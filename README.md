# Esports Community Bot

Private Discord bot and web dashboard for the Esports Community server. It tracks
esports tournaments, live matches, schedules, match cards, EWC prediction games,
news, media posts, and Discord profile showcases from one shared data layer.

The project is built with Node.js, discord.js v14, Next.js, Better Auth, SQLite
for local/self-hosted development, and PostgreSQL for the CranL production
deployment.

> This project is not affiliated with Discord, Liquipedia, the Esports World
> Cup, or any tournament organizer. Tournament data from Liquipedia is credited
> and used under CC-BY-SA 3.0.

## What It Does

- Tracks Liquipedia tournaments for the games supported by the community.
- Posts Discord live boards grouped by live matches, upcoming matches, and recent
  results.
- Posts per-game live match cards with generated images, team logos, scores, and
  match links.
- Keeps optional voice-channel status updated with the nearest live match.
- Runs EWC weekly and season prediction systems with scoring, profile pages, and
  image leaderboards.
- Syncs EWC prediction metadata to Discord Application Role Connections.
- Provides a bilingual web dashboard with Arabic RTL support, news, media,
  public game pages, prediction leaderboards, and an admin CMS.
- Stores admin actions in an audit log so changes can be reviewed later.

## Architecture

The repository contains one Discord bot and one Next.js dashboard. They share the
same database modules in `src/db`.

- Bot entry point: `src/index.js`
- Web app: `apps/web`
- Combined production entry point: `src/start-production.js`
- Shared database client: `src/db/client.js`
- Liquipedia client and parsers: `src/services/liquipedia`
- EWC prediction scoring: `src/lib/ewcPredictions.js`

Local development can use SQLite. Production on CranL uses PostgreSQL by setting
`DATABASE_URL` and `DB_DRIVER=postgres`. The Postgres schema is applied at boot by
the app when the Postgres driver is active.

All Liquipedia access must go through the serialized client in
`src/services/liquipedia/client.js`. Do not add direct HTTP calls to Liquipedia.

## Quick Start

Requirements:

- Node.js 20 or newer
- npm
- A Discord application and bot token

```bash
npm install
cp .env.example .env
```

Fill in the required Discord values:

```env
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_GUILD_ID=
LIQUIPEDIA_USER_AGENT=EsportsCommunityBot/1.0 (contact@example.com)
```

Then register commands and start the bot:

```bash
npm run deploy
npm start
```

For a local dashboard preview:

```bash
DB_PATH="./data/dev-dashboard.sqlite" npm run seed:dev
npm run web:dev
```

## Production Deployment

The current production target is CranL:

- The app runs as one service that starts both the bot and the web dashboard.
- PostgreSQL is provided by CranL as a managed database.
- Cloudflare fronts the public domain and R2 serves uploaded media assets.

Typical production database settings:

```env
DB_DRIVER=postgres
DATABASE_URL=postgresql://...
PGSSLMODE=disable
```

Use `PGSSLMODE=require` only if the database endpoint supports SSL. CranL's
internal Postgres endpoint may use plain TCP, so `disable` can be correct there.

A Docker self-hosting path is still possible, but CranL is the active deployment
path for this server.

## Database Migration

The app can migrate an existing SQLite bot database into PostgreSQL:

```bash
npm run db:sqlite-to-pg -- --dry-run --sqlite backups/nas-2026-06-13/bot.sqlite
npm run db:sqlite-to-pg -- --sqlite backups/nas-2026-06-13/bot.sqlite
```

Use a dry run first to confirm source table counts. The real run applies the
Postgres schema, copies rows, and prints target counts for verification.

## Discord Commands

Most commands are staff-only through Discord default member permissions. The
public commands are for members to inspect matches and submit predictions.

| Command | Purpose |
| --- | --- |
| `/match` | Public match lookup and detail card |
| `/lookup` | Public Liquipedia player/team page lookup |
| `/add_tournament` | Track a Liquipedia tournament |
| `/remove_tournament` | Stop tracking a tournament |
| `/list_tournaments` | List tracked tournaments and current counts |
| `/set_channel leaderboard` | Configure all-game or per-game status boards |
| `/set_channel card` | Configure all-game or per-game match image cards |
| `/set_channel voice` | Configure a voice channel for live status |
| `/unset_channel` | Remove a configured board, card, or voice channel |
| `/set_log` | Configure the audit-log channel |
| `/set_ewc` | Configure EWC club championship output |
| `/set_cs_rankings` | Configure Counter-Strike Valve rankings |
| `/ewc_predict` | Member prediction commands and guide |
| `/ewc_admin` | Prediction setup, scoring, leaderboard, and season controls |

## Web Dashboard

The dashboard provides:

- Public home page and game pages
- Live and upcoming match sections
- News and media pages
- EWC prediction leaderboard and profile pages
- Discord login through Better Auth
- Admin CMS for games, media, news, and staff scopes
- Audit log for administrative actions

The dashboard is bilingual. Arabic pages use RTL layout and the same Thmanyah
Sans font stack as English pages.

## Fonts

The web app uses only Thmanyah Sans:

- Regular
- Medium
- Bold

The font files are served from the configured asset base URL, usually
`https://assets.esportscommunity.net/thmanyahsans/woff2`. Do not use the older
Thmanyah display or serif families in the app.

## Image and Media Storage

News cover images and public media assets can be served from Cloudflare R2.

Required R2 variables:

```env
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
R2_PUBLIC_BASE_URL=https://assets.esportscommunity.net
```

If R2 is not configured, admins can still paste remote image URLs where the CMS
supports it.

## Important Environment Variables

| Variable | Purpose |
| --- | --- |
| `DISCORD_TOKEN` | Discord bot token |
| `DISCORD_CLIENT_ID` | Discord application client ID |
| `DISCORD_CLIENT_SECRET` | Discord OAuth client secret for the dashboard |
| `DISCORD_GUILD_ID` | Guild-scoped command deployment |
| `DATABASE_URL` | PostgreSQL connection URL |
| `DB_DRIVER` | Set to `postgres` for production Postgres |
| `DB_PATH` | SQLite database path for local/self-hosted use |
| `PGSSLMODE` | `disable`, `require`, or `no-verify` |
| `BETTER_AUTH_SECRET` | Better Auth signing/encryption secret |
| `BETTER_AUTH_URL` | Public auth base URL |
| `EWC_DASHBOARD_PUBLIC_URL` | Public dashboard URL |
| `EWC_DASHBOARD_INTERNAL_URL` | Bot-to-web internal URL |
| `EWC_DASHBOARD_INTERNAL_SECRET` | Shared secret for internal sync routes |
| `EWC_DASHBOARD_SUPER_ADMIN_DISCORD_IDS` | Comma-separated Discord IDs with full dashboard access |
| `LIQUIPEDIA_USER_AGENT` | Required descriptive User-Agent with contact info |
| `LIQUIPEDIA_PARSE_MIN_GAP_MS` | Minimum gap between parse requests |
| `LIQUIPEDIA_CACHE_TTL_MS` | Liquipedia response cache TTL |
| `LIQUIPEDIA_RATE_STATE_PATH` | Persistent Liquipedia backoff state |
| `THMANYAH_FONT_BASE_URL` | Public base URL for hosted Thmanyah font files |

See `.env.example` for the full list.

## Liquipedia Rules

Liquipedia access is intentionally conservative:

- Use a descriptive User-Agent with contact information.
- Reuse cached responses as long as possible.
- Keep parse requests serialized and spaced apart.
- Persist backoff state across restarts.
- Never scrape generated HTML pages.
- Never add direct `axios` or `fetch` calls to `liquipedia.net`.

Every Discord match card and board includes Liquipedia attribution:

```text
Data from Liquipedia - CC-BY-SA 3.0
```

## Verification

Run these before claiming a code change is done:

```bash
npm test
npm --workspace @esports-community-bot/web run lint
npm --workspace @esports-community-bot/web run test
npm run web:build
```

## Project Map

```text
src/
  commands/                 Discord slash commands
  db/                       shared SQLite/Postgres database modules
  events/                   Discord event handlers
  jobs/                     sync, polling, cards, rankings, predictions
  lib/                      scoring, cards, games, markdown, logos
  services/liquipedia/      rate-limited Liquipedia client and parsers
apps/web/
  src/app/                  Next.js App Router pages and API routes
  src/components/           dashboard UI components
  src/lib/                  auth, admin access, data helpers, security
scripts/
  migrate-sqlite-to-postgres.mjs
  seed-dev.mjs
tests/
  *.test.mjs                bot-side node:test suite
```

## License

MIT for the project code. Liquipedia content remains under CC-BY-SA 3.0.
