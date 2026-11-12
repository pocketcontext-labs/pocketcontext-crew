import { expect, it } from "vitest";
import {
  clearedBoard,
  commitBoardSearch,
  filterChips,
  heldDuration,
  knownLabels,
  labelMatches,
  longHolds,
  normalizeStatus,
  parseBoardSearch,
  statusMatches,
  tokensMatch,
} from "./boardFilters";
import { claimLabel, claimOf, claimTitle } from "./projectAgents";
import { defaultViewState, viewStateFromHash, viewStateHash } from "./itemLink";
import type { Row } from "./crewApi";
const row = (fields: Record<string, unknown>): Row => ({
  id: "synthetic",
  revision: 1,
  ...fields,
});
it("keeps hold age stable across updates and ignores terminal or archived holds", () => {
  const now = Date.parse("2026-11-12T12:00:00Z");
  const held = row({
    readiness: "waiting",
    held_since: "2026-11-01T12:00:00Z",
    updated: "2026-11-12T11:00:00Z",
  });
  expect(
    longHolds(
      [
        held,
        { ...held, status: "done" },
        { ...held, status: "wont_do" },
        { ...held, archived: true },
        { ...held, readiness: "ready" },
      ],
      now,
    ),
  ).toEqual([held]);
  expect(heldDuration(held, now)).toBe("11 days");
  expect(
    longHolds(
      [row({ readiness: "waiting", updated: "2026-11-01T12:00:00Z" })],
      now,
    ),
  ).toHaveLength(1);
});
it("counts labels case-insensitively once per active task, retaining display casing", () => {
  const tasks = [
    row({ labels: ["Crew", "crew", "Bug"] }),
    row({ labels: ["CREW"] }),
    row({ labels: ["Other"], archived: true }),
  ];
  expect(knownLabels(tasks).map(({ count }) => count)).toEqual([1, 2]);
  expect(labelMatches("cReW", tasks[0])).toBe(true);
  expect(labelMatches("cre", tasks[0])).toBe(false);
  expect(statusMatches("done", row({ status: "wont_do" }))).toBe(false);
});
it("round trips combined filters and hold sort through the address", () => {
  const state = {
    ...defaultViewState,
    assignment: "agent0000000001",
    hold: "on_hold" as const,
    label: "Crew & QA",
    heldOver: "3d",
    status: "todo",
    taskSort: "held" as const,
  };
  expect(viewStateFromHash(viewStateHash("board", state))).toEqual(state);
  expect(
    viewStateFromHash("#/tasks?held_over=3d&held_over=3d&status=bad").heldOver,
  ).toBe("");
});
it("keeps full claim attribution in the tooltip and makes the chip short", () => {
  const now = Date.parse("2026-11-12T12:00:00Z");
  const claim = claimOf(
    row({
      claim_state: "live",
      claimed_by: "Implement · Claude Code · pane/1 · abcdef12",
      claimed_at: "2026-11-12T11:40:00Z",
      claim_until: "2026-11-12T13:40:00Z",
    }),
    now,
  );
  expect(claimLabel(claim, now)).toBe("Claude Code · 1h 40m left");
  expect(claimTitle(claim)).toContain("pane/1 · abcdef12");
  expect(claimTitle(claim)).toContain("Started");
});
it("splits board search into free text and label, agent and status tokens", () => {
  expect(parseBoardSearch("  fix Label:Bug  login ")).toEqual({
    text: "fix login",
    tokens: [
      { key: "label", value: "Bug", raw: "Label:Bug" },
    ],
  });
  expect(parseBoardSearch('agent:"Build bot" status:in-progress').tokens).toEqual([
    { key: "agent", value: "Build bot", raw: 'agent:"Build bot"' },
    { key: "status", value: "in-progress", raw: "status:in-progress" },
  ]);
  // A key with no value yet, or a key inside a word, is not a filter.
  expect(parseBoardSearch("label:")).toEqual({ text: "", tokens: [] });
  expect(parseBoardSearch("prelabel:x")).toEqual({ text: "prelabel:x", tokens: [] });
  // Tasks have no release field since 0.23.0: release: is plain text.
  expect(parseBoardSearch("release:0.20.0")).toEqual({ text: "release:0.20.0", tokens: [] });
  expect(normalizeStatus("In progress")).toBe("in_progress");
  expect(normalizeStatus("to-do")).toBe("todo");
  expect(normalizeStatus("review")).toBe("needs_review");
});
it("matches search tokens exactly like the corresponding filters", () => {
  const agents = [
    { id: "agent0000000001", name: "Build" },
    { id: "agent0000000002", name: "Design" },
  ];
  const shipped = row({
    status: "done",
    labels: ["Bug", "release-0.20.0"],
    assigned_agent: "agent0000000001",
  });
  const open = row({ status: "todo", labels: [], assigned_agent: "" });
  const match = (text: string, task: Row) =>
    tokensMatch(parseBoardSearch(text).tokens, task, agents);
  expect(match("label:release-0.20.0", shipped)).toBe(true);
  expect(match("label:release-0.20.0", open)).toBe(false);
  expect(match("label:bug status:done agent:build", shipped)).toBe(true);
  expect(match("agent:design", shipped)).toBe(false);
  expect(match("agent:unassigned", open)).toBe(true);
  expect(match("agent:nobody", shipped)).toBe(false);
  expect(match("status:todo", shipped)).toBe(false);
});
it("commits search tokens it can resolve into board filters and keeps the rest", () => {
  const agents = [
    { id: "agent0000000001", name: "Build" },
    { id: "agent0000000002", name: "Twin" },
    { id: "agent0000000003", name: "twin" },
  ];
  expect(
    commitBoardSearch("login label:Bug status:review agent:build", agents),
  ).toEqual({
    text: "login",
    changes: {
      label: "Bug",
      status: "needs_review",
      assignment: "agent0000000001",
    },
  });
  // Won't do is not a board column; an ambiguous agent names no single filter.
  expect(commitBoardSearch("status:wont_do agent:twin x", agents)).toEqual({
    text: "x status:wont_do agent:twin",
    changes: {},
  });
  expect(commitBoardSearch("release:0.20.0 agent:unassigned", agents)).toEqual({
    text: "release:0.20.0",
    changes: { assignment: "unassigned" },
  });
});
it("shows one removable chip per panel filter and clears each on its own", () => {
  expect(filterChips(defaultViewState)).toEqual([]);
  const state = {
    ...defaultViewState,
    assignment: "agent0000000001",
    hold: "on_hold" as const,
    heldOver: "3d",
    label: "Bug",
    status: "done",
    taskSort: "held" as const,
  };
  const chips = filterChips(state);
  expect(chips.map((chip) => chip.label)).toEqual([
    "On hold · over 3 days",
    "Label Bug",
    "Status Done",
    "Sort: Oldest hold first",
  ]);
  for (const chip of chips) {
    const next = { ...state, ...chip.clear };
    expect(filterChips(next).map((c) => c.key)).toEqual(
      chips.filter((c) => c !== chip).map((c) => c.key),
    );
  }
  expect(filterChips({ ...defaultViewState, hold: "ready" })[0].label).toBe("Ready");
  expect(filterChips({ ...state, ...clearedBoard })).toEqual([]);
  expect({ ...state, ...clearedBoard }.assignment).toBe("all");
});
