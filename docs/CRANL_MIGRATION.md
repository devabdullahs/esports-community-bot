# Cranl Migration Runbook

This project currently runs from one SQLite database file through
`better-sqlite3`. Cranl offers managed PostgreSQL, MySQL, MariaDB, MongoDB,
and Redis. Use PostgreSQL for this migration.

## Decision

Use Cranl managed PostgreSQL in the `mena` / Saudi Arabia region unless latency
tests show a better region.

Why PostgreSQL:

- The app data is relational: tournaments, matches, guild settings, EWC
  predictions, news, audit logs, Better Auth users/sessions/accounts.
- Better Auth supports PostgreSQL directly through `pg.Pool`.
- PostgreSQL maps better than MySQL/MariaDB for the current SQL: CTEs, window
  queries, `ON CONFLICT`, JSON fields, and strict transactions.
- MongoDB and Redis would require a full data-model rewrite, not a migration.

Cranl creates managed databases with:

```bash
cranl db create --name esports-community-db --type postgresql --region mena --inject <app-id>
```

With `--inject`, Cranl adds `DATABASE_URL` to the application environment.

Current Cranl database values:

- Display name: `esports-community-postgres`
- Database name: `esports_community`
- Username: `ecb_app`
- Region: MENA / Saudi Arabia
- Internal host: use Cranl's injected internal `DATABASE_URL` from the app
  environment for production.
- External host: use Cranl's external connection URL only for local migration
  tooling.

## Current Runtime Status

The dashboard's Better Auth database resolver can use PostgreSQL when
`DB_DRIVER=postgres` or `DATABASE_URL` is present. The app-owned bot/dashboard
tables are not fully ported yet; most runtime data modules still use
`better-sqlite3`.

Keep `RUN_BOT=false` on Cranl until the app-owned DB modules are ported and
verified against PostgreSQL.

## Important Constraint

This is not a dump-only migration.

The current runtime imports SQLite directly from:

- `src/db/connection.js`
- `src/db/*.js`
- `apps/web/src/lib/auth.ts`
- several bot jobs, EWC commands, and dashboard helpers

Those modules use synchronous `better-sqlite3` APIs such as `db.prepare()`,
`.get()`, `.all()`, `.run()`, `.transaction()`, SQLite PRAGMAs, and SQLite
syntax. PostgreSQL clients are async, so the app must be ported before Cranl
PostgreSQL can become the production database.

## What Must Be Preserved

Keep these values/data during cutover:

- `BETTER_AUTH_SECRET`: must stay exactly the same or existing auth sessions and
  linked Discord account data can break.
- Better Auth tables: user, session, account, verification tables if present.
- Bot tables: tournaments, matches, guild settings, channel settings, card
  message IDs, EWC prediction data, EWC profile links, news/CMS data, audit
  logs, and rate-limit tables.
- Liquipedia and logo rate-limit state. Today some of this is file-backed under
  `/app/data`; moving it into PostgreSQL is safer for Cranl restarts.
- Media/uploads: keep existing object storage/R2 settings unless deliberately
  moving them to Cranl object storage.

## Safe Implementation Plan

1. Create and rehearse the PostgreSQL import.
   - `scripts/postgres/schema.sql` mirrors the current app-owned SQLite tables.
   - `npm run db:pg:schema` applies that app schema to `DATABASE_URL`.
   - `npm run db:sqlite-to-pg -- --dry-run --sqlite <backup.sqlite>` previews a
     source backup without opening a PostgreSQL connection.
   - `DATABASE_URL=<external-url> npm run db:sqlite-to-pg -- --sqlite <backup.sqlite>`
     imports app-owned tables into PostgreSQL.

2. Add PostgreSQL support behind the existing DB module boundaries.
   - Add `pg`.
   - Add a pooled PostgreSQL connection using `DATABASE_URL`.
   - Keep the exported domain functions stable where possible.
   - Avoid new direct `db.prepare()` call sites.

3. Replace boot-time SQLite schema creation with PostgreSQL migrations.
   - Convert `src/db/index.js` schema to versioned migrations.
   - Keep app tables snake_case.
   - Run Better Auth PostgreSQL migrations for auth tables.

4. Port DB modules to async PostgreSQL.
   - Replace `?` and named SQLite parameters with `$1`, `$2`, etc.
   - Replace `INSERT OR IGNORE` with `ON CONFLICT DO NOTHING`.
   - Replace `datetime('now')` with `now()` or normalized ISO strings.
   - Replace `.changes` / `lastInsertRowid` with `rowCount` / `RETURNING`.
   - Replace `db.transaction()` with async transaction clients.

5. Port raw DB users outside `src/db`.
   - `src/jobs/ewcPredictions.js`
   - `src/commands/ewc_admin.js`
   - `src/lib/ewcProfileStats.js`
   - web dashboard helpers that import bot DB modules directly

6. Complete the one-time SQLite-to-PostgreSQL migration script.
   - Read from a stopped/checkpointed SQLite backup.
   - Insert into PostgreSQL in dependency order.
   - Preserve IDs and Discord message/channel/guild IDs.
   - Reset PostgreSQL identity sequences after import.
   - Validate row counts and key leaderboard totals.
   - After Better Auth's PostgreSQL tables exist, rerun with `--include-auth`
     to copy matching auth tables.

7. Rehearse in a disposable Cranl/staging database.
   - Import a fresh NAS backup.
   - Smoke test Discord command registration, dashboard login, CMS writes,
     EWC prediction submit/score, leaderboard rendering, match cards, and jobs.

8. Cut over with a short write freeze.
   - Stop the NAS bot first. Only one bot instance should be online.
   - Take the final SQLite backup.
   - Run the migration script.
   - Deploy Cranl app with `DATABASE_URL` and the same production secrets.
   - Start Cranl app and verify logs.

## NAS Backup Procedure

Stop the container before the final backup so SQLite WAL data is consistent:

```bash
cd /volume1/docker/ECB
docker compose stop esports-community-bot
sqlite3 ./data/bot.sqlite ".backup './backups/bot-$(date +%Y%m%d-%H%M%S).sqlite'"
```

If `sqlite3` is not installed on the NAS, copy `bot.sqlite`, `bot.sqlite-wal`,
and `bot.sqlite-shm` only after the container is stopped.

## Cranl Environment

At minimum, the Cranl app needs:

```env
DATABASE_URL=postgresql://...
DB_DRIVER=postgres
NODE_ENV=production
RUN_BOT=true
RUN_WEB=true
PORT=3000
BETTER_AUTH_SECRET=<same value as NAS>
BETTER_AUTH_URL=<cranl or custom domain URL>
DISCORD_TOKEN=...
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
DISCORD_GUILD_ID=1087350030693838918
```

Do not paste secrets in chat. Put them in Cranl environment variables or a local
private env file used only for migration.

For local migration from your machine, use the external Cranl connection URL:

```powershell
$env:DATABASE_URL = "postgresql://ecb_app:<password>@130.94.57.8:40003/esports_community"
npm run db:sqlite-to-pg -- --dry-run --sqlite C:\path\to\bot.sqlite
```

Then remove the shell variable after use:

```powershell
Remove-Item Env:\DATABASE_URL
```

## Verification Checklist

Before stopping the NAS permanently:

- Bot logs show one login and no duplicate instance warnings.
- Slash commands are deployed once.
- Dashboard login works with Discord.
- Admin pages can read/write EWC content.
- EWC prediction profile and leaderboard load.
- Match cards update without creating duplicate Discord messages.
- Liquipedia backoff state persists across Cranl restarts.
- Row counts match the SQLite backup for all migrated tables.
