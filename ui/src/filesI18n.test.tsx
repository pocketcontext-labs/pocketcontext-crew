// The files, help and Guide areas follow the reader language; file names and
// other user content stay as they are.
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import Guide from "./Guide";
import Help from "./Help";
import { helpContent } from "./helpContent";
import { resetLanguageForTests, setLanguage } from "./i18n";
import Lightbox, { type LightboxItem } from "./Lightbox";

const items: LightboxItem[] = [
  { id: "a", src: "blob:http://localhost/a", alt: "Quartalsbericht.png" },
  { id: "b", src: "blob:http://localhost/b", alt: "wide.png" },
];

afterEach(() => {
  cleanup();
  resetLanguageForTests();
});

describe("files and help translations", () => {
  it("shows the Guide and its help topics in German", () => {
    setLanguage("de");
    render(<Guide />);
    expect(
      screen.getByRole("heading", { name: "So funktioniert Crew" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Wartet auf Freigabe" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Agenten müssen zuerst verbunden werden."),
    ).toBeInTheDocument();
    expect(screen.getByText(/Erstelle einen Agenten und benenne ihn/)).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Aufgaben öffnen" }),
    ).toBeInTheDocument();
  });

  it("follows a language switch in the help table without a reload", () => {
    expect(helpContent.done.name).toBe("Done");
    setLanguage("it");
    expect(helpContent.done.name).toBe("Fatto");
    expect(Object.hasOwn(helpContent, "done")).toBe(true);
    setLanguage("de");
    expect(helpContent.done.name).toBe("Erledigt");
  });

  it("labels the help button and popover in Italian", () => {
    setLanguage("it");
    render(<Help topic="claim" />);
    fireEvent.click(
      screen.getByRole("button", { name: "Cos'è una presa in carico?" }),
    );
    expect(
      screen.getByRole("link", { name: "Scopri di più" }),
    ).toBeInTheDocument();
  });

  it("translates the viewer controls but never the file name", () => {
    setLanguage("de");
    render(<Lightbox items={items} index={0} onClose={() => {}} />);
    expect(
      screen.getByRole("button", { name: "Nächstes Bild" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Quartalsbericht.png" }),
    ).toBeInTheDocument();
  });

  it("keeps English unchanged", () => {
    render(<Guide />);
    expect(
      screen.getByRole("heading", { name: "How Crew works" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Agents must be connected first.").closest("li"),
    ).toHaveTextContent(
      /^Agents must be connected first\. Connect an agent shows the steps for this Crew\.$/,
    );
    expect(
      screen.getByText("One agent per project.").closest("li"),
    ).toHaveTextContent(
      /^One agent per project\. Create an agent and name it after the project\. You can start it in a connected chat\.$/,
    );
  });
});
