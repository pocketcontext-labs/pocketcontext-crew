import { useCallback, useEffect, useRef, useState } from "react";
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

/** How long a confirmation toast stays (with an action to reach: View). */
export const toastMs = 6000;
/** The fade before a toast leaves; skipped with reduced motion. */
const toastFadeMs = 200;
const reducedMotion = () =>
  typeof window !== "undefined" &&
  !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * The toast after Start a session: View opens the session instructions; when
 * the copy failed it shows the prompt to copy by hand. No Undo: nothing to undo.
 *
 * A confirmation closes by itself after 6 s, shown by a bar along its bottom
 * edge that shrinks over the same time. Hover or keyboard focus inside it
 * pauses both; leaving resumes them with the time that was left. A toast that
 * needs action (manual copy, failure) never auto-hides.
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
  const autoHide = start.state === "copied";
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const paused = hovered || focused;
  // Time left on the countdown, kept across pauses.
  const remaining = useRef(toastMs);
  const close = useCallback(() => {
    if (reducedMotion()) return dismiss();
    setLeaving(true);
  }, [dismiss]);
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(dismiss, toastFadeMs);
    return () => clearTimeout(timer);
  }, [leaving, dismiss]);
  useEffect(() => {
    if (!autoHide || paused || leaving) return;
    const began = Date.now();
    const timer = setTimeout(close, remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - began));
    };
  }, [autoHide, paused, leaving, close]);
  return (
    <div
      className={`crew-toast${autoHide ? "" : " crew-toast-alert"}${leaving ? " crew-toast-leaving" : ""}${paused ? " crew-toast-paused" : ""}`}
      role={autoHide ? "status" : "alert"}
      aria-live={autoHide ? "polite" : "assertive"}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null))
          setFocused(false);
      }}
    >
      <button
        type="button"
        className="crew-toast-close"
        aria-label="Dismiss"
        title="Dismiss"
        onClick={dismiss}
      >
        <span aria-hidden="true">×</span>
      </button>
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
      {start.session && (
        <div className="crew-toast-actions">
          <button type="button" aria-haspopup="dialog" onClick={view}>
            View
          </button>
        </div>
      )}
      {autoHide && (
        <span
          className="crew-toast-countdown"
          aria-hidden="true"
          style={{ animationDuration: `${toastMs}ms` }}
        />
      )}
    </div>
  );
}
