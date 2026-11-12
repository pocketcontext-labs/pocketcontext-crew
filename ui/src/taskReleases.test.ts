import { describe, expect, it } from "vitest";
import type { Row } from "./crewApi";
import {
  approvalLine,
  compareReleases,
  doneColumn,
  isClosed,
  knownReleases,
  noRelease,
  releaseMatches,
} from "./taskReleases";

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

describe("compareReleases", () => {
  it("orders semantic versions newest first, numerically", () => {
    expect(
      ["0.9.0", "0.19.0", "0.18.1", "1.0.0", "0.19.0-rc.2", "0.19.0-rc.10", "v0.20.0"].sort(
        compareReleases,
      ),
    ).toEqual(["1.0.0", "v0.20.0", "0.19.0", "0.19.0-rc.10", "0.19.0-rc.2", "0.18.1", "0.9.0"]);
  });
  it("puts other names after versions, in a numeric-aware string order", () => {
    expect(["spring", "0.1.0", "build 9", "build 10"].sort(compareReleases)).toEqual([
      "0.1.0",
      "spring",
      "build 10",
      "build 9",
    ]);
  });
});

describe("release helpers", () => {
  it("treats Done and Won't do as closed", () => {
    expect(isClosed(row("a", { status: "done" }))).toBe(true);
    expect(isClosed(row("a", { status: "wont_do" }))).toBe(true);
    expect(isClosed(row("a", { status: "todo" }))).toBe(false);
    expect(isClosed(undefined)).toBe(false);
  });
  it("lists known releases newest first and filters by release or none", () => {
    const tasks = [
      row("a", { release: "0.18.0" }),
      row("b", { release: "0.19.0" }),
      row("c", { release: "" }),
      row("d", { release: "0.19.0" }),
    ];
    expect(knownReleases(tasks)).toEqual(["0.19.0", "0.18.0"]);
    expect(tasks.filter((t) => releaseMatches("0.19.0", t)).map((t) => t.id)).toEqual([
      "b",
      "d",
    ]);
    expect(tasks.filter((t) => releaseMatches(noRelease, t)).map((t) => t.id)).toEqual(["c"]);
    expect(tasks.filter((t) => releaseMatches("", t))).toHaveLength(4);
  });
  it("groups the Done column by release with No release last, folding older tasks", () => {
    const tasks = [
      row("old", { release: "0.17.0", updated: at(9 * day) }),
      row("plain", { release: "", updated: at(day) }),
      row("a", { release: "0.18.0", updated: at(2 * day) }),
      row("b", { release: "0.19.0", updated: at(3 * day) }),
      row("c", { release: "0.19.0", updated: at(day), status: "wont_do" }),
    ];
    const recent = doneColumn(tasks, false, now);
    expect(recent.older).toBe(1);
    expect(recent.groups.map((g) => [g.release, g.tasks.map((t) => t.id)])).toEqual([
      ["0.19.0", ["c", "b"]],
      ["0.18.0", ["a"]],
      ["", ["plain"]],
    ]);
    const all = doneColumn(tasks, true, now);
    expect(all.older).toBe(0);
    expect(all.groups.map((g) => g.release)).toEqual(["0.19.0", "0.18.0", "0.17.0", ""]);
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
