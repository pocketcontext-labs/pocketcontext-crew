import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CopyControl } from "./CopyFeedback";
import { MoreMenu } from "./DialogHeader";
import { setLanguage, t } from "./i18n";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setLanguage("en");
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
  render(<CopyControl copy={copy} label="Copy draft text" onResult={result} />);
  const button = screen.getByRole("button", { name: "Copy", description: "Copy draft text" });
  expect(button).toHaveAttribute("title", "Copy");
  expect(screen.getByText("Copy draft text")).not.toBeVisible();
  expect(button.querySelector(".crew-copy-labels")).toBeNull();
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

it.each([
  ["en", "Copy link"],
  ["de", "Link kopieren"],
  ["it", "Copia link"],
] as const)("shows the localized menu row and confirms copying on the trigger in %s", async (language, label) => {
  vi.useFakeTimers();
  setLanguage(language);
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const onResult = vi.fn();
  render(<MoreMenu items={[{
    label: t("Copy link"),
    icon: "copy",
    copy: { text: "synthetic link", onResult },
  }]} />);
  const trigger = screen.getByRole("button", { name: t("More actions") });
  fireEvent.click(trigger);
  const row = screen.getByRole("menuitem", { name: label });
  expect(screen.getByText(label)).toBeVisible();
  expect(row).not.toHaveClass("crew-copy-icon");
  expect(row.querySelector("svg")).toBeInTheDocument();
  await act(async () => { fireEvent.click(row); });
  expect(writeText).toHaveBeenCalledExactlyOnceWith("synthetic link");
  expect(onResult).toHaveBeenCalledExactlyOnceWith(true, "synthetic link");
  expect(screen.queryByRole("menu")).toBeNull();
  expect(trigger).toHaveFocus();
  const glyph = trigger.querySelector(".crew-copy-glyph");
  expect(glyph).toHaveAttribute("data-state", "copied");
  act(() => void vi.advanceTimersByTime(1300));
  expect(glyph).not.toHaveAttribute("data-state");
});
