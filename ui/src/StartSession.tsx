import { useEffect, useRef, useState } from "react";
import { crewApi, val, type AgentSession, type Row } from "./crewApi";
import { copyText } from "./projectAgents";

/** What one click on Start a session did, for the workspace toast. */
export type SessionStart = {
  name: string;
  /** The prompt that was copied, or that the owner copies by hand. */
  prompt: string;
  /** "copied", "manual" (show the prompt) or "failed" (no prompt). */
  state: "copied" | "manual" | "failed";
  /** The session for View: the read made by this start. */
  session?: Promise<AgentSession>;
};

/**
 * Start a session (0.24.0): one click copies the external agent's session
 * prompt for the owner to paste into a new agent session; Crew starts nothing
 * itself. The session is read when the button renders, so the copy runs inside
 * the click (phones refuse a clipboard write after an await). The result is a
 * toast owned by the workspace; the card keeps only its button.
 */
export default function StartSession({
  agent,
  label = "Start a session",
  onStart,
}: {
  agent: Row;
  /** Visible text; the accessible name always includes the agent. */
  label?: string;
  onStart: (start: SessionStart) => void;
}) {
  const name = val(agent, "name");
  const cached = useRef<AgentSession | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let alive = true;
    void crewApi.session(agent.id).then(
      (session) => {
        if (alive) cached.current = session;
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [agent.id]);
  // The instructions are editable: each start reads the session once, for View
  // and the next click, while the copy uses the prompt already in hand.
  const refresh = () => {
    const next = crewApi.session(agent.id).then((session) => {
      cached.current = session;
      return session;
    });
    next.catch(() => undefined);
    return next;
  };
  const start = async () => {
    const ready = cached.current;
    if (ready) {
      const copying = copyText(ready.prompt);
      const session = refresh().catch(() => ready);
      onStart({
        name,
        prompt: ready.prompt,
        state: (await copying) ? "copied" : "manual",
        session,
      });
      return;
    }
    // Not read yet (or the read failed): read now; the copy may then need a
    // manual step on a phone.
    setLoading(true);
    try {
      const session = await refresh();
      onStart({
        name,
        prompt: session.prompt,
        state: (await copyText(session.prompt)) ? "copied" : "manual",
        session: Promise.resolve(session),
      });
    } catch {
      onStart({ name, prompt: "", state: "failed" });
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="crew-session">
      <button
        type="button"
        disabled={loading}
        aria-label={`Start a session for ${name}`}
        onClick={() => void start()}
      >
        {loading ? "Preparing…" : label}
      </button>
    </div>
  );
}

/**
 * The toast after Start a session: View opens the session instructions; when
 * the copy failed it shows the prompt to copy by hand. No Undo: nothing to undo.
 */
export function SessionToast({
  start,
  view,
  dismiss,
}: {
  start: SessionStart;
  view: () => void;
  dismiss: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  // A plain confirmation leaves by itself; one that needs action stays.
  useEffect(() => {
    if (start.state !== "copied" || hovered) return;
    const timer = setTimeout(dismiss, 10_000);
    return () => clearTimeout(timer);
  }, [start, hovered, dismiss]);
  return (
    <div
      className={`crew-toast${start.state === "copied" ? "" : " crew-toast-alert"}`}
      role={start.state === "copied" ? "status" : "alert"}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
    >
      {start.state === "copied" && (
        <p>Copied the session prompt for {start.name}.</p>
      )}
      {start.state === "manual" && (
        <>
          <p>
            Could not copy automatically. Copy the session prompt for{" "}
            {start.name} into a new agent session:
          </p>
          <textarea
            readOnly
            aria-label={`Session prompt for ${start.name}`}
            value={start.prompt}
            rows={3}
            onFocus={(e) => e.currentTarget.select()}
          />
        </>
      )}
      {start.state === "failed" && (
        <p>
          Could not prepare the session prompt for {start.name}. Check your
          connection and try again.
        </p>
      )}
      <div className="crew-toast-actions">
        {start.session && (
          <button type="button" aria-haspopup="dialog" onClick={view}>
            View
          </button>
        )}
        <button type="button" className="crew-quiet" onClick={dismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
