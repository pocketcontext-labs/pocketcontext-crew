import { useEffect, useState } from "react";
import Login, { readEmailLoginLink } from "./Login";
import { api, pb, sessionGeneration } from "./api";
import CrewWorkspace from "./CrewWorkspace";
import {
  browserNavigation,
  isSigninHash,
  oauthTargetFromHash,
  takeLoginReturn,
  uploadTokenFromHash,
} from "./itemLink";
import UploadPage from "./UploadPage";

const currentSigninHash = () =>
  isSigninHash(location.hash) ? location.hash : "";

function SigninStatus({ onRetry }: { onRetry?: () => void }) {
  return (
    <main className="login-shell">
      <section className="login-card">
        {onRetry ? (
          <>
            <p role="alert" className="login-error">
              Unable to check your sign-in. Please try again.
            </p>
            <button className="primary-button" onClick={onRetry}>
              Try again
            </button>
          </>
        ) : (
          <p role="status">Returning to the connection request…</p>
        )}
      </section>
    </main>
  );
}

/**
 * A one-time upload link (`#/upload/<token>`) renders before the sign-in gate:
 * no session is needed or used, none of the sign-in effects run, and the
 * token is never stored. Every other address goes through Reader.
 */
export default function App() {
  const [upload, setUpload] = useState(() =>
    uploadTokenFromHash(location.hash),
  );
  useEffect(() => {
    const receive = () => setUpload(uploadTokenFromHash(location.hash));
    window.addEventListener("hashchange", receive);
    return () => window.removeEventListener("hashchange", receive);
  }, []);
  if (upload !== null) return <UploadPage key={upload} token={upload} />;
  return <Reader />;
}

function Reader() {
  const [emailLink, setEmailLink] = useState(readEmailLoginLink),
    [session, setSession] = useState(sessionGeneration),
    [authenticated, setAuthenticated] = useState(pb.authStore.isValid),
    [signinHash, setSigninHash] = useState(currentSigninHash),
    [returning, setReturning] = useState(false),
    [checkFailed, setCheckFailed] = useState(false),
    [checkAttempt, setCheckAttempt] = useState(0);
  const oauthTarget = signinHash ? oauthTargetFromHash(signinHash) : null;
  useEffect(() => {
    const receive = () => {
      const next = readEmailLoginLink();
      if (next) setEmailLink(next);
      setSigninHash(currentSigninHash());
    };
    window.addEventListener("hashchange", receive);
    return () => window.removeEventListener("hashchange", receive);
  }, []);
  useEffect(() => {
    if (emailLink)
      history.replaceState(
        null,
        "",
        location.pathname + location.search + "#/login",
      );
  }, [emailLink]);
  useEffect(
    () =>
      pb.authStore.onChange(() => {
        setSession(sessionGeneration);
        setAuthenticated(pb.authStore.isValid);
      }),
    [],
  );
  // An unusable return target is ignored, never followed.
  useEffect(() => {
    if (!signinHash || oauthTarget) return;
    history.replaceState(null, "", location.pathname + location.search + "#/");
    setSigninHash("");
  }, [signinHash, oauthTarget]);
  // The local token only looks valid until the server agrees. Without this check
  // a rejected token would bounce between consent and this route. Rejection
  // clears the session, which renders the login form below.
  useEffect(() => {
    if (!oauthTarget || !authenticated || emailLink) return;
    let active = true;
    setCheckFailed(false);
    api.refreshSession(true).then(
      () => {
        if (active) browserNavigation.replace(oauthTarget);
      },
      () => {
        if (active) setCheckFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [oauthTarget, authenticated, emailLink, checkAttempt]);
  if (returning) return <SigninStatus />;
  if (emailLink)
    return (
      <Login
        key={emailLink.otpId}
        emailLink={emailLink}
        onEmailComplete={() => {
          const target = takeLoginReturn();
          const oauth = target && oauthTargetFromHash(target);
          if (oauth) {
            setReturning(true);
            browserNavigation.replace(oauth);
            return;
          }
          history.replaceState(null, "", location.pathname + (target ?? "#/"));
          setEmailLink(null);
        }}
      />
    );
  if (oauthTarget && authenticated)
    return (
      <SigninStatus
        onRetry={
          checkFailed ? () => setCheckAttempt((value) => value + 1) : undefined
        }
      />
    );
  return authenticated ? <CrewWorkspace key={session} /> : <Login />;
}
