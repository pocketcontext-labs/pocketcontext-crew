/**
 * Attachments: typed helpers for files on tasks and notes (server contract in
 * docs/crew.md#attachments).
 *
 * Exports, for the reader and later modules (previews, the upload-link page,
 * settings):
 *
 * - `Attachment`, `ParentRef`, `CardThumb`: record and reference types.
 * - `attachmentsApi`: one object, so tests can spy on any call.
 *   - `list(parent, {archived})` / `listAll(parent)`: metadata, `position` order.
 *   - `upload(parent, file, {onProgress, signal})`: one file per request, so
 *     progress and errors are per file. Resolves `{attachment,
 *     review_withdrawn}`; rejects with `AttachmentError` (`code`, `status`).
 *   - `createWithFiles(kind, fields, files, {onProgress})`: `task.create` /
 *     `note.create` with files in one atomic request; text may reference
 *     `attachment:new-N` (N is the 1-based file position). Rejects with
 *     `AttachmentError` whose `fileErrors` maps N to `{code, message}`.
 *   - `archive(a)` / `restore(a)`: revision-checked; result has `review_withdrawn`.
 *   - `createUploadLink(parent, {expiresInMinutes, maxFiles})`: owner only;
 *     the token is returned once (`token`, `path`, `url` with a domain).
 *   - `cardThumbnails()`: first active image of every task and note in one
 *     read-only SQL query (`/api/crew/query`), keyed by parent id.
 *   - `fileToken({force})`: short-lived file token, cached and refreshed.
 *   - `download(a)`: starts a download with a fresh token.
 *   - `sendMultipart(path, envelope, files, onProgress, signal)`: the transport.
 * - `attachmentUrl(id, {thumb, download, token})`: protected byte URL.
 * - `useFileToken(enabled)`: React hook with a token kept fresh while mounted.
 * - `isImage`, `isVideo`, `isAudio`, `mediaKind`, `formatBytes`,
 *   `screenshotName`, `uploadLinkAddress`, `parseChanges`, `ATTACHMENT_LIMITS`.
 * - `checkFiles(files, {existing, batchBytes})`: client-side limit check with
 *   a message per refused file, before anything is staged or sent.
 * - `uploadPlaceholder(name, token)` / `replaceUploadPlaceholder(text, token,
 *   replacement)`: the "⏳ Uploading …" text of an inline upload, found again
 *   by its unique token even after edits around it.
 */
import { useEffect, useState } from "react";
import { pb } from "./api";
import { crewApi, type Row } from "./crewApi";

export type ParentKind = "task" | "note";
export type ParentRef = { kind: ParentKind; id: string };
export type Attachment = Row & {
  parent_kind: ParentKind;
  parent: string;
  name: string;
  media_type: string;
  image: boolean;
  width?: number;
  height?: number;
  size: number;
  sha256?: string;
  position: number;
  actor?: string;
  reported_agent?: string;
  via_upload_link?: string;
  archived?: boolean;
  archived_at?: string;
  archived_by?: string;
};
export type FileError = { code: string; message: string };
export type UploadResult = {
  attachment: Attachment;
  review_withdrawn: boolean;
};
export type CardThumb = {
  parent: string;
  id: string;
  name: string;
  width: number;
  height: number;
};
export type UploadLink = Row & {
  token: string;
  path: string;
  url?: string;
  expires_at: string;
  max_files: number;
  state?: string;
};
export type Thumb = "1600x0" | "320x0";

/** Server limits (docs/crew.md#attachments); the server enforces them. */
export const ATTACHMENT_LIMITS = {
  maxFileBytes: 20 * 1024 * 1024,
  maxActive: 20,
  maxFilesPerRequest: 20,
  maxRequestBytes: 101 * 1024 * 1024,
  /** Files saved together (create with files), leaving multipart room. */
  maxBatchBytes: 100 * 1024 * 1024,
} as const;

export type FileRefusal = { file: File; message: string };
/**
 * Splits files into those within the server's limits and per-file refusals.
 * `existing` counts files the item already has (active, uploading or
 * staged); `batchBytes`, when given, the bytes already staged for one create
 * request (uploads to an existing item send one file per request).
 */
export function checkFiles(
  files: File[],
  { existing, batchBytes }: { existing: number; batchBytes?: number },
): { accepted: File[]; refused: FileRefusal[] } {
  const accepted: File[] = [];
  const refused: FileRefusal[] = [];
  let count = existing,
    bytes = batchBytes ?? 0;
  for (const file of files) {
    let message = "";
    if (file.size === 0) message = `${file.name} is empty.`;
    else if (file.size > ATTACHMENT_LIMITS.maxFileBytes)
      message = `${file.name} is larger than 20 MB (${formatBytes(file.size)}).`;
    else if (count >= ATTACHMENT_LIMITS.maxActive)
      message = `${file.name} was not added: a task or note holds at most 20 files.`;
    else if (
      batchBytes !== undefined &&
      bytes + file.size > ATTACHMENT_LIMITS.maxBatchBytes
    )
      message = `${file.name} was not added: files saved with a new item are limited to 100 MB in total. Add it after saving.`;
    if (message) {
      refused.push({ file, message });
      continue;
    }
    accepted.push(file);
    count++;
    bytes += file.size;
  }
  return { accepted, refused };
}

/** Inline upload text; the token finds it again after edits around it. */
export const uploadPlaceholder = (name: string, token: string) =>
  `⏳ Uploading ${name}… (upload ${token})`;
/**
 * Replaces the placeholder carrying `token` (from its ⏳ on the same line,
 * when still there, through the token). An empty replacement also removes one
 * adjacent line break. Text without the token (the user deleted it) is
 * returned unchanged.
 */
export function replaceUploadPlaceholder(
  text: string,
  token: string,
  replacement: string,
) {
  const marker = `(upload ${token})`;
  const at = text.indexOf(marker);
  if (at < 0) return text;
  const lineStart = text.lastIndexOf("\n", at) + 1;
  const glyph = text.lastIndexOf("⏳", at);
  let start = glyph >= lineStart ? glyph : at;
  let end = at + marker.length;
  if (!replacement) {
    if (text[end] === "\n") end++;
    else if (start > 0 && text[start - 1] === "\n") start--;
  }
  return text.slice(0, start) + replacement + text.slice(end);
}

/** Raised by uploads and create-with-files; `fileErrors` keys are 1-based. */
export class AttachmentError extends Error {
  status: number;
  code: string;
  fileErrors: Record<number, FileError>;
  constructor(
    message: string,
    status = 0,
    code = "",
    fileErrors: Record<number, FileError> = {},
  ) {
    super(message);
    this.name = "AttachmentError";
    this.status = status;
    this.code = code;
    this.fileErrors = fileErrors;
  }
}

const imageTypes = ["image/png", "image/jpeg", "image/gif", "image/webp"];
/** The server's verified-image flag; never guessed from the name. */
export const isImage = (a: Pick<Attachment, "image"> | undefined) =>
  a?.image === true;
export const isVideo = (a: Pick<Attachment, "media_type"> | undefined) =>
  /^video\//.test(String(a?.media_type || ""));
export const isAudio = (a: Pick<Attachment, "media_type"> | undefined) =>
  /^audio\//.test(String(a?.media_type || ""));
export function mediaKind(
  a: Pick<Attachment, "image" | "media_type"> | undefined,
): "image" | "video" | "audio" | "file" {
  return isImage(a)
    ? "image"
    : isVideo(a)
      ? "video"
      : isAudio(a)
        ? "audio"
        : "file";
}
/** Local files that the server will likely verify as images (staged previews). */
export const looksLikeImage = (file: Blob) => imageTypes.includes(file.type);

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024,
    unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

const pad = (n: number) => String(n).padStart(2, "0");
/** `screenshot-YYYY-MM-DD-N.ext`, N one past the highest such name in `taken`. */
export function screenshotName(
  taken: Iterable<string>,
  type = "image/png",
  now = new Date(),
) {
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const ext =
    type === "image/jpeg"
      ? "jpg"
      : (type.split("/")[1] || "png").replace(/[^a-z0-9]/g, "") || "png";
  const pattern = new RegExp(`^screenshot-${day}-(\\d+)\\.`);
  let n = 0;
  for (const name of taken) {
    const match = pattern.exec(name);
    if (match) n = Math.max(n, Number(match[1]));
  }
  return `screenshot-${day}-${n + 1}.${ext}`;
}

/** Event `changes` arrive as an object or JSON text. */
export function parseChanges(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string" && raw) {
    try {
      const value = JSON.parse(raw);
      if (value && typeof value === "object") return value;
    } catch {
      /* Not JSON. */
    }
  }
  return {};
}

/** Protected bytes; `token` is a file token (needed by img, video and audio). */
export function attachmentUrl(
  id: string,
  options: { thumb?: Thumb; download?: boolean; token?: string } = {},
) {
  const query = new URLSearchParams({ id });
  if (options.thumb) query.set("thumb", options.thumb);
  if (options.download) query.set("download", "1");
  if (options.token) query.set("token", options.token);
  return `/api/crew/attachment?${query}`;
}

/** The shareable address of a new upload link: its url, else origin + path. */
export function uploadLinkAddress(link: Pick<UploadLink, "url" | "path">) {
  if (link.url) return link.url;
  return `${location.origin}/${link.path.replace(/^\/+/, "")}`;
}

function fileErrorsFrom(data: unknown): Record<number, FileError> {
  const out: Record<number, FileError> = {};
  if (!data || typeof data !== "object") return out;
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    const match = /^files\.(\d+)$/.exec(key);
    if (!match || !value || typeof value !== "object") continue;
    const v = value as { code?: unknown; message?: unknown };
    out[Number(match[1])] = {
      code: String(v.code || ""),
      message: String(v.message || "This file was refused."),
    };
  }
  return out;
}

// One file token for the whole page; tokens live about three minutes.
const TOKEN_TTL_MS = 100_000;
let cachedToken = { value: "", at: 0, owner: "" };
let tokenRequest: Promise<string> | null = null;

export type Progress = (loaded: number, total: number) => void;

export const attachmentsApi = {
  async list(
    parent: string,
    options: { archived?: boolean } = {},
  ): Promise<Attachment[]> {
    return (await crewApi.read("attachments", {
      parent,
      ...(options.archived ? { archived: true } : {}),
    })) as Attachment[];
  },
  /** Active then archived, each in position order. */
  async listAll(parent: string): Promise<Attachment[]> {
    const [active, archived] = await Promise.all([
      attachmentsApi.list(parent),
      attachmentsApi.list(parent, { archived: true }),
    ]);
    return [...active, ...archived];
  },
  /**
   * Multipart POST with an `@jsonPayload` envelope and `files` parts, through
   * XMLHttpRequest for upload progress. Resolves the parsed JSON body.
   */
  sendMultipart(
    path: string,
    envelope: Record<string, unknown>,
    files: File[],
    onProgress?: Progress,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const token = pb.authStore.token;
    return new Promise((resolve, reject) => {
      const form = new FormData();
      form.append("@jsonPayload", JSON.stringify(envelope));
      for (const file of files) form.append("files", file, file.name);
      const xhr = new XMLHttpRequest();
      xhr.open("POST", path);
      xhr.responseType = "text";
      if (token) xhr.setRequestHeader("Authorization", token);
      xhr.setRequestHeader("Accept", "application/json");
      if (onProgress)
        xhr.upload.onprogress = (e) =>
          onProgress(e.loaded, e.lengthComputable ? e.total : 0);
      const abort = () => xhr.abort();
      signal?.addEventListener("abort", abort, { once: true });
      xhr.onerror = () =>
        reject(
          new AttachmentError("Network error: the upload did not finish."),
        );
      xhr.onabort = () =>
        reject(new AttachmentError("Upload cancelled.", 0, "aborted"));
      xhr.onload = () => {
        signal?.removeEventListener("abort", abort);
        let body: Record<string, unknown> = {};
        try {
          body = xhr.responseText ? JSON.parse(xhr.responseText) : {};
        } catch {
          /* Non-JSON error page. */
        }
        if (xhr.status >= 200 && xhr.status < 300) return resolve(body);
        // A dead session signs out like every other request.
        if (xhr.status === 401 && token && token === pb.authStore.token)
          pb.authStore.clear();
        const message =
          typeof body.message === "string" && body.message
            ? body.message
            : xhr.status === 413
              ? "The upload is too large."
              : `Upload failed (HTTP ${xhr.status}).`;
        reject(
          new AttachmentError(
            message,
            xhr.status,
            "",
            fileErrorsFrom(body.data),
          ),
        );
      };
      xhr.send(form);
    });
  },
  /** Uploads one file; its error is this file's error. */
  async upload(
    parent: ParentRef,
    file: File,
    options: { onProgress?: Progress; signal?: AbortSignal } = {},
  ): Promise<UploadResult> {
    let body: Record<string, unknown>;
    try {
      body = await attachmentsApi.sendMultipart(
        "/api/crew/write",
        { action: "attachment.add", data: { [parent.kind]: parent.id } },
        [file],
        options.onProgress,
        options.signal,
      );
    } catch (error) {
      if (error instanceof AttachmentError && error.fileErrors[1])
        throw new AttachmentError(
          error.fileErrors[1].message,
          error.status,
          error.fileErrors[1].code,
        );
      throw error;
    }
    const results = Array.isArray(body.results) ? body.results : [];
    const failed = results.find(
      (r: { ok?: boolean }) => r && r.ok === false,
    ) as { error?: FileError } | undefined;
    const attachment = (
      Array.isArray(body.attachments) ? body.attachments[0] : undefined
    ) as Attachment | undefined;
    if (!attachment)
      throw new AttachmentError(
        failed?.error?.message || "The file was not attached.",
        200,
        failed?.error?.code || "",
      );
    return { attachment, review_withdrawn: body.review_withdrawn === true };
  },
  /** Creates a task or note and its files in one atomic request. */
  async createWithFiles(
    kind: ParentKind,
    fields: Record<string, unknown>,
    files: File[],
    options: { onProgress?: Progress; reason?: string } = {},
  ): Promise<Row & { attachments?: Attachment[] }> {
    return (await attachmentsApi.sendMultipart(
      "/api/crew/write",
      { action: `${kind}.create`, data: fields, reason: options.reason || "" },
      files,
      options.onProgress,
    )) as Row & { attachments?: Attachment[] };
  },
  async archive(a: Attachment, reason = "") {
    return (await crewApi.write(
      "attachment.archive",
      {},
      a,
      reason,
    )) as Attachment & {
      review_withdrawn?: boolean;
    };
  },
  async restore(a: Attachment, reason = "") {
    return (await crewApi.write(
      "attachment.restore",
      {},
      a,
      reason,
    )) as Attachment & {
      review_withdrawn?: boolean;
    };
  },
  async createUploadLink(
    parent: ParentRef,
    options: { expiresInMinutes?: number; maxFiles?: number } = {},
  ): Promise<UploadLink> {
    return (await crewApi.write("upload_link.create", {
      [parent.kind]: parent.id,
      ...(options.expiresInMinutes
        ? { expires_in_minutes: options.expiresInMinutes }
        : {}),
      ...(options.maxFiles ? { max_files: options.maxFiles } : {}),
    })) as UploadLink;
  },
  /** The first active image (lowest position) of every task and note. */
  async cardThumbnails(): Promise<Record<string, CardThumb>> {
    const sql =
      "SELECT a.parent, a.id, a.name, a.width, a.height FROM attachments a " +
      "WHERE a.archived = 0 AND a.image = 1 AND NOT EXISTS (" +
      "SELECT 1 FROM attachments b WHERE b.parent = a.parent AND b.archived = 0 " +
      "AND b.image = 1 AND b.position < a.position)";
    const result = await pb.send<{ columns: string[]; rows: unknown[][] }>(
      "/api/crew/query",
      { method: "POST", body: { sql } },
    );
    const out: Record<string, CardThumb> = {};
    const col = (name: string) => result.columns.indexOf(name);
    for (const row of result.rows || []) {
      const thumb: CardThumb = {
        parent: String(row[col("parent")]),
        id: String(row[col("id")]),
        name: String(row[col("name")] ?? ""),
        width: Number(row[col("width")]) || 0,
        height: Number(row[col("height")]) || 0,
      };
      out[thumb.parent] = thumb;
    }
    return out;
  },
  /** A cached file token; `force` fetches a new one (after a load error). */
  async fileToken(options: { force?: boolean } = {}): Promise<string> {
    const owner = pb.authStore.token;
    if (
      !options.force &&
      cachedToken.value &&
      cachedToken.owner === owner &&
      Date.now() - cachedToken.at < TOKEN_TTL_MS
    )
      return cachedToken.value;
    if (tokenRequest && !options.force) return tokenRequest;
    const request = pb
      .send<{ token?: string }>("/api/files/token", { method: "POST" })
      .then((result) => {
        if (!result.token) throw new Error("File access is unavailable.");
        if (pb.authStore.token === owner)
          cachedToken = { value: result.token, at: Date.now(), owner };
        return result.token;
      })
      .finally(() => {
        if (tokenRequest === request) tokenRequest = null;
      });
    tokenRequest = request;
    return request;
  },
  /**
   * Downloads with a fresh file token (a link's token may have expired since
   * it rendered). The server answers with a download disposition.
   */
  async download(a: Pick<Attachment, "id" | "name">) {
    const token = await attachmentsApi.fileToken();
    const link = document.createElement("a");
    link.href = attachmentUrl(a.id, { download: true, token });
    link.download = a.name;
    link.rel = "noopener";
    document.body.append(link);
    link.click();
    link.remove();
  },
  /** Test hook: forget the cached token. */
  resetFileToken() {
    cachedToken = { value: "", at: 0, owner: "" };
    tokenRequest = null;
  },
};

/**
 * A file token kept fresh while mounted ("" until the first one arrives, and
 * when `enabled` is false). Elements already loaded keep working when it
 * rotates; elements should keep the token they started with and ask again
 * (`attachmentsApi.fileToken({force: true})`) on a load error.
 */
export function useFileToken(enabled = true) {
  const [token, setToken] = useState("");
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const get = () =>
      attachmentsApi.fileToken().then(
        (value) => alive && setToken(value),
        () => {
          /* Images show their reserved boxes; the next tick retries. */
        },
      );
    void get();
    const timer = setInterval(get, TOKEN_TTL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [enabled]);
  return enabled ? token : "";
}
