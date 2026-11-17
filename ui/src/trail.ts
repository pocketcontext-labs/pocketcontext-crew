import { useEffect, useState, type MouseEvent } from "react";

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

/**
 * How many history entries this one sits above the list page it was opened
 * from (0.32.0): 1 for an item opened from a list, one more for each list
 * previous/next step or link followed from there; 0 when no list is under it
 * (a shared link, a fresh page load). Closing goes back that many entries, so
 * the address is the list again and Back never reopens the item.
 */
export function listDepth(): number {
  const state: unknown = history.state;
  const value =
    state && typeof state === "object"
      ? (state as { crewList?: unknown }).crewList
      : undefined;
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : 0;
}

/** Opens an item from a list page: one entry over the list, a new trail. */
export function pushFromList(hash: string) {
  if (location.hash === hash) return;
  history.pushState(
    { crewList: 1 },
    "",
    location.pathname + location.search + hash,
  );
  resetTrail();
}

/** The next entry's state: one trail step further, one more above the list. */
function nextState() {
  const next = trailPosition() + 1;
  const depth = listDepth();
  return { next, state: depth ? { crewTrail: next, crewList: depth + 1 } : { crewTrail: next } };
}

/**
 * A list previous/next step (0.32.0): one history entry for the new item, so
 * Back, Forward and the dialog's own back/forward retrace the items moved
 * through. No hashchange: the caller shows the item.
 */
export function stepTrail(hash: string) {
  if (location.hash === hash) return;
  const { next, state } = nextState();
  history.pushState(state, "", location.pathname + location.search + hash);
  writeMax(next);
  notify();
}

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
  const { next, state } = nextState();
  history.pushState(state, "", location.pathname + location.search + hash);
  writeMax(next);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
  notify();
}

/**
 * The click handler of every in-app record link (text references, Related):
 * a plain click opens the address as the next trail step; a modified or
 * middle click is left to the browser, which opens the href in a new tab.
 */
export function followLink(e: MouseEvent<HTMLAnchorElement>, hash: string) {
  if (
    e.defaultPrevented ||
    e.button !== 0 ||
    e.metaKey ||
    e.ctrlKey ||
    e.shiftKey ||
    e.altKey
  )
    return;
  e.preventDefault();
  followTrail(hash);
}

export type Trail = { back: boolean; forward: boolean };

function current(): Trail {
  const position = trailPosition();
  // Back from the first item opened from a list returns to that list.
  return { back: position > 0 || listDepth() > 0, forward: position < readMax() };
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
