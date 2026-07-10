# Plan 092: Add rich match-details pages fed by Liquipedia Match: data

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, add/update this plan's row in
> `plans/README.md` (see "Index note" at the bottom).
>
> **Drift check (run first)**: `git diff --stat 2301227..HEAD -- src/services/liquipedia src/jobs/pollingManager.js src/db/matches.js src/db/index.js scripts/postgres/schema.sql scripts/migrate-sqlite-to-postgres.mjs apps/web/src/lib/tournaments.ts apps/web/src/components/tournaments/tournament-match-list.tsx apps/web/src/lib/logo-url.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. NOTE: PR #206 (prediction system)
> may merge before you start — it does not touch these files, so its drift is
> expected to be zero here; plans/README.md WILL have drifted (it gains rows
> 082-091), which is fine.

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: MED (touches the rate-limited Liquipedia pipeline; violating the
  rate rules gets the bot banned)
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `2301227`, 2026-07-10

## Why this matters

The site shows tournament match lists with scores, but nothing about HOW a
match is going: no map veto, no per-map scores, no player stat lines, no
drafts. Liquipedia publishes all of this on per-match `Match:` pages (the
"View match details" popup target), and the bot already stores those page
names as match ids for bracket-linked matches. Competitor apps (EScore)
render this as a match screen: header with logos/series score/live badge,
tabs, then per-map collapsible cards with player stat tables. This plan adds
that experience for the two games whose `Match:` pages we verified —
**Valorant** (map veto + per-map player K/D/A) and **Dota 2** (draft + team
stats + player performance) — behind a shape that other games can join later.

## Current state

Facts verified against commit `2301227` (2026-07-10):

- **Match ids**: `src/services/liquipedia/parsers.js:275,371,431` extract
  `a[href*="/Match:"]` from bracket/matchlist rows; when present, the
  `Match:...` page name becomes `matches.external_id` (see
  `src/db/matches.js:101` — `/^Match:/i.test(m.external_id)` is already used
  as a stable-id signal). Matches WITHOUT a linked Match: page keep a
  structural id like `dota2:Esports_World_Cup/2026/Group_Stage:matchlist:25:...`
  — those get NO details in this plan (that's expected; Liquipedia simply has
  not linked a page).
- **The ONLY Liquipedia entry point** is `parsePage(game, page)` in
  `src/services/liquipedia/client.js:106`. It serializes all `action=parse`
  requests through one queue with a ≥30s global gap and a TTL cache
  (`LIQUIPEDIA_CACHE_TTL_MS`, 15 min in prod). NEVER add another fetch path,
  never call axios/fetch to liquipedia.net directly, and never call Liquipedia
  from tests.
- **Polling**: `src/jobs/pollingManager.js` — `armMatch` (line 96) /
  `startPolling` (line 123) set a `setInterval(tick, config.scheduler.livePollIntervalMs)`
  per live match; `pollOnce(match, tournament)` (line 161) refreshes the match
  from its TOURNAMENT page and calls `markFinished` on completion. This is the
  correct place to hang detail refreshes.
- **Matches DB module**: `src/db/matches.js` — prepared, parameterized `$n`
  statements via `src/db/client.js` (`all/get/run`), portable across
  better-sqlite3 and Postgres. `getMatch(source, externalId)` at line 88,
  `getActiveMatches()` at line 169.
- **Dual schema rule**: every new table goes in BOTH `src/db/index.js`
  (CREATE TABLE IF NOT EXISTS inside the big `db.exec` block) AND
  `scripts/postgres/schema.sql`, plus the `appTables` list in
  `scripts/migrate-sqlite-to-postgres.mjs`. The dynamic parity test
  `tests/migrationScriptTables.test.mjs` fails if you miss one side.
- **Web reads bot DB** via the `@bot/*` alias; tournament page model lives in
  `apps/web/src/lib/tournaments.ts` (`MATCHES_SQL` around line 168 selects the
  per-tournament match rows), rendered by
  `apps/web/src/components/tournaments/tournament-match-list.tsx`.
- **Liquipedia images must not be hotlinked**: `apps/web/src/lib/logo-url.ts`
  — `displayImageUrl` routes liquipedia.net URLs through `/api/logo?url=...`,
  which serves ONLY the bot-warmed on-disk cache. Team logos are warmed by
  `src/jobs/logoWarmup.js`. Agent/hero icons are NOT warmed today — see the
  explicit deferral in Scope.
- **Attribution**: Liquipedia data on the web requires the CC-BY-SA notice —
  reuse `apps/web/src/components/tournaments/liquipedia-attribution.tsx`.
- **UI stack**: Next.js App Router, shadcn base-nova on Base UI (compose with
  `render={...}` + `nativeButton={false}`, never Radix `asChild`), Tailwind,
  bilingual EN/AR with RTL (`dir` comes from the locale; keep numerals and
  team/player names LTR inside RTL text with `dir="ltr"` spans). Tabs
  component exists at `apps/web/src/components/ui/tabs.tsx`. Localized copy
  for public pages lives in `apps/web/src/lib/i18n.ts` (`copy` object).
- **Verified page structure — Valorant** (from
  `https://liquipedia.net/valorant/Match:ID_EWC2026POs_R01-M001`):
  header (teams, series score "2 : 1", "finished", date "July 10, 2026 -
  16:10 CEST", casters, patch "13.00"); a **Map Veto** section as ordered
  cards (map thumbnail + name, "BAN"/"PICK" label, acting team logo); one
  section **per map**: map name + duration + round score ("13-2"), a team
  stats row ("First Kills", "Thrifties", "Flawless", "Post Plant",
  "Clutches"), and a **player table per team** with columns: player, agent
  icon(s), "ACS", "KDA", "KAST%", "ADR", "HS%", "FK / FD"; plus
  round-by-round detail and match-history sections (both OUT of scope).
- **Verified page structure — Dota 2** (from
  `https://liquipedia.net/dota2/Match:ID_B5F8Z45QjA_0011`):
  header (teams, "0 : 2", tournament, date, patch "7.41d"); one section **per
  game**: a **Draft** block (per-team hero icons with global pick/ban order
  numbers "#1..#24"), a **Team Stats** block ("<Team> Victory" heading,
  duration "31:18", per-team side Radiant/Dire, win/loss, "KDA", "Gold",
  "Towers", "Barracks", "Roshans"), and a **Player Performance** table per
  team (hero, player, item icons, KDA, "DMG", "LH/DN", "NET", "GPM").
- **The exact DOM classes were NOT captured** — the executor derives selectors
  from the two committed fixtures (Step 2). The structure above is what the
  parser must produce; the selectors are whatever the fixtures show.

Exemplar for parser style + fixtures: `src/services/liquipedia/standingsParsers.js`
with `tests/fixtures/liquipedia-br-standings.html` and its tests — match that
pattern (cheerio, defensive null returns, pure functions, fixture-driven tests).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Bot tests | `npm test` | exit 0 |
| Focused parser tests | `node --test tests/liquipediaMatchDetails.test.mjs` | all pass |
| Focused DB tests | `node --test tests/matchDetails.test.mjs tests/migrationScriptTables.test.mjs` | all pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Web build | `npm run web:build` | exit 0 |
| Seed a preview DB | `$env:DB_PATH="$env:TEMP\ecb-mdetails.sqlite"; npm run seed:dev` | "Seed complete." |

## Scope

**In scope** (the only files to modify or create):

- `src/services/liquipedia/matchDetailsParsers.js` (new)
- `src/services/liquipedia/fetchers.js` (add one fetcher)
- `src/services/liquipedia.js` (re-export facade — add the new fetcher)
- `src/jobs/pollingManager.js` (hang detail refresh off `pollOnce`)
- `src/db/matchDetails.js` (new)
- `src/db/index.js`, `scripts/postgres/schema.sql`,
  `scripts/migrate-sqlite-to-postgres.mjs` (new table, both backends)
- `src/config.js` + `.env.example` (one enable flag)
- `tests/fixtures/liquipedia-valorant-match-details.html` (new)
- `tests/fixtures/liquipedia-dota2-match-details.html` (new)
- `tests/liquipediaMatchDetails.test.mjs` (new)
- `tests/matchDetails.test.mjs` (new)
- `apps/web/src/lib/match-details.ts` (new)
- `apps/web/src/app/matches/[id]/page.tsx` (new)
- `apps/web/src/components/matches/*` (new components)
- `apps/web/src/lib/tournaments.ts` (add `has_details` flag to match rows)
- `apps/web/src/components/tournaments/tournament-match-list.tsx` (link rows
  that have details to `/matches/[id]`)
- `apps/web/src/lib/i18n.ts` (new copy strings, EN + AR)
- `apps/web/src/test/match-details-model.test.ts` (new)
- `plans/README.md` (status row — see Index note)

**Out of scope** (do NOT touch):

- `src/services/liquipedia/client.js`, `rateState.js` — the rate machinery is
  the most fragile code in the repo. You consume `parsePage`; you never modify
  it.
- Round-by-round Valorant detail, match-history sections, item/agent/hero
  ICON images (text names only in v1 — icon warming is a follow-up), head-to-head.
- Discord rendering of match details (cards stay as they are).
- Any other game than `valorant` and `dota2` (the shape is extensible; the
  support map is the extension point).
- The scoring/prediction system entirely.
- The five untracked `apps/web/src/app/discord-bot-*.png` files.

## Git workflow

- Branch: `codex/092-match-details-pages`
- Conventional commits, e.g. `feat(092): parse Liquipedia match detail pages`.
- Do not push or open a PR unless the operator instructed it.

## Steps

### Step 1: Create the fixtures (one-time manual fetch — NOT via code)

Download the two verified pages ONCE each with a normal HTTP client (curl with
a descriptive UA, or a browser "save page"), at least 30 seconds apart:

- `https://liquipedia.net/valorant/Match:ID_EWC2026POs_R01-M001`
  → `tests/fixtures/liquipedia-valorant-match-details.html`
- `https://liquipedia.net/dota2/Match:ID_B5F8Z45QjA_0011`
  → `tests/fixtures/liquipedia-dota2-match-details.html`

Then TRIM each file to the match-detail content subtree (the popup/page body
containing veto/maps or draft/stats — drop `<head>`, nav, footer, scripts,
match-history) so the fixture stays reviewable (aim < 200 KB each). Keep the
DOM structure of the kept subtree byte-faithful — the parser is built against
it. Do NOT add any code that fetches these at runtime beyond Step 3's
`parsePage` call, and never fetch them from tests.

**Verify**: both files exist; `node -e "require('fs').statSync('tests/fixtures/liquipedia-valorant-match-details.html')"` exits 0.

### Step 2: Write the parsers

Create `src/services/liquipedia/matchDetailsParsers.js` exporting:

- `parseValorantMatchDetails(html)` → payload or `null`
- `parseDota2MatchDetails(html)` → payload or `null`
- `parseMatchDetails(game, html)` → dispatches by game key, `null` for
  unsupported games.

Use cheerio like the other parser modules. Selectors come from the fixtures.
Every field is defensive: a missing section yields an empty array/null field,
a page with NO recognizable detail sections yields `null` (so callers store
nothing rather than junk).

Payload envelope (documented here, versioned so later games can extend):

```js
{
  version: 1,
  kind: 'valorant' | 'dota2',
  patch: '13.00' | null,
  casters: ['Paperthin', 'Achilios'],       // [] when absent (dota page has none)
  // Valorant only:
  veto: [{ order: 1, action: 'ban' | 'pick' | 'decider', map: 'Sunset', team: 'a' | 'b' | null }],
  maps: [{
    name: 'Fracture', duration: null | 'MM:SS', scoreA: 2, scoreB: 13,
    winner: 'a' | 'b' | null,
    players: {
      a: [{ name: 'Timotino', agents: ['Jett'], acs: 210, kills: 16, deaths: 7, assists: 2,
            kastPct: '74%', adr: 130, hsPct: '28%', fk: 3, fd: 1 }],
      b: [...],
    },
  }],
  // Dota only:
  games: [{
    number: 1, winner: 'a' | 'b' | null, duration: '31:18',
    sides: { a: 'dire', b: 'radiant' },
    draft: { a: { picks: [{ hero: 'Drow Ranger', order: 8 }], bans: [...] }, b: {...} },
    teamStats: { a: { kills: 10, deaths: 37, assists: 20, gold: '65.2K', towers: 0, barracks: 0, roshans: 0 }, b: {...} },
    players: { a: [{ name: '...', hero: '...', kills, deaths, assists, dmg, lhdn: '312/14', net, gpm }], b: [...] },
  }],
}
```

Numbers that fail to parse stay `null` — never `NaN`. Team assignment to
`'a'`/`'b'` follows the header's left/right team order on the page; the
CALLER (Step 3) is responsible for aligning page teams with the stored
match's `team_a`/`team_b` (pass both names in; if the page's left team
matches `team_b` better than `team_a`, the fetcher swaps sides before
storing). Use the existing normalized-name comparison helper if one exists in
`src/lib/` (search for the function used by `matchParticipant` in
`src/lib/ewcGameTeams.js`); otherwise compare lowercased trimmed names and
treat no-match as "keep page order".

**Verify**: `node --test tests/liquipediaMatchDetails.test.mjs` (written in
Step 6 — during development iterate with a scratch script against the
fixtures; the step is done when the Step 6 tests pass).

### Step 3: Fetcher + facade export

In `src/services/liquipedia/fetchers.js` add:

```js
const MATCH_DETAIL_GAMES = new Set(['valorant', 'dota2']);
export async function fetchMatchDetails(game, matchPage, { teamA, teamB } = {}) {
  if (!MATCH_DETAIL_GAMES.has(game)) return null;
  const html = await parsePage(game, matchPage);   // the ONE rate-limited entry point
  if (!html) return null;
  const parsed = parseMatchDetails(game, html);
  // align page sides with stored team_a/team_b here (see Step 2), then return
  return parsed;
}
```

(Signature and side-alignment as described; follow the module's existing
import/ordering style.) Re-export `fetchMatchDetails` from the
`src/services/liquipedia.js` facade like the other fetchers.

**Verify**: `node -e "import('./src/services/liquipedia.js').then(m => console.log(typeof m.fetchMatchDetails))"` → `function`.

### Step 4: Storage (dual backend)

New table in BOTH `src/db/index.js` and `scripts/postgres/schema.sql`, plus
`appTables` in `scripts/migrate-sqlite-to-postgres.mjs`:

```sql
CREATE TABLE IF NOT EXISTS match_details (
  match_id     INTEGER NOT NULL PRIMARY KEY
                 REFERENCES matches(id) ON DELETE CASCADE,   -- BIGINT on Postgres
  source_page  TEXT    NOT NULL,          -- the Match:... page name
  game         TEXT    NOT NULL,
  payload_json TEXT    NOT NULL,          -- envelope from Step 2
  fetched_at   TEXT    NOT NULL,
  updated_at   TEXT    NOT NULL
);
```

New module `src/db/matchDetails.js` (match the style of `src/db/matches.js`):
`upsertMatchDetails({ matchId, sourcePage, game, payload })` (JSON.stringify,
`INSERT ... ON CONFLICT (match_id) DO UPDATE`, `$n` placeholders),
`getMatchDetails(matchId)` (parse JSON defensively — malformed JSON returns
`null`, never throws), `getMatchDetailsFetchedAt(matchId)`.

**Verify**: `node --test tests/matchDetails.test.mjs tests/migrationScriptTables.test.mjs` → all pass.

### Step 5: Refresh hook in the polling manager

In `src/jobs/pollingManager.js`, inside `pollOnce` after a successful
tournament refresh for the polled match:

- Eligibility: `/^Match:/i.test(match.external_id)` AND the match's game maps
  to a supported wiki (`valorant`, `dota2`) AND
  `config.liquipedia.matchDetailsEnabled`.
- Staleness gate: fetch details only if `getMatchDetailsFetchedAt(match.id)`
  is older than **300 seconds** for a running match. When the match
  transitions to finished, do ONE final fetch (the completed stats snapshot)
  and stop.
- The fetch goes through `fetchMatchDetails` (which uses the serialized parse
  queue — the 30s global gap and cache are enforced there; the 15-min prod
  cache TTL means live details effectively refresh at cache-expiry cadence,
  which is acceptable and intentionally cheap). Wrap in try/catch; a detail
  failure must NEVER fail or delay the score poll — log at `warn` and move on.
- Add `matchDetailsEnabled` to `src/config.js` under the liquipedia section,
  reading `LIQUIPEDIA_MATCH_DETAILS_ENABLED` (default `true`), and document
  the variable in `.env.example`.

**Verify**: `npm test` → exit 0 (existing pollingManager tests still pass).

### Step 6: Bot tests

`tests/liquipediaMatchDetails.test.mjs` (fixture-driven, NEVER network):

- Valorant fixture: envelope kind/patch/casters; veto array — exact length,
  first entry `{ order: 1, action: 'ban', ... }`; 3 maps with exact round
  scores (`13-2`, `10-13`, `13-5` per the fixture); each map has two player
  arrays of 5 rows; one sampled player row asserts every column (name, agent,
  acs, k/d/a, kastPct, adr, hsPct, fk, fd).
- Dota fixture: 2 games; draft pick orders present and numeric; team stats
  (gold `65.2K`, towers 0/4, roshans 0/2, duration `31:18`); player rows 5 per
  team with dmg/lhdn/net/gpm sampled.
- `parseMatchDetails('leagueoflegends', html)` → `null` (unsupported).
- Garbage HTML → `null`; fixture with a section removed → that field
  empty/null, no throw.

`tests/matchDetails.test.mjs`: temp-DB upsert→get roundtrip, overwrite
updates payload + fetched_at, malformed stored JSON → `null`, FK cascade
(deleting the match row deletes the details). Set the standard env preamble
BEFORE imports (`DB_PATH` tempfile, `LOG_LEVEL=error`, `DISCORD_TOKEN`,
`DISCORD_CLIENT_ID` — copy the pattern from `tests/clubChampionship.test.mjs`
lines 7-11).

**Verify**: `npm test` → exit 0, including the new files.

### Step 7: Web data layer + match page

- `apps/web/src/lib/match-details.ts`: server-only wrapper importing
  `@bot/db/matchDetails.js` + a `getMatchPageModel(matchId)` that joins the
  match row (teams, logos, score, status, scheduled_at, stream fields,
  tournament name/id) with the parsed payload and returns a typed view model.
  Pure mapping logic (payload → sections) goes in an exported function so it
  is unit-testable in node.
- `apps/web/src/app/matches/[id]/page.tsx`: public page, `runtime = "nodejs"`,
  `dynamic = "force-dynamic"`. `notFound()` when the match id does not exist;
  when the match exists but has no details, render the header + a localized
  "no detailed stats yet" empty state (the page is still linkable).
- Components under `apps/web/src/components/matches/` modeled on the EScore
  screenshot the operator supplied:
  - **Header**: both team logos through `displayImageUrl` from
    `apps/web/src/lib/logo-url.ts`, names, big series score, live badge
    (reuse the tournament list's live styling), localized date/time.
  - **Tabs** (`apps/web/src/components/ui/tabs.tsx`): "Overview" /
    "Maps" (valorant) or "Games" (dota) — EN/AR labels from `i18n.ts`
    (AR: "معاينة", "الخرائط", "المباريات" — adjust to read naturally).
    Overview = veto list (valorant) or per-game draft summary (dota) + casters
    + patch. Maps/Games = one collapsible card per map/game: score strip,
    winner highlight, per-team player table. Player tables show the first 3
    rows with a localized "show more (N)" expander (client component), like
    the EScore reference.
  - Player/team names and all numerals wrapped `dir="ltr"` inside RTL.
  - `LiquipediaAttribution` at the bottom — REQUIRED.
  - No agent/hero/item images in v1 — text names only (icons are a deferred
    follow-up; see Out of scope).
- `apps/web/src/lib/tournaments.ts`: extend `MATCHES_SQL` with
  `EXISTS(SELECT 1 FROM match_details md WHERE md.match_id = matches.id) AS has_details`
  (portable on both backends) and thread the flag through the row type.
- `tournament-match-list.tsx`: when `has_details`, wrap the row (or add a
  compact "details" affordance) linking to `/matches/[id]` via `localizedPath`.
  Do not change rows without details.

**Verify**: `npm run web:build` → exit 0.

### Step 8: Web tests + visual acceptance

- `apps/web/src/test/match-details-model.test.ts` (node vitest, no DOM —
  model after `apps/web/src/test/leaderboard-page-model.test.ts`): payload →
  view model mapping for both kinds; unsupported/malformed payload → empty
  model; side alignment preserved; has_details flag mapping.
- Visual acceptance with a seeded DB: seed, then insert one fake finished
  valorant match + a `match_details` row built from the PARSED FIXTURE (write
  a tiny scratch script that runs the parser over the fixture and upserts —
  scratch script is throwaway, do not commit it). Run `npm run web:dev`,
  check `/matches/<id>` and `/ar/matches/<id>`: header, tabs, veto, map cards,
  player tables, expander, attribution; no horizontal overflow at 390px;
  RTL coherent.

**Verify**: `npm --workspace @esports-community-bot/web run test` → all pass;
manual checklist above recorded in your report.

## Test plan

Summarized from Steps 6 and 8: fixture-driven parser tests (exact veto/map
scores/player samples for valorant; drafts/team stats/player samples for
dota; unsupported game → null; degraded HTML → null/empty), DB roundtrip +
FK cascade + malformed JSON, migration parity, web view-model mapping tests,
and the bilingual visual acceptance pass. Existing suites must stay green:
`npm test`, web lint/tests/build.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npm test` exits 0 (includes the two new bot test files)
- [ ] `npm --workspace @esports-community-bot/web run lint` exits 0
- [ ] `npm --workspace @esports-community-bot/web run test` exits 0 (includes match-details-model)
- [ ] `npm run web:build` exits 0
- [ ] `grep -rn "liquipedia.net" apps/web/src --include="*.tsx" --include="*.ts" | grep -v logo-url` shows no NEW direct hotlink (images go through `displayImageUrl`)
- [ ] `grep -n "match_details" scripts/postgres/schema.sql src/db/index.js scripts/migrate-sqlite-to-postgres.mjs` → present in all three
- [ ] No test file imports `axios` or fetches liquipedia.net
- [ ] `.env.example` documents `LIQUIPEDIA_MATCH_DETAILS_ENABLED`
- [ ] Only in-scope files modified (`git status`)
- [ ] `plans/README.md` row added/updated (see Index note)

## STOP conditions

Stop and report back (do not improvise) if:

- The fetched fixture pages do not contain the sections listed in "Current
  state" (Liquipedia may render match details client-side from an API for
  some wikis — if the HTML lacks the data, report what IS there instead of
  scraping another endpoint).
- Supporting the pages requires touching `client.js`/`rateState.js` or adding
  a second fetch path.
- The two fixtures' DOM structures differ so much that a shared parser core
  is impossible AND the per-game parsers each exceed ~400 lines — report
  before writing a third abstraction.
- `EXISTS(...)` subquery in `MATCHES_SQL` misbehaves on either backend.
- Anything seems to require calling Liquipedia from the web workspace or from
  tests.

## Maintenance notes

- **Adding a game later** = add its wiki key to `MATCH_DETAIL_GAMES`, write a
  `parse<Game>MatchDetails` + fixture + tests, extend the web view model with
  the new `kind`. The envelope's `version`/`kind` fields exist for this.
- **Icons follow-up** (deferred): agent/hero/item icons require warming those
  liquipedia.net image URLs into the logo cache (extend
  `src/jobs/logoWarmup.js` sources) before the proxy will serve them — never
  hotlink.
- Reviewers should scrutinize: the staleness gate in `pollOnce` (a bug there
  multiplies parse traffic), side-alignment (swapped teams silently corrupt
  every stat table), and that a details failure can never break score polling.
- Liquipedia DOM changes will rot the parsers; the fixture tests fail loudly
  in that case — refresh fixtures the same manual way (single fetch, 30s
  apart).

## Index note

`plans/README.md` on `main` does not yet contain rows 082-091 (they land when
PR #206 merges). Add this plan's row AFTER that merge, or on your branch if
the README already has the 082-091 block:

`| 092 | Rich Liquipedia match-details pages (valorant + dota2) | P2 | L | - | TODO |`
