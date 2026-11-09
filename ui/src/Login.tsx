import { useEffect, useState, type FormEvent } from "react";
import Brand from "./Brand";
import { api, localIdentity, type AuthMode } from "./api";
import {
  clearLoginReturn,
  loginReturnHash,
  rememberLoginReturn,
} from "./itemLink";

export type EmailLoginLink = { otpId: string; password: string };
/** Only the fragment carries credentials; reading it never redeems a link. */
export function readEmailLoginLink(): EmailLoginLink | null {
  const [path, query = ""] = location.hash.replace(/^#\/?/, "").split("?");
  if (path !== "login") return null;
  const params = new URLSearchParams(query);
  const otpId = params.get("otpId") || "";
  const password = params.get("otp") || "";
  if (
    params.getAll("otpId").length !== 1 ||
    params.getAll("otp").length !== 1 ||
    !/^[a-zA-Z0-9]{1,255}$/.test(otpId) ||
    !/^[0-9]{4,71}$/.test(password)
  ) {
    return { otpId: "", password: "" };
  }
  return { otpId, password };
}

export default function Login({
  emailLink,
  onEmailComplete,
}: {
  emailLink?: EmailLoginLink;
  onEmailComplete?: () => void;
}) {
  const [mode, setMode] = useState<AuthMode | null>(null);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [link, setLink] = useState(emailLink);
  const [linkFailed, setLinkFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setError("");
    api
      .loginMode()
      .then((value) => {
        if (active) setMode(value);
      })
      .catch(() => {
        if (active)
          setError("Unable to load sign-in options. Please try again.");
      });
    return () => {
      active = false;
    };
  }, [retry]);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to sign in. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  const password = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(async () => {
      await api.loginPassword(String(form.get("password")));
      onEmailComplete?.();
    });
  };
  const email = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const address = String(form.get("email"));
    const hash = location.hash;
    void run(async () => {
      await api.requestEmailLogin(address);
      const target = loginReturnHash(hash);
      if (target) rememberLoginReturn(target);
      // Asking again from a spent link's #/login view keeps the original target.
      else if (!hash.startsWith("#/login")) clearLoginReturn();
      setSentTo(address);
    });
  };
  const confirm = () =>
    void run(async () => {
      if (!link) return;
      try {
        await api.loginEmail(link.otpId, link.password);
      } catch {
        setLinkFailed(true);
        return;
      }
      setLink(undefined);
      onEmailComplete?.();
    });
  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="crew-logo">
          <Brand />
          <strong>Crew</strong>
        </div>
        {mode === null && !error && (
          <p role="status">Loading sign-in options…</p>
        )}
        {mode === null && error && (
          <button
            className="primary-button"
            onClick={() => setRetry((value) => value + 1)}
          >
            Try again
          </button>
        )}
        {mode === "password" && (
          <>
            <h1>Log in to Crew</h1>
            <form onSubmit={password}>
              <input
                type="hidden"
                name="username"
                autoComplete="username"
                value={localIdentity}
              />
              <label>
                Password
                <input
                  required
                  autoFocus
                  name="password"
                  type="password"
                  autoComplete="current-password"
                />
              </label>
              <button className="primary-button" disabled={busy}>
                Sign in
              </button>
            </form>
            <p className="login-hint">
              Use the password you chose with <code>pocketcontext init</code>,
              or run <code>pocketcontext open</code> to sign in with a
              single-use link.
            </p>
          </>
        )}
        {mode === "email" &&
          (link ? (
            link.otpId && !linkFailed ? (
              <>
                <h1 className="sr-only">Log in to Crew</h1>
                <button
                  className="primary-button"
                  autoFocus
                  disabled={busy}
                  onClick={confirm}
                >
                  Continue to Crew
                </button>
              </>
            ) : (
              <>
                <h1>This link no longer works</h1>
                <button
                  className="primary-button"
                  autoFocus
                  onClick={() => {
                    setLink(undefined);
                    setLinkFailed(false);
                  }}
                >
                  Send a new link
                </button>
              </>
            )
          ) : sentTo ? (
            <>
              <h1>Check your inbox</h1>
              <p role="status">
                If {sentTo} is the owner's address, a login link is on its way.
                It works for 15 minutes.
              </p>
              <button className="login-link" onClick={() => setSentTo("")}>
                Use a different email
              </button>
            </>
          ) : (
            <>
              <h1>Log in to Crew</h1>
              <form onSubmit={email}>
                <label>
                  Email
                  <input
                    required
                    autoFocus
                    name="email"
                    type="email"
                    autoComplete="email"
                    maxLength={255}
                  />
                </label>
                <button className="primary-button" disabled={busy}>
                  Email me a login link
                </button>
              </form>
            </>
          ))}
        {error && (
          <p role="alert" className="login-error">
            {error}
          </p>
        )}
      </section>
    </main>
  );
}
