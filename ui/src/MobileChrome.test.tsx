import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CrewWorkspace from "./CrewWorkspace";
import { attachmentsApi } from "./attachmentsApi";
import { crewApi, type Row } from "./crewApi";
import { resetReferencesForTests } from "./references";
import { resetSessionGuideForTests } from "./sessionGuide";
import { resetTrail } from "./trail";
import { phoneQuery } from "./usePhone";

const agent: Row = {
  id: "agent0000000001",
  revision: 1,
  name: "Network",
  brief: "",
};
const other: Row = {
  id: "agent0000000002",
  revision: 1,
  name: "Build",
  brief: "",
};
const bucket: Row = {
  id: "bucket000000001",
  revision: 1,
  name: "NETWORK",
  responsible_agent: agent.id,
  purpose: "Voice and audiences",
};
const bucket2: Row = {
  id: "bucket000000002",
  revision: 1,
  name: "BUILD",
  responsible_agent: other.id,
  purpose: "Product plans",
};
const task = (
  id: string,
  title: string,
  status: string,
  assigned = agent.id,
): Row => ({
  id,
  revision: 1,
  title,
  description: `About ${title}`,
  status,
  assigned_agent: assigned,
  labels: [],
  links: [],
  updated: "2026-11-17 10:00:00.000Z",
});
const note = (
  id: string,
  title: string,
  inBucket: string,
  updated: string,
): Row => ({
  id,
  revision: 1,
  title,
  body: `Body of ${title}`,
  bucket: inBucket,
  links: [],
  updated,
});
let fixtures: Record<string, Row[]>;

beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === phoneQuery,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  history.replaceState(null, "", "/#/tasks");
  fixtures = {
    agents: [agent, other],
    buckets: [bucket, bucket2],
    tasks: [
      task("task00000000001", "Write the launch post", "todo"),
      task("task00000000002", "Plan the talk", "todo", other.id),
      task("task00000000003", "Fix the login", "in_progress"),
      task("task00000000004", "Ship the release", "done"),
    ],
    reviews: [
      {
        id: "review000000001",
        revision: 1,
        task: "task00000000003",
        draft: "Draft",
        status: "pending",
      },
    ],
    notes: [
      note(
        "note00000000001",
        "Launch voice",
        bucket.id,
        "2026-11-17 10:00:00.000Z",
      ),
      note(
        "note00000000002",
        "Release plan",
        bucket2.id,
        "2026-11-16 10:00:00.000Z",
      ),
      note(
        "note00000000003",
        "Audience list",
        bucket.id,
        "2026-11-15 10:00:00.000Z",
      ),
    ],
    events: [],
    settings: [{ id: "settings0000001", revision: 1, session_guide_off: true }],
  };
  vi.spyOn(crewApi, "serverVersion").mockResolvedValue({
    version: "0.33.0",
    commit: "synthetic-build",
  });
  vi.spyOn(crewApi, "connection").mockResolvedValue({
    kind: "mcp",
    url: "https://crew.example/mcp",
  });
  vi.spyOn(crewApi, "read").mockImplementation(async (c, f = {}) =>
    f.archived ? [] : fixtures[c] || [],
  );
  vi.spyOn(crewApi, "write").mockResolvedValue({ id: "x", revision: 1 });
  vi.spyOn(attachmentsApi, "cardThumbnails").mockResolvedValue({});
  vi.spyOn(attachmentsApi, "fileToken").mockResolvedValue("file-token");
  vi.spyOn(crewApi, "references").mockResolvedValue([]);
});
afterEach(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 20));
  history.replaceState(null, "", "/");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetSessionGuideForTests();
  resetReferencesForTests();
  resetTrail();
});

const tabs = () =>
  within(screen.getByRole("navigation", { name: "Workspace" }));
const sheet = (name: string) => within(screen.getByRole("dialog", { name }));

describe("phone chrome", () => {
  it("has a one-row top bar and bottom tabs instead of the sidebar", async () => {
    render(<CrewWorkspace />);
    await screen.findByText("Write the launch post");
    expect(
      screen.getByRole("heading", { level: 1, name: "Tasks" }),
    ).toBeTruthy();
    for (const name of ["Search", "Filters", "New task", "Page options"])
      expect(screen.getByRole("button", { name })).toBeTruthy();
    expect(
      tabs()
        .getAllByRole("link")
        .map((x) => x.textContent),
    ).toEqual(["Home", "Tasks", "Notes", "1Approvals"]);
    expect(
      tabs().getByRole("link", { name: "Approvals, 1 pending" }),
    ).toBeTruthy();
    expect(tabs().getByRole("link", { name: "Tasks" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(tabs().getByRole("button", { name: "More" })).toBeTruthy();
    // No sidebar, intro text or page help on the page itself.
    expect(screen.queryByText("POCKETCONTEXT / CREW")).toBeNull();
    expect(screen.queryByText(/Follow each task from request/)).toBeNull();
    expect(
      screen.queryByRole("button", { name: "What is the Tasks page?" }),
    ).toBeNull();
  });

  it("keeps the intro, help and Refresh in the page menu", async () => {
    render(<CrewWorkspace />);
    await screen.findByText("Write the launch post");
    fireEvent.click(screen.getByRole("button", { name: "Page options" }));
    const menu = sheet("Tasks");
    expect(menu.getByText(/Follow each task from request/)).toBeTruthy();
    expect(menu.getByText(/Every task and where it stands/)).toBeTruthy();
    expect(
      menu.getByRole("link", { name: "Learn more in the Guide" }),
    ).toHaveAttribute("href", "#/guide/board");
    const reads = vi.mocked(crewApi.read).mock.calls.length;
    fireEvent.click(menu.getByRole("button", { name: "Refresh" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await screen.findByText("Updated.");
    expect(vi.mocked(crewApi.read).mock.calls.length).toBeGreaterThan(reads);
  });

  it("reaches Shared, Agents and Archive from More", async () => {
    render(<CrewWorkspace />);
    await screen.findByText("Write the launch post");
    fireEvent.click(tabs().getByRole("button", { name: "More" }));
    const more = sheet("More");
    for (const name of [
      "Shared",
      "Agents",
      "Archive",
      "Connect an agent",
      "Guide",
    ])
      expect(more.getByRole("link", { name })).toBeTruthy();
    expect(more.getByRole("button", { name: "Sign out" })).toBeTruthy();
    fireEvent.click(more.getByRole("link", { name: "Agents" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    location.hash = "#/agents";
    await screen.findByRole("heading", { level: 1, name: "Agents" });
    expect(tabs().getByRole("button", { name: "More" })).toHaveClass(
      "is-current",
    );
    expect(screen.getByRole("button", { name: "New agent" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Filters" })).toBeNull();
  });
});

describe("phone board", () => {
  it("shows one column at a time with fixed previous and next", async () => {
    render(<CrewWorkspace />);
    await screen.findByText("Write the launch post");
    const previous = screen.getByRole("button", { name: "Previous column" });
    const next = screen.getByRole("button", { name: "Next column" });
    const name = () => screen.getByRole("button", { name: /^Column / });
    expect(previous).toBeDisabled();
    expect(name()).toHaveTextContent("To do· 2(1 of 4)");
    expect(screen.getByText("Plan the talk")).toBeTruthy();
    expect(screen.queryByText("Fix the login")).toBeNull();
    fireEvent.click(next);
    expect(name()).toHaveTextContent("In progress· 1(2 of 4)");
    expect(screen.getByText("Fix the login")).toBeTruthy();
    expect(screen.queryByText("Plan the talk")).toBeNull();
    expect(previous).not.toBeDisabled();
    fireEvent.click(name());
    const picker = within(screen.getByRole("group", { name: "Columns" }));
    expect(picker.getAllByRole("button").map((x) => x.textContent)).toEqual([
      "To do2",
      "In progress1✓",
      "Needs review0",
      "Done1",
    ]);
    fireEvent.click(picker.getByRole("button", { name: /^Done/ }));
    expect(screen.queryByRole("group", { name: "Columns" })).toBeNull();
    expect(name()).toHaveTextContent("Done· 1(4 of 4)");
    expect(next).toBeDisabled();
    expect(screen.getByText("Ship the release")).toBeTruthy();
  });

  it("starts on the column a Home tile asks for", async () => {
    history.replaceState(null, "", "/#/tasks?column=in_progress");
    render(<CrewWorkspace />);
    await screen.findByText("Fix the login");
    expect(screen.getByRole("button", { name: /^Column / })).toHaveTextContent(
      "In progress",
    );
  });

  it("steps a task dialog through the shown column only", async () => {
    render(<CrewWorkspace />);
    fireEvent.click(await screen.findByText("Write the launch post"));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText("1 of 2")).toBeTruthy();
  });

  it("keeps search, scope, sort, agents and filters in a sheet, shown as chips when closed", async () => {
    render(<CrewWorkspace />);
    await screen.findByText("Write the launch post");
    expect(screen.queryByRole("textbox", { name: "Search tasks" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Filter by agent" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    const filters = sheet("Filters");
    for (const label of [
      "Search tasks",
      "Filter by assignment",
      "Sort tasks",
      "Filter by hold",
      "Filter by label",
      "Filter by status",
    ])
      expect(filters.getByLabelText(label)).toBeTruthy();
    fireEvent.click(
      within(filters.getByRole("group", { name: "Filter by agent" })).getByRole(
        "button",
        { name: /^Build,/ },
      ),
    );
    fireEvent.change(filters.getByLabelText("Search tasks"), {
      target: { value: "talk" },
    });
    fireEvent.click(filters.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    const chips = within(screen.getByRole("group", { name: "Active filters" }));
    expect(chips.getByText("Agent: Build")).toBeTruthy();
    expect(chips.getByText("“talk”")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Filters, 2 on" })).toBeTruthy();
    expect(location.hash).toBe(`#/tasks?agent=${other.id}`);
    fireEvent.click(
      chips.getByRole("button", { name: "Remove filter Agent: Build" }),
    );
    expect(location.hash).toBe("#/tasks");
    expect(screen.getByRole("button", { name: "Filters, 1 on" })).toBeTruthy();
  });
});

describe("phone Notes", () => {
  beforeEach(() => history.replaceState(null, "", "/#/notes"));

  it("shows bucket chips with counts and note rows first", async () => {
    render(<CrewWorkspace />);
    await screen.findByText("Launch voice");
    const chips = within(
      screen.getByRole("group", { name: "Filter by bucket" }),
    );
    expect(
      chips.getByRole("button", { name: "All buckets, 3 notes" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      chips.getByRole("button", { name: "NETWORK, 2 notes" }),
    ).toBeTruthy();
    expect(chips.getByRole("button", { name: "BUILD, 1 note" })).toBeTruthy();
    // No bucket cards with permanent Edit buttons.
    expect(
      screen.queryByRole("button", { name: "Edit bucket NETWORK" }),
    ).toBeNull();
    expect(chips.queryByRole("button", { name: /options$/ })).toBeNull();
    const row = screen.getByRole("button", { name: /Launch voice/ });
    expect(row).toHaveTextContent("NETWORK");
    expect(row.querySelector("time")).toBeTruthy();
    expect(row).toHaveTextContent("Body of Launch voice");
    fireEvent.click(chips.getByRole("button", { name: "NETWORK, 2 notes" }));
    expect(location.hash).toBe(`#/notes?bucket=${bucket.id}`);
    expect(screen.queryByText("Release plan")).toBeNull();
    fireEvent.click(
      chips.getByRole("button", { name: "Bucket NETWORK options" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit bucket" }));
    await screen.findByRole("dialog");
    expect(location.hash).toContain(bucket.id);
  });

  it("filters and sorts in a sheet", async () => {
    render(<CrewWorkspace />);
    await screen.findByText("Launch voice");
    fireEvent.click(screen.getByRole("button", { name: "Filter and sort" }));
    const filters = sheet("Filter and sort");
    fireEvent.click(filters.getByRole("radio", { name: "Name" }));
    expect(location.hash).toBe("#/notes?sort=title");
    fireEvent.change(filters.getByLabelText("Filter by responsible agent"), {
      target: { value: agent.id },
    });
    fireEvent.change(filters.getByLabelText("Search notes"), {
      target: { value: "audience" },
    });
    expect(
      within(
        filters.getByRole("group", { name: "Filter by bucket" }),
      ).getAllByRole("button", { name: /options$/ }),
    ).toHaveLength(2);
    fireEvent.click(filters.getByRole("button", { name: "Done" }));
    expect(screen.getByText("Audience list")).toBeTruthy();
    expect(screen.queryByText("Launch voice")).toBeNull();
    expect(screen.queryByText("Release plan")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Filter and sort, 2 on" }),
    ).toBeTruthy();
  });

  it("puts New bucket in the page menu", async () => {
    render(<CrewWorkspace />);
    await screen.findByText("Launch voice");
    fireEvent.click(screen.getByRole("button", { name: "Page options" }));
    fireEvent.click(sheet("Notes").getByRole("button", { name: "New bucket" }));
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "New bucket" })).toBeTruthy(),
    );
  });
});
