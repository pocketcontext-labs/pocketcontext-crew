/**
 * pdf.js, loaded on demand: the library and its worker are separate chunks
 * that only a PDF preview fetches. Nothing in a PDF is ever executed: the
 * display API is used without the viewer or its scripting sandbox, and eval
 * is off. The worker is a bundled same-origin asset (script-src 'self').
 *
 * The reader's asset route serves only .js, .css, .woff2 and .svg files, so
 * pdf.js gets no standard font data, CMaps, ICC profiles or WebAssembly
 * decoders: missing standard fonts fall back to system fonts, and the few
 * PDFs that need the others (non-embedded CJK CMaps, JPEG 2000 or JBIG2
 * images) render without that text or image. Nothing is fetched from
 * elsewhere.
 */
import type {
  DocumentInitParameters,
  PDFDocumentLoadingTask,
} from "pdfjs-dist/types/src/display/api";

export type Pdfjs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let loading: Promise<Pdfjs> | null = null;

/** The pdf.js module with its worker configured (imported once). */
export function loadPdfjs(): Promise<Pdfjs> {
  loading ??= Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
  ])
    .then(([lib, worker]) => {
      lib.GlobalWorkerOptions.workerSrc = worker.default;
      return lib;
    })
    .catch((error) => {
      loading = null;
      throw error;
    });
  return loading;
}

export type PdfOptions = DocumentInitParameters & {
  /** Removed in pdf.js 6, which never compiles with eval; see below. */
  isEvalSupported: false;
};

/** The getDocument options every preview uses, around the PDF's bytes. */
export function pdfOptions(data: Uint8Array): PdfOptions {
  return {
    data,
    // No code from the document. pdf.js 6 interprets PostScript functions
    // (it has no eval path, so the old option is gone); false keeps eval off
    // should an older pdf.js ever be used. XFA forms are not rendered.
    isEvalSupported: false,
    enableXfa: false,
    // Nothing fetched: the bytes are already here, and no font, CMap, ICC
    // or wasm URLs are given (see above).
    disableAutoFetch: true,
    disableStream: true,
    disableRange: true,
    useWorkerFetch: false,
    useWasm: false,
    useSystemFonts: true,
    stopAtErrors: false,
    // Errors only; the missing-font-data warnings are expected.
    verbosity: 0,
  };
}

/** Opens a PDF from its bytes. */
export async function openPdf(
  data: Uint8Array,
): Promise<PDFDocumentLoadingTask> {
  const lib = await loadPdfjs();
  return lib.getDocument(pdfOptions(data));
}
