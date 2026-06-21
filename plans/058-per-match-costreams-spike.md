# Plan 058 (SPIKE): Per-match co-streams — surface `channelsForMatch` on match views

> **This is a design/spike plan, not a build-everything plan.** It defines the
> surface, lists the open product decisions, and scopes a thin first slice. Do
> NOT dispatch an executor to build this until the maintainer answers the open
> questions below — the placement is a product call.

## Status

- **Priority**: P3 (direction)
- **Effort**: M–L (depends on chosen surface)
- **Risk**: LOW (additive, read-only)
- **Depends on**: none (057 is independent)
- **Category**: direction
- **Planned at**: commit `ec39ad6`, 2026-06-21

## Why this matters (the asymmetry)

`channelsForMatch({ gameSlug, teamA, teamB, matchExternalId, includeEwc })`
already exists in `src/db/streamChannels.js` and is **tested**
(`tests/streamChannels.test.mjs` — it unions game/team/match/ewc scopes and
dedupes). It was built precisely so a match can show "who is co-streaming this
match." But **nothing consumes it** — the only public co-stream surface is the
EWC list at `/co-streams`. The per-game / per-team / per-match scopes in the
admin UI are therefore invisible to viewers. This is a one-directional
pair: the data layer supports per-match co-streams; the UI doesn't exist.

## Current state (what's already there)

- `src/db/streamChannels.js` → `channelsForMatch(...)`: returns the applicable
  channels for a match (game-scope for the match's game, team-scope for either
  team, match-scope by external id, optional EWC list), deduped by
  platform+handle.
- `src/db/streamChannelStatus.js` → `getStreamStatuses(pairs)`: live status by
  `platform:handle`.
- `apps/web/src/components/streams/stream-embed.tsx`: the Twitch/Kick iframe.
- `apps/web/src/lib/co-streams.ts`: the channel+status join + creator grouping
  pattern to reuse.
- Match data on the web: tournament/match views live under
  `apps/web/src/components/tournaments/` and `apps/web/src/app/tournaments/`
  (the executor must read these to find where a per-match panel fits — a match
  row has `source`, `external_id`, `game`, `team_a`, `team_b`).

## Open product decisions (answer before building)

1. **Surface placement** — where do per-match co-streams appear?
   (a) a small "Co-streaming this match" strip on the existing match list/cards;
   (b) a dedicated match-detail view; (c) only show when at least one applicable
   channel is **live**. Recommendation: (c) + (a) — a compact "🔴 live co-streams"
   row that appears on a match only when someone is live, linking/embedding.
2. **Embed vs link on match views** — full iframe embed inline (heavy, one per
   live match) vs. a "Watch" link/expand. Recommendation: link/expand to keep
   match lists light; reuse `/co-streams` for the full embed experience.
3. **Include the EWC list per match?** EWC official co-streamers cover EWC
   matches broadly — include them on EWC matches (`includeEwc: true` when the
   match is an EWC tournament) but not on every match.

## Thin first slice (once decisions are made)

1. `apps/web/src/lib/match-co-streams.ts` (server): given a match
   (`game`, `team_a`, `team_b`, `external_id`, EWC flag), call
   `channelsForMatch` + `getStreamStatuses`, return only **live** applicable
   channels (grouped by creator, reuse `co-streams.ts` helpers).
2. A presentational component that renders the live co-streams for a match as
   compact platform-logo links (reuse `platform-icon.tsx` from plan 057).
3. Wire it into the chosen match surface behind a "has ≥1 live" guard.
4. Tests: a pure test of the match→live-channels selection (model after
   `tests/streamChannels.test.mjs` for the DB part; a web pure test for the
   grouping/guard).

## STOP / hand-back

Do not build until decisions 1–3 are answered. When they are, this spike
becomes a normal implementation plan (new number) with the chosen surface
inlined and exact match-view files cited from a fresh read.

## Maintenance notes

- Depends on plan 057 Part D (`platform-icon.tsx`) for the logos — land 057
  first if both proceed.
- Per-match embeds multiply the Twitch `parent` requirement across many
  match cards; prefer links over inline iframes on list views for performance.
