import { copyBlocks, parseReviewMarkup, stripReviewMarkup } from "./reviewMarkup";

/**
 * Markdown to readable plain text for compact previews (agent cards, chips).
 *
 * A card is one button, so it cannot hold rendered links; instead the Markdown
 * markers are removed and each block (paragraph, heading, list item) becomes
 * its own line. Lines inside one paragraph are joined with spaces, so a brief
 * without Markdown reads exactly as before. Raw HTML is dropped, never
 * rendered: the result is plain text for React to escape.
 */
export function markdownText(markdown: string): string {
  // Review markup (0.38.0): its marker lines and notes never show.
  markdown = stripReviewMarkup(markdown);
  const blocks: string[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    const text = inline(paragraph.join(" "));
    if (text) blocks.push(text);
    paragraph = [];
  };
  const push = (text: string) => {
    flush();
    const clean = inline(text);
    if (clean) blocks.push(clean);
  };
  let fence = "";
  for (const raw of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(raw);
    if (fence) {
      if (
        fenceMatch &&
        fenceMatch[1][0] === fence[0] &&
        fenceMatch[1].length >= fence.length
      ) {
        fence = "";
        flush();
      } else if (raw.trim()) {
        paragraph.push(raw.trim());
      }
      continue;
    }
    if (fenceMatch) {
      flush();
      fence = fenceMatch[1];
      continue;
    }
    let line = raw.replace(/^\s{0,3}(>\s?)+/, "");
    if (!line.trim()) {
      flush();
      continue;
    }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      continue;
    }
    // A setext underline turns the paragraph above into a heading.
    if (/^\s{0,3}(=+|-+)\s*$/.test(line) && paragraph.length) {
      flush();
      continue;
    }
    const heading = /^\s{0,3}#{1,6}(?:\s+(.*?))?(?:\s+#+)?\s*$/.exec(line);
    if (heading) {
      push(heading[1] || "");
      continue;
    }
    // Table separator rows carry no text; other rows keep their cells.
    if (/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line))
      continue;
    if (/^\s*\|.*\|\s*$/.test(line)) {
      push(
        line
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((cell) => cell.trim())
          .filter(Boolean)
          .join(" · "),
      );
      continue;
    }
    const item = /^\s*([-*+]|\d{1,9}[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/.exec(line);
    if (item) {
      flush();
      paragraph.push(
        /^\d/.test(item[1]) ? `${item[1]} ${item[2]}` : `• ${item[2]}`,
      );
      continue;
    }
    line = line.trim();
    paragraph.push(line);
  }
  flush();
  return blocks.join("\n");
}

function inline(text: string): string {
  return stripInline(text, false).replace(/\s+/g, " ").trim();
}

/** A link as plain text: its text, plus the address when it goes outside. */
function linkText(label: string, href: string, withUrl: boolean): string {
  const url = href.trim().replace(/\s+["'(].*$/, "");
  if (!withUrl || !/^(https?:|mailto:)/i.test(url)) return label;
  const bare = url.replace(/^mailto:/i, "");
  return label === url || label === bare ? label : `${label} (${bare})`;
}

/** Inline Markdown markers removed; whitespace and line breaks kept. */
function stripInline(text: string, withUrls: boolean): string {
  // Escaped characters are set aside first, so `\*` never reads as emphasis.
  const escaped: string[] = [];
  return (
    text
      .replace(/\\([\\`*_{}[\]()#+\-.!|~>])/g, (_, ch: string) => {
        escaped.push(ch);
        return `\uE000${escaped.length - 1}\uE001`;
      })
      // Raw HTML is dropped (comments, then tags).
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<(https?:\/\/[^>\s]+)>/g, "$1")
      .replace(/<\/?[A-Za-z][^>]*>/g, "")
      // Images keep their alt text; links keep their text.
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/!\[([^\]]*)\]\[[^\]]*\]/g, "$1")
      .replace(/\[([^\]]+)\]\(([^)]*)\)/g, (_, label: string, href: string) =>
        linkText(label, href, withUrls),
      )
      .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
      // Inline code keeps its content.
      .replace(
        /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g,
        (_, _ticks, code: string) => code.trim(),
      )
      // Emphasis: bold, italics and strikethrough.
      .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2")
      .replace(/(^|[^\w*])\*(?=\S)([^*]*?\S)\*(?![\w*])/g, "$1$2")
      .replace(/(^|[^\w_])_(?=\S)([^_]*?\S)_(?![\w_])/g, "$1$2")
      .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "$1")
      // Backslash escapes show the escaped character.
      .replace(/\uE000(\d+)\uE001/g, (_, i: string) => escaped[Number(i)])
  );
}

/**
 * Markdown as plain text to paste into a chat app (a review draft's Copy):
 * no Markdown markers, every line break and paragraph kept, list items as
 * "• " (numbers stay), nested items indented, links as their text plus the
 * address in brackets when they go outside Crew, code blocks verbatim, review
 * markup without its `:::` lines and notes. Lines
 * of a paragraph stay separate lines, because review drafts show their line
 * breaks.
 */
export function markdownPlainText(markdown: string): string {
  // Review markup (0.38.0): no marker lines; notes are never copied.
  markdown = stripReviewMarkup(markdown);
  const out: string[] = [];
  let fence = "";
  for (const raw of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(raw);
    if (fence) {
      if (
        fenceMatch &&
        fenceMatch[1][0] === fence[0] &&
        fenceMatch[1].length >= fence.length
      )
        fence = "";
      else out.push(raw.replace(/\s+$/, ""));
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1];
      continue;
    }
    // A hard break (two trailing spaces or a backslash) is a line break anyway.
    let line = raw
      .replace(/^\s{0,3}(>\s?)+/, "")
      .replace(/(\\| {2,})$/, "")
      .replace(/\s+$/, "");
    if (!line.trim()) {
      out.push("");
      continue;
    }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push("");
      continue;
    }
    // A setext underline: the line above already reads as the heading.
    if (/^\s{0,3}(=+|-+)\s*$/.test(line) && out.length && out.at(-1)) continue;
    const heading = /^\s{0,3}#{1,6}(?:\s+(.*?))?(?:\s+#+)?\s*$/.exec(line);
    if (heading) {
      out.push(stripInline(heading[1] || "", true).trim());
      continue;
    }
    if (/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line))
      continue;
    if (/^\s*\|.*\|\s*$/.test(line)) {
      out.push(
        line
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((cell) => stripInline(cell, true).trim())
          .filter(Boolean)
          .join(" · "),
      );
      continue;
    }
    const item = /^(\s*)([-*+]|\d{1,9}[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/.exec(
      line,
    );
    if (item) {
      const indent = "  ".repeat(
        Math.floor(item[1].replace(/\t/g, "    ").length / 2),
      );
      const marker = /^\d/.test(item[2]) ? item[2] : "•";
      const box = item[3] ? (item[3] === " " ? "☐ " : "☑ ") : "";
      out.push(`${indent}${marker} ${box}${stripInline(item[4], true).trim()}`);
      continue;
    }
    line = stripInline(line, true);
    out.push(line.trim());
  }
  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+|\n+$/g, "");
}

/** Readable card text: Markdown markers would otherwise show, and could be cut in half. */
const cardText = (markdown: string) =>
  markdown
    .replace(/^```.*$/gm, "")
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+)/gm, "")
    .replace(/!\[[^\]]*\]\([^)]*\)\n?/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*|__|~~|`/g, "")
    .replace(/\*(\S[^*\n]*)\*/g, "$1")
    .replace(/\n{2,}/g, "\n")
    .trim();

/** Card previews choose from the complete parsed source before shortening it.
 * The first variant takes precedence over separate copy blocks; context-only
 * drafts may still have ordinary paragraphs outside their reviewer notes. */
export function markdownExcerpt(markdown: string, limit?: number, plain = cardText) {
  const markup = markdown.includes(":::") ? parseReviewMarkup(markdown) : null;
  const blocks = markup ? copyBlocks(markup) : [];
  const first = blocks.find((block) => block.kind === "variant") ?? blocks[0];
  const structured = !!markup?.blocks.length;
  let text = structured ? markdownText(first?.content ?? markdown) : plain(markdown);
  if (limit && text.length > limit) {
    // Keep whole words when possible, or whole code points for an unbroken word.
    const chars = Array.from(text);
    if (chars.length > limit) {
      let end = limit - 1;
      while (end > 0 && !/\s/u.test(chars[end])) end--;
      text = chars.slice(0, end || limit - 1).join("").trimEnd() + "…";
    }
  }
  return { text, blocks, structured };
}

/** The first block of a brief as one line, for a tooltip or a chip. */
export function markdownSummary(markdown: string): string {
  return markdownExcerpt(markdown, undefined, markdownText).text.split("\n")[0] || "";
}
