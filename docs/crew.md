# Crew v1 data and access contract

The `crew_*` collections are accessed through authenticated operations, never
through generic record writes. There are no spaces or inherited knowledge
collections. Reads use the routes below; bounded read-only SQL is available for
reporting (see [SQL reads](#bounded-read-only-sql)).

| Collection     | Purpose                                                                     |
| -------------- | --------------------------------------------------------------------------- |
| agents         | Role metadata, brief and kind (bot, external, human); not auth accounts     |
| buckets        | Name, purpose and responsible agent                                         |
| notes          | One bucket, title, Markdown body, note-ID links, archive state              |
| note_revisions | Immutable snapshots, version, actor, reported agent and reason              |
| session_revisions | Immutable session instruction revisions of an external agent (built-in default when none) |
| tasks          | Board status, assignment, creator attribution, labels, draft, note links, advisory claim, release and approval mode |
| events         | Immutable changes/comments, actor and reported attribution                  |
| reviews        | Immutable draft and attachment snapshot with monotonic decision state       |
| attachments    | Immutable files on a task or note: metadata, archive state; bytes in storage/ |
| upload_links   | One-time owner upload links: parent, expiry, usage; never the token          |
| settings       | Instance settings: storage limit (with derived usage)                       |

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
(`ready`, or `on_hold`/`waiting`), `label` (exact element of labels) and
`claim_state` (`live`, `expired` or `""` for no claim) and `release` (exact
release, or `""` for tasks without one). The `session` collection
takes `agent` (ID or exact name) and returns one object instead of items; see
[project coder agents](#project-coder-agents).
`webhook_bridges` reads accept `overdue: true`; see
[Overdue parent wakes](webhooks.md#overdue-parent-wakes). `changed_since` (RFC3339) selects records
updated at or after that time in any collection. Archive semantics are unchanged.
Task create, update and claim also accept an ID or unique exact name for
`assigned_agent`, and store the agent ID. Task and note responses (reads, lists and
write results) include `path`, and `url` when the install has a domain; see
[item links](#item-links). Both can be requested in `fields`.

`POST /api/crew/search` ranks notes (title, body) and tasks (title, description,
draft) with SQLite FTS5 BM25; the names of each item's active attachments are
indexed with it, so a search for a file name finds its task or note. It takes query (all terms must match; a trailing
`*` is a prefix), optional collections (notes, tasks), limit (default 10, at most
50), offset and archived with crew_read's archive semantics. Hits are compact:
collection, id, title, path, url (with a domain), a short highlighted excerpt,
revision, updated, score and the note bucket or the task status, readiness and assignment. A `generation`
token identifies the indexed content; pass it when following next_offset, and
restart on 409 when content changed. The index is in memory, rebuilt from the
application's own database connection whenever a change fingerprint (id,
revision, updated and effective archive state of every note, task and
attachment) changes,
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

Views: agents, buckets, notes, note_revisions, session_revisions, tasks, events, reviews,
attachments, webhook_configs, webhook_mappings, webhook_routing,
webhook_deliveries, webhook_attempts, webhook_executions and webhook_bridges. Each view selects an
explicit column allowlist, and every column is one crew_read already returns.
Excluded: webhook_configs url and secret_ciphertext; webhook_executions
worker_id, dispatch_worker_id, fence and dispatch_fence and webhook_bridges
wake_worker_id (fencing handles); attachments.file (the storage name) and all
file bytes; upload links (token hashes) and settings, which crew_read
serves; the webhook idempotency table; users and other
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
checks, except `webhook.credentials.update`, `upload_link.create` and
`artifact.publish`/`artifact.replace`/`artifact.revoke`/
  `artifact.set_expiry`/`artifact.archive`/`artifact.restore` (HTTP 403 on the
work-client route, before idempotency replay): webhook URL and secret entry,
upload-link creation and publishing artifacts stay reader-only, and reads never
return credentials, link tokens or artifact tokens. The routes otherwise differ only in
loop accounting and audit: work-client comments never wake (so bots cannot
ping-pong), work-client reassignments count toward `max_bot_handoffs` while
reader task writes reset the count, and events record an `owner:` or `mcp:`
actor plus the unverified `reported_agent`.

Authorization for everything else is a set of owner-editable default rules in the
skill and MCP instructions, not a server gate: decide reviews only on explicit
owner delegation; change `max_bot_handoffs`, archive or restore buckets, and
deactivate or reactivate agents only when the owner asks; recover executions,
put a task on hold (Waiting) or set a hop-limited task Ready when the owner asks or work is stuck
and the owner would otherwise do it in the reader. Attribution is kept for audit
and never used to block. History is append-only, so every such write remains
auditable through `actor` and `reported_agent`.

MCP OAuth credentials cannot authenticate ordinary REST, and the MCP proxy never
reaches the reader route; internal owner-account tokens are never returned by
MCP. Direct owner credentials carry owner authority and must not be shared with
MCP or hosted agents; installs without a domain are the exception described
below. Claimed agent names never grant authority.

## Attachments

Files on tasks and notes: bug screenshots, logs, PDFs, recordings. One
`crew_attachments` record per file holds `parent_kind` (`task` or `note`),
`parent`, `name` (display name), `media_type`, `image`, `width`, `height`,
`size` (bytes), `sha256` (computed by the server), `position` (order added,
1-based per item), `actor`, `reported_agent`, `via_upload_link`, archive state
(`archived`, `archived_at`, `archived_by`), `revision` and timestamps. The
bytes are a PocketBase protected file in the project's `storage/` folder under
an ASCII storage name; neither the storage name nor any URL is ever returned.
Bytes are immutable: a changed file is a new attachment, and removing one means
archiving it (restorable). Nothing is purged.

Limits: 20 MiB (20,971,520 bytes) per file, 20 active attachments per task or
note (archived ones do not count), at most 20 files per request, and an
instance storage limit (default 5 GiB) on the sum of all stored attachments,
archived ones included. Thumbnails are not counted. The reader checks the per-file
size, the 20-file limit and, for files staged with a new task or note (sent in
one request), 89 MiB in total before sending, with a message naming each
refused file; the server enforces every limit regardless.

Images are PNG, JPEG, GIF and WebP whose magic bytes and image header verify
(`image: true`, with `width` and `height`). Only these are shown inline or
thumbnailed. Every other file, whatever its extension (including SVG and HTML),
gets `image: false` and a `media_type` from a fixed extension table (an image
extension whose bytes fail verification becomes `application/octet-stream`).
Types are never sniffed and client-supplied types are ignored.

File names: the server derives the display `name` from the supplied name the
same way for multipart parts, base64 entries and upload-link files, on every
operating system: it keeps only the last path segment (after the last `/` or
`\`), drops invalid UTF-8, control characters and invisible bidirectional
marks and overrides (U+061C, U+200E, U+200F, U+202A–U+202E, U+2066–U+2069,
which can make `report<U+202E>gnp.exe` display as `reportexe.png`), trims
spaces and shortens it to 200 characters keeping its extension. A name that is
empty or only dots afterwards (`folder/`, `a/..`) is refused as `invalid_name`.
The stored file uses a separate random ASCII storage name.

Attachments are untrusted content, like notes.

### Operations

All run on `POST /api/crew/write` (reader) and `POST /api/crew/agent-write`
(work clients), in one transaction with the usual envelope (`action`, `id`,
`expected_revision`, `reported_agent`, `reason`, `data`, `idempotency_key`,
`execution`).

| Action | id / revision | data | Result |
| --- | --- | --- | --- |
| `attachment.add` | none | `task` or `note` (exactly one), files | `{attachments: [record…], results: [{index, name, ok, id \| error: {code, message}}], review_withdrawn}` |
| `attachment.archive` | attachment id, its revision | `{}` | attachment record plus `review_withdrawn` |
| `attachment.restore` | attachment id, its revision | `{}` | attachment record plus `review_withdrawn` |
| `task.create`, `note.create` | none | usual fields, optional files | task/note record plus `attachments: [record…]` |
| `task.comment` | task id, its revision | `body`, optional files | task record; with files also `attachments: [record…]` and `review_withdrawn` |
| `upload_link.create` | none | `task` or `note`, `expires_in_minutes` (1–1440, default 15), `max_files` (1–20, default 10) | link record plus `token`, `path` (`#/upload/<token>`) and `url` (with a domain); reader route only |
| `upload_link.revoke` | link id, its revision | `{}` | link record |
| `storage.update` | settings id, its revision | `storage_limit_bytes` (1 MiB to 1 TiB) | settings record |

`attachment.add` saves each file independently: a file that fails (see codes
below) is reported in `results` while the others are saved; HTTP 200 when at
least one file was saved, HTTP 400 when every file failed, with
`data["files.N"] = {code, message}` for each (N is the 1-based file position).
The parent must be active (not archived, note bucket not archived). On tasks,
work clients need execution proof only while another execution is live, as for
`task.update`. `idempotency_key` is optional; its fingerprint names files by
name, size and sha256, so a retry with the same files replays the first result
and changed files conflict (409).

`attachment.restore` refuses when the item already has 20 active attachments.
Archive and restore of an already archived/active attachment is a 400.

Events: each saved file appends `attachment.add` to its task's or note's
history (`changes`: `attachment`, `name`, `size`, `media_type`, `image`,
`sha256`, and `via_upload_link` when uploaded through a link); archive and
restore append `attachment.archive` / `attachment.restore` (`attachment`,
`name`). `upload_link.create` / `upload_link.revoke` append to the item too;
`storage.update` appends to the settings record (`storage_limit_bytes: {old,
new}`).

Attachment writes (other than a review withdrawal) do not change the task's or note's own revision, so an open
edit form never conflicts with an upload. Read the attachments collection (or
use `changed_since` on it) to see new files.

### File transport

- Multipart (reader, CLI): `multipart/form-data` to either write route, with a
  text field `@jsonPayload` holding the JSON envelope and file parts named
  `files` (the part's filename, as sent, is the name; see file names below). Accepted only by `attachment.add`, `task.create`, `note.create` and `task.comment`.
  A multipart request may carry 90 MiB in total (94,371,840 bytes, which stays
  under Cloudflare's 100 MB request limit; the public HTTPS listener caps
  requests at 110 MiB); clients send at most 89 MiB of files per request and
  split larger batches over several `attachment.add` requests.
- JSON base64 (MCP): `data.files: [{"name": "shot.png", "content_base64":
  "<standard base64>"}]`, exactly those two keys per entry. At most 5 MiB of
  decoded bytes per request (base64 text is about 6.7 MiB), within the MCP
  input limit. JSON writes stay limited to 32 MiB.

Sending both forms in one request, or files to any other action, is a 400.

Per-file error codes: `invalid_name`, `empty_file`, `file_too_large`,
`unreadable`, `invalid_file` (bad base64 entry shape), `invalid_base64`,
`attachment_limit` (20 active), `storage_limit`.

### Create with files and placeholders

`task.create` and `note.create` take the same files and create the item and its
attachments in one step (task revision 1). Text fields may reference files that
do not exist yet as `attachment:new-N`, where N is the file's 1-based position
in the request: `![first step](attachment:new-1)`. Placeholders in `description`
and `draft` (tasks) or `body` (notes) are replaced by the real IDs before the
item is validated and saved, so stored text and note revisions always carry real
IDs. The create is atomic: if any file is refused (any per-file code above, or
the storage limit for the batch) or a placeholder names no uploaded file,
nothing is created and the 400 lists each refused file as `data["files.N"]`.
Placeholders anywhere else are refused, except in comments (below).

### Comments with files

`task.comment` takes the same files (multipart parts named `files`, or JSON
`data.files` within the 5 MiB base64 limit) and stores them as attachments of
the task, so the per-item, per-file and storage limits and the archive rules
apply; there is no separate comment storage. `attachment:new-N` in the comment
`body` names the Nth file and is replaced by the real ID before the comment is
stored, so the comment event's `body` always carries `attachment:ID`. The
comment is atomic like a create: a refused file or an unmatched placeholder
adds neither the comment nor any file (400 with `data["files.N"]`). Each saved
file appends `attachment.add` to the task's history; the comment event's
`changes` lists the new `attachments`.

Every comment body (with or without files) follows the Markdown reference
rules below: each `attachment:ID` must name an active attachment of the same
task, and `data:` images are refused. The reader therefore has two equivalent
paths: upload files first (`attachment.add` or an upload link) and post `{body}`
referencing `![alt](attachment:ID)`, or send the files with the comment and
use `attachment:new-N`. Files sent with a comment on a task with a pending
review withdraw that review exactly like `attachment.add`, so the task's
revision changes only in that case; a plain comment never changes the
revision. Comments with files never wake anyone beyond the usual comment rule.
Fenced (proof-bearing) comments with files fingerprint the files for
idempotency like `attachment.add`.

### Markdown references

Note `body`, task `description`, task `draft` and comment `body` reference attachments as
`![alt](attachment:ID)` (images) or `[label](attachment:ID)`, also in reference
definitions (`[x]: attachment:ID`, anywhere, including inside block quotes and
lists) and autolinks (`<attachment:ID>`). The server finds them on a parsed
CommonMark (GFM) tree, like the reader: destinations are decoded first
(backslash escapes and character references, so `attachment\:ID` and
`attachment&#58;ID` are references) and the scheme is compared without regard
to case (`ATTACHMENT:ID` is a reference too). Links in code spans and code
blocks are not references. The reader resolves only the exact lower-case
`attachment:` scheme after decoding; anything else shows as unavailable. On
every create, update and restore:

- each reference must name an existing attachment of the same task or note
  (unknown or foreign IDs are refused with a message naming the reference);
- a reference new to that field must name an active attachment; a reference
  already saved in the field may stay after its attachment is archived (the
  reader shows it as removed), and `note.restore` may bring back the note's own
  archived references;
- embedded `data:` images (Markdown images, reference definitions or `<img
  src="data:…">`, in any case or encoding) are refused: attach the file
  instead.

Prose such as `attachment: see below` is not a reference.

### Reading

- Metadata: `crew_read {collection: "attachments", parent: <task or note id>}`
  lists active attachments in `position` order; `archived: true` lists archived
  ones; `id`, `query` (name substring), `fields`, `limit` and `changed_since`
  work as usual. `crew_read {collection: "settings"}` returns the storage limit
  with derived `storage_used_bytes`, `max_file_bytes` and
  `max_active_attachments`.
- Bytes for work clients: `POST /api/crew/attachment-read` (signed in; MCP
  proxy and CLI) with `{id, variant, offset?, max_bytes?}`:
  - `original`: base64 bytes from `offset`; `max_bytes` defaults to 1 MiB, at
    most 4 MiB; `next_offset` is set while more remain;
  - `preview` (1600 px wide) and `card` (320 px wide): a downscaled image for
    verified images only, returned whole and never upscaled. An image already
    that small is returned as is when it fits in 4 MiB; otherwise (an original
    or a thumbnail over 4 MiB) the server returns a JPEG re-encode of at most
    that width, shrunk until it fits in 4 MiB (transparency on white, a GIF's
    first frame), cached beside the thumbnails. Images over 40 megapixels
    have no preview: 413 with `data.code` `preview_unavailable`, which work
    clients treat as "metadata only";
  - `text`: strict UTF-8 text (`max_bytes` default 256 KiB, at most 2 MiB), cut
    on character boundaries; 415 for images or non-UTF-8 bytes.

  The result has `attachment` (metadata), `variant`, `media_type` (of the
  returned bytes), `encoding` (`base64` or `utf-8`), `offset`, `length`,
  `total_size`, `next_offset`, `content_base64` or `text`, and `width`/`height`
  for previews. No URL or storage name is ever returned. Archived attachments
  remain readable.
- Bytes for the owner browser and CLI: `GET /api/crew/attachment?id=ID`
  with optional `thumb=1600x0` or `thumb=320x0` (images only; the original when
  the image is that small or thumbnailing fails) and `download=1`. It needs the
  owner's `Authorization` header or `token=` holding a short-lived PocketBase
  file token from `POST /api/files/token` (so `<img>`, `<video>` and `<audio>`
  can load; refresh it every few minutes). Responses carry
  `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src
  'none'; sandbox`, `Cross-Origin-Resource-Policy: same-origin` and `private`
  caching. Verified images are `inline` unless `download=1`; every other file
  is `Content-Disposition: attachment` and keeps a passive type only (text,
  Markdown, CSV, JSON and YAML as UTF-8, PDF, audio, video); HTML, SVG, XML,
  scripts and unknown types are `application/octet-stream`. Range requests
  work. PocketBase's generic `/api/files` route never serves Crew files (the
  collection rules stay locked) and is not public on a domain.

Work clients use these through two adapters:

- MCP `crew_attachment` (read-only): `{parent}` returns a task's or note's
  images as MCP image content, `preview` by default or `card`, at most 6 per
  call and about 4 MiB of image bytes (at least one image), with metadata of its
  other files and `next_offset` (an image index); an image without a preview
  (`preview_unavailable`) is listed under `other_files` with a `note` and the
  page continues; `archived: true` pages archived ones. `{id}` returns one
  file: an image as its preview (or `card`, or `original` as image content when
  the file is at most 4 MiB; metadata with a `note` when no preview exists); a non-image as
  UTF-8 text by default (paged by `offset`/`max_bytes`), falling back to
  metadata when the bytes are not UTF-8; `variant: "original"` returns paged
  base64 bytes (at most 3 MiB per call through MCP). The first content block is
  JSON metadata; no URL is returned.
- CLI `attachment ID --out FILE|DIR [--variant …]`: pages through
  `attachment-read` (4 MiB per request) into a temporary file beside the target,
  verifies size and sha256 against the record for `original` and `text`, and
  moves it into place without replacing an existing file (hard link, or a
  checked rename where links are unsupported). With a directory it uses the
  display name, stripped of separators, reserved characters and Windows device
  names.

Thumbnails (`1600x0`, `320x0`, declared on the file field) are created on first
request beside the original and are never created while the server is in
maintenance (flush) mode.

### Reader previews

The reader shows every attachment without running anything from it. Bytes come
from `GET /api/crew/attachment` on the same origin with a short-lived file
token; nothing is framed or fetched from elsewhere.

| Kind | How it is shown | Limits |
| --- | --- | --- |
| Verified images (PNG, JPEG, GIF, WebP) | Inline in Markdown (1600 px thumbnail), card thumbnails (320 px), lightbox with the original | Images over 40 megapixels are never thumbnailed |
| Video and audio | The browser's own player from the protected URL | Whatever codecs the browser plays; no transcoding |
| Text, logs, YAML, NDJSON and code or config by extension (including HTML, SVG and XML) | Plain text with a wrap toggle, never rendered or run | At most 2 MiB of strict UTF-8 |
| JSON | Pretty-printed when valid, else the text as is | At most 2 MiB |
| CSV and TSV | A table | The first 500 data rows of at most 2 MiB |
| Markdown | Rendered; images show as `[Image: alt]` and are never loaded, links open in a new tab | At most 2 MiB |
| PDF | One page at a time with page count, zoom and fit width (the default), through a bundled pdf.js loaded only when a PDF opens | At most 20 MiB; each page canvas at most about 16 megapixels |
| Anything else | Name, size, type and Download | |

Larger files, files that are not valid UTF-8 and documents that cannot be
opened (including password-protected PDFs) show name, size, type and Download.

PDF limits: pdf.js runs without its viewer, scripting, XFA forms or links, with
eval off, and the reader serves it no standard font data, CMaps, ICC profiles or
WebAssembly decoders (the asset route serves only `.js`, `.css`, `.woff2` and
`.svg`). Missing standard fonts fall back to system fonts; text in fonts that
are not embedded and need CMaps (common in CJK documents) may be missing, and
JPEG 2000 and JBIG2 images may not render. Download the file to see it
exactly.

### Reviews

`review.request` stores the task's active attachments as `attachments: [{id,
sha256}]` on the review. Any `attachment.add`, `attachment.archive` or
`attachment.restore` on a task with a pending review withdraws that review
exactly like a draft edit: the review becomes `withdrawn`, the task leaves
Needs review for In progress and goes on hold (`waiting`, hold reason
`Review withdrawn`), its wake generation advances and nothing wakes. `review.decide` also refuses when the snapshot no longer
matches. Approval therefore covers exactly the draft and files the owner saw.

### Wakes

Attachment writes, including uploads through a link, never wake anyone and do
not change the wake generation, except through the review withdrawal above.

### One-time upload links

The owner creates a link for one task or note in the reader
(`upload_link.create` on `/api/crew/write`; the work-client route returns 403
before idempotency replay, and the action refuses `idempotency_key` so the
token is never stored in a replay record). The 43-character token (about 256
random bits) is returned once with `path` `#/upload/<token>` and, with a
domain, `url`; only its SHA-256 is stored. Links expire after
`expires_in_minutes` (default 15, at most 1440) and can be revoked by either
route (`upload_link.revoke`). Reads (`crew_read {collection: "upload_links",
parent}`) return `state` (`active`, `used`, `revoked` or `expired`), never the
token or hash.

The upload page uses two unauthenticated endpoints, both public on a domain.
The token travels in the `X-Crew-Upload-Token` request header (never in a URL,
so it stays out of request logs). A guard runs before any body is read:

- Rate limits are keyed by what the request presents, not by address (hosted
  mode sees one proxy): a missing, malformed or unknown token takes from one
  shared bucket (burst 20, one request per 3 seconds), and a known token (in
  any state) from its own link's bucket (burst 10, one per 3 seconds), so
  random-token traffic never uses up a real link's allowance. Both answer 429
  with `Retry-After` and `data.rate_limit`.
- `POST /api/crew/upload-link/info` (body ignored, at most 4 KiB) returns only
  `{parent_kind, title, expires_at, max_files, max_file_bytes,
  max_request_bytes}`.
- `POST /api/crew/upload-link/upload` must be `multipart/form-data` (anything
  else is 415 before the body is read) with only file parts named `files` (at
  most `max_files`; any other field is a 400). At most two uploads run at once
  (503 with `Retry-After` otherwise), the link is checked before the body is
  read, and file parts stream to temporary files beyond 1 MiB of memory.
  Returns `{added, results: [{index, name, ok, error?}]}` without IDs. The
  normal size, count and storage limits apply.

The first upload that adds at least one file uses the link up (one batch). A
batch in which every file fails returns 400 with `results` and does not use the
link; five such batches revoke it. Unknown tokens are 404; used, revoked,
expired links and links whose item was archived are 410. Files are attributed
to actor `upload_link:<link id>` with `via_upload_link` set, and events carry
reason `via upload link <id>`. A link token is not a sign-in: it cannot read
anything, including the files it uploaded.

Without a domain, only devices that can reach the local server can use a link.

## Artifacts

Artifacts (0.21.0) are frozen pages the owner shares with someone outside Crew
by a secret link, with no account or password. An artifact is a snapshot you
choose to publish, never a live view of a task or note, so activity, comments
and later edits stay private.

- **Drafts.** Any client creates and edits drafts: `artifact.create` (`title`,
  optional `body`, `sources`, `files`, `replaces`) and `artifact.update`
  (`title`, `body`, `sources`, `replaces`; revision-checked). `replaces` (0.22.0)
  names the artifact whose link a never-published draft updates; the Shared page
  shows it as "Update of: <title>". In the reader, a note's **Share as artifact**
  creates a draft prefilled from the note. An agent can compose one body from
  several notes. `sources` lists the notes and tasks it was built from and is
  shown only in Crew. Images are `![alt](attachment:ID)` references to image
  attachments: the artifact's own files (`attachment:new-N` in
  `artifact.create`) or any note's or task's images. Only PNG, JPEG, GIF and
  WebP can be shown.
- **Publishing is owner-only.** `artifact.publish` (draft or revoked to
  published, with a new random token), `artifact.replace` (the current draft
  becomes the published content under the same link; `published_revision`
  increments) and `artifact.revoke` (clears the token: the page and its images
  answer 404 at once) are refused with 403 on the work-client route before
  idempotency replay and take no `idempotency_key`, like the 0.22.0 lifecycle
  actions below. Their results carry
  `token`, `link_path` (`/a/<token>`) and `link` (with a domain). The reader's
  **Shared** page (`#/shared`, `#/shared/<id>`) lists every artifact with its
  state, link and Copy link, published time, expiry, views, last opened and
  sources, plus Publish, Update content (same link), Set expiry, Edit draft,
  Revoke, Discard, Archive and Restore. Filters (Drafts, Live, Revoked/expired,
  Archived; Drafts and Live by default) stay in the address
  (`#/shared?show=...`). It reads links from
  `GET /api/crew/artifact-links` (signed in, not on the MCP proxy's route
  list). `crew_read` artifacts, SQL view `artifacts` and MCP never return the
  token.
- **Lifecycle (0.22.0).** Reads add a derived `state`: `draft`, `published`,
  `expired` (published, and `expires_at` has passed), `revoked` or `archived`;
  `status` keeps the stored `draft`, `published` or `revoked`. Owner-only
  actions: `artifact.set_expiry` (`expires_at`, a future RFC 3339 time, or
  empty for none) on a live link; `artifact.publish` also takes `expires_at`,
  and on a draft with `replaces` it requires `mode`: `replace` (that artifact's
  link keeps its URL and shows this draft as its next snapshot; the update draft
  is archived) or `new` (a separate link; `replaces` is cleared).
  `artifact.archive` discards a draft or puts away a revoked or expired link (a
  live link is revoked first; archiving clears any token), and
  `artifact.restore` brings it back. Archived artifacts are hidden from
  `crew_read` unless `archived: true`, kept for history and never deleted. An
  expired token never works again: publishing again issues a new one. Every
  publish and replace event keeps the frozen snapshot it published (and the one
  it replaced), so earlier versions stay in history.
- **Snapshot rule.** Publishing copies the title, body and the ordered list of
  image attachments into `published_*`. Editing a source note never changes the
  page; editing a published artifact's draft sets `pending_changes` until the
  owner replaces the content.
- **The public page.** `GET /a/<token>` renders the snapshot in Go with the
  notes' GFM semantics: raw HTML is omitted, images resolve only through
  `/a/<token>/files/<n>` (the nth published image as its 1600 px preview), and
  links survive only when they are http(s) or mailto to another host. Other
  links and images keep their text. The page has no script, Crew navigation or
  links into Crew, and sends `X-Robots-Tag: noindex, nofollow, noarchive`,
  `Referrer-Policy: no-referrer`, `Cache-Control: no-store` and a CSP of
  `default-src 'none'` with only self images and the page's hashed style.
  Unknown, malformed, revoked, expired and archived tokens get the same plain
  404, "This link is no longer available."
  Each page view (not HEAD or images) increments `view_count` and sets
  `last_viewed_at` with one statement outside the record revision.
- **Rate limits.** Hosted mode sees one proxy address, so limits are keyed like
  upload links: unknown or malformed tokens share one bucket (60, refilling
  1/s), and each published artifact has its own (120, refilling 2/s). Refusals
  are 429 with `Retry-After`.
- **Risk.** Anyone with the link can read and forward it until you revoke it or
  it expires.
  The Publish button says so.

## Command-line work commands

The binary's `read`, `search`, `schema`, `query`, `write`, `attach` and
`attachment` commands are the
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
| `attach` | crew_write `attachment.add` | `POST /api/crew/agent-write` (multipart) |
| `attachment` | crew_attachment | `POST /api/crew/attachment-read` |

`attach FILE… (--task ID | --note ID) --reported-agent NAME [--reason TEXT]
[--execution JSON]` checks the files locally (regular, non-empty, at most 20 MiB,
at most 20 per command; otherwise exit 2), sends multipart `attachment.add`
requests of at most 89 MiB of files with the same JSON envelope as `crew_write`, and
prints `saved`, `failed`, `attachments` and per-file `results` (`index`, `file`,
`name`, `ok`, `id` or `error`). It exits 1 when no file was saved, and stops at
any other refusal (a missing or archived item, a conflict, a rate limit).
`write JSON|- --file PATH…` sends one multipart request for `attachment.add`,
`task.create`, `note.create` or `task.comment`; `attachment:new-N` names the Nth `--file`.

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
task.create/update/claim/claim_renew/release/comment; review.request/decide/withdraw; plus the
webhook and execution operations in the [webhook guide](webhooks.md). A restore names
revision_id and creates a new note revision. Claim takes an unassigned task, or
lets the assignee claim its own task; see [project coder agents](#project-coder-agents).
Comments preserve task revision (unless files sent with them withdraw a pending
review); append-only events record them. Link arrays hold
note IDs. Human is reserved as a derived pending-review label, not editable data.

Creating a review snapshots the task draft and moves it to needs_review. Editing
the draft (which puts the task on hold with hold reason `Draft edited`) or
archiving the task withdraws its pending reviews atomically. A work client
requesting review with its own execution proof completes that execution
(outcome `review_requested`); see [webhooks](webhooks.md#governed-tasks-and-atomic-execution). A
decision (by the owner, or by a work client the owner explicitly delegated)
requires a still-pending request and matching current draft. It moves
the task to in_progress, never done. Closed decisions cannot be rewritten. New
content requires a new review; historical approval never transfers to a new draft.

### Review evidence and alternatives (0.20.0)

Attach every image or document before requesting review and reference it as
`attachment:ID`. `review.request` rejects local image/document paths (including
Unix, Windows and `file://` paths) with `draft_references_unattached_files`, listing
the paths to replace. Existing reviews keep their snapshots; the reader warns
when a legacy draft mentions missing local files. Snapshot images appear inline
and in the attachment gallery with full-size previews.

`review.request` optionally accepts `options: [{key, label, body}]`. Use a unique
key for each alternative, including its platform when relevant (for example
`A-linkedin` and `A-x`). Option bodies use the same Markdown and attachment
references as the draft; all are frozen in the review. Without options, existing
review requests and decisions behave as before. At most 20 options are accepted;
keys contain 1–64 letters, digits, underscores or hyphens, labels have at most
200 characters, each nonempty body at most 100,000, and all bodies together at
most 200,000. Option decision notes have at most 20,000 characters.

`review.decide` accepts `option_decisions: [{key, decision, note}]` alongside the
overall `decision` and optional `note`. An approval needs explicit approved/rejected
choices for every option and at least one approved option. Unknown or duplicate
keys and contradictory decisions are refused. Rejecting with omitted option decisions
records every option as rejected; supplied rejection choices must reject them all.
Request changes can include partial choices. Choices are exposed through
`crew_read`, the bounded SQL reviews view, review history and task Activity. Closed
reviews remain immutable. The owner's delegation rules apply to every decision.

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

## Project coder agents

Besides Grok bots, the owner runs coding agents (Codex, Claude Code) in terminal
sessions. A shared manually started agent such as `Implement` can serve several
repositories: label each task with its repository and filter the board by assignment
and label. Its brief tells sessions to work only on the repository the owner picks.
One agent per repository remains supported. Keep one session per repository unless
the owner requests parallel work.

**Agent kinds.** `crew_agents.kind` is `bot` (a Grok bot woken by webhook, the
default, and every agent created before 0.18.0), `external` (a coder session the
owner starts by hand) or `human`. agent.create, agent.update and agent.ensure take
an optional `kind` (default `bot`; agent.ensure applies it only when it creates the
agent). Only bots are routed: Crew never wakes an external or human agent, even when
it has a leftover mapping. `webhook.mapping.update` for a non-bot is HTTP 400
(clearing a leftover mapping with an empty `bot_ref` stays possible), and the
dispatcher and triage agent must be bots. Changing a bot to another kind cancels its
queued wakes like deactivation and, if it was the dispatcher, disables the
integration. Setup checks that look for mapped agents ignore non-bots.

**Session instructions.** `crew_read {collection: "session", agent: "<ID or exact
name>"}` (also CLI `read` and `/api/crew/read`) returns one object:
`{agent: {id, name, kind}, prompt, instructions, lease_hours: 2, body, revision,
is_default, edited_by, edited_at, reason, rewrite_prompt}`. `prompt` is the
two-line paste the reader copies to start a session:

```text
You are <name> in PocketContext Crew.
Read your session instructions with crew_read collection "session" agent "<name>" and follow them.
```

`instructions` is the instructions `body` followed by the agent's brief under
`## Agent brief`. The body is the latest saved revision, or Crew's built-in default
(`pb_hooks/crew_session.js`) while none is saved or after Restore default. The
default tells the session to build a session
name once with one shell command (`$CREW_SESSION`, else
`<name> · <tool> · <Zellij session>/<pane> · <session id 8>` from
`CLAUDE_CODE_SESSION_ID` or `CODEX_SESSION_ID` and `ZELLIJ_SESSION_NAME`/`ZELLIJ_PANE_ID`)
and use it as reported_agent; list the agent's Ready To do tasks; claim one only when
the owner picks it; plan and wait for the owner's approval in the session (that
approval is the review); implement and release per the repository's AGENTS.md;
close with `Released in <version>: <what changed>, commit <sha>`, then one
task.update with `status: "done"`, `release: "<version>"`, `review_mode: "in_session"`
and `approved_by` (the owner's name if known, else `owner`); set Won't do
(`wont_do`) with a comment when the owner decides not to do a task; or release
with a hold reason when stopping early. An unknown agent is HTTP 404.

**Editable session instructions (0.21.0).** Session instructions are saved in
Crew, not in the code, per external agent, with immutable revisions in
`crew_session_revisions` (agent, revision, instructions, is_default, actor,
reported_agent, reason). Only the body is stored: the agent brief stays on the
agent and is appended when the session reads its instructions, so editing the
brief never creates an instructions revision. `revision` is 0 until the first save;
the built-in default then applies. A Restore default revision stores `is_default`
with empty text, so it follows the built-in template of the running release
(reads of that revision show the built-in text). Saved text keeps the agent name it
was written with if the agent is renamed.

`session.update` (reader `/api/crew/write` and work-client `/api/crew/agent-write`;
not owner-only) takes data `{agent: <ID or exact name>, instructions: TEXT}`, or
`{agent, restore_revision: N}` (copies revision N into a new revision), or
`{agent, restore_default: true}`; exactly one of the three. Top-level
`expected_revision` is required and must equal the current revision (0 for the
built-in default); otherwise HTTP 409. Only agents of kind `external` that are not
archived; text is non-empty Markdown up to 100,000 characters. Each change appends
one revision and one `session.update` event on the agent (changes: revision, mode
edit/restore/default, restored_from, is_default; reported_agent and reason as
sent) and returns the new session object. History:
`crew_read {collection: "session_revisions", parent: <agent ID or exact name>}`,
newest first, each row with a derived `edited_by` (the reported name, else `owner`
for reader writes or `a connected agent`). The skill and MCP instructions say to
rewrite instructions only when the owner asks and to save only after the owner
approves the new text.

In the reader, the Session instructions dialog says "These instructions are saved
in Crew, not in the code. Edit them by hand, or ask an agent to rewrite them.",
shows `Revision N · edited by X, date`, and offers **Rewrite with an agent**
(recommended: copies `rewrite_prompt`, which tells an agent to read the current
text, ask what to change, show the new version and save it with
`expected_revision` only after approval), **Edit** (a Markdown textarea with Save
and Cancel; a stale revision explains the conflict and offers Reload latest),
**History** (revision, who, when, with Restore) and **Restore default**. The dialog
rereads the session when it opens; **Copy prompt** copies the two-line prompt,
which makes the session read the latest saved revision.

**Releases, in-session approval and Won't do (0.19.0).** Tasks have:

- `status` gains `wont_do` (Won't do). Done and Won't do are terminal: setting
  either ends a claim, neither ever wakes a bot (owner comments and Ready
  included), both are left out of overdue wakes, a pending review blocks both, and
  leaving either for an open status is a `reopened` wake cause. Moving between
  Done and Won't do is not a reopening.
- `release` (text, trimmed, at most 32 characters on one line, empty for none):
  the release that shipped the task, for example `0.19.0`. Task reads filter it
  exactly with `release`, and `""` selects tasks without one.
- `review_mode`: `""` (the default, meaning a Crew review), `crew` or
  `in_session` (the owner approved the work in a coding session). `in_session` is
  accepted only when the task is or becomes Done (HTTP 400 otherwise). Setting it
  makes Crew stamp `approved_at` with server time; `approved_by` (at most 100
  characters, a reported name used only as attribution, never identity) defaults
  to `owner`. `approved_at` is never written by clients, and `approved_by` is
  refused without `in_session`. Later updates while still Done keep the stamp.
- Leaving Done by any operation (task.update, a claim or review.request) clears
  `review_mode`, `approved_by` and `approved_at`; switching to `crew` clears the
  approval. The release is kept.
- The task event records the trimmed `release` and `approved_by`, and on approval
  `review_mode` and `approved_at`, or `approval_cleared: true` when cleared.

The reader's status select offers Won't do and the task dialog has a Release field
and, for an in-session approval, "Approved in session by <name>, <date>". The
board keeps four columns: the Done column holds Done and Won't do tasks (Won't do
cards carry a chip), grouped by release (newest release first, semantic versions
compared numerically, "No release" last), showing tasks updated in the last 7 days
with **Show older (N)** for the rest. Cards with a release show "Shipped in X".
Clicking a release header in the Done column filters the board to that release,
kept in the address (`#/tasks?release=<release>` or `release=none`); the search
token `release:<release>` and the Filters panel do the same.

**Claims.** Tasks have `claimed_at` (the original start, unchanged by renewal),
`claimed_by` (the claimer's reported session name; attribution, not identity), `claim_until` (ISO UTC lease end) and a derived
`claim_state` (`""`, `live` or `expired`) in every task response.

- `task.claim` with `data.assigned_agent`: on an unassigned task it assigns and sets
  In progress, as before, and records the claim (under reported_agent, or the
  agent's name). The task's own assignee (its ID or exact name) may claim it when it
  is Ready and To do, or In progress with an empty or expired claim; reported_agent
  is then required. Otherwise HTTP 409 (`not_claimable`, or "Task is already
  assigned" for another agent). The lease is 2 hours.
- A live claim by anyone answers HTTP 409 with `data.reason.code`
  `already_claimed` and `data.claimed_by`/`data.claim_until`, checked before the
  revision so the loser of two simultaneous claims learns who won. Writes are
  serialized and revision-checked, so two sessions never hold the same task.
- `task.claim_renew` (empty data) extends a live claim to 2 hours from now when
  reported_agent equals claimed_by; otherwise 409 `claim_expired` or `not_claimer`.
  The claimer's task.update, task.comment and attachment writes on the task renew
  the lease too (a comment still keeps the task revision).
- `task.release` (optional `readiness` and `waiting_reason`) clears the claim, sets
  an In progress task back to To do and applies the readiness. The claimer, the owner
  in the reader, or anyone after the claim expired may release; another work client
  gets 409 `not_claimer`. Setting Done or Won't do (task.update, or
  execution.complete with mark_done) also clears the claim.
- Claims are advisory: they block no other write, owner edits included. They never
  send a webhook; the Grok-bot execution protocol is unchanged. An expired claim
  stays visible (`claim_state: "expired"`) until the task is claimed, released or
  done. Every claim, renewal and release is a task event (`task.claim`,
  `task.claim_renew`, `task.release`) with the claim in its changes.

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

Tasks expose readiness, waiting_reason and server-managed wake_generation.
Readiness is `waiting` (the default), which the reader labels **On hold**, or
`ready`. Writes accept `on_hold` as an alias and store `waiting`; reads and
filters return `waiting` (the read filter accepts `on_hold` too).
`waiting_reason` is the hold reason. Crew sets it on every automatic hold:
`Draft edited` (a draft edit withdrew a pending review), `Review withdrawn` (an
attachment change withdrew one) and `Bot hand-off limit reached`. Going Ready
clears it unless the same write sets one.

Since 0.20.0, `held_since` records the start of the current hold on an open task.
The server manages it across explicit and automatic holds; edits, comments and
attachment changes during that hold do not reset it. Going Ready or terminal clears
it. Existing held tasks use their pre-upgrade update time as an approximate start.
Home and the board share the same over-three-days rule, exclude terminal tasks
from hold views, and keep the age filter in the address (`held_over=3d`).

The board also supports a case-insensitive single label filter (`label=…`), combined
with assignment, hold, status and release filters. Click a label chip to filter.
The board toolbar shows only search, the agent filter and a **Filters** button
(with a count); the button opens a panel with readiness (On hold, Ready, on hold
over 3 days), label, status, release and sort. Each filter set there shows as a
removable chip under the toolbar, with the number of matching tasks and **Clear
all**. The search reads `release:`, `label:`, `agent:` and `status:` tokens
(quote values with spaces, e.g. `agent:"Build bot"`) and applies them like the
corresponding filter; Enter turns them into chips in the address. The MCP `label`
filter remains an exact match.

The wake rule: an on-hold task never wakes a bot, whatever changes. Creating it,
assigning or reassigning it, reopening it, review outcomes and comments
(including owner comments) are only recorded in its Activity. Only a Ready task
wakes: setting Ready, or a subscribed change or opted-in owner comment on a Ready
task. Putting a task on hold, by any route or automatically, cancels its
unfinished executions at once (state `invalidated`, outcome `put_on_hold`,
fence advanced, lease cleared), records a task `execution.cancel` event and
advances the wake generation, so queued wakes are stale. A work client may put
a task on hold during a live execution without proof when the update changes
only `readiness` and `waiting_reason`; any other unproved write is still refused
with `execution_required`. Ready work, assignment, review and invalidation changes share a
transaction with durable outbox records. Shared MCP manages the global dispatcher, bot mappings and non-secret instructions
through revision-checked operations; URL and secret entry is owner-browser-only; this does not expose
general host administration. Read [webhooks](webhooks.md) for the operation and
receiver contracts, idempotency, destination versions and restore epochs.

Reader (owner browser) comments can wake an eligible task's assignee when the
integration opts into the `comment` reason; work-client comments never wake.
This is loop prevention, not a privilege. A comment during live execution is
deferred until `execution.complete`. Consecutive work-client reassignments are
counted per task; exceeding `max_bot_handoffs` (default 4) applies the write but
puts the task on hold without a wake. Any reader task write resets the count.
A work client may set the stopped task Ready (when the owner asks, or after
breaking and reporting the loop), but that keeps the count, so the next
work-client reassignment stops it again. The stopped task's hold reason is
`Bot hand-off limit reached`. The owner sets wake subscriptions
and the limit under Wake rules on the reader's Connect page.

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
supplied proof is always validated. Putting a task on hold releases governance and cancels the live execution. Read the webhook guide for the full lifecycle.

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
