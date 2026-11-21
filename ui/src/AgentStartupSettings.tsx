import { useEffect, useState } from "react";
import { crewApi, val, type Row } from "./crewApi";
import { t } from "./i18n";
import { connectSectionHash } from "./itemLink";
import "./agentStartup.css";

type Startup = { agent: Row; config?: Row; mapping?: Row; paused: boolean };

async function readStartup(id: string): Promise<Startup> {
  const [agents, configs, mappings, routing] = await Promise.all([
    crewApi.read("agents", { id, fields: ["kind", "startup_disabled", "archived"] }),
    crewApi.read("webhook_configs", { fields: ["scope", "enabled", "receiver_host", "agent"] }),
    crewApi.read("webhook_mappings", { fields: ["agent", "bot_ref", "bot_name"] }),
    crewApi.read("webhook_routing", { fields: ["paused"] }),
  ]);
  const agent = agents.find((item) => item.id === id);
  if (!agent) throw new Error("Unknown agent");
  return {
    agent,
    config: configs.find((row) => row.scope === "global"),
    mapping: mappings.find((row) => row.agent === id),
    paused: routing[0]?.paused === true,
  };
}

export default function AgentStartupSettings({ agent, onConfigured }: {
  agent: Row;
  onConfigured: (updated: Row) => void;
}) {
  const [state, setState] = useState<Startup>();
  const [reference, setReference] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [choosing, setChoosing] = useState(false);
  useEffect(() => {
    let active = true;
    setState(undefined);
    setReference("");
    setChoosing(false);
    setError("");
    void readStartup(agent.id).then(
      (value) => { if (active) setState(value); },
      () => { if (active) setError(t("Could not load startup settings.")); },
    );
    return () => { active = false; };
  }, [agent.id, agent.revision, reload]);

  if (agent.archived || agent.kind === "human") return null;
  const mapped = val(state?.mapping, "bot_ref");
  const host = val(state?.config, "receiver_host");
  const available = state?.config?.enabled === true && !state.paused && !!host;
  const configured = !!mapped && state?.agent.kind !== "external" && state?.agent.startup_disabled !== true;
  async function save(enabled: boolean) {
    if (!state || busy) return;
    setBusy(true);
    setError("");
    try {
      const updated = await crewApi.write("webhook.startup.update", {
        enabled,
        mapping_revision: state.mapping?.revision ?? 0,
        ...(enabled && { config_revision: state.config?.revision, bot_ref: mapped || reference.trim() }),
      }, state.agent);
      onConfigured(updated);
      setReload(value => value + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Could not save startup settings."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="crew-agent-start" aria-label={t("Automatic startup")}>
      <label className="crew-startup-toggle">
        <span>{t("Automatic startup")}</span>
        <input type="checkbox" role="switch" checked={available && configured}
          disabled={!available || busy || choosing}
          onChange={() => mapped ? void save(!configured) : setChoosing(true)} />
      </label>
      {!state && !error && <p role="status">{t("Loading startup settings…")}</p>}
      {state && <>
        {available && <p>{t("Integration: {host}", { host })}</p>}
        {mapped && <p>{t("Recipient: {reference}", { reference: mapped })}</p>}
        {!available && <p>{state.paused ? t("Delivery is paused.") : t("Connect and enable an integration to start agents automatically.")}{" "}<a href={connectSectionHash("integration")}>{t("Open integration settings")}</a></p>}
        {choosing && available && !mapped && <div className="crew-startup-destination">
          <label className="crew-field">
            <span>{t("Recipient reference")}</span>
            <input autoFocus autoComplete="off" spellCheck={false} value={reference} maxLength={500}
              disabled={busy} onChange={(event) => setReference(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (reference.trim()) void save(true);
                }
              }} />
          </label>
          <small>{t("Enter this agent’s recipient ID from the integration.")}</small>
          <div className="crew-actions">
            <button type="button" disabled={busy || !reference.trim()} onClick={() => void save(true)}>
              {t("Confirm destination")}
            </button>
            <button type="button" disabled={busy} onClick={() => { setReference(""); setChoosing(false); }}>
              {t("Cancel")}
            </button>
          </div>
        </div>}
      </>}
      {error && <p role="alert">{error}{" "}<button type="button" disabled={busy} onClick={() => setReload(value => value + 1)}>{t("Reload settings")}</button></p>}
    </section>
  );
}
