import { useCallback, useEffect, useId, useRef, useState } from "react";
import { markdownSummary } from "./markdownText";
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

const guideOffKey = "pocketcontext.crew.session_guide_off";
// A per-browser convenience: the guide's "Don't show this again".
function guideOff() {
  try {
    return localStorage.getItem(guideOffKey) === "1";
  } catch {
    return false;
  }
}
function setGuideOff(off: boolean) {
  try {
    if (off) localStorage.setItem(guideOffKey, "1");
    else localStorage.removeItem(guideOffKey);
  } catch {
    /* Optional storage: the choice lasts until reload. */
  }
}

/** The shortest name prefix (up to three letters) no other agent shares. */
export function agentInitials(name: string, agents: Row[]) {
  const letters = name.trim();
  const others = agents
    .map((agent) => val(agent, "name").trim().toLowerCase())
    .filter((other) => other !== letters.toLowerCase());
  for (let size = 1; size < 3; size++) {
    const prefix = letters.slice(0, size).toLowerCase();
    if (!others.some((other) => other.startsWith(prefix)))
      return letters.slice(0, size);
  }
  return letters.slice(0, 3);
}

/**
 * An agent as the Agents page shows it: avatar, name and an Agent tag, with
 * the first line of its brief (plain text) on hover or focus.
 */
export function AgentChip({ agent, agents }: { agent: Row; agents: Row[] }) {
  const name = val(agent, "name");
  const summary = markdownSummary(val(agent, "brief"));
  return (
    <span
      className="crew-agent-chip"
      tabIndex={summary ? 0 : undefined}
      title={summary || undefined}
      aria-label={`Agent ${name}${summary ? `: ${summary}` : ""}`}
    >
      <span className="crew-avatar" aria-hidden="true">
        {agentInitials(name, agents)}
      </span>
      <span aria-hidden="true">{name}</span>
      <small aria-hidden="true">Agent</small>
    </span>
  );
}

/**
 * Start a session (0.24.0; clearer in 0.25.0): one click copies the external
 * agent's session prompt for the owner to paste into a new coding-agent
 * session; Crew starts nothing itself. The session is read when the button
 * renders, so the copy runs inside the click (phones refuse a clipboard write
 * after an await). The result is a toast owned by the workspace.
 *
 * The first click also opens a short inline guide (three steps and the copied
 * prompt) until the owner ticks "Don't show this again"; the ? button opens it
 * again at any time.
 */
export default function StartSession({
  agent,
  agents,
  showAgent = false,
  onStart,
}: {
  agent: Row;
  /** Every agent, for unique avatar initials. */
  agents?: Row[];
  /** Show the agent chip beside the button (Home; the Agents card already names it). */
  showAgent?: boolean;
  onStart: (start: SessionStart) => void;
}) {
  const name = val(agent, "name");
  const cached = useRef<AgentSession | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [guide, setGuide] = useState(false);
  const [prompt, setPrompt] = useState("");
  const guideId = useId();
  useEffect(() => {
    let alive = true;
    void crewApi.session(agent.id).then(
      (session) => {
        if (!alive) return;
        cached.current = session;
        setPrompt(session.prompt);
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
      setPrompt(session.prompt);
      return session;
    });
    next.catch(() => undefined);
    return next;
  };
  const start = async () => {
    if (!guideOff()) setGuide(true);
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
    <div
      className="crew-session"
      onKeyDown={(e) => {
        // Escape closes the guide from anywhere in it or on its buttons.
        if (e.key !== "Escape" || !guide) return;
        e.stopPropagation();
        setGuide(false);
      }}
    >
      <div className="crew-session-row">
        {showAgent && <AgentChip agent={agent} agents={agents ?? [agent]} />}
        <button
          type="button"
          disabled={loading}
          aria-label={`Copy prompt for a coding agent as ${name}`}
          onClick={() => void start()}
        >
          {loading ? "Preparing…" : "Copy prompt for a coding agent"}
        </button>
        <button
          type="button"
          className="crew-session-help"
          aria-label={`How to start a session as ${name}`}
          title="How it works"
          aria-expanded={guide}
          aria-controls={guideId}
          onClick={() => setGuide((open) => !open)}
        >
          ?
        </button>
      </div>
      {guide && (
        <SessionGuide
          id={guideId}
          name={name}
          prompt={prompt}
          close={() => setGuide(false)}
        />
      )}
    </div>
  );
}

/** The three-step guide beside Start a session, with the prompt to paste. */
function SessionGuide({
  id,
  name,
  prompt,
  close,
}: {
  id: string;
  name: string;
  prompt: string;
  close: () => void;
}) {
  const [off, setOff] = useState(guideOff);
  const [copied, setCopied] = useState(false);
  return (
    <div
      id={id}
      className="crew-session-guide"
      role="region"
      aria-label={`How to start a session as ${name}`}
    >
      <ol>
        <li>
          <strong>Copy the prompt.</strong> The button copies two lines that
          tell a coding agent to act as {name} in Crew.
        </li>
        <li>
          <strong>Open your coding agent.</strong> Start a new session in Codex,
          Claude Code or another coding agent, in the repository you want to
          work on.
        </li>
        <li>
          <strong>Paste and send.</strong> The agent connects to Crew, picks up{" "}
          {name}'s Ready tasks, and works by the instructions you keep in Crew.
        </li>
      </ol>
      <div className="crew-session-guide-prompt">
        <textarea
          readOnly
          aria-label={`Session prompt for ${name}`}
          value={prompt || "Loading the prompt…"}
          rows={2}
          onFocus={(e) => e.currentTarget.select()}
        />
        <button
          type="button"
          disabled={!prompt}
          onClick={() => void copyText(prompt).then((ok) => setCopied(ok))}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div className="crew-session-guide-footer">
        <label>
          <input
            type="checkbox"
            checked={off}
            onChange={(e) => {
              setOff(e.target.checked);
              setGuideOff(e.target.checked);
            }}
          />
          Don't show this again
        </label>
        <button type="button" onClick={close}>
          Got it
        </button>
      </div>
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
        <p>
          Copied the session prompt for {start.name}. Paste it into a new
          session in your coding agent.
        </p>
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
