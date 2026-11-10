import type { Row } from "./crewApi";
import {
  isCanonicalSearchHash,
  queryProblem,
  searchHash,
  searchTextFromHash,
} from "./searchApi";

export type ItemKind = "task" | "note";
export type ItemLink = { kind: ItemKind; id: string };

export const viewHashes = {
  home: "#/",
  board: "#/tasks",
  memory: "#/notes",
  reviews: "#/approvals",
  agents: "#/agents",
  archive: "#/archive",
  connect: "#/connect",
  guide: "#/guide",
  search: "#/search",
} as const;
export type View = keyof typeof viewHashes;

/**
 * The current address of an older page address (`#/team` became `#/tasks`,
 * `#/memory` became `#/notes`), keeping its query; null for any other address.
 */
export function legacyRedirect(hash: string): string | null {
  const match = /^#\/(team|memory)(\?.*)?$/.exec(hash);
  if (!match) return null;
  return (
    (match[1] === "team" ? viewHashes.board : viewHashes.memory) +
    (match[2] ?? "")
  );
}

/**
 * A valid item link shows its own list (a task over Tasks, a note over Notes);
 * unknown addresses show Home. Any Guide address shows the Guide and any search
 * address shows Search, which validates its own query. The Tasks and Notes
 * pages keep their filters and sorts in a query, read by viewStateFromHash.
 * Old page addresses are read as their replacements.
 */
export function viewFromHash(hash: string): View {
  hash = legacyRedirect(hash) ?? hash;
  if (/^#\/guide(?:\/|$)/.test(hash)) return "guide";
  if (/^#\/search(?:\?|$)/.test(hash)) return "search";
  if (/^#\/tasks\?/.test(hash)) return "board";
  if (/^#\/notes\?/.test(hash)) return "memory";
  const link = parseItemHash(hash);
  if (link) return link.kind === "task" ? "board" : "memory";
  const match = Object.entries(viewHashes).find(([, value]) => value === hash);
  return match ? (match[0] as View) : "home";
}

export const noteSorts = ["updated", "created", "title", "bucket"] as const;
export const bucketSorts = ["name", "notes", "activity"] as const;
export type NoteSort = (typeof noteSorts)[number];
export type BucketSort = (typeof bucketSorts)[number];
/** Tasks and Notes page state that lives in the address. */
export type ViewState = {
  /** A bucket id, or "" for all buckets. */
  bucket: string;
  noteSort: NoteSort;
  bucketSort: BucketSort;
  /** "all", "unassigned", "invalid" or an agent id. */
  assignment: string;
};
export const defaultViewState: ViewState = {
  bucket: "",
  noteSort: "updated",
  bucketSort: "name",
  assignment: "all",
};
const recordId = /^[a-z0-9]{15}$/;
const assignments = ["unassigned", "invalid"];

/**
 * Reads `#/notes?bucket=<id>&sort=<notes>&buckets=<buckets>` and
 * `#/tasks?agent=<id|unassigned|invalid>`, or their older `#/memory` and `#/team`
 * forms. A missing, repeated or invalid value falls back to its default; unknown
 * parameters are ignored. Whether an id still names an active record is for the
 * page to decide.
 */
export function viewStateFromHash(hash: string): ViewState {
  hash = legacyRedirect(hash) ?? hash;
  const view = viewFromHash(hash);
  const query = /^#\/[a-z]+\?(.*)$/.exec(hash)?.[1];
  if ((view !== "board" && view !== "memory") || query === undefined)
    return defaultViewState;
  const params = new URLSearchParams(query);
  const one = (key: string, valid: (value: string) => boolean) => {
    const values = params.getAll(key);
    return values.length === 1 && valid(values[0]) ? values[0] : null;
  };
  if (view === "board")
    return {
      ...defaultViewState,
      assignment:
        one("agent", (v) => recordId.test(v) || assignments.includes(v)) ??
        defaultViewState.assignment,
    };
  return {
    ...defaultViewState,
    bucket: one("bucket", (v) => recordId.test(v)) ?? defaultViewState.bucket,
    noteSort: (one("sort", (v) => (noteSorts as readonly string[]).includes(v)) ??
      defaultViewState.noteSort) as NoteSort,
    bucketSort: (one("buckets", (v) =>
      (bucketSorts as readonly string[]).includes(v),
    ) ?? defaultViewState.bucketSort) as BucketSort,
  };
}

/** The canonical address of a view with its state; defaults are left out. */
export function viewStateHash(view: View, state: ViewState): string {
  const params = new URLSearchParams();
  if (view === "board" && state.assignment !== defaultViewState.assignment)
    params.set("agent", state.assignment);
  if (view === "memory") {
    if (state.bucket) params.set("bucket", state.bucket);
    if (state.noteSort !== defaultViewState.noteSort)
      params.set("sort", state.noteSort);
    if (state.bucketSort !== defaultViewState.bucketSort)
      params.set("buckets", state.bucketSort);
  }
  const query = params.toString();
  return viewHashes[view] + (query ? `?${query}` : "");
}

const boardColumns = ["todo", "in_progress", "needs_review", "done"];

/**
 * A Tasks address that asks the board to bring one status column into view
 * once (`#/tasks?column=<status>`). It is not page state: the board consumes
 * it and drops it from the address, keeping the filters beside it.
 */
export const boardColumnHash = (status: string) =>
  `${viewHashes.board}?column=${encodeURIComponent(status)}`;

/** The status column a Tasks address asks for, or null. */
export function boardColumnFromHash(hash: string): string | null {
  hash = legacyRedirect(hash) ?? hash;
  if (viewFromHash(hash) !== "board") return null;
  const query = /^#\/tasks\?(.*)$/.exec(hash)?.[1];
  if (query === undefined) return null;
  const values = new URLSearchParams(query).getAll("column");
  return values.length === 1 && boardColumns.includes(values[0])
    ? values[0]
    : null;
}

/** Only the exact form viewStateHash writes for the Tasks or Notes page. */
export function isCanonicalViewStateHash(hash: string): boolean {
  const view = viewFromHash(hash);
  return (
    (view === "board" || view === "memory") &&
    hash === viewStateHash(view, viewStateFromHash(hash))
  );
}

/**
 * The record id is whatever follows the final "-", or the whole token. The slug
 * before it is the server's and is never interpreted here.
 */
export function parseItemHash(hash: string): ItemLink | null {
  const match = /^#\/(tasks|notes)\/([^/?#]+)$/.exec(hash);
  if (!match) return null;
  const id = match[2].slice(match[2].lastIndexOf("-") + 1);
  if (!/^[a-z0-9]{15}$/.test(id)) return null;
  return { kind: match[1] === "tasks" ? "task" : "note", id };
}

export const isItemHash = (hash: string) => /^#\/(tasks|notes)\//.test(hash);

const bareHash = ({ kind, id }: ItemLink) => `#/${kind}s/${id}`;

/** The server's `path` when it identifies this row, otherwise the bare form. */
export function itemPath(kind: ItemKind, row: Row): string {
  const path = typeof row.path === "string" ? row.path : "";
  const link = parseItemHash(path);
  return link?.kind === kind && link.id === row.id
    ? path
    : bareHash({ kind, id: row.id });
}

export function itemShareUrl(kind: ItemKind, row: Row): string {
  return typeof row.url === "string" && row.url
    ? row.url
    : location.origin + location.pathname + itemPath(kind, row);
}

// An emailed sign-in link usually opens in a new tab, so the target has to
// outlive this one. It lasts as long as the one-time password it accompanies.
const returnKey = "pocketcontext.crew.login_return";
const returnLifetimeMs = 15 * 60 * 1000;
const returnPattern =
  /^#\/(?:(?:tasks|notes)\/[a-z0-9]{15}|tasks|notes|team|memory|approvals|agents|archive|connect|search|guide(?:\/[a-z-]+)?)$/;

// OAuth consent sends the browser here to sign in and come back. The path is
// fixed: only the query (validated by the consent endpoint) can vary.
const signinPrefix = "#/signin?next=";
const oauthTargetMaxLength = 16384;

/** Accepts only `/oauth/authorize?<query>` on this origin. */
export function safeOAuthTarget(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > oauthTargetMaxLength) return null;
  if (!/^\/oauth\/authorize\?[^\s\\#]+$/.test(raw)) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null;
  try {
    const url = new URL(raw, location.origin);
    return url.origin === location.origin &&
      url.pathname === "/oauth/authorize" &&
      url.pathname + url.search === raw
      ? raw
      : null;
  } catch {
    return null;
  }
}

export const isSigninHash = (hash: string) => /^#\/signin(?:\?|$)/.test(hash);

/** The validated return target of a `#/signin?next=` address. */
export function oauthTargetFromHash(hash: string): string | null {
  const match = /^#\/signin\?(.*)$/.exec(hash);
  if (!match) return null;
  const next = new URLSearchParams(match[1]).getAll("next");
  return next.length === 1 ? safeOAuthTarget(next[0]) : null;
}

const signinHash = (target: string) =>
  signinPrefix + encodeURIComponent(target);

/** Seam for tests: jsdom cannot perform this navigation. */
export const browserNavigation = {
  replace: (target: string) => location.replace(target),
};

export function clearLoginReturn() {
  try {
    localStorage.removeItem(returnKey);
  } catch {
    /* Optional storage. */
  }
}

/** The normalized place to return to: no slug and nothing from a login URL. */
export function loginReturnHash(hash: string): string | null {
  if (isSigninHash(hash)) {
    const target = oauthTargetFromHash(hash);
    return target ? signinHash(target) : null;
  }
  const link = parseItemHash(hash);
  if (link) return bareHash(link);
  const view = viewFromHash(hash);
  if (view === "guide")
    return returnPattern.test(hash) ? hash : viewHashes.guide;
  if (view === "search") {
    const text = searchTextFromHash(hash);
    return text && queryProblem(text) === null
      ? searchHash(text)
      : viewHashes.search;
  }
  if (view === "board" || view === "memory")
    return viewStateHash(view, viewStateFromHash(hash));
  return view === "home" ? null : hash;
}

export function rememberLoginReturn(hash: string) {
  try {
    localStorage.setItem(
      returnKey,
      JSON.stringify({
        hash,
        expires: Date.now() + returnLifetimeMs,
      }),
    );
  } catch {
    /* Optional storage: sign-in still works and lands on the board. */
  }
}

/** Only the exact form this module writes; anything else in storage is refused. */
function isStoredSignin(hash: string): boolean {
  const target = oauthTargetFromHash(hash);
  return target !== null && hash === signinHash(target);
}

/** Returns a validated item hash at most once; the stored value is always cleared. */
export function takeLoginReturn(): string | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(returnKey);
  } catch {
    return null;
  }
  clearLoginReturn();
  if (!raw) return null;
  try {
    const { hash, expires } = JSON.parse(raw) as {
      hash?: unknown;
      expires?: unknown;
    };
    const now = Date.now();
    return typeof hash === "string" &&
      (returnPattern.test(hash) ||
        isStoredSignin(hash) ||
        isCanonicalSearchHash(hash) ||
        isCanonicalViewStateHash(legacyRedirect(hash) ?? hash)) &&
      typeof expires === "number" &&
      expires > now &&
      expires <= now + returnLifetimeMs
      ? (legacyRedirect(hash) ?? hash)
      : null;
  } catch {
    return null;
  }
}
