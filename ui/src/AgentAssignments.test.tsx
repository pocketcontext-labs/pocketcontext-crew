import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import AgentAssignments from "./AgentAssignments";
import { crewApi } from "./crewApi";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("shows the latest saved step and allows an explicit choice only for available work", async () => {
  const task = {
    id: "ready0000000001",
    revision: 1,
    title: "Weekly summary",
    status: "todo",
    readiness: "ready",
  };
  vi.spyOn(crewApi, "read").mockResolvedValue([
    { ...task, last_saved_step: "Alberto chose the short version." },
    { ...task, id: "hold00000000001", title: "Calendar", readiness: "waiting" },
    {
      ...task,
      id: "busy00000000001",
      title: "Report",
      webhook_holder: "Build",
    },
  ]);
  const writes = vi.spyOn(crewApi, "write");
  render(<AgentAssignments agent={{ id: "build", revision: 2 }} />);
  expect(
    await screen.findByText("Alberto chose the short version."),
  ).toBeVisible();
  expect(screen.getByRole("link", { name: "Calendar" })).toBeVisible();
  expect(screen.getByText(/On hold/)).toBeVisible();
  expect(screen.getByText(/Claimed by Build/)).toBeVisible();
  expect(screen.getAllByRole("radio")).toHaveLength(1);
  fireEvent.click(screen.getByRole("radio", { name: "Choose Weekly summary" }));
  expect(screen.getByText(/I choose task ready0000000001/)).toBeVisible();
  expect(writes).not.toHaveBeenCalled();
});
