import { t } from "./i18n";
import { type Row } from "./crewApi";
import { canStartChat } from "./projectAgents";

/**
 * What tapping an agent row on Home runs (0.36.0), chosen in Settings >
 * Tapping an agent and kept on the server (`crew_settings.agent_tap`).
 *
 * A global action applies unless the agent has an override. People and
 * archived agents fall back to Open agent when the action requires a prompt.
 */
export type TapAction = "open_agent" | "show_tasks" | "copy_prompt";
export type AgentTap = {
  all?: TapAction;
  agents?: Record<string, TapAction>;
};

export const productDefault: TapAction = "open_agent";
const navigationActions: TapAction[] = ["open_agent", "show_tasks"];
export const allAgentsActions: TapAction[] = [...navigationActions, "copy_prompt"];

export const agentActions = (agent: Row | undefined): TapAction[] =>
  canStartChat(agent) ? allAgentsActions : navigationActions;

const isAction = (value: unknown): value is TapAction =>
  allAgentsActions.includes(value as TapAction);

/** The stored value as the reader trusts it: unknown parts are dropped. */
export function parseAgentTap(raw: unknown): AgentTap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const value = raw as { all?: unknown; agents?: unknown };
  const out: AgentTap = {};
  if (isAction(value.all)) out.all = value.all;
  if (
    value.agents &&
    typeof value.agents === "object" &&
    !Array.isArray(value.agents)
  ) {
    const agents: Record<string, TapAction> = {};
    for (const [id, action] of Object.entries(value.agents))
      if (isAction(action)) agents[id] = action;
    if (Object.keys(agents).length) out.agents = agents;
  }
  return out;
}

/** The All agents value: the owner's choice, else Open agent. */
export const allAgentsAction = (tap: AgentTap): TapAction =>
  isAction(tap.all) ? tap.all : productDefault;

/**
 * The action a tap on this agent runs: its override, else All agents, else
 * Open agent; a stored action no longer in the agent's menu falls back.
 */
export function resolveAgentTap(tap: AgentTap, agent: Row): TapAction {
  const allowed = agentActions(agent);
  const own = tap.agents?.[agent.id];
  if (own && allowed.includes(own)) return own;
  const all = allAgentsAction(tap);
  return allowed.includes(all) ? all : productDefault;
}

/** Whether the agent has its own choice (one its menu still offers). */
export const hasOverride = (tap: AgentTap, agent: Row) => {
  const own = tap.agents?.[agent.id];
  return !!own && agentActions(agent).includes(own);
};

/** Sets All agents; per-agent overrides stay. */
export const withAllAgents = (
  tap: AgentTap,
  action: TapAction,
): AgentTap => ({ ...tap, all: action });

/**
 * Sets one agent's action. The All agents value clears the override, so a
 * later All agents change applies to this agent too.
 */
export function withAgentAction(
  tap: AgentTap,
  agentId: string,
  action: TapAction,
): AgentTap {
  const agents = { ...tap.agents };
  if (action === allAgentsAction(tap)) delete agents[agentId];
  else agents[agentId] = action;
  const next: AgentTap = { ...tap };
  if (Object.keys(agents).length) next.agents = agents;
  else delete next.agents;
  return next;
}

/** An action's label, in the reader's language. */
export function tapActionLabel(action: TapAction): string {
  switch (action) {
    case "open_agent":
      return t("Open agent");
    case "show_tasks":
      return t("Show tasks");
    case "copy_prompt":
      return t("Copy prompt");
  }
}
