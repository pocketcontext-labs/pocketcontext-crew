import { expect, it } from "vitest";
import {
  heldDuration,
  knownLabels,
  labelMatches,
  longHolds,
  statusMatches,
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
