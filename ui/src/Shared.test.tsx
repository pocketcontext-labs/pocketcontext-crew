import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
import Shared, { PUBLISH_RISK, artifactUrl } from "./Shared";

const Prose = ({ children }: { children: string }) => <div>{children}</div>;
const note = { id: "note00000000001", revision: 1, title: "Source note" };

describe("Shared", () => {
  beforeEach(() => {
    read.mockReset();
    artifactLinks.mockReset();
    write.mockReset();
  });

  it("publishes a draft from the owner's page with the risk line", async () => {
    read.mockResolvedValue([
      {
        id: "art000000000001",
        revision: 1,
        title: "Pricing",
        body: "Hi",
        status: "draft",
        sources: [note.id],
      },
    ]);
    artifactLinks.mockResolvedValue([]);
    write.mockResolvedValue({});
    render(<Shared notes={[note]} tasks={[]} Prose={Prose} />);
    expect(await screen.findByText("Pricing")).toBeInTheDocument();
    expect(screen.getByText(PUBLISH_RISK)).toBeInTheDocument();
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

  it("shows the link, pending changes, Replace content and Revoke for a published artifact", async () => {
    read.mockResolvedValue([
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
    ]);
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
    fireEvent.click(screen.getByRole("button", { name: "Replace content" }));
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

  it("builds links from the page origin without a domain", () => {
    expect(
      artifactUrl({ id: "x", token: "t", link_path: "/a/t", link: "" }),
    ).toBe(`${location.origin}/a/t`);
    expect(artifactUrl(undefined)).toBe("");
  });
});
