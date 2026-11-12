import { boardStatuses, list, val, type Row } from "./crewApi";
import type { ViewState } from "./itemLink";
import { isClosed, noRelease, releaseMatches } from "./taskReleases";

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

/** Search keys the Tasks board reads out of its search text. */
export const searchKeys = ["release", "label", "agent", "status"] as const;
export type SearchKey = (typeof searchKeys)[number];
export type SearchToken = { key: SearchKey; value: string; raw: string };
export type BoardSearch = { text: string; tokens: SearchToken[] };

const tokenPattern = /(^|\s)(release|label|agent|status):("([^"]*)"?|\S*)/gi;

/**
 * Splits board search text into free text and `key:value` filter tokens
 * (`release:0.20.0`, `label:bug`, `agent:"Build bot"`, `status:done`). A key
 * with no value yet (`release:`) is dropped, so typing never empties the board.
 */
export function parseBoardSearch(input: string): BoardSearch {
  const tokens: SearchToken[] = [];
  const text = input
    .replace(
      tokenPattern,
      (raw: string, lead: string, key: string, rest: string, quoted?: string) => {
        const value = (quoted ?? rest).trim();
        if (value)
          tokens.push({ key: key.toLowerCase() as SearchKey, value, raw: raw.trim() });
        return lead;
      },
    )
    .replace(/\s+/g, " ")
    .trim();
  return { text, tokens };
}

const statusAliases: Record<string, string> = {
  to_do: "todo",
  review: "needs_review",
  wontdo: "wont_do",
  "won't_do": "wont_do",
};
/** A status token's stored value: `in-progress`, `In progress` and `in_progress` agree. */
export function normalizeStatus(value: string) {
  const key = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return statusAliases[key] ?? key;
}

const releaseValue = (value: string) =>
  value.toLowerCase() === noRelease ? noRelease : value;

/** Agents as the board knows them: id and display name. */
export type AgentName = { id: string; name: string };

/** The ids of the agents with this name, ignoring case. */
function agentIds(value: string, agents: AgentName[]) {
  const name = value.toLowerCase();
  return agents
    .filter((agent) => agent.name.toLowerCase() === name)
    .map((agent) => agent.id);
}

/**
 * Whether a task matches every search token, exactly like the corresponding
 * filter; a value that names nothing matches nothing.
 */
export function tokensMatch(tokens: SearchToken[], task: Row, agents: AgentName[]) {
  return tokens.every(({ key, value }) => {
    if (key === "release") return releaseMatches(releaseValue(value), task);
    if (key === "label") return labelMatches(value, task);
    if (key === "status") return statusMatches(normalizeStatus(value), task);
    const assigned = val(task, "assigned_agent");
    if (value.toLowerCase() === "unassigned") return !assigned;
    return !!assigned && agentIds(value, agents).includes(assigned);
  });
}

/**
 * Enter in the board search turns the tokens it can into filters (chips and
 * the address); a token naming no single agent or board column stays in the text.
 */
export function commitBoardSearch(
  input: string,
  agents: AgentName[],
): { text: string; changes: Partial<ViewState> } {
  const { text, tokens } = parseBoardSearch(input);
  const changes: Partial<ViewState> = {};
  const kept: string[] = [];
  for (const token of tokens) {
    const { key, value } = token;
    const status = normalizeStatus(value);
    const ids = key === "agent" ? agentIds(value, agents) : [];
    if (key === "release") changes.release = releaseValue(value);
    else if (key === "label") changes.label = value;
    else if (key === "status" && boardStatuses.some(([s]) => s === status))
      changes.status = status;
    else if (key === "agent" && value.toLowerCase() === "unassigned")
      changes.assignment = "unassigned";
    else if (key === "agent" && ids.length === 1) changes.assignment = ids[0];
    else kept.push(token.raw);
  }
  return { text: [text, ...kept].filter(Boolean).join(" "), changes };
}

export type FilterChip = { key: string; label: string; clear: Partial<ViewState> };

/**
 * One removable chip per filter set in the Filters panel (the agent filter
 * stays visible in the toolbar). The Filters button counts these.
 */
export function filterChips(state: ViewState): FilterChip[] {
  const chips: FilterChip[] = [];
  if (state.heldOver)
    chips.push({
      key: "hold",
      label: "On hold · over 3 days",
      clear: { hold: "all", heldOver: "" },
    });
  else if (state.hold !== "all")
    chips.push({
      key: "hold",
      label: state.hold === "ready" ? "Ready" : "On hold",
      clear: { hold: "all" },
    });
  if (state.label)
    chips.push({ key: "label", label: `Label ${state.label}`, clear: { label: "" } });
  if (state.status) {
    const name =
      boardStatuses.find(([s]) => s === state.status)?.[1] ?? state.status;
    chips.push({ key: "status", label: `Status ${name}`, clear: { status: "" } });
  }
  if (state.release)
    chips.push({
      key: "release",
      label: state.release === noRelease ? "No release" : `Release ${state.release}`,
      clear: { release: "" },
    });
  if (state.taskSort !== "updated")
    chips.push({
      key: "sort",
      label: "Sort: Oldest hold first",
      clear: { taskSort: "updated" },
    });
  return chips;
}

/** Every board filter and sort at its default; the Notes page state is kept. */
export const clearedBoard: Partial<ViewState> = {
  assignment: "all",
  hold: "all",
  release: "",
  label: "",
  status: "",
  heldOver: "",
  taskSort: "updated",
};
