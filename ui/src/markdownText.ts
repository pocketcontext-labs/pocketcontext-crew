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
  return (
    text
      // Raw HTML is dropped (comments, then tags).
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<(https?:\/\/[^>\s]+)>/g, "$1")
      .replace(/<\/?[A-Za-z][^>]*>/g, "")
      // Images keep their alt text; links keep their text.
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/!\[([^\]]*)\]\[[^\]]*\]/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
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
      .replace(/\\([\\`*_{}[\]()#+\-.!|~>])/g, "$1")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** The first block of a brief as one line, for a tooltip or a chip. */
export function markdownSummary(markdown: string): string {
  return markdownText(markdown).split("\n")[0] || "";
}
