import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
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
  dispatching: "Dispatcher started",
  handed_off: "Handoff prepared",
  invalidated: "Invalidated",
  test_acknowledged: "Test acknowledged",
  running: "Execution started",
  completed: "Completed",
  failed: "Failed",
};
type Blocker = { code: string; message: string };
type Setup = {
  can_test: boolean;
  can_enable: boolean;
  blockers: Blocker[];
  test_blockers?: Blocker[];
  test_acknowledged: boolean;
  runtime_reported: boolean;
  native_handoff_reported: boolean;
};
function ago(value: unknown, now: number) {
  const time = Date.parse(String(value || ""));
  if (!Number.isFinite(time)) return "";
  const seconds = Math.max(0, Math.floor((now - time) / 1000));
  return seconds < 60
    ? `${seconds}s`
    : seconds < 3600
      ? `${Math.floor(seconds / 60)}m`
      : `${Math.floor(seconds / 3600)}h`;
}
function Step({
  number,
  title,
  done,
  children,
}: {
  number: number;
  title: string;
  done?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="crew-setup-step" aria-label={title}>
      <div className="crew-setup-heading">
        <span
          className={done ? "crew-step-number complete" : "crew-step-number"}
        >
          {done ? "✓" : number}
        </span>
        <h3>{title}</h3>
        {done && <span className="crew-step-complete">Complete</span>}
      </div>
      {children}
    </section>
  );
}
function Blockers({ items }: { items: Blocker[] }) {
  return items.length ? (
    <ul className="crew-setup-blockers">
      {items.map((x) => (
        <li key={x.code}>{x.message}</li>
      ))}
    </ul>
  ) : null;
}
// Only explicitly named safe fields are rendered; credentials and raw errors are never serialized.
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
  const [subscriptions, setSubscriptions] = useState<string[]>([]);
  const [roleInstructions, setRoleInstructions] = useState("");
  const [reportingInstructions, setReportingInstructions] = useState("");
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [now, setNow] = useState(Date.now());
  const retryKeys = useRef(new Map<string, string>());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    void Promise.all([
      crewApi.read("webhook_configs"),
      crewApi.read("webhook_mappings"),
      crewApi.read("webhook_deliveries"),
      crewApi.read("webhook_executions"),
    ])
      .then(([cs, ms, ds, es]) => {
        if (!alive) return;
        const current = cs.find((x) => x.scope === "global");
        setConfig(current);
        setMappings(ms);
        setDeliveries(ds);
        setExecutions(es);
        setLegacyCount(cs.filter((x) => x.scope === "legacy").length);
        setSubscriptions(list(current, "subscriptions"));
        setRoleInstructions(val(current, "role_instructions"));
        setReportingInstructions(val(current, "reporting_instructions"));
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
      const reason =
        (
          failure as {
            response?: { data?: { reason?: { code?: string } } };
            data?: { reason?: { code?: string } };
          }
        )?.response?.data?.reason?.code ||
        (failure as { data?: { reason?: { code?: string } } })?.data?.reason
          ?.code;
      const guidance: Record<string, string> = {
        instructions_mismatch:
          "The saved routine's managed block does not match Crew. Apply the current block from step 2, then report synchronization again.",
        runtime_unverified:
          "Send the safe connection test and wait for the actual webhook routine to report its capabilities.",
        native_handoff_missing:
          "The webhook routine has not reported native handoff support. Check its available tools in Grok.",
        execution_required:
          "This task requires its current execution authority. The recipient must use execution.begin and the fenced task protocol.",
        test_ack_missing:
          "Send the safe connection test and wait for its acknowledgment.",
      };
      setError(
        (reason && guidance[reason]) ||
          (conflict
            ? "This configuration changed elsewhere. Refresh, review the latest settings, and try again."
            : "The change could not be confirmed. Check the configuration and try again. Credentials are never included in this message."),
      );
      return false;
    } finally {
      setBusy(false);
    }
  }
  const blocked = loading || busy;
  const activeAgents = agents.filter((a) => !a.archived);
  const currentAgent = activeAgents.find((a) => a.id === val(config, "agent"));
  const synced =
    !!config &&
    Number(config.applied_revision) === Number(config.instruction_revision) &&
    ["reported", "verified"].includes(val(config, "sync_status"));
  const syncLabel = !synced
    ? "Instructions not applied"
    : config?.sync_status === "verified"
      ? "Matching saved text reported"
      : "Application reported";
  const baseBlockers: Blocker[] = [];
  if (!currentAgent)
    baseBlockers.push({
      code: "dispatcher_required",
      message: "Choose an active dispatcher in step 1.",
    });
  if (
    currentAgent &&
    !mappings.some((m) => m.agent === currentAgent.id && val(m, "bot_ref"))
  )
    baseBlockers.push({
      code: "dispatcher_mapping_required",
      message:
        "Ask Grok to confirm the dispatcher's bot mapping using the setup prompt.",
    });
  if (!config?.url_configured || !config?.secret_configured)
    baseBlockers.push({
      code: "credentials_required",
      message: "Paste the webhook URL and secret in step 3.",
    });
  if (!synced)
    baseBlockers.push({
      code: "instructions_required",
      message: `Apply instruction revision ${Number(config?.instruction_revision) || 1} in Grok using the setup prompt.`,
    });
  const setup = config?.setup as Setup | undefined;
  const testBlockers = setup?.test_blockers ?? baseBlockers;
  const canTest = setup?.can_test ?? !baseBlockers.length;
  const canEnable = setup?.can_enable ?? false;
  const enableBlockers = setup?.blockers ?? [
    ...baseBlockers,
    {
      code: "verification_required",
      message:
        "Complete the connection test and refresh its acknowledgment before enabling.",
    },
  ];
  const mapped = mappings.filter(
    (m) => activeAgents.some((a) => a.id === m.agent) && val(m, "bot_ref"),
  ).length;
  const setupPrompt = `Set up this existing Grok Bot as the Crew dispatcher, keeping its normal responsibilities. Use the existing shared Crew MCP connection; do not create another bot or connection.\n\n1. Read crew_read collection capabilities for the current operation contracts, then read webhook_configs, agents and webhook_mappings. Do not infer unsupported operations from stale tool descriptions. If this client cannot submit required execution or idempotency fields, follow the advertised data._crew compatibility envelope. If neither path is available, stop and report the blocker.\n2. Reuse the selected dispatcher ${JSON.stringify(val(currentAgent, "name"))} (Crew agent ${JSON.stringify(val(currentAgent, "id"))}). Discover the existing Grok Bots and save confirmed mappings, including readable names where supported; ask only about ambiguous matches. Never guess identifiers.\n3. Apply Crew's current managed dispatcher instruction block to the existing webhook routine. Preserve the bot's role and required reporting settings outside that block. Read saved text back if supported and report instruction synchronization honestly.\n4. Check the tools available inside the actual webhook routine, not only this parent chat. The routine must report its execution and native-handoff capabilities using the current Crew contract. If native messaging is unavailable, report the blocker; never pretend a handoff was sent.\n5. I will copy the webhook URL and key directly from Grok into Crew's browser form. Never read, request, print or copy those values into chat, notes or MCP. Reuse the existing routine and credential binding.\n6. Do not enable delivery, test, replay tasks or perform work from this setup request. Report readiness and exact remaining blockers.\n\nThe canonical managed block is available in the global configuration's instructions field; always fetch its current revision. The runtime must stop if execution.begin cannot establish authority; never fall back to ordinary task writes.`;
  async function copy(text: string, success: string) {
    try {
      await navigator.clipboard.writeText(text);
      setMessage(success);
    } catch {
      setError("Could not copy. Open the prompt and copy its text manually.");
    }
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
      "Credentials saved. No request was sent.",
    );
    if (ok) {
      setUrl("");
      setSecret("");
    }
  }
  const routeEvidence = executions.filter(
    (ex) =>
      ex.state === "completed" &&
      ex.config === config?.id &&
      ex.destination_version === config?.destination_version,
  );
  const selfEvidence = routeEvidence.some((ex) => ex.agent === config?.agent);
  const otherEvidence = routeEvidence.some((ex) => ex.agent !== config?.agent);
  const routingPrompt = `Verify Crew routing with two clearly labeled synthetic tasks, one assigned to the selected dispatcher and one to a mapped specialist. First read crew_read collection capabilities and the current integration. Stop unless delivery is enabled. This prompt explicitly authorizes creating these two synthetic Ready tasks. Reuse existing test tasks if present. Each task should comment pong once and complete through execution.begin and the current fenced completion protocol. Verify an actual native handoff from the webhook routine. Do not infer success from HTTP acceptance or a reported send. Do not change credentials, mappings, dispatcher, ordinary tasks or perform backlog catch-up. Report event, execution and task evidence separately. This prompt authorizes only these synthetic routing tests; no external actions.`;
  return (
    <section className="crew-webhooks" aria-label="Grok Bot integration">
      <div className="crew-section-title">
        <h2>Connect your Grok team</h2>
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
        One existing bot receives Crew notifications and routes them to your
        team. Keep your normal bot roles and one shared MCP connection.
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
            </strong>{" "}
            · Dispatcher:{" "}
            {val(currentAgent, "name") || "Not selected or inactive"}
            <p>
              Only Ready tasks can wake a bot. Enabling does not notify existing
              tasks.
            </p>
          </div>
          <div className="crew-setup-grid">
            <Step
              number={1}
              title="Choose your dispatcher"
              done={!!currentAgent}
            >
              <p>
                Use an existing bot. It keeps its main job and also routes Crew
                notifications.
              </p>
              <label className="crew-field">
                <span>Crew dispatcher</span>
                <select
                  value={val(config, "agent")}
                  disabled={blocked}
                  onChange={(e) =>
                    void mutate(
                      "webhook.integration.update",
                      { agent: e.target.value },
                      config,
                      "Dispatcher changed. Connect its routine before enabling delivery.",
                    )
                  }
                >
                  <option value="">Choose an agent</option>
                  {activeAgents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {val(a, "name")}
                    </option>
                  ))}
                </select>
              </label>
              <p className="crew-footnote">
                Changing the dispatcher pauses delivery and clears the previous
                webhook binding.
              </p>
            </Step>
            <Step
              number={2}
              title="Prepare Grok"
              done={synced && mapped === activeAgents.length && mapped > 0}
            >
              <p>
                Paste one setup prompt into{" "}
                {val(currentAgent, "name") || "your selected bot"}'s Grok chat.
                It asks Grok to discover your bots, save mappings and apply the
                current routine instructions where its tools support them.
              </p>
              <button
                className="crew-primary"
                disabled={blocked || !currentAgent}
                onClick={() =>
                  void copy(
                    setupPrompt,
                    "Setup prompt copied. It contains no credentials.",
                  )
                }
              >
                Copy setup prompt
              </button>
              <details>
                <summary>Read setup prompt</summary>
                <pre className="crew-copy-prompt">{setupPrompt}</pre>
              </details>
              <p>
                <strong>{syncLabel}</strong> · Revision{" "}
                {Number(config.instruction_revision) || 1}
              </p>
              {!synced && (
                <p className="crew-assignment-warning">
                  Apply instruction revision{" "}
                  {Number(config.instruction_revision) || 1} in Grok, then
                  refresh this page.
                </p>
              )}
              <p>
                {mapped} of {activeAgents.length} agents mapped.
              </p>
              <ul className="crew-mapping-summary">
                {activeAgents.map((a) => {
                  const m = mappings.find(
                    (x) => x.agent === a.id && val(x, "bot_ref"),
                  );
                  return (
                    <li key={a.id}>
                      <strong>{val(a, "name")}</strong>
                      <span>
                        →{" "}
                        {m
                          ? val(m, "bot_name") || "Connected Grok Bot"
                          : "Not mapped"}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {mapped < activeAgents.length && (
                <p className="crew-footnote">
                  Unmapped agents cannot receive Ready-task notifications. The
                  setup prompt asks only about ambiguous matches.
                </p>
              )}
            </Step>
            <Step
              number={3}
              title="Enter webhook credentials"
              done={!!config.url_configured && !!config.secret_configured}
            >
              <p>
                Copy the URL and key from the selected bot's Grok routine
                directly into Crew. Never paste them into chat.
              </p>
              <p>
                Endpoint:{" "}
                {config.url_configured
                  ? val(config, "receiver_host") || "configured"
                  : "not configured"}{" "}
                · Credential:{" "}
                {config.secret_configured ? "configured" : "not configured"}
              </p>
              <details
                open={!config.url_configured || !config.secret_configured}
              >
                <summary>
                  {config.url_configured && config.secret_configured
                    ? "Replace saved credentials"
                    : "Add credentials"}
                </summary>
                <form
                  onSubmit={saveCredentials}
                  autoComplete="off"
                  data-private="true"
                >
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
                    Saved values are never filled back in. Leave a field empty
                    to keep it. Replacing the URL requires a new secret. Saving
                    sends nothing.
                  </p>
                  <button
                    className="crew-primary"
                    disabled={
                      blocked ||
                      (!url.trim() && !secret) ||
                      (!!url.trim() && !secret)
                    }
                  >
                    Save credentials
                  </button>
                </form>
              </details>
            </Step>
            <Step
              number={4}
              title="Verify the connection"
              done={!!setup?.test_acknowledged}
            >
              <p>
                Send a harmless test to the routine. It may start a Grok run,
                but must acknowledge the test without task work or forwarding.
              </p>
              <button
                disabled={blocked || !canTest}
                onClick={() =>
                  void mutate(
                    "webhook.test",
                    {},
                    config,
                    "Test queued. Refresh to check its acknowledgment and runtime capability report.",
                  )
                }
              >
                Send test
              </button>
              {!canTest && <Blockers items={testBlockers} />}
              <p>
                {setup?.test_acknowledged
                  ? "Test acknowledged by the routine."
                  : "No current test acknowledgment yet."}
              </p>
              <p className="crew-footnote">
                A successful HTTP response is not a test acknowledgment. Runtime
                capability reports describe the tools available to that webhook
                run; they are not independent certification.
              </p>
            </Step>
            <Step
              number={5}
              title="Enable future notifications"
              done={!!config.enabled}
            >
              <p>
                Enable delivery after checking the routine's setup. Existing
                tasks are not replayed.
              </p>
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
              {!config.enabled && !canEnable && (
                <Blockers items={enableBlockers} />
              )}
            </Step>
            <Step
              number={6}
              title="Verify task routing (optional)"
              done={selfEvidence && otherEvidence}
            >
              <p>
                Use an explicit synthetic test to check work for the dispatcher
                itself and a handoff to another bot. This is separate from the
                harmless connection test.
              </p>
              <ul>
                <li>
                  Dispatcher task:{" "}
                  {selfEvidence
                    ? "completed execution recorded"
                    : "not yet verified"}
                </li>
                <li>
                  Specialist task:{" "}
                  {otherEvidence
                    ? "completed execution recorded"
                    : "not yet verified"}
                </li>
              </ul>
              <button
                disabled={blocked || !currentAgent || !config.enabled}
                onClick={() =>
                  void copy(
                    routingPrompt,
                    "Routing test prompt copied. It authorizes only the described synthetic tasks.",
                  )
                }
              >
                Copy routing test prompt
              </button>
              <details>
                <summary>Read routing test prompt</summary>
                <pre className="crew-copy-prompt">{routingPrompt}</pre>
              </details>
              <p className="crew-footnote">
                Enable delivery first, then run only the authorized sample
                tasks. Recorded completion is reported by the worker; check the
                resulting task and Grok conversation.
              </p>
            </Step>
          </div>
          <section
            className="crew-webhook-card"
            aria-label="Notification activity"
          >
            <h3>Notification activity</h3>
            <p>
              Receiver acceptance does not mean the task started or completed.
              Human review decisions remain separate.
            </p>
            {!deliveries.length ? (
              <p>No deliveries recorded.</p>
            ) : (
              deliveries
                .slice()
                .sort((a, b) =>
                  val(b, "created").localeCompare(val(a, "created")),
                )
                .slice(0, 30)
                .map((d) => (
                  <EventTimeline
                    key={d.id}
                    delivery={d}
                    execution={executions.find((e) => e.delivery === d.id)}
                    agents={agents}
                    now={now}
                  />
                ))
            )}
            {deliveries.length > 30 && (
              <p>Showing the 30 most recent deliveries.</p>
            )}
          </section>
          <details className="crew-webhook-card crew-advanced">
            <summary>Advanced settings and recovery</summary>
            {legacyCount > 0 && (
              <p>
                {legacyCount} previous per-agent configurations are retained as
                disabled history.
              </p>
            )}
            <h3>Bot mappings</h3>
            <p>
              Normally your assistant manages these from the setup prompt. Edit
              a reference only when you can resolve it unambiguously in Grok.
            </p>
            <div className="crew-integration-mappings">
              {activeAgents.map((a) => (
                <AgentMapping
                  key={`${a.id}:${mappings.find((m) => m.agent === a.id)?.revision ?? 0}`}
                  agent={a}
                  mapping={mappings.find((m) => m.agent === a.id)}
                  disabled={blocked}
                  onSave={(ref, row) =>
                    mutate(
                      "webhook.mapping.update",
                      { agent: a.id, bot_ref: ref },
                      row,
                      "Bot mapping saved.",
                      row?.revision ?? 0,
                    )
                  }
                />
              ))}
            </div>
            <h3>Managed instructions</h3>
            <p>
              {syncLabel}. Matching saved text is reported by the assistant;
              Crew does not independently inspect Grok.
            </p>
            {val(config, "routine_ref") && (
              <p>Routine reference: {val(config, "routine_ref")}</p>
            )}
            <label className="crew-field">
              <span>Routine instructions</span>
              <textarea
                readOnly
                rows={10}
                value={val(config, "instructions")}
                disabled={blocked}
              />
            </label>
            <button
              disabled={blocked}
              onClick={() =>
                void copy(
                  val(config, "instructions"),
                  "Managed instructions copied. No credentials are included.",
                )
              }
            >
              Copy instructions
            </button>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void mutate(
                  "webhook.integration.update",
                  {
                    subscriptions,
                    role_instructions: roleInstructions,
                    reporting_instructions: reportingInstructions,
                  },
                  config,
                  "Notification events saved. Review and re-enable delivery if it paused.",
                );
              }}
            >
              <label className="crew-field">
                <span>Bot role instructions</span>
                <textarea
                  rows={4}
                  value={roleInstructions}
                  disabled={blocked}
                  onChange={(e) => setRoleInstructions(e.target.value)}
                />
              </label>
              <label className="crew-field">
                <span>Reporting instructions</span>
                <textarea
                  rows={4}
                  value={reportingInstructions}
                  disabled={blocked}
                  onChange={(e) => setReportingInstructions(e.target.value)}
                />
              </label>
              <p className="crew-footnote">
                These settings stay outside Crew's managed block. After changing
                them, apply and report the saved routine again.
              </p>
              <fieldset className="crew-integration-events">
                <legend>Notify when a task becomes actionable</legend>
                {reasons.map((reason) => (
                  <label key={reason}>
                    <input
                      type="checkbox"
                      checked={subscriptions.includes(reason)}
                      disabled={blocked}
                      onChange={(e) =>
                        setSubscriptions((xs) =>
                          e.target.checked
                            ? [...xs, reason]
                            : xs.filter((x) => x !== reason),
                        )
                      }
                    />
                    {labels[reason]}
                  </label>
                ))}
              </fieldset>
              <button
                disabled={
                  blocked ||
                  !subscriptions.length ||
                  (JSON.stringify(subscriptions) ===
                    JSON.stringify(list(config, "subscriptions")) &&
                    roleInstructions === val(config, "role_instructions") &&
                    reportingInstructions ===
                      val(config, "reporting_instructions"))
                }
              >
                Save advanced settings
              </button>
            </form>
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
                    : "Coordinated work cancelled. External actions were not undone.",
                )
              }
            />
          </details>
        </>
      )}
    </section>
  );
}
function AgentMapping({
  agent,
  mapping,
  disabled,
  onSave,
}: {
  agent: Row;
  mapping?: Row;
  disabled: boolean;
  onSave: (value: string, mapping?: Row) => Promise<boolean>;
}) {
  const [reference, setReference] = useState(val(mapping, "bot_ref"));
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
      <p>{val(mapping, "bot_name") || "Grok Bot reference"}</p>
      <label className="crew-field">
        <span>Grok Bot reference for {val(agent, "name")}</span>
        <input
          value={reference}
          disabled={disabled}
          onChange={(e) => setReference(e.target.value)}
          placeholder="Confirmed bot reference"
        />
      </label>
      <button
        disabled={disabled || reference.trim() === val(mapping, "bot_ref")}
      >
        Save {val(agent, "name")} mapping
      </button>
    </form>
  );
}
function EventTimeline({
  delivery: d,
  execution: ex,
  agents,
  now,
}: {
  delivery: Row;
  execution?: Row;
  agents: Row[];
  now: number;
}) {
  const recipient = agents.find((a) => a.id === d.agent);
  const task = val(d, "task");
  const timestamps = [
    {
      label: deliveryStates[val(d, "state")] || "Unknown delivery status",
      time:
        val(d, "state") === "accepted"
          ? val(d, "accepted_at")
          : val(d, "created"),
    },
    ...(ex?.dispatch_started_at
      ? [{ label: "Dispatcher started", time: val(ex, "dispatch_started_at") }]
      : []),
    ...(ex?.handoff_prepared_at ||
    ex?.handoff_deadline_at ||
    ex?.handoff_at ||
    ex?.state === "handed_off"
      ? [{ label: "Handoff prepared", time: val(ex, "handoff_prepared_at") }]
      : []),
    ...(ex?.handoff_at
      ? [{ label: "Handoff reported", time: val(ex, "handoff_at") }]
      : []),
    ...(ex?.acquired_at
      ? [{ label: "Recipient started", time: val(ex, "acquired_at") }]
      : []),
    ...(ex
      ? [
          {
            label: executionStates[val(ex, "state")] || "Execution recorded",
            time: val(ex, "completed_at"),
          },
        ]
      : []),
  ];
  const pending = ex?.state === "handed_off";
  const leaseExpired =
    ex?.lease_expired === true ||
    (!!ex?.lease_until && Date.parse(val(ex, "lease_until")) <= now);
  const overdue =
    ex?.waiting_overdue === true ||
    (pending &&
      !!ex?.handoff_deadline_at &&
      Date.parse(val(ex, "handoff_deadline_at")) <= now);
  return (
    <article className="crew-event">
      <div className="crew-event-heading">
        {task ? (
          <a href={`/#/tasks/${encodeURIComponent(task)}`}>
            Task wake{recipient ? ` for ${val(recipient, "name")}` : ""}
          </a>
        ) : (
          <strong>Connection test</strong>
        )}
        <span>{Number(d.attempts) || 0} attempts</span>
      </div>
      <ol className="crew-event-timeline">
        {timestamps
          .filter((x, i, xs) => i === xs.findIndex((y) => y.label === x.label))
          .map((x) => (
            <li key={x.label}>
              <span>{x.label}</span>
              {x.time && (
                <time dateTime={x.time}>
                  {new Date(x.time).toLocaleString()}
                </time>
              )}
            </li>
          ))}
      </ol>
      {pending && (
        <p className={overdue ? "crew-assignment-warning" : "crew-footnote"}>
          {overdue
            ? "Recipient acknowledgment overdue"
            : "Waiting for recipient acquisition"}
          {ago(ex?.handoff_at || ex?.created, now)
            ? ` · ${ago(ex?.handoff_at || ex?.created, now)} elapsed`
            : ""}
          .{" "}
          {overdue
            ? "Review the bot conversation before recovery. No automatic resend."
            : "A reported send is not proof that the recipient started."}
        </p>
      )}
      {!!ex?.lease_until && (
        <p
          className={leaseExpired ? "crew-assignment-warning" : "crew-footnote"}
        >
          {leaseExpired ? "Execution lease expired" : "Execution lease expires"}{" "}
          · {new Date(val(ex, "lease_until")).toLocaleString()}
          {leaseExpired
            ? ". Reconcile the outcome before authorizing another attempt."
            : ""}
        </p>
      )}
    </article>
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
            {resolution === "cancel"
              ? "Cancel coordinated work"
              : "Authorize another attempt"}
          </button>
        ))}
      </div>
      <p className="crew-footnote">
        Retry authorizes another acquisition of this execution. It does not send
        a webhook or message. Ask the intended bot to resume it after
        authorization. Cancelling coordination cannot stop a run already in
        progress or undo external actions.
      </p>
    </details>
  );
}
