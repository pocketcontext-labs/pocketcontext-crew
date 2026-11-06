# PocketContext Crew

Shared memory, tasks and human approvals for one person's AI team. One Go service,
one database and one authenticated MCP endpoint at `/mcp`. External assistants
run the agents; Crew stores their context and coordinates work.

Crew is a separate product derived from PocketContext source
`b72e3ff5c96d9ba8792a89be6da724f27ffdc088`. It introduces its own work/memory
schema and application UI. Use a new project database; do not point it at an
existing PocketContext installation. Existing evidence APIs remain available for
immutable source ingestion and provenance; ordinary Crew notes need no publication run.

## First version

- Memory buckets with editable Markdown notes, immutable versions and restoration.
- Full-content text search, explicit note links and archived-item views.
- Agent briefs and designated bucket responsibility: read all buckets, write your
  own, request changes elsewhere through tasks. This is behavior, not isolation.
- AI Team board: To do, In progress, Needs review, Done; assignments, labels,
  revision-checked claims, comments, drafts and append-only events.
- Human review inbox with exact draft snapshots. Only the owner's ordinary login
  can decide; the MCP connection cannot manufacture a decision. Draft edits
  withdraw pending review. Approval never executes an external action or completes
  a task. The owner performs external actions and records completion separately.
- Archive and restore, with history retained indefinitely. Bucket archival and
  agent deactivation are owner operations. No purge endpoint.

Agent names are reported attribution. A shared MCP connection cannot independently
identify its bots. Never give agents the owner's browser/CLI token: the human
approval boundary is between owner credentials and the MCP OAuth connection.

## Connect and use

Sign in to the deployed application's reader with the bound owner email. Connect
an assistant to `https://crew.pocketcontext.com/mcp` and authorize it in that
signed-in browser. The two Crew tools are `crew_read` and `crew_write`; their
schemas describe collections, operations and revision requirements. The browser
provides the same work and memory operations plus owner-only decisions.

Create the optional five-agent starter setup in the UI, or create agents and
buckets yourself. Each agent should read its brief and bucket, track work in a
task, save only durable decisions/findings, and request review for the finished
draft. Agent execution, recurrence, calendar sync and notifications are external.
See [Crew data and API contract](docs/crew.md).

## Hosting

The inherited hosted supervisor supplies one writer, email OTP, HTTPS behind ONCE,
OAuth, complete daily S3 backups and verified stop-first upgrades. Runtime secrets
remain outside the database and Git. Existing environment names, internal executable
`pocketcontext` and supervisor `pocketcontext-container` are retained for compatibility
with that runtime; the image is `ghcr.io/pocketcontext-labs/pocketcontext-crew`.
See [hosting procedures](docs/hosting.md). The deployment scaffold owns the domain,
private bucket and immutable image pin. This repository's image workflow publishes
validated source-tagged multi-platform images; it does not deploy siblings or
follow upstream PocketContext releases automatically.

## Local project backups and moving computers

For a consistent backup, stop the server and wait for successful shutdown. Copy
`pocketcontext.db`, `pocketcontext.json`, `storage/` and the matching binary. Keep
that complete stopped backup together. Restart the original only after the copy
finishes. Hosted containers use the supervisor's verified complete-backup procedure
instead, including their private authorization state.

Only one computer may run a project at a time. Stop the previous server and wait
for file synchronization before switching computers. Restore a local project with
its matching binary; recreate machine-local profiles and credentials separately.
Never substitute a live private working database for a clean project backup.

## Development

Go version is pinned in `go.mod`; CGO and `build-tags.txt` are required. Build the
React UI before the binary:

```sh
cd ui
pnpm install --frozen-lockfile
pnpm test
pnpm build
cd ..
CGO_ENABLED=1 go build -tags "$(cat build-tags.txt)" -o bin/pocketcontext ./cmd/pocketcontext
CGO_ENABLED=1 go test -tags "$(cat build-tags.txt)" ./...
python3 tests/crew_e2e.py --binary bin/pocketcontext
python3 tests/e2e.py --binary bin/pocketcontext
```

Use synthetic records and a temporary project for development. Hosted production
requires owner email, SMTP and dedicated private backup bindings. No credentials
are committed. New schemas must preserve snapshot-safe persistence, authentication,
immutable audit history and Windows support inherited from PocketContext.
