# Install PocketContext Crew with Docker Compose

For the recommended lightweight service, see [native binary installation](native-install.md).
Choose this Docker path when you want its packaged email login and S3 backups.

This guide installs one person's private Crew workspace on a Linux server using
Docker Compose and Caddy. It needs no PocketDeploy account or private repository.
It is a fresh installation procedure, not an upgrade or a migration from
PocketContext. Crew is self-hosted software, not a public registration service.

## What you need

- A Linux AMD64 or ARM64 server you administer, Docker Engine and Compose **2.30+**.
- A domain/subdomain with DNS A (and, if used, AAAA) records pointing to that server.
  Ports 80 and 443 must be reachable and unused by another service. Do not
  replace an existing web service or upgrade Docker without operator authorization. This guide uses
  direct DNS, without a CDN proxy. Keep SSH access restricted appropriately.
- One owner email. Only that address can sign in; no additional accounts are created.
- SMTP delivery credentials and a verified sending domain/address. Disable click
  and open tracking for login emails. Use a sending-only key where supported.
- A dedicated **private** S3-compatible bucket, HTTPS endpoint and scoped credentials
  allowing list/read/write/delete in that bucket. Crew makes and verifies complete
  daily backups, and retains its own archives for 30 days. Backups contain private
  data and authorization state; keep bucket credentials and archives confidential.

Server, domain, mail and storage may incur provider charges. Agree on the provider,
resources and cost before provisioning anything new. Reuse infrastructure only
when its owner has authorized that use. This guide does not choose paid resources.

## Prepare an independent installation directory

Use a reviewed checkout of this repository at an exact commit, then copy the five
files from `deploy/compose/` into a new private installation directory outside Git:
`compose.yaml`, `compose.init.yaml`, `Caddyfile`, `.env.example`, `crew.env.example`.
Record the source commit beside your private operating notes. Do not use inherited
PocketContext install scripts or release assets: they install a different product.

The template pins Crew to the tested multi-platform image:

```
ghcr.io/pocketcontext-labs/pocketcontext-crew@sha256:cf8b485bf331d68687770fe3d07c62b571f9e997a2dbec28961981d533bb19ad
```

Its application source revision is `2c95a8cd2053480b2a5de98b0ed4c6b5ef5da199`.
Caddy is separately pinned in the template. Do not substitute `latest`.

From the installation directory:

```sh
chmod 700 .
umask 077
cp .env.example .env
cp crew.env.example crew.env
chmod 600 .env crew.env
```

Set a unique, stable `COMPOSE_PROJECT_NAME` and your hostname in `.env`. Fill
`crew.env` privately with your owner email, SMTP and S3 configuration. This file
uses Compose's raw format: write literal unquoted values; dollar signs are not
expanded. Do not paste secrets into chat, commit them, print `docker inspect`, or
print a fully expanded `docker compose config`. Use `docker compose config --quiet`
for validation. Do not add an init override to the environment file.

Check the selected Docker daemon and existing containers/volumes before creating
anything. The project name scopes the volumes; do not reuse a project name or
volume from any existing installation. Keep this name and directory stable.

```sh
docker compose version
docker compose config --quiet
docker compose pull
```

## Initialize once, then start normally

Start only Crew, with the explicit initialization override. No public proxy is
started yet. Initialization is a running server, not a command that exits on success.

```sh
docker compose -f compose.yaml -f compose.init.yaml up -d --wait --wait-timeout 120 crew
docker compose -f compose.yaml -f compose.init.yaml stop crew
```

Confirm the stopped container exited cleanly, without printing its environment:

```sh
docker inspect --format '{{.State.ExitCode}}' "$(docker compose ps -a -q crew)"
```

Require exit code `0`. Then use only the base file. The same project keeps the
same `crew_data` volume; Compose replaces the stopped init container with normal
serve mode. Never run both writers at the same time.

```sh
docker compose up -d --wait --wait-timeout 120
```

Caddy obtains and renews the hostname's HTTPS certificate. Its certificate state
has persistent volumes. Only Caddy publishes host ports; Crew's port 80 stays on
the private Docker network. Do not publish Crew directly or mount the Docker socket.

## Verify before handing over

1. Open `https://YOUR_HOST/up`: expect HTTP 200 with a valid public certificate.
2. Open `https://YOUR_HOST/`: expect the Crew sign-in screen. Confirm
   `/api/bundle/auth-mode` returns email mode, and anonymous requests to `/mcp`
   and `POST /api/crew/read` are denied (401/403). The public reader must not
   expose records before login.
3. Have the owner request a login email and confirm successful sign-in. SMTP
   authentication alone does not prove inbox delivery. An agent must not copy
   the owner's login tokens into another assistant.
4. Add `https://YOUR_HOST/mcp` in the chosen MCP client and approve OAuth consent
   in the owner's signed-in browser. Verify the client sees `crew_read` and
   `crew_write`. An actual client connection is required before claiming it works.
5. Optionally use **Set up starter crew** in the UI. External agents run the jobs;
   Crew stores notes, tasks and review decisions. Approval does not post,
   send or pay, and bucket responsibility is behavioral rather than isolation.
6. Create a synthetic note in the UI, edit it once, and record its note ID and
   revision count for the restore rehearsal. Run a complete backup and retain its
   successful receipt and exact object key:

   ```sh
   docker compose exec -T crew pocketcontext-container backup
   ```

   Success includes remote download and checksum verification. Failure means
   backup is not ready; resolve the private bucket permissions/configuration.
7. Restart normally and verify health and the owner's saved data again:

   ```sh
   docker compose restart crew
   docker compose up -d --wait --wait-timeout 120
   ```

Complete the restore rehearsal below before reporting disaster recovery as tested.
Record separately what passed and what still needs owner confirmation. Return the
workspace URL, `/mcp` URL, installation directory, source/image pins, backup location,
and maintenance instructions. Do not return credentials.

## Recover an interrupted installation

- If image pulling or configuration validation failed before init, fix that issue
  and retry; no database has been created by those commands.
- If init started, inspect only container status and sanitized logs. If healthy,
  perform the clean stop and normal serve handover above. Never rerun init blindly.
- If init was interrupted, first stop its container. Preserve its volume and use
  the **same image** in normal serve mode. If the project is absent or incomplete,
  stop and investigate; do not delete files, initialize over them, or create a
  different volume to hide the failure. Escalate uncertain partial initialization
  to the operator with sanitized diagnostics.
- If normal startup or HTTPS fails, preserve all volumes. Check DNS, firewall,
  ports and Caddy logs; do not reset Crew to solve a certificate problem.
- Never run `docker compose down -v`, prune volumes, or use an automatic reset in
  this procedure. A normal `docker compose stop` preserves data.

## Restore rehearsal and disaster recovery

A backup is an archive of the complete project plus private runtime state, not
just SQLite. Keep runtime credentials recoverable separately. The daily schedule
can lose up to one day of writes, and taking the local snapshot briefly pauses
service. See [backup details](hosting.md#complete-backups-and-upgrades).

For a rehearsal, use a **new, never-used** Compose project name, the exact same
image and the successful backup object key. From the installation directory:

```sh
docker compose -p crew-restore-check run --rm --no-deps crew restore EXACT_BACKUP_OBJECT_KEY
```

Replace the example project name with a unique rehearsal name every time. This
runs the restore command without Caddy or published ports and creates its own
empty volume. It validates the remote checksum, archive paths, manifest, SQLite
integrity and original file hashes. It refuses a populated destination. It does
not start a writer or change production traffic. Preserve the successful output.
Before backup, create a synthetic note in the UI, edit it once and record its note
ID and revision count. After restore, verify that note and its immutable revisions
in the stopped destination. The following read-only check prints only counts;
replace `NOTE_ID` with the synthetic note ID. No restored application or network
listener is started, and no SMTP/S3 requests are made by this check:

```sh
docker compose -p crew-restore-check run --rm --no-deps --entrypoint python3 crew -c 'import sqlite3; c=sqlite3.connect("file:/storage/project/pocketcontext.db?mode=ro", uri=True); note="NOTE_ID"; print("note", c.execute("SELECT count(*) FROM crew_notes WHERE id=?", (note,)).fetchone()[0]); print("revisions", c.execute("SELECT count(*) FROM crew_note_revisions WHERE note=?", (note,)).fetchone()[0])'
```

Require one note and the expected revision count. A missing note, revision or
query error is a failed rehearsal, not permission to edit the database. Keep the
restored service stopped throughout this check. Do not start this recovered copy
against production traffic or run two writers against the original volume. Inspect restored application data only in an isolated
rehearsal, with separate backup destination bindings, so it cannot alter production
backup retention. A restore-command check alone does not verify reader/MCP login.

For actual disaster recovery, stop/fence the original writer, preserve the old
volume, restore to a separate empty destination, then start that destination in
normal serve mode. Revalidate HTTPS, owner email sign-in, restored data, OAuth
consent and a fresh backup before accepting recovery. Restored sessions and MCP
credentials are revoked, so clients must reconnect. Never downgrade an image on an
existing database as an improvised rollback. See [disaster restore](hosting.md#disaster-restore).

## Maintenance

Keep a single writer and stable project name. Do not attach one volume to two
running servers. Routine `docker compose up -d` uses the pinned image and performs
no version upgrade. Review release checks before deliberately changing a digest.
For an upgrade, run `docker compose exec -T crew pocketcontext-container prepare-upgrade`,
retain the verified backup receipt, cleanly stop Crew, update the pin, and recreate
it before verifying health and data. Failed preparation must block the upgrade.
Preserve the old volume and follow deliberate restore procedures if recovery is
needed; image rollback is not database rollback. Review server, Docker and Caddy
security updates separately, with backups and a maintenance window.

## Validation scope

The repository's `docker/compose_smoke.py` exercises these exact templates with
synthetic settings on a fresh volume: init, clean handover, restart persistence,
anonymous denial and MCP discovery, plus Caddy configuration and an actual synthetic HTTP proxy
check. `docker/recovery.py` tests populated image
backup/restore against synthetic HTTPS S3. These are not evidence of real SMTP
inbox delivery, a public CA certificate, a particular provider's permissions, or
third-party MCP client login. Verify those for each installation.

References: [Compose service settings](https://docs.docker.com/reference/compose-file/services/)
and [Caddy reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).

Validation on 2026-11-06: the pinned Crew image passed `docker/smoke.py` and
`docker/recovery.py` independently, including populated HTTPS S3 restoration and
old credential revocation. The exact Compose template lifecycle also passed,
including Caddy configuration validation and synthetic HTTP proxy routing. Public
TLS certificate issuance, real inbox delivery and third-party client login were
not exercised by these tests.
