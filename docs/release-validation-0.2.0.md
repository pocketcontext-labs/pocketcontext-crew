# Crew 0.2.0 validation

## Migration gates

- Synthetic populated Crew 0.1.1 upgrade preserves all Crew rows, revisions and
  history while archiving inherited text/binary sources and original files.
- Archive files, table contents and original hashes are verified before schema
  retirement. A transactional database anchor requires the same archive and
  manifest on subsequent startup and backup.
- Missing/corrupt archives, config, pointers, targets, unexpected files and
  symlinks fail closed. Interrupted preparation can be retried safely.
- Restart, complete migrated backup/restore, older-binary refusal and rollback
  using a complete original backup and its matching release are covered.
- An explicitly authorized rehearsal used a fresh, checksum-verified production
  backup on an isolated copy. All Crew rows/history were compared before and
  after migration. No production records are included in tests or this report.
  MCP tool discovery/assignment and authenticated browser responsibility controls
  passed against the migrated copy through an isolated internal Docker network.
  Private receipts and detailed results remain with the operator.

## Application and platform gates

The repository runs Go unit/integration tests, UI typecheck/tests/build, API and
MCP assignment round-trips, revision conflict and authority-boundary checks,
authenticated browser workflows, connection/session lifecycle, installer guards,
native backup and release packaging checks. Hosted gates additionally run actual
container lifecycle/isolation and populated HTTPS S3 backup/disaster restoration.
CI runs native Linux AMD64/ARM64, Windows and macOS before publishing the image.

MCP discovery exposes only crew_read and crew_write. Bucket ownership is behavioral;
review decisions, bucket archival and agent deactivation remain owner-only.

Production deployment is triggered by main, after CI passes, and uses the exact
published immutable digest. Public readiness alone does not prove email inbox
receipt or a third-party assistant's interactive consent; no such claim is made.
