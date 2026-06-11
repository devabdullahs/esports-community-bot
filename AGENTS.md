# Agent guide — Esports Community Bot

Discord bot (Node >= 20, ESM, discord.js v14) + Next.js dashboard
(`apps/web`, npm workspace) sharing one better-sqlite3 database.
Deployed as a single Docker container (GHCR -> UGREEN NAS).
**The bot serves ONE Discord guild** — code is multi-guild-shaped, but do not
add multi-tenant complexity.

## Verify (run before claiming done)
- Bot tests: `npm test` (node:test suite in `tests/*.test.mjs`)
- Web lint:  `npm --workspace @esports-community-bot/web run lint`
- Web tests: `npm --workspace @esports-community-bot/web run test`
- Web build: `npm run web:build`
- CI runs lint, tests, and build for the web workspace.
- There is no bot-side linter; match existing style (single quotes, ESM,
  sparse why-comments).

## Map
- `src/index.js` — client boot, loaders, shutdown.
- `src/commands/` — slash commands; admin ones gate via
  `setDefaultMemberPermissions` (Discord enforces it server-side).
- `src/services/liquipedia.js` — 31-line re-export facade over
  `src/services/liquipedia/{rateState,client,parsers,fetchers}.js`. Parser
  fixes go in `parsers.js`; rate/HTTP tuning in `client.js`/`rateState.js`.
  See rate rules below — this is the most fragile part of the codebase.
- `src/db/index.js` — schema (CREATE TABLE + ensureColumns migrations);
  `src/db/connection.js` — opens the DB, WAL mode, `foreign_keys = ON`
  (line 22) so declared ON DELETE CASCADE clauses DO fire. CAUTION: several
  tables (e.g. admin scope tables) declare NO REFERENCES at all — for those,
  delete child rows explicitly in a transaction (see `deleteEwcGame` in
  `src/db/ewcGames.js` for the exemplar).
- `src/db/*.js` — prepared-statement modules (always parameterized); CMS
  modules: `src/db/{ewcGames,ewcMediaChannels,ewcNewsPosts,ewcAdmins}.js`.
- `src/lib/ewcPredictions.js` — EWC scoring math (pure functions; tests in
  `tests/ewcPredictionScoring.test.mjs`). This is the money path.
- `src/lib/markdownTools.js` — shared markdown helpers (also tested in
  `tests/markdownTools.test.mjs`).
- `src/jobs/` — node-cron jobs: polling, morning sync, EWC automation,
  leaderboards, voice status.
- `apps/web/` — Next.js App Router dashboard; imports bot DB via `@bot/*`
  alias; auth = better-auth Discord OAuth; internal bot->web API guarded by
  `x-ewc-internal-secret` header. Web admin RBAC in
  `apps/web/src/lib/admin.ts` (super-admins via
  `EWC_DASHBOARD_SUPER_ADMIN_DISCORD_IDS`, scoped admins in DB).

## Liquipedia rate rules (violating these gets the bot banned/backed off)
- Every request already goes through ONE serialized queue in
  `src/services/liquipedia/client.js` — never add a parallel fetch path or
  call axios directly to liquipedia.net.
- Parse requests: >= 30s apart (`LIQUIPEDIA_PARSE_MIN_GAP_MS`); search:
  >= 2.5s. Cache TTL 15 min in prod (`compose.ugreen.yml` sets `LIQUIPEDIA_CACHE_TTL_MS=900000`; dev default 5 min).
  Backoff state persists across restarts (`data/liquipedia-rate-limit.json`).
- Tests must NEVER hit liquipedia.net; use fixtures
  (`tests/liquipediaParsers.test.mjs`).

## Conventions & gotchas
- Times shown to users are Asia/Riyadh (the community's timezone) even when
  events are elsewhere; storage is unix seconds UTC.
- Discord interactions: deferReply -> editReply pattern;
  `src/events/interactionCreate.js` has the global error fallback.
- Leaderboard texts render `<@id>` mentions intentionally; the client default
  `allowedMentions: { parse: [] }` (set in `src/index.js`) keeps them
  ping-free.
- Canvas cards (`@napi-rs/canvas`) need fonts in Docker (`fonts-inter`,
  `fonts-dejavu-core`) — rendering differences between Windows dev and Linux
  prod are usually fonts.
- `.env.example` is the canonical env var list; add new vars there in the
  same PR.

## Deployment
- Image: `ghcr.io/devabdullahs/esports-community-bot`; NAS runs
  `docker compose pull && docker compose up -d` in `/volume1/docker/ECB`.
- Never commit secrets; `.env`/`.env.docker` are gitignored.
