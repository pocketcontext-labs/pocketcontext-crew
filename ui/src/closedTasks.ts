import { val, type Row } from "./crewApi";

/** Done and Won't do are closed: no hold, no wakes, shown in the Done column. */
export const closedStatuses = ["done", "wont_do"] as const;
export const isClosed = (task: Row | undefined) =>
  (closedStatuses as readonly string[]).includes(val(task, "status"));

/** The Done column shows closed tasks changed in the last 7 days by default. */
export const recentClosedMs = 7 * 24 * 60 * 60 * 1000;

/**
 * The Done column: closed tasks, most recently updated first. Unless
 * showOlder, only tasks updated in the last 7 days are shown; older counts
 * the rest.
 */
export function doneColumn(
  tasks: Row[],
  showOlder: boolean,
  now = Date.now(),
): { tasks: Row[]; older: number } {
  const recent = (task: Row) => {
    const updated = Date.parse(val(task, "updated").replace(" ", "T"));
    return !Number.isFinite(updated) || now - updated <= recentClosedMs;
  };
  const shown = showOlder ? tasks : tasks.filter(recent);
  return {
    tasks: [...shown].sort((a, b) =>
      val(b, "updated").localeCompare(val(a, "updated")),
    ),
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
