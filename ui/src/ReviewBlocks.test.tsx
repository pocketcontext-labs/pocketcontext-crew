// Review markup in Prose (0.38.0): the three blocks render as Crew blocks with
// their own Copy and count; everything else renders exactly as before.
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import Prose from "./Prose";
import { copyAllText } from "./ReviewBlocks";
import { markdownPlainText, markdownText } from "./markdownText";
import { ReviewDecision } from "./Review";
import { decisionSummary } from "./reviews";
import type { Row } from "./crewApi";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const html = (body: string) => {
  const { container, unmount } = render(<Prose>{body}</Prose>);
  const out = container.innerHTML;
  unmount();
  return out;
};

// Existing notes, tasks and comments with colons: what they rendered as in
// 0.37.2 (written out, so a change to the pipeline shows up here).
const regressions: [string, string][] = [
  ["re:Crew at 10:30, note:here", "<p>re:Crew at 10:30, note:here</p>"],
  ["A lone ::word leaf\n\n::word", "<p>A lone ::word leaf</p>\n<p>::word</p>"],
  [":::poll\n\nA or B\n\n:::", "<p>:::poll</p>\n<p>A or B</p>\n<p>:::</p>"],
  ["Time 10:30:00 and a :smile: and :x[y]{z=1}", "<p>Time 10:30:00 and a :smile: and :x[y]{z=1}</p>"],
  ["::: plain text with spaces", "<p>::: plain text with spaces</p>"],
  [":::variant{channel=myspace}\n\nText\n\n:::", "<p>:::variant{channel=myspace}</p>\n<p>Text</p>\n<p>:::</p>"],
  // Two variants for one channel both stay text (0.38.0 server rule).
  [
    ":::variant{channel=x}\n\nOne\n\n:::\n\n:::variant{channel=x}\n\nTwo\n\n:::",
    "<p>:::variant{channel=x}</p>\n<p>One</p>\n<p>:::</p>\n<p>:::variant{channel=x}</p>\n<p>Two</p>\n<p>:::</p>",
  ],
];
it.each(regressions)("renders %j unchanged", (body, expected) => {
  expect(html(body)).toBe(`<div class="crew-prose">${expected}</div>`);
});
it("keeps URLs with ports and links in prose", () => {
  const out = html("See https://example.com:8080/x and [a:b](https://example.com/c).");
  expect(out).toContain("example.com:8080/x");
  expect(out).toContain(">a:b</a>");
});

const variants =
  "Intro re:Crew at 10:30 and ::word.\n\n:::variant{channel=linkedin}\n\nLinkedIn **text**.\n\n:::\n\n:::variant{channel=x}\n\n" +
  "x".repeat(270) +
  " https://example.com/long/path\n\n:::\n\n:::note\n\nWhy it works.\n\n:::\n\n:::poll\n\nStays text\n\n:::";

it("renders variants and notes as blocks, and the rest as before", () => {
  const { container } = render(<Prose>{variants}</Prose>);
  // Prose around the blocks renders exactly as it does alone.
  expect(container.querySelector(".crew-prose > p")!.outerHTML).toBe(
    "<p>Intro re:Crew at 10:30 and ::word.</p>",
  );
  const blocks = container.querySelectorAll(".crew-blocks > .crew-block");
  expect(blocks).toHaveLength(2);
  expect(within(blocks[0] as HTMLElement).getByText("LinkedIn")).toBeInTheDocument();
  expect(blocks[0]).toHaveTextContent("14 / 3,000");
  // 270 + space + URL counted as 23 = 294 > 280.
  const xCount = blocks[1].querySelector(".crew-block-count")!;
  expect(xCount).toHaveTextContent("294 / 280 · too long");
  expect(xCount).toHaveAttribute("data-over");
  expect(container.querySelector(".crew-block-note")).toHaveTextContent("Why it works.");
  // Outside a review a note has no "for the reviewer" label.
  expect(container.querySelector(".crew-block-note-label")).toBeNull();
  expect(container.textContent).toContain(":::poll");
  expect(container.textContent).not.toContain(":::variant");
  // No comment button outside a review.
  expect(container.querySelector(".crew-pick-comment")).toBeNull();
});

it("copies only a block's text", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  render(<Prose>{variants}</Prose>);
  const copy = screen.getByRole("button", { name: "Copy LinkedIn" });
  fireEvent.click(copy);
  expect(writeText).toHaveBeenLastCalledWith("LinkedIn text.");
  await waitFor(() => expect(copy).toHaveAttribute("data-state", "copied"));
});

it("keeps markers and notes out of plain text, previews and Copy all", () => {
  for (const text of [markdownPlainText(variants), markdownText(variants), copyAllText(variants)]) {
    expect(text).not.toContain(":::variant");
    expect(text).not.toContain(":::note");
    expect(text).not.toContain("Why it works");
    expect(text).toContain("LinkedIn text.");
  }
  expect(copyAllText(variants)).toMatch(/^LinkedIn\nLinkedIn text\.\n\nX\nx{270} https:\/\/example\.com\/long\/path$/);
});

it("never renders HTML or attribute handlers from markup", () => {
  const { container } = render(
    <Prose>{":::variant{channel=x onclick=alert(1)}\n\n<img src=x onerror=alert(1)><script>alert(1)</script>\n\n:::\n\n:::copy{label=\"<b>hi</b>\"}\n\nok\n\n:::"}</Prose>,
  );
  expect(container.querySelector("img, script, b, [onclick]")).toBeNull();
  expect(container.textContent).toContain(":::variant{channel=x onclick=alert(1)}");
  // The label is text.
  expect(container.querySelector(".crew-block-name")).toHaveTextContent("<b>hi</b>");
});

// Per-block feedback in a review (0.38.0).

const markupReview: Row = {
  id: "review000000002",
  revision: 1,
  task: "task00000000001",
  draft: "Pick one",
  status: "pending",
  options: [
    {
      key: "a",
      label: "Draft A",
      body: ":::variant{channel=linkedin}\n\nLinkedIn A\n\n:::\n\n:::variant{channel=x}\n\nX A\n\n:::\n\n:::note\n\nShort on purpose.\n\n:::",
    },
    { key: "b", label: "Draft B", body: "Plain B" },
  ],
};
const decideReview = (row: Row, save = vi.fn().mockResolvedValue(undefined)) => {
  render(
    <ReviewDecision
      row={row}
      busy={false}
      error=""
      attachments={[]}
      loaded
      Prose={Prose}
      when={() => "today"}
      save={save}
    />,
  );
  return save;
};

it("saves feedback per block into option_decisions[].feedback", () => {
  const save = decideReview(markupReview);
  // Option A: two blocks with Copy and feedback; the note is labelled.
  const a = screen.getByRole("region", { name: "Draft A" });
  expect(within(a).getByRole("button", { name: "Copy Draft A · LinkedIn" })).toBeInTheDocument();
  expect(within(a).getByText("Note for the reviewer")).toBeInTheDocument();
  // Option B: one unnamed block with the same controls.
  const b = screen.getByRole("region", { name: "Draft B" });
  expect(within(b).getByRole("button", { name: "Copy Draft B" })).toBeInTheDocument();
  expect(within(b).getByRole("button", { name: "Feedback on Draft B" })).toBeInTheDocument();

  const comment = within(a).getByRole("button", { name: "Feedback on Draft A · LinkedIn" });
  fireEvent.click(comment);
  const field = within(a).getByPlaceholderText("Feedback on Draft A · LinkedIn…");
  expect(document.activeElement).toBe(field);
  fireEvent.change(field, { target: { value: "Drop the last line" } });
  fireEvent.click(within(a).getByRole("button", { name: "Feedback on Draft A · X" }));
  // An empty field sends nothing.
  fireEvent.click(screen.getByRole("button", { name: "Request changes" }));
  expect(save).toHaveBeenCalledWith(
    "review.decide",
    expect.objectContaining({
      decision: "changes_requested",
      option_decisions: [
        {
          key: "a",
          decision: "rejected",
          note: "",
          feedback: [{ target: "linkedin", note: "Drop the last line" }],
        },
        { key: "b", decision: "rejected", note: "" },
      ],
    }),
    markupReview,
  );
});

it("shows recorded block feedback under its block and counts it", () => {
  const decided: Row = {
    ...markupReview,
    status: "changes_requested",
    decided_at: "2026-11-19T10:00:00.000Z",
    decided_by: "owner:user00000000001",
    option_decisions: [
      {
        key: "a",
        decision: "approved",
        note: "",
        feedback: [
          { target: "linkedin", note: "Shorter" },
          { target: "x", note: "Add the link" },
        ],
      },
      { key: "b", decision: "rejected", note: "" },
    ],
  };
  decideReview(decided);
  const a = screen.getByRole("region", { name: "Draft A" });
  const blocks = a.querySelectorAll(".crew-block");
  expect(blocks[0]).toHaveTextContent("Feedback on Draft A · LinkedIn: Shorter");
  expect(blocks[1]).toHaveTextContent("Feedback on Draft A · X: Add the link");
  // The read-only feedback button stays in place, disabled.
  expect(within(a).getByRole("button", { name: "Feedback on Draft A · X" })).toBeDisabled();
  expect(decisionSummary(decided)).toBe("Selected: Draft A (2 comments); Not selected: Draft B");
});

it("copies every variant from the option's More, without the note", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  decideReview(markupReview);
  const a = screen.getByRole("region", { name: "Draft A" });
  fireEvent.click(within(a).getByRole("button", { name: "Actions for Draft A" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Copy all variants" }));
  expect(writeText).toHaveBeenLastCalledWith("LinkedIn\nLinkedIn A\n\nX\nX A");
  await waitFor(() => expect(a.querySelector(".crew-pick-toast")).toHaveTextContent("Copied"));
  // Feedback on the whole option opens the option's own field.
  fireEvent.click(within(a).getByRole("button", { name: "Actions for Draft A" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Feedback on the whole option" }));
  expect(document.activeElement).toBe(within(a).getByPlaceholderText("Feedback on Draft A…"));
});
