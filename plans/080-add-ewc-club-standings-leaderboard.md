# Plan 080: Persist and publish a first-class EWC Club Championship standings leaderboard

> **Executor instructions**: Club standings and community prediction rankings
> are different products. Keep their routes, types, copy, and MCP tool names
> explicit. Implement storage for both SQLite and Postgres, then the public UI.
> Update `plans/README.md` when complete.
>
> **Drift check (run first)**: `git diff --stat ba288a1..HEAD -- src/jobs/clubChampionship.js src/db src/services/liquipedia apps/web/src/lib/ewc-clubs.ts apps/web/src/app/clubs apps/web/src/components/site-header-client.tsx apps/web/src/lib/i18n.ts apps/web/src/app/sitemap.ts scripts/postgres/schema.sql tests apps/web/src/test`

## Status

- **Execution**: DONE (2026-07-10)
- **Priority**: P2
- **Effort**: L
- **Risk**: MED
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `ba288a1`, 2026-07-10

## Why this matters

The site has rich club cards and a prediction leaderboard, but no dedicated
Club Championship points table. The current web tracker can call Liquipedia on
a cache miss and its DB fallback reuses prediction snapshots, while the bot's
successful standings refresh is not persisted as a current source of truth.
Persisting each successful refresh makes a fast, rank-ordered public board and
gives MCP consumers a reliable data source.

## Current state

- `src/jobs/clubChampionship.js:58-89` fetches current standings and edits a
  Discord message, but does not save the successful payload.
- `apps/web/src/lib/ewc-clubs.ts:583-662` builds the web tracker by calling the
  Liquipedia fetchers inside an `unstable_cache` miss.
- Its DB fallback at lines 341-365 and 482-561 reads the newest
  `ewc_prediction_weeks`/`ewc_prediction_seasons.final_json`, which is a scoring
  snapshot rather than a dedicated current Club Championship snapshot.
- `apps/web/src/app/clubs/page.tsx:244-248` can compute a points leader, but the
  main cards at lines 348-353 remain a club directory.
- Live tracker sorting in `ewc-clubs.ts:626-635` puts featured clubs before
  points/rank, so it cannot serve as an official standings order.
- The prediction board route is `/leaderboard/...` and is labeled explicitly
  as a prediction leaderboard in `apps/web/src/lib/i18n.ts:1152-1174`. Do not
  reuse that route or component name for club standings.
- Schema changes must be mirrored in `src/db/index.js` (SQLite) and
  `scripts/postgres/schema.sql`; production boot applies the latter through
  `src/db/client.js:209-212`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Snapshot tests | `node --test tests/ewcClubChampionshipSnapshot.test.mjs tests/clubChampionship.test.mjs` | all pass |
| Web standings tests | `npm --workspace @esports-community-bot/web run test -- src/test/ewc-club-standings.test.ts` | all pass |
| Bot tests | `npm test` | all pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Web build | `npm run web:build` | exit 0 |

## Scope

**In scope**:

- `src/db/index.js`
- `scripts/postgres/schema.sql`
- `src/db/ewcClubChampionshipSnapshots.js` (new)
- `src/jobs/clubChampionship.js`
- `apps/web/src/lib/ewc-clubs.ts`
- `apps/web/src/lib/ewc-club-standings.ts` (new public projection/cache)
- `apps/web/src/app/clubs/standings/page.tsx` (new)
- `apps/web/src/components/clubs/ewc-club-standings-table.tsx` (new)
- `apps/web/src/components/site-header-client.tsx`
- `apps/web/src/app/sitemap.ts`
- `apps/web/src/lib/i18n.ts`
- Focused bot/web tests and fixtures

**Out of scope**:

- Prediction scoring or `/leaderboard`.
- Scraping outside the shared serialized Liquipedia client.
- Historical season charts; persist the latest snapshot first.
- Admin editing of official standings.

## Steps

### Step 1: Add a dual-backend latest-snapshot table

Add one row per season with source URL, standings JSON, prize-pool JSON,
fetched timestamp, and updated timestamp. Use a unique season key and an
atomic upsert. Validate parsed writes before replacing the last good snapshot;
an empty/transient parse must not erase useful current standings.

Mirror schema and indexes in SQLite and Postgres. Keep SQL parameterized.

**Verify**: tests cover insert, replace, restart readback, invalid JSON, empty
parse preservation, and independent seasons on both supported test paths.

### Step 2: Persist every successful bot refresh

After `fetchClubChampionship` returns a valid payload, save it before posting
the Discord message. A Discord permission/edit failure must not discard the
fresh data. A Liquipedia fetch or parse failure must leave the prior snapshot.

**Verify**: job tests prove successful fetch + failed Discord send still saves,
and failed fetch does not overwrite.

### Step 3: Make the stored snapshot the web source of truth

Refactor `ewc-clubs.ts` so public requests read the latest stored standings
first and enrich them with cached club/profile/game metadata. Keep a bounded
fallback for installations with no snapshot yet, but do not make every MCP/page
cache miss wait on live Liquipedia. Surface `updatedAt`, `dataSource`, and a
non-alarming stale warning when appropriate.

**Verify**: with Liquipedia mocked to hang, stored tracker reads complete and
return the latest snapshot.

### Step 4: Add `/clubs/standings`

Build a dense, scan-friendly table ordered by official rank, then points and
name only as deterministic fallbacks. Include rank, crest/name, points,
eligibility, qualified-game count, wins, and region where available. Use a
sticky or compact header only if it remains accessible on mobile. Provide
search and region filters without changing official rank.

Use a segmented link between Club directory and Standings on both club pages.
The H1 and metadata must say "EWC Club Championship standings" (and an accurate
Arabic equivalent), never just "leaderboard".

**Verify**: projection tests cover ties/null points/eligibility and prove
featured status cannot reorder official rank.

### Step 5: Add discovery and resilient states

Add the standings route to the EWC navigation and sitemap. Render explicit
empty, stale, and source-attribution states. Reuse `LiquipediaAttribution` and
safe cached crest handling. Preserve RTL and stable column widths.

### Step 6: Visual acceptance

Check 390x844, 768x1024, and 1440x900 in English/Arabic with 0, 3, and 40+
clubs. Confirm all rows are reachable, rank/points remain visible on mobile,
filters do not mutate rank, and the directory still shows all qualified games.

## Done criteria

- [x] Current Club Championship data is persisted independently of predictions.
- [x] Failed/transient fetches preserve the last good snapshot.
- [x] `/clubs/standings` is rank-ordered and clearly distinct from predictions.
- [x] Navigation, sitemap, bilingual copy, attribution, mobile, and RTL are complete.
- [x] All required repo checks pass.

## STOP conditions

- Liquipedia's returned standings cannot be distinguished from an empty parse.
- Schema drift exists between SQLite and Postgres before this change.
- Implementing the page would require direct browser/server fetches outside the
  shared Liquipedia queue.

## Maintenance notes

The bot refresh owns external data acquisition; public pages consume stored
snapshots. Future seasons should select the configured/current season rather
than duplicating a hard-coded 2026 table or route.
