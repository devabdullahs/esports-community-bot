# Esports Community

Discord bot and bilingual web platform for the Esports Community. The project
tracks esports tournaments and live matches, publishes community news, powers
co-stream discovery, runs Esports World Cup prediction games, and gives staff a
scoped administration workspace backed by one shared data layer.

The bot uses Node.js and discord.js v14. The web app uses Next.js, Better Auth,
and shadcn/ui. Local development can use SQLite; the CranL production deployment
uses PostgreSQL.

> This project is not affiliated with Discord, Liquipedia, the Esports World
> Cup, or any tournament organizer. Liquipedia data is attributed and used under
> CC-BY-SA 3.0.

## Highlights

- Tracks tournaments from Liquipedia, start.gg, and other configured sources.
- Publishes live, upcoming, and recent match boards and generated Discord cards.
- Provides tournament pages, standings, match details, team and player profiles,
  global search, and localized Arabic RTL routes.
- Runs weekly and season EWC predictions with scoring, public leaderboards,
  Discord profile metadata, and staff operations tooling.
- Lets members follow games, tournaments, teams, and players, with instant or
  daily-digest notifications and configurable quiet hours.
- Lists official co-streamers and supports desktop multiview for up to six live
  streams. Mobile keeps a single-stream playback experience.
- Provides game and media publishing workflows, comments, website analytics,
  tournament source health, staff scopes, and an administrative audit log.
- Exposes a public read-only MCP server and a separately authenticated,
  permission-scoped admin MCP server.
- Supports consent-aware Google Analytics, first-party product analytics,
  structured data, localized feeds, sitemaps, and optional IndexNow submission.

## Architecture

The Discord bot and Next.js application share the database modules in `src/db`.
The production entry point can run both processes in one service.

| Area | Path |
| --- | --- |
| Bot entry point | `src/index.js` |
| Combined production entry point | `src/start-production.js` |
| Discord commands and events | `src/commands`, `src/events` |
| Background jobs | `src/jobs` |
| Shared SQLite/Postgres data layer | `src/db` |
| Database adapter | `src/db/client.js` |
| Liquipedia queue, fetchers, and parsers | `src/services/liquipedia` |
| Prediction scoring | `src/lib/ewcPredictions.js` |
| Next.js application | `apps/web` |
| Browser tests | `apps/web/e2e` |

All Liquipedia traffic must use the single serialized queue in
`src/services/liquipedia/client.js`. Never add a direct or parallel fetch path.

## Quick Start

Requirements:

- Node.js 20.12 or newer
- npm
- A Discord application and bot token

```bash
npm install
cp .env.example .env
```

Set the required local values:

```env
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_GUILD_ID=
LIQUIPEDIA_USER_AGENT=EsportsCommunityBot/1.0 (contact@example.com)
BETTER_AUTH_SECRET=replace-with-a-random-secret
```

Register the Discord commands and start the bot:

```bash
npm run deploy
npm start
```

Run the web app separately during development:

```bash
DB_PATH="./data/dev-dashboard.sqlite" npm run seed:dev
npm run web:dev
```

The dashboard is available at `http://localhost:3000` by default. Development
authentication bypass settings are documented in `.env.example` and must never
be enabled in production.

## Discord Commands

Member-facing commands:

| Command | Purpose |
| --- | --- |
| `/match` | Search live, upcoming, and recent matches |
| `/lookup` | Look up a local or Liquipedia team/player profile |
| `/list_tournaments` | List tracked tournaments and their status |
| `/follow` | Follow and manage games, tournaments, teams, or players |
| `/ewc_predict` | Submit predictions, inspect leaderboards/profiles, and manage the linked showcase |

Staff commands use Discord permissions and server-side checks:

| Command | Purpose |
| --- | --- |
| `/add_tournament` | Track a supported tournament source |
| `/remove_tournament` | Stop tracking a tournament |
| `/set_channel` / `/unset_channel` | Configure or remove boards, match cards, news, and voice status |
| `/set_costreams` | Configure co-stream announcement delivery and mention role |
| `/set_log` | Configure the bot audit-log channel |
| `/set_ewc` | Configure EWC Club Championship output |
| `/set_cs_rankings` | Configure Counter-Strike Valve rankings |
| `/ewc_admin` | Operate prediction weeks, scoring, leaderboards, and seasons |
| `Apps -> Delete After` | Preview and confirm deletion of messages after a selected message |

## Web Platform

Public routes include games, tournaments, matches, teams, players, news, media,
co-streams, EWC club standings, prediction leaderboards, and localized feeds.
Discord login adds a personal workspace for follows, notifications, prediction
history, and profile settings.

The admin workspace provides scoped access to content publishing, comments,
co-streams, users, partners, predictions, source health, analytics, staff roles,
MCP keys, and audit history. Staff access is deny-by-default and derives from
the configured super-admin list or database-backed game/media scopes.

Arabic pages live under `/ar`, render RTL, and use the same data and feature set
as English routes.

## MCP Servers

The project exposes two Streamable HTTP MCP endpoints:

| Server | Endpoint | Documentation | Access |
| --- | --- | --- | --- |
| Public MCP | `/api/public-mcp` | `/docs/mcp` | Read-only public data; no key required |
| Admin MCP | `/api/mcp` | `/docs/admin-mcp` | Bearer key with explicit owner permissions and tool scopes |

Admins create and revoke their own keys at `/admin/mcp`. The admin server also
contains the public read tools, so an admin client only needs one MCP
configuration. State-changing tools use conservative workflows, idempotency
controls, and administrative audit entries.

The repository-level maintainer guide is [`docs/ADMIN_MCP.md`](docs/ADMIN_MCP.md).
Never commit or share a real MCP key.

## Production and Data

The active production target is CranL:

- One service runs the bot and web application through `npm run start:production`.
- CranL provides managed PostgreSQL.
- Cloudflare fronts `esportscommunity.net` and R2 serves uploaded assets.
- Deployment builds from the repository's `main` branch.

Typical production database settings:

```env
DB_DRIVER=postgres
DATABASE_URL=postgresql://...
PGSSLMODE=disable
```

Use the TLS mode supported by the database endpoint. `verify-full` with a trusted
CA is preferred for external connections; CranL internal networking may require
`disable`.

To migrate an existing SQLite database:

```bash
npm run db:sqlite-to-pg -- --dry-run --sqlite path/to/bot.sqlite
npm run db:sqlite-to-pg -- --sqlite path/to/bot.sqlite
```

Always run the dry run first and compare the printed source/target counts.

## Configuration

`.env.example` is the canonical configuration reference. Important groups are:

| Group | Variables |
| --- | --- |
| Discord and OAuth | `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_GUILD_ID` |
| Database | `DB_DRIVER`, `DATABASE_URL`, `DB_PATH`, `PGSSLMODE`, `PGSSLROOTCERT` |
| Web/auth | `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `EWC_DASHBOARD_PUBLIC_URL`, `EWC_DASHBOARD_INTERNAL_SECRET` |
| Admin access | `EWC_DASHBOARD_SUPER_ADMIN_DISCORD_IDS` |
| Liquipedia | `LIQUIPEDIA_USER_AGENT`, `LIQUIPEDIA_PARSE_MIN_GAP_MS`, `LIQUIPEDIA_CACHE_TTL_MS`, `LIQUIPEDIA_RATE_STATE_PATH` |
| Tournament sources | `STARTGG_TOKEN`, `LPDB_API_KEY`, `PANDASCORE_TOKEN` |
| Co-stream status | `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `KICK_CLIENT_ID`, `KICK_CLIENT_SECRET` |
| MCP | `EWC_MCP_ENABLED`, `EWC_MCP_ALLOWED_ORIGINS`, `EWC_PUBLIC_MCP_ENABLED`, `EWC_PUBLIC_MCP_ALLOWED_ORIGINS` |
| Analytics and search | `GOOGLE_ANALYTICS_MEASUREMENT_ID`, `EWC_INDEXNOW_ENABLED`, `EWC_INDEXNOW_KEY`, `EWC_GOOGLE_SITE_VERIFICATION` |
| R2 assets | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL` |

Secrets belong only in deployment configuration or a local ignored `.env` file.

## Liquipedia Rules

Liquipedia access is deliberately conservative:

- Use a descriptive User-Agent with valid contact information.
- Route parse and search traffic through the existing serialized client.
- Respect the configured minimum gaps and cache TTLs.
- Persist rate-limit and backoff state across restarts.
- Use fixtures in tests; tests must never contact Liquipedia.
- Keep source attribution on rendered match and tournament content.

## Verification

Required code checks:

```bash
npm test
npm --workspace @esports-community-bot/web run lint
npm --workspace @esports-community-bot/web run test
npm run web:build
```

Browser coverage and local production smoke checks:

```bash
npm run web:e2e:install
npm run web:e2e
npm run web:smoke:local
```

CI runs the bot tests, web lint/tests/build, and Playwright browser suite.

## Project Map

```text
src/
  commands/                 Discord slash and context-menu commands
  db/                       shared SQLite/Postgres database modules
  events/                   Discord event handlers
  jobs/                     polling, sync, cards, rankings, and predictions
  lib/                      scoring, rendering, games, markdown, and logos
  services/liquipedia/      serialized Liquipedia client and parsers
apps/web/
  e2e/                      Playwright browser journeys
  src/app/                  App Router pages, feeds, and API routes
  src/components/           shadcn-based product and admin UI
  src/lib/                  auth, RBAC, MCP, data, analytics, and security helpers
  src/test/                 Vitest web tests
docs/                       deployment, MCP, and search-operations guides
scripts/                    migration, seed, E2E, and smoke-test runners
tests/                      bot-side node:test suite
```

## License

MIT for project code. Third-party data and assets remain under their respective
licenses; Liquipedia content is CC-BY-SA 3.0.
