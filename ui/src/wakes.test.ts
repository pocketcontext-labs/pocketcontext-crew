import { expect, it } from "vitest";
import type { Row } from "./crewApi";
import { strandedSince, strandedWakes } from "./wakes";

const agents: Row[] = [{ id: "agent0000000001", revision: 1, name: "Build" }];
const task = (id: string, extra: Partial<Row> = {}): Row => ({
  id,
  revision: 1,
  status: "todo",
  assigned_agent: "agent0000000001",
  ...extra,
});
const bridge = (id: string, taskId: string, extra: Partial<Row> = {}): Row => ({
  id,
  revision: 1,
  task_id: taskId,
  overdue: true,
  created: "2026-11-10 10:00:00.000Z",
  ...extra,
});

it("keeps overdue wakes on open tasks filed by someone else, latest per task", () => {
  const tasks = [
    task("t1"),
    task("t2", { status: "done" }),
    task("t3", { archived: true }),
    task("t4", { created_by_agent: "build" }),
    task("t5", { created_by_agent: "agent0000000001" }),
    task("t6", { created_by_agent: "Learn" }),
  ];
  const result = strandedWakes(
    [
      bridge("b1", "t1"),
      bridge("b1b", "t1", { created: "2026-11-11 10:00:00.000Z" }),
      bridge("b2", "t2"),
      bridge("b3", "t3"),
      bridge("b4", "t4"),
      bridge("b5", "t5"),
      bridge("b6", "t6", { overdue: false }),
      bridge("b7", ""),
      bridge("b8", "missing"),
    ],
    tasks,
    agents,
  );
  expect(result.map((x) => x.bridge.id)).toEqual(["b1b"]);
});

it("dates a stranded wake by its deadline, then its preparation", () => {
  expect(
    strandedSince({
      id: "b",
      revision: 1,
      deadline_at: "D",
      wake_prepared_at: "P",
      created: "C",
    }),
  ).toBe("D");
  expect(strandedSince({ id: "b", revision: 1, created: "C" })).toBe("C");
});
