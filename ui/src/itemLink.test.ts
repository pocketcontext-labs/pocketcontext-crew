import { afterEach, describe, expect, it } from "vitest";
import {
  boardColumnFromHash,
  boardColumnHash,
  boardOnHoldHash,
  isCanonicalViewStateHash,
  connectSectionFromHash,
  connectSectionHash,
  defaultViewState,
  isItemHash,
  legacyRedirect,
  loginReturnHash,
  parseItemHash,
  viewFromHash,
  viewStateFromHash,
  viewStateHash,
  oauthTargetFromHash,
  rememberLoginReturn,
  safeOAuthTarget,
  takeLoginReturn,
} from "./itemLink";

const target = "/oauth/authorize?client_id=abc&state=x%2By";
const hash = "#/signin?next=" + encodeURIComponent(target);

afterEach(() => localStorage.clear());

describe("safeOAuthTarget", () => {
  it("accepts the authorize path with a query", () => {
    expect(safeOAuthTarget(target)).toBe(target);
  });
  it.each([
    ["no query", "/oauth/authorize"],
    ["empty query", "/oauth/authorize?"],
    ["other path", "/oauth/connections?x=1"],
    ["longer path", "/oauth/authorize/x?y=1"],
    ["prefix path", "/oauth/authorizeX?y=1"],
    ["protocol relative", "//evil.example/oauth/authorize?x=1"],
    ["absolute", "https://evil.example/oauth/authorize?x=1"],
    ["same-origin absolute", location.origin + "/oauth/authorize?x=1"],
    ["backslash", "/\\evil.example/oauth/authorize?x=1"],
    ["backslash in query", "/oauth/authorize?x=\\1"],
    ["dot segments", "/oauth/../oauth/authorize?x=1"],
    ["encoded slash", "/oauth%2Fauthorize?x=1"],
    ["encoded dots", "/oauth/%2e%2e/oauth/authorize?x=1"],
    ["fragment", "/oauth/authorize?x=1#y"],
    ["tab", "/oauth/authorize?x=\t1"],
    ["newline", "/oauth/authorize?x=1\n"],
    ["space", "/oauth/authorize?x 1"],
    ["javascript", "javascript:alert(1)//oauth/authorize?x=1"],
    ["oversized", "/oauth/authorize?" + "x".repeat(16384)],
    ["not a string", 42],
  ])("rejects %s", (_name, value) => {
    expect(safeOAuthTarget(value)).toBeNull();
  });
});

describe("oauthTargetFromHash", () => {
  it("reads one encoded target", () => {
    expect(oauthTargetFromHash(hash)).toBe(target);
  });
  it.each([
    ["no next", "#/signin"],
    ["empty next", "#/signin?next="],
    ["two nexts", hash + "&next=" + encodeURIComponent(target)],
    ["hostile next", "#/signin?next=" + encodeURIComponent("//evil.example")],
    ["other route", "#/signinx?next=" + encodeURIComponent(target)],
  ])("rejects %s", (_name, value) => {
    expect(oauthTargetFromHash(value)).toBeNull();
  });
});

describe("stored return target", () => {
  const put = (value: unknown, expires: unknown = Date.now() + 60_000) =>
    localStorage.setItem(
      "pocketcontext.crew.login_return",
      JSON.stringify({ hash: value, expires }),
    );

  it("normalizes and round-trips a sign-in route once", () => {
    const remembered = loginReturnHash(hash)!;
    expect(remembered).toBe(hash);
    rememberLoginReturn(remembered);
    expect(takeLoginReturn()).toBe(hash);
    expect(takeLoginReturn()).toBeNull();
  });
  it("does not remember an unsafe sign-in route", () => {
    expect(
      loginReturnHash("#/signin?next=" + encodeURIComponent("//evil.example")),
    ).toBeNull();
  });
  it.each([
    ["hostile target", "#/signin?next=" + encodeURIComponent("//evil.example")],
    ["other path", "#/signin?next=" + encodeURIComponent("/api/x?y=1")],
    ["non-canonical encoding", "#/signin?next=/oauth/authorize%3Fx=1"],
    ["extra parameter", hash + "&x=1"],
    ["a bare target", target],
  ])("refuses a stored %s", (_name, value) => {
    put(value);
    expect(takeLoginReturn()).toBeNull();
    expect(localStorage.length).toBe(0);
  });
  it("keeps the expiry rules", () => {
    put(hash, Date.now() - 1);
    expect(takeLoginReturn()).toBeNull();
    put(hash, Date.now() + 16 * 60 * 1000);
    expect(takeLoginReturn()).toBeNull();
  });
});

describe("Tasks and Notes address state", () => {
  const bucketId = "bucket000000001";
  const agentId = "agent0000000001";
  it("reads views with and without a query", () => {
    expect(viewFromHash("#/notes")).toBe("memory");
    expect(viewFromHash(`#/notes?bucket=${bucketId}`)).toBe("memory");
    expect(viewFromHash("#/tasks")).toBe("board");
    expect(viewFromHash(`#/tasks?agent=${agentId}`)).toBe("board");
    expect(viewFromHash("#/tasksx")).toBe("home");
    expect(viewFromHash("#/notesx")).toBe("home");
  });
  it("shows a valid item link over its own list and a malformed one over Home", () => {
    expect(viewFromHash("#/tasks/launch-post-task00000000001")).toBe("board");
    expect(viewFromHash("#/tasks/task00000000001")).toBe("board");
    expect(viewFromHash("#/notes/voice-guide-note00000000001")).toBe("memory");
    expect(viewFromHash("#/notes/x")).toBe("home");
    expect(viewFromHash("#/tasks/task00000000001/extra")).toBe("home");
    expect(viewFromHash("#/tasks/task00000000001?agent=x")).toBe("home");
  });
  it.each([
    ["#/team", "#/tasks"],
    ["#/memory", "#/notes"],
    [`#/team?agent=${agentId}`, `#/tasks?agent=${agentId}`],
    ["#/team?agent=bad&x=1", "#/tasks?agent=bad&x=1"],
    [
      `#/memory?buckets=notes&sort=title&bucket=${bucketId}`,
      `#/notes?buckets=notes&sort=title&bucket=${bucketId}`,
    ],
    ["#/memory?", "#/notes?"],
  ])("redirects the old address %s to %s with its query", (old, current) => {
    expect(legacyRedirect(old)).toBe(current);
    expect(viewFromHash(old)).toBe(viewFromHash(current));
    expect(viewStateFromHash(old)).toEqual(viewStateFromHash(current));
  });
  it.each([
    "#/tasks",
    "#/notes",
    "#/teamx",
    "#/memory/x",
    "#/team/task00000000001",
    "#/tasks/task00000000001",
    "#/search?q=team",
    "#/guide/memory",
    "#/",
  ])("does not redirect %s", (value) => {
    expect(legacyRedirect(value)).toBeNull();
  });
  it("round-trips memory filters and sorts in canonical order", () => {
    const state = viewStateFromHash(
      `#/notes?buckets=activity&sort=title&bucket=${bucketId}`,
    );
    expect(state).toEqual({
      ...defaultViewState,
      bucket: bucketId,
      noteSort: "title",
      bucketSort: "activity",
    });
    expect(viewStateHash("memory", state)).toBe(
      `#/notes?bucket=${bucketId}&sort=title&buckets=activity`,
    );
    expect(viewStateHash("memory", defaultViewState)).toBe("#/notes");
  });
  it("round-trips the board assignment filter", () => {
    for (const value of [agentId, "unassigned", "invalid"]) {
      const state = viewStateFromHash(`#/tasks?agent=${value}`);
      expect(state.assignment).toBe(value);
      expect(viewStateHash("board", state)).toBe(`#/tasks?agent=${value}`);
    }
    expect(viewStateHash("board", defaultViewState)).toBe("#/tasks");
  });
  it("round-trips the board hold filter beside the agent filter", () => {
    for (const value of ["on_hold", "ready"]) {
      const state = viewStateFromHash(`#/tasks?agent=${agentId}&hold=${value}`);
      expect(state).toEqual({
        ...defaultViewState,
        assignment: agentId,
        hold: value,
      });
      expect(viewStateHash("board", state)).toBe(
        `#/tasks?agent=${agentId}&hold=${value}`,
      );
      expect(isCanonicalViewStateHash(`#/tasks?hold=${value}`)).toBe(true);
    }
    expect(boardOnHoldHash).toBe("#/tasks?hold=on_hold&held_over=3d");
  });
  it("round-trips the board release filter after the other filters", () => {
    for (const value of ["0.19.0", "none", "v1.0.0-rc.1"]) {
      const state = viewStateFromHash(
        `#/tasks?release=${encodeURIComponent(value)}&agent=${agentId}`,
      );
      expect(state).toEqual({
        ...defaultViewState,
        assignment: agentId,
        release: value,
      });
      expect(viewStateHash("board", state)).toBe(
        `#/tasks?agent=${agentId}&release=${encodeURIComponent(value)}`,
      );
    }
    expect(isCanonicalViewStateHash("#/tasks?release=0.19.0")).toBe(true);
    expect(
      viewStateHash("memory", { ...defaultViewState, release: "0.19.0" }),
    ).toBe("#/notes");
  });
  it.each([
    ["empty release", "#/tasks?release="],
    ["padded release", "#/tasks?release=%200.19.0"],
    ["long release", `#/tasks?release=${"9".repeat(33)}`],
    ["multi-line release", "#/tasks?release=0.19%0A0"],
    ["repeated release", "#/tasks?release=0.19.0&release=0.18.0"],
    ["release on Notes", "#/notes?release=0.19.0"],
    ["unknown hold", "#/tasks?hold=waiting"],
    ["explicit all hold", "#/tasks?hold=all"],
    ["repeated hold", "#/tasks?hold=ready&hold=on_hold"],
    ["unknown sort", "#/notes?sort=random"],
    ["bad bucket id", "#/notes?bucket=../x"],
    ["repeated bucket", `#/notes?bucket=${bucketId}&bucket=${bucketId}`],
    ["unknown bucket sort", "#/notes?buckets=size"],
    ["other page", `#/agents?bucket=${bucketId}`],
    ["memory parameter on the board", `#/tasks?bucket=${bucketId}`],
    ["bad agent", "#/tasks?agent=all"],
    ["empty agent", "#/tasks?agent="],
    ["repeated agent", `#/tasks?agent=${agentId}&agent=unassigned`],
    ["bad agent at the old address", "#/team?agent=all"],
    ["unknown sort at the old address", "#/memory?sort=random"],
  ])("falls back to defaults for %s", (_name, value) => {
    expect(viewStateFromHash(value)).toEqual(defaultViewState);
  });
  it("leaves item links alone", () => {
    expect(isItemHash("#/notes/voice-guide-note00000000001")).toBe(true);
    expect(parseItemHash("#/notes/voice-guide-note00000000001")).toEqual({
      kind: "note",
      id: "note00000000001",
    });
    expect(viewStateFromHash("#/notes/voice-guide-note00000000001")).toEqual(
      defaultViewState,
    );
  });
  it("remembers a canonical filtered page across sign-in", () => {
    const remembered = loginReturnHash(
      `#/notes?x=1&sort=created&bucket=${bucketId}`,
    )!;
    expect(remembered).toBe(`#/notes?bucket=${bucketId}&sort=created`);
    rememberLoginReturn(remembered);
    expect(takeLoginReturn()).toBe(remembered);
    rememberLoginReturn(`#/notes?y=1&bucket=${bucketId}`);
    expect(takeLoginReturn()).toBeNull();
    expect(loginReturnHash(`#/tasks?x=1&agent=${agentId}`)).toBe(
      `#/tasks?agent=${agentId}`,
    );
    rememberLoginReturn(`#/tasks?agent=${agentId}`);
    expect(takeLoginReturn()).toBe(`#/tasks?agent=${agentId}`);
    rememberLoginReturn("#/tasks?agent=x&y=1");
    expect(takeLoginReturn()).toBeNull();
    for (const page of ["#/tasks", "#/notes"]) {
      expect(loginReturnHash(page)).toBe(page);
      rememberLoginReturn(page);
      expect(takeLoginReturn()).toBe(page);
    }
  });
  it("returns an old address remembered before an upgrade at its new form", () => {
    expect(loginReturnHash(`#/team?x=1&agent=${agentId}`)).toBe(
      `#/tasks?agent=${agentId}`,
    );
    expect(loginReturnHash("#/memory")).toBe("#/notes");
    rememberLoginReturn(`#/team?agent=${agentId}`);
    expect(takeLoginReturn()).toBe(`#/tasks?agent=${agentId}`);
    rememberLoginReturn("#/memory");
    expect(takeLoginReturn()).toBe("#/notes");
    rememberLoginReturn(`#/memory?bucket=${bucketId}&sort=title`);
    expect(takeLoginReturn()).toBe(`#/notes?bucket=${bucketId}&sort=title`);
    rememberLoginReturn("#/team?agent=x&y=1");
    expect(takeLoginReturn()).toBeNull();
  });
});

describe("board column address", () => {
  it("names one status column on the Tasks page", () => {
    expect(boardColumnHash("needs_review")).toBe("#/tasks?column=needs_review");
    expect(viewFromHash("#/tasks?column=todo")).toBe("board");
    expect(boardColumnFromHash("#/tasks?column=todo")).toBe("todo");
    expect(boardColumnFromHash("#/tasks?agent=unassigned&column=done")).toBe(
      "done",
    );
    expect(boardColumnFromHash("#/team?column=in_progress")).toBe(
      "in_progress",
    );
  });

  it("refuses anything else", () => {
    for (const hash of [
      "#/tasks",
      "#/tasks?column=later",
      "#/tasks?column=todo&column=done",
      "#/notes?column=todo",
      "#/?column=todo",
    ])
      expect(boardColumnFromHash(hash)).toBeNull();
  });

  it("is not page state", () => {
    expect(
      viewStateHash("board", viewStateFromHash("#/tasks?column=todo")),
    ).toBe("#/tasks");
    expect(loginReturnHash("#/tasks?column=todo")).toBe("#/tasks");
  });
});

describe("Connect sections", () => {
  it("reads and writes #/connect?section=files", () => {
    expect(connectSectionHash("files")).toBe("#/connect?section=files");
    expect(viewFromHash("#/connect?section=files")).toBe("connect");
    expect(connectSectionFromHash("#/connect?section=files")).toBe("files");
    for (const hash of [
      "#/connect",
      "#/connect?section=other",
      "#/connect?section=files&section=files",
      "#/tasks?section=files",
    ])
      expect(connectSectionFromHash(hash)).toBeNull();
  });
});
