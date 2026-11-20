import { describe, expect, it } from "vitest";
import {
  markdownExcerpt,
  markdownPlainText,
  markdownSummary,
  markdownText,
} from "./markdownText";

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

describe("markdownPlainText", () => {
  it("pastes cleanly: no markers, paragraphs and line breaks kept", () => {
    const draft = [
      "# Launch post",
      "",
      "**We shipped** _Crew_ 0.37 with `copy`.",
      "Second line of the same paragraph.  ",
      "",
      "- one with [the docs](https://example.com/docs)",
      "  - nested ~~old~~ item",
      "1. first",
      "- [x] done",
      "",
      "> A quote with a [task](#/tasks/abc) and <https://example.com>",
      "",
      "",
      "![Hero](attachment:abcdefabcdef123)",
      "```",
      "  keep *this* as is",
      "```",
      "snake_case_name and 2 * 3 * 4 stay \\*literal\\*",
    ].join("\n");
    expect(markdownPlainText(draft)).toBe(
      [
        "Launch post",
        "",
        "We shipped Crew 0.37 with copy.",
        "Second line of the same paragraph.",
        "",
        "• one with the docs (https://example.com/docs)",
        "  • nested old item",
        "1. first",
        "• ☑ done",
        "",
        "A quote with a task and https://example.com",
        "",
        "Hero",
        "  keep *this* as is",
        "snake_case_name and 2 * 3 * 4 stay *literal*",
      ].join("\n"),
    );
  });

  it("keeps plain text as it is and shows mail links once", () => {
    expect(markdownPlainText("Hook\nProblem\nSolution")).toBe(
      "Hook\nProblem\nSolution",
    );
    expect(
      markdownPlainText("[a@b.co](mailto:a@b.co) or [me](mailto:me@x.io)"),
    ).toBe("a@b.co or me (me@x.io)");
    expect(markdownPlainText("")).toBe("");
  });
});

describe("markdownExcerpt", () => {
  const draft = [
    "Instructions before the variants.",
    ":::note", "For the reviewer alone.", ":::",
    ':::copy{label="Reply"}', "A separate reply.", ":::",
    ":::variant{channel=linkedin}", "**The opening.**", "", "The second paragraph.", ":::",
    ":::variant{channel=x}", "Another version.", ":::",
  ].join("\n");

  it("uses only the first variant's text and keeps the labels for all paste-ready blocks", () => {
    const { text, blocks } = markdownExcerpt(draft);
    expect(text).toBe("The opening.\nThe second paragraph.");
    expect(blocks.map((block) => block.label || block.channel)).toEqual(["Reply", "linkedin", "x"]);
  });

  it("falls back to copy text or the ordinary text outside notes", () => {
    expect(markdownExcerpt(':::copy{label="Greeting"}\n**Hello**\n:::').text).toBe("Hello");
    expect(markdownExcerpt("Intro.\n:::note\nReview this.\n:::").text).toBe("Intro.");
    expect(markdownExcerpt(":::note\nReview this.\n:::").text).toBe("");
  });

  it("truncates the visible words and handles an unbroken string of astral characters", () => {
    expect(markdownExcerpt(draft, 19).text).toBe("The opening.\nThe…");
    expect(markdownExcerpt("🌎🌍🌏🌐", 3).text).toBe("🌎🌍…");
  });

  it("preserves ordinary card formatting and literal directive examples", () => {
    expect(markdownExcerpt("# Heading\n\n**Details** [here](https://example.org)").text)
      .toBe("Heading\nDetails here");
    const literal = markdownExcerpt("```\n:::note\nexample\n:::\n```");
    expect(literal.structured).toBe(false);
    expect(literal.text).toBe(":::note\nexample\n:::");
  });
});
