import { useEffect, useRef, useState, type FormEvent } from "react";
import { crewApi, list, val, type Row } from "./crewApi";
const reasons = [
  "created",
  "assigned",
  "reassigned",
  "ready",
  "reopened",
  "review_outcome",
  "unassigned",
  "catch_up",
];
const labels: Record<string, string> = {
  created: "Created ready",
  assigned: "Assigned",
  reassigned: "Reassigned",
  ready: "Marked ready",
  reopened: "Reopened",
  review_outcome: "Review resolved",
  unassigned: "Unassigned (triage)",
  catch_up: "Explicit catch-up",
};
const deliveryStates: Record<string, string> = {
  pending: "Queued",
  in_flight: "Sending",
  accepted: "Accepted by receiver",
  cancelled: "Cancelled",
  failed: "Failed",
};
const executionStates: Record<string, string> = {
  dispatching: "Routing",
  handed_off: "Handoff prepared",
  invalidated: "Invalidated",
  test_acknowledged: "Test acknowledged",
  running: "Execution started",
  completed: "Completed",
  failed: "Failed",
};
// Render only safe named fields, never raw records or server error bodies.
export default function WebhookStatus({ agents }: { agents: Row[] }) {
  const [config, setConfig] = useState<Row>();
  const [mappings, setMappings] = useState<Row[]>([]);
  const [deliveries, setDeliveries] = useState<Row[]>([]);
  const [executions, setExecutions] = useState<Row[]>([]);
  const [legacyCount, setLegacyCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [instructions, setInstructions] = useState("");
  const [subscriptions, setSubscriptions] = useState<string[]>([]);
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const retryKeys = useRef(new Map<string, string>());
  useEffect(() => {
    let alive = true;
    setLoading(true);
    void Promise.all([
      crewApi.read("webhook_configs"),
      crewApi.read("webhook_mappings"),
      crewApi.read("webhook_deliveries"),
      crewApi.read("webhook_executions"),
    ])
      .then(([configs, maps, ds, es]) => {
        if (!alive) return;
        const current = configs.find((row) => row.scope === "global");
        setConfig(current);
        setMappings(maps);
        setDeliveries(ds);
        setExecutions(es);
        setLegacyCount(configs.filter((row) => row.scope === "legacy").length);
        setInstructions(val(current, "instructions"));
        setSubscriptions(list(current, "subscriptions"));
      })
      .catch(() => {
        if (alive)
          setError("Could not load the integration. Refresh to try again.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [refresh]);
  async function mutate(
    action: string,
    data: Record<string, unknown>,
    row: Row | undefined,
    success: string,
    expectedRevision?: number,
  ) {
    if (busy) return false;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const operationText = JSON.stringify([
        action,
        data,
        row?.id,
        row?.revision,
        expectedRevision,
      ]);
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(operationText),
      );
      const operation = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      const key = retryKeys.current.get(operation) || crypto.randomUUID();
      retryKeys.current.set(operation, key);
      await crewApi.write(action, data, row, "", {
        idempotency_key: key,
        ...(expectedRevision !== undefined
          ? { expected_revision: expectedRevision }
          : {}),
      });
      retryKeys.current.delete(operation);
      setMessage(success);
      setRefresh((x) => x + 1);
      return true;
    } catch (failure) {
      const conflict =
        typeof failure === "object" &&
        failure !== null &&
        "status" in failure &&
        failure.status === 409;
      setError(
        conflict
          ? "This configuration changed elsewhere. Refresh, review the latest settings, and try again."
          : "The change could not be confirmed. Check the configuration and try again. Credentials are never included in this message.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }
  const blocked = loading || busy;
  const currentAgent = agents.find(
    (row) => row.id === val(config, "agent") && !row.archived,
  );
  const synced =
    !!config &&
    Number(config.applied_revision) === Number(config.instruction_revision) &&
    ["verified", "reported"].includes(val(config, "sync_status"));
  const syncLabel = !synced
    ? "Update needed"
    : config?.sync_status === "verified"
      ? "Current — assistant reported matching text"
      : "Applied — verification needed";
  const canEnable =
    !!currentAgent &&
    !!mappings.find((m) => m.agent === currentAgent.id && val(m, "bot_ref")) &&
    !!config?.url_configured &&
    !!config?.secret_configured &&
    synced;
  function saveSettings(event: FormEvent) {
    event.preventDefault();
    void mutate(
      "webhook.integration.update",
      { instructions, subscriptions },
      config,
      "Instructions and events saved. Delivery is paused when instructions change.",
    );
  }
  async function saveCredentials(event: FormEvent) {
    event.preventDefault();
    const fields: Record<string, unknown> = {};
    if (url.trim()) fields.url = url.trim();
    if (secret) fields.secret = secret;
    const ok = await mutate(
      "webhook.credentials.update",
      fields,
      config,
      "Credentials saved. Enable delivery separately when setup is ready.",
    );
    if (ok) {
      setUrl("");
      setSecret("");
    }
  }
  return (
    <section className="crew-webhooks" aria-label="Grok Bot integration">
      <div className="crew-section-title">
        <h2>Grok Bot integration</h2>
        <button
          disabled={blocked}
          onClick={() => {
            setError("");
            setRefresh((x) => x + 1);
          }}
        >
          Refresh integration
        </button>
      </div>
      <p>
        One webhook connects your whole team. Choose an existing bot to also
        route notifications; it keeps its normal responsibilities.
      </p>
      {loading && <p role="status">Loading integration…</p>}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {!loading && !config && !error && (
        <p>
          No global integration is available. Refresh after the server upgrade
          completes.
        </p>
      )}
      {config && (
        <>
          <div className="crew-callout">
            <strong>
              {config.enabled ? "Delivery enabled" : "Delivery disabled"}
            </strong>
            <br />
            Dispatcher:{" "}
            {val(currentAgent, "name") || "Not selected or inactive"}. Only
            Ready tasks can wake a bot. Enabling does not notify existing tasks.
          </div>
          {legacyCount > 0 && (
            <p>
              {legacyCount} previous per-agent configuration(s) retained as
              disabled history. Enter this integration’s credentials to connect
              your dispatcher.
            </p>
          )}
          <h3>Agents and routing</h3>
          <p>
            Map each agent to its exact Grok Bot reference. Changing the
            dispatcher pauses delivery and clears the old webhook binding.
          </p>
          <div className="crew-integration-mappings">
            {agents
              .filter((a) => !a.archived)
              .map((agent) => (
                <AgentMapping
                  key={agent.id}
                  agent={agent}
                  mapping={mappings.find((m) => m.agent === agent.id)}
                  selected={config.agent === agent.id}
                  disabled={blocked}
                  onSave={(botRef, mapping) =>
                    mutate(
                      "webhook.mapping.update",
                      { agent: agent.id, bot_ref: botRef },
                      mapping,
                      "Bot mapping saved.",
                      mapping?.revision ?? 0,
                    )
                  }
                  onSelect={() =>
                    mutate(
                      "webhook.integration.update",
                      { agent: config.agent === agent.id ? "" : agent.id },
                      config,
                      "Dispatcher changed. Add its webhook credentials and synchronize its instructions.",
                    )
                  }
                />
              ))}
          </div>
          <form
            className="crew-webhook-card"
            onSubmit={saveCredentials}
            autoComplete="off"
            data-private="true"
          >
            <h3>Webhook credentials</h3>
            <p>
              Copy the URL and key from the dispatcher’s webhook routine
              directly into these fields. Do not paste them into chat. Saving
              sends nothing.
            </p>
            <p>
              Endpoint:{" "}
              {config.url_configured
                ? val(config, "receiver_host") || "configured"
                : "not configured"}{" "}
              · Credential:{" "}
              {config.secret_configured ? "configured" : "not configured"}
            </p>
            <label className="crew-field">
              <span>
                {config.url_configured
                  ? "Replacement webhook URL"
                  : "Webhook URL"}
              </span>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                placeholder="https://…"
                disabled={blocked}
              />
            </label>
            <label className="crew-field">
              <span>
                {config.secret_configured
                  ? "Replacement secret"
                  : "Webhook secret"}
              </span>
              <input
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                autoComplete="new-password"
                spellCheck={false}
                disabled={blocked}
              />
            </label>
            <p className="crew-footnote">
              Saved values are never filled back in. Leave a field empty to keep
              it. Replacing the URL requires a new secret.
            </p>
            <button
              className="crew-primary"
              disabled={
                blocked || (!url.trim() && !secret) || (!!url.trim() && !secret)
              }
            >
              Save credentials
            </button>
          </form>
          <form className="crew-webhook-card" onSubmit={saveSettings}>
            <h3>Dispatcher instructions</h3>
            <p>
              Revision {Number(config.instruction_revision) || 1} · {syncLabel}
            </p>
            <p>
              Ask your connected assistant to apply these instructions to the
              selected bot’s webhook routine through MCP, then record the
              applied revision. Fetching instructions alone does not synchronize
              them. Verified means the assistant reported matching saved text,
              not certified Grok behavior.
            </p>
            {val(config, "routine_ref") && (
              <p>Routine: {val(config, "routine_ref")}</p>
            )}
            <label className="crew-field">
              <span>Routine instructions</span>
              <textarea
                rows={12}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                disabled={blocked}
              />
            </label>
            <button
              type="button"
              disabled={blocked}
              onClick={() => {
                void navigator.clipboard
                  .writeText(instructions)
                  .then(() =>
                    setMessage(
                      "Instructions copied. No credentials are included.",
                    ),
                  )
                  .catch(() =>
                    setError(
                      "Could not copy instructions. Select and copy the text instead.",
                    ),
                  );
              }}
            >
              Copy instructions
            </button>
            <fieldset className="crew-integration-events">
              <legend>Notify when a task becomes actionable</legend>
              {reasons.map((reason) => (
                <label key={reason}>
                  <input
                    type="checkbox"
                    checked={subscriptions.includes(reason)}
                    disabled={blocked}
                    onChange={(e) =>
                      setSubscriptions((items) =>
                        e.target.checked
                          ? [...items, reason]
                          : items.filter((item) => item !== reason),
                      )
                    }
                  />
                  {labels[reason]}
                </label>
              ))}
            </fieldset>
            <button
              className="crew-primary"
              disabled={
                blocked ||
                !instructions.trim() ||
                !subscriptions.length ||
                (instructions === val(config, "instructions") &&
                  JSON.stringify(subscriptions) ===
                    JSON.stringify(list(config, "subscriptions")))
              }
            >
              Save instructions and events
            </button>
          </form>
          <div className="crew-webhook-card">
            <h3>Test and enable</h3>
            <p>
              A test may start a Grok routine run. Its instructions must
              recognize the test and acknowledge it without doing task work.
              HTTP acceptance alone does not verify routing or execution.
            </p>
            <div className="crew-integration-actions">
              <button
                disabled={
                  blocked ||
                  !config.url_configured ||
                  !config.secret_configured ||
                  !synced ||
                  !currentAgent
                }
                onClick={() =>
                  void mutate(
                    "webhook.test",
                    {},
                    config,
                    "Test queued. Check delivery history and the Grok routine for its acknowledgment.",
                  )
                }
              >
                Send test
              </button>
              <button
                className="crew-primary"
                disabled={blocked || (!config.enabled && !canEnable)}
                onClick={() =>
                  void mutate(
                    config.enabled ? "webhook.disable" : "webhook.enable",
                    {},
                    config,
                    config.enabled
                      ? "Delivery disabled."
                      : "Delivery enabled. Existing tasks were not replayed.",
                  )
                }
              >
                {config.enabled ? "Disable delivery" : "Enable delivery"}
              </button>
            </div>
            {!config.enabled && !canEnable && (
              <p className="crew-footnote">
                Choose an active dispatcher and its bot mapping, save
                credentials, and apply the current routine instructions before
                enabling.
              </p>
            )}
            <p className="crew-footnote">
              Grok handoffs and busy-bot behavior need verification in your
              account.
            </p>
          </div>
          <div className="crew-webhook-card">
            <h3>Delivery and execution</h3>
            <p>
              Receiver acceptance does not mean the task started or completed.
              Human review decisions remain separate.
            </p>
            {!deliveries.length ? (
              <p>No deliveries recorded.</p>
            ) : (
              <ul>
                {deliveries
                  .slice()
                  .sort((a, b) =>
                    val(b, "created").localeCompare(val(a, "created")),
                  )
                  .slice(0, 30)
                  .map((delivery) => (
                    <li key={delivery.id}>
                      <strong>
                        {deliveryStates[val(delivery, "state")] ||
                          "Unknown delivery status"}
                      </strong>{" "}
                      ·{" "}
                      {val(delivery, "task") ? (
                        <a
                          href={`/#/tasks/${encodeURIComponent(val(delivery, "task"))}`}
                        >
                          Task wake
                        </a>
                      ) : (
                        "Test event"
                      )}{" "}
                      · {Number(delivery.attempts) || 0} attempts
                      {executions
                        .filter((ex) => ex.delivery === delivery.id)
                        .map((ex) => (
                          <span key={ex.id} className="crew-execution-state">
                            {ex.state === "handed_off" && ex.handoff_at
                              ? "Handoff reported"
                              : executionStates[val(ex, "state")] ||
                                "Execution recorded"}
                          </span>
                        ))}
                    </li>
                  ))}
              </ul>
            )}
            {executions.length > 0 && (
              <ExecutionRecovery
                executions={executions}
                disabled={blocked}
                onRecover={(row, resolution) =>
                  mutate(
                    "execution.recover",
                    { resolution },
                    row,
                    resolution === "retry"
                      ? "Retry authorized. Ask the intended recipient to resume this execution; no webhook or message was sent."
                      : "Execution cancelled. Review any external work separately.",
                  )
                }
              />
            )}
            {deliveries.length > 30 && (
              <p>Showing the 30 most recent deliveries.</p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
function AgentMapping({
  agent,
  mapping,
  selected,
  disabled,
  onSave,
  onSelect,
}: {
  agent: Row;
  mapping?: Row;
  selected: boolean;
  disabled: boolean;
  onSave: (value: string, mapping?: Row) => Promise<boolean>;
  onSelect: () => Promise<boolean>;
}) {
  const [reference, setReference] = useState(val(mapping, "bot_ref"));
  useEffect(() => setReference(val(mapping, "bot_ref")), [mapping]);
  return (
    <form
      className="crew-webhook-card"
      aria-label={`${val(agent, "name")} routing`}
      onSubmit={(e) => {
        e.preventDefault();
        void onSave(reference.trim(), mapping);
      }}
    >
      <h4>{val(agent, "name")}</h4>
      {!val(mapping, "bot_ref") && (
        <p className="crew-assignment-warning">
          No Grok Bot mapping. Ready tasks for this agent cannot be routed.
        </p>
      )}
      <label className="crew-field">
        <span>Grok Bot reference for {val(agent, "name")}</span>
        <input
          value={reference}
          disabled={disabled}
          onChange={(e) => setReference(e.target.value)}
          placeholder="Exact bot reference"
        />
      </label>
      <label className="crew-dispatcher-choice">
        <input
          type="checkbox"
          checked={selected}
          disabled={disabled}
          onChange={() => void onSelect()}
        />
        Use {val(agent, "name")} as Crew dispatcher
      </label>
      <button
        disabled={disabled || reference.trim() === val(mapping, "bot_ref")}
      >
        Save {val(agent, "name")} mapping
      </button>
    </form>
  );
}

function ExecutionRecovery({
  executions,
  disabled,
  onRecover,
}: {
  executions: Row[];
  disabled: boolean;
  onRecover: (row: Row, resolution: string) => Promise<boolean>;
}) {
  const [selected, setSelected] = useState<string>("");
  const [reviewed, setReviewed] = useState(false);
  const recoverable = executions.filter(
    (row) =>
      ["failed", "handed_off"].includes(val(row, "state")) ||
      (["dispatching", "running"].includes(val(row, "state")) &&
        Date.parse(val(row, "lease_until")) <= Date.now()),
  );
  if (!recoverable.length) return null;
  return (
    <details className="crew-execution-recovery">
      <summary>Recover interrupted work ({recoverable.length})</summary>
      <p>
        The bot may already have performed external work. Review the bot
        conversation and affected systems before deciding. Cancelling cannot
        undo external actions.
      </p>
      <label className="crew-field">
        <span>Execution to recover</span>
        <select
          value={selected}
          disabled={disabled}
          onChange={(e) => {
            setSelected(e.target.value);
            setReviewed(false);
          }}
        >
          <option value="">Choose an execution</option>
          {recoverable.map((row) => (
            <option key={row.id} value={row.id}>
              {val(row, "task") || "Task"} ·{" "}
              {executionStates[val(row, "state")] || "Unknown"} · {row.id}
            </option>
          ))}
        </select>
      </label>
      <label className="crew-dispatcher-choice">
        <input
          type="checkbox"
          checked={reviewed}
          disabled={disabled || !selected}
          onChange={(e) => setReviewed(e.target.checked)}
        />
        I reviewed the uncertain outcome and any external actions.
      </label>
      <div className="crew-integration-actions">
        {["cancel", "retry"].map((resolution) => (
          <button
            key={resolution}
            disabled={disabled || !selected || !reviewed}
            onClick={() => {
              const row = recoverable.find((r) => r.id === selected);
              if (row)
                void onRecover(row, resolution).then((ok) => {
                  if (ok) {
                    setSelected("");
                    setReviewed(false);
                  }
                });
            }}
          >
            {resolution === "cancel" ? "Cancel execution" : "Authorize retry"}
          </button>
        ))}
      </div>
      <p className="crew-footnote">
        Retry authorizes another acquisition of this execution. It does not send
        a webhook or message. Ask the intended bot to resume it after
        authorization.
      </p>
    </details>
  );
}
