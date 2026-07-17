# Plan 097: Add a personalized Today for you account overview

> **Executor instructions**: Follow the steps in order and verify each one.
> This page composes existing member data; it must not create a second follow,
> notification, or prediction model. The reviewer owns `plans/README.md`; do
> not update roadmap files in this implementation.
>
> **Mandatory dependency gate (run before drift check)**: Plan 094 must have an
> approved review verdict and its browser harness must be in the branch base:
> `apps/web/e2e/` exists and `npm run web:e2e -- --list` succeeds. If either is
> false, STOP and report the dependency; do not create a parallel E2E setup.
>
> **Drift check (run second)**: `git diff --stat 1530ee8..origin/main -- apps/web/src/components/dashboard/account-workspace.tsx apps/web/src/components/dashboard/profile-dashboard.tsx apps/web/src/components/follows apps/web/src/lib/ewc-profile-sync.ts apps/web/src/lib/follows.ts apps/web/src/lib/co-streams.ts src/db/userFollows.js src/db/userNotifications.js src/db/matches.js apps/web/src/lib/i18n.ts`.
> Stop if account tabs or follow/prediction projections have materially changed.

## Status

- **Priority**: P2
- **Effort**: M-L
- **Risk**: MED
- **Depends on**: Plan 094; Plan 095 recommended
- **Category**: direction / feature
- **Planned at**: commit `1530ee8`, 2026-07-14

## Why this matters

The signed-in account area separates predictions, following, notifications,
and settings into useful tabs, but its Overview is still prediction-profile
oriented. A member cannot answer "what needs my attention today?" without
visiting several screens. A bounded aggregate view can surface followed live
matches, upcoming matches, unread results, open prediction rounds, and relevant
live co-streams while preserving those focused tabs as the place to manage each
feature.

## Current state

- `apps/web/src/components/dashboard/account-workspace.tsx` defines five tabs:
  Overview, Predictions, Following, Notifications, and Settings. Overview only
  renders `ProfileDashboard section="overview"`.
- `apps/web/src/components/follows/follow-center.tsx` already manages follow
  rows and notification preferences with TanStack Query.
- `apps/web/src/app/api/me/follows/route.ts`,
  `apps/web/src/app/api/me/notifications/route.ts`, and
  `apps/web/src/app/api/me/ewc/route.ts` already enforce the signed-in Discord
  member boundary.
- `apps/web/src/lib/ewc-profile-sync.ts` exposes
  `actionableRoundsForViewer`; do not reimplement prediction deadline logic.
- `src/db/userFollows.js` normalizes game/tournament/team/player keys and caps
  each user at 200 follows. `src/db/userNotifications.js` owns inbox ordering
  and unread state.
- Public tournament and co-stream helpers are already cached. The overview must
  consume stored/cached data and must not trigger Liquipedia or start.gg fetches.
- User-facing time is rendered with the existing `LocalDateTime` client
  component so it resolves to the visitor's local timezone.

## Target overview contract

Return one bounded response containing:

- up to 5 followed live matches;
- up to 5 followed upcoming matches in the next 7 days;
- up to 3 unread notifications;
- every currently actionable prediction round, projected without hidden picks;
- up to 4 live co-stream groups whose game tags match followed games (omit the
  section when no relevant groups exist);
- counts and deep-link hrefs for the existing tabs.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused tests | `npm --workspace @esports-community-bot/web run test -- today-for-you` | all pass |
| Bot tests | `npm test` | all pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Native typecheck | `npm --workspace @esports-community-bot/web run typecheck:native` | exit 0 |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| E2E | `npm run web:e2e` | account overview journeys pass |
| Build | `npm run web:build` | exit 0 |

## Scope

**In scope**:
- `apps/web/src/app/api/me/today/route.ts` (create)
- `apps/web/src/lib/today-for-you.ts` (create)
- `apps/web/src/components/dashboard/today-for-you.tsx` (create)
- `apps/web/src/components/dashboard/account-workspace.tsx`
- `src/db/userFollows.js` only for a bounded personalized-match query/helper
- `apps/web/src/lib/follows.ts` only for typed wrappers
- `apps/web/src/lib/i18n.ts`
- `apps/web/src/test/today-for-you.test.ts` (create)
- `tests/followNotifications.test.mjs` (extend shared follow semantics)
- `apps/web/e2e/today-for-you.spec.ts` (create) and test-only support under
  `apps/web/e2e/` only if required for an authenticated local fixture

**Out of scope**:
- Replacing the existing profile header/stat cards or tabs.
- New follows, notification types, scoring rules, or co-stream matching rules.
- Personalized ranking based on behavioral analytics.
- Calling external data providers during a request.
- Showing private pick values before lock or raw notification/Discord IDs.

## Git workflow

- Work only in a separate `git worktree` (or clean clone) whose base contains
  the approved Plan 094 commit. The reviewer will name that commit/ref in the
  execution handoff; verify it with `git merge-base --is-ancestor <094-commit>
  HEAD` before editing. Branch from that ref as `codex/097-today-for-you`.
  Never build, test, commit, stash, clean, reset, or checkout in the dirty
  operator checkout.
- Commit example: `feat(web): add personalized account overview`.
- Do not push unless instructed.

## Steps

### Step 1: Add a bounded personalized match query

Add a shared DB helper that takes a Discord user ID, current unix time, and
limits. Match a followed game, tournament, normalized team, or followed
player's verified current team using the same semantics as
`listFollowerIdsForMatch`; do not invent a second normalization path. Return a
safe match/tournament projection only. Deduplicate a match that satisfies
multiple follows. Order running first, then scheduled ascending, and cap in SQL
or immediately after a bounded candidate query. Use `$1` placeholders and work
on both DB backends. `src/db/matches.js` is reference-only: read its stored
match shape if needed, but do not change it unless a newly discovered hard
contract requires an additive bounded-query helper; in that case STOP and ask
the reviewer to expand scope.

**Verify**: bot DB tests cover every follow type, duplicate criteria, archived
tournament exclusion, placeholder teams, time window, and hard result caps.

### Step 2: Build one server aggregate without N+1 requests

Create `getTodayForViewer(discordUserId, guildId, season, nowSec)` that runs
independent stored-data reads concurrently: personalized matches, notification
page/count, follows, actionable rounds, and cached co-stream groups. Map only
followed game slugs to co-stream tags. Return a strict serializable type with no
Discord ID, hidden pick, raw DB row, provider payload, or internal error.

If one optional public section fails, log a sanitized server error and return
that section as unavailable; authentication and personalized match failures
must fail closed rather than return global data.

**Verify**: focused tests inject loaders to prove limits, deterministic order,
dedupe, partial optional failure, and no private fields.

### Step 3: Add the authenticated API route

Create `GET /api/me/today`, use the same verified-member helper as other
`/api/me` routes, derive guild/season server-side, and return `401/403` using
existing conventions. Set `Cache-Control: private, no-store`. Accept no entity
IDs from the query string. Add a per-user read rate limit only if existing
member endpoints use one; otherwise rely on bounded cached/DB reads.

**Verify**: route tests cover signed out, blocked member, signed in, and verify
one user can never request another user's overview.

### Step 4: Compose the overview UI

Keep `ProfileDashboard section="overview"` and add `TodayForYou` below its
identity/summary area, or refactor the Overview composition without changing
other tabs. Use existing shadcn cards only for repeated actionable groups; do
not nest cards. Provide compact sections with clear Live, Next, Unread, and
Picks labels, local times, and deep links to the relevant existing tab/page.

States:

- no follows: show one onboarding CTA to Games/Tournaments plus open picks;
- no activity: a calm "You're caught up" state;
- section unavailable: localized retry, not a blank panel;
- mobile: single-column scanning, no horizontal table;
- Arabic: RTL logical alignment and bidi-isolated team/player names.

If Plan 095 is present, do not add new free-form analytics; existing action
events on deep links are sufficient.

**Verify**: component tests render populated, caught-up, onboarding, loading,
and partial-error states in EN/AR.

### Step 5: Browser and full verification

Extend Plan 094's seeded E2E data with one followed live match, one upcoming
match, one unread result, and one open round. Verify desktop/mobile, local-time
rendering, tab deep links, and no horizontal overflow. Run all commands.

## Test plan

- Add bot DB characterization tests for personalized match selection.
- Add web model/route tests with injected loaders and auth negatives.
- Add component tests for all states and EN/AR.
- Add Playwright test using seeded member session support; if the harness cannot
  authenticate a local dev member without real OAuth, add a test-only signed
  session fixture through existing Better Auth test conventions, never a
  production bypass.

## Done criteria

- [ ] Overview shows bounded followed live/upcoming activity, unread items,
      actionable rounds, and relevant co-streams.
- [ ] It never fetches external providers or accepts another user's ID.
- [ ] Duplicate follow matches appear once and archived events never appear.
- [ ] Empty/error/loading states are localized and useful.
- [ ] Dates use visitor-local rendering and Arabic is RTL.
- [ ] All repository gates pass.

## STOP conditions

- The only way to test an authenticated overview is a production auth bypass.
- Player follows cannot be resolved with the current trusted-team semantics.
- Building the response requires an unbounded scan or per-follow N+1 query.
- Actionable prediction projection would reveal hidden pick values.
- Account workspace composition changed materially since `1530ee8`.

## Maintenance notes

The overview is a projection, not a new source of truth. Future follow types or
notification types must first land in their owning model, then be explicitly
added here. Reviewers should inspect query bounds and ensure section failures
do not silently substitute non-personal global data.
