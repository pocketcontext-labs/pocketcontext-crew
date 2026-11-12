import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import LabelsInput from "./LabelsInput";

afterEach(cleanup);
function Harness({
  initial = [],
  onChange = () => {},
  disabled = false,
}: {
  initial?: string[];
  onChange?: (next: string[]) => void;
  disabled?: boolean;
}) {
  const [labels, setLabels] = useState(initial);
  return (
    <LabelsInput
      value={labels}
      disabled={disabled}
      suggestions={["Launch", "Legal", "Research"]}
      onChange={(next) => {
        setLabels(next);
        onChange(next);
      }}
    />
  );
}
const input = () => screen.getByRole("combobox", { name: "Labels" });

it("picks a suggestion with the arrow keys and Enter", () => {
  const changed = vi.fn();
  render(<Harness onChange={changed} />);
  fireEvent.change(input(), { target: { value: "l" } });
  fireEvent.keyDown(input(), { key: "ArrowDown" });
  fireEvent.keyDown(input(), { key: "ArrowDown" });
  expect(screen.getByRole("option", { name: "Legal" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  fireEvent.keyDown(input(), { key: "Enter" });
  expect(changed).toHaveBeenLastCalledWith(["Legal"]);
});

it("adds the typed label when focus leaves, but ignores whitespace", () => {
  const changed = vi.fn();
  render(<Harness onChange={changed} />);
  fireEvent.change(input(), { target: { value: "   " } });
  fireEvent.blur(input());
  expect(changed).not.toHaveBeenCalled();
  fireEvent.change(input(), { target: { value: " Draft " } });
  fireEvent.blur(input());
  expect(changed).toHaveBeenLastCalledWith(["Draft"]);
});

it("lets Tab move on from an empty input", () => {
  render(<Harness />);
  const tab = fireEvent.keyDown(input(), { key: "Tab" });
  // Not prevented: focus moves on as usual.
  expect(tab).toBe(true);
});

it("shows chips without remove buttons when disabled", () => {
  render(<Harness initial={["Launch"]} disabled />);
  expect(screen.getByText("Launch")).toHaveClass("crew-chip");
  expect(screen.queryByRole("button")).toBeNull();
  expect(input()).toBeDisabled();
});
