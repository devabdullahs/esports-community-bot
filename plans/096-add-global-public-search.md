# Plan 096: Add one global search across public site content

> **Executor instructions**: Follow every step and verification. Build the
> search from existing public projections; never return raw DB rows or reuse an
> admin/MCP transport as a browser backdoor. The reviewer owns
> `plans/README.md`; do not update roadmap files in this implementation.
>
> **Mandatory dependency gate (run before drift check)**: Plan 094 must have an
> approved review verdict and its browser harness must be present in the branch
> base: `apps/web/e2e/` exists and `npm run web:e2e -- --list` lists its
> projects without starting a server. If either condition is false, STOP and
> report it. Do not create a parallel browser harness.
>
> **Drift check (run second)**: `git diff --stat 1530ee8..origin/main -- apps/web/src/components/site-header-client.tsx apps/web/src/components/ui/command.tsx apps/web/src/lib/games.ts apps/web/src/lib/tournaments.ts apps/web/src/lib/news.ts apps/web/src/lib/public-mcp-tools.ts src/db/teams.js src/db/players.js apps/web/src/lib/i18n.ts`.
> Stop if public projection or header composition changed materially.

## Status

- **Priority**: P2
- **Effort**: M-L
- **Risk**: MED
- **Depends on**: Plan 094; Plan 095 recommended
- **Category**: direction / feature
- **Planned at**: commit `1530ee8`, 2026-07-14

## Why this matters

Games, tournaments, matches, teams, players, and news each have their own
directory, but there is no single entry point for a user who knows only a name.
The header therefore makes discovery depend on understanding the site's
information architecture. A fast keyboard/mobile search reduces that friction
without exposing private/admin data.

## Current state

- `apps/web/src/components/site-header-client.tsx` builds static Content,
  Competition, co-stream, EWC, account, and mobile navigation. It has no search
  action.
- `apps/web/src/components/ui/command.tsx` already provides the installed
  shadcn/Base UI command primitives. Do not add another combobox package.
- Public helpers already exist:
  - games: `apps/web/src/lib/games.ts`
  - active tournament summaries/matches: `apps/web/src/lib/tournaments.ts`
  - published-only news search: `apps/web/src/lib/news.ts`
  - safe team/player directory projections used by
    `apps/web/src/lib/public-mcp-tools.ts` (`listTeamsDirectory`,
    `listPlayersDirectory`, `safeTeam`, `safePlayer`).
- The public MCP proves these sources can be projected safely, but the UI must
  call a normal bounded JSON endpoint, not `/api/public-mcp`.
- Locale is path-based. Every result URL must use `localizedPath`, preserve
  `/ar`, and render mixed Arabic/Latin names with `dir="auto"`/`bdi`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused tests | `npm --workspace @esports-community-bot/web run test -- global-search` | all pass |
| Bot tests | `npm test` | all pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Native typecheck | `npm --workspace @esports-community-bot/web run typecheck:native` | exit 0 |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| E2E | `npm run web:e2e` | search journeys pass |
| Build | `npm run web:build` | exit 0 |

## Scope

**In scope**:
- `apps/web/src/app/api/search/route.ts` (create)
- `apps/web/src/lib/public-search.ts` (create)
- `apps/web/src/components/search/global-search.tsx` (create)
- `apps/web/src/components/site-header-client.tsx`
- `apps/web/src/lib/i18n.ts`
- `apps/web/src/test/global-search.test.ts` (create)
- `apps/web/e2e/global-search.spec.ts` (create)
- `apps/web/src/lib/product-analytics.ts` call site only if Plan 095 has landed

**Out of scope**:
- Admin drafts, comments, audit rows, users, MCP keys, or raw enrichment JSON.
- Fuzzy-search infrastructure, Elasticsearch, vector search, or AI ranking.
- Searching live external providers.
- A dedicated results page in v1; the command dialog is the result surface.
- Highlighting with raw HTML.

## Git workflow

- Work only in a separate `git worktree` (or clean clone) whose base contains
  the approved Plan 094 commit. The reviewer will name that commit/ref in the
  execution handoff; verify it with `git merge-base --is-ancestor <094-commit>
  HEAD` before editing. Branch from that ref as `codex/096-global-public-search`.
  Never operate in the dirty operator checkout or use `git clean`, `git stash`,
  reset, or checkout there.
- Commit example: `feat(web): add global public search`.
- Do not push unless instructed.

## Steps

### Step 1: Build a bounded server-side search model

Create a typed result union for `game`, `tournament`, `match`, `team`,
`player`, and `news`, each containing only: kind, stable ID/key, display title,
short secondary label, localized-ready relative href, and optional proxied logo
URL already accepted by the public directory. Normalize whitespace and case for
matching, cap input at 80 characters, require at least two non-space
characters, and return at most 5 results per group / 24 total.

Use existing cached public helpers. For teams/players, reuse or extract the
same safe projection used by public MCP so raw `raw_json`, `liquipedia_raw`,
Discord IDs, and private fields cannot enter the result type. Rank exact prefix
matches before contains matches, then by current public ordering. Do not query
external services.

**Verify**: focused tests prove each kind, deterministic ranking, result caps,
published-news-only behavior, and absence of forbidden raw field names in a
recursive serialization check.

### Step 2: Add a hardened public endpoint

Create `GET /api/search?q=...&locale=en|ar`. Validate with exact parsing,
return `400` for malformed/too-short queries, apply the existing public
Cloudflare-IP rate-limit helper, set `Cache-Control` suitable for a short public
query cache without caching errors, and return only the typed result groups.
Strip query/fragment from generated hrefs. Ignore authorization headers.

**Verify**: route tests cover missing/short/oversized query, Arabic text,
injection-like strings, rate limiting, no drafts, no raw fields, and maximum
result size.

### Step 3: Compose the shadcn command dialog

Add a compact Search icon button to desktop header and mobile navigation. Use
the installed Command/Dialog primitives with grouped headings, type icons,
loading/error/empty states, and a real text label in mobile. Open with the
button, `/` when focus is not in an editable control, and `Ctrl/Cmd+K`.
Debounce requests 200-300 ms and cancel stale requests with AbortController.
Arrow keys, Enter, Escape, focus return, and screen-reader status must work.

Selecting a result closes the dialog and navigates to its locale-correct href.
If Plan 095 exists, record only `site_search_result_open`; never record the
query or selected result.

**Verify**: component tests prove keyboard opening, stale-request cancellation,
group rendering, selection/navigation, and an accessible empty/error state.

### Step 4: Verify responsive and RTL behavior

At 390px, render the command experience as a near-full-width dialog/sheet with
no clipped input or result rows. In Arabic, align logical start/end correctly,
keep Latin entity names readable with bidi isolation, and preserve `/ar` after
navigation. The desktop trigger must not force header wrapping.

**Verify**: Playwright EN/AR desktop/mobile spec passes and asserts no document
horizontal overflow.

### Step 5: Run all gates

Run the Commands table and `git diff --check`. Search the response code for
forbidden fields (`raw_json`, `liquipedia_raw`, `discord`, `session`) and verify
none can be serialized.

## Test plan

- `apps/web/src/test/global-search.test.ts`: pure search model + route cases.
- Browser test: open by keyboard and button, search seeded team/tournament,
  select a result, repeat under `/ar` and 390px.
- Security negatives: drafts excluded, query bounded, no raw/private keys,
  external URL not reflected, rate limit enforced.

## Done criteria

- [ ] One header/mobile search covers all six public entity kinds.
- [ ] Endpoint requires two characters, caps 24 results, and never calls an
      external provider.
- [ ] News results are published only; team/player results contain safe public
      fields only.
- [ ] Keyboard, focus, mobile, and RTL checks pass.
- [ ] Product analytics, if present, stores no query/result detail.
- [ ] All repository gates pass.

## STOP conditions

- Safe team/player projections cannot be reused without changing the public
  MCP response contract.
- Search latency requires unbounded table scans in the production dataset.
- A result kind has no stable public URL.
- The implementation would expose drafts or raw enrichment payloads.
- Plan 094 is unavailable and no browser verification can be run.

## Maintenance notes

Keep result groups and limits centralized. When a new public entity type is
added, update the union, safe projection, labels, and recursive field-leak test
together. Reviewers should scrutinize cache keys for locale/query separation
and reject free-form analytics properties.
