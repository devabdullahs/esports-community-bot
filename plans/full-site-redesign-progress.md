# Full-site redesign progress

Status: complete. Implementation, visual review, regression checks, production build, and post-build boundary gate passed.

## Foundations

- [x] Read AGENTS.md, website docs; inspect security, auth, data, locale, test architecture.
- [x] Dedicated redesign branch from main.
- [x] UI architecture decision recorded.
- [x] Reference research and baseline browser evidence (Liquipedia and HLTV browser challenges documented).
- [x] Dependencies and seeded loopback preview.
- [x] Semantic tokens, bilingual typography, focus, reduced motion.
- [x] Masthead, mobile priorities, search, community navigation, footer.

## Route inventory

All routes include `/ar` counterparts through existing locale rewrites. Track implemented / desktop / mobile / RTL / tested; unchecked is not complete.

- [x] `/` — competition desk, fixtures, results, tournaments, news, community
- [x] `/live` — live, upcoming, results, game filters
- [x] `/games`, `/games/[slug]`
- [x] `/tournaments`, `/tournaments/ewc`, `/tournaments/archive`
- [x] `/tournaments/[id]` — overview, stages, matches, bracket, standings, participants
- [x] `/matches/[id]`
- [x] `/news`, `/news/ewc`
- [x] `/games/[slug]/news/[id]`, `/media/[slug]/news/[id]`
- [x] `/teams`, `/teams/[id]`
- [x] `/players`, `/players/[id]`
- [x] `/compare`
- [x] `/predictions`
- [x] `/leaderboard`, `/leaderboard/[guildId]/[season]`
- [x] `/predictors/[id]`
- [x] `/clubs`, `/clubs/standings`
- [x] `/mvp`
- [x] `/co-streams`
- [x] `/media`, `/media/[slug]`
- [x] `/me` — account, predictions, follows, notifications
- [x] `/login`
- [x] `/partners`
- [x] `/docs/mcp`, `/docs/admin-mcp`
- [x] `/privacy`, `/terms`, `/offline`, not-found and errors
- [x] Admin smoke: navigation, menus, forms, route protection

## Validation

- [x] Bot tests — 997 passed, 16 repository-defined skips
- [x] Web lint
- [x] Web Vitest — 1,469 passed (2 workers; concurrent initial run exhausted a setup timeout)
- [x] Native TypeScript
- [x] Production build — passed
- [x] Security boundary gate after build — passed
- [x] Playwright journeys — all 46 desktop/mobile cases passed; six focused cases passed again after final skip-link and native-menu-link fixes
- [x] Full route browser sweep — 224 combinations, 56 routes, 4 viewport/theme/locale variants
- [x] Tablet and light theme
- [x] Keyboard, focus, semantics, contrast, overflow, console — 34 axe checks with zero violations; provider embed messages documented
- [x] Final refinement and full-site review — including all six Jakub domain skills; scoped review in redesign-interface-review.md

## Observations

Baseline at 1440px: first fixture started below the fold; mobile primary destinations were in a menu. The new first fixture is visible in the initial viewport and all four primary destinations stay exposed on mobile. Existing E2E covers live center, search, login, today-for-you, critical journeys, and admin operations. No backend/API edits were made.

Environment: OneDrive workspace rejected ordinary file creation (ENOENT from PowerShell and Node); Git can populate tracked files. Implementation and local evidence live in `C:/Users/abdul/.codex/worktrees/esports-redesign`, attached to the requested repository.

Commands: `npm test`; `npm --workspace @esports-community-bot/web run lint`; `npm --workspace @esports-community-bot/web run test -- --maxWorkers=2`; `npm --workspace @esports-community-bot/web run typecheck:native`; `npm run web:e2e`; `npm run web:e2e -- redesign.pw.ts`; `npm run web:build`; `npm run security:boundary`. Browser audit scripts are `scripts/redesign-{sweep,accessibility,interface-check}.mjs`.

The route sweep includes four intentional IndexNow-key 404 responses and provider embed warnings on two co-stream checks. Actual localized missing-content UI was separately inspected at `/ar/games/not-a-real-game`. Article routes may redirect to their published language. See the delivery and interface-review documents for verification boundaries.
