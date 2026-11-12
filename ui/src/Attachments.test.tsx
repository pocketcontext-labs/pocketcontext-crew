import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";
import CrewWorkspace from "./CrewWorkspace";
import { crewApi, type Row } from "./crewApi";
import {
  AttachmentError,
  attachmentsApi,
  screenshotName,
  type Attachment,
} from "./attachmentsApi";

const agent: Row = {
  id: "agent0000000001",
  revision: 1,
  name: "Build",
  brief: "",
};
const bucket: Row = {
  id: "bucket000000001",
  revision: 1,
  name: "BUILD",
  responsible_agent: agent.id,
};
const taskId = "task00000000001";
const att = (id: string, extra: Partial<Attachment> = {}): Attachment => ({
  id,
  revision: 1,
  parent_kind: "task",
  parent: taskId,
  name: `${id}.png`,
  media_type: "image/png",
  image: true,
  width: 800,
  height: 600,
  size: 2048,
  position: 1,
  ...extra,
});
let fixtures: Record<string, Row[]>;
let attachments: Attachment[];
const MB = 1024 * 1024;
/** A File reporting `size` bytes without allocating them. */
const sized = (name: string, size: number) => {
  const file = new File(["x"], name);
  Object.defineProperty(file, "size", { value: size });
  return file;
};
const png = (name = "image.png") =>
  new File([new Uint8Array([137, 80, 78, 71, 1])], name, { type: "image/png" });
const today = () => screenshotName([]).replace(/-1\.png$/, "");

beforeEach(() => {
  vi.spyOn(crewApi, "serverVersion").mockResolvedValue({
    version: "0.16.0",
    commit: "",
  });
  vi.spyOn(crewApi, "connection").mockResolvedValue({ kind: "local" });
  fixtures = {
    agents: [agent],
    buckets: [bucket],
    tasks: [
      {
        id: taskId,
        revision: 2,
        title: "Crash on save",
        description: "Steps",
        status: "todo",
        readiness: "waiting",
        assigned_agent: "",
        draft: "",
        labels: [],
        links: [],
      },
    ],
    reviews: [],
    notes: [],
    events: [],
  };
  attachments = [];
  vi.spyOn(crewApi, "read").mockImplementation(async (c, f = {}) => {
    if (c === "attachments")
      return attachments.filter(
        (a) =>
          a.parent === f.parent && Boolean(a.archived) === Boolean(f.archived),
      );
    if (f.id) return (fixtures[c] || []).filter((x) => x.id === f.id);
    return f.archived ? [] : fixtures[c] || [];
  });
  vi.spyOn(crewApi, "write").mockResolvedValue({ id: "x", revision: 1 });
  vi.spyOn(attachmentsApi, "fileToken").mockResolvedValue("tok");
  vi.spyOn(attachmentsApi, "cardThumbnails").mockResolvedValue({});
  history.replaceState(null, "", "/#/tasks");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  history.replaceState(null, "", "/");
});
async function openTask() {
  history.replaceState(null, "", `/#/tasks/${taskId}`);
  render(<CrewWorkspace />);
  return within(await screen.findByRole("dialog"));
}
const descriptionBox = (dialog: ReturnType<typeof within>) =>
  dialog.getByLabelText("Description") as HTMLTextAreaElement;

describe("Files section", () => {
  it("shows images, other files and removed files", async () => {
    attachments = [
      att("img1"),
      att("log1", {
        name: "app.log",
        image: false,
        media_type: "text/plain",
        position: 2,
      }),
      att("gone", { name: "old.png", archived: true, position: 3 }),
    ];
    const dialog = await openTask();
    const open = await dialog.findByRole("button", {
      name: "Open image img1.png",
    });
    await waitFor(() =>
      expect(open.querySelector("img")).toHaveAttribute(
        "src",
        "/api/crew/attachment?id=img1&thumb=320x0&token=tok",
      ),
    );
    expect(open.querySelector("img")).toHaveAttribute("loading", "lazy");
    expect(
      dialog.getByRole("button", { name: "Open app.log" }),
    ).toBeInTheDocument();
    expect(
      dialog.getByRole("link", { name: "Download app.log" }),
    ).toBeInTheDocument();
    expect(dialog.getByText("Removed files (1)")).toBeInTheDocument();
    expect(
      dialog.getByRole("button", { name: "Restore old.png" }),
    ).toBeInTheDocument();
    expect(dialog.getByText("2 of 20")).toBeInTheDocument();
  });
  it("uploads several files one request each, with retry after a failure", async () => {
    const upload = vi
      .spyOn(attachmentsApi, "upload")
      .mockImplementationOnce(async (_p, file) => ({
        attachment: att("new1", { name: file.name }),
        review_withdrawn: false,
      }))
      .mockRejectedValueOnce(
        new AttachmentError(
          "b.png is larger than 20 MiB",
          400,
          "file_too_large",
        ),
      )
      .mockImplementationOnce(async (_p, file) => ({
        attachment: att("new2", { name: file.name, position: 2 }),
        review_withdrawn: false,
      }));
    const dialog = await openTask();
    await dialog.findByText("Files");
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [png("a.png"), png("b.png")] },
    });
    expect(
      await dialog.findByRole("button", { name: "Open image a.png" }),
    ).toBeInTheDocument();
    expect(
      await dialog.findByText("b.png is larger than 20 MiB"),
    ).toBeInTheDocument();
    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload.mock.calls.map(([p, f]) => [p, f.name])).toEqual([
      [{ kind: "task", id: taskId }, "a.png"],
      [{ kind: "task", id: taskId }, "b.png"],
    ]);
    fireEvent.click(dialog.getByRole("button", { name: "Retry b.png" }));
    expect(
      await dialog.findByRole("button", { name: "Open image b.png" }),
    ).toBeInTheDocument();
    expect(dialog.queryByText("b.png is larger than 20 MiB")).toBeNull();
  });
  it("refuses files over a limit before sending, with a reason each", async () => {
    attachments = Array.from({ length: 19 }, (_, i) =>
      att(`f${i}`, { name: `f${i}.txt`, image: false, position: i + 1 }),
    );
    const upload = vi
      .spyOn(attachmentsApi, "upload")
      .mockImplementation(async (_p, file) => ({
        attachment: att("new1", { name: file.name, image: false }),
        review_withdrawn: false,
      }));
    const dialog = await openTask();
    await dialog.findByText("19 of 20");
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: {
        files: [
          sized("big.zip", 21 * MB),
          sized("ok.txt", 3),
          sized("one-more.txt", 3),
        ],
      },
    });
    expect(
      await dialog.findByText("big.zip is larger than 20 MB (21 MB)."),
    ).toBeInTheDocument();
    expect(
      dialog.getByText(
        "one-more.txt was not added: a task or note holds at most 20 files.",
      ),
    ).toBeInTheDocument();
    expect(dialog.queryByRole("button", { name: "Retry big.zip" })).toBeNull();
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(upload.mock.calls[0][1].name).toBe("ok.txt");
  });
  it("stages new-item files within the per-file and total limits", async () => {
    vi.spyOn(attachmentsApi, "createWithFiles").mockResolvedValue({
      id: "task2",
      revision: 1,
    });
    render(<CrewWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: /New task/ }));
    const dialog = within(await screen.findByRole("dialog"));
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    fireEvent.change(input, {
      target: {
        files: [
          ...[1, 2, 3, 4, 5].map((n) => sized(`v${n}.mp4`, 17 * MB)),
          sized("v6.mp4", 17 * MB),
          sized("too-big.mov", 30 * MB),
        ],
      },
    });
    expect(
      await dialog.findByText(
        /v6\.mp4 was not added: files saved with a new item are limited to 89 MB/,
      ),
    ).toBeInTheDocument();
    expect(
      dialog.getByText("too-big.mov is larger than 20 MB (30 MB)."),
    ).toBeInTheDocument();
    expect(dialog.getByText("5 of 20")).toBeInTheDocument();
  });
  it("removes after confirming and restores", async () => {
    attachments = [att("img1")];
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const archive = vi
      .spyOn(attachmentsApi, "archive")
      .mockResolvedValue({ ...att("img1"), archived: true, revision: 2 });
    const restore = vi
      .spyOn(attachmentsApi, "restore")
      .mockResolvedValue({ ...att("img1"), archived: false, revision: 3 });
    const dialog = await openTask();
    fireEvent.click(
      await dialog.findByRole("button", { name: "Remove img1.png" }),
    );
    expect(archive).toHaveBeenCalledWith(
      expect.objectContaining({ id: "img1" }),
    );
    fireEvent.click(
      await dialog.findByRole("button", { name: "Restore img1.png" }),
    );
    await waitFor(() => expect(restore).toHaveBeenCalled());
    expect(
      await dialog.findByRole("button", { name: "Open image img1.png" }),
    ).toBeInTheDocument();
  });
  it("says when a file change withdrew the pending approval and takes the new revision", async () => {
    vi.spyOn(attachmentsApi, "upload").mockResolvedValue({
      attachment: att("new1"),
      review_withdrawn: true,
    });
    const dialog = await openTask();
    await dialog.findByText("Files");
    fixtures.tasks = [
      { ...fixtures.tasks[0], revision: 3, readiness: "waiting" },
    ];
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [png("a.png")] },
    });
    expect(
      await dialog.findByText(
        /pending approval was withdrawn because the task changed/,
      ),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(crewApi.read).toHaveBeenCalledWith("tasks", { id: taskId }),
    );
    // The next save uses the new revision.
    fireEvent.change(dialog.getAllByRole("textbox")[0], {
      target: { value: "Crash on save!" },
    });
    fireEvent.click(dialog.getByRole("button", { name: "Save task" }));
    await waitFor(() =>
      expect(crewApi.write).toHaveBeenCalledWith(
        "task.update",
        expect.anything(),
        expect.objectContaining({ revision: 3 }),
        "",
      ),
    );
  });
  it("creates a one-time upload link and shows it once", async () => {
    vi.spyOn(attachmentsApi, "createUploadLink").mockResolvedValue({
      id: "link1",
      revision: 1,
      token: "t".repeat(43),
      path: `#/upload/${"t".repeat(43)}`,
      expires_at: new Date(Date.now() + 15 * 60000).toISOString(),
      max_files: 10,
    });
    const dialog = await openTask();
    fireEvent.click(
      await dialog.findByRole("button", { name: "Get upload link" }),
    );
    expect(
      await dialog.findByText(`${location.origin}/#/upload/${"t".repeat(43)}`),
    ).toBeInTheDocument();
    expect(
      dialog.getByText(/up to 10 files to this task\. It works once/),
    ).toBeInTheDocument();
    expect(attachmentsApi.createUploadLink).toHaveBeenCalledWith({
      kind: "task",
      id: taskId,
    }); // Managing links opens the Files section of the Connect page.
    expect(
      dialog.getByRole("link", { name: "Manage upload links" }),
    ).toHaveAttribute("href", "#/connect?section=files");
  });
  it("shows and focuses the Files section for #/connect?section=files, once", async () => {
    const scroll = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scroll;
    onTestFinished(() => {
      Element.prototype.scrollIntoView = original;
    });
    history.replaceState(null, "", "/#/connect?section=files");
    render(<CrewWorkspace />);
    const section = await screen.findByRole("region", { name: "Files" });
    await waitFor(() => expect(section).toHaveFocus());
    expect(scroll).toHaveBeenCalled();
    // The query is dropped, so a refresh or Back does not scroll again.
    expect(location.hash).toBe("#/connect");
  });
  it("hides adding in read-only items", async () => {
    attachments = [att("img1")];
    fixtures.tasks = [];
    vi.mocked(crewApi.read).mockImplementation(async (c, f = {}) => {
      if (c === "attachments") return f.archived ? [] : attachments;
      if (c === "tasks" && f.archived)
        return [
          {
            id: taskId,
            revision: 2,
            title: "Old",
            archived: true,
            status: "done",
          },
        ];
      return f.archived ? [] : fixtures[c] || [];
    });
    const dialog = await openTask();
    expect(
      await dialog.findByRole("button", { name: "Open image img1.png" }),
    ).toBeInTheDocument();
    expect(dialog.queryByRole("button", { name: "Add files" })).toBeNull();
    expect(
      dialog.queryByRole("button", { name: "Remove img1.png" }),
    ).toBeNull();
    expect(
      dialog.queryByRole("button", { name: "Get upload link" }),
    ).toBeNull();
  });
});

describe("paste and drop into Markdown", () => {
  it("uploads a pasted screenshot and inserts its reference", async () => {
    let finish: (v: {
      attachment: Attachment;
      review_withdrawn: boolean;
    }) => void = () => {};
    const upload = vi.spyOn(attachmentsApi, "upload").mockImplementation(
      (_p, file) =>
        new Promise((resolve) => {
          finish = resolve;
          void file;
        }),
    );
    const dialog = await openTask();
    fireEvent.click(
      within(
        dialog.getByRole("tablist", { name: "Description view" }),
      ).getByRole("tab", {
        name: "Edit",
      }),
    );
    const box = descriptionBox(dialog);
    box.setSelectionRange(5, 5);
    fireEvent.paste(box, {
      clipboardData: { files: [png()], types: ["Files"] },
    });
    const name = `${today()}-1.png`;
    await waitFor(() =>
      expect(box.value).toMatch(
        new RegExp(`^Steps⏳ Uploading ${name}… \\(upload [\\w-]+\\)$`),
      ),
    );
    expect(upload.mock.calls[0][1].name).toBe(name);
    // Save waits for the upload, so no placeholder is ever saved.
    const save = dialog.getByRole("button", { name: "Waiting for uploads…" });
    expect(save).toBeDisabled();
    // Edits around the placeholder (and to its name) do not lose it.
    fireEvent.change(box, {
      target: {
        value: `Intro\n${box.value.replace("Steps", "Steps ").replace(name, "renamed")}\nOutro`,
      },
    });
    finish({ attachment: att("shot1", { name }), review_withdrawn: false });
    await waitFor(() =>
      expect(box.value).toBe(
        `Intro\nSteps ![${name}](attachment:shot1)\nOutro`,
      ),
    );
    expect(dialog.getByRole("button", { name: "Save task" })).toBeEnabled();
  });
  it("refuses an oversized pasted file without uploading it", async () => {
    const upload = vi.spyOn(attachmentsApi, "upload");
    const dialog = await openTask();
    fireEvent.click(
      within(
        dialog.getByRole("tablist", { name: "Description view" }),
      ).getByRole("tab", {
        name: "Edit",
      }),
    );
    const box = descriptionBox(dialog);
    fireEvent.drop(box, {
      dataTransfer: { files: [sized("huge.mov", 25 * MB)], types: ["Files"] },
    });
    expect(
      await dialog.findByText("huge.mov is larger than 20 MB (25 MB)."),
    ).toBeInTheDocument();
    expect(box.value).toBe("Steps");
    expect(upload).not.toHaveBeenCalled();
  });
  it("removes the placeholder and explains a failed upload", async () => {
    vi.spyOn(attachmentsApi, "upload").mockRejectedValue(
      new AttachmentError("Storage limit reached", 400, "storage_limit"),
    );
    const dialog = await openTask();
    fireEvent.click(
      within(
        dialog.getByRole("tablist", { name: "Description view" }),
      ).getByRole("tab", {
        name: "Edit",
      }),
    );
    const box = descriptionBox(dialog);
    fireEvent.drop(box, {
      dataTransfer: { files: [png("trace.png")], types: ["Files"] },
    });
    expect(
      await dialog.findByText(
        "Could not attach trace.png: Storage limit reached",
      ),
    ).toBeInTheDocument();
    expect(box.value).toBe("Steps");
  });
  it("stages files in New task and creates everything in one request", async () => {
    let n = 0;
    vi.stubGlobal(
      "URL",
      Object.assign(URL, {
        createObjectURL: () => `blob:local-${++n}`,
        revokeObjectURL: () => {},
      }),
    );
    const create = vi
      .spyOn(attachmentsApi, "createWithFiles")
      .mockRejectedValueOnce(
        new AttachmentError(
          "No task was created: a file was refused",
          400,
          "",
          {
            2: { code: "empty_file", message: "third.png is empty" },
          },
        ),
      )
      .mockResolvedValueOnce({ id: "task2", revision: 1 });
    render(<CrewWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: /New task/ }));
    const dialog = within(await screen.findByRole("dialog"));
    fireEvent.change(dialog.getAllByRole("textbox")[0], {
      target: { value: "Bug" },
    });
    const box = descriptionBox(dialog);
    fireEvent.paste(box, {
      clipboardData: { files: [png(), png()], types: ["Files"] },
    });
    const first = `${today()}-1.png`,
      second = `${today()}-2.png`;
    await waitFor(() =>
      expect(box.value).toBe(
        `![${first}](attachment:new-1)\n![${second}](attachment:new-2)`,
      ),
    );
    // Staged images preview locally, in the text and in Files.
    expect(
      dialog
        .getByRole("button", { name: `Open image ${first}` })
        .querySelector("img"),
    ).toHaveAttribute("src", "blob:local-1");
    // A third file, then the first removed: placeholders renumber on save.
    fireEvent.drop(box, {
      dataTransfer: { files: [png("third.png")], types: ["Files"] },
    });
    fireEvent.click(dialog.getByRole("button", { name: `Remove ${first}` }));
    await waitFor(() => expect(box.value).not.toContain("new-1"));
    fireEvent.click(dialog.getByRole("button", { name: "Save task" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const [kind, fields, files] = create.mock.calls[0];
    expect(kind).toBe("task");
    expect(files.map((f) => f.name)).toEqual([second, "third.png"]);
    expect(String(fields.description)).toContain(
      `![${second}](attachment:new-1)`,
    );
    expect(String(fields.description)).toContain(
      "![third.png](attachment:new-2)",
    );
    // Atomic failure: the form stays with the refused file marked.
    expect(await dialog.findByText("third.png is empty")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(dialog.getByRole("button", { name: "Remove third.png" }));
    fireEvent.click(dialog.getByRole("button", { name: "Save task" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[1][2].map((f) => f.name)).toEqual([second]);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("Markdown references", () => {
  it("renders same-item images and media, and nothing foreign or external", async () => {
    attachments = [
      att("img1", { name: "first.png" }),
      att("img2", { name: "second.png", position: 2, width: 400, height: 300 }),
      att("vid1", {
        name: "clip.mp4",
        image: false,
        media_type: "video/mp4",
        position: 3,
      }),
      att("aud1", {
        name: "note.mp3",
        image: false,
        media_type: "audio/mpeg",
        position: 4,
      }),
      att("gone", { name: "old.png", archived: true, position: 5 }),
    ];
    fixtures.tasks[0].description = [
      "![Step one](attachment:img1)",
      "![](attachment:img2)",
      "![clip](attachment:vid1)",
      "![voice](attachment:aud1)",
      "![Old step](attachment:gone)",
      "![Foreign](attachment:zzzzzzzzzzzzzzz)",
      "![Tracker](https://evil.test/pixel.png)",
      "![Inline](data:image/png;base64,AAAA)",
      "![Upper](ATTACHMENT:img1)",
      "![Spaced](<attachment: img1>)",
      "![Decoded](attachment&#58;img2)",
    ].join("\n\n");
    const dialog = await openTask();
    const one = await dialog.findByRole("button", {
      name: "Open image: Step one",
    });
    await waitFor(() =>
      expect(one.querySelector("img")).toHaveAttribute(
        "src",
        "/api/crew/attachment?id=img1&thumb=1600x0&token=tok",
      ),
    );
    const two = dialog.getByRole("button", { name: "Open image: second.png" });
    expect(two.querySelector("img")).toHaveAttribute("width", "400");
    expect(two.querySelector("img")).toHaveAttribute("height", "300");
    const video = document.querySelector("video.crew-inline-video");
    expect(video).toHaveAttribute(
      "src",
      "/api/crew/attachment?id=vid1&token=tok",
    );
    expect(video).toHaveAttribute("preload", "metadata");
    expect(document.querySelector("audio.crew-inline-audio")).toHaveAttribute(
      "src",
      "/api/crew/attachment?id=aud1&token=tok",
    );
    expect(dialog.getByText("Image removed: Old step")).toBeInTheDocument();
    expect(dialog.getByText("Image unavailable: Foreign")).toBeInTheDocument();
    expect(dialog.getByText("Image unavailable: Inline")).toBeInTheDocument();
    // Only the exact scheme resolves, after Markdown decoding.
    expect(dialog.getByText("Image unavailable: Upper")).toBeInTheDocument();
    expect(dialog.getByText("Image unavailable: Spaced")).toBeInTheDocument();
    expect(
      dialog.getByRole("button", { name: "Open image: Decoded" }),
    ).toBeInTheDocument();
    expect(
      dialog.getByRole("link", { name: "image on evil.test" }),
    ).toHaveAttribute("href", "https://evil.test/pixel.png");
    const sources = Array.from(document.querySelectorAll("img")).map((i) =>
      i.getAttribute("src"),
    );
    expect(sources.some((s) => /evil\.test|^data:/.test(String(s)))).toBe(
      false,
    );
  });
  it("opens the lightbox at the clicked image and moves with the keyboard", async () => {
    attachments = [
      att("img1", { name: "first.png" }),
      att("img2", { name: "second.png", position: 2 }),
    ];
    fixtures.tasks[0].description =
      "![first](attachment:img1)\n\n![second](attachment:img2)";
    const dialog = await openTask();
    const trigger = await dialog.findByRole("button", {
      name: "Open image: second",
    });
    trigger.focus();
    fireEvent.click(trigger);
    const viewer = await screen.findByRole("dialog", { name: "Image viewer" });
    const shown = () => within(viewer).getByRole("img");
    expect(shown()).toHaveAttribute(
      "src",
      "/api/crew/attachment?id=img2&token=tok",
    );
    expect(
      within(viewer).getByRole("button", { name: "Close image viewer" }),
    ).toHaveFocus();
    fireEvent.keyDown(viewer, { key: "ArrowRight" });
    expect(shown()).toHaveAttribute("alt", "first.png");
    fireEvent.keyDown(viewer, { key: "ArrowLeft" });
    expect(shown()).toHaveAttribute("alt", "second.png");
    fireEvent.click(within(viewer).getByRole("button", { name: "Next image" }));
    expect(shown()).toHaveAttribute("alt", "first.png");
    // Tab stays inside.
    const buttons = within(viewer).getAllByRole("button");
    buttons[buttons.length - 1].focus();
    fireEvent.keyDown(viewer, { key: "Tab" });
    expect(buttons[0]).toHaveFocus();
    fireEvent.keyDown(viewer, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Image viewer" })).toBeNull(),
    );
    // Escape closed only the viewer, and focus went back.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});

describe("cards and history", () => {
  it("shows the first image as a card thumbnail from one query", async () => {
    vi.mocked(attachmentsApi.cardThumbnails).mockResolvedValue({
      [taskId]: {
        parent: taskId,
        id: "img1",
        name: "a.png",
        width: 800,
        height: 600,
      },
    });
    const { container } = render(<CrewWorkspace />);
    await screen.findByRole("heading", { name: "Crash on save" });
    await waitFor(() =>
      expect(
        container.querySelector(".crew-task-card .crew-card-thumb img"),
      ).toHaveAttribute(
        "src",
        "/api/crew/attachment?id=img1&thumb=320x0&token=tok",
      ),
    );
    expect(attachmentsApi.cardThumbnails).toHaveBeenCalledTimes(1);
    expect(crewApi.read).not.toHaveBeenCalledWith(
      "attachments",
      expect.anything(),
    );
  });
  it("describes file events in the activity", async () => {
    fixtures.events = [
      {
        id: "ev1",
        revision: 1,
        action: "attachment.add",
        actor: "upload_link:link1",
        reason: "via upload link link1",
        changes: {
          attachment: "a1",
          name: "phone.jpg",
          via_upload_link: "link1",
        },
      },
      {
        id: "ev2",
        revision: 1,
        action: "attachment.archive",
        actor: "owner",
        changes: JSON.stringify({ attachment: "a1", name: "phone.jpg" }),
      },
      {
        id: "ev3",
        revision: 1,
        action: "attachment.restore",
        actor: "mcp:client",
        reported_agent: "Build",
        changes: { attachment: "a1", name: "phone.jpg" },
      },
    ];
    const dialog = await openTask();
    fireEvent.click(dialog.getByRole("tab", { name: "Activity" }));
    expect(await dialog.findByText("Attached phone.jpg")).toBeInTheDocument();
    expect(dialog.getByText(/via upload link$/)).toBeInTheDocument();
    expect(dialog.getByText("Removed phone.jpg")).toBeInTheDocument();
    expect(dialog.getByText("Restored phone.jpg")).toBeInTheDocument();
    expect(dialog.getByText(/· Build$/)).toBeInTheDocument();
  });
});

describe("comments", () => {
  const openActivity = async () => {
    const dialog = await openTask();
    fireEvent.click(dialog.getByRole("tab", { name: "Activity" }));
    return dialog;
  };
  it("renders comment Markdown with inline images that open the viewer, and never runs HTML", async () => {
    attachments = [att("img1", { name: "bug.png" })];
    fixtures.events = [
      {
        id: "ev1",
        revision: 1,
        action: "task.comment",
        actor: "owner",
        body: "**Bold** step\n\n![the bug](attachment:img1)\n\n<script>window.__pwned = 1</script><img src=x onerror=\"window.__pwned = 2\">",
      },
      {
        id: "ev2",
        revision: 1,
        action: "task.update",
        actor: "owner",
        reason: "**not markdown**",
      },
    ];
    const dialog = await openActivity();
    expect(await dialog.findByText("Bold")).toContainHTML("<strong>Bold</strong>");
    expect(document.querySelector(".crew-timeline script")).toBeNull();
    expect(document.querySelector('.crew-timeline img[src="x"]')).toBeNull();
    expect((window as { __pwned?: number }).__pwned).toBeUndefined();
    // Other events keep their reason as plain text.
    expect(dialog.getByText("**not markdown**")).toBeInTheDocument();
    fireEvent.click(
      await dialog.findByRole("button", { name: "Open image: the bug" }),
    );
    const viewer = await screen.findByRole("dialog", { name: "Image viewer" });
    expect(within(viewer).getByRole("img")).toHaveAttribute(
      "src",
      "/api/crew/attachment?id=img1&token=tok",
    );
  });
  it("uploads a pasted screenshot into the comment and waits for it before posting", async () => {
    let finish: (v: {
      attachment: Attachment;
      review_withdrawn: boolean;
    }) => void = () => {};
    const upload = vi.spyOn(attachmentsApi, "upload").mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const dialog = await openActivity();
    const box = dialog.getByLabelText("Add a comment") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "See " } });
    box.setSelectionRange(4, 4);
    fireEvent.paste(box, {
      clipboardData: { files: [png()], types: ["Files"] },
    });
    const name = `${today()}-1.png`;
    await waitFor(() => expect(box.value).toMatch(/^See ⏳ Uploading /));
    expect(upload.mock.calls[0][0]).toEqual({ kind: "task", id: taskId });
    const post = dialog.getByRole("button", { name: "Waiting for uploads…" });
    expect(post).toBeDisabled();
    fireEvent.submit(box.closest("form")!);
    expect(crewApi.write).not.toHaveBeenCalled();
    finish({ attachment: att("shot1", { name }), review_withdrawn: false });
    await waitFor(() =>
      expect(box.value).toBe(`See ![${name}](attachment:shot1)`),
    );
    fireEvent.click(dialog.getByRole("button", { name: "Add comment" }));
    await waitFor(() =>
      expect(crewApi.write).toHaveBeenCalledWith(
        "task.comment",
        { body: `See ![${name}](attachment:shot1)` },
        expect.objectContaining({ id: taskId }),
      ),
    );
  });
  it("accepts dropped files and the Attach files button", async () => {
    let n = 0;
    vi.spyOn(attachmentsApi, "upload").mockImplementation(async (_p, file) => ({
      attachment: att(`up${++n}`, { name: file.name }),
      review_withdrawn: false,
    }));
    const dialog = await openActivity();
    const box = dialog.getByLabelText("Add a comment") as HTMLTextAreaElement;
    fireEvent.drop(box, {
      dataTransfer: { files: [png("drop.png")], types: ["Files"] },
    });
    await waitFor(() => expect(box.value).toBe("![drop.png](attachment:up1)"));
    const picker = dialog.getByLabelText("Attach files to the comment");
    const click = vi.spyOn(picker, "click");
    fireEvent.click(dialog.getByRole("button", { name: "Attach files" }));
    expect(click).toHaveBeenCalled();
    fireEvent.change(picker, { target: { files: [png("picked.png")] } });
    await waitFor(() => expect(box.value).toContain("(attachment:up2)"));
    expect(box.value).toContain("![picked.png]");
  });
});
