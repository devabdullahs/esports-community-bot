# Esports Community Bot

A free, open-source **Discord bot** that brings live esports tournament tracking into Discord
servers — match schedules, live scores, brackets, and the **Esports World Cup Club
Championship** standings — without anyone leaving Discord.

Built with **discord.js v14** on **Node ≥ 20.12**. Primary data source is **Liquipedia**
(free), via the MediaWiki API. It is **non-commercial** — no ads, no paid features, no betting.

> Not affiliated with Liquipedia, Discord, the Esports World Cup, or any tournament organizer.
> Tournament data comes from [Liquipedia](https://liquipedia.net) and is used under CC-BY-SA 3.0.

## Features

- **Live leaderboards** (Components V2 embeds) that auto-update as scores change, grouped into
  **Live / Upcoming / Recent**. Have one **combined** board *and* **per-game** boards in
  separate channels — all update simultaneously.
- **Live match image cards** — `/set_channel card` can target all games or a single game
  channel. It posts one rendered PNG per running match, edits score changes, and deletes cards
  when those matches finish. If nothing is live, the channel keeps a tidy standby card.
- **EWC Club Championship board** — `/set_ewc` posts an auto-refreshing standings embed
  (club points race + prize pool, with winner highlighting).
- **Live voice-channel status** — renames a voice channel to the current match
  (e.g. `🔴 LIVE: VCT - SEN vs PRX 1-0`), debounced to respect Discord's rename limit.
- **Localized times** — all match times use Discord timestamps, shown in each viewer's zone.
- **Liquipedia attribution** — every match tag links back to its Liquipedia page, and each
  embed credits Liquipedia (CC-BY-SA).
- **EWC predictions** — members pick a club **per game** each week through a guided
  Components-V2 picker (`/ewc_predict weekly`), plus season-long top-10 picks. Scoring runs
  automatically from per-game Liquipedia placements; image leaderboards (with champion-pick
  column) and a best-of-K overall ranking keep the race fair.
- **Web dashboard** (`apps/web`, Next.js) — bilingual EN/AR (full RTL) community hub: game
  pages, news, media directory, public prediction leaderboards, and a member profile that
  syncs an **EWC showcase to Discord profiles** via Application Role Connections.
- **News & Media CMS** — bilingual (EN/AR) news posts and a media channel directory, authored
  at `/admin` on the dashboard with role-based access control and an audit log.

### Commands (all admin-gated except `/list_tournaments`)

| Command | What it does |
|---|---|
| `/add_tournament` | Track a tournament by Liquipedia URL (game auto-detected; ~45 games via autocomplete) |
| `/list_tournaments` | List tracked tournaments with live/upcoming counts |
| `/match` | Focused detail card for any tracked match (autocomplete search) |
| `/remove_tournament` | Stop tracking one (autocomplete search) |
| `/set_channel leaderboard` | Set the combined board channel, or a per-game board (optional `game`) |
| `/set_channel card` | Set the channel for live match image cards, optionally limited to one game |
| `/set_channel voice` | Set the voice channel used for live status |
| `/set_ewc` | Track the EWC Club Championship standings in a channel |
| `/set_cs_rankings` | Auto-refreshing Counter-Strike Valve regional rankings card |
| `/set_log` | Channel for admin audit-log embeds |
| `/unset_channel` | Remove a board/card/voice binding (cleans up its messages) |
| `/lookup` | Liquipedia page lookup for a player or team (no scraping) |
| `/ewc_predict` | Member-facing predictions: weekly per-game picker, season picks, leaderboards, dashboard link/sync |
| `/ewc_admin` | Prediction rounds admin: generate/open/close/score/delete weeks, season scoring, baselines |

## How it works

1. **Daily sync** (cron, 08:00, timezone-aware) reads tracked tournaments and fetches each
   one's matches from its Liquipedia page.
2. **Match parsing** reads the tournament's **bracket / matchlist** (`action=parse`) — the
   authoritative source for teams, scores, winners, and best-of — plus the upcoming-matches
   widget for fixtures not yet seeded into the bracket.
3. **Targeted polling** watches only running / soon matches and re-checks them, stopping when
   the bracket marks a winner. Match state persists, so polling resumes after a restart.
4. **Rate-limit discipline** (per Liquipedia's [API ToS](https://liquipedia.net/api-terms-of-use)):
   a **descriptive User-Agent + contact**, **≥30s between `action=parse` requests**, a **5-minute
   response cache** so many matches/polls share one fetch, and **automatic 20-minute backoff**
   if ever rate-limited. Heavy pages are cached aggressively and results are re-used.

## Setup

Requires Node ≥ 20.12 and a Discord application + bot token
([Discord Developer Portal](https://discord.com/developers/applications)).

```bash
git clone <your-fork-url>
cd "Esports Community Bot"
npm install
cp .env.example .env
# Fill in:
#   DISCORD_TOKEN, DISCORD_CLIENT_ID   (+ DISCORD_GUILD_ID for instant command updates while testing)
#   LIQUIPEDIA_USER_AGENT="EsportsCommunityBot/1.0 (you@example.com)"   ← required by Liquipedia ToS
npm run deploy   # register slash commands with Discord
npm start        # or: npm run dev  (auto-restart on file change)
```

Invite the bot with the `bot` + `applications.commands` scopes and these permissions:
**View Channels**, **Send Messages**, **Embed Links**, **Attach Files**, **Read Message History**
(to edit its own boards), and **Manage Channels** (to rename the voice channel). The bot prints a ready-made
invite link in its startup log.

Then, as a server admin:

```
/set_channel leaderboard channel:#esports
/set_channel leaderboard channel:#valorant  game:Valorant      (optional per-game board)
/set_channel card channel:#valorant  game:Valorant
/set_channel card channel:#lol       game:League of Legends
/set_channel voice channel:🔴-status
/add_tournament identifier:https://liquipedia.net/valorant/VCT/2026/Stage_2/Masters
/set_ewc url:https://liquipedia.net/esports/Esports_World_Cup/2026 channel:#ewc-standings
```

## EWC prediction dashboard and profile showcase

The dashboard is a separate Next.js app in `apps/web`. It reads the same SQLite database as
the bot, uses Better Auth for Discord login, and can update a user's Discord Application Role
Connection so their profile can show an EWC prediction summary.

Discord Developer Portal setup:

1. Add the OAuth redirect URL: `{BETTER_AUTH_URL}/api/auth/callback/discord`
2. Add an Application Role Connection verification URL: `{EWC_DASHBOARD_PUBLIC_URL}/me`
3. Run `npm run deploy` so slash commands and role-connection metadata are registered.

Local setup:

```bash
npm install
npm run web:auth:migrate
npm run web:build
npm run web:start   # terminal 1
npm start           # terminal 2
```

Both processes should point at the same `DB_PATH`. The bot calls the web app through `EWC_DASHBOARD_INTERNAL_URL` with
`EWC_DASHBOARD_INTERNAL_SECRET` when `/ewc_predict sync`, `/ewc_predict unlink`, or scoring
automation refreshes profile showcases.

Docker/NAS setup:

The production image runs both services through `npm run start:production`: the bot starts from
`src/index.js`, and the dashboard starts with `next start` from `apps/web`. In `compose.ugreen.yml`,
the dashboard is exposed as `${EWC_DASHBOARD_PORT:-3000}:3000` and the bot talks to it through
`EWC_DASHBOARD_INTERNAL_URL=http://127.0.0.1:3000`. Set `RUN_WEB=false` only if the dashboard is
hosted elsewhere, or `RUN_BOT=false` only for a web-only container.

For local dashboard previews without Discord OAuth, start the web app with
`EWC_DASHBOARD_DEV_AUTH_BYPASS=true`. The preview user defaults to Discord ID
`100000000000000001`; set `EWC_DASHBOARD_DEV_DISCORD_USER_ID` to view another local
prediction user. This bypass is ignored when `NODE_ENV=production`.

Useful dashboard URLs:

```text
/me
/leaderboard/<guildId>/2026
/games
```

The dashboard stores the selected language in the `ewc_locale` cookie. Legacy links
with `?lang=en` or `?lang=ar` are redirected to the same URL without the query parameter
while setting the cookie. If no cookie is present, Arabic browsers default to Arabic
from `Accept-Language`; everyone else gets English. Set `EWC_DASHBOARD_DEFAULT_GUILD_ID`
when you want the home page to include a direct public leaderboard button.

The web app uses hosted Thmanyah WOFF2 files through the same-origin `/fonts/...` proxy.
Set `THMANYAH_FONT_BASE_URL` to the public R2/custom-domain base URL that contains
`thmanyahsans/woff2`, `thmanyahserifdisplay/woff2`, and `thmanyahseriftext/woff2`.

## News & Media CMS

The dashboard includes a bilingual news/media CMS, accessible at `/admin` to authorized
staff. Admins can publish game-specific news posts in English, Arabic (RTL), or both, as
well as manage a media channel directory.

**Roles model**

- **Super admins** are declared via `EWC_DASHBOARD_SUPER_ADMIN_DISCORD_IDS` (comma-separated
  Discord user IDs). They have full access, including the ability to manage the admin roster.
- The legacy variable `EWC_DASHBOARD_ADMIN_DISCORD_IDS` is still honored and grants the same
  super-admin level for back-compat.
- **Scoped admins** are assigned per game and per media channel at `/admin/team` (super-only
  page) and stored in the bot database — no env change required.

**Publish lifecycle**

Posts start as drafts. A post in `shared` mode uses one language with a configured default
locale. A post in `translated` mode requires both EN and AR content before it can be
published. Published posts appear on the public game pages with locale-aware fallback (cookie
or `Accept-Language`). Content limits: title 90 chars, summary 180 chars, body 12,000 chars.

**Image uploads (Cloudflare R2)**

Cover images are uploaded to Cloudflare R2 (S3-compatible). Accepted formats: PNG, JPEG,
WebP, GIF, AVIF (SVG is excluded — script risk). Maximum size: 8 MB. Files are stored under
`news/YYYY-MM-DD/<uuid>.<ext>` and served from `R2_PUBLIC_BASE_URL`. R2 is optional — when
the five `R2_*` env vars are not set, the upload endpoint returns 503 and admins can paste
image URLs instead. See `apps/web/README.md` for R2 setup steps.

## Configuration (`.env`)

| Variable | Purpose |
|---|---|
| `DISCORD_TOKEN`, `DISCORD_CLIENT_ID` | Bot credentials (required) |
| `DISCORD_CLIENT_SECRET` | Discord OAuth client secret for the web dashboard |
| `DISCORD_GUILD_ID` | Register commands to one server instantly (dev) |
| `LIQUIPEDIA_PARSE_MIN_GAP_MS`, `LIQUIPEDIA_CACHE_TTL_MS`, `LIQUIPEDIA_BACKOFF_MS`, `LIQUIPEDIA_RATE_STATE_PATH` | Liquipedia parse throttle, cache, and restart-safe rate-limit state |
| `LIQUIPEDIA_USER_AGENT` | Required by Liquipedia ToS — identify your app + a contact |
| `SCHEDULER_TIMEZONE`, `MORNING_CRON` | Daily-sync schedule |
| `LIVE_POLL_INTERVAL_MS` | Live poll cadence (default 3 min; cache keeps fetches well under the limit) |
| `CC_REFRESH_MINUTES` | Club Championship refresh cadence (default 15) |
| `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` | Better Auth secret and public auth base URL |
| `EWC_DASHBOARD_PUBLIC_URL`, `EWC_DASHBOARD_INTERNAL_URL`, `EWC_DASHBOARD_INTERNAL_SECRET` | Public dashboard URL and bot-to-web internal sync settings |
| `EWC_DASHBOARD_SUPER_ADMIN_DISCORD_IDS` | Comma-separated Discord IDs with full dashboard control (roster, games, media) |
| `EWC_DASHBOARD_ADMIN_DISCORD_IDS` | Legacy — still honored, grants the same super-admin level (prefer the var above) |
| `RUN_BOT`, `RUN_WEB`, `WEB_HOST`, `WEB_PORT` | Combined-container controls for `npm run start:production` |
| `R2_*` (5 vars) | Optional Cloudflare R2 for news image uploads (see `apps/web/README.md`) |
| `EWC_DASHBOARD_DEFAULT_GUILD_ID` | Optional guild ID used for the home page public leaderboard shortcut |
| `THMANYAH_FONT_BASE_URL` | Public base URL for hosted Thmanyah WOFF2 files used by the web app font proxy |
| `LOGO_CACHE_DIR`, `LOGO_CACHE_CONCURRENCY` | Persistent logo cache path and max concurrent logo downloads |
| `LOGO_DOWNLOAD_MIN_GAP_MS`, `LOGO_RATE_LIMIT_BACKOFF_MS`, `LOGO_RATE_STATE_PATH` | Logo download throttle and restart-safe rate-limit state |
| `LOGO_FAILURE_TTL_MS`, `LOGO_MAX_BYTES` | Logo retry delay for bad URLs and maximum accepted logo size |
| `STARTGG_TOKEN`, `PANDASCORE_TOKEN` | Optional secondary sources (stubbed) |

## Docker / UGREEN NAS

Production runs **one combined container** (bot + dashboard via
`npm run start:production`) published to GHCR by CI — tag a release
(`git tag vX.Y.Z && git push --tags`) and the `Publish image` workflow builds
`ghcr.io/devabdullahs/esports-community-bot`. Public HTTPS comes from a
**Cloudflare Tunnel** sidecar (no port-forward).

Copy `compose.example.yml` to `compose.ugreen.yml` (git-ignored), fill
`.env.docker`, then on the NAS:

```bash
docker compose pull
docker compose up -d
```

The full runbook — Cloudflare Tunnel setup, env checklist, Discord OAuth
redirect, one-time auth migration, smoke checks — is in
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). The compose file stores the SQLite
database, logo cache, and persistent rate-limit state under `./data`.

## Project structure

```
src/
  index.js               bot entry: load config/commands/events, login, graceful shutdown
  start-production.js    combined-container entry: spawns bot + web (RUN_BOT / RUN_WEB)
  config.js              env loading + validation
  deploy-commands.js     register slash commands via Discord REST
  commands/              tournaments, boards, match, lookup, ewc_predict, ewc_admin, ...
  events/                ready, interactionCreate (commands + components + modals)
  jobs/                  morningSync, pollingManager, leaderboard, ewcPredictions,
                         clubChampionship, csRankings, voiceStatus, refresh, matchCardBoard
  services/liquipedia/   client (one serialized queue), parsers, fetchers, rateState
  db/                    SQLite (better-sqlite3): tournaments, matches, settings,
                         ewcPredictions, ewcGames, ewcMediaChannels, ewcNewsPosts,
                         ewcAdmins, ewcAdminAuditLog, ewcRateLimits, ewcProfileLinks
  lib/                   scoring math (ewcPredictions), canvas cards, logoCache,
                         markdownTools, render, games, auditLog, ...
apps/web/                Next.js dashboard (EN/AR, RTL) — pages, /admin CMS, API routes,
                         vitest suite in src/test/
scripts/seed-dev.mjs     sample-data seeder for local dashboard preview (npm run seed:dev)
tests/                   bot test suite (node:test) — scoring, parsers, CMS, limits
docs/DEPLOYMENT.md       NAS deployment runbook
```

## Data source & attribution

All tournament data is sourced from **[Liquipedia](https://liquipedia.net)** and is licensed
under **[CC-BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)**. The bot attributes
Liquipedia in every embed footer and links each match back to its Liquipedia page. Access is
done via the MediaWiki API in accordance with Liquipedia's
[API Terms of Use](https://liquipedia.net/api-terms-of-use) (descriptive User-Agent, request
throttling, aggressive caching, no scraping of generated HTML pages).

## Known limitations

- Eligibility colors (green/yellow) on the Club Championship board activate once a live EWC
  edition marks them.
- The `npm audit` moderate advisory (postcss via Next 16.2.x) clears when a stable
  Next ≥ 16.3.0 ships — tracked, not actionable yet.

## License

[MIT](LICENSE) — free to use, modify, and self-host. (Replace `<YOUR NAME>` in `LICENSE`.)
Liquipedia data remains under CC-BY-SA 3.0 as noted above.

## Roadmap

Everything in earlier roadmaps has shipped (Swiss parsing, per-game boards and
voice channels, LPDB client, Start.gg/PandaScore, `/match` detail cards,
rendered match images, the per-game prediction system, the bilingual web
dashboard + CMS, CI, and the GHCR deployment pipeline). What's actually next:

- [ ] **Tournaments & live matches on the web dashboard** — design ready in
  [`plans/design/tournaments-dashboard.md`](plans/design/tournaments-dashboard.md)
  (the bot's tournament/match data, surfaced on the public site).
- [ ] **Discord news auto-posting** — publish a dashboard news post and the bot
  announces it in Discord; design ready in
  [`plans/design/discord-news-posting.md`](plans/design/discord-news-posting.md).
- [ ] Nonce-based CSP `script-src` (tightening the current conservative policy).
- [ ] Bump Next when a stable ≥ 16.3.0 ships (clears the postcss audit advisory).
