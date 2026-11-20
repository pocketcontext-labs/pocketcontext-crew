import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { CopyControl } from "./CopyFeedback";
import { createPortal } from "react-dom";
import { markdownSummary } from "./markdownText";
import { crewApi, val, type AgentSession, type Row } from "./crewApi";
import { copyText } from "./projectAgents";
import { useSessionGuideOff } from "./sessionGuide";
import HideHelp, { helpIds } from "./HideHelp";
import { t } from "./i18n";

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
      aria-label={
        summary
          ? t("Agent {name}: {summary}", { name, summary })
          : t("Agent {name}", { name })
      }
    >
      <span className="crew-avatar" aria-hidden="true">
        {agentInitials(name, agents)}
      </span>
      <span aria-hidden="true">{name}</span>
      <small aria-hidden="true">{t("Agent")}</small>
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
 * Since 0.26.0 the first click also opens a small dialog (three steps and the
 * prompt) until the owner ticks "Don't show this again", a server setting; the
 * ? help icon opens it at any time. Nothing is added to the page's flow, so
 * agent cards keep their height.
 */
/**
 * The copy-prompt behaviour of Start a session, for any control: `start` copies
 * the prompt (opening the guide on a first use), `openGuide` opens the guide,
 * and `guide` is the dialog to render. The session is read on mount, so the
 * copy runs inside the click (phones refuse a clipboard write after an await).
 */
export function useSessionStart(
  agent: Row,
  notify: (start: SessionStart) => void,
) {
  const name = val(agent, "name");
  const cached = useRef<AgentSession | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [guide, setGuide] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [guideLoaded, guideOff] = useSessionGuideOff();
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
  const copy = async () => {
    const ready = cached.current;
    if (ready) {
      const copying = copyText(ready.prompt);
      const session = refresh().catch(() => ready);
      const ok = await copying;
      notify({ name, prompt: ready.prompt, state: ok ? "copied" : "manual", session });
      return ok;
    }
    // Not read yet (or the read failed): read now; the copy may then need a
    // manual step on a phone.
    setLoading(true);
    try {
      const session = await refresh();
      const ok = await copyText(session.prompt);
      notify({
        name,
        prompt: session.prompt,
        state: ok ? "copied" : "manual",
        session: Promise.resolve(session),
      });
      return ok;
    } catch {
      notify({ name, prompt: "", state: "failed" });
      return false;
    } finally {
      setLoading(false);
    }
  };
  const start = () => {
    if (guideLoaded && !guideOff) setGuide(true);
    return copy();
  };
  return {
    start,
    openGuide: () => setGuide(true),
    loading,
    guide: guide ? (
      <SessionGuide
        name={name}
        prompt={prompt}
        copy={copy}
        close={() => setGuide(false)}
      />
    ) : null,
  };
}

/**
 * Start a session (0.24.0; clearer in 0.25.0): one click copies the external
 * agent's session prompt for the owner to paste into a new coding-agent
 * session; Crew starts nothing itself. The result is a toast owned by the
 * workspace.
 *
 * Since 0.26.0 the first click also opens a small dialog (three steps and the
 * prompt) until the owner ticks "Don't show this again", a server setting; the
 * ? help icon opens it at any time. Nothing is added to the page's flow, so
 * agent cards keep their height. Since 0.34.0 Home reaches the same actions
 * from an agent's ⋯ menu (useSessionStart).
 */
export default function StartSession({
  agent,
  agents,
  showAgent = false,
  compact = false,
  onStart,
}: {
  agent: Row;
  /** Every agent, for unique avatar initials. */
  agents?: Row[];
  /** Show the agent chip beside the button. */
  showAgent?: boolean;
  /** A card footer: the short label "Copy coding prompt" keeps the ? on the same row. */
  compact?: boolean;
  onStart: (start: SessionStart) => void;
}) {
  const name = val(agent, "name");
  const session = useSessionStart(agent, onStart);
  return (
    <div className="crew-session">
      <div className="crew-session-row">
        {showAgent && <AgentChip agent={agent} agents={agents ?? [agent]} />}
        <CopyControl
          className="crew-session-copy"
          disabled={session.loading}
          accessibleLabel={t("Copy prompt for a coding agent as {name}", { name })}
          label={session.loading ? t("Preparing…") : compact ? t("Copy coding prompt") : t("Copy prompt for a coding agent")}
          successLabel={t("Copied")}
          copy={session.start}
        />
        <div className="crew-help">
          <button
            type="button"
            className="crew-help-button"
            aria-label={t("How to start a session as {name}", { name })}
            title={t("How it works")}
            aria-haspopup="dialog"
            onClick={session.openGuide}
          >
            <span aria-hidden="true">?</span>
          </button>
        </div>
      </div>
      {session.guide}
    </div>
  );
}

const focusable =
  'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The guide dialog: three steps, the prompt in full (wrapped, read-only) with
 * a copy icon, and "Don't show this again" (HideHelp) beside Got it. Focus moves in, is
 * kept inside while it is open and returns to the control that opened it.
 */
function SessionGuide({
  name,
  prompt,
  copy,
  close,
}: {
  name: string;
  prompt: string;
  copy: () => Promise<boolean>;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const done = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    if (dialog && typeof dialog.showModal === "function" && !dialog.open)
      dialog.showModal();
    done.current?.focus({ preventScroll: true });
    return () => {
      if (dialog?.open && typeof dialog.close === "function") dialog.close();
      previous?.focus?.({ preventScroll: true });
    };
  }, []);
  const onKeyDown = (e: KeyboardEvent<HTMLDialogElement>) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") {
      // A modal dialog already traps focus; this covers browsers without one.
      const nodes = Array.from(
        ref.current?.querySelectorAll<HTMLElement>(focusable) ?? [],
      );
      if (!nodes.length) return;
      const first = nodes[0],
        last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  return createPortal(
    <dialog
      ref={ref}
      className="crew-dialog crew-session-guide"
      aria-labelledby={titleId}
      open={
        typeof HTMLDialogElement.prototype.showModal !== "function"
          ? true
          : undefined
      }
      onKeyDown={onKeyDown}
      onCancel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        close();
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) close();
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <header>
        <h2 id={titleId}>{t("Start a coding session as {name}", { name })}</h2>
        <button
          type="button"
          className="crew-session-guide-close"
          aria-label={t("Close")}
          title={t("Close")}
          onClick={close}
        >
          <span aria-hidden="true">×</span>
        </button>
      </header>
      <ol>
        <li>
          <strong>{t("Copy the prompt.")}</strong>{" "}
          {t(
            "The button copies the two lines below, which tell a coding agent to act as {name} in Crew.",
            { name },
          )}
        </li>
        <li>
          <strong>{t("Open your coding agent.")}</strong>{" "}
          {t(
            "Start a new session in Codex, Claude Code or another coding agent, in the repository you want to work on.",
          )}
        </li>
        <li>
          <strong>{t("Paste and send.")}</strong>{" "}
          {t(
            "The agent connects to Crew, picks up {name}'s Ready tasks, and works by the instructions you keep in Crew.",
            { name },
          )}
        </li>
      </ol>
      <div className="crew-session-guide-prompt">
        <pre aria-label={t("Session prompt for {name}", { name })}>
          <code>{prompt || t("Loading the prompt…")}</code>
        </pre>
        <CopyControl
          className="crew-session-guide-copy"
          disabled={!prompt}
          label={t("Copy session prompt for {name}", { name })}
          title={t("Copy")}
          iconOnly
          copy={copy}
        />
      </div>
      <footer>
        <HideHelp id={helpIds.sessionGuide} />
        <button
          ref={done}
          type="button"
          className="crew-primary"
          onClick={close}
        >
          {t("Got it")}
        </button>
      </footer>
    </dialog>,
    document.body,
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
        aria-label={t("Dismiss")}
        title={t("Dismiss")}
        onClick={dismiss}
      >
        <span aria-hidden="true">×</span>
      </button>
      {start.state === "copied" && (
        <p>
          {t(
            "Copied the session prompt for {name}. Paste it into a new session in your coding agent.",
            { name: start.name },
          )}
        </p>
      )}
      {start.state === "manual" && (
        <>
          <p>
            {t(
              "Could not copy automatically. Copy the session prompt for {name} into a new agent session:",
              { name: start.name },
            )}
          </p>
          <textarea
            readOnly
            aria-label={t("Session prompt for {name}", { name: start.name })}
            value={start.prompt}
            rows={3}
            onFocus={(e) => e.currentTarget.select()}
          />
        </>
      )}
      {start.state === "failed" && (
        <p>
          {t(
            "Could not prepare the session prompt for {name}. Check your connection and try again.",
            { name: start.name },
          )}
        </p>
      )}
      {start.session && (
        <div className="crew-toast-actions">
          <button type="button" aria-haspopup="dialog" onClick={view}>
            {t("View")}
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
