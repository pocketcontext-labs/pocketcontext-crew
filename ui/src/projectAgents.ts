import { val, type Row } from "./crewApi";

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
export const agentKindChoices: Record<AgentKind, string> = {
  bot: "Webhook (bot)",
  external: "I start it myself (no webhook)",
  human: "Person",
};
/** The line under the name on an agent card; bots show none. */
export const agentKindCardLabel: Record<AgentKind, string> = {
  bot: "",
  external: "Started manually · no webhook",
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
export type Claim = { state: "" | "live" | "expired"; by: string; until: string };
/**
 * The server derives `claim_state`; a live claim whose lease has passed since
 * the last refresh already shows as expired.
 */
export function claimOf(task: Row | undefined, now = Date.now()): Claim {
  const raw = val(task, "claim_state");
  const by = val(task, "claimed_by").trim();
  const until = val(task, "claim_until");
  let state: Claim["state"] = raw === "live" || raw === "expired" ? raw : "";
  if (state === "live" && until && Date.parse(until) <= now) state = "expired";
  return { state, by, until };
}
/** HH:MM in the owner's local time. */
export const claimTime = (until: string) => {
  const date = new Date(until);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};
export const claimTitle = (claim: Claim) =>
  claim.state === "live"
    ? claimTime(claim.until)
      ? `until ${claimTime(claim.until)}`
      : ""
    : claim.by
      ? `Previously claimed by ${claim.by}`
      : "The session's claim ran out";

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
