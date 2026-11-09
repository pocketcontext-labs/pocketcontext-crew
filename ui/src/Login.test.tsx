import { StrictMode } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, pb } from "./api";
import { crewApi, type Row } from "./crewApi";
import Login, { readEmailLoginLink } from "./Login";
import App from "./App";

beforeEach(() => {
  history.replaceState(null, "", "/");
  vi.spyOn(api, "loginMode").mockResolvedValue("email");
  vi.spyOn(api, "loginEmail").mockResolvedValue(undefined);
  vi.spyOn(api, "requestEmailLogin").mockResolvedValue(undefined);
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
  fireEvent.click(screen.getByRole("button", { name: "Email me a login link" }));
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
  fireEvent.click(screen.getByRole("button", { name: "Email me a login link" }));
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
  fireEvent.click(screen.getByRole("button", { name: "Email me a login link" }));
  await screen.findByText(/is the owner's address/);
  const value = JSON.parse(localStorage.getItem(returnKey)!);
  expect(value.hash).toBe("#/tasks/task00000000001");
  expect(value.expires).toBeGreaterThan(Date.now() + 14 * 60 * 1000);
  expect(value.expires).toBeLessThanOrEqual(Date.now() + 15 * 60 * 1000);
});

it("forgets an earlier target when a link is requested away from any item", async () => {
  stored("#/tasks/task00000000001");
  history.replaceState(null, "", "/#/");
  render(<Login />);
  fireEvent.change(await screen.findByLabelText("Email"), {
    target: { value: "owner@example.test" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Email me a login link" }));
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
  fireEvent.click(screen.getByRole("button", { name: "Email me a login link" }));
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
