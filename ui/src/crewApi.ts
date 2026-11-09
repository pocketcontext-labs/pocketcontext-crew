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
export type Connection = { kind: "mcp"; url: string } | { kind: "local" };
export type ConnectionState =
  | Connection
  | { kind: "checking" }
  | { kind: "unknown" };
export type ConnectedApp = { id: string; name: string; created: number };
async function connectionsRequest<T>(body?: { id: string }): Promise<T> {
  const response = await fetch("/oauth/connections", {
    method: body ? "POST" : "GET",
    credentials: "omit",
    redirect: "error",
    headers: {
      Authorization: `Bearer ${pb.authStore.token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error("Connected apps are unavailable.");
  return response.json() as Promise<T>;
}
export const crewApi = {
  // MCP clients discover the endpoint from this same public document. The
  // server serves it only when MCP is on, and 404s it otherwise, including on a
  // domain without --mcp. Any other answer proves nothing, so it throws.
  async connectedApps(): Promise<ConnectedApp[]> {
    const { connections } = await connectionsRequest<{
      connections: ConnectedApp[];
    }>();
    return connections;
  },
  async revokeConnectedApp(id: string): Promise<void> {
    await connectionsRequest({ id });
  },
  async connection(): Promise<Connection> {
    const response = await fetch("/.well-known/oauth-protected-resource", {
      cache: "no-store",
      credentials: "omit",
    });
    if (response.status === 404) return { kind: "local" };
    if (!response.ok) throw new Error("Connection details unavailable");
    const { resource } = (await response.json()) as { resource?: unknown };
    if (typeof resource !== "string")
      throw new Error("Connection details unavailable");
    const url = new URL(resource);
    if (url.protocol !== "https:" || url.pathname !== "/mcp")
      throw new Error("Connection details unavailable");
    return { kind: "mcp", url: resource };
  },
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
    options: { idempotency_key?: string; expected_revision?: number } = {},
  ): Promise<Row> {
    return pb.send("/api/crew/write", {
      method: "POST",
      body: {
        action,
        data,
        ...(row ? { id: row.id, expected_revision: row.revision } : {}),
        reason,
        ...options,
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
