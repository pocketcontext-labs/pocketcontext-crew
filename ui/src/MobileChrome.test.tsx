import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ColumnSwitcher from "./ColumnSwitcher";
import CrewWorkspace from "./CrewWorkspace";
import { MobileTabBar } from "./MobileChrome";
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
  it.each([
    ["home", "Home", "#/"],
    ["board", "Tasks", "#/tasks?column=in_progress&sort=title"],
    ["memory", "Notes", "#/notes?bucket=bucket000000001&q=launch"],
    ["reviews", "Approvals", "#/approvals"],
  ] as const)(
    "retaps the current %s page without navigating",
    (view, name, hash) => {
      history.replaceState(null, "", hash);
      const entries = history.length;
      const scroll = vi.fn();
      vi.stubGlobal("scrollTo", scroll);
      vi.stubGlobal("scrollY", 680);
      render(<MobileTabBar view={view} pending={0} />);
      const link = tabs().getByRole("link", { name, current: "page" });
      expect(fireEvent.click(link)).toBe(false);
      expect(scroll).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
      vi.stubGlobal("scrollY", 0);
      expect(fireEvent.click(link)).toBe(false);
      expect(scroll).toHaveBeenCalledTimes(1);
      expect(location.hash).toBe(hash);
      expect(history.length).toBe(entries);
    },
  );

  it("honors reduced motion when the current page is chosen again in More", () => {
    const hash = "#/shared?show=archived";
    history.replaceState(null, "", hash);
    const scroll = vi.fn();
    vi.stubGlobal("scrollTo", scroll);
    vi.stubGlobal("scrollY", 500);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
    }));
    render(<MobileTabBar view="shared" pending={0} />);
    fireEvent.click(tabs().getByRole("button", { name: "More" }));
    expect(scroll).not.toHaveBeenCalled();
    const current = sheet("More").getByRole("link", {
      name: "Shared",
      current: "page",
    });
    expect(fireEvent.click(current)).toBe(false);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(scroll).toHaveBeenCalledWith({ top: 0, behavior: "instant" });
    expect(location.hash).toBe(hash);
  });

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
    ).toEqual(["Home", "Tasks", "Notes", "Approvals"]);
    // Pending drafts show as a dot; the count is in the tab's name.
    const approvals = tabs().getByRole("link", { name: "Approvals, 1 pending" });
    expect(approvals.querySelector(".crew-tab-dot")).toBeTruthy();
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
    expect(more.getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Agents",
      "Connect an agent",
      "Shared",
      "Archive",
      "Settings",
      "Guide",
    ]);
    // Since 0.36.0 Sign out is in Settings.
    expect(more.queryByRole("button", { name: "Sign out" })).toBeNull();
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

describe("phone Home", () => {
  beforeEach(() => {
    history.replaceState(null, "", "/#/");
    localStorage.clear();
  });
  afterEach(() => localStorage.clear());

  it("opens a create menu from + instead of a new task", async () => {
    render(<CrewWorkspace />);
    await screen.findByRole("region", { name: "Agents" });
    const plus = screen.getByRole("button", { name: "Create" });
    expect(plus).toHaveAttribute("aria-haspopup", "dialog");
    fireEvent.click(plus);
    const menu = within(screen.getByRole("dialog", { name: "Create" }));
    expect(menu.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Task",
      "Note",
      "Bucket",
      "Agent",
      "Shared page",
    ]);
    expect(screen.queryByRole("dialog", { name: /New task/ })).toBeNull();
    fireEvent.click(menu.getByRole("button", { name: "Bucket" }));
    expect(screen.queryByRole("dialog", { name: "Create" })).toBeNull();
    expect(await screen.findByRole("dialog")).toHaveTextContent(/bucket/i);
  });

  it("creates a Shared page draft from the create menu and opens it to write", async () => {
    render(<CrewWorkspace />);
    await screen.findByRole("region", { name: "Agents" });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Create" })).getByRole("button", {
        name: "Shared page",
      }),
    );
    const form = within(screen.getByRole("dialog", { name: "New shared page" }));
    fireEvent.click(form.getByRole("button", { name: "Create draft" }));
    expect(form.getByRole("alert")).toHaveTextContent("Give the page a title.");
    vi.mocked(crewApi.write).mockResolvedValueOnce({
      id: "artifact0000001",
      revision: 1,
    });
    fireEvent.change(form.getByLabelText("Title"), {
      target: { value: "Synthetic launch page" },
    });
    fireEvent.click(form.getByRole("button", { name: "Create draft" }));
    await waitFor(() =>
      expect(crewApi.write).toHaveBeenCalledWith(
        "artifact.create",
        { title: "Synthetic launch page", body: "" },
        undefined,
        "New shared page",
      ),
    );
    await waitFor(() => expect(location.hash).toBe("#/shared/artifact0000001"));
  });

  it("hides the How it works row with Don't show this again, kept on the server", async () => {
    const view = render(<CrewWorkspace />);
    const link = await screen.findByRole("link", {
      name: "New to Crew? Read how it works",
    });
    expect(link).toHaveAttribute("href", "#/guide");
    const box = within(link.closest(".crew-home-guide") as HTMLElement).getByRole(
      "checkbox",
      { name: "Don't show this again" },
    );
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    expect(box).toBeChecked();
    await waitFor(() =>
      expect(crewApi.write).toHaveBeenCalledWith(
        "settings.update",
        { hidden_help: ["home.guide_row"] },
        expect.objectContaining({ id: "settings0000001" }),
      ),
    );
    // Still on screen until the owner leaves; gone on the next visit.
    expect(screen.getByRole("link", { name: /Read how it works/ })).toBeTruthy();
    view.unmount();
    render(<CrewWorkspace />);
    await screen.findByRole("region", { name: "Agents" });
    expect(screen.queryByRole("link", { name: /Read how it works/ })).toBeNull();
  });

  it("carries the old per-browser hides over to the server once", async () => {
    localStorage.setItem("pocketcontext.crew.how_it_works_hidden", "1");
    localStorage.setItem("pocketcontext.crew.get_started_hidden", "1");
    render(<CrewWorkspace />);
    await screen.findByRole("region", { name: "Agents" });
    await waitFor(() =>
      expect(crewApi.write).toHaveBeenCalledWith(
        "settings.update",
        { hidden_help: ["home.guide_row", "home.get_started"] },
        expect.anything(),
      ),
    );
    await waitFor(() =>
      expect(localStorage.getItem("pocketcontext.crew.how_it_works_hidden")).toBeNull(),
    );
    expect(localStorage.getItem("pocketcontext.crew.get_started_hidden")).toBeNull();
    expect(screen.queryByRole("link", { name: /Read how it works/ })).toBeNull();
  });

  it("shows How it works in the page menu until hidden, then on demand", async () => {
    render(<CrewWorkspace />);
    await screen.findByRole("region", { name: "Agents" });
    fireEvent.click(screen.getByRole("button", { name: "Page options" }));
    let menu = sheet("Home");
    const about = menu.getByRole("region", { name: "About this page" });
    expect(about).toHaveTextContent(/^Where you and your AI agents/);
    const box = within(about).getByRole("checkbox", { name: "Don't show this again" });
    fireEvent.click(box);
    await waitFor(() =>
      expect(crewApi.write).toHaveBeenCalledWith(
        "settings.update",
        { hidden_help: ["page.home"] },
        expect.anything(),
      ),
    );
    // Kept while the menu is open; with the panel showing, How it works goes on to the Guide.
    expect(menu.getByRole("region", { name: "About this page" })).toBeTruthy();
    fireEvent.click(menu.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Home" })).toBeNull());
    // Hidden: the menu opens without it, and How it works opens it in place, checked.
    fireEvent.click(screen.getByRole("button", { name: "Page options" }));
    menu = sheet("Home");
    expect(menu.queryByRole("region", { name: "About this page" })).toBeNull();
    const how = menu.getByRole("button", { name: "How it works" });
    expect(how).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(how);
    const shown = menu.getByRole("region", { name: "About this page" });
    const again = within(shown).getByRole("checkbox", { name: "Don't show this again" });
    expect(again).toBeChecked();
    fireEvent.click(again);
    await waitFor(() =>
      expect(crewApi.write).toHaveBeenLastCalledWith(
        "settings.update",
        { hidden_help: [] },
        expect.anything(),
      ),
    );
    fireEvent.click(menu.getByRole("button", { name: "How it works" }));
    await waitFor(() => expect(location.hash).toBe("#/guide/home"));
  });

  it("keeps + a direct create on Tasks and Notes", async () => {
    history.replaceState(null, "", "/#/tasks");
    render(<CrewWorkspace />);
    await screen.findByText("Write the launch post");
    expect(screen.getByRole("button", { name: "New task" })).not.toHaveAttribute(
      "aria-haspopup",
    );
    expect(screen.queryByRole("button", { name: "Create" })).toBeNull();
  });
});

/** The switcher's markup with every text and count stripped. */
function switcherShape() {
  const root = document.querySelector(".crew-column-switcher");
  const walk = (el: Element): unknown => [
    el.tagName,
    [...el.classList].filter((c) => c !== "crew-bucket-switcher").join(" "),
    [...el.children].map(walk),
  ];
  return root && walk(root);
}
const SWITCHER_SHAPE = [
  "DIV",
  "crew-column-switcher",
  [
    ["BUTTON", "crew-switch-step", [["svg", "crew-micon-svg", expect.anything()]]],
    [
      "BUTTON",
      "crew-switch-name",
      [
        [
          "SPAN",
          "crew-switch-title",
          [
            ["STRONG", "", []],
            ["SPAN", "crew-switch-count", []],
            ["SPAN", "crew-switch-of", []],
          ],
        ],
      ],
    ],
    ["BUTTON", "crew-switch-step", [["svg", "crew-micon-svg", expect.anything()]]],
  ],
];

describe("ColumnSwitcher", () => {
  const options = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      status: `s${i}`,
      label: `Option ${i}`,
      count: i * 3,
    }));

  it("renders one markup for columns, buckets and statuses, with no dots", () => {
    for (const [n, item] of [
      [4, "column"],
      [10, "bucket"],
      [4, "status"],
    ] as const) {
      for (const at of [0, Math.floor(n / 2), n - 1]) {
        const onSelect = vi.fn();
        const { unmount } = render(
          <ColumnSwitcher
            columns={options(n)}
            current={`s${at}`}
            onSelect={onSelect}
            item={item}
          />,
        );
        expect(switcherShape()).toEqual(SWITCHER_SHAPE);
        expect(document.querySelector(".crew-switch-dots, i")).toBeNull();
        const name = screen.getByRole("button", {
          name: /^(Column|Bucket|Status) /,
        });
        expect(name).toHaveTextContent(
          `Option ${at}· ${at * 3}(${at + 1} of ${n})`,
        );
        const previous = screen.getByRole("button", { name: `Previous ${item}` });
        const next = screen.getByRole("button", { name: `Next ${item}` });
        expect((previous as HTMLButtonElement).disabled).toBe(at === 0);
        expect((next as HTMLButtonElement).disabled).toBe(at === n - 1);
        if (at < n - 1) {
          fireEvent.click(next);
          expect(onSelect).toHaveBeenLastCalledWith(`s${at + 1}`);
        }
        fireEvent.click(name);
        expect(screen.getAllByRole("button", { current: true })).toHaveLength(1);
        unmount();
      }
    }
  });

  it("shows an option's hint in the picker and on the name, for Shared", () => {
    render(
      <ColumnSwitcher
        columns={[
          { status: "live", label: "Live", count: 3 },
          { status: "ended", label: "Revoked", count: 1, hint: "Revoked or expired" },
        ]}
        current="ended"
        onSelect={() => {}}
        item="status"
        noun={["shared page", "shared pages"]}
      />,
    );
    const name = screen.getByRole("button", {
      name: "Status Revoked, 1 shared page, 2 of 2. Choose a status",
    });
    expect(name).toHaveAttribute("title", "Revoked or expired");
    fireEvent.click(name);
    expect(
      screen.getAllByRole("button", { current: true }).map((b) => b.textContent),
    ).toEqual(["RevokedRevoked or expired1✓"]);
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
    expect(switcherShape()).toEqual(SWITCHER_SHAPE);
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

  it("switches buckets with fixed previous and next, then shows note rows", async () => {
    render(<CrewWorkspace />);
    await screen.findByText("Launch voice");
    expect(screen.queryByRole("group", { name: "Filter by bucket" })).toBeNull();
    const previous = screen.getByRole("button", { name: "Previous bucket" });
    const next = screen.getByRole("button", { name: "Next bucket" });
    const name = () => screen.getByRole("button", { name: /^Bucket .*Choose a bucket$/ });
    expect(previous).toBeDisabled();
    expect(name()).toHaveTextContent("All· 3(1 of 3)");
    expect(name()).toHaveAccessibleName("Bucket All, 3 notes, 1 of 3. Choose a bucket");
    // The same component and markup as the board's switcher, no dots.
    expect(switcherShape()).toEqual(SWITCHER_SHAPE);
    expect(document.querySelector(".crew-bucket-switcher")).toBe(
      document.querySelector(".crew-column-switcher"),
    );
    // No bucket cards with permanent Edit buttons.
    expect(
      screen.queryByRole("button", { name: "Edit bucket NETWORK" }),
    ).toBeNull();
    const row = screen.getByRole("button", { name: /Launch voice/ });
    expect(row).toHaveTextContent("NETWORK");
    expect(row.querySelector("time")).toBeTruthy();
    expect(row).toHaveTextContent("Body of Launch voice");
    // All first, then buckets A–Z with live counts and a check on the current one.
    fireEvent.click(name());
    const picker = within(screen.getByRole("group", { name: "Buckets" }));
    expect(picker.getAllByRole("button").map((x) => x.textContent)).toEqual([
      "All3✓",
      "BUILD1",
      "NETWORK2",
    ]);
    fireEvent.click(picker.getByRole("button", { name: /^NETWORK/ }));
    expect(screen.queryByRole("group", { name: "Buckets" })).toBeNull();
    expect(location.hash).toBe(`#/notes?bucket=${bucket.id}`);
    expect(name()).toHaveTextContent("NETWORK· 2(3 of 3)");
    expect(next).toBeDisabled();
    expect(screen.queryByText("Release plan")).toBeNull();
    fireEvent.click(previous);
    expect(name()).toHaveTextContent("BUILD· 1(2 of 3)");
    expect(screen.getByText("Release plan")).toBeTruthy();
    expect(screen.queryByText("Launch voice")).toBeNull();
    fireEvent.click(previous);
    expect(location.hash).toBe("#/notes");
    expect(previous).toBeDisabled();
  });

  it("edits the selected bucket from the page menu", async () => {
    history.replaceState(null, "", `/#/notes?bucket=${bucket.id}`);
    render(<CrewWorkspace />);
    await screen.findByText("Launch voice");
    fireEvent.click(screen.getByRole("button", { name: "Page options" }));
    fireEvent.click(
      sheet("Notes").getByRole("button", { name: "Edit bucket NETWORK" }),
    );
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
    const bucket = filters.getByRole("combobox", { name: "Filter by bucket" });
    const options = within(bucket).getAllByRole<HTMLOptionElement>("option");
    expect(options).toHaveLength(3);
    expect(options[0].textContent).toMatch(/^All buckets · /);
    fireEvent.change(bucket, { target: { value: options[1].value } });
    fireEvent.click(filters.getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: /^Filter and sort/ }));
    const reopened = sheet("Filter and sort").getByLabelText(
      "Filter by bucket",
    ) as HTMLSelectElement;
    expect(reopened.value).toBe(options[1].value);
    fireEvent.change(reopened, { target: { value: "" } });
    fireEvent.click(
      sheet("Filter and sort").getByRole("button", { name: "Done" }),
    );
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
