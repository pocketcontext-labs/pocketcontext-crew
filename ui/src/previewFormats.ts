/**
 * File previews: which preview an attachment gets, protected byte fetches,
 * strict UTF-8 decoding, CSV/TSV parsing and JSON pretty printing. Pure
 * helpers for AttachmentPreview (tested in previewFormats.test.ts).
 */
import {
  attachmentsApi,
  attachmentUrl,
  isAudio,
  isImage,
  isVideo,
  type Attachment,
} from "./attachmentsApi";

/** Text-like previews read at most this many bytes (2 MiB). */
export const TEXT_PREVIEW_LIMIT = 2 * 1024 * 1024;
/** PDFs up to the server's per-file limit (20 MiB). */
export const PDF_PREVIEW_LIMIT = 20 * 1024 * 1024;
/** CSV/TSV tables show at most this many data rows. */
export const TABLE_ROW_LIMIT = 500;

export type PreviewKind =
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "csv"
  | "tsv"
  | "json"
  | "markdown"
  | "text"
  | "none";

// Source and config files the server stores as octet-stream (or as an active
// type it never serves as such): shown as plain text, never run.
const codeExtensions = new Set(
  (
    "txt log text toml ini cfg conf env properties yaml yml jsonl ndjson xml html htm svg " +
    "js mjs cjs ts tsx jsx css scss less py rb go rs java kt kts swift c h cc cpp hpp cs " +
    "php pl sh bash zsh fish ps1 bat sql graphql proto gradle lua r m dart scala ex exs " +
    "erl hs clj vue svelte diff patch gitignore dockerfile makefile lock"
  ).split(" "),
);

const extensionOf = (name: string) => {
  const base = name.toLowerCase().split(/[\\/]/).pop() || "";
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot + 1) : base;
};

/** The preview an attachment gets, from its server type and its name. */
export function previewKind(
  a: Pick<Attachment, "image" | "media_type" | "name">,
): PreviewKind {
  if (isImage(a)) return "image";
  if (isVideo(a)) return "video";
  if (isAudio(a)) return "audio";
  const type = String(a.media_type || "").toLowerCase();
  const ext = extensionOf(a.name || "");
  if (type === "application/pdf") return "pdf";
  if (type === "text/tab-separated-values" || ext === "tsv") return "tsv";
  if (type === "text/csv" || ext === "csv") return "csv";
  if (type === "application/json" || ext === "json") return "json";
  if (type === "text/markdown" || ext === "md" || ext === "markdown")
    return "markdown";
  if (
    type === "text/plain" ||
    type === "application/yaml" ||
    type === "application/x-ndjson" ||
    codeExtensions.has(ext)
  )
    return "text";
  return "none";
}

export class PreviewFetchError extends Error {
  code: "too_large" | "http" | "network";
  constructor(code: PreviewFetchError["code"], message: string) {
    super(message);
    this.name = "PreviewFetchError";
    this.code = code;
  }
}

/**
 * The attachment's bytes, same-origin with a file token. An expired token
 * (401/403) is replaced once. More than `limit` bytes is `too_large`.
 */
export async function fetchAttachmentBytes(
  a: Pick<Attachment, "id">,
  limit: number,
  options: { token?: string; signal?: AbortSignal } = {},
): Promise<ArrayBuffer> {
  let token = options.token || (await attachmentsApi.fileToken());
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(attachmentUrl(a.id, { token }), {
        credentials: "same-origin",
        cache: "no-store",
        signal: options.signal,
      });
    } catch (error) {
      if ((error as Error)?.name === "AbortError") throw error;
      throw new PreviewFetchError("network", "The file could not be loaded.");
    }
    if ((response.status === 401 || response.status === 403) && attempt === 0) {
      token = await attachmentsApi.fileToken({ force: true });
      continue;
    }
    if (!response.ok)
      throw new PreviewFetchError(
        "http",
        `The file could not be loaded (HTTP ${response.status}).`,
      );
    const declared = Number(response.headers.get("Content-Length"));
    if (declared > limit)
      throw new PreviewFetchError("too_large", "Too large to preview.");
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > limit)
      throw new PreviewFetchError("too_large", "Too large to preview.");
    return bytes;
  }
}

/** Strict UTF-8 (a leading BOM is dropped); null when the bytes are not text. */
export function decodeUtf8Strict(
  bytes: ArrayBuffer | Uint8Array,
): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** Pretty JSON with two-space indent; null when the text is not JSON. */
export function prettyJson(text: string): string | null {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return null;
  }
}

export type Table = {
  /** Header row first, then at most `limit` data rows. */
  rows: string[][];
  /** All data rows in the file (header excluded). */
  total: number;
};

/**
 * RFC 4180 delimited text: quoted fields may hold the delimiter, line breaks
 * and doubled quotes; CRLF or LF rows; a trailing newline adds no row. Keeps
 * the header plus the first `limit` data rows and counts the rest.
 */
export function parseDelimited(
  text: string,
  delimiter = ",",
  limit = TABLE_ROW_LIMIT,
): Table {
  const rows: string[][] = [];
  let total = 0;
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let fieldStarted = false;
  const endRow = () => {
    row.push(field);
    if (rows.length === 0) rows.push(row);
    else {
      total++;
      if (total <= limit) rows.push(row);
    }
    row = [];
    field = "";
    fieldStarted = false;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && !fieldStarted && field === "") {
      quoted = true;
      fieldStarted = true;
    } else if (c === delimiter) {
      row.push(field);
      field = "";
      fieldStarted = false;
    } else if (c === "\r" || c === "\n") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      endRow();
    } else {
      field += c;
      fieldStarted = true;
    }
  }
  if (fieldStarted || field !== "" || row.length) endRow();
  return { rows, total };
}
