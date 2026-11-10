# PocketContext Crew

Single-owner shared memory, tasks and human review, derived from PocketContext.
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
  operation except `webhook.credentials.update`: webhook URL/credentials are
  owner-browser-only and never returned by reads. Keep that 403 before
  idempotency replay and keep `/api/crew/write` off the MCP proxy allowlist.
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
  Reported names are not identity. No local MCP or unauthenticated endpoints.
- External platforms run agents. Crew never posts, sends or pays.
- Keep runtime credentials and OAuth state private and out of Git and knowledge.
- Tests: build ui/dist first; pnpm test/build in ui; CGO_ENABLED=1 go test with
  build-tags.txt; tests/crew_e2e.py, tests/upgrades.py, tests/upgrades_0_8.py and tests/e2e.py with built binary.
  Shared server code lives in pocketcontext-core (tagged release in go.mod; no replace); Crew's identity and public route allowlist live in internal/crewpolicy and the golden table in internal/appconfig/testdata must not change without review.
  Preserve Windows support. Hosted releases require image lifecycle and populated
  backup/restore gates before deployment. Deploy the exact tested OCI digest;
  a desired `:latest` reference must resolve to a digest before replacement.
- No databases, generated ui/dist, bin, credentials or user data in commits.
- Historical upstream docs (docs/releases/upstream/, docs/release-validation-*)
  describe inherited infrastructure, not a Crew release.

- Crew has no spaces or inherited knowledge APIs. Upgrades must verify a private
  legacy-knowledge archive before retiring populated knowledge collections.
  Production-data rehearsals require explicit authorization and isolated copies;
  never commit their data or use them as test fixtures.
