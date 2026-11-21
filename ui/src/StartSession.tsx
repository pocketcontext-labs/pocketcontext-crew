import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { CopyControl, CopyGlyph, useCopyFeedback } from "./CopyFeedback";
import { createPortal } from "react-dom";
import { crewApi, val, type AgentSession, type Row } from "./crewApi";
import { copyText } from "./projectAgents";
import { icons, PopoverMenu, type MenuItem } from "./MobileChrome";
import { boardAgentHash } from "./itemLink";
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
    guideOff,
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

export function agentMenuItems(open: () => void, showTasks: () => void, chat: MenuItem[]) {
  return [
    { label: t("Open agent"), icon: icons.agent, onSelect: open },
    { label: t("Show tasks"), icon: icons.tasks, onSelect: showTasks },
    ...chat,
  ];
}

export function chatMenuItems(loading: boolean, icon: MenuItem["icon"], copy: () => void, guide: () => void): MenuItem[] {
  return [
    { label: loading ? t("Preparing the prompt…") : t("Copy startup prompt"), icon, disabled: loading, onSelect: copy },
    { label: t("How to continue in a chat"), icon: icons.notes, onSelect: guide },
  ];
}

/** The same one-tap copy action for manual and webhook-started agents. */
export default function StartSession({ agent, onStart, openAgent }: {
  agent: Row;
  openAgent: () => void;
  onStart: (start: SessionStart) => void;
}) {
  const name = val(agent, "name");
  const session = useSessionStart(agent, onStart);
  const { state, run } = useCopyFeedback();
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const label = t("Copy startup prompt");
  const copy = () => void run(session.start);
  return (
    <div className="crew-session">
      <button type="button" className="crew-card-more crew-micon"
        aria-label={t("More for {name}", { name })} aria-haspopup="dialog"
        aria-expanded={!!menu} onClick={(event) => setMenu(event.currentTarget)}>
        {icons.more}
      </button>
      <button type="button" className="crew-session-row"
        aria-label={t("Copy startup prompt for {name}", { name })}
        title={t("Copy startup prompt for {name}", { name })}
        data-state={state || undefined} disabled={session.loading} onClick={copy}>
        <span>
          <strong>{label}</strong>
          {!session.guideOff && <span className="crew-session-hint">{agent.chat_start === "webhook"
            ? t("Crew starts {name} automatically. To use it in a chat too, copy and paste its instructions.", { name })
            : t("Copy the instructions, then paste them into a chat to start {name}.", { name })}</span>}
        </span>
        <span className="crew-session-copy" aria-hidden="true">
          <CopyGlyph state={state} />
        </span>
      </button>
      {menu && <PopoverMenu label={name} anchor={menu} onClose={() => setMenu(null)}
        items={agentMenuItems(openAgent, () => { location.hash = boardAgentHash(agent.id); },
          chatMenuItems(session.loading, <CopyGlyph state={state} />, copy, session.openGuide))} />}
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
        <h2 id={titleId}>{t("Use {name} in a chat", { name })}</h2>
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
        <li>{t("Before leaving your old chat, save any new decisions and the next step on the task.")}</li>
        <li>{t("Open a chat connected to Crew and paste the instructions below. You can use another subscription. If Crew is missing, connect it first.")}</li>
        <li>{t("Read the saved tasks and notes, then choose a ready task by title. Crew checks who is working on it before the new chat starts work.")}</li>
      </ol>
      <div className="crew-session-guide-prompt">
        <pre aria-label={t("Session prompt for {name}", { name })}>
          <code>{prompt || t("Loading the prompt…")}</code>
        </pre>
        <CopyControl
          className="crew-session-guide-copy"
          disabled={!prompt}
          label={t("Copy session prompt for {name}", { name })}
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
      className={`crew-toast crew-startup-toast${autoHide ? "" : " crew-toast-alert"}${leaving ? " crew-toast-leaving" : ""}${paused ? " crew-toast-paused" : ""}`}
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
          {t("Startup prompt copied. Paste it into your agent chat.")}
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
            {t("Show startup prompt")}
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
