# Design: Tournaments & live matches on the web dashboard

> Spike for plan 011. Status: draft. Every data claim below is grounded in a
> `file:line` reference verified during the spike.

---

## Goal

Surface the tournament and match data that the bot already writes to SQLite on
the web dashboard. Phase 1 is a read-only public page: `/tournaments` (list)
and `/tournaments/[id]` (per-tournament match view). Phase 2 adds admin tools
behind the existing `requireAdmin` guard (plan 006's pattern).

Single-guild constraint: this deployment always serves exactly one Discord
guild. No guild picker. The guild ID is read from
`process.env.EWC_DASHBOARD_DEFAULT_GUILD_ID` via `defaultPublicGuildId()` in
`apps/web/src/lib/env.ts:3-10`.

---

## Data inventory

### `tournaments` table (`src/db/index.js:6-18`)

| Column        | Type    | Notes                                      |
|---------------|---------|--------------------------------------------|
| `id`          | INTEGER | PK, auto-increment                         |
| `source`      | TEXT    | `'pandascore'`, `'startgg'`, `'liquipedia'`|
| `external_id` | TEXT    | Source-specific identifier                 |
| `game`        | TEXT    | Game slug (nullable)                       |
| `name`        | TEXT    | Display name (nullable)                    |
| `url`         | TEXT    | Link to source page (nullable)             |
| `guild_id`    | TEXT    | Always the single guild's Discord snowflake|
| `added_by`    | TEXT    | Discord user ID who added it               |
| `active`      | INTEGER | 1 = tracked, 0 = deactivated               |
| `created_at`  | TEXT    | datetime string                            |

UNIQUE constraint on `(source, external_id, guild_id)`.

Read helper: `src/db/tournaments.js:25-31` — `listActiveTournaments(guildId)`
returns all rows with `active = 1`, ordered by `created_at DESC`.

### `matches` table (`src/db/index.js:20-38`)

| Column           | Type    | Notes                                           |
|------------------|---------|-------------------------------------------------|
| `id`             | INTEGER | PK                                              |
| `tournament_id`  | INTEGER | FK → tournaments.id (CASCADE DELETE)            |
| `source`         | TEXT    | Same enum as tournaments                        |
| `external_id`    | TEXT    | Source match ID                                 |
| `name`           | TEXT    | Match label (nullable)                          |
| `team_a`         | TEXT    | Default `'TBD'`                                 |
| `team_b`         | TEXT    | Default `'TBD'`                                 |
| `logo_a`         | TEXT    | Liquipedia image URL (nullable, added by migration at `src/db/index.js:90-93`)|
| `logo_b`         | TEXT    | Liquipedia image URL (nullable)                 |
| `score_a`        | INTEGER | Nullable until live/finished                    |
| `score_b`        | INTEGER | Nullable until live/finished                    |
| `status`         | TEXT    | `'scheduled'`, `'running'`, `'finished'`        |
| `scheduled_at`   | INTEGER | Unix seconds (nullable); Discord `<t:…>` timestamps built from this |
| `last_polled_at` | TEXT    | Last poll datetime                              |
| `updated_at`     | TEXT    | Row update time                                 |

UNIQUE constraint on `(source, external_id)`.
Status lifecycle: `scheduled` → `running` → `finished` (never reversed by the polling code).
Score granularity: integer win-count per team (e.g. `2 - 1` in a Bo3). Null means
not yet scored, so `score_a != null && score_b != null` is the guard used in rendering
(`src/lib/matchMessage.js:22-24`).

Read helper: `src/db/matches.js:87-100` — `getMatchesForGuild(guildId)` joins
`matches` with `tournaments` (adds `game`, `tournament_name`, `tournament_url`,
`tournament_path`, `tournament_source`) and applies `dedupeMatches` to collapse
duplicate rows for the same match from different sources
(`src/db/matches.js:65-83`).

### `game_leaderboards` table (`src/db/index.js:98-106`)

Discord-only. Stores channel/message IDs for leaderboard Discord messages.
Not needed for the web surface.

### `match_card_messages` table (`src/db/index.js:131-139`)

Discord-only. Stores which Discord messages hold a match card image.
Not needed for the web surface.

### Update cadence

The bot's polling jobs refresh running/upcoming matches roughly every 5 min;
Liquipedia's API is cached 15 min in prod. Web routes read the same SQLite file
via the `@bot/` monorepo alias (same pattern as
`apps/web/src/app/leaderboard/[guildId]/[season]/page.tsx:21` which imports
`@bot/lib/ewcProfileStats.js` directly).

### Logo handling

Logo URLs in `logo_a` / `logo_b` are raw Liquipedia `commons/images/…` URLs.
The bot caches and pre-processes them into binary files under `data/logo-cache/`
(keyed by SHA-256 of the URL), using `@napi-rs/canvas` for light-mode inversion
(`src/lib/logoCache.js:172-218`). **The web process cannot use this cache
safely** because:

1. The cache is written and read by the bot process; concurrent access from
   Next.js would require cross-process locking.
2. `@napi-rs/canvas` is a native module that does not need to run in the web
   process.

**Recommendation**: proxy the logo URL directly via an `<img src={logoUrl}>` in
the browser. Liquipedia URLs are publicly accessible. For production, an
optional Next.js image-proxy route (`/api/logo-proxy?url=…`) can revalidate
and serve cached responses using `fetch()` with a `next: { revalidate: 3600 }`
hint — but this is not required for phase 1. **Open question Q1** (see below).

---

## API contract

Both endpoints are **public** (no session required), consistent with the public
leaderboard at `apps/web/src/app/api/ewc/[guildId]/[season]/leaderboard/route.ts`
which gates zero reads on auth. Tournament data is one guild's public competitive
data; there is no PII.

### `GET /api/tournaments`

Returns active tournaments for the configured guild.

**Route file**: `apps/web/src/app/api/tournaments/route.ts`

```
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
```

**Response shape**:
```json
{
  "tournaments": [
    {
      "id": 1,
      "name": "EWC 2026 — CS2",
      "game": "cs2",
      "source": "liquipedia",
      "url": "https://liquipedia.net/counterstrike/EWC/2026",
      "active": 1,
      "created_at": "2026-05-01T12:00:00",
      "matchCounts": { "running": 0, "scheduled": 3, "finished": 12 }
    }
  ]
}
```

Implementation: `listActiveTournaments(guildId)` from `src/db/tournaments.js`,
then for each tournament one aggregation query (or a single JOIN with GROUP BY)
to populate `matchCounts`. The guild ID comes from `defaultPublicGuildId()`.

**Validation**: if `defaultPublicGuildId()` returns an empty string, return
`{ "tournaments": [] }` rather than a 500 — same graceful-empty pattern used by
existing pages.

### `GET /api/tournaments/[id]/matches`

Returns matches for one tournament, grouped by status.

**Route file**: `apps/web/src/app/api/tournaments/[id]/matches/route.ts`

**Path param**: `id` — validate with `parseInt` and check `> 0`; also verify the
tournament's `guild_id` matches the configured guild (prevents cross-guild reads
if the bot is ever reused in a different guild context).

**Query params**:
- `status` (optional): `running` | `scheduled` | `finished` — filter by single
  status. Omit to return all.
- `limit` (optional): integer, default 50, max 200 — use `clampInt` from
  `apps/web/src/lib/validate.ts`.
- `offset` (optional): integer, default 0, max 100000 — `clampInt`.

**Response shape**:
```json
{
  "tournament": { "id": 1, "name": "EWC 2026 — CS2", "game": "cs2", "url": "…" },
  "matches": {
    "running": [ /* match rows */ ],
    "scheduled": [ /* match rows */ ],
    "finished": [ /* match rows */ ]
  },
  "total": 15
}
```

Each match row: `{ id, name, team_a, team_b, logo_a, logo_b, score_a, score_b, status, scheduled_at, updated_at }`.

**Ordering**: running first, then upcoming by `scheduled_at ASC`, then finished
by `scheduled_at DESC` (most recent result first). Mirrors the ordering in
`src/db/matches.js:94-96`.

**Pagination**: applied to `finished` only (potentially hundreds); `running` and
`scheduled` are always returned in full (typical count is 0–10 for a tournament
in progress).

---

## Pages & components

### `/tournaments` — Tournament list page

**File**: `apps/web/src/app/tournaments/page.tsx`
**Convention**: `runtime = "nodejs"`, `dynamic = "force-dynamic"`, locale via
`getRequestLocale()` — exactly as `apps/web/src/app/games/page.tsx:25` and
`apps/web/src/app/media/page.tsx:35`.

**Wireframe** (server component, reads DB directly like the leaderboard page):

```
┌─────────────────────────────────────────────────────────────┐
│ [Badge: TrophyIcon  "Tournaments"]                          │
│                                                             │
│ h1: "Tracked tournaments"                                   │
│ p:  "Live match data from the community's tracked events."  │
│                                                             │
│ [3-column card grid]                                        │
│ ┌────────────────┐ ┌────────────────┐ ┌────────────────┐   │
│ │ Badge: "CS2"   │ │ Badge: "Dota2" │ │ Badge: "LoL"   │   │
│ │ CardTitle:     │ │                │ │                │   │
│ │ "EWC 2026 CS2" │ │ "…"            │ │ "…"            │   │
│ │ ── ── ── ──   │ │                │ │                │   │
│ │ 0 live         │ │                │ │                │   │
│ │ 3 upcoming     │ │                │ │                │   │
│ │ 12 finished    │ │                │ │                │   │
│ │ [View matches →]│ │               │ │                │   │
│ └────────────────┘ └────────────────┘ └────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

**Components used**:
- `Badge` (variant `"outline"` for eyebrow, variant `"secondary"` for game slug
  — mirrors `apps/web/src/app/games/page.tsx:46,61`)
- `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`
  (from `apps/web/src/components/ui/card.tsx`)
- `Button` with `render={<Link>}` for "View matches" CTA
- `TrophyIcon` (already in `lucide-react`, used in leaderboard and nav)

EWC gold accent: apply to `running` count text via `text-primary` or an inline
`className="text-yellow-500"` — operator decides the exact color token. The same
accent pattern appears in `src/lib/matchCard.js:529-533`.

**Empty state**: if `listActiveTournaments(guildId)` returns `[]`, render a
single paragraph (same `text-sm text-muted-foreground` pattern as
`apps/web/src/app/media/page.tsx:103-105`).

**i18n copy to add** to `apps/web/src/lib/i18n.ts`:
```typescript
// en
tournaments: {
  eyebrow: "Tournaments",
  title: "Tracked tournaments",
  description: "Live match data from the community's tracked events.",
  empty: "No tournaments tracked yet.",
  live: "Live",
  upcoming: "Upcoming",
  finished: "Finished",
  viewMatches: "View matches",
}
// ar
tournaments: {
  eyebrow: "البطولات",
  title: "البطولات المتابَعة",
  description: "بيانات المباريات المباشرة من الفعاليات التي يتابعها المجتمع.",
  empty: "لا توجد بطولات متابَعة بعد.",
  live: "مباشر",
  upcoming: "القادمة",
  finished: "المنتهية",
  viewMatches: "عرض المباريات",
}
```

### `/tournaments/[id]` — Per-tournament matches view

**File**: `apps/web/src/app/tournaments/[id]/page.tsx`
**Convention**: same as above; `[id]` validated with `parseInt`.

**Wireframe**:

```
┌─────────────────────────────────────────────────────────────┐
│ [← Back to tournaments]                                     │
│                                                             │
│ Badge: "CS2"   Badge: "LIVE" (red, only if running > 0)    │
│ h1: "EWC 2026 — CS2"                                       │
│ [Liquipedia ↗] (if url present)                            │
│                                                             │
│ ── Live now ─────────────────────────────────────────────  │
│ [MatchCard row: Team A  2 - 1  Team B]                     │
│                                                             │
│ ── Upcoming ─────────────────────────────────────────────  │
│ [Table rows: time | Team A vs Team B | scheduled_at]       │
│                                                             │
│ ── Results ──────────────────────────────────────────────  │
│ [Table rows: date | Team A score - score Team B | status]  │
│ [← Prev  Page 1/3  Next →]                                 │
└─────────────────────────────────────────────────────────────┘
```

**Components used**:
- `Badge` with `"destructive"` variant for live indicator
- `Card`, `CardHeader`, `CardContent` for match cards in live section
- `Table`, `TableBody`, `TableRow`, `TableCell`, `TableHead` from
  `apps/web/src/components/ui/table.tsx` for upcoming and results
- `Button` for back nav and pagination
- `Separator` between sections

**Match card (live section)**: a simple `<Card>` with two team names, logos
(`<img>` tags — see Logo handling above), and score. No canvas rendering in the
web process. Keep it simple: `team_a  score_a – score_b  team_b` in large text.

**Client component pattern**: the per-tournament page can be a server component
reading the DB directly for the initial render (same as the leaderboard page).
Auto-refresh is handled by a thin `"use client"` child component using
`@tanstack/react-query` — mirrors `apps/web/src/components/dashboard/profile-dashboard.tsx:1-3`.

---

## Refresh & caching strategy

**Recommendation: TanStack Query `refetchInterval: 90_000` (90 seconds).**

Reasoning: the bot polls at most every 5 min; Liquipedia adds another 15 min of
cache. A 90 s UI poll wastes no meaningful resources and keeps the view current
within 1–2 polling cycles of a real score change. The Discord match-card
behavior (same source data) shows a "LIVE" badge the moment the bot's poll
catches the status change — the web view would trail by at most 90 s, which is
acceptable. 60 s would also work but adds unnecessary load; 120 s risks the page
feeling stale during active matches.

**Initial render**: server component; data is SSR'd from the DB on first load.
The client component takes the SSR data as `initialData` and begins polling from
it. This avoids a flash of empty content, consistent with how
`apps/web/src/app/leaderboard/[guildId]/[season]/page.tsx:34` handles its initial
data.

---

## Auth decision

**Public read, no session required.**

Justification: this is community-facing tournament data for a single public
Discord guild. The existing public leaderboard (`/leaderboard/[guildId]/[season]`)
sets the precedent — it returns member prediction data with zero auth. Tournament
results are less sensitive than member data. Gating it on login would add friction
for exactly the audience (casual spectators, Discord members on mobile) who would
benefit most from a quick tournament view.

Phase 2 admin tools (add/remove tournaments) are session-gated via
`getAdminAccess()` from `apps/web/src/lib/admin.ts:50`, with the `isSuper` guard
(`apps/web/src/lib/admin.ts:96`) for destructive actions — identical to how
`apps/web/src/app/api/admin/games/route.ts:19` guards the `POST` handler.

---

## Logo handling (open question Q1)

Logo URLs stored in `matches.logo_a` / `logo_b` are raw Liquipedia
`commons/images/…` URLs. Three options:

| Option | Pros | Cons |
|--------|------|------|
| **A. `<img src={logoUrl}>` directly** | Zero infra, works immediately | Exposes Liquipedia referer to browser; light-mode logos may appear dark on dark theme |
| **B. Next.js Image with `remotePatterns`** | Automatic resizing, lazy load | Requires adding Liquipedia to `next.config` `remotePatterns`; still no dark-mode fix |
| **C. `/api/logo-proxy?url=…` route** | Can apply the light-mode inversion from `src/lib/logoCache.js:184-218`; CDN-cacheable | Adds one more route; ~30 lines of code |

**Recommendation**: start with option A for phase 1 — it requires no new code
and the Liquipedia ToS allows embedding. Upgrade to C if the dark-theme logo
contrast problem is reported by users.

**Decision needed from operator** (Q1): Is the light-mode logo contrast issue a
known problem on the current Discord dark theme? If yes, build option C in phase 1.

---

## Phasing

### Phase 1 — Read-only public surface (this build)

Files to create/modify:

| File | Change |
|------|--------|
| `apps/web/src/app/tournaments/page.tsx` | New — tournament list |
| `apps/web/src/app/tournaments/[id]/page.tsx` | New — per-tournament matches |
| `apps/web/src/app/api/tournaments/route.ts` | New — list endpoint |
| `apps/web/src/app/api/tournaments/[id]/matches/route.ts` | New — matches endpoint |
| `apps/web/src/components/dashboard/tournament-match-list.tsx` | New — client component for live-refresh |
| `apps/web/src/lib/i18n.ts` | Add `tournaments` copy block |
| `apps/web/src/components/site-header-client.tsx` | Add "Tournaments" item to Browse dropdown |

**Estimated effort**: 5 new files + 2 edits. Based on the leaderboard route
(~20 lines) and games page (~137 lines) as benchmarks, this is roughly 400–500
lines of straightforward TypeScript. Call it **S** (small) — 1–2 days for a
developer familiar with the codebase.

### Phase 2 — Admin tools (separate build plan, plan 006 pattern)

- Add tournament from a URL or external ID (Liquipedia/PandaScore/start.gg)
- Deactivate a tracked tournament
- These actions call `addTournament()` / `deactivateTournament()` from
  `src/db/tournaments.js` (bot-side helpers already exist)
- Route: `apps/web/src/app/api/admin/tournaments/route.ts` — guarded with
  `getAdminAccess()` + `isSuper` (same as `apps/web/src/app/api/admin/games/route.ts:9,19`)
- Admin page: `apps/web/src/app/admin/tournaments/page.tsx`
- Effort: **M** (≈ same scope as the existing admin games page)

---

## Effort estimate

| Deliverable | Files | Estimated LOC | Effort |
|-------------|-------|--------------|--------|
| Phase 1 API routes (2) | 2 | ~60 | — |
| Phase 1 pages (2) | 2 | ~250 | — |
| Phase 1 client component | 1 | ~120 | — |
| i18n + nav edits | 2 | ~40 | — |
| **Phase 1 total** | **7** | **~470** | **S (1–2 days)** |
| Phase 2 admin tools | ~4 | ~300 | M (2–3 days) |

---

## Open questions for the operator

**Q1 — Logo rendering strategy** (see Logo handling above):
Do you want dark-theme logo correction (requires `/api/logo-proxy` route) in
phase 1, or is option A (direct `<img>`) acceptable to start?
_Recommendation: start with option A._

**Q2 — `tournaments` table populated?**
The spike did not connect to the live database. Before building, confirm with
`SELECT COUNT(*) FROM tournaments WHERE active=1;` that there are tracked
tournaments. If the table is empty, the page will render an empty state cleanly
but there is nothing to demonstrate.
_This is the STOP condition from the spike plan — verify before commissioning
the build._

**Q3 — Navigation placement**:
Should `/tournaments` appear in the Browse dropdown (alongside Games, News,
Media, Predictions) in `apps/web/src/components/site-header-client.tsx:91-108`?
Or as a top-level nav item?
_Recommendation: add as a DropdownMenuItem in the existing Browse group, below
Predictions. It matches the community-data pattern of that group._

**Q4 — Timestamp display timezone**:
The bot renders times as `Asia/Riyadh` (UTC+3) in Discord match cards
(`src/lib/matchCard.js:151-167`). The web should use the user's local timezone
via `toLocaleDateString()` / `toLocaleTimeString()` in the browser. Confirm this
is the desired behavior, or should UTC+3 be enforced on the web too?
_Recommendation: browser local time for the web (standard web convention); the
Discord cards are a different medium._

**Q5 — Deduplication in API routes**:
`getMatchesForGuild` already deduplicates via `dedupeMatches`
(`src/db/matches.js:65-83`). The per-tournament matches endpoint will query a
single tournament's matches directly, bypassing this cross-tournament dedup. This
is correct — dedup is only needed when showing all-games matches together. But if
a single tournament has duplicate rows (e.g. same match from two sources), the
per-tournament view will show both. Is this a known issue in practice?
_Recommendation: run `SELECT COUNT(*) FROM matches WHERE tournament_id = X GROUP BY source` on an active tournament to check before building._

---

## Prototype status

Step 4 (optional prototype route) was **skipped** per plan instructions
("prefer skipping it" in executor override). All data claims above are grounded
in reading the actual source files. The DB read path is the same pattern as the
existing leaderboard page (`apps/web/src/app/leaderboard/[guildId]/[season]/page.tsx:21`)
which has been shipped and verified.
