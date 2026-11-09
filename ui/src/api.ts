import PocketBase, {
  BaseAuthStore,
  LocalAuthStore,
  type SendOptions,
  type RecordAuthResponse,
} from "pocketbase";

// The SDK synchronizes this application's credentials across same-origin tabs.
const sessionKey = "pocketcontext.reader.auth";
function browserAuthStore(): BaseAuthStore {
  try {
    const probe = `${sessionKey}.probe.${Math.random()}`;
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return new LocalAuthStore(sessionKey);
  } catch {
    return new BaseAuthStore();
  }
}
const authStore = browserAuthStore();
// The SDK handles named keys, but localStorage.clear() emits a null key.
if (typeof window !== "undefined" && authStore instanceof LocalAuthStore) {
  window.addEventListener("storage", (event) => {
    if (event.storageArea !== window.localStorage) return;
    // Even an empty-to-empty logout must fence a sign-in that is still pending.
    if (event.key === null || event.key === sessionKey) cancelLogin();
    if (event.key === null) authStore.clear();
  });
}
// Discard legacy per-tab credentials; never resurrect them after shared logout.
try {
  window.sessionStorage.removeItem(sessionKey);
} catch {
  /* Optional storage. */
}
if (authStore.record?.collectionName !== "users" || !authStore.isValid)
  authStore.clear();
export let sessionGeneration = 0;
function identityKey() {
  return authStore.token
    ? `${authStore.record?.collectionName}:${authStore.record?.id}`
    : "";
}
let activeIdentity = identityKey();
authStore.onChange(() => {
  const next = identityKey();
  if (next === activeIdentity) {
    // A sibling tab already renewed this identity; do not renew it again on focus.
    if (next) {
      refreshedAt = Date.now();
      refreshedToken = authStore.token;
    }
    return;
  }
  activeIdentity = next;
  sessionGeneration++;
});
export const pb = new PocketBase(
  typeof window === "undefined" ? "http://localhost" : window.location.origin,
  authStore,
);
// Concurrent Crew reads share an endpoint but must not cancel each other.
pb.autoCancellation(false);
// Reject fully parsed responses from a previous identity before callers see them.
const send = pb.send.bind(pb);
pb.send = async <T = unknown>(
  path: string,
  options: SendOptions = {},
): Promise<T> => {
  const generation = sessionGeneration;
  const token = authStore.token;
  const identity = identityKey();
  try {
    const result = await send<T>(path, options);
    if (generation !== sessionGeneration || identity !== identityKey())
      throw new Error("Session changed");
    return result;
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (
      generation === sessionGeneration &&
      token &&
      token === authStore.token &&
      (status === 401 || status === 403)
    )
      authStore.clear();
    throw error;
  }
};

let pendingSignIn: { cancel: (message?: string) => void } | null = null;
/** The sign-in name of the project's one account; the password is the secret. */
export const localIdentity = "me@pocketcontext.localhost";
async function signIn(
  authenticate: (client: PocketBase) => Promise<RecordAuthResponse>,
): Promise<void> {
  pendingSignIn?.cancel();
  const generation = sessionGeneration,
    token = authStore.token;
  const client = new PocketBase(pb.baseURL, new BaseAuthStore());
  let ended = false;
  let rejectAttempt: (error: Error) => void = () => {};
  const attempt = {
    cancel(message = "Sign-in cancelled. You can try again.") {
      if (ended) return;
      ended = true;
      // This isolated client owns only this attempt.
      client.cancelAllRequests();
      rejectAttempt(Object.assign(new Error(message), { isAbort: true }));
    },
  };
  pendingSignIn = attempt;
  try {
    const result = await new Promise<RecordAuthResponse>((resolve, reject) => {
      rejectAttempt = reject;
      authenticate(client).then(resolve, reject);
    });
    if (
      ended ||
      pendingSignIn !== attempt ||
      generation !== sessionGeneration ||
      token !== authStore.token
    )
      throw new Error("Session changed");
    if (result.record.collectionName !== "users")
      throw new Error("Unexpected sign-in response");
    authStore.save(result.token, result.record);
  } finally {
    ended = true;
    if (pendingSignIn === attempt) pendingSignIn = null;
  }
}
/** Cancel a pending sign-in and fence late responses. */
export function cancelLogin(): void {
  pendingSignIn?.cancel();
}
export async function loginPassword(password: string): Promise<void> {
  await signIn((client) =>
    client.collection("users").authWithPassword(localIdentity, password),
  );
}
export type AuthMode = "email" | "password";
export async function loginMode(): Promise<AuthMode> {
  const client = new PocketBase(pb.baseURL, new BaseAuthStore());
  const result = await client.send<{ mode: AuthMode }>(
    "/api/bundle/auth-mode",
    { method: "GET" },
  );
  if (result.mode !== "email" && result.mode !== "password")
    throw new Error("Unable to load sign-in options. Please try again.");
  return result.mode;
}
export async function requestEmailLogin(email: string): Promise<void> {
  const client = new PocketBase(pb.baseURL, new BaseAuthStore());
  await client.collection("users").requestOTP(email.trim());
}
export async function loginEmail(
  otpId: string,
  password: string,
): Promise<void> {
  await signIn((client) =>
    client.collection("users").authWithOTP(otpId, password),
  );
}
let refreshedAt = 0;
let refreshedToken = "";
/** `force` asks the server even when this token was renewed moments ago. */
export async function refreshSession(force = false): Promise<void> {
  const initiatingToken = pb.authStore.token;
  if (!initiatingToken) throw new Error("Please sign in to continue");
  const generation = sessionGeneration;
  if (
    !force &&
    initiatingToken === refreshedToken &&
    Date.now() - refreshedAt < 300000
  )
    return;
  try {
    // Save explicitly: the SDK authRefresh helper saves even after a user signs out.
    const result = await pb.send<RecordAuthResponse>(
      "/api/collections/users/auth-refresh",
      {
        method: "POST",
        headers: { Authorization: initiatingToken },
      },
    );
    if (
      pb.authStore.token !== initiatingToken ||
      generation !== sessionGeneration
    )
      return;
    if (result.record.collectionName !== "users")
      throw new Error("Unexpected sign-in response");
    refreshedAt = Date.now();
    refreshedToken = result.token;
    pb.authStore.save(result.token, result.record);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "status" in error &&
      (error.status === 401 || error.status === 403) &&
      pb.authStore.token === initiatingToken
    )
      pb.authStore.clear();
    throw error;
  }
}
export function logout(): void {
  cancelLogin();
  pb.authStore.clear();
}

export const api = {
  cancelLogin,
  loginPassword,
  loginMode,
  requestEmailLogin,
  loginEmail,
  refreshSession,
  logout,
};
