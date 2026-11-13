import { afterEach, describe, expect, it, vi } from "vitest";
import { attachmentsApi } from "./attachmentsApi";
import {
  decodeUtf8Strict,
  fetchAttachmentBytes,
  parseDelimited,
  prettyJson,
  previewKind,
  PreviewFetchError,
} from "./previewFormats";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const file = (name: string, media_type: string, image = false) => ({
  name,
  media_type,
  image,
});

describe("previewKind", () => {
  it("maps server types and names to previews", () => {
    expect(previewKind(file("a.png", "image/png", true))).toBe("image");
    expect(previewKind(file("a.webm", "video/webm"))).toBe("video");
    expect(previewKind(file("a.mp3", "audio/mpeg"))).toBe("audio");
    expect(previewKind(file("a.pdf", "application/pdf"))).toBe("pdf");
    expect(previewKind(file("a.csv", "text/csv"))).toBe("csv");
    expect(previewKind(file("a.tsv", "text/tab-separated-values"))).toBe("tsv");
    expect(previewKind(file("a.json", "application/json"))).toBe("json");
    expect(previewKind(file("a.md", "text/markdown"))).toBe("markdown");
    expect(previewKind(file("app.log", "text/plain"))).toBe("text");
    expect(previewKind(file("c.yaml", "application/yaml"))).toBe("text");
    // Code the server stores as opaque bytes is shown as text, never run.
    expect(previewKind(file("main.py", "application/octet-stream"))).toBe(
      "text",
    );
    // HTML and SVG run only in the sandboxed preview; by name alone, text.
    expect(previewKind(file("page.html", "text/html"))).toBe("html");
    expect(previewKind(file("logo.svg", "image/svg+xml"))).toBe("html");
    expect(previewKind(file("page.html", "application/octet-stream"))).toBe(
      "text",
    );
    expect(previewKind(file("a.zip", "application/zip"))).toBe("none");
    expect(previewKind(file("blob.bin", "application/octet-stream"))).toBe(
      "none",
    );
    // An image name that failed verification is not an image.
    expect(previewKind(file("fake.png", "application/octet-stream"))).toBe(
      "none",
    );
  });
});

describe("decodeUtf8Strict", () => {
  it("decodes UTF-8 and refuses other bytes", () => {
    expect(decodeUtf8Strict(new TextEncoder().encode("héllo ✓"))).toBe(
      "héllo ✓",
    );
    expect(decodeUtf8Strict(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toBe(
      "a",
    );
    expect(decodeUtf8Strict(new Uint8Array([0x61, 0xff, 0xfe]))).toBeNull();
    expect(decodeUtf8Strict(new Uint8Array([0xe9, 0x74, 0xe9]))).toBeNull(); // Latin-1
  });
});

describe("prettyJson", () => {
  it("pretty prints JSON and refuses other text", () => {
    expect(prettyJson('{"a":1,"b":[true,null]}')).toBe(
      '{\n  "a": 1,\n  "b": [\n    true,\n    null\n  ]\n}',
    );
    expect(prettyJson("{nope")).toBeNull();
  });
});

describe("parseDelimited", () => {
  it("follows RFC 4180 quoting", () => {
    const text =
      'name,note,n\r\n"Doe, Jane","said ""hi""\nthen left",1\r\nplain,,2\n';
    expect(parseDelimited(text)).toEqual({
      rows: [
        ["name", "note", "n"],
        ["Doe, Jane", 'said "hi"\nthen left', "1"],
        ["plain", "", "2"],
      ],
      total: 2,
    });
  });
  it("parses TSV and a last row without a newline", () => {
    expect(parseDelimited("a\tb\n1\t2", "\t")).toEqual({
      rows: [
        ["a", "b"],
        ["1", "2"],
      ],
      total: 1,
    });
  });
  it("keeps the header and the first rows, counting all", () => {
    const lines = ["h1,h2"];
    for (let i = 1; i <= 1200; i++) lines.push(`${i},x`);
    const table = parseDelimited(lines.join("\n") + "\n", ",", 500);
    expect(table.total).toBe(1200);
    expect(table.rows).toHaveLength(501);
    expect(table.rows[500]).toEqual(["500", "x"]);
  });
  it("handles empty text", () => {
    expect(parseDelimited("")).toEqual({ rows: [], total: 0 });
  });
});

describe("fetchAttachmentBytes", () => {
  it("fetches same-origin with the token and retries once on an expired one", async () => {
    vi.spyOn(attachmentsApi, "fileToken").mockResolvedValue("fresh");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 403 }))
      .mockResolvedValueOnce(new Response("abc"));
    vi.stubGlobal("fetch", fetchMock);
    const bytes = await fetchAttachmentBytes({ id: "att1" }, 10, {
      token: "old",
    });
    expect(new TextDecoder().decode(bytes)).toBe("abc");
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/crew/attachment?id=att1&token=old",
    );
    expect(fetchMock.mock.calls[1][0]).toBe(
      "/api/crew/attachment?id=att1&token=fresh",
    );
    expect(attachmentsApi.fileToken).toHaveBeenCalledWith({ force: true });
  });
  it("refuses more bytes than the limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("0123456789abc")),
    );
    await expect(
      fetchAttachmentBytes({ id: "att1" }, 10, { token: "t" }),
    ).rejects.toMatchObject({ code: "too_large" });
    await expect(
      fetchAttachmentBytes({ id: "att1" }, 10, { token: "t" }),
    ).rejects.toBeInstanceOf(PreviewFetchError);
  });
});
