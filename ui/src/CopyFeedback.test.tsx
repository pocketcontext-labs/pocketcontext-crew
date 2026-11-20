import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CopyControl } from "./CopyFeedback";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("holds the check for the latest successful tap and ignores an older result", async () => {
  vi.useFakeTimers();
  let finishFirst!: (ok: boolean) => void;
  const copy = vi
    .fn(() => Promise.resolve(true))
    .mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finishFirst = resolve;
        }),
    );
  const result = vi.fn();
  render(<CopyControl copy={copy} label="Copy" onResult={result} />);
  const button = screen.getByRole("button", { name: "Copy" });
  fireEvent.click(button);
  await act(async () => { fireEvent.click(button); });
  await act(async () => finishFirst(false));
  expect(result.mock.calls).toEqual([[true]]);
  expect(button).toHaveAttribute("data-state", "copied");
  act(() => void vi.advanceTimersByTime(900));
  await act(async () => { fireEvent.click(button); });
  act(() => void vi.advanceTimersByTime(1200));
  expect(button).toHaveAttribute("data-state", "copied");
  act(() => void vi.advanceTimersByTime(100));
  expect(button).not.toHaveAttribute("data-state");
});
