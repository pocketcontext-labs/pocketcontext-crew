import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type CSSProperties,
  type DragEvent,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import { defaultUrlTransform } from "react-markdown";
import { AttachmentPreview } from "./AttachmentPreview";
import {
  attachmentsApi,
  attachmentUrl,
  AttachmentError,
  checkFiles,
  formatBytes,
  isAudio,
  isImage,
  isVideo,
  looksLikeImage,
  parseChanges,
  screenshotName,
  uploadLinkAddress,
  useFileToken,
  type Attachment,
  type CardThumb,
  type ParentRef,
  type Thumb,
  type UploadLink,
} from "./attachmentsApi";
import Lightbox, { type LightboxItem } from "./Lightbox";
import type { Row } from "./crewApi";
import { viewHashes } from "./itemLink";
import "./upload.css";

/** Shown after a file change (or a draft edit) withdrew a pending approval. */
export const withdrawnNotice =
  "The pending approval was withdrawn because the task changed. Send the draft for approval again when it's ready.";

const message = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

/** A file the open item can show: a saved attachment or a staged local file. */
export type ItemFile = {
  /** Attachment id, or `new-K` for a staged file. */
  id: string;
  name: string;
  image: boolean;
  media_type: string;
  size: number;
  width?: number;
  height?: number;
  archived?: boolean;
  /** Staged files: a local blob: URL. */
  blob?: string;
  attachment?: Attachment;
};
type AttachmentsContextValue = {
  files: ItemFile[];
  token: string;
  open: (id: string) => void;
};
const AttachmentsContext = createContext<AttachmentsContextValue | null>(null);

const fromAttachment = (a: Attachment): ItemFile => ({
  id: a.id,
  name: a.name,
  image: isImage(a),
  media_type: a.media_type,
  size: a.size,
  width: Number(a.width) || undefined,
  height: Number(a.height) || undefined,
  archived: a.archived === true,
  attachment: a,
});

/** Markdown text for a file reference; `[`, `]` and `\` in names are escaped. */
export function fileReference(name: string, target: string, image: boolean) {
  const alt = name.replace(/[\\[\]]/g, (c) => `\\${c}`).replace(/\s+/g, " ");
  return `${image ? "!" : ""}[${alt}](attachment:${target})`;
}

/**
 * The reserved box of an image: its aspect ratio, at most its own width, and
 * `--crew-ar` so CSS can cap inline images' height (crew.css) at the same
 * ratio, before and after loading.
 */
const imageBox = (width: number, height: number) =>
  ({
    aspectRatio: `${width} / ${height}`,
    maxWidth: `${width}px`,
    "--crew-ar": String(width / height),
  }) as CSSProperties;

/** Image with a protected URL; keeps its box before loading and retries once. */
export function ProtectedImage({
  id,
  thumb,
  alt,
  width,
  height,
  token,
  className = "",
  lazy = true,
}: {
  id: string;
  thumb?: Thumb;
  alt: string;
  width?: number;
  height?: number;
  token: string;
  className?: string;
  lazy?: boolean;
}) {
  const [src, setSrc] = useState("");
  const [failed, setFailed] = useState(false);
  const retried = useRef(false);
  useEffect(() => {
    if (!src && token) setSrc(attachmentUrl(id, { thumb, token }));
  }, [src, token, id, thumb]);
  const box = width && height ? imageBox(width, height) : undefined;
  if (failed)
    return <span className="crew-image-missing">Image unavailable: {alt}</span>;
  return (
    <span className={`crew-image-box ${className}`} style={box}>
      {src ? (
        <img
          src={src}
          alt={alt}
          width={width || undefined}
          height={height || undefined}
          loading={lazy ? "lazy" : undefined}
          decoding="async"
          onError={() => {
            if (retried.current) return setFailed(true);
            retried.current = true;
            attachmentsApi.fileToken({ force: true }).then(
              (fresh) => setSrc(attachmentUrl(id, { thumb, token: fresh })),
              () => setFailed(true),
            );
          }}
        />
      ) : (
        <span className="crew-image-pending" role="img" aria-label={alt} />
      )}
    </span>
  );
}

/** Video or audio from a protected URL; a failed load retries with a fresh token. */
function ProtectedMedia({
  file,
  token,
  title,
}: {
  file: ItemFile;
  token: string;
  title: string;
}) {
  const [src, setSrc] = useState("");
  const retried = useRef(false);
  useEffect(() => {
    if (!src && token) setSrc(attachmentUrl(file.id, { token }));
  }, [src, token, file.id]);
  const onError = (e: SyntheticEvent<HTMLMediaElement>) => {
    if (retried.current) return;
    retried.current = true;
    const at = e.currentTarget.currentTime;
    const el = e.currentTarget;
    void attachmentsApi.fileToken({ force: true }).then((fresh) => {
      setSrc(attachmentUrl(file.id, { token: fresh }));
      requestAnimationFrame(() => {
        if (at) el.currentTime = at;
      });
    });
  };
  const fallback = <>Your browser can't play {file.name}.</>;
  if (!src) return <span className="crew-media-pending">Loading {title}…</span>;
  return isVideo(file) ? (
    <video
      className="crew-inline-video"
      controls
      preload="metadata"
      src={src}
      aria-label={title}
      onError={onError}
    >
      {fallback}
    </video>
  ) : (
    <audio
      className="crew-inline-audio"
      controls
      preload="metadata"
      src={src}
      aria-label={title}
      onError={onError}
    >
      {fallback}
    </audio>
  );
}

/**
 * An attachment destination after Markdown decoding (escapes and character
 * references): exactly the lower-case `attachment:` scheme and an ID. The
 * server validates every case and encoding of the scheme as a reference;
 * anything else here shows as unavailable.
 */
const ATTACHMENT_REF = /^attachment:([a-z0-9-]+)$/;
export const attachmentRefId = (url: string) =>
  ATTACHMENT_REF.exec(url)?.[1] ?? null;

/** react-markdown URL policy: `attachment:` only as an image or link target. */
export function proseUrlTransform(url: string, key: string) {
  if (attachmentRefId(url) && (key === "src" || key === "href")) return url;
  return defaultUrlTransform(url);
}
const domainOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
};

/** Markdown image: same-item attachments render; nothing external loads. */
export function ProseImage({ src, alt }: { src?: unknown; alt?: string }) {
  const ctx = useContext(AttachmentsContext);
  const url = typeof src === "string" ? src : "";
  const label = alt?.trim() || "";
  const id = attachmentRefId(url);
  if (id) {
    if (!ctx) return <span>[Image: {label || "attachment"}]</span>;
    const file = ctx.files.find((f) => f.id === id);
    const name = label || file?.name || "attachment";
    if (!file)
      return (
        <span className="crew-image-missing">Image unavailable: {name}</span>
      );
    if (file.archived)
      return <span className="crew-image-missing">Image removed: {name}</span>;
    if (file.image) {
      const image = file.blob ? (
        <span
          className="crew-image-box"
          style={
            file.width && file.height
              ? { ...imageBox(file.width, file.height), maxWidth: undefined }
              : undefined
          }
        >
          <img src={file.blob} alt={name} />
        </span>
      ) : (
        <ProtectedImage
          id={file.id}
          thumb="1600x0"
          alt={name}
          width={file.width}
          height={file.height}
          token={ctx.token}
        />
      );
      return (
        <button
          type="button"
          className="crew-inline-image"
          aria-label={`Open image: ${name}`}
          onClick={() => ctx.open(file.id)}
        >
          {image}
        </button>
      );
    }
    if (!file.blob && (isVideo(file) || isAudio(file)))
      return <ProtectedMedia file={file} token={ctx.token} title={name} />;
    return (
      <button
        type="button"
        className="crew-inline-file"
        onClick={() => ctx.open(file.id)}
      >
        {name}
      </button>
    );
  }
  if (/^https?:\/\//i.test(url)) {
    const domain = domainOf(url);
    return (
      <span className="crew-image-external">
        {label || "Image"} (
        <a href={url} target="_blank" rel="noopener noreferrer nofollow">
          image on {domain || "another site"}
        </a>
        )
      </span>
    );
  }
  return (
    <span className="crew-image-missing">
      Image unavailable: {label || "image"}
    </span>
  );
}

/** Markdown link: `[label](attachment:ID)` opens the file; others open a tab. */
export function ProseLink({
  href,
  children,
}: {
  href?: string;
  children?: ReactNode;
}) {
  const ctx = useContext(AttachmentsContext);
  const id = attachmentRefId(href || "");
  if (id) {
    const file = ctx?.files.find((f) => f.id === id);
    if (!file || file.archived)
      return (
        <span className="crew-image-missing">
          {children} ({file ? "file removed" : "file unavailable"})
        </span>
      );
    return (
      <button
        type="button"
        className="crew-inline-file"
        onClick={() => ctx?.open(file.id)}
      >
        {children}
      </button>
    );
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

type Upload = {
  key: number;
  file: File;
  loaded: number;
  total: number;
  error?: string;
  /** Refused before sending (a limit): no retry. */
  refused?: boolean;
};

/**
 * Attachments of one existing task or note (`parent`), uploads in order (one
 * request per file), archive and restore. `onChanged` runs after every saved
 * change; `onWithdrawn` when it withdrew a pending approval.
 */
export function useItemAttachments({
  parent,
  onChanged,
  onWithdrawn,
}: {
  parent?: ParentRef;
  onChanged?: () => void;
  onWithdrawn?: () => void;
}) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [withdrawn, setWithdrawn] = useState(false);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const nextKey = useRef(1);
  const alive = useRef(true);
  const callbacks = useRef({ onChanged, onWithdrawn });
  callbacks.current = { onChanged, onWithdrawn };
  const id = parent?.id,
    kind = parent?.kind;
  const reload = useCallback(async () => {
    if (!id) return;
    try {
      const all = await attachmentsApi.listAll(id);
      if (alive.current) {
        setAttachments(all);
        setLoaded(true);
      }
    } catch (e) {
      if (alive.current) setError(message(e, "Could not load files."));
    }
  }, [id]);
  useEffect(() => {
    alive.current = true;
    void reload();
    return () => {
      alive.current = false;
    };
  }, [reload]);
  const merge = (a: Attachment) =>
    setAttachments((list) =>
      list.some((x) => x.id === a.id)
        ? list.map((x) => (x.id === a.id ? a : x))
        : [...list, a],
    );
  const changed = (withdrew: boolean) => {
    if (withdrew) {
      setWithdrawn(true);
      callbacks.current.onWithdrawn?.();
    }
    callbacks.current.onChanged?.();
  };
  /** Queues one upload; positions follow the order files were added. */
  const enqueue = (
    file: File,
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<Attachment> => {
    if (!id || !kind) return Promise.reject(new Error("Save first."));
    const run = queue.current.then(async () => {
      const result = await attachmentsApi.upload({ kind, id }, file, {
        onProgress,
      });
      if (alive.current) merge(result.attachment);
      changed(result.review_withdrawn);
      return result.attachment;
    });
    queue.current = run.catch(() => undefined);
    return run;
  };
  const start = (upload: Upload) => {
    enqueue(upload.file, (loadedBytes, total) =>
      setUploads((list) =>
        list.map((u) =>
          u.key === upload.key ? { ...u, loaded: loadedBytes, total } : u,
        ),
      ),
    ).then(
      () => setUploads((list) => list.filter((u) => u.key !== upload.key)),
      (e) =>
        setUploads((list) =>
          list.map((u) =>
            u.key === upload.key
              ? { ...u, error: message(e, "The file was not attached.") }
              : u,
          ),
        ),
    );
  };
  /** Active files plus uploads still running: the item's 20-file budget. */
  const used = () =>
    attachments.filter((a) => !a.archived).length +
    uploads.filter((u) => !u.error).length;
  /**
   * Adds files with a progress row each; files over a limit get a row with
   * the reason and are not sent.
   */
  const addFiles = (incoming: File[]) => {
    setError("");
    const { accepted: files, refused } = checkFiles(incoming, {
      existing: used(),
    });
    if (refused.length)
      setUploads((list) => [
        ...list,
        ...refused.map((r) => ({
          key: nextKey.current++,
          file: r.file,
          loaded: 0,
          total: r.file.size,
          error: r.message,
          refused: true,
        })),
      ]);
    for (const file of files) {
      const upload = {
        key: nextKey.current++,
        file,
        loaded: 0,
        total: file.size,
      };
      setUploads((list) => [...list, upload]);
      start(upload);
    }
  };
  const retry = (key: number) => {
    const upload = uploads.find((u) => u.key === key);
    if (!upload) return;
    const fresh = { ...upload, loaded: 0, error: undefined };
    setUploads((list) => list.map((u) => (u.key === key ? fresh : u)));
    start(fresh);
  };
  const dismiss = (key: number) =>
    setUploads((list) => list.filter((u) => u.key !== key));
  const toggle = async (a: Attachment, archive: boolean) => {
    setError("");
    try {
      const result = archive
        ? await attachmentsApi.archive(a)
        : await attachmentsApi.restore(a);
      const { review_withdrawn, ...record } = result;
      merge(record as Attachment);
      changed(review_withdrawn === true);
      return true;
    } catch (e) {
      setError(
        message(
          e,
          archive
            ? "Could not remove the file."
            : "Could not restore the file.",
        ),
      );
      void reload();
      return false;
    }
  };
  return {
    attachments,
    loaded,
    error,
    uploads,
    withdrawn,
    reload,
    used,
    addFiles,
    /** Uploads without a progress row (inline inserts show their own text). */
    upload: enqueue,
    retry,
    dismiss,
    archive: (a: Attachment) => toggle(a, true),
    restore: (a: Attachment) => toggle(a, false),
  };
}
export type ItemAttachments = ReturnType<typeof useItemAttachments>;

export type StagedFile = {
  key: number;
  file: File;
  url: string;
  image: boolean;
  width?: number;
  height?: number;
};
/** Files waiting for a New task or New note; previews use blob: URLs. */
export function useStagedFiles() {
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const nextKey = useRef(1);
  const urls = useRef(new Set<string>());
  useEffect(
    () => () => {
      for (const url of urls.current) URL.revokeObjectURL?.(url);
    },
    [],
  );
  const [refused, setRefused] = useState<string[]>([]);
  /**
   * Stages files within the limits (20 files, 20 MB each, 100 MB together);
   * the others are reported in `refused` and returned with their reasons.
   */
  const stage = (incoming: File[]) => {
    const checked = checkFiles(incoming, {
      existing: staged.length,
      batchBytes: staged.reduce((sum, s) => sum + s.file.size, 0),
    });
    setRefused(checked.refused.map((r) => r.message));
    const entries = checked.accepted.map((file) => {
      const image = looksLikeImage(file);
      const url = image ? (URL.createObjectURL?.(file) ?? "") : "";
      if (url) urls.current.add(url);
      return { key: nextKey.current++, file, url, image };
    });
    setStaged((list) => [...list, ...entries]);
    for (const entry of entries)
      if (entry.url && typeof Image !== "undefined") {
        const probe = new Image();
        probe.onload = () =>
          setStaged((list) =>
            list.map((s) =>
              s.key === entry.key
                ? {
                    ...s,
                    width: probe.naturalWidth,
                    height: probe.naturalHeight,
                  }
                : s,
            ),
          );
        probe.src = entry.url;
      }
    return { entries, refused: checked.refused };
  };
  const unstage = (key: number) => {
    setStaged((list) => {
      const entry = list.find((s) => s.key === key);
      if (entry?.url) {
        URL.revokeObjectURL?.(entry.url);
        urls.current.delete(entry.url);
      }
      return list.filter((s) => s.key !== key);
    });
    setErrors(({ [key]: _gone, ...rest }) => rest);
  };
  /**
   * Files for the create request, and a function that renumbers text
   * placeholders (`attachment:new-K`, K the staged key) to request positions.
   */
  const prepare = () => {
    const positions = new Map(staged.map((s, i) => [s.key, i + 1]));
    return {
      files: staged.map((s) => s.file),
      renumber: (text: string) =>
        text.replace(/attachment:new-(\d+)/g, (all, k) => {
          const position = positions.get(Number(k));
          return position ? `attachment:new-${position}` : all;
        }),
      /** Maps a create error's per-file errors back to staged rows. */
      fail: (error: unknown) => {
        if (!(error instanceof AttachmentError)) return;
        const next: Record<number, string> = {};
        for (const [position, e] of Object.entries(error.fileErrors)) {
          const entry = staged[Number(position) - 1];
          if (entry) next[entry.key] = e.message;
        }
        setErrors(next);
      },
    };
  };
  return { staged, errors, refused, stage, unstage, prepare };
}
export type StagedFiles = ReturnType<typeof useStagedFiles>;

/** Generic clipboard names get `screenshot-YYYY-MM-DD-N`; real names stay. */
export function namePasted(files: File[], taken: string[]) {
  const names = [...taken];
  return files.map((file) => {
    if (
      !file.type.startsWith("image/") ||
      !/^(image\.\w+|blob)?$/i.test(file.name)
    )
      return file;
    const name = screenshotName(names, file.type);
    names.push(name);
    return new File([file], name, {
      type: file.type,
      lastModified: file.lastModified,
    });
  });
}
export const filesOf = (data: DataTransfer | null) =>
  Array.from(data?.files ?? []);
export const hasFiles = (data: DataTransfer | null) =>
  Array.from(data?.types ?? []).includes("Files");

/**
 * Provides the item's files to Markdown (inline images, links) and opens the
 * lightbox or the file preview.
 */
export function AttachmentsProvider({
  attachments,
  staged = [],
  enabled = true,
  children,
}: {
  attachments: Attachment[];
  staged?: StagedFile[];
  enabled?: boolean;
  children: ReactNode;
}) {
  const token = useFileToken(enabled && attachments.length > 0);
  const [viewing, setViewing] = useState<
    { kind: "image"; id: string } | { kind: "file"; id: string } | null
  >(null);
  const [fresh, setFresh] = useState("");
  const files: ItemFile[] = [
    ...attachments.map(fromAttachment),
    ...staged.map((s) => ({
      id: `new-${s.key}`,
      name: s.file.name,
      image: s.image,
      media_type: s.file.type,
      size: s.file.size,
      width: s.width,
      height: s.height,
      blob: s.url || undefined,
    })),
  ];
  const images = files.filter((f) => f.image && !f.archived);
  const open = (id: string) => {
    const file = files.find((f) => f.id === id);
    if (!file) return;
    setViewing({ kind: file.image ? "image" : "file", id });
  };
  const lightboxItems: LightboxItem[] = images.map((f) => ({
    id: f.id,
    alt: f.name,
    width: f.width,
    height: f.height,
    src: f.blob || attachmentUrl(f.id, { token: fresh || token }),
  }));
  const previewing =
    viewing?.kind === "file"
      ? files.find((f) => f.id === viewing.id)?.attachment
      : undefined;
  return (
    <AttachmentsContext.Provider value={{ files, token, open }}>
      {children}
      {viewing?.kind === "image" && lightboxItems.length > 0 && (
        <Lightbox
          items={lightboxItems}
          index={Math.max(
            0,
            images.findIndex((f) => f.id === viewing.id),
          )}
          onClose={() => setViewing(null)}
          onLoadError={() =>
            void attachmentsApi
              .fileToken({ force: true })
              .then(setFresh, () => undefined)
          }
        />
      )}
      {previewing && (
        <AttachmentPreview
          attachment={previewing}
          token={token}
          onClose={() => setViewing(null)}
        />
      )}
    </AttachmentsContext.Provider>
  );
}
export const useAttachmentsContext = () => useContext(AttachmentsContext);

function UploadLinkButton({ parent }: { parent: ParentRef }) {
  const [link, setLink] = useState<UploadLink | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<"" | "copied" | "failed">("");
  const create = async () => {
    setBusy(true);
    setError("");
    setCopied("");
    try {
      setLink(await attachmentsApi.createUploadLink(parent));
    } catch (e) {
      setError(message(e, "Could not create an upload link."));
    } finally {
      setBusy(false);
    }
  };
  const address = link ? uploadLinkAddress(link) : "";
  return (
    <div className="crew-upload-link">
      <button type="button" disabled={busy} onClick={() => void create()}>
        {link ? "Get a new upload link" : "Get upload link"}
      </button>
      {error && (
        <p className="crew-alert" role="alert">
          {error}
        </p>
      )}
      {link && (
        <div className="crew-upload-link-box" role="status">
          <p>
            Open this link on your phone or another device to add up to{" "}
            {link.max_files} {link.max_files === 1 ? "file" : "files"} to this{" "}
            {parent.kind}. It works once and expires at{" "}
            {new Date(link.expires_at).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
            . It is shown only now.
          </p>
          <code>{address}</code>
          <button
            type="button"
            onClick={() =>
              navigator.clipboard.writeText(address).then(
                () => setCopied("copied"),
                () => setCopied("failed"),
              )
            }
          >
            {copied === "copied" ? "Link copied" : "Copy upload link"}
          </button>
          {copied === "failed" && (
            <span role="alert">
              Could not copy automatically; copy it from above.
            </span>
          )}
          <a className="crew-upload-link-manage" href={viewHashes.connect}>
            Manage upload links
          </a>
        </div>
      )}
    </div>
  );
}

function DownloadLink({ attachment }: { attachment: Attachment }) {
  return (
    <a
      className="crew-attachment-download"
      href={attachmentUrl(attachment.id, { download: true })}
      download={attachment.name}
      aria-label={`Download ${attachment.name}`}
      onClick={(e) => {
        e.preventDefault();
        void attachmentsApi.download(attachment);
      }}
    >
      Download
    </a>
  );
}

const typeLabel = (type: string) => type.split(";")[0] || "file";

/**
 * The Files section of a task or note dialog: add (button, drop, paste in the
 * dialog), progress and retry, image grid, file rows, removed files.
 * Without `parent`, files are staged for the create request.
 */
export function AttachmentsSection({
  parent,
  item,
  staged,
  readOnly,
  onStage,
  onUnstage,
  allowUploadLink = true,
}: {
  parent?: ParentRef;
  item?: ItemAttachments;
  staged?: StagedFiles;
  readOnly: boolean;
  onStage?: (files: File[]) => void;
  /** Removes a staged file (and, in the editor, its text placeholders). */
  onUnstage?: (key: number) => void;
  allowUploadLink?: boolean;
}) {
  const ctx = useContext(AttachmentsContext);
  const headingId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const active = (item?.attachments ?? []).filter((a) => !a.archived);
  const removed = (item?.attachments ?? []).filter((a) => a.archived);
  const images = active.filter(isImage);
  const others = active.filter((a) => !isImage(a));
  const add = (files: File[]) => {
    if (!files.length || readOnly) return;
    if (parent && item) item.addFiles(files);
    else onStage?.(files);
  };
  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    // Choosing files is not an edit of the form's fields.
    e.stopPropagation();
    add(Array.from(e.target.files ?? []));
    e.target.value = "";
  };
  const remove = (a: Attachment) => {
    if (
      window.confirm(
        `Remove ${a.name}? It moves to Removed files, where you can restore it.`,
      )
    )
      void item?.archive(a);
  };
  const stagedFiles = staged?.staged ?? [];
  const count = active.length + stagedFiles.length;
  const empty = !count && !item?.uploads.length && !removed.length;
  if (readOnly && empty) return null;
  return (
    <section
      className={`crew-attachments${dragging ? " crew-dragging" : ""}`}
      aria-labelledby={headingId}
      onDragOver={(e: DragEvent) => {
        if (readOnly || !hasFiles(e.dataTransfer)) return;
        e.preventDefault();
        e.stopPropagation();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null))
          setDragging(false);
      }}
      onDrop={(e) => {
        setDragging(false);
        if (readOnly) return;
        const files = filesOf(e.dataTransfer);
        if (!files.length) return;
        e.preventDefault();
        e.stopPropagation();
        add(files);
      }}
    >
      <div className="crew-attachments-head">
        <h3 id={headingId}>Files</h3>
        {count > 0 && (
          <span className="crew-attachments-count">{count} of 20</span>
        )}
        {!readOnly && (
          <>
            <button type="button" onClick={() => input.current?.click()}>
              Add files
            </button>
            <input
              ref={input}
              type="file"
              multiple
              hidden
              aria-label="Choose files to add"
              onChange={onPick}
            />
          </>
        )}
      </div>
      {!readOnly && (
        <p className="crew-attachments-hint">
          Drop files here or paste a screenshot. Up to 20 MB each.
          {!parent && " They are saved with the new item."}
        </p>
      )}
      {item?.withdrawn && (
        <p className="crew-notice" role="status">
          {withdrawnNotice}
        </p>
      )}
      {item?.error && (
        <p className="crew-alert" role="alert">
          {item.error}
        </p>
      )}
      {!!staged?.refused.length && (
        <ul className="crew-uploads" aria-label="Files not added">
          {staged.refused.map((m) => (
            <li key={m} className="crew-upload-failed">
              <span className="crew-upload-error" role="alert">
                {m}
              </span>
            </li>
          ))}
        </ul>
      )}
      {!!item?.uploads.length && (
        <ul className="crew-uploads" aria-label="Uploads">
          {item.uploads.map((u) => (
            <li key={u.key} className={u.error ? "crew-upload-failed" : ""}>
              <span className="crew-upload-name">{u.file.name}</span>
              {u.error ? (
                <>
                  <span className="crew-upload-error" role="alert">
                    {u.error}
                  </span>
                  {!u.refused && (
                    <button
                      type="button"
                      aria-label={`Retry ${u.file.name}`}
                      onClick={() => item.retry(u.key)}
                    >
                      Retry
                    </button>
                  )}
                  <button
                    type="button"
                    className="crew-quiet"
                    aria-label={`Dismiss ${u.file.name}`}
                    onClick={() => item.dismiss(u.key)}
                  >
                    Dismiss
                  </button>
                </>
              ) : (
                <progress
                  max={u.total || 1}
                  value={u.loaded}
                  aria-label={`Uploading ${u.file.name}`}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {(images.length > 0 || stagedFiles.some((s) => s.image)) && (
        <ul className="crew-attachment-grid" aria-label="Images">
          {images.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                className="crew-attachment-thumb"
                aria-label={`Open image ${a.name}`}
                onClick={() => ctx?.open(a.id)}
              >
                <ProtectedImage
                  id={a.id}
                  thumb="320x0"
                  alt={a.name}
                  token={ctx?.token ?? ""}
                />
              </button>
              <span className="crew-attachment-caption" title={a.name}>
                {a.name}
              </span>
              {!readOnly && (
                <button
                  type="button"
                  className="crew-quiet"
                  aria-label={`Remove ${a.name}`}
                  onClick={() => remove(a)}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
          {stagedFiles
            .filter((s) => s.image)
            .map((s) => (
              <li key={`new-${s.key}`}>
                <button
                  type="button"
                  className="crew-attachment-thumb"
                  aria-label={`Open image ${s.file.name}`}
                  onClick={() => ctx?.open(`new-${s.key}`)}
                >
                  <span className="crew-image-box">
                    <img src={s.url} alt={s.file.name} />
                  </span>
                </button>
                <span className="crew-attachment-caption" title={s.file.name}>
                  {s.file.name}
                </span>
                {staged?.errors[s.key] && (
                  <span className="crew-upload-error" role="alert">
                    {staged.errors[s.key]}
                  </span>
                )}
                <button
                  type="button"
                  className="crew-quiet"
                  aria-label={`Remove ${s.file.name}`}
                  onClick={() => (onUnstage ?? staged?.unstage)?.(s.key)}
                >
                  Remove
                </button>
              </li>
            ))}
        </ul>
      )}
      {(others.length > 0 || stagedFiles.some((s) => !s.image)) && (
        <ul className="crew-attachment-files" aria-label="Other files">
          {others.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                className="crew-attachment-name"
                aria-label={`Open ${a.name}`}
                onClick={() => ctx?.open(a.id)}
              >
                {a.name}
              </button>
              <small>
                {formatBytes(a.size)} · {typeLabel(a.media_type)}
              </small>
              <DownloadLink attachment={a} />
              {!readOnly && (
                <button
                  type="button"
                  className="crew-quiet"
                  aria-label={`Remove ${a.name}`}
                  onClick={() => remove(a)}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
          {stagedFiles
            .filter((s) => !s.image)
            .map((s) => (
              <li key={`new-${s.key}`}>
                <span className="crew-attachment-name">{s.file.name}</span>
                <small>
                  {formatBytes(s.file.size)} · {typeLabel(s.file.type)}
                </small>
                {staged?.errors[s.key] && (
                  <span className="crew-upload-error" role="alert">
                    {staged.errors[s.key]}
                  </span>
                )}
                <button
                  type="button"
                  className="crew-quiet"
                  aria-label={`Remove ${s.file.name}`}
                  onClick={() => (onUnstage ?? staged?.unstage)?.(s.key)}
                >
                  Remove
                </button>
              </li>
            ))}
        </ul>
      )}
      {parent && !readOnly && allowUploadLink && (
        <UploadLinkButton parent={parent} />
      )}
      {removed.length > 0 && (
        <details className="crew-attachments-removed">
          <summary>Removed files ({removed.length})</summary>
          <ul>
            {removed.map((a) => (
              <li key={a.id}>
                <span className="crew-attachment-name">{a.name}</span>
                <small>
                  {formatBytes(a.size)} · {typeLabel(a.media_type)}
                </small>
                <DownloadLink attachment={a} />
                {!readOnly && (
                  <button
                    type="button"
                    aria-label={`Restore ${a.name}`}
                    onClick={() => void item?.restore(a)}
                  >
                    Restore
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** A small fixed-size card image; its box is reserved before it loads. */
export function CardThumbnail({
  thumb,
  token,
}: {
  thumb: CardThumb;
  token: string;
}) {
  return (
    <span className="crew-card-thumb" aria-hidden="true">
      <ProtectedImage id={thumb.id} thumb="320x0" alt="" token={token} />
    </span>
  );
}

/** Readable history lines for attachment and upload-link events. */
export function eventSummary(event: Row): { title: string; by: string } {
  const action = String(event.action || "");
  const changes = parseChanges(event.changes);
  const name = String(changes.name || "a file");
  const actor = String(event.actor || "");
  const viaLink =
    actor.startsWith("upload_link:") || Boolean(changes.via_upload_link);
  const by = viaLink
    ? "via upload link"
    : String(event.reported_agent || "") || actor || "Owner / connection";
  const title =
    action === "attachment.add"
      ? `Attached ${name}`
      : action === "attachment.archive"
        ? `Removed ${name}`
        : action === "attachment.restore"
          ? `Restored ${name}`
          : action === "upload_link.create"
            ? "Created an upload link"
            : action === "upload_link.revoke"
              ? "Revoked an upload link"
              : action;
  return { title, by };
}
export const isFileEvent = (event: Row) =>
  /^(attachment|upload_link)\./.test(String(event.action || ""));

/** Paste and drop for any text field: files go to `onFiles` with the caret range. */
export function fileInputHandlers(
  onFiles:
    | ((
        files: File[],
        range: [number, number],
        pasted: boolean,
      ) => string | void)
    | undefined,
  disabled = false,
) {
  if (!onFiles || disabled) return {};
  // The caret goes after the inserted text once React has committed it: a
  // microtask runs after React's own flush and before the next keystroke.
  const place = (
    el: HTMLTextAreaElement,
    inserted: string | void,
    start: number,
  ) => {
    if (!inserted) return;
    queueMicrotask(() => {
      const end = start + inserted.length;
      if (el.value.slice(start, end) === inserted)
        el.setSelectionRange?.(end, end);
    });
  };
  return {
    onPaste: (e: ClipboardEvent<HTMLTextAreaElement>) => {
      const files = filesOf(e.clipboardData);
      if (!files.length) return;
      e.preventDefault();
      e.stopPropagation();
      const el = e.currentTarget;
      const start = el.selectionStart ?? el.value.length;
      place(el, onFiles(files, [start, el.selectionEnd ?? start], true), start);
    },
    onDragOver: (e: DragEvent<HTMLTextAreaElement>) => {
      if (!hasFiles(e.dataTransfer)) return;
      e.preventDefault();
      e.stopPropagation();
    },
    onDrop: (e: DragEvent<HTMLTextAreaElement>) => {
      const files = filesOf(e.dataTransfer);
      if (!files.length) return;
      e.preventDefault();
      e.stopPropagation();
      const el = e.currentTarget;
      const start = el.selectionStart ?? el.value.length;
      place(
        el,
        onFiles(files, [start, el.selectionEnd ?? start], false),
        start,
      );
    },
  };
}
