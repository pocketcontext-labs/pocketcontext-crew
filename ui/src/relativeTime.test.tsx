import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RelativeTime,
  formatDuration,
  formatExact,
  formatRelative,
  parseInstant,
} from "./relativeTime";

const now = new Date("2026-11-18T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
const MIN = 60_000;
const H = 60 * MIN;
const D = 24 * H;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("relative dates", () => {
  it("parses PocketBase and RFC 3339 instants", () => {
    expect(parseInstant("2026-11-17 08:19:48.969Z")?.toISOString()).toBe(
      "2026-11-17T08:19:48.969Z",
    );
    expect(parseInstant("2026-11-17T08:19:48Z")?.getTime()).toBe(
      Date.UTC(2026, 10, 17, 8, 19, 48),
    );
    expect(parseInstant("")).toBeNull();
    expect(parseInstant("nope")).toBeNull();
  });

  it("follows the rule from just now to a short date", () => {
    expect(formatRelative(ago(20_000), now)).toBe("just now");
    expect(formatRelative(ago(5 * MIN), now)).toBe("5 min ago");
    expect(formatRelative(ago(19 * H), now)).toBe("19 h ago");
    expect(formatRelative(ago(30 * H), now)).toBe("yesterday");
    expect(formatRelative(ago(2 * D + H), now)).toBe("2 days ago");
    expect(formatRelative(ago(7 * D + H), now)).toBe("7 days ago");
    expect(formatRelative(ago(8 * D), now)).toMatch(/Nov 10/);
    expect(formatRelative(ago(8 * D), now)).not.toMatch(/2026/);
    expect(formatRelative(new Date("2025-11-10T12:00:00Z"), now)).toMatch(
      /2025/,
    );
  });

  it("describes future instants and durations", () => {
    expect(formatRelative(new Date(now.getTime() + 10 * MIN), now)).toBe(
      "in 10 min",
    );
    expect(formatRelative(new Date(now.getTime() + 2 * H), now)).toBe("in 2 h");
    // A fresh server time a few seconds ahead of the browser is still "just now".
    expect(formatRelative(new Date(now.getTime() + 3_000), now)).toBe("just now");
    expect(formatDuration(105 * MIN)).toBe("1 h 45 m");
    expect(formatDuration(30_000)).toBe("1 min");
    expect(formatDuration(3 * D)).toBe("3 days");
  });

  it("renders <time> with the exact time in title and refreshes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    render(<RelativeTime value={now.toISOString()} prefix="Updated " />);
    const el = screen.getByText("Updated just now");
    expect(el.tagName).toBe("TIME");
    expect(el.getAttribute("datetime")).toBe(now.toISOString());
    expect(el.getAttribute("title")).toBe(formatExact(now));
    act(() => {
      vi.advanceTimersByTime(90_000);
    });
    expect(screen.getByText("Updated 1 min ago")).toBeTruthy();
  });

  it("shows the fallback for a missing value", () => {
    render(<RelativeTime value="" fallback="never" />);
    expect(screen.getByText("never")).toBeTruthy();
  });
});
