// Every literal key the reader passes to t() or tn() must be in every
// catalog, with the same {placeholders}; and the runtime behaves as the
// i18n/index.ts contract says.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  browserLanguage,
  catalogFor,
  getLanguage,
  languages,
  resetLanguageForTests,
  setLanguage,
  t,
  tn,
  type Language,
} from "./index";

// Vitest runs from ui/.
const src = join(process.cwd(), "src") + "/";

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory())
      return name === "i18n" || name === "assets" ? [] : sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const literal = String.raw`("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\`(?:\\.|[^\`\\$])*\`)`;
const unquote = (raw: string) => {
  const body = raw.slice(1, -1);
  return raw[0] === '"' ? JSON.parse(raw) : body.replace(/\\(.)/g, "$1");
};

/** Literal keys used in the reader source, with the file they came from. */
function usedKeys(): Map<string, string> {
  const keys = new Map<string, string>();
  const single = new RegExp(String.raw`(?<![\w.$])t\(\s*` + literal, "g");
  const plural = new RegExp(
    String.raw`(?<![\w.$])tn\(\s*[^,()]+(?:\([^()]*\))?\s*,\s*` + literal + String.raw`\s*,\s*` + literal,
    "g",
  );
  for (const file of sources(src)) {
    const text = readFileSync(file, "utf8");
    const name = file.slice(src.length);
    for (const m of text.matchAll(single)) keys.set(unquote(m[1]), name);
    for (const m of text.matchAll(plural)) {
      keys.set(unquote(m[1]), name);
      keys.set(unquote(m[2]), name);
    }
  }
  return keys;
}

const placeholders = (text: string) =>
  [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

const translated = languages.map((l) => l.code).filter((c) => c !== "en");

describe("catalogs", () => {
  const keys = usedKeys();
  for (const lang of translated) {
    it(`${lang} has every key the reader uses`, () => {
      const catalog = catalogFor(lang);
      const missing = [...keys]
        .filter(([key]) => !(key in catalog))
        .map(([key, file]) => `${file}: ${JSON.stringify(key)}`);
      expect(missing).toEqual([]);
    });
    it(`${lang} keeps each key's placeholders`, () => {
      const wrong = Object.entries(catalogFor(lang))
        .filter(([key, value]) => placeholders(key).join() !== placeholders(value).join())
        .map(([key, value]) => `${key} -> ${value}`);
      expect(wrong).toEqual([]);
    });
  }
});

describe("t", () => {
  afterEach(() => resetLanguageForTests());

  it("switches language without a reload and sets html lang", () => {
    expect(t("Sign out")).toBe("Sign out");
    setLanguage("de");
    expect(getLanguage()).toBe("de");
    expect(document.documentElement.lang).toBe("de");
    expect(t("Sign out")).toBe("Abmelden");
    setLanguage("it");
    expect(document.documentElement.lang).toBe("it");
    expect(t("Sign out")).toBe("Esci");
  });

  it("falls back to the English key and fills placeholders", () => {
    setLanguage("de");
    expect(t("A key no catalog has {x}", { x: 1 })).toBe("A key no catalog has 1");
  });

  it("picks plural forms by the language's rules", () => {
    expect(tn(1, "{n} day", "{n} days")).toBe("1 day");
    expect(tn(3, "{n} day", "{n} days")).toBe("3 days");
  });

  it("defaults to the browser language when Crew offers it", () => {
    const cases: [string[], Language][] = [
      [["de-DE", "en"], "de"],
      [["it"], "it"],
      [["fr-FR", "it-IT"], "it"],
      [["fr-FR"], "en"],
      [[], "en"],
    ];
    for (const [preferred, expected] of cases)
      expect(browserLanguage(preferred)).toBe(expected);
  });
});
