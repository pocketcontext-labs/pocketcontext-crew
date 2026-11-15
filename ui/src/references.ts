import { useEffect, useSyncExternalStore } from "react";
import { crewApi } from "./crewApi";
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
 * stay plain text. Stored text never changes.
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
// Never inside a link (or a reference-style one), code or raw HTML; code and
// HTML have no text children, so skipping links is enough.
const skip = new Set(["link", "linkReference", "definition"]);
function linkIds(node: MdNode) {
  if (!node.children || skip.has(node.type)) return;
  const next: MdNode[] = [];
  for (const child of node.children) {
    if (child.type !== "text" || !child.value) {
      linkIds(child);
      next.push(child);
      continue;
    }
    const text = child.value;
    let at = 0;
    for (const { id, index } of findIds(text)) {
      if (index > at) next.push({ type: "text", value: text.slice(at, index) });
      next.push({
        type: "link",
        url: refScheme + id,
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
/** remark plugin: bare record ids become `crew-ref:` links. */
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
  const kind = collectionLabels[ref.collection] ?? "Record";
  const state = ref.archived ? " (archived)" : "";
  return `${kind}${state} · ${ref.id}`;
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
