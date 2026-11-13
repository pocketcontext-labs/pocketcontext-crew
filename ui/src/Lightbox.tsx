import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
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
  /** Saves the original file under its own name (one click). */
  onDownload?: () => void;
};

/** Where the open file sits in a list of files the viewer steps through. */
export type FileNav = {
  index: number;
  count: number;
  go: (step: number) => void;
};

const focusable =
  'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/** "fit" shows the whole image, "width" fills the stage's width, a number is
 *  a scale of the image's own pixels (1 = 100%). */
type Zoom = "fit" | "width" | number;

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
const STEPS = [
  0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4,
  5, 6, 8,
];
const clamp = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
const stepIn = (s: number) => STEPS.find((v) => v > s + 0.001) ?? MAX_SCALE;
const stepOut = (s: number) =>
  [...STEPS].reverse().find((v) => v < s - 0.001) ?? MIN_SCALE;
type Point = { clientX: number; clientY: number };
const distance = (a: Point, b: Point) =>
  Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

type Anchor = { fx: number; fy: number; px: number; py: number };
type Gesture = {
  x: number;
  y: number;
  t: number;
  pinched: boolean;
  pinch?: { dist: number; scale: number };
};

/**
 * Full-size images of one task or note. Arrow keys and swipes move between
 * them, Escape closes, focus stays inside and returns to where it was.
 * Zoom with the toolbar, + - 0, Ctrl/Cmd + wheel, pinch or a double click;
 * a zoomed image scrolls. Rendered in a portal; its events do not reach the
 * dialog underneath.
 */
export default function Lightbox({
  items,
  index: start,
  onClose,
  onLoadError,
  nav,
}: {
  items: LightboxItem[];
  index: number;
  onClose: () => void;
  /** Stepping through a mixed list of files (0.26.0): this image is one of
   *  them; arrows, swipes and the buttons move through the whole list. */
  nav?: FileNav;
  /** Called once per image that fails to load (for example, an expired token);
   *  the caller may pass items with fresh addresses. */
  onLoadError?: (item: LightboxItem) => void;
}) {
  const [index, setIndex] = useState(() =>
    Math.min(Math.max(start, 0), Math.max(items.length - 1, 0)),
  );
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const lastTap = useRef(0);
  const lastDoubleTap = useRef(0);
  const drag = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const anchor = useRef<Anchor | null>(null);
  const failed = useRef(new Set<string>());
  const [broken, setBroken] = useState<string[]>([]);
  const [zoom, setZoom] = useState<Zoom>("fit");
  // Bumped when the image loads or the stage resizes, to measure again.
  const [, setLayout] = useState(0);
  const count = items.length;
  const item = items[index];

  // Sizes in CSS pixels; zero when unknown (not loaded yet, or no layout).
  const measure = () => {
    const stage = stageRef.current;
    const img = imgRef.current;
    const nw = img?.naturalWidth || item?.width || 0;
    const nh = img?.naturalHeight || item?.height || 0;
    if (!stage) return { nw, nh, w: 0, h: 0 };
    const cs = getComputedStyle(stage);
    const px = (v: string) => parseFloat(v) || 0;
    const w = stage.clientWidth - px(cs.paddingLeft) - px(cs.paddingRight);
    const h = stage.clientHeight - px(cs.paddingTop) - px(cs.paddingBottom);
    return { nw, nh, w, h };
  };
  const { nw, nh, w, h } = measure();
  const fitScale = nw && nh && w > 0 && h > 0 ? Math.min(w / nw, h / nh, 1) : 1;
  const widthScale = nw && w > 0 ? clamp(Math.floor(w) / nw) : 1;
  const scale =
    zoom === "fit" ? fitScale : zoom === "width" ? widthScale : zoom;
  const zoomed = zoom !== "fit";

  const setScale = (next: number, at?: { x: number; y: number }) => {
    const stage = stageRef.current;
    const img = imgRef.current;
    if (stage && img) {
      const s = stage.getBoundingClientRect();
      const r = img.getBoundingClientRect();
      const x = at?.x ?? s.left + s.width / 2;
      const y = at?.y ?? s.top + s.height / 2;
      anchor.current = {
        fx: r.width ? Math.min(Math.max((x - r.left) / r.width, 0), 1) : 0.5,
        fy: r.height ? Math.min(Math.max((y - r.top) / r.height, 0), 1) : 0.5,
        px: x - s.left,
        py: y - s.top,
      };
    }
    setZoom(clamp(next));
  };
  const toggle = (at?: { x: number; y: number }) => {
    if (zoomed) setZoom("fit");
    else setScale(fitScale < 1 ? 1 : stepIn(fitScale), at);
  };
  const live = useRef({ scale, setScale });
  live.current = { scale, setScale };

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
  // A different image starts fitted.
  useLayoutEffect(() => {
    setZoom("fit");
    anchor.current = null;
  }, [item?.id]);
  // Keep the point under the cursor (or the centre) in place after zooming.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    const img = imgRef.current;
    const a = anchor.current;
    anchor.current = null;
    if (!stage || !img) return;
    if (zoom === "width" || !zoomed) {
      stage.scrollTop = 0;
      stage.scrollLeft = 0;
      return;
    }
    if (!a) return;
    stage.scrollLeft = img.offsetLeft + a.fx * img.offsetWidth - a.px;
    stage.scrollTop = img.offsetTop + a.fy * img.offsetHeight - a.py;
  }, [scale, zoom, zoomed]);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    // Ctrl/Cmd + wheel (and trackpad pinch) zooms; a plain wheel scrolls.
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const { scale: s, setScale: set } = live.current;
      set(s * Math.exp(-e.deltaY * 0.002), { x: e.clientX, y: e.clientY });
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    const bump = () => setLayout((n) => n + 1);
    const observer =
      typeof ResizeObserver === "function" ? new ResizeObserver(bump) : null;
    observer?.observe(stage);
    if (!observer) window.addEventListener("resize", bump);
    return () => {
      stage.removeEventListener("wheel", onWheel);
      observer?.disconnect();
      window.removeEventListener("resize", bump);
    };
  }, []);

  if (!item) return null;
  const total = nav ? nav.count : count;
  const position = nav ? nav.index : index;
  const unit = nav ? "file" : "image";
  const go = (step: number) => {
    if (total < 2) return;
    if (nav) return nav.go(step);
    setIndex((i) => (i + step + count) % count);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDialogElement>) => {
    e.stopPropagation();
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowRight" && total > 1) {
      e.preventDefault();
      go(1);
    } else if (e.key === "ArrowLeft" && total > 1) {
      e.preventDefault();
      go(-1);
    } else if (plain && (e.key === "+" || e.key === "=")) {
      e.preventDefault();
      setScale(stepIn(scale));
    } else if (plain && (e.key === "-" || e.key === "_")) {
      e.preventDefault();
      setScale(stepOut(scale));
    } else if (plain && e.key === "0") {
      e.preventDefault();
      setZoom("fit");
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
    const [a, b] = [e.touches[0], e.touches[1]];
    if (a && b) {
      const g = gesture.current ?? {
        x: a.clientX,
        y: a.clientY,
        t: Date.now(),
        pinched: false,
      };
      gesture.current = {
        ...g,
        pinched: true,
        pinch: { dist: distance(a, b) || 1, scale },
      };
    } else if (a) {
      gesture.current = {
        x: a.clientX,
        y: a.clientY,
        t: Date.now(),
        pinched: false,
      };
    }
  };
  const onTouchMove = (e: TouchEvent) => {
    const g = gesture.current;
    const [a, b] = [e.touches[0], e.touches[1]];
    if (!g?.pinch || !a || !b) return;
    setScale(g.pinch.scale * (distance(a, b) / g.pinch.dist), {
      x: (a.clientX + b.clientX) / 2,
      y: (a.clientY + b.clientY) / 2,
    });
  };
  const onTouchEnd = (e: TouchEvent) => {
    const g = gesture.current;
    if (e.touches.length > 0) {
      // One finger of a pinch lifted: the gesture stays a pinch.
      if (g) g.pinch = undefined;
      return;
    }
    gesture.current = null;
    const t = e.changedTouches[0];
    if (!g || !t || g.pinched) return;
    const dx = t.clientX - g.x,
      dy = t.clientY - g.y;
    const now = Date.now();
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && now - g.t < 300) {
      if (!stageRef.current?.contains(e.target as Node)) return;
      if (now - lastTap.current < 300) {
        lastTap.current = 0;
        lastDoubleTap.current = now;
        toggle({ x: t.clientX, y: t.clientY });
      } else lastTap.current = now;
      return;
    }
    // A zoomed image pans instead of changing.
    if (zoomed) return;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5)
      go(dx < 0 ? 1 : -1);
  };
  // Drag a zoomed image with the mouse to pan it.
  const onImgPointerDown = (e: ReactPointerEvent<HTMLImageElement>) => {
    const stage = stageRef.current;
    if (!zoomed || e.pointerType !== "mouse" || e.button !== 0 || !stage)
      return;
    e.preventDefault();
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      left: stage.scrollLeft,
      top: stage.scrollTop,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onImgPointerMove = (e: ReactPointerEvent<HTMLImageElement>) => {
    const d = drag.current;
    const stage = stageRef.current;
    if (!d || !stage) return;
    stage.scrollLeft = d.left - (e.clientX - d.x);
    stage.scrollTop = d.top - (e.clientY - d.y);
  };
  const endDrag = () => {
    drag.current = null;
  };
  const label = nav
    ? `File ${position + 1} of ${total}: ${item.alt}`
    : `Image ${index + 1} of ${count}: ${item.alt}`;
  const percent = `${Math.round(scale * 100)}%`;
  const imgStyle =
    zoomed && nw
      ? {
          width: `${Math.round(nw * scale)}px`,
          height: nh ? `${Math.round(nh * scale)}px` : "auto",
        }
      : undefined;
  const isBroken = broken.includes(item.id);
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
        // The backdrop and the empty stage of a fitted image close; the
        // image and controls don't.
        if (
          e.target === e.currentTarget ||
          (!zoomed && (e.target as HTMLElement).dataset.stage)
        )
          onClose();
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onChange={(e) => e.stopPropagation()}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={() => {
        gesture.current = null;
      }}
    >
      <div className="crew-lightbox-bar">
        <span className="crew-lightbox-count" aria-live="polite">
          {total > 1 ? `${position + 1} / ${total}` : ""}
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
      <div className="crew-lightbox-tools" role="toolbar" aria-label="Zoom">
        <span className="crew-lightbox-zoom">
          <button
            type="button"
            aria-label="Zoom out"
            disabled={isBroken || scale <= MIN_SCALE + 0.001}
            onClick={() => setScale(stepOut(scale))}
          >
            −
          </button>
          <output className="crew-lightbox-level" aria-label="Zoom level">
            {percent}
          </output>
          <button
            type="button"
            aria-label="Zoom in"
            disabled={isBroken || scale >= MAX_SCALE - 0.001}
            onClick={() => setScale(stepIn(scale))}
          >
            +
          </button>
        </span>
        <span className="crew-lightbox-fit" role="group" aria-label="Fit">
          <button
            type="button"
            aria-label="Fit to screen"
            aria-pressed={zoom === "fit"}
            disabled={isBroken}
            onClick={() => setZoom("fit")}
          >
            Fit
          </button>
          <button
            type="button"
            aria-label="Fit width"
            aria-pressed={zoom === "width"}
            disabled={isBroken}
            onClick={() => setZoom("width")}
          >
            Fit width
          </button>
          <button
            type="button"
            aria-label="Actual size"
            aria-pressed={zoom === 1}
            disabled={isBroken}
            onClick={() => setScale(1)}
          >
            Actual size
          </button>
        </span>
        <span className="crew-lightbox-actions">
          <a
            className="crew-lightbox-original"
            href={item.src}
            target="_blank"
            rel="noopener noreferrer"
            title="Open the original in a new tab"
          >
            <span aria-hidden="true">↗</span>Open original
          </a>
          {item.onDownload && (
            <button
              type="button"
              className="crew-lightbox-download"
              aria-label={`Download ${item.alt}`}
              title={`Download ${item.alt}`}
              onClick={item.onDownload}
            >
              <span aria-hidden="true">⤓ </span>Download
            </button>
          )}
        </span>
      </div>
      <div
        ref={stageRef}
        className={`crew-lightbox-stage${zoomed ? " is-zoomed" : ""}`}
        data-stage="1"
      >
        {isBroken ? (
          <p className="crew-lightbox-error" role="alert">
            Image unavailable: {item.alt}
          </p>
        ) : (
          <img
            ref={imgRef}
            key={item.src}
            src={item.src}
            alt={item.alt}
            width={item.width || undefined}
            height={item.height || undefined}
            style={imgStyle}
            decoding="async"
            draggable={false}
            onLoad={() => setLayout((n) => n + 1)}
            onDoubleClick={(e) => {
              // A double tap was already handled from the touch events.
              if (Date.now() - lastDoubleTap.current < 600) return;
              toggle({ x: e.clientX, y: e.clientY });
            }}
            onPointerDown={onImgPointerDown}
            onPointerMove={onImgPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
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
      {total > 1 && (
        <>
          <button
            type="button"
            className="crew-lightbox-prev"
            aria-label={`Previous ${unit}`}
            onClick={() => go(-1)}
          >
            ‹
          </button>
          <button
            type="button"
            className="crew-lightbox-next"
            aria-label={`Next ${unit}`}
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
