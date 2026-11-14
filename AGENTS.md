# PocketContext Crew

Single-owner notes, tasks and human review, derived from PocketContext.
Read README.md, docs/crew.md and docs/hosting.md before relevant changes.

- Work on main when authorized. Keep all records synthetic in tests.
- Preserve the inherited single-writer, private working copy, atomic snapshot and
  complete-backup contracts. Never open a synced database directly.
- Auth stays on. Default users is the sole auth collection; crew_agents is role
  metadata, never credentials. Buckets are not security boundaries.
- All Crew mutations use revision-checked custom operations. Generic REST/batch
  writes remain disabled. History is immutable. Archive, never purge.
- MCP and the CLI work commands use only the work-client route
  (`/api/crew/agent-write`). It accepts every reader (`/api/crew/write`)
  operation except `webhook.credentials.update`, `upload_link.create` and
  `artifact.publish`/`artifact.replace`/`artifact.revoke`/
  `artifact.set_expiry`/`artifact.archive`/`artifact.restore`: webhook
  URL/credentials, upload links and publishing artifacts are owner-browser-only
  (bots draft artifacts, the owner publishes), and reads never return
  credentials, link tokens or artifact tokens. Keep those 403s before idempotency
  replay and keep `/api/crew/write` off the MCP proxy allowlist.
  Authorization for everything else is owner-editable default rules in the skill
  and MCP instructions; attribution (`actor`, `reported_agent`) is audit only,
  never a gate. No per-bot tokens or policy engine. Loop prevention stays on the
  route split: work-client comments never wake, work-client reassignments count
  toward max_bot_handoffs, reader writes reset it. MCP exposes no local keys,
  general host administration, shell, arbitrary host paths or network fetching.
- Owner tokens must not be shared with MCP or hosted agents. Scoped exception: on
  installs without a domain, CLI agents act with owner authority (local key on
  the host, saved session token on tunnel-paired computers); only the skill keeps
  them off the reader route and webhook credentials. Docs and skill say so plainly.
  Reported names are not identity. No local MCP or unauthenticated endpoints,
  with two scoped exceptions: one-time upload links (`/api/crew/upload-link/*`)
  add files to their one task or note; token hash only, upload only, expiring,
  single batch, revocable, rate-limited, never readable. Published artifact
  pages (`/a/<token>`, `/a/<token>/files/<n>`) are read-only frozen snapshots
  the owner published: 32-character random token, the same plain 404 for
  unknown, revoked, expired and archived tokens, rate-limited, no script, no links into Crew,
  noindex/no-referrer/no-store; images only from the published list.
- Attachments are immutable protected files under storage/. Archive, never
  purge; only `/api/crew/attachment` (signed in) serves bytes, with nosniff and
  a download disposition for every non-image. One exception: the HTML/SVG
  preview (`?preview=`, a 5-minute token signed for one attachment by
  `POST /api/crew/attachment-preview`) is served inline only inside a CSP
  sandbox (`allow-scripts`, no same-origin, no network, no forms,
  `frame-ancestors 'self'`) and framed by the reader with `sandbox="allow-scripts"`
  only; never widen that sandbox; work clients get bounded reads
  from `/api/crew/attachment-read`, never URLs or storage names.
- External platforms run agents. Crew never posts, sends or pays.
- Keep runtime credentials and OAuth state private and out of Git and knowledge.
- Tests: build ui/dist first; pnpm test/build in ui; CGO_ENABLED=1 go test with
  build-tags.txt; tests/crew_e2e.py, tests/upgrades.py, tests/upgrades_0_8.py, tests/e2e.py and tests/crew_browser.py (Playwright Chromium; the hosted image build runs it) with built binary.
  Shared server code lives in pocketcontext-core (tagged release in go.mod; no replace); Crew's identity and public route allowlist live in internal/crewpolicy and the golden table in internal/appconfig/testdata must not change without review.
  Preserve Windows support. Hosted releases require image lifecycle and populated
  backup/restore gates before deployment. Deploy the exact tested OCI digest;
  a desired `:latest` reference must resolve to a digest before replacement.
- No databases, generated ui/dist, bin, credentials or user data in commits.
- A release adds `docs/releases/<version>.md`, one line at the top of
  `CHANGELOG.md` and the pinned release link in README.md's "Shipped in the open".
- Historical upstream docs (docs/releases/upstream/, docs/release-validation-*)
  describe inherited infrastructure, not a Crew release.

- Crew has no spaces or inherited knowledge APIs. Upgrades must verify a private
  legacy-knowledge archive before retiring populated knowledge collections.
  Production-data rehearsals require explicit authorization and isolated copies;
  never commit their data or use them as test fixtures.
