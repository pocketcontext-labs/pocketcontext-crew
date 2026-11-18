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
 * - `hidden_help` (0.37.0): the help panels hidden with "Don't show this
 *   again" (HideHelp.tsx). Until 0.36.x Home kept two of them in this
 *   browser's storage; a browser that still has them carries them over once.
 */
const legacyKey = "pocketcontext.crew.session_guide_off";
/** Home's per-browser hides before 0.37.0, and the help id each became. */
export const legacyHelpKeys: Record<string, string> = {
  "pocketcontext.crew.how_it_works_hidden": "home.guide_row",
  "pocketcontext.crew.get_started_hidden": "home.get_started",
};

export type ReaderSettings = {
  loaded: boolean;
  off: boolean;
  language: Language | "";
  agentTap: AgentTap;
  /** Help ids hidden with "Don't show this again". */
  hiddenHelp: string[];
};
const initial: ReaderSettings = {
  loaded: false,
  off: false,
  language: "",
  agentTap: {},
  hiddenHelp: [],
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
  hiddenHelp: parseHiddenHelp(row?.hidden_help),
});

const helpId = /^[a-z0-9_.-]{1,64}$/;
function parseHiddenHelp(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is string => typeof x === "string" && helpId.test(x));
}

function legacyOff() {
  try {
    return localStorage.getItem(legacyKey) === "1";
  } catch {
    return false;
  }
}
function legacyHelp() {
  const ids: string[] = [];
  try {
    for (const [key, id] of Object.entries(legacyHelpKeys))
      if (localStorage.getItem(key) === "1") ids.push(id);
  } catch {
    /* Optional storage. */
  }
  return ids;
}
function forgetLegacyHelp() {
  try {
    for (const key of Object.keys(legacyHelpKeys)) localStorage.removeItem(key);
  } catch {
    /* Optional storage. */
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
  // Hides left in this browser count at once, before anything decides to show.
  const carried = row
    ? legacyHelp().filter((id) => !next.hiddenHelp.includes(id))
    : [];
  publish({ ...next, hiddenHelp: [...next.hiddenHelp, ...carried] });
  if (next.language) setLanguage(next.language);
  if (!next.off && row && legacyOff())
    await saveSettings({ session_guide_off: true }).catch(() => undefined);
  else if (next.off) forgetLegacy();
  if (carried.length)
    await saveSettings({ hidden_help: state.hiddenHelp }).then(
      forgetLegacyHelp,
      () => undefined,
    );
  else if (row) forgetLegacyHelp();
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
  hidden_help?: string[];
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
    ...("hidden_help" in patch ? { hiddenHelp: patch.hidden_help ?? [] } : {}),
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

/** Whether a help id is hidden ("session_guide" is session_guide_off). */
export function isHelpHidden(prefs: ReaderSettings, id: string) {
  return id === sessionGuideHelp ? prefs.off : prefs.hiddenHelp.includes(id);
}
/** The Start a session guide's help id, kept in session_guide_off. */
export const sessionGuideHelp = "session_guide";

/** Hides or shows one help; the page follows at once. */
export function setHelpHidden(id: string, hidden: boolean) {
  if (id === sessionGuideHelp) return saveSettings({ session_guide_off: hidden });
  const rest = state.hiddenHelp.filter((x) => x !== id);
  return saveSettings({ hidden_help: hidden ? [...rest, id] : rest });
}

/** Settings' Show all help again: every hide, the guide's and old local ones. */
export async function showAllHelp() {
  forgetLegacyHelp();
  forgetLegacy();
  await saveSettings({ hidden_help: [], session_guide_off: false });
}

/** Tests start from clean preferences. */
export function resetSessionGuideForTests() {
  state = initial;
  settings = null;
  loading = null;
}
export const resetReaderSettingsForTests = resetSessionGuideForTests;
