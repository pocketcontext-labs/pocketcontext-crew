// The shared fixtures (tests/fixtures/review_markup.json): the reader's parser
// must agree with the server's on valid, errors (code and line) and blocks.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  blockCopyText,
  characterCount,
  parseReviewMarkup,
  stripReviewMarkup,
} from "./reviewMarkup";

type Case = {
  name: string;
  body: string;
  valid: boolean;
  errors: { code: string; line: number }[];
  blocks: { kind: string; target: string; limit?: number | null; label?: string }[];
};
const fixtures = JSON.parse(
  readFileSync(join(process.cwd(), "..", "tests", "fixtures", "review_markup.json"), "utf8"),
) as { cases: Case[] };

describe("review markup fixtures", () => {
  it.each(fixtures.cases.map((c) => [c.name, c] as const))("%s", (_, c) => {
    const got = parseReviewMarkup(c.body);
    expect(got.valid).toBe(c.valid);
    expect(got.errors.map(({ code, line }) => ({ code, line }))).toEqual(c.errors);
    for (const e of got.errors) {
      expect(e.opener).toMatch(/^:{3,}/);
      expect(e.message).toBeTruthy();
    }
    const blocks = got.valid
      ? got.blocks.map((b) =>
          b.kind === "note"
            ? { kind: b.kind, target: b.target }
            : b.kind === "copy"
              ? { kind: b.kind, target: b.target, label: b.label }
              : { kind: b.kind, target: b.target, limit: b.limit },
        )
      : [];
    expect(blocks).toEqual(c.blocks);
  });
});

it("strips interpreted markup and notes, keeping invalid markup as text", () => {
  const body =
    ":::variant{channel=linkedin}\n\nHello **world**\n\n:::\n\n:::note\n\nSecret\n\n:::\n\n:::poll\n\nA\n\n:::";
  const out = stripReviewMarkup(body);
  expect(out).not.toContain(":::variant");
  expect(out).not.toContain("Secret");
  expect(out).toContain(":::poll");
  expect(blockCopyText(parseReviewMarkup(body).blocks[0])).toBe("Hello world");
});

it("counts code points, URLs as 23 on X", () => {
  expect(characterCount("héllo 👋")).toBe(7);
  expect(characterCount("see https://example.com/a-very-long-path-indeed.", "x")).toBe(4 + 23 + 1);
  expect(characterCount("see https://example.com/a-very-long-path-indeed.", "linkedin")).toBe(48);
});

// Rules the server shares beyond the fixtures (pb_hooks/crew_markup.js).
const targets = (body: string) => parseReviewMarkup(body).blocks.map((b) => b.target);
const codes = (body: string) => parseReviewMarkup(body).errors.map((e) => [e.code, e.line]);
describe("rules shared with the server", () => {
  it("judges blocks one at a time", () => {
    const body = ":::poll\n\nA\n\n:::\n\n:::variant{channel=x}\n\nB\n\n:::";
    expect(targets(body)).toEqual(["x"]);
    expect(codes(body)).toEqual([["review_markup_unknown_directive", 1]]);
  });
  it("keeps every variant of a repeated channel as text", () => {
    const body = ":::variant{channel=x}\n\nOne\n\n:::\n\n:::variant{channel=x}\n\nTwo\n\n:::\n\n:::copy{label=\"A\"}\n\nC\n\n:::";
    expect(targets(body)).toEqual(["copy-1"]);
  });
  it("numbers only interpreted copy blocks", () => {
    const body = ":::copy\n\nBad\n\n:::\n\n:::copy{label=\"Good\"}\n\nOK\n\n:::";
    expect(targets(body)).toEqual(["copy-1"]);
  });
  it.each([
    ":::variant{channel=x channel=linkedin}",
    ":::variant{#id channel=x}",
    ":::variant{.big channel=x}",
    ":::variant[label]{channel=x}",
  ])("refuses %s", (open) => {
    expect(targets(`${open}\n\nText\n\n:::`)).toEqual([]);
    expect(codes(`${open}\n\nText\n\n:::`)).toEqual([["review_markup_invalid_attribute", 1]]);
  });
  it("closes the outermost block first", () => {
    // The first ::: closes the outer variant; the inner note was nested.
    const body = ":::variant{channel=x}\n\n:::note\n\nInner\n\n:::\n\nAfter\n\n:::";
    expect(targets(body)).toEqual([]);
    expect(codes(body)).toEqual([["review_markup_nesting", 3]]);
  });
  it("reads a broken opener as text without a warning", () => {
    expect(codes(':::variant{channel="x}\n\nText\n\n:::')).toEqual([]);
  });
  it("leaves directives in lists and blockquotes as text", () => {
    expect(targets("- :::variant{channel=x}\n\n  Text\n\n  :::")).toEqual([]);
    expect(targets("> :::variant{channel=x}\n>\n> Text\n>\n> :::")).toEqual([]);
  });
});
