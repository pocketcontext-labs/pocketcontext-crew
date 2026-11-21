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
import { resetSessionGuideForTests } from "./sessionGuide";
import CrewWorkspace from "./CrewWorkspace";
import { crewApi, type Row } from "./crewApi";
import { attachmentsApi } from "./attachmentsApi";
import { resetReferencesForTests } from "./references";
import { resetTrail } from "./trail";
import { resetLanguageForTests, setLanguage } from "./i18n";
const agent: Row = {
  id: "agent0000000001",
  revision: 1,
  name: "Network",
  brief: "Save decisions, not every activity.",
};
const bucket: Row = {
  id: "bucket000000001",
  revision: 1,
  name: "NETWORK",
  responsible_agent: agent.id,
  purpose: "Voice and audiences",
};
const task: Row = {
  id: "task00000000001",
  revision: 3,
  title: "Launch post",
  description: "Introduce our product",
  status: "needs_review",
  assigned_agent: agent.id,
  draft: "The submitted draft",
  labels: ["Network"],
  links: [],
};
const review: Row = {
  id: "review000000001",
  revision: 1,
  task: task.id,
  draft: "The submitted draft",
  status: "pending",
};
let fixtures: Record<string, Row[]>;
beforeEach(() => {
  history.replaceState(null, "", "/#/tasks");
  vi.spyOn(crewApi, "serverVersion").mockResolvedValue({
    version: "0.3.1",
    commit: "synthetic-build",
  });
  fixtures = {
    agents: [agent],
    buckets: [bucket],
    tasks: [task],
    reviews: [review],
    notes: [],
    events: [],
    note_revisions: [],
    // The session guide is off unless a test turns it on.
    settings: [{ id: "settings0000001", revision: 1, session_guide_off: true }],
  };
  vi.spyOn(crewApi, "connection").mockResolvedValue({
    kind: "mcp",
    url: "https://crew.example/mcp",
  });
  vi.spyOn(crewApi, "read").mockImplementation(async (c, f = {}) =>
    f.archived ? [] : fixtures[c] || [],
  );
  vi.spyOn(crewApi, "write").mockResolvedValue({
    ...review,
    status: "approved",
  });
  vi.spyOn(attachmentsApi, "cardThumbnails").mockResolvedValue({});
  vi.spyOn(attachmentsApi, "fileToken").mockResolvedValue("file-token");
  vi.spyOn(crewApi, "references").mockResolvedValue([]);
});
afterEach(async () => {
  cleanup();
  // Closing a dialog opened from a list goes back in history (0.32.0); let a
  // traversal still queued from the test land before the next test starts.
  await new Promise((resolve) => setTimeout(resolve, 20));
  history.replaceState(null, "", "/");
  vi.restoreAllMocks();
  resetSessionGuideForTests();
  resetReferencesForTests();
  resetTrail();
});
/** Opens the board's Filters panel (if closed) and returns it. */
/** Matches the innermost element whose whole text (dates included) matches. */
const fullText = (re: RegExp) => (_: string, el: Element | null) => {
  const text = (e: Element) => (e.textContent ?? "").replace(/\s+/g, " ").trim();
  return !!el && re.test(text(el)) && !Array.from(el.children).some((c) => re.test(text(c)));
};
function openFilters() {
  const button = screen.getByRole("button", { name: /^Filters/ });
  if (button.getAttribute("aria-expanded") !== "true") fireEvent.click(button);
  return within(screen.getByRole("group", { name: "Task filters" }));
}
async function openPage(name: string | RegExp) {
  const link = screen.getByRole("link", { name });
  fireEvent.click(link);
  await waitFor(() => expect(link).toHaveAttribute("aria-current", "page"));
}
describe("empty Tasks board", () => {
  it.each(["desktop", "phone"])("opens the first task from the only creation action on %s", async (layout) => {
    fixtures.tasks = [];
    fixtures.reviews = [];
    fixtures.agents = [];
    fixtures.buckets = [];
    if (layout === "phone")
      vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(max-width: 680px)" }));
    try {
      render(<CrewWorkspace />);
      const empty = await screen.findByRole("region", { name: "No tasks yet" });
      expect(screen.queryByRole("searchbox", { name: "Search tasks" })).toBeNull();
      expect(screen.queryByRole("button", { name: /Filters|New task/ })).toBeNull();
      expect(screen.getByRole("button", { name: "Set up starter crew" })).toBeVisible();
      expect(screen.queryByRole("heading", { name: /^To do/ })).toBeNull();
      fireEvent.click(within(empty).getByRole("button", { name: "Create your first task" }));
      expect(within(await screen.findByRole("dialog")).getByLabelText("Hold")).toHaveValue("waiting");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("preserves filters with zero matches and shows the empty state after clearing", async () => {
    fixtures.tasks = [];
    history.replaceState(null, "", "/#/tasks?label=sample");
    render(<CrewWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "Clear all" }));
    await screen.findByRole("button", { name: "Create your first task" });
    expect(location.hash).toBe("#/tasks");
  });
});

it("opens the page named by the address and titles it", async () => {
  history.replaceState(null, "", "/#/approvals");
  render(<CrewWorkspace />);
  await screen.findAllByText("The submitted draft");
  expect(screen.getByRole("link", { name: /^Approvals/ })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(document.title).toBe("Approvals · PocketContext Crew");
});
it("puts each page in the address", async () => {
  render(<CrewWorkspace />);
  await screen.findByRole("heading", { name: "Launch post" });
  await openPage("Agents");
  expect(location.hash).toBe("#/agents");
  await openPage("Tasks");
  expect(location.hash).toBe("#/tasks");
  await openPage("Home");
  expect(location.hash).toBe("#/");
});
it("returns to the current page when an item closes or Back is used", async () => {
  history.replaceState(null, "", "/#/approvals");
  render(<CrewWorkspace />);
  await screen.findAllByText("The submitted draft");
  location.hash = "#/tasks/task00000000001";
  let dialog = within(await screen.findByRole("dialog"));
  expect(document.title).toBe("Launch post · PocketContext Crew");
  fireEvent.click(dialog.getByRole("button", { name: "Close dialog" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(location.hash).toBe("#/approvals");
  location.hash = "#/tasks/task00000000001";
  dialog = within(await screen.findByRole("dialog"));
  expect(dialog.getByRole("button", { name: "Close dialog" })).toBeTruthy();
  location.hash = "#/approvals";
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByRole("link", { name: /^Approvals/ })).toHaveAttribute(
    "aria-current",
    "page",
  );
});
it("shows note previews without Markdown markers", async () => {
  fixtures.notes = [
    {
      id: "note00000000001",
      revision: 1,
      title: "Voice guide",
      body: "## Summary\n\n**Task:** `abc` and snake_case\n- [site](https://x.test)",
      bucket: bucket.id,
    },
  ];
  render(<CrewWorkspace />);
  await screen.findByRole("heading", { name: "Launch post" });
  await openPage("Notes");
  expect(
    screen.getByText(/^Summary Task: abc and snake_case site$/),
  ).toBeInTheDocument();
});
it("closes an overlay on a backdrop click but not on a drag from inside", async () => {
  history.replaceState(null, "", "/#/tasks/task00000000001");
  render(<CrewWorkspace />);
  const dialog = await screen.findByRole("dialog");
  const outside = { clientX: -5, clientY: -5 };
  fireEvent.mouseDown(within(dialog).getAllByRole("textbox")[0]);
  fireEvent.click(dialog, outside);
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  fireEvent.mouseDown(dialog, { clientX: 0, clientY: 0 });
  fireEvent.click(dialog, { clientX: 0, clientY: 0 });
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  fireEvent.mouseDown(dialog, outside);
  fireEvent.click(dialog, outside);
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(location.hash).toBe("#/tasks");
});
it("keeps the dialog and the draft comment when a file picker is cancelled", async () => {
  history.replaceState(null, "", "/#/tasks/task00000000001?tab=comments");
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  let now = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  render(<CrewWorkspace />);
  const dialog = await screen.findByRole("dialog");
  const box = await within(dialog).findByPlaceholderText(
    "Paste or drop screenshots here",
  );
  fireEvent.change(box, { target: { value: "Half-written comment" } });
  const input = within(dialog).getByLabelText("Attach files to the comment");
  fireEvent.click(within(dialog).getByRole("button", { name: "Attach files" }));
  // Dismissing the native picker fires a bubbling cancel on the input, and a
  // stray Escape or backdrop click may follow.
  fireEvent(input, new Event("cancel", { bubbles: true, cancelable: true }));
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  const outside = { clientX: -5, clientY: -5 };
  fireEvent.mouseDown(dialog, outside);
  fireEvent.click(dialog, outside);
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(box).toHaveValue("Half-written comment");
  expect(confirm).not.toHaveBeenCalled();
  // A cancel bubbling from any file input never closes the dialog by itself.
  now += 5_000;
  const other = document.createElement("input");
  other.type = "file";
  dialog.appendChild(other);
  fireEvent(other, new Event("cancel", { bubbles: true, cancelable: true }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  other.remove();
  // Escape on the dialog itself still closes it once the picker is gone.
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});
it("asks before discarding edits, and only when something changed", async () => {
  history.replaceState(null, "", "/#/tasks/task00000000001");
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  render(<CrewWorkspace />);
  const dialog = await screen.findByRole("dialog");
  fireEvent.change(within(dialog).getAllByRole("textbox")[0], {
    target: { value: "Edited title" },
  });
  const closeButton = within(dialog).getByRole("button", {
    name: "Close dialog",
  });
  fireEvent.click(closeButton);
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  location.hash = "#/agents";
  await waitFor(() => expect(confirm).toHaveBeenCalledTimes(2));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  confirm.mockReturnValue(true);
  fireEvent.click(closeButton);
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});
it("does not ask when nothing was edited", async () => {
  history.replaceState(null, "", "/#/tasks/task00000000001");
  const confirm = vi.spyOn(window, "confirm");
  render(<CrewWorkspace />);
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Close dialog" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(confirm).not.toHaveBeenCalled();
});
it("shows one loading message on Home until the workspace is ready", async () => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  vi.mocked(crewApi.read).mockImplementation(async (collection, filters = {}) => {
    await gate;
    return filters.archived ? [] : fixtures[collection] || [];
  });
  history.replaceState(null, "", "/#/");
  render(<CrewWorkspace />);
  expect(screen.getAllByText("Loading your workspace…")).toHaveLength(1);
  release();
  await waitFor(() => expect(screen.queryByText("Loading your workspace…")).toBeNull());
});

it("takes the brand link to Home", async () => {
  history.replaceState(null, "", "/#/agents");
  render(<CrewWorkspace />);
  await screen.findByRole("link", { name: "Agents" });
  fireEvent.click(screen.getByRole("link", { name: /go to Home/ }));
  await waitFor(() => expect(location.hash).toBe("#/"));
  expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});
it("guides a new owner from step one even with a previous workspace confirmation", async () => {
  fixtures = { agents: [], buckets: [], tasks: [], reviews: [], notes: [] };
  localStorage.clear();
  localStorage.setItem("pocketcontext.crew.agent_connected", "1");
  history.replaceState(null, "", "/");
  render(<CrewWorkspace />);
  await screen.findByRole("heading", { name: "Get started" });
  expect(screen.getByText("0 of 5 done")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Set up starter crew" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "I've connected it" })).toBeNull();
  expect(
    screen.getByRole("link", { name: "0 approvals waiting, open Approvals" }),
  ).toHaveAttribute("href", "#/approvals");
  expect(
    screen.getByRole("link", { name: "0 tasks on hold, show on the Tasks board" }),
  ).toHaveAttribute("href", "#/tasks?hold=on_hold");
});
it("reopens crew setup when all agents are deactivated", async () => {
  fixtures = { agents: [], buckets: [], tasks: [], reviews: [], notes: [] };
  serveArchived({ agents: [{ ...agent, archived: true }] });
  localStorage.clear();
  history.replaceState(null, "", "/");
  render(<CrewWorkspace />);
  expect(await screen.findByRole("button", { name: "Set up starter crew" })).toBeVisible();
  expect(screen.getByText("0 of 5 done")).toBeVisible();
});
it.each(["tasks", "notes", "approvals", "shared", "agents", "archive", "settings", "guide", "connect", "search"])(
  "offers starter setup on %s when buckets remain but every agent is inactive", async (route) => {
    fixtures.agents = [];
    serveArchived({ agents: [{ ...agent, archived: true }] });
    history.replaceState(null, "", "/#/" + route);
    render(<CrewWorkspace />);
    expect(await screen.findByRole("button", { name: "Set up starter crew" })).toBeEnabled();
  },
);
it("restores starter agents in place when their buckets already exist", async () => {
  const roles = ["Build", "Deploy", "Design", "Learn", "Network"];
  const inactive = roles.map((name, i) => ({ ...agent, id: "agent" + i, name, archived: true }));
  fixtures.agents = [];
  fixtures.buckets = inactive.map((role, i) => ({
    ...bucket, id: "bucket" + i, name: role.name.toUpperCase(), responsible_agent: role.id,
  }));
  fixtures.notes = fixtures.buckets.map((b, i) => ({ id: "note" + i, revision: 1, title: "About this bucket", bucket: b.id }));
  serveArchived({ agents: inactive });
  vi.mocked(crewApi.write).mockImplementation(async (_action, data, row) => ({ ...row!, ...data }));
  render(<CrewWorkspace />);
  fireEvent.click(await screen.findByRole("button", { name: "Set up starter crew" }));
  await screen.findByText("Your five starter agents and their buckets are ready.");
  expect(crewApi.write).toHaveBeenCalledTimes(5);
  for (const role of inactive) {
    expect(crewApi.write).toHaveBeenCalledWith("agent.update", { archived: false }, role);
  }
});
it("advances past a manually confirmed connection and remembers it", async () => {
  fixtures.tasks = [];
  fixtures.reviews = [];
  localStorage.clear();
  history.replaceState(null, "", "/");
  render(<CrewWorkspace />);
  fireEvent.click(await screen.findByRole("button", { name: "I've connected it" }));
  expect(await screen.findByRole("button", { name: "＋ New task" })).toBeTruthy();
  expect(localStorage.getItem("pocketcontext.crew.agent_connected." + agent.id)).toBe("1");
  localStorage.clear();
});
it("counts agent activity as connected and lists what needs the owner", async () => {
  localStorage.clear();
  history.replaceState(null, "", "/");
  render(<CrewWorkspace />);
  await screen.findByText("Draft waiting for your approval");
  expect(screen.getByText("2 of 5 done")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open Tasks" })).toBeTruthy();
  fireEvent.click(screen.getByText("Draft waiting for your approval"));
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
});
it("prefills the onboarding task with an editable request for human approval", async () => {
  localStorage.setItem("pocketcontext.crew.agent_connected." + agent.id, "1");
  fixtures.tasks = [];
  fixtures.reviews = [];
  history.replaceState(null, "", "/");
  render(<CrewWorkspace />);
  fireEvent.click(await screen.findByRole("button", { name: "＋ New task" }));
  const dialog = within(screen.getByRole("dialog"));
  expect(dialog.getByLabelText("Title")).toHaveValue("Draft a welcome message for the crew");
  expect(dialog.getByLabelText("Assigned agent")).toHaveValue(agent.id);
  expect(dialog.getByLabelText("Hold")).toHaveValue("ready");
  expect(dialog.getByText(/Save the message in Draft for review/, { selector: "p" })).toHaveTextContent("review.request");
});
it("requires a Ready assignment and a separate prompt handoff before review", async () => {
  localStorage.clear();
  localStorage.setItem("pocketcontext.crew.agent_connected." + agent.id, "1");
  fixtures.reviews = [];
  fixtures.tasks = [{ ...task, readiness: "ready", assigned_agent: "" }];
  history.replaceState(null, "", "/");
  const first = render(<CrewWorkspace />);
  expect(await screen.findByRole("link", { name: "Open Tasks" })).toBeVisible();
  first.unmount();
  fixtures.tasks = [{ ...task, readiness: "ready", status: "todo" }];
  render(<CrewWorkspace />);
  expect(await screen.findByText(/paste it into a chat connected to Crew/)).toHaveTextContent(task.title as string);
  fireEvent.click(screen.getByRole("button", { name: "I've pasted and sent the prompt" }));
  expect(await screen.findByRole("link", { name: "Open Approvals" })).toBeVisible();
});
it.each(["approved", "changes_requested", "rejected"])("keeps onboarding complete after a %s decision when the task is no longer Ready", async (status) => {
  localStorage.clear();
  fixtures.tasks = [{ ...task, readiness: "waiting" }];
  fixtures.reviews = [{ ...review, status }];
  history.replaceState(null, "", "/");
  render(<CrewWorkspace />);
  await screen.findByRole("heading", { name: "Agents" });
  expect(screen.queryByRole("heading", { name: "Get started" })).toBeNull();
});
it("manages connected apps inside Crew and confirms before disconnecting", async () => {
  vi.spyOn(crewApi, "connection").mockResolvedValue({
    kind: "mcp",
    url: "https://crew.example.test/mcp",
  });
  const apps = vi
    .spyOn(crewApi, "connectedApps")
    .mockResolvedValue([{ id: "grant1", name: "Grok", created: 1700000000 }]);
  const revoke = vi.spyOn(crewApi, "revokeConnectedApp").mockResolvedValue();
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  history.replaceState(null, "", "/#/connect");
  render(<CrewWorkspace />);
  const button = await screen.findByRole("button", { name: "Disconnect" });
  expect(screen.getByText("Grok")).toBeInTheDocument();
  fireEvent.click(button);
  expect(revoke).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  apps.mockResolvedValue([]);
  fireEvent.click(button);
  await screen.findByText("No apps connected yet.");
  expect(revoke).toHaveBeenCalledWith("grant1");
});
it("opens task Markdown in Read and edits it second", async () => {
  history.replaceState(null, "", "/#/tasks/task00000000001");
  render(<CrewWorkspace />);
  const dialog = within(await screen.findByRole("dialog"));
  const views = within(dialog.getByRole("tablist", { name: "Description view" }));
  expect(views.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
    "Read",
    "Edit",
  ]);
  expect(views.getByRole("tab", { name: "Read" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(
    dialog.getByText("Introduce our product", { selector: "p" }),
  ).toBeInTheDocument();
  fireEvent.click(views.getByRole("tab", { name: "Edit" }));
  fireEvent.change(dialog.getByLabelText("Description"), {
    target: { value: "**Bold step**" },
  });
  fireEvent.click(views.getByRole("tab", { name: "Read" }));
  expect(dialog.getByText("Bold step").tagName).toBe("STRONG");
  fireEvent.click(views.getByRole("tab", { name: "Edit" }));
  expect(dialog.getByLabelText("Description")).toHaveValue("**Bold step**");
});
it("keeps legacy copy blocks out of the brief and preserves their source when saving a draft", async () => {
  const original = 'Introduce our product\n\n:::copy{label="Copy for X"}\n\nSynthetic legacy post\n\n:::';
  fixtures.tasks = [{ ...task, description: original }];
  history.replaceState(null, "", "/#/tasks/task00000000001");
  render(<CrewWorkspace />);
  const dialog = within(await screen.findByRole("dialog"));
  expect(dialog.getByText("Introduce our product", { selector: "p" })).toBeVisible();
  expect(dialog.queryByText("Synthetic legacy post", { selector: "p" })).toBeNull();
  const brief = within(dialog.getByRole("tablist", { name: "Description view" }));
  fireEvent.click(brief.getByRole("tab", { name: "Edit" }));
  expect(dialog.getByLabelText("Description")).toHaveValue(original);

  const draft = within(dialog.getByRole("tablist", { name: "Draft for review view" }));
  fireEvent.click(draft.getByRole("tab", { name: "Edit" }));
  fireEvent.change(dialog.getByLabelText("Draft for review"), { target: { value: "Revised post" } });
  fireEvent.click(dialog.getByRole("button", { name: "Save task" }));
  await waitFor(() => expect(crewApi.write).toHaveBeenCalled());
  const [, fields] = vi.mocked(crewApi.write).mock.calls[0];
  expect(fields).toMatchObject({ draft: "Revised post" });
  expect(fields).not.toHaveProperty("description");
});
it("gives agents with the same first letter distinct initials", async () => {
  fixtures.agents = [
    agent,
    { id: "agent0000000002", revision: 1, name: "Deploy", brief: "Ships." },
    { id: "agent0000000003", revision: 1, name: "Design", brief: "Draws." },
  ];
  history.replaceState(null, "", "/#/agents");
  render(<CrewWorkspace />);
  const card = async (name: string) =>
    (await screen.findByRole("heading", { name })).closest("button")!;
  expect((await card("Deploy")).querySelector(".crew-avatar")).toHaveTextContent(/^Dep$/);
  expect((await card("Design")).querySelector(".crew-avatar")).toHaveTextContent(/^Des$/);
  expect((await card("Network")).querySelector(".crew-avatar")).toHaveTextContent(/^N$/);
  expect(screen.queryByText(/Edit brief and responsibilities/)).toBeNull();
});
it("previews a Markdown brief as clamped plain text, one line per block, with the full text on hover", async () => {
  const brief =
    "Save decisions.\n\n## Standing approval\n- Not every **activity**\n  - Ask first";
  fixtures.agents = [{ ...agent, brief }];
  history.replaceState(null, "", "/#/agents");
  render(<CrewWorkspace />);
  const card = (await screen.findByRole("heading", { name: "Network" })).closest(
    "button",
  )!;
  const preview = card.querySelector("p")!;
  const text = "Save decisions.\nStanding approval\n• Not every activity\n• Ask first";
  expect(preview.textContent).toBe(text);
  expect(preview.textContent).not.toMatch(/[#*]/);
  expect(preview).toHaveAttribute("title", text);
});
it("sizes a long agent brief once its dialog is shown, and on rewrap", async () => {
  const observers: ResizeObserverCallback[] = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(cb: ResizeObserverCallback) {
        observers.push(cb);
      }
      observe() {}
      disconnect() {}
    },
  );
  // A field in a dialog not yet shown measures zero, as in a browser.
  let shown = false;
  let width = 0;
  vi.spyOn(HTMLTextAreaElement.prototype, "scrollHeight", "get").mockImplementation(
    () => (shown ? (width < 400 ? 900 : 600) : 0),
  );
  vi.spyOn(HTMLTextAreaElement.prototype, "clientWidth", "get").mockImplementation(
    () => width,
  );
  try {
    fixtures.agents = [{ ...agent, brief: "A long brief.\n".repeat(60) }];
    history.replaceState(null, "", "/#/agents");
    render(<CrewWorkspace />);
    fireEvent.click(
      (await screen.findByRole("heading", { name: "Network" })).closest("button")!,
    );
    const dialog = within(await screen.findByRole("dialog"));
    const field = dialog.getByLabelText("Agent brief") as HTMLTextAreaElement;
    expect(field.style.height).toBe("auto");
    // A non-empty brief opens in Read; Edit shows the growing editor.
    expect(field).not.toBeVisible();
    fireEvent.click(dialog.getByRole("tab", { name: "Edit" }));
    shown = true;
    width = 480;
    act(() => observers.forEach((cb) => cb([], {} as ResizeObserver)));
    expect(field.style.height).toBe("602px");
    width = 320;
    act(() => observers.forEach((cb) => cb([], {} as ResizeObserver)));
    expect(field.style.height).toBe("902px");
  } finally {
    vi.unstubAllGlobals();
  }
});
it("opens a review from anywhere on its Approvals card, which holds no other controls", async () => {
  history.replaceState(null, "", "/#/approvals");
  render(<CrewWorkspace />);
  const card = await screen.findByRole("button", {
    name: "Review draft: Launch post",
  });
  expect(card.tagName).toBe("BUTTON");
  expect(card).toHaveAttribute("type", "button");
  expect(card).toHaveAccessibleDescription("The submitted draft");
  expect(
    card.querySelectorAll("a, button, input, select, textarea, [tabindex]"),
  ).toHaveLength(0);
  expect(screen.queryByText(/Review exact draft/)).toBeNull();
  // Clicking the preview text, not a button, opens the same review.
  fireEvent.click(within(card).getByText("The submitted draft"));
  const dialog = await screen.findByRole("dialog");
  expect(
    within(dialog).getByRole("button", { name: "Approve draft" }),
  ).toBeInTheDocument();
});
it("previews the first option when a review carries alternatives", async () => {
  fixtures.reviews = [{ ...review, draft: "An internal note for the reviewer", options: [
    { key: "a", label: "Reply A", body: ":::variant{channel=linkedin}\nProposed reply\n:::" },
    { key: "b", label: "Reply B", body: "A different reply" },
  ] }];
  history.replaceState(null, "", "/#/approvals");
  render(<CrewWorkspace />);
  const card = await screen.findByRole("button", { name: "Review draft: Launch post" });
  expect(card).toHaveTextContent("Proposed reply");
  expect(card).not.toHaveTextContent(/internal note|different reply|:::/);
});

it("shows channels and the first variant on the Approvals card", async () => {
  fixtures.reviews = [{ ...review, draft: [
    ":::note", "Reviewer reminder", ":::",
    ":::variant{channel=linkedin}", "First **post**", ":::",
    ":::variant{channel=x}", "Second post", ":::",
  ].join("\n") }];
  history.replaceState(null, "", "/#/approvals");
  render(<CrewWorkspace />);
  const card = await screen.findByRole("button", { name: "Review draft: Launch post" });
  expect(within(card).getByText("LinkedIn")).toBeVisible();
  expect(within(card).getByText("X")).toBeVisible();
  expect(card).toHaveTextContent("First post");
  expect(card).not.toHaveTextContent(/:::|Reviewer reminder|Second post/);
});
describe("review links (#/approvals/<id>)", () => {
  const decided: Row = {
    ...review,
    id: "review000000002",
    revision: 2,
    status: "approved",
    decided_by: "owner:user00000000001",
    decided_at: "2026-11-15T10:00:00.000Z",
    decision_note: "Ship it",
  };
  it("opens a pending review's dialog with its actions, no tap needed", async () => {
    history.replaceState(null, "", "/#/approvals/review000000001");
    render(<CrewWorkspace />);
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByRole("heading", { name: "Approval", level: 2 })).toBeVisible();
    expect(dialog.getByRole("group", { name: "Link history" })).toBeVisible();
    expect(dialog.getByText("Approvals", { exact: true })).toBeVisible();
    expect(dialog.getByRole("heading", { name: "Launch post", level: 3 })).toBeVisible();
    expect(dialog.queryByRole("tablist")).toBeNull();
    for (const name of ["Approve draft", "Request changes"])
      expect(dialog.getByRole("button", { name })).toBeEnabled();
    // Reject is a secondary action: last in the More menu, in red (0.32.0).
    expect(dialog.queryByRole("button", { name: "Reject" })).toBeNull();
    const more = dialog.getByRole("button", { name: "More actions" });
    await waitFor(() => expect(more).toBeEnabled());
    fireEvent.click(more);
    const items = dialog.getAllByRole("menuitem");
    expect(items.at(-1)).toHaveTextContent("Reject");
    expect(items.at(-1)).toHaveClass("crew-menu-danger");
    expect(items.map((x) => x.textContent)).toEqual(
      expect.arrayContaining(["Add note", "Copy link"]),
    );
    expect(screen.getByRole("link", { name: /^Approvals/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(location.hash).toBe("#/approvals/review000000001");
  });
  it("opens a decided review read-only with its outcome, who and when", async () => {
    fixtures.reviews = [review, decided];
    history.replaceState(null, "", "/#/approvals/review000000002");
    render(<CrewWorkspace />);
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText(fullText(/^Approved .* by you\.$/))).toBeTruthy();
    expect(dialog.getByText("Ship it")).toBeTruthy();
    for (const name of ["Approve draft", "Request changes", "Reject"])
      expect(dialog.queryByRole("button", { name })).toBeNull();
  });
  it("reads a review newer than the last load by id", async () => {
    const reads = vi.mocked(crewApi.read);
    reads.mockImplementation(async (c, f = {}) =>
      f.archived
        ? []
        : c === "reviews" && f.id === decided.id
          ? [decided]
          : fixtures[c] || [],
    );
    history.replaceState(null, "", "/#/approvals/review000000002");
    render(<CrewWorkspace />);
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText(fullText(/^Approved .* by you\.$/))).toBeTruthy();
  });
  it("falls back to the Approvals page with a notice for an unknown review", async () => {
    history.replaceState(null, "", "/#/approvals/review000000009");
    render(<CrewWorkspace />);
    expect(await screen.findByText("Review not found.")).toBeTruthy();
    expect(location.hash).toBe("#/approvals");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Review draft: Launch post" }),
    ).toBeTruthy();
  });
  it("puts a clicked card in the address and closes back to #/approvals without reopening on Back", async () => {
    history.replaceState(null, "", "/#/approvals");
    const length = history.length;
    render(<CrewWorkspace />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Review draft: Launch post" }),
    );
    const dialog = within(await screen.findByRole("dialog"));
    expect(location.hash).toBe("#/approvals/review000000001");
    expect(history.length).toBe(length + 1);
    fireEvent.click(dialog.getByRole("button", { name: "Close dialog" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // Back to the list's own entry (0.32.0): nothing pushed, and the review's
    // entry is forward history, so Back never reopens it.
    await waitFor(() => expect(location.hash).toBe("#/approvals"));
    expect(history.length).toBe(length + 1);
  });
  it("shows the list after a decision made from a link", async () => {
    history.replaceState(null, "", "/#/approvals/review000000001");
    render(<CrewWorkspace />);
    const dialog = within(await screen.findByRole("dialog"));
    fireEvent.click(dialog.getByRole("button", { name: "Request changes" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(crewApi.write).toHaveBeenCalledWith(
      "review.decide",
      { decision: "changes_requested", note: "" },
      review,
      "",
    );
    expect(location.hash).toBe("#/approvals");
  });
  it("opens a review when the address changes to its link", async () => {
    history.replaceState(null, "", "/#/tasks");
    render(<CrewWorkspace />);
    await screen.findByRole("heading", { name: "Launch post" });
    location.hash = "#/approvals/review000000001";
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByRole("button", { name: "Approve draft" })).toBeTruthy();
  });
});
it("derives Human from a pending request while preserving the assigned agent", async () => {
  render(<CrewWorkspace />);
  await screen.findByRole("heading", { name: "Launch post" });
  expect(
    screen.getByText("Human", { selector: ".crew-human" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Filter by agent Network" }),
  ).toBeInTheDocument();
  expect(crewApi.write).not.toHaveBeenCalled();
});
it("approves the exact review snapshot and does not complete or execute the task", async () => {
  render(<CrewWorkspace />);
  await screen.findByRole("heading", { name: "Launch post" });
  await openPage(/^Approvals/);
  fireEvent.click(
    screen.getByRole("button", { name: "Review draft: Launch post" }),
  );
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText("The submitted draft")).toBeInTheDocument();
  fireEvent.change(within(dialog).getByLabelText("Decision note"), {
    target: { value: "Ready to publish manually" },
  });
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Approve draft" }),
  );
  await waitFor(() =>
    expect(crewApi.write).toHaveBeenCalledWith(
      "review.decide",
      { decision: "approved", note: "Ready to publish manually" },
      review,
      "",
    ),
  );
  expect(crewApi.write).toHaveBeenCalledTimes(1);
});
it("saves the edited draft and requests approval on its returned revision in one click", async () => {
  fixtures.tasks = [{ ...task, status: "in_progress" }];
  fixtures.reviews = [];
  render(<CrewWorkspace />);
  await screen.findByRole("heading", { name: "Launch post" });
  fireEvent.click(screen.getByRole("button", { name: /Launch post/ }));
  const dialog = screen.getByRole("dialog");
  expect(
    within(dialog).getByRole("button", { name: "Request approval" }),
  ).toBeEnabled();
  fireEvent.change(
    within(dialog).getByLabelText("Draft for review"),
    { target: { value: "Different draft" } },
  );
  const updated = { ...fixtures.tasks[0], draft: "Different draft", revision: 2 };
  vi.mocked(crewApi.write).mockResolvedValueOnce(updated).mockResolvedValueOnce(review);
  fireEvent.click(within(dialog).getByRole("button", { name: "Save and request approval" }));
  await waitFor(() => expect(crewApi.write).toHaveBeenCalledWith("review.request", {}, updated, ""));
  expect(crewApi.write).toHaveBeenNthCalledWith(1, "task.update", expect.objectContaining({ draft: "Different draft" }), fixtures.tasks[0], "");
});
it("keeps review alternatives while editing the brief and requests approval only after an explicit save", async () => {
  fixtures.tasks = [{ ...task, status: "in_progress" }];
  fixtures.reviews = [];
  vi.mocked(crewApi.write).mockImplementation(async (action, fields) => {
    if (action === "task.update") {
      const saved = { ...fixtures.tasks[0], ...fields, revision: task.revision + 1 };
      fixtures.tasks = [saved];
      return saved;
    }
    return review;
  });
  history.replaceState(null, "", "/#/tasks/task00000000001");
  render(<CrewWorkspace />);
  const dialog = within(await screen.findByRole("dialog"));
  fireEvent.click(dialog.getByText("Review alternatives (optional)"));
  fireEvent.click(dialog.getByRole("button", { name: "Add review option" }));
  fireEvent.change(dialog.getByLabelText("Option 1 label"), { target: { value: "Synthetic A" } });
  fireEvent.change(dialog.getByLabelText("Option 1 draft"), { target: { value: "An alternative" } });
  fireEvent.change(dialog.getByLabelText("Recipient (optional)"), { target: { value: "Sam" } });
  fireEvent.change(dialog.getByLabelText("Selection"), { target: { value: "one" } });
  fireEvent.change(dialog.getByLabelText("Description"), { target: { value: "Owner's revised request" } });
  const request = () => dialog.getByRole("button", { name: "Request approval" });
  expect(dialog.getByRole("button", { name: "Save and request approval" })).toBeEnabled();
  fireEvent.change(dialog.getByLabelText("Draft context"), { target: { value: "New working draft" } });
  expect(dialog.getByLabelText("Option 1 draft")).toHaveValue("An alternative");
  fireEvent.click(dialog.getByRole("button", { name: "Save task" }));
  await waitFor(() => expect(request()).toBeEnabled());
  expect(vi.mocked(crewApi.write).mock.calls.map(([action]) => action)).toEqual(["task.update"]);
  expect(fixtures.tasks[0]).toMatchObject({ description: "Owner's revised request", draft: "New working draft", draft_options: [{key: "option-1", label: "Synthetic A", body: "An alternative"}], draft_selection: "one", draft_recipient: "Sam" });
  expect(dialog.getByLabelText("Recipient (optional)")).toHaveValue("Sam");
  fireEvent.click(request());
  await waitFor(() => expect(crewApi.write).toHaveBeenCalledWith(
    "review.request",
    {},
    fixtures.tasks[0], "",
  ));
});
it("keeps the task's matching draft in sync when the owner renames or removes its option", async () => {
  const options = [
    { key: "option-2", label: "Main plan", body: "### Original main plan" },
    { key: "other", label: "Alternative", body: "### Another plan" },
  ];
  fixtures.tasks = [{ ...task, draft: options[0].body, draft_options: options }];
  vi.mocked(crewApi.write).mockImplementation(async (_action, fields) => {
    const saved = { ...fixtures.tasks[0], ...fields, revision: fixtures.tasks[0].revision + 1 };
    fixtures.tasks = [saved];
    fixtures.reviews = [];
    return saved;
  });
  history.replaceState(null, "", "/#/tasks/task00000000001");
  render(<CrewWorkspace />);
  const dialog = within(await screen.findByRole("dialog"));
  expect(dialog.getAllByRole("heading", { name: "Original main plan" })).toHaveLength(1);
  expect(dialog.getByRole("heading", { name: "Another plan" })).toBeVisible();
  const jump = dialog.getByRole("combobox", { name: "Jump to option" });
  expect(jump).toHaveDisplayValue("2 options");
  expect(within(jump).getByRole("option", { name: "Main plan" })).toBeInTheDocument();
  const destination = within(jump).getByRole<HTMLOptionElement>("option", { name: "Alternative" });
  const alternate = dialog.getByRole("group", { name: "Alternative" });
  const scroll = vi.fn();
  alternate.scrollIntoView = scroll;
  fireEvent.change(jump, { target: { value: destination.value } });
  expect(alternate).toHaveFocus();
  expect(scroll).toHaveBeenCalledWith({ block: "start" });
  expect(dialog.getByRole("button", { name: "Save task" })).toBeDisabled();
  const first = within(dialog.getByRole("group", { name: "Main plan" }));
  fireEvent.click(first.getByText("Option settings"));
  fireEvent.change(first.getByLabelText("Option 1 key"), { target: { value: "main" } });
  fireEvent.click(within(first.getByRole("tablist")).getByRole("tab", { name: "Edit" }));
  const text = first.getByLabelText("Option 1 draft");
  fireEvent.change(text, { target: { value: "" } });
  fireEvent.change(text, { target: { value: "### Revised main plan" } });
  expect(dialog.getByText("Saving these changes will withdraw the pending review.")).toBeVisible();
  fireEvent.click(dialog.getByRole("button", { name: "Save task" }));
  await waitFor(() => expect(dialog.getByRole("button", { name: "Request approval" })).toBeEnabled());
  expect(fixtures.tasks[0]).toMatchObject({
    draft: "### Revised main plan",
    draft_options: [{ ...options[0], key: "main", body: "### Revised main plan" }, options[1]],
  });
  fireEvent.click(first.getByRole("button", { name: "Remove option 1" }));
  fireEvent.click(dialog.getByRole("button", { name: "Save task" }));
  await waitFor(() => expect(fixtures.tasks[0]).toMatchObject({ draft: "", draft_options: [options[1]] }));
});
it("keeps edits made while saving draft options guarded by the discard prompt", async () => {
  const option = { key: "main", label: "Main plan", body: "### Main draft" };
  fixtures.tasks = [{ ...task, draft: option.body, draft_options: [option] }];
  fixtures.reviews = [];
  let finish!: () => void;
  const waiting = new Promise<void>(resolve => { finish = resolve; });
  vi.mocked(crewApi.write).mockImplementation(async (_action, fields) => {
    await waiting;
    const saved = { ...fixtures.tasks[0], ...fields, revision: task.revision + 1 };
    fixtures.tasks = [saved];
    return saved;
  });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  history.replaceState(null, "", "/#/tasks/task00000000001");
  render(<CrewWorkspace />);
  const dialog = within(await screen.findByRole("dialog"));
  const text = dialog.getByLabelText("Option 1 draft");
  fireEvent.change(text, { target: { value: "First edit" } });
  fireEvent.click(dialog.getByRole("button", { name: "Save task" }));
  fireEvent.change(text, { target: { value: "Second edit" } });
  await act(async () => { finish(); });
  expect(text).toHaveValue("Second edit");
  expect(dialog.getByRole("button", { name: "Save task" })).toBeEnabled();
  fireEvent.click(dialog.getByRole("button", { name: "Close dialog" }));
  expect(confirm).toHaveBeenCalledWith("Discard your unsaved changes?");
});
it("requires restoring the owning bucket before an inherited archived note", async () => {
  const note: Row = {
    id: "note00000000001",
    revision: 1,
    title: "Voice",
    bucket: bucket.id,
    body: "Clear prose",
    archived: false,
  };
  vi.mocked(crewApi.read).mockImplementation(async (c, f = {}) =>
    f.archived
      ? c === "notes"
        ? [note]
        : c === "buckets"
          ? [{ ...bucket, archived: true }]
          : []
      : fixtures[c] || [],
  );
  render(<CrewWorkspace />);
  await screen.findByRole("heading", { name: "Launch post" });
  await openPage("Archive");
  fireEvent.click(screen.getByRole("tab", { name: /^Notes/ }));
  // A note hidden by its archived bucket is grouped under the bucket, with
  // the bucket's Restore instead of a disabled one per note.
  expect(
    screen.getByText(/1 note hidden by archived bucket/),
  ).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Restore Voice" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Show notes" }));
  expect(screen.getByText("Voice")).toBeInTheDocument();
  vi.mocked(crewApi.write).mockResolvedValue({ id: bucket.id, revision: 2 });
  fireEvent.click(screen.getByRole("button", { name: "Restore bucket" }));
  await waitFor(() =>
    expect(crewApi.write).toHaveBeenCalledWith(
      "bucket.update",
      { archived: false },
      expect.objectContaining({ id: bucket.id }),
    ),
  );
});
it("renders draft Markdown without loading remote images or executing HTML", async () => {
  fixtures.reviews = [
    {
      ...review,
      draft:
        "![pixel](https://example.test/tracker)\n<script>alert(1)</script>\n[bad](javascript:alert(1))",
    },
  ];
  render(<CrewWorkspace />);
  await screen.findByRole("heading", { name: "Launch post" });
  await openPage(/^Approvals/);
  expect(document.querySelector(".crew-review-list img")).toBeNull();
  expect(document.querySelector(".crew-review-list script")).toBeNull();
  expect(
    document.querySelector('.crew-review-list a[href^="javascript:"]'),
  ).toBeNull();
});
it("shows an approval conflict without claiming success or closing the draft", async () => {
  vi.mocked(crewApi.write).mockRejectedValue(
    new Error("Revision conflict; reread and reassess"),
  );
  render(<CrewWorkspace />);
  await screen.findByRole("heading", { name: "Launch post" });
  await openPage(/^Approvals/);
  fireEvent.click(
    screen.getByRole("button", { name: "Review draft: Launch post" }),
  );
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Approve draft",
    }),
  );
  await waitFor(() =>
    expect(
      within(screen.getByRole("dialog")).getByRole("alert"),
    ).toHaveTextContent("Revision conflict"),
  );
  expect(screen.queryByText("Saved.")).toBeNull();
});

it("preserves an inactive assignment visibly without offering new inactive assignments", async () => {
  fixtures.agents = [];
  vi.mocked(crewApi.read).mockImplementation(async (c, f = {}) =>
    f.archived
      ? c === "agents"
        ? [
            { ...agent, archived: true },
            { ...agent, id: "otheragent00001", name: "Other", archived: true },
          ]
        : []
      : fixtures[c] || [],
  );
  render(<CrewWorkspace />);
  await screen.findByRole("heading", { name: "Launch post" });
  expect(document.querySelector(".crew-task-card footer")).toHaveTextContent("Network");
  expect(screen.queryByRole("button", { name: /^Filter by agent/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Launch post/ }));
  const select = within(screen.getByRole("dialog")).getByLabelText(
    /Assigned agent/,
  );
  expect(select).toHaveValue(agent.id);
  expect(
    within(select).getByRole("option", { name: "Network (inactive)" }),
  ).toBeDisabled();
  expect(
    within(select).queryByRole("option", { name: "Other (inactive)" }),
  ).toBeNull();
  fireEvent.change(within(screen.getByRole("dialog")).getByLabelText("Title"), {
    target: { value: "Updated launch post" },
  });
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Save task",
    }),
  );
  await waitFor(() =>
    expect(crewApi.write).toHaveBeenCalledWith(
      "task.update",
      expect.objectContaining({
        assigned_agent: agent.id,
        title: "Updated launch post",
      }),
      task,
      "",
    ),
  );
});

it("shows bucket responsibility and saves a changed or cleared assignment", async () => {
  const design: Row = { id: "agent0000000002", revision: 1, name: "Design" };
  fixtures.agents.push(design);
  render(<CrewWorkspace />);
  await screen.findByRole("heading", { name: "Launch post" });
  await openPage("Notes");
  expect(screen.getByText("Network · responsible agent")).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Edit bucket NETWORK" }),
  );
  let dialog = within(screen.getByRole("dialog"));
  expect(dialog.getByLabelText("Responsible agent")).toHaveValue(agent.id);
  fireEvent.change(dialog.getByLabelText("Responsible agent"), {
    target: { value: design.id },
  });
  fireEvent.click(dialog.getByRole("button", { name: "Save bucket" }));
  await waitFor(() =>
    expect(crewApi.write).toHaveBeenCalledWith(
      "bucket.update",
      {
        name: "NETWORK",
        purpose: "Voice and audiences",
        responsible_agent: design.id,
      },
      bucket,
      "",
    ),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(
    screen.getByRole("button", { name: "Edit bucket NETWORK" }),
  );
  dialog = within(screen.getByRole("dialog"));
  fireEvent.change(dialog.getByLabelText("Responsible agent"), {
    target: { value: "" },
  });
  fireEvent.click(dialog.getByRole("button", { name: "Save bucket" }));
  await waitFor(() =>
    expect(crewApi.write).toHaveBeenLastCalledWith(
      "bucket.update",
      {
        name: "NETWORK",
        purpose: "Voice and audiences",
        responsible_agent: "",
      },
      bucket,
      "",
    ),
  );
});

it("keeps bucket assignment conflicts visible for reassessment", async () => {
  vi.mocked(crewApi.write).mockRejectedValue(
    new Error("Revision conflict; reread and reassess"),
  );
  render(<CrewWorkspace />);
  await screen.findByRole("heading", { name: "Launch post" });
  await openPage("Notes");
  fireEvent.click(
    screen.getByRole("button", { name: "Edit bucket NETWORK" }),
  );
  const dialog = within(screen.getByRole("dialog"));
  fireEvent.change(dialog.getByLabelText("Responsible agent"), {
    target: { value: "" },
  });
  fireEvent.click(dialog.getByRole("button", { name: "Save bucket" }));
  await waitFor(() =>
    expect(dialog.getByRole("alert")).toHaveTextContent("Revision conflict"),
  );
  expect(screen.queryByText("Saved.")).toBeNull();
});

it("defaults new tasks to On hold and explicitly creates assigned ready work", async () => {
  render(<CrewWorkspace />);
  await screen.findByRole("heading", { name: "Launch post" });
  fireEvent.click(screen.getByRole("button", { name: /New task/ }));
  const dialog = within(screen.getByRole("dialog"));
  expect(dialog.getByLabelText("Hold")).toHaveValue("waiting");
  expect(
    within(dialog.getByLabelText("Hold")).getByRole("option", { name: "On hold" }),
  ).toBeInTheDocument();
  expect(dialog.getByLabelText("Hold reason")).toBeInTheDocument();
  expect(
    dialog.getByText(
      "On hold: nobody is woken; a person decides. Ready: the assigned bot may act.",
    ),
  ).toBeInTheDocument();
  fireEvent.change(dialog.getByLabelText("Title"), {
    target: { value: "Prepare research" },
  });
  fireEvent.change(dialog.getByLabelText("Assigned agent"), {
    target: { value: agent.id },
  });
  fireEvent.change(dialog.getByLabelText("Hold"), {
    target: { value: "ready" },
  });
  expect(dialog.queryByLabelText("Hold reason")).toBeNull();
  fireEvent.click(dialog.getByRole("button", { name: "Save task" }));
  await waitFor(() =>
    expect(crewApi.write).toHaveBeenCalledWith(
      "task.create",
      expect.objectContaining({
        title: "Prepare research",
        assigned_agent: agent.id,
        readiness: "ready",
        waiting_reason: "",
      }),
      undefined,
      "",
    ),
  );
});

it("keeps assignment separate from the hold and saves the hold reason", async () => {
  fixtures.tasks = [
    {
      ...task,
      status: "todo",
      assigned_agent: "",
      readiness: "waiting",
      waiting_reason: "Need source material",
    },
  ];
  fixtures.reviews = [];
  render(<CrewWorkspace />);
  await screen.findByRole("heading", { name: "Launch post" });
  fireEvent.click(screen.getByRole("button", { name: /Launch post/ }));
  const dialog = within(screen.getByRole("dialog"));
  fireEvent.change(dialog.getByLabelText("Assigned agent"), {
    target: { value: agent.id },
  });
  expect(dialog.getByLabelText("Hold")).toHaveValue("waiting");
  expect(dialog.getByLabelText("Hold reason")).toHaveValue(
    "Need source material",
  );
  fireEvent.click(dialog.getByRole("button", { name: "Save task" }));
  await waitFor(() =>
    expect(crewApi.write).toHaveBeenCalledWith(
      "task.update",
      expect.objectContaining({
        assigned_agent: agent.id,
        readiness: "waiting",
        waiting_reason: "Need source material",
      }),
      fixtures.tasks[0],
      "",
    ),
  );
});

it("separates unassigned work from invalid assignments and excludes completed work from queues", async () => {
  fixtures.tasks = [
    {
      ...task,
      id: "unassigned00001",
      title: "Needs an owner",
      status: "todo",
      assigned_agent: "",
    },
    {
      ...task,
      id: "missing00000001",
      title: "Missing agent task",
      status: "todo",
      assigned_agent: "missingagent001",
    },
    {
      ...task,
      id: "finished0000001",
      title: "Completed work",
      status: "done",
      assigned_agent: "",
    },
    { ...task, status: "todo" },
  ];
  fixtures.reviews = [];
  render(<CrewWorkspace />);
  await screen.findByRole("heading", { name: "Needs an owner" });
  const filter = screen.getByLabelText("Filter by assignment");
  expect(
    within(filter).getByRole("option", { name: "Unassigned (1)" }),
  ).toBeInTheDocument();
  expect(
    within(filter).getByRole("option", { name: "Invalid assignments (1)" }),
  ).toBeInTheDocument();
  fireEvent.change(filter, { target: { value: "unassigned" } });
  expect(
    screen.getByRole("heading", { name: "Needs an owner" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Missing agent task" }),
  ).toBeNull();
  expect(screen.queryByRole("heading", { name: "Completed work" })).toBeNull();
  fireEvent.change(filter, { target: { value: "invalid" } });
  expect(
    screen.getByRole("heading", { name: "Missing agent task" }),
  ).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Needs an owner" })).toBeNull();
  expect(
    screen.getByText(
      "Assigned agent is inactive or unavailable. Reassign this task.",
    ),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Missing agent task/ }));
  const select = within(screen.getByRole("dialog")).getByLabelText(
    "Assigned agent",
  );
  expect(select).toHaveValue("missingagent001");
  expect(
    within(select).getByRole("option", { name: "Unavailable agent" }),
  ).toBeDisabled();
});

it("shows redacted webhook health without exposing credential fields, URL paths or payloads", async () => {
  fixtures.webhook_configs = [
    {
      id: "webhook00000001",
      revision: 1,
      agent: agent.id,
      enabled: true,
      scope: "global",
      receiver_host: "receiver.example",
      url_configured: true,
      instructions: "Read current Crew task state before routing.",
      instruction_revision: 1,
      applied_revision: 1,
      sync_status: "reported",
      url: "https://receiver.example/private-path?key=private-query",
      secret_configured: true,
      secret: "private-credential",
      subscriptions: ["ready"],
    },
  ];
  fixtures.webhook_deliveries = [
    {
      id: "delivery0000001",
      revision: 1,
      config: "webhook00000001",
      task: task.id,
      state: "accepted",
      attempts: 2,
      payload: "private-payload",
      last_error: "private-error",
    },
  ];
  render(<CrewWorkspace />);
  await screen.findByRole("heading", { name: "Launch post" });
  await openPage("Connect an agent");
  fireEvent.click(
    await screen.findByRole("button", { name: /Enter webhook credentials/ }),
  );
  await screen.findByText(/Credential: configured/);
  const section = screen.getByRole("region", { name: "Grok Bot integration" });
  expect(section).toHaveTextContent("receiver.example");
  expect(section).toHaveTextContent("Accepted by receiver");
  expect(section).toHaveTextContent("2 attempts");
  expect(section).toHaveTextContent(
    "Receiver acceptance does not mean the task started or completed",
  );
  for (const secret of [
    "private-path",
    "private-query",
    "private-credential",
    "private-payload",
    "private-error",
  ]) {
    expect(section).not.toHaveTextContent(secret);
  }
  expect(crewApi.write).not.toHaveBeenCalled();
});

const wakeButton = { name: "Set up automatic wake-ups" };
async function renderConnect() {
  history.replaceState(null, "", "/#/connect");
  render(<CrewWorkspace />);
  await screen.findByRole("heading", {
    name: "Connect an agent",
    level: 1,
  });
}

it("keeps wake-up setup behind one button for a first-time owner", async () => {
  fixtures.webhook_configs = [
    { id: "webhook00000001", revision: 1, scope: "global", enabled: false },
  ];
  await renderConnect();
  fireEvent.click(await screen.findByRole("button", wakeButton));
  expect(
    await screen.findByRole("region", { name: "Grok Bot integration" }),
  ).toBeInTheDocument();
  expect(screen.queryByRole("button", wakeButton)).toBeNull();
});

it.each([
  ["delivery is on", { enabled: true }],
  ["credentials are saved", { url_configured: true }],
  ["a dispatcher is chosen", { agent: agent.id }],
])("opens wake-up setup when %s", async (_name, fields) => {
  fixtures.webhook_configs = [
    { id: "webhook00000001", revision: 1, scope: "global", ...fields },
  ];
  await renderConnect();
  expect(
    await screen.findByRole("region", { name: "Grok Bot integration" }),
  ).toBeInTheDocument();
  expect(screen.queryByRole("button", wakeButton)).toBeNull();
});

it("shows an existing owner the error when wake-up status cannot load", async () => {
  vi.mocked(crewApi.read).mockImplementation(async (c, f = {}) => {
    if (c === "webhook_configs") throw new Error("synthetic");
    return f.archived ? [] : fixtures[c] || [];
  });
  await renderConnect();
  expect(
    await screen.findByText(
      "Could not load the integration. Crew will try again shortly.",
    ),
  ).toBeInTheDocument();
  expect(screen.queryByRole("button", wakeButton)).toBeNull();
});

it("shows the MCP address and connected apps when the server has MCP", async () => {
  await renderConnect();
  expect(
    await screen.findByText("https://crew.example/mcp"),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Copy", description: "Copy address" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Copy", description: "Copy link" })).toBeNull();
  const apps = screen.getByRole("region", { name: "Connected apps" });
  expect(apps).toHaveTextContent(
    "They decide a review only when you ask them to in the conversation.",
  );
  expect(apps).not.toHaveTextContent("can't record");
});

it("gives skill instructions and no MCP details without a domain", async () => {
  vi.mocked(crewApi.connection).mockResolvedValue({ kind: "local" });
  await renderConnect();
  expect(
    await screen.findByText("./pocketcontext-crew skill"),
  ).toBeInTheDocument();
  expect(screen.getByText("./pocketcontext-crew tunnel invite")).toBeInTheDocument();
  expect(document.body).toHaveTextContent(
    "It decides a review only when you ask it to in the conversation.",
  );
  expect(document.body).not.toHaveTextContent("approval decisions yourself");
  expect(document.body).not.toHaveTextContent("/mcp");
  expect(screen.queryByRole("region", { name: "Connected apps" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Copy", description: "Copy link" })).toBeNull();
});

it("shows the skill step on Home without a domain", async () => {
  fixtures = { ...fixtures, tasks: [], reviews: [] };
  vi.mocked(crewApi.connection).mockResolvedValue({ kind: "local" });
  history.replaceState(null, "", "/#/home");
  render(<CrewWorkspace />);
  expect(
    await screen.findByText("./pocketcontext-crew skill"),
  ).toBeInTheDocument();
  expect(document.body).not.toHaveTextContent("/mcp");
  expect(
    screen.getByRole("button", { name: "I've connected it" }),
  ).toBeInTheDocument();
});

it("describes the MCP Copy button on Home's connect step", async () => {
  fixtures = { ...fixtures, tasks: [], reviews: [] };
  history.replaceState(null, "", "/#/home");
  render(<CrewWorkspace />);
  expect(
    await screen.findByRole("button", { name: "Copy", description: "Copy address" }),
  ).toBeVisible();
  expect(screen.queryByRole("button", { name: "Copy", description: "Copy link" })).toBeNull();
});

it("claims neither setup when the server cannot be checked", async () => {
  vi.mocked(crewApi.connection).mockRejectedValue(new Error("synthetic"));
  await renderConnect();
  expect(
    await screen.findByText(/Could not check how this Crew is set up/),
  ).toBeInTheDocument();
  expect(screen.queryByText("./pocketcontext-crew skill")).toBeNull();
  expect(document.body).not.toHaveTextContent("/mcp");
});

describe("crewApi.connection", () => {
  const answer = (status: number, body = "{}") =>
    vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(body, { status }));
  beforeEach(() => vi.mocked(crewApi.connection).mockRestore());

  it("uses the address the server publishes", async () => {
    answer(200, JSON.stringify({ resource: "https://crew.example/mcp" }));
    await expect(crewApi.connection()).resolves.toEqual({
      kind: "mcp",
      url: "https://crew.example/mcp",
    });
  });
  it("reads a 404 as an install without MCP", async () => {
    answer(404);
    await expect(crewApi.connection()).resolves.toEqual({ kind: "local" });
  });
  it.each([
    [503, "{}"],
    [200, "<html></html>"],
    [200, JSON.stringify({ resource: "http://127.0.0.1:8099/mcp" })],
  ])("does not guess from status %i with %s", async (status, body) => {
    answer(status, body);
    await expect(crewApi.connection()).rejects.toThrow();
  });
});

it("opens webhook task links and clears the route when the editor closes", async () => {
  history.replaceState(null, "", `/#/tasks/${task.id}`);
  render(<CrewWorkspace />);
  const dialog = within(await screen.findByRole("dialog"));
  expect(dialog.getByLabelText("Title")).toHaveValue("Launch post");
  fireEvent.click(dialog.getByRole("button", { name: "Close dialog" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(location.hash).toBe("#/tasks");
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("shows Refresh in flight, ignores a second tap and confirms the result", async () => {
  render(<CrewWorkspace />);
  const refresh = screen.getByRole("button", { name: "Refresh" });
  await waitFor(() => expect(refresh).toBeEnabled());
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  vi.mocked(crewApi.read).mockImplementation(async (c, f = {}) => {
    await gate;
    return f.archived ? [] : fixtures[c] || [];
  });
  const reads = vi.mocked(crewApi.read).mock.calls.length;
  fireEvent.click(refresh);
  await waitFor(() => expect(refresh).toBeDisabled());
  expect(refresh).toHaveAttribute("aria-busy", "true");
  expect(refresh).toHaveClass("is-refreshing");
  const started = vi.mocked(crewApi.read).mock.calls.length;
  fireEvent.click(refresh);
  expect(vi.mocked(crewApi.read).mock.calls.length).toBe(started);
  expect(started).toBeGreaterThan(reads);
  release();
  expect(await screen.findByText("Updated.")).toHaveAttribute("role", "status");
  expect(refresh).toBeEnabled();
  expect(refresh).not.toHaveAttribute("aria-busy");
  expect(refresh).not.toHaveClass("is-refreshing");

  vi.mocked(crewApi.read).mockRejectedValue(new Error("Synthetic offline"));
  fireEvent.click(refresh);
  expect(
    await screen.findByText(
      "Couldn't refresh. Check your connection and try again.",
    ),
  ).toHaveAttribute("role", "alert");
  expect(screen.queryByText("Updated.")).toBeNull();
  await waitFor(() => expect(refresh).toBeEnabled());
});

// Since 0.36.0 the server release and build are in Settings > About.
const aboutServer = () => screen.getByRole("region", { name: "About" });
it("displays the running server release and build in Settings and refreshes them", async () => {
  const commit = "0123456789abcdef0123456789abcdef01234567";
  vi.mocked(crewApi.serverVersion).mockResolvedValueOnce({
    version: "0.2.0",
    commit,
  });
  history.replaceState(null, "", "/#/settings");
  render(<CrewWorkspace />);
  const footer = aboutServer();
  await waitFor(() =>
    expect(footer).toHaveTextContent("Server0.2.0Build0123456789ab"),
  );
  expect(within(footer).getByText("0123456789ab")).toHaveAttribute(
    "title",
    commit,
  );
  expect(screen.queryByRole("contentinfo", { name: "Running server" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() =>
    expect(footer).toHaveTextContent("Server0.3.1Buildsynthetic-bu"),
  );
  expect(crewApi.serverVersion).toHaveBeenCalledTimes(2);
});

it("keeps the workspace usable when server metadata is missing and never substitutes the UI release", async () => {
  vi.mocked(crewApi.serverVersion).mockRejectedValue(
    new Error("Synthetic metadata unavailable"),
  );
  render(<CrewWorkspace />);
  await screen.findByRole("heading", { name: "Launch post" });
  fireEvent.click(screen.getByRole("button", { name: /Launch post/ }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  cleanup();
  history.replaceState(null, "", "/#/settings");
  render(<CrewWorkspace />);
  const footer = aboutServer();
  await waitFor(() => expect(footer).toHaveTextContent("ServerUnavailable"));
  expect(footer).not.toHaveTextContent("0.3.1");
  expect(footer).not.toHaveTextContent("Synthetic metadata unavailable");
});

it("renders development and older hosted version strings without inventing a release or commit", async () => {
  vi.mocked(crewApi.serverVersion).mockResolvedValue({
    version: "hosted-0123456789ab",
    commit: "",
  });
  history.replaceState(null, "", "/#/settings");
  render(<CrewWorkspace />);
  await waitFor(() =>
    expect(aboutServer()).toHaveTextContent("Serverhosted-0123456789ab"),
  );
  expect(aboutServer()).not.toHaveTextContent("Build");
});
it("marks a hop-limit stop and a pending owner comment wake on task cards", async () => {
  fixtures.reviews = [];
  fixtures.tasks = [
    {
      ...task,
      status: "todo",
      readiness: "waiting",
      waiting_reason: "Bot handoff limit reached",
      handoff_limited: true,
    },
    {
      ...task,
      id: "task00000000002",
      title: "Running task",
      status: "in_progress",
      readiness: "ready",
      wake_generation: 3,
      comment_wake_generation: 3,
    },
    {
      ...task,
      id: "task00000000003",
      title: "Superseded marker",
      status: "in_progress",
      readiness: "ready",
      wake_generation: 4,
      comment_wake_generation: 3,
    },
  ];
  render(<CrewWorkspace />);
  await screen.findByRole("heading", { name: "Running task" });
  expect(screen.getByText("Handoff limit")).toBeInTheDocument();
  expect(screen.getAllByText("Comment wake pending")).toHaveLength(1);
  expect(crewApi.write).not.toHaveBeenCalled();
});

const linkedNote: Row = {
  id: "note00000000001",
  revision: 2,
  title: "Voice guide",
  bucket: bucket.id,
  body: "Clear prose",
  links: [],
  path: "#/notes/voice-guide-note00000000001",
};
const linkedTask: Row = {
  ...task,
  status: "in_progress",
  path: "#/tasks/launch-post-task00000000001",
};
function serveArchived(rows: Record<string, Row[]>) {
  vi.mocked(crewApi.read).mockImplementation(async (c, f = {}) =>
    f.archived ? rows[c] || [] : fixtures[c] || [],
  );
}
function mockClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn(writeText) },
  });
  return navigator.clipboard.writeText;
}
afterEach(() => {
  Reflect.deleteProperty(navigator, "clipboard");
});
function navigate(hash: string) {
  history.replaceState(null, "", `/${hash}`);
  fireEvent(window, new HashChangeEvent("hashchange"));
}

it.each([
  ["task", "#/tasks/launch-post-task00000000001", "Launch post"],
  ["task", "#/tasks/task00000000001", "Launch post"],
  ["task", "#/tasks/any-old-slug-task00000000001", "Launch post"],
  ["note", "#/notes/voice-guide-note00000000001", "Voice guide"],
  ["note", "#/notes/note00000000001", "Voice guide"],
])("opens a %s from %s", async (kind, hash, title) => {
  fixtures.tasks = [linkedTask];
  fixtures.notes = [linkedNote];
  history.replaceState(null, "", `/${hash}`);
  render(<CrewWorkspace />);
  const dialog = within(await screen.findByRole("dialog"));
  if (kind === "note")
    expect(dialog.getByRole("heading", { name: title })).toBeInTheDocument();
  else expect(dialog.getByLabelText("Title")).toHaveValue(title);
});

it.each([
  "#/tasks/short",
  "#/tasks/launch-post-TASK00000000001",
  "#/tasks/task00000000001/extra",
  "#/tasks/task00000000001?otp=123456",
  "#/labels/task00000000001",
  "#/notes/note00000000001?comment=event0000000001",
  "#/buckets/bucket000000001?file=file00000000001",
])("ignores the malformed item link %s", async (hash) => {
  history.replaceState(null, "", `/${hash}`);
  render(<CrewWorkspace />);
  await screen.findByRole("region", { name: "Needs you" });
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("rewrites a stale slug to the current path after a title change", async () => {
  fixtures.tasks = [
    {
      ...linkedTask,
      title: "Renamed",
      path: "#/tasks/renamed-task00000000001",
    },
  ];
  history.replaceState(null, "", "/#/tasks/launch-post-task00000000001");
  render(<CrewWorkspace />);
  await screen.findByRole("dialog");
  expect(location.hash).toBe("#/tasks/renamed-task00000000001");
});

it("falls back to the bare form for a row without a usable path", async () => {
  fixtures.tasks = [
    { ...task, status: "todo", path: "#/notes/x-otherid00000001" },
  ];
  render(<CrewWorkspace />);
  fireEvent.click(await screen.findByRole("button", { name: /Launch post/ }));
  expect(location.hash).toBe(`#/tasks/${task.id}`);
});

it("opens a link that arrives before the data has loaded, only once", async () => {
  fixtures.tasks = [linkedTask];
  let release = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  const serve = vi.mocked(crewApi.read).getMockImplementation()!;
  vi.mocked(crewApi.read).mockImplementation(async (c, f) => {
    await gate;
    return serve(c, f);
  });
  render(<CrewWorkspace />);
  navigate("#/tasks/launch-post-task00000000001");
  expect(screen.queryByRole("dialog")).toBeNull();
  release();
  await screen.findByRole("dialog");
});

it("opens a hashchange navigation on already-loaded data", async () => {
  fixtures.tasks = [linkedTask];
  fixtures.notes = [linkedNote];
  render(<CrewWorkspace />);
  await screen.findByRole("heading", { name: "Launch post" });
  navigate("#/notes/voice-guide-note00000000001");
  const dialog = within(await screen.findByRole("dialog"));
  expect(
    dialog.getByRole("heading", { name: "Voice guide" }),
  ).toBeInTheDocument();
});

it("never opens or reopens a dialog on a data refresh", async () => {
  fixtures.tasks = [linkedTask];
  render(<CrewWorkspace />);
  await screen.findByRole("heading", { name: "Launch post" });
  await openPage("Notes");
  fireEvent.click(
    screen.getByRole("button", { name: "Edit bucket NETWORK" }),
  );
  expect(screen.getByRole("dialog", { name: "Edit bucket" })).toBeVisible();
  // An item hash left in place by a replaceState must not act on refresh.
  history.replaceState(null, "", "/#/tasks/launch-post-task00000000001");
  const reads = vi.mocked(crewApi.read).mock.calls.length;
  fixtures.tasks = [{ ...linkedTask }];
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() =>
    expect(vi.mocked(crewApi.read).mock.calls.length).toBeGreaterThan(reads),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled(),
  );
  expect(screen.getByRole("dialog", { name: "Edit bucket" })).toBeVisible();
});

it("keeps in-progress edits and the opened row across a refresh of a linked dialog", async () => {
  fixtures.tasks = [linkedTask];
  history.replaceState(null, "", "/#/tasks/launch-post-task00000000001");
  render(<CrewWorkspace />);
  const dialog = within(await screen.findByRole("dialog"));
  fireEvent.change(dialog.getByLabelText("Title"), {
    target: { value: "Unsaved title" },
  });
  fixtures.tasks = [{ ...linkedTask, revision: 9, title: "Server title" }];
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await screen.findAllByText("Server title");
  expect(dialog.getByLabelText("Title")).toHaveValue("Unsaved title");
  fireEvent.click(dialog.getByRole("button", { name: "Save task" }));
  await waitFor(() =>
    expect(crewApi.write).toHaveBeenCalledWith(
      "task.update",
      expect.objectContaining({ title: "Unsaved title" }),
      linkedTask,
      "",
    ),
  );
});

it.each([
  ["task", "#/tasks/launch-post-task00000000001", "Tasks", "#/tasks"],
  ["note", "#/notes/voice-guide-note00000000001", "Notes", "#/notes"],
])(
  "opens a %s link over its own list and returns to that list on close",
  async (_kind, hash, page, list) => {
    fixtures.tasks = [linkedTask];
    fixtures.notes = [linkedNote];
    history.replaceState(null, "", `/${hash}`);
    render(<CrewWorkspace />);
    const dialog = within(await screen.findByRole("dialog"));
    expect(location.hash).toBe(hash);
    expect(screen.getByRole("link", { name: page })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      screen.getByRole("heading", { level: 1, name: page }),
    ).toBeInTheDocument();
    fireEvent.click(dialog.getByRole("button", { name: "Close dialog" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(location.hash).toBe(list);
    expect(screen.getByRole("link", { name: page })).toHaveAttribute(
      "aria-current",
      "page",
    );
  },
);

it.each([
  ["#/team", "#/tasks", "Tasks"],
  ["#/team?agent=unassigned", "#/tasks?agent=unassigned", "Tasks"],
  ["#/memory", "#/notes", "Notes"],
  [
    "#/memory?sort=title&buckets=notes",
    "#/notes?sort=title&buckets=notes",
    "Notes",
  ],
])("redirects the old address %s to %s", async (old, current, page) => {
  fixtures.notes = [linkedNote];
  history.replaceState(null, "", `/${old}`);
  const length = history.length;
  render(<CrewWorkspace />);
  await waitFor(() =>
    expect(screen.getByRole("link", { name: page })).toHaveAttribute(
      "aria-current",
      "page",
    ),
  );
  await waitFor(() => expect(location.hash).toBe(current));
  expect(history.length).toBe(length);
});

it("redirects an old address reached by navigation without an extra history entry", async () => {
  render(<CrewWorkspace />);
  await screen.findByRole("heading", { name: "Launch post" });
  await openPage("Agents");
  const length = history.length;
  location.hash = `#/team?agent=${agent.id}`;
  await waitFor(() =>
    expect(screen.getByRole("link", { name: "Tasks" })).toHaveAttribute(
      "aria-current",
      "page",
    ),
  );
  // The navigation adds one entry; the redirect replaces it.
  expect(location.hash).toBe(`#/tasks?agent=${agent.id}`);
  expect(history.length).toBe(length + 1);
  expect(screen.getByRole("link", { name: "Tasks" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(screen.getByRole("combobox", { name: "Filter by assignment" })).toHaveValue(
    agent.id,
  );
  navigate("#/memory?sort=title");
  await waitFor(() => expect(location.hash).toBe("#/notes?sort=title"));
  expect(screen.getByRole("link", { name: "Notes" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

it("updates the address on click without a duplicate open, and not for new items", async () => {
  fixtures.tasks = [linkedTask];
  fixtures.notes = [linkedNote];
  const listener = vi.fn();
  window.addEventListener("hashchange", listener);
  render(<CrewWorkspace />);
  fireEvent.click(await screen.findByRole("button", { name: /Launch post/ }));
  expect(location.hash).toBe("#/tasks/launch-post-task00000000001");
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
  // Closing goes back to the list's own entry (0.32.0).
  await waitFor(() => expect(location.hash).toBe("#/tasks"));
  await openPage("Notes");
  listener.mockClear(); // The sidebar link is a real navigation.
  fireEvent.click(screen.getByRole("button", { name: /Voice guide/ }));
  expect(location.hash).toBe("#/notes/voice-guide-note00000000001");
  fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
  await waitFor(() => expect(location.hash).toBe("#/notes"));
  listener.mockClear();
  fireEvent.click(screen.getByRole("button", { name: /New note/ }));
  expect(location.hash).toBe("#/notes");
  expect(listener).not.toHaveBeenCalled();
  window.removeEventListener("hashchange", listener);
});

it("updates the address when a linked note opens from a note's related items", async () => {
  const source: Row = {
    ...linkedNote,
    id: "note00000000002",
    title: "Source",
    links: [linkedNote.id],
    path: "#/notes/source-note00000000002",
  };
  fixtures.notes = [source, linkedNote];
  history.replaceState(null, "", "/#/notes/source-note00000000002");
  render(<CrewWorkspace />);
  const dialog = within(await screen.findByRole("dialog"));
  fireEvent.click(dialog.getByRole("link", { name: "Voice guide" }));
  expect(location.hash).toBe("#/notes/voice-guide-note00000000001");
  expect(
    await dialog.findByRole("heading", { name: "Voice guide" }),
  ).toBeInTheDocument();
});

it("opens a task on its Comments tab from a ?tab=comments link", async () => {
  fixtures.tasks = [linkedTask];
  history.replaceState(null, "", "/#/tasks/launch-post-task00000000001?tab=comments");
  render(<CrewWorkspace />);
  const dialog = within(await screen.findByRole("dialog"));
  expect(dialog.getByRole("tab", { name: /^Comments/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(location.hash).toBe("#/tasks/launch-post-task00000000001?tab=comments");
  fireEvent.click(dialog.getByRole("tab", { name: "Activity" }));
  expect(location.hash).toBe("#/tasks/launch-post-task00000000001?tab=activity");
  fireEvent.click(dialog.getByRole("tab", { name: "Edit" }));
  expect(location.hash).toBe("#/tasks/launch-post-task00000000001");
});

it("shows an archived task read-only and explains how to restore it", async () => {
  fixtures.tasks = [];
  serveArchived({ tasks: [{ ...linkedTask, archived: true }] });
  history.replaceState(null, "", "/#/tasks/launch-post-task00000000001");
  render(<CrewWorkspace />);
  const element = await screen.findByRole("dialog", { name: "Archived task" });
  const dialog = within(element);
  expect(dialog.getByRole("status")).toHaveTextContent(
    "This task is archived and read-only. Restore it from the Archive view",
  );
  expect(dialog.getByLabelText("Title")).toBeDisabled();
  expect(dialog.getByLabelText("Description")).toBeDisabled();
  expect(dialog.getByLabelText("Assigned agent")).toBeDisabled();
  expect(dialog.queryByRole("button", { name: "Save task" })).toBeNull();
  expect(dialog.queryByRole("button", { name: "Archive task" })).toBeNull();
  expect(
    dialog.queryByRole("button", { name: "Request approval" }),
  ).toBeNull();
  expect(dialog.queryByText("Save a draft first.")).toBeNull();
  expect(dialog.queryByText("Save your draft first.")).toBeNull();
  fireEvent.click(dialog.getByRole("button", { name: "More actions" }));
  const menu = within(dialog.getByRole("menu", { name: "More actions" }));
  expect(menu.queryByRole("menuitem", { name: "Review the draft" })).toBeNull();
  fireEvent.click(dialog.getByRole("tab", { name: "Activity" }));
  expect(dialog.queryByRole("button", { name: "Add comment" })).toBeNull();
  expect(crewApi.write).not.toHaveBeenCalled();
});

it("shows an archived note read-only without restore-revision actions", async () => {
  fixtures.note_revisions = [
    { id: "revision0000001", revision: 1, title: "Old", body: "Old body" },
  ];
  serveArchived({ notes: [{ ...linkedNote, archived: true }] });
  history.replaceState(null, "", "/#/notes/voice-guide-note00000000001");
  render(<CrewWorkspace />);
  const element = await screen.findByRole("dialog", { name: "Archived note" });
  const dialog = within(element);
  expect(dialog.getByRole("status")).toHaveTextContent(
    "This note is archived and read-only.",
  );
  expect(dialog.queryByRole("tab", { name: "Edit" })).toBeNull();
  expect(dialog.queryByLabelText("Note")).toBeNull();
  expect(dialog.queryByRole("button", { name: "Save note" })).toBeNull();
  expect(dialog.queryByRole("button", { name: "Archive note" })).toBeNull();
  fireEvent.click(dialog.getByRole("button", { name: "History" }));
  await dialog.findByText(/Revision 1/);
  expect(
    dialog.queryByRole("button", { name: "Restore as new revision" }),
  ).toBeNull();
});

it("treats a note hidden only by its archived bucket as archived", async () => {
  serveArchived({
    notes: [{ ...linkedNote, archived: false }],
    buckets: [{ ...bucket, archived: true }],
  });
  fixtures.buckets = [];
  history.replaceState(null, "", "/#/notes/voice-guide-note00000000001");
  render(<CrewWorkspace />);
  const element = await screen.findByRole("dialog", { name: "Archived note" });
  const dialog = within(element);
  expect(dialog.getByRole("status")).toHaveTextContent(
    "Restore the bucket from the Archive view",
  );
  expect(dialog.getByRole("heading", { name: "Voice guide" })).toBeTruthy();
  expect(dialog.getByText("NETWORK")).toBeInTheDocument();
  expect(dialog.queryByRole("tab", { name: "Edit" })).toBeNull();
  expect(dialog.queryByRole("button", { name: "Archive note" })).toBeNull();
});

/** Copy link lives in the header's More menu (0.32.0). */
async function copyFromMenu(dialog: ReturnType<typeof within>) {
  const more = dialog.getByRole("button", { name: "More actions" });
  await waitFor(() => expect(more).toBeEnabled());
  fireEvent.click(more);
  fireEvent.click(dialog.getByRole("menuitem", { name: "Copy link" }));
}
it("copies the server's absolute url when present", async () => {
  const writeText = mockClipboard(async () => {});
  fixtures.tasks = [
    {
      ...linkedTask,
      url: "https://crew.example.test/#/tasks/launch-post-task00000000001",
    },
  ];
  history.replaceState(null, "", "/#/tasks/launch-post-task00000000001");
  render(<CrewWorkspace />);
  const dialog = within(await screen.findByRole("dialog"));
  await copyFromMenu(dialog);
  await screen.findByText("Link copied.");
  expect(writeText).toHaveBeenCalledExactlyOnceWith(
    "https://crew.example.test/#/tasks/launch-post-task00000000001",
  );
});

it("builds the link from the current origin and path without a url", async () => {
  const writeText = mockClipboard(async () => {});
  fixtures.notes = [linkedNote];
  history.replaceState(null, "", "/app/#/notes/voice-guide-note00000000001");
  render(<CrewWorkspace />);
  const dialog = within(await screen.findByRole("dialog"));
  await copyFromMenu(dialog);
  await screen.findByText("Link copied.");
  expect(writeText).toHaveBeenCalledExactlyOnceWith(
    `${location.origin}/app/#/notes/voice-guide-note00000000001`,
  );
});

it.each([
  ["rejects", () => mockClipboard(() => Promise.reject(new Error("denied")))],
  ["is unavailable", () => undefined],
])("shows the link when the clipboard %s", async (_name, setup) => {
  setup();
  fixtures.tasks = [linkedTask];
  history.replaceState(null, "", "/#/tasks/launch-post-task00000000001");
  render(<CrewWorkspace />);
  const dialog = within(await screen.findByRole("dialog"));
  await copyFromMenu(dialog);
  const alert = await dialog.findByRole("alert");
  expect(alert).toHaveTextContent("Could not copy automatically");
  expect(alert).toHaveTextContent("#/tasks/launch-post-task00000000001");
  expect(dialog.getByLabelText("Title")).toHaveValue("Launch post");
});

describe("dialog header", () => {
  it("is one floating row: back, forward, title, list previous/next with x of y, More, close", async () => {
    fixtures.notes = [linkedNote];
    history.replaceState(null, "", `/${linkedNote.path}`);
    render(<CrewWorkspace />);
    const dialog = await screen.findByRole("dialog");
    const header = dialog.querySelector("header.crew-dialog-head")!;
    const names = Array.from(header.querySelectorAll("button")).map((b) =>
      b.getAttribute("aria-label"),
    );
    expect(names).toEqual([
      "Back",
      "Forward",
      "Previous note (K)",
      "Next note (J)",
      "More actions",
      "Close dialog",
    ]);
    // The list capsule shows the note's place in the Notes page's list.
    expect(header.querySelector(".crew-list-position")).toHaveTextContent("1 of 1");
    // Icon-only, each named and with a tooltip.
    for (const button of header.querySelectorAll("button")) {
      expect(button.textContent).toBe("");
      expect(button.getAttribute("title")).toBe(button.getAttribute("aria-label"));
    }
    expect(within(header as HTMLElement).getByRole("heading")).toHaveAttribute(
      "title",
      "Note",
    );
  });

  it("keeps Copy link in the More menu, not the header, on a task", async () => {
    fixtures.tasks = [linkedTask];
    fixtures.reviews = [{ ...review, status: "approved" }];
    history.replaceState(null, "", "/#/tasks/launch-post-task00000000001");
    render(<CrewWorkspace />);
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.queryByRole("button", { name: "Copy", description: "Copy link" })).toBeNull();
    expect(dialog.queryByRole("button", { name: "Share as artifact" })).toBeNull();
    expect(dialog.getByRole("button", { name: "Back" })).toBeDisabled();
    const more = dialog.getByRole("button", { name: "More actions" });
    await waitFor(() => expect(more).toBeEnabled());
    fireEvent.click(more);
    expect(dialog.getAllByRole("menuitem").map((x) => x.textContent)).toEqual([
      "Copy link",
      "Archive task",
    ]);
  });

  it("opens a More menu with roles, arrow keys and Escape that keeps the dialog", async () => {
    fixtures.notes = [linkedNote];
    history.replaceState(null, "", `/${linkedNote.path}`);
    render(<CrewWorkspace />);
    const dialog = within(await screen.findByRole("dialog"));
    const more = dialog.getByRole("button", { name: "More actions" });
    expect(more).toHaveAttribute("aria-haspopup", "menu");
    fireEvent.click(more);
    const menu = dialog.getByRole("menu", { name: "More actions" });
    expect(more).toHaveAttribute("aria-expanded", "true");
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((x) => x.textContent)).toEqual([
      "Copy link",
      "Share as artifact",
      "History",
      "Archive note",
    ]);
    // Destructive actions are red, in their own last group.
    const groups = within(menu).getAllByRole("group");
    expect(groups).toHaveLength(2);
    expect(within(groups[1]).getByRole("menuitem")).toHaveClass("crew-menu-danger");
    expect(items[0]).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(items[3]).toHaveFocus();
    fireEvent.keyDown(menu, { key: "Home" });
    expect(items[0]).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(items[1]).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(dialog.queryByRole("menu")).toBeNull();
    expect(more).toHaveFocus();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("runs a menu item and closes the menu; outside taps close it too", async () => {
    fixtures.notes = [linkedNote];
    history.replaceState(null, "", `/${linkedNote.path}`);
    render(<CrewWorkspace />);
    const dialog = within(await screen.findByRole("dialog"));
    fireEvent.click(dialog.getByRole("button", { name: "More actions" }));
    fireEvent.pointerDown(dialog.getByText("Clear prose"));
    expect(dialog.queryByRole("menu")).toBeNull();
    fireEvent.click(dialog.getByRole("button", { name: "More actions" }));
    fireEvent.click(dialog.getByRole("menuitem", { name: "History" }));
    expect(dialog.queryByRole("menu")).toBeNull();
    expect(await dialog.findByRole("button", { name: /Back to note/ })).toBeInTheDocument();
  });

  it("disables More when a dialog has nothing in it", async () => {
    history.replaceState(null, "", "/#/tasks");
    render(<CrewWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "＋ New task" }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByRole("button", { name: "More actions" })).toBeDisabled();
    expect(dialog.queryByRole("button", { name: "Copy", description: "Copy link" })).toBeNull();
    // A new item has no list behind it: no previous/next capsule.
    expect(dialog.queryByRole("button", { name: /^Next/ })).toBeNull();
  });
});

describe("simple dialogs", () => {
  const openNote = async (note: Row = linkedNote) => {
    fixtures.notes = fixtures.notes.length ? fixtures.notes : [note];
    history.replaceState(null, "", `/${note.path}`);
    render(<CrewWorkspace />);
    return within(await screen.findByRole("dialog"));
  };

  it("focuses the dialog rather than its first header button", async () => {
    fixtures.tasks = [linkedTask];
    history.replaceState(null, "", "/#/tasks/launch-post-task00000000001");
    render(<CrewWorkspace />);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveFocus();
    expect(
      within(dialog).getByRole("button", { name: "More actions" }),
    ).not.toHaveFocus();
  });

  it("opens a note on Read with Edit as the second tab", async () => {
    const dialog = await openNote();
    expect(
      dialog.getByRole("heading", { name: "Voice guide" }),
    ).toBeInTheDocument();
    expect(dialog.getByText("Clear prose")).toBeInTheDocument();
    expect(dialog.getByText("NETWORK")).toBeInTheDocument();
    expect(dialog.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Read",
      "Edit",
    ]);
    expect(dialog.queryByLabelText("Title")).toBeNull();
    fireEvent.click(dialog.getByRole("tab", { name: "Edit" }));
    expect(dialog.getByLabelText("Title")).toHaveValue("Voice guide");
    expect(dialog.getByLabelText("Note")).toHaveValue("Clear prose");
    expect(dialog.queryByLabelText("Bucket")).toBeNull();
  });

  it("returns from edit to reading when nothing changed", async () => {
    const dialog = await openNote();
    fireEvent.click(dialog.getByRole("tab", { name: "Edit" }));
    fireEvent.click(dialog.getByRole("tab", { name: "Read" }));
    expect(dialog.getByRole("tab", { name: "Edit" })).toBeInTheDocument();
    fireEvent.click(dialog.getByRole("button", { name: "History" }));
    expect(
      dialog.getByText(/Restoring creates a new revision/),
    ).toBeInTheDocument();
    fireEvent.click(dialog.getByRole("button", { name: /Back to note/ }));
    expect(dialog.getByText("Clear prose")).toBeInTheDocument();
  });

  it("opens new notes for editing and always shows their create button", async () => {
    render(<CrewWorkspace />);
    await screen.findByRole("heading", { name: "Launch post" });
    await openPage("Notes");
    fireEvent.click(screen.getByRole("button", { name: /New note/ }));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByLabelText("Bucket")).toHaveValue(bucket.id);
    expect(dialog.getByLabelText("Note")).toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "Save note" })).toBeTruthy();
    expect(dialog.queryByLabelText("Reason for change")).toBeNull();
  });

  it("shows the reason and Save only once something is edited, and submits the reason", async () => {
    const dialog = await openNote();
    fireEvent.click(dialog.getByRole("tab", { name: "Edit" }));
    expect(dialog.queryByLabelText("Reason for change")).toBeNull();
    expect(dialog.getByRole("button", { name: "Save note" })).toBeDisabled();
    fireEvent.change(dialog.getByLabelText("Note"), {
      target: { value: "Sharper prose" },
    });
    fireEvent.change(dialog.getByLabelText("Reason for change"), {
      target: { value: "Tighter" },
    });
    fireEvent.click(dialog.getByRole("button", { name: "Save note" }));
    await waitFor(() =>
      expect(crewApi.write).toHaveBeenCalledWith(
        "note.update",
        { title: "Voice guide", body: "Sharper prose", links: [] },
        linkedNote,
        "Tighter",
      ),
    );
  });

  it("hides Save again when the edit is undone but still asks before discarding", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const dialog = await openNote();
    fireEvent.click(dialog.getByRole("tab", { name: "Edit" }));
    const field = dialog.getByLabelText("Title");
    fireEvent.change(field, { target: { value: "Changed" } });
    expect(dialog.getByRole("button", { name: "Save note" })).toBeTruthy();
    fireEvent.change(field, { target: { value: "Voice guide" } });
    expect(dialog.getByRole("button", { name: "Save note" })).toBeDisabled();
    fireEvent.click(dialog.getByRole("button", { name: "Close dialog" }));
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("links related notes by search, removes them and sends the same links", async () => {
    const other: Row = {
      ...linkedNote,
      id: "note00000000002",
      title: "Launch checklist",
      path: "#/notes/launch-checklist-note00000000002",
    };
    const third: Row = {
      ...linkedNote,
      id: "note00000000003",
      title: "Pricing",
      path: "#/notes/pricing-note00000000003",
    };
    const source = { ...linkedNote, links: [third.id] };
    fixtures.notes = [source, other, third];
    const dialog = await openNote(source);
    fireEvent.click(dialog.getByRole("tab", { name: "Edit" }));
    expect(dialog.queryByRole("checkbox")).toBeNull();
    expect(dialog.getByText("Pricing")).toBeInTheDocument();
    expect(dialog.queryByRole("button", { name: "Note Launch checklist" })).toBeNull();
    fireEvent.change(dialog.getByLabelText("Link a task or note"), {
      target: { value: "launch" },
    });
    // Searching alone is not an edit.
    expect(dialog.getByRole("button", { name: "Save note" })).toBeDisabled();
    fireEvent.click(dialog.getByRole("button", { name: "Note Launch checklist" }));
    fireEvent.click(dialog.getByRole("button", { name: "Remove Pricing" }));
    fireEvent.click(dialog.getByRole("button", { name: "Save note" }));
    await waitFor(() =>
      expect(crewApi.write).toHaveBeenCalledWith(
        "note.update",
        expect.objectContaining({ links: [other.id] }),
        source,
        "",
      ),
    );
  });

  it("links tasks as well as notes and shows links both ways", async () => {
    const task: Row = {
      id: "task00000000077",
      title: "Ship the launch",
      status: "todo",
      readiness: "ready",
      labels: [],
      links: [linkedNote.id],
      revision: 1,
      path: "#/tasks/ship-the-launch-task00000000077",
    };
    fixtures.tasks = [...(fixtures.tasks || []), task];
    fixtures.notes = [linkedNote];
    const dialog = await openNote();
    // The note doesn't list the task, but the task links here.
    const from = dialog.getByRole("group", { name: "Related" });
    expect(within(from).getByText("Linked from")).toBeInTheDocument();
    const link = within(from).getByRole("link", { name: "Ship the launch" });
    expect(link).toHaveAttribute("href", task.path);
    fireEvent.click(dialog.getByRole("tab", { name: "Edit" }));
    fireEvent.change(dialog.getByLabelText("Link a task or note"), {
      target: { value: "ship" },
    });
    fireEvent.click(dialog.getByRole("button", { name: "Task Ship the launch" }));
    fireEvent.click(dialog.getByRole("button", { name: "Save note" }));
    await waitFor(() =>
      expect(crewApi.write).toHaveBeenCalledWith(
        "note.update",
        expect.objectContaining({ links: [task.id] }),
        expect.anything(),
        "",
      ),
    );
  });

  it("links and unlinks from the note's Read view with the same Related as tasks", async () => {
    const task: Row = {
      id: "task00000000078",
      title: "Ship the docs",
      status: "todo",
      readiness: "ready",
      labels: [],
      links: [],
      revision: 1,
      path: "#/tasks/ship-the-docs-task00000000078",
    };
    fixtures.tasks = [task];
    fixtures.notes = [linkedNote];
    const dialog = await openNote();
    const related = dialog.getByRole("group", { name: "Related" });
    expect(within(related).getByText("No related items")).toBeInTheDocument();
    expect(within(related).getByRole("button", { name: "What are related tasks and notes?" })).toBeInTheDocument();
    fireEvent.change(within(related).getByLabelText("Link a task or note"), {
      target: { value: "docs" },
    });
    fireEvent.click(within(related).getByRole("button", { name: "Task Ship the docs" }));
    expect(within(related).queryByText("No related items")).toBeNull();
    const remove = within(related).getByRole("button", { name: "Remove Ship the docs" });
    expect(remove).toHaveClass("crew-related-remove");
    expect(dialog.queryByRole("button", { name: "Continue editing to save" })).toBeNull();
    fireEvent.click(dialog.getByRole("button", { name: "Save note" }));
    await waitFor(() =>
      expect(crewApi.write).toHaveBeenCalledWith(
        "note.update",
        expect.objectContaining({ links: [task.id] }),
        expect.anything(),
        "",
      ),
    );
  });

  it("asks before discarding a related-note change", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const other: Row = { ...linkedNote, id: "note00000000002", title: "Other" };
    fixtures.notes = [linkedNote, other];
    const dialog = await openNote();
    fireEvent.click(dialog.getByRole("tab", { name: "Edit" }));
    fireEvent.change(dialog.getByLabelText("Link a task or note"), {
      target: { value: "oth" },
    });
    fireEvent.click(dialog.getByRole("button", { name: "Note Other" }));
    fireEvent.click(dialog.getByRole("button", { name: "Close dialog" }));
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("keeps Archive and record details out of the main flow", async () => {
    const dialog = await openNote();
    const meta = dialog.getByText("Revision 2").closest("p")!;
    expect(
      within(meta).getByRole("button", { name: "Archive note" }),
    ).toBeTruthy();
    expect(within(meta).getByRole("button", { name: "History" })).toBeTruthy();
    expect(meta).not.toHaveTextContent("note0");
    fireEvent.click(dialog.getByRole("tab", { name: "Edit" }));
    fireEvent.change(dialog.getByLabelText("Title"), {
      target: { value: "Changed" },
    });
    expect(
      dialog
        .getByRole("button", { name: "Save note" })
        .closest(".crew-save-bar"),
    ).not.toHaveTextContent("Archive");
  });

  const openTask = async (fields: Partial<Row>) => {
    fixtures.tasks = [{ ...linkedTask, ...fields }];
    history.replaceState(null, "", "/#/tasks/launch-post-task00000000001");
    render(<CrewWorkspace />);
    return within(await screen.findByRole("dialog"));
  };

  it("sends a saved draft for approval through review.request", async () => {
    fixtures.reviews = [];
    const dialog = await openTask({});
    fireEvent.click(
      dialog.getByRole("button", { name: "Request approval" }),
    );
    await waitFor(() =>
      expect(crewApi.write).toHaveBeenCalledWith(
        "review.request",
        {},
        fixtures.tasks[0],
        "",
      ),
    );
  });

  it("explains in one line when a draft cannot be sent yet", async () => {
    fixtures.reviews = [];
    const dialog = await openTask({ draft: "" });
    const request = dialog.getByRole("button", { name: "Request approval" });
    expect(request).toBeDisabled();
    expect(request).toHaveAccessibleDescription("Write a draft or add a review option first.");
    // The standard "?" sits in the same row as the button.
    expect(
      request.parentElement?.querySelector(".crew-help-button"),
    ).toHaveAccessibleName("What does Request approval do?");
  });

  it("opens the pending review from the task's More menu", async () => {
    const dialog = await openTask({});
    expect(dialog.queryByRole("link", { name: /review.*draft/i })).toBeNull();
    expect(dialog.queryByText(/Waiting for your approval/)).toBeNull();
    expect(
      dialog.queryByRole("button", { name: "Request approval" }),
    ).toBeNull();
    fireEvent.click(dialog.getByRole("button", { name: "More actions" }));
    const menu = within(dialog.getByRole("menu", { name: "More actions" }));
    expect(menu.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Copy link",
      "Review the draft",
      "Archive task",
    ]);
    fireEvent.click(menu.getByRole("menuitem", { name: "Review the draft" }));
    await screen.findByRole("button", { name: "Approve draft" });
    expect(location.hash).toBe(`#/approvals/${review.id}`);
    expect(crewApi.write).not.toHaveBeenCalled();
  });
});

describe("automatic refresh", () => {
  const becomeVisible = () => fireEvent(document, new Event("visibilitychange"));
  const settled = async () => {
    await screen.findByRole("heading", { name: "Launch post" });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled(),
    );
  };

  it("reloads silently when the tab becomes visible", async () => {
    render(<CrewWorkspace />);
    await settled();
    fixtures.tasks = [{ ...task, title: "Fresh from server" }];
    becomeVisible();
    await screen.findByRole("heading", { name: "Fresh from server" });
    expect(screen.queryByText("Saved.")).toBeNull();
    expect(screen.queryByText("Loading your workspace…")).toBeNull();
  });

  it("reloads about every 30 seconds while visible", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<CrewWorkspace />);
      await settled();
      const reads = vi.mocked(crewApi.read).mock.calls.length;
      await vi.advanceTimersByTimeAsync(30_000);
      expect(vi.mocked(crewApi.read).mock.calls.length).toBeGreaterThan(reads);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays quiet about background failures and keeps the version", async () => {
    render(<CrewWorkspace />);
    await settled();
    await waitFor(() => expect(crewApi.serverVersion).toHaveBeenCalled());
    vi.mocked(crewApi.read).mockRejectedValue(new Error("Synthetic outage"));
    vi.mocked(crewApi.serverVersion).mockRejectedValue(new Error("Synthetic"));
    const reads = vi.mocked(crewApi.read).mock.calls.length;
    becomeVisible();
    await waitFor(() =>
      expect(vi.mocked(crewApi.read).mock.calls.length).toBeGreaterThan(reads),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole("alert")).toBeNull();
    // The version from the last good load stays (Settings > About).
    location.hash = "#/settings";
    await waitFor(() => expect(aboutServer()).toHaveTextContent("Server0.3.1"));
  });

  it("keeps a failed save's error and in-progress edits", async () => {
    vi.mocked(crewApi.write).mockRejectedValue(new Error("Revision conflict"));
    fixtures.tasks = [linkedTask];
    history.replaceState(null, "", "/#/tasks/launch-post-task00000000001");
    render(<CrewWorkspace />);
    const dialog = within(await screen.findByRole("dialog"));
    fireEvent.change(dialog.getByLabelText("Title"), {
      target: { value: "Unsaved title" },
    });
    fireEvent.click(dialog.getByRole("button", { name: "Save task" }));
    await dialog.findByRole("alert");
    const reads = vi.mocked(crewApi.read).mock.calls.length;
    becomeVisible();
    await waitFor(() =>
      expect(vi.mocked(crewApi.read).mock.calls.length).toBeGreaterThan(reads),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled(),
    );
    expect(dialog.getByRole("alert")).toHaveTextContent("Revision conflict");
    expect(dialog.getByLabelText("Title")).toHaveValue("Unsaved title");
  });

  it("skips while a save is busy", async () => {
    let finish = () => {};
    vi.mocked(crewApi.write).mockImplementation(
      () =>
        new Promise<Row>((resolve) => {
          finish = () => resolve(task);
        }),
    );
    fixtures.tasks = [linkedTask];
    history.replaceState(null, "", "/#/tasks/launch-post-task00000000001");
    render(<CrewWorkspace />);
    const dialog = within(await screen.findByRole("dialog"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled(),
    );
    fireEvent.change(dialog.getByLabelText("Title"), {
      target: { value: "Changed" },
    });
    fireEvent.click(dialog.getByRole("button", { name: "Save task" }));
    await waitFor(() => expect(crewApi.write).toHaveBeenCalled());
    const reads = vi.mocked(crewApi.read).mock.calls.length;
    becomeVisible();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(vi.mocked(crewApi.read).mock.calls.length).toBe(reads);
    finish();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
describe("help and Guide", () => {
  it("opens help on click and closes it with Escape or a click outside", async () => {
    render(<CrewWorkspace />);
    await screen.findByRole("heading", { name: "Launch post" });
    const button = screen.getByRole("button", {
      name: "What is the Tasks page?",
    });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "Learn more" })).toHaveAttribute(
      "href",
      "#/guide/board",
    );
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(button);
    fireEvent.pointerDown(document.body);
    await waitFor(() =>
      expect(button).toHaveAttribute("aria-expanded", "false"),
    );
  });
  it("keeps help inside a dialog from closing or dirtying it", async () => {
    const confirm = vi.spyOn(window, "confirm");
    fixtures.notes = [
      { id: "note00000000001", revision: 1, title: "Voice", body: "Plain", bucket: bucket.id, links: [] },
    ];
    render(<CrewWorkspace />);
    await screen.findByRole("heading", { name: "Launch post" });
    fireEvent.click(screen.getByRole("button", { name: /Launch post/ }));
    const dialog = within(await screen.findByRole("dialog"));
    const button = dialog.getByRole("button", { name: "What do On hold and Ready mean?" });
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(dialog.getByRole("link", { name: /Learn more/ })).toHaveAttribute(
      "target",
      "_blank",
    );
    expect(dialog.getByRole("button", { name: /^Save task/ })).toBeDisabled();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(dialog.getByRole("button", { name: "Close dialog" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(confirm).not.toHaveBeenCalled();
  });
  it("opens a Guide deep link at its section", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    history.replaceState(null, "", "/#/guide/bucket");
    render(<CrewWorkspace />);
    await screen.findByRole("heading", { name: "Guide", level: 1 });
    await waitFor(() => expect(scroll).toHaveBeenCalled());
    expect(scroll.mock.contexts[0]).toBe(
      document.getElementById("guide-bucket"),
    );
    expect(document.getElementById("guide-bucket")).toHaveClass("current");
    expect(
      screen.getByText("Approving never sends or publishes anything."),
    ).toBeInTheDocument();
  });
  it("falls back to the top of the Guide for an unknown topic", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    history.replaceState(null, "", "/#/guide/constructor");
    render(<CrewWorkspace />);
    await screen.findByRole("heading", { name: "Guide", level: 1 });
    await waitFor(() => expect(scroll).toHaveBeenCalled());
    expect(scroll.mock.contexts[0]).toBe(
      document.querySelector(".crew-app"),
    );
    expect(document.querySelector(".crew-guide-entry.current")).toBeNull();
  });
  it("does not point installs without a domain to an MCP address", async () => {
    vi.mocked(crewApi.connection).mockResolvedValue({ kind: "local" });
    history.replaceState(null, "", "/#/guide/mcp");
    render(<CrewWorkspace />);
    const entry = await waitFor(() => {
      const el = document.getElementById("guide-mcp");
      expect(el).toHaveTextContent("has no MCP address");
      return el as HTMLElement;
    });
    expect(entry).toHaveTextContent("Use the skill");
    const connect = document.getElementById("guide-connect") as HTMLElement;
    expect(connect).toHaveTextContent("installed skill");
    expect(connect).not.toHaveTextContent("address to your platform");
    expect(
      screen.getByText(/there is no address to add/),
    ).toBeInTheDocument();
  });
  it("shows the MCP help only where an address exists", async () => {
    vi.mocked(crewApi.connection).mockResolvedValue({ kind: "local" });
    history.replaceState(null, "", "/#/connect");
    render(<CrewWorkspace />);
    await screen.findByText("./pocketcontext-crew skill");
    expect(screen.queryByRole("button", { name: "What is MCP?" })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "What are automatic wake-ups?" }),
    );
    expect(document.querySelector(".crew-help-popover")).toHaveTextContent(
      "a woken cloud bot can't answer",
    );
  });
});

describe("Notes page", () => {
  const design: Row = {
    id: "bucket000000002",
    revision: 1,
    name: "DESIGN",
    responsible_agent: "",
    purpose: "Brand and visual direction",
  };
  const research: Row = {
    id: "bucket000000003",
    revision: 1,
    name: "ARCHIVE NOTES",
    responsible_agent: "",
    purpose: "",
  };
  const note = (
    id: string,
    title: string,
    bucketId: string,
    created: string,
    updated: string,
  ): Row => ({
    id,
    revision: 1,
    title,
    bucket: bucketId,
    body: `${title} body`,
    links: [],
    created,
    updated,
  });
  beforeEach(() => {
    fixtures.buckets = [bucket, design, research];
    fixtures.notes = [
      note(
        "note00000000001",
        "Beta voice",
        bucket.id,
        "2026-01-02 00:00:00.000Z",
        "2026-03-01 00:00:00.000Z",
      ),
      note(
        "note00000000002",
        "Alpha palette",
        design.id,
        "2026-01-03 00:00:00.000Z",
        "2026-01-04 00:00:00.000Z",
      ),
      note(
        "note00000000003",
        "Gamma audience",
        bucket.id,
        "2026-01-01 00:00:00.000Z",
        "2026-02-01 00:00:00.000Z",
      ),
    ];
  });
  const noteTitles = () =>
    [...document.querySelectorAll(".crew-note-card h3")].map(
      (x) => x.textContent,
    );
  const bucketNames = () =>
    [...document.querySelectorAll(".crew-bucket-card h2")].map(
      (x) => x.textContent,
    );
  const filterButton = (name: string) =>
    within(document.querySelector<HTMLElement>(".crew-buckets")!).getByRole(
      "button",
      { name: new RegExp(`^${name} `) },
    );
  async function openMemory(hash = "#/notes") {
    history.replaceState(null, "", `/${hash}`);
    render(<CrewWorkspace />);
    await screen.findByRole("heading", { name: "Beta voice" });
  }

  it("has no page search; the header search finds notes", async () => {
    await openMemory();
    expect(
      screen.queryByRole("searchbox", { name: "Search memory" }),
    ).toBeNull();
    expect(screen.queryByPlaceholderText(/Search note titles/)).toBeNull();
    expect(
      screen.getByRole("combobox", { name: "Search Crew" }),
    ).toBeInTheDocument();
  });

  it("shows name, responsible agent and note count, with the description only as a tooltip", async () => {
    await openMemory();
    const card = filterButton("NETWORK");
    expect(card).toHaveTextContent("Network · responsible agent");
    expect(card).toHaveTextContent("2 notes");
    expect(card).not.toHaveTextContent("Voice and audiences");
    expect(card).toHaveAttribute("title", "Voice and audiences");
    expect(filterButton("DESIGN")).toHaveTextContent("1 note");
    expect(filterButton("ARCHIVE NOTES")).toHaveTextContent("0 notes");
    expect(screen.queryByText("Voice and audiences")).toBeNull();
  });

  it("filters notes by clicking a bucket, keeps the dropdown in sync and clears on a second click", async () => {
    await openMemory();
    const dropdown = screen.getByRole("combobox", { name: "Filter by bucket" });
    const card = filterButton("NETWORK");
    expect(card).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(card);
    expect(card).toHaveAttribute("aria-pressed", "true");
    expect(card.closest(".crew-bucket-card")).toHaveClass("selected");
    expect(dropdown).toHaveValue(bucket.id);
    expect(noteTitles()).toEqual(["Beta voice", "Gamma audience"]);
    expect(location.hash).toBe(`#/notes?bucket=${bucket.id}`);
    // Every bucket card stays visible, so another can be chosen directly.
    expect(bucketNames()).toHaveLength(3);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(card);
    expect(card).toHaveAttribute("aria-pressed", "false");
    expect(dropdown).toHaveValue("");
    expect(noteTitles()).toHaveLength(3);
    expect(location.hash).toBe("#/notes");
    fireEvent.change(dropdown, { target: { value: design.id } });
    expect(filterButton("DESIGN")).toHaveAttribute("aria-pressed", "true");
    expect(noteTitles()).toEqual(["Alpha palette"]);
  });

  it("offers a way back from an empty bucket", async () => {
    await openMemory();
    fireEvent.click(filterButton("ARCHIVE NOTES"));
    expect(screen.getByText("No notes in this bucket")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show all buckets" }));
    expect(noteTitles()).toHaveLength(3);
  });

  it("opens a bucket with its own Edit button, not by clicking the card", async () => {
    await openMemory();
    const edit = screen.getByRole("button", { name: "Edit bucket NETWORK" });
    // Sibling buttons: nothing interactive is nested in another control.
    expect(edit.closest("button")).toBe(edit);
    expect(edit.parentElement?.closest("button")).toBeNull();
    expect(
      filterButton("NETWORK").querySelector("button, a, input, select"),
    ).toBeNull();
    edit.focus();
    expect(document.activeElement).toBe(edit);
    fireEvent.click(edit);
    const dialog = within(screen.getByRole("dialog", { name: "Edit bucket" }));
    expect(dialog.getByDisplayValue("Voice and audiences")).toBeInTheDocument();
  });

  it("sorts notes by last updated by default, then created, title and bucket", async () => {
    await openMemory();
    expect(noteTitles()).toEqual([
      "Beta voice",
      "Gamma audience",
      "Alpha palette",
    ]);
    const sort = screen.getByRole("combobox", { name: "Sort notes" });
    fireEvent.change(sort, { target: { value: "created" } });
    expect(noteTitles()).toEqual([
      "Alpha palette",
      "Beta voice",
      "Gamma audience",
    ]);
    expect(location.hash).toBe("#/notes?sort=created");
    fireEvent.change(sort, { target: { value: "title" } });
    expect(noteTitles()).toEqual([
      "Alpha palette",
      "Beta voice",
      "Gamma audience",
    ]);
    fireEvent.change(sort, { target: { value: "bucket" } });
    // DESIGN before NETWORK; within a bucket, most recently updated first.
    expect(noteTitles()).toEqual([
      "Alpha palette",
      "Beta voice",
      "Gamma audience",
    ]);
    fireEvent.change(sort, { target: { value: "updated" } });
    expect(location.hash).toBe("#/notes");
  });

  it("sorts buckets by name by default, then note count and last activity", async () => {
    await openMemory();
    expect(bucketNames()).toEqual(["ARCHIVE NOTES", "DESIGN", "NETWORK"]);
    const sort = screen.getByRole("combobox", { name: "Sort buckets" });
    fireEvent.change(sort, { target: { value: "notes" } });
    expect(bucketNames()).toEqual(["NETWORK", "DESIGN", "ARCHIVE NOTES"]);
    fireEvent.change(sort, { target: { value: "activity" } });
    expect(bucketNames()).toEqual(["NETWORK", "DESIGN", "ARCHIVE NOTES"]);
    fixtures.notes = [
      ...fixtures.notes,
      note(
        "note00000000004",
        "Delta type",
        design.id,
        "2026-04-01 00:00:00.000Z",
        "2026-04-01 00:00:00.000Z",
      ),
    ];
    const refresh = screen.getByRole("button", { name: "Refresh" });
    await waitFor(() => expect(refresh).toBeEnabled());
    fireEvent.click(refresh);
    await screen.findByRole("heading", { name: "Delta type" });
    expect(bucketNames()).toEqual(["DESIGN", "NETWORK", "ARCHIVE NOTES"]);
    expect(location.hash).toBe("#/notes?buckets=activity");
  });

  it("restores the filter and sorts from the address", async () => {
    await openMemory(`#/notes?buckets=notes&sort=title&bucket=${bucket.id}`);
    expect(
      screen.getByRole("combobox", { name: "Filter by bucket" }),
    ).toHaveValue(bucket.id);
    expect(screen.getByRole("combobox", { name: "Sort notes" })).toHaveValue(
      "title",
    );
    expect(screen.getByRole("combobox", { name: "Sort buckets" })).toHaveValue(
      "notes",
    );
    expect(noteTitles()).toEqual(["Beta voice", "Gamma audience"]);
    expect(filterButton("NETWORK")).toHaveAttribute("aria-pressed", "true");
    // The address is rewritten in canonical order without a navigation.
    expect(location.hash).toBe(
      `#/notes?bucket=${bucket.id}&sort=title&buckets=notes`,
    );
  });

  it.each([
    ["an unknown bucket", "#/notes?bucket=missing00000001"],
    ["a malformed bucket", "#/notes?bucket=x"],
    ["unknown sorts", "#/notes?sort=size&buckets=color"],
  ])("falls back to defaults for %s", async (_name, hash) => {
    await openMemory(hash);
    expect(
      screen.getByRole("combobox", { name: "Filter by bucket" }),
    ).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "Sort notes" })).toHaveValue(
      "updated",
    );
    expect(noteTitles()).toHaveLength(3);
    await waitFor(() => expect(location.hash).toBe("#/notes"));
  });

  it("returns to the filtered page when a note closes, and keeps note links", async () => {
    await openMemory(`#/notes?bucket=${bucket.id}&sort=title`);
    fireEvent.click(screen.getByRole("button", { name: /Gamma audience/ }));
    expect(location.hash).toBe("#/notes/note00000000003");
    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    await waitFor(() =>
      expect(location.hash).toBe(`#/notes?bucket=${bucket.id}&sort=title`),
    );
    expect(noteTitles()).toEqual(["Beta voice", "Gamma audience"]);
    navigate("#/notes/note00000000002");
    const dialog = within(await screen.findByRole("dialog"));
    expect(
      dialog.getByRole("heading", { name: "Alpha palette" }),
    ).toBeInTheDocument();
  });

  it("starts unfiltered from the sidebar link", async () => {
    await openMemory(`#/notes?bucket=${bucket.id}`);
    await openPage("Tasks");
    await openPage("Notes");
    expect(location.hash).toBe("#/notes");
    expect(noteTitles()).toHaveLength(3);
  });
});

describe("board agent filter", () => {
  const design: Row = { id: "agent0000000002", revision: 1, name: "Design" };
  const boardTask = (
    id: string,
    title: string,
    status: string,
    assigned: string,
  ): Row => ({ ...task, id, title, status, assigned_agent: assigned });
  beforeEach(() => {
    fixtures.agents = [agent, design];
    fixtures.reviews = [];
    fixtures.tasks = [
      boardTask("task00000000001", "Network draft", "todo", agent.id),
      boardTask("task00000000002", "Network shipped", "done", agent.id),
      boardTask("task00000000003", "Design palette", "in_progress", design.id),
      boardTask("task00000000004", "Nobody yet", "todo", ""),
      boardTask("task00000000005", "Gone agent", "todo", "missingagent001"),
    ];
  });
  const filter = () => screen.getByRole("combobox", { name: "Filter by assignment" });
  const cardTitles = () =>
    [...document.querySelectorAll(".crew-task-card h3")].map((x) => x.textContent);
  const columnCount = (label: string) =>
    document
      .querySelector(`.crew-column:has(h2 i.${label}) h2 span`)
      ?.textContent;
  async function openBoard(hash = "#/tasks") {
    history.replaceState(null, "", `/${hash}`);
    render(<CrewWorkspace />);
    // Loaded once the agent options carry their counts.
    await screen.findByRole("option", { name: "Design (1)" });
  }

  it("extends the assignment filter with one option per active agent, with counts", async () => {
    await openBoard();
    expect(
      screen.getAllByRole("combobox", { name: "Filter by assignment" }),
    ).toHaveLength(1);
    const options = within(filter())
      .getAllByRole("option")
      .map((x) => x.textContent);
    expect(options).toEqual([
      "All tasks",
      "Unassigned (1)",
      "Invalid assignments (1)",
      "Design (1)",
      "Network (2)",
    ]);
  });

  it("shows one agent's tasks with matching column counts, and clears with All", async () => {
    await openBoard();
    expect(columnCount("todo")).toBe("3");
    fireEvent.change(filter(), { target: { value: agent.id } });
    expect(cardTitles()).toEqual(["Network draft", "Network shipped"]);
    expect(columnCount("todo")).toBe("1");
    expect(columnCount("in_progress")).toBe("0");
    expect(columnCount("done")).toBe("1");
    expect(location.hash).toBe(`#/tasks?agent=${agent.id}`);
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(filter()).toHaveValue("all");
    expect(cardTitles()).toHaveLength(5);
    expect(location.hash).toBe("#/tasks");
    expect(screen.queryByRole("button", { name: "Clear all" })).toBeNull();
    fireEvent.change(filter(), { target: { value: design.id } });
    fireEvent.change(filter(), { target: { value: "all" } });
    expect(cardTitles()).toHaveLength(5);
  });

  it("combines the agent filter with the board search", async () => {
    await openBoard(`#/tasks?agent=${agent.id}`);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search tasks" }), {
      target: { value: "shipped" },
    });
    expect(cardTitles()).toEqual(["Network shipped"]);
    expect(location.hash).toBe(`#/tasks?agent=${agent.id}`);
  });

  it("reads agent: from the search and commits it to the agent filter on Enter", async () => {
    await openBoard();
    const search = screen.getByRole("searchbox", { name: "Search tasks" });
    fireEvent.change(search, { target: { value: "agent:network" } });
    expect(cardTitles()).toEqual(["Network draft", "Network shipped"]);
    fireEvent.change(search, { target: { value: "agent:unassigned" } });
    expect(cardTitles()).toEqual(["Nobody yet"]);
    fireEvent.change(search, { target: { value: "agent:nobody" } });
    expect(cardTitles()).toEqual([]);
    // An unknown agent stays in the search on Enter.
    fireEvent.keyDown(search, { key: "Enter" });
    expect(search).toHaveValue("agent:nobody");
    fireEvent.change(search, { target: { value: 'agent:"Design"' } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(search).toHaveValue("");
    expect(filter()).toHaveValue(design.id);
    expect(location.hash).toBe(`#/tasks?agent=${design.id}`);
    expect(cardTitles()).toEqual(["Design palette"]);
  });

  it("restores the filter from the address and keeps it when a task closes", async () => {
    await openBoard(`#/tasks?agent=${design.id}`);
    expect(filter()).toHaveValue(design.id);
    expect(cardTitles()).toEqual(["Design palette"]);
    fireEvent.click(screen.getByRole("button", { name: /Design palette/ }));
    expect(location.hash).toBe("#/tasks/task00000000003");
    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    await waitFor(() => expect(location.hash).toBe(`#/tasks?agent=${design.id}`));
    expect(cardTitles()).toEqual(["Design palette"]);
  });

  it.each([
    ["an unknown agent", "#/tasks?agent=nobody000000001"],
    ["a malformed value", "#/tasks?agent=everyone"],
  ])("falls back to all tasks for %s", async (_name, hash) => {
    await openBoard(hash);
    expect(filter()).toHaveValue("all");
    expect(cardTitles()).toHaveLength(5);
    await waitFor(() => expect(location.hash).toBe("#/tasks"));
  });

  it("keeps the unassigned and invalid queues in the address", async () => {
    await openBoard("#/tasks?agent=unassigned");
    expect(cardTitles()).toEqual(["Nobody yet"]);
    fireEvent.change(filter(), { target: { value: "invalid" } });
    expect(cardTitles()).toEqual(["Gone agent"]);
    expect(location.hash).toBe("#/tasks?agent=invalid");
  });

  it("Home's Tasks on hold tile opens the whole board on hold", async () => {
    await openBoard(`#/tasks?agent=${agent.id}`);
    await openPage("Home");
    const tile = screen.getByRole("link", {
      name: "4 tasks on hold, show on the Tasks board",
    });
    expect(tile).toHaveAttribute("href", "#/tasks?hold=on_hold");
    expect(tile).toHaveTextContent("4Tasks on hold");
    fireEvent.click(tile);
    await waitFor(() => expect(filter()).toHaveValue("all"));
    expect(cardTitles()).toHaveLength(4);
    expect(document.querySelectorAll(".crew-column")).toHaveLength(4);
  });

  it("lists every active agent A–Z on Home with its open work and a ⋯ menu", async () => {
    await openBoard();
    await openPage("Home");
    const agents = within(screen.getByRole("region", { name: "Agents" }));
    const rows = agents.getAllByRole("listitem");
    expect(rows.map((row) => row.querySelector("strong")?.textContent)).toEqual([
      "Design",
      "Network",
    ]);
    expect(rows.map((row) => row.querySelector("small")?.textContent)).toEqual([
      "1 in progress",
      "1 on hold",
    ]);
    expect(agents.queryByText("Agent")).toBeNull();
    expect(agents.getAllByRole("button", { name: /^Copy startup prompt for / })).toHaveLength(2);
    fireEvent.click(agents.getByRole("button", { name: "More for Network" }));
    const menu = within(screen.getByRole("dialog", { name: "Network" }));
    expect(menu.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Open agent",
      "Show tasks",
      "Copy startup prompt",
      "How to continue in a chat",
    ]);
    fireEvent.click(menu.getByRole("button", { name: "Show tasks" }));
    await waitFor(() => expect(filter()).toHaveValue(agent.id));
    expect(cardTitles()).toEqual(["Network draft", "Network shipped"]);
  });
});

describe("A column link focuses a board column", () => {
  const scroll = vi.fn();
  const column = (name: string) =>
    screen.getByRole("region", { name: new RegExp(`^${name}`) });
  beforeEach(() => {
    scroll.mockClear();
    Element.prototype.scrollIntoView = scroll;
    fixtures.reviews = [];
    fixtures.tasks = [
      { ...task, id: "task00000000001", title: "First", status: "todo" },
      { ...task, id: "task00000000002", title: "Second", status: "done" },
    ];
  });
  afterEach(() => {
    delete (Element.prototype as Partial<Element>).scrollIntoView;
    delete (window as Partial<Window>).matchMedia;
  });

  it("scrolls to, focuses and briefly highlights the column, then drops it from the address", async () => {
    history.replaceState(null, "", "/#/");
    render(<CrewWorkspace />);
    await screen.findByRole("region", { name: "Needs you" });
    location.hash = "#/tasks?status=done&column=done";
    await waitFor(() => expect(column("Done")).toHaveFocus());
    const done = column("Done");
    expect(done).toHaveAttribute("tabindex", "-1");
    expect(done).toHaveClass("crew-column-highlight");
    expect(column("To do")).not.toHaveClass("crew-column-highlight");
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.contexts[0]).toBe(done);
    expect(scroll).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "nearest",
      inline: "nearest",
    });
    expect(location.hash).toBe("#/tasks?status=done");
    expect(screen.getAllByRole("heading", { name: /First|Second/ })).toHaveLength(1);
    await waitFor(
      () => expect(done).not.toHaveClass("crew-column-highlight"),
      { timeout: 2000 },
    );
  });

  it("keeps the board filters beside the column", async () => {
    history.replaceState(null, "", `/#/tasks?agent=${agent.id}&column=done`);
    render(<CrewWorkspace />);
    await waitFor(() => expect(column("Done")).toHaveFocus());
    expect(location.hash).toBe(`#/tasks?agent=${agent.id}`);
    expect(
      screen.getByRole("combobox", { name: "Filter by assignment" }),
    ).toHaveValue(agent.id);
  });

  it("highlights once after a slow load, and never on a refresh", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    vi.mocked(crewApi.read).mockImplementation(async (c, f = {}) => {
      await gate;
      return f.archived ? [] : fixtures[c] || [];
    });
    history.replaceState(null, "", "/#/tasks?column=todo");
    const { rerender } = render(<CrewWorkspace />);
    await screen.findByText("Loading your workspace…");
    expect(location.hash).toBe("#/tasks");
    expect(scroll).not.toHaveBeenCalled();
    release();
    await waitFor(() => expect(column("To do")).toHaveFocus());
    rerender(<CrewWorkspace />);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await act(async () => {});
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it("scrolls instantly when motion is reduced", async () => {
    window.matchMedia = vi.fn(
      (query: string) =>
        ({ matches: query.includes("reduce"), media: query }) as MediaQueryList,
    );
    history.replaceState(null, "", "/#/tasks?column=in_progress");
    render(<CrewWorkspace />);
    await waitFor(() => expect(column("In progress")).toHaveFocus());
    expect(scroll).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: "auto" }),
    );
  });

  it("ignores an unknown column", async () => {
    history.replaceState(null, "", "/#/tasks?column=later");
    render(<CrewWorkspace />);
    await screen.findByRole("heading", { name: "First" });
    expect(location.hash).toBe("#/tasks");
    expect(scroll).not.toHaveBeenCalled();
    expect(document.querySelector(".crew-column-highlight")).toBeNull();
  });
});

const chipOf = (dialog: ReturnType<typeof within>, name: string) =>
  dialog
    .getByRole("button", { name: `Remove label ${name}` })
    .closest(".crew-chip") as HTMLElement;
describe("labels as chips", () => {
  beforeEach(() => {
    fixtures.reviews = [];
    fixtures.tasks = [
      { ...task, status: "todo", labels: ["Network", "Launch"] },
      {
        ...task,
        id: "task00000000002",
        title: "Other",
        status: "todo",
        labels: ["Research"],
      },
    ];
  });
  async function openLaunch() {
    render(<CrewWorkspace />);
    await screen.findByRole("heading", { name: "Launch post" });
    fireEvent.click(screen.getByRole("button", { name: /Launch post/ }));
    return within(screen.getByRole("dialog"));
  }
  it("shows the same chips on cards and saves exactly the chips", async () => {
    render(<CrewWorkspace />);
    await screen.findByRole("heading", { name: "Launch post" });
    const card = screen.getByRole("button", { name: /Launch post/ });
    expect(
      [...card.querySelectorAll(".crew-chip")].map((x) => x.textContent),
    ).toEqual(["Launch"]);
    fireEvent.click(card);
    const dialog = within(screen.getByRole("dialog"));
    const input = dialog.getByRole("combobox", { name: "Labels" });
    fireEvent.click(dialog.getByRole("button", { name: "Remove label Network" }));
    fireEvent.change(input, { target: { value: "  Copy  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input).toHaveValue("");
    fireEvent.click(dialog.getByRole("button", { name: "Save task" }));
    await waitFor(() =>
      expect(crewApi.write).toHaveBeenCalledWith(
        "task.update",
        expect.objectContaining({ labels: ["Launch", "Copy"] }),
        expect.objectContaining({ id: task.id }),
        "",
      ),
    );
  });
  it("adds with comma or Tab, pastes several, and never duplicates", async () => {
    const dialog = await openLaunch();
    const input = dialog.getByRole("combobox", { name: "Labels" });
    const chips = () =>
      [...document.querySelectorAll(".crew-chip-input .crew-chip")].map(
        (x) => x.firstChild?.textContent,
      );
    fireEvent.change(input, { target: { value: "One" } });
    fireEvent.keyDown(input, { key: "," });
    fireEvent.change(input, { target: { value: "Two" } });
    fireEvent.keyDown(input, { key: "Tab" });
    fireEvent.paste(input, {
      clipboardData: { getData: () => "Three, ,four,launch" },
    });
    expect(chips()).toEqual(["Network", "Launch", "One", "Two", "Three", "four"]);
    // "launch" matched the existing chip, which is highlighted instead.
    expect(
      chipOf(dialog, "Launch"),
    ).toHaveClass("flash");
    fireEvent.change(input, { target: { value: "NETWORK" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(chips()).toHaveLength(6);
  });
  it("removes with Backspace: the first selects the last chip, the second removes it", async () => {
    const dialog = await openLaunch();
    const input = dialog.getByRole("combobox", { name: "Labels" });
    fireEvent.keyDown(input, { key: "Backspace" });
    const last = chipOf(dialog, "Launch");
    expect(last).toHaveClass("selected");
    fireEvent.keyDown(input, { key: "Backspace" });
    expect(
      dialog.queryByRole("button", { name: "Remove label Launch" }),
    ).toBeNull();
    // A focused chip goes with Delete.
    const chip = chipOf(dialog, "Network");
    chip.focus();
    expect(chip).toHaveFocus();
    fireEvent.keyDown(chip, { key: "Delete" });
    expect(
      dialog.queryByRole("button", { name: "Remove label Network" }),
    ).toBeNull();
    expect(input).toHaveFocus();
  });
  it("suggests labels from other tasks, keeping their casing", async () => {
    const dialog = await openLaunch();
    const input = dialog.getByRole("combobox", { name: "Labels" });
    fireEvent.change(input, { target: { value: "res" } });
    const option = dialog.getByRole("option", { name: "Research" });
    fireEvent.click(option);
    expect(
      dialog.getByRole("button", { name: "Remove label Research" }),
    ).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "research" } });
    expect(dialog.queryByRole("listbox")).toBeNull();
    fireEvent.change(input, { target: { value: "netw" } });
    expect(dialog.queryByRole("listbox")).toBeNull();
  });
  it("uses an existing label's casing when typed in another case", async () => {
    fixtures.tasks[0] = { ...fixtures.tasks[0], labels: [] };
    const dialog = await openLaunch();
    const input = dialog.getByRole("combobox", { name: "Labels" });
    fireEvent.change(input, { target: { value: "RESEARCH" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(
      dialog.getByRole("button", { name: "Remove label Research" }),
    ).toBeInTheDocument();
  });
});

describe("On hold", () => {
  const boardTask = (id: string, title: string, extra: Partial<Row>): Row => ({
    ...task,
    id,
    title,
    status: "todo",
    readiness: "waiting",
    waiting_reason: "",
    ...extra,
  });
  beforeEach(() => {
    fixtures.reviews = [];
    fixtures.tasks = [
      boardTask("task00000000001", "Held draft", {
        waiting_reason: "Draft edited",
      }),
      boardTask("task00000000002", "Ready work", { readiness: "ready" }),
      boardTask("task00000000003", "Finished", {
        status: "done",
        readiness: "waiting",
      }),
      boardTask("task00000000004", "Other agent", {
        readiness: "ready",
        assigned_agent: "agent0000000002",
      }),
    ];
    fixtures.agents = [
      agent,
      { id: "agent0000000002", revision: 1, name: "Design" },
    ];
  });
  const card = (title: string) =>
    screen.getByRole("button", { name: new RegExp(title) });
  const cardTitles = () =>
    [...document.querySelectorAll(".crew-task-card h3")].map((x) => x.textContent);
  it("shows On hold with its reason, Ready, nothing for Done, and never Waiting", async () => {
    render(<CrewWorkspace />);
    await screen.findByRole("heading", { name: "Held draft" });
    const held = within(card("Held draft")).getByText("On hold");
    expect(held).toHaveAttribute("title", "Draft edited");
    expect(within(card("Ready work")).getByText("Ready")).toBeInTheDocument();
    expect(within(card("Finished")).queryByText(/On hold|Ready/)).toBeNull();
    expect(screen.queryByText(/^Waiting/)).toBeNull();
  });
  it("filters the board by hold, combined with the agent filter, in the address", async () => {
    render(<CrewWorkspace />);
    await screen.findByRole("heading", { name: "Held draft" });
    const hold = openFilters().getByRole("combobox", { name: "Filter by hold" });
    expect(
      within(hold).getAllByRole("option").map((x) => x.textContent),
    ).toEqual(["On hold and Ready", "On hold (1)", "Ready (2)"]);
    fireEvent.change(hold, { target: { value: "on_hold" } });
    expect(cardTitles()).toEqual(["Held draft"]);
    expect(location.hash).toBe("#/tasks?hold=on_hold");
    expect(screen.getByRole("button", { name: "Filters · 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove filter On hold" })).toBeInTheDocument();
    fireEvent.change(hold, { target: { value: "ready" } });
    expect(cardTitles()).toEqual(["Ready work", "Other agent"]);
    expect(screen.getByRole("button", { name: "Remove filter Ready" })).toBeInTheDocument();
    fireEvent.change(
      screen.getByRole("combobox", { name: "Filter by assignment" }),
      { target: { value: agent.id } },
    );
    expect(cardTitles()).toEqual(["Ready work"]);
    expect(location.hash).toBe(`#/tasks?agent=${agent.id}&hold=ready`);
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(cardTitles()).toHaveLength(4);
    expect(location.hash).toBe("#/tasks");
  });
  it("restores the hold filter from the address", async () => {
    history.replaceState(null, "", "/#/tasks?hold=on_hold");
    render(<CrewWorkspace />);
    await screen.findByRole("heading", { name: "Held draft" });
    expect(screen.getByRole("button", { name: "Remove filter On hold" })).toBeInTheDocument();
    expect(openFilters().getByRole("combobox", { name: "Filter by hold" })).toHaveValue(
      "on_hold",
    );
    expect(cardTitles()).toEqual(["Held draft"]);
  });
  it("opens the board filtered to tasks on hold over 3 days, and Home counts every hold", async () => {
    const old = new Date(Date.now() - 4 * 86_400_000).toISOString();
    const recent = new Date(Date.now() - 86_400_000).toISOString();
    fixtures.tasks = [
      boardTask("task00000000001", "Old hold", { updated: old }),
      boardTask("task00000000002", "New hold", { updated: recent }),
      boardTask("task00000000003", "Old ready", {
        updated: old,
        readiness: "ready",
      }),
      boardTask("task00000000004", "Old done", { updated: old, status: "done" }),
    ];
    history.replaceState(null, "", "/#/");
    render(<CrewWorkspace />);
    // Home counts every open task on hold, however long.
    expect(
      await screen.findByRole("link", {
        name: "2 tasks on hold, show on the Tasks board",
      }),
    ).toHaveAttribute("href", "#/tasks?hold=on_hold");
    location.hash = "#/tasks?hold=on_hold&held_over=3d";
    const chip = await screen.findByRole("button", {
      name: "Remove filter On hold · over 3 days",
    });
    expect(cardTitles()).toEqual(["Old hold"]);
    expect(document.querySelector(".crew-filter-count")?.textContent).toBe("1 task");
    expect(openFilters().getByRole("checkbox", { name: /On hold over 3 days/ })).toBeChecked();
    fireEvent.click(chip);
    expect(location.hash).toBe("#/tasks");
    expect(cardTitles()).toHaveLength(4);
  });
});

describe("Wake not received", () => {
  beforeEach(() => {
    fixtures.reviews = [];
    fixtures.tasks = [
      { ...task, status: "todo", readiness: "ready", title: "Stranded" },
      {
        ...task,
        id: "task00000000002",
        status: "todo",
        readiness: "ready",
        title: "Self filed",
        created_by_agent: "Network",
      },
      {
        ...task,
        id: "task00000000003",
        status: "todo",
        readiness: "ready",
        title: "On time",
      },
    ];
    fixtures.webhook_bridges = [
      { id: "bridge000000001", revision: 1, task_id: task.id, overdue: true },
      {
        id: "bridge000000002",
        revision: 1,
        task_id: "task00000000002",
        overdue: true,
      },
      {
        id: "bridge000000003",
        revision: 1,
        task_id: "task00000000003",
        overdue: false,
      },
      { id: "bridge000000004", revision: 1, task_id: "", overdue: true },
    ];
  });
  it("marks only open tasks whose overdue wake was dispatched to someone else, on the card and in the task", async () => {
    render(<CrewWorkspace />);
    await screen.findByRole("heading", { name: "On time" });
    await waitFor(() =>
      expect(screen.getAllByText("Wake not received")).toHaveLength(1),
    );
    const stranded = screen.getByRole("button", { name: /Stranded/ });
    expect(within(stranded).getByText("Wake not received")).toBeInTheDocument();
    fireEvent.click(stranded);
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByRole("note")).toHaveTextContent("Wake not received");
    expect(screen.queryByRole("button", { name: /Retry|Dismiss/ })).toBeNull();
  });
  it("keeps the board working when wake evidence cannot be read", async () => {
    vi.mocked(crewApi.read).mockImplementation(async (c, f = {}) => {
      if (c === "webhook_bridges") throw new Error("synthetic");
      return f.archived ? [] : fixtures[c] || [];
    });
    render(<CrewWorkspace />);
    await screen.findByRole("heading", { name: "Stranded" });
    expect(screen.queryByText("Wake not received")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
describe("project agents and coding sessions", () => {
  const project: Row = {
    id: "agent0000000007",
    revision: 2,
    name: "synthetic-repo",
    kind: "external",
    brief: "Work the synthetic repository's Ready tasks.",
  };
  const person: Row = {
    id: "agent0000000008",
    revision: 1,
    name: "Reviewer",
    kind: "human",
    brief: "Checks things by hand.",
  };
  const session = {
    agent: { id: project.id, name: "synthetic-repo", kind: "external" },
    prompt: "Use the PocketContext Crew skill.\nWork as synthetic-repo.",
    instructions: "## Session\n\nClaim **one** Ready task.",
    lease_hours: 2,
    body: "## Session\n\nClaim **one** Ready task.",
    revision: 0,
    is_default: true,
    edited_by: "",
    edited_at: "",
    rewrite_prompt:
      'Rewrite the Crew session instructions for agent "synthetic-repo" (revision 0).',
  };
  beforeEach(() => {
    fixtures.agents = [agent, project, person];
    fixtures.reviews = [];
  });
  async function openNewAgent() {
    history.replaceState(null, "", "/#/agents");
    render(<CrewWorkspace />);
    await screen.findByRole("heading", { name: "synthetic-repo" });
    fireEvent.click(screen.getByRole("button", { name: /New agent/ }));
    return within(screen.getByRole("dialog"));
  }
  it("creates a manual agent even when an integration is connected", async () => {
    fixtures.webhook_configs = [{ id: "config", revision: 1, scope: "global", enabled: true }];
    const dialog = await openNewAgent();
    expect(dialog.getByRole("radio", { name: "Agent" })).toBeChecked();
    fireEvent.change(dialog.getByLabelText("Name"), {
      target: { value: "another-repo" },
    });
    fireEvent.click(dialog.getByRole("button", { name: "Save agent" }));
    await waitFor(() =>
      expect(crewApi.write).toHaveBeenCalledWith(
        "agent.create",
        { name: "another-repo", brief: "", kind: "external" },
        undefined,
        "",
      ),
    );
  });
  it("creates a person separately from startup configuration", async () => {
    const dialog = await openNewAgent();
    fireEvent.click(dialog.getByRole("radio", { name: "Person" }));
    fireEvent.change(dialog.getByLabelText("Name"), {
      target: { value: "Editor" },
    });
    fireEvent.click(dialog.getByRole("button", { name: "Save person" }));
    await waitFor(() =>
      expect(crewApi.write).toHaveBeenCalledWith(
        "agent.create",
        expect.objectContaining({ name: "Editor", kind: "human" }),
        undefined,
        "",
      ),
    );
  });
  it("keeps startup settings out of an existing person's profile", async () => {
    history.replaceState(null, "", "/#/agents");
    render(<CrewWorkspace />);
    fireEvent.click((await screen.findByRole("heading", { name: "Reviewer" })).closest("button")!);
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByLabelText("Name")).toHaveValue("Reviewer");
    expect(dialog.queryByText("Copy startup prompt")).toBeNull();
    expect(dialog.queryByText("Automatic startup")).toBeNull();
  });
  it("shows the agent brief as Markdown in Read and edits it in Edit", async () => {
    fixtures.agents = [{ ...fixtures.agents[0], brief: "## Rules\n\n- Work on `main`" }];
    history.replaceState(null, "", "/#/agents");
    render(<CrewWorkspace />);
    fireEvent.click(
      (await screen.findByRole("heading", { name: "Network" })).closest("button")!,
    );
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByLabelText("Name")).toHaveValue("Network");
    expect(dialog.getByText("Markdown supported")).toBeInTheDocument();
    expect(dialog.getByRole("tab", { name: "Read" })).toHaveAttribute("aria-selected", "true");
    expect(dialog.getByRole("heading", { name: "Rules" })).toBeInTheDocument();
    fireEvent.click(dialog.getByRole("tab", { name: "Edit" }));
    expect(dialog.getByLabelText("Agent brief")).toBeVisible();
  });
  it("uses the saved session instructions and preserves kind on a profile edit", async () => {
    vi.spyOn(crewApi, "session").mockResolvedValue(session);
    const copied = mockClipboard(async () => undefined);
    history.replaceState(null, "", "/#/agents");
    render(<CrewWorkspace />);
    fireEvent.click((await screen.findByRole("heading", { name: "Network" })).closest("button")!);
    const dialog = within(screen.getByRole("dialog"));
    const copy = dialog.getByRole("button", { name: "Copy startup prompt" });
    fireEvent.click(within(copy).getByText("Copy startup prompt"));
    await waitFor(() => expect(copied).toHaveBeenCalledWith(session.prompt));
    expect(copy.querySelector(".crew-copy-glyph")).toHaveAttribute("data-state", "copied");
    expect(crewApi.write).not.toHaveBeenCalled();
    fireEvent.change(dialog.getByLabelText("Agent brief"), { target: { value: "New brief" } });
    fireEvent.click(dialog.getByRole("button", { name: "Save agent" }));
    await waitFor(() =>
      expect(crewApi.write).toHaveBeenLastCalledWith(
        "agent.update", { name: "Network", brief: "New brief" },
        expect.objectContaining({ id: agent.id }), "",
      ),
    );
  });
  it("opens a fresh bot's instruction editor and revision history without discarding profile edits", async () => {
    const copied = mockClipboard(async () => undefined);
    const botSession = { ...session, agent: { id: agent.id, name: "Network", kind: "bot" } };
    vi.spyOn(crewApi, "session").mockResolvedValue(botSession);
    const update = vi.spyOn(crewApi, "updateSession").mockResolvedValue({
      ...botSession, body: "Updated chat instructions", instructions: "Updated chat instructions", revision: 1,
    });
    history.replaceState(null, "", "/#/agents");
    render(<CrewWorkspace />);
    fireEvent.click((await screen.findByRole("heading", { name: "Network" })).closest("button")!);
    const profile = within(screen.getByRole("dialog", { name: "Edit agent" }));
    fireEvent.change(profile.getByLabelText("Name"), { target: { value: "Unsaved name" } });
    fireEvent.click(profile.getByRole("button", { name: "Read session instructions" }));
    let instructions = within(await screen.findByRole("dialog", { name: "Session instructions for Network" }));
    expect(instructions.getByRole("button", { name: "Read" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(instructions.getByRole("button", { name: "Edit" }));
    fireEvent.change(instructions.getByRole("textbox", { name: /Session instructions/ }), {
      target: { value: "Updated chat instructions" },
    });
    fireEvent.click(instructions.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith(agent.id, 0,
      { instructions: "Updated chat instructions" }, "Edited by hand"));
    fireEvent.click(instructions.getByRole("button", { name: "Close dialog" }));
    expect(profile.getByLabelText("Name")).toHaveValue("Unsaved name");
    expect(profile.queryByRole("button", { name: "Revision history" })).toBeNull();
    fireEvent.click(profile.getByRole("button", { name: "Read session instructions" }));
    instructions = within(await screen.findByRole("dialog", { name: "Session instructions for Network" }));
    fireEvent.click(instructions.getByRole("button", { name: "History" }));
    expect(instructions.getByRole("button", { name: "History" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(crewApi.read).toHaveBeenCalledWith("session_revisions", { parent: agent.id }));
    expect(copied).not.toHaveBeenCalled();
    fireEvent.click(instructions.getByRole("button", { name: "Close dialog" }));
    expect(profile.getByLabelText("Name")).toHaveValue("Unsaved name");
    expect(crewApi.write).not.toHaveBeenCalled();
  });
  it("keeps unsaved profile edits and saves against the revision returned by startup settings", async () => {
    fixtures.webhook_configs = [{ id: "config", revision: 3, scope: "global", enabled: true, receiver_host: "runtime.example" }];
    fixtures.webhook_mappings = [];
    const configured = { ...project, revision: project.revision + 1, kind: "bot" };
    vi.mocked(crewApi.write).mockImplementation(async (action) =>
      action === "webhook.startup.update" ? configured : { ...configured, revision: configured.revision + 1 });
    history.replaceState(null, "", "/#/agents");
    render(<CrewWorkspace />);
    fireEvent.click((await screen.findByRole("heading", { name: "synthetic-repo" })).closest("button")!);
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.change(dialog.getByLabelText("Name"), { target: { value: "Renamed" } });
    const startup = await dialog.findByRole("switch", { name: "Automatic startup" });
    await waitFor(() => expect(startup).toBeEnabled());
    fireEvent.click(startup);
    fireEvent.change(await dialog.findByRole("textbox", { name: /Recipient reference/ }), { target: { value: "synthetic" } });
    fireEvent.click(dialog.getByRole("button", { name: "Confirm destination" }));
    await waitFor(() => expect(crewApi.write).toHaveBeenCalledWith("webhook.startup.update",
      expect.objectContaining({ enabled: true }), expect.objectContaining({ revision: project.revision })));
    expect(dialog.getByLabelText("Name")).toHaveValue("Renamed");
    fireEvent.click(dialog.getByRole("button", { name: "Save agent" }));
    await waitFor(() => expect(crewApi.write).toHaveBeenCalledWith("agent.update",
      { name: "Renamed", brief: project.brief }, configured, ""));
  });
  it("shows matching copy controls for manual and webhook agents and excludes people", async () => {
    fixtures.agents = [{ ...agent, chat_start: "webhook" }, project, person];
    vi.spyOn(crewApi, "session").mockImplementation(async (id) => ({
      ...session,
      prompt: "Synthetic instructions for " + id,
    }));
    const clipboard = mockClipboard(async () => undefined);
    history.replaceState(null, "", "/#/agents");
    render(<CrewWorkspace />);
    const tile = async (name: string) =>
      within(
        (await screen.findByRole("heading", { name })).closest(
          ".crew-agent-tile",
        ) as HTMLElement,
      );
    const manual = await tile("synthetic-repo");
    expect(manual.getByText("Started manually · no webhook")).toBeInTheDocument();
    expect(
      manual.getByRole("button", { name: "Copy startup prompt for synthetic-repo" }),
    ).toBeInTheDocument();
    const human = await tile("Reviewer");
    expect(human.getByText("Person")).toBeInTheDocument();
    expect(human.queryByRole("button", { name: /Copy instructions/ })).toBeNull();
    const bot = await tile("Network");
    expect(bot.getByText("Started automatically · webhook")).toBeVisible();
    expect(bot.getByText("Copy startup prompt")).toBeVisible();
    expect(bot.getByRole("button", { name: "Copy startup prompt for Network" })).toHaveClass("crew-session-row");
    expect(manual.getByText("Copy startup prompt")).toBeVisible();
    expect(manual.getByRole("button", { name: "Copy startup prompt for synthetic-repo" })).toHaveClass("crew-session-row");
    fireEvent.click(bot.getByRole("button", { name: "Copy startup prompt for Network" }));
    await waitFor(() => expect(clipboard).toHaveBeenCalledWith("Synthetic instructions for " + agent.id));
    expect(crewApi.write).not.toHaveBeenCalled();
  });
  it("Start a session copies the prompt in one click and confirms it in a toast", async () => {
    fixtures.settings = [{ id: "settings0000001", revision: 1, session_guide_off: false }];
    const session$ = vi.spyOn(crewApi, "session").mockResolvedValue(session);
    const writeText = mockClipboard(async () => undefined);
    vi.mocked(crewApi.write).mockResolvedValue({
      id: "settings0000001",
      revision: 2,
      session_guide_off: true,
    });
    history.replaceState(null, "", "/#/agents");
    render(<CrewWorkspace />);
    // The session is read as the card renders, so the click copies at once.
    await waitFor(() => expect(session$).toHaveBeenCalledWith(project.id));
    await waitFor(() => expect(crewApi.read).toHaveBeenCalledWith("settings"));
    const card = screen
      .getByRole("heading", { name: "synthetic-repo" })
      .closest(".crew-agent-tile") as HTMLElement;
    const copy = screen.getByRole("button", {
      name: "Copy startup prompt for synthetic-repo",
    });
    copy.focus();
    fireEvent.click(copy);
    expect(writeText).toHaveBeenCalledWith(session.prompt);
    const toast = await screen.findByRole("status");
    expect(toast).toHaveTextContent(
      "Startup prompt copied. Paste it into your agent chat.",
    );
    expect(within(toast).queryByRole("button", { name: /Undo/ })).toBeNull();
    // The first start opens the guide dialog with the prompt in full (no
    // text area) and one copy icon; the card itself does not change.
    const guide = screen.getByRole("dialog", {
      name: "Use synthetic-repo in a chat",
    });
    expect(copy).toHaveAttribute("data-state", "copied");
    expect(copy.querySelector(".crew-copy-glyph")).toHaveAttribute("data-state", "copied");
    expect(guide.querySelector("textarea")).toBeNull();
    expect(within(guide).getByLabelText("Session prompt for synthetic-repo").textContent).toBe(
      session.prompt,
    );
    expect(guide).toHaveTextContent(/a chat connected to Crew/);
    expect(within(guide).getAllByRole("button", { name: /Copy/ })).toHaveLength(1);
    expect(document.activeElement).toBe(within(guide).getByRole("button", { name: "Got it" }));
    fireEvent.click(within(guide).getByRole("button", { name: "Copy", description: "Copy session prompt for synthetic-repo" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    // "Don't show this again" is saved on the server.
    fireEvent.click(within(guide).getByRole("checkbox", { name: "Don't show this again" }));
    await waitFor(() =>
      expect(crewApi.write).toHaveBeenCalledWith(
        "settings.update",
        { session_guide_off: true },
        expect.objectContaining({ id: "settings0000001", revision: 1 }),
      ),
    );
    fireEvent.click(within(guide).getByRole("button", { name: "Got it" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    // Focus returns to the button that opened it.
    expect(document.activeElement).toBe(copy);
    fireEvent.click(copy);
    await act(async () => undefined);
    expect(screen.queryByRole("dialog")).toBeNull();
    // The short label and the menu survive dismissal of first-use help.
    expect(within(card).getByText("Copy startup prompt")).toBeVisible();
    fireEvent.click(within(card).getByRole("button", { name: "More for synthetic-repo" }));
    const menu = within(screen.getByRole("dialog", { name: "synthetic-repo" }));
    expect(menu.getByRole("button", { name: "Copy startup prompt" })).toBeVisible();
    fireEvent.click(menu.getByRole("button", { name: "How to continue in a chat" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(within(toast).getByRole("button", { name: "Show startup prompt" }));
    const preview = within(screen.getByRole("dialog", { name: "Startup prompt for synthetic-repo" }));
    for (const paragraph of session.prompt.split(/\n+/)) expect(preview.getByText(paragraph)).toBeVisible();
    fireEvent.click(preview.getByRole("button", { name: "Copy again" }));
    expect(writeText).toHaveBeenLastCalledWith(session.prompt);
    fireEvent.click(preview.getByRole("button", { name: "Read session instructions" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Session instructions for synthetic-repo",
    });
    // One read when the card rendered and one per copy, none to open View.
    expect(session$.mock.calls.filter(([id]) => id === project.id)).toHaveLength(4);
    expect(screen.queryByRole("status")).toBeNull();
    expect(within(dialog).getByText("one").tagName).toBe("STRONG");
    expect(screen.getByText("one").closest(".crew-agent-tile")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Copy", description: "Copy prompt" }));
    await waitFor(() =>
      expect(within(dialog).getByText("Prompt copied"))
        .toBeInTheDocument(),
    );
    expect(writeText).toHaveBeenLastCalledWith(session.prompt);
    fireEvent.click(within(dialog).getByRole("button", { name: "Close dialog" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("Dismiss closes the Start a session toast and leaves the card as it was", async () => {
    const session$ = vi.spyOn(crewApi, "session").mockResolvedValue(session);
    mockClipboard(async () => undefined);
    history.replaceState(null, "", "/#/agents");
    render(<CrewWorkspace />);
    await waitFor(() => expect(session$).toHaveBeenCalled());
    fireEvent.click(
      within(screen.getByRole("button", { name: "Copy startup prompt for synthetic-repo" })).getByText("Copy startup prompt"),
    );
    const toast = await screen.findByRole("status");
    fireEvent.click(within(toast).getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    const button = screen.getByRole("button", {
      name: "Copy startup prompt for synthetic-repo",
    });
    expect(button).toHaveAttribute("data-state", "copied");
    await waitFor(() => expect(button).not.toHaveAttribute("data-state"), { timeout: 3000 });
    expect(within(button.closest(".crew-agent-tile") as HTMLElement).getByText("Copy startup prompt", { selector: ".crew-session-row strong" })).toBeVisible();

  });
  it("copies an agent's instructions from its ⋯ on Home and excludes archived agents", async () => {
    const session$ = vi.spyOn(crewApi, "session").mockResolvedValue(session);
    const writeText = mockClipboard(async () => undefined);
    serveArchived({
      agents: [{ ...project, id: "agentarchived01", name: "old-repo", archived: true }],
    });
    history.replaceState(null, "", "/#/");
    render(<CrewWorkspace />);
    const agents = within(await screen.findByRole("region", { name: "Agents" }));
    expect(agents.queryByText("old-repo")).toBeNull();
    expect(screen.queryByRole("region", { name: "Start a session" })).toBeNull();
    // The row menu also includes instructions and help.
    expect(agents.queryByRole("button", { name: /Copy prompt|How to start/ })).toBeNull();
    await waitFor(() => expect(session$).toHaveBeenCalledWith(project.id));
    fireEvent.click(agents.getByRole("button", { name: "More for synthetic-repo" }));
    const menu = within(screen.getByRole("dialog", { name: "synthetic-repo" }));
    expect(menu.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Open agent",
      "Show tasks",
      "Copy startup prompt",
      "How to continue in a chat",
    ]);
    fireEvent.click(menu.getByRole("button", { name: "Copy startup prompt" }));
    expect(writeText).toHaveBeenCalledWith(session.prompt);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Startup prompt copied. Paste it into your agent chat.",
    );
    expect(screen.queryByRole("dialog", { name: "synthetic-repo" })).toBeNull();
    // An unmapped bot uses the manual start wording.
    fireEvent.click(agents.getByRole("button", { name: "More for Network" }));
    expect(
      within(screen.getByRole("dialog", { name: "Network" }))
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Open agent", "Show tasks", "Copy startup prompt", "How to continue in a chat"]);
  });
  it("opens the session guide from a coding agent's ⋯ on Home", async () => {
    vi.spyOn(crewApi, "session").mockResolvedValue(session);
    history.replaceState(null, "", "/#/");
    render(<CrewWorkspace />);
    const agents = within(await screen.findByRole("region", { name: "Agents" }));
    fireEvent.click(agents.getByRole("button", { name: "More for synthetic-repo" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "synthetic-repo" })).getByRole("button", {
        name: "How to continue in a chat",
      }),
    );
    expect(
      await screen.findByRole("dialog", { name: "Use synthetic-repo in a chat" }),
    ).toBeInTheDocument();
  });
  it("edits session instructions by hand, restores history and copies a rewrite prompt", async () => {
    vi.spyOn(crewApi, "session").mockResolvedValue(session);
    const writeText = mockClipboard(async () => undefined);
    const edited = {
      ...session,
      body: "Synthetic **edited** text",
      instructions: "Synthetic **edited** text\n\n## Agent brief\n\nBrief.",
      revision: 1,
      is_default: false,
      edited_by: "owner",
      edited_at: "2026-11-12 10:00:00.000Z",
      rewrite_prompt:
        'Rewrite the Crew session instructions for agent "synthetic-repo" (revision 1).',
    };
    const update = vi
      .spyOn(crewApi, "updateSession")
      .mockResolvedValueOnce(edited)
      .mockResolvedValueOnce({ ...session, revision: 2, edited_by: "owner", edited_at: "2026-11-12 11:00:00.000Z" });
    vi.mocked(crewApi.read).mockImplementation(async (c, f = {}) =>
      c === "session_revisions"
        ? [
            { id: "srev00000000001", revision: 1, instructions: edited.body, is_default: false, edited_by: "owner", created: edited.edited_at },
          ]
        : f.archived ? [] : fixtures[c] || [],
    );
    history.replaceState(null, "", "/#/agents");
    render(<CrewWorkspace />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Copy startup prompt for synthetic-repo" }),
    );
    fireEvent.click(
      within(await screen.findByRole("status")).getByRole("button", { name: "Show startup prompt" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Read session instructions" }));
    const dialog = within(
      await screen.findByRole("dialog", { name: "Session instructions for synthetic-repo" }),
    );
    dialog.getByText("Built-in default · not edited yet");
    expect(dialog.queryByRole("button", { name: "Restore default" })).toBeNull();
    // The recommended path copies a prompt for an agent conversation.
    expect(vi.mocked(crewApi.session).mock.calls.filter(([id]) => id === project.id)).toHaveLength(2);
    fireEvent.click(dialog.getByRole("button", { name: "Rewrite with an agent" }));
    await dialog.findByRole("button", { name: "Rewrite prompt copied" });
    expect(writeText).toHaveBeenLastCalledWith(session.rewrite_prompt);
    // Edit by hand: Save sends the revision shown.
    fireEvent.click(dialog.getByRole("button", { name: "Edit" }));
    const field = dialog.getByLabelText(/Session instructions/);
    expect(field).toHaveValue(session.body);
    fireEvent.change(field, { target: { value: edited.body } });
    fireEvent.click(dialog.getByRole("button", { name: "Save" }));
    await dialog.findByText(fullText(/^Revision 1 · edited by owner, \S/));
    expect(update).toHaveBeenLastCalledWith(
      project.id,
      0,
      { instructions: edited.body },
      "Edited by hand",
    );
    expect(dialog.getByText("edited").tagName).toBe("STRONG");
    // History lists revisions; the current one has no Restore.
    fireEvent.click(dialog.getByRole("button", { name: "History" }));
    await dialog.findByText(fullText(/^Revision 1 · owner · \S.* · current$/));
    expect(dialog.queryByRole("button", { name: "Restore revision 1" })).toBeNull();
    // Restore default writes a new revision against the current one.
    fireEvent.click(dialog.getByRole("button", { name: "Restore default" }));
    await dialog.findByText(fullText(/^Revision 2 · edited by owner, \S.* · built-in default$/));
    expect(update).toHaveBeenLastCalledWith(
      project.id,
      1,
      { restore_default: true },
      "Restore default",
    );
    // Copy prompt copies the session prompt of the latest revision.
    fireEvent.click(dialog.getByRole("button", { name: "Copy", description: "Copy prompt" }));
    await dialog.findByText("Prompt copied");
    expect(writeText).toHaveBeenLastCalledWith(session.prompt);
  });
  it("explains a stale session instructions revision", async () => {
    vi.spyOn(crewApi, "session").mockResolvedValue(session);
    mockClipboard(async () => undefined);
    vi.spyOn(crewApi, "updateSession").mockRejectedValue(
      Object.assign(new Error("conflict"), { status: 409 }),
    );
    history.replaceState(null, "", "/#/agents");
    render(<CrewWorkspace />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Copy startup prompt for synthetic-repo" }),
    );
    fireEvent.click(
      within(await screen.findByRole("status")).getByRole("button", { name: "Show startup prompt" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Read session instructions" }));
    const dialog = within(
      await screen.findByRole("dialog", { name: "Session instructions for synthetic-repo" }),
    );
    fireEvent.click(dialog.getByRole("button", { name: "Edit" }));
    fireEvent.change(dialog.getByLabelText(/Session instructions/), {
      target: { value: "Synthetic stale edit" },
    });
    fireEvent.click(dialog.getByRole("button", { name: "Save" }));
    await dialog.findByText(/Someone saved a newer revision meanwhile/);
    dialog.getByRole("button", { name: "Reload latest" });
    expect(dialog.getByLabelText(/Session instructions/)).toHaveValue("Synthetic stale edit");
  });
  it("shows the prompt to copy by hand when the clipboard is unavailable", async () => {
    vi.spyOn(crewApi, "session").mockResolvedValue(session);
    mockClipboard(async () => {
      throw new Error("denied");
    });
    history.replaceState(null, "", "/#/agents");
    render(<CrewWorkspace />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Copy startup prompt for synthetic-repo",
      }),
    );
    expect(
      await screen.findByLabelText("Session prompt for synthetic-repo"),
    ).toHaveValue(session.prompt);
  });
  it("explains politely when the session prompt cannot be read", async () => {
    vi.spyOn(crewApi, "session").mockRejectedValue(new Error("synthetic 500"));
    history.replaceState(null, "", "/#/agents");
    render(<CrewWorkspace />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Copy startup prompt for synthetic-repo",
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not prepare the session prompt for synthetic-repo. Check your connection and try again.",
    );
    expect(screen.queryByText(/synthetic 500/)).toBeNull();
  });
  it("lists manual agents and people in the board filter with a muted kind", async () => {
    render(<CrewWorkspace />);
    const filter = await screen.findByRole("combobox", {
      name: "Filter by assignment",
    });
    await waitFor(() =>
      expect(
        within(filter)
          .getAllByRole("option")
          .map((x) => x.textContent),
      ).toEqual([
        "All tasks",
        "Unassigned (0)",
        "Invalid assignments (0)",
        "Network (1)",
        "Reviewer · person (0)",
        "synthetic-repo · manual (0)",
      ]),
    );
  });
  describe("claims", () => {
    const future = new Date(Date.now() + 90 * 60_000).toISOString();
    const liveTask: Row = {
      ...task,
      status: "in_progress",
      readiness: "ready",
      assigned_agent: project.id,
      title: "Claimed work",
      claimed_by: "codex-session-1",
      claim_until: future,
      claim_state: "live",
    };
    const expiredTask: Row = {
      ...task,
      id: "task00000000002",
      status: "in_progress",
      readiness: "ready",
      assigned_agent: project.id,
      title: "Stale work",
      claimed_by: "claude-session-2",
      claim_until: "2026-11-12T01:00:00Z",
      claim_state: "expired",
    };
    beforeEach(() => {
      fixtures.tasks = [liveTask, expiredTask];
    });
    it("marks a live claim with its end time on hover and an expired one with the previous claimer", async () => {
      render(<CrewWorkspace />);
      const live = await screen.findByRole("button", { name: /Claimed work/ });
      const chip = within(live).getByText(/^Session · /);
      expect(chip).toHaveClass("crew-claim-chip");
      expect(chip.getAttribute("title")).toContain("Claimed by codex-session-1");
      const stale = screen.getByRole("button", { name: /Stale work/ });
      const badge = within(stale).getByText(/^Claim expired/);
      expect(badge).toHaveClass("crew-claim-expired");
      expect(badge.getAttribute("title")).toContain("Claimed by claude-session-2");
      expect(within(live).queryByText(/Claim expired/)).toBeNull();
    });
    it("asks before releasing a live claim and releases it with an empty payload", async () => {
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
      render(<CrewWorkspace />);
      fireEvent.click(await screen.findByRole("button", { name: /Claimed work/ }));
      const dialog = within(screen.getByRole("dialog"));
      // One compact banner names the agent, not the session; actions are in ⋯.
      const banner = within(dialog.getByRole("region", { name: "Claim" }));
      expect(banner.getByText(`Claimed · ${String(project.name)}`)).toBeInTheDocument();
      expect(banner.getByText(/^ends in 1 h \d+ m$/)).toBeInTheDocument();
      expect(dialog.queryByRole("button", { name: /^Claim( task)?$/ })).toBeNull();
      expect(dialog.queryByRole("button", { name: "Release claim" })).toBeNull();
      const release = () => {
        fireEvent.click(banner.getByRole("button", { name: "Claim actions" }));
        fireEvent.click(banner.getByRole("menuitem", { name: "Release claim" }));
      };
      release();
      expect(confirm).toHaveBeenCalledWith(
        "A session is working on this. Release its claim?",
      );
      expect(crewApi.write).not.toHaveBeenCalled();
      confirm.mockReturnValue(true);
      release();
      await waitFor(() =>
        expect(crewApi.write).toHaveBeenCalledWith(
          "task.release",
          {},
          expect.objectContaining({ id: liveTask.id, revision: liveTask.revision }),
        ),
      );
      expect(
        await screen.findByText("Claim released. The task is To do."),
      ).toBeInTheDocument();
    });
    it("releases an expired claim without asking", async () => {
      const confirm = vi.spyOn(window, "confirm");
      render(<CrewWorkspace />);
      fireEvent.click(await screen.findByRole("button", { name: /Stale work/ }));
      const dialog = within(screen.getByRole("dialog"));
      expect(dialog.getByText(`Claim expired · ${String(project.name)}`)).toBeInTheDocument();
      expect(dialog.getAllByText(/Claim expired/)).toHaveLength(1);
      fireEvent.click(dialog.getByRole("button", { name: "Claim actions" }));
      fireEvent.click(dialog.getByRole("menuitem", { name: "Release claim" }));
      await waitFor(() =>
        expect(crewApi.write).toHaveBeenCalledWith(
          "task.release",
          {},
          expect.objectContaining({ id: expiredTask.id }),
        ),
      );
      expect(confirm).not.toHaveBeenCalled();
    });
    it("shows no claim controls on an unclaimed task", async () => {
      fixtures.tasks = [{ ...task, status: "todo", title: "Free work" }];
      render(<CrewWorkspace />);
      fireEvent.click(await screen.findByRole("button", { name: /Free work/ }));
      const dialog = within(screen.getByRole("dialog"));
      expect(dialog.queryByRole("button", { name: "Claim actions" })).toBeNull();
      expect(dialog.queryByText(/Claimed by|Claim expired/)).toBeNull();
    });
  });
});
it("explains project agents and coding sessions in the Guide", async () => {
  history.replaceState(null, "", "/#/guide");
  render(<CrewWorkspace />);
  const section = within(
    (
      await screen.findByRole("heading", {
        name: "Project agents and coding sessions",
      })
    ).closest("section")!,
  );
  expect(section.getByText(/One agent per project/)).toBeInTheDocument();
  expect(section.getByText(/claims one task for 2 hours/)).toBeInTheDocument();
  expect(section.getByText(/Its instructions are saved in Crew/)).toBeInTheDocument();
  expect(section.getByText(/Claim expired/)).toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "How an agent is started" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Claim" })).toBeInTheDocument();
});
describe("release labels and Won't do on the board", () => {
  // One base time, so tasks "a day old" tie exactly: separate Date.now() calls
  // can straddle a millisecond and flip the newest-first order (flaked in CI).
  let base = Date.now();
  const days = (n: number) =>
    new Date(base - n * 86_400_000).toISOString().replace("T", " ");
  const closed = (id: string, title: string, extra: Partial<Row>): Row => ({
    ...task,
    id,
    title,
    status: "done",
    readiness: "waiting",
    updated: days(1),
    ...extra,
  });
  beforeEach(() => {
    base = Date.now();
    fixtures.reviews = [];
    fixtures.tasks = [
      { ...task, id: "task00000000001", title: "Planned", status: "todo", labels: [] },
      closed("task00000000002", "Shipped first", { labels: ["release-0.18.0"], updated: days(2) }),
      closed("task00000000003", "Shipped next", { labels: ["release-0.19.0"] }),
      closed("task00000000004", "Dropped idea", { status: "wont_do", labels: [] }),
      closed("task00000000005", "Ancient work", { labels: ["release-0.9.0"], updated: days(30) }),
      closed("task00000000006", "Also next", {
        labels: ["release-0.19.0"],
        updated: days(3),
      }),
    ];
  });
  const doneColumn = () =>
    within(screen.getByRole("region", { name: /^Done/ }));
  const doneTitles = () =>
    [...doneColumn().queryAllByRole("heading", { level: 3 })].map((x) => x.textContent);
  const cardTitles = () =>
    [...document.querySelectorAll(".crew-task-card h3")].map((x) => x.textContent);

  it("keeps four columns and lists recent closed tasks newest change first, without release groups", async () => {
    render(<CrewWorkspace />);
    await screen.findByRole("heading", { name: "Planned" });
    expect(document.querySelectorAll(".crew-column")).toHaveLength(4);
    expect(doneColumn().queryAllByRole("group")).toHaveLength(0);
    expect(doneTitles()).toEqual(["Shipped next", "Dropped idea", "Shipped first", "Also next"]);
    const dropped = screen.getByRole("button", { name: /Dropped idea/ });
    expect(within(dropped).getByText("Won't do")).toBeInTheDocument();
    expect(within(dropped).queryByText(/On hold|Ready/)).toBeNull();
    expect(screen.queryByText(/Shipped in/)).toBeNull();
    // Older closed tasks fold away behind one button.
    expect(screen.queryByRole("heading", { name: "Ancient work" })).toBeNull();
    fireEvent.click(doneColumn().getByRole("button", { name: "Show older (1)" }));
    expect(doneTitles()).toHaveLength(5);
    expect(doneTitles().at(-1)).toBe("Ancient work");
    expect(doneColumn().queryByRole("button", { name: /Show older/ })).toBeNull();
  });

  it("has no release filter, field or search token; a release label finds that release's older tasks", async () => {
    render(<CrewWorkspace />);
    await screen.findByRole("heading", { name: "Planned" });
    expect(openFilters().queryByRole("combobox", { name: "Filter by release" })).toBeNull();
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by label" }), {
      target: { value: "release-0.9.0" },
    });
    expect(cardTitles()).toEqual(["Ancient work"]);
    expect(location.hash).toBe("#/tasks?label=release-0.9.0");
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    const search = screen.getByRole("searchbox", { name: "Search tasks" });
    // release: is plain text now; label: is the filter.
    fireEvent.change(search, { target: { value: "release:0.19.0" } });
    expect(cardTitles()).toEqual([]);
    fireEvent.change(search, { target: { value: "label:release-0.19.0" } });
    expect(cardTitles()).toEqual(["Shipped next", "Also next"]);
    fireEvent.keyDown(search, { key: "Enter" });
    expect(location.hash).toBe("#/tasks?label=release-0.19.0");
  });

  it("opens a 0.22.0 release link as its release label", async () => {
    history.replaceState(null, "", "/#/tasks?release=0.18.0");
    render(<CrewWorkspace />);
    await screen.findByRole("heading", { name: "Shipped first" });
    expect(screen.getByRole("button", { name: "Remove filter Label release-0.18.0" })).toBeInTheDocument();
    expect(cardTitles()).toEqual(["Shipped first"]);
  });

  it("reads status: from the search like the filters", async () => {
    render(<CrewWorkspace />);
    await screen.findByRole("heading", { name: "Planned" });
    const search = screen.getByRole("searchbox", { name: "Search tasks" });
    fireEvent.change(search, { target: { value: "status:wont-do" } });
    expect(cardTitles()).toEqual(["Dropped idea"]);
    // A key still being typed filters nothing.
    fireEvent.change(search, { target: { value: "label:" } });
    expect(cardTitles()).toHaveLength(5);
  });

  it("leaves Done and Won't do tasks out of Home's on-hold count", async () => {
    history.replaceState(null, "", "/#/");
    render(<CrewWorkspace />);
    // Only "Planned" is open; the closed tasks are never on hold.
    expect(
      await screen.findByRole("link", {
        name: "1 task on hold, show on the Tasks board",
      }),
    ).toBeInTheDocument();
  });

  it("offers Won't do without a release field and shows an in-session approval", async () => {
    fixtures.tasks = [
      closed("task00000000003", "Shipped next", {
        labels: ["release-0.19.0"],
        review_mode: "in_session",
        approved_by: "Synthetic Owner",
        approved_at: "2026-11-12 10:00:00.000Z",
      }),
    ];
    render(<CrewWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: /Shipped next/ }));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByRole("note")).toHaveTextContent(
      /^Approved in session by Synthetic Owner, \S/,
    );
    expect(dialog.queryByRole("textbox", { name: "Release" })).toBeNull();
    const status = dialog.getByRole("combobox", { name: "Status" });
    expect(within(status).getByRole("option", { name: "Won't do" })).toBeInTheDocument();
    fireEvent.change(status, { target: { value: "wont_do" } });
    fireEvent.click(dialog.getByRole("button", { name: "Save task" }));
    await waitFor(() =>
      expect(crewApi.write).toHaveBeenCalledWith(
        "task.update",
        expect.objectContaining({ status: "wont_do", labels: ["release-0.19.0"] }),
        expect.objectContaining({ id: "task00000000003" }),
        "",
      ),
    );
    const sent = vi.mocked(crewApi.write).mock.calls.at(-1)?.[1] as Record<string, unknown>;
    expect(sent).not.toHaveProperty("release");
  });

  it("shows no approval line for a task approved through Crew", async () => {
    fixtures.tasks = [closed("task00000000003", "Shipped next", { review_mode: "" })];
    render(<CrewWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: /Shipped next/ }));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.queryByText(/Approved in session/)).toBeNull();
  });
});

it("combines label filtering with assignment, keeps hidden assignee labels filterable, and restores history", async () => {
  fixtures.reviews = [];
  fixtures.tasks = [
    { ...task, title: "Crew change", status: "todo", readiness: "ready", labels: ["Network", "Crew", "Bug"] },
    { ...task, id: "task00000000002", title: "Atlas change", status: "in_progress", labels: ["Network", "Atlas"] },
    { ...task, id: "task00000000003", title: "Other Crew", assigned_agent: "", status: "todo", labels: ["crew"] },
  ];
  render(<CrewWorkspace />);
  const card = await screen.findByRole("button", { name: /Crew change/ });
  expect(within(card).queryByRole("button", { name: "Filter by label Network" })).toBeNull();
  expect(within(openFilters().getByRole("combobox", { name: "Filter by label" })).getByRole("option", { name: "Network (2)" })).toBeInTheDocument();
  fireEvent.change(screen.getByRole("combobox", { name: "Filter by assignment" }), { target: { value: agent.id } });
  fireEvent.click(within(card).getByRole("button", { name: "Filter by label Crew" }));
  expect(document.querySelectorAll(".crew-task-card")).toHaveLength(1);
  expect(location.hash).toBe(`#/tasks?agent=${agent.id}&label=Crew`);
  expect(screen.getByRole("button", { name: "Remove filter Label Crew" })).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).toBeNull();
  act(() => history.back());
  await waitFor(() => expect(document.querySelectorAll(".crew-task-card")).toHaveLength(2));
  act(() => history.forward());
  await waitFor(() => expect(document.querySelectorAll(".crew-task-card")).toHaveLength(1));
  fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
  expect(document.querySelectorAll(".crew-task-card")).toHaveLength(3);
  expect(location.hash).toBe("#/tasks");
});
it("explains the statuses and why Needs review can't be picked", async () => {
  fixtures.reviews = [];
  fixtures.tasks = [{ ...task, title: "Plain", status: "todo", labels: [] }];
  render(<CrewWorkspace />);
  fireEvent.click(await screen.findByRole("button", { name: /Plain/ }));
  const dialog = within(screen.getByRole("dialog"));
  const status = dialog.getByRole("combobox", { name: "Status" });
  expect(within(status).getByRole("option", { name: "Needs review" })).toBeDisabled();
  expect(status).toHaveAccessibleDescription(
    "Needs review is set by requesting approval for a saved draft, not by hand.",
  );
  fireEvent.click(dialog.getByRole("button", { name: "What do the statuses mean?" }));
  expect(document.querySelector(".crew-help-popover")).toHaveTextContent(
    /Pick any status except Needs review: Crew sets that one itself when you or an agent requests approval/,
  );
});
it("says a pending review is why a task is in Needs review", async () => {
  render(<CrewWorkspace />);
  fireEvent.click(await screen.findByRole("button", { name: /Launch post/ }));
  const status = within(screen.getByRole("dialog")).getByRole("combobox", { name: "Status" });
  expect(status).toHaveAccessibleDescription(
    "Needs review: a draft is waiting for your decision in Approvals.",
  );
});
it("filters the board in one click from the agent row, in sync with the select", async () => {
  fixtures.reviews = [];
  fixtures.tasks = [
    { ...task, title: "Mine open", status: "todo", labels: [] },
    { ...task, id: "task00000000002", title: "Mine done", status: "done", labels: [] },
    { ...task, id: "task00000000003", title: "Nobody's", assigned_agent: "", status: "todo", labels: [] },
  ];
  history.replaceState(null, "", "/#/tasks");
  render(<CrewWorkspace />);
  await screen.findByText("Mine open");
  const row = within(screen.getByRole("group", { name: "Filter by agent" }));
  const all = row.getByRole("button", { name: "All agents, 2 open" });
  expect(all).toHaveAttribute("aria-pressed", "true");
  const mine = row.getByRole("button", { name: `${agent.name}, 1 open` });
  const nobody = row.getByRole("button", { name: "Unassigned, 1 open" });
  fireEvent.click(mine);
  expect(mine).toHaveAttribute("aria-pressed", "true");
  expect(all).toHaveAttribute("aria-pressed", "false");
  expect(location.hash).toBe(`#/tasks?agent=${agent.id}`);
  expect(screen.getByRole("combobox", { name: "Filter by assignment" })).toHaveValue(agent.id);
  expect(screen.queryByText("Nobody's")).toBeNull();
  fireEvent.click(mine);
  expect(location.hash).toBe("#/tasks");
  expect(all).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(nobody);
  expect(screen.queryByText("Mine open")).toBeNull();
  fireEvent.click(all);
  expect(document.querySelectorAll(".crew-task-card")).toHaveLength(3);
});
it("hides the Unassigned chip when every open task has an agent", async () => {
  fixtures.reviews = [];
  fixtures.tasks = [{ ...task, title: "Mine open", status: "todo", labels: [] }];
  history.replaceState(null, "", "/#/tasks");
  render(<CrewWorkspace />);
  await screen.findByText("Mine open");
  const row = within(screen.getByRole("group", { name: "Filter by agent" }));
  expect(row.queryByRole("button", { name: /^Unassigned/ })).toBeNull();
});
it("filters the board by the assigned agent in a card footer without opening the card", async () => {
  fixtures.reviews = [];
  fixtures.tasks = [
    { ...task, title: "Mine", status: "todo", labels: [] },
    { ...task, id: "task00000000002", title: "Nobody's", assigned_agent: "", status: "todo", labels: [] },
  ];
  history.replaceState(null, "", "/#/tasks");
  render(<CrewWorkspace />);
  const card = (await screen.findByText("Mine")).closest(".crew-task-card") as HTMLElement;
  const unassigned = screen.getByText("Nobody's").closest(".crew-task-card") as HTMLElement;
  expect(within(unassigned).queryByRole("button", { name: /^Filter by agent/ })).toBeNull();
  const chip = within(card).getByRole("button", { name: `Filter by agent ${agent.name}` });
  expect(chip).toHaveAttribute("title", `Filter by agent ${agent.name}`);
  fireEvent.keyDown(chip, { key: "Enter" });
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(chip);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(location.hash).toBe(`#/tasks?agent=${agent.id}`);
  expect(document.querySelectorAll(".crew-task-card")).toHaveLength(1);
  expect(screen.getByRole("combobox", { name: "Filter by assignment" })).toHaveValue(agent.id);
});
it("filters the board from Ready, On hold and Won't do chips without opening the card", async () => {
  fixtures.tasks = [
    { ...task, id: "taskready000001", title: "Ready one", status: "todo", readiness: "ready", labels: ["Bug"] },
    { ...task, id: "taskhold0000001", title: "Held one", status: "todo", readiness: "waiting", labels: [] },
    { ...task, id: "taskwont0000001", title: "Dropped one", status: "wont_do", labels: [] },
  ];
  history.replaceState(null, "", "/#/tasks");
  render(<CrewWorkspace />);
  const ready = (await screen.findByText("Ready one")).closest(".crew-task-card") as HTMLElement;
  fireEvent.click(within(ready).getByRole("button", { name: "Filter by readiness Ready" }));
  expect(location.hash).toContain("hold=ready");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByText("Held one")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Remove filter Ready" }));
  const held = (await screen.findByText("Held one")).closest(".crew-task-card") as HTMLElement;
  const holdChip = within(held).getByRole("button", { name: "Filter by readiness On hold" });
  fireEvent.keyDown(holdChip, { key: "Enter" });
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(holdChip);
  expect(location.hash).toContain("hold=on_hold");
  expect(screen.queryByText("Ready one")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Remove filter On hold" }));
  const dropped = (await screen.findByText("Dropped one")).closest(".crew-task-card") as HTMLElement;
  fireEvent.click(within(dropped).getByRole("button", { name: "Filter by status Won't do" }));
  expect(location.hash).toContain("status=wont_do");
  expect(screen.getByRole("button", { name: "Remove filter Status Won't do" })).toBeInTheDocument();
  expect(screen.queryByText("Ready one")).toBeNull();
  expect(screen.getByText("Dropped one")).toBeInTheDocument();
});
it("keeps Sort as its own toolbar control, outside Filters, and not counted as a filter", async () => {
  history.replaceState(null, "", "/#/tasks");
  render(<CrewWorkspace />);
  const sort = await screen.findByRole("combobox", { name: "Sort tasks" });
  expect(sort).toHaveValue("updated");
  expect(screen.getByRole("button", { name: "Filters" })).toBeInTheDocument();
  fireEvent.change(sort, { target: { value: "held" } });
  expect(location.hash).toContain("sort=held");
  expect(screen.getByRole("button", { name: "Filters" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Filters" }));
  const panel = screen.getByRole("group", { name: "Task filters" });
  expect(within(panel).queryByRole("combobox", { name: "Sort tasks" })).toBeNull();
  expect(within(panel).getByRole("combobox", { name: "Filter by status" })).toBeInTheDocument();
});

describe("links in rendered text (0.29.0)", () => {
  const linkingNote: Row = {
    id: "note00000000002",
    revision: 1,
    title: "Weekly digest",
    bucket: bucket.id,
    body: "Picked up task00000000001 and an unknown zzzzzzzzzzzzzzz, see `zzzzzzzzzzzzzzy`.",
    links: [],
    path: "#/notes/weekly-digest-note00000000002",
  };
  const taskRef = {
    id: task.id,
    collection: "tasks",
    title: "Launch post",
    path: "#/tasks/launch-post-task00000000001",
  };
  it("shows a bare id as its record's title and walks back and forward", async () => {
    fixtures.notes = [linkingNote];
    fixtures.tasks = [linkedTask];
    vi.mocked(crewApi.references).mockResolvedValue([taskRef]);
    history.replaceState(null, "", "/#/notes/weekly-digest-note00000000002");
    render(<CrewWorkspace />);
    let dialog = within(await screen.findByRole("dialog"));
    const link = await dialog.findByRole("link", { name: "Launch post" });
    expect(link).toHaveAttribute("href", taskRef.path);
    expect(link).toHaveAttribute("title", "Task · task00000000001");
    expect(link).not.toHaveAttribute("target");
    // Unknown ids stay as written (in code, code); one batched request asked.
    expect(dialog.getByText(/an unknown zzzzzzzzzzzzzzz/)).toBeInTheDocument();
    expect(dialog.getByText("zzzzzzzzzzzzzzy").tagName).toBe("CODE");
    expect(crewApi.references).toHaveBeenCalledTimes(1);
    expect(vi.mocked(crewApi.references).mock.calls[0][0].sort()).toEqual(
      ["task00000000001", "zzzzzzzzzzzzzzy", "zzzzzzzzzzzzzzz"],
    );
    const back = dialog.getByRole("button", { name: "Back" });
    const forward = dialog.getByRole("button", { name: "Forward" });
    expect(back).toBeDisabled();
    expect(forward).toBeDisabled();

    fireEvent.click(link);
    dialog = within(await screen.findByRole("dialog"));
    await waitFor(() => expect(dialog.getByLabelText("Title")).toHaveValue("Launch post"));
    expect(location.hash).toBe(taskRef.path);
    expect(dialog.getByRole("button", { name: "Back" })).toBeEnabled();
    expect(dialog.getByRole("button", { name: "Forward" })).toBeDisabled();

    fireEvent.click(dialog.getByRole("button", { name: "Back" }));
    await waitFor(() =>
      expect(location.hash).toBe("#/notes/weekly-digest-note00000000002"),
    );
    dialog = within(await screen.findByRole("dialog"));
    await dialog.findByRole("heading", { name: "Weekly digest" });
    expect(dialog.getByRole("button", { name: "Back" })).toBeDisabled();
    expect(dialog.getByRole("button", { name: "Forward" })).toBeEnabled();

    fireEvent.click(dialog.getByRole("button", { name: "Forward" }));
    await waitFor(() => expect(location.hash).toBe(taskRef.path));
    dialog = within(await screen.findByRole("dialog"));
    await waitFor(() => expect(dialog.getByLabelText("Title")).toHaveValue("Launch post"));

    // Closing returns to the page underneath.
    fireEvent.click(dialog.getByRole("button", { name: "Close dialog" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(location.hash).toBe("#/notes");
  });
  it("asks before leaving unsaved changes for a linked record", async () => {
    fixtures.tasks = [{ ...linkedTask, description: "See note00000000002" }];
    fixtures.notes = [linkingNote];
    vi.mocked(crewApi.references).mockResolvedValue([
      { id: linkingNote.id, collection: "notes", title: "Weekly digest", path: linkingNote.path as string },
    ]);
    history.replaceState(null, "", "/#/tasks/launch-post-task00000000001");
    render(<CrewWorkspace />);
    const dialog = within(await screen.findByRole("dialog"));
    fireEvent.change(dialog.getByLabelText("Title"), { target: { value: "Edited" } });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const link = await dialog.findByRole("link", { name: "Weekly digest" });
    fireEvent.click(link);
    expect(confirm).toHaveBeenCalled();
    await waitFor(() => expect(location.hash).toBe("#/tasks/launch-post-task00000000001"));
    expect(screen.getByRole("dialog")).toHaveTextContent("Edit task");
  });
  it("walks Related links back and forward like links in text (0.30.1)", async () => {
    fixtures.tasks = [{ ...linkedTask, links: [linkedNote.id] }];
    fixtures.notes = [linkedNote];
    history.replaceState(null, "", "/#/tasks/launch-post-task00000000001");
    render(<CrewWorkspace />);
    let dialog = within(await screen.findByRole("dialog"));
    const related = dialog.getByRole("group", { name: "Related" });
    const link = within(related).getByRole("link", { name: "Voice guide" });
    expect(link).toHaveAttribute("href", linkedNote.path);
    expect(dialog.getByRole("button", { name: "Back" })).toBeDisabled();

    fireEvent.click(link);
    await waitFor(() => expect(location.hash).toBe(linkedNote.path));
    dialog = within(await screen.findByRole("dialog"));
    await dialog.findByRole("heading", { name: "Voice guide" });
    expect(dialog.getByRole("button", { name: "Back" })).toBeEnabled();
    expect(dialog.getByRole("button", { name: "Forward" })).toBeDisabled();

    // The note lists the task under Linked from; the dialog's Back returns.
    fireEvent.click(dialog.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(location.hash).toBe("#/tasks/launch-post-task00000000001"));
    dialog = within(await screen.findByRole("dialog"));
    await waitFor(() => expect(dialog.getByLabelText("Title")).toHaveValue("Launch post"));
    expect(dialog.getByRole("button", { name: "Back" })).toBeDisabled();
    expect(dialog.getByRole("button", { name: "Forward" })).toBeEnabled();

    // Browser Forward matches the dialog's Forward.
    act(() => history.forward());
    await waitFor(() => expect(location.hash).toBe(linkedNote.path));
    dialog = within(await screen.findByRole("dialog"));
    await dialog.findByRole("heading", { name: "Voice guide" });

    // From the note's Related to the task, then browser Back.
    fireEvent.click(
      within(dialog.getByRole("group", { name: "Related" })).getByRole("link", {
        name: "Launch post",
      }),
    );
    await waitFor(() => expect(location.hash).toBe("#/tasks/launch-post-task00000000001"));
    dialog = within(await screen.findByRole("dialog"));
    await waitFor(() => expect(dialog.getByLabelText("Title")).toHaveValue("Launch post"));
    expect(dialog.getByRole("button", { name: "Back" })).toBeEnabled();
    act(() => history.back());
    await waitFor(() => expect(location.hash).toBe(linkedNote.path));
    await within(await screen.findByRole("dialog")).findByRole("heading", { name: "Voice guide" });
  });
  it("leaves modified clicks on a Related link to the browser", async () => {
    fixtures.tasks = [{ ...linkedTask, links: [linkedNote.id] }];
    fixtures.notes = [linkedNote];
    history.replaceState(null, "", "/#/tasks/launch-post-task00000000001");
    render(<CrewWorkspace />);
    const dialog = within(await screen.findByRole("dialog"));
    const link = within(dialog.getByRole("group", { name: "Related" })).getByRole("link", {
      name: "Voice guide",
    });
    for (const init of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }]) {
      // fireEvent returns false when a handler called preventDefault.
      expect(fireEvent.click(link, init)).toBe(true);
    }
    expect(location.hash).toBe("#/tasks/launch-post-task00000000001");
  });
  it("asks before a Related link leaves unsaved changes, and keeps them", async () => {
    fixtures.tasks = [{ ...linkedTask, links: [linkedNote.id] }];
    fixtures.notes = [linkedNote];
    history.replaceState(null, "", "/#/tasks/launch-post-task00000000001");
    render(<CrewWorkspace />);
    const dialog = within(await screen.findByRole("dialog"));
    fireEvent.change(dialog.getByLabelText("Title"), { target: { value: "Edited" } });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(
      within(dialog.getByRole("group", { name: "Related" })).getByRole("link", {
        name: "Voice guide",
      }),
    );
    expect(confirm).toHaveBeenCalledWith("Discard your unsaved changes?");
    await waitFor(() => expect(location.hash).toBe("#/tasks/launch-post-task00000000001"));
    expect(within(screen.getByRole("dialog")).getByLabelText("Title")).toHaveValue("Edited");
  });
  it("opens buckets and agents from their links, and says when one is missing", async () => {
    history.replaceState(null, "", "/#/buckets/network-bucket000000001");
    render(<CrewWorkspace />);
    let dialog = within(await screen.findByRole("dialog"));
    expect(screen.getByRole("dialog")).toHaveTextContent("Edit bucket");
    expect(dialog.getByDisplayValue("NETWORK")).toBeInTheDocument();
    navigate("#/agents/network-agent0000000001");
    await waitFor(() => expect(screen.getByRole("dialog")).toHaveTextContent("Edit agent"));
    dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByDisplayValue("Network")).toBeInTheDocument();
    cleanup();
    history.replaceState(null, "", "/#/agents/gone-agent0000000009");
    render(<CrewWorkspace />);
    expect(await screen.findByText("That agent wasn't found.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("opens a comment link on the Comments tab at that comment", async () => {
    fixtures.tasks = [linkedTask];
    fixtures.events = [
      { id: "event0000000001", revision: 1, parent: task.id, action: "task.comment", body: "First synthetic comment", created: "2026-11-15 10:00:00.000Z", reported_agent: "Network" },
    ];
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    history.replaceState(null, "", "/#/tasks/launch-post-task00000000001?comment=event0000000001");
    render(<CrewWorkspace />);
    const dialog = within(await screen.findByRole("dialog"));
    const item = (await dialog.findByText("First synthetic comment")).closest("li")!;
    expect(item).toHaveClass("crew-comment-target");
    expect(dialog.getByRole("tab", { name: /Comments/ })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(scroll).toHaveBeenCalled());
  });
  it("shows relative dates in Activity and comments, with the exact time on hover", async () => {
    fixtures.tasks = [linkedTask];
    const ago = (h: number) => new Date(Date.now() - h * 3600000).toISOString();
    fixtures.events = [
      { id: "event0000000003", revision: 1, parent: task.id, action: "task.update", body: "Hold reason updated", created: ago(19.2), reported_agent: "Assess" },
      { id: "event0000000002", revision: 1, parent: task.id, action: "task.comment", body: "Drafts only", created: ago(30), reported_agent: "Assess" },
      { id: "event0000000001", revision: 1, parent: task.id, action: "task.create", body: "Launch plan", created: ago(50), reported_agent: "Assess" },
    ];
    history.replaceState(null, "", "/#/tasks/launch-post-task00000000001?tab=activity");
    render(<CrewWorkspace />);
    const dialog = within(await screen.findByRole("dialog"));
    const updated = (await dialog.findByText("Hold reason updated")).closest("li")!;
    expect(updated).toHaveTextContent(/^Updated · 19 h ago · Assess/);
    const time = updated.querySelector("time")!;
    expect(time).toHaveAttribute("datetime", fixtures.events[0].created);
    expect(time.getAttribute("title")).toMatch(/\d{4}.*\d:\d{2}/);
    expect(dialog.getByText("Drafts only").closest("li")).toHaveTextContent(/· yesterday · Assess/);
    expect(dialog.getByText("Launch plan").closest("li")).toHaveTextContent(/· 2 days ago · Assess/);
    fireEvent.click(dialog.getByRole("tab", { name: /^Comments/ }));
    const comment = (await dialog.findByText("Drafts only")).closest("li")!;
    expect(comment).toHaveTextContent(/^Assess · yesterday/);
    expect(comment.querySelector("time[title][datetime]")).not.toBeNull();
    expect(comment).not.toHaveTextContent(/\d{4}/);
  });
});
describe("stepping through the list a dialog was opened from (0.32.0)", () => {
  const second: Row = {
    ...review,
    id: "review000000002",
    draft: "The second draft",
  };
  /** A one-finger swipe on el: dx < 0 is a swipe left. */
  function swipe(el: Element, dx: number) {
    fireEvent.touchStart(el, { touches: [{ clientX: 300, clientY: 300 }] });
    fireEvent.touchEnd(el, {
      touches: [],
      changedTouches: [{ clientX: 300 + dx, clientY: 300 }],
    });
  }
  const position = (dialog: HTMLElement) =>
    dialog.querySelector(".crew-list-position")?.textContent;
  it("steps between pending reviews with previous/next and x of y, one history entry per step", async () => {
    fixtures.reviews = [review, second];
    history.replaceState(null, "", "/#/approvals");
    const push = vi.spyOn(history, "pushState");
    render(<CrewWorkspace />);
    fireEvent.click(
      (await screen.findAllByRole("button", { name: "Review draft: Launch post" }))[0],
    );
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("The submitted draft");
    const next = within(dialog).getByRole("button", { name: "Next review (J)" });
    const previous = within(dialog).getByRole("button", {
      name: "Previous review (K)",
    });
    expect(position(dialog)).toBe("1 of 2");
    expect(previous).toBeDisabled();
    expect(push).toHaveBeenCalledTimes(1);
    fireEvent.click(next);
    await within(dialog).findByText("The second draft");
    expect(location.hash).toBe("#/approvals/review000000002");
    expect(push).toHaveBeenCalledTimes(2);
    // A tap on the disabled end adds nothing.
    fireEvent.click(next);
    expect(push).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(position(dialog)).toBe("2 of 2");
    expect(next).toBeDisabled();
    expect(previous).toBeEnabled();
    // A step never decides.
    expect(crewApi.write).not.toHaveBeenCalled();
    // History back/forward retrace the steps; the dialog stays open.
    history.back();
    await within(dialog).findByText("The submitted draft");
    expect(location.hash).toBe("#/approvals/review000000001");
    expect(position(dialog)).toBe("1 of 2");
    history.forward();
    await within(dialog).findByText("The second draft");
    expect(location.hash).toBe("#/approvals/review000000002");
    // Back twice: the first review, then the list, which closes the dialog.
    history.back();
    await within(dialog).findByText("The submitted draft");
    history.back();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(location.hash).toBe("#/approvals");
  });
  it("closes from a stepped-to item back to the list without reopening on Back", async () => {
    fixtures.reviews = [review, second];
    history.replaceState(null, "", "/#/approvals");
    render(<CrewWorkspace />);
    fireEvent.click(
      (await screen.findAllByRole("button", { name: "Review draft: Launch post" }))[0],
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.keyDown(dialog, { key: "j" });
    await within(dialog).findByText("The second draft");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close dialog" }));
    await waitFor(() => expect(location.hash).toBe("#/approvals"));
    expect(screen.queryByRole("dialog")).toBeNull();
    // The list's own entry: the items are forward history now.
    expect(history.state).toBeNull();
  });
  it("never changes the item on a horizontal swipe or Left/Right", async () => {
    fixtures.reviews = [review, second];
    history.replaceState(null, "", "/#/approvals/review000000001");
    render(<CrewWorkspace />);
    const dialog = await screen.findByRole("dialog");
    const text = await within(dialog).findByText("The submitted draft");
    swipe(text, -120);
    swipe(text, 120);
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    fireEvent.keyDown(dialog, { key: "ArrowLeft" });
    expect(location.hash).toBe("#/approvals/review000000001");
    expect(within(dialog).getByText("The submitted draft")).toBeTruthy();
    // A deep link has its list too: the page's default list.
    expect(position(dialog)).toBe("1 of 2");
  });
  it("asks before discarding a typed decision note; staying adds no history entry", async () => {
    fixtures.reviews = [review, second];
    history.replaceState(null, "", "/#/approvals/review000000001");
    const push = vi.spyOn(history, "pushState");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<CrewWorkspace />);
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("The submitted draft");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Decision note" }), {
      target: { value: "Almost" },
    });
    const next = within(dialog).getByRole("button", { name: "Next review (J)" });
    fireEvent.click(next);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(location.hash).toBe("#/approvals/review000000001");
    expect(push).not.toHaveBeenCalled();
    expect(dialog).not.toHaveAttribute("data-swipe");
    confirm.mockReturnValue(true);
    fireEvent.click(next);
    await within(dialog).findByText("The second draft");
    expect(push).toHaveBeenCalledTimes(1);
    expect(crewApi.write).not.toHaveBeenCalled();
    // The new review has nothing typed: no question.
    fireEvent.click(within(dialog).getByRole("button", { name: "Previous review (K)" }));
    await within(dialog).findByText("The submitted draft");
    expect(confirm).toHaveBeenCalledTimes(2);
  });
  it("steps through the board in visible card order with J/K and the header buttons", async () => {
    const todo: Row = {
      ...task,
      id: "task00000000002",
      title: "Plan launch",
      status: "todo",
      updated: "2026-11-10 10:00:00.000Z",
    };
    const doing: Row = {
      ...task,
      id: "task00000000003",
      title: "Write copy",
      status: "in_progress",
      updated: "2026-11-11 10:00:00.000Z",
    };
    fixtures.tasks = [task, doing, todo];
    fixtures.reviews = [];
    render(<CrewWorkspace />);
    fireEvent.click(await screen.findByRole("heading", { name: "Plan launch" }));
    const dialog = await screen.findByRole("dialog");
    expect(location.hash).toMatch(/^#\/tasks\/task00000000002$/);
    expect(position(dialog)).toBe("1 of 3");
    fireEvent.keyDown(dialog, { key: "j" });
    await waitFor(() =>
      expect(location.hash).toMatch(/^#\/tasks\/task00000000003$/),
    );
    expect(within(dialog).getByDisplayValue("Write copy")).toBeTruthy();
    expect(position(dialog)).toBe("2 of 3");
    // Typing J in a field types it.
    fireEvent.keyDown(within(dialog).getByDisplayValue("Write copy"), {
      key: "j",
    });
    expect(location.hash).toBe("#/tasks/task00000000003");
    fireEvent.click(within(dialog).getByRole("button", { name: "Next task (J)" }));
    await waitFor(() => expect(location.hash).toBe("#/tasks/task00000000001"));
    expect(within(dialog).getByRole("button", { name: "Next task (J)" })).toBeDisabled();
    expect(position(dialog)).toBe("3 of 3");
    fireEvent.keyDown(dialog, { key: "k" });
    await waitFor(() => expect(location.hash).toBe("#/tasks/task00000000003"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Close dialog" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(location.hash).toBe("#/tasks"));
  });
  it("follows the board's filter: hidden tasks are not steps", async () => {
    const other: Row = {
      ...task,
      id: "task00000000002",
      title: "Other work",
      labels: ["Elsewhere"],
    };
    fixtures.tasks = [task, other];
    history.replaceState(null, "", "/#/tasks?label=Network");
    render(<CrewWorkspace />);
    fireEvent.click(await screen.findByRole("heading", { name: "Launch post" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Next task (J)" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Previous task (K)" })).toBeDisabled();
    expect(position(dialog)).toBe("1 of 1");
    fireEvent.keyDown(dialog, { key: "j" });
    expect(dialog).toHaveAttribute("data-swipe", "bounce-next");
  });
  it("gives a link to another kind its collection's own list", async () => {
    fixtures.reviews = [review, second];
    history.replaceState(null, "", "/#/");
    render(<CrewWorkspace />);
    await screen.findByRole("region", { name: "Needs you" });
    location.hash = "#/approvals";
    await screen.findAllByRole("button", { name: "Review draft: Launch post" });
    // A task opened from a link over Approvals steps through the board.
    location.hash = "#/tasks/task00000000001";
    const dialog = await screen.findByRole("dialog");
    expect(position(dialog)).toBe("1 of 1");
    expect(within(dialog).getByRole("button", { name: "Next task (J)" })).toBeDisabled();
    // History back/forward stay, and so do More and close.
    expect(within(dialog).getByRole("button", { name: "Back" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "More actions" })).toBeTruthy();
  });
  it("keeps the capsule's slot, hidden, for an item its list is hiding", async () => {
    const other: Row = { ...task, id: "task00000000002", title: "Other work", labels: ["Elsewhere"] };
    fixtures.tasks = [task, other];
    history.replaceState(null, "", "/#/tasks?label=Network");
    render(<CrewWorkspace />);
    await screen.findByRole("heading", { name: "Launch post" });
    // A link to a task the board's filter hides: no steps, but the slot stays.
    location.hash = "#/tasks/task00000000002";
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByDisplayValue("Other work");
    const slot = dialog.querySelector(".crew-list-nav")!;
    expect(slot).toHaveClass("crew-list-nav-hidden");
    expect(slot).toHaveAttribute("aria-hidden", "true");
    expect(slot.querySelector(".crew-list-position")?.textContent).toBe("");
    expect(within(dialog).queryByRole("button", { name: /^Next task/ })).toBeNull();
    // It sits where the capsule does: after the title, before More and close.
    const head = dialog.querySelector("header.crew-dialog-head")!;
    expect(Array.from(head.children).map((x) => x.className.split(" ")[0] || x.tagName)).toEqual([
      "crew-trail-nav", "H2", "crew-list-nav", "crew-head-pill", "crew-head-button",
    ]);
    fireEvent.keyDown(dialog, { key: "j" });
    expect(location.hash).toBe("#/tasks/task00000000002");
  });
  it("steps through notes in their sort, and agents with their links", async () => {
    fixtures.notes = [
      { id: "note00000000001", revision: 1, bucket: bucket.id, title: "Beta", body: "b", updated: "2026-11-10 10:00:00.000Z" },
      { id: "note00000000002", revision: 1, bucket: bucket.id, title: "Alpha", body: "a", updated: "2026-11-11 10:00:00.000Z" },
    ];
    fixtures.agents = [agent, { ...agent, id: "agent0000000002", name: "Build" }];
    history.replaceState(null, "", "/#/notes?sort=title");
    render(<CrewWorkspace />);
    fireEvent.click(await screen.findByRole("heading", { name: "Alpha" }));
    let dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Next note (J)" }));
    await waitFor(() => expect(location.hash).toMatch(/^#\/notes\/note00000000001$/));
    fireEvent.click(within(dialog).getByRole("button", { name: "Close dialog" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(location.hash).toBe("#/notes?sort=title"));
    await openPage("Agents");
    fireEvent.click(screen.getByRole("heading", { name: "Network" }));
    dialog = await screen.findByRole("dialog");
    expect(location.hash).toBe("#/agents/agent0000000001");
    fireEvent.click(within(dialog).getByRole("button", { name: "Next agent (J)" }));
    await waitFor(() => expect(within(dialog).getByDisplayValue("Build")).toBeTruthy());
    expect(location.hash).toBe("#/agents/agent0000000002");
  });
});
describe("previous/next from Home sections and natural lists (0.35.0)", () => {
  const position = (dialog: HTMLElement) =>
    dialog.querySelector(".crew-list-position")?.textContent;
  const planTask: Row = { ...task, id: "task00000000002", title: "Plan launch", status: "todo", updated: "2026-11-10 10:00:00.000Z" };
  it("steps through approvals waiting from Needs you, then closes to Home", async () => {
    fixtures.tasks = [task, planTask];
    fixtures.reviews = [
      review,
      { ...review, id: "review000000002", task: planTask.id, draft: "The plan draft" },
      { ...review, id: "review000000003", status: "approved", draft: "Old" },
    ];
    history.replaceState(null, "", "/#/");
    render(<CrewWorkspace />);
    const needs = within(await screen.findByRole("region", { name: "Needs you" }));
    fireEvent.click(needs.getByRole("button", { name: /^Launch post Draft waiting/ }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("The submitted draft");
    expect(location.hash).toBe("#/approvals/review000000001");
    expect(position(dialog)).toBe("1 of 2");
    expect(within(dialog).getByRole("button", { name: "Previous review (K)" })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Next review (J)" }));
    await within(dialog).findByText("The plan draft");
    expect(location.hash).toBe("#/approvals/review000000002");
    expect(position(dialog)).toBe("2 of 2");
    expect(within(dialog).getByRole("button", { name: "Next review (J)" })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close dialog" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(location.hash).toBe("#/"));
    expect(screen.getByRole("region", { name: "Needs you" })).toBeTruthy();
  });
  it("steps through the Needs you tasks only, not the board", async () => {
    fixtures.reviews = [];
    fixtures.tasks = [
      { ...task, status: "todo", handoff_limited: true, updated: "2026-11-12 10:00:00.000Z" },
      planTask,
      { ...task, id: "task00000000003", title: "Stuck too", status: "in_progress", handoff_limited: true, updated: "2026-11-11 10:00:00.000Z" },
    ];
    history.replaceState(null, "", "/#/");
    render(<CrewWorkspace />);
    const needs = within(await screen.findByRole("region", { name: "Needs you" }));
    fireEvent.click(needs.getByRole("button", { name: /^Launch post/ }));
    const dialog = await screen.findByRole("dialog");
    expect(position(dialog)).toBe("1 of 2");
    fireEvent.keyDown(dialog, { key: "j" });
    await waitFor(() => expect(location.hash).toBe("#/tasks/task00000000003"));
    expect(position(dialog)).toBe("2 of 2");
    expect(within(dialog).getByRole("button", { name: "Next task (J)" })).toBeDisabled();
  });
  it("steps across kinds through Recent, and Back keeps that list", async () => {
    fixtures.reviews = [];
    fixtures.tasks = [{ ...task, status: "todo", updated: "2026-11-12 10:00:00.000Z" }, planTask];
    fixtures.notes = [{ id: "note00000000001", revision: 1, bucket: bucket.id, title: "Voice notes", body: "b", updated: "2026-11-11 10:00:00.000Z" }];
    history.replaceState(null, "", "/#/");
    render(<CrewWorkspace />);
    const recent = within(await screen.findByRole("region", { name: "Recent" }));
    fireEvent.click(recent.getByRole("button", { name: /^Launch post/ }));
    const dialog = await screen.findByRole("dialog");
    expect(position(dialog)).toBe("1 of 3");
    fireEvent.click(within(dialog).getByRole("button", { name: "Next item (J)" }));
    await waitFor(() => expect(location.hash).toBe("#/notes/note00000000001"));
    expect(position(dialog)).toBe("2 of 3");
    expect(history.state).toMatchObject({ crewList: 2, crewSource: "home:recent" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Next item (J)" }));
    await waitFor(() => expect(location.hash).toBe("#/tasks/task00000000002"));
    expect(within(dialog).getByRole("button", { name: "Next item (J)" })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Back" }));
    await waitFor(() => expect(location.hash).toBe("#/notes/note00000000001"));
    await waitFor(() => expect(position(dialog)).toBe("2 of 3"));
    expect(within(dialog).getByRole("button", { name: "Next item (J)" })).toBeEnabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close dialog" }));
    await waitFor(() => expect(location.hash).toBe("#/"));
  });
  it("steps through Home's agents A–Z, from the row and from its menu", async () => {
    fixtures.reviews = [];
    fixtures.agents = [agent, { ...agent, id: "agent0000000002", name: "Build" }];
    history.replaceState(null, "", "/#/");
    render(<CrewWorkspace />);
    const agents = await screen.findByRole("region", { name: "Agents" });
    const rows = agents.querySelectorAll<HTMLButtonElement>(".crew-home-agent");
    expect(rows[0]).toHaveTextContent("Build");
    fireEvent.click(rows[0]);
    const dialog = await screen.findByRole("dialog");
    expect(location.hash).toBe("#/agents/agent0000000002");
    expect(position(dialog)).toBe("1 of 2");
    fireEvent.click(within(dialog).getByRole("button", { name: "Next agent (J)" }));
    await waitFor(() => expect(location.hash).toBe("#/agents/agent0000000001"));
    expect(within(dialog).getByDisplayValue("Network")).toBeTruthy();
    expect(position(dialog)).toBe("2 of 2");
  });
  it("keeps a Home section's list after a reload of the item's address", async () => {
    fixtures.reviews = [];
    fixtures.tasks = [{ ...task, status: "todo", updated: "2026-11-12 10:00:00.000Z" }, planTask];
    history.replaceState({ crewList: 1, crewSource: "home:recent" }, "", "/#/tasks/task00000000001");
    render(<CrewWorkspace />);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(position(dialog)).toBe("1 of 2"));
    expect(within(dialog).getByRole("button", { name: "Next item (J)" })).toBeEnabled();
  });
  it("opens a direct link in its collection's natural list", async () => {
    fixtures.reviews = [];
    fixtures.notes = [
      { id: "note00000000001", revision: 1, bucket: bucket.id, title: "Older", body: "a", updated: "2026-11-10 10:00:00.000Z" },
      { id: "note00000000002", revision: 1, bucket: bucket.id, title: "Newer", body: "b", updated: "2026-11-11 10:00:00.000Z" },
    ];
    fixtures.buckets = [bucket, { ...bucket, id: "bucket000000002", name: "BUILD" }];
    history.replaceState(null, "", "/#/notes/note00000000001");
    render(<CrewWorkspace />);
    let dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(position(dialog)).toBe("2 of 2"));
    // A link to a bucket from the note's dialog: all buckets.
    location.hash = "#/buckets/bucket000000002";
    await waitFor(() => expect(screen.getByRole("button", { name: "Next bucket (J)" })).toBeTruthy());
    dialog = screen.getByRole("dialog");
    expect(position(dialog)).toMatch(/^\d of 2$/);
  });
});
// 0.40.0: Archive task from the Approval detail's ⋯ menu. One write archives
// the task and withdraws its pending review; a toast offers Undo
// (review.restore) and the detail moves to the next approval.
describe("Archive task from the Approval ⋯ menu (0.40.0)", () => {
  const item = (n: number, title: string, draft: string) => {
    const id = `task0000000000${n}`;
    return {
      task: { ...task, id, title, draft } as Row,
      review: { ...review, id: `review00000000${n}`, task: id, draft } as Row,
    };
  };
  const one = item(1, "Plan one", "First draft"),
    two = item(2, "Plan two", "Second draft"),
    three = item(3, "Plan three", "Third draft");
  const position = (dialog: HTMLElement) =>
    dialog.querySelector(".crew-list-position")?.textContent;
  const conflict = () =>
    Object.assign(new Error("Revision conflict; reread and reassess"), {
      status: 409,
    });
  const refusal = () =>
    Object.assign(
      new Error("This review cannot be restored (review_not_restorable)."),
      {
        status: 409,
        response: { data: { reason: { code: "review_not_restorable" } } },
      },
    );
  const offline = () =>
    Object.assign(new TypeError("Failed to fetch"), { status: 0 });
  /** Archived rows on the synthetic server, and writes it refuses. */
  let gone: Record<string, Row[]>;
  let reject: Record<string, (() => unknown) | undefined>;
  /** Each write as action, data, row id and the revision it was sent with. */
  const writes = () =>
    vi
      .mocked(crewApi.write)
      .mock.calls.map(([action, data, row]) => [
        action,
        data,
        row?.id,
        row?.revision,
      ]);
  const bump = (row: Row, changes: Partial<Row>): Row => ({
    ...row,
    ...changes,
    revision: row.revision + 1,
  });
  /**
   * A small synthetic server: revision-checked; archiving a task withdraws its
   * pending review in the same write; review.restore undoes exactly that.
   */
  const seed = () => {
    fixtures.tasks = [one.task, two.task, three.task];
    fixtures.reviews = [one.review, two.review, three.review];
    gone = { tasks: [] };
    reject = {};
    vi.mocked(crewApi.read).mockImplementation(async (collection, f = {}) => {
      const rows = (f.archived ? gone[collection] : fixtures[collection]) ?? [];
      return f.id ? rows.filter((x) => x.id === f.id) : rows;
    });
    vi.mocked(crewApi.write).mockReset();
    vi.mocked(crewApi.write).mockImplementation(async (action, data = {}, row) => {
      const refused =
        reject[action === "task.update" ? `task.update:${data.archived}` : action];
      if (refused) throw refused();
      if (action === "task.update" && typeof data.archived === "boolean") {
        const current = (data.archived ? fixtures.tasks : gone.tasks).find(
          (x) => x.id === row?.id,
        );
        if (!current || current.revision !== row?.revision) throw conflict();
        if (data.archived) {
          const next = bump(current, { archived: true, status: "in_progress" });
          fixtures.tasks = fixtures.tasks.filter((x) => x.id !== current.id);
          gone.tasks = [...gone.tasks, next];
          fixtures.reviews = fixtures.reviews.map((x) =>
            x.task === current.id && x.status === "pending"
              ? bump(x, { status: "withdrawn" })
              : x,
          );
          return next;
        }
        const next = bump(current, { archived: false });
        gone.tasks = gone.tasks.filter((x) => x.id !== current.id);
        fixtures.tasks = [...fixtures.tasks, next];
        return next;
      }
      if (action === "review.restore") {
        const current = fixtures.reviews.find((x) => x.id === row?.id);
        if (!current || current.revision !== row?.revision) throw conflict();
        const archived = gone.tasks.find((x) => x.id === current.task);
        if (current.status !== "withdrawn" || !archived) throw refusal();
        const next = bump(current, { status: "pending" });
        fixtures.reviews = fixtures.reviews.map((x) =>
          x.id === next.id ? next : x,
        );
        gone.tasks = gone.tasks.filter((x) => x.id !== archived.id);
        fixtures.tasks = [
          ...fixtures.tasks,
          bump(archived, { archived: false, status: "needs_review" }),
        ];
        return next;
      }
      throw new Error(`Unexpected synthetic write ${action}`);
    });
  };
  beforeEach(seed);
  afterEach(() => resetLanguageForTests());
  const openCard = async (title: string) => {
    fireEvent.click(
      await screen.findByRole("button", { name: `Review draft: ${title}` }),
    );
    return screen.findByRole("dialog");
  };
  /** Opens the dialog's More menu (its items arrive a render later) and picks Archive task. */
  const archive = async (dialog: HTMLElement, row = "Archive task") => {
    const more = dialog.querySelector<HTMLButtonElement>(
      '.crew-head-pill button[aria-haspopup="menu"]',
    )!;
    await waitFor(() => expect(more).toBeEnabled());
    fireEvent.click(more);
    fireEvent.click(within(dialog).getByRole("menuitem", { name: row }));
  };
  const toastOf = (text: string) =>
    screen.getByText(text).closest<HTMLElement>(".crew-undo-toast")!;
  /** Plan two (2 of 3) archived from the Approvals page: the detail shows Plan three. */
  const archivedSecond = async () => {
    history.replaceState(null, "", "/#/approvals");
    render(<CrewWorkspace />);
    const dialog = await openCard("Plan two");
    await within(dialog).findByText("Second draft");
    await archive(dialog);
    await within(dialog).findByText("Third draft");
    return dialog;
  };

  it("adds Archive task under Open task as a normal row, above the divider and Reject", async () => {
    history.replaceState(null, "", "/#/approvals/review000000002");
    render(<CrewWorkspace />);
    const dialog = await screen.findByRole("dialog");
    const more = within(dialog).getByRole("button", { name: "More actions" });
    await waitFor(() => expect(more).toBeEnabled());
    fireEvent.click(more);
    const menu = within(dialog).getByRole("menu", { name: "More actions" });
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((x) => x.textContent),
    ).toEqual([
      "Add note",
      "Copy link",
      "Open task",
      "Archive task",
      "How it works",
      "Reject",
    ]);
    const row = within(menu).getByRole("menuitem", { name: "Archive task" });
    expect(row).toBeEnabled();
    expect(row).not.toHaveClass("crew-menu-danger");
    const groups = menu.querySelectorAll(".crew-menu-group");
    expect(groups[0]).toContainElement(row);
    expect(groups[1].textContent).toBe("Reject");
    expect(row.querySelector("svg.crew-icon")).not.toBeNull();
    // Opening the menu sends nothing.
    expect(crewApi.write).not.toHaveBeenCalled();
  });

  it("archives with one write and no confirmation, then shows the next approval with Undo", async () => {
    history.replaceState(null, "", "/#/approvals");
    const push = vi.spyOn(history, "pushState");
    const confirm = vi.spyOn(window, "confirm");
    render(<CrewWorkspace />);
    const dialog = await openCard("Plan two");
    await within(dialog).findByText("Second draft");
    expect(position(dialog)).toBe("2 of 3");
    expect(history.state).toEqual({ crewList: 1 });
    const controls = () =>
      ["More actions", "Close dialog", "Previous review (K)", "Next review (J)"].map(
        (name) => within(dialog).getByRole("button", { name }),
      );
    const before = controls();
    await archive(dialog);
    await within(dialog).findByText("Third draft");
    // Exactly one write: the task's own archive, with its revision.
    expect(vi.mocked(crewApi.write).mock.calls).toEqual([
      ["task.update", { archived: true }, two.task],
    ]);
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.queryByText("Saved.")).toBeNull();
    // The next approval takes over the archived one's history entry: nothing
    // is pushed and the entry keeps its state (its place above the list).
    expect(location.hash).toBe("#/approvals/review000000003");
    expect(push).toHaveBeenCalledTimes(1);
    expect(history.state).toEqual({ crewList: 1 });
    // Its real place in the shorter list.
    expect(position(dialog)).toBe("2 of 2");
    expect(within(dialog).getByRole("heading", { name: "Plan three", level: 3 })).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Approve draft" })).toBeEnabled();
    // The same dialog and the same header controls: nothing was remounted.
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(controls()).toEqual(before);
    // The toast is inside the open dialog (a modal dialog makes the page
    // inert), as the dialog's last child.
    const toast = toastOf("Task archived");
    expect(toast).toHaveAttribute("role", "status");
    expect(toast).toHaveTextContent("Task archived·Undo×");
    expect(toast.parentElement).toHaveClass("crew-dialog-toast");
    expect(dialog.lastElementChild).toBe(toast.parentElement);
    expect(within(toast).getByRole("button", { name: "Undo" })).toBeEnabled();
    expect(within(toast).getByRole("button", { name: "Dismiss" })).toBeEnabled();
    // Back goes to the list, never to the archived approval, and the list no
    // longer shows it; the toast moves to the page.
    history.back();
    await waitFor(() => expect(location.hash).toBe("#/approvals"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(
      screen
        .getAllByRole("button", { name: /^Review draft: / })
        .map((x) => x.getAttribute("aria-label")),
    ).toEqual(["Review draft: Plan one", "Review draft: Plan three"]);
    expect(toastOf("Task archived").closest("dialog")).toBeNull();
    // Forward is the approval that took its place.
    history.forward();
    await waitFor(() =>
      expect(location.hash).toBe("#/approvals/review000000003"),
    );
    await within(await screen.findByRole("dialog")).findByText("Third draft");
    expect(crewApi.write).toHaveBeenCalledTimes(1);
  });

  it("returns to the Approvals list after archiving the last approval, and the task is in Archive", async () => {
    history.replaceState(null, "", "/#/approvals");
    render(<CrewWorkspace />);
    const dialog = await openCard("Plan three");
    await within(dialog).findByText("Third draft");
    expect(position(dialog)).toBe("3 of 3");
    await archive(dialog);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(location.hash).toBe("#/approvals"));
    // The list's own entry, as after a decision.
    expect(history.state).toBeNull();
    expect(writes()).toEqual([
      ["task.update", { archived: true }, three.task.id, 3],
    ]);
    const toast = toastOf("Task archived");
    expect(toast).toHaveAttribute("role", "status");
    expect(toast.closest("dialog")).toBeNull();
    expect(within(toast).getByRole("button", { name: "Undo" })).toBeEnabled();
    expect(
      screen
        .getAllByRole("button", { name: /^Review draft: / })
        .map((x) => x.getAttribute("aria-label")),
    ).toEqual(["Review draft: Plan one", "Review draft: Plan two"]);
    // Without Undo it stays recoverable from the Archive page.
    location.hash = "#/archive";
    expect(
      await screen.findByRole("button", { name: "Restore Plan three" }),
    ).toBeEnabled();
  });

  it("walks Home's approvals waiting: each archive shows the next one and the last returns to Home", async () => {
    history.replaceState(null, "", "/#/");
    render(<CrewWorkspace />);
    const needs = within(await screen.findByRole("region", { name: "Needs you" }));
    fireEvent.click(needs.getByRole("button", { name: /^Plan one Draft waiting/ }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("First draft");
    expect(position(dialog)).toBe("1 of 3");
    await archive(dialog);
    await within(dialog).findByText("Second draft");
    expect(position(dialog)).toBe("1 of 2");
    // The list is still Home's section.
    expect(history.state).toEqual({ crewList: 1, crewSource: "home:approvals" });
    expect(location.hash).toBe("#/approvals/review000000002");
    await archive(dialog);
    await within(dialog).findByText("Third draft");
    expect(position(dialog)).toBe("1 of 1");
    // One toast at a time: the second archive replaced the first one's.
    expect(screen.getAllByText("Task archived")).toHaveLength(1);
    await archive(dialog);
    await waitFor(() => expect(location.hash).toBe("#/"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(writes()).toEqual(
      [one, two, three].map((x) => ["task.update", { archived: true }, x.task.id, 3]),
    );
    expect(screen.getAllByText("Task archived")).toHaveLength(1);
  });

  it("skips an approval that was decided elsewhere in the meantime", async () => {
    history.replaceState(null, "", "/#/approvals");
    render(<CrewWorkspace />);
    const dialog = await openCard("Plan one");
    await within(dialog).findByText("First draft");
    fixtures.reviews = fixtures.reviews.map((x) =>
      x.id === two.review.id ? bump(x, { status: "approved" }) : x,
    );
    await archive(dialog);
    await within(dialog).findByText("Third draft");
    expect(location.hash).toBe("#/approvals/review000000003");
    expect(position(dialog)).toBe("1 of 1");
  });

  it("keeps the approval and what was typed when the archive fails; a retry sends the fresh revision", async () => {
    history.replaceState(null, "", "/#/approvals");
    const push = vi.spyOn(history, "pushState");
    const confirm = vi.spyOn(window, "confirm");
    render(<CrewWorkspace />);
    const dialog = await openCard("Plan two");
    await within(dialog).findByText("Second draft");
    const note = within(dialog).getByRole("textbox", { name: "Decision note" });
    fireEvent.change(note, { target: { value: "Keep this thought" } });
    // The task changed elsewhere, so the row the reader holds is stale.
    fixtures.tasks = fixtures.tasks.map((x) =>
      x.id === two.task.id ? { ...x, revision: 8, title: "Plan two, renamed" } : x,
    );
    await archive(dialog);
    const toast = (
      await screen.findByText("Couldn't archive the task. Try again.")
    ).closest<HTMLElement>(".crew-undo-toast")!;
    expect(toast).toHaveAttribute("role", "alert");
    expect(dialog).toContainElement(toast);
    expect(within(toast).queryByRole("button", { name: "Undo" })).toBeNull();
    expect(screen.queryByText("Task archived")).toBeNull();
    // One write was tried and nothing else was sent; nothing moved or was lost.
    expect(writes()).toEqual([
      ["task.update", { archived: true }, two.task.id, 3],
    ]);
    expect(location.hash).toBe("#/approvals/review000000002");
    expect(push).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByText("Second draft")).toBeVisible();
    expect(position(dialog)).toBe("2 of 3");
    expect(note).toHaveValue("Keep this thought");
    expect(within(dialog).queryByText(/Revision conflict/)).toBeNull();
    expect(screen.queryByText("Saved.")).toBeNull();
    expect(fixtures.reviews.every((x) => x.status === "pending")).toBe(true);
    // The reload brought the task's current row, so the retry is accepted.
    await within(dialog).findByRole("heading", { name: "Plan two, renamed" });
    await archive(dialog);
    await within(dialog).findByText("Third draft");
    expect(writes()).toEqual([
      ["task.update", { archived: true }, two.task.id, 3],
      ["task.update", { archived: true }, two.task.id, 8],
    ]);
    expect(toastOf("Task archived")).toHaveAttribute("role", "status");
    expect(screen.queryByText("Couldn't archive the task. Try again.")).toBeNull();
    // Archiving never asks, even over a typed note.
    expect(confirm).not.toHaveBeenCalled();
  });

  it("shows the same alert when nothing reaches the server", async () => {
    reject["task.update:true"] = offline;
    history.replaceState(null, "", "/#/approvals/review000000001");
    render(<CrewWorkspace />);
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("First draft");
    await archive(dialog);
    expect(
      (await screen.findByText("Couldn't archive the task. Try again.")).closest(
        '[role="alert"]',
      ),
    ).toHaveClass("crew-undo-toast-alert");
    expect(crewApi.write).toHaveBeenCalledTimes(1);
    expect(location.hash).toBe("#/approvals/review000000001");
    expect(position(dialog)).toBe("1 of 3");
    expect(within(dialog).getByRole("button", { name: "Approve draft" })).toBeEnabled();
    expect(gone.tasks).toEqual([]);
  });

  it("counts a lost answer as archived when the reload shows the task archived", async () => {
    // The write reached the server, but its answer never came back.
    const server = vi.mocked(crewApi.write).getMockImplementation()!;
    vi.mocked(crewApi.write).mockImplementation(async (...args) => {
      const answer = await server(...args);
      if (args[0] === "task.update") throw offline();
      return answer;
    });
    history.replaceState(null, "", "/#/approvals");
    render(<CrewWorkspace />);
    const dialog = await openCard("Plan two");
    await within(dialog).findByText("Second draft");
    await archive(dialog);
    await within(dialog).findByText("Third draft");
    expect(writes()).toEqual([
      ["task.update", { archived: true }, two.task.id, 3],
    ]);
    expect(position(dialog)).toBe("2 of 2");
    expect(toastOf("Task archived")).toHaveAttribute("role", "status");
    expect(screen.queryByText("Couldn't archive the task. Try again.")).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Undo" })).toBeEnabled();
  });

  it("Undo restores the review with its fresh revision and reopens the approval where it was", async () => {
    const push = vi.spyOn(history, "pushState");
    const dialog = await archivedSecond();
    expect(position(dialog)).toBe("2 of 2");
    fireEvent.click(within(dialog).getByRole("button", { name: "Undo" }));
    await within(dialog).findByText("Second draft");
    // The withdrawn review's current row: the archive raised its revision.
    expect(crewApi.read).toHaveBeenCalledWith("reviews", { id: two.review.id });
    expect(vi.mocked(crewApi.write).mock.calls).toEqual([
      ["task.update", { archived: true }, two.task],
      ["review.restore", {}, { ...two.review, status: "withdrawn", revision: 2 }],
    ]);
    // Its own address again, on the same history entry, in its old place.
    expect(location.hash).toBe("#/approvals/review000000002");
    expect(push).toHaveBeenCalledTimes(1);
    expect(history.state).toEqual({ crewList: 1 });
    expect(position(dialog)).toBe("2 of 3");
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(within(dialog).getByRole("button", { name: "Approve draft" })).toBeEnabled();
    expect(within(dialog).getByText("pending")).toBeVisible();
    // The toast is gone, and the task is active again.
    expect(screen.queryByText("Task archived")).toBeNull();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    expect(gone.tasks).toEqual([]);
    // Closing returns to the list, which shows it again.
    fireEvent.click(within(dialog).getByRole("button", { name: "Close dialog" }));
    await waitFor(() => expect(location.hash).toBe("#/approvals"));
    expect(
      screen
        .getAllByRole("button", { name: /^Review draft: / })
        .map((x) => x.getAttribute("aria-label")),
    ).toEqual([
      "Review draft: Plan one",
      "Review draft: Plan two",
      "Review draft: Plan three",
    ]);
  });

  it("Undo from the list opens the restored approval as a click on its card does", async () => {
    history.replaceState(null, "", "/#/approvals");
    render(<CrewWorkspace />);
    const first = await openCard("Plan three");
    await within(first).findByText("Third draft");
    await archive(first);
    await waitFor(() => expect(location.hash).toBe("#/approvals"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const push = vi.spyOn(history, "pushState");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("Third draft");
    expect(writes()).toEqual([
      ["task.update", { archived: true }, three.task.id, 3],
      ["review.restore", {}, three.review.id, 2],
    ]);
    // One entry over the list, like a card click; closing goes back to it.
    expect(location.hash).toBe("#/approvals/review000000003");
    expect(push).toHaveBeenCalledTimes(1);
    expect(history.state).toEqual({ crewList: 1 });
    expect(position(dialog)).toBe("3 of 3");
    expect(within(dialog).getByRole("button", { name: "Approve draft" })).toBeEnabled();
    expect(screen.queryByText("Task archived")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close dialog" }));
    await waitFor(() => expect(location.hash).toBe("#/approvals"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("asks before Undo leaves a note typed on the approval that took its place", async () => {
    const dialog = await archivedSecond();
    const note = within(dialog).getByRole("textbox", { name: "Decision note" });
    fireEvent.change(note, { target: { value: "For plan three" } });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(screen.queryByText("Task archived")).toBeNull());
    // The approval is restored either way; declining only stays here.
    expect(writes().map((x) => x[0])).toEqual(["task.update", "review.restore"]);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(location.hash).toBe("#/approvals/review000000003");
    expect(note).toHaveValue("For plan three");
    await waitFor(() => expect(position(dialog)).toBe("3 of 3"));
  });

  it("restores the task alone and says so when the server refuses to restore the review", async () => {
    const dialog = await archivedSecond();
    reject["review.restore"] = refusal;
    fireEvent.click(within(dialog).getByRole("button", { name: "Undo" }));
    const toast = (
      await screen.findByText(
        "Task restored. Its approval is no longer pending; request it again.",
      )
    ).closest<HTMLElement>(".crew-undo-toast")!;
    expect(toast).toHaveAttribute("role", "status");
    expect(within(toast).queryByRole("button", { name: "Undo" })).toBeNull();
    expect(screen.queryByText("Task archived")).toBeNull();
    // The fallback un-archives the task from its current (archived) row.
    expect(writes()).toEqual([
      ["task.update", { archived: true }, two.task.id, 3],
      ["review.restore", {}, two.review.id, 2],
      ["task.update", { archived: false }, two.task.id, 4],
    ]);
    expect(crewApi.read).toHaveBeenCalledWith("tasks", {
      id: two.task.id,
      archived: true,
    });
    // No navigation: still on the approval that followed.
    expect(location.hash).toBe("#/approvals/review000000003");
    expect(within(dialog).getByText("Third draft")).toBeVisible();
    expect(position(dialog)).toBe("2 of 2");
    // The task is active again and its review stays withdrawn.
    expect(gone.tasks).toEqual([]);
    expect(fixtures.tasks.map((x) => x.id)).toContain(two.task.id);
    expect(fixtures.reviews.find((x) => x.id === two.review.id)).toMatchObject({
      status: "withdrawn",
    });
  });

  it("reads the review again, once, when Undo meets a plain revision conflict", async () => {
    const dialog = await archivedSecond();
    // A 409 with no reason code: the review changed since it was read.
    reject["review.restore"] = () => {
      reject["review.restore"] = undefined;
      return conflict();
    };
    fireEvent.click(within(dialog).getByRole("button", { name: "Undo" }));
    await within(dialog).findByText("Second draft");
    expect(writes()).toEqual([
      ["task.update", { archived: true }, two.task.id, 3],
      ["review.restore", {}, two.review.id, 2],
      ["review.restore", {}, two.review.id, 2],
    ]);
    expect(
      vi
        .mocked(crewApi.read)
        .mock.calls.filter(([c, f]) => c === "reviews" && f?.id === two.review.id),
    ).toHaveLength(2);
    expect(location.hash).toBe("#/approvals/review000000002");
    expect(position(dialog)).toBe("2 of 3");
    expect(screen.queryByText(/Task restored/)).toBeNull();
  });

  it("falls back to restoring the task alone when the conflict repeats", async () => {
    const dialog = await archivedSecond();
    reject["review.restore"] = conflict;
    fireEvent.click(within(dialog).getByRole("button", { name: "Undo" }));
    await screen.findByText(
      "Task restored. Its approval is no longer pending; request it again.",
    );
    expect(writes().map((x) => [x[0], x[1]])).toEqual([
      ["task.update", { archived: true }],
      ["review.restore", {}],
      ["review.restore", {}],
      ["task.update", { archived: false }],
    ]);
    expect(gone.tasks).toEqual([]);
    expect(location.hash).toBe("#/approvals/review000000003");
  });

  it("leaves the task in Archive and says so when Undo cannot reach the server", async () => {
    const dialog = await archivedSecond();
    reject["review.restore"] = offline;
    fireEvent.click(within(dialog).getByRole("button", { name: "Undo" }));
    const toast = (
      await screen.findByText(
        "Couldn't undo. The task is in Archive; restore it from there.",
      )
    ).closest<HTMLElement>(".crew-undo-toast")!;
    expect(toast).toHaveAttribute("role", "alert");
    expect(within(toast).queryByRole("button", { name: "Undo" })).toBeNull();
    // Nothing was un-archived behind the owner's back.
    expect(writes().map((x) => [x[0], x[1]])).toEqual([
      ["task.update", { archived: true }],
      ["review.restore", {}],
    ]);
    expect(gone.tasks.map((x) => x.id)).toEqual([two.task.id]);
    expect(location.hash).toBe("#/approvals/review000000003");
    expect(position(dialog)).toBe("2 of 2");
  });

  it("says the same when the fallback fails too", async () => {
    const dialog = await archivedSecond();
    reject["review.restore"] = refusal;
    reject["task.update:false"] = conflict;
    fireEvent.click(within(dialog).getByRole("button", { name: "Undo" }));
    expect(
      (
        await screen.findByText(
          "Couldn't undo. The task is in Archive; restore it from there.",
        )
      ).closest('[role="alert"]'),
    ).not.toBeNull();
    expect(writes().map((x) => [x[0], x[1]])).toEqual([
      ["task.update", { archived: true }],
      ["review.restore", {}],
      ["task.update", { archived: false }],
    ]);
    expect(gone.tasks.map((x) => x.id)).toEqual([two.task.id]);
    expect(screen.queryByText(/Task restored/)).toBeNull();
  });

  it("runs one Undo at a time, however often it is tapped", async () => {
    const dialog = await archivedSecond();
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    const server = vi.mocked(crewApi.write).getMockImplementation()!;
    vi.mocked(crewApi.write).mockImplementation(async (...args) => {
      if (args[0] === "review.restore") await held;
      return server(...args);
    });
    const undo = within(dialog).getByRole("button", { name: "Undo" });
    fireEvent.click(undo);
    fireEvent.click(undo);
    await waitFor(() => expect(undo).toBeDisabled());
    // Nothing else can be decided while it runs.
    expect(within(dialog).getByRole("button", { name: "Approve draft" })).toBeDisabled();
    fireEvent.click(undo);
    release();
    await within(dialog).findByText("Second draft");
    expect(writes().map((x) => x[0])).toEqual(["task.update", "review.restore"]);
  });

  it("lets the toast go by itself after about 5 seconds, leaving the task in Archive", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const dialog = await archivedSecond();
      expect(within(dialog).getByRole("button", { name: "Undo" })).toBeEnabled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(screen.getByText("Task archived")).toBeVisible();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2100);
      });
      // Past five seconds it fades, then it is gone.
      expect(toastOf("Task archived")).toHaveClass("crew-undo-toast-leaving");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      expect(screen.queryByText("Task archived")).toBeNull();
      expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
      // The approval that followed is untouched, and nothing was restored.
      expect(within(dialog).getByText("Third draft")).toBeVisible();
      expect(crewApi.write).toHaveBeenCalledTimes(1);
      expect(gone.tasks.map((x) => x.id)).toEqual([two.task.id]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives a toast that replaces another its own five seconds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      history.replaceState(null, "", "/#/approvals");
      render(<CrewWorkspace />);
      const dialog = await openCard("Plan one");
      await within(dialog).findByText("First draft");
      await archive(dialog);
      await within(dialog).findByText("Second draft");
      // Three seconds into the first toast, the second archive replaces it.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      await archive(dialog);
      await within(dialog).findByText("Third draft");
      expect(screen.getAllByText("Task archived")).toHaveLength(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      // The first toast's remaining two seconds do not apply to the second.
      expect(toastOf("Task archived")).not.toHaveClass("crew-undo-toast-leaving");
      // Its Undo restores the second archive, not the first.
      fireEvent.click(within(dialog).getByRole("button", { name: "Undo" }));
      await within(dialog).findByText("Second draft");
      expect(writes().at(-1)).toEqual(["review.restore", {}, two.review.id, 2]);
      expect(gone.tasks.map((x) => x.id)).toEqual([one.task.id]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reads in German and Italian: the row, the failure and the toast with Undo", async () => {
    for (const [lang, row, failed, done, undo] of [
      [
        "de",
        "Aufgabe archivieren",
        "Die Aufgabe konnte nicht archiviert werden. Versuche es erneut.",
        "Aufgabe archiviert",
        "Rückgängig",
      ],
      [
        "it",
        "Archivia attività",
        "Impossibile archiviare l'attività. Riprova.",
        "Attività archiviata",
        "Annulla",
      ],
    ] as const) {
      seed();
      setLanguage(lang);
      history.replaceState(null, "", "/#/approvals/review000000002");
      const view = render(<CrewWorkspace />);
      const dialog = await screen.findByRole("dialog");
      await within(dialog).findByText("Second draft");
      reject["task.update:true"] = offline;
      await archive(dialog, row);
      expect((await screen.findByText(failed)).closest('[role="alert"]')).not.toBeNull();
      reject = {};
      await archive(dialog, row);
      // The task's own title and draft stay as written.
      await within(dialog).findByText("Third draft");
      const toast = toastOf(done);
      expect(within(toast).getByRole("button", { name: undo })).toBeEnabled();
      fireEvent.click(within(toast).getByRole("button", { name: undo }));
      await within(dialog).findByText("Second draft");
      expect(screen.queryByText(done)).toBeNull();
      view.unmount();
    }
  });
});
