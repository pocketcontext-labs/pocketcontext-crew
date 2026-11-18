import { useEffect, useSyncExternalStore } from "react";
import { crewApi } from "./crewApi";
import { t } from "./i18n";
import {
  legacyRedirect,
  parseItemHash,
  reviewFocusFromHash,
  sharedFocusFromHash,
  viewFromHash,
  viewHashes,
} from "./itemLink";

/**
 * Record ids and Crew addresses written in rendered Markdown (0.29.0). Bare
 * 15-character ids become links titled with the record they name, resolved in
 * one batch per page by the `references` read; ids that resolve to nothing
 * stay plain text. Since 0.37.0 an inline code span that is exactly one id
 * links too (it stays code when it resolves to nothing), and an id right after
 * a link to the same record keeps the id as its text, the title in its
 * tooltip. Stored text never changes.
 */
export type Reference = {
  id: string;
  collection: string;
  title: string;
  path: string;
  url?: string;
  archived?: boolean;
  state?: string;
};

/** The link scheme the Markdown plugin gives a bare id until it renders. */
export const refScheme = "crew-ref:";

// A whole token: not part of a longer word, a slug (`-`), a path (`/`), a
// file name or a URL. All-digit tokens are numbers, not ids.
const idPattern = /(?<![\w\-/.@:#?=&%+])[a-z0-9]{15}(?![\w\-@]|\.\w)/g;
export function findIds(text: string): { id: string; index: number }[] {
  const out: { id: string; index: number }[] = [];
  for (const match of text.matchAll(idPattern))
    if (/[a-z]/.test(match[0]))
      out.push({ id: match[0], index: match.index ?? 0 });
  return out;
}

type MdNode = {
  type: string;
  value?: string;
  url?: string;
  children?: MdNode[];
};

/**
 * How a `crew-ref:` link was written: `code` when the id was an inline code
 * span (it stays code when it resolves to nothing), `beside` when it follows
 * a link to the same record, so it keeps the id as its text instead of
 * repeating the title.
 */
export type RefHint = { id: string; code: boolean; beside: boolean };
export function refHref(hint: RefHint): string {
  const flags = [hint.code && "code", hint.beside && "beside"].filter(Boolean);
  return refScheme + hint.id + (flags.length ? `?${flags.join("&")}` : "");
}
export function parseRefHref(href: string): RefHint | null {
  if (!href.startsWith(refScheme)) return null;
  const [id, query = ""] = href.slice(refScheme.length).split("?");
  const flags = query.split("&");
  return { id, code: flags.includes("code"), beside: flags.includes("beside") };
}

/** An inline code span that is exactly one record id. */
function codeId(value: string): string | null {
  const ids = findIds(value);
  return ids.length === 1 && ids[0].id === value ? value : null;
}

/** Whether a link's address names this record (a slug, a path or the id). */
function urlNames(url: string, id: string): boolean {
  if (url.startsWith(refScheme)) return parseRefHref(url)?.id === id;
  return new RegExp(`(?:^|[-/=])${id}(?:$|[?&#/])`).test(url);
}

// Spaces and opening punctuation between a link and an id beside it.
const joiner = /^[\s([{,:;–—-]*$/;
/**
 * Whether the siblings so far end with a link to this record followed only by
 * `before` and spaces or opening punctuation: `[Title](…/slug-<id>) (<id>)`.
 */
function besideLink(siblings: MdNode[], before: string, id: string): boolean {
  if (!joiner.test(before)) return false;
  let i = siblings.length - 1;
  if (!before && siblings[i]?.type === "text") {
    if (!joiner.test(siblings[i].value ?? "")) return false;
    i--;
  }
  const prev = siblings[i];
  return prev?.type === "link" && !!prev.url && urlNames(prev.url, id);
}

// Never inside a link (or a reference-style one), fenced code or raw HTML;
// those have no text children, so skipping links is enough. An inline code
// span that is exactly one id becomes a link as well (0.37.0).
const skip = new Set(["link", "linkReference", "definition"]);
function linkIds(node: MdNode) {
  if (!node.children || skip.has(node.type)) return;
  const next: MdNode[] = [];
  for (const child of node.children) {
    const id = child.type === "inlineCode" ? codeId(child.value ?? "") : null;
    if (id) {
      next.push({
        type: "link",
        url: refHref({ id, code: true, beside: besideLink(next, "", id) }),
        children: [{ type: "text", value: id }],
      });
      continue;
    }
    if (child.type !== "text" || !child.value) {
      linkIds(child);
      next.push(child);
      continue;
    }
    const text = child.value;
    let at = 0;
    for (const { id, index } of findIds(text)) {
      const before = text.slice(at, index);
      // Only the first id of a text node can sit right after a link.
      const beside = at === 0 && besideLink(next, before, id);
      if (index > at) next.push({ type: "text", value: before });
      next.push({
        type: "link",
        url: refHref({ id, code: false, beside }),
        children: [{ type: "text", value: id }],
      });
      at = index + id.length;
    }
    if (at === 0) next.push(child);
    else if (at < text.length)
      next.push({ type: "text", value: text.slice(at) });
  }
  node.children = next;
}
/** remark plugin: bare ids and inline-code ids become `crew-ref:` links. */
export function remarkCrewRefs() {
  return (tree: MdNode) => linkIds(tree);
}

// One shared cache for the page: every Prose on screen asks for its ids and
// one request (per 100 ids) answers them all. Answers are kept for a few
// minutes so a renamed record shows its new title after a while.
const freshFor = 5 * 60 * 1000;
const cache = new Map<string, { ref: Reference | null; at: number }>();
const queued = new Set<string>();
const inFlight = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

const notify = () => {
  version++;
  listeners.forEach((fn) => fn());
};

async function flush() {
  timer = null;
  const ids = [...queued];
  queued.clear();
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    batch.forEach((id) => inFlight.add(id));
    let found: Reference[] = [];
    let failed = false;
    try {
      found = await crewApi.references(batch);
    } catch {
      failed = true;
    }
    const at = Date.now();
    const byId = new Map(found.map((ref) => [ref.id, ref]));
    for (const id of batch) {
      inFlight.delete(id);
      // A failed request is not an answer: leave the id plain and ask again
      // next time it renders.
      if (!failed) cache.set(id, { ref: byId.get(id) ?? null, at });
    }
    notify();
  }
}

/** Asks for ids not already known; one request per tick for the whole page. */
export function requestReferences(ids: string[]) {
  const now = Date.now();
  for (const id of ids) {
    const known = cache.get(id);
    if (known && now - known.at < freshFor) continue;
    if (inFlight.has(id)) continue;
    queued.add(id);
  }
  if (queued.size && !timer) timer = setTimeout(() => void flush(), 0);
}

/** The resolved record, or null while unknown or unresolved. */
export function useReference(id: string): Reference | null {
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => version,
  );
  useEffect(() => {
    if (id) requestReferences([id]);
  }, [id]);
  return (id && cache.get(id)?.ref) || null;
}

/** Test seam: forget every answer. */
export function resetReferencesForTests() {
  cache.clear();
  queued.clear();
  inFlight.clear();
  if (timer) clearTimeout(timer);
  timer = null;
  notify();
}

// English labels, translated in referenceLabel (catalog: pages.ts).
const collectionLabels: Record<string, string> = {
  tasks: "Task",
  notes: "Note",
  reviews: "Review",
  buckets: "Bucket",
  agents: "Agent",
  artifacts: "Shared page",
  attachments: "File",
  comments: "Comment",
  events: "Activity",
  note_revisions: "Note revision",
  session_revisions: "Session instructions revision",
};
export function referenceLabel(ref: Reference): string {
  const kind = t(collectionLabels[ref.collection] ?? "Record");
  return ref.archived
    ? t("{kind} (archived) · {id}", { kind, id: ref.id })
    : `${kind} · ${ref.id}`;
}

/**
 * The reader address a link points at when it is this Crew install (a bare
 * `#/...` hash, or this page's own origin and path), in canonical form; null
 * for anything else, which stays an external link. `id` is the record the
 * address names, for its title.
 */
export function crewAddress(
  href: string,
): { hash: string; id: string } | null {
  let hash = "";
  if (href.startsWith("#/")) hash = href;
  else {
    let url: URL;
    try {
      url = new URL(href);
    } catch {
      return null;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.origin !== location.origin) return null;
    if (url.pathname !== location.pathname && url.pathname !== "/") return null;
    if (url.search || !url.hash.startsWith("#/")) return null;
    hash = url.hash;
  }
  hash = legacyRedirect(hash) ?? hash;
  const item = parseItemHash(hash);
  if (item) return { hash, id: item.file || item.comment || item.id };
  const review = reviewFocusFromHash(hash);
  if (review) return { hash, id: review };
  const shared = sharedFocusFromHash(hash);
  if (shared) return { hash, id: shared };
  if (hash === viewHashes.home || viewFromHash(hash) !== "home")
    return { hash, id: "" };
  return null;
}

/** A long URL shown shortened; the full one goes in the tooltip. */
export function displayUrl(url: string, max = 60): string {
  if (url.length <= max) return url;
  const plain = url.replace(/^https?:\/\//, "");
  const tail = 16;
  return `${plain.slice(0, max - tail - 1)}…${plain.slice(-tail)}`;
}
