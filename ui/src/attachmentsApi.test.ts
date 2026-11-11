import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pb } from "./api";
import { crewApi } from "./crewApi";
import {
  AttachmentError,
  attachmentsApi,
  attachmentUrl,
  formatBytes,
  mediaKind,
  parseChanges,
  screenshotName,
  uploadLinkAddress,
} from "./attachmentsApi";

type Sent = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: FormData;
};
let sent: Sent[] = [];
let respond: (xhr: FakeXHR) => void = () => {};
class FakeXHR {
  status = 0;
  responseText = "";
  responseType = "";
  method = "";
  url = "";
  headers: Record<string, string> = {};
  upload: { onprogress: ((e: ProgressEvent) => void) | null } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  abort() {
    this.onabort?.();
  }
  send(body: FormData) {
    sent.push({
      method: this.method,
      url: this.url,
      headers: this.headers,
      body,
    });
    queueMicrotask(() => respond(this));
  }
  reply(status: number, body: unknown) {
    this.upload.onprogress?.({
      loaded: 5,
      total: 10,
      lengthComputable: true,
    } as ProgressEvent);
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.onload?.();
  }
}
const png = () =>
  new File([new Uint8Array([137, 80, 78, 71])], "shot.png", {
    type: "image/png",
  });
const record = (id: string) => ({
  id,
  revision: 1,
  parent_kind: "task",
  parent: "task00000000001",
  name: "shot.png",
  media_type: "image/png",
  image: true,
  size: 4,
  position: 1,
});

beforeEach(() => {
  sent = [];
  vi.stubGlobal("XMLHttpRequest", FakeXHR);
  attachmentsApi.resetFileToken();
  pb.authStore.save("owner-token", null);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  pb.authStore.clear();
});

describe("URLs and names", () => {
  it("builds protected byte URLs", () => {
    expect(attachmentUrl("abc")).toBe("/api/crew/attachment?id=abc");
    expect(attachmentUrl("abc", { thumb: "320x0", token: "t k" })).toBe(
      "/api/crew/attachment?id=abc&thumb=320x0&token=t+k",
    );
    expect(attachmentUrl("abc", { download: true })).toBe(
      "/api/crew/attachment?id=abc&download=1",
    );
  });
  it("names screenshots after the highest taken number of the day", () => {
    const day = new Date(2026, 10, 11);
    expect(screenshotName([], "image/png", day)).toBe(
      "screenshot-2026-11-11-1.png",
    );
    expect(
      screenshotName(
        [
          "screenshot-2026-11-11-1.png",
          "screenshot-2026-11-11-4.jpg",
          "screenshot-2026-11-10-9.png",
        ],
        "image/jpeg",
        day,
      ),
    ).toBe("screenshot-2026-11-11-5.jpg");
  });
  it("formats sizes, kinds, changes and upload-link addresses", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(20 * 1024 * 1024)).toBe("20 MB");
    expect(mediaKind({ image: true, media_type: "image/png" })).toBe("image");
    expect(mediaKind({ image: false, media_type: "video/mp4" })).toBe("video");
    expect(mediaKind({ image: false, media_type: "audio/mpeg" })).toBe("audio");
    expect(mediaKind({ image: false, media_type: "image/svg+xml" })).toBe(
      "file",
    );
    expect(parseChanges('{"name":"a.png"}')).toEqual({ name: "a.png" });
    expect(parseChanges("nope")).toEqual({});
    expect(
      uploadLinkAddress({
        url: "https://crew.example/#/upload/x",
        path: "#/upload/x",
      }),
    ).toBe("https://crew.example/#/upload/x");
    expect(uploadLinkAddress({ path: "#/upload/x" })).toBe(
      `${location.origin}/#/upload/x`,
    );
  });
});

describe("reads", () => {
  it("lists active and archived attachments of one parent", async () => {
    const read = vi
      .spyOn(crewApi, "read")
      .mockImplementation(async (_c, f = {}) => [
        record(f.archived ? "old" : "new"),
      ]);
    const all = await attachmentsApi.listAll("task00000000001");
    expect(all.map((a) => a.id)).toEqual(["new", "old"]);
    expect(read).toHaveBeenCalledWith("attachments", {
      parent: "task00000000001",
    });
    expect(read).toHaveBeenCalledWith("attachments", {
      parent: "task00000000001",
      archived: true,
    });
  });
  it("loads card thumbnails with one query", async () => {
    const send = vi.spyOn(pb, "send").mockResolvedValue({
      columns: ["parent", "id", "name", "width", "height"],
      rows: [["task1", "att1", "a.png", 800, 600]],
    });
    expect(await attachmentsApi.cardThumbnails()).toEqual({
      task1: {
        parent: "task1",
        id: "att1",
        name: "a.png",
        width: 800,
        height: 600,
      },
    });
    expect(send).toHaveBeenCalledTimes(1);
    const [path, options] = send.mock.calls[0];
    expect(path).toBe("/api/crew/query");
    expect(String((options?.body as { sql: string }).sql)).toMatch(
      /FROM attachments a/,
    );
  });
  it("caches the file token and refreshes it on request", async () => {
    const send = vi
      .spyOn(pb, "send")
      .mockResolvedValueOnce({ token: "first" })
      .mockResolvedValueOnce({ token: "second" });
    expect(await attachmentsApi.fileToken()).toBe("first");
    expect(await attachmentsApi.fileToken()).toBe("first");
    expect(send).toHaveBeenCalledTimes(1);
    expect(await attachmentsApi.fileToken({ force: true })).toBe("second");
    expect(send).toHaveBeenCalledWith("/api/files/token", { method: "POST" });
  });
});

describe("writes", () => {
  it("uploads one file per request with progress", async () => {
    respond = (xhr) =>
      xhr.reply(200, {
        attachments: [record("att1")],
        results: [{ index: 1, name: "shot.png", ok: true, id: "att1" }],
        review_withdrawn: true,
      });
    const progress = vi.fn();
    const result = await attachmentsApi.upload(
      { kind: "task", id: "task00000000001" },
      png(),
      { onProgress: progress },
    );
    expect(result.attachment.id).toBe("att1");
    expect(result.review_withdrawn).toBe(true);
    expect(progress).toHaveBeenCalledWith(5, 10);
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe("/api/crew/write");
    expect(sent[0].headers.Authorization).toBe("owner-token");
    expect(JSON.parse(String(sent[0].body.get("@jsonPayload")))).toEqual({
      action: "attachment.add",
      data: { task: "task00000000001" },
    });
    expect((sent[0].body.getAll("files")[0] as File).name).toBe("shot.png");
  });
  it("reports a refused file with its code", async () => {
    respond = (xhr) =>
      xhr.reply(400, {
        message: "No file was attached",
        data: {
          "files.1": {
            code: "file_too_large",
            message: "shot.png is larger than 20 MiB",
          },
        },
      });
    const error = await attachmentsApi
      .upload({ kind: "note", id: "note1" }, png())
      .catch((e) => e);
    expect(error).toBeInstanceOf(AttachmentError);
    expect(error.message).toBe("shot.png is larger than 20 MiB");
    expect(error.code).toBe("file_too_large");
    expect(error.status).toBe(400);
  });
  it("creates an item with files and maps per-file errors", async () => {
    respond = (xhr) =>
      xhr.reply(400, {
        message: "No task was created: a file was refused",
        data: { "files.2": { code: "empty_file", message: "b.png is empty" } },
      });
    const error = await attachmentsApi
      .createWithFiles(
        "task",
        { title: "T", description: "![a](attachment:new-1)" },
        [png(), png()],
      )
      .catch((e) => e);
    expect(error.message).toBe("No task was created: a file was refused");
    expect(error.fileErrors).toEqual({
      2: { code: "empty_file", message: "b.png is empty" },
    });
    const envelope = JSON.parse(String(sent[0].body.get("@jsonPayload")));
    expect(envelope.action).toBe("task.create");
    expect(envelope.data.description).toBe("![a](attachment:new-1)");
    expect(sent[0].body.getAll("files")).toHaveLength(2);
  });
  it("archives, restores and creates upload links through the reader route", async () => {
    const write = vi
      .spyOn(crewApi, "write")
      .mockResolvedValue({ id: "x", revision: 2 });
    const a = { ...record("att1"), revision: 3 } as Parameters<
      typeof attachmentsApi.archive
    >[0];
    await attachmentsApi.archive(a);
    await attachmentsApi.restore(a);
    await attachmentsApi.createUploadLink(
      { kind: "note", id: "note1" },
      { expiresInMinutes: 30 },
    );
    expect(write).toHaveBeenNthCalledWith(1, "attachment.archive", {}, a, "");
    expect(write).toHaveBeenNthCalledWith(2, "attachment.restore", {}, a, "");
    expect(write).toHaveBeenNthCalledWith(3, "upload_link.create", {
      note: "note1",
      expires_in_minutes: 30,
    });
  });
});
