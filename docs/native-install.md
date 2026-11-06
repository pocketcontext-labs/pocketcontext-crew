# Install Crew as a native Linux service

The recommended first path is a dedicated Linux AMD64 or ARM64 server with
systemd, one Crew binary, native HTTPS and authenticated MCP. Docker remains an
[alternative](install.md) with email sign-in and integrated S3 backups. Native
Crew uses a password or an owner-generated reader sign-in link; it needs no SMTP.
The binary does not run your agents. A laptop-only install does not provide a
public remote MCP endpoint.

## Prerequisites and release

Use an existing server you may administer, Python **3.11+** for the backup helper,
systemd 243+, and a domain with working A/AAAA records pointing directly to it.
Inbound TCP 80/443 must be available and reachable; native HTTPS owns both ports.
Check conflicts, firewall, IPv6 routing, DNS and available disk first. Do not
replace existing services or assume a server behind CGNAT is reachable. Agree on
costs before provisioning new resources. The native server obtains and renews
Let's Encrypt certificates; `--domain` accepts its subscriber agreement.

Install only Crew **v0.1.0**, from
<https://github.com/pocketcontext-labs/pocketcontext-crew/releases/tag/v0.1.0>.
Download `install.sh` and `checksums.txt` from that release, verify the installer's
SHA-256 against the manifest, inspect it, then run it with the new absolute project
directory. The installer verifies the selected archive and installs
`pocketcontext-crew`; do not use PocketContext's installers. Keep the release
manifest and source revision with your operating notes. Do not substitute `latest`.
The executable currently reports the compatibility prefix `pocketcontext` in
`--version`; require version `0.1.0` and the release's source revision.

```sh
sh /private/downloads/install.sh /var/lib/pocketcontext-crew/project
/var/lib/pocketcontext-crew/project/pocketcontext-crew --version
```

The paths below are a complete example, not a compulsory default. Choose a fresh
project directory and dedicated unprivileged OS account. Adapt all units and
commands together. Never share a database, home/cache or service name with another
PocketContext/Crew installation. Copy `deploy/native/` from the same reviewed
release source. No helper is downloaded from mutable main at execution time.

## Initialize and configure the service

Create the dedicated `pocketcontext-crew` account with home
`/var/lib/pocketcontext-crew`, no interactive shell, and a private project directory
owned by that account. Install the binary as that account. Keep project and home
mode 700; do not run the application as root. Run initialization and later local
administration under this same account and HOME, so the private cache stays stable.

Initialize once with an owner-chosen password supplied through protected stdin:

```sh
sudo -u pocketcontext-crew -H /var/lib/pocketcontext-crew/project/pocketcontext-crew init --name Crew --password-stdin --db /var/lib/pocketcontext-crew/project/pocketcontext.db
sudo -u pocketcontext-crew -H /var/lib/pocketcontext-crew/project/pocketcontext-crew stop --db /var/lib/pocketcontext-crew/project/pocketcontext.db
```

The first command consumes the password from stdin; obtain it through a private
local mechanism, never a command argument, chat transcript or committed file.
Alternatively generate it in memory, submit it through stdin and store it in an
owner-authorized password manager. Initialization starts a background server;
require exit status 0 from the clean stop before handing ownership to systemd. If interrupted,
inspect the project and running processes; never reinitialize an existing project.

Edit `pocketcontext-crew.service` from `deploy/native/`: replace `crew.example.com`,
and adapt its user/home/project paths. Install it root-owned in
`/etc/systemd/system/`. It grants the unprivileged process only permission to bind
privileged ports, keeps one writer and allows 300 seconds for clean shutdown.

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now pocketcontext-crew.service
sudo systemctl status pocketcontext-crew.service
```

Verify `https://YOUR_HOST/` with valid public TLS from outside the server. Native
mode has no public `/up` endpoint. `/api/bundle/auth-mode` must show password mode;
unauthenticated `/mcp` and POST `/api/crew/read` must refuse records. Preserve
`--mcp` in the service command. Public HTTPS never provides local administration.

Have the owner sign in with their password, or issue a fresh short-lived link:

```sh
sudo -u pocketcontext-crew -H /var/lib/pocketcontext-crew/project/pocketcontext-crew open --public --db /var/lib/pocketcontext-crew/project/pocketcontext.db
```

Show that link only to the requesting owner; it grants access and expires quickly.
Do not put it in logs, source control, a public page or another agent's prompt.
Confirm actual owner browser access. Add `https://YOUR_HOST/mcp` in the chosen
assistant and approve OAuth in the same signed-in browser. Verify `crew_read` and
`crew_write` with a synthetic note, an edit and a task. Never share an owner token
with an agent. Keep the synthetic note ID and expected revision count for restore.

## Install daily stopped-project backups

Install `backup.py` and `service-control.py` root-owned, mode 755 in
`/usr/local/lib/pocketcontext-crew/`. Create a private destination such as
`/var/backups/pocketcontext-crew`, mode 700 and owned by the Crew account. It must be
outside the project and preferably on independently recoverable storage. Adapt the
backup service and timer consistently and install them root-owned under
`/etc/systemd/system/`. Do not grant the application account general sudo access.

The service checks whether Crew is active, stops it cleanly and copies as the
unprivileged owner. It rejects an unclean exit, links/special files, corrupt SQLite,
missing/corrupt source originals or changed copied files. A completed private
snapshot contains `project/` (database, settings, storage and matching binary) and
`manifest.json` with SHA-256 hashes. A failed copy does not publish a completed
snapshot. It attempts to restart the previously active service even after a copy
failure/timeout; a restart failure is a failed backup job and needs operator action.
An already-stopped Crew service is skipped, not started. Never run another writer
or manual start during this backup window.

```sh
sudo systemctl daemon-reload
sudo systemctl start pocketcontext-crew-backup.service
sudo systemctl status pocketcontext-crew-backup.service
sudo systemctl is-active pocketcontext-crew.service
sudo systemctl enable --now pocketcontext-crew-backup.timer
sudo systemctl list-timers pocketcontext-crew-backup.timer
```

Check the successful backup receipt and verify its recorded path:

```sh
sudo -u pocketcontext-crew -H python3 /usr/local/lib/pocketcontext-crew/backup.py --verify /var/backups/pocketcontext-crew/SNAPSHOT
```

Daily snapshots briefly interrupt service and may lose up to a day of writes.
**All completed snapshots are retained**; no automatic deletion is configured.
Monitor disk space and backup job failures, agree a retention policy, and remove
older snapshots only after verifying newer independent copies. A backup on the
same disk does not protect against disk/server loss. Configure and verify a
private off-host copy or independently recoverable backup mount before claiming
host-loss recovery; S3 is optional. Keep backup contents and credentials private.

These are native **project** backups. They intentionally exclude machine-local
OAuth grants, local access keys, profiles, certificates and private working caches.
A restored server needs a fresh runtime home/cache, certificates and OAuth consent.
Owner credentials and records remain in the database; do not claim that all old
browser sessions are revoked. Handle a compromised-account restore separately.

## Restore rehearsal and recovery

Before maintenance or restoration, stop the backup timer, wait for any active
backup job to finish, then stop Crew cleanly. Do not race the backup service's
conditional restart. Keep the original project and private cache intact.

Verify the snapshot, copy its `project/` to a **new absent directory**, and use the
matching binary. Never overlay a running project, copy a live private working
SQLite file or overwrite the old project. Use a separate dedicated runtime account
and home/cache for a rehearsal. Inspect synthetic note/history counts only while
the restored database is stopped, or start it isolated on loopback without
`--domain`/`--mcp`; never expose a duplicate service on the production domain.

For example, after copying a verified snapshot to `/private/rehearsal/project`,
run under a separate rehearsal account with its own HOME:

```sh
/private/rehearsal/project/pocketcontext-crew serve --tcp-only --port 18096 --db /private/rehearsal/project/pocketcontext.db
```

Use the owner's password privately in a reachable loopback browser, verify the
synthetic note, revision history and task, then cleanly stop the rehearsal. This
checks data/password recovery, not public certificate issuance or MCP consent.
For a real cutover, fence the original writer first, adapt the production service
to the restored directory/runtime account, establish native HTTPS, reauthorize
MCP clients, verify the owner data and take a new verified backup. Only then
re-enable the backup timer. Never downgrade a database with an older binary.

## Upgrades and interrupted setup

The installer refuses existing executables unless explicit replacement names the
observed old version. Before replacement, stop the timer, complete a verified
backup, stop Crew and preserve its old project/binary. Install an explicitly
selected Crew release, verify version and source revision, then start and check
owner data, HTTPS and MCP. Refresh the backup configuration if paths change.
There are no automatic binary upgrades. A certificate failure is not a reason to
reset or reinitialize data; check DNS, firewall, permissions and stable private
cache. Partial initialization requires diagnosis, not deletion and retry.

## Validation scope

`tests/native_backup_test.py` covers corruption, tampering, failed copies,
symlinks, destination safety and changed input. `tests/native_install.py` exercises
real Crew operations, clean stop, snapshot verification, fresh-cache restoration,
password sign-in and retained immutable history. Public DNS/Let's Encrypt issuance,
a physical owner's browser and a third-party MCP client must be confirmed for each
installation; synthetic checks do not establish these outcomes.

Validation on 2026-11-06: the native binary rehearsal passed with synthetic Crew
records and a fresh runtime cache. The disposable real-systemd harness
`tests/native_systemd.py` passed active-service stop/copy/restart, a deliberately
failed copy with service recovery, and skipping a manually stopped service. It
used unique temporary units and no public ports; production services were untouched.
