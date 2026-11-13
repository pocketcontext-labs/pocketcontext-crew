import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ReviewContent, ReviewDecision, ReviewRequest } from "./Review";
import { decisionSummary, localFilePaths, reviewFiles } from "./reviews";
import { attachmentsApi, formatBytes, type Attachment } from "./attachmentsApi";
import type { Row } from "./crewApi";
import RealProse from "./Prose";
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
  const gallery = within(
    screen.getByRole("region", { name: "Files submitted for review" }),
  );
  // Each file once, as a tile with its name, type and size.
  expect(
    gallery
      .getAllByRole("button", { name: /^Open / })
      .map((x) => x.getAttribute("aria-label")),
  ).toEqual(["Open second.png", "Open first.png"]);
  expect(gallery.getAllByText("second.png")).toHaveLength(1);
  expect(gallery.getAllByText(/^PNG · /)).toHaveLength(2);
  expect(screen.queryByText("later.png")).not.toBeInTheDocument();
  fireEvent.click(gallery.getByRole("button", { name: "Open first.png" }));
  const viewer = await screen.findByRole("dialog");
  // The viewer steps through every submitted file.
  expect(viewer).toHaveTextContent("2 / 2");
  fireEvent.keyDown(viewer, { key: "ArrowRight" });
  expect(await screen.findByRole("dialog")).toHaveTextContent("1 / 2");
  expect(screen.getByRole("dialog")).toHaveTextContent("second.png");
});
it("steps from an image to an HTML file, which opens in the sandboxed preview", async () => {
  const preview = vi
    .spyOn(attachmentsApi, "previewLink")
    .mockResolvedValue({ url: "/api/crew/attachment?id=page&preview=signed", expires_at: "" });
  const row = {
    ...review,
    draft: "",
    attachments: [
      { id: "shot", sha256: "shot" },
      { id: "page", sha256: "page" },
    ],
  };
  render(
    <ReviewContent
      row={row}
      attachments={[
        file("shot"),
        file("page", { name: "homepage.html", image: false, media_type: "text/html" }),
      ]}
      Prose={Prose}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Open shot.png" }));
  fireEvent.click(await screen.findByRole("button", { name: "Next file" }));
  const frame = await screen.findByTitle("Preview of homepage.html");
  expect(preview).toHaveBeenCalledWith("page");
  expect(frame.tagName).toBe("IFRAME");
  expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
  expect(frame.getAttribute("src")).toBe("/api/crew/attachment?id=page&preview=signed");
  expect(screen.getByRole("link", { name: "Open in new tab" })).toHaveAttribute("rel", "noopener noreferrer");
  expect(screen.getByText("Preview runs isolated from Crew")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Mobile" }));
  expect(screen.getByRole("button", { name: "Mobile" })).toHaveAttribute("aria-pressed", "true");
  expect(frame.style.width).toBe("390px");
  fireEvent.click(screen.getByRole("button", { name: "Previous file" }));
  // Back to the image, in the zoomable image viewer.
  expect(await screen.findByRole("toolbar", { name: "Zoom" })).toBeInTheDocument();
  expect(screen.queryByTitle("Preview of homepage.html")).toBeNull();
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
    screen.getByRole("button", { name: "Request approval" }),
  ).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Option 1 label"), {
    target: { value: "A · LinkedIn" },
  });
  fireEvent.change(screen.getByLabelText("Option 1 draft"), {
    target: { value: "A draft" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Request approval" }),
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
it("keeps the draft's images and the file grid in place while typing a decision note", async () => {
  let renders = 0;
  const CountingProse = ({ children }: { children: string }) => {
    renders++;
    return <RealProse>{children}</RealProse>;
  };
  render(
    <ReviewDecision
      row={{
        ...review,
        options: [],
        draft: "Concept\n\n![concept](attachment:att000000000001)",
        attachments: [{ id: "att000000000001", sha256: "att000000000001" }],
      }}
      busy={false}
      error=""
      attachments={[file("att000000000001")]}
      loaded
      Prose={CountingProse}
      when={() => "now"}
      save={vi.fn()}
    />,
  );
  const loaded = (name: string, scope = screen) =>
    waitFor(() => {
      const el = scope.getByRole("img", { name });
      expect(el.tagName).toBe("IMG");
      return el;
    });
  const draftImage = await loaded("concept");
  const gallery = screen.getByRole("region", { name: "Files submitted for review" });
  const thumb = await waitFor(() => {
    const el = gallery.querySelector("img");
    expect(el).not.toBeNull();
    return el!;
  });
  const before = renders;
  const note = screen.getByLabelText("Decision note");
  for (const value of ["L", "Lo", "Looks good"])
    fireEvent.change(note, { target: { value } });
  expect(renders).toBe(before);
  expect(screen.getByRole("img", { name: "concept" })).toBe(draftImage);
  expect(gallery.querySelector("img")).toBe(thumb);
  expect(draftImage.getAttribute("src")).toBe(screen.getByRole("img", { name: "concept" }).getAttribute("src"));
});
it("does not remount Markdown images when the page re-renders", async () => {
  const { rerender } = render(
    <ReviewContent
      row={{ ...review, draft: "![concept](attachment:att000000000001)", attachments: [{ id: "att000000000001", sha256: "att000000000001" }] }}
      attachments={[file("att000000000001")]}
      Prose={RealProse}
    />,
  );
  const image = await waitFor(() => {
    const el = screen.getByRole("img", { name: "concept" });
    expect(el.tagName).toBe("IMG");
    return el;
  });
  rerender(
    <ReviewContent
      row={{ ...review, draft: "![concept](attachment:att000000000001)", attachments: [{ id: "att000000000001", sha256: "att000000000001" }] }}
      attachments={[file("att000000000001")]}
      Prose={RealProse}
    >
      <p>Changed beside the draft</p>
    </ReviewContent>,
  );
  expect(screen.getByRole("img", { name: "concept" })).toBe(image);
});
it("offers a one-click download for every file submitted for review", () => {
  const download = vi.spyOn(attachmentsApi, "download").mockResolvedValue(undefined);
  render(
    <ReviewContent
      row={{
        ...review,
        attachments: [
          { id: "att000000000001", sha256: "att000000000001" },
          { id: "att000000000002", sha256: "att000000000002" },
        ],
      }}
      attachments={[
        file("att000000000001", { name: "concept 14 – café.png" }),
        file("att000000000002", { name: "brief.pdf", image: false, media_type: "application/pdf" }),
      ]}
      Prose={Prose}
    />,
  );
  const gallery = screen.getByRole("region", { name: "Files submitted for review" });
  fireEvent.click(within(gallery).getByRole("button", { name: "Download concept 14 – café.png" }));
  expect(download).toHaveBeenCalledWith(
    expect.objectContaining({ id: "att000000000001", name: "concept 14 – café.png" }),
  );
  fireEvent.click(within(gallery).getByRole("button", { name: "Download brief.pdf" }));
  expect(download).toHaveBeenLastCalledWith(
    expect.objectContaining({ id: "att000000000002", name: "brief.pdf" }),
  );
  expect(within(gallery).getByText("PDF · " + formatBytes(file("x").size))).toBeInTheDocument();
});
