import { val, type Row } from "./crewApi";
import { isClosed } from "./closedTasks";

/** A wake whose receipt deadline passed, on an open task someone else filed. */
export type StrandedWake = { bridge: Row; task: Row };

/**
 * Overdue wake bridges worth the owner's attention: one per task (the latest),
 * only for tasks that are open (not done or won't do, not archived) and not
 * self-dispatched (created by the agent they are assigned to; the creator is
 * a reported name or id, so both are compared). Bridges with
 * no task, such as the connection test, are left out. Display only: the
 * server decides `overdue`.
 */
export function strandedWakes(
  bridges: Row[],
  tasks: Row[],
  agents: Row[] = [],
): StrandedWake[] {
  const latest = new Map<string, StrandedWake>();
  for (const bridge of bridges) {
    if (bridge.overdue !== true) continue;
    const taskId = val(bridge, "task_id");
    if (!taskId) continue;
    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.archived === true || isClosed(task))
      continue;
    const creator = val(task, "created_by_agent").trim().toLowerCase();
    const assigned = val(task, "assigned_agent");
    const assignedName = val(
      agents.find((a) => a.id === assigned),
      "name",
    )
      .trim()
      .toLowerCase();
    if (
      creator &&
      assigned &&
      (creator === assigned.toLowerCase() || creator === assignedName)
    )
      continue;
    const seen = latest.get(taskId);
    if (!seen || val(bridge, "created") > val(seen.bridge, "created"))
      latest.set(taskId, { bridge, task });
  }
  return [...latest.values()].sort((a, b) =>
    val(b.bridge, "created").localeCompare(val(a.bridge, "created")),
  );
}

/** When the wake became overdue: its deadline, else when it was prepared. */
export const strandedSince = (bridge: Row) =>
  val(bridge, "deadline_at") ||
  val(bridge, "wake_prepared_at") ||
  val(bridge, "created");
