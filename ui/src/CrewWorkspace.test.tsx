import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
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
it("takes the brand link home to AI Team", async () => {
  history.replaceState(null, "", "/#/agents");
  render(<CrewWorkspace />);
  await screen.findByRole("link", { name: "Agents" });
  fireEvent.click(screen.getByRole("link", { name: /go to AI Team/ }));
  await waitFor(() => expect(location.hash).toBe("#/"));
  expect(screen.getByRole("link", { name: "AI Team" })).toHaveAttribute(
    "aria-current",
    "page",
  );
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
  fireEvent.click(screen.getByRole("button", { name: /Review exact draft/ }));
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
  const submit = within(dialog).getByRole("button", {
    name: /Submit saved draft/,
  });
  expect(submit).toBeEnabled();
  fireEvent.change(
    within(dialog).getByLabelText("Draft for review (Markdown)"),
    { target: { value: "Different draft" } },
  );
  expect(submit).toBeDisabled();
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
  fireEvent.click(screen.getByRole("button", { name: /Review exact draft/ }));
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
    screen.getByRole("button", { name: /NETWORK Voice and audiences/ }),
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
    screen.getByRole("button", { name: /NETWORK Voice and audiences/ }),
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
    screen.getByRole("button", { name: /NETWORK Voice and audiences/ }),
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
  await openPage("Agents");
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
])("opens a %s from %s", async (_kind, hash, title) => {
  fixtures.tasks = [linkedTask];
  fixtures.notes = [linkedNote];
  history.replaceState(null, "", `/${hash}`);
  render(<CrewWorkspace />);
  const dialog = within(await screen.findByRole("dialog"));
  expect(dialog.getByLabelText("Title")).toHaveValue(title);
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
  await screen.findByRole("heading", { name: "Launch post" });
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
  expect(dialog.getByLabelText("Title")).toHaveValue("Voice guide");
});

it("never opens or reopens a dialog on a data refresh", async () => {
  fixtures.tasks = [linkedTask];
  render(<CrewWorkspace />);
  await screen.findByRole("heading", { name: "Launch post" });
  await openPage("Shared memory");
  fireEvent.click(
    screen.getByRole("button", { name: /NETWORK Voice and audiences/ }),
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
  await screen.findByRole("heading", { name: "Server title" });
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
  fireEvent.click(dialog.getByRole("tab", { name: "Preview" }));
  fireEvent.click(dialog.getByRole("button", { name: /Voice guide/ }));
  expect(location.hash).toBe("#/notes/voice-guide-note00000000001");
  expect(dialog.getByRole("tab", { name: "Preview" })).toBeInTheDocument();
  fireEvent.click(dialog.getByRole("tab", { name: "Edit" }));
  expect(dialog.getByLabelText("Title")).toHaveValue("Voice guide");
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
    dialog.queryByRole("button", { name: /Submit saved draft/ }),
  ).toBeNull();
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
  expect(dialog.getByLabelText("Note (Markdown)")).toBeDisabled();
  expect(dialog.queryByRole("button", { name: "Save note" })).toBeNull();
  fireEvent.click(dialog.getByRole("tab", { name: "History" }));
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
  expect(dialog.getByLabelText("Title")).toBeDisabled();
  expect(dialog.getByLabelText("Memory bucket")).toHaveValue(bucket.id);
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
