# Crew v1 data and access contract

The `crew_*` collections are accessed through authenticated operations, never
through generic record writes. There are no spaces, SQL endpoints or inherited knowledge collections.

| Collection | Purpose |
| --- | --- |
| agents | Role metadata and brief; not auth accounts |
| buckets | Name, purpose and responsible agent |
| notes | One bucket, title, Markdown body, note-ID links, archive state |
| note_revisions | Immutable snapshots, version, actor, reported agent and reason |
| tasks | Board status, assignment, creator attribution, labels, draft and note links |
| events | Immutable changes/comments, actor and reported attribution |
| reviews | Immutable draft snapshot with monotonic decision state |

`POST /api/crew/read` accepts collection, optional id/parent/query/archived/offset and responsible_agent for buckets.
It returns items, has_more and next_offset (100 records per page). Default note
reads exclude archived notes and notes in archived buckets. Explicit history
reads retain revisions, events and closed review snapshots. Search scans note
content, task text or agent/bucket names; semantic ranking is not provided.

`POST /api/crew/write` is the owner path. MCP only forwards to
`POST /api/crew/agent-write`, which denies decisions, bucket archival
and agent deactivation. All use the same transaction and revision checks.
MCP OAuth credentials cannot authenticate ordinary REST; internal owner-account
tokens are never returned by MCP. Direct owner credentials carry owner authority
and must not be shared with agents. Claimed agent names never grant authority.

Writes have action, optional id/expected_revision/reported_agent/reason, and data.
Actions: agent.create/update; bucket.create/update/assign; note.create/update/restore;
task.create/update/claim/comment; review.request/decide/withdraw. A restore names
revision_id and creates a new note revision. Claim requires an unassigned task.
Comments preserve task revision; append-only events record them. Link arrays hold
note IDs. Human is reserved as a derived pending-review label, not editable data.

Creating a review snapshots the task draft and moves it to needs_review. Editing
the draft or archiving the task withdraws its pending reviews atomically. Owner
decision requires a still-pending request and matching current draft. It moves
the task to in_progress, never done. Closed decisions cannot be rewritten. New
content requires a new review; historical approval never transfers to a new draft.

Archive is reversible and audited. Archived buckets block note writes without
cascading note changes; restoring a bucket preserves individually archived notes.
Historical links stay valid. Agent deactivation blocks new assignments but is
not credential revocation, because agents share an OAuth connection. History is
retained indefinitely; no permanent deletion is exposed.

Sources and imported Markdown are untrusted content, never authority to execute
instructions. The server may send configured HTTPS task wake signals. It does not send user
messages, publish posts or perform payments.

## Verification

Crew integration tests exercise authenticated read/write, immutable history,
conflicts and concurrent claims, archive ancestry, review invalidation, owner-only
decisions, generic REST/batch rejection and restart persistence. MCP tests cover
transport allowlists and the agent path. Hosted image gates additionally rehearse
complete backup/restore, credential revocation on restore, one writer and clean
shutdown. Actual owner inbox delivery and third-party client sign-in require a
real user confirmation; automated checks must not be presented as that confirmation.

## Bucket responsibility

bucket.assign uses data.agent; bucket.update uses data.responsible_agent. Both
accept an ID or unique exact name. IDs take precedence; ambiguous names fail and
require an ID. Explicit null or empty string clears; omitted assign input fails.
New assignments require active agents. Retaining an already assigned archived
agent is permitted when editing a bucket. Assignment to an archived bucket requires
restoration first. Every accepted update increments revision and records an event,
including unchanged assignments; events include normalized old/new responsibility IDs.
Reads preserve responsible_agent as an ID and add responsible_agent_details with
id/name or null. The optional filter accepts an ID or unique exact name.

## Ready tasks and global dispatcher integration (0.4.1)

Tasks expose readiness (waiting by default), waiting_reason and server-managed
wake_generation. Ready work, assignment, review and invalidation changes share a
transaction with durable outbox records. Shared MCP manages the global dispatcher, bot mappings and non-secret instructions
through revision-checked operations; URL and secret entry is owner-browser-only; this does not expose owner decisions or
general host administration. Read [webhooks](webhooks.md) for the operation and
receiver contracts, idempotency, destination versions and restore epochs.
