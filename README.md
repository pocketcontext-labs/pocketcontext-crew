# PocketContext Crew

Notes, tasks and human approvals for one person's AI team. One Go service,
one database and one authenticated MCP endpoint at `/mcp`, or, without a domain,
the same binary's agent commands on your own computers. External assistants
run the agents; Crew stores their context and coordinates work.

Crew is a separate product derived from PocketContext source
`b72e3ff5c96d9ba8792a89be6da724f27ffdc088`. It introduces its own notes and tasks
schema and application UI. Use a new project database; do not point it at an
existing PocketContext installation. Crew has no spaces or inherited knowledge APIs. Notes need no publication run.

See [Crew 0.14.0 release notes](docs/releases/0.14.0.md) for the Tasks and Notes pages, board column focus and visible wake rules, [Crew 0.13.0](docs/releases/0.13.0.md) for bucket and agent filters, sorting and bot display names, [Crew 0.12.1](docs/releases/0.12.1.md) for search focus, agent brief and Approvals card polish, [Crew 0.12.0](docs/releases/0.12.0.md) for one capability set across the reader, MCP and the CLI, [Crew 0.11.1](docs/releases/0.11.1.md) for Approvals and focus polish, [Crew 0.11.0](docs/releases/0.11.0.md) for the simpler reader, Home, help, search and the styled consent page, [Crew 0.10.0](docs/releases/0.10.0.md) for permanent task and note links, [Crew 0.9.3](docs/releases/0.9.3.md) for agent names in task assignment, [Crew 0.9.2](docs/releases/0.9.2.md) for archiving done governed tasks, [Crew 0.9.1](docs/releases/0.9.1.md) for self-started tasks, [Crew 0.9.0](docs/releases/0.9.0.md) for the move to `pocketcontext-core` and [Crew 0.8.0](docs/releases/0.8.0.md) for the agent commands
`read`, `search`, `schema`, `query` and `write`, which give installs without a
domain the same agent path through the CLI and the installed skill, locally and
on tunnel-paired computers. [Crew 0.7.0](docs/releases/0.7.0.md) added opt-in
owner-comment wakes, the bot handoff limit, ranked search and bounded read-only
SQL; [Crew 0.7.1](docs/releases/0.7.1.md) fixed remote client invitations.

## First version

- Buckets of editable Markdown notes, immutable versions and restoration.
- Ranked full-text search (FTS5/BM25) over notes and tasks, compact filtered
  reads, bounded read-only SQL reporting, explicit note links and archived-item views.
- Agent briefs and designated bucket responsibility: read all buckets, write your
  own, request changes elsewhere through tasks. This is behavior, not isolation.
- Tasks board: To do, In progress, Needs review, Done; assignments, labels,
  revision-checked claims, comments, drafts and append-only events.
- Human review inbox with exact draft snapshots. The owner reviews; an agent
  records a decision only when the owner explicitly delegates it. Draft edits
  withdraw pending review. Approval never executes an external action or completes
  a task. The owner performs external actions and records completion separately.
- Archive and restore, with history retained indefinitely. No purge endpoint.

Work clients (MCP `crew_write` and the CLI `write` command) have the same
operations as the owner's reader, except webhook URL and secret entry, which
stay in the owner browser. Authorization for the rest is a set of owner-editable
default rules in the skill and MCP instructions (for example: decide reviews
only on explicit delegation); attribution (`actor`, `reported_agent`) is kept
for audit and never used to block. Agent names are reported attribution, not
identity. Never give MCP or hosted agents the owner's browser token; installs
without a domain are the exception below.

## Connect and use

Without a domain, run Crew on your own computer: the binary is both the localhost
server and the CLI your coding agent calls through the installed skill (`skill`).
The commands `read`, `search`, `schema`, `query` and `write` take the MCP tools'
JSON and call the same routes, `write` only the work-client route; other computers
join through `tunnel serve` and `tunnel invite`. CLI agents there act with owner
authority (local key or a paired computer's saved session), so even webhook
credential entry is kept from them only by the skill's rules, and cloud
assistants cannot reach such an install. See [local use](docs/local.md).

With a domain, sign in with the native owner password/sign-in link, or the configured owner email
for a hosted container. Connect
an assistant to `https://YOUR_HOST/mcp` and authorize it in that
signed-in browser. The Crew tools are `crew_read` (filtered, projected reads),
`crew_search` (ranked full-text search over notes and tasks), `crew_schema` and
`crew_query` (bounded read-only SQL for reporting) and `crew_write`; their
schemas describe collections, operations and revision requirements. The browser
provides the same operations plus webhook credential entry.

Create the optional five-agent starter setup in the UI, or create agents and
buckets yourself. Each agent should read its brief and bucket, track work in a
task, save only durable decisions/findings, and request review for the finished
draft. Agent execution, recurrence and calendar sync are external. Crew can send configured HTTPS task wake signals; see [webhooks](docs/webhooks.md).
See [Crew data and API contract](docs/crew.md) and [data-model diagram](docs/data-model.md).

## Install your own copy

Start with the [native Linux installation guide](docs/native-install.md): one
Crew binary, native HTTPS/MCP, password access and separately scheduled verified
backups. The [Docker Compose alternative](docs/install.md) supplies email login
and integrated private S3 backups. Both use your own domain and need no private
deployment scaffold. Without a domain, follow [local use](docs/local.md) for
agents on your own computers.
Crew is single-owner self-hosted software; there is no public signup service.

## Hosting

The inherited hosted supervisor supplies one writer, email OTP, HTTPS behind ONCE,
OAuth, complete daily S3 backups and verified stop-first upgrades. Runtime secrets
remain outside the database and Git. Existing environment names, internal executable
`pocketcontext` and supervisor `pocketcontext-container` are retained for compatibility
with that runtime; the image is `ghcr.io/pocketcontext-labs/pocketcontext-crew`.
See [hosting procedures](docs/hosting.md). The deployment scaffold owns the domain,
private bucket and desired image reference. The managed Crew instance follows
`:latest` for manual convergence; each deployment resolves to an immutable digest.
Every push to `main` starts the image workflow, which publishes validated
source-tagged multi-platform images and `latest`. Explicitly enrolled Crew
instances automatically deploy that exact digest through a repository-scoped SSH
forced command after all checks pass, unless delivery is paused or the revision
has been superseded on `main`. This does not deploy sibling products or follow upstream
PocketContext releases. See the hosting guide for enrollment and pause controls.

## Local project backups and moving computers

For a consistent backup, stop the server and wait for successful shutdown. Copy
`pocketcontext.db`, `pocketcontext.json`, `storage/`, `legacy-knowledge/` (when present) and the matching binary. Keep
that complete stopped backup together. Configured webhooks also require the
machine-private webhook key; use the documented native snapshot/restore helper
on Linux or a complete private runtime backup. Project-only copies do not preserve
webhook credentials. Supported restoration changes the delivery epoch and pauses
delivery. Restart the original only after the copy
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
CGO_ENABLED=1 go build -tags "$(cat build-tags.txt)" -o bin/pocketcontext-crew ./cmd/pocketcontext-crew
CGO_ENABLED=1 go test -tags "$(cat build-tags.txt)" ./...
python3 tests/crew_e2e.py --binary bin/pocketcontext-crew
python3 tests/e2e.py --binary bin/pocketcontext-crew
```

Use synthetic records and a temporary project for development. Hosted production
requires owner email, SMTP and dedicated private backup bindings. No credentials
are committed. New schemas must preserve snapshot-safe persistence, authentication,
immutable audit history and Windows support inherited from PocketContext.
