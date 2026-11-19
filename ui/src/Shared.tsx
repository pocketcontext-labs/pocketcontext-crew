import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { crewApi, val, list, type ArtifactLink, type Row } from "./crewApi";
import {
  itemPath,
  sharedFilters,
  sharedFilterFromHash,
  sharedHash,
  type SharedFilter,
} from "./itemLink";
import ColumnSwitcher from "./ColumnSwitcher";
import { usePhone } from "./usePhone";
import AutoTextarea from "./AutoTextarea";
import PagePreview, { isStandaloneDisplay } from "./PagePreview";
import { ListNavCluster } from "./DialogHeader";
import { t, tc, tn } from "./i18n";
import { listKeyStep, type Step } from "./swipe";
import { parseInstant, RelativeTime, type Instant } from "./relativeTime";
import "./shared.css";

/**
 * The owner's Shared page (#/shared): every artifact with its state, link,
 * expiry, views and sources. Publishing, replacing, revoking, expiry,
 * archiving and restoring happen only here (the owner's browser); agents
 * create and edit drafts over MCP, including drafts that update another
 * artifact's link (replaces).
 */
export const PUBLISH_RISK =
  "Anyone with this link can view it until you revoke it or it expires.";
/** PUBLISH_RISK in the reader's language. */
const publishRisk = () =>
  t("Anyone with this link can view it until you revoke it or it expires.");

/** A status's label in the reader's language. */
function filterLabel(f: SharedFilter): string {
  if (f === "drafts") return t("Drafts");
  if (f === "live") return t("Live");
  // Plural like the others ("Revocate" in Italian, not the badge's "Revocata").
  if (f === "ended") return tc("shared", "Revoked");
  return t("Archived");
}

/**
 * The status shown without a choice in the address: a focused artifact's own
 * status, else Live, else the first status with artifacts, else Live.
 */
export function defaultSharedFilter(
  counts: Record<SharedFilter, number>,
  focused?: SharedFilter,
): SharedFilter {
  if (focused) return focused;
  if (counts.live) return "live";
  return sharedFilters.find((f) => counts[f] > 0) ?? "live";
}

type State = "draft" | "published" | "expired" | "revoked" | "archived";

/** The lifecycle state, from the server's derived state when present. */
export function artifactState(row: Row): State {
  const state = val(row, "state");
  if (["draft", "published", "expired", "revoked", "archived"].includes(state))
    return state as State;
  if (row.archived === true) return "archived";
  const status = val(row, "status");
  return status === "published" || status === "revoked" ? status : "draft";
}

function filterOf(state: State): SharedFilter {
  return state === "draft"
    ? "drafts"
    : state === "published"
      ? "live"
      : state === "archived"
        ? "archived"
        : "ended";
}

type Props = {
  notes: Row[];
  tasks: Row[];
  focus?: string;
  Prose: ComponentType<{ children: string }>;
};

export function artifactUrl(link: ArtifactLink | undefined): string {
  if (!link) return "";
  return link.link || `${location.origin}${link.link_path}`;
}

/** A date part of the meta line: prefix plus relative time (exact on hover). */
const at = (prefix: string, value: unknown) =>
  parseInstant(value as Instant) ? (
    <RelativeTime value={value as Instant} prefix={prefix} />
  ) : (
    prefix.trim()
  );

/** A date as YYYY-MM-DD in the owner's time zone (for date inputs). */
function localDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Expiry choices: none, 7 or 30 days from now, or a chosen date. */
export function expiryFrom(
  choice: string,
  date: string,
  now = Date.now(),
): string {
  if (choice === "7" || choice === "30")
    return new Date(now + Number(choice) * 86400000).toISOString();
  if (choice === "date" && date) {
    // The end of the chosen day, in the owner's time zone.
    const [y, m, d] = date.split("-").map(Number);
    return new Date(y, m - 1, d, 23, 59, 59).toISOString();
  }
  return "";
}

export default function Shared({ notes, tasks, focus, Prose }: Props) {
  const phone = usePhone();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [links, setLinks] = useState<Record<string, ArtifactLink>>({});
  const [error, setError] = useState("");
  // The owner's choice (address or switcher); null until one is made, then
  // the default comes from the loaded counts, so no wrong list flashes.
  const [chosen, setChosen] = useState<SharedFilter | null>(() =>
    sharedFilterFromHash(location.hash),
  );
  const load = useCallback(async () => {
    try {
      const [active, archived, published] = await Promise.all([
        crewApi.read("artifacts"),
        crewApi.read("artifacts", { archived: true }),
        crewApi.artifactLinks(),
      ]);
      setRows([...active, ...archived]);
      setLinks(Object.fromEntries(published.map((l) => [l.id, l])));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Could not load artifacts."));
      setRows((r) => r ?? []);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!focus || !rows) return;
    document
      .getElementById(`artifact-${focus}`)
      ?.scrollIntoView?.({ block: "start" });
  }, [focus, rows]);
  const counts = Object.fromEntries(
    sharedFilters.map((f) => [
      f,
      (rows ?? []).filter((r) => filterOf(artifactState(r)) === f).length,
    ]),
  ) as Record<SharedFilter, number>;
  const focusedRow = focus ? rows?.find((r) => r.id === focus) : undefined;
  const filter =
    chosen ??
    defaultSharedFilter(
      counts,
      focusedRow ? filterOf(artifactState(focusedRow)) : undefined,
    );
  // A focused artifact (#/shared/<id>) shows whatever its state.
  const shown = (rows ?? []).filter(
    (r) => r.id === focus || filterOf(artifactState(r)) === filter,
  );
  // A focused artifact (#/shared/<id>) is the Shared page's detail view: it
  // steps through the list as shown (0.35.0), J/K too, outside fields.
  const shownIds = shown.map((r) => r.id);
  const focusIndex = focus ? shownIds.indexOf(focus) : -1;
  const stepTo = (step: Step) => {
    const id = focusIndex >= 0 ? shownIds[focusIndex + step] : undefined;
    // A plain history entry per step, like a list step in a dialog.
    if (id) location.hash = `#/shared/${id}`;
  };
  const stepRef = useRef(stepTo);
  stepRef.current = stepTo;
  useEffect(() => {
    if (focusIndex < 0) return;
    const onKey = (e: KeyboardEvent) => {
      // Another dialog or popover over the page owns its keys.
      if (document.querySelector("dialog[open], .crew-page-preview")) return;
      const step = listKeyStep(e, document.body);
      if (!step) return;
      e.preventDefault();
      stepRef.current(step);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [focusIndex]);
  const select = (next: SharedFilter) => {
    setChosen(next);
    // Keeps the choice in the address without firing hashchange.
    if (!focus)
      history.replaceState(
        null,
        "",
        location.pathname + location.search + sharedHash(next),
      );
  };

  if (!rows)
    return <p className="crew-shared-loading">{t("Loading artifacts…")}</p>;
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  return (
    <section className="crew-shared" aria-label={t("Shared artifacts")}>
      {rows.length > 0 && !phone && (
        // A desktop shows every status at once, like the Tasks agent row
        // (same chips); one is chosen at a time and Shared has no "All".
        <div
          className="crew-agent-row crew-shared-status-row"
          role="group"
          aria-label={t("Filter by status")}
        >
          {sharedFilters.map((f) => (
            <button
              key={f}
              type="button"
              className="crew-agent-chip"
              aria-pressed={filter === f}
              aria-label={tn(
                counts[f],
                "{name}, {n} shared page",
                "{name}, {n} shared pages",
                { name: filterLabel(f) },
              )}
              title={f === "ended" ? t("Revoked or expired") : undefined}
              onClick={() => select(f)}
            >
              {filterLabel(f)}
              <span className="crew-agent-chip-count" aria-hidden="true">
                {counts[f]}
              </span>
            </button>
          ))}
        </div>
      )}
      {rows.length > 0 && phone && (
        <ColumnSwitcher
          className="crew-shared-switcher"
          item="status"
          pickerLabel="Show artifacts"
          noun={["shared page", "shared pages"]}
          columns={sharedFilters.map((f) => ({
            status: f,
            label: filterLabel(f),
            count: counts[f],
            hint: f === "ended" ? t("Revoked or expired") : undefined,
          }))}
          current={filter}
          onSelect={(f) => select(f as SharedFilter)}
        />
      )}
      {error && (
        <p role="alert" className="crew-alert">
          {error}
        </p>
      )}
      {!rows.length && (
        <div className="crew-empty">
          <span aria-hidden="true">↗</span>
          <h3>{t("Nothing shared yet")}</h3>
          <p>
            {t(
              "Open a note and choose Share as artifact, or ask an agent to make an artifact from your notes.",
            )}
          </p>
        </div>
      )}
      {rows.length > 0 && !shown.length && (
        <p className="crew-shared-none">{t("No artifacts with this status.")}</p>
      )}
      <ol className="crew-shared-list">
        {shown.map((row) => (
          <ArtifactCard
            key={`${row.id}-${row.revision}`}
            row={row}
            link={links[row.id]}
            target={byId[val(row, "merged_into") || val(row, "replaces")]}
            focused={row.id === focus}
            listNav={
              row.id === focus && focusIndex >= 0 ? (
                <ListNavCluster
                  noun="shared page"
                  index={focusIndex}
                  count={shownIds.length}
                  previous={focusIndex > 0 ? () => stepTo(-1) : undefined}
                  next={
                    focusIndex < shownIds.length - 1
                      ? () => stepTo(1)
                      : undefined
                  }
                />
              ) : undefined
            }
            notes={notes}
            tasks={tasks}
            Prose={Prose}
            reload={load}
          />
        ))}
      </ol>
    </section>
  );
}

// English labels, translated where they render (catalog: pages.ts).
const stateLabels: Record<State, string> = {
  draft: "Draft",
  published: "Published",
  expired: "Expired",
  revoked: "Revoked",
  archived: "Archived",
};

function ArtifactCard({
  row,
  link,
  target,
  focused,
  listNav,
  notes,
  tasks,
  Prose,
  reload,
}: {
  row: Row;
  link?: ArtifactLink;
  target?: Row;
  focused: boolean;
  /** Previous/next through the Shared list, on the focused artifact. */
  listNav?: ReactNode;
  notes: Row[];
  tasks: Row[];
  Prose: ComponentType<{ children: string }>;
  reload: () => Promise<void>;
}) {
  const state = artifactState(row);
  const pending = row.pending_changes === true;
  const updates = val(row, "replaces");
  // An archived update draft whose content went live (Update content, same
  // link) says so; a discarded one keeps "Update of".
  const mergedInto = val(row, "merged_into");
  const targetLive = !!target && artifactState(target) === "published";
  // A new empty draft (Home's + → Shared page) opens ready to write.
  const [editing, setEditing] = useState(
    () => focused && state === "draft" && !val(row, "body"),
  );
  const [choosing, setChoosing] = useState(false);
  const [expiring, setExpiring] = useState(false);
  const [expiryChoice, setExpiryChoice] = useState("none");
  const [expiryDate, setExpiryDate] = useState("");
  const [preview, setPreview] = useState(focused && state === "draft");
  const [title, setTitle] = useState(val(row, "title"));
  const [body, setBody] = useState(val(row, "body"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<"" | "copied" | "failed">("");
  const [previewing, setPreviewing] = useState(false);
  const url = state === "published" ? artifactUrl(link) : "";
  const run = async (action: string, data: Record<string, unknown> = {}) => {
    setBusy(true);
    setError("");
    try {
      await crewApi.write(action, data, row);
      setEditing(false);
      setChoosing(false);
      setExpiring(false);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("That did not work."));
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied("copied");
    } catch {
      setCopied("failed");
    }
  };
  const sources = list(row, "sources").map((id) => {
    const note = notes.find((n) => n.id === id);
    const task = note ? undefined : tasks.find((t) => t.id === id);
    const item = note || task;
    return {
      id,
      title: item ? val(item, "title") : t("Unavailable item"),
      href: item ? itemPath(note ? "note" : "task", item) : "",
    };
  });
  const views = Number(row.view_count) || 0;
  const everPublished = Number(row.published_revision) > 0;
  const expires = val(row, "expires_at");
  return (
    <li
      id={`artifact-${row.id}`}
      className={`crew-artifact${focused ? " crew-artifact-focused" : ""}`}
    >
      <header>
        {/* The title opens the artifact by itself (#/shared/<id>), with
            previous/next through the list. */}
        <h3>
          <a className="crew-artifact-title" href={`#/shared/${row.id}`}>
            {val(row, "title")}
          </a>
        </h3>
        <span className={`crew-artifact-status crew-artifact-${state}`}>
          {t(stateLabels[state])}
        </span>
        {pending && (
          <span className="crew-artifact-pending">{t("Changes not live")}</span>
        )}
        {listNav}
      </header>
      {mergedInto && (
        <>
          <p className="crew-artifact-update">
            {t("Merged into")}{" "}
            {target ? (
              <a href={`#/shared/${target.id}`}>{val(target, "title")}</a>
            ) : (
              t("an unavailable artifact")
            )}
            {val(row, "merged_at") ? (
              <>
                {" "}
                <RelativeTime value={val(row, "merged_at")} />
              </>
            ) : (
              ""
            )}
          </p>
          <p className="crew-artifact-note">
            {targetLive ? t("Its content is live in that link.") + " " : ""}
            {t("Restore brings back this draft only; the link does not change.")}
          </p>
        </>
      )}
      {updates && !mergedInto && (
        <p className="crew-artifact-update">
          {t("Update of:")}{" "}
          {target ? (
            <a href={`#/shared/${target.id}`}>{val(target, "title")}</a>
          ) : (
            t("an unavailable artifact")
          )}
          {target && !targetLive ? t(" (its link no longer works)") : ""}
        </p>
      )}
      <p className="crew-artifact-meta">
        {[
          state === "published" && val(row, "published_at")
            ? at(t("Published "), row.published_at)
            : "",
          Number(row.published_revision) > 1
            ? t("revision {n}", { n: String(row.published_revision) })
            : "",
          state === "published"
            ? expires
              ? at(t("expires "), expires)
              : t("no expiry")
            : "",
          state === "expired" ? at(t("Expired "), expires) : "",
          state === "revoked" ? at(t("Revoked "), row.revoked_at) : "",
          state === "archived" ? at(t("Archived "), row.archived_at) : "",
          everPublished ? tn(views, "{n} view", "{n} views") : "",
          everPublished
            ? row.last_viewed_at
              ? at(t("last opened "), row.last_viewed_at)
              : t("never opened")
            : "",
          val(row, "created_by_agent")
            ? t("drafted by {agent}", { agent: val(row, "created_by_agent") })
            : "",
        ]
          .filter(Boolean)
          .map((part, i) => (
            <Fragment key={i}>
              {i > 0 && " · "}
              {part}
            </Fragment>
          ))}
      </p>
      {url && (
        <div className="crew-artifact-link">
          <input
            readOnly
            aria-label={t("Link to {title}", { title: val(row, "title") })}
            value={url}
            onFocus={(e) => e.currentTarget.select()}
          />
          <button type="button" onClick={() => void copy()}>
            {copied === "copied" ? t("Link copied") : t("Copy link")}
          </button>
          {/* Opens what recipients see in a new tab; Crew does not count it
              as a view (same-origin navigation). The home-screen app has no
              Back, so there it opens in the in-app preview instead. */}
          <a
            className="crew-artifact-open"
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t("Open {title} in a new tab", { title: val(row, "title") })}
            onClick={(e) => {
              if (!isStandaloneDisplay()) return;
              e.preventDefault();
              setPreviewing(true);
            }}
          >
            {t("Open")}
          </a>
          {previewing && (
            <PagePreview
              url={url}
              title={val(row, "published_title") || val(row, "title")}
              backLabel={t("Back to Shared")}
              onClose={() => setPreviewing(false)}
            />
          )}
          {copied === "failed" && (
            <span role="alert" className="crew-copy-error">
              {t("Could not copy automatically. Copy it from the box.")}
            </span>
          )}
        </div>
      )}
      {(state === "expired" || state === "revoked") && (
        <p className="crew-artifact-note">
          {t(
            "The link no longer works: visitors see “This link is no longer available”. Publishing again gives a new link.",
          )}
        </p>
      )}
      {sources.length > 0 && (
        <p className="crew-artifact-sources">
          {t("Sources:")}{" "}
          {sources.map((s, i) => (
            <span key={s.id}>
              {i > 0 && ", "}
              {s.href ? <a href={s.href}>{s.title}</a> : s.title}
            </span>
          ))}
        </p>
      )}
      {pending && (
        <p className="crew-artifact-note">
          {t(
            "The draft differs from the published page. Update content to put it live under the same link.",
          )}
        </p>
      )}
      {editing ? (
        <form
          className="crew-artifact-edit"
          onSubmit={(e) => {
            e.preventDefault();
            const data: Record<string, unknown> = {};
            if (title !== val(row, "title")) data.title = title;
            if (body !== val(row, "body")) data.body = body;
            if (!Object.keys(data).length) setEditing(false);
            else void run("artifact.update", data);
          }}
        >
          <label>
            {t("Title")}
            <AutoTextarea
              aria-label={t("Artifact title")}
              value={title}
              maxLength={300}
              required
              onValue={setTitle}
            />
          </label>
          <label>
            {t("Page")}
            <textarea
              aria-label={t("Artifact page")}
              value={body}
              rows={12}
              onChange={(e) => setBody(e.target.value)}
            />
          </label>
          <div className="crew-artifact-actions">
            <button type="submit" className="crew-primary" disabled={busy}>
              {t("Save draft")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setTitle(val(row, "title"));
                setBody(val(row, "body"));
                setEditing(false);
              }}
            >
              {t("Cancel")}
            </button>
          </div>
        </form>
      ) : (
        <>
          {preview && (
            <div className="crew-artifact-preview">
              {val(row, "body").trim() ? (
                <Prose>{val(row, "body")}</Prose>
              ) : (
                <p>{t("Nothing written yet.")}</p>
              )}
            </div>
          )}
          {choosing && (
            <div
              className="crew-artifact-choice"
              role="group"
              aria-label={t("How to publish this update")}
            >
              <p>
                {t("This draft updates “{title}”.", {
                  title: target ? val(target, "title") : "",
                })}
              </p>
              <button
                type="button"
                className="crew-primary"
                disabled={busy || !targetLive}
                onClick={() =>
                  void run("artifact.publish", { mode: "replace" })
                }
              >
                {t("Replace the existing link's content")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void run("artifact.publish", { mode: "new" })}
              >
                {t("Publish as a new link")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setChoosing(false)}
              >
                {t("Cancel")}
              </button>
              <small>
                {targetLive
                  ? t(
                      "Replace keeps the same link and shows this draft from now on; the earlier version stays in history and this draft is archived.",
                    )
                  : t(
                      "The link this draft updates no longer works, so it can only be published as a new link.",
                    )}
              </small>
            </div>
          )}
          {expiring && (
            <form
              className="crew-artifact-expiry"
              onSubmit={(e) => {
                e.preventDefault();
                void run("artifact.set_expiry", {
                  expires_at: expiryFrom(expiryChoice, expiryDate),
                });
              }}
            >
              <label>
                {t("Link expires")}
                <select
                  aria-label={t("Link expires")}
                  value={expiryChoice}
                  onChange={(e) => setExpiryChoice(e.target.value)}
                >
                  <option value="none">{t("Never")}</option>
                  <option value="7">{t("In 7 days")}</option>
                  <option value="30">{t("In 30 days")}</option>
                  <option value="date">{t("On a date…")}</option>
                </select>
              </label>
              {expiryChoice === "date" && (
                <input
                  type="date"
                  aria-label={t("Expiry date")}
                  required
                  value={expiryDate}
                  min={localDate(new Date())}
                  onChange={(e) => setExpiryDate(e.target.value)}
                />
              )}
              <button type="submit" className="crew-primary" disabled={busy}>
                {t("Save expiry")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setExpiring(false)}
              >
                {t("Cancel")}
              </button>
            </form>
          )}
          <div className="crew-artifact-actions">
            {state !== "published" && state !== "archived" && !choosing && (
              <span className="crew-artifact-publish">
                <button
                  type="button"
                  className="crew-primary"
                  disabled={busy}
                  onClick={() =>
                    updates && state === "draft"
                      ? setChoosing(true)
                      : void run("artifact.publish")
                  }
                >
                  {state === "draft"
                    ? t("Publish")
                    : t("Publish again with a new link")}
                </button>
                <small>
                  {publishRisk()}
                  {state !== "draft"
                    ? " " + t("The old link never works again.")
                    : ""}
                </small>
              </span>
            )}
            {state === "published" && pending && (
              <button
                type="button"
                className="crew-primary"
                disabled={busy}
                onClick={() => void run("artifact.replace")}
              >
                {t("Update content (same link)")}
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => setPreview((p) => !p)}
            >
              {preview ? t("Hide draft") : t("Show draft")}
            </button>
            {state !== "archived" && (
              <button
                type="button"
                disabled={busy}
                onClick={() => setEditing(true)}
              >
                {t("Edit draft")}
              </button>
            )}
            {state === "published" && !expiring && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setExpiryChoice(expires ? "date" : "none");
                  setExpiryDate(
                    expires ? localDate(new Date(Date.parse(expires))) : "",
                  );
                  setExpiring(true);
                }}
              >
                {t("Set expiry")}
              </button>
            )}
            {state === "published" && (
              <button
                type="button"
                className="crew-artifact-revoke"
                disabled={busy}
                onClick={() => {
                  if (
                    confirm(
                      t(
                        "Revoke this link? It stops working at once for everyone who has it.",
                      ),
                    )
                  )
                    void run("artifact.revoke");
                }}
              >
                {t("Revoke")}
              </button>
            )}
            {state === "draft" && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (
                    confirm(
                      t(
                        "Discard this draft? It moves to Archived, where you can restore it.",
                      ),
                    )
                  )
                    void run("artifact.archive");
                }}
              >
                {t("Discard")}
              </button>
            )}
            {(state === "expired" || state === "revoked") && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void run("artifact.archive")}
              >
                {t("Archive")}
              </button>
            )}
            {state === "archived" && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void run("artifact.restore")}
              >
                {t("Restore")}
              </button>
            )}
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="crew-alert">
          {error}
        </p>
      )}
    </li>
  );
}
