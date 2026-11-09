import { afterEach, describe, expect, it, vi } from "vitest";
import { pb } from "./api";
import {
  loginReturnHash,
  rememberLoginReturn,
  takeLoginReturn,
  viewFromHash,
} from "./itemLink";
import {
  isCanonicalSearchHash,
  matchNames,
  parseExcerpt,
  queryProblem,
  searchCrew,
  searchFailure,
  searchHash,
  searchTextFromHash,
  serverQuery,
} from "./searchApi";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("parseExcerpt", () => {
  it("splits the server's « » markers into plain and marked text", () => {
    expect(parseExcerpt("…plan the «launch» for «Friday» now…")).toEqual([
      { text: "…plan the ", mark: false },
      { text: "launch", mark: true },
      { text: " for ", mark: false },
      { text: "Friday", mark: true },
      { text: " now…", mark: false },
    ]);
  });
  it("returns plain text without markers", () => {
    expect(parseExcerpt("no matches here")).toEqual([
      { text: "no matches here", mark: false },
    ]);
  });
  it.each([
    ["not a string", 42, []],
    ["null", null, []],
    ["empty", "", []],
    ["empty highlight", "a«»b", [{ text: "ab", mark: false }]],
  ])("handles %s", (_name, raw, parts) => {
    expect(parseExcerpt(raw)).toEqual(parts);
  });
  it("keeps markup as literal text, inside and outside highlights", () => {
    const parts = parseExcerpt(
      '<img src=x onerror="alert(1)">«<script>alert(2)</script>»&amp;',
    );
    expect(parts).toEqual([
      { text: '<img src=x onerror="alert(1)">', mark: false },
      { text: "<script>alert(2)</script>", mark: true },
      { text: "&amp;", mark: false },
    ]);
  });
  it("treats stray and nested markers as text", () => {
    expect(parseExcerpt("a » b «c «d» e» f")).toEqual([
      { text: "a » b ", mark: false },
      { text: "c «d", mark: true },
      { text: " e» f", mark: false },
    ]);
  });
  it("keeps a highlight cut off by the length limit highlighted", () => {
    expect(parseExcerpt("start «trunc…")).toEqual([
      { text: "start ", mark: false },
      { text: "trunc…", mark: true },
    ]);
  });
  it("bounds hostile lengths and keeps astral characters whole", () => {
    const parts = parseExcerpt("«😀»" + "x".repeat(100_000));
    expect(parts[0]).toEqual({ text: "😀", mark: true });
    expect(parts.map((p) => p.text).join("").length).toBeLessThan(4100);
  });
});

describe("queries", () => {
  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["ok", null],
    ["a\u0000b", "invalid"],
    ["a\nb", "invalid"],
    ["\uD800x", "invalid"],
    ["x".repeat(1025), "long"],
    ["é".repeat(513), "long"],
    [Array.from({ length: 33 }, (_, i) => `w${i}`).join(" "), "long"],
    [Array.from({ length: 32 }, (_, i) => `w${i}`).join(" "), null],
  ])("checks %j", (text, problem) => {
    expect(queryProblem(text)).toBe(problem);
  });
  it("matches the start of the last word only when it ends in a letter or digit", () => {
    expect(serverQuery("  launch  pla ")).toBe("launch pla*");
    expect(serverQuery("launch*")).toBe("launch*");
    expect(serverQuery("v2")).toBe("v2*");
    expect(serverQuery("C++")).toBe("C++");
    expect(serverQuery("café")).toBe("café*");
  });
  it("matches agent and bucket names by every word, ignoring case", () => {
    const rows = [
      { id: "a", revision: 1, name: "Network Lead" },
      { id: "b", revision: 1, name: "Build" },
    ];
    expect(matchNames(rows, "net LEAD").map((r) => r.id)).toEqual(["a"]);
    expect(matchNames(rows, "bui*").map((r) => r.id)).toEqual(["b"]);
    expect(matchNames(rows, "  ")).toEqual([]);
  });
});

describe("searchCrew", () => {
  it("sends only the given fields and keeps well-formed hits", async () => {
    const send = vi.spyOn(pb, "send").mockResolvedValue({
      items: [
        {
          collection: "tasks",
          id: "task00000000001",
          title: "Launch",
          excerpt: "«Launch»",
          status: "todo",
        },
        { collection: "events", id: "event0000000001" },
        { collection: "notes", id: "../../etc" },
        null,
      ],
      has_more: true,
      next_offset: 20,
      generation: "g1",
    });
    const result = await searchCrew({
      query: "launch*",
      limit: 20,
      offset: 20,
      archived: true,
      generation: "g0",
    });
    expect(send).toHaveBeenCalledWith("/api/crew/search", {
      method: "POST",
      body: {
        query: "launch*",
        limit: 20,
        offset: 20,
        archived: true,
        generation: "g0",
      },
    });
    expect(result.items.map((x) => x.id)).toEqual(["task00000000001"]);
    expect(result).toMatchObject({
      hasMore: true,
      nextOffset: 20,
      generation: "g1",
    });
  });
  it("refuses a response without items", async () => {
    vi.spyOn(pb, "send").mockResolvedValue({ nope: true });
    await expect(searchCrew({ query: "x" })).rejects.toThrow();
  });
  it.each([
    [{ status: 409 }, "changed"],
    [{ status: 400 }, "invalid"],
    [{ status: 408 }, "busy"],
    [{ status: 413 }, "busy"],
    [{ status: 500 }, "failed"],
    [{ status: 0, isAbort: true }, "aborted"],
    [new Error("offline"), "failed"],
  ])("classifies %j", (error, failure) => {
    expect(searchFailure(error)).toBe(failure);
  });
});

describe("the #/search address", () => {
  it("round-trips a query, including reserved characters", () => {
    const text = "launch & plan #2 / 100% «x»";
    const hash = searchHash(text);
    expect(hash).toBe("#/search?q=" + encodeURIComponent(text));
    expect(searchTextFromHash(hash)).toBe(text);
    expect(isCanonicalSearchHash(hash)).toBe(true);
    expect(viewFromHash(hash)).toBe("search");
  });
  it.each([
    ["bare page", "#/search", ""],
    ["empty query", "#/search?q=", ""],
    ["plus for space", "#/search?q=a+b", "a b"],
  ])("reads the %s", (_name, hash, text) => {
    expect(searchTextFromHash(hash)).toBe(text);
    expect(viewFromHash(hash)).toBe("search");
  });
  it.each([
    ["extra parameter", "#/search?q=a&x=1"],
    ["repeated q", "#/search?q=a&q=b"],
    ["other parameter", "#/search?x=a"],
    ["control character", "#/search?q=a%0Ab"],
    ["lone surrogate", "#/search?q=%ED%A0%80"],
    ["fragment", "#/search?q=a#b"],
    ["malformed escape", "#/search?q=%E0%A4%A"],
    ["raw equals sign", "#/search?q=a=b"],
  ])("refuses a query with %s", (_name, hash) => {
    expect(searchTextFromHash(hash)).toBeNull();
    expect(isCanonicalSearchHash(hash)).toBe(false);
  });
  it.each([
    ["#/searchx", "home"],
    ["#/search/x", "home"],
  ])("does not treat %s as search", (hash, view) => {
    expect(viewFromHash(hash)).toBe(view);
  });
  it("remembers a valid search across sign-in in canonical form", () => {
    const remembered = loginReturnHash("#/search?q=a+b")!;
    expect(remembered).toBe("#/search?q=a%20b");
    rememberLoginReturn(remembered);
    expect(takeLoginReturn()).toBe("#/search?q=a%20b");
  });
  it.each([
    ["an invalid query", "#/search?q=a&x=1"],
    ["an empty query", "#/search?q="],
    ["an oversized query", "#/search?q=" + "x".repeat(2000)],
  ])("returns to the bare search page for %s", (_name, hash) => {
    expect(loginReturnHash(hash)).toBe("#/search");
  });
  it.each([
    ["non-canonical encoding", "#/search?q=a+b"],
    ["extra parameter", "#/search?q=a&x=1"],
    ["control character", "#/search?q=a%0Ab"],
    ["oversized query", "#/search?q=" + "x".repeat(2000)],
    ["script", "#/search?q=<script>"],
  ])("refuses a stored %s", (_name, hash) => {
    localStorage.setItem(
      "pocketcontext.crew.login_return",
      JSON.stringify({ hash, expires: Date.now() + 60_000 }),
    );
    expect(takeLoginReturn()).toBeNull();
  });
  it("accepts the stored bare search page", () => {
    rememberLoginReturn("#/search");
    expect(takeLoginReturn()).toBe("#/search");
  });
});
