import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { pb } from "./api";
import {
  loginReturnHash,
  rememberLoginReturn,
  takeLoginReturn,
  uploadTokenFromHash,
} from "./itemLink";
import UploadPage, {
  goneMessage,
  UploadLinkError,
  uploadLinkApi,
  type UploadInfo,
} from "./UploadPage";

const token = "Ab3".repeat(14) + "Z"; // 43 letters and digits
const info: UploadInfo = {
  parent_kind: "task",
  title: "Crash on save",
  expires_at: new Date(Date.now() + 15 * 60000).toISOString(),
  max_files: 3,
  max_file_bytes: 1000,
  max_request_bytes: 2500,
};
const file = (name: string, size = 10, type = "image/png") =>
  new File([new Uint8Array(size)], name, { type });
const choose = (files: File[]) =>
  fireEvent.change(screen.getByLabelText("Choose photos or files"), {
    target: { files },
  });
const sendButton = () => screen.getByRole("button", { name: /^Send/ });
let revoked: string[];

beforeEach(() => {
  let n = 0;
  revoked = [];
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: () => `blob:local-${++n}`,
      revokeObjectURL: (url: string) => revoked.push(url),
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  localStorage.clear();
  sessionStorage.clear();
  pb.authStore.clear();
  history.replaceState(null, "", "/");
});

async function ready() {
  render(<UploadPage token={token} />);
  await screen.findByRole("heading", {
    name: /Add screenshots to: Crash on save/,
  });
}

describe("routing", () => {
  it("parses upload addresses and never remembers them for sign-in", () => {
    expect(uploadTokenFromHash(`#/upload/${token}`)).toBe(token);
    expect(uploadTokenFromHash("#/upload/short")).toBe("");
    expect(uploadTokenFromHash("#/upload")).toBe("");
    expect(uploadTokenFromHash("#/tasks")).toBeNull();
    expect(loginReturnHash(`#/upload/${token}`)).toBeNull();
    rememberLoginReturn(`#/upload/${token}`);
    expect(localStorage.length).toBe(0);
    expect(takeLoginReturn()).toBeNull();
  });
  it("renders before the sign-in gate, signed out, without any session", async () => {
    const infoSpy = vi.spyOn(uploadLinkApi, "info").mockResolvedValue(info);
    history.replaceState(null, "", `/#/upload/${token}`);
    render(<App />);
    await screen.findByRole("heading", { name: /Crash on save/ });
    expect(infoSpy).toHaveBeenCalledWith(token);
    expect(screen.queryByLabelText("Password")).toBeNull();
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(JSON.stringify({ ...localStorage })).not.toContain(token);
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(token);
  });
  it("shows the upload page even when this browser is signed in, and sends no session", async () => {
    pb.authStore.save("owner-session-token", null);
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(info), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    history.replaceState(null, "", `/#/upload/${token}`);
    render(<App />);
    await screen.findByRole("heading", { name: /Crash on save/ });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/crew/upload-link/info");
    expect(init.credentials).toBe("omit");
    expect(JSON.stringify(init.headers)).not.toContain("owner-session-token");
    expect(JSON.parse(init.body)).toEqual({ token });
  });
});

describe("upload page", () => {
  it("shows only the title, expiry and limits, and stages files with thumbnails", async () => {
    vi.spyOn(uploadLinkApi, "info").mockResolvedValue(info);
    await ready();
    expect(
      screen.getByText(/Up to 3 files, 1000 B each, 2\.4 KB in total/),
    ).toBeInTheDocument();
    expect(screen.getByText(/expires/)).toBeInTheDocument();
    expect(sendButton()).toBeDisabled();
    choose([file("a.png"), file("notes.txt", 5, "text/plain")]);
    const list = screen.getByRole("list", { name: "Files to send" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(list.querySelector("img")?.getAttribute("src")).toBe("blob:local-1");
    expect(sendButton()).toHaveTextContent("Send 2 files");
    fireEvent.click(screen.getByRole("button", { name: "Remove a.png" }));
    expect(revoked).toEqual(["blob:local-1"]);
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
  });
  it("checks count, file size and total before sending", async () => {
    vi.spyOn(uploadLinkApi, "info").mockResolvedValue(info);
    const send = vi.spyOn(uploadLinkApi, "send");
    await ready();
    choose([file("1.png"), file("2.png"), file("3.png"), file("4.png")]);
    expect(
      screen.getByText(/at most 3 files\. Remove 1 file/),
    ).toBeInTheDocument();
    expect(sendButton()).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Remove 4.png" }));
    expect(sendButton()).toBeEnabled();
    choose([]);
    fireEvent.click(screen.getByRole("button", { name: "Remove 3.png" }));
    choose([file("big.png", 1001)]);
    expect(screen.getByText(/Larger than 1000 B/)).toBeInTheDocument();
    expect(sendButton()).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Remove big.png" }));
    choose([file("empty.png", 0)]);
    expect(screen.getByText(/Empty file/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove empty.png" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove 2.png" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove 1.png" }));
    choose([file("x.bin", 900), file("y.bin", 900), file("z.bin", 900)]);
    expect(
      screen.getByText(/All files together must be at most 2\.4 KB/),
    ).toBeInTheDocument();
    expect(sendButton()).toBeDisabled();
    expect(send).not.toHaveBeenCalled();
  });
  it("names pasted screenshots and accepts dropped files", async () => {
    vi.spyOn(uploadLinkApi, "info").mockResolvedValue(info);
    await ready();
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.assign(paste, { clipboardData: { files: [file("image.png")] } });
    act(() => {
      document.dispatchEvent(paste);
    });
    expect(
      screen.getByText(/^screenshot-\d{4}-\d{2}-\d{2}-1\.png$/),
    ).toBeInTheDocument();
    fireEvent.drop(screen.getByRole("main"), {
      dataTransfer: { files: [file("dropped.pdf", 20, "application/pdf")] },
    });
    expect(screen.getByText("dropped.pdf")).toBeInTheDocument();
  });
  it("sends the whole batch in one request and then says done without another send", async () => {
    vi.spyOn(uploadLinkApi, "info").mockResolvedValue(info);
    const send = vi
      .spyOn(uploadLinkApi, "send")
      .mockImplementation(async (_t, files, progress) => {
        progress?.(5, 10);
        return {
          added: 1,
          results: [
            { index: 1, name: files[0].name, ok: true },
            {
              index: 2,
              name: files[1].name,
              ok: false,
              error: {
                code: "storage_limit",
                message: "Storage limit reached",
              },
            },
          ],
        };
      });
    await ready();
    choose([file("a.png"), file("b.png")]);
    fireEvent.click(sendButton());
    await screen.findByRole("heading", { name: "Partly done" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBe(token);
    expect(send.mock.calls[0][1].map((f) => f.name)).toEqual([
      "a.png",
      "b.png",
    ]);
    const results = screen.getByRole("list", { name: "Upload results" });
    expect(within(results).getByText("Saved")).toBeInTheDocument();
    expect(
      within(results).getByText("Storage limit reached"),
    ).toBeInTheDocument();
    expect(screen.getByText(/This link is now used/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Send/ })).toBeNull();
    expect(revoked).toContain("blob:local-1");
    expect(JSON.stringify({ ...localStorage })).not.toContain(token);
  });
  it("builds one multipart request with the token and every file, without credentials", async () => {
    const sent: {
      url: string;
      body: FormData;
      headers: Record<string, string>;
      withCredentials: boolean;
    }[] = [];
    class FakeXHR {
      upload: { onprogress?: (e: ProgressEvent) => void } = {};
      headers: Record<string, string> = {};
      url = "";
      status = 0;
      responseText = "";
      responseType = "";
      withCredentials = false;
      onload?: () => void;
      onerror?: () => void;
      onabort?: () => void;
      open(_m: string, url: string) {
        this.url = url;
      }
      setRequestHeader(k: string, v: string) {
        this.headers[k] = v;
      }
      getResponseHeader() {
        return null;
      }
      send(body: FormData) {
        sent.push({
          url: this.url,
          body,
          headers: this.headers,
          withCredentials: this.withCredentials,
        });
        queueMicrotask(() => {
          this.status = 200;
          this.responseText = JSON.stringify({ added: 2, results: [] });
          this.onload?.();
        });
      }
    }
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    pb.authStore.save("owner-session-token", null);
    const out = await uploadLinkApi.send(token, [file("a.png"), file("b.png")]);
    expect(out.added).toBe(2);
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe("/api/crew/upload-link/upload");
    expect(sent[0].body.get("token")).toBe(token);
    expect(sent[0].body.getAll("files")).toHaveLength(2);
    expect(sent[0].headers.Authorization).toBeUndefined();
    expect(sent[0].withCredentials).toBe(false);
  });
  it.each([404, 410])(
    "explains an unknown or used link (%i) on open",
    async (status) => {
      vi.spyOn(uploadLinkApi, "info").mockRejectedValue(
        new UploadLinkError("", status),
      );
      render(<UploadPage token={token} />);
      expect(await screen.findByRole("alert")).toHaveTextContent(goneMessage);
      expect(screen.queryByLabelText("Choose photos or files")).toBeNull();
    },
  );
  it("explains a malformed link without asking the server", async () => {
    const infoSpy = vi.spyOn(uploadLinkApi, "info");
    render(<UploadPage token="" />);
    expect(await screen.findByRole("alert")).toHaveTextContent(goneMessage);
    expect(infoSpy).not.toHaveBeenCalled();
  });
  it("explains a link used before the send (410) and drops the files", async () => {
    vi.spyOn(uploadLinkApi, "info").mockResolvedValue(info);
    vi.spyOn(uploadLinkApi, "send").mockRejectedValue(
      new UploadLinkError("This upload link was already used", 410),
    );
    await ready();
    choose([file("a.png")]);
    fireEvent.click(sendButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(goneMessage);
    expect(screen.queryByRole("button", { name: /^Send/ })).toBeNull();
  });
  it("asks to wait after a rate limit (429) and keeps the files", async () => {
    vi.spyOn(uploadLinkApi, "info").mockResolvedValue(info);
    const send = vi
      .spyOn(uploadLinkApi, "send")
      .mockRejectedValueOnce(new UploadLinkError("Too many", 429, 2))
      .mockResolvedValueOnce({
        added: 1,
        results: [{ index: 1, name: "a.png", ok: true }],
      });
    await ready();
    choose([file("a.png")]);
    fireEvent.click(sendButton());
    expect(
      await screen.findByText(/Try again in 2 seconds/),
    ).toBeInTheDocument();
    expect(screen.getByText("a.png")).toBeInTheDocument();
    expect(sendButton()).toBeDisabled();
    await waitFor(() => expect(sendButton()).toBeEnabled(), { timeout: 3500 });
    fireEvent.click(sendButton());
    await screen.findByRole("heading", { name: "Done" });
    expect(send).toHaveBeenCalledTimes(2);
  });
  it("keeps the staged files after a network error so a retry sends them", async () => {
    vi.spyOn(uploadLinkApi, "info").mockResolvedValue(info);
    const send = vi
      .spyOn(uploadLinkApi, "send")
      .mockRejectedValueOnce(new UploadLinkError("Network error"))
      .mockRejectedValueOnce(new UploadLinkError("used", 410));
    await ready();
    choose([file("a.png"), file("b.png")]);
    fireEvent.click(sendButton());
    expect(
      await screen.findByText(/Network error: the files may not have arrived/),
    ).toBeInTheDocument();
    expect(sendButton()).toHaveTextContent("Send 2 files");
    fireEvent.click(sendButton());
    // The first send may have finished before the connection dropped.
    expect(
      await screen.findByText(/earlier send finished/),
    ).toBeInTheDocument();
    expect(send.mock.calls[1][1]).toHaveLength(2);
  });
  it("marks refused files when no file was added and keeps the link usable", async () => {
    vi.spyOn(uploadLinkApi, "info").mockResolvedValue(info);
    vi.spyOn(uploadLinkApi, "send").mockRejectedValue(
      new UploadLinkError("No file was added", 400, 0, [
        {
          index: 1,
          name: "a.png",
          ok: false,
          error: { code: "storage_limit", message: "Storage limit reached" },
        },
      ]),
    );
    await ready();
    choose([file("a.png")]);
    fireEvent.click(sendButton());
    expect(await screen.findByText(/No file was added/)).toBeInTheDocument();
    expect(screen.getByText(/Storage limit reached/)).toBeInTheDocument();
    expect(sendButton()).toBeEnabled();
  });
});
