import { useEffect, useId, useState, type ReactNode } from "react";
import {
  crewApi,
  val,
  type AgentSession,
  type Row,
  type SessionChange,
} from "./crewApi";
import { copyText } from "./projectAgents";

const when = (raw: unknown) => {
  const date = new Date(String(raw || ""));
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
};

/** "Revision N · edited by X, date", or the built-in default at revision 0. */
export function sessionRevisionLine(session: AgentSession) {
  if (!session.revision) return "Built-in default · not edited yet";
  const by = session.edited_by || "unknown";
  const date = when(session.edited_at);
  return `Revision ${session.revision} · edited by ${by}${date ? `, ${date}` : ""}${session.is_default ? " · built-in default" : ""}`;
}

const conflictMessage =
  "Someone saved a newer revision meanwhile. Reload it, then make your change again.";

function failure(e: unknown) {
  const status = (e as { status?: number })?.status;
  if (status === 409) return conflictMessage;
  const message =
    (e as { response?: { message?: string } })?.response?.message ||
    (e instanceof Error ? e.message : "");
  return message || "Could not save. Check your connection and try again.";
}

/**
 * The body of the "Session instructions for <agent>" dialog: the saved
 * instructions, with hand editing, history and restore, and a prompt that asks
 * an agent to rewrite them (the recommended path). Every save is a new
 * revision, checked against the revision shown.
 */
export default function SessionInstructions({
  session,
  onChange,
  Markdown,
}: {
  session: AgentSession;
  /** The latest saved session, after a save or reload. */
  onChange: (session: AgentSession) => void;
  /** Renders Markdown the way the rest of the reader does. */
  Markdown: (props: { children: string }) => ReactNode;
}) {
  const [mode, setMode] = useState<"read" | "edit" | "history">("read");
  const [text, setText] = useState(session.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<Row[] | null>(null);
  const [copied, setCopied] = useState<"" | "copied" | "manual">("");
  const editorId = useId();
  const agent = session.agent.id;
  const name = session.agent.name;

  // A copied rewrite prompt names the revision it was copied at.
  useEffect(() => setCopied(""), [session.revision]);
  useEffect(() => {
    if (mode !== "history") return;
    let alive = true;
    setHistory(null);
    crewApi
      .read("session_revisions", { parent: agent })
      .then((rows) => {
        if (alive) setHistory(rows);
      })
      .catch((e) => {
        if (alive) setError(failure(e));
      });
    return () => {
      alive = false;
    };
  }, [mode, agent, session.revision]);

  const reload = async () => {
    setBusy(true);
    setError("");
    try {
      const next = await crewApi.session(agent);
      onChange(next);
      return next;
    } catch (e) {
      setError(failure(e));
    } finally {
      setBusy(false);
    }
  };
  const save = async (change: SessionChange, reason: string) => {
    setBusy(true);
    setError("");
    try {
      const next = await crewApi.updateSession(
        agent,
        session.revision,
        change,
        reason,
      );
      onChange(next);
      setMode("read");
      return true;
    } catch (e) {
      setError(failure(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const rewrite = async () => {
    setCopied((await copyText(session.rewrite_prompt)) ? "copied" : "manual");
  };

  return (
    <div className="crew-dialog-body crew-session-dialog">
      <p className="crew-session-hint">
        These instructions are saved in Crew, not in the code. Edit them by
        hand, or ask an agent to rewrite them.
      </p>
      <p className="crew-footnote crew-session-revision">
        {sessionRevisionLine(session)}
      </p>
      <div className="crew-session-toolbar">
        <div className="crew-session-rewrite">
          <button
            type="button"
            className="crew-primary"
            disabled={!session.rewrite_prompt}
            onClick={() => void rewrite()}
          >
            {copied === "copied" ? "Rewrite prompt copied" : "Rewrite with an agent"}
          </button>
          <small>
            Recommended. Copies a prompt for an agent conversation: the agent
            reads the current text, asks what to change, shows you the new
            version and saves it only after you approve.
          </small>
        </div>
        {mode === "read" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setText(session.body);
              setError("");
              setMode("edit");
            }}
          >
            Edit
          </button>
        ) : null}
        <button
          type="button"
          aria-pressed={mode === "history"}
          disabled={busy}
          onClick={() => {
            setError("");
            setMode(mode === "history" ? "read" : "history");
          }}
        >
          History
        </button>
        <button
          type="button"
          disabled={busy || session.is_default}
          title={
            session.is_default
              ? "These are already the built-in instructions"
              : undefined
          }
          onClick={() =>
            void save({ restore_default: true }, "Restore default")
          }
        >
          Restore default
        </button>
      </div>
      {copied === "manual" && (
        <div role="alert" className="crew-session-note">
          <p>Could not copy automatically. Copy this into an agent conversation:</p>
          <textarea
            readOnly
            aria-label={`Rewrite prompt for ${name}`}
            value={session.rewrite_prompt}
            rows={5}
            onFocus={(e) => e.currentTarget.select()}
          />
        </div>
      )}
      {error && (
        <div role="alert" className="crew-session-note crew-session-error">
          <p>{error}</p>
          {error === conflictMessage && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void reload().then((next) => {
                  if (next && mode === "edit") setText(next.body);
                })
              }
            >
              Reload latest
            </button>
          )}
        </div>
      )}
      {mode === "edit" && (
        <form
          className="crew-session-editor"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) void save({ instructions: text }, "Edited by hand");
          }}
        >
          <label htmlFor={editorId}>
            Session instructions <small>Markdown supported</small>
          </label>
          <textarea
            id={editorId}
            value={text}
            rows={18}
            required
            onChange={(e) => setText(e.target.value)}
          />
          <p className="crew-footnote">
            The agent brief is added after these instructions; edit it on the
            agent card.
          </p>
          <div className="crew-session-actions">
            <button
              type="submit"
              className="crew-primary"
              disabled={busy || !text.trim()}
            >
              {busy ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setError("");
                setMode("read");
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {mode === "history" && (
        <section aria-label="Revision history" className="crew-session-history">
          <p>Restoring creates a new revision and keeps every earlier one.</p>
          {history === null && !error && <p>Loading history…</p>}
          {history?.length === 0 && (
            <p>No saved revisions yet: these are the built-in instructions.</p>
          )}
          {history && history.length > 0 && (
            <ol>
              {history.map((x) => (
                <li key={x.id}>
                  <details>
                    <summary>
                      Revision {x.revision} ·{" "}
                      {val(x, "edited_by") || val(x, "reported_agent") || "unknown"}{" "}
                      · {when(x.created)}
                      {x.is_default === true ? " · built-in default" : ""}
                      {x.revision === session.revision ? " · current" : ""}
                    </summary>
                    {val(x, "reason") && (
                      <p className="crew-footnote">{val(x, "reason")}</p>
                    )}
                    <Markdown>{val(x, "instructions")}</Markdown>
                  </details>
                  {x.revision !== session.revision && (
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={`Restore revision ${x.revision}`}
                      onClick={() =>
                        void save(
                          { restore_revision: x.revision },
                          `Restore revision ${x.revision}`,
                        )
                      }
                    >
                      Restore
                    </button>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
      {mode === "read" && <Markdown>{session.instructions}</Markdown>}
    </div>
  );
}
