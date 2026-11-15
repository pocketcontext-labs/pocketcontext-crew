import type { ReactNode, Ref } from "react";
import "./viewer.css";

/** Zoom controls of an image; files that are not images get them disabled. */
export type ViewerZoom = {
  percent: string;
  mode: "fit" | "width" | "actual" | "custom";
  canZoomIn: boolean;
  canZoomOut: boolean;
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
  fitWidth: () => void;
  actualSize: () => void;
};

/**
 * The one header of the file viewer, the same for images and every other file
 * (0.27.2): the name, the zoom group, then one cluster of previous, position,
 * next, Download, Open original and close. Every control is always rendered in
 * the same order and size; one that does not apply to the open file is
 * disabled in place, so stepping through files never moves a control under the
 * pointer.
 */
export default function ViewerBar({
  name,
  meta,
  position,
  total,
  unit,
  onStep,
  prevRef,
  nextRef,
  zoom,
  download,
  original,
  closeRef,
  closeLabel,
  onClose,
  label,
}: {
  name: string;
  /** Size and type, shown after the name. */
  meta?: string;
  /** Zero-based position in the list of files the viewer steps through. */
  position: number;
  total: number;
  unit: "file" | "image";
  onStep: (step: number) => void;
  prevRef?: Ref<HTMLButtonElement>;
  nextRef?: Ref<HTMLButtonElement>;
  zoom?: ViewerZoom;
  /** A Download control with the class crew-viewer-action, or null. */
  download: ReactNode;
  /** An Open original link with the class crew-viewer-action, or null. */
  original: ReactNode;
  closeRef?: Ref<HTMLButtonElement>;
  closeLabel: string;
  onClose: () => void;
  /** Spoken position, for example "File 3 of 17: notes.zip". */
  label: string;
}) {
  const many = total > 1;
  const off = !zoom;
  return (
    <div className="crew-viewer-bar">
      <div className="crew-viewer-title">
        <h2 className="crew-viewer-name" title={name}>
          {name}
        </h2>
        {meta && <span className="crew-viewer-meta">{meta}</span>}
        <span className="crew-visually-hidden" aria-live="polite">
          {label}
        </span>
      </div>
      <div className="crew-viewer-zoom" role="toolbar" aria-label="Zoom">
        <span className="crew-viewer-steps">
          <button
            type="button"
            aria-label="Zoom out"
            disabled={off || !zoom.canZoomOut}
            onClick={zoom?.zoomOut}
          >
            −
          </button>
          <output className="crew-viewer-level" aria-label="Zoom level">
            {zoom ? zoom.percent : "–"}
          </output>
          <button
            type="button"
            aria-label="Zoom in"
            disabled={off || !zoom.canZoomIn}
            onClick={zoom?.zoomIn}
          >
            +
          </button>
        </span>
        <span className="crew-viewer-fit" role="group" aria-label="Fit">
          <button
            type="button"
            aria-label="Fit to screen"
            aria-pressed={zoom?.mode === "fit"}
            disabled={off}
            onClick={zoom?.fit}
          >
            Fit
          </button>
          <button
            type="button"
            aria-label="Fit width"
            aria-pressed={zoom?.mode === "width"}
            disabled={off}
            onClick={zoom?.fitWidth}
          >
            Fit width
          </button>
          <button
            type="button"
            aria-label="Actual size"
            aria-pressed={zoom?.mode === "actual"}
            disabled={off}
            onClick={zoom?.actualSize}
          >
            Actual size
          </button>
        </span>
      </div>
      <div className="crew-viewer-cluster" role="group" aria-label="Viewer">
        <button
          ref={prevRef}
          type="button"
          className="crew-viewer-step"
          aria-label={`Previous ${unit}`}
          title={`Previous ${unit} (←)`}
          disabled={!many}
          onClick={() => onStep(-1)}
        >
          ‹
        </button>
        <span className="crew-viewer-count" aria-hidden="true">
          {position + 1} / {total}
        </span>
        <button
          ref={nextRef}
          type="button"
          className="crew-viewer-step"
          aria-label={`Next ${unit}`}
          title={`Next ${unit} (→)`}
          disabled={!many}
          onClick={() => onStep(1)}
        >
          ›
        </button>
        {download ?? (
          <button type="button" className="crew-viewer-action" disabled>
            <span aria-hidden="true">⤓</span>
            <span className="crew-viewer-action-label">Download</span>
          </button>
        )}
        {original ?? (
          <button
            type="button"
            className="crew-viewer-action"
            disabled
            title="Only images open as an original here"
          >
            <span aria-hidden="true">↗</span>
            <span className="crew-viewer-action-label">Open original</span>
          </button>
        )}
        <button
          ref={closeRef}
          type="button"
          className="crew-viewer-close"
          aria-label={closeLabel}
          title={`${closeLabel} (Esc)`}
          onClick={onClose}
        >
          ×
        </button>
      </div>
    </div>
  );
}

/** The control that a step through the files left focused: the new viewer
 *  focuses the same one, so repeated clicks or keys stay on one spot. */
export type ArrivedBy = "prev" | "next" | undefined;
