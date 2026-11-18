// The pages area follows the chosen language (Crew 0.36.0): reader labels
// are translated, record titles and other content never are.
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import Archive from "./Archive";
import DialogHeader, { ListNavCluster } from "./DialogHeader";
import type { Row } from "./crewApi";
import { resetLanguageForTests, setLanguage } from "./i18n";

afterEach(() => {
  cleanup();
  resetLanguageForTests();
});

const archived = (): Record<string, Row[]> => ({
  tasks: [
    {
      id: "task00000000001",
      revision: 2,
      title: "Close the books",
      labels: ["Finance"],
      archived: true,
      archived_at: new Date(Date.now() - 5 * 60_000).toISOString(),
      archived_by: "owner",
    },
  ],
  notes: [],
  buckets: [],
  agents: [],
});

function renderArchive() {
  return render(
    <Archive
      archived={archived()}
      buckets={[]}
      busy={false}
      restore={() => undefined}
    />,
  );
}

it("renders the Archive in German and keeps the record title", () => {
  setLanguage("de");
  renderArchive();
  expect(screen.getByRole("tab", { name: /Aufgaben/ })).toBeTruthy();
  expect(screen.getByRole("tab", { name: /Inaktive Agenten/ })).toBeTruthy();
  expect(screen.getByPlaceholderText("Nach Titel suchen")).toBeTruthy();
  expect(screen.getByRole("status")).toHaveTextContent("1 Eintrag");
  expect(screen.getByText("Close the books")).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Close the books wiederherstellen" }),
  ).toBeTruthy();
  expect(document.querySelector(".crew-archive-list small")).toHaveTextContent(
    "Archiviert vor 5 Min. von owner",
  );
});

it("renders the Archive in Italian and switches back to English live", () => {
  setLanguage("it");
  renderArchive();
  expect(screen.getByRole("tab", { name: /Agenti inattivi/ })).toBeTruthy();
  expect(
    screen.getByRole("option", { name: "Tutte le etichette" }),
  ).toBeTruthy();
  expect(document.querySelector(".crew-archive-list small")).toHaveTextContent(
    "Archiviato 5 min fa da owner",
  );
  expect(screen.getByText("Close the books")).toBeTruthy();
  // The label is user content: never translated.
  expect(screen.getByRole("option", { name: "Finance" })).toBeTruthy();
  act(() => setLanguage("en"));
  cleanup();
  renderArchive();
  expect(screen.getByRole("tab", { name: /Inactive agents/ })).toBeTruthy();
  expect(document.querySelector(".crew-archive-list small")).toHaveTextContent(
    "Archived 5 min ago by owner",
  );
});

it("translates the dialog header but not the title", () => {
  setLanguage("de");
  render(
    <DialogHeader
      title="Quarterly plan"
      menu={[{ label: "Copy link", icon: "link", onSelect: () => undefined }]}
      close={() => undefined}
      listNav={<ListNavCluster noun="task" index={2} count={12} />}
    />,
  );
  expect(screen.getByRole("heading", { name: "Quarterly plan" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Dialog schließen" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Zurück" })).toBeTruthy();
  expect(screen.getByRole("group", { name: "Aufgabe 3 von 12" })).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Vorherige Aufgabe (K)" }),
  ).toBeTruthy();
  expect(screen.getByRole("button", { name: "Weitere Aktionen" })).toBeTruthy();
});
