import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CrewWorkspace from "./CrewWorkspace";
import { crewApi, type Row } from "./crewApi";
import { searchApi } from "./Search";
import type { SearchHit, SearchRequest, SearchResult } from "./searchApi";

const agent: Row = {
  id: "agent0000000001",
  revision: 1,
  name: "Network",
  brief: "Voice",
};
const bucket: Row = {
  id: "bucket000000001",
  revision: 1,
  name: "NETWORK",
  purpose: "Voice and audiences",
  responsible_agent: agent.id,
};
const task: Row = {
  id: "task00000000001",
  revision: 3,
  title: "Launch post",
  description: "Introduce our product",
  status: "todo",
  assigned_agent: agent.id,
  labels: [],
  links: [],
  path: "#/tasks/launch-post-task00000000001",
};
const note: Row = {
  id: "note00000000001",
  revision: 1,
  title: "Launch voice",
  body: "Write plainly",
  bucket: bucket.id,
  links: [],
  path: "#/notes/launch-voice-note00000000001",
};
const taskHit = (id = task.id, title = String(task.title)): SearchHit => ({
  collection: "tasks",
  id,
  title,
  path: `#/tasks/x-${id}`,
  excerpt: "Plan the «launch» today",
  revision: 1,
  updated: "",
  status: "in_progress",
  assigned_agent_name: "Network",
});
const noteHit = (id = note.id, title = String(note.title)): SearchHit => ({
  collection: "notes",
  id,
  title,
  path: `#/notes/x-${id}`,
  excerpt: "Write «launch» copy plainly",
  revision: 1,
  updated: "",
  bucket_name: "NETWORK",
});
const result = (
  items: SearchHit[],
  more: Partial<SearchResult> = {},
): SearchResult => ({
  items,
  hasMore: false,
  nextOffset: null,
  generation: "g1",
  ...more,
});
type Call = {
  request: SearchRequest;
  resolve: (value: SearchResult) => void;
  reject: (error: unknown) => void;
};
let calls: Call[];
let fixtures: Record<string, Row[]>;
let archivedFixtures: Record<string, Row[]>;
/** Each search waits until the test settles it, so ordering is explicit. */
function controlledSearch() {
  return vi
    .spyOn(searchApi, "search")
    .mockImplementation(
      (request) =>
        new Promise((resolve, reject) =>
          calls.push({ request, resolve, reject }),
        ),
    );
}
beforeEach(() => {
  history.replaceState(null, "", "/#/team");
  calls = [];
  fixtures = {
    agents: [agent],
    buckets: [bucket],
    tasks: [task],
    notes: [note],
    reviews: [],
  };
  archivedFixtures = {};
  vi.spyOn(crewApi, "serverVersion").mockResolvedValue({
    version: "0.9.2",
    commit: "",
  });
  vi.spyOn(crewApi, "connection").mockResolvedValue({ kind: "local" });
  vi.spyOn(crewApi, "read").mockImplementation(async (c, f = {}) => {
    const rows = (f.archived ? archivedFixtures[c] : fixtures[c]) || [];
    return f.id ? rows.filter((x) => x.id === f.id) : rows;
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  history.replaceState(null, "", "/");
  vi.restoreAllMocks();
});
const box = () => screen.getByRole("combobox", { name: "Search Crew" });
async function ready() {
  render(<CrewWorkspace />);
  await screen.findByRole("heading", { name: "Launch post" });
}
const type = (text: string) =>
  fireEvent.change(box(), { target: { value: text } });
const option = (name: RegExp | string) =>
  within(screen.getByRole("listbox", { name: "Search results" })).getByRole(
    "option",
    { name },
  );

describe("live results", () => {
  it("waits for typing to pause and sends one prefix query", async () => {
    vi.useFakeTimers();
    const search = controlledSearch();
    render(<CrewWorkspace />);
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    type("l");
    type("la");
    act(() => vi.advanceTimersByTime(200));
    type("launch pl");
    act(() => vi.advanceTimersByTime(249));
    expect(search).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(search).toHaveBeenCalledTimes(1);
    expect(search.mock.calls[0][0]).toEqual({ query: "launch pl*", limit: 10 });
  });

  it("never lets an older response replace a newer one", async () => {
    controlledSearch();
    await ready();
    type("alpha");
    await waitFor(() => expect(calls).toHaveLength(1));
    type("beta");
    await waitFor(() => expect(calls).toHaveLength(2));
    // The first request was cancelled when the text changed.
    await act(async () => {
      calls[1].resolve(result([taskHit("task00000000002", "Beta result")]));
    });
    await screen.findByRole("option", { name: /Beta result/ });
    await act(async () => {
      calls[0].resolve(result([taskHit("task00000000003", "Alpha result")]));
    });
    expect(screen.queryByRole("option", { name: /Alpha result/ })).toBeNull();
    expect(screen.getByRole("option", { name: /Beta result/ })).toBeTruthy();
  });

  it("groups tasks, notes, agents and buckets with safe highlights", async () => {
    controlledSearch();
    await ready();
    type("netw");
    await waitFor(() => expect(calls).toHaveLength(1));
    const hostile = {
      ...noteHit(),
      title: "<b>bold</b> note",
      excerpt: '<img src=x onerror="alert(1)">«<i>netw</i>ork»',
    };
    await act(async () => calls[0].resolve(result([taskHit(), hostile])));
    const list = screen.getByRole("listbox", { name: "Search results" });
    const groups = within(list).getAllByRole("group");
    expect(groups.map((g) => within(g).getAllByRole("option").length)).toEqual([
      1, 1, 1, 1,
    ]);
    expect(
      within(list).getByRole("group", { name: "Tasks" }),
    ).toHaveTextContent(
      "Launch postIn progress · NetworkPlan the launch today",
    );
    expect(
      within(list).getByRole("group", { name: "Notes" }),
    ).toHaveTextContent("NETWORK");
    expect(
      within(list).getByRole("group", { name: "Agents" }),
    ).toHaveTextContent("Network");
    expect(
      within(list).getByRole("group", { name: "Buckets" }),
    ).toHaveTextContent("NETWORK");
    expect(list.querySelector("img, b, i, script")).toBeNull();
    const marks = [...list.querySelectorAll("mark")].map((m) => m.textContent);
    expect(marks).toEqual(["launch", "<i>netw</i>ork"]);
    expect(option(/See all results for “netw”/)).toBeTruthy();
  });

  it("explains no matches and failures in plain words", async () => {
    controlledSearch();
    await ready();
    type("zebra");
    await waitFor(() => expect(calls).toHaveLength(1));
    await act(async () => calls[0].resolve(result([])));
    await screen.findByText(
      "No tasks, notes, agents or buckets match “zebra”.",
    );
    type("zebras");
    await waitFor(() => expect(calls).toHaveLength(2));
    await act(async () => calls[1].reject({ status: 500 }));
    await screen.findByText(/Search isn't available right now/);
    type("x".repeat(1100));
    await screen.findByText(/That search is too long/);
    expect(calls).toHaveLength(2);
  });
});

describe("keyboard", () => {
  it("moves through options with the arrows and wraps", async () => {
    controlledSearch();
    await ready();
    type("netw");
    await waitFor(() => expect(calls).toHaveLength(1));
    await act(async () => calls[0].resolve(result([taskHit(), noteHit()])));
    const input = box();
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(input).not.toHaveAttribute("aria-activedescendant");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const first = option(/Launch post/);
    expect(input).toHaveAttribute("aria-activedescendant", first.id);
    expect(first).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input).toHaveAttribute(
      "aria-activedescendant",
      option(/Launch voice/).id,
    );
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input).toHaveAttribute(
      "aria-activedescendant",
      option(/See all results/).id,
    );
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(document.querySelector("[role=option]")).toBeNull();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input).toHaveAttribute("aria-expanded", "true");
  });

  it("focuses the field with / and Ctrl+K, but not while typing elsewhere", async () => {
    controlledSearch();
    await ready();
    fireEvent.keyDown(document.body, { key: "/" });
    expect(box()).toHaveFocus();
    box().blur();
    fireEvent.keyDown(document.body, { key: "k", ctrlKey: true });
    expect(box()).toHaveFocus();
    box().blur();
    fireEvent.keyDown(document.body, { key: "K", metaKey: true });
    expect(box()).toHaveFocus();
    const filter = screen.getByRole("searchbox", { name: "Search tasks" });
    filter.focus();
    fireEvent.keyDown(filter, { key: "/" });
    fireEvent.keyDown(filter, { key: "k", ctrlKey: true });
    expect(filter).toHaveFocus();
  });

  it("does nothing while a dialog is open", async () => {
    controlledSearch();
    history.replaceState(null, "", "/#/tasks/task00000000001");
    render(<CrewWorkspace />);
    await screen.findByRole("dialog");
    fireEvent.keyDown(document.body, { key: "/" });
    expect(box()).not.toHaveFocus();
  });

  it("goes to the results page on Enter without a chosen option", async () => {
    controlledSearch();
    await ready();
    type("launch plan");
    fireEvent.keyDown(box(), { key: "Enter" });
    await waitFor(() => expect(location.hash).toBe("#/search?q=launch%20plan"));
    await screen.findByRole("heading", { name: "Search", level: 1 });
    expect(document.title).toBe("Search · PocketContext Crew");
  });
});

describe("opening results", () => {
  async function results(text: string, hits: SearchHit[]) {
    controlledSearch();
    await ready();
    type(text);
    await waitFor(() => expect(calls).toHaveLength(1));
    await act(async () => calls[0].resolve(result(hits)));
  }

  it("opens a task with Enter at its bookmarkable path", async () => {
    await results("launch", [taskHit()]);
    fireEvent.keyDown(box(), { key: "ArrowDown" });
    fireEvent.keyDown(box(), { key: "Enter" });
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByDisplayValue("Launch post")).toBeTruthy();
    expect(location.hash).toBe("#/tasks/launch-post-task00000000001");
    expect(box()).toHaveAttribute("aria-expanded", "false");
  });

  it("opens a note on click", async () => {
    await results("launch", [noteHit()]);
    fireEvent.click(option(/Launch voice/));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByRole("heading", { name: "Launch voice" })).toBeTruthy();
    expect(location.hash).toBe("#/notes/launch-voice-note00000000001");
  });

  it("reads a note newer than the loaded workspace by id", async () => {
    const fresh: Row = {
      ...note,
      id: "note00000000009",
      title: "Fresh note",
      path: "",
    };
    await results("fresh", [noteHit(fresh.id, "Fresh note")]);
    fixtures.notes = [note, fresh];
    fireEvent.click(option(/Fresh note/));
    await screen.findByRole("dialog");
    expect(crewApi.read).toHaveBeenCalledWith("notes", {
      id: fresh.id,
      archived: false,
    });
    expect(location.hash).toBe("#/notes/note00000000009");
  });

  it("says so when a result can no longer be opened", async () => {
    await results("gone", [noteHit("note00000000008", "Gone note")]);
    fireEvent.click(option(/Gone note/));
    await screen.findByText(
      "That note couldn't be opened. It may have just changed; try again.",
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens an agent's dialog", async () => {
    await results("netw", []);
    fireEvent.click(
      within(screen.getByRole("group", { name: "Agents" })).getByRole("option"),
    );
    const dialog = await screen.findByRole("dialog", { name: "Edit agent" });
    expect(within(dialog).getByDisplayValue("Network")).toBeTruthy();
    expect(location.hash).toBe("#/team");
  });

  it("opens a bucket's dialog", async () => {
    await results("netw", []);
    fireEvent.click(
      within(screen.getByRole("group", { name: "Buckets" })).getByRole(
        "option",
      ),
    );
    const dialog = await screen.findByRole("dialog", { name: "Edit bucket" });
    expect(within(dialog).getByDisplayValue("NETWORK")).toBeTruthy();
  });
});

describe("search page", () => {
  const many = (from: number, count: number) =>
    Array.from({ length: count }, (_, i) =>
      taskHit(
        `task${String(from + i).padStart(11, "0")}`,
        `Result ${from + i}`,
      ),
    );

  it("shows a prompt for an empty or incomplete address", async () => {
    const search = controlledSearch();
    history.replaceState(null, "", "/#/search");
    render(<CrewWorkspace />);
    await screen.findByText(
      /Type what you're looking for in the search box at the top/,
    );
    act(() => {
      location.hash = "#/search?q=a&x=1";
    });
    await screen.findByText(/This search address isn't complete/);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(search).not.toHaveBeenCalled();
  });

  it("pages with next_offset and the generation token", async () => {
    controlledSearch();
    history.replaceState(null, "", "/#/search?q=result");
    render(<CrewWorkspace />);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].request).toEqual({
      query: "result*",
      limit: 20,
      archived: false,
    });
    expect(box()).toHaveValue("result");
    await act(async () =>
      calls[0].resolve(
        result(many(1, 20), {
          hasMore: true,
          nextOffset: 20,
          generation: "gen-a",
        }),
      ),
    );
    const list = screen.getByRole("list", { name: "Tasks and notes" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(20);
    fireEvent.click(screen.getByRole("button", { name: "Show more results" }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].request).toEqual({
      query: "result*",
      limit: 20,
      offset: 20,
      archived: false,
      generation: "gen-a",
    });
    await act(async () =>
      calls[1].resolve(result(many(21, 5), { generation: "gen-a" })),
    );
    expect(within(list).getAllByRole("listitem")).toHaveLength(25);
    expect(
      screen.queryByRole("button", { name: "Show more results" }),
    ).toBeNull();
  });

  it("starts again from the top on 409", async () => {
    controlledSearch();
    history.replaceState(null, "", "/#/search?q=result");
    render(<CrewWorkspace />);
    await waitFor(() => expect(calls).toHaveLength(1));
    await act(async () =>
      calls[0].resolve(
        result(many(1, 20), {
          hasMore: true,
          nextOffset: 20,
          generation: "gen-a",
        }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Show more results" }));
    await waitFor(() => expect(calls).toHaveLength(2));
    await act(async () =>
      calls[1].reject({
        status: 409,
        response: { data: { generation: "gen-b" } },
      }),
    );
    await waitFor(() => expect(calls).toHaveLength(3));
    expect(calls[2].request).toEqual({
      query: "result*",
      limit: 20,
      archived: false,
    });
    await act(async () =>
      calls[2].resolve(result(many(100, 3), { generation: "gen-b" })),
    );
    await screen.findByText(/results started again from the top/);
    const list = screen.getByRole("list", { name: "Tasks and notes" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((x) => x.textContent),
    ).toEqual([
      expect.stringContaining("Result 100"),
      expect.stringContaining("Result 101"),
      expect.stringContaining("Result 102"),
    ]);
  });

  it("adds archived matches only when asked", async () => {
    controlledSearch();
    archivedFixtures.notes = [
      { ...note, id: "note00000000007", title: "Old voice", archived: true },
    ];
    history.replaceState(null, "", "/#/search?q=voice");
    render(<CrewWorkspace />);
    await waitFor(() => expect(calls).toHaveLength(1));
    await act(async () => calls[0].resolve(result([noteHit()])));
    expect(calls.every((c) => c.request.archived === false)).toBe(true);
    expect(
      screen.queryByRole("heading", { name: "Archived tasks and notes" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Include archived" }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].request).toEqual({
      query: "voice*",
      limit: 20,
      archived: true,
    });
    await act(async () =>
      calls[1].resolve(result([noteHit("note00000000007", "Old voice")])),
    );
    const old = screen.getByRole("list", { name: "Archived tasks and notes" });
    fireEvent.click(within(old).getByRole("button", { name: /Old voice/ }));
    const dialog = await screen.findByRole("dialog", { name: "Archived note" });
    expect(within(dialog).getByText(/archived and read-only/)).toBeTruthy();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Close dialog" }),
    );
    await waitFor(() => expect(location.hash).toBe("#/search?q=voice"));
    fireEvent.click(screen.getByRole("checkbox", { name: "Include archived" }));
    expect(
      screen.queryByRole("heading", { name: "Archived tasks and notes" }),
    ).toBeNull();
  });

  it("shows a failure with a retry, and lists agent and bucket names", async () => {
    controlledSearch();
    history.replaceState(null, "", "/#/search?q=network");
    render(<CrewWorkspace />);
    await waitFor(() => expect(calls).toHaveLength(1));
    await act(async () => calls[0].reject({ status: 503 }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Search is busy right now. Try again in a moment.",
    );
    expect(screen.getByRole("heading", { name: "Agents" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Buckets" })).toBeTruthy();
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(calls).toHaveLength(2));
    await act(async () => calls[1].resolve(result([])));
    await screen.findByText(
      "No tasks or notes match. Try fewer or different words.",
    );
  });
});

describe("help", () => {
  it("has a help topic on the page and an entry in the Guide", async () => {
    controlledSearch();
    history.replaceState(null, "", "/#/guide/search");
    render(<CrewWorkspace />);
    const entry = await screen.findByRole("heading", {
      name: "Search",
      level: 3,
    });
    expect(entry.parentElement).toHaveClass("current");
    expect(
      within(entry.parentElement!).getByRole("link", { name: "Open Search" }),
    ).toHaveAttribute("href", "#/search");
    act(() => {
      location.hash = "#/search";
    });
    expect(
      await screen.findByRole("button", { name: "How does search work?" }),
    ).toBeTruthy();
  });
});
