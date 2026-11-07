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
- MCP uses only the agent-write route. Shared MCP may configure and activate
  per-agent HTTPS webhooks through the revision-checked Crew operations. This
  narrow exception does not expose owner decisions, local keys, general host
  administration, shell, arbitrary host paths or network fetching through MCP.
  Webhook credentials are write-only; agent names remain reported attribution.
- Owner tokens must not be shared with agents. Reported names are not identity.
- External platforms run agents. Crew never posts, sends or pays.
- Keep runtime credentials and OAuth state private and out of Git and knowledge.
- Tests: build ui/dist first; pnpm test/build in ui; CGO_ENABLED=1 go test with
  build-tags.txt; tests/crew_e2e.py, tests/upgrades.py and tests/e2e.py with built binary.
  Preserve Windows support. Hosted releases require image lifecycle and populated
  backup/restore gates before deployment. Deploy the exact tested OCI digest;
  a desired `:latest` reference must resolve to a digest before replacement.
- No databases, generated ui/dist, bin, credentials or user data in commits.
- Historical upstream docs describe inherited infrastructure, not a Crew release.

- Crew has no spaces or inherited knowledge APIs. Upgrades must verify a private
  legacy-knowledge archive before retiring populated knowledge collections.
  Production-data rehearsals require explicit authorization and isolated copies;
  never commit their data or use them as test fixtures.
