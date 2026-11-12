import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { crewApi, list, val, type Row } from "./crewApi";
import Help, { HelpField } from "./Help";
import type { HelpTopic } from "./helpContent";
import { itemPath } from "./itemLink";
import { isBot } from "./projectAgents";
import { strandedSince, strandedWakes } from "./wakes";
type WakeRule = {
  reason: string;
  label: string;
  /** Crew's default for new installs (pb_migrations/1800300000_crew_global_webhook.js). */
  recommended: boolean;
  /** When it fires, then what turning it off means. True to pb_hooks/crew_webhooks.js. */
  help: string;
};
const wakeRules: WakeRule[] = [
  {
    reason: "created",
    label: "Created ready",
    recommended: true,
    help: "Wakes the assigned bot when a task is created already Ready. Off: such tasks wait until something else wakes them.",
  },
  {
    reason: "assigned",
    label: "Assigned",
    recommended: true,
    help: "Wakes the bot a Ready task is assigned to. Off: assigning alone wakes no one.",
  },
  {
    reason: "reassigned",
    label: "Reassigned",
    recommended: true,
    help: "Wakes the new bot when a Ready task moves from one bot to another. Off: handoffs between bots stall.",
  },
  {
    reason: "ready",
    label: "Marked ready",
    recommended: true,
    help: "Wakes the assigned bot when a task on hold is set Ready, the normal way to release work. Off: setting Ready wakes no one.",
  },
  {
    reason: "reopened",
    label: "Reopened",
    recommended: true,
    help: "Wakes the assigned bot when a Ready task is reopened from Done or restored from the archive. Off: it waits until something else wakes it.",
  },
  {
    reason: "review_outcome",
    label: "Review resolved",
    recommended: true,
    help: "Wakes the assigned bot when a review is decided or withdrawn, so it can continue. Off: it waits until something else wakes it.",
  },
  {
    reason: "unassigned",
    label: "Unassigned (triage)",
    recommended: false,
    help: "Wakes the triage agent when a Ready task loses its assignee. Off: such tasks wait for you.",
  },
  {
    reason: "catch_up",
    label: "Explicit catch-up",
    recommended: true,
    help: "Lets you or your assistant ask for a catch-up wake on chosen Ready tasks. Never fires on its own. Off: catch-up requests are refused.",
  },
  {
    reason: "comment",
    label: "Owner comment",
    recommended: false,
    help: "Wakes the assigned bot when you comment on a Ready task in the browser; agent comments never wake. Turn on if you steer bots through comments. Off: comments are only recorded.",
  },
];
const recommendedSubscriptions = wakeRules
  .filter((x) => x.recommended)
  .map((x) => x.reason);
const recommendedHandoffLimit = 4;
const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));
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
  dispatch_mode?: "native" | "parent_bridge";
  parent_wake_reported?: boolean;
  parent_received?: boolean;
  recipient_acknowledged?: boolean;
  bridge_test_recipient_agent_id?: string;
  bridge_test_state?: string;
  bridge_test_overdue?: boolean;
  bridge_send_reported?: boolean;
  test_event_id?: string;
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
/** An unresolved warning this old, with nothing tying it to live work, is history. */
const staleWarningMs = 24 * 60 * 60 * 1000;
const initialActivityEntries = 3;
type ActivityWarning = "none" | "current" | "superseded" | "old";
/**
 * Decides how loudly a timeline entry may warn. Display only: delivery, overdue
 * and lease rules stay on the server. Handed-off records are invalidated lazily,
 * so a stale one can keep its state long after its task has moved on.
 */
function activityWarning(
  d: Row,
  ex: Row | undefined,
  deliveries: Row[],
  tasks: Row[],
  now: number,
): ActivityWarning {
  if (!ex) return "none";
  const waitingOverdue =
    ex.state === "handed_off" &&
    (ex.waiting_overdue === true ||
      (!!ex.handoff_deadline_at &&
        Date.parse(val(ex, "handoff_deadline_at")) <= now));
  const leaseExpired =
    !!ex.lease_until &&
    (ex.lease_expired === true || Date.parse(val(ex, "lease_until")) <= now);
  if (!waitingOverdue && !leaseExpired) return "none";
  const taskId = val(d, "task");
  const replaced =
    !!taskId &&
    deliveries.some(
      (x) =>
        x.id !== d.id &&
        val(x, "task") === taskId &&
        val(x, "created") > val(d, "created"),
    );
  const task = tasks.find((t) => t.id === taskId);
  if (task) {
    const generation = Number(ex.generation);
    const moved =
      task.archived === true ||
      val(task, "status") === "done" ||
      (!!val(task, "readiness") && val(task, "readiness") !== "ready") ||
      (Number.isFinite(generation) &&
        generation !== Number(task.wake_generation));
    // The task still waits on this exact wake, so age alone never quiets it.
    return replaced || moved ? "superseded" : "current";
  }
  if (replaced) return "superseded";
  const since = Date.parse(
    val(ex, "handoff_deadline_at") ||
      val(ex, "lease_until") ||
      val(ex, "handoff_at") ||
      val(ex, "updated") ||
      val(ex, "created"),
  );
  return Number.isFinite(since) && now - since > staleWarningMs
    ? "old"
    : "current";
}
function Step({
  number,
  title,
  done,
  help,
  expanded,
  future,
  current,
  onToggle,
  onUse,
  children,
}: {
  number: number;
  title: string;
  done?: boolean;
  help?: HelpTopic;
  expanded: boolean;
  future: boolean;
  current: boolean;
  onToggle: (step: number) => void;
  onUse: (step: number) => void;
  children: ReactNode;
}) {
  const classes = ["crew-setup-step"];
  if (done) classes.push("done");
  if (future) classes.push("future");
  return (
    <section
      className={classes.join(" ")}
      aria-label={title}
      aria-current={current ? "step" : undefined}
    >
      <div className="crew-setup-heading">
        <h3>
          <button
            type="button"
            className="crew-setup-toggle"
            aria-expanded={expanded}
            onClick={() => onToggle(number)}
          >
            <span
              aria-hidden="true"
              className={done ? "crew-step-number complete" : "crew-step-number"}
            >
              {done ? "✓" : number}
            </span>
            <span className="crew-step-title">{title}</span>
            {done && <span className="crew-step-complete">Complete</span>}
          </button>
        </h3>
        {help && <Help topic={help} />}
      </div>
      {expanded && (
        // Editing or opening something inside a step holds it open across refreshes.
        <div
          className="crew-setup-body"
          onChangeCapture={() => onUse(number)}
          onClickCapture={(e) => {
            if ((e.target as Element).closest("summary,[aria-expanded]"))
              onUse(number);
          }}
        >
          {children}
        </div>
      )}
    </section>
  );
}
function PromptActions({
  copyButton,
  readLabel,
  prompt,
}: {
  copyButton: ReactNode;
  readLabel: string;
  prompt: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="crew-prompt-actions">
        {copyButton}
        <button
          type="button"
          aria-label={readLabel}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Hide prompt" : "Read prompt"}
        </button>
      </div>
      {open && <pre className="crew-copy-prompt">{prompt}</pre>}
    </>
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
export default function WebhookStatus({
  agents,
  tasks = [],
  collapsible = false,
  mcpUrl = `${window.location.origin}/mcp`,
}: {
  agents: Row[];
  /** Current and archived tasks, used only to tell live warnings from old ones. */
  tasks?: Row[];
  collapsible?: boolean;
  /** null when this install has no MCP endpoint to authorize bots against. */
  mcpUrl?: string | null;
}) {
  const [open, setOpen] = useState(!collapsible);
  const [config, setConfig] = useState<Row>();
  const [mappings, setMappings] = useState<Row[]>([]);
  const [routing, setRouting] = useState<Row>();
  const [handoffLimit, setHandoffLimit] = useState("4");
  const [deliveries, setDeliveries] = useState<Row[]>([]);
  const [executions, setExecutions] = useState<Row[]>([]);
  const [bridges, setBridges] = useState<Row[]>([]);
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
  const [testRecipient, setTestRecipient] = useState("");
  const [reviewing, setReviewing] = useState(false);
  // Steps the owner opened or used, and steps the owner closed by hand.
  const [openedSteps, setOpenedSteps] = useState<ReadonlySet<number>>(new Set());
  const [closedSteps, setClosedSteps] = useState<ReadonlySet<number>>(new Set());
  const [showAllActivity, setShowAllActivity] = useState(false);
  const [now, setNow] = useState(Date.now());
  const retryKeys = useRef(new Map<string, string>());
  const loadTicket = useRef(0);
  const loadsInFlight = useRef(0);
  const loadFailed = useRef(false);
  const busyRef = useRef(false);
  const formBase = useRef<{
    subscriptions: string[];
    role: string;
    reporting: string;
    limit: string;
  }>(undefined);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);
  const load = useCallback(async (silent = false) => {
    const ticket = ++loadTicket.current;
    loadsInFlight.current++;
    if (!silent) setLoading(true);
    // Wake evidence is optional: a failure only hides the overdue list.
    void crewApi.read("webhook_bridges", { overdue: true }).then(
      (rows) => {
        if (ticket === loadTicket.current) setBridges(rows);
      },
      () => undefined,
    );
    try {
      const [cs, ms, ds, es, rs] = await Promise.all([
        crewApi.read("webhook_configs"),
        crewApi.read("webhook_mappings"),
        crewApi.read("webhook_deliveries"),
        crewApi.read("webhook_executions"),
        crewApi.read("webhook_routing"),
      ]);
      if (ticket !== loadTicket.current) return;
      const current = cs.find((x) => x.scope === "global");
      setConfig(current);
      setMappings(ms);
      setDeliveries(ds);
      setExecutions(es);
      setRouting(rs[0]);
      setLegacyCount(cs.filter((x) => x.scope === "legacy").length);
      // A field follows the server only while it still holds the last server
      // value, so a refresh never overwrites what the owner is typing.
      const next = {
        subscriptions: list(current, "subscriptions"),
        role: val(current, "role_instructions"),
        reporting: val(current, "reporting_instructions"),
        limit: String(Number(rs[0]?.max_bot_handoffs) || 4),
      };
      const base = formBase.current;
      setSubscriptions((value) =>
        !base || JSON.stringify(value) === JSON.stringify(base.subscriptions)
          ? next.subscriptions
          : value,
      );
      setRoleInstructions((value) =>
        !base || value === base.role ? next.role : value,
      );
      setReportingInstructions((value) =>
        !base || value === base.reporting ? next.reporting : value,
      );
      setHandoffLimit((value) =>
        !base || value === base.limit ? next.limit : value,
      );
      formBase.current = next;
      if (loadFailed.current) {
        loadFailed.current = false;
        setError("");
      }
      // Latched, so a later refresh cannot collapse a form in use.
      if (
        current?.enabled ||
        current?.url_configured ||
        current?.secret_configured ||
        val(current, "agent") ||
        ms.some((m) => val(m, "bot_ref")) ||
        ds.length ||
        es.length
      )
        setOpen(true);
    } catch {
      if (silent || ticket !== loadTicket.current) return;
      loadFailed.current = true;
      setError("Could not load the integration. Crew will try again shortly.");
      // Status is unknown, so show the error rather than hide live state.
      setOpen(true);
    } finally {
      loadsInFlight.current--;
      if (!silent) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
    return () => {
      loadTicket.current++;
    };
  }, [load, refresh]);
  // Same terms as the workspace refresh: visible tab, no overlap, no feedback.
  useEffect(() => {
    const refreshSilently = () => {
      if (document.hidden || busyRef.current || loadsInFlight.current) return;
      void load(true);
    };
    const timer = setInterval(refreshSilently, 30_000);
    document.addEventListener("visibilitychange", refreshSilently);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshSilently);
    };
  }, [load]);
  // Sends one revision-checked write with a retry key that survives a lost
  // response, so retrying the same change cannot apply it twice.
  async function send(
    action: string,
    data: Record<string, unknown>,
    row: Row | undefined,
    expectedRevision?: number,
  ) {
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
  }
  // Safe guidance for a failed write; raw server text is never shown.
  function describeFailure(failure: unknown) {
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
        "The routine has not reported native messaging. If it uses WakeParent, select the parent bridge and apply its current instructions.",
      parent_wake_missing:
        "The routine has not reported WakeParent. Check its actual tools and run the connection test again.",
      parent_receipt_missing:
        "The dispatcher parent has not acknowledged the wake. Check its Grok conversation before sending another test.",
      parent_native_handoff_missing:
        "The dispatcher parent has not reported native bot messaging. Check its available tools.",
      parent_execution_protocol_missing:
        "The dispatcher parent cannot use Crew's execution protocol. Refresh its tools before testing again.",
      recipient_test_required:
        "Choose a mapped teammate and run the end-to-end test before enabling delivery.",
      recipient_ack_missing:
        "The recipient has not acknowledged the test. Check its Grok conversation and prior authorization; do not resend an uncertain message.",
      execution_required:
        "Another execution is live on this task. The recipient must use execution.begin and the fenced task protocol, or wait for the live run to end.",
      test_ack_missing:
        "Send the safe connection test and wait for its acknowledgment.",
    };
    return {
      conflict,
      text:
        (reason && guidance[reason]) ||
        (conflict
          ? "This configuration changed elsewhere. Review the latest settings and try again."
          : "The change could not be confirmed. Check the configuration and try again. Credentials are never included in this message."),
    };
  }
  function startWrite() {
    if (busy) return false;
    setBusy(true);
    busyRef.current = true;
    loadFailed.current = false;
    // A background read that started before this write must not land after it.
    loadTicket.current++;
    setError("");
    setMessage("");
    return true;
  }
  function endWrite() {
    busyRef.current = false;
    setBusy(false);
  }
  async function mutate(
    action: string,
    data: Record<string, unknown>,
    row: Row | undefined,
    success: string,
    expectedRevision?: number,
  ) {
    if (!startWrite()) return false;
    try {
      await send(action, data, row, expectedRevision);
      setMessage(success);
      setRefresh((x) => x + 1);
      return true;
    } catch (failure) {
      const { conflict, text } = describeFailure(failure);
      setError(text);
      if (conflict) setRefresh((x) => x + 1);
      return false;
    } finally {
      endWrite();
    }
  }
  const blocked = loading || busy;
  // Only webhook bots are dispatched, mapped or woken; agents started manually
  // and people never need a bot mapping.
  const activeAgents = agents.filter((a) => !a.archived && isBot(a));
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
  const parentBridge = val(config, "dispatch_mode") === "parent_bridge";
  const testRecipients = activeAgents.filter((a) =>
    mappings.some((m) => m.agent === a.id && val(m, "bot_ref")),
  );
  const selectedTestRecipient =
    testRecipients.find((a) => a.id === testRecipient) ||
    testRecipients.find((a) => a.id !== config?.agent) ||
    testRecipients.find((a) => a.id === config?.agent);
  const testBlockers = setup?.test_blockers ?? baseBlockers;
  const canTest = setup?.can_test ?? !baseBlockers.length;
  const canEnable = setup?.can_enable ?? false;
  const testDelivery = setup?.test_event_id
    ? deliveries.find((d) => d.event_id === setup.test_event_id)
    : undefined;
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
  const setupPrompt = `Set up this existing Grok Bot as the Crew dispatcher, keeping its normal responsibilities. Use the existing shared Crew MCP connection; do not create another bot or connection.

1. Read crew_read collection capabilities for current operation contracts, then read webhook_configs, agents and webhook_mappings. Use the advertised data._crew compatibility envelope if this client lacks top-level execution or idempotency fields. Stop if neither path is available.
2. Reuse the selected dispatcher ${JSON.stringify(val(currentAgent, "name"))} (Crew agent ${JSON.stringify(val(currentAgent, "id"))}). Discover existing Grok Bots and save confirmed mappings with each bot's display name as bot_name; ask only about ambiguous matches. Never guess identifiers or use a Crew agent ID as a native messaging address.
3. The configured dispatch mode is ${parentBridge ? "parent_bridge: the webhook routine wakes this bot's parent conversation with WakeParent; the parent handles its own work or calls SendToAgent with priority:true for a teammate" : "native: dispatch directly inside the webhook routine using its native messaging tools"}. Apply Crew's current managed instruction block to the existing webhook routine, preserving the bot's role and reporting settings outside it. Read saved text back and report synchronization honestly.
4. Inspect tools in their actual execution context. Do not claim native messaging inside a routine merely because the parent can send. Follow Crew's durable wake/send guards and report missing tools honestly. Never retry an ambiguous native call.
5. Confirm that each recipient has the owner's direct authorization to use this Crew instance for its assigned work and explicit setup diagnostics. Report any missing authorization; do not claim that your message grants it.
6. I will copy the webhook URL and key directly from Grok into Crew's browser form. Never read, request, print or copy those values into chat, notes or MCP. Reuse the existing routine and credential binding.
7. Do not enable delivery, test, send bot messages, replay tasks or perform work from this setup request. Report readiness and exact remaining blockers.

Fetch the current canonical managed block from the global configuration's instructions field. Setup uses the full capabilities; wake runs read only crew_read {collection:"capabilities", id:"execution"} and skip it when they already hold the payload's capabilities_digest. The runtime must stop if execution.begin cannot establish authority; never fall back to ordinary task writes.`;
  const authorizationPrompt = `I authorize this bot to use my Crew instance at ${mcpUrl} through our shared MCP connection for explicitly tagged setup diagnostics and work assigned to its Crew agent. This authorization is subject to my existing task and human-review rules. It does not authorize other Crew instances, production changes, external actions or unrelated bot messages.

For a setup diagnostic, verify the connected instance, use Crew's current capability contract, and record only your own receipt and acknowledgment. Distinguish an automatically started turn from a human follow-up. Do no task work during a diagnostic and do not send acknowledgment loops. If the instance or recipient is ambiguous, stop and report the issue.`;
  // The owner posts this once in a Grok group with every bot: each bot reads the
  // owner's own message, which a relayed message from another bot can't replace.
  const groupAuthorizationPrompt = authorizationPrompt
    .replace(
      "I authorize this bot to use my Crew instance",
      "I authorize every bot in this group chat to use my Crew instance",
    )
    .replace("work assigned to its Crew agent", "work assigned to its own Crew agent")
    .concat(
      "\n\nEach bot: reply once here to confirm, then stop. Do not respond to other bots' confirmations.",
    );
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
      releaseStep(3);
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
  const routingPrompt = `Verify Crew routing with two clearly labeled synthetic tasks, one assigned to the selected dispatcher and one to a mapped specialist. First read crew_read collection capabilities and the current integration. Stop unless delivery is enabled. This prompt explicitly authorizes creating these two synthetic Ready tasks. Reuse existing test tasks if present. Each task should comment pong once and complete through execution.begin and the current fenced completion protocol. Verify the configured dispatch path, including the parent wake when parent_bridge is selected and the actual native handoff to the recipient. Do not infer success from HTTP acceptance or a reported send. Do not change credentials, mappings, dispatcher, ordinary tasks or perform backlog catch-up. Report event, execution and task evidence separately. This prompt authorizes only these synthetic routing tests; no external actions.`;
  const stepDone = [
    !!currentAgent,
    synced && mapped === activeAgents.length && mapped > 0,
    !!config?.url_configured && !!config?.secret_configured,
    canEnable,
    !!config?.enabled,
    selfEvidence && otherEvidence,
  ];
  // Steps 1-5 are required, and step 5 is delivery itself; step 6 is optional.
  const firstIncomplete = stepDone.slice(0, 5).findIndex((done) => !done);
  const setupComplete = !!config && firstIncomplete === -1;
  const autoStep =
    firstIncomplete >= 0 ? firstIncomplete + 1 : stepDone[5] ? 0 : 6;
  const showSteps = !setupComplete || reviewing || openedSteps.size > 0;
  function withStep(steps: ReadonlySet<number>, step: number, present: boolean) {
    const next = new Set(steps);
    if (present) next.add(step);
    else next.delete(step);
    return next;
  }
  function stepExpanded(step: number) {
    return (
      openedSteps.has(step) || (step === autoStep && !closedSteps.has(step))
    );
  }
  function toggleStep(step: number) {
    const expand = !stepExpanded(step);
    setOpenedSteps((steps) => withStep(steps, step, expand));
    setClosedSteps((steps) => withStep(steps, step, !expand));
  }
  function useStep(step: number) {
    setOpenedSteps((steps) => withStep(steps, step, true));
    setClosedSteps((steps) => withStep(steps, step, false));
  }
  function releaseStep(step: number) {
    setOpenedSteps((steps) => withStep(steps, step, false));
  }
  function resetSteps() {
    setReviewing(false);
    setOpenedSteps(new Set());
    setClosedSteps(new Set());
  }
  const stepProps = (number: number) => ({
    number,
    done: stepDone[number - 1],
    expanded: stepExpanded(number),
    current: number === autoStep,
    future: !stepDone[number - 1] && autoStep > 0 && number > autoStep,
    onToggle: toggleStep,
    onUse: useStep,
  });
  const recentDeliveries = deliveries
    .slice()
    .sort((a, b) => val(b, "created").localeCompare(val(a, "created")))
    .slice(0, 30);
  const activity = recentDeliveries.map((delivery, index) => {
    const execution = executions.find((e) => e.delivery === delivery.id);
    const warning = activityWarning(
      delivery,
      execution,
      deliveries,
      tasks,
      now,
    );
    return { delivery, execution, warning, index };
  });
  // Anything still needing recovery stays listed however far down it falls.
  const shownActivity = showAllActivity
    ? activity
    : activity.filter(
        (x) => x.index < initialActivityEntries || x.warning === "current",
      );
  const stranded = strandedWakes(bridges, tasks, agents);
  const savedSubscriptions = list(config, "subscriptions");
  const savedHandoffLimit = Number(routing?.max_bot_handoffs) || 4;
  const triageAgent = activeAgents.find(
    (a) => a.id === val(routing, "triage_agent"),
  );
  const subscriptionsChanged = !sameSet(subscriptions, savedSubscriptions);
  const limitValid =
    /^\d+$/.test(handoffLimit) &&
    Number(handoffLimit) >= 1 &&
    Number(handoffLimit) <= 20;
  const limitChanged =
    !!routing && limitValid && Number(handoffLimit) !== savedHandoffLimit;
  const canSaveWakeRules =
    !blocked &&
    subscriptions.length > 0 &&
    (!routing || limitValid) &&
    (subscriptionsChanged || limitChanged);
  const atRecommended =
    sameSet(subscriptions, recommendedSubscriptions) &&
    (!routing || handoffLimit === String(recommendedHandoffLimit));
  // What webhook.integration.update does to changed subscriptions on the server.
  const wakeRulesWarning = `Saving changed wake rules ${
    config?.enabled ? "turns delivery off, " : ""
  }cancels queued wakes and interrupts bots working on Ready tasks.${
    config?.enabled ? " Turn delivery back on afterwards." : ""
  } Ready tasks are not woken again until you put them on hold, then set them Ready.`;
  // Fills the form only; nothing is saved until Save wake rules.
  function resetWakeRules() {
    setSubscriptions(recommendedSubscriptions);
    if (routing) setHandoffLimit(String(recommendedHandoffLimit));
  }
  async function saveWakeRules(event: FormEvent) {
    event.preventDefault();
    if (!canSaveWakeRules) return;
    if (
      subscriptionsChanged &&
      !window.confirm(`${wakeRulesWarning}\n\nSave the new wake rules?`)
    )
      return;
    if (!startWrite()) return;
    let limitSaved = false;
    try {
      // The limit goes first: it never pauses delivery, so a failure after it
      // leaves the integration as it was.
      if (limitChanged) {
        await send(
          "webhook.routing.update",
          { max_bot_handoffs: Number(handoffLimit) },
          routing,
        );
        limitSaved = true;
      }
      if (subscriptionsChanged)
        await send(
          "webhook.integration.update",
          {
            subscriptions: wakeRules
              .map((x) => x.reason)
              .filter((x) => subscriptions.includes(x)),
          },
          config,
        );
      setMessage(
        subscriptionsChanged
          ? config?.enabled
            ? "Wake rules saved. Delivery is off; turn it back on with Enable delivery."
            : "Wake rules saved."
          : "Bot handoff limit saved.",
      );
    } catch (failure) {
      const { text } = describeFailure(failure);
      setError(
        limitSaved
          ? `The handoff limit was saved, but the rule changes were not. ${text}`
          : text,
      );
    } finally {
      // Reload either way, so the form shows exactly what was saved.
      setRefresh((x) => x + 1);
      endWrite();
    }
  }
  if (!open)
    return loading ? null : (
      <button type="button" onClick={() => setOpen(true)}>
        Set up automatic wake-ups
      </button>
    );
  return (
    <section className="crew-webhooks" aria-label="Grok Bot integration">
      <div className="crew-section-title">
        <h2>Grok setup</h2>
      </div>
      {!setupComplete && (
        <p>
          One existing bot receives Crew notifications and routes them to your
          team. Keep your normal bot roles
          {mcpUrl ? " and one shared MCP connection" : ""}.
        </p>
      )}
      {loading && <p role="status">Loading integration…</p>}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {!loading && !config && !error && (
        <p>
          No global integration is available yet. It appears here after the
          server upgrade completes.
        </p>
      )}
      {config && (
        <>
          {setupComplete ? (
            <div className="crew-wake-status">
              <p>
                <strong>Automatic wake-ups: on</strong> · {mapped} of{" "}
                {activeAgents.length} agents mapped
              </p>
              <button
                type="button"
                aria-expanded={showSteps}
                onClick={() => (showSteps ? resetSteps() : setReviewing(true))}
              >
                {showSteps ? "Hide setup" : "Review setup"}
              </button>
            </div>
          ) : (
            <div className="crew-callout">
              <strong>
                {config.enabled ? "Delivery enabled" : "Delivery disabled"}
              </strong>{" "}
              · Dispatcher:{" "}
              {val(currentAgent, "name") || "Not selected or inactive"}
              <p>
                Only Ready tasks can wake a bot. Enabling does not notify
                existing tasks.
              </p>
            </div>
          )}
          {showSteps && (
          <div className="crew-setup-list">
            <Step {...stepProps(1)} title="Choose your dispatcher">
              <p>
                Use an existing bot. It keeps its main job and also routes Crew
                notifications.
              </p>
              <HelpField label="Crew dispatcher" topic="dispatcher">
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
              </HelpField>
              <p className="crew-footnote">
                Changing the dispatcher pauses delivery and clears the previous
                webhook binding.
              </p>
              <label className="crew-field">
                <span>Dispatch path</span>
                <select
                  value={parentBridge ? "parent_bridge" : "native"}
                  disabled={blocked}
                  onChange={(e) =>
                    void mutate(
                      "webhook.integration.update",
                      { dispatch_mode: e.target.value },
                      config,
                      "Dispatch path changed. Apply the current instructions and test again. Credentials were preserved.",
                    )
                  }
                >
                  <option value="parent_bridge">
                    Via the bot's parent conversation
                  </option>
                  <option value="native">
                    Directly inside the webhook routine
                  </option>
                </select>
              </label>
              <p className="crew-footnote">
                {parentBridge
                  ? "The routine wakes its parent conversation, which can work or message a teammate."
                  : "Use direct dispatch only when native bot messaging is available inside the routine. For Grok routines with WakeParent, choose the parent conversation."}
              </p>
            </Step>
            <Step {...stepProps(2)} title="Prepare Grok">
              <p>Two prompts, in this order. Both are required.</p>
              <h4 className="crew-prompt-step">
                First: paste once into{" "}
                {val(currentAgent, "name") || "your selected bot"}'s Grok chat
              </h4>
              <p>
                It asks Grok to discover your bots, save mappings and apply the
                current routine instructions where its tools support them.
              </p>
              <PromptActions
                readLabel="Read setup prompt"
                prompt={setupPrompt}
                copyButton={
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
                }
              />
              <p>
                <strong>{syncLabel}</strong> · Revision{" "}
                {Number(config.instruction_revision) || 1}
              </p>
              {!synced && (
                <p className="crew-assignment-warning">
                  Apply instruction revision{" "}
                  {Number(config.instruction_revision) || 1} in Grok. This page
                  updates automatically.
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
                        {m ? mappingLabel(a, m) : "Not mapped"}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {mcpUrl && (
                <div>
                  <h4 className="crew-prompt-step">
                    Then: paste once into a Grok group with all your bots
                  </h4>
                  <p>
                    Create a group chat with you and{" "}
                    {activeAgents.length > 1
                      ? `all ${activeAgents.length} bots`
                      : "your bot"}
                    , then paste this there. Do it after the first prompt and
                    before testing. Each bot needs your authorization directly:
                    the first bot can't give it on your behalf.
                  </p>
                  <PromptActions
                    readLabel="Read group authorization prompt"
                    prompt={groupAuthorizationPrompt}
                    copyButton={
                      <button
                        className="crew-primary"
                        disabled={blocked}
                        onClick={() =>
                          void copy(
                            groupAuthorizationPrompt,
                            "Group authorization prompt copied. Paste it once in the group with all your bots.",
                          )
                        }
                      >
                        Copy group authorization prompt
                      </button>
                    }
                  />
                  <details className="crew-prompt-fallback">
                    <summary>
                      Can't use a group? Paste into each bot's own chat
                    </summary>
                  <PromptActions
                    readLabel="Read bot authorization prompt"
                    prompt={authorizationPrompt}
                    copyButton={
                      <button
                        disabled={blocked}
                        onClick={() =>
                          void copy(
                            authorizationPrompt,
                            "Authorization prompt copied. Paste it into each bot's own conversation.",
                          )
                        }
                      >
                        Copy bot authorization prompt
                      </button>
                    }
                  />
                  </details>
                </div>
              )}
              {mapped < activeAgents.length && (
                <p className="crew-footnote">
                  Unmapped agents cannot receive Ready-task notifications. The
                  setup prompt asks only about ambiguous matches.
                </p>
              )}
            </Step>
            <Step
              {...stepProps(3)}
              title="Enter webhook credentials"
              help="webhook-credentials"
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
                open={
                  !config.url_configured ||
                  !config.secret_configured ||
                  !!url ||
                  !!secret
                }
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
            <Step {...stepProps(4)} title="Verify the connection">
              <p>
                {parentBridge
                  ? "Test the complete route: routine, parent conversation, and selected recipient. This explicitly sends a diagnostic message to a teammate when selected, but performs no task work."
                  : "Send a connection test to the routine. It acknowledges the test without task work or forwarding."}
              </p>
              {parentBridge && (
                <label className="crew-field">
                  <span>Test recipient</span>
                  <select
                    value={selectedTestRecipient?.id || ""}
                    disabled={blocked}
                    onChange={(e) => setTestRecipient(e.target.value)}
                  >
                    {!testRecipients.length && (
                      <option value="">Map a bot first</option>
                    )}
                    {testRecipients.map((a) => (
                      <option key={a.id} value={a.id}>
                        {val(a, "name")}
                        {a.id === config.agent ? " (dispatcher)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <button
                disabled={
                  blocked ||
                  !canTest ||
                  (parentBridge && !selectedTestRecipient)
                }
                onClick={() =>
                  void mutate(
                    "webhook.test",
                    parentBridge
                      ? { recipient_agent_id: selectedTestRecipient?.id }
                      : {},
                    config,
                    "Test queued. Acknowledgment progress updates here automatically. Do not send another test while the outcome is uncertain.",
                  )
                }
              >
                Send test
              </button>
              {!canTest && <Blockers items={testBlockers} />}
              <ul aria-label="Connection test progress">
                <li>
                  Webhook:{" "}
                  {testDelivery
                    ? deliveryStates[val(testDelivery, "state")] ||
                      "Unknown delivery status"
                    : "no current delivery recorded"}
                </li>
                <li>
                  Routine:{" "}
                  {setup?.test_acknowledged
                    ? "test acknowledged"
                    : "awaiting acknowledgment"}
                </li>
                <li>
                  Routine capabilities:{" "}
                  {setup?.runtime_reported ? "reported" : "awaiting report"}
                </li>
                {parentBridge && (
                  <>
                    <li>
                      Parent wake capability:{" "}
                      {setup?.parent_wake_reported
                        ? "reported"
                        : "awaiting report"}
                    </li>
                    <li>
                      Parent conversation:{" "}
                      {setup?.parent_received
                        ? "receipt recorded"
                        : "awaiting receipt"}
                    </li>
                    {setup?.bridge_test_recipient_agent_id &&
                      setup.bridge_test_recipient_agent_id !== config.agent && (
                        <li>
                          Native send:{" "}
                          {setup.bridge_send_reported
                            ? "reported"
                            : "not reported"}
                        </li>
                      )}
                    <li>
                      Recipient:{" "}
                      {setup?.bridge_test_recipient_agent_id === config.agent
                        ? "not needed for this dispatcher-only test"
                        : setup?.recipient_acknowledged
                          ? "acknowledgment recorded"
                          : "awaiting acknowledgment"}
                    </li>
                  </>
                )}
              </ul>
              {parentBridge && setup?.bridge_test_overdue && (
                <p className="crew-assignment-warning">
                  Test acknowledgment overdue. Check the bot conversations and
                  authorization before starting a new test. No automatic resend.
                </p>
              )}
              {parentBridge && setup?.bridge_test_recipient_agent_id && (
                <p>
                  Latest test recipient:{" "}
                  {val(
                    agents.find(
                      (a) => a.id === setup.bridge_test_recipient_agent_id,
                    ),
                    "name",
                  ) || "Unavailable agent"}
                </p>
              )}
              <p className="crew-footnote">
                Receiver acceptance, parent receipt and recipient acknowledgment
                are separate stages. Reports are supplied by bots using the
                shared connection; they do not independently identify a bot or
                guarantee reliable delivery. Check Grok before retrying an
                uncertain outcome.
              </p>
            </Step>
            <Step {...stepProps(5)} title="Enable future notifications">
              <p>
                Enable delivery after checking the routine's setup. Existing
                tasks are not replayed.
              </p>
              <button
                className="crew-primary"
                disabled={blocked || (!config.enabled && !canEnable)}
                onClick={() => {
                  const enabling = !config.enabled;
                  void mutate(
                    enabling ? "webhook.enable" : "webhook.disable",
                    {},
                    config,
                    enabling
                      ? "Delivery enabled. Existing tasks were not replayed."
                      : "Delivery disabled.",
                  ).then((ok) => {
                    if (ok && enabling) resetSteps();
                  });
                }}
              >
                {config.enabled ? "Disable delivery" : "Enable delivery"}
              </button>
              {!config.enabled && !canEnable && (
                <Blockers items={enableBlockers} />
              )}
            </Step>
            <Step {...stepProps(6)} title="Verify task routing (optional)">
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
              <PromptActions
                readLabel="Read routing test prompt"
                prompt={routingPrompt}
                copyButton={
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
                }
              />
              <p className="crew-footnote">
                Enable delivery first, then run only the authorized sample
                tasks. Recorded completion is reported by the worker; check the
                resulting task and Grok conversation.
              </p>
            </Step>
          </div>
          )}
          <form
            className="crew-webhook-card crew-wake-rules"
            aria-labelledby="crew-wake-rules-title"
            onSubmit={(e) => void saveWakeRules(e)}
          >
            <div className="crew-wake-rules-heading">
              <h3 id="crew-wake-rules-title">Wake rules</h3>
              <button
                type="button"
                disabled={blocked || atRecommended}
                onClick={resetWakeRules}
              >
                Reset to recommended
              </button>
            </div>
            <p>
              Which changes wake a bot. A task must be Ready, not done and not
              waiting for approval before any rule can wake it.
            </p>
            <fieldset className="crew-integration-events">
              <legend>Wake a bot when</legend>
              {wakeRules.map((rule) => (
                <div className="crew-wake-rule" key={rule.reason}>
                  <label>
                    <input
                      type="checkbox"
                      aria-describedby={`crew-wake-${rule.reason}`}
                      checked={subscriptions.includes(rule.reason)}
                      disabled={blocked}
                      onChange={(e) =>
                        setSubscriptions((xs) =>
                          e.target.checked
                            ? [...xs, rule.reason]
                            : xs.filter((x) => x !== rule.reason),
                        )
                      }
                    />
                    <span>{rule.label}</span>
                    <span className="crew-recommended">
                      {rule.recommended
                        ? "Recommended: on"
                        : "Recommended: off"}
                    </span>
                  </label>
                  <p id={`crew-wake-${rule.reason}`} className="crew-footnote">
                    {rule.help}
                    {rule.reason === "unassigned" && (
                      <>
                        {" "}
                        {triageAgent
                          ? `Triage agent: ${val(triageAgent, "name")}.`
                          : "No triage agent is chosen, so this wakes no one; your assistant can choose one. Turn it on only after that."}
                      </>
                    )}
                  </p>
                </div>
              ))}
            </fieldset>
            {routing && (
              <>
                <HelpField label="Bot handoff limit" topic="handoff-limit">
                  <input
                    type="number"
                    min={1}
                    max={20}
                    step={1}
                    aria-describedby="crew-handoff-limit-help"
                    value={handoffLimit}
                    disabled={blocked}
                    onChange={(e) => setHandoffLimit(e.target.value)}
                  />
                </HelpField>
                <p id="crew-handoff-limit-help" className="crew-footnote">
                  <span className="crew-recommended">
                    Recommended: {recommendedHandoffLimit}
                  </span>{" "}
                  How many times in a row bots can pass a task to each other (1
                  to 20). When reached, the task goes on hold until you act.
                  Any edit or comment from you resets the count; an agent
                  setting it Ready does not.
                </p>
              </>
            )}
            <button className="crew-primary" disabled={!canSaveWakeRules}>
              Save wake rules
            </button>
            {!subscriptions.length && (
              <p className="crew-footnote">Choose at least one rule.</p>
            )}
            {routing && !limitValid && (
              <p className="crew-footnote">
                Enter a whole number from 1 to 20.
              </p>
            )}
            {subscriptionsChanged && subscriptions.length > 0 && (
              <p className="crew-wake-warning" id="crew-wake-warning">
                {wakeRulesWarning}
              </p>
            )}
          </form>
          {stranded.length > 0 && (
            <section
              className="crew-webhook-card crew-stranded"
              aria-label="Wakes not received"
            >
              <h3>Wakes not received</h3>
              <p>
                Crew woke these bots but they never confirmed receiving the
                wake. Check each bot's conversation; Crew does not resend on
                its own.
              </p>
              <ul>
                {stranded.map(({ bridge, task }) => {
                  const recipientId =
                    val(bridge, "recipient_agent") || val(task, "assigned_agent");
                  const recipient = agents.find((a) => a.id === recipientId);
                  const since = strandedSince(bridge);
                  return (
                    <li key={bridge.id}>
                      <a href={itemPath("task", task)}>
                        {val(task, "title") || "Untitled task"}
                      </a>
                      <span>
                        {recipient
                          ? val(recipient, "name")
                          : recipientId
                            ? "Unavailable agent"
                            : "The dispatcher"}
                      </span>
                      <small>
                        Overdue since{" "}
                        <time dateTime={since}>
                          {since ? new Date(since).toLocaleString() : "unknown"}
                        </time>
                      </small>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
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
              shownActivity.map(({ delivery, execution, warning }) => (
                <EventTimeline
                  key={delivery.id}
                  delivery={delivery}
                  execution={execution}
                  agents={agents}
                  now={now}
                  warning={warning}
                />
              ))
            )}
            {shownActivity.length < activity.length ? (
              <button type="button" onClick={() => setShowAllActivity(true)}>
                Show all ({activity.length})
              </button>
            ) : (
              showAllActivity &&
              activity.length > initialActivityEntries && (
                <button type="button" onClick={() => setShowAllActivity(false)}>
                  Show fewer
                </button>
              )
            )}
            {showAllActivity && deliveries.length > 30 && (
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
                  key={a.id}
                  agent={a}
                  mapping={mappings.find((m) => m.agent === a.id)}
                  disabled={blocked}
                  onSave={(ref, name, row) =>
                    mutate(
                      "webhook.mapping.update",
                      {
                        agent: a.id,
                        bot_ref: ref,
                        // Omitted when untouched, so the saved name is kept.
                        ...(name === undefined ? {} : { bot_name: name }),
                      },
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
              aria-label="Role and reporting instructions"
              onSubmit={(e) => {
                e.preventDefault();
                // Wake rules are saved in their own section, never from here.
                void mutate(
                  "webhook.integration.update",
                  {
                    role_instructions: roleInstructions,
                    reporting_instructions: reportingInstructions,
                  },
                  config,
                  "Instructions saved. Delivery is off until the routine is applied, tested and enabled again.",
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
              <button
                disabled={
                  blocked ||
                  (roleInstructions === val(config, "role_instructions") &&
                    reportingInstructions ===
                      val(config, "reporting_instructions"))
                }
              >
                Save instructions
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
// Shortens an opaque bot reference for display; the full value stays in the field.
export function shortBotRef(ref: string) {
  return ref.length > 18 ? `${ref.slice(0, 8)}…${ref.slice(-6)}` : ref;
}
// The saved bot display name, or the Crew agent plus a shortened reference:
// never placeholder text that reads like a name.
export function mappingLabel(agent: Row, mapping?: Row) {
  const name = val(mapping, "bot_name").trim();
  if (name) return name;
  const ref = val(mapping, "bot_ref");
  return ref ? `${val(agent, "name")} bot (${shortBotRef(ref)})` : "";
}
// A newer saved value replaces the field only if the owner hasn't edited it.
function useSavedField(saved: string) {
  const [value, setValue] = useState(saved);
  const lastSaved = useRef(saved);
  useEffect(() => {
    const previous = lastSaved.current;
    lastSaved.current = saved;
    setValue((current) => (current === previous ? saved : current));
  }, [saved]);
  return [value, setValue] as const;
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
  onSave: (
    value: string,
    name: string | undefined,
    mapping?: Row,
  ) => Promise<boolean>;
}) {
  const saved = val(mapping, "bot_ref");
  const savedName = val(mapping, "bot_name");
  const [reference, setReference] = useSavedField(saved);
  const [name, setName] = useSavedField(savedName);
  const nameChanged = name.trim() !== savedName;
  const label = mappingLabel(agent, mapping);
  return (
    <form
      className="crew-webhook-card"
      aria-label={`${val(agent, "name")} routing`}
      onSubmit={(e) => {
        e.preventDefault();
        void onSave(
          reference.trim(),
          nameChanged ? name.trim() : undefined,
          mapping,
        );
      }}
    >
      <h4>{val(agent, "name")}</h4>
      {label && <p>{label}</p>}
      <label className="crew-field">
        <span>Grok Bot reference for {val(agent, "name")}</span>
        <input
          value={reference}
          disabled={disabled}
          onChange={(e) => setReference(e.target.value)}
          placeholder="Confirmed bot reference"
        />
      </label>
      <label className="crew-field">
        <span>Bot display name for {val(agent, "name")} (optional)</span>
        <input
          value={name}
          maxLength={200}
          disabled={disabled}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name shown in Grok"
        />
      </label>
      <button
        disabled={
          disabled || (reference.trim() === saved && !nameChanged)
        }
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
  warning,
}: {
  delivery: Row;
  execution?: Row;
  agents: Row[];
  now: number;
  warning: ActivityWarning;
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
  const attempts = Number(d.attempts) || 0;
  const quiet = warning === "superseded" || warning === "old";
  const pastNote =
    warning === "superseded"
      ? "Later activity replaced this attempt; nothing to do here."
      : "This is more than a day old. Review the bot conversation only if the outcome still matters.";
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
        <span>
          {attempts} {attempts === 1 ? "attempt" : "attempts"}
        </span>
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
        <p
          className={
            overdue && !quiet ? "crew-assignment-warning" : "crew-footnote"
          }
        >
          {overdue
            ? "Recipient acknowledgment overdue"
            : "Waiting for recipient acquisition"}
          {ago(ex?.handoff_at || ex?.created, now)
            ? ` · ${ago(ex?.handoff_at || ex?.created, now)} elapsed`
            : ""}
          .{" "}
          {overdue
            ? quiet
              ? pastNote
              : "Review the bot conversation before recovery. No automatic resend."
            : "A reported send is not proof that the recipient started."}
        </p>
      )}
      {!!ex?.lease_until && (
        <p
          className={
            leaseExpired && !quiet ? "crew-assignment-warning" : "crew-footnote"
          }
        >
          {leaseExpired ? "Execution lease expired" : "Execution lease expires"}{" "}
          · {new Date(val(ex, "lease_until")).toLocaleString()}
          {leaseExpired
            ? quiet
              ? `. ${pastNote}`
              : ". Reconcile the outcome before authorizing another attempt."
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
