# Crew upgrades and rollback

## Crew 0.17.0 to 0.18.0

One data migration (`1801100000_crew_project_agents.js`) adds an agent `kind` (`bot`,
`external` or `human`) and the advisory task claim fields `claimed_by` and
`claim_until`. Every existing agent becomes `bot`, so webhook routing is unchanged;
existing tasks have no claim. Records, history and webhook settings are otherwise
unchanged. There is no protocol version change and no new managed block
(DEFAULT_INSTRUCTIONS is unchanged), so webhook delivery is not paused.

1. Take a complete stopped backup first: `pocketcontext.db`, `pocketcontext.json`,
   `storage/`, `legacy-knowledge/` (when present), the matching 0.17.0 binary and,
   with webhooks, the private webhook key. Hosted instances use the verified
   complete backup that the deployment prepares.
2. Replace the binary or image with the normal procedure
   (`CREW_REPLACE_VERSION=0.17.0` for the installer) and upgrade paired clients
   with the server. A client and server must report the same release.
3. Run `skill` once on each computer with a Crew profile: the skill and MCP
   instructions now describe project coder sessions and claims. Refresh MCP
   connector tool schemas (`crew_read` gains `agent`, `claim_state` and the
   `session` collection).
4. `capabilities_digest` changes (agent `kind`, task claim fields, `task.claim_renew`,
   `task.release` and the `session` collection), so routines and agents reread
   `capabilities` once at their next run; they need no other change.

An older binary refuses the migrated database (unknown migration) and leaves it
unchanged. Rollback means restoring the complete pre-upgrade backup with the 0.17.0
binary or image; agent kinds, claims and other changes made after the upgrade are
not in that backup.

Behavior changes: `task.claim` now also lets the assigned agent claim its own Ready
To do task (or an In progress task without a live claim) with a 2-hour lease, and a
live claim answers HTTP 409 `already_claimed` with `claimed_by` and `claim_until`
in `data`. `webhook.mapping.update` for a non-bot agent is a 400; the dispatcher and
triage agent must be bots. See [project coder agents](crew.md#project-coder-agents).

## Crew 0.16.0 to 0.17.0

No data migration, no protocol version change and no new managed block, so webhook
delivery is not paused. An 0.16.0 binary can still open the database, so rollback is
replacing the binary or image again.

1. Take the usual complete backup (hosted instances use the verified backup the
   deployment prepares).
2. Replace the binary or image with the normal procedure
   (`CREW_REPLACE_VERSION=0.16.0` for the installer) and upgrade paired clients with
   the server. A client and server must report the same release.
3. Run `skill` once on each computer with a Crew profile: the skill and MCP
   instructions now state the On hold wake rule and comment files. Refresh MCP
   connector tool schemas (`crew_read` gains `overdue`).
4. `capabilities_digest` changes, so routines and agents reread `capabilities` once.
5. Comment bodies are now validated: a client that put another task's
   `attachment:ID` in a comment gets a 400 instead.

## Crew 0.15.0 to 0.16.0

One data migration (`1801000000_crew_attachments.js`) adds the `crew_attachments`,
`crew_upload_links` and `crew_settings` collections (storage limit 5 GiB) and an
`attachments` snapshot field on reviews. Existing records, history and webhook
settings are unchanged. There is no protocol version change and no new managed
block (DEFAULT_INSTRUCTIONS is unchanged), so webhook delivery is not paused.

1. Take a complete stopped backup first: `pocketcontext.db`, `pocketcontext.json`,
   `storage/`, `legacy-knowledge/` (when present), the matching 0.15.0 binary and,
   with webhooks, the private webhook key. Hosted instances use the verified
   complete backup that the deployment prepares.
2. Replace the binary or image with the normal procedure
   (`CREW_REPLACE_VERSION=0.15.0` for the installer) and upgrade paired clients
   with the server. A client and server must report the same release.
3. Run `skill` once on each computer with a Crew profile to install the new skill
   files. Refresh MCP connector tool schemas.
4. `capabilities_digest` changes (new attachment, upload-link and storage
   operations and collections), so routines and agents reread `capabilities` once
   at their next run; they need no other change.

An older binary refuses the migrated database (unknown migration) and leaves it
unchanged. Rollback means restoring the complete pre-upgrade backup with the 0.15.0
binary or image; files attached after the upgrade are not in that backup. Hosted
volumes keep attachments under `/storage/project/storage/`, which the complete S3
backup includes and verifies by SHA-256. Allow room on the volume for the storage
limit (default 5 GiB) plus thumbnails.

The public route allowlist on a domain adds `GET /api/crew/attachment` (signed-in
file reads), `POST /api/crew/attachment-read`, `POST /api/files/token` and the
upload-link endpoints `POST /api/crew/upload-link/info` and
`POST /api/crew/upload-link/upload`. A reverse proxy in front of Crew must allow request bodies of at
least 90 MiB (94,371,840 bytes) on `/api/crew/write`, `/api/crew/agent-write` and
`/api/crew/upload-link/upload`, and pass the `X-Crew-Upload-Token` header
unchanged. Crew caps multipart requests at 90 MiB so they fit under
Cloudflare's 100 MB (100,000,000-byte) request body limit on standard plans,
which would otherwise refuse larger requests with an opaque 413 (the native
HTTPS listener caps requests at 110 MiB and passes headers through).

New for agents and the CLI: the read-only MCP tool `crew_attachment` and
`crew_write` file operations (refresh connector tool schemas, step 3), and the
CLI commands `attach` and `attachment` (installed with the new binary and
`skill`). Without a domain, upload links work only for devices that can reach
the local server. See [attachments](crew.md#attachments) for limits, previews
and upload-link rules.

## Crew 0.14.0 to 0.15.0

No data migration, protocol change or new managed block, so webhook delivery is not paused.
Replace the binary or image with the normal procedure (`CREW_REPLACE_VERSION=0.14.0` for
the installer), upgrade paired clients with the server and run `skill` on each computer
with a Crew profile to install the updated skill wording. A client and server must report
the same release. From 0.13.0, first follow the 0.14.0 step below.

## Crew 0.13.0 to 0.14.0

No data migration, protocol change or operator step, and no new managed block. Saved
webhook settings are unchanged. Replace the binary or image with the normal procedure
(`CREW_REPLACE_VERSION=0.13.0` for the installer) and upgrade paired clients with the
server. A client and server must report the same release. Bookmarks to `#/team` and
`#/memory` redirect to `#/tasks` and `#/notes`. From 0.12.x, first follow the 0.13.0 step
below.

## Crew 0.12.x to 0.13.0

No data migration, protocol change or operator step, and no new managed block. Replace
the binary or image with the normal procedure (`CREW_REPLACE_VERSION=0.12.1` for the
installer, or the 0.12.x release you run) and upgrade paired clients with the server. A
client and server must report the same release. From 0.11.x, first follow the 0.12.0
steps below.

## Crew 0.12.0 to 0.12.1

No data migration, protocol change or operator step, and no new managed block. Replace
the binary or image with the normal procedure (`CREW_REPLACE_VERSION=0.12.0` for the
installer) and upgrade paired clients with the server. A client and server must report
the same release.

## Crew 0.11.1 to 0.12.0

No schema or data format change and no protocol version change. One migration installs a
managed dispatcher instruction revision. It keeps the dispatcher, dispatch mode, mappings,
encrypted credentials and history, saves the previous instruction text, moves Ready tasks
to a new wake generation and pauses delivery. Take a complete stopped backup, including
the private webhook key, then replace the binary or image with the normal procedure
(`CREW_REPLACE_VERSION=0.11.1` for the installer). Upgrade paired clients with the server.
A client and server must report the same release.

After starting 0.12.0:

1. Run `skill` to install the updated guidance, including the new Authorization rules.
   Refresh MCP connector tool schemas, and have agents read `capabilities` again:
   `capabilities_digest` changes because `review.decide` and `execution.recover` are now
   available to work clients.
2. If webhooks are configured, apply the new managed block to the dispatcher routine,
   keeping role and reporting text, and report synchronization once. Then run the
   connection test and re-enable delivery. Enabling sends no backlog, so set a task
   Waiting and then Ready to wake it again.

Rollback requires the complete pre-upgrade backup with the 0.11.1 binary or image,
because an older binary must not open the migrated database.

## Crew 0.11.0 to 0.11.1

No data migration, protocol change or operator step. Replace the binary or image with
the normal procedure (`CREW_REPLACE_VERSION=0.11.0` for the installer) and upgrade
paired clients with the server. A client and server must report the same release.

## Crew 0.10.0 to 0.11.0

No data migration, protocol change or operator step. Replace the binary or image with
the normal procedure (`CREW_REPLACE_VERSION=0.10.0` for the installer) and upgrade
paired clients with the server. A client and server must report the same release. The
skill and `capabilities_digest` are unchanged, so no `skill` run or routine reread is needed.

## Crew 0.9.3 to 0.10.0

No data migration, protocol change or operator step. Replace the binary or image with
the normal procedure (`CREW_REPLACE_VERSION=0.9.3` for the installer) and upgrade
paired clients with the server, then run `skill` to install the updated guidance. A
client and server must report the same release. `capabilities_digest` changes, so webhook
routines reread capabilities once.

## Crew 0.9.2 to 0.9.3

No data migration, protocol change or operator step. Replace the binary or image with
the normal procedure (`CREW_REPLACE_VERSION=0.9.2` for the installer) and upgrade
paired clients with the server. A client and server must report the same release. Task
writes now accept an agent name for `assigned_agent`, and an unknown value returns 400
instead of 404.

## Crew 0.9.1 to 0.9.2

No data migration, protocol change or operator step. Replace the binary or image with
the normal procedure (`CREW_REPLACE_VERSION=0.9.1` for the installer) and upgrade
paired clients with the server, then run `skill` to install the updated guidance. A
client and server must report the same release.

## Crew 0.9.0 to 0.9.1

No data migration, protocol change or operator step. Replace the binary or image with
the normal procedure (`CREW_REPLACE_VERSION=0.9.0` for the installer) and upgrade
paired clients with the server, then run `skill` to install the updated guidance. A
client and server must report the same release.

## Crew 0.8.x to 0.9.0 (agent runbook)

No data migration. The database, `pocketcontext.json`, `storage/`, `legacy-knowledge/`
and the private cache are unchanged. New: skill directory `pocketcontext-crew`, registry
`<config>/pocketcontext-crew/`, default port 8099 for new projects only (saved ports stay).

Work one computer at a time and do not reorder: **stop, confirm flush, back up, upgrade,
verify.** Never run `init` on an existing project. Never put passwords, tokens or local
keys in chat. Keep `crew-webhook.key` in the cache: do not delete the cache to troubleshoot.

1. Inventory (read-only): record the executable path and `--version`, each project's
   `status --db DB`, paired clients and any service manager that owns the server. Stage
   the new release outside the synced folder, verify its checksums and run
   `pocketcontext-crew upgrade-check --db DB --from 0.8.0 --inventory`.
2. Order: stop each paired client's forward first but upgrade clients after the server;
   a client and server must report the same release.
3. Stop with the old binary (`tunnel stop --url URL`, then `stop --db DB`) or the owning
   service manager. Do not kill the process; the final write-back happens on the graceful
   path. Never use `--take-over` to work around this.
4. Confirm flush: `pocketcontext-crew upgrade-check --db DB --from 0.8.0` must report
   `ready`, and the sync client must be idle. If a block reports unsaved changes, start
   once with the old binary and stop it; if it reports a conflict, follow `recover`.
5. Back up the complete stopped project to a separate destination outside the synced
   folder: `pocketcontext.db`, `pocketcontext.json`, `storage/`, `legacy-knowledge/` and
   the matching binary. Record the database checksum. Never copy cache working files,
   tokens or local keys.
6. Upgrade: `CREW_REPLACE_VERSION=0.8.0 sh install.sh /absolute/project` (PowerShell:
   set `CREW_INSTALL_DIR` and `CREW_REPLACE_VERSION`). The installer refuses a folder with
   a database and no Crew executable. Then `ensure-running --db DB` and
   `skill --db DB`.
7. Verify: `upgrade-check` is ready; `status` shows the same instance and port; `whoami`;
   `read '{"collection":"notes"}' --db DB` returns a known note; the reader opens.
8. Paired clients, after the server verifies: upgrade, `tunnel forward --url URL
   --background`, `skill --url URL`, `whoami --url URL`. Do not rotate the tunnel address.
9. Clean-up: remove the old `~/.claude/skills/pocketcontext` (and Codex/Antigravity
   equivalents) only after PocketContext Atlas has also moved on that computer; other
   products may still rely on it.

Rollback before any write through 0.9.0: stop it, restore the old binary and start. After
writes: stop, restore the complete backup with its matching binary, verify identity before
any write. Never force an older release past a refused database.

**Hosted instances.** No operator step changes. Delivery is the normal path: the workflow
sends the immutable digest to the restricted deploy command, `pocketcontext-container
prepare-upgrade` runs in the old container and verifies a complete backup, stop-first
replacement then updates the same ONCE application in place with `once update` on its
existing volume (no restore and no new volume). The image still ships
`pocketcontext-container`, `/storage`, `pocketcontext.db`, `pocketcontext.json`,
`POCKETCONTEXT_*`, the backup format and `/up`.

## Crew 0.2.0 standalone migration

This release removes inherited PocketContext knowledge collections and exposes
only Crew memory, tasks and review. It preserves all Crew records, IDs, revisions,
relationships and history. Fresh installations contain no spaces or knowledge tables.

Before migration, the application works on its locked private database copy. If
legacy knowledge exists, it writes and verifies a private archive at
`legacy-knowledge/<database-sha256>/` beside the project database. The archive holds
`pocketcontext.db`, `pocketcontext.json`, original `storage/` files and a manifest
with file hashes and legacy table digests. `legacy-knowledge/current.json` identifies
the archive. Missing/corrupt evidence fails the upgrade before collection removal.
These archives are never served by the reader or MCP. Keep them in complete backups.

Always preserve a complete stopped pre-upgrade backup and its matching release.
An archive preserves the old schema and evidence; the complete hosted backup also
preserves private runtime state needed for operational recovery. Neither is a
reason to copy an open database. Native project backups include database, config,
storage, legacy-knowledge and the matching binary. Hosted preparation performs and
remotely verifies a complete backup before replacement.

## Release procedure

1. Verify the running release, instance identity and latest complete backup.
2. Rehearse upgrade on an isolated restored copy, including Crew history comparisons,
   archive hashes, restarted reads/writes and backup/restore. Never use production
   credentials or outbound integrations in a rehearsal process.
3. Stop the old writer through its supervisor. Hosted CI uses prepare-upgrade and
   stop-first replacement on the original volume; do not start a second writer.
4. Start the new release, verify authenticated Crew operations and MCP discovery,
   and confirm the reader and backup service. Refresh installed skills and clients.

Pushes to main automatically run checks, publish an immutable image and deploy
the enrolled instance. The production-data migration rehearsal must pass before
that push. See [hosting](hosting.md) for CI enrollment and pause controls.

## Rollback

Stop the new release. Preserve any later Crew work separately. Restore the complete
pre-upgrade backup with its exact matching binary/image, then verify history and
identity before writes. An older binary must not open the migrated database;
binary-only downgrade is unsupported. Never reverse migrations or purge history.

Maintain one writer per project. Remote clients, managed forwards and local servers
must use compatible releases. Preserve domain, certificate cache, tunnel identity
and registered project identity through upgrades; never silently adopt another
instance or choose a conflicting sync copy.

A private database anchor binds the required archive and manifest hash. After
conversion, startup and backups reject a missing archive, changed manifest or
corrupt file. Archive publication flushes files and directory metadata before
schema retirement; interrupted preparation is cleaned under the writer lock.

## Crew 0.4.1 dispatcher migration

Take the complete stopped backup described above, including the private webhook
key. Existing per-agent webhook configurations and delivery history are retained,
but old configurations are disabled and pending work is invalidated. A new global
integration starts disabled. Select an existing dispatcher bot, map recipients,
apply routine instructions and enter the URL/key manually in the owner browser.
No endpoint is silently adopted and no backlog is sent. Explicit test/enable and
optional catch-up follow configuration. Do not roll back only the binary after
a schema migration; use the matching complete backup if rollback is required.

## Crew 0.5.0 managed setup migration

The migration retains the existing dispatcher, mappings, encrypted credentials
and histories. It replaces the old unstructured instructions with protocol 2's
managed block, preserves the prior instruction text for inspection, invalidates
in-flight eligibility and pauses delivery. No tests or tasks are sent on upgrade.
Apply the current managed block and run the explicit safe connection test before
re-enabling. Existing webhook-governed tasks remain subject to execution fencing;
the owner can set Waiting explicitly to release a task for ordinary MCP edits.
Older connector schemas can discover and use `data._crew` through capabilities;
refreshing the client's tool schema remains recommended.

## Crew 0.6.0 parent bridge migration

Take a complete stopped backup, including the private webhook key. The migration
retains the dispatcher, mappings, credentials and history, preserves the previous
instruction text, installs protocol 3, invalidates old work generations and pauses
delivery. Existing integrations retain native mode; select parent_bridge explicitly
for a routine that uses WakeParent. Switching dispatch mode preserves credentials
but requires synchronization and new diagnostic evidence.

Apply the current managed block to the existing routine and remove retired Crew
probe overrides, preserving normal role and reporting settings. Authorize the bots
to use the intended instance before testing. Run an explicit connection test to a
mapped teammate; parent receipt and an automatic recipient acknowledgment are
required when other mapped bots exist. Then enable delivery and validate explicitly
authorized synthetic Ready tasks. Enabling sends no backlog. Native tool-approval
settings belong to the harness and may still interrupt execution.

Uncertain wakes or sends must be reconciled before a fresh attempt. If a parent
wake stopped before an execution record exists, the owner can explicitly move the
task Waiting then Ready after reconciliation to create a new generation. Do not
replay the old bridge event. Update installed skills with the release so their
webhook instructions match protocol 3.

## Crew 0.7.0 comment wakes and compact instructions

Take a complete stopped backup, including the private webhook key, and keep the
matching 0.6.0 release for rollback. Three migrations run in order:

1. Task fields for owner-comment wakes and the bot handoff limit, with
   `max_bot_handoffs` set to 4. Subscriptions are unchanged, so `comment` stays
   opt-in. This step sends nothing and leaves work, generations and delivery as
   they were.
2. A compact managed block as a new instruction revision (protocol 3 wire format
   unchanged).
3. One more instruction revision with two retrieval rules: protocol steps never
   use search, schema or SQL, and task work reads compactly.

Steps 2 and 3 behave like earlier instruction upgrades: they retain the
dispatcher, dispatch mode, mappings, encrypted credentials and histories,
preserve the previous instruction text, invalidate old work generations and pause
delivery. No tests or tasks are sent. After the upgrade delivery is paused at the
latest instruction revision, and the routine is synchronized once, to that block.

After starting 0.7.0:

1. Verify authenticated Crew operations and MCP discovery; refresh connector tool
   schemas so clients see `crew_search`, `crew_schema` and `crew_query`.
2. Apply the current managed block to the existing routine, preserving role and
   reporting text, and report synchronization once.
3. Run an explicit connection test, with a mapped teammate in parent_bridge mode.
4. Re-enable delivery. Enabling sends no backlog; set a task Waiting and then Ready
   to wake it again.
5. Optionally opt in to the `comment` subscription so owner browser comments wake
   the assignee. Any integration, subscription or credential change, including
   this one, pauses delivery, moves Ready tasks to a new generation and fences
   in-flight work for the old one. Make the change between runs, then re-enable.
6. Optionally adjust `max_bot_handoffs` (owner only, 1-20).
7. Update installed skills with the release.

Rollback requires the complete pre-upgrade backup with the 0.6.0 binary or image;
an older binary must not open the migrated database.

## Crew 0.7.1 client invitation fix

No migrations. Take the usual complete stopped backup, replace the 0.7.0 binary or
image with 0.7.1 and verify authenticated Crew operations. Invitations generated
by 0.7.0 pointed at a nonexistent release; after the host runs 0.7.1, issue a
fresh `tunnel invite` to any client whose setup failed. Upgrade connected clients
to 0.7.1 so client and server releases match. Rolling back to the 0.7.0 binary
needs no database restore.

## Crew 0.8.0 agent commands

No migrations. Take the usual complete stopped backup, stop the server, replace
the 0.7.1 binary or image with 0.8.0 and verify authenticated Crew operations.
Then refresh each profile's skill on every computer that has one, with `skill`
(`--db` on the host, `--url` on paired computers): until then `profile check`
reports that the binary changed from 0.7.1 to 0.8.0, and agents keep the old
skill text without the `read`, `search`, `schema`, `query` and `write` commands.
Upgrade paired clients to 0.8.0 so client and server releases match.

Rolling back to the 0.7.1 binary needs no database restore. A synthetic native
rehearsal (0.7.1 project, upgrade, CLI write, stop, 0.7.1 again) showed 0.7.1
starting on the database and reading records written by 0.8.0; run `skill`
again after rolling back so profiles and skills match 0.7.1, which has no CLI
work commands.
