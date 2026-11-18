// Reader UI translations (Crew 0.36.0).
//
// The English text is the key: `t("Sign out")` returns the current language's
// translation, or the English key itself when a catalog lacks it (English
// needs no catalog). Placeholders are `{name}`: `t("{n} min ago", { n: 5 })`.
// Plurals pick the English singular or plural key by the language's plural
// rules: `tn(n, "{n} day", "{n} days")`.
//
// Catalogs live in ./locales/<language>/<area>.ts, each a default-exported
// `Record<string, string>` from English key to translation. Every file of a
// language is merged, so areas never edit each other's files, and a new
// language is a new folder plus one entry in `languages`. i18n/catalog.test.ts
// checks that every literal key used in the source is in every catalog.
//
// Only reader UI text goes through t(): never task titles, notes, agent names
// or anything else a person or an agent wrote.
import { useSyncExternalStore } from "react";

export type Language = "en" | "de" | "it";

/** The languages offered, each named in its own language. */
export const languages: { code: Language; name: string }[] = [
  { code: "en", name: "English" },
  { code: "de", name: "Deutsch" },
  { code: "it", name: "Italiano" },
];

export const isLanguage = (value: unknown): value is Language =>
  languages.some((l) => l.code === value);

type Catalog = Record<string, string>;

const modules = import.meta.glob<{ default: Catalog }>("./locales/*/*.ts", {
  eager: true,
});
const catalogs: Partial<Record<Language, Catalog>> = {};
for (const [path, mod] of Object.entries(modules)) {
  const lang = path.split("/")[2];
  if (!isLanguage(lang)) continue;
  catalogs[lang] = { ...catalogs[lang], ...mod.default };
}

/** The merged catalog of a language, for tests. */
export const catalogFor = (lang: Language): Catalog => catalogs[lang] ?? {};

const storageKey = "pocketcontext.crew.language";

/** The browser's first preferred language Crew offers, else English. */
export function browserLanguage(
  preferred: readonly string[] = typeof navigator === "undefined"
    ? []
    : navigator.languages?.length
      ? navigator.languages
      : [navigator.language],
): Language {
  for (const tag of preferred) {
    const base = String(tag || "").toLowerCase().split(/[-_]/)[0];
    if (isLanguage(base)) return base;
  }
  return "en";
}

function initialLanguage(): Language {
  try {
    const saved = localStorage.getItem(storageKey);
    if (isLanguage(saved)) return saved;
  } catch {
    // Storage may be blocked; the browser language still applies.
  }
  return browserLanguage();
}

let current: Language = initialLanguage();
const listeners = new Set<() => void>();
if (typeof document !== "undefined") document.documentElement.lang = current;

export const getLanguage = (): Language => current;

/**
 * Switches the reader's language at once (no reload): sets `<html lang>`,
 * caches the choice in this browser so the next load starts in it, and
 * re-renders every component that subscribed with useLanguage() (App does,
 * so the whole tree follows). Saving it on the server is the caller's job.
 */
export function setLanguage(lang: Language) {
  if (!isLanguage(lang)) return;
  try {
    localStorage.setItem(storageKey, lang);
  } catch {
    // A blocked storage only loses the cache.
  }
  if (lang === current) return;
  current = lang;
  if (typeof document !== "undefined") document.documentElement.lang = lang;
  for (const listener of [...listeners]) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The current language; re-renders the caller when it changes. */
export const useLanguage = (): Language =>
  useSyncExternalStore(subscribe, getLanguage, getLanguage);

/** The BCP 47 locale for Intl formatting in the current language. */
export const locale = (lang: Language = current): string => lang;

export type Vars = Record<string, string | number>;

const fill = (text: string, vars?: Vars) =>
  vars
    ? text.replace(/\{(\w+)\}/g, (match, name: string) =>
        name in vars ? String(vars[name]) : match,
      )
    : text;

/** Translates an English UI string; missing keys fall back to English. */
export function t(key: string, vars?: Vars): string {
  return fill(catalogs[current]?.[key] ?? key, vars);
}

/**
 * Translates an English string whose meaning depends on where it shows: the
 * catalog key is "context|English" (e.g. "sheet|Done" for a button that
 * closes a sheet, versus the status Done), falling back to the plain key and
 * then to English.
 */
export function tc(context: string, key: string, vars?: Vars): string {
  const catalog = catalogs[current];
  return fill(catalog?.[`${context}|${key}`] ?? catalog?.[key] ?? key, vars);
}

/**
 * Translates a counted string: `one` when the language's plural rule says
 * "one" for n, else `other`. `{n}` is filled with n.
 */
export function tn(n: number, one: string, other: string, vars?: Vars): string {
  const rule = new Intl.PluralRules(locale()).select(n);
  return t(rule === "one" ? one : other, { n, ...vars });
}

/** Resets to a language without notifying, for tests. */
export function resetLanguageForTests(lang: Language = "en") {
  current = lang;
  try {
    localStorage.removeItem(storageKey);
  } catch {
    // ignore
  }
  if (typeof document !== "undefined") document.documentElement.lang = lang;
}
