import { pb } from "./api";
export type Row = {
  id: string;
  revision: number;
  archived?: boolean;
  [key: string]: unknown;
};
export const val = (row: Row | undefined, key: string) =>
  String(row?.[key] ?? "");
export function list(row: Row | undefined, key: string): string[] {
  const raw = row?.[key];
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {}
  }
  return [];
}
export type ServerVersion = { version: string; commit: string };
export const crewApi = {
  async serverVersion(): Promise<ServerVersion> {
    const result = await pb.send<Partial<ServerVersion>>(
      "/api/bundle/version",
      {
        method: "GET",
        cache: "no-store",
      },
    );
    if (typeof result.version !== "string" || !result.version.trim())
      throw new Error("Server version unavailable");
    return {
      version: result.version,
      commit: typeof result.commit === "string" ? result.commit : "",
    };
  },
  async read(
    collection: string,
    filters: Record<string, unknown> = {},
  ): Promise<Row[]> {
    const rows: Row[] = [];
    let offset = 0;
    for (;;) {
      const response = await pb.send<{
        items: Row[];
        has_more?: boolean;
        next_offset?: number;
      }>("/api/crew/read", {
        method: "POST",
        body: { collection, ...filters, offset },
      });
      rows.push(...response.items);
      if (!response.has_more) return rows;
      if (response.next_offset === undefined || response.next_offset <= offset)
        throw new Error("Could not continue loading records.");
      offset = response.next_offset;
    }
  },
  async write(
    action: string,
    data: Record<string, unknown> = {},
    row?: Row,
    reason = "",
  ): Promise<Row> {
    return pb.send("/api/crew/write", {
      method: "POST",
      body: {
        action,
        data,
        ...(row ? { id: row.id, expected_revision: row.revision } : {}),
        reason,
      },
    });
  },
};
export const statuses = [
  ["todo", "To do"],
  ["in_progress", "In progress"],
  ["needs_review", "Needs review"],
  ["done", "Done"],
] as const;
export function lineDiff(before: string, after: string) {
  const oldLines = before.split("\n"),
    newLines = after.split("\n");
  let start = 0;
  while (
    start < oldLines.length &&
    start < newLines.length &&
    oldLines[start] === newLines[start]
  )
    start++;
  let oldEnd = oldLines.length,
    newEnd = newLines.length;
  while (
    oldEnd > start &&
    newEnd > start &&
    oldLines[oldEnd - 1] === newLines[newEnd - 1]
  ) {
    oldEnd--;
    newEnd--;
  }
  // Exact ordered replacement section: linear time, retains duplicates and moves.
  return {
    removed: oldLines.slice(start, oldEnd),
    added: newLines.slice(start, newEnd),
  };
}
