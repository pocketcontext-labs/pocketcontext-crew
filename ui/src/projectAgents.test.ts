import { afterEach, expect, it, vi } from "vitest";
import {
  agentKind,
  claimOf,
  claimTitle,
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
  expect(
    webhookConfigured([row({ scope: "global", enabled: false })]),
  ).toBe(false);
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
  });
  expect(claimTitle(claimOf(live, now))).toMatch(/^until \d{1,2}:\d{2}/);
  expect(claimOf(live, Date.parse("2026-11-12T12:00:00Z")).state).toBe(
    "expired",
  );
  const expired = row({ claim_state: "expired", claimed_by: "codex-1" });
  expect(claimTitle(claimOf(expired, now))).toBe(
    "Previously claimed by codex-1",
  );
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
