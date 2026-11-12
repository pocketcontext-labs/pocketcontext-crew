import { val, type Row } from "./crewApi";

/** Done and Won't do are closed: no hold, no wakes, shown in the Done column. */
export const closedStatuses = ["done", "wont_do"] as const;
export const isClosed = (task: Row | undefined) =>
  (closedStatuses as readonly string[]).includes(val(task, "status"));

/** The board's release filter value for tasks without a release. */
export const noRelease = "none";

/** The Done column shows closed tasks changed in the last 7 days by default. */
export const recentClosedMs = 7 * 24 * 60 * 60 * 1000;

const semver = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * Newest release first: semantic versions compare numerically (a pre-release
 * sorts before its release), anything else falls back to a numeric-aware
 * string order, and semantic versions sort before other names.
 */
export function compareReleases(a: string, b: string): number {
  const [ma, mb] = [semver.exec(a), semver.exec(b)];
  if (ma && mb) {
    for (let i = 1; i <= 3; i++) {
      const diff = Number(mb[i]) - Number(ma[i]);
      if (diff) return diff;
    }
    if (!ma[4] !== !mb[4]) return ma[4] ? 1 : -1;
    if (ma[4] && mb[4])
      return mb[4].localeCompare(ma[4], undefined, { numeric: true });
    return 0;
  }
  if (ma || mb) return ma ? -1 : 1;
  return b.localeCompare(a, undefined, { numeric: true, sensitivity: "base" });
}

/** Distinct non-empty releases of these tasks, newest first. */
export function knownReleases(tasks: Row[]): string[] {
  const set = new Set<string>();
  for (const task of tasks) {
    const release = val(task, "release");
    if (release) set.add(release);
  }
  return [...set].sort(compareReleases);
}

/** Whether a task shows under the board's release filter ("" is all). */
export function releaseMatches(filter: string, task: Row) {
  if (!filter) return true;
  const release = val(task, "release");
  return filter === noRelease ? !release : release === filter;
}

export type ReleaseGroup = { release: string; tasks: Row[] };

/**
 * The Done column: closed tasks grouped by release (newest release first,
 * "No release" last, newest change first within a group). Unless showOlder,
 * only tasks updated in the last 7 days are grouped; older counts the rest.
 */
export function doneColumn(
  tasks: Row[],
  showOlder: boolean,
  now = Date.now(),
): { groups: ReleaseGroup[]; older: number } {
  const recent = (task: Row) => {
    const updated = Date.parse(val(task, "updated").replace(" ", "T"));
    return !Number.isFinite(updated) || now - updated <= recentClosedMs;
  };
  const shown = showOlder ? tasks : tasks.filter(recent);
  const byRelease = new Map<string, Row[]>();
  for (const task of shown) {
    const release = val(task, "release");
    byRelease.set(release, [...(byRelease.get(release) ?? []), task]);
  }
  const order = [...byRelease.keys()].sort((a, b) =>
    !a ? 1 : !b ? -1 : compareReleases(a, b),
  );
  return {
    groups: order.map((release) => ({
      release,
      tasks: [...(byRelease.get(release) ?? [])].sort((a, b) =>
        val(b, "updated").localeCompare(val(a, "updated")),
      ),
    })),
    older: tasks.length - shown.length,
  };
}

/** "Approved in session by <name>, <date>" for an in-session approval, else "". */
export function approvalLine(task: Row | undefined): string {
  if (val(task, "review_mode") !== "in_session") return "";
  const by = val(task, "approved_by") || "owner";
  const at = Date.parse(val(task, "approved_at").replace(" ", "T"));
  return `Approved in session by ${by}${Number.isFinite(at) ? `, ${new Date(at).toLocaleString()}` : ""}`;
}
