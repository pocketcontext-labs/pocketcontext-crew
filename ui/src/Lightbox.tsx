import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type TouchEvent,
} from "react";
import { createPortal } from "react-dom";

export type LightboxItem = {
  id: string;
  /** Full-size address: a protected URL with a file token, or a blob: URL. */
  src: string;
  alt: string;
  width?: number;
  height?: number;
};

const focusable =
  'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/**
 * Full-size images of one task or note. Arrow keys and swipes move between
 * them, Escape closes, focus stays inside and returns to where it was.
 * Rendered in a portal; its events do not reach the dialog underneath.
 */
export default function Lightbox({
  items,
  index: start,
  onClose,
  onLoadError,
}: {
  items: LightboxItem[];
  index: number;
  onClose: () => void;
  /** Called once per image that fails to load (for example, an expired token);
   *  the caller may pass items with fresh addresses. */
  onLoadError?: (item: LightboxItem) => void;
}) {
  const [index, setIndex] = useState(() =>
    Math.min(Math.max(start, 0), Math.max(items.length - 1, 0)),
  );
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const failed = useRef(new Set<string>());
  const [broken, setBroken] = useState<string[]>([]);
  const count = items.length;
  const item = items[index];
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
  useEffect(() => {
    if (index >= count && count) setIndex(count - 1);
  }, [count, index]);
  if (!item) return null;
  const go = (step: number) => {
    if (count < 2) return;
    setIndex((i) => (i + step + count) % count);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDialogElement>) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      go(1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      go(-1);
    } else if (e.key === "Tab") {
      // A modal dialog already traps focus; this covers browsers without one.
      const nodes = Array.from(
        ref.current?.querySelectorAll<HTMLElement>(focusable) ?? [],
      );
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
  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0];
    touch.current = t ? { x: t.clientX, y: t.clientY } : null;
  };
  const onTouchEnd = (e: TouchEvent) => {
    const from = touch.current;
    touch.current = null;
    const t = e.changedTouches[0];
    if (!from || !t) return;
    const dx = t.clientX - from.x,
      dy = t.clientY - from.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5)
      go(dx < 0 ? 1 : -1);
  };
  const label = `Image ${index + 1} of ${count}: ${item.alt}`;
  return createPortal(
    <dialog
      ref={ref}
      className="crew-lightbox"
      aria-label="Image viewer"
      aria-modal="true"
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
        // The backdrop and the empty stage close; the image and controls don't.
        if (
          e.target === e.currentTarget ||
          (e.target as HTMLElement).dataset.stage
        )
          onClose();
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onChange={(e) => e.stopPropagation()}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div className="crew-lightbox-bar">
        <span className="crew-lightbox-count" aria-live="polite">
          {count > 1 ? `${index + 1} / ${count}` : ""}
          <span className="crew-visually-hidden">{label}</span>
        </span>
        <span className="crew-lightbox-name" title={item.alt}>
          {item.alt}
        </span>
        <button
          ref={closeRef}
          type="button"
          className="crew-lightbox-close"
          aria-label="Close image viewer"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <div className="crew-lightbox-stage" data-stage="1">
        {broken.includes(item.id) ? (
          <p className="crew-lightbox-error" role="alert">
            Image unavailable: {item.alt}
          </p>
        ) : (
          <img
            key={item.src}
            src={item.src}
            alt={item.alt}
            width={item.width || undefined}
            height={item.height || undefined}
            decoding="async"
            onError={() => {
              // One retry per image (with a fresh address), then a message.
              if (failed.current.has(item.id) || !onLoadError) {
                setBroken((list) => [...list, item.id]);
                return;
              }
              failed.current.add(item.id);
              onLoadError(item);
            }}
          />
        )}
      </div>
      {count > 1 && (
        <>
          <button
            type="button"
            className="crew-lightbox-prev"
            aria-label="Previous image"
            onClick={() => go(-1)}
          >
            ‹
          </button>
          <button
            type="button"
            className="crew-lightbox-next"
            aria-label="Next image"
            onClick={() => go(1)}
          >
            ›
          </button>
        </>
      )}
    </dialog>,
    document.body,
  );
}
