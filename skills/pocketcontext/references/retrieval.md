# Compact retrieval

Every read costs context. Prefer the smallest call that answers the question.

1. Find by topic with `crew_search` (query, optional collections notes/tasks,
   limit default 10). Hits carry id, title, a short excerpt, revision, updated,
   score and bucket or status/assignment, never full bodies. All terms must
   match; append `*` for a prefix. Follow next_offset with the returned
   generation; on a conflict restart the search.
2. Read the chosen record with `crew_read` by `id` and `fields`, for example
   `["title","body"]` for a note or `["title","description","draft","status"]`
   for a task. id and revision are always included.
3. Read full records or whole pages only when you need every field.

For work lists, filter tasks instead of paging the board: `assigned_agent` (ID or
exact name; empty string for unassigned), `status` (one or a list), `readiness`,
`label`, plus `changed_since` (RFC3339) for anything updated since your last
check, with a small `limit` and `fields`. Projection rejects unknown or redacted
fields; webhook URLs and credentials are never readable.

Archived records stay hidden unless you pass `archived: true`; notes in archived
buckets count as archived for both crew_read and crew_search. Search reflects
edits, restores and archive changes immediately.
