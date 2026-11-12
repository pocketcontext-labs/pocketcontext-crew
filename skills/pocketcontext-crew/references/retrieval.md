# Compact retrieval

Every read costs context. Prefer the smallest call that answers the question.
The CLI commands `search`, `read`, `schema` and `query` take the same JSON as
the MCP tools crew_search, crew_read, crew_schema and crew_query.

1. Find by topic with `search` / `crew_search` (query, optional collections notes/tasks,
   limit default 10). Hits carry id, title, `path`, `url` (only when the install has
   a domain), a short excerpt, revision, updated, score and bucket or
   status/assignment, never full bodies. All terms must
   match; append `*` for a prefix. Follow next_offset with the returned
   generation; on a conflict restart the search.
2. Read the chosen record with `read` / `crew_read` by `id` and `fields`, for example
   `["title","body"]` for a note or `["title","description","draft","status"]`
   for a task. id and revision are always included. Add `url` when you will cite
   the item to a human.
3. Read full records or whole pages only when you need every field.

For work lists, filter tasks instead of paging the board: `assigned_agent` (ID or
exact name; empty string for unassigned), `status` (one or a list, including
`wont_do`), `readiness`, `label`, `release` (exact; empty string for none), plus `changed_since` (RFC3339) for anything updated since your last
check, with a small `limit` and `fields`. Projection rejects unknown or redacted
fields; webhook URLs and credentials are never readable.

Archived records stay hidden unless you pass `archived: true`; notes in archived
buckets count as archived for both reads and search. Search reflects
edits, restores and archive changes immediately.

Use SQL for counts, joins, aggregates and history, not for ordinary lookups:
read `schema` (crew_schema) once for the views and columns, then send one
read-only statement to `query` (crew_query). Results are `columns` plus `rows` arrays, at most
1000 rows and 1 MiB (`truncated` reports a cut). SQL includes archived records:
add `archived = 0` (and join buckets for notes) when you want active work.
Example: `SELECT a.name, t.status, count(*) FROM tasks t LEFT JOIN agents a ON
a.id = t.assigned_agent WHERE t.archived = 0 GROUP BY 1, 2`. JSON columns are
text (`json_each(t.labels)`), timestamps are UTC text. Webhook URLs, credentials
and fencing handles are not readable; never try to work around that.
