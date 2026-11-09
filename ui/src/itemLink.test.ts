import { afterEach, describe, expect, it } from "vitest";
import {
  loginReturnHash,
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
