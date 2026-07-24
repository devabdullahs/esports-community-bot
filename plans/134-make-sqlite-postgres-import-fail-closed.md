# Plan 134: Make SQLite-to-PostgreSQL imports fail closed

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: Plans 125 and 133
- **Status**: DONE

## Outcome

The one-time SQLite-to-PostgreSQL cutover now aborts rather than reporting
partial success when source or target schemas drift, a selected target contains
rows, an insert conflicts, counts differ, constraints are not validated, or an
identity sequence is unsafe.

## Delivered

- Exact per-table source-to-target mapping with a named legacy
  `post_comments` transformation.
- Source-only `--dry-run` and a separate target-aware
  `--preflight-target` mode.
- Environment-only `DATABASE_URL` handling.
- Access-exclusive target locks and an empty-target requirement.
- Plain inserts with no conflict suppression.
- One copy transaction with source, inserted, and target count equality checks
  before commit.
- Constraint and identity-sequence validation before commit.
- Live disposable-PostgreSQL coverage for clean imports and every material
  rollback path.

## Safety contract

This importer supports one clean SQLite snapshot copied into one empty
PostgreSQL target. It intentionally has no force, resume, or permissive
unknown-column option. A future merge/resume workflow requires its own
source-of-truth design.
