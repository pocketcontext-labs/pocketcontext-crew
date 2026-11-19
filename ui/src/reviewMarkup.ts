/**
 * Review markup (Crew 0.38.0): three container directives, read as data, that
 * mark the texts a person pastes somewhere else.
 *
 *     :::variant{channel=linkedin}      one per channel; limit=N optional
 *     :::copy{label="WhatsApp reply"}   any paste-ready text
 *     :::note                           context for the reviewer, never copied
 *
 * The syntax is remark-directive's, but only these three containers, at the
 * top level and with valid attributes, are interpreted. Everything else
 * (unknown names, bad attributes, nesting, unclosed fences, text `:x` and leaf
 * `::x` directives) is ordinary text, exactly as before 0.38.0.
 *
 * parseReviewMarkup is the single line parser, a port of the server's
 * (pb_hooks/crew_markup.js); both are checked against
 * tests/fixtures/review_markup.json.
 * The Prose plugin (remarkCrewMarkup) lets remark-directive form a container
 * only on an opener line this parser accepted, so text, leaf and unknown
 * directives never become nodes and render from their exact source.
 */
import remarkDirective from "remark-directive";
import { markdownPlainText } from "./markdownText";

export const markupChannels = [
  "linkedin",
  "x",
  "email",
  "whatsapp",
  "slack",
  "generic",
] as const;
export type MarkupChannel = (typeof markupChannels)[number];
const defaultLimits: Partial<Record<string, number>> = {
  linkedin: 3000,
  x: 280,
};

export type MarkupBlock = {
  kind: "variant" | "copy" | "note";
  /** The channel, copy-<n> (1-based among copy blocks) or "" for a note. */
  target: string;
  channel?: string;
  label?: string;
  /** The effective character limit, or null. */
  limit: number | null;
  /** 1-based lines of the opener and the closer. */
  line: number;
  end: number;
  /** The Markdown between the opener and the closer. */
  content: string;
};
export type MarkupError = {
  code:
    | "review_markup_unknown_directive"
    | "review_markup_invalid_attribute"
    | "review_markup_nesting"
    | "review_markup_duplicate_channel"
    | "review_markup_unclosed";
  line: number;
  opener: string;
  message: string;
};
export type ReviewMarkup = {
  valid: boolean;
  errors: MarkupError[];
  /** Interpreted blocks in order (also those of a body with other errors). */
  blocks: MarkupBlock[];
};

/*
 * The line parser, rule for rule the server's (pb_hooks/crew_markup.js), so
 * both agree on what is interpreted and on every feedback target:
 * - an opener is 0-3 spaces, 3+ colons, a name, an optional [label] and
 *   {attributes} as remark-directive reads them, then only whitespace;
 *   anything else is text and not reported;
 * - every open container checks its closing fence first, outermost first
 *   (as micromark does), also inside fenced code;
 * - blocks are judged one at a time: one bad block leaves the others;
 * - all variants of a repeated channel stay text;
 * - copy-<n> counts only interpreted copy blocks.
 */
const PUNCT = /[\p{P}\p{S}]/u;
const SPACE = /\s/;
const punct = (c: string | undefined) => c !== undefined && PUNCT.test(c);
const space = (c: string | undefined) => c !== undefined && SPACE.test(c);
const blank = (s: string) => /^[ \t]*$/.test(s);

type Fence = { ch: string; len: number; depth: number };
function fenceOpen(line: string) {
  const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if (!m) return null;
  if (m[1][0] === "`" && m[2].includes("`")) return null;
  return { ch: m[1][0], len: m[1].length };
}
function fenceClose(line: string, fence: Fence) {
  const m = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
  return !!m && m[1][0] === fence.ch && m[1].length >= fence.len;
}
function closes(line: string, size: number) {
  const m = /^ {0,3}(:{3,})[ \t]*$/.exec(line);
  return !!m && m[1].length >= size;
}
function readName(cs: string[], i: number) {
  if (i >= cs.length || space(cs[i]) || punct(cs[i])) return null;
  let j = i + 1;
  while (j < cs.length && !space(cs[j]) && !(punct(cs[j]) && cs[j] !== "-" && cs[j] !== "_")) j++;
  if (cs[j - 1] === "-" || cs[j - 1] === "_") return null;
  return { name: cs.slice(i, j).join(""), end: j };
}
function readLabel(cs: string[], i: number) {
  let j = i + 1,
    balance = 0,
    size = 0;
  while (j < cs.length) {
    const c = cs[j];
    if (size > 999) return null;
    if (c === "\\" && ["[", "\\", "]"].includes(cs[j + 1])) {
      j += 2;
      size += 2;
      continue;
    }
    if (c === "[" && ++balance > 32) return null;
    if (c === "]") {
      if (!balance) return { label: cs.slice(i + 1, j).join(""), end: j + 1 };
      balance--;
    }
    j++;
    size++;
  }
  return null;
}
type Attr = { key: string; value: string };
function readAttributes(cs: string[], i: number): { attrs: Attr[]; end: number } | null {
  const attrs: Attr[] = [];
  const inert = (c: string | undefined) => c !== undefined && ['"', "'", "<", "=", ">", "`"].includes(c);
  let j = i + 1;
  for (;;) {
    while (j < cs.length && (cs[j] === " " || cs[j] === "\t")) j++;
    if (j >= cs.length) return null;
    const c = cs[j];
    if (c === "#" || c === ".") {
      let k = j + 1;
      if (k >= cs.length || inert(cs[k]) || ["#", ".", "}"].includes(cs[k]) || space(cs[k])) return null;
      while (k < cs.length && !["#", ".", "}"].includes(cs[k]) && !space(cs[k])) {
        if (inert(cs[k])) return null;
        k++;
      }
      attrs.push({ key: c, value: cs.slice(j + 1, k).join("") });
      j = k;
      continue;
    }
    if (space(c) || (punct(c) && c !== "-" && c !== "_")) {
      if (c !== "}") return null;
      return { attrs, end: j + 1 };
    }
    let k = j + 1;
    while (k < cs.length && !space(cs[k]) && !(punct(cs[k]) && !["-", ".", ":", "_"].includes(cs[k]))) k++;
    const key = cs.slice(j, k).join("");
    while (k < cs.length && (cs[k] === " " || cs[k] === "\t")) k++;
    if (cs[k] !== "=") {
      attrs.push({ key, value: "" });
      j = k;
      continue;
    }
    k++;
    while (k < cs.length && (cs[k] === " " || cs[k] === "\t")) k++;
    if (k >= cs.length || ["<", "=", ">", "`", "}"].includes(cs[k])) return null;
    if (cs[k] === '"' || cs[k] === "'") {
      const quote = cs[k];
      let q = k + 1;
      while (q < cs.length && cs[q] !== quote) q++;
      if (q >= cs.length) return null;
      attrs.push({ key, value: cs.slice(k + 1, q).join("") });
      q++;
      if (q < cs.length && cs[q] !== "}" && !space(cs[q])) return null;
      j = q;
      continue;
    }
    let q = k;
    while (q < cs.length && cs[q] !== "}" && !space(cs[q])) {
      if (inert(cs[q])) return null;
      q++;
    }
    attrs.push({ key, value: cs.slice(k, q).join("") });
    j = q;
  }
}
type Opener = { size: number; name: string; label: string | null; attrs: Attr[] };
function opener(line: string): Opener | null {
  const m = /^ {0,3}(:{3,})/.exec(line);
  if (!m) return null;
  const cs = Array.from(line);
  const named = readName(cs, Array.from(m[0]).length);
  if (!named) return null;
  let j = named.end;
  let label: string | null = null;
  let attrs: Attr[] = [];
  if (cs[j] === "[") {
    const l = readLabel(cs, j);
    if (!l) return null;
    label = l.label;
    j = l.end;
  }
  if (cs[j] === "{") {
    const a = readAttributes(cs, j);
    if (!a) return null;
    attrs = a.attrs;
    j = a.end;
  }
  if (!blank(cs.slice(j).join(""))) return null;
  return { size: m[1].length, name: named.name, label, attrs };
}

type Interpreted =
  | { code: MarkupError["code"]; message: string }
  | { kind: "variant"; channel: string; limit: number | null }
  | { kind: "copy"; label: string }
  | { kind: "note" };
function interpret(o: Opener): Interpreted {
  const invalid = (message: string) => ({ code: "review_markup_invalid_attribute" as const, message });
  if (o.name !== "variant" && o.name !== "copy" && o.name !== "note")
    return {
      code: "review_markup_unknown_directive",
      message: `Unknown directive :::${o.name}; only variant, copy and note are interpreted (this block shows as text)`,
    };
  if (o.label !== null) return invalid("Directive labels in [brackets] are not supported");
  const seen: Record<string, string> = {};
  for (const a of o.attrs) {
    if (a.key === "#" || a.key === ".") return invalid("#id and .class attributes are not supported");
    if (a.key in seen) return invalid(`Attribute ${a.key} appears twice`);
    seen[a.key] = a.value;
  }
  const allowed = { variant: ["channel", "limit"], copy: ["label"], note: [] as string[] }[o.name];
  const extra = Object.keys(seen).find((k) => !allowed.includes(k));
  if (extra !== undefined)
    return invalid(
      `Attribute ${extra} is not allowed on :::${o.name}` +
        (allowed.length ? ` (allowed: ${allowed.join(", ")})` : ""),
    );
  if (o.name === "variant") {
    const channel = seen.channel;
    if (!(markupChannels as readonly string[]).includes(channel))
      return invalid(
        channel === undefined
          ? `variant needs channel=${markupChannels.join("|")}`
          : `Unknown channel ${channel}; use one of ${markupChannels.join(", ")}`,
      );
    let limit = defaultLimits[channel] ?? null;
    if (seen.limit !== undefined) {
      if (!/^[0-9]{1,6}$/.test(seen.limit) || +seen.limit < 1 || +seen.limit > 100000)
        return invalid("limit must be an integer from 1 to 100000");
      limit = Number(seen.limit);
    }
    return { kind: "variant", channel, limit };
  }
  if (o.name === "copy") {
    const label = seen.label;
    if (label === undefined || !label.trim() || Array.from(label).length > 80)
      return invalid('copy needs label="..." of 1 to 80 characters');
    return { kind: "copy", label };
  }
  return { kind: "note" };
}

/** Parses a body's review markup: what renders as blocks and what is wrong. */
export function parseReviewMarkup(body: string): ReviewMarkup {
  const lines = String(body ?? "").split(/\r\n|\r|\n/);
  const errors: MarkupError[] = [];
  type Entry = {
    size: number;
    line: number;
    end: number;
    opener: string;
    closed: boolean;
    nested: boolean;
    result?: Interpreted;
  };
  const top: Entry[] = [];
  let stack: Entry[] = [];
  let fence: Fence | null = null;
  const error = (code: MarkupError["code"], entry: Entry, message: string) =>
    errors.push({ code, line: entry.line, opener: entry.opener, message });
  lines.forEach((line, index) => {
    const at = stack.findIndex((s) => closes(line, s.size));
    if (at >= 0) {
      for (const s of stack.slice(at)) {
        s.closed = true;
        s.end = index + 1;
      }
      stack = stack.slice(0, at);
      if (fence && fence.depth > stack.length) fence = null;
      return;
    }
    if (fence) {
      if (fenceClose(line, fence)) fence = null;
      return;
    }
    const f = fenceOpen(line);
    if (f) {
      fence = { ...f, depth: stack.length };
      return;
    }
    const o = opener(line);
    if (!o) return;
    const trimmed = Array.from(line.trim());
    const entry: Entry = {
      size: o.size,
      line: index + 1,
      end: 0,
      opener: trimmed.length > 200 ? trimmed.slice(0, 200).join("") + "…" : trimmed.join(""),
      closed: false,
      nested: false,
    };
    if (stack.length) {
      for (const s of stack) s.nested = true;
      error(
        "review_markup_nesting",
        entry,
        `Directives cannot be nested; close the outer block before opening :::${o.name}`,
      );
    } else {
      entry.result = interpret(o);
      top.push(entry);
    }
    stack.push(entry);
  });
  const valid: Entry[] = [];
  for (const entry of top) {
    const r = entry.result!;
    if ("code" in r) error(r.code, entry, r.message);
    else if (!entry.closed)
      error("review_markup_unclosed", entry, `Add a closing line of at least ${entry.size} colons after this block`);
    else if (!entry.nested) valid.push(entry);
  }
  const channelOf = (e: Entry) => (e.result && "kind" in e.result && e.result.kind === "variant" ? e.result.channel : "");
  const count: Record<string, number> = {};
  for (const e of valid) if (channelOf(e)) count[channelOf(e)] = (count[channelOf(e)] || 0) + 1;
  const seen = new Set<string>();
  for (const e of valid) {
    const channel = channelOf(e);
    if (!channel || count[channel] < 2) continue;
    if (seen.has(channel))
      error(
        "review_markup_duplicate_channel",
        e,
        `A second variant for channel ${channel}; use one variant per channel in each body`,
      );
    seen.add(channel);
  }
  const blocks: MarkupBlock[] = [];
  let copies = 0;
  for (const e of valid) {
    const r = e.result as Exclude<Interpreted, { code: string }>;
    const where = { line: e.line, end: e.end, content: lines.slice(e.line, e.end - 1).join("\n") };
    if (r.kind === "variant") {
      if (count[r.channel] > 1) continue;
      blocks.push({ kind: "variant", target: r.channel, channel: r.channel, limit: r.limit, ...where });
    } else if (r.kind === "copy")
      blocks.push({ kind: "copy", target: `copy-${++copies}`, label: r.label, limit: null, ...where });
    else blocks.push({ kind: "note", target: "", limit: null, ...where });
  }
  errors.sort((a, b) => a.line - b.line);
  return { valid: errors.length === 0, errors, blocks };
}

const sizeOf = (text: string) => Array.from(text).length;

/** Whether a body has blocks to copy (variants or copy blocks). */
export const copyBlocks = (markup: ReviewMarkup) =>
  markup.blocks.filter((b) => b.kind !== "note");

/**
 * The body without its interpreted markup: opener and closer lines removed,
 * notes removed with their text. Invalid markup stays, as it renders as text.
 */
export function stripReviewMarkup(markdown: string): string {
  const markup = parseReviewMarkup(markdown);
  if (!markup.blocks.length) return markdown;
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const drop = new Set<number>();
  for (const block of markup.blocks) {
    if (block.kind === "note") for (let l = block.line; l <= block.end; l++) drop.add(l);
    else drop.add(block.line).add(block.end);
  }
  return lines.filter((_, i) => !drop.has(i + 1)).join("\n");
}

/** What a block's Copy puts on the clipboard. */
export const blockCopyText = (block: MarkupBlock) => markdownPlainText(block.content);

/**
 * Characters as a person counts them (code points); on X every http(s) URL
 * counts as 23, as X shortens it.
 */
export function characterCount(text: string, channel?: string): number {
  if (channel !== "x") return sizeOf(text);
  let urls = 0;
  const rest = text.replace(/https?:\/\/[^\s<>"]*[^\s<>".,;:!?)\]'*_]/gi, () => {
    urls += 1;
    return "";
  });
  return sizeOf(rest) + urls * 23;
}

/** The plugin's options: the blocks parseReviewMarkup found in the body. */
export type CrewMarkupOptions = { blocks: MarkupBlock[] };

/* Minimal shapes of the unified processor and micromark constructs used here
   (their packages are not direct dependencies). */
type Construct = {
  tokenize: (this: { now(): { line: number } }, ...args: unknown[]) => unknown;
  [key: string]: unknown;
};
type MicromarkExtension = { flow?: Record<number, Construct[]>; text?: unknown };
type MdNode = {
  type: string;
  position?: { start: { line: number } };
  children?: MdNode[];
  data?: Record<string, unknown>;
};

/**
 * The Prose plugin: remark-directive's container syntax, gated to the opener
 * lines parseReviewMarkup accepted (text and leaf directives are left out
 * entirely), and each accepted container turned into a <section> that Prose
 * renders as a Crew block. Consecutive variant and copy blocks are grouped so
 * a wide dialog can set them side by side.
 */
export function remarkCrewMarkup(
  this: { data(): Record<string, unknown[] | undefined> },
  options: CrewMarkupOptions,
) {
  remarkDirective.call(this as never);
  const data = this.data();
  const extensions = data.micromarkExtensions as MicromarkExtension[];
  const generic = extensions[extensions.length - 1];
  const container = generic.flow![58][0];
  const byLine = new Map(options.blocks.map((b, i) => [b.line, i]));
  const gated: Construct = {
    ...container,
    tokenize(...args: unknown[]) {
      const nok = args[2];
      return byLine.has(this.now().line) ? container.tokenize.apply(this, args) : nok;
    },
  };
  extensions[extensions.length - 1] = { flow: { 58: [gated] } };
  return (tree: MdNode) => {
    const walk = (node: MdNode) => {
      if (!node.children) return;
      node.children.forEach(walk);
      const grouped: MdNode[] = [];
      let run: MdNode[] = [];
      const flush = () => {
        if (run.length)
          grouped.push({
            type: "crewBlocks",
            children: run,
            data: { hName: "div", hProperties: { className: ["crew-blocks"] } },
          });
        run = [];
      };
      for (const child of node.children) {
        const index =
          child.type === "containerDirective"
            ? byLine.get(child.position?.start.line ?? -1)
            : undefined;
        if (index === undefined) {
          flush();
          grouped.push(child);
          continue;
        }
        child.data = { hName: "section", hProperties: { dataCrewBlock: String(index) } };
        if (options.blocks[index].kind === "note") {
          flush();
          grouped.push(child);
        } else run.push(child);
      }
      flush();
      node.children = grouped;
    };
    walk(tree);
  };
}
