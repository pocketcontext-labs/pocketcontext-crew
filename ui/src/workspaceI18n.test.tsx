// The workspace follows the reader language (0.36.0): navigation, board and
// dialog text are translated, while task titles and other content stay as
// written.
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import CrewWorkspace from "./CrewWorkspace";
import { attachmentsApi } from "./attachmentsApi";
import { crewApi, type Row } from "./crewApi";
import { resetLanguageForTests, setLanguage } from "./i18n";
import { resetReferencesForTests } from "./references";
import { resetSessionGuideForTests } from "./sessionGuide";
import { resetTrail } from "./trail";

const agent: Row = {
  id: "agent0000000001",
  revision: 1,
  name: "Network",
  brief: "",
};
const bucket: Row = {
  id: "bucket000000001",
  revision: 1,
  name: "NETWORK",
  responsible_agent: agent.id,
  purpose: "",
};
const task: Row = {
  id: "task00000000001",
  revision: 3,
  title: "Launch post",
  description: "Introduce our product",
  status: "todo",
  readiness: "ready",
  assigned_agent: agent.id,
  draft: "",
  labels: [],
  links: [],
};

beforeEach(() => {
  history.replaceState(null, "", "/#/tasks");
  const fixtures: Record<string, Row[]> = {
    agents: [agent],
    buckets: [bucket],
    tasks: [task],
    reviews: [],
    notes: [],
    events: [],
    settings: [{ id: "settings0000001", revision: 1, session_guide_off: true }],
  };
  vi.spyOn(crewApi, "serverVersion").mockResolvedValue({
    version: "0.3.1",
    commit: "",
  });
  vi.spyOn(crewApi, "connection").mockResolvedValue({
    kind: "mcp",
    url: "https://crew.example/mcp",
  });
  vi.spyOn(crewApi, "read").mockImplementation(async (c, f = {}) =>
    f.archived ? [] : fixtures[c] || [],
  );
  vi.spyOn(attachmentsApi, "cardThumbnails").mockResolvedValue({});
  vi.spyOn(attachmentsApi, "fileToken").mockResolvedValue("file-token");
  vi.spyOn(crewApi, "references").mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  history.replaceState(null, "", "/");
  vi.restoreAllMocks();
  resetLanguageForTests();
  resetSessionGuideForTests();
  resetReferencesForTests();
  resetTrail();
});

it("shows the board in German and leaves task titles as written", async () => {
  setLanguage("de");
  render(<CrewWorkspace />);
  await screen.findByRole("heading", { name: "Launch post" });
  const nav = within(
    screen.getByRole("navigation", { name: "Arbeitsbereich" }),
  );
  expect(nav.getByRole("link", { name: "Aufgaben" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(nav.getByRole("link", { name: "Notizen" })).toBeTruthy();
  expect(nav.getByRole("link", { name: "Freigaben" })).toBeTruthy();
  expect(
    screen.getByRole("heading", { level: 1, name: "Aufgaben" }),
  ).toBeTruthy();
  expect(screen.getByRole("heading", { name: /Zu erledigen/ })).toBeTruthy();
  expect(
    screen.getByRole("heading", { name: /Wartet auf Freigabe/ }),
  ).toBeTruthy();
  expect(screen.getByRole("button", { name: "＋ Neue Aufgabe" })).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Nach Bereitschaft filtern: Bereit" }),
  ).toBeTruthy();
  expect(document.title).toBe("Aufgaben · PocketContext Crew");
  // Content is never translated.
  expect(screen.getByText("Introduce our product")).toBeTruthy();
});

it("follows the language to Italian and back to English", async () => {
  render(<CrewWorkspace />);
  await screen.findByRole("heading", { name: "Launch post" });
  expect(screen.getByRole("heading", { level: 1, name: "Tasks" })).toBeTruthy();
  // App re-renders the tree on a language change; a fresh render stands in.
  act(() => setLanguage("it"));
  cleanup();
  render(<CrewWorkspace />);
  await screen.findByRole("heading", { name: "Launch post" });
  expect(
    screen.getByRole("heading", { level: 1, name: "Attività" }),
  ).toBeTruthy();
  expect(screen.getByRole("heading", { name: /Da fare/ })).toBeTruthy();
  act(() => setLanguage("en"));
  cleanup();
  render(<CrewWorkspace />);
  await screen.findByRole("heading", { name: "Launch post" });
  expect(screen.getByRole("heading", { level: 1, name: "Tasks" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: /To do/ })).toBeTruthy();
});
