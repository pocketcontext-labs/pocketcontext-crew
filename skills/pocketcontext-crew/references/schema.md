# Crew operations

Agents: name, brief, archived. Buckets: name, purpose, responsible_agent, archived.
Notes: bucket, title, body, links (note IDs), archived. Note revisions preserve
immutable title/body/links snapshots. Tasks: title, description, assigned_agent,
labels, status, draft, links, archived, readiness, waiting_reason and server-managed
wake_generation, bot_handoffs, handoff_limited and comment wake markers. Reviews preserve exact draft snapshots and
owner decisions. Events preserve action, actor, reported_agent, reason and changes.
All records have id, revision, created and updated. There is no space field.
Task and note responses also have `path` (for example
`#/tasks/launch-post-vicfcuk53eds6yt`) and, only when the install has a domain, an
absolute `url`; both can be requested in `fields`.

Read with `read` (crew_read), find by topic with `search` (crew_search), and
report with read-only SQL (`schema`/`query`, crew_schema/crew_query). Write
with `write` (crew_write), which uses only the agent route; revisions are
mandatory for changes. The server's tool schemas and collection capabilities
are authoritative; CLI and MCP take the same JSON. Agents may create/update
agents and buckets, assign buckets, create/update/restore notes, create/update/
claim/comment on tasks, and request/withdraw review. Archive of buckets and agent
deactivation, and review decisions, require owner authority.

Assignment returns responsible_agent as an ID and responsible_agent_details as
{id,name} or null. Names must resolve uniquely; use IDs to resolve ambiguity.

Webhook operations and receiver requirements: [webhooks](webhooks.md).
