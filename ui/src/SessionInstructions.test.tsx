import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AgentSession } from "./crewApi";
import SessionInstructions from "./SessionInstructions";

const session: AgentSession = {
  agent: { id: "agent0000000001", name: "synthetic-repo", kind: "external" },
  prompt: "Synthetic prompt",
  instructions: "Synthetic body",
  lease_hours: 2,
  body: "Synthetic body",
  revision: 0,
  is_default: true,
  edited_by: "",
  edited_at: "",
  rewrite_prompt: "Rewrite synthetic (revision 0).",
};
const Markdown = ({ children }: { children: string }) => <div>{children}</div>;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "clipboard");
});

// The copied label belongs to the revision it was copied at. It used to be
// reset by a mount effect, which on slow runners could run after the click
// and swallow the copied state.
it("keeps the copied rewrite prompt for its revision and clears it on a new one", async () => {
  const writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  const props = { onChange: () => undefined, Markdown };
  const { rerender } = render(<SessionInstructions session={session} {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Rewrite with an agent" }));
  await screen.findByRole("button", { name: "Rewrite prompt copied" });
  expect(writeText).toHaveBeenCalledWith(session.rewrite_prompt);
  // A refetch of the same revision keeps it.
  rerender(<SessionInstructions session={{ ...session }} {...props} />);
  expect(screen.getByRole("button", { name: "Rewrite prompt copied" })).toBeInTheDocument();
  // A new revision means a new prompt: copy again.
  rerender(<SessionInstructions session={{ ...session, revision: 1 }} {...props} />);
  expect(screen.getByRole("button", { name: "Rewrite with an agent" })).toBeInTheDocument();
});

// 0.27.2: Read, Edit and History are one fixed control (the pressed view
// changes, the buttons never), and an unsaved edit survives a look at History.
it("keeps the same view buttons in every view and the draft across views", async () => {
  const { crewApi } = await import("./crewApi");
  vi.spyOn(crewApi, "read").mockResolvedValue([]);
  render(<SessionInstructions session={session} onChange={() => undefined} Markdown={Markdown} />);
  const views = screen.getByRole("group", { name: "View" });
  const names = () =>
    [...views.querySelectorAll("button")].map((b) => [b.textContent, b.getAttribute("aria-pressed")]);
  expect(names()).toEqual([["Read", "true"], ["Edit", "false"], ["History", "false"]]);
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  expect(names()).toEqual([["Read", "false"], ["Edit", "true"], ["History", "false"]]);
  fireEvent.change(screen.getByLabelText(/Session instructions/), { target: { value: "Draft" } });
  fireEvent.click(screen.getByRole("button", { name: "History" }));
  await screen.findByText("No saved revisions yet: these are the built-in instructions.");
  expect(names()).toEqual([["Read", "false"], ["Edit", "false"], ["History", "true"]]);
  expect(screen.getByRole("button", { name: "Restore default" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  expect(screen.getByLabelText(/Session instructions/)).toHaveValue("Draft");
  // Cancel drops the draft; the next Edit starts from the saved text.
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  expect(screen.getByLabelText(/Session instructions/)).toHaveValue("Synthetic body");
});
