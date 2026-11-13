import { useEffect, useState } from "react";
import { crewApi, type Row } from "./crewApi";

/**
 * The Start a session guide's "Don't show this again" (0.26.0): the owner's
 * setting `session_guide_off` on the server, so it holds across browsers. One
 * read is shared by every Start a session control on the page.
 *
 * Until 0.25.x the choice lived in this browser's storage; a browser that
 * still has it carries it over to the server once.
 */
const legacyKey = "pocketcontext.crew.session_guide_off";

type State = { loaded: boolean; off: boolean };
let state: State = { loaded: false, off: false };
let settings: Row | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(next: State) {
  state = next;
  for (const listener of listeners) listener();
}

function legacyOff() {
  try {
    return localStorage.getItem(legacyKey) === "1";
  } catch {
    return false;
  }
}
function forgetLegacy() {
  try {
    localStorage.removeItem(legacyKey);
  } catch {
    /* Optional storage. */
  }
}

async function load() {
  const [row] = await crewApi.read("settings");
  settings = row ?? null;
  const off = row?.session_guide_off === true;
  publish({ loaded: true, off });
  if (!off && row && legacyOff()) await save(true).catch(() => undefined);
  else if (off) forgetLegacy();
}

function ensureLoaded() {
  if (!loading)
    loading = load().catch(() => {
      // Unknown: keep the guide quiet rather than show it on every click.
      loading = null;
      publish({ loaded: false, off: false });
    });
  return loading;
}

async function save(off: boolean) {
  publish({ loaded: true, off });
  const write = async () => {
    if (!settings) {
      const [row] = await crewApi.read("settings");
      settings = row ?? null;
    }
    if (!settings) return;
    settings = await crewApi.write(
      "settings.update",
      { session_guide_off: off },
      settings,
    );
  };
  try {
    await write();
  } catch (e) {
    // Someone else changed the settings: reread once and try again.
    if ((e as { status?: number })?.status !== 409) throw e;
    settings = null;
    await write();
  }
  forgetLegacy();
}

/** The shared preference: [loaded, off, setOff]. */
export function useSessionGuideOff(): [
  boolean,
  boolean,
  (off: boolean) => Promise<void>,
] {
  const [, render] = useState(0);
  useEffect(() => {
    const listener = () => render((n) => n + 1);
    listeners.add(listener);
    void ensureLoaded();
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return [state.loaded, state.off, save];
}

/** Tests start from a clean preference. */
export function resetSessionGuideForTests() {
  state = { loaded: false, off: false };
  settings = null;
  loading = null;
}
