import { list, val, type Row } from "./crewApi";
import { isClosed } from "./taskReleases";

export const longHoldMs = 3 * 24 * 60 * 60 * 1000;
export const heldSince = (task: Row) =>
  Date.parse(val(task, "held_since") || val(task, "updated"));
export const isLongHeld = (task: Row, now = Date.now()) =>
  !task.archived &&
  !isClosed(task) &&
  val(task, "readiness") !== "ready" &&
  Number.isFinite(heldSince(task)) &&
  now - heldSince(task) > longHoldMs;
export const longHolds = (tasks: Row[], now = Date.now()) =>
  tasks.filter((task) => isLongHeld(task, now));
export const heldDuration = (task: Row, now = Date.now()) => {
  const elapsed = now - heldSince(task);
  if (!Number.isFinite(elapsed) || elapsed < 0) return "";
  const days = Math.floor(elapsed / 86400000);
  return days > 0
    ? `${days} ${days === 1 ? "day" : "days"}`
    : "less than a day";
};
/** Home's Done tile means Done, not Won't do; the unfiltered Done column includes both. */
export const statusMatches = (status: string, task: Row) =>
  !status || val(task, "status") === status;
export const labelMatches = (label: string, task: Row) =>
  !label ||
  list(task, "labels").some(
    (value) => value.toLowerCase() === label.toLowerCase(),
  );
export function knownLabels(tasks: Row[]) {
  const labels = new Map<string, { label: string; count: number }>();
  for (const task of tasks.filter((x) => !x.archived)) {
    for (const label of new Map(
      list(task, "labels").map((x) => [x.toLowerCase(), x]),
    ).values()) {
      const key = label.toLowerCase();
      const entry = labels.get(key) ?? { label, count: 0 };
      entry.count++;
      labels.set(key, entry);
    }
  }
  return [...labels.values()].sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
  );
}
