import type { Row } from "./crewApi";
import {
  isCanonicalSearchHash,
  queryProblem,
  searchHash,
  searchTextFromHash,
} from "./searchApi";

export type ItemKind = "task" | "note";
export type ItemLink = { kind: ItemKind; id: string; tab?: TaskTab };
/** Task dialog views a link can open on: `#/tasks/<slug>?tab=comments`. */
export const taskTabs = ["edit", "comments", "activity", "reviews"] as const;
export type TaskTab = (typeof taskTabs)[number];

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
  shared: "#/shared",
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
  if (/^#\/connect\?/.test(hash)) return "connect";
  if (/^#\/shared\/[a-z0-9]{15}$/.test(hash)) return "shared";
  if (/^#\/shared\?/.test(hash)) return "shared";
  const link = parseItemHash(hash);
  if (link) return link.kind === "task" ? "board" : "memory";
  const match = Object.entries(viewHashes).find(([, value]) => value === hash);
  return match ? (match[0] as View) : "home";
}

/** The artifact a Shared page address (#/shared/<id>) points at, or "". */
export function sharedFocusFromHash(hash: string): string {
  return /^#\/shared\/([a-z0-9]{15})$/.exec(hash)?.[1] ?? "";
}

/**
 * Shared page filters: Drafts, Live, Revoked/expired ("ended") and Archived.
 * The default (Drafts and Live) keeps the plain #/shared address; any other
 * choice lives in ?show=, in this order.
 */
export const sharedFilters = ["drafts", "live", "ended", "archived"] as const;
export type SharedFilter = (typeof sharedFilters)[number];
export const defaultSharedFilters: SharedFilter[] = ["drafts", "live"];

export function sharedFiltersFromHash(hash: string): SharedFilter[] {
  const match = /^#\/shared\?(.*)$/.exec(hash);
  if (!match) return [...defaultSharedFilters];
  const show = new URLSearchParams(match[1]).get("show");
  if (show === null) return [...defaultSharedFilters];
  const wanted = show.split(",");
  return sharedFilters.filter((f) => wanted.includes(f));
}

export function sharedHash(filters: SharedFilter[]): string {
  const ordered = sharedFilters.filter((f) => filters.includes(f));
  if (ordered.join(",") === defaultSharedFilters.join(","))
    return viewHashes.shared;
  return `${viewHashes.shared}?show=${ordered.join(",")}`;
}

export const noteSorts = ["updated", "created", "title", "bucket"] as const;
export const bucketSorts = ["name", "notes", "activity"] as const;
export type NoteSort = (typeof noteSorts)[number];
export type BucketSort = (typeof bucketSorts)[number];
/** Board hold filter: every task, open tasks on hold, or open Ready tasks. */
export const holdFilters = ["all", "on_hold", "ready"] as const;
export type HoldFilter = (typeof holdFilters)[number];
/** Tasks and Notes page state that lives in the address. */
export type ViewState = {
  /** A bucket id, or "" for all buckets. */
  bucket: string;
  noteSort: NoteSort;
  bucketSort: BucketSort;
  /** "all", "unassigned", "invalid" or an agent id. */
  assignment: string;
  /** On hold or Ready (open tasks only), or all. */
  hold: HoldFilter;
  label: string;
  status: string;
  heldOver: string;
  taskSort: "updated" | "held";
};
export const defaultViewState: ViewState = {
  bucket: "",
  noteSort: "updated",
  bucketSort: "name",
  assignment: "all",
  hold: "all",
  label: "",
  status: "",
  heldOver: "",
  taskSort: "updated",
};
const recordId = /^[a-z0-9]{15}$/;
const validLabel = (v: string) => v.trim().length > 0 && v.length <= 200;
const legacyReleaseLabel = (release: string | null) =>
  release?.trim() && validLabel("release-" + release.trim())
    ? "release-" + release.trim()
    : null;
const assignments = ["unassigned", "invalid"];

/**
 * Reads `#/notes?bucket=<id>&sort=<notes>&buckets=<buckets>` and
 * `#/tasks?agent=<id|unassigned|invalid>&hold=<on_hold|ready>&label=<label>`, or their older `#/memory` and `#/team`
 * forms. A 0.22.0 `release=<release>` link becomes the label release-<release>
 * (tasks have no release field since 0.23.0). A missing, repeated or invalid value falls back to its default; unknown
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
      hold: (one(
        "hold",
        (v) => v !== "all" && (holdFilters as readonly string[]).includes(v),
      ) ?? defaultViewState.hold) as HoldFilter,
      label:
        one("label", validLabel) ??
        legacyReleaseLabel(one("release", (v) => v !== "none")) ??
        "",
      status: one("status", (v) => statusFilters.includes(v)) ?? "",
      heldOver: one("held_over", (v) => v === "3d") ?? "",
      taskSort:
        one("sort", (v) => v === "held") === "held" ? "held" : "updated",
    };
  return {
    ...defaultViewState,
    bucket: one("bucket", (v) => recordId.test(v)) ?? defaultViewState.bucket,
    noteSort: (one("sort", (v) =>
      (noteSorts as readonly string[]).includes(v),
    ) ?? defaultViewState.noteSort) as NoteSort,
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
  if (view === "board" && state.hold !== defaultViewState.hold)
    params.set("hold", state.hold);
  if (view === "board") {
    if (state.label) params.set("label", state.label);
    if (state.status) params.set("status", state.status);
    if (state.heldOver) params.set("held_over", state.heldOver);
    if (state.taskSort === "held") params.set("sort", "held");
  }
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
/** The status filter: the four columns, plus Won't do (in the Done column). */
const statusFilters = [...boardColumns, "wont_do"];

/**
 * A Tasks address that asks the board to bring one status column into view
 * once (`#/tasks?column=<status>`). It is not page state: the board consumes
 * it and drops it from the address, keeping the filters beside it.
 */
export const boardColumnHash = (status: string) =>
  `${viewHashes.board}?column=${encodeURIComponent(status)}`;

/** The Tasks board showing only open tasks on hold. */
export const boardOnHoldHash = `${viewHashes.board}?hold=on_hold&held_over=3d`;
export const boardStatusHash = (status: string) =>
  `${viewHashes.board}?status=${encodeURIComponent(status)}&column=${encodeURIComponent(status)}`;

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
  // The only query an item link takes is a task tab (0.24.0); anything else
  // makes the link malformed, as before.
  const match =
    /^#\/(tasks|notes)\/([^/?#]+)(?:\?tab=(edit|comments|activity|reviews))?$/.exec(
      hash,
    );
  if (!match) return null;
  const id = match[2].slice(match[2].lastIndexOf("-") + 1);
  if (!/^[a-z0-9]{15}$/.test(id)) return null;
  const kind = match[1] === "tasks" ? "task" : "note";
  if (match[3] && kind !== "task") return null;
  return match[3] ? { kind, id, tab: match[3] as TaskTab } : { kind, id };
}
/** An item's address on one task tab; Edit, the default, has no query. */
export function itemTabPath(path: string, tab?: string): string {
  const base = path.replace(/\?.*$/, "");
  return tab && tab !== "edit" && taskTabs.includes(tab as TaskTab)
    ? `${base}?tab=${tab}`
    : base;
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

// One-time upload links: `#/upload/<token>`. The token stays in the fragment
// (never in a request URL) and is never remembered as a return address.
const uploadPattern = /^#\/upload\/([^/?#]*)$/;
export const isUploadHash = (hash: string) => /^#\/upload(?:\/|$)/.test(hash);
/** The token of an upload address ("" for a malformed one), or null. */
export function uploadTokenFromHash(hash: string): string | null {
  if (!isUploadHash(hash)) return null;
  const token = uploadPattern.exec(hash)?.[1] ?? "";
  return /^[A-Za-z0-9]{43}$/.test(token) ? token : "";
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
  if (isUploadHash(hash)) return null;
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
  if (isUploadHash(hash)) return;
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

export const connectSections = ["files"] as const;
export type ConnectSection = (typeof connectSections)[number];
/** The Connect page scrolled to one section (consumed once, then dropped). */
export const connectSectionHash = (section: ConnectSection) =>
  `${viewHashes.connect}?section=${section}`;
/** The section of `#/connect?section=<name>`, or null. */
export function connectSectionFromHash(hash: string): ConnectSection | null {
  const query = /^#\/connect\?(.*)$/.exec(hash)?.[1];
  if (query === undefined) return null;
  const values = new URLSearchParams(query).getAll("section");
  return values.length === 1 &&
    (connectSections as readonly string[]).includes(values[0])
    ? (values[0] as ConnectSection)
    : null;
}
