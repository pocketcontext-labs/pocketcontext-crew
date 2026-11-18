import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const read = vi.fn();
const artifactLinks = vi.fn();
const write = vi.fn();
vi.mock("./crewApi", async (original) => ({
  ...(await original<typeof import("./crewApi")>()),
  crewApi: {
    read: (...a: unknown[]) => read(...a),
    artifactLinks: () => artifactLinks(),
    write: (...a: unknown[]) => write(...a),
  },
}));
import Shared, { PUBLISH_RISK, artifactUrl, expiryFrom } from "./Shared";

/** Active rows for the default read, none for the archived read. */
const only =
  (rows: unknown[]) =>
  (_collection: string, filters?: { archived?: boolean }) =>
    Promise.resolve(filters?.archived ? [] : rows);
const Prose = ({ children }: { children: string }) => <div>{children}</div>;
const note = { id: "note00000000001", revision: 1, title: "Source note" };

describe("Shared", () => {
  afterEach(cleanup);
  beforeEach(() => {
    read.mockReset();
    artifactLinks.mockReset();
    write.mockReset();
  });

  it("publishes a draft from the owner's page with the risk line", async () => {
    read.mockImplementation(
      only([
        {
          id: "art000000000001",
          revision: 1,
          title: "Pricing",
          body: "Hi",
          status: "draft",
          sources: [note.id],
        },
      ]),
    );
    artifactLinks.mockResolvedValue([]);
    write.mockResolvedValue({});
    render(<Shared notes={[note]} tasks={[]} Prose={Prose} />);
    expect(await screen.findByText("Pricing")).toBeInTheDocument();
    expect(screen.getByText(PUBLISH_RISK)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /in a new tab/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Source note" })).toHaveAttribute(
      "href",
      expect.stringContaining(note.id),
    );
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() =>
      expect(write).toHaveBeenCalledWith(
        "artifact.publish",
        {},
        expect.objectContaining({ id: "art000000000001" }),
      ),
    );
  });

  it("opens a new empty draft focused from Home's + ready to write", async () => {
    read.mockImplementation(
      only([
        {
          id: "art000000000002",
          revision: 1,
          title: "Fresh page",
          body: "",
          status: "draft",
        },
        {
          id: "art000000000003",
          revision: 1,
          title: "Empty but not focused",
          body: "",
          status: "draft",
        },
      ]),
    );
    artifactLinks.mockResolvedValue([]);
    render(
      <Shared notes={[]} tasks={[]} focus="art000000000002" Prose={Prose} />,
    );
    expect(await screen.findByLabelText("Artifact page")).toHaveValue("");
    // Only the focused new draft opens its editor.
    expect(screen.getAllByLabelText("Artifact page")).toHaveLength(1);
    expect(screen.getByLabelText("Artifact title")).toHaveValue("Fresh page");
  });

  it("shows the link, pending changes, Update content and Revoke for a published artifact", async () => {
    read.mockImplementation(
      only([
        {
          id: "art000000000002",
          revision: 4,
          title: "Live",
          body: "New",
          status: "published",
          pending_changes: true,
          published_at: "2026-11-12T10:00:00Z",
          published_revision: 2,
          view_count: 3,
        },
      ]),
    );
    artifactLinks.mockResolvedValue([
      {
        id: "art000000000002",
        token: "t",
        link_path: "/a/t",
        link: "https://crew.example.com/a/t",
      },
    ]);
    write.mockResolvedValue({});
    render(<Shared notes={[]} tasks={[]} Prose={Prose} />);
    expect(
      await screen.findByDisplayValue("https://crew.example.com/a/t"),
    ).toBeInTheDocument();
    expect(screen.getByText("Changes not live")).toBeInTheDocument();
    expect(screen.getByText(/3 views/)).toBeInTheDocument();
    // Open shows what recipients see in a new tab, without referrer or opener.
    const open = screen.getByRole("link", { name: "Open Live in a new tab" });
    expect(open).toHaveAttribute("href", "https://crew.example.com/a/t");
    expect(open).toHaveAttribute("target", "_blank");
    expect(open).toHaveAttribute("rel", "noopener noreferrer");
    expect(open).toHaveTextContent("Open");
    fireEvent.click(
      screen.getByRole("button", { name: "Update content (same link)" }),
    );
    await waitFor(() =>
      expect(write).toHaveBeenCalledWith(
        "artifact.replace",
        {},
        expect.objectContaining({ revision: 4 }),
      ),
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(await screen.findByRole("button", { name: "Revoke" }));
    await waitFor(() =>
      expect(write).toHaveBeenCalledWith(
        "artifact.revoke",
        {},
        expect.anything(),
      ),
    );
  });

  it("opens a live page in the in-app preview in the home-screen app, and Back returns with the filter and scroll kept", async () => {
    const token = "Ab3dEf6hIj9kLm2nOp5qRs8tUv1wXy4z";
    vi.stubGlobal(
      "matchMedia",
      (query: string) =>
        ({
          matches: query === "(display-mode: standalone)",
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    );
    read.mockImplementation(
      only([
        {
          id: "art000000000002",
          revision: 4,
          title: "Live",
          published_title: "Live page",
          status: "published",
          published_at: "2026-11-12T10:00:00Z",
          published_revision: 1,
        },
      ]),
    );
    artifactLinks.mockResolvedValue([
      {
        id: "art000000000002",
        token,
        link_path: `/a/${token}`,
        link: `${location.origin}/a/${token}`,
      },
    ]);
    history.replaceState(null, "", "#/shared?show=live");
    render(<Shared notes={[]} tasks={[]} Prose={Prose} />);
    const open = await screen.findByRole("link", {
      name: "Open Live in a new tab",
    });
    window.scrollTo = vi.fn();
    document.documentElement.scrollTop = 240;
    expect(fireEvent.click(open)).toBe(false); // the app window stays on Crew
    const sheet = screen.getByRole("dialog", { name: "Shared page: Live page" });
    const frame = sheet.querySelector("iframe")!;
    expect(frame).toHaveAttribute("src", `/a/${token}#in-crew`);
    expect(frame.getAttribute("sandbox")).toBe(
      "allow-same-origin allow-popups allow-popups-to-escape-sandbox",
    );
    expect(frame).toHaveAttribute("title", "Live page");
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(
      screen.getByRole("menuitem", { name: "Copy link" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /^Open in (Safari|browser)$/ }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to Shared" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    // The page under the sheet never unmounted: filters and scroll stay.
    expect(screen.getByRole("button", { name: /^Live/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(location.hash).toBe("#/shared?show=live");
    expect(document.documentElement.scrollTop).toBe(240);
    expect(read).toHaveBeenCalledTimes(2); // no reload
    vi.unstubAllGlobals();
    history.replaceState(null, "", "#/");
  });

  it("keeps Open as a new tab in a browser", async () => {
    read.mockImplementation(
      only([
        {
          id: "art000000000002",
          revision: 4,
          title: "Live",
          status: "published",
          published_revision: 1,
        },
      ]),
    );
    artifactLinks.mockResolvedValue([
      { id: "art000000000002", token: "t", link_path: "/a/t", link: "" },
    ]);
    render(<Shared notes={[]} tasks={[]} Prose={Prose} />);
    const open = await screen.findByRole("link", {
      name: "Open Live in a new tab",
    });
    open.addEventListener("click", (e) => e.preventDefault()); // jsdom has no navigation
    fireEvent.click(open);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("filters by state, hides archived by default and keeps the choice in the address", async () => {
    history.replaceState(null, "", "#/shared");
    read.mockImplementation((_c: string, f?: { archived?: boolean }) =>
      Promise.resolve(
        f?.archived
          ? [
              {
                id: "art000000000009",
                revision: 2,
                title: "Old draft",
                status: "draft",
                state: "archived",
                archived: true,
              },
            ]
          : [
              {
                id: "art000000000003",
                revision: 1,
                title: "Draft one",
                status: "draft",
                state: "draft",
              },
              {
                id: "art000000000004",
                revision: 3,
                title: "Gone",
                status: "published",
                state: "expired",
                expires_at: "2026-11-01T00:00:00Z",
                published_revision: 1,
              },
            ],
      ),
    );
    artifactLinks.mockResolvedValue([]);
    write.mockResolvedValue({});
    render(<Shared notes={[]} tasks={[]} Prose={Prose} />);
    expect(await screen.findByText("Draft one")).toBeInTheDocument();
    expect(screen.queryByText("Gone")).not.toBeInTheDocument();
    expect(screen.queryByText("Old draft")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Archived/ }));
    expect(await screen.findByText("Old draft")).toBeInTheDocument();
    expect(location.hash).toBe("#/shared?show=drafts,live,archived");
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() =>
      expect(write).toHaveBeenCalledWith(
        "artifact.restore",
        {},
        expect.objectContaining({ id: "art000000000009" }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: /^Revoked\/expired/ }));
    expect(await screen.findByText("Gone")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /in a new tab/ })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Publish again with a new link" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    await waitFor(() =>
      expect(write).toHaveBeenCalledWith(
        "artifact.archive",
        {},
        expect.objectContaining({ id: "art000000000004" }),
      ),
    );
    history.replaceState(null, "", "#/");
  });

  it("asks replace or new for an update draft and discards drafts after confirming", async () => {
    read.mockImplementation((_c: string, f?: { archived?: boolean }) =>
      Promise.resolve(
        f?.archived
          ? []
          : [
              {
                id: "art000000000005",
                revision: 1,
                title: "Revised",
                status: "draft",
                state: "draft",
                replaces: "art000000000006",
              },
              {
                id: "art000000000006",
                revision: 2,
                title: "Live original",
                status: "published",
                state: "published",
                published_revision: 1,
              },
            ],
      ),
    );
    artifactLinks.mockResolvedValue([]);
    write.mockResolvedValue({});
    render(<Shared notes={[]} tasks={[]} Prose={Prose} />);
    expect(await screen.findByText("Update of:")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: "Replace the existing link's content",
      }),
    );
    await waitFor(() =>
      expect(write).toHaveBeenCalledWith(
        "artifact.publish",
        { mode: "replace" },
        expect.objectContaining({ id: "art000000000005" }),
      ),
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(await screen.findByRole("button", { name: "Discard" }));
    await waitFor(() =>
      expect(write).toHaveBeenCalledWith(
        "artifact.archive",
        {},
        expect.objectContaining({ id: "art000000000005" }),
      ),
    );
  });

  it("says Merged into for an archived update draft whose content went live, and Update of for a discarded one", async () => {
    history.replaceState(null, "", "#/shared?show=live,archived");
    read.mockImplementation((_c: string, f?: { archived?: boolean }) =>
      Promise.resolve(
        f?.archived
          ? [
              {
                id: "art000000000007",
                revision: 3,
                title: "Merged revision",
                status: "draft",
                state: "archived",
                archived: true,
                replaces: "art000000000006",
                merged_into: "art000000000006",
                merged_at: "2026-11-12 10:00:00.000Z",
              },
              {
                id: "art000000000008",
                revision: 2,
                title: "Discarded revision",
                status: "draft",
                state: "archived",
                archived: true,
                replaces: "art000000000006",
                merged_into: "",
              },
            ]
          : [
              {
                id: "art000000000006",
                revision: 2,
                title: "Live original",
                status: "published",
                state: "published",
                published_revision: 2,
              },
            ],
      ),
    );
    artifactLinks.mockResolvedValue([]);
    render(<Shared notes={[]} tasks={[]} Prose={Prose} />);
    const merged = (await screen.findByText("Merged revision")).closest("li")!;
    const discarded = screen.getByText("Discarded revision").closest("li")!;
    expect(merged).toHaveTextContent(/Merged into Live original \S/);
    expect(merged).not.toHaveTextContent("Update of:");
    expect(merged).toHaveTextContent(
      "Its content is live in that link. Restore brings back this draft only; the link does not change.",
    );
    expect(merged.querySelector('a[href="#/shared/art000000000006"]')).not.toBeNull();
    expect(discarded).toHaveTextContent("Update of: Live original");
    expect(discarded).not.toHaveTextContent("Merged into");
    history.replaceState(null, "", "#/");
  });

  it("steps a focused artifact through the Shared list as shown (0.35.0)", async () => {
    const art = (n: number, extra = {}) => ({
      id: `art00000000000${n}`,
      revision: 1,
      title: `Page ${n}`,
      body: "Body",
      status: "draft",
      ...extra,
    });
    read.mockImplementation((_c: string, f?: { archived?: boolean }) =>
      Promise.resolve(
        f?.archived
          ? [art(4, { archived: true, state: "archived" })]
          : [art(1), art(2), art(3)],
      ),
    );
    artifactLinks.mockResolvedValue([]);
    history.replaceState(null, "", "/#/shared/art000000000002");
    const view = render(
      <Shared notes={[]} tasks={[]} focus="art000000000002" Prose={Prose} />,
    );
    const group = await screen.findByRole("group", {
      name: "shared page 2 of 3",
    });
    expect(group.closest("li")).toHaveAttribute("id", "artifact-art000000000002");
    // Only the focused artifact has the capsule; every title opens its own.
    expect(screen.getAllByRole("group", { name: /^shared page/ })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Page 1" })).toHaveAttribute(
      "href",
      "#/shared/art000000000001",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Next shared page (J)" }),
    );
    expect(location.hash).toBe("#/shared/art000000000003");
    // K steps back.
    fireEvent.keyDown(document.body, { key: "k" });
    expect(location.hash).toBe("#/shared/art000000000001");
    // The last shown artifact: next is disabled in place, no wrapping.
    view.rerender(
      <Shared notes={[]} tasks={[]} focus="art000000000003" Prose={Prose} />,
    );
    await screen.findByRole("group", { name: "shared page 3 of 3" });
    expect(
      screen.getByRole("button", { name: "Next shared page (J)" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Previous shared page (K)" }),
    ).toBeEnabled();
    history.replaceState(null, "", "/#/shared/art000000000003");
    fireEvent.keyDown(document.body, { key: "j" });
    expect(location.hash).toBe("#/shared/art000000000003");
    // A focused artifact the filters hide is shown at its place in the list.
    view.rerender(
      <Shared notes={[]} tasks={[]} focus="art000000000004" Prose={Prose} />,
    );
    await screen.findByRole("group", { name: "shared page 4 of 4" });
    history.replaceState(null, "", "#/");
  });

  it("turns expiry choices into times", () => {
    const now = Date.UTC(2026, 10, 12, 12);
    expect(expiryFrom("none", "", now)).toBe("");
    expect(expiryFrom("7", "", now)).toBe("2026-11-19T12:00:00.000Z");
    expect(expiryFrom("30", "", now)).toBe("2026-12-12T12:00:00.000Z");
    expect(new Date(expiryFrom("date", "2026-12-01", now)).getDate()).toBe(1);
  });

  it("builds links from the page origin without a domain", () => {
    expect(
      artifactUrl({ id: "x", token: "t", link_path: "/a/t", link: "" }),
    ).toBe(`${location.origin}/a/t`);
    expect(artifactUrl(undefined)).toBe("");
  });
});
