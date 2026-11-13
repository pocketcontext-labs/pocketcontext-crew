import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  attachmentsApi,
  attachmentUrl,
  formatBytes,
  type Attachment,
} from "./attachmentsApi";
import {
  decodeUtf8Strict,
  fetchAttachmentBytes,
  parseDelimited,
  PDF_PREVIEW_LIMIT,
  PreviewFetchError,
  previewKind,
  prettyJson,
  TABLE_ROW_LIMIT,
  TEXT_PREVIEW_LIMIT,
  type PreviewKind,
} from "./previewFormats";
import type { FileNav } from "./Lightbox";
import "./preview.css";

// pdf.js and its worker load only when a PDF is opened.
const PdfPreview = lazy(() => import("./PdfPreview"));

const focusable =
  'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"]), video[controls], audio[controls]';

/**
 * Preview of a non-image attachment (images open in the lightbox): text,
 * logs, code, YAML, JSON (pretty), CSV/TSV (table) and Markdown up to 2 MiB of
 * strict UTF-8; video and audio players; PDF through a lazily loaded pdf.js;
 * HTML and SVG in a sandboxed frame (HtmlPreview); name, size, type and
 * Download for everything else. Nothing else in a file is executed or framed;
 * bytes are fetched same-origin with a file token.
 */
export function AttachmentPreview({
  attachment,
  token,
  onClose,
  nav,
}: {
  attachment: Attachment;
  /** A current file token for protected URLs (download links work without). */
  token?: string;
  onClose: () => void;
  /** Stepping through a list of files (0.26.0): previous / next and arrows. */
  nav?: FileNav;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const kind = previewKind(attachment);
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    if (dialog && typeof dialog.showModal === "function" && !dialog.open)
      dialog.showModal();
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      if (dialog?.open && typeof dialog.close === "function") dialog.close();
      previous?.focus?.({ preventScroll: true });
    };
  }, []);
  const onKeyDown = (e: KeyboardEvent<HTMLDialogElement>) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (
      nav &&
      nav.count > 1 &&
      (e.key === "ArrowLeft" || e.key === "ArrowRight") &&
      !e.altKey &&
      !e.ctrlKey &&
      !e.metaKey &&
      !(e.target as HTMLElement).closest?.("pre, table, input, .crew-pdf")
    ) {
      // Arrows still scroll text, tables and PDFs when those have focus.
      e.preventDefault();
      nav.go(e.key === "ArrowRight" ? 1 : -1);
    } else if (e.key === "Tab") {
      // A modal dialog already traps focus; this covers browsers without one.
      const nodes = Array.from(
        ref.current?.querySelectorAll<HTMLElement>(focusable) ?? [],
      ).filter((n) => !n.hidden);
      if (!nodes.length) return;
      const first = nodes[0],
        last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (!ref.current?.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  const type = attachment.media_type || "file";
  return createPortal(
    <dialog
      ref={ref}
      className={`crew-file-preview crew-file-preview-${kind}`}
      aria-label={`File: ${attachment.name}`}
      open={
        typeof HTMLDialogElement.prototype.showModal !== "function"
          ? true
          : undefined
      }
      onKeyDown={onKeyDown}
      onCancel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onChange={(e) => e.stopPropagation()}
    >
      <header className="crew-file-preview-header">
        <div className="crew-file-preview-title">
          <h2>{attachment.name}</h2>
          <p>
            {formatBytes(attachment.size)} · {type}
          </p>
        </div>
        <div className="crew-file-preview-actions">
          {nav && nav.count > 1 && (
            <span className="crew-file-preview-nav">
              <button
                type="button"
                aria-label="Previous file"
                title="Previous file"
                onClick={() => nav.go(-1)}
              >
                ‹
              </button>
              <span aria-live="polite">
                {nav.index + 1} / {nav.count}
              </span>
              <button
                type="button"
                aria-label="Next file"
                title="Next file"
                onClick={() => nav.go(1)}
              >
                ›
              </button>
            </span>
          )}
          <DownloadButton attachment={attachment} token={token} />
          <button
            ref={closeRef}
            type="button"
            className="crew-file-preview-close"
            aria-label="Close file preview"
            onClick={onClose}
          >
            ×
          </button>
        </div>
      </header>
      <div className="crew-file-preview-body">
        <PreviewBody attachment={attachment} kind={kind} token={token} />
      </div>
    </dialog>,
    document.body,
  );
}
export default AttachmentPreview;

function DownloadButton({
  attachment,
  token,
  label = "Download",
}: {
  attachment: Attachment;
  token?: string;
  label?: string;
}) {
  return (
    <a
      className="crew-file-preview-download"
      href={attachmentUrl(attachment.id, { download: true, token })}
      download={attachment.name}
      onClick={(e) => {
        e.preventDefault();
        void attachmentsApi.download(attachment);
      }}
    >
      {label}
    </a>
  );
}

/** A message in place of a preview, with a download link. */
function Unavailable({
  attachment,
  token,
  children,
}: {
  attachment: Attachment;
  token?: string;
  children: ReactNode;
}) {
  return (
    <div className="crew-preview-unavailable">
      <p>{children}</p>
      <DownloadButton
        attachment={attachment}
        token={token}
        label={`Download ${attachment.name}`}
      />
    </div>
  );
}

function PreviewBody({
  attachment,
  kind,
  token,
}: {
  attachment: Attachment;
  kind: PreviewKind;
  token?: string;
}) {
  switch (kind) {
    case "video":
    case "audio":
      return <MediaPreview attachment={attachment} kind={kind} token={token} />;
    case "pdf":
      return <PdfBody attachment={attachment} token={token} />;
    case "html":
      return <HtmlPreview attachment={attachment} />;
    case "text":
    case "json":
    case "csv":
    case "tsv":
    case "markdown":
      return (
        <TextualPreview attachment={attachment} kind={kind} token={token} />
      );
    default:
      return (
        <Unavailable attachment={attachment} token={token}>
          No preview for this type of file.
        </Unavailable>
      );
  }
}

/** The preview widths: a desktop and a phone viewport. */
const htmlWidths = { desktop: 1440, mobile: 390 } as const;
/** Ask for a new address before the 5-minute one expires (Open in new tab). */
const previewRefreshMs = 4 * 60 * 1000;

/**
 * An HTML or SVG file in a sandboxed frame (0.26.0). The frame has only
 * allow-scripts, and the server adds its own CSP sandbox with no network, so
 * the page runs in an opaque origin: it cannot read Crew's storage or DOM,
 * call Crew, navigate this window, open windows, submit forms or load anything
 * from outside the file. The address is signed for this one file and expires
 * in 5 minutes; Open in new tab keeps the same sandbox.
 */
function HtmlPreview({ attachment }: { attachment: Attachment }) {
  const [link, setLink] = useState<Loaded<string>>({ state: "loading" });
  const [width, setWidth] = useState<keyof typeof htmlWidths>("desktop");
  const stage = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  useEffect(() => {
    let alive = true;
    const load = () =>
      attachmentsApi.previewLink(attachment.id).then(
        (result) => alive && setLink({ state: "ready", value: result.url }),
        () =>
          alive &&
          setLink((current) =>
            current.state === "ready"
              ? current
              : { state: "error", message: "The preview could not be opened." },
          ),
      );
    void load();
    const timer = setInterval(() => void load(), previewRefreshMs);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [attachment.id]);
  useLayoutEffect(() => {
    const node = stage.current;
    if (!node) return;
    const measure = () =>
      setBox({ width: node.clientWidth, height: node.clientHeight });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [link.state]);
  // The first address is kept for the frame, so a refresh never reloads it.
  const [frameUrl, setFrameUrl] = useState("");
  useEffect(() => {
    if (link.state === "ready" && !frameUrl) setFrameUrl(link.value);
  }, [link, frameUrl]);
  if (link.state === "loading")
    return <p className="crew-preview-note">Opening {attachment.name}…</p>;
  if (link.state === "error")
    return <Unavailable attachment={attachment}>{link.message}</Unavailable>;
  const target = htmlWidths[width];
  // Scale the viewport down to fit; never up.
  const scale = box.width > 0 ? Math.min(1, box.width / target) : 1;
  return (
    <div className="crew-html-preview">
      <div className="crew-preview-toolbar">
        <div
          className="crew-html-widths"
          role="group"
          aria-label="Preview width"
        >
          {(Object.keys(htmlWidths) as (keyof typeof htmlWidths)[]).map(
            (key) => (
              <button
                key={key}
                type="button"
                aria-pressed={width === key}
                onClick={() => setWidth(key)}
              >
                {key === "desktop" ? "Desktop" : "Mobile"}
              </button>
            ),
          )}
        </div>
        <a
          href={link.value}
          target="_blank"
          rel="noopener noreferrer"
          referrerPolicy="no-referrer"
        >
          Open in new tab
        </a>
        <span className="crew-html-isolated">
          Preview runs isolated from Crew
        </span>
      </div>
      <div className="crew-html-stage" ref={stage}>
        {frameUrl && (
          <iframe
            title={`Preview of ${attachment.name}`}
            src={frameUrl}
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            loading="eager"
            style={{
              width: `${target}px`,
              height: box.height ? `${box.height / scale}px` : "100%",
              transform: scale < 1 ? `scale(${scale})` : undefined,
            }}
          />
        )}
      </div>
    </div>
  );
}

type Loaded<T> =
  | { state: "loading" }
  | { state: "ready"; value: T }
  | { state: "error"; message: string };

/** The attachment's bytes (at most `limit`), fetched once while mounted. */
function useBytes(attachment: Attachment, limit: number, token?: string) {
  const tooLarge = attachment.size > limit;
  const [result, setResult] = useState<Loaded<ArrayBuffer>>(
    tooLarge
      ? { state: "error", message: "Too large to preview." }
      : { state: "loading" },
  );
  useEffect(() => {
    if (tooLarge) return;
    const controller = new AbortController();
    fetchAttachmentBytes(attachment, limit, {
      token,
      signal: controller.signal,
    }).then(
      (value) => setResult({ state: "ready", value }),
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setResult({
          state: "error",
          message:
            error instanceof PreviewFetchError
              ? error.message
              : "The file could not be loaded.",
        });
      },
    );
    return () => controller.abort();
    // Keep the token the fetch started with; a fresh one comes on retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachment.id, limit, tooLarge]);
  return result;
}

function TextualPreview({
  attachment,
  kind,
  token,
}: {
  attachment: Attachment;
  kind: "text" | "json" | "csv" | "tsv" | "markdown";
  token?: string;
}) {
  const bytes = useBytes(attachment, TEXT_PREVIEW_LIMIT, token);
  if (bytes.state === "loading")
    return <p className="crew-preview-note">Loading {attachment.name}…</p>;
  if (bytes.state === "error")
    return (
      <Unavailable attachment={attachment} token={token}>
        {bytes.message}
      </Unavailable>
    );
  const text = decodeUtf8Strict(bytes.value);
  if (text === null)
    return (
      <Unavailable attachment={attachment} token={token}>
        Not valid text: this file is not UTF-8, so it can't be shown here.
      </Unavailable>
    );
  if (kind === "csv" || kind === "tsv")
    return <TablePreview text={text} delimiter={kind === "tsv" ? "\t" : ","} />;
  if (kind === "markdown") return <MarkdownPreview text={text} />;
  if (kind === "json") {
    const pretty = prettyJson(text);
    return (
      <>
        {pretty === null && (
          <p className="crew-preview-note">
            Not valid JSON; showing the text as it is.
          </p>
        )}
        <TextPreview text={pretty ?? text} />
      </>
    );
  }
  return <TextPreview text={text} />;
}

function TextPreview({ text }: { text: string }) {
  const [wrap, setWrap] = useState(true);
  return (
    <div className="crew-text-preview">
      <div className="crew-preview-toolbar">
        <button
          type="button"
          aria-pressed={wrap}
          onClick={() => setWrap((w) => !w)}
        >
          Wrap lines
        </button>
      </div>
      <pre className={wrap ? "crew-text-wrap" : undefined} tabIndex={0}>
        {text}
      </pre>
    </div>
  );
}

function TablePreview({
  text,
  delimiter,
}: {
  text: string;
  delimiter: string;
}) {
  const { rows, total } = parseDelimited(text, delimiter, TABLE_ROW_LIMIT);
  if (!rows.length)
    return <p className="crew-preview-note">The file is empty.</p>;
  const [header, ...body] = rows;
  const columns = Math.max(...rows.map((r) => r.length));
  const cells = (row: string[]) =>
    Array.from({ length: columns }, (_, i) => row[i] ?? "");
  return (
    <div className="crew-table-preview">
      <p className="crew-preview-note">
        {total > body.length
          ? `Showing first ${body.length.toLocaleString("en")} of ${total.toLocaleString("en")} rows.`
          : `${total.toLocaleString("en")} ${total === 1 ? "row" : "rows"}.`}
      </p>
      <div className="crew-table-scroll" tabIndex={0}>
        <table>
          <thead>
            <tr>
              {cells(header).map((cell, i) => (
                <th key={i} scope="col">
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, r) => (
              <tr key={r}>
                {cells(row).map((cell, i) => (
                  <td key={i}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * An attached Markdown file, with the reader's Markdown settings (GFM, no raw
 * HTML, default URL sanitizing). Its images never load (alt text instead);
 * links open in a new tab.
 */
function MarkdownPreview({ text }: { text: string }) {
  return (
    <div className="crew-prose crew-markdown-preview">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={defaultUrlTransform}
        components={{
          img: ({ alt }) => (
            <span className="crew-preview-image-alt">
              [Image{alt?.trim() ? `: ${alt.trim()}` : ""}]
            </span>
          ),
          a: ({ children, href }) =>
            href ? (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

/** A player from the protected URL; a failed load retries once with a fresh token. */
function MediaPreview({
  attachment,
  kind,
  token,
}: {
  attachment: Attachment;
  kind: "video" | "audio";
  token?: string;
}) {
  const [src, setSrc] = useState(() =>
    token ? attachmentUrl(attachment.id, { token }) : "",
  );
  const [failed, setFailed] = useState(false);
  const retried = useRef(false);
  useEffect(() => {
    if (src) return;
    let alive = true;
    attachmentsApi.fileToken().then(
      (fresh) =>
        alive && setSrc(attachmentUrl(attachment.id, { token: fresh })),
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [src, attachment.id]);
  if (failed)
    return (
      <Unavailable attachment={attachment} token={token}>
        Can't play this format here.
      </Unavailable>
    );
  if (!src)
    return <p className="crew-preview-note">Loading {attachment.name}…</p>;
  const onError = () => {
    if (retried.current) return setFailed(true);
    retried.current = true;
    attachmentsApi.fileToken({ force: true }).then(
      (fresh) => setSrc(attachmentUrl(attachment.id, { token: fresh })),
      () => setFailed(true),
    );
  };
  return kind === "video" ? (
    <video
      className="crew-preview-video"
      controls
      preload="metadata"
      playsInline
      src={src}
      aria-label={attachment.name}
      onError={onError}
    />
  ) : (
    <audio
      className="crew-preview-audio"
      controls
      preload="metadata"
      src={src}
      aria-label={attachment.name}
      onError={onError}
    />
  );
}

function PdfBody({
  attachment,
  token,
}: {
  attachment: Attachment;
  token?: string;
}) {
  const bytes = useBytes(attachment, PDF_PREVIEW_LIMIT, token);
  const [failure, setFailure] = useState<"" | "password" | "invalid">("");
  const [data, setData] = useState<Uint8Array | null>(null);
  useEffect(() => {
    if (bytes.state === "ready") setData(new Uint8Array(bytes.value));
  }, [bytes]);
  if (bytes.state === "error")
    return (
      <Unavailable attachment={attachment} token={token}>
        {bytes.message}
      </Unavailable>
    );
  if (failure)
    return (
      <Unavailable attachment={attachment} token={token}>
        {failure === "password"
          ? "This PDF is password protected and can't be shown here."
          : "This PDF can't be shown here."}
      </Unavailable>
    );
  if (!data)
    return <p className="crew-preview-note">Loading {attachment.name}…</p>;
  return (
    <Suspense
      fallback={<p className="crew-preview-note">Opening the PDF viewer…</p>}
    >
      <PdfLoadBoundary
        fallback={
          <Unavailable attachment={attachment} token={token}>
            The PDF viewer could not be loaded.
          </Unavailable>
        }
      >
        <PdfPreview data={data} name={attachment.name} onError={setFailure} />
      </PdfLoadBoundary>
    </Suspense>
  );
}

/** Shows `fallback` when the lazy PDF viewer chunk fails to load. */
class PdfLoadBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
