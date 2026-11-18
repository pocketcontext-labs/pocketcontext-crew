import { useEffect, useState } from "react";
import { crewApi, type Row } from "./crewApi";
import { isLanguage, setLanguage, type Language } from "./i18n";
import { parseAgentTap, type AgentTap } from "./agentTap";

/**
 * The owner's reader preferences on the server (`crew_settings`), shared by
 * every control on the page through one read:
 *
 * - `session_guide_off` (0.26.0): the Start a session guide's "Don't show this
 *   again", so it holds across browsers. Until 0.25.x the choice lived in this
 *   browser's storage; a browser that still has it carries it over once.
 * - `language` (0.36.0): the reader's language; empty follows the browser.
 *   The server value is applied when it loads; i18n caches the language in
 *   this browser only as the first render's hint.
 * - `agent_tap` (0.36.0): what tapping an agent row on Home runs (agentTap.ts).
 */
const legacyKey = "pocketcontext.crew.session_guide_off";

export type ReaderSettings = {
  loaded: boolean;
  off: boolean;
  language: Language | "";
  agentTap: AgentTap;
};
const initial: ReaderSettings = {
  loaded: false,
  off: false,
  language: "",
  agentTap: {},
};
let state: ReaderSettings = initial;
let settings: Row | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(next: ReaderSettings) {
  state = next;
  for (const listener of [...listeners]) listener();
}

const fromRow = (row: Row | null): ReaderSettings => ({
  loaded: true,
  off: row?.session_guide_off === true,
  language: isLanguage(row?.language) ? row.language : "",
  agentTap: parseAgentTap(row?.agent_tap),
});

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
  const next = fromRow(settings);
  publish(next);
  if (next.language) setLanguage(next.language);
  if (!next.off && row && legacyOff())
    await saveSettings({ session_guide_off: true }).catch(() => undefined);
  else if (next.off) forgetLegacy();
}

/** Reads the settings once per page; a failure is retried on the next use. */
export function loadReaderSettings() {
  if (!loading)
    loading = load().catch(() => {
      // Unknown: keep the guide quiet rather than show it on every click.
      loading = null;
      publish({ ...state, loaded: false });
    });
  return loading;
}

type Patch = {
  session_guide_off?: boolean;
  language?: Language | "";
  agent_tap?: AgentTap;
};

/**
 * Saves preferences: the page follows at once, then the revision-checked
 * write; a conflict rereads once and tries again.
 */
export async function saveSettings(patch: Patch) {
  publish({
    ...state,
    loaded: true,
    ...("session_guide_off" in patch ? { off: !!patch.session_guide_off } : {}),
    ...("language" in patch ? { language: patch.language ?? "" } : {}),
    ...("agent_tap" in patch ? { agentTap: patch.agent_tap ?? {} } : {}),
  });
  const write = async () => {
    if (!settings) {
      const [row] = await crewApi.read("settings");
      settings = row ?? null;
    }
    if (!settings) return;
    settings = await crewApi.write("settings.update", patch, settings);
  };
  try {
    await write();
  } catch (e) {
    // Someone else changed the settings: reread once and try again.
    if ((e as { status?: number })?.status !== 409) throw e;
    settings = null;
    await write();
  }
  if ("session_guide_off" in patch) forgetLegacy();
}

/** The shared preferences; re-renders the caller when they change. */
export function useReaderSettings(): ReaderSettings {
  const [, render] = useState(0);
  useEffect(() => {
    const listener = () => render((n) => n + 1);
    listeners.add(listener);
    void loadReaderSettings();
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return state;
}

/** The session guide preference: [loaded, off, setOff]. */
export function useSessionGuideOff(): [
  boolean,
  boolean,
  (off: boolean) => Promise<void>,
] {
  const current = useReaderSettings();
  return [
    current.loaded,
    current.off,
    (off) => saveSettings({ session_guide_off: off }),
  ];
}

/** Tests start from clean preferences. */
export function resetSessionGuideForTests() {
  state = initial;
  settings = null;
  loading = null;
}
export const resetReaderSettingsForTests = resetSessionGuideForTests;
