# Crew v1 data and access contract

The `crew_*` collections are accessed through authenticated operations, never
through generic record writes. SQL is read-only and does not expose these
collections. Existing knowledge collections are separate provenance infrastructure.

| Collection | Purpose |
| --- | --- |
| agents | Role metadata and brief; not auth accounts |
| buckets | Name, purpose and responsible agent |
| notes | One bucket, title, Markdown body, note-ID links, archive state |
| note_revisions | Immutable snapshots, version, actor, reported agent and reason |
| tasks | Board status, assignment, creator attribution, labels, draft and note links |
| events | Immutable changes/comments, actor and reported attribution |
| reviews | Immutable draft snapshot with monotonic decision state |

`POST /api/crew/read` accepts collection, optional id/parent/query/archived/offset.
It returns items, has_more and next_offset (100 records per page). Default note
reads exclude archived notes and notes in archived buckets. Explicit history
reads retain revisions, events and closed review snapshots. Search scans note
content, task text or agent/bucket names; semantic ranking is not provided.

`POST /api/crew/write` is the owner path. MCP only forwards to
`POST /api/crew/agent-write`, which denies decisions, bucket archival/reassignment
and agent deactivation. All use the same transaction and revision checks.
MCP OAuth credentials cannot authenticate ordinary REST; internal owner-account
tokens are never returned by MCP. Direct owner credentials carry owner authority
and must not be shared with agents. Claimed agent names never grant authority.

Writes have action, optional id/expected_revision/reported_agent/reason, and data.
Actions: agent.create/update; bucket.create/update; note.create/update/restore;
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
instructions. The server does not send messages, publish posts or perform payments.

## Verification

Crew integration tests exercise authenticated read/write, immutable history,
conflicts and concurrent claims, archive ancestry, review invalidation, owner-only
decisions, generic REST/batch rejection and restart persistence. MCP tests cover
transport allowlists and the agent path. Hosted image gates additionally rehearse
complete backup/restore, credential revocation on restore, one writer and clean
shutdown. Actual owner inbox delivery and third-party client sign-in require a
real user confirmation; automated checks must not be presented as that confirmation.
