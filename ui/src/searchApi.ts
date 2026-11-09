import { pb } from "./api";
import { val, type Row } from "./crewApi";

/**
 * Global search: the request and response of `POST /api/crew/search`, the
 * excerpt highlight format, and the `#/search?q=` address.
 */

export type SearchHit = {
  collection: "tasks" | "notes";
  id: string;
  title: string;
  path: string;
  url?: string;
  excerpt: string;
  revision: number;
  updated: string;
  bucket?: string;
  bucket_name?: string;
  status?: string;
  readiness?: string;
  assigned_agent?: string;
  assigned_agent_name?: string;
};
export type SearchResult = {
  items: SearchHit[];
  hasMore: boolean;
  nextOffset: number | null;
  generation: string;
};
export type SearchRequest = {
  query: string;
  limit?: number;
  offset?: number;
  archived?: boolean;
  generation?: string;
};

// The server's limits (internal/crewread/searchread).
export const maxQueryBytes = 1024;
export const maxTerms = 32;
export const maxOffset = 10000;

const str = (raw: unknown) => (typeof raw === "string" ? raw : undefined);

/** Keeps only well-formed hits; anything else from the server is dropped. */
function readHit(raw: unknown): SearchHit | null {
  if (!raw || typeof raw !== "object") return null;
  const x = raw as Record<string, unknown>;
  if (x.collection !== "tasks" && x.collection !== "notes") return null;
  if (typeof x.id !== "string" || !/^[a-z0-9]{15}$/.test(x.id)) return null;
  return {
    collection: x.collection,
    id: x.id,
    title: str(x.title) ?? "",
    path: str(x.path) ?? "",
    url: str(x.url),
    excerpt: str(x.excerpt) ?? "",
    revision: typeof x.revision === "number" ? x.revision : 0,
    updated: str(x.updated) ?? "",
    bucket: str(x.bucket),
    bucket_name: str(x.bucket_name),
    status: str(x.status),
    readiness: str(x.readiness),
    assigned_agent: str(x.assigned_agent),
    assigned_agent_name: str(x.assigned_agent_name),
  };
}

export async function searchCrew(
  request: SearchRequest,
  signal?: AbortSignal,
): Promise<SearchResult> {
  const body: Record<string, unknown> = { query: request.query };
  if (request.limit) body.limit = request.limit;
  if (request.offset) body.offset = request.offset;
  if (request.archived) body.archived = true;
  if (request.generation) body.generation = request.generation;
  const response = await pb.send<Record<string, unknown>>("/api/crew/search", {
    method: "POST",
    body,
    ...(signal ? { signal } : {}),
  });
  if (!response || !Array.isArray(response.items))
    throw new Error("Unexpected search response");
  const next = response.next_offset;
  return {
    items: response.items
      .map(readHit)
      .filter((x): x is SearchHit => x !== null),
    hasMore: response.has_more === true,
    nextOffset:
      typeof next === "number" && Number.isInteger(next) ? next : null,
    generation: str(response.generation) ?? "",
  };
}

export type SearchFailure =
  "aborted" | "changed" | "invalid" | "busy" | "failed";

/** Classifies a search error. 409 means the content changed while paging. */
export function searchFailure(error: unknown): SearchFailure {
  const e = error as { status?: unknown; isAbort?: unknown; name?: unknown };
  if (e?.isAbort === true || e?.name === "AbortError") return "aborted";
  switch (e?.status) {
    case 409:
      return "changed";
    case 400:
      return "invalid";
    case 408:
    case 413:
    case 429:
    case 503:
      return "busy";
    default:
      return "failed";
  }
}

export const failureText: Record<Exclude<SearchFailure, "aborted">, string> = {
  changed: "Results changed while you were looking. Search again.",
  invalid: "Search couldn't use those words. Try different ones.",
  busy: "Search is busy right now. Try again in a moment.",
  failed:
    "Search isn't available right now. Check your connection and try again.",
};

// eslint-disable-next-line no-control-regex
const controlChars = /[\u0000-\u001f\u007f]/;
const loneSurrogate =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

export type QueryProblem = "empty" | "long" | "invalid";

/** Why the server would refuse this text, or null when it is searchable. */
export function queryProblem(text: string): QueryProblem | null {
  const trimmed = text.trim();
  if (!trimmed) return "empty";
  if (controlChars.test(text) || loneSurrogate.test(text)) return "invalid";
  if (new TextEncoder().encode(trimmed).length > maxQueryBytes) return "long";
  if (trimmed.split(/\s+/).length > maxTerms) return "long";
  return null;
}

export const problemText: Record<QueryProblem, string> = {
  empty: "Type a word or two to search tasks, notes, agents and buckets.",
  long: `That search is too long. Use at most ${maxTerms} words.`,
  invalid: "That search contains characters Crew can't search for.",
};

/**
 * The text sent to the server. Every word must match; the last word also
 * matches longer words that start with it, so results appear while typing.
 */
export function serverQuery(text: string): string {
  const terms = text.trim().split(/\s+/);
  const last = terms[terms.length - 1];
  if (last && !last.endsWith("*") && /[\p{L}\p{N}]$/u.test(last))
    terms[terms.length - 1] = last + "*";
  return terms.join(" ");
}

/** Lowercased words without a trailing prefix marker, for name matching. */
const nameTerms = (text: string) =>
  text
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.replace(/\*+$/, ""))
    .filter(Boolean);

/** Agents and buckets whose name contains every word. */
export function matchNames(rows: Row[], text: string): Row[] {
  const terms = nameTerms(text);
  if (!terms.length) return [];
  return rows.filter((row) => {
    const name = val(row, "name").toLowerCase();
    return terms.every((term) => name.includes(term));
  });
}

export type ExcerptPart = { text: string; mark: boolean };

/** Highlight markers: SQLite FTS5 snippet(search, -1, '«', '»', '…', 12). */
export const markOpen = "«";
export const markClose = "»";
const maxExcerptChars = 4000;

/**
 * Splits a server excerpt into plain and highlighted text. Nothing is ever
 * interpreted as markup: the result is only rendered as React text and <mark>.
 * The server does not escape its markers, so the parse is deliberately simple:
 * "«" opens a highlight outside one, "»" closes one inside it, and any other
 * marker is literal text. A highlight cut off by the server's length limit
 * stays highlighted up to the end.
 */
export function parseExcerpt(raw: unknown): ExcerptPart[] {
  if (typeof raw !== "string" || !raw) return [];
  const text =
    raw.length > maxExcerptChars ? raw.slice(0, maxExcerptChars) + "…" : raw;
  const parts: ExcerptPart[] = [];
  let buffer = "";
  let marked = false;
  const flush = () => {
    if (buffer) {
      const last = parts[parts.length - 1];
      if (last && last.mark === marked) last.text += buffer;
      else parts.push({ text: buffer, mark: marked });
    }
    buffer = "";
  };
  for (const char of text) {
    if (char === markOpen && !marked) {
      flush();
      marked = true;
    } else if (char === markClose && marked) {
      flush();
      marked = false;
    } else buffer += char;
  }
  flush();
  return parts;
}

// The bookmarkable results page. Only `q` is accepted, exactly once.
export const searchPrefix = "#/search";

export function searchHash(text: string): string {
  return queryProblem(text) === "invalid"
    ? searchPrefix
    : `${searchPrefix}?q=${encodeURIComponent(text)}`;
}

/**
 * The query of a `#/search?q=` address: "" for the bare page, null for an
 * address that is not a well-formed search address.
 */
export function searchTextFromHash(hash: string): string | null {
  if (hash === searchPrefix || hash === searchPrefix + "?") return "";
  const match = /^#\/search\?([^#]*)$/.exec(hash);
  if (!match) return null;
  const pair = /^q=([^&=]*)$/.exec(match[1]);
  if (!pair) return null;
  let text: string;
  try {
    // Strict: malformed escapes and invalid UTF-8 are refused, not replaced.
    text = decodeURIComponent(pair[1].replace(/\+/g, " "));
  } catch {
    return null;
  }
  return queryProblem(text) === "invalid" ? null : text;
}

/** True only for the canonical form this module writes, with a searchable query. */
export function isCanonicalSearchHash(hash: string): boolean {
  const text = searchTextFromHash(hash);
  return (
    text !== null && queryProblem(text) === null && hash === searchHash(text)
  );
}
