# Plan 125: Exercise PostgreSQL behavior in CI

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. Stop
> on any condition in "STOP conditions"; do not point tests at an existing or
> production database. Update this plan's row in `plans/README.md` when done.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `0718e2d`, 2026-07-23
- **Completed**: 2026-07-23

## Why this matters

Production uses PostgreSQL, while the fast default test suite uses SQLite.
PostgreSQL-only transaction, locking, DDL, identity, and parameter behavior
therefore needs a dedicated CI signal before later migration and prediction
integrity work can rely on it.

## Implemented

- Added a cross-platform, fail-closed `scripts/run-postgres-tests.mjs` runner.
- Required an explicit reset opt-in and a database name ending in `_test`.
- Restricted local runs to loopback hosts and CI runs to an explicit host
  allow marker.
- Added live PostgreSQL schema, transaction, helper round-trip, and concurrent
  `FOR UPDATE` parity coverage.
- Added an independent PostgreSQL 17 CI service job without replacing the fast
  SQLite, web, or browser jobs.

## Commands

| Purpose | Command |
|---|---|
| Focused PostgreSQL lane | `npm run test:postgres` |
| Bot suite | `npm test` |
| Web lint | `npm --workspace @esports-community-bot/web run lint` |
| Native typecheck | `npm --workspace @esports-community-bot/web run typecheck:native` |
| Web tests | `npm --workspace @esports-community-bot/web run test` |
| Web build | `npm run web:build` |

## Safety contract

The runner:

1. requires `DATABASE_URL` and `ALLOW_POSTGRES_TEST_RESET=1`;
2. requires the parsed database name to end in `_test`;
3. rejects non-loopback hosts outside CI;
4. requires `POSTGRES_TEST_HOST_ALLOWED=1` in CI;
5. drops and recreates only the `public` schema in that guarded database;
6. never logs a connection URL or password;
7. closes setup and application clients and propagates the test exit code.

## Verification

- [x] Missing guard environment exits nonzero before connecting.
- [x] Disposable PostgreSQL 17 test run passes twice consecutively.
- [x] Schema applies repeatedly.
- [x] Rollback and commit behavior are covered.
- [x] Prediction helper round trips are covered.
- [x] Concurrent row locking preserves both writes.
- [x] Existing SQLite/web/E2E jobs remain present.
- [x] Full repository gates pass.

## Maintenance notes

Plans 129, 133, and 134 depend on this lane. Add focused PostgreSQL regression
coverage whenever code introduces backend-specific SQL, locking, migrations, or
import behavior, while keeping the default SQLite suite fast.
