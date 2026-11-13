import { describe, expect, it } from "vitest";
import { markdownSummary, markdownText } from "./markdownText";

describe("markdownText", () => {
  it("puts a heading on its own line without its markers", () => {
    const brief =
      "Coding sessions act as Implement.\n\n## Standing approval (Alberto, 2026-11-12)\nAlberto gives Implement sessions standing approval.";
    expect(markdownText(brief)).toBe(
      "Coding sessions act as Implement.\nStanding approval (Alberto, 2026-11-12)\nAlberto gives Implement sessions standing approval.",
    );
  });

  it("keeps a plain brief exactly as the old one-paragraph preview", () => {
    const brief =
      "Read relevant notes before work.\nMaintain BUILD;   request changes elsewhere.";
    expect(markdownText(brief)).toBe(brief.replace(/\s+/g, " ").trim());
  });

  it("removes emphasis, code, link and image markers", () => {
    expect(
      markdownText(
        "Use **bold**, *italics*, _under_, ~~gone~~ and `crew_read` with [the guide](https://example.test/guide) ![logo](a.png).",
      ),
    ).toBe("Use bold, italics, under, gone and crew_read with the guide logo.");
  });

  it("keeps snake_case and lone asterisks", () => {
    expect(
      markdownText("Set max_bot_handoffs to 4 * 2 and file_name_here."),
    ).toBe("Set max_bot_handoffs to 4 * 2 and file_name_here.");
  });

  it("lists items on their own lines", () => {
    expect(
      markdownText("Rules:\n- one\n- two\n1. first\n2) second\n* [x] done"),
    ).toBe("Rules:\n• one\n• two\n1. first\n2) second\n• done");
  });

  it("drops raw HTML instead of rendering it", () => {
    expect(
      markdownText(
        'Hi <script>alert(1)</script><b onclick="x">there</b> <!-- c -->',
      ),
    ).toBe("Hi alert(1)there");
  });

  it("handles quotes, rules, fences, tables and setext headings", () => {
    expect(
      markdownText(
        "Title\n=====\n> quoted\n\n---\n```sh\nmake test\n```\n| a | b |\n|---|---|\n| 1 | 2 |",
      ),
    ).toBe("Title\nquoted\nmake test\na · b\n1 · 2");
  });

  it("summarizes the first block", () => {
    expect(markdownSummary("## Role\nWrites posts.")).toBe("Role");
    expect(markdownSummary("")).toBe("");
  });
});
