# Plan 140: Make tournament history complete and trustworthy

> **Executor instructions**: Fix the public data contract before polishing the
> results UI. Running/upcoming data may keep polling, but paged history must not
> be silently truncated or reset. Retained data and transport health are
> separate concepts: a failed refetch must never continue claiming that the
> browser view is fresh.
>
> **Drift check (run first)**:
> `git diff --stat d1b66e1..HEAD -- apps/web/src/lib/tournaments.ts apps/web/src/app/api/tournaments apps/web/src/app/tournaments apps/web/src/components/tournaments apps/web/src/test/tournaments-api.test.ts apps/web/src/test/tournament-sync-health.test.tsx apps/web/e2e/critical-public-journeys.pw.ts`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `d1b66e1`, 2026-07-24

## Why this matters

Tournament detail pages currently request the default API window and show only
50 finished matches. The header then reports that capped array length as the
result count even when the API knows more rows exist. Production tournament 25
currently demonstrates the mismatch: its directory summary reports more
results than its detail page renders.

The same client keeps polling archived/final snapshots and retains old data when
a refetch fails without telling the viewer. A page can therefore look complete
and "Fresh" while its result history is truncated or its browser transport is
broken.

## Current state

- `apps/web/src/lib/tournaments.ts:406-451` deduplicates all tournament matches,
  then slices finished rows with a default limit of 50.
- `apps/web/src/app/tournaments/[id]/page.tsx:69-72` requests the helper without
  an explicit finished-results page.
- `apps/web/src/components/tournaments/tournament-match-list.tsx:388-397`
  refreshes the same default page every 90 seconds.
- `apps/web/src/components/tournaments/tournament-match-list.tsx:611-675`
  renders the returned results with no total, range, pagination, or truncation
  notice.
- `apps/web/src/app/tournaments/[id]/page.tsx:184-188` reports
  `finished.length`, not the full finished total.
- The match-list and sync-health queries throw on failed responses but render
  neither an error/retry state nor a distinct "last successful refresh" state.
- Polling intervals remain enabled when upstream health is final.
- The route already accepts bounded `limit` and `offset`, and its API tests
  characterize offset behavior. The missing piece is an explicit public/UI
  paging contract.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused tests | `npm --workspace @esports-community-bot/web run test -- tournaments-api tournament-sync-health` | all pass |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Native typecheck | `npm --workspace @esports-community-bot/web run typecheck:native` | exit 0 |
| Web build | `npm run web:build` | exit 0 |
| Browser journey | `npm run web:e2e -- critical-public-journeys.pw.ts` | focused tournament journey passes |

## Scope

**In scope**:

- The tournament-match data contract and public route.
- A truthful finished total and visible paging/range state.
- Separate refresh behavior for live/upcoming data and finished history.
- Browser transport error/retry and last-success feedback.
- Conditional polling for final snapshots.
- EN/AR, RTL, mobile, keyboard, and no-JavaScript-safe pagination behavior.

**Out of scope**:

- Redesigning the directory/card visual language; plan 141 owns that.
- Changing provider sync frequency or bypassing the persisted data layer.
- Rebuilding brackets from a paged subset.
- Solving the previously rejected tournament-summary N+1 issue.
- Calling Liquipedia, start.gg, or PandaScore from the web process.

## Git workflow

- Branch: `codex/140-complete-tournament-history`
- Commit style: `fix(tournaments): page complete result history`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Characterize the current cap and refresh failure

Add a fixture with at least 80 finished matches plus running and scheduled rows.
Prove the current first response contains 50 finished rows while the full
finished count is greater than 50. Add component/query tests that prove:

- a failed refetch retains the last successful rows;
- the failure is currently invisible;
- final health currently leaves polling enabled.

Use fake timers and injected fetches. No test may access an external provider.

**Verify**: the new truthfulness/error assertions fail before implementation.

### Step 2: Return explicit per-status totals and paging metadata

Replace the ambiguous response total with an additive contract such as:

```ts
{
  matches: {
    running: Match[];
    scheduled: Match[];
    finished: Match[];
  };
  totals: {
    running: number;
    scheduled: number;
    finished: number;
    all: number;
  };
  finishedPage: {
    offset: number;
    limit: number;
    hasMore: boolean;
  };
}
```

Keep a compatibility field only if a current caller requires it, and document
its meaning. Clamp inputs as the route does today. Compute `finished` total
after the same alias/deduplication rules used for displayed rows so the count
cannot include hidden duplicates.

Do not build the bracket from one history page. Its input must remain the
complete canonical stage projection until a separately characterized bounded
bracket query exists.

**Verify**: API tests cover the first, middle, final, empty, and over-range
finished page alongside live/upcoming rows.

### Step 3: Add URL-addressable result history navigation

Render a truthful results heading/range and Previous/Next controls using
composed shadcn `Button` links. Prefer a server-readable query parameter such
as `?resultsPage=2` so an older history page is shareable, refresh-safe, and
usable without client JavaScript.

Do not place a `Button` inside a `Link`. Use the project's supported composed
link pattern. Preserve unrelated query parameters and the tournament anchor.
When a new result changes page boundaries, return the viewer to the newest
page with a localized notice rather than showing duplicate/skipped rows
silently.

The detail header's result metric must use `totals.finished`, never the current
array length.

**Verify**: a fixture with 80 results renders all pages exactly once and the
header remains 80 on every page.

### Step 4: Decouple live polling from paged history

Keep running and scheduled matches refreshable without replacing the viewer's
selected finished page. Either split the queries or merge only the live
segments into retained page data. The query key must include the finished page.

Disable polling when:

- upstream health is `final`; or
- the tournament is archived/final and has no running/scheduled matches.

Continue refetch-on-focus/reconnect only where it can change the snapshot.
Avoid a second full-history request on every timer tick.

**Verify**: fake-timer tests show live rows update, page 2 history remains page
2, and final pages schedule no interval.

### Step 5: Surface browser transport health

When a request fails after successful initial data:

- retain the visible data;
- show a compact shadcn `Alert` stating that refresh failed and when data last
  refreshed successfully;
- provide a retry action;
- do not relabel upstream schedule/standings health as failed.

When no initial data exists, use the existing route error boundary or a
localized `Empty`/retry state. Never show the last upstream `Fresh` badge as if
it describes the browser request; label source health and page refresh
separately.

**Verify**: EN/AR tests cover retained-data failure, retry success, initial
failure, and a final snapshot.

### Step 6: Validate responsive and accessible behavior

Ensure the range and controls:

- have an accessible navigation label;
- expose disabled/unavailable directions without dead links;
- keep logical ordering in RTL;
- do not create horizontal overflow at 320 CSS pixels;
- preserve visible focus and reduced-motion behavior.

Extend the existing public tournament browser journey with an 80-result
fixture, page navigation, simulated refetch failure, and Arabic/mobile pass.

### Step 7: Run all gates

Run the focused tests first, then lint, native typecheck, the full web suite,
build, and the focused browser journey. Confirm the web tests never call a
provider.

## Test plan

- 80-result API fixture with complete per-status totals.
- First/middle/last/out-of-range result pages.
- Header total independent of page size.
- Live polling does not reset history navigation.
- Final/archived snapshots do not poll.
- Retained-data refresh failure, retry, and last-success copy.
- EN/AR, RTL, keyboard, and 320-pixel browser coverage.

## Done criteria

- [ ] No finished match is silently unreachable.
- [ ] Result counts describe the full deduplicated set.
- [ ] History navigation is URL-addressable and works without client state.
- [ ] Live polling does not reset or duplicate paged history.
- [ ] Final snapshots stop interval polling.
- [ ] Refresh failures are visible without discarding retained data.
- [ ] All repository gates pass.

## STOP conditions

- The full finished count cannot be computed with the same dedupe identity as
  displayed rows. Characterize and resolve identity before shipping a count.
- Paging would make bracket construction incomplete. Keep bracket data on its
  existing complete path rather than accepting a partial bracket.
- A proposed optimization changes provider fetch behavior or creates a web-side
  provider call.

## Maintenance notes

Treat `limit` as a transport boundary, never a product total. Future consumers
must use the named per-status totals and must opt into history paging
explicitly.
