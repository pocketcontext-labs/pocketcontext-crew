import { val, type Row } from "./crewApi";
import { isClosed } from "./closedTasks";
import type { ItemKind } from "./itemLink";

/**
 * Which list a record dialog was opened from when the page alone does not say
 * (0.35.0): Home has several sections, so an item opened there remembers its
 * section, and the dialog's previous/next walk exactly that section in its
 * shown order. Kept in the history entry (`crewSource`, see trail.ts), so
 * Back, Forward and a reload keep the same list.
 */
export const listSources = [
  "home:approvals",
  "home:tasks",
  "home:recent",
  "home:agents",
] as const;
export type ListSource = (typeof listSources)[number];

export type ListEntry = { kind: ItemKind | "review"; row: Row };

/** The list source of this history entry, if any. */
export function currentListSource(): ListSource | undefined {
  const state: unknown = history.state;
  const value =
    state && typeof state === "object"
      ? (state as { crewSource?: unknown }).crewSource
      : undefined;
  return listSources.includes(value as ListSource)
    ? (value as ListSource)
    : undefined;
}

/** Home's Needs you tasks: open tasks stopped by the handoff limit or assigned to an unavailable agent. */
export function homeStuckTasks(
  tasks: Row[],
  invalidAssignment: (task: Row) => boolean,
): Row[] {
  return tasks.filter(
    (x) => !isClosed(x) && (x.handoff_limited === true || invalidAssignment(x)),
  );
}

/** Home's Agents: every active agent A–Z. */
export function homeAgents(agents: Row[]): Row[] {
  return [...agents].sort((a, b) =>
    val(a, "name").localeCompare(val(b, "name"), undefined, {
      sensitivity: "base",
    }),
  );
}

/** Home's Recent: the five most recently updated tasks and notes. */
export function homeRecent(
  tasks: Row[],
  notes: Row[],
): { kind: "task" | "note"; row: Row }[] {
  return [
    ...tasks.map((row) => ({ kind: "task" as const, row })),
    ...notes.map((row) => ({ kind: "note" as const, row })),
  ]
    .sort((a, b) => val(b.row, "updated").localeCompare(val(a.row, "updated")))
    .slice(0, 5);
}

/** The Home section's items, in the order Home shows them. */
export function homeList(
  source: ListSource,
  {
    tasks,
    notes,
    agents,
    pending,
    invalidAssignment,
  }: {
    tasks: Row[];
    notes: Row[];
    agents: Row[];
    /** Pending reviews, as Home lists them. */
    pending: Row[];
    invalidAssignment: (task: Row) => boolean;
  },
): ListEntry[] {
  switch (source) {
    case "home:approvals":
      return pending.map((row) => ({ kind: "review", row }));
    case "home:tasks":
      return homeStuckTasks(tasks, invalidAssignment).map((row) => ({
        kind: "task",
        row,
      }));
    case "home:recent":
      return homeRecent(tasks, notes);
    case "home:agents":
      return homeAgents(agents).map((row) => ({ kind: "agent", row }));
  }
}

/** The word the header uses for one item of the source's list. */
export function listSourceNoun(source: ListSource): string {
  return source === "home:approvals"
    ? "review"
    : source === "home:tasks"
      ? "task"
      : source === "home:agents"
        ? "agent"
        : "item";
}
