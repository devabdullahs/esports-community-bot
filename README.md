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
| `/remove_tournament` | Stop tracking one (autocomplete search) |
| `/set_channel leaderboard` | Set the combined board channel, or a per-game board (optional `game`) |
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
**View Channels**, **Send Messages**, **Embed Links**, **Read Message History** (to edit its
own boards), and **Manage Channels** (to rename the voice channel). The bot prints a ready-made
invite link in its startup log.

Then, as a server admin:

```
/set_channel leaderboard channel:#esports
/set_channel leaderboard channel:#valorant  game:Valorant      (optional per-game board)
/set_channel voice channel:🔴-status
/add_tournament identifier:https://liquipedia.net/valorant/VCT/2026/Stage_2/Masters
/set_ewc url:https://liquipedia.net/esports/Esports_World_Cup/2026 channel:#ewc-standings
```

## Configuration (`.env`)

| Variable | Purpose |
|---|---|
| `DISCORD_TOKEN`, `DISCORD_CLIENT_ID` | Bot credentials (required) |
| `DISCORD_GUILD_ID` | Register commands to one server instantly (dev) |
| `LIQUIPEDIA_USER_AGENT` | Required by Liquipedia ToS — identify your app + a contact |
| `SCHEDULER_TIMEZONE`, `MORNING_CRON` | Daily-sync schedule |
| `LIVE_POLL_INTERVAL_MS` | Live poll cadence (default 3 min; cache keeps fetches well under the limit) |
| `CC_REFRESH_MINUTES` | Club Championship refresh cadence (default 15) |
| `STARTGG_TOKEN`, `PANDASCORE_TOKEN` | Optional secondary sources (stubbed) |

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
- [ ] Per-match detail view (buttons / select menus)
