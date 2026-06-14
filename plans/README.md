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
| 032  | Cache public EWC leaderboard reads | P3 | S-M | - | TODO |
| 033  | Scope game-page admin CTA to game admins | P2 | S | - | DONE - game page uses `getAdminAccess` + `canManageGame(access, slug)` instead of any signed-in session, so the Admin button shows only to admins who manage that game. |
| 034  | Add public page metadata and discovery files | P2 | M | - | TODO |
| 035  | Server-page the public EWC leaderboard | P2 | M | 032 | TODO |
| 036  | Add bilingual route not-found/error/loading states | P3 | M | - | TODO |
Status values: TODO | IN PROGRESS | DONE | BLOCKED (reason) | REJECTED (rationale) | SUPERSEDED.

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
