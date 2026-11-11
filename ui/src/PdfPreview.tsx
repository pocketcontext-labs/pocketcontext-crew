/**
 * PDF preview: one page at a time on a canvas, with previous/next, page
 * count, zoom and fit width (the default; on phones it is the only sensible
 * size). Loaded lazily with pdf.js (see pdfjs.ts); annotations are drawn as
 * part of the page, with no forms, links or scripts.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  RenderTask,
} from "pdfjs-dist";
import { openPdf } from "./pdfjs";

const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
const STEP = 1.25;
// Keep each canvas under ~16 megapixels (memory on phones).
const MAX_PIXELS = 16_000_000;

export type PdfZoom = "fit" | number;

export default function PdfPreview({
  data,
  name,
  onError,
}: {
  /** The PDF's bytes (pdf.js may transfer them to its worker). */
  data: Uint8Array;
  name: string;
  /** The document could not be opened; `password` for protected PDFs. */
  onError: (reason: "password" | "invalid") => void;
}) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState<PdfZoom>("fit");
  const [scale, setScale] = useState(1);
  const [rendering, setRendering] = useState(true);
  const [pageError, setPageError] = useState("");
  const [width, setWidth] = useState(0);
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    let alive = true;
    let task: PDFDocumentLoadingTask | null = null;
    // A copy: pdf.js transfers its buffer to the worker.
    openPdf(data.slice()).then(
      (loading) => {
        task = loading;
        if (!alive) return void loading.destroy();
        loading.promise.then(
          (opened) => alive && setDoc(opened),
          (error: unknown) => {
            if (!alive) return;
            const isPassword =
              (error as { name?: string })?.name === "PasswordException";
            onErrorRef.current(isPassword ? "password" : "invalid");
          },
        );
      },
      () => alive && onErrorRef.current("invalid"),
    );
    return () => {
      alive = false;
      void task?.destroy();
    };
  }, [data]);

  // Fit width follows the stage's width (phone rotation, dialog resizing).
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => {
      const style = getComputedStyle(el);
      setWidth(
        el.clientWidth -
          (parseFloat(style.paddingLeft) || 0) -
          (parseFloat(style.paddingRight) || 0),
      );
    };
    measure();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!doc || !canvas.current) return;
    let alive = true;
    let task: RenderTask | null = null;
    setRendering(true);
    setPageError("");
    doc.getPage(page).then(
      (pdfPage) => {
        if (!alive || !canvas.current) return;
        const base = pdfPage.getViewport({ scale: 1 });
        const fit = width > 0 ? Math.max(width - 2, 50) / base.width : 1;
        const next =
          zoom === "fit" ? Math.min(Math.max(fit, MIN_SCALE), MAX_SCALE) : zoom;
        setScale(next);
        const viewport = pdfPage.getViewport({ scale: next });
        let ratio = window.devicePixelRatio || 1;
        const pixels = viewport.width * viewport.height * ratio * ratio;
        if (pixels > MAX_PIXELS) ratio *= Math.sqrt(MAX_PIXELS / pixels);
        const el = canvas.current;
        el.width = Math.floor(viewport.width * ratio);
        el.height = Math.floor(viewport.height * ratio);
        el.style.width = `${Math.floor(viewport.width)}px`;
        el.style.height = `${Math.floor(viewport.height)}px`;
        task = pdfPage.render({
          canvas: el,
          viewport,
          transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
        });
        task.promise.then(
          () => alive && setRendering(false),
          (error: unknown) => {
            if (!alive) return;
            if (
              (error as { name?: string })?.name ===
              "RenderingCancelledException"
            )
              return;
            setRendering(false);
            setPageError("This page could not be shown.");
          },
        );
      },
      () => {
        if (!alive) return;
        setRendering(false);
        setPageError("This page could not be shown.");
      },
    );
    return () => {
      alive = false;
      task?.cancel();
    };
  }, [doc, page, zoom, width]);

  const pages = doc?.numPages ?? 0;
  const go = (step: number) =>
    setPage((p) => Math.min(Math.max(p + step, 1), Math.max(pages, 1)));
  const zoomBy = (factor: number) =>
    setZoom(() =>
      Math.min(
        Math.max(Math.round(scale * factor * 100) / 100, MIN_SCALE),
        MAX_SCALE,
      ),
    );
  return (
    <div className="crew-pdf">
      <div className="crew-pdf-toolbar" role="toolbar" aria-label="PDF pages">
        <button
          type="button"
          onClick={() => go(-1)}
          disabled={!doc || page <= 1}
          aria-label="Previous page"
        >
          ‹
        </button>
        <span className="crew-pdf-count" aria-live="polite">
          {doc ? `Page ${page} of ${pages}` : "Opening…"}
        </span>
        <button
          type="button"
          onClick={() => go(1)}
          disabled={!doc || page >= pages}
          aria-label="Next page"
        >
          ›
        </button>
        <span className="crew-pdf-spacer" />
        <button
          type="button"
          onClick={() => zoomBy(1 / STEP)}
          disabled={!doc || scale <= MIN_SCALE}
          aria-label="Zoom out"
        >
          −
        </button>
        <span className="crew-pdf-zoom">{Math.round(scale * 100)}%</span>
        <button
          type="button"
          onClick={() => zoomBy(STEP)}
          disabled={!doc || scale >= MAX_SCALE}
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => setZoom("fit")}
          disabled={!doc}
          aria-pressed={zoom === "fit"}
        >
          Fit width
        </button>
      </div>
      <div
        ref={stage}
        className="crew-pdf-stage"
        aria-busy={rendering}
        tabIndex={0}
        aria-label={`${name}, page ${page}`}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "PageDown") {
            e.preventDefault();
            go(1);
          } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
            e.preventDefault();
            go(-1);
          }
        }}
      >
        {pageError && <p className="crew-preview-note">{pageError}</p>}
        <canvas
          ref={canvas}
          className="crew-pdf-page"
          role="img"
          aria-label={`Page ${page} of ${name}`}
          hidden={!!pageError}
        />
      </div>
    </div>
  );
}
