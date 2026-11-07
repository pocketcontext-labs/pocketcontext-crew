# Webhook MCP operations

Use the server tool schema as the authoritative contract. The shared MCP
connection can configure any agent; reported_agent is attribution only.

Read webhook_configs, webhook_deliveries, webhook_attempts and webhook_routing.
Reads redact secrets. Follow pagination. Parent on deliveries selects a config;
parent on attempts selects a delivery.

Write actions:
- agent.ensure: data.name, optional brief or agent ID; idempotency_key required.
- webhook.create: data.agent, url, adapter="crew-v1", subscriptions (reason array),
  write-only secret; idempotency_key required. Created disabled.
- webhook.update: config id/expected_revision; changed url, adapter, subscriptions,
  secret or clear_secret=true. Destination changes disable delivery.
- webhook.enable / webhook.disable: config id/expected_revision, empty data.
  Enable sends no backlog.
- webhook.test: config id/expected_revision, empty data, idempotency_key required.
  Only use after verifying receiver test events perform no task actions.
- webhook.retry: failed delivery id/expected_revision, data.config_revision;
  retains event UUID and refuses stale/destination-changed deliveries.
- webhook.catch_up: config id/expected_revision, idempotency_key and data.tasks
  containing {id,expected_revision}. At most 100; explicitly requested backlog only.
- webhook.routing.update: routing expected_revision and data.triage_agent ID or null.

Subscriptions: created, assigned, reassigned, unassigned, ready, reopened,
review_outcome, catch_up. Simultaneous qualifying causes produce one event.
Idempotency replay returns the recorded result; changed input with the same key
returns 409. On other revision conflicts reread and reassess.

The crew-v1 receiver uses HTTPS with Authorization: Bearer authentication. It
must persist receipt before responding, deduplicate UUIDs, serialize task execution
and fetch current webhook_routing epoch and task generation/readiness/assignment/
review, current triage routing and config enabled/destination version before acting. A test event is a handshake, never task work. An accepted
request does not prove completion. A gateway must coordinate execution, not merely
forward requests into uncontrolled concurrent runs.

Never expose credentials in results, audit reasons or knowledge. Supported restore
changes epoch and disables delivery; old events must be rejected. Re-enable and
request catch-up explicitly only after recovery is accepted.
