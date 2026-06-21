# Plan 059: Per-match co-stream strip on live match cards

> **Executor instructions**: Follow step by step. Run every verification command
> and confirm the expected result before moving on. Touch only in-scope files. If
> a STOP condition occurs, stop and report — do not improvise.
>
> **Drift check (run first)**:
> `git diff --stat 30d4a5e..HEAD -- src/db/streamChannels.js apps/web/src/lib/tournaments.ts apps/web/src/components/tournaments/tournament-match-list.tsx apps/web/src/lib/i18n.ts`
> If any changed since `30d4a5e` and the "Current state" excerpts no longer match, STOP.

## Status

- **Priority**: P3 (direction → build)
- **Effort**: M
- **Risk**: LOW (additive, read-only; one new bot query helper)
- **Depends on**: 057 (uses `apps/web/src/components/platform-icon.tsx` — already merged at `30d4a5e`)
- **Category**: direction / feature
- **Planned at**: commit `30d4a5e`, 2026-06-21
- **Supersedes**: 058 (the spike — product decisions now answered, see below)

## Decisions (answered by the maintainer — build to these)

1. **Placement**: a compact live strip on the **"Live now" match cards** of the
   tournament-detail page, shown **only when ≥1 applicable channel is live**.
2. **Watch mode**: **links**, not inline embeds — platform-logo links per live
   channel (no iframe per match). Keeps the live-card grid light.
3. **EWC list**: include the official EWC co-stream list **only when the match's
   tournament is an EWC tournament** (`isEwcTournament`).

## Why this matters

`channelsForMatch(...)` in `src/db/streamChannels.js` is built and tested but
**unconsumed** — the per-game / per-team / per-match co-stream scopes never reach
viewers. This surfaces "who's co-streaming this live match" exactly where people
watch it, reusing the live-status the poller already writes.

## Current state

- **`apps/web/src/lib/tournaments.ts`** — server, read-only. `getTournamentMatches(id, …)`
  builds the payload; `publicMatch(row)` (lines ~102-116) maps a DB row to the
  client shape and **drops `external_id`/`game`**. The raw rows include
  `external_id` (see `MATCH_COLUMNS`) and `tournament.game`/`tournament` is in
  scope. `isEwcTournament(t)` (lines ~83-90) returns the EWC flag. `MatchRow`
  type (lines ~49-63) and `TournamentMatches` (65-69) are exported. Caching:
  `getTournamentMatchesCached` (revalidate 60s) wraps it.
- **`apps/web/src/components/tournaments/tournament-match-list.tsx`** — `"use client"`,
  polls `/api/tournaments/[id]/matches` every 90s via react-query. Renders running
  matches as cards (the `running.map((m) => <Card>…</Card>)` block, ~lines 150-171).
  Local `MatchRow` type at lines 26-38. The card's `<CardContent>` currently holds
  one row (team A / score / team B).
- **`src/db/streamChannels.js`** — has `channelsForMatch({ gameSlug, teamA, teamB, matchExternalId, includeEwc })`
  (per single match) using distinct `$n` placeholders, importing `normalizeTeamName`
  from `../lib/render.js`. `hydrate(row)` returns `{ id, platform, handle, label, …, url }`.
- **`apps/web/src/lib/co-streams.ts`** — `getStreamStatuses` is imported from
  `@bot/db/streamChannelStatus.js` (status by `platform:handle`).
- **`apps/web/src/components/platform-icon.tsx`** — `PlatformIcon({ platform, className })`
  (from plan 057). Reuse it for the logo links.
- **`apps/web/src/lib/i18n.ts`** — `copy[locale].tournaments` holds the match-view
  strings (en around line 145+, ar around line 430+; find by the `tournaments:` key).

## Commands

| Purpose | Command | Expected |
|---|---|---|
| Install | `npm install` | exit 0 |
| Bot tests | `npm test` | all pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Web build | `npm run web:build` | exit 0 |

## Scope

**In scope**:
- `src/db/streamChannels.js` (add one helper)
- `tests/streamChannels.test.mjs` (test the helper)
- `apps/web/src/lib/match-co-streams.ts` (create)
- `apps/web/src/lib/tournaments.ts` (attach co-streams to running matches)
- `apps/web/src/components/tournaments/tournament-match-list.tsx` (render strip)
- `apps/web/src/lib/i18n.ts` (one copy key)
- `apps/web/src/test/match-co-streams.test.ts` (create)

**Out of scope**: the `/co-streams` page + `co-streams.ts` (leave untouched); the
upcoming/finished match tables (strip is live-only); any embed iframe; the admin UI.

## Steps

### Step 1 — Batched tournament-level channel query (bot)

In `src/db/streamChannels.js`, add a helper that returns every channel applicable
to ANY of a tournament's running matches in ONE query (so we don't run
`channelsForMatch` per match — an EWC 1v1 open can have 100+ live matches).

```js
// Every channel applicable to a tournament's running matches in one query:
// game-scope for the game, the EWC list (optional), team-scope for any of the
// given teams, and match-scope for any of the given match external ids. Hydrated;
// callers filter per-match in memory. Distinct placeholders only (no $n reuse).
export async function channelsForTournament({ gameSlug = null, teams = [], matchExternalIds = [], includeEwc = false } = {}) {
  const teamKeys = [...new Set(teams.map(normalizeTeamName).filter(Boolean))];
  const matchIds = [...new Set(matchExternalIds.map((v) => String(v ?? '').trim()).filter(Boolean))];
  const params = [];
  const ors = [];
  const gs = cleanGameSlug(gameSlug);
  if (gs) {
    params.push(gs);
    const single = `$${params.length}`;
    params.push(`%"${gs}"%`);
    ors.push(`(scope = 'game' AND (game_slug = ${single} OR game_slugs LIKE $${params.length}))`);
  }
  if (includeEwc) ors.push(`(scope = 'ewc')`);
  if (teamKeys.length) {
    const ph = teamKeys.map((t) => { params.push(t); return `$${params.length}`; });
    ors.push(`(scope = 'team' AND team_key IN (${ph.join(',')}))`);
  }
  if (matchIds.length) {
    const ph = matchIds.map((m) => { params.push(m); return `$${params.length}`; });
    ors.push(`(scope = 'match' AND match_external_id IN (${ph.join(',')}))`);
  }
  if (!ors.length) return [];
  const rows = await all(`SELECT * FROM stream_channels WHERE active = 1 AND (${ors.join(' OR ')}) ORDER BY sort_order ASC, id ASC`, params);
  return rows.map(hydrate);
}
```

(`cleanGameSlug`, `normalizeTeamName`, `hydrate`, `all` already exist in this file —
reuse them. Match the existing `channelsForMatch` style.)

**Verify**: `node --check src/db/streamChannels.js` → exit 0.

### Step 2 — Test the helper (bot)

In `tests/streamChannels.test.mjs`, add a test (model after the existing
`channelsForMatch unions …` test): seed a game-scope channel (game `valorant`),
a team-scope channel (team `Team Vitality`), a match-scope channel
(`Match:T-1`), and an EWC channel; call
`channelsForTournament({ gameSlug: 'valorant', teams: ['Team Vitality','Sentinels'], matchExternalIds: ['Match:T-1'], includeEwc: true })`
and assert all four are returned; then call with `includeEwc: false` and assert
the EWC-only channel is absent while the game/team/match ones remain.

**Verify**: `npm test` → all pass.

### Step 3 — Web helper: live co-streams per running match

Create `apps/web/src/lib/match-co-streams.ts` (`import "server-only"`):

```ts
import "server-only";
import { channelsForTournament } from "@bot/db/streamChannels.js";
import { getStreamStatuses } from "@bot/db/streamChannelStatus.js";
import { normalizeTeamName } from "@bot/lib/render.js";
import type { StreamPlatform } from "@/lib/stream-types";

export type MatchCoStream = { platform: StreamPlatform; handle: string; label: string; url: string | null };

type Chan = {
  platform: StreamPlatform; handle: string; label: string; url: string | null;
  scope: "game" | "team" | "match" | "ewc";
  teamKey: string | null; matchExternalId: string | null;
};
type RunningLike = { external_id?: string; team_a: string | null; team_b: string | null };

const norm = normalizeTeamName as unknown as (s: string | null) => string;
const fetchChannels = channelsForTournament as unknown as (args: {
  gameSlug?: string | null; teams?: string[]; matchExternalIds?: string[]; includeEwc?: boolean;
}) => Promise<Chan[]>;
const fetchStatuses = getStreamStatuses as unknown as (
  pairs: Array<{ platform: string; handle: string }>,
) => Promise<Map<string, { isLive: boolean }>>;

// Map of match id (or external id) -> its LIVE applicable co-stream links.
export async function liveCoStreamsByMatch(
  running: Array<RunningLike & { id: number }>,
  { gameSlug, includeEwc }: { gameSlug: string | null; includeEwc: boolean },
): Promise<Map<number, MatchCoStream[]>> {
  const result = new Map<number, MatchCoStream[]>();
  if (!running.length) return result;

  const teams = running.flatMap((m) => [m.team_a, m.team_b]).filter((t): t is string => Boolean(t));
  const matchExternalIds = running.map((m) => m.external_id).filter((v): v is string => Boolean(v));
  const channels = await fetchChannels({ gameSlug, teams, matchExternalIds, includeEwc });
  if (!channels.length) return result;

  const statuses = await fetchStatuses(channels.map((c) => ({ platform: c.platform, handle: c.handle })));
  const isLive = (c: Chan) => Boolean(statuses.get(`${c.platform}:${c.handle}`)?.isLive);

  for (const m of running) {
    const teamKeys = new Set([norm(m.team_a), norm(m.team_b)].filter(Boolean));
    const seen = new Set<string>();
    const links: MatchCoStream[] = [];
    for (const c of channels) {
      if (!isLive(c)) continue;
      const applies =
        c.scope === "game" || c.scope === "ewc" ||
        (c.scope === "team" && c.teamKey != null && teamKeys.has(c.teamKey)) ||
        (c.scope === "match" && c.matchExternalId === m.external_id);
      if (!applies) continue;
      const key = `${c.platform}:${c.handle}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ platform: c.platform, handle: c.handle, label: c.label, url: c.url });
    }
    if (links.length) result.set(m.id, links);
  }
  return result;
}
```

**Verify**: `npm --workspace @esports-community-bot/web run lint` → exit 0.

### Step 4 — Attach to running matches in `tournaments.ts`

In `getTournamentMatches`, after computing `running` (the mapped public running
matches), compute live co-streams and attach them. Note `publicMatch` drops
`external_id`; pass the RAW running rows (which still have `external_id`) to the
helper, then attach onto the public objects by `id`.

- Add `coStreams?: MatchCoStream[]` to the exported `MatchRow` type (import the
  type from `@/lib/match-co-streams`).
- In `getTournamentMatches`: keep the raw running rows (before `publicMatch`),
  call `liveCoStreamsByMatch(rawRunning, { gameSlug: tournament.game, includeEwc: isEwcTournament(tournament) })`,
  then map each public running match to include `coStreams: map.get(m.id) ?? undefined`.

Concretely, replace the running line:
```ts
const rawRunning = rows.filter((m) => m.status === "running");
const coStreamMap = await liveCoStreamsByMatch(rawRunning, {
  gameSlug: tournament.game,
  includeEwc: isEwcTournament(tournament),
});
const running = rawRunning.map((m) => ({ ...publicMatch(m), coStreams: coStreamMap.get(m.id) }));
```
(`isEwcTournament` already takes `{ name, external_id, url }` — `tournament` is a
`TournamentRow`, which has all three. Good.)

This runs inside `getTournamentMatchesCached` (60s) — co-stream liveness is at
most ~60s stale, which matches the poll cadence. Fine.

**Verify**: `npm --workspace @esports-community-bot/web run test` → all pass (existing
tournaments tests still green); `npm run web:build` → exit 0.

### Step 5 — Render the strip (client)

In `tournament-match-list.tsx`:
- Add `coStreams?: { platform: string; handle: string; label: string; url: string | null }[]`
  to the local `MatchRow` type.
- Import `PlatformIcon` from `@/components/platform-icon`.
- Inside the running match `<Card>`, after the existing `<CardContent>` row, when
  `m.coStreams?.length`, render a compact strip: a small `🔴`/`RadioIcon` +
  the localized "Co-streaming" label + one logo link per channel:
  ```tsx
  {m.coStreams?.length ? (
    <div className="flex flex-wrap items-center gap-2 border-t px-3 py-1.5 text-xs text-muted-foreground">
      <RadioIcon className="size-3 text-primary" />
      <span>{text.coStreaming}</span>
      {m.coStreams.map((c) => (
        <a key={`${c.platform}:${c.handle}`} href={c.url ?? "#"} target="_blank" rel="noreferrer"
           className="inline-flex items-center gap-1 hover:text-foreground" title={`${c.label} · ${c.platform}`}>
          <PlatformIcon platform={c.platform as never} className="size-3.5" />
          <span className="max-w-24 truncate">{c.label}</span>
        </a>
      ))}
    </div>
  ) : null}
  ```
  Put it inside the running `<Card>` (move the current single-row `<CardContent>`
  + this strip under one wrapper, or add the strip as a sibling block within the
  card). `RadioIcon` is already imported.

**Verify**: web lint + web build pass.

### Step 6 — i18n copy key

In `apps/web/src/lib/i18n.ts`, add `coStreaming` to `copy.en.tournaments` and
`copy.ar.tournaments` (e.g. en `"Co-streaming"`, ar `"بث مصاحب"`). Reference it as
`text.coStreaming` in the client (where `text = copy[locale].tournaments`).

**Verify**: web build → exit 0 (a missing key is a TS error).

### Step 7 — Web test for the mapping

Create `apps/web/src/test/match-co-streams.test.ts` — since `liveCoStreamsByMatch`
imports bot DB modules, test the **per-match assignment logic** by extracting the
pure filtering into a small exported helper, OR (simpler) test via a thin pure
function. If extraction is awkward, instead add the assertion to the bot test in
Step 2 and note here that the web mapping is covered by the build + the bot helper
test. **Do not** spin up a DB in the web vitest. (If you extract a pure
`applies(channel, match)` predicate and export it, test: game/ewc apply to all;
team applies only on matching normalized team; match applies only on exact id;
dedupe by platform+handle.)

**Verify**: `npm --workspace @esports-community-bot/web run test` → all pass.

## Test plan

- `tests/streamChannels.test.mjs` — `channelsForTournament` union + EWC toggle (Step 2).
- `apps/web/src/test/match-co-streams.test.ts` — the per-match predicate/dedupe (Step 7), if a pure helper is extracted.

## Done criteria (ALL)

- [ ] `npm test` exits 0 (incl. `channelsForTournament` test).
- [ ] `npm --workspace @esports-community-bot/web run test` exits 0.
- [ ] `npm --workspace @esports-community-bot/web run lint` exits 0.
- [ ] `npm run web:build` exits 0.
- [ ] `grep -n "channelsForTournament" src/db/streamChannels.js apps/web/src/lib/match-co-streams.ts` → matches in both.
- [ ] No files outside Scope are modified (`git status`).

## STOP conditions

- Drift check shows an in-scope file changed since `30d4a5e` and excerpts no longer match.
- `channelsForTournament` would need placeholder reuse to express — STOP (push every value distinctly; this repo had a Postgres crash from `$n` reuse).
- `apps/web/src/components/platform-icon.tsx` does NOT exist (plan 057 not merged) — STOP.
- Any verification fails twice after a reasonable fix attempt.

## Maintenance notes

- The strip is live-only by design (decision 1). If a future change wants
  co-streams on upcoming/finished matches, revisit `getTournamentMatches`
  (currently only `running` gets `coStreams`).
- `channelsForTournament` is the batched read; if per-match scopes grow large,
  it stays one query. A reviewer should confirm it uses distinct placeholders.
- Co-stream liveness on this surface is bounded by the 60s `getTournamentMatchesCached`
  revalidate + the 90s client poll — acceptable staleness for "is live now".
