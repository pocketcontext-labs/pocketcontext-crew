// One shared formatter for every date the reader shows (Crew 0.33.0).
//
// Visible text is relative ("just now", "5 min ago", "3 h ago", "yesterday",
// "4 days ago") up to 7 days, then a short date ("Nov 10", "Nov 10, 2025" in
// another year), in the user's locale and timezone. The exact local date and
// time is in the title (hover, long-press) and the instant in <time datetime>.
// Mounted <RelativeTime> elements share one minute ticker.
import { useEffect, useState } from "react";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export type Instant = string | number | Date | null | undefined;

/** Parses PocketBase ("2026-11-17 08:19:48.969Z"), RFC 3339, ms or Date. */
export function parseInstant(raw: Instant): Date | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const date =
    raw instanceof Date
      ? raw
      : typeof raw === "number"
        ? new Date(raw)
        : new Date(
            String(raw)
              .trim()
              .replace(/^(\d{4}-\d{2}-\d{2}) /, "$1T"),
          );
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Short date: "Nov 10", with the year when it differs from now's. */
export function formatShortDate(date: Date, now: Date = new Date()): string {
  const options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
  };
  if (date.getFullYear() !== now.getFullYear()) options.year = "numeric";
  return date.toLocaleDateString(undefined, options);
}

/** Exact local date and time, e.g. "Nov 17, 2026, 9:10 AM". */
export function formatExact(raw: Instant): string {
  const date = parseInstant(raw);
  if (!date) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** A span of time: "45 min", "1 h 45 m", "3 days". */
export function formatDuration(ms: number): string {
  const abs = Math.max(0, Math.abs(ms));
  if (abs < HOUR) return `${Math.max(1, Math.floor(abs / MINUTE))} min`;
  if (abs < DAY) {
    const h = Math.floor(abs / HOUR);
    const m = Math.floor((abs % HOUR) / MINUTE);
    return m ? `${h} h ${m} m` : `${h} h`;
  }
  const d = Math.floor(abs / DAY);
  return `${d} ${d === 1 ? "day" : "days"}`;
}

/**
 * Relative text for an instant. Past: "just now", "N min ago", "N h ago",
 * "yesterday", "N days ago" (to 7 days), then a short date. Future: "just
 * now" (under a minute, for clock skew), "in N min", "in N h", "tomorrow", "in N days", then a short date.
 */
export function formatRelative(raw: Instant, now: Date = new Date()): string {
  const date = parseInstant(raw);
  if (!date) return "";
  const diff = now.getTime() - date.getTime();
  const abs = Math.abs(diff);
  const past = diff >= 0;
  // Under a minute either way is "just now": a record saved this moment can
  // carry a server time a few seconds ahead of the browser's clock.
  if (abs < MINUTE) return "just now";
  if (abs < HOUR) {
    const n = Math.floor(abs / MINUTE);
    return past ? `${n} min ago` : `in ${n} min`;
  }
  if (abs < DAY) {
    const n = Math.floor(abs / HOUR);
    return past ? `${n} h ago` : `in ${n} h`;
  }
  if (abs < 2 * DAY) return past ? "yesterday" : "tomorrow";
  const days = Math.floor(abs / DAY);
  if (days <= 7) return past ? `${days} days ago` : `in ${days} days`;
  return formatShortDate(date, now);
}

// One shared ticker for every mounted relative date.
const listeners = new Set<(now: number) => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(listener: (now: number) => void): () => void {
  listeners.add(listener);
  if (!timer) {
    timer = setInterval(() => {
      const now = Date.now();
      listeners.forEach((l) => l(now));
    }, 30_000);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** The current time, refreshed at least every minute while mounted. */
export function useNow(): Date {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => subscribe(setNow), []);
  return new Date(now);
}

export function RelativeTime({
  value,
  prefix,
  className,
  fallback = "",
}: {
  value: Instant;
  /** Text before the relative part inside the element, e.g. "Started ". */
  prefix?: string;
  className?: string;
  /** Shown when the value is missing or invalid. */
  fallback?: string;
}) {
  const now = useNow();
  const date = parseInstant(value);
  if (!date)
    return fallback ? <span className={className}>{fallback}</span> : null;
  const exact = formatExact(date);
  return (
    <time
      className={className ? `crew-time ${className}` : "crew-time"}
      dateTime={date.toISOString()}
      title={exact}
    >
      {prefix}
      {formatRelative(date, now)}
    </time>
  );
}
