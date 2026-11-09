import type { Row } from "./crewApi";

export type ItemKind = "task" | "note";
export type ItemLink = { kind: ItemKind; id: string };

export const viewHashes = {
  home: "#/",
  board: "#/team",
  memory: "#/memory",
  reviews: "#/approvals",
  agents: "#/agents",
  archive: "#/archive",
  connect: "#/connect",
  guide: "#/guide",
} as const;
export type View = keyof typeof viewHashes;

/** Item links and unknown addresses show Home; any Guide address shows the Guide. */
export function viewFromHash(hash: string): View {
  if (/^#\/guide(?:\/|$)/.test(hash)) return "guide";
  const match = Object.entries(viewHashes).find(([, value]) => value === hash);
  return match ? (match[0] as View) : "home";
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
  /^#\/(?:(?:tasks|notes)\/[a-z0-9]{15}|team|memory|approvals|agents|archive|connect|guide(?:\/[a-z-]+)?)$/;

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
      (returnPattern.test(hash) || isStoredSignin(hash)) &&
      typeof expires === "number" &&
      expires > now &&
      expires <= now + returnLifetimeMs
      ? hash
      : null;
  } catch {
    return null;
  }
}
