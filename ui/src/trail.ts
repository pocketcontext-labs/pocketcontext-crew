import { useEffect, useState } from "react";

/**
 * The trail of records opened from links in rendered text (0.29.0). Each link
 * click pushes a browser history entry carrying its position in the trail, so
 * browser Back/Forward and the dialog's own back/forward buttons walk the same
 * entries. Any other navigation that adds history (opening a card, changing a
 * filter) starts a new trail at position 0.
 */
const maxKey = "pocketcontext.crew.trail_max";
let memoryMax = 0;

function readMax(): number {
  try {
    const raw = sessionStorage.getItem(maxKey);
    const value = raw === null ? memoryMax : Number(raw);
    return Number.isInteger(value) && value >= 0 ? value : 0;
  } catch {
    return memoryMax;
  }
}
function writeMax(value: number) {
  memoryMax = value;
  try {
    sessionStorage.setItem(maxKey, String(value));
  } catch {
    /* Optional storage: Forward then works only until a reload. */
  }
}

/** This history entry's position in the trail (0 outside a trail). */
export function trailPosition(): number {
  const state: unknown = history.state;
  const value =
    state && typeof state === "object"
      ? (state as { crewTrail?: unknown }).crewTrail
      : undefined;
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : 0;
}

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

/** A plain history entry (a card, a filter) starts a new trail. */
export function resetTrail() {
  writeMax(0);
  notify();
}

/**
 * Opens a reader address as the next step of the trail: a history entry is
 * pushed (dropping any forward steps) and hashchange is fired, which opens the
 * record as if the address had been typed.
 */
export function followTrail(hash: string) {
  if (location.hash === hash) return;
  const next = trailPosition() + 1;
  history.pushState(
    { crewTrail: next },
    "",
    location.pathname + location.search + hash,
  );
  writeMax(next);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
  notify();
}

export type Trail = { back: boolean; forward: boolean };

function current(): Trail {
  const position = trailPosition();
  return { back: position > 0, forward: position < readMax() };
}

/** Whether the dialog's back and forward buttons apply right now. */
export function useTrail(): Trail {
  const [trail, setTrail] = useState(current);
  useEffect(() => {
    const update = () =>
      setTrail((old) => {
        const next = current();
        return old.back === next.back && old.forward === next.forward
          ? old
          : next;
      });
    listeners.add(update);
    window.addEventListener("popstate", update);
    window.addEventListener("hashchange", update);
    update();
    return () => {
      listeners.delete(update);
      window.removeEventListener("popstate", update);
      window.removeEventListener("hashchange", update);
    };
  }, []);
  return trail;
}
