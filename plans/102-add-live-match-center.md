# Plan 102: Add a live match center

> **Executor instructions**: Follow this plan step by step. Run every
> verification command before moving on. If a STOP condition occurs, stop and
> report; do not improvise.
>
> **Drift check**: `git diff --stat 27a04f8..HEAD -- apps/web/src/lib/tournaments.ts apps/web/src/components/tournaments/tournament-match-list.tsx apps/web/src/lib/co-streams.ts apps/web/src/lib/match-co-streams.ts apps/web/src/app/tournaments/page.tsx apps/web/src/lib/i18n.ts`

## Status

- **Priority**: P1
- **Effort**: M-L
- **Risk**: MED
- **Depends on**: plans/094-add-browser-e2e-and-production-smoke.md recommended
- **Category**: direction
- **Planned at**: commit `27a04f8`, 2026-07-17

## Why this matters

During EWC, the most common audience question is "what is live right now?"
The site already stores live/upcoming matches, match-details availability, and
co-stream mappings. This plan composes those existing projections into one
high-signal `/live` hub without adding provider traffic or new sync jobs.

## Current state

- `apps/web/src/lib/tournaments.ts` exposes cached tournament summaries and
  `getTournamentMatchesCached(id)`, including match rows and `coStreams`.
- `apps/web/src/components/tournaments/tournament-match-list.tsx` already
  renders running/scheduled/finished match rows and match-details links.
- `apps/web/src/lib/co-streams.ts` exposes cached co-stream groups; do not call
  Twitch/Kick/YouTube directly from the page.
- Public pages use `getRequestLocale`, `localizedPath`, and `copy` from
  `apps/web/src/lib/i18n.ts`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused web tests | `npm --workspace @esports-community-bot/web run test -- live-match-center` | all pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Bot tests | `npm test` | all pass |
| Build | `npm run web:build` | exit 0 |

## Scope

**In scope**:
- `apps/web/src/app/live/page.tsx` (create)
- `apps/web/src/components/live/live-match-center.tsx` (create)
- `apps/web/src/lib/live-match-center.ts` (create)
- `apps/web/src/app/api/live/route.ts` (create)
- `apps/web/src/lib/i18n.ts`
- `apps/web/src/test/live-match-center.test.ts` (create)
- `apps/web/e2e/live-match-center.spec.ts` if plan 094 is available

**Out of scope**:
- External provider fetchers and polling intervals.
- Match card PNG rendering.
- Follow, notification, or prediction schemas.
- Admin tournament configuration.

## Steps

### Step 1: Build a cached live-center projection

Create `apps/web/src/lib/live-match-center.ts`. Use existing cached tournament
helpers to return:

- all running matches, ordered by game then scheduled time;
- next 25 upcoming matches, ordered by nearest `scheduled_at`;
- recent finished matches only as a small context strip, not the main page;
- match details URLs where `has_details` is true;
- co-stream links already present on running match rows.

Keep the response public and serializable. Do not expose raw DB rows, provider
payloads, Discord IDs, or admin fields.

**Verify**: focused unit tests cover ordering, row caps, empty state, and that a
match with `has_details` gets a `/matches/[id]` href.

### Step 2: Add the API and page

Add `GET /api/live` for client refresh and `GET /live` as a server-rendered page.
The page should server-render initial data, then hydrate a small client component
that refreshes every 60-90 seconds. Use shadcn/Base UI cards, badges, tabs or
segmented controls, and no nested cards.

**Verify**: `npm --workspace @esports-community-bot/web run test -- live-match-center`
passes.

### Step 3: Link it from navigation and footer

Add a "Live" entry where it fits the existing public nav and footer. Localize EN
and AR labels. Preserve `/ar/live` routing and RTL.

**Verify**: lint passes and a manual browser check shows EN/AR links route to
the same page in the correct locale.

## Test plan

- Unit test `getLiveMatchCenter` with seeded rows across running, scheduled,
  finished, details, and co-stream metadata.
- API test that `/api/live` returns public fields only.
- E2E, when plan 094 exists: desktop and mobile screenshots for `/live` and
  `/ar/live`.

## Done criteria

- [ ] `/live` and `/ar/live` render useful content with no matches and with live matches.
- [ ] API refresh does not call external providers.
- [ ] EN/AR labels and RTL are correct.
- [ ] All verification commands pass.
- [ ] `plans/README.md` row updated.

## STOP conditions

- Existing tournament helpers cannot provide running/upcoming rows without new
  provider fetches.
- The page requires changing match persistence or polling jobs.
- E2E setup from plan 094 is missing and the reviewer requires visual proof.

## Maintenance notes

This page will become the primary public match surface. Reviewers should watch
for accidental provider fetches during requests and for unbounded list sizes.
