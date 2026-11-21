import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CrewWorkspace from "./CrewWorkspace";
import { attachmentsApi } from "./attachmentsApi";
import { crewApi, type Row } from "./crewApi";
import { getLanguage, resetLanguageForTests, useLanguage } from "./i18n";
import { resetReferencesForTests } from "./references";
import { resetReaderSettingsForTests } from "./sessionGuide";
import { resetTrail } from "./trail";
import { phoneQuery } from "./usePhone";

// Agent names are the owner's content: "Bauen" and "Lernen" must stay as
// they are in every language.
const bot: Row = {
  id: "agent0000000001",
  revision: 1,
  name: "Bauen",
  brief: "",
};
const other: Row = {
  id: "agent0000000002",
  revision: 1,
  name: "Lernen",
  brief: "",
};
const coder: Row = {
  id: "agent0000000003",
  revision: 1,
  name: "Implement",
  brief: "",
  kind: "external",
};
const session = {
  agent: { id: coder.id, name: "Implement", kind: "external" },
  prompt: "Act as Implement in Crew.",
  instructions: "",
  lease_hours: 2,
  body: "",
  revision: 0,
  is_default: true,
  edited_by: "",
  edited_at: "",
  rewrite_prompt: "",
};
let fixtures: Record<string, Row[]>;
let phone = true;
// Like App: the whole tree re-renders when the language changes.
function Root() {
  useLanguage();
  return <CrewWorkspace />;
}

beforeEach(() => {
  phone = true;
  resetLanguageForTests("en");
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: phone && query === phoneQuery,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  history.replaceState(null, "", "/#/settings");
  fixtures = {
    agents: [bot, other, coder],
    buckets: [],
    tasks: [],
    reviews: [],
    notes: [],
    events: [],
    settings: [
      {
        id: "settings0000001",
        revision: 1,
        session_guide_off: true,
        language: "",
        agent_tap: null,
      },
    ],
  };
  vi.spyOn(crewApi, "serverVersion").mockResolvedValue({
    version: "0.36.0",
    commit: "0123456789abcdef0123",
  });
  vi.spyOn(crewApi, "connection").mockResolvedValue({
    kind: "mcp",
    url: "https://crew.example/mcp",
  });
  vi.spyOn(crewApi, "read").mockImplementation(async (c, f = {}) =>
    f.archived ? [] : fixtures[c] || [],
  );
  vi.spyOn(crewApi, "write").mockImplementation(async (_action, data) => ({
    ...fixtures.settings[0],
    ...(data as Row),
    revision: 2,
  }));
  vi.spyOn(crewApi, "session").mockResolvedValue(session);
  vi.spyOn(attachmentsApi, "cardThumbnails").mockResolvedValue({});
  vi.spyOn(crewApi, "references").mockResolvedValue([]);
});
afterEach(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 20));
  history.replaceState(null, "", "/");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetReaderSettingsForTests();
  resetReferencesForTests();
  resetTrail();
  resetLanguageForTests("en");
});

const tabs = () =>
  within(
    screen.getByRole("navigation", {
      name: /Workspace|Arbeitsbereich|Spazio di lavoro/,
    }),
  );
const settingsWrites = () =>
  vi
    .mocked(crewApi.write)
    .mock.calls.filter(([action]) => action === "settings.update");

describe("Settings", () => {
  it("is a row in More that keeps More selected, without Sign out in the sheet", async () => {
    history.replaceState(null, "", "/#/tasks");
    render(<Root />);
    await screen.findByRole("navigation", { name: "Workspace" });
    fireEvent.click(tabs().getByRole("button", { name: "More" }));
    const more = within(screen.getByRole("dialog", { name: "More" }));
    expect(more.getAllByRole("link").map((a) => a.textContent)).toEqual([
      "Agents",
      "Connect an agent",
      "Shared",
      "Archive",
      "Settings",
      "Guide",
    ]);
    expect(more.queryByRole("button", { name: "Sign out" })).toBeNull();
    fireEvent.click(more.getByRole("link", { name: "Settings" }));
    history.replaceState(null, "", "/#/settings");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await screen.findByRole("heading", { name: "Tapping an agent" });
    expect(tabs().getByRole("button", { name: "More" })).toHaveClass(
      "is-current",
    );
    // Not in the page ⋯ menu.
    fireEvent.click(screen.getByRole("button", { name: "Page options" }));
    expect(
      within(screen.getByRole("dialog", { name: "Settings" })).queryByRole(
        "button",
        { name: "Settings" },
      ),
    ).toBeNull();
  });

  it("shows Account with Sign out and About with the server version, not a footer", async () => {
    render(<Root />);
    const account = within(
      await screen.findByRole("region", { name: "Account" }),
    );
    expect(account.getByRole("button", { name: "Sign out" })).toBeTruthy();
    const about = within(screen.getByRole("region", { name: "About" }));
    await waitFor(() => expect(about.getByText("0.36.0")).toBeTruthy());
    expect(about.getByText("0123456789ab")).toHaveAttribute(
      "title",
      "0123456789abcdef0123",
    );
    expect(
      screen.queryByRole("contentinfo", { name: "Running server" }),
    ).toBeNull();
  });

  it("shows all help again from Help: clears every hide and confirms", async () => {
    fixtures.settings[0].hidden_help = ["page.home", "home.guide_row"];
    render(<Root />);
    const help = within(await screen.findByRole("region", { name: "Help" }));
    // An old per-browser hide left behind is cleared too.
    localStorage.setItem("pocketcontext.crew.get_started_hidden", "1");
    const row = help.getByRole("button", { name: "Show all help again" });
    fireEvent.click(row);
    await waitFor(() =>
      expect(settingsWrites().at(-1)?.[1]).toEqual({
        hidden_help: [],
        session_guide_off: false,
      }),
    );
    expect((await screen.findByRole("status")).textContent).toBe(
      "All help will show again",
    );
    expect(localStorage.getItem("pocketcontext.crew.get_started_hidden")).toBeNull();
    localStorage.clear();
  });

  it("switches the language without a reload, saves it, and leaves agent names alone", async () => {
    render(<Root />);
    await screen.findByRole("heading", { name: "Tapping an agent" });
    fireEvent.click(screen.getByRole("button", { name: /^Language/ }));
    const list = within(screen.getByRole("radiogroup", { name: "Language" }));
    expect(list.getAllByRole("radio").map((r) => r.textContent)).toEqual([
      "English",
      "Deutsch",
      "Italiano",
    ]);
    expect(list.getByRole("radio", { name: "English" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    fireEvent.click(list.getByRole("radio", { name: "Deutsch" }));
    await waitFor(() => expect(document.documentElement.lang).toBe("de"));
    expect(getLanguage()).toBe("de");
    expect(tabs().getByText("Aufgaben")).toBeTruthy();
    expect(tabs().getByText("Freigaben")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Deutsch" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await waitFor(() =>
      expect(settingsWrites().at(-1)?.[1]).toEqual({ language: "de" }),
    );
    fireEvent.click(screen.getByRole("radio", { name: "Italiano" }));
    await waitFor(() => expect(document.documentElement.lang).toBe("it"));
    expect(tabs().getByText("Attività")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Torna alle impostazioni" }),
    );
    expect(
      screen.getByRole("heading", { name: "Tocco su un agente" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Lingua/ })).toHaveTextContent(
      "Italiano",
    );
    // The owner's agent names are never translated.
    expect(screen.getByRole("button", { name: /^Bauen/ })).toHaveTextContent(
      "BauenApri agente",
    );
    expect(screen.getByRole("button", { name: /^Lernen/ })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /^Tutti gli agenti/ }),
    ).toHaveTextContent("Apri agente");
  });

  it("applies the server's language on load", async () => {
    fixtures.settings = [{ ...fixtures.settings[0], language: "it" }];
    render(<Root />);
    await waitFor(() => expect(document.documentElement.lang).toBe("it"));
    expect(
      await screen.findByRole("heading", { name: "Tocco su un agente" }),
    ).toBeTruthy();
  });

  it("sets All agents and per-agent actions from each agent's own menu", async () => {
    render(<Root />);
    await screen.findByRole("heading", { name: "Tapping an agent" });
    expect(
      screen.getByRole("button", { name: /^All agents/ }),
    ).toHaveTextContent("Open agent");
    fireEvent.click(screen.getByRole("button", { name: /^All agents/ }));
    let list = within(screen.getByRole("radiogroup", { name: "All agents" }));
    expect(list.getAllByRole("radio").map((r) => r.textContent)).toEqual([
      "Open agent",
      "Show tasks",
      "Copy prompt",
    ]);
    fireEvent.click(list.getByRole("radio", { name: "Copy prompt" }));
    await waitFor(() =>
      expect(settingsWrites().at(-1)?.[1]).toEqual({
        agent_tap: { all: "copy_prompt" },
      }),
    );
    fireEvent.click(list.getByRole("radio", { name: "Show tasks" }));
    await waitFor(() =>
      expect(settingsWrites().at(-1)?.[1]).toEqual({
        agent_tap: { all: "show_tasks" },
      }),
    );
    expect(list.getByRole("radio", { name: "Show tasks" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Back to Settings" }));
    // Every agent now shows the action that will run.
    for (const name of ["Bauen", "Lernen", "Implement"])
      expect(
        screen.getByRole("button", { name: new RegExp(`^${name}`) }),
      ).toHaveTextContent("Show tasks");
    fireEvent.click(screen.getByRole("button", { name: /^Bauen/ }));
    list = within(screen.getByRole("radiogroup", { name: "Bauen" }));
    expect(list.getAllByRole("radio").map((r) => r.textContent)).toEqual([
      "Open agent",
      "Show tasks",
      "Copy prompt",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Back to Settings" }));
    fireEvent.click(screen.getByRole("button", { name: /^Implement/ }));
    list = within(screen.getByRole("radiogroup", { name: "Implement" }));
    expect(list.getAllByRole("radio").map((r) => r.textContent)).toEqual([
      "Open agent",
      "Show tasks",
      "Copy prompt",
    ]);
    expect(list.getByRole("radio", { name: "Show tasks" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    fireEvent.click(
      list.getByRole("radio", { name: "Copy prompt" }),
    );
    await waitFor(() =>
      expect(settingsWrites().at(-1)?.[1]).toEqual({
        agent_tap: { all: "show_tasks", agents: { [coder.id]: "copy_prompt" } },
      }),
    );
    // Choosing the All agents value again follows All agents (no override).
    fireEvent.click(list.getByRole("radio", { name: "Show tasks" }));
    await waitFor(() =>
      expect(settingsWrites().at(-1)?.[1]).toEqual({
        agent_tap: { all: "show_tasks" },
      }),
    );
  });

  it("is in the desktop sidebar beside Connect and Guide", async () => {
    phone = false;
    history.replaceState(null, "", "/#/tasks");
    render(<Root />);
    const link = await screen.findByRole("link", { name: "Settings" });
    expect(link.closest(".crew-sidebar-bottom")).toBeTruthy();
    expect(link).toHaveAttribute("href", "#/settings");
  });
});

describe("Home agent rows", () => {
  const agentsRegion = async () =>
    within(await screen.findByRole("region", { name: "Agents" }));
  beforeEach(() => {
    history.replaceState(null, "", "/#/");
  });

  it("opens the agent on a tap by default and keeps ⋯ for the full menu", async () => {
    render(<Root />);
    const agents = await agentsRegion();
    fireEvent.click(agents.getByRole("button", { name: /^Bauen/ }));
    await waitFor(() => expect(location.hash).toBe(`#/agents/${bot.id}`));
  });

  it("copies an automatic agent's prompt on tap with the saved global action", async () => {
    fixtures.agents = [{ ...bot, chat_start: "webhook" }];
    fixtures.settings[0].agent_tap = { all: "copy_prompt" };
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    vi.mocked(crewApi.session).mockResolvedValue({
      ...session, agent: { id: bot.id, name: "Bauen", kind: "bot" }, prompt: "Act as Bauen in Crew.",
    });
    render(<Root />);
    const agents = await agentsRegion();
    await waitFor(() => expect(crewApi.session).toHaveBeenCalledWith(bot.id));
    fireEvent.click(agents.getByRole("button", { name: /^Bauen/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Act as Bauen in Crew."));
    expect(location.hash).toBe("#/");
  });

  it("runs Show tasks from All agents and an override for the coding agent", async () => {
    fixtures.settings = [
      {
        ...fixtures.settings[0],
        agent_tap: { all: "show_tasks", agents: { [coder.id]: "copy_prompt" } },
      },
    ];
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    render(<Root />);
    const agents = await agentsRegion();
    await waitFor(() => expect(crewApi.session).toHaveBeenCalledWith(coder.id));
    // Let the settings read land.
    await waitFor(() =>
      expect(
        vi.mocked(crewApi.read).mock.calls.some(([c]) => c === "settings"),
      ).toBe(true),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    fireEvent.click(agents.getByRole("button", { name: /^Lernen/ }));
    await waitFor(() =>
      expect(location.hash).toBe(`#/tasks?agent=${other.id}`),
    );
    history.replaceState(null, "", "/#/");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    const again = await agentsRegion();
    fireEvent.click(again.getByRole("button", { name: /^Implement/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(session.prompt));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Startup prompt copied. Paste it into your agent chat.",
    );
  });

  it("shows effective startup, a separate copy button and each agent’s menu", async () => {
    fixtures.agents = [
      { ...bot, chat_start: "webhook" },
      other,
      coder,
      { id: "human00000000001", revision: 1, name: "Reviewer", kind: "human" },
    ];
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    render(<Root />);
    const agents = await agentsRegion();
    expect(agents.getByRole("button", { name: /^Bauen/ })).toHaveTextContent("Automatic startup");
    expect(agents.getByRole("button", { name: /^Lernen/ })).toHaveTextContent("Manual start");
    expect(agents.getByRole("button", { name: /^Implement/ })).toHaveTextContent("Manual start");
    expect(agents.getByRole("button", { name: /^Reviewer/ })).toHaveTextContent("Person");
    expect(agents.queryByRole("button", { name: "Copy instructions for Reviewer" })).toBeNull();
    expect(agents.getAllByRole("button", { name: /^Copy instructions for / })).toHaveLength(3);
    const copy = agents.getByRole("button", { name: "Copy instructions for Bauen" });
    await waitFor(() => expect(copy).toBeEnabled());
    fireEvent.click(copy);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(session.prompt));
    expect(location.hash).toBe("#/");
    fireEvent.click(agents.getByRole("button", { name: "More for Implement" }));
    const menu = within(screen.getByRole("dialog", { name: "Implement" }));
    expect(menu.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Open agent",
      "Show tasks",
      "Start in a chat",
      "How to continue in a chat",
    ]);
  });
});
