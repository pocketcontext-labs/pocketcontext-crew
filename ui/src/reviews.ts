import { val, type Row } from "./crewApi";
import type { Attachment } from "./attachmentsApi";

export type ReviewOption = { key: string; label: string; body: string };
export type OptionDecision = {
  key: string;
  decision: "approved" | "rejected";
  note?: string;
};
export function objects(value: unknown): Record<string, unknown>[] {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  return Array.isArray(value)
    ? value.filter((x) => x && typeof x === "object")
    : [];
}
export const reviewOptions = (row: Row) =>
  objects(row.options) as ReviewOption[];
export const optionDecisions = (row: Row) =>
  objects(row.option_decisions) as OptionDecision[];

/** Metadata is immutable. Resolve only files named by the frozen id/hash pairs,
 * including archived files, never attachments added after submission. */
export function reviewFiles(row: Row, files: Attachment[]) {
  const snapshot = objects(row.attachments);
  const text = [
    val(row, "draft"),
    ...reviewOptions(row).map((o) => o.body),
  ].join("\n");
  return snapshot
    .flatMap((ref) => {
      const file = files.find(
        (a) => a.id === ref.id && (!ref.sha256 || a.sha256 === ref.sha256),
      );
      return file ? [{ ...file, archived: false }] : [];
    })
    .sort((a, b) => {
      const rank = (id: string) => {
        const at = text.indexOf(`attachment:${id}`);
        return at < 0 ? Infinity : at;
      };
      return rank(a.id) - rank(b.id);
    });
}
export function decisionSummary(row: Row): string {
  const choices = optionDecisions(row);
  const options = reviewOptions(row);
  return ["approved", "rejected"]
    .flatMap((decision) => {
      const labels = choices
        .filter((x) => x.decision === decision)
        .map((x) => options.find((o) => o.key === x.key)?.label || x.key);
      return labels.length
        ? [
            `${decision === "approved" ? "Approved" : "Rejected"}: ${labels.join(", ")}`,
          ]
        : [];
    })
    .join("; ");
}

/** Legacy review warning; the server validates new submissions too. */
export function localFilePaths(text: string): string[] {
  // Remove web URLs before looking for absolute Unix, home, Windows and file URLs.
  const clean = text.replace(/https?:\/\/[^\s<>"'`]+/gi, "");
  const pattern =
    /(?:^|[\s(<\["'`])((?:file:\/\/|[A-Za-z]:[\\/]|\\\\|~\/|\.{1,2}[\\/]|\/)[^\n\r<>"'`]*?\.(?:png|jpe?g|gif|webp|avif|svg|bmp|tiff?|heic|pdf|docx?|xlsx?|pptx?|txt|md|csv|json|mp[34]|wav|ogg|mov|webm))(?=$|[\s)\]>"'`,;:!?.])/gi;
  return [...new Set(Array.from(clean.matchAll(pattern), (m) => m[1]))];
}
export function missingReviewEvidence(
  row: Row,
  files: Attachment[],
  loaded: boolean,
): string[] {
  const text = [
    val(row, "draft"),
    ...reviewOptions(row).map((o) => o.body),
  ].join("\n");
  const missing = localFilePaths(text);
  if (loaded) {
    const ids = new Set(files.map((a) => a.id));
    for (const ref of objects(row.attachments))
      if (!ids.has(String(ref.id))) missing.push(`attachment:${ref.id}`);
    for (const match of text.matchAll(/attachment:([A-Za-z0-9_-]+)/g))
      if (!ids.has(match[1])) missing.push(match[0]);
  }
  return [...new Set(missing)];
}
