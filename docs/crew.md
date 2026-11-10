# Crew v1 data and access contract

The `crew_*` collections are accessed through authenticated operations, never
through generic record writes. There are no spaces or inherited knowledge
collections. Reads use the routes below; bounded read-only SQL is available for
reporting (see [SQL reads](#bounded-read-only-sql)).

| Collection     | Purpose                                                                     |
| -------------- | --------------------------------------------------------------------------- |
| agents         | Role metadata and brief; not auth accounts                                  |
| buckets        | Name, purpose and responsible agent                                         |
| notes          | One bucket, title, Markdown body, note-ID links, archive state              |
| note_revisions | Immutable snapshots, version, actor, reported agent and reason              |
| tasks          | Board status, assignment, creator attribution, labels, draft and note links |
| events         | Immutable changes/comments, actor and reported attribution                  |
| reviews        | Immutable draft snapshot with monotonic decision state                      |

`POST /api/crew/read` accepts collection, optional id/parent/query/archived/offset and responsible_agent for buckets.
It returns items, has_more and next_offset (100 records per page). Default note
reads exclude archived notes and notes in archived buckets. Explicit history
reads retain revisions, events and closed review snapshots. The `query` filter
is a substring match over note content, task text or agent/bucket names.

Compact reads are optional; omitting them keeps the behavior above. `limit`
(1-100) sets the page size and next_offset advances by it. `fields` projects
top-level fields of the normal export (id and revision are always returned);
unknown fields, and fields the export hides or redacts such as webhook URLs and
secrets, are rejected. Task reads accept `assigned_agent` (ID or unique exact
name, empty string for unassigned), `status` (one value or a list), `readiness`
and `label` (exact element of labels). `changed_since` (RFC3339) selects records
updated at or after that time in any collection. Archive semantics are unchanged.
Task create, update and claim also accept an ID or unique exact name for
`assigned_agent`, and store the agent ID. Task and note responses (reads, lists and
write results) include `path`, and `url` when the install has a domain; see
[item links](#item-links). Both can be requested in `fields`.

`POST /api/crew/search` ranks notes (title, body) and tasks (title, description,
draft) with SQLite FTS5 BM25. It takes query (all terms must match; a trailing
`*` is a prefix), optional collections (notes, tasks), limit (default 10, at most
50), offset and archived with crew_read's archive semantics. Hits are compact:
collection, id, title, path, url (with a domain), a short highlighted excerpt,
revision, updated, score and the note bucket or the task status, readiness and assignment. A `generation`
token identifies the indexed content; pass it when following next_offset, and
restart on 409 when content changed. The index is in memory, rebuilt from the
application's own database connection whenever a change fingerprint (id,
revision, updated and effective archive state of every note and task) changes,
so edits, restores and archive changes, including bucket archival, are visible
immediately. Indexed text is bounded (64 MiB). Webhook, event, review and
revision records are never indexed or returned.

## Item links

Tasks and notes open in the reader at `#/tasks/<slug>-<id>` and
`#/notes/<slug>-<id>`. The id decides what opens and the slug is cosmetic, so links
survive renames. Older bare `#/tasks/<id>` links still work. Archived items open
read-only. Opened from its link, a task shows over the Tasks page (`#/tasks`) and a
note over the Notes page (`#/notes`). An item opened from a page closes back to that
page with its filters (`#/tasks?agent=…`, `#/notes?bucket=…&sort=…&buckets=…`). The
older page addresses `#/team` and `#/memory` redirect to these, keeping their query.

Responses always include `path`, for example `#/tasks/launch-post-vicfcuk53eds6yt`.
`url` is the absolute link and is present only when the install has a domain; without
one, agents cite the title plus the id instead of a link. Agents cite items to humans
as `[title](url)`, escaping `]` and replacing newlines because titles are untrusted.

Webhook wakes are unchanged and title-free: they carry IDs, revisions and reasons,
never task prose, and their `task_url` stays in the bare-id form.

## Bounded read-only SQL

`GET /api/crew/schema` lists the SQL views, their columns and limits.
`POST /api/crew/query` takes `{"sql": "..."}` with exactly one read-only
statement and returns `columns`, `rows` (arrays) and `truncated`. Both require
the same authentication as crew_read (owner token or MCP OAuth caller) and are
the MCP tools crew_schema and crew_query.

Views: agents, buckets, notes, note_revisions, tasks, events, reviews,
webhook_configs, webhook_mappings, webhook_routing, webhook_deliveries,
webhook_attempts, webhook_executions and webhook_bridges. Each view selects an
explicit column allowlist, and every column is one crew_read already returns.
Excluded: webhook_configs url and secret_ciphertext; webhook_executions
worker_id, dispatch_worker_id, fence and dispatch_fence and webhook_bridges
wake_worker_id (fencing handles); the webhook idempotency table; users and other
auth records; PocketBase internal tables; OAuth state; retired knowledge data.
The underlying `crew_*` table names are not a supported interface and are limited
to the same columns.

SQL sees archived records. Filter `archived` explicitly; a note in an archived
bucket is archived for crew_read and crew_search, so join buckets when that
matters. JSON columns are text (use `json_each` or `->>`), timestamps are UTC
text and booleans are 0/1.

Queries run on separate read-only connections to the server's private working
copy (never the synced database), with `query_only`, an SQLite authorizer that
allows only SELECT, the allowlisted columns and a fixed function list, and a
prepared-statement read-only check. Writes, ATTACH, PRAGMA, extension loading
and multiple statements are rejected. Limits: 2 seconds, 1000 rows and 1 MiB per
result, 64 KiB of SQL. Prefer crew_read filters and crew_search for ordinary
lookups; use SQL for counts, joins, aggregates and history.

## Reader writes and work-client writes

`POST /api/crew/write` carries reader writes (the owner browser). MCP and the
CLI `write` command only forward to `POST /api/crew/agent-write`, the work-client
route. Both accept the same operations with the same transaction and revision
checks, except `webhook.credentials.update`: webhook URL and secret entry stays
reader-only, and reads never return them. The routes otherwise differ only in
loop accounting and audit: work-client comments never wake (so bots cannot
ping-pong), work-client reassignments count toward `max_bot_handoffs` while
reader task writes reset the count, and events record an `owner:` or `mcp:`
actor plus the unverified `reported_agent`.

Authorization for everything else is a set of owner-editable default rules in the
skill and MCP instructions, not a server gate: decide reviews only on explicit
owner delegation; change `max_bot_handoffs`, archive or restore buckets, and
deactivate or reactivate agents only when the owner asks; recover executions,
set Waiting or set a hop-limited task Ready when the owner asks or work is stuck
and the owner would otherwise do it in the reader. Attribution is kept for audit
and never used to block. History is append-only, so every such write remains
auditable through `actor` and `reported_agent`.

MCP OAuth credentials cannot authenticate ordinary REST, and the MCP proxy never
reaches the reader route; internal owner-account tokens are never returned by
MCP. Direct owner credentials carry owner authority and must not be shared with
MCP or hosted agents; installs without a domain are the exception described
below. Claimed agent names never grant authority.

## Command-line work commands

The binary's `read`, `search`, `schema`, `query` and `write` commands are the
work-client path for installs without a domain (see [local use](local.md)). They take
the MCP tool's input as one JSON object (argument, or `-` for standard input),
validate it against the same schema before any request, and share the MCP
request builders:

| Command  | MCP tool    | Route                        |
| -------- | ----------- | ---------------------------- |
| `read`   | crew_read   | `POST /api/crew/read`        |
| `search` | crew_search | `POST /api/crew/search`      |
| `schema` | crew_schema | `GET /api/crew/schema`       |
| `query`  | crew_query  | `POST /api/crew/query`       |
| `write`  | crew_write  | `POST /api/crew/agent-write` |

They run locally with `--db` (the local key; the server starts if needed) or on
a tunnel-paired computer with `--url` (its saved session token). `write` never
uses the reader route, so CLI writes behave like MCP writes: events record an
`mcp:` actor, comments never wake, reassignments count toward
`max_bot_handoffs`, and credential entry is refused (HTTP 403, exit 1). On these
installs CLI agents act with owner authority, because the credential they use is
the owner's: a raw HTTP call to the reader route could even enter webhook
credentials, which the skill forbids. Output is JSON on stdout. Invalid input exits 2; HTTP 409 exits 4, and the last stderr line
distinguishes a revision conflict (reread, reassess, retry) from a refusal with
a reason code such as `execution_required` (do not retry unchanged). There is no local MCP endpoint and no unauthenticated route.

Writes have action, optional id/expected_revision/reported_agent/reason, and data.
Actions: agent.create/update; bucket.create/update/assign; note.create/update/restore;
task.create/update/claim/comment; review.request/decide/withdraw; plus the
webhook and execution operations in the [webhook guide](webhooks.md). A restore names
revision_id and creates a new note revision. Claim requires an unassigned task.
Comments preserve task revision; append-only events record them. Link arrays hold
note IDs. Human is reserved as a derived pending-review label, not editable data.

Creating a review snapshots the task draft and moves it to needs_review. Editing
the draft or archiving the task withdraws its pending reviews atomically. A
decision (by the owner, or by a work client the owner explicitly delegated)
requires a still-pending request and matching current draft. It moves
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

Crew integration tests exercise authenticated read/write, compact read filters
and projections, ranked search freshness and archive semantics, SQL allowlists
(each excluded secret column is rejected), mutation rejection and limits, immutable history,
conflicts and concurrent claims, archive ancestry, review invalidation, delegated
decisions on the work-client route, reader-only credential entry, generic
REST/batch rejection and restart persistence. MCP tests cover transport
allowlists and the work-client route. `CREW_READ_BENCH=1 go test ./internal/crewruntime
-run TestCrewRetrievalBenchmark -v` (with the usual CGO and build tags) seeds a
synthetic 500-note, 300-task project and compares response bytes and call counts
of full pages with compact reads, search and SQL, checking identical answers. Hosted image gates additionally rehearse
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

## Ready tasks and global dispatcher integration

Tasks expose readiness (waiting by default), waiting_reason and server-managed
wake_generation. Ready work, assignment, review and invalidation changes share a
transaction with durable outbox records. Shared MCP manages the global dispatcher, bot mappings and non-secret instructions
through revision-checked operations; URL and secret entry is owner-browser-only; this does not expose
general host administration. Read [webhooks](webhooks.md) for the operation and
receiver contracts, idempotency, destination versions and restore epochs.

Reader (owner browser) comments can wake an eligible task's assignee when the
integration opts into the `comment` reason; work-client comments never wake.
This is loop prevention, not a privilege. A comment during live execution is
deferred until `execution.complete`. Consecutive work-client reassignments are
counted per task; exceeding `max_bot_handoffs` (default 4) applies the write but
stops the task as Waiting without a wake. Any reader task write resets the count.
A work client may set the stopped task Ready (when the owner asks, or after
breaking and reporting the loop), but that keeps the count, so the next
work-client reassignment stops it again.

## Capability discovery and cached tool schemas

Read collection `capabilities` to discover protocol version, server build, operation
input/result schemas and the `data._crew` compatibility envelope. MCP clients
with a cached declaration can supply `data._crew: {idempotency_key, execution}`
without bypassing checks or exposing owner credentials. Wake runs read the compact
execution subset (`id: "execution"`) and can skip it when they already hold the
payload's `capabilities_digest`. Conflicting top-level
and nested metadata is refused. `execution.begin` atomically validates/acquires
work. Work-client task writes need execution proof only while another execution
is live on the task (its lease or acknowledgment window has not expired);
supplied proof is always validated. Setting Waiting releases governance. Read the webhook guide for the full lifecycle.

## Parent bridge coordination

The global integration selects `native` or `parent_bridge` dispatch. Parent bridge
mode reserves each routine-to-parent wake before the native call, records parent
receipt separately, and enters the same fenced task execution lifecycle from the
parent turn. `webhook_bridges` is readable stage evidence, not a separate bot
identity or authorization boundary. Diagnostic tests can reserve one mapped native
send while task delivery is disabled; recipient acknowledgment must be reported
from the automatically activated turn. Shared MCP cannot independently authenticate
these reported execution contexts. See the webhook guide for exact operations,
setup checks, prior recipient authorization and uncertain-result handling.
