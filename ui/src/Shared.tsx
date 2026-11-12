import { useCallback, useEffect, useState, type ComponentType } from "react";
import { crewApi, val, list, type ArtifactLink, type Row } from "./crewApi";
import {
  itemPath,
  sharedFilters,
  sharedFiltersFromHash,
  sharedHash,
  type SharedFilter,
} from "./itemLink";
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

const filterLabels: Record<SharedFilter, string> = {
  drafts: "Drafts",
  live: "Live",
  ended: "Revoked/expired",
  archived: "Archived",
};

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

function when(value: unknown, withTime = true): string {
  const text = typeof value === "string" ? value : "";
  const time = Date.parse(text.includes("T") ? text : text.replace(" ", "T"));
  if (!text || !Number.isFinite(time)) return "";
  return new Date(time).toLocaleString(
    undefined,
    withTime
      ? { dateStyle: "medium", timeStyle: "short" }
      : { dateStyle: "medium" },
  );
}

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
  const [rows, setRows] = useState<Row[] | null>(null);
  const [links, setLinks] = useState<Record<string, ArtifactLink>>({});
  const [error, setError] = useState("");
  const [filters, setFilters] = useState<SharedFilter[]>(() =>
    sharedFiltersFromHash(location.hash),
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
      setError(e instanceof Error ? e.message : "Could not load artifacts.");
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
  const toggle = (filter: SharedFilter) => {
    const next = filters.includes(filter)
      ? filters.filter((f) => f !== filter)
      : [...filters, filter];
    setFilters(next);
    // Keeps the choice in the address without firing hashchange.
    if (!focus)
      history.replaceState(
        null,
        "",
        location.pathname + location.search + sharedHash(next),
      );
  };

  if (!rows) return <p className="crew-shared-loading">Loading artifacts…</p>;
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  const counts = Object.fromEntries(
    sharedFilters.map((f) => [
      f,
      rows.filter((r) => filterOf(artifactState(r)) === f).length,
    ]),
  ) as Record<SharedFilter, number>;
  // A focused artifact (#/shared/<id>) shows whatever its state.
  const shown = rows.filter(
    (r) => r.id === focus || filters.includes(filterOf(artifactState(r))),
  );
  return (
    <section className="crew-shared" aria-label="Shared artifacts">
      {error && (
        <p role="alert" className="crew-alert">
          {error}
        </p>
      )}
      {rows.length > 0 && (
        <div
          className="crew-shared-filters"
          role="group"
          aria-label="Show artifacts"
        >
          {sharedFilters.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filters.includes(f)}
              onClick={() => toggle(f)}
            >
              {filterLabels[f]} <span>{counts[f]}</span>
            </button>
          ))}
        </div>
      )}
      {!rows.length && (
        <div className="crew-empty">
          <span aria-hidden="true">↗</span>
          <h3>Nothing shared yet</h3>
          <p>
            Open a note and choose Share as artifact, or ask an agent to make an
            artifact from your notes.
          </p>
        </div>
      )}
      {rows.length > 0 && !shown.length && (
        <p className="crew-shared-none">No artifacts match these filters.</p>
      )}
      <ol className="crew-shared-list">
        {shown.map((row) => (
          <ArtifactCard
            key={`${row.id}-${row.revision}`}
            row={row}
            link={links[row.id]}
            target={byId[val(row, "merged_into") || val(row, "replaces")]}
            focused={row.id === focus}
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
  notes,
  tasks,
  Prose,
  reload,
}: {
  row: Row;
  link?: ArtifactLink;
  target?: Row;
  focused: boolean;
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
  const [editing, setEditing] = useState(false);
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
      setError(e instanceof Error ? e.message : "That did not work.");
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
      title: item ? val(item, "title") : "Unavailable item",
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
        <h3>{val(row, "title")}</h3>
        <span className={`crew-artifact-status crew-artifact-${state}`}>
          {stateLabels[state]}
        </span>
        {pending && (
          <span className="crew-artifact-pending">Changes not live</span>
        )}
      </header>
      {mergedInto && (
        <>
          <p className="crew-artifact-update">
            Merged into{" "}
            {target ? (
              <a href={`#/shared/${target.id}`}>{val(target, "title")}</a>
            ) : (
              "an unavailable artifact"
            )}
            {val(row, "merged_at") ? ` on ${when(row.merged_at, false)}` : ""}
          </p>
          <p className="crew-artifact-note">
            {targetLive ? "Its content is live in that link. " : ""}Restore
            brings back this draft only; the link does not change.
          </p>
        </>
      )}
      {updates && !mergedInto && (
        <p className="crew-artifact-update">
          Update of:{" "}
          {target ? (
            <a href={`#/shared/${target.id}`}>{val(target, "title")}</a>
          ) : (
            "an unavailable artifact"
          )}
          {target && !targetLive ? " (its link no longer works)" : ""}
        </p>
      )}
      <p className="crew-artifact-meta">
        {[
          state === "published" && val(row, "published_at")
            ? `Published ${when(row.published_at)}`
            : "",
          Number(row.published_revision) > 1
            ? `revision ${row.published_revision}`
            : "",
          state === "published"
            ? expires
              ? `expires ${when(expires)}`
              : "no expiry"
            : "",
          state === "expired" ? `Expired ${when(expires)}` : "",
          state === "revoked" ? `Revoked ${when(row.revoked_at)}` : "",
          state === "archived" ? `Archived ${when(row.archived_at)}` : "",
          everPublished ? `${views} ${views === 1 ? "view" : "views"}` : "",
          everPublished
            ? row.last_viewed_at
              ? `last opened ${when(row.last_viewed_at)}`
              : "never opened"
            : "",
          val(row, "created_by_agent")
            ? `drafted by ${val(row, "created_by_agent")}`
            : "",
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {url && (
        <div className="crew-artifact-link">
          <input
            readOnly
            aria-label={`Link to ${val(row, "title")}`}
            value={url}
            onFocus={(e) => e.currentTarget.select()}
          />
          <button type="button" onClick={() => void copy()}>
            {copied === "copied" ? "Link copied" : "Copy link"}
          </button>
          {/* Opens what recipients see in a new tab; Crew does not count it
              as a view (same-origin navigation). */}
          <a
            className="crew-artifact-open"
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${val(row, "title")} in a new tab`}
          >
            Open
          </a>
          {copied === "failed" && (
            <span role="alert" className="crew-copy-error">
              Could not copy automatically. Copy it from the box.
            </span>
          )}
        </div>
      )}
      {(state === "expired" || state === "revoked") && (
        <p className="crew-artifact-note">
          The link no longer works: visitors see “This link is no longer
          available”. Publishing again gives a new link.
        </p>
      )}
      {sources.length > 0 && (
        <p className="crew-artifact-sources">
          Sources:{" "}
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
          The draft differs from the published page. Update content to put it
          live under the same link.
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
            Title
            <input
              aria-label="Artifact title"
              value={title}
              maxLength={300}
              required
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label>
            Page
            <textarea
              aria-label="Artifact page"
              value={body}
              rows={12}
              onChange={(e) => setBody(e.target.value)}
            />
          </label>
          <div className="crew-artifact-actions">
            <button type="submit" className="crew-primary" disabled={busy}>
              Save draft
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
              Cancel
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
                <p>Nothing written yet.</p>
              )}
            </div>
          )}
          {choosing && (
            <div
              className="crew-artifact-choice"
              role="group"
              aria-label="How to publish this update"
            >
              <p>This draft updates “{target ? val(target, "title") : ""}”.</p>
              <button
                type="button"
                className="crew-primary"
                disabled={busy || !targetLive}
                onClick={() =>
                  void run("artifact.publish", { mode: "replace" })
                }
              >
                Replace the existing link's content
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void run("artifact.publish", { mode: "new" })}
              >
                Publish as a new link
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setChoosing(false)}
              >
                Cancel
              </button>
              <small>
                {targetLive
                  ? "Replace keeps the same link and shows this draft from now on; the earlier version stays in history and this draft is archived."
                  : "The link this draft updates no longer works, so it can only be published as a new link."}
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
                Link expires
                <select
                  aria-label="Link expires"
                  value={expiryChoice}
                  onChange={(e) => setExpiryChoice(e.target.value)}
                >
                  <option value="none">Never</option>
                  <option value="7">In 7 days</option>
                  <option value="30">In 30 days</option>
                  <option value="date">On a date…</option>
                </select>
              </label>
              {expiryChoice === "date" && (
                <input
                  type="date"
                  aria-label="Expiry date"
                  required
                  value={expiryDate}
                  min={localDate(new Date())}
                  onChange={(e) => setExpiryDate(e.target.value)}
                />
              )}
              <button type="submit" className="crew-primary" disabled={busy}>
                Save expiry
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setExpiring(false)}
              >
                Cancel
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
                    ? "Publish"
                    : "Publish again with a new link"}
                </button>
                <small>
                  {PUBLISH_RISK}
                  {state !== "draft" ? " The old link never works again." : ""}
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
                Update content (same link)
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => setPreview((p) => !p)}
            >
              {preview ? "Hide draft" : "Show draft"}
            </button>
            {state !== "archived" && (
              <button
                type="button"
                disabled={busy}
                onClick={() => setEditing(true)}
              >
                Edit draft
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
                Set expiry
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
                      "Revoke this link? It stops working at once for everyone who has it.",
                    )
                  )
                    void run("artifact.revoke");
                }}
              >
                Revoke
              </button>
            )}
            {state === "draft" && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (
                    confirm(
                      "Discard this draft? It moves to Archived, where you can restore it.",
                    )
                  )
                    void run("artifact.archive");
                }}
              >
                Discard
              </button>
            )}
            {(state === "expired" || state === "revoked") && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void run("artifact.archive")}
              >
                Archive
              </button>
            )}
            {state === "archived" && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void run("artifact.restore")}
              >
                Restore
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
