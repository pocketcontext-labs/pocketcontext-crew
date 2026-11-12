import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ReviewContent, ReviewDecision, ReviewRequest } from "./Review";
import { decisionSummary, localFilePaths, reviewFiles } from "./reviews";
import { attachmentsApi, type Attachment } from "./attachmentsApi";
import type { Row } from "./crewApi";
const Prose = ({ children }: { children: string }) => (
  <div className="crew-prose">
    <p>{children}</p>
  </div>
);
const review: Row = {
  id: "review000000001",
  revision: 1,
  task: "task00000000001",
  draft: "Choose a draft",
  status: "pending",
  options: [
    { key: "a-linkedin", label: "Draft A · LinkedIn", body: "LinkedIn A" },
    { key: "a-x", label: "Draft A · X", body: "X A" },
    { key: "b-linkedin", label: "Draft B · LinkedIn", body: "LinkedIn B" },
    { key: "b-x", label: "Draft B · X", body: "X B" },
  ],
};
const file = (id: string, extra: Partial<Attachment> = {}): Attachment => ({
  id,
  revision: 1,
  parent_kind: "task",
  parent: "task00000000001",
  name: `${id}.png`,
  image: true,
  media_type: "image/png",
  size: 50,
  position: 1,
  sha256: id,
  ...extra,
});
beforeEach(() => {
  vi.spyOn(attachmentsApi, "fileToken").mockResolvedValue("test-token");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("requires explicit choices and submits exact per-platform decisions", () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(
    <ReviewDecision
      row={review}
      busy={false}
      error=""
      attachments={[]}
      loaded
      Prose={Prose}
      when={() => "today"}
      save={save}
    />,
  );
  const approve = screen.getByRole("button", {
    name: "Approve selected options",
  });
  expect(approve).toBeDisabled();
  for (const label of ["Draft A · LinkedIn", "Draft A · X"])
    fireEvent.click(
      within(screen.getByRole("region", { name: label })).getByRole("radio", {
        name: "Approve",
      }),
    );
  expect(approve).toBeDisabled();
  for (const label of ["Draft B · LinkedIn", "Draft B · X"])
    fireEvent.click(
      within(screen.getByRole("region", { name: label })).getByRole("radio", {
        name: "Reject",
      }),
    );
  fireEvent.change(screen.getByLabelText("Note for Draft A · X (optional)"), {
    target: { value: "Use this" },
  });
  expect(approve).toBeEnabled();
  fireEvent.click(approve);
  expect(save).toHaveBeenCalledWith(
    "review.decide",
    expect.objectContaining({
      decision: "approved",
      option_decisions: expect.arrayContaining([
        { key: "a-linkedin", decision: "approved" },
        { key: "a-x", decision: "approved", note: "Use this" },
        { key: "b-linkedin", decision: "rejected" },
        { key: "b-x", decision: "rejected" },
      ]),
    }),
    review,
  );
});
it("cannot approve all-rejected options but can reject the whole review", () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(
    <ReviewDecision
      row={review}
      busy={false}
      error=""
      attachments={[]}
      loaded
      Prose={Prose}
      when={() => "today"}
      save={save}
    />,
  );
  for (const radio of screen.getAllByRole("radio", { name: "Reject" }))
    fireEvent.click(radio);
  expect(
    screen.getByRole("button", { name: "Approve selected options" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Reject" }));
  expect(save).toHaveBeenCalledWith(
    "review.decide",
    expect.objectContaining({
      decision: "rejected",
      option_decisions: expect.arrayContaining([
        { key: "a-x", decision: "rejected", note: "" },
      ]),
    }),
    review,
  );
});
it("keeps the legacy approval payload unchanged", () => {
  const save = vi.fn().mockResolvedValue(undefined),
    row = { ...review, options: null };
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
  fireEvent.change(screen.getByLabelText("Decision note"), {
    target: { value: "Good" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Approve draft" }));
  expect(save).toHaveBeenCalledWith(
    "review.decide",
    { decision: "approved", note: "Good" },
    row,
  );
});
it("shows only snapshot files, including archived evidence, in draft-reference order", async () => {
  const row = {
    ...review,
    draft: "Second attachment:second before attachment:first",
    attachments: [
      { id: "first", sha256: "first" },
      { id: "second", sha256: "second" },
    ],
  };
  const files = [
    file("first", { archived: true }),
    file("second"),
    file("later"),
  ];
  expect(reviewFiles(row, files).map((x) => x.id)).toEqual(["second", "first"]);
  render(<ReviewContent row={row} attachments={files} Prose={Prose} />);
  expect(
    screen
      .getAllByRole("button", { name: /^Open image:/ })
      .map((x) => x.getAttribute("aria-label")),
  ).toEqual(["Open image: second.png", "Open image: first.png"]);
  expect(screen.queryByText("later.png")).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Open image: first.png" }),
  );
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
});
it("warns for legacy local paths and unresolved snapshot evidence", () => {
  render(
    <ReviewContent
      row={{
        ...review,
        draft: "/workspace/billboard.png",
        attachments: [{ id: "missing", sha256: "abc" }],
      }}
      attachments={[]}
      Prose={Prose}
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Request changes and ask the agent to attach them",
  );
  expect(screen.getByRole("alert")).toHaveTextContent("attachment:missing");
});
it("lets browser owners submit named review alternatives", () => {
  const submit = vi.fn();
  render(<ReviewRequest busy={false} submit={submit} />);
  fireEvent.click(screen.getByText("Review alternatives (optional)"));
  fireEvent.click(screen.getByRole("button", { name: "Add review option" }));
  expect(
    screen.getByRole("button", { name: "Send draft for approval" }),
  ).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Option 1 label"), {
    target: { value: "A · LinkedIn" },
  });
  fireEvent.change(screen.getByLabelText("Option 1 draft"), {
    target: { value: "A draft" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Send draft for approval" }),
  );
  expect(submit).toHaveBeenCalledWith([
    { key: "option-1", label: "A · LinkedIn", body: "A draft" },
  ]);
});
it("finds Unix, home, Windows, UNC and file URLs but not HTTPS", () => {
  expect(
    localFilePaths(
      "/workspace/design one.png\n~/draft.pdf\nC:\\drafts\\a.png\n\\\\server\\b.pdf\nfile:///home/a.png\nhttps://example.com/file.png",
    ),
  ).toEqual([
    "/workspace/design one.png",
    "~/draft.pdf",
    "C:\\drafts\\a.png",
    "\\\\server\\b.pdf",
    "file:///home/a.png",
  ]);
});
it("reports option labels", () => {
  expect(
    decisionSummary({
      ...review,
      option_decisions: [
        { key: "a-x", decision: "approved" },
        { key: "b-x", decision: "rejected" },
      ],
    }),
  ).toBe("Approved: Draft A · X; Rejected: Draft B · X");
});

it("detects relative file paths followed by sentence punctuation", () => {
  expect(localFilePaths("See ./draft.png. Then ../deck.pdf.")).toEqual([
    "./draft.png",
    "../deck.pdf",
  ]);
});
