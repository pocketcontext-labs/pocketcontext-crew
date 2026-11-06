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
  vi.restoreAllMocks();
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
  fireEvent.click(screen.getByRole("button", { name: /Human approvals/ }));
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
  fireEvent.click(screen.getByRole("button", { name: "Archive" }));
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
  fireEvent.click(screen.getByRole("button", { name: /Human approvals/ }));
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
  fireEvent.click(screen.getByRole("button", { name: /Human approvals/ }));
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
