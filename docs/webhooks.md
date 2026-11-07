# Agent webhooks

Crew sends small HTTPS wake signals to external agents. The agent still executes
work in its own harness. One shared authenticated MCP connection can manage every
agent's configuration; reported names and bucket responsibility are instructions,
not separate accounts or permissions. Human review decisions remain owner-only.

## Prompt-driven setup

Ask your connected assistant:

> Create a Build agent in Crew for implementation tasks. Connect this bot's
> supported webhook receiver so ready assigned work wakes it. Reuse an existing
> matching agent and configuration if this setup has already succeeded.

The assistant reads the current configuration, creates or reuses the agent, and
uses the harness's documented integration to obtain a receiving URL and credentials
securely. It configures and enables the receiver through MCP within that setup
request. No separate Crew dashboard or approval step is required. Saving a
configuration itself does not send a request or enable delivery.

Automatic setup requires the harness to supply a secure endpoint/credential path
and a conforming receiver. If it cannot, the assistant creates the agent and
reports the missing capability. Do not invent receiver URLs or copy credentials
into notes or ordinary chat. A working webhook endpoint is not proof of safe task
execution. No real Grok Bot integration has been certified in this release.

Use stable idempotency keys for setup retries. Replaying the same successful
request returns its original result; a changed request with the same key fails.
Never silently replace an unrelated receiver. Enabling a receiver does not scan
or replay existing tasks; catch-up is an explicitly requested operation.

## Readiness and routing

Tasks have `readiness` (`waiting` or `ready`) and `waiting_reason`. Existing tasks
and new tasks that omit readiness are waiting. Assignment alone never changes
readiness. Use `task.create` or `task.update` to explicitly set readiness:

```json
{"action":"task.create","reported_agent":"Build","data":{"title":"Implement the approved change","assigned_agent":"AGENT_ID","readiness":"ready"}}
```

A wake requires a ready, unarchived task in `todo` or `in_progress`, no pending
review, an active assignee and an enabled subscribed receiver. An optional single
triage agent handles ready tasks with no assignee. Invalid or inactive assignments
are shown separately; Crew never broadcasts unassigned work to every agent.

`wake_generation` changes when work becomes actionable, changes target, is
explicitly caught up, or becomes ineligible. An invalidation sends no wake. Ordinary
comments, edits and delivery records cause no new generation. Each task mutation
increments its revision once, even if several fields and generation change.
Subscription matching considers all qualifying causes before selecting one display
reason, so assignment and readiness in one mutation produce one event.

Pending review blocks task execution. Editing a pending draft withdraws review
and leaves the task waiting. Explicit review resolution can wake reassessment or
revision when otherwise ready; it does not perform an external action. Historical
approval does not transfer to changed drafts.

## MCP operations

Use `crew_read` for `webhook_configs`, `webhook_deliveries`, `webhook_attempts` and
`webhook_routing`; follow pagination. Configuration reads omit credentials and
ciphertext. `crew_write` supports agent setup and webhook create/update,
enable/disable, test, retry, catch-up and routing operations. The tool schema
provides fields and required concurrency/idempotency parameters. The initial
adapter is `crew-v1`, using a write-only `secret` as Bearer authentication. Receiver
URLs use `url`, with no query string, fragment or embedded credentials.

| Action | Data and concurrency |
| --- | --- |
| `agent.ensure` | `name`, optional `brief` or `agent` ID; required `idempotency_key` |
| `webhook.create` | `agent`, `url`, `adapter`, `subscriptions`, `secret`; required `idempotency_key` |
| `webhook.update` | config `id`/`expected_revision`; changed fields or `clear_secret: true` |
| `webhook.enable` / `webhook.disable` | config `id`/`expected_revision`, empty data |
| `webhook.test` | config `id`/`expected_revision`, empty data, required `idempotency_key` |
| `webhook.retry` | failed delivery `id`/`expected_revision`, `data.config_revision` |
| `webhook.catch_up` | config `id`/`expected_revision`, `data.tasks: [{id, expected_revision}]`, required `idempotency_key` |
| `webhook.routing.update` | routing `expected_revision`, `data.triage_agent` ID or null |

Subscription reasons are `created`, `assigned`, `reassigned`, `unassigned`, `ready`,
`reopened`, `review_outcome` and `catch_up`. Idempotency keys remain recorded without
expiry; replay lookup precedes revision validation. Catch-up validates at most 100
unique task revisions and commits all or none. `task.claim` accepts optional
`expected_generation` for an atomic ready-work claim. All webhook mutations may
supply an idempotency key to protect retries after a lost response.

Use current `expected_revision` for changes. A configuration's revision protects
concurrent updates; its `destination_version` identifies endpoint, credential and
adapter changes. These are distinct. Disabling cancels pending work; re-enabling
never resurrects cancelled deliveries. A failed delivery can be retried only
while its task generation and destination remain valid. Its event UUID stays the
same across retry cycles.

Credentials are write-only. Set or replace them through the dedicated tool field
from a secure harness capability; never echo them. Omitting the field preserves
it. Encrypted credentials and their private key must remain confidential, including
in backups. A missing key fails closed; do not reset it to hide recovery failure.

## Receiver contract

A wake includes schema version, UUID, stable instance ID, restore epoch, target
agent/kind, config ID/destination version, task ID/revision, wake generation, UTC occurrence time, reason and task
URL. It contains no task description, draft or credential. Treat it as an untrusted
signal; fetch authoritative task state through authenticated MCP.

Before doing work, compare the event epoch and generation with current Crew state,
and check readiness, assignment, current triage routing (when applicable), enabled
configuration/destination version, pending reviews and authorization. A changed task
revision alone does not make an event stale: ordinary edits can change revisions.
An already delivered or in-flight event cannot be recalled by cancelling the sender.

The receiver must persist accepted event IDs, deduplicate retries, serialize work
for each instance/task and coalesce newer generations while a task is running.
These guarantees need a conforming harness or durable adapter/gateway; prompting
an agent to avoid duplicates is not proof of transactional deduplication. A gateway
must coordinate execution handoff and completion, not simply forward duplicate
requests into uncontrolled runs. Delivery does not establish exactly-once external
side effects.

A Crew test event must be recognized before task processing and exit without task
actions. It may start a harness run to handle that handshake. A `test` field alone
is insufficient. If that behavior cannot be established, skip testing and report
configuration as unverified. HTTP acceptance never means a task completed.

Grok Bot's [routine documentation](https://docs.x.ai/grok-bot/skills-routines-and-automations)
describes webhook URL/key copying and HTTP 200 starting a run. It does not establish
automatic secure credential provisioning or the receiver guarantees above. Test
real integrations before claiming support; synthetic fixtures establish only the
Crew contract.

## Delivery and recovery

The task mutation and outbox insertion commit in one transaction. The dispatcher
uses the existing application writer and sends only committed events. States are
pending, in flight, accepted, cancelled and failed, with immutable attempts and
sanitized errors. Each attempt appends a `started` row before network I/O and a
separate `finished` row afterward; a started attempt without a finish has an
unknown outcome after a crash. Retry cycles remain distinguishable. Retries are bounded by attempts and time; redirects are refused.
The dispatcher rechecks eligibility before every attempt and only connects to
validated public HTTPS destinations. Private/link-local/reserved addresses and
DNS-rebinding routes are rejected.

Use the supported complete backup/restore procedure. Restoring changes the delivery
epoch before serving and pauses delivery, invalidating old receiver payloads.
Explicitly enable and request catch-up only after the recovered instance is ready.
Ordinary restarts preserve the epoch and recover pending work. Fence the old writer
before restoring; arbitrary copied live databases are not a supported restore.
