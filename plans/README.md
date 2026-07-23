# Implementation Plans

Maintained by the improve skill. First audit 2026-06-10 at `2c0ba69`; second
audit 2026-06-10 at `c260e10`; third audit 2026-06-11 at `82e32e6` (after ALL
plans 001-018 merged + pushed to the PR, the security-review fix, and the
RTL/design passes). Execute in the order below unless dependencies say
otherwise. Each executor: read the plan fully, honor its STOP conditions,
update your row when done.

**ALL plan branches are merged into `feature/ewc-profile-showcase-dashboard`
and pushed** (batch 1 @ `c260e10`, batch 2 via merges `3371dde..d52e76c` +
lockfile `ae07b91`; per-row branch names below are historical — branches are
deleted). Post-plan session work, implemented directly at operator request:
leaderboard Discord-ID leak fix (`19f0b98`, from /security-review), RTL
document direction + logical props (`5caa50f`, `755666d`), skip link + chrome
polish (`4bbebb2`), design pass (`82e32e6`).

**CRITICAL correction (third audit)**: plan 001's workflow is INVALID on
GitHub — job-level `env` uses `${{ runner.temp }}`, but the `runner` context
is not available at job level, so GitHub rejects the file (workflow registers
by path, every push = 0s failure, PR shows no checks). All "CI green" claims
were local-only. Fix tracked as plan 020.

**Deployment context (operator-confirmed)**: this bot serves **a single
Discord guild**. Code is multi-guild-shaped; do not add multi-tenant features
or optimize for guild counts.

## Execution order & status

| Plan | Title | Priority | Effort | Depends on | Status |
|------|-------|----------|--------|------------|--------|
| 001  | CI workflow (bot tests + web lint/build) | P1 | S | — | MERGED but BROKEN on GitHub (runner-context bug — see header note; superseded by plan 020) |
| 002  | EWC scoring characterization tests | P1 | M | — | DONE (branch `advisor/002-ewc-scoring-tests` @ 255e61c, chains on 001, unmerged) |
| 003  | Liquipedia parser fixture tests | P1 | M–L | — | DONE — merged @ `1cf3013` |
| 004  | Bot hardening: scoring transactions + allowedMentions | P2 | S | 002 | DONE (branch `advisor/004-bot-hardening` @ f3045dc, chains on 002, unmerged) |
| 005  | Web API hardening: timing-safe secret, validation, clamps | P2 | S | — | DONE — merged @ `4f047e1` |
| 006  | Admin lockdown (original) | P2 | M | — | SUPERSEDED by 006b (upstream RBAC conflict); branch deleted |
| 006b | Admin hardening on upstream RBAC (headers, layout guard, email trim, docs) | P2 | S | — | DONE — merged @ `c260e10` |
| 007  | Repo hygiene: env docs, dockerignore, deps, audit bump | P3 | S | — | DONE (branch `advisor/007-repo-hygiene` @ 331c651, chains on 001, unmerged; Next bump deferred — no stable ≥16.3.0 yet) |
| 008  | AGENTS.md | P2 | S | best after 004 | DONE (branch `advisor/008-agents-md` @ 68008a4, chains on 010, unmerged) |
| 009  | Liquipedia module split | P3 | L | 003 | DONE — merged @ `3dec9fb` |
| 010  | /ewc_admin delete_week + orphan week-8 cleanup | P2 | S | — | DONE (branch `advisor/010-delete-week` @ ede4ba0, chains on 004, unmerged; operator runbook in plan report) |
| 011  | Design spike: tournaments on the dashboard | P3 | M | — | DONE (branch `advisor/011-tournaments-spike` @ e974762 — design doc `plans/design/tournaments-dashboard.md`, 5 open questions for operator) |
| 012  | CMS input hardening: length caps, strict reorder, ID validation | P2 | S | — | DONE (branch `advisor/012-cms-input-hardening` @ 247d824, chains on 001, unmerged; incl. optional magic-byte check) |
| 013  | Web test runner (vitest) + admin authorization matrix | P2 | M | — | DONE (branch `advisor/013-admin-authz-tests` @ 614068e, chains on 012, unmerged; 94 web tests, RBAC matrix verified — no missing checks) |
| 014  | News lifecycle, cascade, markdown edge-case tests (bot) | P2 | S | — | DONE (branch `advisor/014-news-lifecycle-tests` @ 7563093, unmerged; 42 tests total) |
| 015  | Cache public CMS data reads (tags + revalidateTag) | P3 | S–M | after 012/013 (same route files) | DONE (branch `advisor/015-public-data-caching` @ 6cb5fde, chains on 013, unmerged; 106 web tests) |
| 016  | CMS docs: README section, R2 setup, admin env vars | P3 | S–M | — | DONE (branch `advisor/016-cms-docs` @ 01756fd, chains on 007, unmerged) |
| 017  | Design spike: Discord news auto-posting | P3 | M | 014 recommended | DONE (branch `advisor/017-discord-news-spike` @ b38b31b — design doc `plans/design/discord-news-posting.md`, 4 open questions for operator) |
| 018  | Web admin audit log (table + route wiring + viewer) | P3 | M | after 012/013 (same route files) | DONE (branch `advisor/018-web-admin-audit-log` @ d8d4724, chains on 015, unmerged; 16 wired sites, 107 web + 42 bot tests) |
| 020  | Fix CI on GitHub (runner-context bug, triggers, dispatch, concurrency) | P1 | S | — | DONE — merged @ `77fcc7f` (GitHub-run verification still pending a push) |
| 021  | Admin editor UX: error surfacing, discard warning, localized errors | P2 | M | — | DONE — merged (128→138 web tests) |
| 022  | Container hardening: USER node + heartbeat HEALTHCHECK | P3 | S–M | — | SUPERSEDED — operator shipped a combined bot+web multi-stage Dockerfile with `USER node` + `start-production.js` (commit `a39350f`); plan 022's bot-only Dockerfile + heartbeat-healthcheck approach no longer fits. Re-scope a healthcheck for the combined container if wanted. |
| 023  | Docs refresh (AGENTS.md) + promote seed to `npm run seed:dev` | P3 | S | — | DONE — merged @ `ddce4f8` (AGENTS bot-test line kept count-free per operator's edit; seed:dev coexists with start:production) |
| 024  | Design spike: web dashboard deployment to the NAS | P2 | M | 020 first | DONE — design doc merged. NOTE: operator chose a DIFFERENT architecture than the doc recommends — a single combined bot+web container (`start-production.js`, RUN_BOT/RUN_WEB), not separate web + cloudflared services. The doc's image-strategy/TLS analysis still informs ingress decisions. |
| 025  | Abuse limits (sync/unlink/upload) + sanitized upload errors | P2 | M | — | DONE — merged (auto-merged cleanly with operator's `bc1aa8f` AVIF-brand upload change) |
| 026  | Content-Security-Policy (prod) | P3 | S–M | — | DONE — merged |
| 027  | Restrict server-side logo downloads to approved hosts | P2 | S–M | — | DONE — `isAllowedLogoUrl` (https + liquipedia.net) enforced at the top of `loadLogoImage` before any cache/network work; `tests/logoUrlPolicy.test.mjs` (106 bot tests). |
| 028  | Cache public tournament API routes used by live dashboard polling | P2 | S-M | - | DONE - both public tournament routes call the cached helpers (`listTournamentSummariesCached` / `getTournamentMatchesCached`, 60s, keyed by id+limit+offset); existing `tournaments-api.test.ts` covers route behavior (191 web tests). |
| 029  | Enforce game scope on the admin author-picker API | P2 | S | - | DONE - `canManageGame` enforced on `/api/admin/authors`; `admin-authz.test.ts` adds the route to the 401/403 matrices + a scope suite (wrong game 403, correct game/super 200). |
| 030  | Pin GitHub Actions and minimize CI token permissions | P3 | S | - | DONE - `ci.yml` gets top-level `permissions: contents: read`; every action in ci + publish pinned by full SHA (with `# vN` comments); added `.github/dependabot.yml` (github-actions, weekly). |
| 031  | Verify news authors on write | P2 | S-M | - | DONE - POST/PATCH news routes resolve submitted authors against `listEligibleAuthors` via `resolveNewsAuthors`; ineligible ids → 403 and stored name/avatar are canonical (not the payload), fallback = acting admin (create) / existing author (update). `admin-authz.test.ts` suite 10 covers spoof-reject + canonical name (194 web tests). |
| 032  | Cache public EWC leaderboard reads | P3 | S-M | - | DONE - `getPublicEwcLeaderboardCached` (`unstable_cache`, 60s, key guildId/season/limit/offset, clamps limit 1-100 + offset 0-100000) backs both the public leaderboard route and the server page. |
| 033  | Scope game-page admin CTA to game admins | P2 | S | - | DONE - game page uses `getAdminAccess` + `canManageGame(access, slug)` instead of any signed-in session, so the Admin button shows only to admins who manage that game. |
| 034  | Add public page metadata and discovery files | P2 | M | - | DONE - `lib/metadata.ts` (`absoluteUrl`, `buildPageMetadata` -> canonical + OpenGraph + Twitter); `layout.tsx` sets `metadataBase` + title template; `generateMetadata` on games/[slug], games/[slug]/news/[id], tournaments/[id], media/[slug], leaderboard pages; new `robots.ts` (allow /, disallow /admin /api/ /me /login) + `sitemap.ts` (static paths + games/media/tournaments/news from cached helpers, DB-failure tolerant). |
| 035  | Server-page the public EWC leaderboard | P2 | M | 032 | DONE - `leaderboard/[guildId]/[season]/page.tsx` now does server pagination (PAGE_SIZE=100, `?page`, clamps over-range, topScore always from page 1, localized `showing(start,end,total)` range); server nav rendered only when `totalPages > 1`. |
| 036  | Add bilingual route not-found/error/loading states | P3 | M | - | DONE - added `not-found.tsx` (server, getRequestLocale, 404 + Home), `error.tsx` (client, cookie-locale via lazy init, retry/reset + console.error), `loading.tsx` (server, spinner); bilingual `notFoundTitle/notFoundBody/errorTitle/errorBody/retry/loadingLabel` keys in en+ar common. |
| 037  | Bound + throttle public comment reads | P2 | S | - | DONE - merged in PR #27 (`3889de6`); two-query bounded `listCommentsForPost`, throttled read-path auto-approval sweep. |
| 038  | Bump form-data (GHSA-hmw2-7cc7-3qxx) | P3 | S | - | DONE - merged in PR #27 (`3889de6`). |
| 039  | Key rate limits on cf-connecting-ip only | P2 | S | - | DONE - merged in PR #27 (`3889de6`); `clientIp` reads only `cf-connecting-ip` (behind Cloudflare), not spoofable forwarded headers. |
| 040  | Same-origin (CSRF) guard on admin + me mutating routes | P2 | S | - | DONE - merged in PR #25 (`65cf75c`); `sameOriginOr403` on /api/admin/** and /api/me/ewc/*. Internal /api/internal/** intentionally excluded (server-to-server). |
| 041  | Restrict logo-proxy redirects to allowed hosts (SSRF) | P2 | S | - | DONE - merged in PR #25 (`65cf75c`); `isAllowedLogoRedirect` + `maxRedirects:3` in `src/lib/logoSource.js`. |
| 042  | Add verifying Postgres TLS modes (bot client) | P2 | S | - | DONE - merged in PR #25 (`65cf75c`); exported `resolvePgSslConfig` (disable/require/no-verify/verify-ca/verify-full + PGSSLROOTCERT), `tests/pgSslConfig.test.mjs`. NOTE: prod runs `PGSSLMODE=disable` — managed PG server rejects SSL (open infra item). |
| 044  | Cap the Liquipedia HTTP client's response size | P3 | S | - | DONE (executed + reviewed 2026-06-18) — commit `703c53a` on branch `advisor/044-liquipedia-response-size-cap` (UNMERGED, in worktree). Added `MAX_RESPONSE_BYTES` (50 MB default, 8 MB floor, env `LIQUIPEDIA_MAX_RESPONSE_BYTES`) + `maxContentLength`/`maxBodyLength` on the shared axios client; `.env.example` documents it. Reviewer re-verified: bot 174/174, scope clean (only client.js + .env.example), throttle/cache/20s-timeout unchanged, behavior-preserving. |
| 043  | Web auth-DB pool honors the same Postgres TLS modes as the bot | P2 | S | - | DONE (executed + reviewed 2026-06-18) — commit `5346c3d` on branch `advisor/043-web-auth-db-tls-config` (UNMERGED, in worktree). `auth-database.ts` drops its partial `postgresSslConfig` and reuses `resolvePgSslConfig` (+ PGSSLROOTCERT + unset-mode warning); new web test `apps/web/src/test/pg-ssl-config.test.ts` (5). Reviewer re-verified: web lint clean, web 230/230, web build OK, bot 174/174, scope clean (client.js untouched). |
| 045  | Image decompression-bomb guard on logo decode | P3 | M | - | DEFERRED (accepted risk) — correct fix needs a pre-decode dimension check (new dep / header parser) + per-logo cost; threat is low-likelihood (allow-listed host serving a crafted image). See bot-internals audit note below. |
| 046  | Characterization tests for the EWC prediction lifecycle (DB + status) | P2 | M | - | DONE — added `tests/ewcPredictionLifecycle.test.mjs` covering pick idempotency, score save/overwrite, status transitions, and best-N-weeks tied-score behavior. Commit `15c880d`. |
| 047  | Bring admin score_week guards in line with the automation | P2 | S | 046 | DONE — added manual `score_week` guards for already-scored weeks and unavailable aggregate final standings. Commit `8b50391`. |
| 048  | Web tests for the EWC public leaderboard + profile sync/unlink | P2 | M | - | DONE — added public leaderboard route tests plus EWC profile GET/sync/unlink tests. Commit `7e5b52b`. |
| 049  | Fill EWC scoring-math edge-case test gaps | P3 | S | - | DONE — added scoring edge-case tests for single-game bonus gating, 3-game sweeps, sparse/boundary season picks, exact-rank bonus, and missing-pick bonus blocking. Commit `21bc7db`. |
| 051  | Make `/ewc_predict link` + the guide actually explain linking | P2 | S–M | - | DONE — merged in PR #33, deployed 2026-06-19. `link` reply is a bilingual embed (what-you-get + 3 steps, "Open my dashboard"); `guide` gains a 2nd embed explaining the showcase + how to link. |
| 052  | Unify EWC linking terminology + fix the single-guild empty state | P2 | S | 051 | DONE — merged in PR #33, deployed. "Sync profile"→"Refresh"/"تحديث"; "select a server" empty state replaced with an actionable single-guild one; predictions copy aligned. Plus a polish commit: Refresh error labels + the `Synced`→`Refreshed` badge + Arabic guide says "اضغط زر التحديث". Reviewer re-verified: bot 194/194, web 238/238, lint clean, build OK. |
| 050  | EWC web minor cleanups (leaderboard topScore + unlink ordering) | P3 | S | - | DONE — added page-independent leaderboard `topScore`, removed the page-level page>1 top-score fetch, logged Discord unlink-delete failures while preserving delete+throw behavior, and extended leaderboard tests. Commit `06459a8`. |
| 053  | Community user-block primitive (table + gate enforcement) | P2 | S–M | - | DONE — shipped: `community_user_blocks` table + `src/db/communityUserBlocks.js`; `requireVerifiedMember` returns 403 `code:"blocked"` (`apps/web/src/lib/community.ts:134`); web tests present. (verified 2026-06-26) |
| 054  | Admin Users area — find, track, moderate community members | P2 | L | 053 | DONE — shipped: `/admin/users` page + `[discordId]` detail + `/api/admin/users/[discordId]/block` route + `community-users.ts`. (verified 2026-06-26) |
| 055  | Pin patched `undici` via package.json `overrides` (clear HIGH advisories) | P1 | S | — | DONE — executor (worktree, reviewed/approved). Plan refined mid-execute: BOTH majors were flagged (the 7.x advisory was shadowed in baseline audit), so the override is `{"undici@6":"^6.27.0","undici@7":"^7.28.0"}` (discord.js→6.27.0, cheerio→7.28.0). `npm audit --omit=dev --audit-level=high` exits 0; bot 242 pass. Commit `c1bde38`. |
| 056  | Sanitize request host before using it as the Twitch embed `parent` | P2 | S | — | DONE — executor (worktree, reviewed/approved). `parentHost` now returns the request host only if it matches `^[a-z0-9.-]{1,253}$/i`, else the configured host. web lint + build green. Commit `2d82927`. |
| 057  | Co-stream management polish — grouping tests + fixes, group-edit propagation, normalization dedup, platform-logo links | P2 | M | — | DONE — executor (worktree, reviewed/APPROVED). All 4 parts landed; reviewer re-ran gates: bot 243, web 259, web lint+build green; scope clean (13 files). Part A (viewer-sum + numeric startedAt fixes + `buildCoStreamGroups` extracted/tested), B (creator-level edits propagate to sibling rows, distinct placeholders), C (`stream-normalize.ts` dedup), D (`@icons-pack/react-simple-icons` platform logos, SOOP fallback). **Follow-up noted**: the BUG-2 (`startedAt`) regression test uses same-magnitude timestamps that order identically lexicographically + numerically, so it doesn't discriminate the comparator fix — strengthen with different-magnitude values when next touched. 4th audit @ `ec39ad6`. |
| 058  | (SPIKE) Per-match co-streams — surface `channelsForMatch` on match views | P3 | M–L | — | SUPERSEDED by 059 — the 3 product decisions are answered (live strip on match cards, link/watch not embed, EWC list on EWC matches only). |
| 059  | Per-match co-stream strip on live match cards | P3 | M | 057 | DONE — executor (worktree, reviewed/APPROVED). Reviewer re-ran gates: bot 244, web 264, lint+build green; scope clean (7 files). Batched `channelsForTournament` (distinct placeholders) + `match-co-streams.ts` (`liveCoStreamsByMatch` + pure `coStreamApplies`, tested) attached server-side to running matches; logo-link strip on the tournament-detail "Live now" cards (live-only, EWC list on EWC tournaments only). Planned @ `30d4a5e`. |
| 066  | One-tap EWC weekly picks entry (leaderboard button + default week) | P2 | M | — | DONE — executor (worktree, reviewed/APPROVED); shipped PR #64 (squash `7aea8cf`), CI green, deployed. #1 "🎯 Open my picks" button on the auto-updating leaderboard (not owner-gated, clears when no week open) + #3 `/ewc_predict weekly` defaults to current open week via shared `currentOpenWeek`. Reviewer re-ran gates: bot 267 pass. Planned @ `11f5320`. |
| 067  | Guided season picker (replace raw 10 slash options) | P3 | M-L | 066 | DONE — executor (worktree, reviewed/APPROVED); shipped PR #64 (squash `7aea8cf`), CI green, deployed. #2 guided slots + club modal mirroring the weekly picker (owner-gated, distinct-club guard, in-place re-render); incremental `upsertSeasonClubPick` (no schema change); raw 10-option path kept for back-compat. Reviewer verified all builders imported (UI not covered by tests). Planned @ `11f5320`. |
| 068  | Keep MCP key verifier hashes server-private | P1 | S | - | DONE |
| 069  | Derive MCP permissions, UI, tests, and docs from one tool manifest | P1 | M | 068 | DONE |
| 070  | Apply canonical news validation to MCP-created drafts | P1 | S | - | DONE |
| 071  | Make admin MCP news search honor locale and combined owner filters | P2 | M | - | TODO |
| 072  | Make MCP writes atomic, audited, and idempotent | P1 | L | 070 | DONE |
| 073  | Let admin MCP clients discover usable scopes and resource IDs | P2 | M | 069 | DONE |
| 074  | Confirm client-side admin navigation when a news draft is dirty | P1 | M | - | DONE |
| 075  | Redesign MCP key creation around purpose, least privilege, and setup success | P2 | L | 069, 073 | DONE |
| 076  | Standardize the admin workspace with shadcn Sidebar and entity-aware navigation | P2 | L | 074 | DONE |
| 077  | Make the prediction leaderboard use one truthful pagination model | P1 | S-M | - | DONE |
| 078  | Make notifications discoverable, live, paginated, and failure-safe | P1 | M | - | DONE |
| 079  | Turn `/me` and `/predictions` into one coherent account and prediction hub | P2 | M-L | 078 | DONE |
| 080  | Persist and publish a first-class EWC Club Championship standings leaderboard | P2 | L | - | DONE |
| 081  | Make the public MCP fast, complete, and directly linkable | P2 | M-L | 080 | DONE |
| 082  | Make prediction writes atomic and deadline-safe | P1 | M | - | DONE (this commit) |
| 083  | Surface every actionable prediction round | P1 | M | - | DONE (this commit) |
| 084  | Make prediction deadlines and completion truthful | P1 | M | 083 | DONE (this commit) |
| 085  | Remove Discord prediction picker component ceilings | P2 | M | 082 | DONE (this commit) |
| 086  | Make prediction ranks tie-aware on every surface | P2 | M | - | DONE (this commit) |
| 087  | Add explainable prediction score breakdowns | P2 | M | 082 | DONE (this commit) |
| 088  | Add secure website prediction submission | P2 | L | 082, 083, 084 | DONE (this commit) |
| 089  | Localize the complete Discord prediction experience | P2 | M | 084, 085, 087 | TODO — STOP: installed discord.js application-command locale enum lacks Arabic |
| 090  | Add a secure admin prediction operations center | P3 | L | 082, 084 | DONE (`69d9eb2`) |
| 091  | Add opt-in public predictor identities | P3 | M | 086 | DONE (`97f91c7`) |
| 092  | Add Liquipedia match details pages | P2 | L | - | DONE (PR #207) |

## Prediction-system audit (2026-07-10 @ `2301227`)

Standard scoped audit of EWC prediction submission, lock/deadline behavior,
weekly/season scoring projections, leaderboards, linked-role metadata, Discord
interaction UX, authenticated website profile/status UX, and prediction admin
operations. The operator selected every vetted finding and direction, producing
plans 082-091. No application source was changed.

Recommended execution order:

1. **Write integrity first**: 082 is the prerequisite for any additional writer.
   It makes lock decisions trusted and incremental JSON updates atomic on both
   databases.
2. **Read/funnel correctness**: 083, 085, 086, and 087 may proceed after their
   listed dependencies; 083 is the prerequisite for 084's multi-round
   completion/reminder experience.
3. **Member experience**: execute 084 after 083. Execute 089 after 084, 085, and
   087 so localization lands on the final interaction shapes rather than being
   repeatedly rewritten.
4. **New write surface**: execute 088 only after 082, 083, and 084. Website
   routes must adapt the shared domain service, never call DB upserts directly.
5. **Operations and identity**: 090 follows 082+084; 091 follows 086. These can
   run independently of 088/089 once their prerequisites land.

Vetted findings mapped to plans:

- **BUG-082**: weekly/season mutations check locks before asynchronous
  resolution and replace a read-modify-written JSON array, allowing late writes,
  lost concurrent edits, and duplicate first-pick signals
  (`ewc_predict.js:735-766,877-938`, `ewcPredictions.js:214-232,390-406`).
- **BUG-083**: web projections select one current round although official event
  windows overlap (`ewcPredictionRounds.js:3-16`,
  `public-prediction-status.ts:65-93`, `ewc-profile-sync.ts:99-136`). Production
  Week 4's MLBB lock coincides with the moment Week 3 stops winning selection,
  so the website can hide that pick for its whole actionable window.
- **BUG-084**: opening/profile copy emphasizes the final round close although
  games lock independently (`ewcPredictions.js:312-321`,
  `ewc-profile-sync.ts:119-135`). A read-only production aggregate found four
  complete and three incomplete Week 1 submissions; all incomplete submissions
  began before their missing games locked.
- **BUG-085**: the Discord picker renders only 12 games, while independent
  optional choice chunks plus first-selected parsing can ignore a cross-chunk
  edit (`ewc_predict.js:313-331,639-696`). Current official weeks have at most
  four games, so the 12-game ceiling is a future boundary; the large-choice edit
  path is reachable today.
- **BUG-086**: positional/`ROW_NUMBER` ranking gives equal scores different ranks
  and zero-point maxima count as weekly wins (`ewcPredictions.js:272-281,
  442-451,540-547`, `ewcProfileStats.js:95-111,295-307`).
- **DIR-087**: authoritative score details are stored but discarded before
  member UI, preventing members from explaining totals
  (`ewcPredictions.js:242-304`, `ewcProfileStats.js:225-237`,
  `profile-dashboard.tsx:393-413`).
- **DIR-088**: the authenticated website can identify a verified Discord member
  and show private progress but has no prediction writer; its page explicitly
  sends members back to Discord.
- **DIR-089**: Discord prediction metadata, pickers, modals, errors, and controls
  are English-only despite an Arabic-majority community and bilingual guide.
- **DIR-090**: prediction operations live in the Discord admin command and logs;
  no secure web health/recovery surface exists.
- **DIR-091**: public rows intentionally protect Discord IDs but are all labeled
  `Member ####`; explicit, revocable consent can make the competition social
  without reopening the ID leak.

Verification performed during audit:

- 64 focused bot prediction tests passed.
- 13 focused web prediction/profile/leaderboard tests passed.
- `npm audit --omit=dev --audit-level=high` reported no high/critical production
  advisory. The two moderate Next/PostCSS findings require a breaking forced
  resolution and were not made a prediction-system plan.

Considered and rejected in this pass:

- **Continuous polling as a standalone fix**: not worth a separate plan.
  TanStack Query refetches on focus/reconnect and the global route freshness
  guard refreshes revisited/long-hidden routes. Plans 083/084 should update the
  bounded prediction model without introducing WebSockets.
- **Discord leaderboard member-fetch N+1**: bounded to small leaderboard/image
  sets, benefits from Discord caches, and runs in a single-guild background job.
- **Publishing names by default**: rejected on privacy grounds. Plan 091 is
  explicitly opt-in and preserves anonymous fallback.
- **Changing scoring point values/bonuses**: no correctness defect was found in
  the characterized formulas; plans improve writes, rank semantics, and
  explanations without rebasing the competition.
- **A new generic notification type for prediction DMs**: deferred. Plan 084
  uses restrained channel reminders; personal DMs require a separate preference
  and migration decision.

Not audited in this pass: unrelated match/Liquipedia parsing and rate behavior,
co-streams, news/CMS, general MCP/admin behavior outside prediction dependencies,
and live visual acceptance inside Discord clients. The full repo test/build
matrix was not rerun because this was a read-only planning audit; every plan
requires it during execution. Existing untracked Discord image assets were left
untouched.
| 093  | Add a safe, responsive 1-9 stream co-stream multiview | P1 | L | 057 | DONE - executor worktree reviewed/APPROVED at `9545779`; 557 bot tests, 604 web tests, lint, build, diff check, repeated seed (9 rows / 9 creator groups), and EN/AR responsive QA passed. Physical Esc-key automation was infrastructure-limited; fullscreen enter/exit and state transitions passed through the on-page control. |
| 094  | Add browser E2E coverage and a read-only production smoke suite | P1 | L | - | TODO |
| 095  | Add consent-aware, privacy-safe product analytics | P1 | M-L | 094 | TODO |
| 096  | Add unified global public search | P2 | M-L | 094 (095 recommended) | TODO |
| 097  | Add a personalized Today for you overview | P2 | M-L | 094 (095 recommended) | TODO |
| 098  | Add Discord follow management | P2 | M-L | 094 recommended | TODO |
| 099  | Add quiet hours, digest delivery, and per-follow notification controls | P2 | L | 098 | TODO |
| 100  | Show tournament data freshness and source health | P2 | L | 094 (095 recommended) | TODO |
| 101  | Redesign the login page as a first-class public-site surface | P1 | M | - | DONE - merged in PR #254 (`b272848`); deployed successfully to CranL and production-smoked in EN/AR. |
| 102  | Add a live match center | P1 | M-L | 094 recommended | DONE |
| 103  | Add a personal match calendar with iCal export | P1 | M | 097 recommended | DONE |
| 104  | Add opt-in web push notifications | P1 | L | 099 | TODO |
| 105  | Show community pick distribution after lock | P1 | M | - | DONE |
| 106  | Add interactive playoff bracket views | P1 | L | 102 optional | DONE |
| 107  | Add private prediction mini-leagues | P1 | L | - | DONE |
| 108  | Add predictor achievements and streak badges | P2 | M | - | DONE |
| 109  | Add match discussion threads | P2 | M-L | - | DONE |
| 110  | Add PWA install support and an offline shell | P2 | M | 104 optional | TODO |
| 111  | Add team and player comparison pages | P2 | M-L | - | DONE |
| 112  | Add Club Championship standings history charts | P2 | M | 080 | DONE |
| 113  | Add downloadable web share cards | P2 | M | - | DONE |
| 114  | Add language and game filters to co-streams | P2 | S-M | 093 | DONE |
| 115  | Add one-tap match reminders | P2 | M | 099 recommended | DONE |
| 116  | Add MVP of the day voting | P3 | M-L | - | DONE |
| 117  | Add moderated highlight and clip submissions | P3 | L | - | DEFERRED (legal/copyright policy) |
| 118  | Add public predictor profile pages | P2 | M | 108 optional | DONE |
| 119  | Add a compare-me prediction widget | P3 | S-M | - | DONE |
| 120  | Add scheduled publishing and an editorial calendar | P1 | L | - | DONE |
| 121  | Add per-post analytics for media channels | P1 | M-L | 095 | DONE |
| 122  | Add branded graphics generator for admins and media channels | P2 | L | - | DONE |
| 123  | Add keyword auto-flagging and bulk moderation | P2 | M-L | - | DONE |
| 124  | Add a cross-post composer for site, Discord, and social drafts | P2 | L | 120 recommended | DONE |
| 125  | Exercise PostgreSQL behavior in CI | P1 | M | - | DONE |
| 126  | Bound every web mutation request before parsing | P1 | L | - | TODO |
| 127  | Preserve CMS content when games or media channels are deleted | P1 | M | - | DONE |
| 128  | Compute and reconcile official EWC boundaries in Riyadh | P1 | M | - | DONE |
| 129  | Serialize prediction submissions with round transitions and scoring | P1 | M | 125 | TODO |
| 130  | Give EWC prediction games stable identities and migrate references | P1 | L | 129 | TODO |
| 131  | Require authoritative and complete EWC results before final scoring | P1 | M | - | DONE |
| 132  | Make manual prediction scoring honor automation readiness | P1 | M | 129, 131 | TODO |
| 133  | Gate every service startup on versioned PostgreSQL migrations | P1 | L | 125 | TODO |
| 134  | Make SQLite-to-PostgreSQL imports fail closed on skipped data | P1 | M | 125, 133 | TODO |
| 135  | Route Liquipedia MediaWiki requests through one scheduler | P1 | M | - | DONE |
| 136  | Serialize, persist, and paginate LPDB schedule requests | P1 | M | - | DONE |
Status values: TODO | IN PROGRESS | DONE | BLOCKED (reason) | REJECTED (rationale) | SUPERSEDED.

## Deep reliability audit - first planning batch (2026-07-23 @ `0718e2d`)

Plans 125-136 are the operator-selected first batch from the 2026-07-23 deep
audit. The audit covered the complete owned bot/web repository, excluding
dependencies, generated assets, secret values, and live external
infrastructure. Baseline verification was green.

### Recommended execution order

1. **Establish the safety lane**: execute 125 first.
2. **Independent urgent fixes**: 126, 127, 128, 131, 135, and 136 may proceed
   after their own drift checks.
3. **Prediction integrity chain**: 129 after 125; then 130 after 129. Execute
   132 only after both 129 and 131.
4. **Database rollout chain**: 133 after 125; 134 after 133.
5. **Production data operations are separate approvals**: plans 128 and 130
   create dry-run-first reconciliation tools. Do not apply those tools to
   production without a separate operator review.

## Feature roadmap dependency notes (plans 102-124)

Recommended first execution batch: **102 Live Match Center**, **105 pick
distribution**, **120 scheduled publishing**, **121 media analytics** after plan
095, and **114 co-stream filters**. These are high audience/admin value and
compose from existing data.

- 104 depends on 099 because push notifications must respect quiet hours and
  notification controls.
- 103 is stronger after 097 because the personalized overview should share the
  same followed-match projection.
- 106 can ship independently, but 102 gives it a natural entry point.
- 118 can ship before 108, but the public predictor pages are richer after
  achievements exist.
- 124 should follow or at least coordinate with 120 so scheduled publishing and
  cross-post copy do not create conflicting post lifecycle states.

## Login experience plan (2026-07-15 @ `fe7beec`)

Plan 101 removes the generic standalone login-demo treatment without changing
the one-provider auth model. It keeps the shared public header/footer, composes
one responsive shadcn auth card with the real EC mark, localizes every visible
state for EN/AR, and fail-closes query-provided callback paths before handing
them to Better Auth. Unit, Playwright, full workspace, PR, and CranL production
gates are included because this page sits on every protected-route entry path.

## End-user experience roadmap (2026-07-14 @ `1530ee8`)

The operator selected all seven grounded opportunities from the latest website
and Discord experience review. They are split into independently reviewable
plans with explicit privacy, authorization, provider-rate, and production-safety
boundaries. No application source was changed while preparing these plans.

Recommended execution order:

1. **Testing foundation**: execute 094 first. It establishes deterministic
   browser coverage and a non-mutating production smoke check for every later
   user-facing change.
2. **Measurement contract**: execute 095 next. Its closed event allowlist,
   consent boundary, and admin aggregates make later product decisions
   measurable without collecting arbitrary metadata or personal data.
3. **Parallel product work**: 096, 097, 098, and 100 can proceed in parallel
   after 094. Landing 095 first is recommended so each surface is instrumented
   through the approved event contract from its first release.
4. **Notification delivery controls**: execute 099 after 098 because both touch
   follow identity, Discord command UX, and notification fan-out semantics.

The seven plans are:

- **094**: Playwright desktop/mobile EN/AR journeys, disposable seeded data,
  CI coverage, and an opt-in read-only production smoke workflow.
- **095**: consent-aware product events with a closed schema, abuse controls,
  retention, and aggregate-only admin reporting.
- **096**: one keyboard/mobile global search across public stored entities,
  with bounded groups, localized URLs, and no upstream fetches.
- **097**: a bounded account overview for followed live/upcoming matches,
  unread notifications, actionable prediction rounds, and relevant co-streams.
- **098**: ephemeral `/follow` management using canonical local entities and
  the existing single-guild follow quota/authorization model.
- **099**: immediate/digest modes, quiet hours, per-follow overrides, paced
  retryable Discord delivery, and an always-immediate website inbox.
- **100**: durable sanitized schedule-sync health, coarse public freshness,
  tournament status UI, and a super-admin operational view without manual
  provider refresh controls.

## End-user, predictions, notifications, standings, and public MCP audit (2026-07-10 @ `ba288a1`)

Focused source audit of the public account/profile experience, notification
inbox, prediction landing page and leaderboard, EWC club tracker, and public
MCP. The operator requested plans for every named surface, so all five vetted
work packages were planned without an additional selection round. No
application source was changed.

Recommended execution order:

1. **Immediate correctness**: 077 and 078 can run in parallel. They remove the
   prediction leaderboard's double pagination and make notification actions
   refreshable, reachable, and reversible.
2. **Account experience**: 079 after 078, because the account workspace should
   compose the completed inbox/query model rather than duplicate it.
3. **Authoritative standings data**: 080 can run alongside 077/078. It persists
   the successful bot refresh before adding a rank-ordered public page.
4. **Public MCP contract**: 081 after 080. MCP then consumes the stored
   standings projection instead of waiting on Liquipedia and can expose a
   clearly named Club Championship standings tool.

Vetted findings mapped to plans:

- **BUG-077**: the server fetches and labels 100 rows while TanStack Table's
  implicit client page renders ten (`leaderboard/.../page.tsx:28-79`,
  `leaderboard-table.tsx:155-165,213-224`).
- **BUG-078**: notifications load only once and only the first 20 are reachable;
  unfollow/mark-all failure handling is incomplete
  (`follow-center.tsx:77-143,221-297`).
- **DIR-079**: `/predictions` is two static links and `/me` is three separate
  vertical tools; neither projects the canonical current-round state
  (`predictions/page.tsx:65-112`, `me/page.tsx:33-51`,
  `ewcPredictions.js:378-402`).
- **DIR-080**: successful live Club Championship fetches are not persisted, and
  the web fallback reuses prediction scoring snapshots
  (`clubChampionship.js:58-89`, `ewc-clubs.ts:341-365,583-675`).
- **PERF/DIR-081**: public MCP news search is latest-51 in the global case,
  returns relative site links, and club reads can wait on live Liquipedia
  (`public-mcp-tools.ts:85-109,312-335,396-427`).

Considered and rejected in this pass:

- Trusting `x-forwarded-for` when `cf-connecting-ip` is absent: rejected. The
  current shared fallback bucket is intentional and tested against spoofed
  forwarding headers.
- Reusing `/leaderboard` for club points: rejected. It is a community prediction
  ranking with different entities, privacy rules, and scoring semantics.
- Web prediction submission in this batch: deferred. It writes to the scoring
  path and needs a separate authorization/lock/idempotency plan after the
  read-only profile hub is proven.
- WebSockets/push for notifications: not worth the infrastructure. Conservative
  focus/interval refetch is sufficient for a single-guild community site.

## MCP + admin experience audit (2026-07-09 @ `5091ff1`)

Source-only audit of the admin/public MCP implementation and the admin dashboard
shell, key-management workflow, news editor navigation, bilingual docs, and
Base UI shadcn composition. The operator selected all nine vetted findings for
planning. Plans 068-076 are self-contained handoffs; no application code was
changed during the audit.

Recommended execution order:

1. **Immediate boundaries and correctness**: 068, 070, and 074 can run in
   parallel. They close the verifier DTO leak, invalid MCP draft writes, and
   client-navigation data loss.
2. **Shared MCP contract**: 069 after 068, then 073. This establishes one tool
   manifest before adding always-on capability discovery.
3. **Write integrity**: 072 after 070. It is the highest-risk plan and must use
   one dual-backend transaction for mutation, audit, and retry receipt.
4. **Experience work**: 075 after 069+073; 076 after 074. The key workflow must
   understand real capability classes, and the Sidebar migration must preserve
   the shared dirty-navigation guard.

Findings mapped to plans:

- **068**: runtime `keyHash` survived TypeScript casts and object spreads into
  admin API/page objects. The stored secret has high entropy, so forced key
  rotation is not part of the plan; explicit safe DTOs are.
- **069**: tool names, grant semantics, UI, tests, and bilingual docs drifted
  across several sources. Existing public-only reads intentionally remain
  always available through admin MCP.
- **070**: `create_news_draft` bypassed canonical content limits and owner
  existence checks.
- **071**: combined game+media news filters generated impossible SQL and locale
  search ran against the default-language projection.
- **072**: MCP writes, audit rows, stream sibling propagation, and retries were
  not one atomic/idempotent operation.
- **073**: write tools required media slugs and numeric stream IDs that clients
  could not discover safely.
- **074**: `beforeunload` covered tab close/hard navigation but not normal Next
  Link navigation in the admin workspace.
- **075**: the key form defaulted to maximum access and used inaccessible,
  unsearchable custom chips instead of Base UI shadcn controls.
- **076**: the custom admin shell/static breadcrumb/manual page headers caused
  dynamic-route ambiguity, RTL arrow regressions, and excess vertical space.

Considered and not planned in this pass:

- **Brute-forcing a leaked verifier into a bearer secret**: impractical with
  the current 32-byte random secret; the concrete issue is verifier disclosure
  and unsafe serialization, addressed by 068.
- **Public MCP exposing raw enrichment/auth fields**: current team/player,
  co-stream, and leaderboard projections are explicit and tests cover public
  fields. No concrete leak was found.
- **Admin news-list N+1/per-request filtering rewrite**: cached, bounded, and
  previously accepted for the single-guild deployment. Plan 071 changes only
  the semantics needed for correct MCP locale/owner filtering.
- **Next/PostCSS moderate audit advisory**: no high/critical production
  advisory and no stable framework target verified in this audit; retain the
  existing upgrade watch rather than forcing a canary.
- **A new DOM test stack**: the current Vitest environment is node-only. Plans
  074/075 extract pure models and require browser acceptance; adding jsdom or
  React Testing Library remains a separate workflow decision.
- **New MCP publishing/moderation powers**: deferred. V1 writes stay draft-only
  or narrowly scoped stream updates.

Not audited in this pass: Discord bot match/fetch behavior, unrelated public
website pages, production CranL runtime state, and the unrelated untracked
Discord image assets in `apps/web/src/app`.

## Ninth pass (2026-06-24 @ `11f5320`) — EWC command interaction UX (operator: "execute all 3")

Direction/UX audit of how members interact with the EWC prediction commands. The
flows are correct; the gaps are friction + discovery. → plans 066 (#1 one-tap
button + #3 default-week) and 067 (#2 guided season picker). Deferred: announce a
week the moment it OPENS (needs an `open_announced` schema flag + automation pass) —
066's leaderboard button covers persistent one-tap entry without it.

## Fourth audit (2026-06-21 @ `ec39ad6`) — co-streaming feature + management

Scoped to the co-stream feature only (security covered last run via 055/056).
Findings → plan 057 (parts A–D) + spike 058. Considered and rejected:
- **`game_slugs LIKE '%"slug"%'` JSON-substring matching** — fragile in theory
  but `cleanGameSlug` makes slugs alphanumeric and the quoted pattern avoids
  prefix collisions; a join table is heavier than the ≤12-slug payload warrants.
- **`groupKey` collision when two creators share a normalized key** — admin
  controls labels/creatorKeys; low real risk, not worth a uniqueness constraint.
- **Public page `router.refresh()` every 60s per viewer (PERF-01)** — real but
  only bites at live-event concurrency; recorded as backlog. A lightweight JSON
  status endpoint + client poll is the fix when load warrants it.
- **Admin manager client component has no tests** — UI logic; the valuable
  pure logic (grouping, normalization) is extracted + tested by 057 instead.

## Co-stream feature security audit (2026-06-21, main @ e6bd9a9)

Focused security pass over the new live-co-stream feature (PRs #40–#44 + the
multi-platform / `gameSlugs` / `creatorKey` / `isDefault` extensions) plus a
`npm audit` sweep. The feature is well-built: SQL is fully parameterized (`$n`,
`cleanGameSlug` sanitizes the JSON `LIKE` term, distinct placeholders — no
injection/reuse), admin routes are super-only + `sameOriginOr403` + audited,
input is validated/length-capped, the poller URL-builds via `URLSearchParams`
(no SSRF — fixed hosts), the new columns are migrated in BOTH schemas
(`ALTER TABLE ... ADD COLUMN IF NOT EXISTS` + `ensureColumns`), and all rendering
is React-escaped (no `dangerouslySetInnerHTML`). Two findings became plans:

- **055 (P1, HIGH)** — `undici@6.24.1` transitive via `discord.js` carries 8 HIGH
  advisories; fix via `overrides`. Reachability limited (bot → Discord API), but
  HIGH + cheap fix.
- **056 (P2, LOW)** — `co-streams/page.tsx` reflects client `x-forwarded-host`
  into the Twitch embed `parent`; React-escaped so no XSS, but trust-smell.

### Findings considered and rejected (2026-06-21) — do not re-audit

- **`*.twitch.tv` / `*.kick.com` wildcards in CSP `frame-src`** (`next.config.ts`):
  required for the player's nested frames; scoped to the two trusted vendors. By design.
- **No `sandbox` on the Twitch/Kick `<iframe>`** (`stream-embed.tsx`): sandboxing a
  trusted video player breaks it; CSP already restricts framed origins. Not a finding.
- **Public co-streams directory exposes channel handles/labels/live status**: by
  design — they are public streamer handles, no PII.
- **No rate-limit on `/api/admin/streams`**: super-admin-only (trusted), consistent
  with the other admin CRUD routes (media/games). Not worth doing.
- **`game_slugs LIKE %"slug"%` substring match**: the slug is alphanumeric-cleaned
  and quoted, so cross-slug false matches don't occur in practice. Minor correctness, not security.

## Security deep audit (2026-06-14, main @ d19a87f)

Focused pass on externally influenced fetches, public unauthenticated web
routes, admin RBAC symmetry, auth redirect behavior, upload/markdown handling,
headers/CSP, container posture, dependency audit, and CI supply chain. No
critical/high production secret leak was found. New actionable hardening work is
tracked in plans 027-030.

## Website security deep audit (2026-06-14, main @ f1a1b6e)

Focused pass on the dashboard/web app: admin news write paths, author
attribution, public EWC leaderboard routes, markdown/upload handling, Better
Auth/session gates, internal API secret checks, production headers/CSP, and web
dependency audit. No critical/high issue was found. New actionable hardening
work is tracked in plans 031-032. Dependency audit still reports the known
Next-bundled `postcss` advisory; npm currently offers `next@16.2.9`, which still
depends on `postcss@8.4.31`, so there is no stable Next upgrade that clears it
yet.

## Website product audit (2026-06-14, main @ f1a1b6e)

Focused pass on the public dashboard experience: public game/news/media/
tournament pages, admin affordances exposed from public pages, share metadata,
leaderboard pagination, route boundaries, and current web test coverage. New
actionable website polish work is tracked in plans 033-036. Directional backlog
items not turned into first-batch plans: archive pagination for news lists,
finished-tournament archive filters, and a future DOM/component test harness for
large client editors once the admin CMS stabilizes.

## Security audit (2026-06-18, main @ 347a0d0)

Focused security pass (3 read-only subagents) on the surfaces added since the
2026-06-14 deep audits: the comments/likes/moderation feature, the SQLite→Postgres
dual-backend (`src/db/client.js`), web auth/RBAC/CSRF, the locale middleware
(`apps/web/src/proxy.ts`), the post-share component, and deps/config/secrets.
Recent hardening (PRs #25/#27/#29) had already closed most of the real surface;
this pass produced exactly **one** plan-worthy finding → plan 043 (web auth-DB
pool TLS mapping diverges from the bot pool — can't certificate-verify the
session/credential connection even when the operator sets `verify-full`).

Verified directly during vetting (no action needed): comment edit/delete enforce
server-side ownership (`apps/web/src/app/api/comments/[id]/route.ts:26,55`, 403 on
mismatch) + CSRF + rate limits — no IDOR; comment POST/GET and likes are gated and
bounded; the post-share X-intent URL is `encodeURIComponent`-escaped.

## Bot-internals security audit (2026-06-18, main @ 347a0d0)

Focused pass (3 subagents) on surfaces skipped in the prior pass: Liquipedia
client/fetchers/rateState, parsers + canvas/image rendering, slash-commands +
the EWC scoring "money path". 13 candidates → 11 rejected (see below), 2 real
hardening items, both about resilience to malicious/oversized UPSTREAM
(Liquipedia) content — neither high-severity (Liquipedia is a trusted third
party over HTTPS).

- **044 (response-size cap on the Liquipedia axios client)** — TODO/executing.
  Clean, behavior-preserving, generous env-overridable cap.
- **045 (image decompression-bomb guard on logo decode)** — DEFERRED, accepted
  risk. `src/lib/logoCache.js:31,34`: `loadImage(bytes)` then
  `createCanvas(img.width, img.height)` run with only a 4 MB *byte* cap upstream
  (`src/lib/logoSource.js:21,221`); a byte cap does not bound *decoded* pixels,
  so a ≤4 MB image from an allow-listed host could decode to huge dimensions →
  OOM. NOT executed per operator constraint ("don't hurt performance or current
  behavior"): the correct fix needs a PRE-decode dimension check (the decode is
  the bomb), which means a new runtime dependency or a hand-rolled multi-format
  header parser — both add per-logo work and a real chance of turning an
  unusual-but-legitimate logo into a placeholder (a visible behavior change).
  The cheap "check after loadImage" version is theater (the OOM already happened
  during decode). Threat is low-likelihood (needs an allow-listed host — i.e.
  Liquipedia's own wiki/CDN — serving a crafted image referenced on a tracked
  page). Revisit if the operator accepts a small per-logo header-read cost.

Low-leverage, noted but not planned: unbounded parser loops / unclamped parsed
name lengths in `src/services/liquipedia/parsers.js` (same malicious-wiki-content
theme; path is cached + throttled, pages curated); `picks_json` read-side schema
validation in `src/lib/ewcPredictions.js` (defense-in-depth only — the write path
validates; would need DB corruption to bite).

Not audited this pass: the cron jobs' internal logic (`src/jobs/*` beyond
fetch/parse/render entry points), `markdownTools`/`discordContent` formatting.

### Bot-internals findings rejected (2026-06-18) — do not re-audit

- **ReDoS in `cleanName`** (`src/services/liquipedia/parsers.js:51`,
  `/\((?:[^)]*?\s)?stack\)/gi`) — false. A single bounded lazy quantifier
  (`[^)]` can't cross `)`), no nested/overlapping quantifiers → linear, not
  catastrophic; applied to short names, not blobs.
- **SSRF via `add_tournament` game param** — false. `game` interpolates into
  `https://liquipedia.net/${game}/api.php` (`client.js:54`); the host is fixed,
  `game` only affects the path (no host escape). Worst case is a 404. Data-hygiene
  nit, not a vuln.
- **Rate-state file needs bounds validation** (`rateState.js:19-25`) — not a
  security finding. The parse is already try/caught (corrupt file → first-run
  defaults); `blockedUntil` magnitude is a config constant, not remote-controllable
  (upstream can only trigger the fixed backoff). Tampering needs local FS write =
  host already owned.
- **Internal secret undocumented / rotation risk** — false. `EWC_DASHBOARD_INTERNAL_SECRET`
  IS documented (`.env.example:98`), env-based/gitignored, by-design internal
  bot→web header; internal sync/unlink routes are already rate-limited.
- **`setEwcWeekSnapshot` dynamic column** — already rejected (prior pass): ternary
  between two hard-coded literals, not injectable.
- **Score integer overflow** (`ewcPredictions.js`) — no practical trigger (~33k
  max vs 2^53); speculative.
- **Liquipedia axios follows redirects (maxRedirects:5)** — Liquipedia is a trusted
  upstream over HTTPS; exploitation needs upstream compromise. Not changing.

## EWC linking-experience audit (2026-06-18, main @ 946138d)

Focused UX/docs audit of the EWC predict-link flow across Discord (`/ewc_predict
link`/`sync`/`guide`/`unlink`) and web (`/me`, `/predictions`, ProfileDashboard).
Operator note carried into the plans: **the bot serves ONE guild — there is no
server to select**, so all guild-selection language is wrong copy, not a feature.
Operator selected the link-message+guide rewrite and the terminology unification:

- **051** (P2) rewrite the bare `/ewc_predict link` reply (what-you-get + 3 steps)
  and add a linking/showcase section to `/ewc_predict guide` (it currently explains
  predictions thoroughly but never mentions linking — the "guide isn't complete"
  gap). Discord copy only.
- **052** (P2, dep 051) unify the terminology (link / refresh / unlink / "your EWC
  showcase") across the web, rename the "Sync profile" button to "Refresh", and
  remove the single-guild-wrong "select a server" empty-state copy. Web copy only.

**Dependency**: 052 reuses 051's chosen user-facing words — land 051's wording
first (or keep them in lockstep).

### Linking-UX findings deferred / reframed (2026-06-18)

- **Website dead-end** (`/predictions` → "Open my profile" → `/me` with no guildId →
  empty state) — reframed by the single-guild note: the harmful part was the
  "select a server" copy (fixed in 052). The empty state itself is legitimate for a
  member who hasn't made picks yet. A fully-seamless fix (auto-resolve the one guild
  on `/me`, like `/leaderboard` does) is a flow change, deferred — noted in 052.
- **link vs sync as separate commands** — not renaming the slash commands (renames
  are disruptive); 052 instead clarifies the words and makes "sync"→"Refresh" on the
  web where members actually see it.

## EWC prediction-system audit (2026-06-18, main @ e7e0a6e)

Feature-scoped audit of the EWC prediction system across bot + web (3 subagents:
scoring money path, lifecycle/commands/job, web surface), weighted to
CORRECTNESS + TEST COVERAGE since security was already swept 3×. The scoring
**math** is well-tested and correct on the paths read; the gap is everything
around it. Five plans (046-050) selected by the operator:

- **046** (P2) bot lifecycle characterization tests — pin pick idempotency, score
  save/overwrite, status transitions, best-N-weeks tie selection. **Land first.**
- **047** (P2, dep 046) admin `score_week` guards — block re-scoring a 'scored'
  week + reject empty aggregate standings (the automation already guards both; the
  command can silently score everyone 0 on a fetch failure, then mark scored).
- **048** (P2) web tests for the public leaderboard + profile sync/unlink (the
  main public surface has ZERO web tests today).
- **049** (P3) scoring-math edge cases + document the single-game all-winners-bonus
  decision.
- **050** (P3, optional) web cleanups: fold `topScore` into the leaderboard
  response (drop the page>1 double-fetch); log a failed Discord unlink.

**Dependency ordering**: 046 (tests, freezes behavior) → 047 (guard change). The
rest are independent. 050's test extends 048's leaderboard test if 048 lands first.

### EWC findings rejected (2026-06-18) — do not re-audit

- **Leaderboard "single cache key" cross-contamination** (`public-ewc-leaderboard.ts:27`)
  — false. `unstable_cache` keys on the wrapped fn's ARGS (guildId/season/limit/offset);
  `["public-ewc-leaderboard"]` is only a namespace. No cross-contamination.
- **Pagination off-by-one if total changes mid-render** — false. `total` and `rows`
  come from ONE cached object (`page.tsx:65,82`); `rangeEnd` is always consistent.
- **Unlink "returns success on Discord failure"** — false. `ewc-profile-sync.ts:157-167`
  is `try/finally` with NO catch — a Discord failure propagates (caller gets the error),
  it does not return `{deleted:true}`. (The minor residual — no log for the orphaned
  role connection — is folded into plan 050.)
- **Single-game all-winners bonus "bug"** (`ewcPredictions.js:258`) — design call,
  not a bug; `details.length > 1` makes a "sweep ALL games" bonus meaningless for one
  game. Pinned + flagged for decision in plan 049, not changed.
- **Score integer overflow / NaN** — no practical trigger (~33k max vs 2^53); season
  scoring read and correct.
- **Transaction atomicity unknown** — already verified real (`client.js` BEGIN/COMMIT/ROLLBACK
  on both backends); admin + automation scoring loops are wrapped in `transaction(...)`.
- **Admin can score an unclosed (open) week** — intentional admin override; NOT guarded
  by plan 047 (only re-score + empty-standings are).

Not audited this pass: the leaderboard CARD render internals, `discordRoleConnection`
payload building, `ewcClubCache`/`ewcNewsContent` — and security (covered 3× already).

## Jobs + formatting security sweep (2026-06-18, main @ 347a0d0)

Third focused pass, scoped to the only surface left un-audited after the
web/data and bot-internals passes: `src/jobs/*` internal logic + the
`markdownTools`/`discordContent`/`ewcNewsContent` formatting helpers. **Result:
ZERO actionable findings.** The markdown helpers have no ReDoS (escaped
anchored-prefix matches + a linear `[text](url)` regex), the formatting regexes
are linear, mentions are neutralized by the global `allowedMentions: { parse: [] }`,
and no job reaches a shell/eval/fs/SSRF sink. The security surface at this commit
is now comprehensively covered across the three passes; further audits here have
diminishing returns until the code changes. The productive security ACTION now is
to ship the two ready hardening branches (043, 044), not more audits.

### Jobs/formatting findings rejected (2026-06-18) — do not re-audit

- **Unhandled Discord send/edit wedges the cron loop** — false. Jobs run as
  `setInterval(() => run().catch(log), …)` (`src/jobs/ewcPredictions.js:429`); a
  throw is caught per-tick and the next tick fires normally. `refresh.js` already
  wraps each board; announcers have parent try/catch loops. A failed send skips
  one update, it does not stop the schedule.
- **User-supplied champion pick can blow past the 4096-char embed limit**
  (`src/jobs/ewcPredictions.js:61-70,96`) — false. `championPick` is
  `prediction.picks[0]`, a CONSTRAINED selection from the guided picker (not free
  text), and `leaderboardLines` caps at 20 rows of `<@id>` mentions (not names) —
  bounded to ~1.5 KB by construction, far under 4096.
- **Many users × long picks → oversized embed** — same bounding; non-issue.
- **Internal secret leaks via `response.text()`** (`src/jobs/ewcPredictions.js:238`)
  — false. The secret travels only in the OUTGOING request header (`:229`); the
  logged value is the web route's response body, which returns generic JSON errors
  and never echoes request headers. No exposure.

### Findings considered and rejected (2026-06-18) — do not re-audit

- **`sqliteParams` "parameter corruption" on repeated `$N`** (`src/db/client.js:29-39`)
  — false. The regex emits one `?` and pushes one value per `$N` occurrence, so the
  `?` count always equals the params-array length by construction (`$12,$12` →
  two `?` + two values is correct). SQLite path is dev/test-only anyway (prod = Postgres).
- **`canManageGame`/`canManageMedia` call `.includes()` on the string `"ALL"`**
  (`apps/web/src/lib/admin.ts:101,105`) — false. The `games !== "ALL"` guard narrows
  the union before `.includes`; it never runs on the string. Correct and type-safe.
- **Dynamic column name in `setEwcWeekSnapshot`** (`src/db/ewcPredictions.js:~148`)
  — not injectable. `column` is a ternary between two hard-coded literals
  (`baseline_json`/`final_json`); no input becomes the identifier. Same class as the
  already-accepted `ensureColumns` hardcoded-constant pattern.
- **`internalSecret()` returns `""` when unset** (`apps/web/src/lib/env.ts`) — fails
  CLOSED (`isInternalRequestAuthorized` rejects on empty). Not a bypass (re-confirmed).
- **Dynamic WHERE / `IN()` placeholder builders** (`src/db/postComments.js`,
  `src/db/commentLikes.js`) — correctly parameterized (`$${params.length}` /
  index-offset joins); "fragility/smell," not a vulnerability.
- **PostCSS XSS advisory via Next bundle** — known; no stable fixed Next yet. Deferred.
- **"Throw in prod if Postgres TLS is off"** (subagent's suggested 043 fix) — REJECTED:
  prod runs `PGSSLMODE=disable` because the server rejects SSL; throwing would crash
  boot. Plan 043 is mapping *consistency* only, not enforcement.

Not re-audited (covered by prior audits, unchanged this cycle): Liquipedia
parsers/client internals, canvas rendering, EWC scoring math, bot slash-command
internals beyond an injection grep.

## Merged (2026-06-10)

Plans 003, 009, 005, 006b were merged into `feature/ewc-profile-showcase-dashboard`
(merge head `c260e10`) and verified there: 35 tests pass, web lint clean, web
build clean (after `npm install` for upstream's new deps). Advisor branches
and executor worktrees deleted; per-plan SHAs are reachable from the branch.
Note: upstream's `getAdminAccess` grants the dev-auth-bypass user super admin
(dev-only by NODE_ENV gate) — documented with a warning in the apps/web
README security section.

## Per-game prediction reconciliation (2026-06-12, main @ ad19f00)

During the merge to `main`, 9 stranded commits were discovered on the old
local main (preserved on branch `backup-old-local-main`): the **per-game
weekly prediction system that production actually runs** (Components-V2
guided picker, per-game picks inside picks_json, `fetchEwcWeekGameResults`
placement scoring, effective week-status state machine) — the dashboard PR
had been branched before that line landed, so `main` carried the older
3-club weekly model. An executor port (reviewed + gated) reconciled it:
backup's per-game feature + ALL of main's hardening (liquipedia split,
scoring transactions, delete_week, dashboard subcommands, allowedMentions)
across 15 files; per-game results re-homed into `liquipedia/{parsers,fetchers}`;
14 new characterization tests (96 bot total); zero existing assertions
changed (shared scoring fns were byte-identical). The three job-hygiene
files (pollingManager 48h-cap/dedupe/placeholder-skip, cc/cs debug logging)
were adopted wholesale (main never diverged on them). Prod-data compatible:
identical table schemas; 4 idempotent ensureColumns additions on
`ewc_prediction_weeks`.

**`backup-old-local-main` must be KEPT until a production deploy of
`main` is verified against the live DB** — it is the only copy of the
exact code production currently runs. Delete it after a successful deploy.

Known carried-over edge (not a regression): a pathological 48-char game
slug could push the picker's modal customId to ~103 chars (>100 limit);
real EWC-2026 names max out at 26 chars → worst case 76. Revisit only if
CMS admins create extremely long game names.

## Batch 2 — merging the executed branches (verified 2026-06-11)

All remaining plans executed in three chains plus independents; every
cross-chain pairwise `git merge-tree` dry-run is conflict-free. Merge the
CHAIN HEADS in this order from `feature/ewc-profile-showcase-dashboard`
(each head brings its whole chain):

1. `advisor/014-news-lifecycle-tests`
2. `advisor/008-agents-md` (chain B: 001 CI → 002 → 004 → 010 → 008)
3. `advisor/016-cms-docs` (chain C: 007 → 016)
4. `advisor/018-web-admin-audit-log` (chain A: 012 → 013 → 015 → 018)
5. `advisor/011-tournaments-spike`, `advisor/017-discord-news-spike` (design docs)

Then regenerate/verify: `npm install && npm test &&
npm --workspace @esports-community-bot/web run test && npm run web:build`
(lockfile was edited on two chains — npm install reconciles it; expected
post-merge totals ≈ 77 bot tests + 107 web tests).

**Advisor erratum corrected during this batch**: `PRAGMA foreign_keys = ON`
IS set (`src/db/connection.js:22`) — earlier "inert FK" claims in plans/docs
were fixed (008's AGENTS.md content, the rejected-findings entry below).

## Dependency notes

- **001 (CI) remains the highest-leverage TODO** — 35 bot tests plus
  (post-013) a web test suite exist with no automated gate.
- **002 before 004**: scoring tests freeze behavior before the transaction
  wrapper touches the call sites.
- **012, 013, 015, 018 all touch `/api/admin/*` route files** — execute
  serially (recommended order: 012 → 013 → 015 → 018), or rebase carefully.
- **013 + 012**: once both land, add validator-cap unit tests in 013's runner.
- **017 builds on news modules** protected by 014's tests — land 014 first.
- **008** should land after 004 (its allowedMentions wording) — the plan's
  refresh notes explain how to adjust if not.

## Findings considered and rejected

First audit (at `2c0ba69`):

- **"Internal API fails open when secret unset"** — false; the guard returns
  401 when the secret is empty. Fails closed.
- **"React Query invalidation misses key variants"** — false; prefix matching
  is the default.
- **"deferReply 3s timeout / errors swallowed after defer"** — false; defer
  grants 15 min and `interactionCreate.js` has a global catch.
- **"riyadhStartOfDay relies on undocumented Date.UTC behavior"** —
  spec-defined; Riyadh display TZ is intentional.
- **Admin slash commands "missing" server-side permission checks** —
  `default_member_permissions` is enforced by Discord; overrides are
  platform-intended.
- **Dev auth bypass reachable in staging/prod** — `NODE_ENV` gate;
  `next build/start` force production. (Upstream later made the bypass a
  super admin — still dev-only; documented, accepted.)
- **Email/Discord-ID "exposure"** — own email to own session (trimmed anyway
  in 006b); Discord IDs are public identifiers.
- **Rate limiting on internal sync/unlink** — caller holds the secret;
  single-guild NAS. The real DoS (unclamped leaderboard limit) was fixed in 005.
- **Repo bloat in git history** — tarball/PNGs untracked; Docker-context
  slice folded into plan 007.
- **Perf: dedupeMatches per read, hourly canvas re-render, client-side /me
  fetching** — trivial at single-guild scale.
- **"Web eslint config missing"** — false; flat config exists.
- **Dynamic SQL identifiers in ensureColumns** — hardcoded constants at every
  call site; by-design migration helper.
- **Cross-guild leaderboards** — retired; single-guild deployment.
- **start.gg / PandaScore keep-or-deprecate** — left as-is; revisit on pain.

Third audit (at `82e32e6`) — bot runtime, admin UI, deploy infra:

- **logoCache concurrent-download "race"** — false: the `inFlight.has` check
  and `.set` happen synchronously in one tick (`src/lib/logoCache.js:241-258`);
  no interleaving point exists.
- **"Corrupted logo crashes batch renders"** — false: `decodeLogo(...).catch`
  returns `null` (logoCache.js:249-253); renderers receive null and draw
  placeholders.
- **"Canvas errors crash the refresh loop"** — false: `src/jobs/refresh.js`
  wraps each board update in its own try/catch with logging.
- **pollingManager stopAll vs in-flight fetches** — theoretical: stopAll runs
  at shutdown, after which the process exits; single-process deployment.
- **Voice-rename cooldown not persisted across restarts** — rare, errors are
  caught; not worth persistence machinery at single-guild scale.
- **`await` on synchronous renderAllGamesStatusCard** — cosmetic; harmless.
- **pandascore/startgg timeouts** — configured (15s axios); no action.
- **"Bump Next to 16.2.9 clears the postcss advisory"** — wrong: 16.2.9 is
  inside the vulnerable range (`9.3.4-canary.0 - 16.3.0-canary.5`); the bump
  stays deferred until a stable ≥16.3.0 ships (re-verified 2026-06-11).
- **Reorder rapid-click stale-snapshot race** — already prevented: move
  buttons are `disabled={busy...}` while a request is in flight
  (games-list.tsx:94,104; media-list same pattern).
- **add_tournament fire-and-forget skips refreshGuild on failure** - marginal:
  a failed sync has no new data to render; morning sync self-heals. Recorded,
  no plan.

Website audit (at `f1a1b6e`):

- **"Upgrade Next now to clear the PostCSS advisory"** - no stable target yet:
  npm latest is `next@16.2.9`, and that release still depends on
  `postcss@8.4.31`; audit remains until a stable Next release ships a fixed
  bundled PostCSS.
- **Production CSP still has `script-src 'unsafe-inline'`** - accepted for now:
  `next.config.ts` already ships a restrictive production CSP with
  `object-src 'none'`, `base-uri`, `form-action`, and `frame-ancestors`; the app
  does not render raw user HTML. Moving to nonce/hash CSP is future defense in
  depth and needs a framework-wide script pipeline, not a small security fix.
- **R2 public base URL can be configured as `http://`** - env-only operator
  configuration, not user input. Prefer HTTPS operationally, but this is not an
  app-side exploit path.
- **Admin news GET filters posts in memory** - not a data leak: the response is
  filtered before return and this is a single-guild dashboard. Query-level
  filtering can be a perf cleanup later.
- **"All Arabic source strings are mojibake"** - not treated as an app bug from
  this pass: PowerShell output renders UTF-8 Arabic poorly in this environment.
  Verify in an editor/browser before changing strings.
- **"Make public pages static"** - rejected for this batch: locale/session/data
  helpers currently make these pages dynamic by design. Metadata/discovery work
  is a better first step than changing rendering mode.
- **News archive pagination** - real product gap, deferred. The hub currently
  loads latest 20 posts, or 50 EWC-only posts. Add archive pagination after the
  metadata and route-boundary polish lands.
- **Finished-tournament archive filters** - real product gap, deferred. The
  tournaments view intentionally filters to live/upcoming tournaments today.
  Add an archive tab/filter after the current public route polish.
- **Component/DOM test harness for large editors** - useful but deferred. The
  current web test runner is node-only; adding jsdom/happy-dom and React
  Testing Library is a workflow dependency decision, not a small website polish
  fix.

Second audit (at `c260e10`):

- **"Add FK constraints to admin scope tables"** — verdict stands, reasoning
  corrected 2026-06-11: `PRAGMA foreign_keys = ON` IS enabled
  (`src/db/connection.js:22` — the advisor's earlier "inert" claim was wrong,
  caught by plan 010's executor). The scope tables simply declare no
  REFERENCES clauses, and `deleteEwcGame` already does transactional explicit
  cleanup (plan 014 tests it); retrofitting REFERENCES needs SQLite table
  rebuilds for marginal benefit.
- **"Reorder not transactional"** — false; `reorderEwcGames` runs inside
  `db.transaction`. Only input validation is missing (plan 012).
- **Seeding race in ewcGames/ewcMediaChannels** — benign: `INSERT OR IGNORE`
  + module-singleton flag.
- **parseJson silent fallback in new db modules** — matches the established
  repo pattern (`ewcPredictions.js`); logging nice-to-have, not a plan.
- **Upload MIME/extension spoofing** — adequate defenses: SVG excluded by
  design, 8 MB cap, UUID keys, admin-gated; optional magic-byte check folded
  into plan 012 Step 6.
- **ewcAdmins hydrate N+1** — a handful of admins on synchronous local
  SQLite; not worth it.
- **@aws-sdk/client-s3 weight** — server-side only; acceptable. Presigned-PUT
  alternative noted for the future.
- **i18n dictionary in client bundle** — unverified (needs bundle analysis),
  small either way; investigate only if bundle size becomes a complaint.
- **Locale cookie missing HttpOnly/Secure** — correct for a JS-set preference
  cookie.
- **Markdown XSS in post-body** — verified safe: react-markdown without raw
  HTML, `safe-url` filtering on hrefs.
- **Legacy news columns + fallback hydration** — intentional back-compat;
  revisit only when dropping the columns (would need its own migration plan).
- **Editor/validation triplication (news/media/game)** — real but the surface
  is days old and actively evolving upstream; refactoring now buys churn.
  Reassess after the CMS stabilizes.
- **News N+1 translations hydration** — superseded by plan 015 (data-layer
  caching makes the per-request query count moot).
- **/admin/me scopes visibility card** — recorded as backlog QoL; no plan.
- **News scheduling / RSS** — backlog options recorded in plan 017's
  non-goals; revisit after Discord posting ships.

Not audited in the second run: prediction system internals, Liquipedia
parsers/client (covered by the first audit + tests), canvas rendering,
deploy infra.

---

## Fourth audit — `/improve deep` @ `fc0df08` (2026-07-07)

Seven-agent deep sweep after the July co-stream + club-tracker PRs (#150–#160).
Schema-drift check ran clean (all new columns present in both backends). Most
"critical" subagent findings were rejected on vetting (false NULLS-LAST/SQLite
claim, non-committed `.env`, unreachable `canManageGame` branch, documented
tradeoffs). One consolidated plan of four safe, low-risk fixes:

| Plan | Title | Priority | Effort | Status |
|------|-------|----------|--------|--------|
| 061  | Deep-audit fixes: YouTube non-200 status, homepage parallel fetch, session cache() dedup, canvas render smoke test | P2 | S (each) | TODO |

### SEO audit @ `0f1ff8a` (2026-07-13)

| Plan | Title | Priority | Effort | Status |
|------|-------|----------|--------|--------|
| 094 | Improve SEO and search discoverability | P1 | L | DONE |

Plan 094 delivered locale/canonical correctness, complete sitemap inventory,
localized feeds, structured data, privacy-safe acquisition reporting, IndexNow,
and conservative CDN caching for cookie-free public HTML. Requests carrying
cookies, query strings, RSC/prefetch headers, or private paths remain dynamic.

Considered and rejected (do not re-audit): N+1 tournament-summary queries (low
leverage — cached, single-guild, bounded N); CSP `img-src https:` tightening
(would break admin-pasted covers); Postgres TLS fail-fast (server lacks SSL —
decided). Direction options (prediction lock reminders, match follows, tier
roles) recorded but not planned — need product decisions.
