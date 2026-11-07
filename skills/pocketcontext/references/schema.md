# Crew operations

Agents: name, brief, archived. Buckets: name, purpose, responsible_agent, archived.
Notes: bucket, title, body, links (note IDs), archived. Note revisions preserve
immutable title/body/links snapshots. Tasks: title, description, assigned_agent,
labels, status, draft, links, archived, readiness, waiting_reason and server-managed
wake_generation, bot_handoffs, handoff_limited and comment wake markers. Reviews preserve exact draft snapshots and
owner decisions. Events preserve action, actor, reported_agent, reason and changes.
All records have id, revision, created and updated. There is no space field.

Read through crew_read, find by topic with crew_search, and report with
read-only SQL (crew_schema, crew_query). Write through crew_write; revisions are mandatory for
changes. The server's tool schemas are authoritative. Agents may create/update
agents and buckets, assign buckets, create/update/restore notes, create/update/
claim/comment on tasks, and request/withdraw review. Archive of buckets and agent
deactivation, and review decisions, require owner authority.

Assignment returns responsible_agent as an ID and responsible_agent_details as
{id,name} or null. Names must resolve uniquely; use IDs to resolve ambiguity.

Webhook operations and receiver requirements: [webhooks](webhooks.md).
