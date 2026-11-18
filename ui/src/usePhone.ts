import { useSyncExternalStore } from "react";

/** The reader's phone breakpoint, the same as crew.css's `max-width: 680px`. */
export const phoneQuery = "(max-width: 680px)";

const media = () =>
  typeof window.matchMedia === "function"
    ? window.matchMedia(phoneQuery)
    : null;

function subscribe(change: () => void) {
  const list = media();
  // Test doubles may lack listeners; they never change.
  list?.addEventListener?.("change", change);
  return () => list?.removeEventListener?.("change", change);
}

const snapshot = () => media()?.matches === true;

/**
 * Whether the reader shows its phone chrome (slim top bar, bottom tabs, one
 * board column at a time). Without matchMedia (jsdom) it is the desktop.
 */
export function usePhone() {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
