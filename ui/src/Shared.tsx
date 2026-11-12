import { useCallback, useEffect, useState, type ComponentType } from "react";
import { crewApi, val, list, type ArtifactLink, type Row } from "./crewApi";
import { itemPath } from "./itemLink";
import "./shared.css";

/**
 * The owner's Shared page (#/shared): every artifact with its status, link,
 * views and sources. Publishing, replacing and revoking happen only here (the
 * owner's browser); agents create and edit drafts over MCP.
 */
export const PUBLISH_RISK =
  "Anyone with this link can view it until you revoke it.";

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

function when(value: unknown): string {
  const text = typeof value === "string" ? value : "";
  const time = Date.parse(text.includes("T") ? text : text.replace(" ", "T"));
  if (!text || !Number.isFinite(time)) return "";
  return new Date(time).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function Shared({ notes, tasks, focus, Prose }: Props) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [links, setLinks] = useState<Record<string, ArtifactLink>>({});
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const [artifacts, published] = await Promise.all([
        crewApi.read("artifacts"),
        crewApi.artifactLinks(),
      ]);
      setRows(artifacts);
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

  if (!rows) return <p className="crew-shared-loading">Loading artifacts…</p>;
  return (
    <section className="crew-shared" aria-label="Shared artifacts">
      {error && (
        <p role="alert" className="crew-alert">
          {error}
        </p>
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
      <ol className="crew-shared-list">
        {rows.map((row) => (
          <ArtifactCard
            key={`${row.id}-${row.revision}`}
            row={row}
            link={links[row.id]}
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

function ArtifactCard({
  row,
  link,
  focused,
  notes,
  tasks,
  Prose,
  reload,
}: {
  row: Row;
  link?: ArtifactLink;
  focused: boolean;
  notes: Row[];
  tasks: Row[];
  Prose: ComponentType<{ children: string }>;
  reload: () => Promise<void>;
}) {
  const status = val(row, "status") || "draft";
  const pending = row.pending_changes === true;
  const [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState(focused && status === "draft");
  const [title, setTitle] = useState(val(row, "title"));
  const [body, setBody] = useState(val(row, "body"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<"" | "copied" | "failed">("");
  const url = artifactUrl(link);
  const run = async (action: string, data: Record<string, unknown> = {}) => {
    setBusy(true);
    setError("");
    try {
      await crewApi.write(action, data, row);
      setEditing(false);
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
  return (
    <li
      id={`artifact-${row.id}`}
      className={`crew-artifact${focused ? " crew-artifact-focused" : ""}`}
    >
      <header>
        <h3>{val(row, "title")}</h3>
        <span className={`crew-artifact-status crew-artifact-${status}`}>
          {status === "published"
            ? "Published"
            : status === "revoked"
              ? "Revoked"
              : "Draft"}
        </span>
        {pending && (
          <span className="crew-artifact-pending">Changes not live</span>
        )}
      </header>
      <p className="crew-artifact-meta">
        {[
          status === "published" && val(row, "published_at")
            ? `Published ${when(row.published_at)}`
            : "",
          Number(row.published_revision) > 1
            ? `revision ${row.published_revision}`
            : "",
          status === "revoked" ? `Revoked ${when(row.revoked_at)}` : "",
          Number(row.published_revision) > 0
            ? `${views} ${views === 1 ? "view" : "views"}`
            : "",
          row.last_viewed_at ? `last viewed ${when(row.last_viewed_at)}` : "",
          val(row, "created_by_agent")
            ? `drafted by ${val(row, "created_by_agent")}`
            : "",
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {status === "published" && url && (
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
          {copied === "failed" && (
            <span role="alert" className="crew-copy-error">
              Could not copy automatically. Copy it from the box.
            </span>
          )}
        </div>
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
          The draft differs from the published page. Replace content to put it
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
          <div className="crew-artifact-actions">
            {status !== "published" && (
              <span className="crew-artifact-publish">
                <button
                  type="button"
                  className="crew-primary"
                  disabled={busy}
                  onClick={() => void run("artifact.publish")}
                >
                  {status === "revoked" ? "Publish again" : "Publish"}
                </button>
                <small>
                  {PUBLISH_RISK}
                  {status === "revoked" ? " Publishing gives a new link." : ""}
                </small>
              </span>
            )}
            {status === "published" && pending && (
              <button
                type="button"
                className="crew-primary"
                disabled={busy}
                onClick={() => void run("artifact.replace")}
              >
                Replace content
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => setPreview((p) => !p)}
            >
              {preview ? "Hide draft" : "Show draft"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setEditing(true)}
            >
              Edit draft
            </button>
            {status === "published" && (
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
