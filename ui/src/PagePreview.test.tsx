import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PagePreview, { openOutside, publicPagePath } from "./PagePreview";
import Prose from "./Prose";
import { crewApi } from "./crewApi";
import { resetReferencesForTests } from "./references";

const token = "Ab3dEf6hIj9kLm2nOp5qRs8tUv1wXy4z";
const standalone = (on: boolean) =>
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: on && query === "(display-mode: standalone)",
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );

beforeEach(() => {
  vi.spyOn(crewApi, "references").mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetReferencesForTests();
});

describe("publicPagePath", () => {
  it("accepts only this origin's published page links", () => {
    expect(publicPagePath(`${location.origin}/a/${token}`)).toBe(`/a/${token}`);
    expect(publicPagePath(`https://elsewhere.example/a/${token}`)).toBe("");
    expect(publicPagePath(`${location.origin}/a/${token}/files/1`)).toBe("");
    expect(publicPagePath(`${location.origin}/a/short`)).toBe("");
    expect(publicPagePath(`${location.origin}/#/notes`)).toBe("");
    expect(publicPagePath("not a url ::")).toBe("");
  });
});

describe("PagePreview", () => {
  it("frames the page, copies, opens outside and shares from More, and closes on Escape", async () => {
    const url = `${location.origin}/a/${token}`;
    const writeText = vi.fn().mockResolvedValue(undefined);
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText },
      share,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
    });
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this);
    });
    const onClose = vi.fn();
    render(<PagePreview url={url} title="Pricing" onClose={onClose} />);
    const sheet = screen.getByRole("dialog", { name: "Shared page: Pricing" });
    expect(sheet.querySelector("iframe")).toHaveAttribute(
      "src",
      `/a/${token}#in-crew`,
    );
    const more = () =>
      fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    more();
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy", description: "Copy link" }));
    expect(writeText).toHaveBeenCalledWith(url);
    expect(await screen.findByRole("status")).toHaveTextContent("Link copied");
    more();
    fireEvent.click(screen.getByRole("menuitem", { name: "Open in Safari" }));
    expect(clicked).toHaveLength(1);
    expect(clicked[0].href).toBe(url);
    expect(clicked[0].target).toBe("_blank");
    expect(clicked[0].rel).toBe("noopener noreferrer");
    more();
    fireEvent.click(screen.getByRole("menuitem", { name: "Share" }));
    expect(share).toHaveBeenCalledWith({ title: "Pricing", url });
    fireEvent.keyDown(sheet, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("has no Share item without the share sheet", () => {
    vi.stubGlobal("navigator", {
      ...navigator,
      share: undefined,
      userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
    });
    render(
      <PagePreview
        url={`${location.origin}/a/${token}`}
        title="Pricing"
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(screen.queryByRole("menuitem", { name: "Share" })).toBeNull();
    expect(
      screen.getByRole("menuitem", { name: "Open in browser" }),
    ).toBeInTheDocument();
  });

  it("opens outside Crew with no opener or referrer", () => {
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this);
    });
    openOutside("https://example.com/x");
    expect(clicked[0].target).toBe("_blank");
    expect(clicked[0].rel).toBe("noopener noreferrer");
  });
});

describe("Prose links to published pages", () => {
  const body = `See ${location.origin}/a/${token} and https://example.com/docs`;

  it("open in the in-app preview in the home-screen app", () => {
    standalone(true);
    render(<Prose>{body}</Prose>);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
    expect(fireEvent.click(links[0])).toBe(false);
    expect(screen.getByRole("dialog").querySelector("iframe")).toHaveAttribute(
      "src",
      `/a/${token}#in-crew`,
    );
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("stay new-tab links in a browser", () => {
    standalone(false);
    render(<Prose>{body}</Prose>);
    const link = screen.getAllByRole("link")[0];
    link.addEventListener("click", (e) => e.preventDefault());
    fireEvent.click(link);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
