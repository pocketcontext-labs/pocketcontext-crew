import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SessionToast, toastMs, type SessionStart } from "./StartSession";

const copied: SessionStart = {
  name: "synthetic-repo",
  prompt: "Two lines.",
  state: "copied",
  session: new Promise(() => undefined),
};

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
});

it("closes a confirmation after 6 seconds with a countdown bar and a fade", () => {
  const dismiss = vi.fn();
  render(
    <SessionToast start={copied} view={() => undefined} dismiss={dismiss} />,
  );
  const toast = screen.getByRole("status");
  expect(toast).toHaveAttribute("aria-live", "polite");
  const bar = toast.querySelector(".crew-toast-countdown") as HTMLElement;
  expect(bar.style.animationDuration).toBe(`${toastMs}ms`);
  expect(toastMs).toBe(6000);
  act(() => void vi.advanceTimersByTime(5999));
  expect(toast).not.toHaveClass("crew-toast-leaving");
  act(() => void vi.advanceTimersByTime(1));
  expect(toast).toHaveClass("crew-toast-leaving");
  expect(dismiss).not.toHaveBeenCalled();
  act(() => void vi.advanceTimersByTime(200));
  expect(dismiss).toHaveBeenCalledTimes(1);
});

it("pauses on hover and focus and resumes with the time left", () => {
  const dismiss = vi.fn();
  render(
    <SessionToast start={copied} view={() => undefined} dismiss={dismiss} />,
  );
  const toast = screen.getByRole("status");
  act(() => void vi.advanceTimersByTime(4000));
  fireEvent.mouseEnter(toast);
  expect(toast).toHaveClass("crew-toast-paused");
  act(() => void vi.advanceTimersByTime(60_000));
  expect(toast).not.toHaveClass("crew-toast-leaving");
  fireEvent.mouseLeave(toast);
  // Focus inside pauses too, until focus leaves the toast.
  act(() => screen.getByRole("button", { name: "View" }).focus());
  act(() => void vi.advanceTimersByTime(60_000));
  expect(toast).not.toHaveClass("crew-toast-leaving");
  act(() => screen.getByRole("button", { name: "View" }).blur());
  act(() => void vi.advanceTimersByTime(1999));
  expect(toast).not.toHaveClass("crew-toast-leaving");
  act(() => void vi.advanceTimersByTime(1));
  expect(toast).toHaveClass("crew-toast-leaving");
});

it("dismisses at once from the × icon, which is named and has a tooltip", () => {
  const dismiss = vi.fn();
  render(
    <SessionToast start={copied} view={() => undefined} dismiss={dismiss} />,
  );
  const close = screen.getByRole("button", { name: "Dismiss" });
  expect(close).toHaveAttribute("title", "Dismiss");
  expect(close).toHaveTextContent("×");
  fireEvent.click(close);
  expect(dismiss).toHaveBeenCalledTimes(1);
  // View stays the only text button.
  expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
    "×",
    "View",
  ]);
});

it("skips the fade with reduced motion but keeps the timeout", () => {
  reduce = true;
  const dismiss = vi.fn();
  render(
    <SessionToast start={copied} view={() => undefined} dismiss={dismiss} />,
  );
  act(() => void vi.advanceTimersByTime(toastMs));
  expect(dismiss).toHaveBeenCalledTimes(1);
});

it("never auto-hides a toast that needs action", () => {
  const dismiss = vi.fn();
  render(
    <SessionToast
      start={{ name: "synthetic-repo", prompt: "", state: "failed" }}
      view={() => undefined}
      dismiss={dismiss}
    />,
  );
  const toast = screen.getByRole("alert");
  expect(toast.querySelector(".crew-toast-countdown")).toBeNull();
  act(() => void vi.advanceTimersByTime(60_000));
  expect(dismiss).not.toHaveBeenCalled();
});
