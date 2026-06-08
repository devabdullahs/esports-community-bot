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
npm run web:start
```

Run the bot separately with `npm start`. Both processes should point at the same `DB_PATH`.
The bot calls the web app through `EWC_DASHBOARD_INTERNAL_URL` with
`EWC_DASHBOARD_INTERNAL_SECRET` when `/ewc_predict sync`, `/ewc_predict unlink`, or scoring
automation refreshes profile showcases.

For local dashboard previews without Discord OAuth, start the web app with
`EWC_DASHBOARD_DEV_AUTH_BYPASS=true`. The preview user defaults to Discord ID
`100000000000000001`; set `EWC_DASHBOARD_DEV_DISCORD_USER_ID` to view another local
prediction user. This bypass is ignored when `NODE_ENV=production`.

Useful dashboard URLs:

```text
/me
/leaderboard/<guildId>/2026
```

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
| `EWC_DASHBOARD_ADMIN_DISCORD_IDS` | Optional comma-separated Discord user IDs for future admin dashboard routes |
| `LOGO_CACHE_DIR`, `LOGO_CACHE_CONCURRENCY` | Persistent logo cache path and max concurrent logo downloads |
| `LOGO_DOWNLOAD_MIN_GAP_MS`, `LOGO_RATE_LIMIT_BACKOFF_MS`, `LOGO_RATE_STATE_PATH` | Logo download throttle and restart-safe rate-limit state |
| `LOGO_FAILURE_TTL_MS`, `LOGO_MAX_BYTES` | Logo retry delay for bad URLs and maximum accepted logo size |
| `STARTGG_TOKEN`, `PANDASCORE_TOKEN` | Optional secondary sources (stubbed) |

## Docker / UGREEN NAS

Local NAS deployment files are intentionally ignored by git. Fill `.env.docker`, then run:

```bash
docker compose -f compose.ugreen.yml build
docker compose -f compose.ugreen.yml up -d
```

The compose file stores the SQLite database, logo cache, and persistent Liquipedia/logo rate-limit state under `./data`.

## Project structure

```
src/
  index.js              entry: load config/commands/events, login, graceful shutdown
  config.js             env loading + validation
  deploy-commands.js    register slash commands via Discord REST
  commands/             add_tournament, list_tournaments, remove_tournament, set_channel, set_ewc
  events/               ready, interactionCreate (commands + autocomplete)
  jobs/                 morningSync, pollingManager, leaderboard, clubChampionship, voiceStatus, refresh
  services/             liquipedia (primary), startgg + pandascore (optional stubs)
  db/                   SQLite (better-sqlite3): tournaments, matches, settings, game_leaderboards
  lib/                  logger, time, loaders, render, games, parseTournamentInput
```

## Data source & attribution

All tournament data is sourced from **[Liquipedia](https://liquipedia.net)** and is licensed
under **[CC-BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)**. The bot attributes
Liquipedia in every embed footer and links each match back to its Liquipedia page. Access is
done via the MediaWiki API in accordance with Liquipedia's
[API Terms of Use](https://liquipedia.net/api-terms-of-use) (descriptive User-Agent, request
throttling, aggressive caching, no scraping of generated HTML pages).

## Known limitations

- **Swiss-stage tournaments** (e.g. some Rocket League events) render matches in a standings
  grid rather than a bracket/matchlist; parsing those is on the roadmap.
- Eligibility colors (green/yellow) on the Club Championship board activate once a live EWC
  edition marks them.

## License

[MIT](LICENSE) — free to use, modify, and self-host. (Replace `<YOUR NAME>` in `LICENSE`.)
Liquipedia data remains under CC-BY-SA 3.0 as noted above.

## Roadmap

- [x] Swiss-stage match parsing (Rocket League and similar)
- [x] Per-game leaderboards **and** voice channels (a separate channel per game)
- [x] LPDB API client wired — preferred over HTML parsing when `LPDB_API_KEY` is set (activate once your key is approved)
- [x] Start.gg + PandaScore integrations (free tier) — structured match data with live status
- [x] Per-match detail view — `/match` (autocomplete) opens a focused card + link to full details
- [x] Generated match-card images for `/match` and per-game live card channels
