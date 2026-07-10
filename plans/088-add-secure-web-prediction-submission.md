# Plan 088: Add secure website prediction submission

> **Executor instructions**: Do not call prediction DB upsert helpers directly
> from a route. This plan is permitted only after plan 082 establishes one
> trusted lock/validation service. Run every authorization, deadline, and
> concurrency test before visual work is considered complete.
>
> **Drift check (run first)**: `git diff --stat 2301227..HEAD -- src/lib/ewcPredictionWrites.js src/lib/ewcPredictionRounds.js apps/web/src/app/api/me/ewc apps/web/src/lib/ewc-profile-sync.ts apps/web/src/app/predictions/page.tsx apps/web/src/components/dashboard/profile-dashboard.tsx apps/web/src/lib/community.ts apps/web/src/lib/rate-limit.ts apps/web/src/lib/i18n.ts`

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: plans 082, 083, and 084
- **Category**: direction
- **Planned at**: commit `2301227`, 2026-07-10

## Why this matters

The website already authenticates members with Discord and shows their private
prediction progress, but it tells them to return to Discord to act. A secure
web picker removes that context switch and makes mobile completion much easier.
It also expands the write surface of the scoring system, so the website must be
a thin authenticated adapter over the exact domain service used by Discord,
with server-derived identity, guild, season, timestamps, and club resolution.

## Current state

- `apps/web/src/app/predictions/page.tsx:43-63` says picks are made in Discord
  and offers profile/leaderboard links only.
- `apps/web/src/lib/ewc-profile-sync.ts:60-85` already resolves the signed-in
  user's Discord account and prediction profile.
- No web route calls `upsertWeeklyGamePick`, `upsertSeasonClubPick`, or a shared
  prediction-write service.
- `apps/web/src/app/api/me/ewc/sync/route.ts:15-31` is the mutation exemplar:
  same-origin check, server session, per-user rate limit, and strict validation.
- `apps/web/src/lib/community.ts:115-139` provides `requireVerifiedMember`,
  including guild verification and blocked-user enforcement. Web prediction
  writes must use it, not session-only authorization.
- Plan 082 owns trusted request timestamps, lock revalidation, atomic writes,
  and canonical club resolution. Plan 083 owns all actionable rounds; plan 084
  owns completion and deadline projections.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused web tests | `npm --workspace @esports-community-bot/web run test -- src/test/ewc-web-picks-api.test.ts src/test/ewc-web-picker-model.test.ts src/test/ewc-sync.test.ts` | all pass |
| Shared write tests | `node --test tests/ewcPredictionWrites.test.mjs` | all pass |
| Bot suite | `npm test` | all pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Native typecheck | `npm --workspace @esports-community-bot/web run typecheck:native` | exit 0 |
| Web build | `npm run web:build` | exit 0 |

## Suggested executor toolkit

- Invoke the `shadcn` skill. Use Base UI/shadcn Field, Select/Combobox,
  Command, Progress, Alert, Dialog, and Button primitives already configured.
- Use browser acceptance at 390x844, 768x1024, and 1440x900 in both locales.

## Scope

**In scope**:

- `apps/web/src/app/api/me/ewc/picks/weekly/route.ts` (new)
- `apps/web/src/app/api/me/ewc/picks/season/route.ts` (new)
- A focused web adapter in `apps/web/src/lib/ewc-prediction-writes.ts`
- New picker components under `apps/web/src/components/predictions/`
- `apps/web/src/app/predictions/page.tsx`
- `apps/web/src/components/dashboard/profile-dashboard.tsx`
- Prediction copy in `apps/web/src/lib/i18n.ts`
- Web API/model tests
- Minimal cache invalidation tags needed after a successful pick

**Out of scope**:

- A public or unauthenticated prediction-write API.
- Admin/MCP write tools for member picks.
- Client-supplied Discord ID, guild ID, season, score, deadline, canonical club
  name, or `pickedAt`.
- Scoring/ranking changes.
- New Liquipedia request paths or browser-to-Liquipedia calls.

## Git workflow

- Branch: `advisor/088-web-prediction-submission`
- Suggested commit: `feat: submit EWC predictions from the website`
- Do not push or open a PR unless requested.

## Steps

### Step 1: Write the authorization and abuse-control matrix first

Add API tests for both routes covering:

- anonymous (401), signed-in non-member/unverified/blocked (403);
- cross-origin and origin-less POST (403);
- missing Discord account/profile link;
- client attempts to submit another Discord ID, guild, season, timestamp, score,
  or locked round;
- malformed/oversized game keys and club names;
- per-user and Cloudflare-IP rate limits with `Retry-After`;
- idempotent retry and concurrent writes;
- successful weekly and season changes using the authenticated member ID.

Do not expose whether another member has picks through error differences.

**Verify**: tests fail because the routes do not exist, then remain the contract
for every later step.

### Step 2: Add a narrow server adapter

Create `apps/web/src/lib/ewc-prediction-writes.ts` that:

1. accepts the verified `CommunityMember` from `requireVerifiedMember`;
2. resolves the configured single guild and current season server-side from
   the member's link/default settings;
3. captures `submittedAt` at route entry before body parsing/name resolution;
4. validates only opaque round/game/slot identifiers and raw user-entered pick;
5. calls plan 082's command-free service;
6. invalidates private progress and public participant-count caches after success.

Do not import `src/commands/ewc_predict.js` into Next.js and do not duplicate
`gameClosedMessage` in TypeScript.

**Verify**: route unit tests can inject the service; integration tests exercise
the real shared service against a disposable DB.

### Step 3: Implement weekly routes with stable error codes

The weekly POST body should contain only `weekKey`, `gameKey`, and raw `pick`.
Return a bounded completion projection for all actionable rounds after success.
Map service result codes to stable HTTP statuses:

- invalid input 400;
- not found/changed round 404 or 409 as documented;
- not open/locked 409;
- throttled 429;
- unexpected upstream resolution failure 503 without raw stack/error details.

Never accept canonical club names from the client as authoritative. Never log
raw session tokens or full request bodies.

**Verify**: API matrix passes, including a request received before lock whose
resolution finishes after lock according to plan 082 semantics.

### Step 4: Implement season slot/reorder routes

Support setting one next/filled season rank and swapping two already-filled
ranks, matching Discord's top-down/no-gap rules. The server derives `top_size`
and rejects duplicate clubs or skipped ranks. Keep route shape narrow; do not
accept a whole arbitrary picks array.

**Verify**: tests cover top-down filling, edits, swap, duplicate, close boundary,
concurrent requests, and idempotent retry.

### Step 5: Build the authenticated weekly picker

On `/me?tab=predictions` and the signed-in state of `/predictions`, render every
actionable round from plan 083. For each game show current pick privately,
deadline, state, and an accessible searchable club selector. Save one game at a
time with TanStack Query mutation, preserve scroll/focus, and refresh the shared
completion payload without a full page reload.

Use optimistic UI only for a pending visual state; the server response remains
authoritative. On 409 locked, restore server state and explain the lock. Provide
the Discord picker as a secondary fallback, not the primary action.

**Verify**: keyboard, touch, loading, retry, offline/reconnect, long names, and
two overlapping rounds at required viewports/locales.

### Step 6: Build the season picker and review screen

Reuse the same searchable club control, ordered ranks, and swap behavior. Show
a final private review state and exact season lock. There is no separate
"submit all" transaction: each server-confirmed slot is already saved, matching
Discord behavior; wording must not imply otherwise.

**Verify**: browser acceptance and API/model tests pass in both locales.

### Step 7: Run all gates and security review

Run every command. Review route responses/logs for IDs, picks belonging to other
users, stack traces, and cache leaks. Confirm no public page serializes private
pick values and no route can select an arbitrary guild/season.

## Test plan

- API authorization matrix modeled after comment mutation routes and existing
  EWC sync tests.
- Pure UI model tests for overlapping rounds, completion, disabled/locked games,
  season slot state, and locale strings.
- Real shared-service integration tests on disposable SQLite; optional
  disposable Postgres parity run.
- No tests hit Discord or Liquipedia.

## Done criteria

- [ ] Verified members can create/change weekly and season picks on the website.
- [ ] Discord and web call the same lock/validation/atomic write service.
- [ ] Identity, guild, season, and request time are server-derived.
- [ ] CSRF, member/block gates, rate limits, validation, and stable errors pass.
- [ ] Private picks never enter public caches, pages, APIs, or MCP output.
- [ ] Mobile/desktop English/Arabic acceptance passes.
- [ ] All required repo checks pass.

## STOP conditions

- Plan 082 is not complete or web routes would need to call DB upserts directly.
- Better Auth cannot prove a verified single-guild Discord member at write time.
- Shared service imports pull Discord client/runtime-only modules into Next.js.
- Cache invalidation cannot distinguish private pick data from public status.

## Maintenance notes

All future clients (mobile app, MCP, another bot) must use the same domain
service and authorization-specific adapter pattern. Treat prediction APIs as a
high-integrity write surface even though no money changes hands.

