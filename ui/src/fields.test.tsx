import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AutoTextarea, { singleLine } from "./AutoTextarea";
import ClaimBanner from "./ClaimBanner";
import HoldReasonField from "./HoldReasonField";
import PlainRefs, { plainParts } from "./PlainRefs";
import { crewApi } from "./crewApi";
import type { Claim } from "./projectAgents";
import { resetReferencesForTests } from "./references";
import { resetTrail, trailPosition } from "./trail";

const taskRef = {
  id: "task00000000001",
  collection: "tasks",
  title: "Research: how the launch went viral and what it changed for everyone",
  path: "#/tasks/research-task00000000001",
};
const noteRef = {
  id: "note00000000001",
  collection: "notes",
  title: "Catalog spec",
  path: "#/notes/catalog-spec-note00000000001",
};

beforeEach(() => {
  history.replaceState(null, "", "/#/tasks");
  vi.spyOn(crewApi, "references").mockImplementation(async (ids) =>
    [taskRef, noteRef].filter((ref) => ids.includes(ref.id)),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetReferencesForTests();
  resetTrail();
  history.replaceState(null, "", "/");
});

function Controlled(props: {
  initial?: string;
  onSubmit?: () => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState(props.initial ?? "");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        props.onSubmit?.();
      }}
    >
      <label>
        Title
        <AutoTextarea value={value} onValue={setValue} maxLength={200} />
      </label>
      <button disabled={props.disabled}>Save</button>
    </form>
  );
}

describe("AutoTextarea", () => {
  it("is a one-row textarea without AutoFill that keeps its label", () => {
    render(<Controlled initial="Launch plan" />);
    const field = screen.getByLabelText("Title");
    expect(field.tagName).toBe("TEXTAREA");
    expect(field).toHaveAttribute("rows", "1");
    expect(field).toHaveAttribute("autocomplete", "off");
    expect(field).toHaveAttribute("maxlength", "200");
    expect(field).toHaveValue("Launch plan");
  });
  it("submits on Enter instead of adding a line, unless the save button is disabled", () => {
    const onSubmit = vi.fn();
    const { unmount } = render(<Controlled initial="A" onSubmit={onSubmit} />);
    const field = screen.getByLabelText("Title");
    const enter = fireEvent.keyDown(field, { key: "Enter" });
    expect(enter).toBe(false);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(field, { key: "Enter", shiftKey: true });
    expect(onSubmit).toHaveBeenCalledTimes(2);
    unmount();
    const blocked = vi.fn();
    render(<Controlled initial="A" onSubmit={blocked} disabled />);
    fireEvent.keyDown(screen.getByLabelText("Title"), { key: "Enter" });
    expect(blocked).not.toHaveBeenCalled();
  });
  it("never stores line breaks, typed or pasted", () => {
    expect(singleLine("one\ntwo\r\n  three")).toBe("one two three");
    render(<Controlled />);
    const field = screen.getByLabelText("Title");
    fireEvent.change(field, { target: { value: "a\nb" } });
    expect(field).toHaveValue("a b");
    fireEvent.paste(field, {
      clipboardData: { getData: () => "x\ny", files: [] },
    });
    expect((field as HTMLTextAreaElement).value).not.toMatch(/\n/);
    expect(field).toHaveValue("a bx y");
  });
});

describe("PlainRefs", () => {
  it("splits text into ids, addresses and text", () => {
    expect(
      plainParts("See task00000000001 and https://example.com/x). Done"),
    ).toEqual([
      { kind: "text", text: "See " },
      { kind: "id", id: "task00000000001" },
      { kind: "text", text: " and " },
      { kind: "url", url: "https://example.com/x" },
      { kind: "text", text: "). Done" },
    ]);
  });
  it("links resolved ids by title and Crew addresses, leaving unknown ids plain", async () => {
    render(
      <p data-testid="text">
        <PlainRefs
          text={`Waiting for task00000000001 and ${location.origin}/#/notes/catalog-spec-note00000000001; zzzz00000000009 stays.`}
          max={30}
        />
      </p>,
    );
    const task = await screen.findByRole("link", {
      name: /^Research: how the launch/,
    });
    expect(task.textContent).toBe("Research: how the launch went…");
    expect(task).toHaveAttribute("href", taskRef.path);
    const note = await screen.findByRole("link", { name: "Catalog spec" });
    expect(note).toHaveAttribute(
      "href",
      "#/notes/catalog-spec-note00000000001",
    );
    expect(screen.getByTestId("text")).toHaveTextContent(
      "zzzz00000000009 stays.",
    );
    fireEvent.click(task);
    expect(location.hash).toBe(taskRef.path);
    expect(trailPosition()).toBe(1);
  });
  it("opens other web addresses in a new tab", () => {
    render(<PlainRefs text="See https://example.com/page." />);
    const link = screen.getByRole("link", { name: "https://example.com/page" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});

describe("HoldReasonField", () => {
  function Host({
    initial,
    readOnly,
  }: {
    initial: string;
    readOnly?: boolean;
  }) {
    const [value, setValue] = useState(initial);
    return (
      <>
        <HoldReasonField value={value} onValue={setValue} readOnly={readOnly} />
        <output data-testid="stored">{value}</output>
      </>
    );
  }
  it("opens an empty reason in Edit", () => {
    render(<Host initial="" />);
    expect(screen.getByLabelText("Hold reason")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Edit hold reason" }),
    ).toBeNull();
  });
  it("reads a reason with linked titles, and edits the raw text on a tap", async () => {
    render(<Host initial="Waiting for task00000000001. Assess sets Ready." />);
    const box = screen.getByLabelText("Hold reason");
    expect(box).not.toBeVisible();
    expect(box).toHaveValue("Waiting for task00000000001. Assess sets Ready.");
    const link = await screen.findByRole("link", { name: /^Research: how/ });
    // A link opens its record; it doesn't start editing.
    fireEvent.click(link);
    expect(box).not.toBeVisible();
    fireEvent.click(
      screen.getByText(/Assess sets Ready/, { selector: ".crew-plain-read" }),
    );
    expect(box).toBeVisible();
    expect(box).toHaveFocus();
    fireEvent.change(box, { target: { value: "Waiting for note00000000001" } });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(
      await screen.findByRole("link", { name: "Catalog spec" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("stored")).toHaveTextContent(
      "Waiting for note00000000001",
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit hold reason" }));
    expect(screen.getByLabelText("Hold reason")).toBeVisible();
  });
  it("stays in Read when read-only", () => {
    render(<Host initial="Blocked by legal" readOnly />);
    fireEvent.click(
      screen.getByText("Blocked by legal", { selector: ".crew-plain-read" }),
    );
    expect(screen.getByLabelText("Hold reason")).not.toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Edit hold reason" }),
    ).toBeNull();
  });
});

describe("ClaimBanner", () => {
  const now = Date.parse("2026-11-17T04:00:00Z");
  const expired: Claim = {
    state: "expired",
    by: "Implement · Claude Code · undulating-duck/2 · 9e017204",
    started: "2026-11-16T13:00:00Z",
    until: "2026-11-16T15:00:00Z",
  };
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
  });
  afterEach(() => vi.useRealTimers());

  it("shows an expired claim once, with relative times and details on demand", () => {
    render(
      <ClaimBanner claim={expired} agent="Implement" onRelease={() => {}} />,
    );
    expect(screen.getAllByText(/Claim expired/)).toHaveLength(1);
    expect(screen.getByText("Claim expired · Implement")).toBeInTheDocument();
    const started = screen.getByText("Started 15 h ago");
    expect(started.tagName).toBe("TIME");
    expect(started).toHaveAttribute("datetime", "2026-11-16T13:00:00.000Z");
    expect(started.getAttribute("title")).toMatch(/2026/);
    expect(screen.getByText("expired 13 h ago")).toBeInTheDocument();
    expect(screen.queryByText(/undulating-duck/)).not.toBeVisible();
    expect(screen.queryByRole("button", { name: "Release claim" })).toBeNull();
    const details = screen.getByRole("button", { name: "Details" });
    expect(details).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(details);
    expect(details).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(expired.by)).toBeVisible();
  });
  it("shows a live claim's end and keeps Copy details and Release claim in its menu", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const onRelease = vi.fn();
    render(
      <ClaimBanner
        claim={{
          ...expired,
          state: "live",
          started: "2026-11-17T03:45:00Z",
          until: "2026-11-17T05:45:00Z",
        }}
        agent="Implement"
        onRelease={onRelease}
      />,
    );
    expect(screen.getByText("Claimed · Implement")).toBeInTheDocument();
    expect(screen.getByText("Started 15 min ago")).toBeInTheDocument();
    expect(screen.getByText("ends in 1 h 45 m")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Claim actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy details" }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0][0]).toMatch(
      /^Claimed by Implement · Claude Code · undulating-duck\/2 · 9e017204 · Started /,
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Claim details copied.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Claim actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Release claim" }));
    expect(onRelease).toHaveBeenCalledTimes(1);
  });
  it("offers only Copy details when read-only", () => {
    render(
      <ClaimBanner
        claim={expired}
        agent="Implement"
        readOnly
        onRelease={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Claim actions" }));
    expect(
      screen.getByRole("menuitem", { name: "Copy details" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Release claim" }),
    ).toBeNull();
  });
});
