import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  attachmentsApi,
  attachmentUrl,
  formatBytes,
  type Attachment,
} from "./attachmentsApi";

/**
 * Preview of a non-image attachment. For now: name, size, type and a download
 * link. Planned: text, logs, JSON, CSV and Markdown up to 2 MB, audio and
 * video players, and PDF through a lazily loaded pdf.js. Keep the props.
 */
export function AttachmentPreview({
  attachment,
  token,
  onClose,
}: {
  attachment: Attachment;
  /** A current file token for protected URLs (download links work without). */
  token?: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
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
  return createPortal(
    <dialog
      ref={ref}
      className="crew-preview"
      aria-label={`File: ${attachment.name}`}
      open={
        typeof HTMLDialogElement.prototype.showModal !== "function"
          ? true
          : undefined
      }
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
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
      <header>
        <h2>{attachment.name}</h2>
        <button
          ref={closeRef}
          type="button"
          aria-label="Close file preview"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <p>
        {formatBytes(attachment.size)} · {attachment.media_type || "file"}
      </p>
      <p>No preview for this file yet.</p>
      <a
        className="crew-attachment-download"
        href={attachmentUrl(attachment.id, { download: true, token })}
        download={attachment.name}
        onClick={(e) => {
          e.preventDefault();
          void attachmentsApi.download(attachment);
        }}
      >
        Download {attachment.name}
      </a>
    </dialog>,
    document.body,
  );
}
export default AttachmentPreview;
