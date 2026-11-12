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
import { attachmentsApi } from "./attachmentsApi";
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
});
afterEach(() => {
  cleanup();
  history.replaceState(null, "", "/");
  vi.restoreAllMocks();
});
/** Opens the board's Filters panel (if closed) and returns it. */
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
  expect(screen.getByRole("button", { name: "Copy address" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Copy link" })).toBeNull();
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
  expect(location.hash).toBe("#/tasks");
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
  expect(listener).not.toHaveBeenCalled();
  await openPage("Notes");
  listener.mockClear(); // The sidebar link is a real navigation.
  fireEvent.click(screen.getByRole("button", { name: /Voice guide/ }));
  expect(location.hash).toBe("#/notes/voice-guide-note00000000001");
  fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
  fireEvent.click(screen.getByRole("button", { name: /New note/ }));
  expect(location.hash).toBe("#/notes");
  expect(listener).not.toHaveBeenCalled();
  window.removeEventListener("hashchange", listener);
});

it("updates the address when a linked note opens from a note's related notes", async () => {
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
    expect(location.hash).toBe(`#/notes?bucket=${bucket.id}&sort=title`);
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
    expect(location.hash).toBe(`#/tasks?agent=${design.id}`);
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

  it("Home's status tiles open the whole board on their column", async () => {
    await openBoard(`#/tasks?agent=${agent.id}`);
    await openPage("Home");
    const tile = screen.getByRole("link", {
      name: "3 To do, show on the Tasks board",
    });
    expect(tile).toHaveAttribute("href", "#/tasks?status=todo&column=todo");
    expect(tile).toHaveTextContent("3To do");
    fireEvent.click(tile);
    await waitFor(() => expect(filter()).toHaveValue("all"));
    expect(cardTitles()).toHaveLength(3);
    expect(document.querySelectorAll(".crew-column")).toHaveLength(4);
  });
});

describe("Home tiles focus a board column", () => {
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

  it("links each tile to its column, named for where it goes", async () => {
    history.replaceState(null, "", "/#/");
    render(<CrewWorkspace />);
    await screen.findByRole("heading", { name: "Your crew right now" });
    const tiles = [
      ["1 To do", "todo"],
      ["0 In progress", "in_progress"],
      ["0 Needs review", "needs_review"],
      ["1 Done", "done"],
    ];
    for (const [name, status] of tiles)
      await waitFor(() =>
        expect(
          screen.getByRole("link", { name: `${name}, show on the Tasks board` }),
        ).toHaveAttribute("href", `#/tasks?status=${status}&column=${status}`),
      );
  });

  it("scrolls to, focuses and briefly highlights the column, then drops it from the address", async () => {
    history.replaceState(null, "", "/#/");
    render(<CrewWorkspace />);
    await screen.findByRole("heading", { name: "Your crew right now" });
    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: /^1 Done, show on/ }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("link", { name: /^1 Done, show on/ }));
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
  it("counts tasks on hold over 3 days on Home and opens the board filtered to them", async () => {
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
    const tile = await screen.findByRole("link", {
      name: "1 on hold over 3 days, show tasks on hold",
    });
    expect(tile).toHaveAttribute("href", "#/tasks?hold=on_hold&held_over=3d");
    fireEvent.click(tile);
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
  it("starts a new agent manually when no webhook is set up, and saves its kind", async () => {
    const dialog = await openNewAgent();
    const group = within(dialog.getByRole("group", { name: /How is it started/ }));
    await waitFor(() =>
      expect(
        group.getByRole("radio", { name: "I start it myself (no webhook)" }),
      ).toBeChecked(),
    );
    expect(
      group.getByText(
        "Name it after the project, e.g. pocketcontext-crew. Start sessions from its card.",
      ),
    ).toBeInTheDocument();
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
  it("defaults to a webhook bot once the integration is set up, and offers Person", async () => {
    fixtures.webhook_configs = [
      { id: "integration", revision: 1, scope: "global", url_configured: true },
    ];
    const dialog = await openNewAgent();
    await waitFor(() =>
      expect(crewApi.read).toHaveBeenCalledWith("webhook_configs"),
    );
    const group = within(dialog.getByRole("group", { name: /How is it started/ }));
    expect(group.getByRole("radio", { name: "Webhook (bot)" })).toBeChecked();
    expect(group.queryByText(/Name it after the project/)).toBeNull();
    fireEvent.click(group.getByRole("radio", { name: "Person" }));
    fireEvent.change(dialog.getByLabelText("Name"), {
      target: { value: "Editor" },
    });
    fireEvent.click(dialog.getByRole("button", { name: "Save agent" }));
    await waitFor(() =>
      expect(crewApi.write).toHaveBeenCalledWith(
        "agent.create",
        expect.objectContaining({ name: "Editor", kind: "human" }),
        undefined,
        "",
      ),
    );
  });
  it("keeps the owner's choice when the webhook setup arrives later", async () => {
    let answer: (rows: Row[]) => void = () => undefined;
    vi.mocked(crewApi.read).mockImplementation((c, f = {}) =>
      c === "webhook_configs"
        ? new Promise((resolve) => (answer = resolve))
        : Promise.resolve(f.archived ? [] : fixtures[c] || []),
    );
    const dialog = await openNewAgent();
    const group = within(dialog.getByRole("group", { name: /How is it started/ }));
    fireEvent.click(group.getByRole("radio", { name: "Webhook (bot)" }));
    await act(async () => answer([]));
    expect(group.getByRole("radio", { name: "Webhook (bot)" })).toBeChecked();
  });
  it("changes an existing agent's kind and sends kind only when it changed", async () => {
    history.replaceState(null, "", "/#/agents");
    render(<CrewWorkspace />);
    fireEvent.click(
      (await screen.findByRole("heading", { name: "Network" })).closest("button")!,
    );
    let dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByRole("radio", { name: "Webhook (bot)" })).toBeChecked();
    fireEvent.change(dialog.getByLabelText("Agent brief"), {
      target: { value: "New brief" },
    });
    fireEvent.click(dialog.getByRole("button", { name: "Save agent" }));
    await waitFor(() =>
      expect(crewApi.write).toHaveBeenLastCalledWith(
        "agent.update",
        { name: "Network", brief: "New brief" },
        expect.objectContaining({ id: agent.id }),
        "",
      ),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(
      screen.getByRole("heading", { name: "Network" }).closest("button")!,
    );
    dialog = within(screen.getByRole("dialog"));
    fireEvent.click(
      dialog.getByRole("radio", { name: "I start it myself (no webhook)" }),
    );
    fireEvent.click(dialog.getByRole("button", { name: "Save agent" }));
    await waitFor(() =>
      expect(crewApi.write).toHaveBeenLastCalledWith(
        "agent.update",
        expect.objectContaining({ kind: "external" }),
        expect.objectContaining({ id: agent.id }),
        "",
      ),
    );
  });
  it("labels manual and person cards, leaves bot cards as they were and offers sessions only to manual agents", async () => {
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
      manual.getByRole("button", { name: "Start a session for synthetic-repo" }),
    ).toBeInTheDocument();
    const human = await tile("Reviewer");
    expect(human.getByText("Person")).toBeInTheDocument();
    expect(human.queryByRole("button", { name: /Start a session/ })).toBeNull();
    const bot = await tile("Network");
    expect(bot.queryByText(/Started manually|Person/)).toBeNull();
    expect(bot.queryByRole("button", { name: /Start a session/ })).toBeNull();
    expect(
      screen
        .getByRole("heading", { name: "Network" })
        .closest(".crew-agent-tile")!
        .querySelector(".crew-agent-kind"),
    ).toBeNull();
  });
  it("Start a session copies the prompt and can show the full instructions", async () => {
    const session$ = vi.spyOn(crewApi, "session").mockResolvedValue(session);
    const writeText = mockClipboard(async () => undefined);
    history.replaceState(null, "", "/#/agents");
    render(<CrewWorkspace />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Start a session for synthetic-repo",
      }),
    );
    expect(
      await screen.findByText(
        "Copied. Paste it into a new Codex or Claude Code session.",
      ),
    ).toBeInTheDocument();
    expect(session$).toHaveBeenCalledWith(project.id);
    expect(writeText).toHaveBeenCalledWith(session.prompt);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Show full instructions" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Session instructions for synthetic-repo",
    });
    // The instructions open in their own dialog, not inside the agent card.
    expect(within(dialog).getByText("one").tagName).toBe("STRONG");
    expect(
      screen.getByText("one").closest(".crew-agent-tile"),
    ).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Copy prompt" }));
    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: "Prompt copied" }))
        .toBeInTheDocument(),
    );
    expect(writeText).toHaveBeenLastCalledWith(session.prompt);
    fireEvent.click(within(dialog).getByRole("button", { name: "Close dialog" }));
    expect(screen.queryByRole("dialog")).toBeNull();
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
      await screen.findByRole("button", { name: "Start a session for synthetic-repo" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Show full instructions" }));
    const dialog = within(
      await screen.findByRole("dialog", { name: "Session instructions for synthetic-repo" }),
    );
    dialog.getByText(
      "These instructions are saved in Crew, not in the code. Edit them by hand, or ask an agent to rewrite them.",
    );
    dialog.getByText("Built-in default · not edited yet");
    expect(dialog.getByRole("button", { name: "Restore default" })).toBeDisabled();
    // The recommended path copies a prompt for an agent conversation.
    fireEvent.click(dialog.getByRole("button", { name: "Rewrite with an agent" }));
    await dialog.findByRole("button", { name: "Rewrite prompt copied" });
    expect(writeText).toHaveBeenLastCalledWith(session.rewrite_prompt);
    // Edit by hand: Save sends the revision shown.
    fireEvent.click(dialog.getByRole("button", { name: "Edit" }));
    const field = dialog.getByLabelText(/Session instructions/);
    expect(field).toHaveValue(session.body);
    fireEvent.change(field, { target: { value: edited.body } });
    fireEvent.click(dialog.getByRole("button", { name: "Save" }));
    await dialog.findByText(/^Revision 1 · edited by owner, /);
    expect(update).toHaveBeenLastCalledWith(
      project.id,
      0,
      { instructions: edited.body },
      "Edited by hand",
    );
    expect(dialog.getByText("edited").tagName).toBe("STRONG");
    expect(dialog.getByRole("button", { name: "Restore default" })).toBeEnabled();
    // History lists revisions; the current one has no Restore.
    fireEvent.click(dialog.getByRole("button", { name: "History" }));
    await dialog.findByText(/^Revision 1 · owner · .* · current$/);
    expect(dialog.queryByRole("button", { name: "Restore revision 1" })).toBeNull();
    // Restore default writes a new revision against the current one.
    fireEvent.click(dialog.getByRole("button", { name: "Restore default" }));
    await dialog.findByText(/^Revision 2 · edited by owner, .* · built-in default$/);
    expect(update).toHaveBeenLastCalledWith(
      project.id,
      1,
      { restore_default: true },
      "Restore default",
    );
    // Copy prompt copies the session prompt of the latest revision.
    fireEvent.click(dialog.getByRole("button", { name: "Copy prompt" }));
    await dialog.findByRole("button", { name: "Prompt copied" });
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
      await screen.findByRole("button", { name: "Start a session for synthetic-repo" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Show full instructions" }));
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
        name: "Start a session for synthetic-repo",
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
        name: "Start a session for synthetic-repo",
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not prepare the session prompt. Check your connection and try again.",
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
      expect(dialog.getByText(/^Session · /)).toBeInTheDocument();
      expect(dialog.queryByRole("button", { name: /^Claim/ })).toBeNull();
      fireEvent.click(dialog.getByRole("button", { name: "Release claim" }));
      expect(confirm).toHaveBeenCalledWith(
        "A session is working on this. Release its claim?",
      );
      expect(crewApi.write).not.toHaveBeenCalled();
      confirm.mockReturnValue(true);
      fireEvent.click(dialog.getByRole("button", { name: "Release claim" }));
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
      expect(dialog.getByText(/^Claim expired/)).toBeInTheDocument();
      fireEvent.click(dialog.getByRole("button", { name: "Release claim" }));
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
      expect(dialog.queryByRole("button", { name: "Release claim" })).toBeNull();
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
describe("releases and Won't do on the board", () => {
  const days = (n: number) =>
    new Date(Date.now() - n * 86_400_000).toISOString().replace("T", " ");
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
    fixtures.reviews = [];
    fixtures.tasks = [
      { ...task, id: "task00000000001", title: "Planned", status: "todo", release: "" },
      closed("task00000000002", "Shipped first", { release: "0.18.0", updated: days(2) }),
      closed("task00000000003", "Shipped next", { release: "0.19.0" }),
      closed("task00000000004", "Dropped idea", { status: "wont_do", release: "" }),
      closed("task00000000005", "Ancient work", { release: "0.9.0", updated: days(30) }),
      closed("task00000000006", "Also next", {
        release: "0.19.0",
        updated: days(3),
      }),
    ];
  });
  const doneColumn = () =>
    within(screen.getByRole("region", { name: /^Done/ }));
  const groups = () =>
    doneColumn()
      .queryAllByRole("group")
      .map((g) => [
        g.getAttribute("aria-label"),
        [...g.querySelectorAll(".crew-task-card h3")].map((x) => x.textContent),
      ]);
  const cardTitles = () =>
    [...document.querySelectorAll(".crew-task-card h3")].map((x) => x.textContent);

  it("keeps four columns and groups recent closed tasks by release, newest first", async () => {
    render(<CrewWorkspace />);
    await screen.findByRole("heading", { name: "Planned" });
    expect(document.querySelectorAll(".crew-column")).toHaveLength(4);
    expect(groups()).toEqual([
      ["0.19.0", ["Shipped next", "Also next"]],
      ["0.18.0", ["Shipped first"]],
      ["No release", ["Dropped idea"]],
    ]);
    const dropped = screen.getByRole("button", { name: /Dropped idea/ });
    expect(within(dropped).getByText("Won't do")).toBeInTheDocument();
    expect(within(dropped).queryByText(/On hold|Ready/)).toBeNull();
    expect(
      within(screen.getByRole("button", { name: /Shipped next/ })).getByText(
        "Shipped in 0.19.0",
      ),
    ).toBeInTheDocument();
    // Older closed tasks fold away behind one button.
    expect(screen.queryByRole("heading", { name: "Ancient work" })).toBeNull();
    fireEvent.click(doneColumn().getByRole("button", { name: "Show older (1)" }));
    expect(groups().map(([release]) => release)).toEqual([
      "0.19.0",
      "0.18.0",
      "0.9.0",
      "No release",
    ]);
    expect(doneColumn().queryByRole("button", { name: /Show older/ })).toBeNull();
  });

  it("filters by release in the address and shows that release's older tasks", async () => {
    render(<CrewWorkspace />);
    await screen.findByRole("heading", { name: "Planned" });
    // No release dropdown on the toolbar: release lives in the Filters panel.
    expect(screen.queryByRole("combobox", { name: "Filter by release" })).toBeNull();
    const filter = openFilters().getByRole("combobox", { name: "Filter by release" });
    expect(within(filter).getAllByRole("option").map((x) => x.textContent)).toEqual([
      "All releases",
      "0.19.0",
      "0.18.0",
      "0.9.0",
      "No release",
    ]);
    fireEvent.change(filter, { target: { value: "0.9.0" } });
    expect(cardTitles()).toEqual(["Ancient work"]);
    expect(location.hash).toBe("#/tasks?release=0.9.0");
    expect(screen.getByRole("button", { name: "Remove filter Release 0.9.0" })).toBeInTheDocument();
    fireEvent.change(filter, { target: { value: "none" } });
    expect(cardTitles()).toEqual(["Planned", "Dropped idea"]);
    expect(location.hash).toBe("#/tasks?release=none");
    expect(screen.getByRole("button", { name: "Remove filter No release" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(filter).toHaveValue("");
    expect(location.hash).toBe("#/tasks");
  });

  it("restores the release filter from the address", async () => {
    history.replaceState(null, "", "/#/tasks?release=0.18.0");
    render(<CrewWorkspace />);
    await screen.findByRole("heading", { name: "Shipped first" });
    expect(screen.getByRole("button", { name: "Filters · 1" })).toBeInTheDocument();
    expect(openFilters().getByRole("combobox", { name: "Filter by release" })).toHaveValue(
      "0.18.0",
    );
    expect(cardTitles()).toEqual(["Shipped first"]);
  });

  it("filters to a release from its Done column header", async () => {
    render(<CrewWorkspace />);
    await screen.findByRole("heading", { name: "Planned" });
    fireEvent.click(doneColumn().getByRole("button", { name: "Show only release 0.19.0" }));
    expect(location.hash).toBe("#/tasks?release=0.19.0");
    expect(cardTitles()).toEqual(["Shipped next", "Also next"]);
    expect(doneColumn().getByRole("button", { name: "Show only release 0.19.0" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove filter Release 0.19.0" }));
    expect(location.hash).toBe("#/tasks");
    fireEvent.click(doneColumn().getByRole("button", { name: "Show only tasks without a release" }));
    expect(location.hash).toBe("#/tasks?release=none");
    expect(cardTitles()).toEqual(["Planned", "Dropped idea"]);
  });

  it("reads release:, status: and label: from the search like the filters, and Enter makes them chips", async () => {
    render(<CrewWorkspace />);
    await screen.findByRole("heading", { name: "Planned" });
    const search = screen.getByRole("searchbox", { name: "Search tasks" });
    fireEvent.change(search, { target: { value: "release:0.9.0" } });
    expect(cardTitles()).toEqual(["Ancient work"]);
    // The address only holds committed filters.
    expect(location.hash).toBe("#/tasks");
    fireEvent.change(search, { target: { value: "release:0.19.0 also" } });
    expect(cardTitles()).toEqual(["Also next"]);
    fireEvent.change(search, { target: { value: "status:wont-do" } });
    expect(cardTitles()).toEqual(["Dropped idea"]);
    // A key still being typed filters nothing.
    fireEvent.change(search, { target: { value: "release:" } });
    expect(cardTitles()).toHaveLength(5);
    fireEvent.change(search, { target: { value: "release:0.19.0 next" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(search).toHaveValue("next");
    expect(location.hash).toBe("#/tasks?release=0.19.0");
    expect(screen.getByRole("button", { name: "Remove filter Release 0.19.0" })).toBeInTheDocument();
    expect(cardTitles()).toEqual(["Shipped next", "Also next"]);
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(search).toHaveValue("");
    expect(location.hash).toBe("#/tasks");
    expect(screen.queryByRole("button", { name: "Clear all" })).toBeNull();
  });

  it("counts Done only on its Home tile, and Won't do never breaks the counts", async () => {
    history.replaceState(null, "", "/#/");
    render(<CrewWorkspace />);
    const tile = await screen.findByRole("link", {
      name: "4 Done, show on the Tasks board",
    });
    expect(tile).toHaveAttribute("href", "#/tasks?status=done&column=done");
    expect(screen.queryByRole("link", { name: /Won't do, show/ })).toBeNull();
    expect(
      screen.getByRole("link", { name: "1 To do, show on the Tasks board" }),
    ).toBeInTheDocument();
  });

  it("offers Won't do, edits the release and shows an in-session approval", async () => {
    fixtures.tasks = [
      closed("task00000000003", "Shipped next", {
        release: "0.19.0",
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
    const status = dialog.getByRole("combobox", { name: "Status" });
    expect(within(status).getByRole("option", { name: "Won't do" })).toBeInTheDocument();
    const release = dialog.getByRole("textbox", { name: "Release" });
    expect(release).toHaveValue("0.19.0");
    fireEvent.change(release, { target: { value: " 0.19.1 " } });
    fireEvent.change(status, { target: { value: "wont_do" } });
    fireEvent.click(dialog.getByRole("button", { name: "Save task" }));
    await waitFor(() =>
      expect(crewApi.write).toHaveBeenCalledWith(
        "task.update",
        expect.objectContaining({ release: "0.19.1", status: "wont_do" }),
        expect.objectContaining({ id: "task00000000003" }),
        "",
      ),
    );
  });

  it("shows no approval line for a task approved through Crew", async () => {
    fixtures.tasks = [closed("task00000000003", "Shipped next", { review_mode: "" })];
    render(<CrewWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: /Shipped next/ }));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.queryByText(/Approved in session/)).toBeNull();
    expect(dialog.getByRole("textbox", { name: "Release" })).toHaveValue("");
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
