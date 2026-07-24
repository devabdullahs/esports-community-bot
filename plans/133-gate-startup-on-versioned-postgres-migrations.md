# Plan 133: Gate every service startup on versioned PostgreSQL migrations

> **Executor instructions**: Introduce a migration ledger and advisory lock
> without changing Better Auth's separately managed tables. Rehearse both an
> empty database and an existing-schema baseline in the disposable PostgreSQL
> lane before changing startup. Never test against production.
>
> **Drift check (run first)**: `git diff --stat 0718e2d..HEAD -- src/start-production.js src/index.js src/db/client.js scripts/postgres scripts/migrate-sqlite-to-postgres.mjs package.json apps/web/package.json tests`

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: `plans/125-add-postgres-ci-coverage.md`
- **Category**: migration
- **Planned at**: commit `0718e2d`, 2026-07-23

## Why this matters

The parent process currently starts bot and web concurrently, while only the
bot applies the application schema. The whole `schema.sql`, including
backfills, constraint work, and a column drop, runs again on every bot restart
without a durable record. Versioned, checksummed migrations must complete once
under a database lock before either service accepts work.

## Current state

- `src/start-production.js:24-35,63-70` builds and spawns bot/web services
  without a database preflight.
- `src/index.js:36` calls `ensurePostgresAppSchema()` only in the bot child.
- `src/db/client.js:209-212` reads and executes all of
  `scripts/postgres/schema.sql` on every bot start.
- `scripts/postgres/schema.sql:1035-1117` includes historical DDL/DML, so it is
  not merely an empty-database bootstrap.
- `apps/web/package.json` runs `next start` directly; web-only startup has no
  general app-schema gate.
- Better Auth tables are explicitly managed separately. Do not include them in
  the application migration ledger.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Migration tests | `npm run test:postgres -- --test-name-pattern=migration` | all migration cases pass |
| Schema generation check | `npm run db:pg:schema:check` | exit 0; generated snapshot is current |
| PostgreSQL lane | `npm run test:postgres` | all pass |
| Bot suite | `npm test` | all pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Native typecheck | `npm --workspace @esports-community-bot/web run typecheck:native` | exit 0 |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Web build | `npm run web:build` | exit 0 |

## Scope

**In scope**:

- `scripts/postgres/migrations/0001-baseline.sql` (new; current app schema)
- `scripts/run-postgres-migrations.mjs` (new CLI)
- `scripts/build-postgres-schema.mjs` (new deterministic snapshot generator)
- `scripts/postgres/schema.sql` converted to a generated migration snapshot
- `src/db/postgresMigrations.js` (new reusable migrator, or an equivalently
  named dependency-free module)
- `src/db/client.js`
- `src/start-production.js`
- `src/index.js`
- `package.json`
- `apps/web/package.json` for web-only `prestart`
- `scripts/migrate-sqlite-to-postgres.mjs` only to invoke the migrator instead
  of raw schema execution
- `tests/postgresMigrations.test.mjs` (new) and schema-text tests whose path
  assumptions need mechanical updates

**Out of scope**:

- Better Auth migrations or auth-table ownership.
- Changing app table shapes beyond the current schema snapshot.
- Database-role separation; note it as a follow-up.
- Zero-downtime compatibility for a future breaking migration not yet defined.

## Git workflow

- Branch: `codex/133-versioned-postgres-migrations`
- Commit style: `feat(db): gate startup on versioned migrations`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Freeze the current schema as migration 0001

Copy the current application-owned schema byte-for-byte into
`scripts/postgres/migrations/0001-baseline.sql`. Add a generator that concatenates
sorted `NNNN-*.sql` files with deterministic headers into
`scripts/postgres/schema.sql`. The generator needs `--check` mode that exits
non-zero when the committed snapshot differs.

Keep `schema.sql` because existing parity tests and external inspection use it,
but mark it generated and never hand-edit it after this plan.

**Verify**: generation produces a snapshot containing the same executable SQL
as before; all existing schema-text tests still pass.

### Step 2: Implement a checksummed, locked migrator

Create a reusable migrator that uses one dedicated `pg` client and:

1. obtains a session-level PostgreSQL advisory lock with a constant app key;
2. creates `app_schema_migrations(version TEXT PRIMARY KEY, checksum TEXT NOT
   NULL, applied_at TIMESTAMPTZ NOT NULL)` if absent;
3. reads migration files in strict numeric order and computes SHA-256 checksums;
4. fails if an applied version's checksum differs;
5. applies each pending file in its own transaction and inserts its ledger row
   before commit;
6. always releases the advisory lock/client.

For an existing database with no ledger, run the idempotent 0001 baseline once
under the lock, then record it. This is the final intentional execution of the
old aggregate schema on that installation. Do not infer â€œalready currentâ€ from
one table and skip the baseline silently.

**Verify**: disposable tests cover empty DB, existing current schema/no ledger,
second no-op run, concurrent migrators, failed migration rollback, gap/duplicate
version, and checksum drift.

### Step 3: Replace raw schema application entry points

Make `ensurePostgresAppSchema` call the migrator or replace it with a clearly
named `ensurePostgresMigrations`. `scripts/run-postgres-migrations.mjs` should be
the operator CLI and print only versions/status, never the connection URL.

Update `db:pg:schema` to a migration command and add
`db:pg:schema:generate`/`:check`. The SQLite-to-PostgreSQL importer must call the
migrator when schema application is requested.

**Verify**: `rg -n "exec\(schema\)|readFileSync.*schema.sql" src scripts`
finds no runtime raw-schema execution outside the snapshot generator/tests.

### Step 4: Gate combined, bot-only, and web-only startup

- In `src/start-production.js`, await migrations before spawning either child.
  On failure, print a sanitized error and exit non-zero with no children.
- Keep a bot-only fallback in `src/index.js` for direct `npm start`.
- Add a web workspace `prestart` that invokes the root migration CLI so direct
  web-only `npm ... start` is also gated. Development may remain migration-free
  for SQLite; PostgreSQL development should use the explicit CLI.

Concurrent gates are safe because of the advisory lock and ledger.

**Verify**: spawn tests/fakes prove migration failure starts zero services and
success starts the requested RUN_BOT/RUN_WEB combination exactly once.

### Step 5: Put migration generation and execution in CI

Add `db:pg:schema:check` to the normal CI or PostgreSQL job. In plan 125's
PostgreSQL lane, apply migrations rather than raw `schema.sql`, run them again,
and assert the ledger contains exactly the expected versions/checksums.

**Verify**: full PostgreSQL lane passes from empty DB twice.

### Step 6: Run all gates and document the executor handoff

Run every command. Add a short migration-author note near the migration folder:
new changes get the next immutable file; never edit an applied migration;
regenerate the snapshot; add upgrade and fresh-install tests.

## Test plan

- Empty and pre-ledger existing databases.
- Two concurrent migrators serialize through advisory lock.
- Failed SQL leaves neither partial DDL nor ledger row when PostgreSQL supports
  transactional DDL.
- Checksum/version validation.
- Combined/bot-only/web-only startup barriers.
- Generated schema snapshot drift check.

## Done criteria

- [ ] Every production start mode completes migrations before serving.
- [ ] Applied versions/checksums are durable and immutable.
- [ ] Concurrent starters cannot apply the same migration twice.
- [ ] Raw full-schema execution is removed from normal boot.
- [ ] Better Auth tables remain separately managed.
- [ ] Fresh and existing-schema PostgreSQL tests pass.
- [ ] All repository gates pass.

## STOP conditions

- The current 0001 schema is not idempotent on a copy of an existing deployed
  schema; report the statement and schema facts before adding special cases.
- A migration contains PostgreSQL operations that cannot run transactionally;
  it needs explicit per-file metadata/design, not a silent transaction escape.
- Web-only startup cannot invoke the root migrator without changing deployment
  topology; report the exact command path.
- Better Auth-owned tables appear in the application schema.

## Maintenance notes

Migration files are immutable after deployment. Future releases must be
expand/migrate/contract aware when old and new processes may overlap; the
ledger/checksum tests should be mandatory CI.


