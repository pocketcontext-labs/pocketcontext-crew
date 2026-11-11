import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AttachmentPreview } from "./AttachmentPreview";
import { attachmentsApi, type Attachment } from "./attachmentsApi";

// pdf.js stand-in; `loaded` proves the library is imported only for PDFs.
const pdf = vi.hoisted(() => {
  const state = {
    loaded: false,
    fail: "" as "" | "password",
    renders: [] as number[],
    getDocument: null as unknown as ReturnType<typeof import("vitest").vi.fn>,
    GlobalWorkerOptions: { workerSrc: "" },
  };
  return state;
});
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", async () => {
  pdf.loaded = true;
  const { vi } = await import("vitest");
  pdf.getDocument = vi.fn(() => ({
    promise: pdf.fail
      ? Promise.reject(
          Object.assign(new Error("No password given"), {
            name: "PasswordException",
          }),
        )
      : Promise.resolve({
          numPages: 3,
          getPage: async (n: number) => ({
            getViewport: ({ scale }: { scale: number }) => ({
              width: 600 * scale,
              height: 800 * scale,
            }),
            render: () => {
              pdf.renders.push(n);
              return { promise: Promise.resolve(), cancel: () => undefined };
            },
          }),
        }),
    destroy: vi.fn(),
  }));
  return {
    GlobalWorkerOptions: pdf.GlobalWorkerOptions,
    getDocument: pdf.getDocument,
  };
});

const att = (name: string, media_type: string, size = 100): Attachment => ({
  id: "att000000000001",
  revision: 1,
  parent_kind: "task",
  parent: "task00000000001",
  name,
  media_type,
  image: false,
  size,
  position: 1,
});

let body: BodyInit = "";
const fetchMock = vi.fn(async () => new Response(body));

beforeEach(() => {
  vi.spyOn(attachmentsApi, "fileToken").mockResolvedValue("fresh-token");
  vi.spyOn(attachmentsApi, "download").mockResolvedValue(undefined);
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const open = (a: Attachment, onClose = vi.fn()) =>
  render(<AttachmentPreview attachment={a} token="tok" onClose={onClose} />);

describe("AttachmentPreview", () => {
  it("shows a log as monospace text with a wrap toggle, fetched with the token", async () => {
    body = "line 1\nline 2 ✓";
    open(att("app.log", "text/plain"));
    const pre = await screen.findByText(/line 1/);
    expect(pre.tagName).toBe("PRE");
    expect(pre.textContent).toBe("line 1\nline 2 ✓");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/crew/attachment?id=att000000000001&token=tok",
      expect.objectContaining({ credentials: "same-origin" }),
    );
    const wrap = screen.getByRole("button", { name: "Wrap lines" });
    expect(wrap).toHaveAttribute("aria-pressed", "true");
    expect(pre).toHaveClass("crew-text-wrap");
    fireEvent.click(wrap);
    expect(wrap).toHaveAttribute("aria-pressed", "false");
    expect(pre).not.toHaveClass("crew-text-wrap");
    // Header: name, size, type, Download and Close.
    expect(screen.getByRole("heading", { name: "app.log" })).toBeVisible();
    expect(screen.getByText("100 B · text/plain")).toBeVisible();
    fireEvent.click(screen.getByRole("link", { name: "Download" }));
    expect(attachmentsApi.download).toHaveBeenCalled();
    expect(pdf.loaded).toBe(false);
  });

  it("refuses bytes that are not strict UTF-8", async () => {
    body = new Uint8Array([0x68, 0x69, 0xff, 0xfe, 0x00]);
    open(att("dump.txt", "text/plain"));
    expect(await screen.findByText(/^Not valid text/)).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Download dump.txt" }),
    ).toBeVisible();
    expect(document.querySelector("pre")).toBeNull();
  });

  it("does not fetch a file over 2 MiB", async () => {
    open(att("huge.log", "text/plain", 2 * 1024 * 1024 + 1));
    expect(screen.getByText("Too large to preview.")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Download huge.log" }),
    ).toBeVisible();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a response larger than 2 MiB", async () => {
    body = new Uint8Array(2 * 1024 * 1024 + 10);
    open(att("small.log", "text/plain", 10));
    expect(await screen.findByText("Too large to preview.")).toBeVisible();
  });

  it("pretty prints JSON and falls back to the raw text", async () => {
    body = '{"status":"ok","items":[1,2]}';
    open(att("result.json", "application/json"));
    const pre = await screen.findByText(/"status": "ok"/);
    expect(pre.textContent).toBe(
      '{\n  "status": "ok",\n  "items": [\n    1,\n    2\n  ]\n}',
    );
    cleanup();
    body = "{not json";
    open(att("broken.json", "application/json"));
    expect(await screen.findByText("{not json")).toBeVisible();
    expect(screen.getByText(/Not valid JSON/)).toBeVisible();
  });

  it("shows CSV as a table with quoted fields and the first 500 rows", async () => {
    const lines = ["name,comment", '"Doe, Jane","said ""hi"""'];
    for (let i = 2; i <= 600; i++) lines.push(`row${i},c${i}`);
    body = lines.join("\r\n");
    open(att("people.csv", "text/csv", 9000));
    expect(
      await screen.findByText("Showing first 500 of 600 rows."),
    ).toBeVisible();
    const table = screen.getByRole("table");
    expect(table.querySelectorAll("thead th")).toHaveLength(2);
    expect(table.querySelectorAll("tbody tr")).toHaveLength(500);
    expect(screen.getByRole("cell", { name: "Doe, Jane" })).toBeVisible();
    expect(screen.getByRole("cell", { name: 'said "hi"' })).toBeVisible();
  });

  it("shows TSV by extension", async () => {
    body = "a\tb\n1\t2\n";
    open(att("data.tsv", "text/tab-separated-values"));
    expect(await screen.findByText("1 row.")).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "b" })).toBeVisible();
  });

  it("renders Markdown without loading its images; links open a new tab", async () => {
    body =
      "# Report\n\n![diagram](https://images.example/d.png)\n\n" +
      '<img src="https://images.example/raw.png" onerror="alert(1)">\n\n' +
      "[docs](https://docs.example/page) and [bad](javascript:alert(1))";
    open(att("report.md", "text/markdown"));
    expect(
      await screen.findByRole("heading", { name: "Report" }),
    ).toBeVisible();
    expect(document.querySelector(".crew-file-preview img")).toBeNull();
    expect(screen.getByText("[Image: diagram]")).toBeVisible();
    const link = screen.getByRole("link", { name: "docs" });
    expect(link).toHaveAttribute("href", "https://docs.example/page");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(screen.queryByRole("link", { name: "bad" })).toBeNull();
  });

  it("plays video from the protected URL, retries once, then offers a download", async () => {
    open(att("clip.webm", "video/webm"));
    const video = document.querySelector("video")!;
    expect(video).toHaveAttribute("controls");
    expect(video).toHaveAttribute("preload", "metadata");
    expect(video).toHaveAttribute("playsinline");
    expect(video.getAttribute("src")).toBe(
      "/api/crew/attachment?id=att000000000001&token=tok",
    );
    fireEvent.error(video);
    await waitFor(() =>
      expect(document.querySelector("video")!.getAttribute("src")).toContain(
        "token=fresh-token",
      ),
    );
    expect(attachmentsApi.fileToken).toHaveBeenCalledWith({ force: true });
    fireEvent.error(document.querySelector("video")!);
    expect(
      await screen.findByText("Can't play this format here."),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Download clip.webm" }),
    ).toBeVisible();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("plays audio", () => {
    open(att("memo.mp3", "audio/mpeg"));
    const audio = document.querySelector("audio")!;
    expect(audio).toHaveAttribute("controls");
    expect(audio).toHaveAttribute("preload", "metadata");
  });

  it("offers a download for other files", () => {
    open(att("archive.zip", "application/zip", 4096));
    expect(screen.getByText("No preview for this type of file.")).toBeVisible();
    expect(screen.getByText("4.0 KB · application/zip")).toBeVisible();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("closes on Escape and returns focus", async () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const onClose = vi.fn();
    const view = open(att("archive.zip", "application/zip"), onClose);
    const close = screen.getByRole("button", { name: "Close file preview" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    view.unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it("loads pdf.js lazily, with no eval and a same-origin worker, and pages through", async () => {
    body = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
    pdf.fail = "";
    pdf.renders = [];
    open(att("spec.pdf", "application/pdf"));
    expect(await screen.findByText("Page 1 of 3")).toBeVisible();
    expect(pdf.loaded).toBe(true);
    const options = pdf.getDocument.mock.calls[0][0] as Record<string, unknown>;
    expect(options).toMatchObject({
      isEvalSupported: false,
      enableXfa: false,
      useWasm: false,
      useWorkerFetch: false,
    });
    expect(options.data).toBeInstanceOf(Uint8Array);
    // No font, CMap, ICC or wasm addresses: nothing is fetched.
    for (const key of [
      "url",
      "cMapUrl",
      "standardFontDataUrl",
      "wasmUrl",
      "iccUrl",
    ])
      expect(options[key]).toBeUndefined();
    // No scripting option is ever enabled.
    expect(options.enableScripting).toBeUndefined();
    const worker = pdf.GlobalWorkerOptions.workerSrc;
    expect(worker).toMatch(/^\/[^/]/);
    expect(worker).toContain("pdf.worker");
    await waitFor(() => expect(pdf.renders).toContain(1));
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(await screen.findByText("Page 2 of 3")).toBeVisible();
    await waitFor(() => expect(pdf.renders).toContain(2));
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByRole("button", { name: "Fit width" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(document.querySelector("iframe, object, embed")).toBeNull();
  });

  it("explains a password-protected PDF", async () => {
    body = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    pdf.fail = "password";
    open(att("locked.pdf", "application/pdf"));
    expect(
      await screen.findByText(/This PDF is password protected/),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Download locked.pdf" }),
    ).toBeVisible();
    pdf.fail = "";
    await act(async () => undefined);
  });
});
