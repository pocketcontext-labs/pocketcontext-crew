import { afterEach, expect, it, vi } from "vitest";
import { pb } from "./api";
import { crewApi, lineDiff } from "./crewApi";
afterEach(() => vi.restoreAllMocks());
it("follows bounded pagination instead of silently dropping older records", async () => {
  const send = vi
    .spyOn(pb, "send")
    .mockResolvedValueOnce({
      items: [{ id: "first", revision: 1 }],
      has_more: true,
      next_offset: 100,
    })
    .mockResolvedValueOnce({
      items: [{ id: "second", revision: 1 }],
      has_more: false,
      next_offset: null,
    });
  expect(await crewApi.read("notes", { archived: true })).toHaveLength(2);
  expect(send).toHaveBeenLastCalledWith("/api/crew/read", {
    method: "POST",
    body: { collection: "notes", archived: true, offset: 100 },
  });
});
it("uses the expected revision without claiming a verified agent identity", async () => {
  const send = vi
    .spyOn(pb, "send")
    .mockResolvedValue({ id: "note", revision: 5 });
  await crewApi.write(
    "note.update",
    { body: "New decision" },
    { id: "note", revision: 4 },
    "Decision changed",
  );
  expect(send).toHaveBeenCalledWith("/api/crew/write", {
    method: "POST",
    body: {
      action: "note.update",
      data: { body: "New decision" },
      id: "note",
      expected_revision: 4,
      reason: "Decision changed",
    },
  });
});

it("preserves duplicate lines and ordering in revision comparisons", () => {
  expect(lineDiff("a\nb\na", "a\na\nb")).toEqual({
    removed: ["b", "a"],
    added: ["a", "b"],
  });
  expect(lineDiff("a\na", "a")).toEqual({ removed: ["a"], added: [] });
  expect(lineDiff("a\nb", "a\nb")).toEqual({ removed: [], added: [] });
});

it("fetches uncached running-server metadata and rejects missing versions", async () => {
  const send = vi
    .spyOn(pb, "send")
    .mockResolvedValueOnce({ version: "0.3.1", commit: "synthetic-revision" })
    .mockResolvedValueOnce({});
  expect(await crewApi.serverVersion()).toEqual({
    version: "0.3.1",
    commit: "synthetic-revision",
  });
  expect(send).toHaveBeenCalledWith("/api/bundle/version", {
    method: "GET",
    cache: "no-store",
  });
  await expect(crewApi.serverVersion()).rejects.toThrow(
    "Server version unavailable",
  );
});

it("passes idempotency and an explicit zero create revision to owner writes", async () => {
  const send = vi
    .spyOn(pb, "send")
    .mockResolvedValue({ id: "mapping", revision: 1 });
  await crewApi.write(
    "webhook.mapping.update",
    { agent: "build", bot_ref: "Build bot" },
    undefined,
    "",
    { idempotency_key: "stable-key", expected_revision: 0 },
  );
  expect(send).toHaveBeenCalledWith("/api/crew/write", {
    method: "POST",
    body: {
      action: "webhook.mapping.update",
      data: { agent: "build", bot_ref: "Build bot" },
      reason: "",
      idempotency_key: "stable-key",
      expected_revision: 0,
    },
  });
});
