import { val, type Row } from "./crewApi";
import { t } from "./i18n";
import { formatDuration, formatExact, parseInstant } from "./relativeTime";

/**
 * How an agent is started: a webhook-woken bot, a project agent whose coding
 * sessions the owner starts in a terminal, or a person. Agents saved before
 * kinds existed are bots.
 */
export type AgentKind = "bot" | "external" | "human";
export const agentKinds: AgentKind[] = ["bot", "external", "human"];
export const agentKind = (agent: Row | undefined): AgentKind => {
  const kind = val(agent, "kind");
  return kind === "external" || kind === "human" ? kind : "bot";
};
/** Only bots are woken by webhook, so only bots have bot mappings. */
export const isBot = (agent: Row | undefined) => agentKind(agent) === "bot";
/** Existing external roles are owner-started in Crew's single-owner agent directory. */
export const canStartChat = (agent: Row | undefined) =>
  !!agent && !agent.archived && agentKind(agent) !== "human";
export const chatActionLabel = (agent: Row) =>
  agent.chat_start === "webhook" ? t("Use in another chat") : t("Start in a chat");
// The tables below hold English, translated with t() where they render
// (catalog: pages.ts lists every value).
export const agentKindChoices: Record<AgentKind, string> = {
  bot: "Webhook (bot)",
  external: "I start it myself (no webhook)",
  human: "Person",
};
/** The muted suffix after an agent's name in the board filter. */
export const agentKindSuffix: Record<AgentKind, string> = {
  bot: "",
  external: " · manual",
  human: " · person",
};
/**
 * Whether the global webhook integration has been set up, so a new agent
 * defaults to a webhook bot rather than a manually started one.
 */
export const webhookConfigured = (configs: Row[]) => {
  const global = configs.find((x) => x.scope === "global");
  return (
    !!global &&
    (global.enabled === true ||
      global.url_configured === true ||
      global.secret_configured === true)
  );
};

/** A task's claim by a coding session; `until` is ISO UTC. */
export type Claim = {
  state: "" | "live" | "expired";
  by: string;
  until: string;
  started: string;
};
/**
 * The server derives `claim_state`; a live claim whose lease has passed since
 * the last refresh already shows as expired.
 */
export function claimOf(task: Row | undefined, now = Date.now()): Claim {
  const raw = val(task, "claim_state");
  const by = val(task, "claimed_by").trim();
  const until = val(task, "claim_until");
  let state: Claim["state"] = raw === "live" || raw === "expired" ? raw : "";
  const end = parseInstant(until);
  if (state === "live" && end && end.getTime() <= now) state = "expired";
  return { state, by, until, started: val(task, "claimed_at") };
}
/** The coding tool named in `claimed_by`, if any. */
export const claimTool = (claim: Claim) =>
  claim.by
    .split(" · ")
    .find((part) => /^(Codex|Claude Code|Antigravity)$/i.test(part.trim()))
    ?.trim() || "";
/**
 * The agent a claim belongs to: the task's assigned agent when known (only
 * its sessions can claim), else the first part of `claimed_by`.
 */
export const claimAgent = (claim: Claim, assigned = "") =>
  assigned.trim() || claim.by.split(" · ")[0].trim() || t("a session");
/**
 * The claim with exact local times, for a tooltip and Copy details:
 * "Claimed by … · Started Nov 17, 2026, 1:18 PM · Until … · Claim expired".
 */
export const claimTitle = (claim: Claim) =>
  [
    claim.by
      ? t("Claimed by {by}", { by: claim.by })
      : t("Claimed by a session"),
    formatExact(claim.started)
      ? t("Started {time}", { time: formatExact(claim.started) })
      : t("Start time unavailable"),
    formatExact(claim.until)
      ? t("Until {time}", { time: formatExact(claim.until) })
      : "",
    claim.state === "expired" ? t("Claim expired") : "",
  ]
    .filter(Boolean)
    .join(" · ");
/** A card chip: "Claude Code · 1 h 40 m left", or "Claim expired". */
export function claimLabel(claim: Claim, now = Date.now()) {
  if (claim.state === "expired") return t("Claim expired");
  const tool = claimTool(claim) || t("Session");
  const until = parseInstant(claim.until);
  if (!until) return tool;
  return t("{tool} · {duration} left", {
    tool,
    duration: formatDuration(Math.max(0, until.getTime() - now)),
  });
}

/**
 * Copies text: the Clipboard API, else a selected textarea and the copy
 * command. False when neither worked, so the caller can show the text.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) throw new Error("unavailable");
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    try {
      area.select();
      return document.execCommand?.("copy") === true;
    } catch {
      return false;
    } finally {
      area.remove();
    }
  }
}
