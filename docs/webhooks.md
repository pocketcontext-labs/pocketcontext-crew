# Guided Grok dispatcher setup (0.5.0)

One existing Grok Bot keeps its normal role and also handles Crew notifications.
One application-wide webhook wakes that bot; explicit mappings identify the other
Grok Bots. One shared MCP connection supplies memory, tasks and coordination.
Agent names and worker handles are attribution and coordination, not identities.

## Owner setup flow

Open Agents → Grok Bot integration. Reuse existing configuration; do not create
another dispatcher bot, MCP connection or per-agent credential.

1. Choose an existing agent as dispatcher.
2. Copy the setup prompt into that bot's Grok chat. The assistant discovers actual
   bots, saves confirmed mappings and applies Crew's managed instruction block to
   the existing routine. Ambiguities require clarification, never guessed IDs.
3. Copy the webhook URL/key directly from Grok's routine UI into Crew's browser
   form. Saved values are never returned; unchanged credentials need no re-entry.
4. Explicitly send a harmless connection test. The webhook run reports the tools
   actually available in that context and acknowledges the test without task work
   or handoffs. Capability claims remain caller-reported evidence.
5. Enable delivery once the visible prerequisites are met. This sends no backlog.
6. Explicitly request routing samples for the dispatcher and one mapped recipient.
   These are ordinary synthetic Ready tasks, created only through the authorized
   setup/test request after enablement. Inspect their execution histories and
   native Grok conversations before calling the account integration verified.

Tests are real webhook calls and consume harness usage. Saving configuration,
copying a prompt, reading capabilities and upgrading do not send notifications.
No hidden task-execution path exists while delivery is disabled. The UI explains
missing prerequisites rather than leaving an unexplained disabled button.

Native handoff must be available where dispatch actually runs. A parent chat's
capabilities do not prove a delegated worker has them. Keep dispatch in the native
routine context; do not delegate it to a worker lacking messaging tools. There is
no invented parent-send bridge or broadcast fallback.

## Capability discovery and cached clients

Read `crew_read` with `collection: "capabilities"`. The response contains protocol
version 2, server version/commit, supported collections, operation input/result
schemas, authorization requirements and compatibility metadata. Current raw MCP
`tools/list` also exposes execution and idempotency arguments. Connector caches
can retain older declarations; do not infer backend availability from those alone.

An old connector's original `data` object can carry coordination metadata:

```json
{
  "action": "execution.begin",
  "reported_agent": "Build",
  "data": {
    "event_id": "EVENT_ID",
    "epoch": "CURRENT_EPOCH",
    "generation": 1,
    "worker_id": "UNIQUE_RUN_ID",
    "role": "dispatcher",
    "native_handoff": true,
    "_crew": {"idempotency_key": "STABLE_OPERATION_KEY"}
  }
}
```

Use `native_handoff: true` only when the current run actually has the supported
native messaging capability. For task writes, `data._crew.execution` carries
`{id, worker_id, fence}`. New clients can use top-level `execution` and
`idempotency_key`. The server normalizes both representations before applying the
same checks; contradictory metadata is rejected. This is compatibility, not a
privilege bypass. Never fall back to an unfenced update if coordination fails.

## Managed instructions and synchronization

The canonical dispatcher block is delimited by exactly one pair of markers:
`<!-- crew-dispatch:begin -->` and `<!-- crew-dispatch:end -->`.
The SHA-256 comparison covers that exact block. Meaningful changes inside it,
duplicate markers and malformed boundaries are rejected; no loose normalization
silently removes instructions. Role and reporting instructions remain outside it.
The assistant must preserve Grok's reporting destination and other outside text.

Configuration stores instruction revision, managed hash, applied revision/hash,
routine reference and reported synchronization state. `reported` means the caller
says it applied the block. `verified` means supplied saved text contained the
matching block; it is not an independent Crew-to-Grok inspection. UI labels
maintain this distinction. Error data.reason.code includes `instructions_mismatch` or
`revision_conflict` so a content mismatch is not mistaken for a stale record.

Changing instructions pauses delivery and invalidates prior setup evidence.
Changing the selected dispatcher requires a new webhook binding and clears the
old credentials; editing the current managed protocol during upgrade preserves
credentials. Mapping changes invalidate affected routing. No-op mapping saves
must not invalidate work.

## Runtime report and safe test

`webhook.runtime.report` uses the current config ID/revision and data
`{event_id, context:"webhook", native_handoff, execution_protocol}`. The event must
be a current test for that configuration, instruction revision, destination and
restore epoch. A report is tied to a real test record but its capability assertions
are supplied by the assistant, not hardware attestation or proof of delivery.

`execution.test_ack` acknowledges the same test with event_id/epoch and a stable
retry key. It cannot acquire or mutate a task. The setup export reports exact
blockers, acknowledgment and runtime evidence. A successful HTTP response without
these records does not complete the connection test.

Grok documents [editable routines and JSON/Bearer webhooks](https://docs.x.ai/grok-bot/skills-routines-and-automations)
and [native asynchronous handoffs](https://docs.x.ai/grok-bot/chat-and-collaboration).
Tool availability in a webhook run and recipient behavior require account-level
verification. Crew's synthetic tests do not certify Grok or its team policy.

## Governed tasks and atomic execution

Tasks default to Waiting. Ready work in todo/in_progress, with no pending review,
an active recipient, a mapping and an enabled subscribed integration can emit a
wake. The task and outbox record commit atomically. A persisted governance marker
is set at enqueue, before any worker acquires the event.

MCP task mutations and review requests for governed tasks require a valid running
execution proof even when no execution record exists yet. Governance persists
after completion, invalidation and lease expiry; omitting proof cannot restore
ordinary access. The owner can explicitly set Waiting to release a task from
coordination. Owner edits remain authoritative. Non-governed tasks retain ordinary
revision-checked MCP behavior. These rules coordinate the shared principal, not
independently authenticated bots.

`execution.begin` validates current epoch, generation, destination, mapping,
assignment, readiness and review state and acquires coordination in one transaction.
Its result includes the execution record, `execution` proof, authoritative
`task_context`, explicit recipient identifiers and `next_step`:

- `self_work`: the dispatcher is the recipient and can work immediately.
- `handoff`: the dispatcher has prepared recipient acquisition; send one short
  native message to the returned bot reference.
- `work`: the recipient acquired its prepared handoff and can work.
- `reconcile`: an idempotent replay; inspect the fresh record and do not send or
  start work from this response. Replayed responses omit the old work proof.

For cross-bot routing, report actual native messaging capability in the begin call;
missing capability must stop before a prepared send is claimed. After a successful
native send, `execution.dispatched` records `sent:true` with the original dispatcher
worker/fence, current record revision and optional non-secret message reference.
Do not fabricate a receipt. “Handoff reported” is not independent recipient receipt.
A recipient may start before this report; the late report must not replace its lease.

Renew during long work. Include proof on task writes and review requests. Use a
stable key for proof-bearing comments so a lost response cannot create a second
pong. Complete through `execution.complete`; `mark_done:true` plus task_revision
commits task completion and execution outcome together. Review/Waiting/reassignment
changes invalidate previous authority; later eligible work uses a new generation.

## Operation reference

Read capabilities for the current machine-readable schemas. All mutations are
revision checked; stable idempotency keys are required for execution mutations,
proof-bearing comments, agent.ensure and webhook.test/catch_up. Replaying an
acquisition does not extend its lease. Fresh execution.validate never caches
eligibility. Owner-only operations remain unavailable through the compatibility
metadata path.

| Action | Main fields |
| --- | --- |
| webhook.integration.update | config id/revision; agent, instructions, role_instructions, reporting_instructions, subscriptions |
| webhook.credentials.update | owner browser only; config id/revision; url, secret or clear_secret |
| webhook.mapping.update | agent, bot_ref, optional bot_name; current mapping revision or 0 to create |
| webhook.instructions.sync | config id/revision; instruction_revision, routine_ref, reported/verified status; verified includes full saved routine instructions |
| webhook.runtime.report | config id/revision; event_id, context webhook, native_handoff, execution_protocol |
| webhook.enable / disable / test | config id/revision, empty data |
| webhook.retry | failed delivery id/revision, config_revision; no stale event replay |
| webhook.catch_up | config id/revision, tasks [{id,expected_revision}], at most 100; explicit request only |
| webhook.routing.update | routing revision, triage_agent ID/null |
| execution.begin | event_id, epoch, generation, worker_id, role dispatcher/recipient; actual native_handoff capability; optional lease_seconds 30–900 |
| execution.test_ack | event_id, epoch; no task work |
| execution.renew | execution id/revision; worker_id, fence; optional lease_seconds |
| execution.dispatched | execution id/revision; original dispatcher worker_id/fence, sent:true, optional message_ref |
| execution.complete | execution id/revision; worker_id/fence, completed/failed outcome; optional mark_done/task_revision |
| execution.recover | owner-only; execution id/revision; cancel/retry after reconciling uncertain effects |

The lower-level validate/acquire/start/handoff operations remain available for
compatibility, subject to the same governance, capability and fencing rules.

## Timeline and recovery

Track transport accepted, dispatcher started, handoff prepared/reported, recipient
started and completed separately. Self-directed work skips handoff. A prepared
handoff has a recipient waiting deadline independent of a running worker's lease.
Show overdue waiting and expired leases as recovery conditions, not proof that
nothing happened. Execution records retain evidence and redacted audit history.

A crash between native send and reporting can leave an ambiguous result. Never
blindly resend. The owner reviews the Grok conversation and affected systems, then
cancels coordinated work or authorizes another attempt. Cancellation cannot undo
external actions. Retry authorization itself sends no webhook or native message.

Current epoch/generation/destination checks prevent stale coordinated writes;
leases cannot recall a running model or stop effects in unrelated external
services. External actions still need authorization and their own idempotency or
reconciliation. No exactly-once external-effects guarantee is made.

## Security, migration and backups

Credentials are encrypted with a machine-private key, entered only in the owner's
browser and absent from MCP reads, audit payloads and errors. Historical retry
results are redacted too. Sender HTTPS checks block private/reserved destinations,
DNS rebinding and redirects. Delivery retries are bounded; acceptance is not
completion or a promise of eventual success.

0.5.0 retains mappings, dispatcher, credentials, old instructions and histories,
installs the new managed block and pauses delivery. It sends no tests or backlog.
Supported complete restore rotates the epoch and pauses delivery; normal restarts
preserve it. Backups must include the private webhook key through the documented
native or hosted process. Fence the old writer before restoration. Re-enable and
catch up explicitly only after recovery and setup verification.
