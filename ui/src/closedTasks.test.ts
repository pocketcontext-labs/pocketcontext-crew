import { describe, expect, it } from "vitest";
import type { Row } from "./crewApi";
import { approvalLine, doneColumn, isClosed } from "./closedTasks";

const now = Date.parse("2026-11-12T12:00:00Z");
const day = 86_400_000;
const row = (id: string, extra: Partial<Row>): Row => ({
  id,
  revision: 1,
  status: "done",
  ...extra,
});
const at = (msAgo: number) =>
  new Date(now - msAgo).toISOString().replace("T", " ");

describe("closed task helpers", () => {
  it("treats Done and Won't do as closed", () => {
    expect(isClosed(row("a", { status: "done" }))).toBe(true);
    expect(isClosed(row("a", { status: "wont_do" }))).toBe(true);
    expect(isClosed(row("a", { status: "todo" }))).toBe(false);
    expect(isClosed(undefined)).toBe(false);
  });
  it("lists the Done column newest change first, folding older tasks", () => {
    const tasks = [
      row("old", { updated: at(9 * day) }),
      row("plain", { updated: at(day + 1000) }),
      row("a", { updated: at(2 * day) }),
      row("c", { updated: at(day), status: "wont_do" }),
    ];
    const recent = doneColumn(tasks, false, now);
    expect(recent.older).toBe(1);
    expect(recent.tasks.map((t) => t.id)).toEqual(["c", "plain", "a"]);
    const all = doneColumn(tasks, true, now);
    expect(all.older).toBe(0);
    expect(all.tasks.map((t) => t.id)).toEqual(["c", "plain", "a", "old"]);
  });
  it("describes an in-session approval only", () => {
    expect(approvalLine(row("a", { review_mode: "crew" }))).toBe("");
    const line = approvalLine(
      row("a", {
        review_mode: "in_session",
        approved_by: "Synthetic Owner",
        approved_at: "2026-11-12 10:00:00.000Z",
      }),
    );
    expect(line).toMatch(/^Approved in session by Synthetic Owner, \S/);
    expect(approvalLine(row("a", { review_mode: "in_session" }))).toBe(
      "Approved in session by owner",
    );
  });
});
