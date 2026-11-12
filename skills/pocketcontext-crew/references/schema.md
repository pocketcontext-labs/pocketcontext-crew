# Crew operations

Agents: name, brief, archived, kind (bot, the default; external, a coder session
the owner starts by hand; human). Only bots are woken or mapped. Buckets: name, purpose, responsible_agent, archived.
Notes: bucket, title, body, links (note IDs), archived. Note revisions preserve
immutable title/body/links snapshots. Tasks: title, description, assigned_agent,
labels, status (todo, in_progress, needs_review via review.request, done or
wont_do; done and wont_do are terminal), draft, links, archived, release (the
shipping release, at most 32 characters; also a task read filter, "" for none),
review_mode ("", crew or in_session; in_session only with status done, which
stamps the server-set approved_at), approved_by (reported name, default owner),
readiness (waiting = on hold, the default,
or ready; writes accept on_hold), waiting_reason (hold reason), held_since (server-managed hold start) and server-managed
wake_generation, bot_handoffs, handoff_limited and comment wake markers, plus the
advisory claim: claimed_at (start, unchanged by renewal), claimed_by (reported session name), claim_until (ISO UTC lease end)
and derived claim_state ("", live or expired; also a task read filter). Reviews preserve exact draft and attachment snapshots, optional options
[{key,label,body}] and option_decisions [{key,decision,note}]. Attach evidence first,
use attachment:ID references and submit each draft/platform alternative as an
option. An approval requires explicit choices and at least one approved option. Events preserve action, actor, reported_agent, reason and changes.
Attachments: parent_kind (task or note), parent, name, media_type, image, width,
height, size, sha256, position, actor, reported_agent, archived; bytes come only
through crew_attachment or the `attachment` command, never as URLs. Settings:
storage_limit_bytes with derived storage_used_bytes.
All records have id, revision, created and updated. There is no space field.
Task and note responses also have `path` (for example
`#/tasks/launch-post-vicfcuk53eds6yt`) and, only when the install has a domain, an
absolute `url`; both can be requested in `fields`.

Read with `read` (crew_read), find by topic with `search` (crew_search), and
report with read-only SQL (`schema`/`query`, crew_schema/crew_query). Write
with `write` (crew_write), which uses only the work-client route; revisions are
mandatory for changes. The server's tool schemas and collection capabilities
are authoritative; CLI and MCP take the same JSON. Agents may create/update
agents and buckets, assign buckets, create/update/restore notes, create/update/
claim/claim_renew/release/comment on tasks, update session instructions (session.update),
request/withdraw/decide review, add/archive/restore
attachments, archive and restore, and recover executions: every reader
operation except webhook credential entry, upload-link creation and publishing,
replacing, revoking, expiring or archiving artifacts (agents create and edit artifact drafts; the owner
publishes them in the browser).
The skill's Authorization rules say when (review decisions only on explicit owner
delegation; archival, deactivation and recovery when the owner asks).

Assignment returns responsible_agent as an ID and responsible_agent_details as
{id,name} or null. Names must resolve uniquely; use IDs to resolve ambiguity.

Claims: `task.claim` (data.assigned_agent) assigns an unassigned task, or lets the
assignee claim its own Ready To do task (or an In progress task without a live
claim), with a 2-hour lease recorded under reported_agent. A live claim answers
409 `already_claimed` with data.claimed_by and data.claim_until. `task.claim_renew`
(claimer only, 409 `claim_expired` or `not_claimer`) extends it; the claimer's
updates, comments and attachment writes renew it. `task.release` (claimer, owner,
or anyone after expiry; optional readiness and waiting_reason) ends it and sets
In progress back to To do. Done or Won't do ends it. The session collection
(`{"collection":"session","agent":NAME}`) returns `{agent, prompt, instructions,
lease_hours, body, revision, is_default, edited_by, edited_at, rewrite_prompt}`:
instructions is body plus the agent brief. Only external agents have editable
instructions: `session.update` data {agent, instructions | restore_revision |
restore_default:true} with top-level expected_revision = revision (0 for the
built-in default) appends an immutable revision and a session.update event on the
agent; a stale revision is HTTP 409. History: session_revisions (parent = agent ID
or exact name; agent, revision, instructions, is_default, actor, reported_agent,
edited_by, reason, created), newest first.

Webhook operations and receiver requirements: [webhooks](webhooks.md).
