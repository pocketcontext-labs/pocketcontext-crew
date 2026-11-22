import { afterEach, expect, it, vi } from "vitest";
import {
  agentKind,
  claimAgent,
  claimLabel,
  claimOf,
  claimTitle,
  claimTool,
  copyText,
  isBot,
  webhookConfigured,
} from "./projectAgents";
import type { Row } from "./crewApi";
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const row = (fields: Record<string, unknown>): Row => ({
  id: "x",
  revision: 1,
  ...fields,
});
it("treats agents without a kind, or an unknown one, as webhook bots", () => {
  expect(agentKind(row({}))).toBe("bot");
  expect(agentKind(row({ kind: "robot" }))).toBe("bot");
  expect(agentKind(row({ kind: "external" }))).toBe("external");
  expect(agentKind(row({ kind: "human" }))).toBe("human");
  expect(isBot(row({ kind: "external" }))).toBe(false);
  expect(isBot(undefined)).toBe(true);
});
it("knows whether the webhook integration is set up", () => {
  expect(webhookConfigured([])).toBe(false);
  expect(webhookConfigured([row({ scope: "global", enabled: false })])).toBe(
    false,
  );
  expect(
    webhookConfigured([row({ scope: "legacy", url_configured: true })]),
  ).toBe(false);
  expect(
    webhookConfigured([row({ scope: "global", url_configured: true })]),
  ).toBe(true);
  expect(webhookConfigured([row({ scope: "global", enabled: true })])).toBe(
    true,
  );
});
it("reads the claim, showing a live claim whose lease passed as expired", () => {
  const now = Date.parse("2026-11-12T10:00:00Z");
  expect(claimOf(row({}), now).state).toBe("");
  const live = row({
    claim_state: "live",
    claimed_by: "codex-1",
    claim_until: "2026-11-12T11:30:00Z",
  });
  expect(claimOf(live, now)).toEqual({
    state: "live",
    by: "codex-1",
    until: "2026-11-12T11:30:00Z",
    started: "",
  });
  expect(claimTitle(claimOf(live, now))).toContain("Claimed by codex-1");
  expect(claimOf(live, Date.parse("2026-11-12T12:00:00Z")).state).toBe(
    "expired",
  );
  const expired = row({ claim_state: "expired", claimed_by: "codex-1" });
  expect(claimTitle(claimOf(expired, now))).toBe(
    "Claimed by codex-1 · Start time unavailable · Claim expired",
  );
});
it("names the claim's agent and tool and shows exact times in the title", () => {
  const now = Date.parse("2026-11-12T10:00:00Z");
  const claim = claimOf(
    row({
      claim_state: "live",
      claimed_by: "Implement · Claude Code · undulating-duck/2 · 9e017204",
      claimed_at: "2026-11-12 09:45:00.000Z",
      claim_until: "2026-11-12T11:45:00Z",
    }),
    now,
  );
  expect(claimAgent(claim)).toBe("Implement");
  expect(claimAgent(claimOf(row({ claim_state: "live" }), now))).toBe("a session");
  expect(claimTool(claim)).toBe("Claude Code");
  expect(claimLabel(claim, now)).toBe("Claude Code · 1 h 45 m left");
  expect(claimTitle(claim)).toMatch(/^Claimed by Implement · Claude Code · undulating-duck\/2 · 9e017204 · Started .*2026.* · Until .*2026/);
  expect(claimLabel({ ...claim, state: "expired" }, now)).toBe("Claim expired");
});
it("copies with the Clipboard API, else the copy command, else reports failure", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  expect(await copyText("prompt")).toBe(true);
  expect(writeText).toHaveBeenCalledWith("prompt");
  writeText.mockRejectedValue(new Error("denied"));
  const exec = vi.fn().mockReturnValue(true);
  Object.defineProperty(document, "execCommand", {
    value: exec,
    configurable: true,
  });
  expect(await copyText("prompt")).toBe(true);
  expect(exec).toHaveBeenCalledWith("copy");
  expect(document.querySelector("textarea")).toBeNull();
  exec.mockReturnValue(false);
  expect(await copyText("prompt")).toBe(false);
});
