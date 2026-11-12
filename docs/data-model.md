# Crew data model

Crew has one owner and one instance-wide model. There are no spaces or inherited
knowledge collections. Agents are role metadata, not accounts. Responsibilities
and task assignments are optional single-agent relations.

```mermaid
erDiagram
  crew_agents o|--o{ crew_buckets : responsible_agent
  crew_buckets ||--o{ crew_notes : bucket
  crew_notes ||--o{ crew_note_revisions : note
  crew_agents ||--o{ crew_session_revisions : agent
  crew_agents o|--o{ crew_tasks : assigned_agent
  crew_tasks ||--o{ crew_reviews : task
  crew_tasks ||--o{ crew_attachments : parent
  crew_notes ||--o{ crew_attachments : parent
  crew_tasks ||--o{ crew_upload_links : parent
  crew_notes ||--o{ crew_upload_links : parent
  crew_artifacts ||--o{ crew_attachments : parent
```

Notes and tasks also carry JSON arrays of linked task or note IDs. Events carry a parent record
ID as text, plus action, actor, reported_agent, reason and changes. These links are
validated by custom operations rather than generic record writes. Every Crew
record has revision and timestamps. Notes have immutable snapshots; events are
append-only. Agents, buckets, notes and tasks archive without purging history.

Agents have a `kind`: `bot` (default; Grok bots woken by webhook), `external`
(coder sessions the owner starts by hand) or `human`. Only bots are woken. Tasks
carry an advisory claim: `claimed_by` (reported session name, attribution only),
`claimed_at` (start) and `claim_until` (ISO UTC lease end), empty without a claim.
Responses add a
derived `claim_state`. External agents' session instructions are immutable
`crew_session_revisions` rows (agent, revision, instructions body, is_default,
actor, reported_agent, reason; unique per agent and revision). The latest row is
current; without rows, or when the latest is a default revision (empty text,
is_default true), Crew's built-in template applies. The agent brief is not stored
there; it is appended when the instructions are read. See [project coder agents](crew.md#project-coder-agents).
Task `status` is `todo`, `in_progress`, `needs_review`, `done` or `wont_do`
(terminal like done). Tasks also carry `review_mode` (empty, `crew` or `in_session`), `approved_by` (reported
name, attribution only) and the server-set `approved_at`; see
[in-session approval](crew.md#project-coder-agents). Since 0.23.0 tasks have no
`release` field: the migration moved each release to the label `release-<value>`,
and a write or read that names `release` is refused (HTTP 400,
`release_field_removed`).

Artifacts (0.21.0) are pages shared by link. The draft is `title`, `body`
(Markdown) and `sources` (note and task IDs, shown only in Crew); `status` is
`draft`, `published` or `revoked`. Publishing copies `published_title`,
`published_body` and `published_files` (ordered image attachment IDs; attachments
are immutable, so the snapshot never changes) with `published_at`, `published_by`
and `published_revision`. `token` is a hidden field (32 random base62 characters,
cleared on revoke; never in crew_read, SQL or MCP). `view_count` and
`last_viewed_at` are updated by the public page outside the record revision.
Since 0.22.0, `expires_at` (RFC 3339, empty never expires) ends a published
link, `replaces` names the artifact whose link a draft updates, and `archived`,
`archived_at` and `archived_by` archive artifacts instead of deleting them; reads
add the derived `state` (`draft`, `published`, `expired`, `revoked` or
`archived`) and, since 0.23.0, `merged_into`/`merged_at` for an archived update
draft whose content replaced a live link. A same-origin visit to `/a/<token>`
(the owner's Open on the Shared page, `Sec-Fetch-Site: same-origin`) is not
counted in `view_count`. See [Artifacts](crew.md#artifacts).

Attachments carry `parent_kind` (task, note or artifact) and the parent ID as text, a
protected single file (20 MiB, thumbs 1600x0 and 320x0, never exported), display
name, media type, verified-image flag and dimensions, size, server-computed
SHA-256, position, attribution and archive state. Their bytes are immutable and
never purged. Upload links store only a token SHA-256 with parent, expiry,
maximum files, usage and revocation. `crew_settings` is a singleton holding
`storage_limit_bytes` (default 5 GiB). Reviews snapshot the task's active
attachments as `[{id, sha256}]`. Optional review `options` freeze keyed alternative
bodies; `option_decisions` records each approved/rejected choice. Tasks have
server-managed `held_since` for stable hold age on open tasks. See [Attachments](crew.md#attachments).

Responsibility does not enforce write isolation. Work clients have the reader's
operations except webhook credential entry, upload-link creation and publishing artifacts; review decisions, archival and
deactivation follow the owner's authorization rules. See [Crew contract](crew.md).
