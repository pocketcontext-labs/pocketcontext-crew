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
  history.replaceState(null, "", "/#/team");
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
});
afterEach(() => {
  cleanup();
  history.replaceState(null, "", "/");
  vi.restoreAllMocks();
});
async function openPage(name: string | RegExp) {
  const link = screen.getByRole("link", { name });
  fireEvent.click(link);
  await waitFor(() => expect(link).toHaveAttribute("aria-current", "page"));
}
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
  await openPage("AI Team");
  expect(location.hash).toBe("#/team");
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
  await openPage("Shared memory");
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
  expect(location.hash).toBe("#/");
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
it("guides a new owner one step at a time", async () => {
  fixtures = { agents: [], buckets: [], tasks: [], reviews: [], notes: [] };
  localStorage.clear();
  history.replaceState(null, "", "/");
  render(<CrewWorkspace />);
  await screen.findByRole("heading", { name: "Get started" });
  expect(screen.getByText("0 of 4 done")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Set up starter crew" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "I've connected it" })).toBeNull();
  expect(screen.getByText("Nothing needs you right now.")).toBeInTheDocument();
});
it("advances past a manually confirmed connection and remembers it", async () => {
  fixtures.tasks = [];
  fixtures.reviews = [];
  localStorage.clear();
  history.replaceState(null, "", "/");
  render(<CrewWorkspace />);
  fireEvent.click(await screen.findByRole("button", { name: "I've connected it" }));
  expect(await screen.findByRole("button", { name: "＋ New task" })).toBeTruthy();
  expect(localStorage.getItem("pocketcontext.crew.agent_connected")).toBe("1");
  localStorage.clear();
});
it("counts agent activity as connected and lists what needs the owner", async () => {
  localStorage.clear();
  history.replaceState(null, "", "/");
  render(<CrewWorkspace />);
  await screen.findByText("Draft waiting for your approval");
  expect(screen.getByText("3 of 4 done")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open Approvals" })).toBeTruthy();
  fireEvent.click(screen.getByText("Draft waiting for your approval"));
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
});
it("hides Get started once finished or dismissed", async () => {
  localStorage.clear();
  fixtures.reviews = [{ ...review, status: "approved" }];
  history.replaceState(null, "", "/");
  render(<CrewWorkspace />);
  await screen.findByRole("heading", { name: "Your crew right now" });
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
it("previews a multi-line brief as one clamped paragraph with the full brief on hover", async () => {
  const brief = "Save decisions.\n\n- Not every activity\n  - Ask first";
  fixtures.agents = [{ ...agent, brief }];
  history.replaceState(null, "", "/#/agents");
  render(<CrewWorkspace />);
  const card = (await screen.findByRole("heading", { name: "Network" })).closest(
    "button",
  )!;
  const preview = card.querySelector("p")!;
  expect(preview.textContent).toBe(
    "Save decisions. - Not every activity - Ask first",
  );
  expect(preview).toHaveAttribute("title", brief);
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
    const field = within(await screen.findByRole("dialog")).getByLabelText(
      "Agent brief",
    ) as HTMLTextAreaElement;
    expect(field.style.height).toBe("auto");
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
it("derives Human from a pending request while preserving the assigned agent", async () => {
  render(<CrewWorkspace />);
  await screen.findByRole("heading", { name: "Launch post" });
  expect(
    screen.getByText("Human", { selector: ".crew-human" }),
  ).toBeInTheDocument();
  expect(
    screen.getByText("Network", { selector: "footer" }),
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
it("requires saving a changed draft before submitting it for review", async () => {
  fixtures.tasks = [{ ...task, status: "in_progress" }];
  fixtures.reviews = [];
  render(<CrewWorkspace />);
  await screen.findByRole("heading", { name: "Launch post" });
  fireEvent.click(screen.getByRole("button", { name: /Launch post/ }));
  const dialog = screen.getByRole("dialog");
  expect(
    within(dialog).getByRole("button", { name: "Send draft for approval" }),
  ).toBeEnabled();
  fireEvent.change(
    within(dialog).getByLabelText("Draft for review"),
    { target: { value: "Different draft" } },
  );
  expect(
    within(dialog).queryByRole("button", { name: "Send draft for approval" }),
  ).toBeNull();
  expect(within(dialog).getByText("Save your draft first")).toBeInTheDocument();
  expect(crewApi.write).not.toHaveBeenCalled();
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
  expect(
    screen.getByText(
      "Hidden by its archived bucket. Restore the bucket first.",
    ),
  ).toBeInTheDocument();
  const noteRow = screen.getByText("Voice").closest(".crew-archive-row")!;
  expect(
    within(noteRow as HTMLElement).getByRole("button", { name: "Restore" }),
  ).toBeDisabled();
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
  expect(
    screen.getByText("Network", { selector: "footer" }),
  ).toBeInTheDocument();
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
  await openPage("Shared memory");
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
  await openPage("Shared memory");
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

it("defaults new tasks to waiting and explicitly creates assigned ready work", async () => {
  render(<CrewWorkspace />);
  await screen.findByRole("heading", { name: "Launch post" });
  fireEvent.click(screen.getByRole("button", { name: /New task/ }));
  const dialog = within(screen.getByRole("dialog"));
  expect(dialog.getByLabelText("Readiness")).toHaveValue("waiting");
  expect(dialog.getByLabelText("Waiting reason")).toBeInTheDocument();
  fireEvent.change(dialog.getByLabelText("Title"), {
    target: { value: "Prepare research" },
  });
  fireEvent.change(dialog.getByLabelText("Assigned agent"), {
    target: { value: agent.id },
  });
  fireEvent.change(dialog.getByLabelText("Readiness"), {
    target: { value: "ready" },
  });
  expect(dialog.queryByLabelText("Waiting reason")).toBeNull();
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

it("keeps assignment separate from readiness and saves the waiting reason", async () => {
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
  expect(dialog.getByLabelText("Readiness")).toHaveValue("waiting");
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
  expect(screen.getByRole("button", { name: "Copy address" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Copy link" })).toBeNull();
  expect(
    screen.getByRole("region", { name: "Connected apps" }),
  ).toBeInTheDocument();
});

it("gives skill instructions and no MCP details without a domain", async () => {
  vi.mocked(crewApi.connection).mockResolvedValue({ kind: "local" });
  await renderConnect();
  expect(
    await screen.findByText("./pocketcontext-crew skill"),
  ).toBeInTheDocument();
  expect(screen.getByText("./pocketcontext-crew tunnel invite")).toBeInTheDocument();
  expect(document.body).not.toHaveTextContent("/mcp");
  expect(screen.queryByRole("region", { name: "Connected apps" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Copy link" })).toBeNull();
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

it("labels the MCP copy button Copy address on Home's connect step", async () => {
  fixtures = { ...fixtures, tasks: [], reviews: [] };
  history.replaceState(null, "", "/#/home");
  render(<CrewWorkspace />);
  expect(
    await screen.findByRole("button", { name: "Copy address" }),
  ).toBeVisible();
  expect(screen.queryByRole("button", { name: "Copy link" })).toBeNull();
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
  expect(location.hash).toBe("#/");
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("displays the running server release and build and refreshes them", async () => {
  const commit = "0123456789abcdef0123456789abcdef01234567";
  vi.mocked(crewApi.serverVersion).mockResolvedValueOnce({
    version: "0.2.0",
    commit,
  });
  render(<CrewWorkspace />);
  const footer = screen.getByRole("contentinfo", { name: "Running server" });
  await waitFor(() =>
    expect(footer).toHaveTextContent("Server 0.2.0 · Build 0123456789ab"),
  );
  expect(within(footer).getByLabelText(`Build ${commit}`)).toHaveAttribute(
    "title",
    commit,
  );
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() =>
    expect(footer).toHaveTextContent("Server 0.3.1 · Build synthetic-bu"),
  );
  expect(crewApi.serverVersion).toHaveBeenCalledTimes(2);
});

it("keeps the workspace usable when server metadata is missing and never substitutes the UI release", async () => {
  vi.mocked(crewApi.serverVersion).mockRejectedValue(
    new Error("Synthetic metadata unavailable"),
  );
  render(<CrewWorkspace />);
  await screen.findByRole("heading", { name: "Launch post" });
  const footer = screen.getByRole("contentinfo", { name: "Running server" });
  await waitFor(() =>
    expect(footer).toHaveTextContent("Server version unavailable"),
  );
  expect(footer).not.toHaveTextContent("0.3.1");
  expect(footer).not.toHaveTextContent("Synthetic metadata unavailable");
  fireEvent.click(screen.getByRole("button", { name: /Launch post/ }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});

it("renders development and older hosted version strings without inventing a release or commit", async () => {
  vi.mocked(crewApi.serverVersion).mockResolvedValue({
    version: "hosted-0123456789ab",
    commit: "",
  });
  render(<CrewWorkspace />);
  await waitFor(() =>
    expect(
      screen.getByRole("contentinfo", { name: "Running server" }),
    ).toHaveTextContent("Server hosted-0123456789ab"),
  );
  expect(
    screen.getByRole("contentinfo", { name: "Running server" }),
  ).not.toHaveTextContent("Build");
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
  "#/agents/task00000000001",
])("ignores the malformed item link %s", async (hash) => {
  history.replaceState(null, "", `/${hash}`);
  render(<CrewWorkspace />);
  await screen.findByRole("heading", { name: "Your crew right now" });
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
  await openPage("Shared memory");
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
  ["task", "#/tasks/launch-post-task00000000001"],
  ["note", "#/notes/voice-guide-note00000000001"],
])("clears the %s hash when its dialog closes", async (_kind, hash) => {
  fixtures.tasks = [linkedTask];
  fixtures.notes = [linkedNote];
  history.replaceState(null, "", `/${hash}`);
  render(<CrewWorkspace />);
  const dialog = within(await screen.findByRole("dialog"));
  expect(location.hash).toBe(hash);
  fireEvent.click(dialog.getByRole("button", { name: "Close dialog" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(location.hash).toBe("#/");
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
  expect(listener).not.toHaveBeenCalled();
  await openPage("Shared memory");
  listener.mockClear(); // The sidebar link is a real navigation.
  fireEvent.click(screen.getByRole("button", { name: /Voice guide/ }));
  expect(location.hash).toBe("#/notes/voice-guide-note00000000001");
  fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
  fireEvent.click(screen.getByRole("button", { name: /New note/ }));
  expect(location.hash).toBe("#/memory");
  expect(listener).not.toHaveBeenCalled();
  window.removeEventListener("hashchange", listener);
});

it("updates the address when a linked note opens from a note's related memory", async () => {
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
  fireEvent.click(dialog.getByRole("button", { name: /Voice guide/ }));
  expect(location.hash).toBe("#/notes/voice-guide-note00000000001");
  expect(
    await dialog.findByRole("heading", { name: "Voice guide" }),
  ).toBeInTheDocument();
});

it("shows an archived task read-only and explains how to restore it", async () => {
  fixtures.tasks = [];
  fixtures.reviews = [];
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
    dialog.queryByRole("button", { name: "Send draft for approval" }),
  ).toBeNull();
  expect(dialog.queryByText("Add a draft to request approval")).toBeNull();
  expect(dialog.queryByText("Save your draft first")).toBeNull();
  expect(dialog.queryByText(/Waiting for your approval/)).toBeNull();
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
  fireEvent.click(dialog.getByRole("button", { name: "Copy link" }));
  await dialog.findByRole("button", { name: "Link copied" });
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
  fireEvent.click(dialog.getByRole("button", { name: "Copy link" }));
  await dialog.findByRole("button", { name: "Link copied" });
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
  fireEvent.click(dialog.getByRole("button", { name: "Copy link" }));
  const alert = await dialog.findByRole("alert");
  expect(alert).toHaveTextContent("Could not copy automatically");
  expect(alert).toHaveTextContent("#/tasks/launch-post-task00000000001");
  expect(dialog.getByLabelText("Title")).toHaveValue("Launch post");
});

describe("simple dialogs", () => {
  const openNote = async (note: Row = linkedNote) => {
    fixtures.notes = fixtures.notes.length ? fixtures.notes : [note];
    history.replaceState(null, "", `/${note.path}`);
    render(<CrewWorkspace />);
    return within(await screen.findByRole("dialog"));
  };

  it("focuses the dialog rather than Copy link", async () => {
    fixtures.tasks = [linkedTask];
    history.replaceState(null, "", "/#/tasks/launch-post-task00000000001");
    render(<CrewWorkspace />);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveFocus();
    expect(
      within(dialog).getByRole("button", { name: "Copy link" }),
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
    await openPage("Shared memory");
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
    expect(dialog.queryByRole("button", { name: "Launch checklist" })).toBeNull();
    fireEvent.change(dialog.getByLabelText("Add related note"), {
      target: { value: "launch" },
    });
    // Searching alone is not an edit.
    expect(dialog.getByRole("button", { name: "Save note" })).toBeDisabled();
    fireEvent.click(dialog.getByRole("button", { name: "Launch checklist" }));
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

  it("asks before discarding a related-note change", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const other: Row = { ...linkedNote, id: "note00000000002", title: "Other" };
    fixtures.notes = [linkedNote, other];
    const dialog = await openNote();
    fireEvent.click(dialog.getByRole("tab", { name: "Edit" }));
    fireEvent.change(dialog.getByLabelText("Add related note"), {
      target: { value: "oth" },
    });
    fireEvent.click(dialog.getByRole("button", { name: "Other" }));
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
      dialog.getByRole("button", { name: "Send draft for approval" }),
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
    expect(
      dialog.getByText("Add a draft to request approval"),
    ).toBeInTheDocument();
    expect(dialog.queryByRole("button", { name: /^Send draft/ })).toBeNull();
  });

  it("points to Approvals while a review is pending", async () => {
    const dialog = await openTask({});
    expect(dialog.getByText(/Waiting for your approval/)).toBeInTheDocument();
    expect(dialog.getByRole("link", { name: "Approvals" })).toHaveAttribute(
      "href",
      "#/approvals",
    );
    expect(
      dialog.queryByRole("button", { name: "Send draft for approval" }),
    ).toBeNull();
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
    expect(
      screen.getByRole("contentinfo", { name: "Running server" }),
    ).toHaveTextContent("Server 0.3.1");
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
    await waitFor(() =>
      expect(
        screen.getByRole("contentinfo", { name: "Running server" }),
      ).toHaveTextContent("Server 0.3.1"),
    );
    vi.mocked(crewApi.read).mockRejectedValue(new Error("Synthetic outage"));
    vi.mocked(crewApi.serverVersion).mockRejectedValue(new Error("Synthetic"));
    const reads = vi.mocked(crewApi.read).mock.calls.length;
    becomeVisible();
    await waitFor(() =>
      expect(vi.mocked(crewApi.read).mock.calls.length).toBeGreaterThan(reads),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      screen.getByRole("contentinfo", { name: "Running server" }),
    ).toHaveTextContent("Server 0.3.1");
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
      name: "What is the AI Team board?",
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
    const button = dialog.getByRole("button", { name: "What is readiness?" });
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

describe("shared memory page", () => {
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
  async function openMemory(hash = "#/memory") {
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
    expect(location.hash).toBe(`#/memory?bucket=${bucket.id}`);
    // Every bucket card stays visible, so another can be chosen directly.
    expect(bucketNames()).toHaveLength(3);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(card);
    expect(card).toHaveAttribute("aria-pressed", "false");
    expect(dropdown).toHaveValue("");
    expect(noteTitles()).toHaveLength(3);
    expect(location.hash).toBe("#/memory");
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
    expect(location.hash).toBe("#/memory?sort=created");
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
    expect(location.hash).toBe("#/memory");
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
    expect(location.hash).toBe("#/memory?buckets=activity");
  });

  it("restores the filter and sorts from the address", async () => {
    await openMemory(`#/memory?buckets=notes&sort=title&bucket=${bucket.id}`);
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
      `#/memory?bucket=${bucket.id}&sort=title&buckets=notes`,
    );
  });

  it.each([
    ["an unknown bucket", "#/memory?bucket=missing00000001"],
    ["a malformed bucket", "#/memory?bucket=x"],
    ["unknown sorts", "#/memory?sort=size&buckets=color"],
  ])("falls back to defaults for %s", async (_name, hash) => {
    await openMemory(hash);
    expect(
      screen.getByRole("combobox", { name: "Filter by bucket" }),
    ).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "Sort notes" })).toHaveValue(
      "updated",
    );
    expect(noteTitles()).toHaveLength(3);
    await waitFor(() => expect(location.hash).toBe("#/memory"));
  });

  it("returns to the filtered page when a note closes, and keeps note links", async () => {
    await openMemory(`#/memory?bucket=${bucket.id}&sort=title`);
    fireEvent.click(screen.getByRole("button", { name: /Gamma audience/ }));
    expect(location.hash).toBe("#/notes/note00000000003");
    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    expect(location.hash).toBe(`#/memory?bucket=${bucket.id}&sort=title`);
    expect(noteTitles()).toEqual(["Beta voice", "Gamma audience"]);
    navigate("#/notes/note00000000002");
    const dialog = within(await screen.findByRole("dialog"));
    expect(
      dialog.getByRole("heading", { name: "Alpha palette" }),
    ).toBeInTheDocument();
  });

  it("starts unfiltered from the sidebar link", async () => {
    await openMemory(`#/memory?bucket=${bucket.id}`);
    await openPage("AI Team");
    await openPage("Shared memory");
    expect(location.hash).toBe("#/memory");
    expect(noteTitles()).toHaveLength(3);
  });
});
