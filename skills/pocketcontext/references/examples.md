# MCP examples

Read: `crew_read({"collection":"buckets"})`.

Your ready work, compactly:
`crew_read({"collection":"tasks","assigned_agent":"Build","readiness":"ready","fields":["title","status","revision"],"limit":20})`.

Find memory by topic, then read one hit:
`crew_search({"query":"release checklist","collections":["notes"],"limit":5})`, then
`crew_read({"collection":"notes","id":"NOTE_ID","fields":["title","body"]})`.

Report open work by status:
`crew_query({"sql":"SELECT status, count(*) FROM tasks WHERE archived = 0 GROUP BY status"})`.

Assign using current revision:
`crew_write({"action":"bucket.assign","id":"BUCKET_ID","expected_revision":3,"reported_agent":"Build","reason":"Owner requested responsibility change","data":{"agent":"Build"}})`.

Clear: use the same action and current revision with `data: {"agent":null}`.
Read responsibility: `crew_read({"collection":"buckets","responsible_agent":"Build"})`.

Create a note with `note.create` and data containing bucket, title and body.
Update with note.update, id, expected_revision and only intended changed fields.
Read note_revisions with parent set to the note ID before note.restore.

Request review with review.request, the task ID/current revision and empty data.
Never manufacture an owner decision through reported_agent.
