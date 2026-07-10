# Plan 077: Make the prediction leaderboard use one truthful pagination model

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. Do
> not change prediction scoring or public row privacy. Update this plan and
> `plans/README.md` when complete.
>
> **Drift check (run first)**: `git diff --stat ba288a1..HEAD -- apps/web/src/app/leaderboard apps/web/src/components/dashboard/leaderboard-table.tsx apps/web/src/lib/i18n.ts apps/web/src/test`

## Status

- **Execution**: DONE (2026-07-10)
- **Priority**: P1
- **Effort**: S-M
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `ba288a1`, 2026-07-10

## Why this matters

The server fetches and labels a 100-member page, but `LeaderboardTable` adds a
second, implicit React Table page whose default size is 10. A visitor therefore
sees "Showing 1-100" beside a table that displays ten rows and must operate two
different Next controls. One server-owned page must equal the rows rendered.

## Current state

- `apps/web/src/app/leaderboard/[guildId]/[season]/page.tsx:28-79` sets
  `PAGE_SIZE = 100`, fetches that block, and computes the public range from all
  returned rows.
- The same page renders the server previous/next controls at lines 139-169.
- `apps/web/src/components/dashboard/leaderboard-table.tsx:155-165` installs
  `getPaginationRowModel()` without a page-size state, so TanStack defaults to
  ten visible rows.
- The table renders another page label and previous/next controls at lines
  213-224.
- `src/lib/ewcProfileStats.js:276-301` already returns privacy-safe rows with
  masked member labels. Preserve that response shape.
- Public UI uses Base UI/shadcn composition and logical RTL classes. Match the
  patterns in the existing leaderboard page and table.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused tests | `npm --workspace @esports-community-bot/web run test -- src/test/ewc-leaderboard.test.ts src/test/leaderboard-page-model.test.ts` | all pass |
| Bot tests | `npm test` | all pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Web build | `npm run web:build` | exit 0 |

## Scope

**In scope**:

- `apps/web/src/app/leaderboard/[guildId]/[season]/page.tsx`
- `apps/web/src/components/dashboard/leaderboard-table.tsx`
- `apps/web/src/lib/leaderboard-page-model.ts` (new, only if useful)
- `apps/web/src/lib/i18n.ts`
- `apps/web/src/test/leaderboard-page-model.test.ts` (new)
- Existing leaderboard tests when required

**Out of scope**:

- Scoring formulas, ranking SQL, Discord leaderboard cards, member-label privacy.
- Adding profiles or exposing Discord IDs.
- EWC Club Championship standings; plan 080 owns that separate leaderboard.

## Git workflow

- Branch: `codex/077-leaderboard-pagination`
- Commit example: `Fix prediction leaderboard pagination`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Establish one server page model

Choose a deliberate public page size between 25 and 50. Extract a pure helper
only if it removes the current duplicated page/range math. It must clamp invalid
and over-range page values and return `offset`, `totalPages`, `rangeStart`, and
`rangeEnd` for an actual returned row count.

**Verify**: focused model tests cover empty, first, middle, final partial, invalid,
and over-range pages.

### Step 2: Remove client pagination from the table

Remove `getPaginationRowModel`, the inner page label, and the table-level
previous/next buttons. Keep local filtering and sorting over the current server
page. Every row supplied to `LeaderboardTable` must render in the table.

Use copy that makes the search boundary honest (for example, "Search this
page") in English and Arabic. Do not imply a global search unless the backend
actually searches all ranks.

**Verify**: `rg -n "getPaginationRowModel|table.previousPage|table.nextPage" apps/web/src/components/dashboard/leaderboard-table.tsx` returns no matches.

### Step 3: Keep only server navigation

Use the model in the page and preserve locale when constructing page links.
The visible range must equal the rendered row count. Keep arrow direction
logical in Arabic. Disable or omit previous/next when unavailable.

**Verify**: build succeeds and the focused leaderboard tests pass.

### Step 4: Visual acceptance

With seeded data containing more than one server page, check 390x844 and
1440x900 in English and Arabic. Count the rendered rows and compare with the
range text. Confirm there is exactly one pagination control set and no table
overflow hides rank or points.

## Test plan

- Pure page-model boundary tests listed above.
- Extend `ewc-leaderboard.test.ts` to assert stable limits/offsets and top score.
- Manual browser check confirms every fetched row is visible and one control
  changes the server page.

## Done criteria

- [x] One pagination layer remains.
- [x] Displayed range equals rendered rows.
- [x] Search wording is explicit about its page scope.
- [x] English, Arabic, mobile, and desktop have no overflow or wrong arrows.
- [x] All required repo checks pass.

## STOP conditions

- Fixing the table would require exposing raw Discord IDs.
- The live page has intentionally adopted cursor pagination since this plan.
- A shadcn primitive must be overwritten to implement the change.

## Maintenance notes

If global member search is added later, implement it at the DB/server boundary
and preserve the masked-label policy. Do not quietly reintroduce client paging
inside a server-paged table.
