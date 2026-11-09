import { useEffect, useState } from "react";
import Login, { readEmailLoginLink } from "./Login";
import { pb, sessionGeneration } from "./api";
import CrewWorkspace from "./CrewWorkspace";
import { takeLoginReturn } from "./itemLink";
export default function App() {
  const [emailLink, setEmailLink] = useState(readEmailLoginLink),
    [session, setSession] = useState(sessionGeneration),
    [authenticated, setAuthenticated] = useState(pb.authStore.isValid);
  useEffect(() => {
    const receive = () => {
      const next = readEmailLoginLink();
      if (next) setEmailLink(next);
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
  if (emailLink)
    return (
      <Login
        key={emailLink.otpId}
        emailLink={emailLink}
        onEmailComplete={() => {
          history.replaceState(
            null,
            "",
            location.pathname + (takeLoginReturn() ?? "#/"),
          );
          setEmailLink(null);
        }}
      />
    );
  return authenticated ? <CrewWorkspace key={session} /> : <Login />;
}
