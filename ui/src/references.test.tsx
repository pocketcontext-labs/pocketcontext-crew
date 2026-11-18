import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Prose from "./Prose";
import { crewApi } from "./crewApi";
import {
  crewAddress,
  displayUrl,
  findIds,
  resetReferencesForTests,
} from "./references";
import { resetTrail, trailPosition } from "./trail";

const taskRef = {
  id: "task00000000001",
  collection: "tasks",
  title: "Launch post",
  path: "#/tasks/launch-post-task00000000001",
};
const bucketRef = {
  id: "bucket000000001",
  collection: "buckets",
  title: "NETWORK",
  path: "#/buckets/network-bucket000000001",
  archived: true,
};

beforeEach(() => {
  history.replaceState(null, "", "/#/notes");
  vi.spyOn(crewApi, "references").mockImplementation(async (ids) =>
    [taskRef, bucketRef].filter((ref) => ids.includes(ref.id)),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetReferencesForTests();
  resetTrail();
  history.replaceState(null, "", "/");
});

describe("findIds", () => {
  it("finds whole 15-character ids only", () => {
    const text =
      "See task00000000001, (bucket000000001) and xtask00000000001x. " +
      "Not slug-task00000000001, a/task00000000001, task00000000001.png, " +
      "123456789012345, TASK00000000001 or task000000000012.";
    expect(findIds(text).map((x) => x.id)).toEqual([
      "task00000000001",
      "bucket000000001",
    ]);
  });
});

describe("crewAddress", () => {
  const here = `${location.origin}/`;
  it.each([
    [`${here}#/tasks/launch-post-task00000000001`, "#/tasks/launch-post-task00000000001", "task00000000001"],
    [`${here}#/tasks/task00000000001`, "#/tasks/task00000000001", "task00000000001"],
    ["#/notes/a-note00000000001", "#/notes/a-note00000000001", "note00000000001"],
    [`${here}#/approvals/review000000001`, "#/approvals/review000000001", "review000000001"],
    [`${here}#/reviews/review000000001`, "#/approvals/review000000001", "review000000001"],
    [`${here}#/artifacts/pricing-artifact0000001`, "#/shared/artifact0000001", "artifact0000001"],
    [`${here}#/buckets/network-bucket000000001`, "#/buckets/network-bucket000000001", "bucket000000001"],
    [`${here}#/tasks/t-task00000000001?file=file00000000001`, "#/tasks/t-task00000000001?file=file00000000001", "file00000000001"],
    [`${here}#/tasks?label=ops`, "#/tasks?label=ops", ""],
  ])("reads %s as an in-app address", (href, hash, id) => {
    expect(crewAddress(href)).toEqual({ hash, id });
  });
  it.each([
    "https://other.example/#/tasks/task00000000001",
    "javascript:alert(1)",
    "mailto:someone@example.com",
    `${location.origin}/elsewhere#/tasks/task00000000001`,
    `${location.origin}/?x=1#/tasks/task00000000001`,
    "#/nowhere/at-all",
  ])("leaves %s alone", (href) => {
    expect(crewAddress(href)).toBeNull();
  });
});

describe("displayUrl", () => {
  it("keeps short URLs and shortens long ones", () => {
    expect(displayUrl("https://example.com/a")).toBe("https://example.com/a");
    const long = "https://example.com/" + "segment/".repeat(12) + "end-of-it";
    const shown = displayUrl(long);
    expect(shown.length).toBe(60);
    expect(shown).toContain("…");
    expect(shown.startsWith("example.com/")).toBe(true);
    expect(shown.endsWith("ment/end-of-it")).toBe(true);
  });
});

describe("Prose links", () => {
  it("titles resolved ids (also in inline code), leaves the rest as written, in one request", async () => {
    render(
      <>
        <Prose>
          {"Done in task00000000001 for bucket000000001; unknown zzzzzzzzzzzzzzz."}
        </Prose>
        <Prose>
          {"Again task00000000001 in `task00000000001` and [own text](https://example.com) task00000000001\n\n```\ntask00000000001\n```"}
        </Prose>
      </>,
    );
    const links = await screen.findAllByRole("link", { name: "Launch post" });
    expect(links).toHaveLength(4);
    expect(links[0]).toHaveAttribute("href", taskRef.path);
    const bucket = screen.getByRole("link", { name: "NETWORK" });
    expect(bucket).toHaveAttribute("title", "Bucket (archived) · bucket000000001");
    expect(screen.getByText(/unknown zzzzzzzzzzzzzzz\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "own text" })).toHaveAttribute(
      "href",
      "https://example.com",
    );
    expect(document.querySelectorAll("code")).toHaveLength(1);
    for (const code of document.querySelectorAll("code"))
      expect(code.textContent?.trim()).toBe("task00000000001");
    expect(crewApi.references).toHaveBeenCalledTimes(1);
  });
  it("opens Crew links in the app as the next step of the trail", async () => {
    const listener = vi.fn();
    window.addEventListener("hashchange", listener);
    render(
      <Prose>
        {`Pasted ${location.origin}/#/tasks/old-slug-task00000000001 and [the plan](#/tasks/task00000000001)`}
      </Prose>,
    );
    const pasted = await screen.findByRole("link", { name: "Launch post" });
    expect(pasted).not.toHaveAttribute("target");
    expect(pasted).toHaveAttribute("href", "#/tasks/old-slug-task00000000001");
    expect(screen.getByRole("link", { name: "the plan" })).not.toHaveAttribute(
      "target",
    );
    fireEvent.click(pasted);
    expect(location.hash).toBe("#/tasks/old-slug-task00000000001");
    expect(trailPosition()).toBe(1);
    expect(listener).toHaveBeenCalledTimes(1);
    // A modified click is left to the browser (a new tab).
    fireEvent.click(screen.getByRole("link", { name: "the plan" }), {
      ctrlKey: true,
    });
    expect(location.hash).toBe("#/tasks/old-slug-task00000000001");
    window.removeEventListener("hashchange", listener);
  });
  it("opens external links in a new tab and never links other schemes", () => {
    const long = "https://example.com/" + "segment/".repeat(12) + "end";
    render(
      <Prose>
        {`Visit https://example.com/page, ${long}, write to someone@example.com, [mail](mailto:a@example.com), [bad](javascript:alert(1)) and [file](file:///etc/passwd).`}
      </Prose>,
    );
    const page = screen.getByRole("link", { name: "https://example.com/page" });
    expect(page).toHaveAttribute("target", "_blank");
    expect(page).toHaveAttribute("rel", "noopener noreferrer");
    const shortened = screen.getByRole("link", { name: displayUrl(long) });
    expect(shortened).toHaveAttribute("href", long);
    expect(shortened).toHaveAttribute("title", long);
    expect(
      screen.getByRole("link", { name: "someone@example.com" }),
    ).toHaveAttribute("href", "mailto:someone@example.com");
    const mail = screen.getByRole("link", { name: "mail" });
    expect(mail).toHaveAttribute("href", "mailto:a@example.com");
    expect(mail).not.toHaveAttribute("target");
    expect(screen.queryByRole("link", { name: "bad" })).toBeNull();
    expect(screen.queryByRole("link", { name: "file" })).toBeNull();
    expect(screen.getByText(/bad/)).toBeInTheDocument();
  });
  it("links ids in inline code, keeps unknown ones code, leaves fenced code", async () => {
    render(
      <Prose>
        {"Crew task: [Launch post](https://crew.example/#/tasks/launch-post-task00000000001) (`task00000000001`). " +
          "Bucket `bucket000000001`, unknown `zzzzzzzzzzzzzzz`, not one id `task00000000001 and more`.\n\n" +
          "```\ntask00000000001\n```"}
      </Prose>,
    );
    // Beside its own link: the id stays the text (as code), the title is the tooltip.
    const beside = await screen.findByRole("link", { name: "task00000000001" });
    expect(beside).toHaveClass("crew-ref");
    expect(beside).toHaveAttribute("href", taskRef.path);
    expect(beside).toHaveAttribute("title", "Launch post · Task · task00000000001");
    expect(beside.querySelector("code")?.textContent).toBe("task00000000001");
    // The written title link is untouched (another origin stays external).
    expect(screen.getByRole("link", { name: "Launch post" })).toHaveAttribute(
      "href",
      "https://crew.example/#/tasks/launch-post-task00000000001",
    );
    // The only mention reads as the title.
    expect(screen.getByRole("link", { name: "NETWORK" })).toHaveAttribute(
      "href",
      bucketRef.path,
    );
    const codes = [...document.querySelectorAll(".crew-prose code")].map(
      (code) => [code.closest("a") !== null, code.textContent?.trim()],
    );
    expect(codes).toEqual([
      [true, "task00000000001"],
      [false, "zzzzzzzzzzzzzzz"],
      [false, "task00000000001 and more"],
      [false, "task00000000001"],
    ]);
    expect(document.querySelector("pre a")).toBeNull();
    expect(crewApi.references).toHaveBeenCalledTimes(1);
    expect(vi.mocked(crewApi.references).mock.calls[0][0].sort()).toEqual([
      "bucket000000001",
      "task00000000001",
      "zzzzzzzzzzzzzzz",
    ]);
  });
  it("keeps a bare id beside its own link as the id", async () => {
    render(
      <Prose>
        {"See [the post](#/tasks/launch-post-task00000000001) (task00000000001) and later task00000000001; " +
          "[elsewhere](https://example.com/x) task00000000001."}
      </Prose>,
    );
    const beside = await screen.findByRole("link", { name: "task00000000001" });
    expect(beside).toHaveAttribute("title", "Launch post · Task · task00000000001");
    expect(beside.querySelector("code")).toBeNull();
    // Not beside a link to the same record: the title.
    expect(screen.getAllByRole("link", { name: "Launch post" })).toHaveLength(2);
  });
  it("keeps ids plain when the resolver fails", async () => {
    vi.mocked(crewApi.references).mockRejectedValue(new Error("offline"));
    render(<Prose>{"See task00000000001."}</Prose>);
    await vi.waitFor(() => expect(crewApi.references).toHaveBeenCalled());
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("See task00000000001.")).toBeInTheDocument();
  });
});
