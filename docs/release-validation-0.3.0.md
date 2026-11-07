# Crew 0.3.0 validation

All fixtures use synthetic records and credentials. The release adds explicit
readiness, shared-MCP webhook configuration, transactional wake events and
receiver delivery; it does not certify a real third-party harness integration.

Local validation covers:

- UI typecheck, tests and production build; Chromium smoke of readiness, task
  links and redacted webhook status with a synthetic API.
- Go application tests, real MCP setup/readiness/idempotency operations and
  integrated API/outbox tests for subscriptions, catch-up, triage and stale events.
- Destination filtering, encrypted credentials and missing-key refusal,
  retry/lease/exhaustion behavior, in-flight cancellation and restore epochs.
- Authenticated Crew end-to-end workflows, shared configuration, redacted reads,
  readiness/review generations and restart persistence.
- Upgrade from the published 0.1.1 binary: every old Crew field/history row is
  retained, new task fields default to waiting with no deliveries, legacy archive
  remains verified, downgrade is refused and complete-backup rollback works.
- Native complete snapshot/restore with the narrowly backed-up webhook key,
  epoch rotation, paused delivery and retained idempotency key material.
- Synthetic container backup tests and release assembly tests.

The publication pipelines must additionally pass all platform suites, actual
native container lifecycle and populated HTTPS S3 backup/restore gates before
publishing/delivering the image. Binary release publication requires all four
native platform builds/tests; installed-release checks then exercise published
assets. The website setup prompt must use the resulting exact source and image
pins, never a guessed digest or an unverified release URL.

No production data was used as a test fixture. Public DNS/certificate issuance,
owner inbox delivery and real harness credential provisioning/receiver conformance
are separate integration checks, not established by the synthetic suite.
