import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import Brand from "./Brand";
import { t } from "./i18n";
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

/** An installed home-screen app keeps its own cookies and storage, apart from the browser. */
export function isStandaloneApp(): boolean {
  try {
    return (
      window.matchMedia?.("(display-mode: standalone)")?.matches === true ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    );
  } catch {
    return false;
  }
}
const codeLength = 6;
const codeDigits = (value: string) =>
  value.replace(/\D/g, "").slice(0, codeLength);
/** These server answers end the login request; only a new email helps. */
const spentCode = /Too many wrong codes|expired or was already used/;

/** Fills a translated sentence's {name} slots with elements. */
function fillNodes(text: string, nodes: Record<string, ReactNode>): ReactNode[] {
  return text
    .split(/(\{\w+\})/)
    .map((part, i) => {
      const name = /^\{(\w+)\}$/.exec(part)?.[1];
      return name && name in nodes ? (
        <Fragment key={i}>{nodes[name]}</Fragment>
      ) : (
        part
      );
    });
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
  const [address, setAddress] = useState("");
  const [otpId, setOtpId] = useState("");
  const [code, setCode] = useState("");
  const [codeSpent, setCodeSpent] = useState(false);
  const redeeming = useRef(false);
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
          setError(t("Unable to load sign-in options. Please try again."));
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
        e instanceof Error
          ? e.message
          : t("Unable to sign in. Please try again."),
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
    setAddress(address);
    void run(async () => {
      const id = await api.requestEmailLogin(address);
      const target = loginReturnHash(hash);
      if (target) rememberLoginReturn(target);
      // Asking again from a spent link's #/login view keeps the original target.
      else if (!hash.startsWith("#/login")) clearLoginReturn();
      setOtpId(id);
      setCode("");
      setCodeSpent(false);
      setSentTo(address);
    });
  };
  const redeem = (value: string) => {
    if (redeeming.current) return;
    if (value.length !== codeLength) {
      setError(t("Enter the 6-digit code from the email."));
      return;
    }
    redeeming.current = true;
    void run(async () => {
      try {
        await api.loginEmailCode(otpId, value);
      } catch (e) {
        setCode("");
        if (e instanceof Error && spentCode.test(e.message)) setCodeSpent(true);
        throw e;
      } finally {
        redeeming.current = false;
      }
      // The link flow returns to the stored target; here the address never left it.
      if (onEmailComplete) onEmailComplete();
      else clearLoginReturn();
    });
  };
  const enterCode = (value: string) => {
    const digits = codeDigits(value);
    setCode(digits);
    if (digits.length === codeLength) redeem(digits);
  };
  const pasteCode = (event: ClipboardEvent<HTMLInputElement>) => {
    // maxLength would cut "123 456" before the spaces are stripped.
    event.preventDefault();
    enterCode(event.clipboardData.getData("text"));
  };
  const newCode = () => {
    setSentTo("");
    setOtpId("");
    setCode("");
    setCodeSpent(false);
    setError("");
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
          <p role="status">{t("Loading sign-in options…")}</p>
        )}
        {mode === null && error && (
          <button
            className="primary-button"
            onClick={() => setRetry((value) => value + 1)}
          >
            {t("Try again")}
          </button>
        )}
        {mode === "password" && (
          <>
            <h1>{t("Log in to Crew")}</h1>
            <form onSubmit={password}>
              <input
                type="hidden"
                name="username"
                autoComplete="username"
                value={localIdentity}
              />
              <label>
                {t("Password")}
                <input
                  required
                  autoFocus
                  name="password"
                  type="password"
                  autoComplete="current-password"
                />
              </label>
              <button className="primary-button" disabled={busy}>
                {t("Sign in")}
              </button>
            </form>
            <p className="login-hint">
              {fillNodes(
                t(
                  "Use the password you chose with {init}, or run {open} to sign in with a single-use link.",
                ),
                {
                  init: <code>pocketcontext init</code>,
                  open: <code>pocketcontext open</code>,
                },
              )}
            </p>
          </>
        )}
        {mode === "email" &&
          (link ? (
            link.otpId && !linkFailed ? (
              <>
                <h1 className="sr-only">{t("Log in to Crew")}</h1>
                <button
                  className="primary-button"
                  autoFocus
                  disabled={busy}
                  onClick={confirm}
                >
                  {t("Continue to Crew")}
                </button>
              </>
            ) : (
              <>
                <h1>{t("This link no longer works")}</h1>
                <button
                  className="primary-button"
                  autoFocus
                  onClick={() => {
                    setLink(undefined);
                    setLinkFailed(false);
                  }}
                >
                  {t("Send a new link")}
                </button>
              </>
            )
          ) : sentTo ? (
            <>
              <h1>{t("Check your inbox")}</h1>
              <p role="status">
                {t(
                  "If {address} is the owner's address, a sign-in code and link are on their way. They work for 15 minutes.",
                  { address: sentTo },
                )}
              </p>
              <p className="login-code-hint">
                {isStandaloneApp()
                  ? t(
                      "Enter the code from the email here. The link in the email opens your browser, not this app.",
                    )
                  : t(
                      "Enter the code from the email here, or open the link in it. Either one signs you in.",
                    )}
              </p>
              {codeSpent ? (
                <button className="primary-button" autoFocus onClick={newCode}>
                  {t("Send a new code")}
                </button>
              ) : (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    redeem(code);
                  }}
                >
                  <label>
                    {t("Code from the email")}
                    <input
                      className="login-code"
                      required
                      autoFocus
                      name="code"
                      type="text"
                      autoComplete="one-time-code"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={codeLength}
                      readOnly={busy}
                      value={code}
                      onChange={(event) => enterCode(event.target.value)}
                      onPaste={pasteCode}
                    />
                  </label>
                  <button className="primary-button" disabled={busy}>
                    {t("Sign in")}
                  </button>
                </form>
              )}
              <button className="login-link" onClick={newCode}>
                {t("Use a different email")}
              </button>
            </>
          ) : (
            <>
              <h1>{t("Log in to Crew")}</h1>
              <form onSubmit={email}>
                <label>
                  {t("Email")}
                  <input
                    required
                    autoFocus
                    name="email"
                    type="email"
                    autoComplete="email"
                    maxLength={255}
                    defaultValue={address}
                  />
                </label>
                <button className="primary-button" disabled={busy}>
                  {t("Email me a sign-in code")}
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
