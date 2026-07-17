# Plan 094: Add browser E2E coverage and read-only production smoke checks

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. Stop
> on any condition listed under "STOP conditions"; do not improvise. Update
> this plan's row in `plans/README.md` when complete unless a reviewer owns the
> index.
>
> **Drift check (run first)**: fetch `origin/main`, then run
> `git diff --stat 1530ee8..origin/main -- .github/workflows/ci.yml apps/web/package.json package-lock.json apps/web/src/app apps/web/src/components scripts`.
> This plan was written against fetched `origin/main`, not the operator's
> checked-out feature branch. If the CI jobs, public routes, or seed command no
> longer match the Current state below, stop and report the drift.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: none
- **Category**: tests / dx
- **Planned at**: commit `1530ee8`, 2026-07-14

## Why this matters

The repository has strong unit and API coverage, but CI never opens the app in
a browser. Responsive layout, Arabic direction, navigation state, consent UI,
and third-party stream controls can therefore regress while all current gates
remain green. A small stable browser suite plus a non-mutating production probe
will catch failures at the boundary users actually exercise.

## Current state

- `.github/workflows/ci.yml` has `bot-tests` and `web` jobs. The web job runs
  install, lint, native typecheck, Vitest, and the Next build; it has no browser
  job.
- `apps/web/package.json` has Vitest but no Playwright dependency or E2E script.
- `package.json` exposes `npm run seed:dev`; `scripts/seed-dev.mjs` can populate
  a disposable `DB_PATH` with public games, news, predictions, and a dev user.
- High-risk public UI is concentrated in:
  - `apps/web/src/components/site-header-client.tsx`
  - `apps/web/src/components/streams/co-streams-view.tsx`
  - `apps/web/src/components/streams/multi-stream-grid.tsx`
  - `apps/web/src/components/predictions/web-prediction-picker.tsx`
  - `apps/web/src/components/tournaments/tournament-match-list.tsx`
- Locale is route-based (`/ar/...`) and Arabic pages must render `lang="ar"`
  and `dir="rtl"`. Tests must navigate real localized links, not mutate a
  language cookie behind the app.
- CI actions are pinned by full commit SHA and top-level permissions are
  `contents: read`; preserve both conventions.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm ci` | exit 0 |
| Install Chromium | `npm run web:e2e:install` | Chromium and required Linux dependencies installed |
| Seed | `DB_PATH="<disposable-path>" npm run seed:dev` | exit 0; seed summary printed |
| E2E | `npm run web:e2e` | all Playwright projects pass |
| Local smoke | `npm run web:smoke:local` | starts a disposable seeded local server, probes it, then exits 0 |
| Bot tests | `npm test` | all pass |
| Web lint | `npm --workspace @esports-community-bot/web run lint` | exit 0 |
| Native typecheck | `npm --workspace @esports-community-bot/web run typecheck:native` | exit 0 |
| Web tests | `npm --workspace @esports-community-bot/web run test` | all pass |
| Build | `npm run web:build` | exit 0 |

## Scope

**In scope**:
- `apps/web/package.json`
- `package.json`
- `package-lock.json`
- `apps/web/playwright.config.ts` (create)
- `apps/web/e2e/` (create specs and helpers)
- `scripts/run-web-e2e.mjs` (create; cross-platform disposable DB lifecycle)
- `scripts/smoke-public.mjs` (create; read-only HTTP checks)
- `.github/workflows/ci.yml`
- `.github/workflows/production-smoke.yml` (create)
- `.gitignore` only if Playwright artifacts are not already ignored

**Out of scope**:
- Product behavior changes made solely to satisfy a test.
- Logging in with a real Discord account in CI.
- Calling Liquipedia, Discord, start.gg, or other external APIs from E2E.
- Production POST/PATCH/DELETE requests.
- Pixel-perfect golden screenshots as required assertions.

## Git workflow

- Work only in a separate `git worktree` (or clean clone) created from fetched
  `origin/main`/`1530ee8`: `codex/094-browser-e2e-smoke`. The operator checkout
  currently contains unrelated untracked assets and uncommitted plans. Never
  use `git clean`, `git stash`, reset, or checkout in that operator tree.
- Use conventional commits, for example `test(web): add critical browser journeys`.
- Do not push or open a PR unless the operator requests it.

## Steps

### Step 1: Add a deterministic Playwright harness

Add `@playwright/test` as a web dev dependency and root scripts
`web:e2e`/`web:e2e:install`/`web:smoke:local`. Configure Chromium desktop and a
390px mobile project. Use a cross-platform Node wrapper to create an ignored
temporary SQLite file, set `DB_PATH`, seed it once, start Next on a dedicated
port, and clean up the DB after the run. The wrapper must detect Playwright's
`--list` forwarding and invoke only the test lister: it must not seed, launch
Next, or make provider requests in that mode. `web:e2e:install` must run before
the first browser test on a clean machine. `web:smoke:local` must reuse the
same disposable DB/server lifecycle, run `smoke-public.mjs` against the known
local base URL, and stop the server before deleting the database. Explicitly
stub required Discord/web env values; never load developer `.env` secrets.
Configure traces and screenshots only on failure.

**Verify**: run `npm ci`, then `npm run web:e2e:install`, then
`npm run web:e2e -- --list` -> lists both projects and all specs without
seeding, starting Next, or making external network requests.

### Step 2: Cover stable critical public journeys

Write selector-resilient specs using roles and accessible names. Cover:

1. English home -> tournament directory -> seeded tournament detail.
2. `/ar` -> Arabic tournament detail, asserting `html[lang=ar][dir=rtl]` and
   no document-level horizontal overflow at 390px.
3. Header menus and locale switch preserve a valid localized destination.
4. Public prediction leaderboard renders seeded rows and opens the picker
   entry point without submitting.
5. Co-stream page can select a creator; stub iframe/provider requests so the
   test never contacts Twitch/Kick/YouTube.
6. Analytics consent can be denied and reopened from settings; assert no GA
   script request is made before consent.

Do not assert live scores, relative dates, or mutable copy.

**Verify**: `npm run web:e2e` -> all desktop and mobile tests pass twice in a
row against freshly seeded databases.

### Step 3: Add the browser job to CI

Add an `e2e` job after the existing web checks. Keep read-only token
permissions and pinned action SHAs. The job must call the same
`npm run web:e2e:install` and `npm run web:e2e` scripts used locally so it gets
the identical disposable DB/seed lifecycle. Install only Chromium plus its
system dependencies, cache npm through setup-node, upload failure artifacts
only, and enforce a 15-minute timeout. The job must use a workspace path DB,
not `${{ runner.temp }}` at job-level env (that context previously broke CI).

**Verify**: run `npx --yes prettier@3.5.3 --check .github/workflows/ci.yml`
to parse the existing CI YAML, then run `npm run web:e2e` locally -> exit 0.

### Step 4: Add a read-only production smoke script and manual workflow

Create a Node script accepting `--base-url` (or `EWC_PUBLIC_URL`) and a bounded
timeout. Probe `/`, `/ar`, `/games`, `/tournaments`, `/docs/mcp`,
`/api/public-mcp` with a valid `tools/list` POST, `/robots.txt`, and
`/sitemap.xml`. Assert expected status/content type, EN/AR direction markers,
HSTS on HTTPS, no accidental `noindex` on public HTML, and no 5xx. Redact query
strings and bodies from failures. The workflow must be manual and optionally
scheduled, use no admin key, and have no write permissions. Define a
`workflow_dispatch` `base_url` input; use it first, then the repository variable
`EWC_PUBLIC_URL` for scheduled runs. A manual run with neither must fail before
network access; a scheduled run with neither must exit successfully with an
explicit "not configured" summary rather than probing an accidental host.

**Verify**: `npm run web:smoke:local` -> the wrapper starts its seeded local
server on the documented dedicated port, invokes
`node scripts/smoke-public.mjs --base-url http://127.0.0.1:<port>`, and tears
everything down after all probes pass; an invalid explicit URL exits nonzero
within the configured timeout. Then run
`npx --yes prettier@3.5.3 --check .github/workflows/production-smoke.yml` to
parse the newly created workflow YAML.

### Step 5: Run the complete repository gates

Run all commands in the Commands table. Review `git diff --check` and ensure
Playwright output, screenshots, traces, and temporary DBs are untracked.

## Test plan

- Browser specs live under `apps/web/e2e/` and cover EN/AR plus desktop/mobile.
- Unit-test pure smoke response validators if they contain branching logic.
- Run the E2E suite twice to catch leaked DB/server state.
- Keep every provider request mocked/aborted; a test should fail if it attempts
  network access outside localhost.

## Done criteria

- [ ] `npm run web:e2e` passes twice from clean disposable databases.
- [ ] CI contains a bounded Playwright job with read-only permissions.
- [ ] The production smoke script issues only GET/HEAD and public MCP
      `tools/list`; it cannot mutate data.
- [ ] Desktop and 390px EN/AR journeys pass and Arabic asserts RTL.
- [ ] All existing bot/web gates pass.
- [ ] `git status --short` shows no generated browser artifacts or DBs.

## STOP conditions

- The seed script requires a real Discord, Liquipedia, or production DB
  connection.
- A stable journey cannot be tested without real OAuth credentials.
- CI would require a write-scoped token or an unpinned third-party action.
- The smoke probe would need an admin MCP key or any state-changing request.
- In-scope application contracts drifted from the Current state.

## Maintenance notes

Treat this as a small release-confidence suite, not a duplicate of Vitest.
Add one browser regression only when the failure depends on browser/layout or
real navigation. Reviewers should reject waits by fixed duration, mutable live
data assertions, and selectors tied to Tailwind classes.
