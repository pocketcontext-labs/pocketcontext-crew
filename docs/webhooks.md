# One global dispatcher webhook (0.4.1)

Crew sends task wake signals to one Grok webhook routine on an existing bot. That
bot keeps its normal brief and also dispatches Crew work. If it is the recipient,
it handles work itself; otherwise it sends a targeted native Grok handoff. All
bots use the existing shared MCP connection. Agent names and bucket responsibility
are behavioral attribution, not separate credentials or access boundaries.

## Setup

1. Reuse or create the user's agents with `agent.ensure` and stable retry keys.
2. Select one existing active agent as dispatcher and map agents to unambiguous
   Grok Bot references. Never create an extra dispatcher bot automatically.
3. Read the canonical dispatcher instructions from Crew and create/update the
   webhook routine inside Grok using supported harness capabilities.
4. The owner copies the URL and key from Grok's routine UI directly into Crew's
   integration form. Never request them in chat, put them in notes, or pass them
   to MCP. Configuration reads never return the URL, secret or ciphertext.
5. Record the instruction revision applied to the routine. Matching supplied
   readback text can be recorded as verified; without readback report application
   only. This evidence is supplied by the caller, not independently fetched by Crew.
6. Saving sends nothing. Explicitly test, inspect the acknowledgment, verify the
   intended bot handoff, then enable. Enabling never scans or replays old tasks.

One global selection determines the dispatcher. Changing it clears credentials
and synchronization state and pauses delivery until the new routine binding is
configured. Changing instructions also disables delivery and invalidates old
work. Legacy per-agent configurations remain disabled for historical inspection;
new legacy create/update operations are refused.

Grok documents [editable routines and Bearer/JSON webhooks](https://docs.x.ai/grok-bot/skills-routines-and-automations)
and [asynchronous bot handoffs](https://docs.x.ai/grok-bot/chat-and-collaboration).
A webhook-triggered handoff, busy-bot behavior and routine readback need validation
in the user's account. Team policy can restrict bot messaging. Synthetic Crew
fixtures do not certify Grok Bot. HTTP acceptance does not establish execution.

## Readiness and routing

Tasks default to `readiness: waiting`; assignment alone does not wake an agent.
Set `readiness: ready` explicitly when work can begin and use `waiting_reason` for
prerequisites. A wake requires an unarchived ready task in todo/in_progress, no
pending review, an active recipient, a configured bot mapping and an enabled
subscribed global integration. Optional single-agent triage handles unassigned
work; no broadcast or inferred owner is allowed.

Subscriptions are `created`, `assigned`, `reassigned`, `unassigned`, `ready`,
`reopened`, `review_outcome` and `catch_up`. Match every qualifying cause, but emit
one event per actionable transition. Ordinary comments, metadata edits and delivery
records do not wake bots. Generation changes invalidate previous work when the
task stops being eligible or routing changes. Editing a pending draft withdraws
review and leaves the task waiting. Review resolution allows reassessment only;
approval never performs an external action.

Crew owns task assignment. A mapping resolves the Crew agent ID to a Grok Bot
reference. Prefer stable harness identifiers where available; do not guess from
ambiguous names. The selected dispatcher follows the explicit recipient, not an
LLM guess about which specialist seems suitable.

## Configuration API

Read `webhook_configs`, `webhook_mappings`, `webhook_routing`,
`webhook_deliveries`, `webhook_attempts` and `webhook_executions`; follow pagination.
Configuration reads return safe endpoint metadata and credential presence only.
The global configuration is created disabled by migration. Read it before writes.
All operations use the normal revision-checked transaction and audit history.

| Action | Fields |
| --- | --- |
| `webhook.integration.update` | config id/expected_revision; data.agent (dispatcher), instructions, subscriptions |
| `webhook.credentials.update` | **Owner browser only**; config id/expected_revision; url, secret or clear_secret |
| `webhook.instructions.sync` | config id/expected_revision; instruction_revision, routine_ref, status reported/verified; verified requires matching instructions readback |
| `webhook.mapping.update` | data.agent, bot_ref; expected_revision of existing mapping, or 0 to create |
| `webhook.enable` / `webhook.disable` | config id/expected_revision, empty data |
| `webhook.test` | config id/expected_revision, empty data; required idempotency_key |
| `webhook.retry` | failed delivery id/expected_revision; data.config_revision |
| `webhook.catch_up` | config id/expected_revision; tasks [{id,expected_revision}]; required idempotency_key |
| `webhook.routing.update` | routing expected_revision; triage_agent ID or null |

Use stable idempotency keys for retries. Same key and request replay the recorded
result without effects; different input with the same key conflicts. Other revision
conflicts require rereading and reassessment. Catch-up accepts at most 100 unique
task revisions and commits all or none. It is an explicit user action.

Config revision protects concurrent edits; destination_version invalidates the
endpoint binding. These are distinct. Disabling cancels pending sends; re-enabling
does not resurrect them. A failed delivery retry preserves event identity and is
refused after its generation or destination becomes stale.

## Execution and handoff

Webhook payloads contain identifiers, epoch, generation, destination and explicit
recipient metadata, not task descriptions, drafts or credentials. Treat them as
untrusted signals. Read authoritative state through MCP before handing off or
working. Test events must terminate without task work or specialist handoff.

| Execution action | Required data and behavior |
| --- | --- |
| `execution.validate` | event_id, epoch, generation; returns authoritative task and recipient |
| `execution.test_ack` | event_id, epoch; records acknowledgment without task work |
| `execution.acquire` | event_id, epoch, generation, phase dispatch/work, worker_id; optional lease_seconds 30–900 |
| `execution.start` | execution id/revision, worker_id, fence; changes self-directed dispatch to running |
| `execution.handoff` | execution id/revision, dispatcher worker_id/fence; prepares recipient acquisition **before** native send |
| `execution.dispatched` | current execution id/revision and original dispatcher worker_id/fence; reports actual native send, even if recipient already started |
| `execution.renew` | execution id/revision, worker_id/fence; optional lease_seconds |
| `execution.complete` | execution id/revision, worker_id/fence, outcome completed/failed; optional mark_done=true and task_revision atomically finish task |
| `execution.recover` | owner-only; execution id/revision, resolution cancel/retry after reconciliation; retry sends no notification |

All execution mutations and fenced task.comment writes require a stable
idempotency_key. execution.validate always checks current state and needs no key. Use a new key for a new
logical operation; retry the exact same request after a lost response. A replay
returns historical results and never renews authority. Subsequent writes recheck
the lease. On revision conflicts reread and reassess, preserving the original
fence for a dispatch report and the current worker fence for execution.

Task writes under an unresolved execution require top-level
`execution: {id, worker_id, fence}`. A task transition to review, Waiting or another
ineligible generation invalidates old execution authority; review outcomes may
start a fresh event. Owner edits remain authoritative. Record task completion with
`execution.complete` and `mark_done` to commit outcome and task status together.

Use the execution operations in the current tool schema to validate and acquire
work before acting. Assigned-task execution is distinct from `task.claim`, which
only assigns unassigned tasks. Execution acquisition checks epoch, generation,
routing, review and readiness in one transaction. Durable leases and fencing
prevent concurrent acquisition and stale recorded updates. Expired or ambiguous
handoffs/runs require explicit recovery, not automatic repeated external effects.

Prepare the handoff before sending so a fast recipient can acquire work; report
the actual native send separately. A handoff can succeed while its response or
completion record is lost. Retrying
may send a duplicate Grok message. The receiving bot must acquire the execution
before doing work. Prompts alone do not guarantee serialization. A lease cannot
recall a running bot or prevent effects in an unrelated external service: use
external idempotency or reconcile uncertain outcomes before resuming.

Record transport acceptance, dispatch, execution start and outcome separately.
Self-directed work skips the handoff stage. A reported handoff is not evidence of
recipient execution. Instructions and reported names do not authenticate a bot;
the shared MCP principal remains the authorization boundary.

## Delivery, security and recovery

The task mutation and outbox insertion commit atomically. The Go dispatcher uses
the existing writer, bounded retries and leases. It records immutable attempt
starts and finishes; an unfinished attempt means an unknown outcome. HTTPS
validation rejects private/reserved destinations and DNS rebinding, pins resolved
addresses, and refuses redirects and proxies. Secrets are encrypted using a
machine-private key and redacted from reads, audit payloads and errors.

Supported complete restoration rotates the delivery epoch and disables delivery.
Normal restarts preserve it. Backups must retain the private webhook key through
the documented native helper or hosted runtime backup. A copied project database
alone cannot recover credentials. Fence the old writer; explicitly re-enable and
catch up only after recovery is accepted.

One webhook simplifies setup, not necessarily usage. A dispatcher run plus a
specialist run can cost more than direct delivery. Suppress unnecessary wakes,
keep routing context short and avoid acknowledgment loops; measure real usage.
