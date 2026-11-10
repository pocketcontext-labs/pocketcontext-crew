# Examples

Each CLI command takes the same JSON object as its MCP tool. `CREW` stands for
the absolute binary with this instance's `--db` or `--url` option from SKILL.md;
`read JSON` is `crew_read(JSON)` over MCP, and likewise for search, schema,
query and write. Use `-` and standard input for long or multi-line JSON.

Read: `CREW read '{"collection":"buckets"}'` (MCP: `crew_read({"collection":"buckets"})`).

Your ready work, compactly:
`CREW read '{"collection":"tasks","assigned_agent":"Build","readiness":"ready","fields":["title","status","revision"],"limit":20}'`.

Find notes by topic, then read one hit:
`CREW search '{"query":"release checklist","collections":["notes"],"limit":5}'`, then
`CREW read '{"collection":"notes","id":"NOTE_ID","fields":["title","body"]}'`.

Cite a task to a human:
`CREW read '{"collection":"tasks","id":"TASK_ID","fields":["title","url"]}'`, then write
`[Launch post](https://crew.example.com/#/tasks/launch-post-vicfcuk53eds6yt)`; with no
`url` in the response, write `Launch post (vicfcuk53eds6yt)`.

Report open work by status (`CREW schema` lists the views once):
`CREW query '{"sql":"SELECT status, count(*) FROM tasks WHERE archived = 0 GROUP BY status"}'`.

Assign using current revision:
`CREW write '{"action":"bucket.assign","id":"BUCKET_ID","expected_revision":3,"reported_agent":"Build","reason":"Owner requested responsibility change","data":{"agent":"Build"}}'`.

Clear: use the same action and current revision with `data: {"agent":null}`.
Read responsibility: `CREW read '{"collection":"buckets","responsible_agent":"Build"}'`.

Create a note with `note.create` and data containing bucket, title and body; a
long body is easiest from standard input:

```sh
CREW write - <<'EOF'
{"action":"note.create","reported_agent":"Build","data":{"bucket":"BUCKET_ID","title":"Release checklist","body":"Markdown body"}}
EOF
```

Update with note.update, id, expected_revision and only intended changed fields.
Read note_revisions with parent set to the note ID before note.restore.

Request review with review.request, the task ID/current revision and empty data.
Record a decision only when the owner explicitly delegated it in this conversation:
`CREW write '{"action":"review.decide","id":"REVIEW_ID","expected_revision":1,"reported_agent":"Build","reason":"Owner reviewed and asked me to record approval","data":{"decision":"approved"}}'`.
Keep reported_agent your own name; never pose as the owner or another agent.
