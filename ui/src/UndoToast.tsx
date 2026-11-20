import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "./i18n";

/** How long a confirmation with Undo stays: about five seconds. */
export const undoToastMs = 5000;
/** A sentence the owner has to read (a failure, a partial undo) stays longer. */
export const messageToastMs = 8000;
/** The fade before the toast leaves; skipped with reduced motion. */
const fadeMs = 200;

const reducedMotion = () =>
  typeof window !== "undefined" &&
  !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * The toast after an action that asks no confirmation (0.40.0: Archive task
 * from the Approval ⋯ menu): a compact dark pill at the bottom centre,
 * "Task archived · Undo". Without an action it is a plain message; as an
 * alert it reports a failure.
 *
 * It closes by itself after `ms`. Hover, keyboard focus inside it or a running
 * action pause the countdown; it resumes with the time that was left. With
 * reduced motion it leaves without the fade.
 *
 * The workspace shows it over the page or inside the open dialog (a modal
 * dialog makes everything outside it inert), so it can be mounted again while
 * it counts down: `left` is the time left, one object for each toast, kept by
 * the caller across mounts.
 */
export default function UndoToast({
  text,
  tone = "status",
  ms = undoToastMs,
  left,
  action,
  busy = false,
  dismiss,
}: {
  text: string;
  /** A confirmation, or a failure read out at once. */
  tone?: "status" | "alert";
  ms?: number;
  /** Time left in ms, this toast's own, kept by the caller across remounts. */
  left?: { current: number };
  /** The one action beside the text, such as Undo. */
  action?: { label: string; run: () => void };
  /** A write is in flight: the action waits and the toast stays. */
  busy?: boolean;
  dismiss: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const paused = hovered || focused || busy;
  const own = useRef(ms);
  const remaining = left ?? own;
  const close = useCallback(() => {
    if (reducedMotion()) return dismiss();
    setLeaving(true);
  }, [dismiss]);
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(dismiss, fadeMs);
    return () => clearTimeout(timer);
  }, [leaving, dismiss]);
  useEffect(() => {
    if (paused || leaving) return;
    const began = Date.now();
    const timer = setTimeout(close, remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - began));
    };
  }, [paused, leaving, close, remaining]);
  const alert = tone === "alert";
  return (
    <div
      className={`crew-undo-toast${alert ? " crew-undo-toast-alert" : ""}${leaving ? " crew-undo-toast-leaving" : ""}`}
      role={alert ? "alert" : "status"}
      aria-live={alert ? "assertive" : "polite"}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null))
          setFocused(false);
      }}
    >
      <span className="crew-undo-toast-text">{text}</span>
      {action && (
        <>
          <span className="crew-undo-toast-dot" aria-hidden="true">
            ·
          </span>
          <button
            type="button"
            className="crew-undo-toast-action"
            disabled={busy}
            onClick={action.run}
          >
            {action.label}
          </button>
        </>
      )}
      <button
        type="button"
        className="crew-undo-toast-close"
        aria-label={t("Dismiss")}
        title={t("Dismiss")}
        onClick={dismiss}
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}
