import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import UndoToast, { messageToastMs, undoToastMs } from "./UndoToast";
import { resetLanguageForTests, setLanguage } from "./i18n";

let reduce = false;
beforeEach(() => {
  reduce = false;
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query.includes("reduce"),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetLanguageForTests();
});

const archived = (
  props: Partial<Parameters<typeof UndoToast>[0]> = {},
  run = vi.fn(),
  dismiss = vi.fn(),
) => {
  const view = render(
    <UndoToast
      text="Task archived"
      action={{ label: "Undo", run }}
      dismiss={dismiss}
      {...props}
    />,
  );
  return { run, dismiss, ...view };
};

it("says what happened with one action and a dismiss control", () => {
  const { run, dismiss } = archived();
  const toast = screen.getByRole("status");
  expect(toast).toHaveAttribute("aria-live", "polite");
  expect(toast).toHaveClass("crew-undo-toast");
  expect(toast).toHaveTextContent("Task archived·Undo×");
  // The middle dot is decoration; the buttons are Undo, then Dismiss.
  expect(toast.querySelector(".crew-undo-toast-dot")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  expect(
    screen
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label") ?? b.textContent),
  ).toEqual(["Undo", "Dismiss"]);
  expect(screen.getByRole("button", { name: "Dismiss" })).toHaveAttribute(
    "title",
    "Dismiss",
  );
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(run).toHaveBeenCalledTimes(1);
  expect(dismiss).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(dismiss).toHaveBeenCalledTimes(1);
});

it("closes by itself after about 5 seconds, with a short fade", () => {
  const { dismiss } = archived();
  const toast = screen.getByRole("status");
  expect(undoToastMs).toBe(5000);
  act(() => void vi.advanceTimersByTime(4999));
  expect(toast).not.toHaveClass("crew-undo-toast-leaving");
  act(() => void vi.advanceTimersByTime(1));
  expect(toast).toHaveClass("crew-undo-toast-leaving");
  expect(dismiss).not.toHaveBeenCalled();
  act(() => void vi.advanceTimersByTime(200));
  expect(dismiss).toHaveBeenCalledTimes(1);
});

it("pauses while hovered or focused and resumes with the time left", () => {
  const { dismiss } = archived();
  const toast = screen.getByRole("status");
  act(() => void vi.advanceTimersByTime(3000));
  fireEvent.mouseEnter(toast);
  act(() => void vi.advanceTimersByTime(60_000));
  expect(toast).not.toHaveClass("crew-undo-toast-leaving");
  fireEvent.mouseLeave(toast);
  // Keyboard focus inside pauses too, until focus leaves the toast.
  act(() => screen.getByRole("button", { name: "Undo" }).focus());
  act(() => void vi.advanceTimersByTime(60_000));
  expect(toast).not.toHaveClass("crew-undo-toast-leaving");
  // Moving between its two buttons keeps it paused.
  act(() => screen.getByRole("button", { name: "Dismiss" }).focus());
  act(() => void vi.advanceTimersByTime(60_000));
  expect(toast).not.toHaveClass("crew-undo-toast-leaving");
  act(() => screen.getByRole("button", { name: "Dismiss" }).blur());
  act(() => void vi.advanceTimersByTime(1999));
  expect(toast).not.toHaveClass("crew-undo-toast-leaving");
  act(() => void vi.advanceTimersByTime(1));
  expect(toast).toHaveClass("crew-undo-toast-leaving");
  expect(dismiss).not.toHaveBeenCalled();
});

it("skips the fade with reduced motion but keeps the timeout", () => {
  reduce = true;
  const { dismiss } = archived();
  act(() => void vi.advanceTimersByTime(undoToastMs - 1));
  expect(dismiss).not.toHaveBeenCalled();
  act(() => void vi.advanceTimersByTime(1));
  expect(dismiss).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("status")).not.toHaveClass("crew-undo-toast-leaving");
});

it("waits while its action runs: the button is disabled and the countdown stops", () => {
  const { run, dismiss, rerender } = archived();
  act(() => void vi.advanceTimersByTime(4000));
  rerender(
    <UndoToast
      text="Task archived"
      action={{ label: "Undo", run }}
      busy
      dismiss={dismiss}
    />,
  );
  const undo = screen.getByRole("button", { name: "Undo" });
  expect(undo).toBeDisabled();
  fireEvent.click(undo);
  expect(run).not.toHaveBeenCalled();
  act(() => void vi.advanceTimersByTime(60_000));
  expect(screen.getByRole("status")).not.toHaveClass("crew-undo-toast-leaving");
  // Dismiss still works while it waits.
  expect(screen.getByRole("button", { name: "Dismiss" })).toBeEnabled();
  rerender(
    <UndoToast
      text="Task archived"
      action={{ label: "Undo", run }}
      dismiss={dismiss}
    />,
  );
  act(() => void vi.advanceTimersByTime(999));
  expect(screen.getByRole("status")).not.toHaveClass("crew-undo-toast-leaving");
  act(() => void vi.advanceTimersByTime(1));
  expect(screen.getByRole("status")).toHaveClass("crew-undo-toast-leaving");
});

it("carries its countdown on when it is mounted again in another place", () => {
  const left = { current: undoToastMs };
  const dismiss = vi.fn();
  const first = render(
    <UndoToast text="Task archived" left={left} dismiss={dismiss} />,
  );
  act(() => void vi.advanceTimersByTime(3000));
  first.unmount();
  expect(left.current).toBe(2000);
  // Time while it is not shown does not count.
  act(() => void vi.advanceTimersByTime(10_000));
  render(<UndoToast text="Task archived" left={left} dismiss={dismiss} />);
  act(() => void vi.advanceTimersByTime(1999));
  expect(screen.getByRole("status")).not.toHaveClass("crew-undo-toast-leaving");
  act(() => void vi.advanceTimersByTime(1));
  expect(screen.getByRole("status")).toHaveClass("crew-undo-toast-leaving");
  act(() => void vi.advanceTimersByTime(200));
  expect(dismiss).toHaveBeenCalledTimes(1);
});

it("reports a failure as an alert that stays long enough to read", () => {
  const dismiss = vi.fn();
  render(
    <UndoToast
      tone="alert"
      text="Couldn't archive the task. Try again."
      ms={messageToastMs}
      dismiss={dismiss}
    />,
  );
  const toast = screen.getByRole("alert");
  expect(toast).toHaveAttribute("aria-live", "assertive");
  expect(toast).toHaveClass("crew-undo-toast-alert");
  expect(toast).toHaveTextContent("Couldn't archive the task. Try again.");
  // No action: only the dismiss control, and no separator.
  expect(screen.getAllByRole("button")).toHaveLength(1);
  expect(toast.querySelector(".crew-undo-toast-dot")).toBeNull();
  expect(messageToastMs).toBeGreaterThan(undoToastMs);
  act(() => void vi.advanceTimersByTime(messageToastMs - 1));
  expect(toast).not.toHaveClass("crew-undo-toast-leaving");
  act(() => void vi.advanceTimersByTime(1));
  expect(toast).toHaveClass("crew-undo-toast-leaving");
});

it("names its dismiss control in the reader's language", () => {
  setLanguage("de");
  archived();
  expect(screen.getByRole("button", { name: "Ausblenden" })).toHaveAttribute(
    "title",
    "Ausblenden",
  );
  cleanup();
  setLanguage("it");
  archived();
  expect(screen.getByRole("button", { name: "Chiudi" })).toBeInTheDocument();
});
