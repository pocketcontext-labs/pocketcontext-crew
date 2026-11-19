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
import { DialogMenuContext, type MenuItem } from "./DialogHeader";
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
const decide = (row: Row, save = vi.fn().mockResolvedValue(undefined)) => {
  let menu: MenuItem[] = [];
  render(
    <DialogMenuContext.Provider value={(items) => (menu = items)}>
      <ReviewDecision
        row={row}
        busy={false}
        error=""
        attachments={[]}
        loaded
        Prose={Prose}
        when={() => "today"}
        save={save}
      />
    </DialogMenuContext.Provider>,
  );
  return { save, menu: () => menu };
};
it("picks any options, with feedback on each, and records every option (0.32.0)", () => {
  const { save } = decide(review);
  expect(screen.getByRole("heading", { name: "Options · pick any" })).toBeTruthy();
  expect(screen.queryAllByRole("radio")).toHaveLength(0);
  const approve = screen.getByRole("button", { name: "Approve 0 selected" });
  expect(approve).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", { name: "Draft A · LinkedIn" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Draft A · X" }));
  expect(approve).toHaveTextContent("Approve 2 selected");
  expect(approve).toBeEnabled();
  // Selecting opens the option's one-line feedback field.
  fireEvent.change(screen.getByRole("textbox", { name: "Feedback on Draft A · X" }), {
    target: { value: "Use this" },
  });
  // The feedback icon opens the field on an unselected option too.
  expect(screen.queryByRole("textbox", { name: "Feedback on Draft B · LinkedIn" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Feedback on Draft B · LinkedIn" }));
  fireEvent.change(
    screen.getByRole("textbox", { name: "Feedback on Draft B · LinkedIn" }),
    { target: { value: "Too long" } },
  );
  expect(screen.getByRole("checkbox", { name: "Draft B · LinkedIn" })).not.toBeChecked();
  fireEvent.click(approve);
  expect(save).toHaveBeenCalledWith(
    "review.decide",
    {
      decision: "approved",
      note: "",
      option_decisions: [
        { key: "a-linkedin", decision: "approved", note: "" },
        { key: "a-x", decision: "approved", note: "Use this" },
        { key: "b-linkedin", decision: "rejected", note: "Too long" },
        { key: "b-x", decision: "rejected", note: "" },
      ],
    },
    review,
  );
});
it("keeps the selection and feedback on Request changes; Reject in More rejects every option", () => {
  const { save, menu } = decide(review);
  fireEvent.click(screen.getByRole("checkbox", { name: "Draft B · X" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Feedback on Draft B · X" }), {
    target: { value: "Shorter" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Decision note" }), {
    target: { value: "Close" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Request changes" }));
  expect(save).toHaveBeenLastCalledWith(
    "review.decide",
    expect.objectContaining({
      decision: "changes_requested",
      note: "Close",
      option_decisions: expect.arrayContaining([
        { key: "b-x", decision: "approved", note: "Shorter" },
        { key: "a-x", decision: "rejected", note: "" },
      ]),
    }),
    review,
  );
  // No Reject on the main screen: it is the last, red item of the More menu.
  expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
  const reject = menu().at(-1)!;
  expect(reject).toMatchObject({ label: "Reject", destructive: true });
  expect(menu().map((x) => x.label)).toEqual(
    expect.arrayContaining(["Add note", "Copy link"]),
  );
  reject.onSelect();
  expect(save).toHaveBeenLastCalledWith(
    "review.decide",
    expect.objectContaining({
      decision: "rejected",
      option_decisions: expect.arrayContaining([
        { key: "b-x", decision: "rejected", note: "Shorter" },
        { key: "a-x", decision: "rejected", note: "" },
      ]),
    }),
    review,
  );
});
it("focuses the one-line note from Add note in More", () => {
  const { menu } = decide({ ...review, options: null });
  const note = screen.getByRole("textbox", { name: "Decision note" });
  expect(note).toHaveAttribute("rows", "1");
  expect(note).toHaveAttribute("placeholder", "Add a note…");
  menu().find((x) => x.label === "Add note")!.onSelect();
  expect(note).toHaveFocus();
});
it("shows image options as tiles with a feedback badge, under Text and Images", () => {
  const row: Row = {
    ...review,
    options: [
      { key: "a", label: "A · Tokens", body: "We run out of tokens" },
      { key: "img-a", label: "Shared notebook", body: "![Shared notebook](attachment:abcdefabcdef123)" },
      { key: "img-b", label: "Handoff", body: "![Handoff](attachment:abcdefabcdef124)" },
    ],
  };
  decide(row);
  expect(screen.getByRole("heading", { name: "Text · pick any" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Images · pick any" })).toBeTruthy();
  const tile = screen.getByRole("listitem", { name: "Shared notebook" });
  expect(tile).toHaveClass("crew-pick-tile");
  const badge = within(tile).getByRole("button", { name: "Feedback on Shared notebook" });
  expect(badge).not.toHaveAttribute("data-note");
  fireEvent.click(within(tile).getByRole("checkbox", { name: "Shared notebook" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Feedback on Shared notebook" }), {
    target: { value: "Crop it" },
  });
  expect(badge).toHaveAttribute("data-note");
  expect(screen.getByRole("button", { name: "Approve 1 selected" })).toBeEnabled();
});
it("shows a decided review's selection and feedback read-only", () => {
  decide({
    ...review,
    status: "changes_requested",
    decided_at: "2026-11-17T10:00:00.000Z",
    decided_by: "owner:user00000000001",
    option_decisions: [
      { key: "a-linkedin", decision: "approved", note: "Shorten the hook" },
      { key: "a-x", decision: "rejected", note: "" },
      { key: "b-linkedin", decision: "rejected", note: "" },
      { key: "b-x", decision: "rejected", note: "" },
    ],
  });
  expect(screen.getByRole("heading", { name: "Options" })).toBeTruthy();
  const a = screen.getByRole("checkbox", { name: "Draft A · LinkedIn" });
  expect(a).toBeChecked();
  expect(a).toBeDisabled();
  expect(screen.getByRole("checkbox", { name: "Draft A · X" })).not.toBeChecked();
  expect(screen.getByText("Shorten the hook")).toBeTruthy();
  expect(
    screen.getByText("Selected: Draft A · LinkedIn; Not selected: Draft A · X, Draft B · LinkedIn, Draft B · X"),
  ).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Approve/ })).toBeNull();
});
// 0.37.1: the feedback icon focuses its option's field inside the tap (iOS
// opens the keyboard only for a focus made by the gesture) and scrolls it
// into view; an already open field (a selected option) stays open.
it("focuses the option's feedback field synchronously on a tap of its icon", () => {
  const scrolled: Element[] = [];
  Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
    scrolled.push(this);
  });
  decide(review);
  const icon = (label: string) =>
    screen.getByRole("button", { name: `Feedback on ${label}` });
  // A tap or click (detail 1), as opposed to Enter or Space (detail 0).
  const tap = (label: string) => {
    fireEvent.pointerDown(icon(label));
    fireEvent.click(icon(label), { detail: 1 });
  };
  const field = (label: string) =>
    screen.queryByRole("textbox", { name: `Feedback on ${label}` });
  expect(field("Draft B · X")).toBeNull();
  expect(icon("Draft B · X")).toHaveAttribute("aria-expanded", "false");
  tap("Draft B · X");
  // Right after the click, with no frame or timer in between.
  expect(field("Draft B · X")).toHaveFocus();
  expect(scrolled.at(-1)).toBe(field("Draft B · X"));
  expect(icon("Draft B · X")).toHaveAttribute("aria-expanded", "true");
  // Another option's icon moves the focus there; one field per option.
  tap("Draft A · X");
  expect(field("Draft A · X")).toHaveFocus();
  expect(screen.getAllByRole("textbox", { name: "Feedback on Draft A · X" })).toHaveLength(1);
  // A selected option's field is already open: the icon focuses it, never closes it.
  fireEvent.click(screen.getByRole("checkbox", { name: "Draft A · LinkedIn" }));
  (document.activeElement as HTMLElement).blur();
  tap("Draft A · LinkedIn");
  expect(field("Draft A · LinkedIn")).toHaveFocus();
  // Pressed again while its empty field has focus, the icon closes it.
  tap("Draft A · LinkedIn");
  expect(field("Draft A · LinkedIn")).toBeNull();
  // A field with feedback never closes.
  fireEvent.change(field("Draft A · X")!, { target: { value: "Keep" } });
  tap("Draft A · X");
  expect(field("Draft A · X")).toHaveFocus();
  // From the keyboard, the icon toggles an open empty field.
  fireEvent.click(icon("Draft B · X"), { detail: 0 });
  expect(field("Draft B · X")).toBeNull();
  fireEvent.click(icon("Draft B · X"), { detail: 0 });
  expect(field("Draft B · X")).toHaveFocus();
});
const stubClipboard = () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  return writeText;
};
it("copies the draft and each option as plain text, with a short Copied", async () => {
  const writeText = stubClipboard();
  const { menu } = decide({
    ...review,
    draft: "## Launch\n\n**Big** news, see [the post](https://example.com/p).\n- one\n- two",
    options: [
      { key: "a", label: "Draft A", body: "_Short_ hook\n\nwith `code`" },
      { key: "img", label: "Picture", body: "![Picture](attachment:abcdefabcdef123)" },
    ],
  });
  const draftCopy = screen.getByRole("button", { name: "Copy draft text" });
  expect(draftCopy).toHaveTextContent("Copy");
  fireEvent.click(draftCopy);
  expect(writeText).toHaveBeenLastCalledWith(
    "Launch\n\nBig news, see the post (https://example.com/p).\n• one\n• two",
  );
  await waitFor(() => expect(draftCopy).toHaveAttribute("data-state", "copied"));
  expect(draftCopy.querySelector("[data-shown]")).toHaveTextContent("Copied");
  fireEvent.click(screen.getByRole("button", { name: "Copy Draft A" }));
  expect(writeText).toHaveBeenLastCalledWith("Short hook\n\nwith code");
  // Image options have no Copy.
  expect(screen.queryByRole("button", { name: "Copy Picture" })).toBeNull();
  // More has Copy text too, beside Copy link.
  menu().find((x) => x.label === "Copy text")!.onSelect();
  expect(writeText).toHaveBeenLastCalledWith(
    "Launch\n\nBig news, see the post (https://example.com/p).\n• one\n• two",
  );
  await screen.findByText("Text copied");
});
it("copies from a decided review and says when the copy failed", async () => {
  const writeText = stubClipboard().mockRejectedValue(new Error("denied"));
  decide({
    ...review,
    status: "approved",
    decided_at: "2026-11-17T10:00:00.000Z",
    decided_by: "owner:user00000000001",
    option_decisions: ["a-linkedin", "a-x", "b-linkedin", "b-x"].map((key) => ({
      key,
      decision: "approved",
      note: "",
    })),
  });
  const copy = screen.getByRole("button", { name: "Copy Draft B · X" });
  fireEvent.click(copy);
  expect(writeText).toHaveBeenCalledWith("X B");
  await waitFor(() => expect(copy).toHaveAttribute("data-state", "failed"));
  // An option's Copy is an icon; the failure is announced and shown as a cross.
  expect(copy.nextElementSibling).toHaveTextContent("Not copied");
  expect(copy.nextElementSibling).toHaveAttribute("aria-live", "polite");
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
// 0.27.2: one viewer shell for every file type; the step buttons are always
// in the same cluster and the one that stepped keeps focus.
it("keeps previous, next and close in one cluster from an image to a zip", async () => {
  const row = {
    ...review,
    draft: "",
    attachments: [
      { id: "shot", sha256: "shot" },
      { id: "pack", sha256: "pack" },
    ],
  };
  render(
    <ReviewContent
      row={row}
      attachments={[
        file("shot"),
        file("pack", { name: "bundle.zip", image: false, media_type: "application/zip" }),
      ]}
      Prose={Prose}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Open shot.png" }));
  const image = await screen.findByRole("dialog", { name: "Image viewer" });
  expect(image).toHaveClass("crew-viewer");
  fireEvent.click(within(image).getByRole("button", { name: "Next file" }));
  const zip = await screen.findByRole("dialog", { name: "File: bundle.zip" });
  expect(zip).toHaveClass("crew-viewer");
  const cluster = within(zip).getByRole("group", { name: "Viewer" });
  expect(
    [...cluster.querySelectorAll("button, a")].map((x) => x.getAttribute("aria-label")),
  ).toEqual([
    "Previous file",
    "Next file",
    "Download",
    null,
    "Close file preview",
  ]);
  expect(within(cluster).getByRole("button", { name: "Open original" })).toBeDisabled();
  expect(within(zip).getByRole("button", { name: "Zoom in" })).toBeDisabled();
  expect(within(zip).getByText("No preview for this type of file.")).toBeInTheDocument();
  // Focus stays on Next, so repeated clicks or Enter keep stepping.
  expect(within(zip).getByRole("button", { name: "Next file" })).toHaveFocus();
  fireEvent.click(within(zip).getByRole("button", { name: "Next file" }));
  const back = await screen.findByRole("dialog", { name: "Image viewer" });
  expect(within(back).getByRole("button", { name: "Next file" })).toHaveFocus();
  fireEvent.keyDown(back, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
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
