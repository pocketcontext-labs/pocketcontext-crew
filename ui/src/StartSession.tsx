import { useState, type ReactNode } from "react";
import { crewApi, val, type AgentSession, type Row } from "./crewApi";
import { copyText } from "./projectAgents";

/**
 * Start a session: reads the external agent's session prompt and copies it,
 * for the owner to paste into a new Codex or Claude Code session. Crew starts
 * nothing itself.
 */
export default function StartSession({
  agent,
  markdown,
}: {
  agent: Row;
  /** Renders the full instructions as Markdown. */
  markdown: (text: string) => ReactNode;
}) {
  const [state, setState] = useState<
    "idle" | "loading" | "copied" | "manual" | "failed"
  >("idle");
  const [session, setSession] = useState<AgentSession>();
  const name = val(agent, "name");
  const start = async () => {
    setState("loading");
    let next: AgentSession;
    try {
      next = await crewApi.session(agent.id);
    } catch {
      setState("failed");
      return;
    }
    setSession(next);
    setState((await copyText(next.prompt)) ? "copied" : "manual");
  };
  return (
    <div className="crew-session">
      <button
        type="button"
        disabled={state === "loading"}
        aria-label={`Start a session for ${name}`}
        onClick={() => void start()}
      >
        {state === "loading" ? "Preparing…" : "Start a session"}
      </button>
      {state === "copied" && (
        <p role="status" className="crew-session-note">
          Copied. Paste it into a new Codex or Claude Code session.
        </p>
      )}
      {state === "manual" && session && (
        <div role="alert" className="crew-session-note">
          <p>
            Could not copy automatically. Copy this into a new Codex or Claude
            Code session:
          </p>
          <textarea
            readOnly
            aria-label={`Session prompt for ${name}`}
            value={session.prompt}
            rows={3}
            onFocus={(e) => e.currentTarget.select()}
          />
        </div>
      )}
      {state === "failed" && (
        <p role="alert" className="crew-session-note crew-session-error">
          Could not prepare the session prompt. Check your connection and try
          again.
        </p>
      )}
      {session?.instructions.trim() && (
        <details className="crew-session-instructions">
          <summary>Show full instructions</summary>
          {markdown(session.instructions)}
        </details>
      )}
    </div>
  );
}
