import { val, type Row } from "./crewApi";
import { markdownPlainText } from "./markdownText";
import { blockCopyText, parseReviewMarkup } from "./reviewMarkup";
import { reviewOptions } from "./reviews";

/** Keep paste-ready text, reviewer notes and unmarked prose separate without
 * changing the frozen source. Feedback targets retain their original order. */
function splitBody(source: string) {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks = parseReviewMarkup(source).blocks;
  const paste = blocks.filter((b) => b.kind !== "note");
  const notes: string[] = [];
  const outside: string[] = [];
  let last = 0;
  for (const block of blocks) {
    outside.push(lines.slice(last, block.line - 1).join("\n"));
    if (block.kind === "note") notes.push(block.content.trim());
    last = block.end;
  }
  outside.push(lines.slice(last).join("\n"));
  const prose = outside
    .filter((s) => s.trim())
    .join("\n\n")
    .trim();
  const body = paste.length
    ? paste.map((b) => lines.slice(b.line - 1, b.end).join("\n")).join("\n\n")
    : prose;
  const copy = paste.length
    ? paste.map(blockCopyText).join("\n\n")
    : markdownPlainText(body);
  return { body, copy, paste, notes, prose };
}

const paragraphs = (s: string) =>
  s
    .trim()
    .split(/\n\s*\n/)
    .filter(Boolean);
const matchText = (s: string) =>
  markdownPlainText(s).trim().replace(/\s+/g, " ");

/** Older reviews put the alternatives and their labels in the snapshot as
 * well as in options. Keep any other submitted prose in the reviewer's note. */
export function reviewPresentation(row: Row) {
  const draft = splitBody(val(row, "draft"));
  const options = reviewOptions(row).map((option) => ({
    ...option,
    ...splitBody(option.body),
  }));
  const notes = new Set(draft.notes.filter(Boolean));
  if (!options.length) {
    if (draft.paste.length && draft.prose) notes.add(draft.prose);
    return { draft, options, notes: [...notes] };
  }

  const duplicates = new Set<string>();
  const labels = new Set<string>();
  for (const option of options) {
    labels.add(matchText(option.label));
    for (const note of option.notes) if (note) notes.add(note);
    if (option.paste.length && option.prose) notes.add(option.prose);
    const bodies = option.paste.length
      ? option.paste.map((b) => b.content)
      : [option.body];
    for (const body of bodies)
      for (const paragraph of paragraphs(body))
        duplicates.add(matchText(paragraph));
  }
  const repeated = (text: string) => {
    if (duplicates.has(text)) return true;
    const header = text.replace(/:$/, "");
    return (
      labels.has(header) || labels.has(header.replace(/\s+\([^()]*\)$/, ""))
    );
  };
  const draftParts = [draft.prose, ...draft.paste.map((b) => b.content)];
  for (const part of draftParts) {
    const retained = paragraphs(part).flatMap((paragraph) => {
      if (repeated(matchText(paragraph))) return [];
      // Legacy headings can directly precede the reply with a single newline.
      const lines = paragraph.split("\n");
      const start = lines.findIndex((line) => !repeated(matchText(line)));
      if (start < 0) return [];
      const rest = lines.slice(start).join("\n").trim();
      return rest && !repeated(matchText(rest)) ? [rest] : [];
    });
    if (retained.length) notes.add(retained.join("\n\n"));
  }
  return { draft, options, notes: [...notes] };
}
export type PresentedReview = ReturnType<typeof reviewPresentation>;
