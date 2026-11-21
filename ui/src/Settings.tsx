import { useEffect, useRef, useState, type ReactNode } from "react";
import { languages, t, useLanguage, setLanguage, type Language } from "./i18n";
import { localIdentity, pb } from "./api";
import { val, type Row } from "./crewApi";
import {
  agentActions,
  allAgentsAction,
  allAgentsActions,
  resolveAgentTap,
  tapActionLabel,
  withAgentAction,
  withAllAgents,
  type TapAction,
} from "./agentTap";
import { homeAgents } from "./listSource";
import { icons } from "./MobileChrome";
import { saveSettings, showAllHelp, useReaderSettings } from "./sessionGuide";
import "./settings.css";

export type ServerVersion = { version: string; commit: string };

type Picker =
  { kind: "language" } | { kind: "all" } | { kind: "agent"; agent: Row };

/**
 * Settings (0.36.0), from More on a phone and the sidebar on a desktop:
 * Language, Tapping an agent (what a tap on an agent row on Home runs),
 * Help (0.37.0: Show all help again clears every "Don't show this again"),
 * Account with Sign out, and About with the server version and build. Each
 * choice opens a list with a check on the current value and applies at once;
 * the server keeps it (crew_settings), so it holds across browsers.
 */
export default function Settings({
  agents,
  serverVersion,
  onSignOut,
}: {
  /** The active agents. */
  agents: Row[];
  /** undefined while checking, null when unavailable. */
  serverVersion: ServerVersion | null | undefined;
  onSignOut: () => void;
}) {
  const language = useLanguage();
  const prefs = useReaderSettings();
  const [picker, setPicker] = useState<Picker | null>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState(0);
  const tap = prefs.agentTap;
  const save = (patch: Parameters<typeof saveSettings>[0]) => {
    setError("");
    saveSettings(patch).catch(() =>
      setError(
        t("Couldn't save the setting. Check your connection and try again."),
      ),
    );
  };
  const chooseLanguage = (lang: Language) => {
    setLanguage(lang);
    save({ language: lang });
  };
  const status = error ? (
    <p className="crew-settings-error" role="alert">
      {error}
    </p>
  ) : null;

  if (picker) {
    const back = () => setPicker(null);
    if (picker.kind === "language")
      return (
        <PickerPage title={t("Language")} onBack={back}>
          <Choices
            label={t("Language")}
            options={languages.map((l) => ({
              value: l.code,
              // Each language is named in its own language.
              label: <span lang={l.code}>{l.name}</span>,
            }))}
            current={language}
            onChoose={(value) => chooseLanguage(value as Language)}
          />
          {status}
        </PickerPage>
      );
    if (picker.kind === "all")
      return (
        <PickerPage title={t("All agents")} onBack={back}>
          <p className="crew-settings-hint">
            {t("Agents without their own choice do this.")}
          </p>
          <Choices
            label={t("All agents")}
            options={allAgentsActions.map((action) => ({
              value: action,
              label: tapActionLabel(action),
            }))}
            current={allAgentsAction(tap)}
            onChoose={(value) =>
              save({
                agent_tap: withAllAgents(
                  tap,
                  value as TapAction,
                ),
              })
            }
          />
          {status}
        </PickerPage>
      );
    const agent = agents.find((x) => x.id === picker.agent.id) ?? picker.agent;
    return (
      // The agent's name is the owner's content, never translated.
      <PickerPage title={val(agent, "name")} onBack={back}>
        <p className="crew-settings-hint">
          {t("Only actions already in this agent's menu.")}
        </p>
        <Choices
          label={val(agent, "name")}
          options={agentActions(agent).map((action) => ({
            value: action,
            label: tapActionLabel(action),
          }))}
          current={resolveAgentTap(tap, agent)}
          onChoose={(value) =>
            save({
              agent_tap: withAgentAction(tap, agent.id, value as TapAction),
            })
          }
        />
        {status}
      </PickerPage>
    );
  }

  const record = pb.authStore.record;
  const email = String(record?.email ?? "");
  const user =
    String(record?.name ?? "").trim() ||
    (email && email !== localIdentity
      ? email
      : t("The owner on this computer"));
  const languageName =
    languages.find((l) => l.code === language)?.name ?? "English";
  const listed = homeAgents(agents);

  return (
    <div className="crew-settings">
      {status}
      <ul className="crew-settings-group" aria-label={t("Language")}>
        <li>
          <Row
            label={t("Language")}
            value={<span lang={language}>{languageName}</span>}
            onClick={() => setPicker({ kind: "language" })}
          />
        </li>
      </ul>

      <section aria-labelledby="crew-settings-tap">
        <h2 id="crew-settings-tap">{t("Tapping an agent")}</h2>
        <p className="crew-settings-hint">
          {t(
            "What happens when you tap an agent on Home. A single agent can use a different action.",
          )}
        </p>
        <ul className="crew-settings-group">
          <li>
            <Row
              label={t("All agents")}
              value={tapActionLabel(allAgentsAction(tap))}
              onClick={() => setPicker({ kind: "all" })}
            />
          </li>
        </ul>
        {listed.length > 0 && (
          <ul className="crew-settings-group" aria-label={t("Agents")}>
            {listed.map((agent) => (
              <li key={agent.id}>
                <Row
                  label={val(agent, "name")}
                  value={tapActionLabel(resolveAgentTap(tap, agent))}
                  onClick={() => setPicker({ kind: "agent", agent })}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="crew-settings-help">
        <h2 id="crew-settings-help">{t("Help")}</h2>
        <ul className="crew-settings-group">
          <li>
            <button
              type="button"
              className="crew-settings-row"
              onClick={() => {
                setError("");
                showAllHelp().then(
                  () => setToast((n) => n + 1),
                  () =>
                    setError(
                      t(
                        "Couldn't save the setting. Check your connection and try again.",
                      ),
                    ),
                );
              }}
            >
              <span className="crew-settings-label">
                {t("Show all help again")}
              </span>
            </button>
          </li>
        </ul>
      </section>

      <section aria-labelledby="crew-settings-account">
        <h2 id="crew-settings-account">{t("Account")}</h2>
        <ul className="crew-settings-group">
          <li>
            <div className="crew-settings-row crew-settings-static">
              <span className="crew-settings-label">{user}</span>
            </div>
          </li>
          <li>
            <button
              type="button"
              className="crew-settings-row crew-settings-signout"
              onClick={onSignOut}
            >
              <span className="crew-settings-label">{t("Sign out")}</span>
            </button>
          </li>
        </ul>
      </section>

      <section aria-labelledby="crew-settings-about">
        <h2 id="crew-settings-about">{t("About")}</h2>
        <ul className="crew-settings-group">
          <li>
            <div className="crew-settings-row crew-settings-static">
              <span className="crew-settings-label">{t("Server")}</span>
              <span className="crew-settings-value">
                {serverVersion === undefined
                  ? t("Checking…")
                  : serverVersion === null
                    ? t("Unavailable")
                    : serverVersion.version}
              </span>
            </div>
          </li>
          {serverVersion?.commit && (
            <li>
              <div className="crew-settings-row crew-settings-static">
                <span className="crew-settings-label">{t("Build")}</span>
                <span
                  className="crew-settings-value"
                  title={serverVersion.commit}
                >
                  {serverVersion.commit.slice(0, 12)}
                </span>
              </div>
            </li>
          )}
        </ul>
      </section>
      {toast > 0 && (
        <SettingsToast key={toast} dismiss={() => setToast(0)}>
          {t("All help will show again")}
        </SettingsToast>
      )}
    </div>
  );
}

/** A short confirmation over the page, gone after a few seconds. */
function SettingsToast({
  children,
  dismiss,
}: {
  children: ReactNode;
  dismiss: () => void;
}) {
  const latest = useRef(dismiss);
  latest.current = dismiss;
  useEffect(() => {
    const timer = setTimeout(() => latest.current(), 4000);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div className="crew-toast crew-settings-toast" role="status">
      <p>{children}</p>
    </div>
  );
}

/** A row that opens a list: label, the current value and a chevron. */
function Row({
  label,
  value,
  onClick,
}: {
  label: string;
  value: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="crew-settings-row"
      aria-haspopup="true"
      onClick={onClick}
    >
      <span className="crew-settings-label">{label}</span>
      <span className="crew-settings-value">{value}</span>
      <span className="crew-settings-chevron" aria-hidden="true">
        {icons.chevronRight}
      </span>
    </button>
  );
}

/** A choice list's own page: a back button and its title. */
function PickerPage({
  title,
  onBack,
  children,
}: {
  title: string;
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <div className="crew-settings crew-settings-picker">
      <header className="crew-settings-picker-head">
        <button
          type="button"
          className="crew-settings-back"
          aria-label={t("Back to Settings")}
          title={t("Back to Settings")}
          onClick={onBack}
        >
          {icons.chevronLeft}
        </button>
        <h2>{title}</h2>
      </header>
      {children}
    </div>
  );
}

/** The options as radio rows, with a check on the current one. */
function Choices({
  label,
  options,
  current,
  onChoose,
}: {
  label: string;
  options: { value: string; label: ReactNode }[];
  current: string;
  onChoose: (value: string) => void;
}) {
  return (
    <ul className="crew-settings-group" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <li key={option.value} role="presentation">
          <button
            type="button"
            role="radio"
            aria-checked={option.value === current}
            className="crew-settings-row"
            onClick={() => onChoose(option.value)}
          >
            <span className="crew-settings-label">{option.label}</span>
            {option.value === current && (
              <span className="crew-settings-check" aria-hidden="true">
                <svg
                  viewBox="0 0 24 24"
                  width="20"
                  height="20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="m5 12.5 4.5 4.5L19 7.5" />
                </svg>
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}
