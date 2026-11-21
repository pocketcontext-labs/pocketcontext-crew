import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { NamedCopyAction } from "./CopyFeedback";
import {
  crewApi,
  val,
  type AgentSession,
  type Row,
  type SessionChange,
} from "./crewApi";
import { t } from "./i18n";
import { copyText } from "./projectAgents";
import PlainRefs from "./PlainRefs";
import { parseInstant, RelativeTime } from "./relativeTime";

/** "Revision N · edited by X, <relative date>", or the built-in default at revision 0. */
function SessionRevisionLine({ session }: { session: AgentSession }) {
  if (!session.revision) return <>{t("Built-in default · not edited yet")}</>;
  const by = session.edited_by || t("unknown");
  return (
    <>
      {t("Revision {n} · edited by {by}", { n: session.revision, by })}
      {parseInstant(session.edited_at) && (
        <>
          , <RelativeTime value={session.edited_at} />
        </>
      )}
      {session.is_default ? t(" · built-in default") : ""}
    </>
  );
}

const conflictMessage = () =>
  t(
    "Someone saved a newer revision meanwhile. Reload it, then make your change again.",
  );

function failure(e: unknown) {
  const status = (e as { status?: number })?.status;
  if (status === 409) return conflictMessage();
  const message =
    (e as { response?: { message?: string } })?.response?.message ||
    (e instanceof Error ? e.message : "");
  return message || t("Could not save. Check your connection and try again.");
}

/**
 * The body of the "Session instructions for <agent>" dialog: the saved
 * instructions, with hand editing, history and restore, and a prompt that asks
 * an agent to rewrite them (the recommended path). Every save is a new
 * revision, checked against the revision shown.
 */
export default function SessionInstructions({
  session,
  initialMode = "read",
  onChange,
  Markdown,
}: {
  session: AgentSession;
  initialMode?: "read" | "edit" | "history";
  /** The latest saved session, after a save or reload. */
  onChange: (session: AgentSession) => void;
  /** Renders Markdown the way the rest of the reader does. */
  Markdown: (props: { children: string }) => ReactNode;
}) {
  const [mode, setMode] = useState<"read" | "edit" | "history">(initialMode);
  // An unsaved hand edit, kept while switching views; null when none.
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<Row[] | null>(null);
  // Manual fallback belongs to the revision whose prompt failed to copy.
  const [failedRevision, setFailedRevision] = useState<number | null>(null);
  const editorId = useId();
  const editor = useRef<HTMLTextAreaElement>(null);
  const templatePreview = useRef<HTMLDetailsElement>(null);
  const agent = session.agent.id;
  const name = session.agent.name;

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
      setText(null);
      setMode("read");
      return true;
    } catch (e) {
      setError(failure(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const show = (next: "read" | "edit" | "history") => {
    setError("");
    if (next === "edit") setText((draft) => draft ?? session.body);
    setMode(next);
  };
  const draft = text ?? session.body;
  const codingTemplate = session.coding_template;
  return (
    <div className="crew-dialog-body crew-session-dialog">
      <p className="crew-footnote crew-session-revision">
        <SessionRevisionLine session={session} />
      </p>
      <div className="crew-session-toolbar">
        <div
          className="crew-session-views"
          role="group"
          aria-label={t("View")}
        >
          <button
            type="button"
            aria-pressed={mode === "read"}
            onClick={() => show("read")}
          >
            {t("Read")}
          </button>
          <button
            type="button"
            aria-pressed={mode === "edit"}
            disabled={busy && mode !== "edit"}
            onClick={() => show("edit")}
          >
            {t("Edit")}
          </button>
          <button
            type="button"
            aria-pressed={mode === "history"}
            disabled={busy && mode !== "history"}
            onClick={() => show("history")}
          >
            {t("History")}
          </button>
        </div>
        {mode !== "read" && <button
          type="button"
          disabled={busy || session.is_default}
          title={
            session.is_default
              ? t("These are already the built-in instructions")
              : undefined
          }
          onClick={() =>
            void save({ restore_default: true }, "Restore default")
          }
        >
          {t("Restore default")}
        </button>}
      </div>
      {/* Only this area changes between Read, Edit and History; the
          dialog, the hint and the toolbar above keep their size and place. */}
      <div className={`crew-session-view crew-session-view-${mode}`}>
        {failedRevision === session.revision && (
          <div role="alert" className="crew-session-note">
            <p>
              {t(
                "Could not copy automatically. Copy this into an agent conversation:",
              )}
            </p>
            <textarea
              readOnly
              aria-label={t("Rewrite prompt for {name}", { name })}
              value={session.rewrite_prompt}
              rows={5}
              onFocus={(e) => e.currentTarget.select()}
            />
          </div>
        )}
        {error && (
          <div role="alert" className="crew-session-note crew-session-error">
            <p>{error}</p>
            {error === conflictMessage() && (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void reload().then((next) => {
                    if (next && mode === "edit") setText(next.body);
                  })
                }
              >
                {t("Reload latest")}
              </button>
            )}
          </div>
        )}
        {mode === "edit" && (
          <form
            className="crew-session-editor"
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.trim()) void save({ instructions: draft }, "Edited by hand");
            }}
          >
            {codingTemplate && (
              <details ref={templatePreview} className="crew-coding-template">
                <summary>{t("Coding workflow template")}</summary>
                <p>{t("Use this template to replace the text in the editor. Save creates a new revision.")}</p>
                <button type="button" disabled={busy || draft === codingTemplate} onClick={() => {
                  setText(codingTemplate);
                  if (templatePreview.current) templatePreview.current.open = false;
                  editor.current?.focus();
                }}>{t("Use template in editor")}</button>
                <div className="crew-coding-preview"><Markdown>{codingTemplate}</Markdown></div>
              </details>
            )}
            <label htmlFor={editorId}>
              {t("Session instructions")} <small>{t("Markdown supported")}</small>
            </label>
            <textarea
              id={editorId}
              ref={editor}
              value={draft}
              required
              onChange={(e) => setText(e.target.value)}
            />
            <p className="crew-footnote">
              {t(
                "The agent brief is added after these instructions; edit it on the agent card.",
              )}
            </p>
            <div className="crew-session-actions">
              <button
                type="submit"
                className="crew-primary"
                disabled={busy || !draft.trim()}
              >
                {busy ? t("Saving…") : t("Save")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setError("");
                  setText(null);
                  setMode("read");
                }}
              >
                {t("Cancel")}
              </button>
            </div>
          </form>
        )}
        {mode === "history" && (
          <section aria-label={t("Revision history")} className="crew-session-history">
            <p>{t("Restoring creates a new revision and keeps every earlier one.")}</p>
            {history === null && !error && <p>{t("Loading history…")}</p>}
            {history?.length === 0 && (
              <p>
                {t("No saved revisions yet: these are the built-in instructions.")}
              </p>
            )}
            {history && history.length > 0 && (
              <ol>
                {history.map((x) => (
                  <li key={x.id}>
                    <details>
                      <summary>
                        {t("Revision {n}", { n: String(x.revision) })} ·{" "}
                        {val(x, "edited_by") || val(x, "reported_agent") || t("unknown")}{" "}
                        · <RelativeTime value={val(x, "created")} />
                        {x.is_default === true ? t(" · built-in default") : ""}
                        {x.revision === session.revision ? t(" · current") : ""}
                      </summary>
                      {val(x, "reason") && (
                        <p className="crew-footnote">
                          <PlainRefs text={val(x, "reason")} />
                        </p>
                      )}
                      <Markdown>{val(x, "instructions")}</Markdown>
                    </details>
                    {x.revision !== session.revision && (
                      <button
                        type="button"
                        disabled={busy}
                        aria-label={t("Restore revision {n}", { n: String(x.revision) })}
                        onClick={() =>
                          void save(
                            { restore_revision: x.revision },
                            `Restore revision ${x.revision}`,
                          )
                        }
                      >
                        {t("Restore")}
                      </button>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}
        {mode === "read" && (
          <div className="crew-session-read">
            <Markdown>{session.instructions}</Markdown>
          </div>
        )}
      </div>
        <div className="crew-session-rewrite">
          <NamedCopyAction
            key={session.revision}
            disabled={!session.rewrite_prompt}
            copy={() => copyText(session.rewrite_prompt)}
            label={t("Rewrite with an agent")}
            successLabel={t("Rewrite prompt copied")}
            onResult={(ok) => setFailedRevision(ok ? null : session.revision)}
          />
        </div>
    </div>
  );
}
