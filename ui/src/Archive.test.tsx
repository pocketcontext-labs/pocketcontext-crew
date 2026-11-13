import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Archive, {
  archivePageSize,
  archiveStateFromHash,
  archiveStateHash,
} from "./Archive";
import type { Row } from "./crewApi";

const id = (prefix: string, n: number) =>
  `${prefix}${String(n).padStart(15 - prefix.length, "0")}`;
const at = (n: number) =>
  new Date(Date.UTC(2026, 0, 1) + n * 60000).toISOString();

function seed() {
  const buckets: Row[] = Array.from({ length: 100 }, (_, n) => ({
    id: id("bucket", n),
    revision: 1,
    name: `Bucket ${String(n).padStart(3, "0")}`,
    archived: true,
    archived_at: at(n),
    archived_by: "owner",
  }));
  const live: Row = { id: id("livebucket", 1), revision: 1, name: "LIVE" };
  const tasks: Row[] = Array.from({ length: 500 }, (_, n) => ({
    id: id("task", n),
    revision: 2,
    title: `Synthetic task ${String(n).padStart(3, "0")}`,
    labels: n % 2 ? ["Bug"] : ["Feature"],
    archived: true,
    archived_at: at(n),
    archived_by: n % 5 ? "owner" : "Build",
  }));
  const notes: Row[] = Array.from({ length: 500 }, (_, n) => ({
    id: id("note", n),
    revision: 1,
    title: `Synthetic note ${String(n).padStart(3, "0")}`,
    bucket: live.id,
    archived: true,
    archived_at: at(n),
    archived_by: "owner",
  }));
  // Twelve notes hidden by one archived bucket (not archived themselves).
  for (let n = 0; n < 12; n++)
    notes.push({
      id: id("hidden", n),
      revision: 1,
      title: `Hidden note ${n}`,
      bucket: buckets[7].id,
      archived: false,
    });
  return { archived: { tasks, notes, buckets, agents: [] }, live: [live] };
}

beforeEach(() => history.replaceState(null, "", "/#/archive"));
afterEach(cleanup);

function renderArchive(restore = vi.fn()) {
  const { archived, live } = seed();
  render(
    <Archive
      archived={archived}
      buckets={live}
      busy={false}
      restore={restore}
    />,
  );
  return { restore, archived };
}
const rows = () =>
  screen
    .getByRole("list", { name: /Tasks|Notes|Buckets/ })
    .querySelectorAll("li");

it("shows one category at a time with counts and at most 50 rows, newest first", () => {
  renderArchive();
  expect(screen.getByRole("tab", { name: "Tasks (500)" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(screen.getByRole("tab", { name: "Notes (512)" })).toBeInTheDocument();
  expect(
    screen.getByRole("tab", { name: "Buckets (100)" }),
  ).toBeInTheDocument();
  expect(rows()).toHaveLength(archivePageSize);
  expect(rows()[0]).toHaveTextContent("Synthetic task 499");
  expect(rows()[0]).toHaveTextContent(/Archived .+ by owner/);
  fireEvent.click(screen.getByRole("button", { name: "Show more (450 left)" }));
  expect(rows()).toHaveLength(100);
});

it("searches, filters and sorts across the whole archive and keeps it in the address", () => {
  renderArchive();
  fireEvent.change(
    screen.getByRole("searchbox", { name: "Search archived tasks by title" }),
    {
      target: { value: "task 01" },
    },
  );
  // Matches beyond the first page: 010-019.
  expect(rows()).toHaveLength(10);
  fireEvent.change(screen.getByRole("combobox", { name: "Filter by label" }), {
    target: { value: "Bug" },
  });
  expect(rows()).toHaveLength(5);
  fireEvent.change(screen.getByRole("combobox", { name: "Sort archive" }), {
    target: { value: "title" },
  });
  expect(rows()[0]).toHaveTextContent("Synthetic task 011");
  expect(location.hash).toBe("#/archive?q=task+01&sort=title&filter=Bug");
  fireEvent.change(
    screen.getByRole("searchbox", { name: "Search archived tasks by title" }),
    {
      target: { value: "nothing like this" },
    },
  );
  expect(
    screen.getByText("No archived tasks match “nothing like this”."),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("tab", { name: /^Buckets/ }));
  expect(location.hash).toBe(
    "#/archive?tab=buckets&q=nothing+like+this&sort=title",
  );
});

it("reads its tab and filters back from the address", () => {
  expect(
    archiveStateFromHash("#/archive?tab=notes&q=x&sort=title&filter=b1"),
  ).toEqual({
    tab: "notes",
    query: "x",
    sort: "title",
    filter: "b1",
  });
  expect(archiveStateFromHash("#/archive?tab=nope")).toEqual({
    tab: "tasks",
    query: "",
    sort: "archived",
    filter: "",
  });
  expect(
    archiveStateHash({ tab: "tasks", query: "", sort: "archived", filter: "" }),
  ).toBe("#/archive");
});

it("groups notes hidden by an archived bucket under one Restore bucket", () => {
  const { restore, archived } = renderArchive();
  fireEvent.click(screen.getByRole("tab", { name: /^Notes/ }));
  expect(
    screen.getByText("12 notes hidden by archived bucket Bucket 007"),
  ).toBeInTheDocument();
  expect(screen.queryByText("Hidden note 0")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Show notes" }));
  expect(screen.getByText("Hidden note 0")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Restore bucket" }));
  expect(restore).toHaveBeenCalledWith([
    { collection: "buckets", row: archived.buckets[7] },
  ]);
  // Notes filter by bucket.
  fireEvent.change(screen.getByRole("combobox", { name: "Filter by bucket" }), {
    target: { value: archived.buckets[7].id },
  });
  expect(
    screen.queryAllByRole("button", { name: /^Restore Synthetic/ }),
  ).toHaveLength(0);
});

it("restores a selection and a single row", () => {
  const { restore, archived } = renderArchive();
  const list = screen.getByRole("list", { name: "Tasks" });
  fireEvent.click(
    within(list).getByRole("checkbox", { name: "Select Synthetic task 499" }),
  );
  fireEvent.click(
    within(list).getByRole("checkbox", { name: "Select Synthetic task 498" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Restore selected (2)" }));
  expect(restore).toHaveBeenCalledWith([
    { collection: "tasks", row: archived.tasks[499] },
    { collection: "tasks", row: archived.tasks[498] },
  ]);
  fireEvent.click(screen.getByRole("checkbox", { name: "Select shown" }));
  expect(
    screen.getByRole("button", { name: "Restore selected (50)" }),
  ).toBeEnabled();
  fireEvent.click(
    within(list).getByRole("button", { name: "Restore Synthetic task 460" }),
  );
  expect(restore).toHaveBeenLastCalledWith([
    { collection: "tasks", row: archived.tasks[460] },
  ]);
});
