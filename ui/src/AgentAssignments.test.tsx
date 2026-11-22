import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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

it("groups current claims by exact session and returns expired leases to the remaining assignments", async () => {
  const task = { revision: 1, status: "todo", readiness: "ready", claim_state: "live" };
  const first = "Implement · iMac · session-a";
  const second = "Implement · iMac · session-b";
  vi.spyOn(crewApi, "read").mockResolvedValue([
    { ...task, id: "one", title: "First", claimed_by: first },
    { ...task, id: "two", title: "Second", claimed_by: second },
    { ...task, id: "three", title: "Third", claimed_by: first },
    { ...task, id: "four", title: "Expired", claimed_by: second, claim_until: "2000-01-01T00:00:00Z" },
  ]);
  render(<AgentAssignments agent={{ id: "implement", revision: 1 }} />);
  const group = (heading: HTMLElement) => within(heading.closest("section")!);
  const firstGroup = group(await screen.findByRole("heading", { name: "Claimed by " + first }));
  expect(firstGroup.getAllByRole("link").map(link => link.textContent)).toEqual(["First", "Third"]);
  const secondGroup = group(screen.getByRole("heading", { name: "Claimed by " + second }));
  expect(secondGroup.getAllByRole("link")).toHaveLength(1);
  expect(secondGroup.getByRole("link", { name: "Second" })).toBeVisible();
  expect(screen.getByRole("radio", { name: "Choose Expired" })).toBeVisible();
});
