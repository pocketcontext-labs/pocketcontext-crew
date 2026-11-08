# Crew upgrades and rollback

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
