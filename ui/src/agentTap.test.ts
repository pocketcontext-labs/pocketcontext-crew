import { afterEach, describe, expect, it } from "vitest";
import {
  agentActions,
  allAgentsAction,
  hasOverride,
  parseAgentTap,
  resolveAgentTap,
  tapActionLabel,
  withAgentAction,
  withAllAgents,
  type AgentTap,
} from "./agentTap";
import { resetLanguageForTests, setLanguage } from "./i18n";

const bot = {
  id: "agentbot0000001",
  revision: 1,
  name: "Network",
  kind: "bot",
};
const coder = {
  id: "agentcoder00001",
  revision: 1,
  name: "Implement",
  kind: "external",
};
const person = {
  id: "agentperson0001",
  revision: 1,
  name: "Ada",
  kind: "human",
};

describe("agent tap", () => {
  afterEach(() => resetLanguageForTests());

  it("defaults every agent to Open agent", () => {
    const tap = parseAgentTap(null);
    expect(tap).toEqual({});
    expect(allAgentsAction(tap)).toBe("open_agent");
    for (const agent of [bot, coder, person])
      expect(resolveAgentTap(tap, agent)).toBe("open_agent");
  });

  it("offers only the actions in each agent's ⋯ menu", () => {
    expect(agentActions(bot)).toEqual(["open_agent", "show_tasks"]);
    expect(agentActions(person)).toEqual(["open_agent", "show_tasks"]);
    expect(agentActions(coder)).toEqual([
      "open_agent",
      "show_tasks",
      "copy_prompt",
    ]);
  });

  it("applies All agents to every agent without an override", () => {
    let tap: AgentTap = withAgentAction({}, coder.id, "copy_prompt");
    tap = withAllAgents(tap, "show_tasks");
    expect(resolveAgentTap(tap, bot)).toBe("show_tasks");
    expect(resolveAgentTap(tap, person)).toBe("show_tasks");
    expect(resolveAgentTap(tap, coder)).toBe("copy_prompt");
    tap = withAllAgents(tap, "open_agent");
    expect(resolveAgentTap(tap, bot)).toBe("open_agent");
    expect(resolveAgentTap(tap, coder)).toBe("copy_prompt");
  });

  it("treats the All agents value as following All agents, not an override", () => {
    let tap: AgentTap = withAllAgents({}, "show_tasks");
    tap = withAgentAction(tap, bot.id, "open_agent");
    expect(hasOverride(tap, bot)).toBe(true);
    expect(resolveAgentTap(tap, bot)).toBe("open_agent");
    tap = withAgentAction(tap, bot.id, "show_tasks");
    expect(tap).toEqual({ all: "show_tasks" });
    expect(hasOverride(tap, bot)).toBe(false);
    // A later All agents change now reaches this agent.
    tap = withAllAgents(tap, "open_agent");
    expect(resolveAgentTap(tap, bot)).toBe("open_agent");
  });

  it("falls back to All agents, then Open agent, when an action disappears", () => {
    const tap = parseAgentTap({
      all: "show_tasks",
      agents: { [coder.id]: "copy_prompt" },
    });
    // The coding agent became a bot: no prompt to copy any more.
    const former = { ...coder, kind: "bot" };
    expect(resolveAgentTap(tap, former)).toBe("show_tasks");
    expect(hasOverride(tap, former)).toBe(false);
    expect(
      resolveAgentTap({ agents: { [coder.id]: "copy_prompt" } }, former),
    ).toBe("open_agent");
  });

  it("drops unknown stored values", () => {
    expect(
      parseAgentTap({
        all: "copy_prompt",
        agents: { [bot.id]: "launch", [coder.id]: "show_tasks" },
        extra: 1,
      }),
    ).toEqual({ agents: { [coder.id]: "show_tasks" } });
    expect(parseAgentTap([])).toEqual({});
    expect(parseAgentTap("open_agent")).toEqual({});
  });

  it("labels actions in the reader's language", () => {
    expect(tapActionLabel("copy_prompt")).toBe("Copy prompt for coding agent");
    setLanguage("de");
    expect(tapActionLabel("show_tasks")).toBe("Aufgaben anzeigen");
    setLanguage("it");
    expect(tapActionLabel("open_agent")).toBe("Apri agente");
  });
});
