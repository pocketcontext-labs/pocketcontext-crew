import { StrictMode } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, pb } from "./api";
import { crewApi, type Row } from "./crewApi";
import Login, { readEmailLoginLink } from "./Login";
import App from "./App";
import { browserNavigation, takeLoginReturn } from "./itemLink";

beforeEach(() => {
  history.replaceState(null, "", "/");
  vi.spyOn(api, "loginMode").mockResolvedValue("email");
  vi.spyOn(api, "loginEmail").mockResolvedValue(undefined);
  vi.spyOn(api, "requestEmailLogin").mockResolvedValue("syntheticotp0001");
  vi.spyOn(api, "loginEmailCode").mockResolvedValue(undefined);
  vi.spyOn(api, "loginPassword").mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  pb.authStore.clear();
  localStorage.clear();
  history.replaceState(null, "", "/");
});

it("requests a link without revealing whether the email is registered", async () => {
  render(<Login />);
  fireEvent.change(await screen.findByLabelText("Email"), {
    target: { value: "owner@example.test" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Email me a sign-in code" }));
  await screen.findByText(/is the owner's address/);
  expect(api.requestEmailLogin).toHaveBeenCalledWith("owner@example.test");
  expect(screen.queryByLabelText("Password")).toBeNull();
  expect(api.loginEmail).not.toHaveBeenCalled();
});

it("replaces the form once sent and can return to it", async () => {
  render(<Login />);
  fireEvent.change(await screen.findByLabelText("Email"), {
    target: { value: "owner@example.test" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Email me a sign-in code" }));
  await screen.findByRole("heading", { name: "Check your inbox" });
  expect(screen.queryByLabelText("Email")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Use a different email" }));
  expect(screen.getByLabelText("Email")).toBeInTheDocument();
});

it("shows only the failure action for a malformed link", async () => {
  render(<Login emailLink={{ otpId: "", password: "" }} />);
  await screen.findByRole("heading", { name: "This link no longer works" });
  expect(screen.getAllByRole("button")).toHaveLength(1);
});

it("never redeems a link on mount, including React strict effects", async () => {
  history.replaceState(null, "", "/#/login?otpId=syntheticid1234&otp=12345678");
  const link = readEmailLoginLink()!;
  const done = vi.fn();
  render(
    <StrictMode>
      <Login emailLink={link} onEmailComplete={done} />
    </StrictMode>,
  );
  const confirm = await screen.findByRole("button", { name: "Continue to Crew" });
  expect(api.loginEmail).not.toHaveBeenCalled();
  expect(api.requestEmailLogin).not.toHaveBeenCalled();
  fireEvent.click(confirm);
  await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
  expect(api.loginEmail).toHaveBeenCalledExactlyOnceWith(
    "syntheticid1234",
    "12345678",
  );
});

it("lets an expired link request another without exposing the token", async () => {
  vi.mocked(api.loginEmail).mockRejectedValue(new Error("server detail"));
  render(
    <Login emailLink={{ otpId: "syntheticid1234", password: "12345678" }} />,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Continue to Crew" }));
  await screen.findByRole("heading", { name: "This link no longer works" });
  expect(document.body.textContent).not.toContain("12345678");
  expect(screen.queryByRole("button", { name: "Continue to Crew" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Send a new link" }));
  expect(screen.getByLabelText("Email")).toBeInTheDocument();
});

it("preserves the existing local password flow", async () => {
  vi.mocked(api.loginMode).mockResolvedValue("password");
  render(<Login />);
  fireEvent.change(await screen.findByLabelText("Password"), {
    target: { value: "synthetic-password" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  await waitFor(() =>
    expect(api.loginPassword).toHaveBeenCalledWith("synthetic-password"),
  );
  expect(screen.queryByLabelText("Email")).toBeNull();
  expect(screen.getByText("pocketcontext init")).toBeInTheDocument();
});

it("fails closed when authentication configuration is unavailable", async () => {
  vi.mocked(api.loginMode).mockRejectedValue(new Error("offline"));
  render(<Login />);
  await screen.findByRole("alert");
  expect(screen.queryByLabelText("Password")).toBeNull();
  expect(screen.queryByLabelText("Email")).toBeNull();
  vi.mocked(api.loginMode).mockResolvedValue("email");
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByLabelText("Email");
});

it.each([
  "#/login?otpId=id&otp=1234&otp=5678",
  "#/login?otpId=id",
  "#/login?otpId=id&otp=abc",
  "#/login",
])("rejects malformed login fragments: %s", (hash) => {
  history.replaceState(null, "", "/" + hash);
  expect(readEmailLoginLink()).toEqual({ otpId: "", password: "" });
});
it("does not interpret query-string credentials or knowledge navigation as login", () => {
  history.replaceState(null, "", "/?otpId=id&otp=1234#/page/login");
  expect(readEmailLoginLink()).toBeNull();
});

it("scrubs the email secret from browser history while retaining explicit confirmation", async () => {
  history.replaceState(null, "", "/#/login?otpId=syntheticid1234&otp=12345678");
  render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  await screen.findByRole("button", { name: "Continue to Crew" });
  expect(location.hash).toBe("#/login");
  expect(location.href).not.toContain("12345678");
  expect(api.loginEmail).not.toHaveBeenCalled();
});

it("accepts a replacement email link in an already-open tab without redeeming it", async () => {
  history.replaceState(null, "", "/#/login?otpId=firstid12345678&otp=12345678");
  render(<App />);
  await screen.findByRole("button", { name: "Continue to Crew" });
  history.replaceState(null, "", "/#/login?otpId=secondid1234567&otp=87654321");
  fireEvent(window, new HashChangeEvent("hashchange"));
  await screen.findByRole("button", { name: "Continue to Crew" });
  expect(location.hash).toBe("#/login");
  expect(api.loginEmail).not.toHaveBeenCalled();
  // Leave the request pending so this test does not mount the private reader.
  vi.mocked(api.loginEmail).mockReturnValue(new Promise(() => {}));
  fireEvent.click(screen.getByRole("button", { name: "Continue to Crew" }));
  expect(api.loginEmail).toHaveBeenCalledExactlyOnceWith(
    "secondid1234567",
    "87654321",
  );
});

const returnKey = "pocketcontext.crew.login_return";
const linkedTask: Row = {
  id: "task00000000001",
  revision: 1,
  title: "Launch post",
  status: "todo",
  labels: [],
  links: [],
  path: "#/tasks/launch-post-task00000000001",
};
const emailLink = "/#/login?otpId=syntheticid1234&otp=12345678";
function signIn() {
  const payload = btoa(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, type: "auth" }),
  );
  pb.authStore.save(`h.${payload}.s`, {
    id: "user00000000001",
    collectionId: "users",
    collectionName: "users",
  });
}
function mockWorkspace() {
  vi.spyOn(crewApi, "serverVersion").mockResolvedValue({
    version: "0.0.0",
    commit: "",
  });
  vi.spyOn(crewApi, "read").mockImplementation(async (c, f = {}) =>
    c === "tasks" && !f.archived ? [linkedTask] : [],
  );
  vi.mocked(api.loginEmail).mockImplementation(async () => signIn());
  vi.mocked(api.loginPassword).mockImplementation(async () => signIn());
}
async function completeEmailLogin() {
  history.replaceState(null, "", emailLink);
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Continue to Crew" }));
  await screen.findByRole("button", { name: "Refresh" });
}
const stored = (hash: unknown, expires: unknown = Date.now() + 60_000) =>
  localStorage.setItem(returnKey, JSON.stringify({ hash, expires }));

it("reopens the item after password sign-in, keeping the hash", async () => {
  mockWorkspace();
  vi.mocked(api.loginMode).mockResolvedValue("password");
  history.replaceState(null, "", "/#/tasks/launch-post-task00000000001");
  render(<App />);
  fireEvent.change(await screen.findByLabelText("Password"), {
    target: { value: "synthetic-password" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
  expect(location.hash).toBe("#/tasks/launch-post-task00000000001");
});

it("remembers only the item target when an email link is requested from one", async () => {
  history.replaceState(null, "", "/#/tasks/launch-post-task00000000001");
  render(<Login />);
  fireEvent.change(await screen.findByLabelText("Email"), {
    target: { value: "owner@example.test" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Email me a sign-in code" }));
  await screen.findByText(/is the owner's address/);
  const value = JSON.parse(localStorage.getItem(returnKey)!);
  expect(value.hash).toBe("#/tasks/task00000000001");
  expect(value.expires).toBeGreaterThan(Date.now() + 14 * 60 * 1000);
  expect(value.expires).toBeLessThanOrEqual(Date.now() + 15 * 60 * 1000);
});

it("remembers a bookmarked page when an email link is requested from it", async () => {
  history.replaceState(null, "", "/#/approvals");
  render(<Login />);
  fireEvent.change(await screen.findByLabelText("Email"), {
    target: { value: "owner@example.test" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Email me a sign-in code" }));
  await screen.findByText(/is the owner's address/);
  expect(JSON.parse(localStorage.getItem(returnKey)!).hash).toBe("#/approvals");
});

it("returns to a stored page after email sign-in", async () => {
  mockWorkspace();
  stored("#/approvals");
  await completeEmailLogin();
  expect(location.hash).toBe("#/approvals");
  expect(screen.getByRole("link", { name: /^Approvals/ })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

it("returns to a review link after sign-in and opens its dialog", async () => {
  mockWorkspace();
  vi.mocked(crewApi.read).mockImplementation(async (c, f = {}) =>
    f.archived
      ? []
      : c === "tasks"
        ? [linkedTask]
        : c === "reviews"
          ? [
              {
                id: "review000000001",
                revision: 1,
                task: linkedTask.id,
                draft: "Synthetic draft",
                status: "pending",
              },
            ]
          : [],
  );
  vi.mocked(api.loginMode).mockResolvedValue("password");
  history.replaceState(null, "", "/#/approvals/review000000001");
  render(<App />);
  fireEvent.change(await screen.findByLabelText("Password"), {
    target: { value: "synthetic-password" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  const dialog = await screen.findByRole("dialog");
  expect(
    within(dialog).getByRole("button", { name: "Approve draft" }),
  ).toBeInTheDocument();
  expect(location.hash).toBe("#/approvals/review000000001");
});

it("remembers a review link when an email link is requested from it", async () => {
  history.replaceState(null, "", "/#/approvals/review000000001");
  render(<Login />);
  fireEvent.change(await screen.findByLabelText("Email"), {
    target: { value: "owner@example.test" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Email me a sign-in code" }));
  await screen.findByText(/is the owner's address/);
  expect(JSON.parse(localStorage.getItem(returnKey)!).hash).toBe(
    "#/approvals/review000000001",
  );
});

it("forgets an earlier target when a link is requested away from any item", async () => {
  stored("#/tasks/task00000000001");
  history.replaceState(null, "", "/#/");
  render(<Login />);
  fireEvent.change(await screen.findByLabelText("Email"), {
    target: { value: "owner@example.test" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Email me a sign-in code" }));
  await screen.findByText(/is the owner's address/);
  expect(localStorage.getItem(returnKey)).toBeNull();
});

it("does not remember a target when the email request fails", async () => {
  vi.mocked(api.requestEmailLogin).mockRejectedValue(new Error("offline"));
  history.replaceState(null, "", "/#/tasks/task00000000001");
  render(<Login />);
  fireEvent.change(await screen.findByLabelText("Email"), {
    target: { value: "owner@example.test" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Email me a sign-in code" }));
  await screen.findByRole("alert");
  expect(localStorage.getItem(returnKey)).toBeNull();
});

it("returns to the stored item after email sign-in and clears it", async () => {
  mockWorkspace();
  stored("#/tasks/task00000000001");
  await completeEmailLogin();
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
  expect(location.hash).toBe("#/tasks/launch-post-task00000000001");
  expect(location.href).not.toContain("12345678");
  expect(localStorage.getItem(returnKey)).toBeNull();
});

it("goes to the board after email sign-in with no stored target", async () => {
  mockWorkspace();
  await completeEmailLogin();
  expect(location.hash).toBe("#/");
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("still signs in when storage is unavailable", async () => {
  mockWorkspace();
  const getItem = Storage.prototype.getItem;
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (
    this: Storage,
    key: string,
  ) {
    if (key === returnKey) throw new Error("blocked");
    return getItem.call(this, key);
  });
  await completeEmailLogin();
  expect(location.hash).toBe("#/");
});

it("ignores an expired stored target and clears it", async () => {
  mockWorkspace();
  stored("#/tasks/task00000000001", Date.now() - 1);
  await completeEmailLogin();
  expect(location.hash).toBe("#/");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(localStorage.getItem(returnKey)).toBeNull();
});

it.each([
  [
    "login credentials",
    JSON.stringify({
      hash: "#/login?otpId=abc&otp=123456",
      expires: Date.now() + 60_000,
    }),
  ],
  [
    "an item link carrying a query",
    JSON.stringify({
      hash: "#/tasks/task00000000001?otp=123456",
      expires: Date.now() + 60_000,
    }),
  ],
  [
    "a script URL",
    JSON.stringify({
      hash: "javascript:alert(1)",
      expires: Date.now() + 60_000,
    }),
  ],
  [
    "another origin",
    JSON.stringify({
      hash: "https://evil.example/#/tasks/task00000000001",
      expires: Date.now() + 60_000,
    }),
  ],
  [
    "path traversal",
    JSON.stringify({ hash: "#/tasks/../login", expires: Date.now() + 60_000 }),
  ],
  [
    "a non-string hash",
    JSON.stringify({
      hash: ["#/tasks/task00000000001"],
      expires: Date.now() + 60_000,
    }),
  ],
  [
    "a far-future expiry",
    JSON.stringify({
      hash: "#/tasks/task00000000001",
      expires: Date.now() + 86_400_000,
    }),
  ],
  [
    "an unknown page",
    JSON.stringify({ hash: "#/settings", expires: Date.now() + 60_000 }),
  ],
  ["a missing expiry", JSON.stringify({ hash: "#/tasks/task00000000001" })],
  ["invalid JSON", "{not json"],
  ["a bare string", "#/tasks/task00000000001"],
])("refuses a stored value with %s", async (_name, value) => {
  mockWorkspace();
  localStorage.setItem(returnKey, value);
  await completeEmailLogin();
  expect(location.hash).toBe("#/");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(localStorage.getItem(returnKey)).toBeNull();
});

describe("OAuth sign-in route", () => {
  const target = "/oauth/authorize?client_id=abc&state=x";
  const route = "/#/signin?next=" + encodeURIComponent(target);
  const signIn = () =>
    pb.authStore.save(fakeToken(), {
      id: "synthetic",
      collectionName: "users",
    } as never);
  const fakeToken = () =>
    `e30.${btoa(JSON.stringify({ exp: 4102444800, type: "auth" }))}.sig`;
  let replace: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    replace = vi
      .spyOn(browserNavigation, "replace")
      .mockImplementation(() => undefined);
  });

  it("is not mistaken for an email login link", () => {
    history.replaceState(null, "", route);
    expect(readEmailLoginLink()).toBeNull();
  });

  it("shows the normal login and remembers the target for the emailed link", async () => {
    history.replaceState(null, "", route);
    render(<App />);
    fireEvent.change(await screen.findByLabelText("Email"), {
      target: { value: "owner@example.test" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Email me a sign-in code" }),
    );
    await screen.findByRole("heading", { name: "Check your inbox" });
    expect(replace).not.toHaveBeenCalled();
    expect(takeLoginReturn()).toBe(
      "#/signin?next=" + encodeURIComponent(target),
    );
  });

  it("goes to the target after password sign-in", async () => {
    vi.mocked(api.loginMode).mockResolvedValue("password");
    vi.spyOn(api, "refreshSession").mockResolvedValue(undefined);
    vi.mocked(api.loginPassword).mockImplementation(async () => signIn());
    history.replaceState(null, "", route);
    render(<App />);
    fireEvent.change(await screen.findByLabelText("Password"), {
      target: { value: "synthetic-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() =>
      expect(replace).toHaveBeenCalledExactlyOnceWith(target),
    );
  });

  it("goes straight there when the server accepts the session", async () => {
    const refresh = vi.spyOn(api, "refreshSession").mockResolvedValue(undefined);
    signIn();
    history.replaceState(null, "", route);
    render(<App />);
    await waitFor(() =>
      expect(replace).toHaveBeenCalledExactlyOnceWith(target),
    );
    expect(refresh).toHaveBeenCalledWith(true);
  });

  it("shows login when the server rejects the session, without navigating", async () => {
    vi.spyOn(api, "refreshSession").mockImplementation(async () => {
      pb.authStore.clear();
      throw Object.assign(new Error("rejected"), { status: 401 });
    });
    signIn();
    history.replaceState(null, "", route);
    render(<App />);
    expect(await screen.findByLabelText("Email")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it("offers a retry when the check cannot complete", async () => {
    const refresh = vi
      .spyOn(api, "refreshSession")
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);
    signIn();
    history.replaceState(null, "", route);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["other path", "/api/secret?x=1"],
    ["protocol relative", "//evil.example/oauth/authorize?x=1"],
    ["backslash", "/\\evil.example/oauth/authorize?x=1"],
  ])("falls back to Home for %s", async (_name, next) => {
    mockWorkspace();
    signIn();
    history.replaceState(null, "", "/#/signin?next=" + encodeURIComponent(next));
    render(<App />);
    await waitFor(() => expect(location.hash).toBe("#/"));
    expect(replace).not.toHaveBeenCalled();
  });

  it("returns to the stored target after the emailed link", async () => {
    stored("#/signin?next=" + encodeURIComponent(target));
    history.replaceState(null, "", "/#/login?otpId=syntheticid1234&otp=12345678");
    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Continue to Crew" }),
    );
    await waitFor(() =>
      expect(replace).toHaveBeenCalledExactlyOnceWith(target),
    );
    expect(localStorage.getItem(returnKey)).toBeNull();
  });

  it("refuses a tampered stored target after the emailed link", async () => {
    mockWorkspace();
    stored("#/signin?next=" + encodeURIComponent("//evil.example/x"));
    await completeEmailLogin();
    expect(replace).not.toHaveBeenCalled();
    expect(location.hash).toBe("#/");
  });
});

describe("emailed sign-in code", () => {
  async function requestCode(address = "owner@example.test") {
    fireEvent.change(await screen.findByLabelText("Email"), {
      target: { value: address },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Email me a sign-in code" }),
    );
    return screen.findByLabelText("Code from the email");
  }
  function standalone(value: boolean) {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: value && query === "(display-mode: standalone)",
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }));
  }
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (navigator as Navigator & { standalone?: boolean }).standalone;
  });

  it("offers a one-time code field with the non-enumerating copy", async () => {
    render(<Login />);
    const input = await requestCode();
    expect(input).toHaveAttribute("autocomplete", "one-time-code");
    expect(input).toHaveAttribute("inputmode", "numeric");
    expect(input).toHaveAttribute("pattern", "[0-9]*");
    expect(input).toHaveAttribute("maxlength", "6");
    expect(input).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent(
      "If owner@example.test is the owner's address, a sign-in code and link are on their way. They work for 15 minutes.",
    );
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(api.loginEmailCode).not.toHaveBeenCalled();
  });

  it("strips spaces and dashes from a pasted code and submits it", async () => {
    render(<Login />);
    const input = await requestCode();
    fireEvent.paste(input, {
      clipboardData: { getData: () => " 123-456 " },
    });
    await waitFor(() =>
      expect(api.loginEmailCode).toHaveBeenCalledExactlyOnceWith(
        "syntheticotp0001",
        "123456",
      ),
    );
  });

  it("submits automatically at six digits, not before", async () => {
    render(<Login />);
    const input = await requestCode();
    fireEvent.change(input, { target: { value: "12345" } });
    expect(input).toHaveValue("12345");
    expect(api.loginEmailCode).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "123456" } });
    await waitFor(() =>
      expect(api.loginEmailCode).toHaveBeenCalledExactlyOnceWith(
        "syntheticotp0001",
        "123456",
      ),
    );
  });

  it("asks for six digits when Sign in is pressed early", async () => {
    render(<Login />);
    const input = await requestCode();
    fireEvent.change(input, { target: { value: "12a3" } });
    expect(input).toHaveValue("123");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Enter the 6-digit code from the email.",
    );
    expect(api.loginEmailCode).not.toHaveBeenCalled();
  });

  it("shows a wrong-code message and lets the owner try again", async () => {
    vi.mocked(api.loginEmailCode).mockRejectedValueOnce(
      new Error("That code is wrong. 4 tries left."),
    );
    render(<Login />);
    const input = await requestCode();
    fireEvent.change(input, { target: { value: "111111" } });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That code is wrong. 4 tries left.",
    );
    expect(screen.getByLabelText("Code from the email")).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Send a new code" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Code from the email"), {
      target: { value: "222222" },
    });
    await waitFor(() => expect(api.loginEmailCode).toHaveBeenCalledTimes(2));
    expect(api.loginEmailCode).toHaveBeenLastCalledWith(
      "syntheticotp0001",
      "222222",
    );
  });

  it.each([
    "Too many wrong codes. Send a new one.",
    "This code has expired or was already used. Send a new one.",
  ])("offers a new code after: %s", async (message) => {
    vi.mocked(api.loginEmailCode).mockRejectedValue(new Error(message));
    render(<Login />);
    fireEvent.change(await requestCode(), { target: { value: "111111" } });
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.queryByLabelText("Code from the email")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Send a new code" }));
    expect(screen.getByLabelText("Email")).toHaveValue("owner@example.test");
    expect(screen.queryByRole("alert")).toBeNull();
    vi.mocked(api.requestEmailLogin).mockResolvedValue("syntheticotp0002");
    vi.mocked(api.loginEmailCode).mockResolvedValue(undefined);
    fireEvent.click(
      screen.getByRole("button", { name: "Email me a sign-in code" }),
    );
    fireEvent.change(await screen.findByLabelText("Code from the email"), {
      target: { value: "333333" },
    });
    await waitFor(() =>
      expect(api.loginEmailCode).toHaveBeenLastCalledWith(
        "syntheticotp0002",
        "333333",
      ),
    );
  });

  it("tells a home-screen app to use the code", async () => {
    standalone(true);
    render(<Login />);
    await requestCode();
    expect(
      screen.getByText(
        "Enter the code from the email here. The link in the email opens your browser, not this app.",
      ),
    ).toBeInTheDocument();
  });

  it("recognizes the iOS standalone flag", async () => {
    standalone(false);
    (navigator as Navigator & { standalone?: boolean }).standalone = true;
    render(<Login />);
    await requestCode();
    expect(
      screen.getByText(/opens your browser, not this app/),
    ).toBeInTheDocument();
  });

  it("says either the code or the link works in a browser", async () => {
    standalone(false);
    render(<Login />);
    await requestCode();
    expect(screen.queryByText(/not this app/)).toBeNull();
    expect(screen.getByText(/or open the link in it/)).toBeInTheDocument();
  });

  it("lands on the requested item after code sign-in", async () => {
    mockWorkspace();
    vi.mocked(api.loginEmailCode).mockImplementation(async () => signIn());
    history.replaceState(null, "", "/#/tasks/launch-post-task00000000001");
    render(<App />);
    fireEvent.change(await requestCode(), { target: { value: "123456" } });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(location.hash).toBe("#/tasks/launch-post-task00000000001");
    expect(localStorage.getItem(returnKey)).toBeNull();
  });

  it("lands on a review link after code sign-in", async () => {
    mockWorkspace();
    vi.mocked(api.loginEmailCode).mockImplementation(async () => signIn());
    history.replaceState(null, "", "/#/approvals/review000000001");
    render(<App />);
    fireEvent.change(await requestCode(), { target: { value: "123456" } });
    await screen.findByRole("button", { name: "Refresh" });
    expect(location.hash).toBe("#/approvals/review000000001");
  });

  it("returns to the stored target when a spent link asks for a code", async () => {
    mockWorkspace();
    vi.mocked(api.loginEmail).mockRejectedValue(new Error("expired"));
    vi.mocked(api.loginEmailCode).mockImplementation(async () => signIn());
    stored("#/approvals");
    history.replaceState(null, "", emailLink);
    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Continue to Crew" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Send a new link" }),
    );
    fireEvent.change(await requestCode(), { target: { value: "123456" } });
    await screen.findByRole("button", { name: "Refresh" });
    expect(location.hash).toBe("#/approvals");
    expect(localStorage.getItem(returnKey)).toBeNull();
  });

  it("keeps the link's Continue step without a code field", async () => {
    render(
      <Login emailLink={{ otpId: "syntheticid1234", password: "12345678" }} />,
    );
    await screen.findByRole("button", { name: "Continue to Crew" });
    expect(screen.queryByLabelText("Code from the email")).toBeNull();
    expect(api.loginEmail).not.toHaveBeenCalled();
    expect(api.loginEmailCode).not.toHaveBeenCalled();
  });
});
