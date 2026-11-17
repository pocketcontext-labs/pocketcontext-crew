import { useEffect, useRef, type RefObject } from "react";

/**
 * The one swipe handler of the reader (0.31.0): a horizontal swipe on a dialog
 * opened from a list moves to the previous or next item of that list, and the
 * file preview steps through its files the same way. Swipe left is next,
 * swipe right is previous.
 *
 * A swipe counts only when it is mostly horizontal, long enough and quick
 * enough (or very long), starts away from the screen edges (iOS uses them for
 * Back), and does not start in a field, while typing, while text is selected,
 * in content that scrolls sideways or in another window above the dialog (the
 * image viewer is a portal, so its touches never reach the dialog).
 */

export type Step = -1 | 1;
/** What a step did: moved to another item, hit the end, or stayed (declined). */
export type StepResult = "moved" | "end" | "stayed";

/** Touches starting this close to a screen edge belong to the system. */
export const edgeInset = 24;
const minDistance = 60;
/** px per ms; slower swipes count only when they cross most of the dialog. */
const minVelocity = 0.3;
const farShare = 0.4;

/** Whether a finished drag is a swipe; dt in ms, width of the swiped area. */
export function isSwipe(dx: number, dy: number, dt: number, width: number) {
  const ax = Math.abs(dx);
  if (ax < minDistance || ax < Math.abs(dy) * 2) return false;
  return ax / Math.max(dt, 1) >= minVelocity || ax >= width * farShare;
}

const fields =
  'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="file"]), textarea, select, [contenteditable=""], [contenteditable="true"]';

/** A text field has focus: the owner is typing. */
export function typing() {
  const active = document.activeElement;
  return (
    active instanceof HTMLElement &&
    (active.matches(fields) || active.isContentEditable)
  );
}

export const selecting = () => {
  const selection = document.getSelection?.();
  return !!selection && !selection.isCollapsed && String(selection) !== "";
};

/** Inside root, an element between target and root scrolls sideways. */
function scrollsSideways(target: Element, root: Element) {
  for (let n: Element | null = target; n && n !== root; n = n.parentElement) {
    if (n.scrollWidth <= n.clientWidth + 1) continue;
    const overflow = getComputedStyle(n).overflowX;
    if (overflow === "auto" || overflow === "scroll") return true;
  }
  return false;
}

/** A swipe or arrow key starting at target belongs to something else. */
export function ownedElsewhere(target: EventTarget | null, root: Element) {
  if (!(target instanceof Element) || !root.contains(target)) return true;
  if (target.closest(fields)) return true;
  return scrollsSideways(target, root);
}

/** Arrow keys that a focused control already uses (tabs, menus, fields). */
const arrowOwners =
  '[role="tablist"], [role="tab"], [role="menu"], [role="menuitem"], [role="radiogroup"], [role="radio"], [role="slider"], [role="listbox"], [role="option"], [role="combobox"], pre, table';

/** The list step a key press asks for: Left is previous, Right is next. */
export function arrowStep(
  e: {
    key: string;
    target: EventTarget | null;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
    defaultPrevented: boolean;
  },
  root: Element | null,
): Step | 0 {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return 0;
  if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey)
    return 0;
  if (!root || typing() || ownedElsewhere(e.target, root)) return 0;
  if (e.target instanceof Element && e.target.closest(arrowOwners)) return 0;
  return e.key === "ArrowRight" ? 1 : -1;
}

/**
 * Calls onSwipe(step) for each swipe on the element in ref; null turns the
 * handler off. Listeners are native, so touches in portals never count.
 */
export function useSwipe(
  ref: RefObject<HTMLElement | null>,
  onSwipe: ((step: Step) => void) | null,
) {
  const handler = useRef(onSwipe);
  handler.current = onSwipe;
  const enabled = !!onSwipe;
  useEffect(() => {
    const root = ref.current;
    if (!root || !enabled) return;
    let start: { x: number; y: number; t: number } | null = null;
    const begin = (e: TouchEvent) => {
      start = null;
      const touch = e.touches[0];
      if (e.touches.length !== 1 || !touch) return;
      if (
        touch.clientX < edgeInset ||
        touch.clientX > window.innerWidth - edgeInset
      )
        return;
      if (ownedElsewhere(e.target, root) || typing() || selecting()) return;
      start = { x: touch.clientX, y: touch.clientY, t: Date.now() };
    };
    const move = (e: TouchEvent) => {
      // A second finger makes it a pinch or zoom.
      if (e.touches.length > 1) start = null;
    };
    const end = (e: TouchEvent) => {
      const from = start;
      start = null;
      const touch = e.changedTouches[0];
      if (!from || !touch || e.touches.length > 0 || selecting()) return;
      const dx = touch.clientX - from.x,
        dy = touch.clientY - from.y;
      if (!isSwipe(dx, dy, Date.now() - from.t, root.clientWidth)) return;
      handler.current?.(dx < 0 ? 1 : -1);
    };
    const cancel = () => {
      start = null;
    };
    root.addEventListener("touchstart", begin, { passive: true });
    root.addEventListener("touchmove", move, { passive: true });
    root.addEventListener("touchend", end);
    root.addEventListener("touchcancel", cancel);
    return () => {
      root.removeEventListener("touchstart", begin);
      root.removeEventListener("touchmove", move);
      root.removeEventListener("touchend", end);
      root.removeEventListener("touchcancel", cancel);
    };
  }, [ref, enabled]);
}

/**
 * Feedback on the element: a short slide in from the side moved to, or a
 * bounce toward the end that stopped it. CSS animates the dialog body only
 * (not its header) and turns it off for reduced motion.
 */
export function swipeFeedback(
  element: HTMLElement | null,
  result: StepResult,
  step: Step,
) {
  if (!element || result === "stayed") return;
  const value = `${result === "moved" ? "slide" : "bounce"}-${step > 0 ? "next" : "prev"}`;
  element.removeAttribute("data-swipe");
  void element.offsetWidth;
  element.setAttribute("data-swipe", value);
  window.setTimeout(() => {
    if (element.getAttribute("data-swipe") === value)
      element.removeAttribute("data-swipe");
  }, 320);
}
