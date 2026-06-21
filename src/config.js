import { logger } from './lib/logger.js';

// Load .env if present (Node >= 20.12 has process.loadEnvFile, no dependency needed).
// You can also run with: node --env-file=.env src/index.js
try {
  process.loadEnvFile();
} catch {
  // No .env file in CWD — fall back to the real process environment.
}

function required(name) {
  const value = process.env[name];
  if (!value) {
    logger.error(`Missing required env var: ${name}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
  return value;
}

const get = (name, fallback) => process.env[name] ?? fallback;

export const config = {
  discord: {
    token: required('DISCORD_TOKEN'),
    clientId: required('DISCORD_CLIENT_ID'),
    // Optional: when set, slash commands register to this one guild instantly (great for dev).
    guildId: get('DISCORD_GUILD_ID'),
    deployCommandsOnStart: get('DEPLOY_DISCORD_COMMANDS', 'false') === 'true',
  },
  pandascore: {
    token: get('PANDASCORE_TOKEN'),
    baseUrl: get('PANDASCORE_BASE_URL', 'https://api.pandascore.co'),
  },
  startgg: {
    token: get('STARTGG_TOKEN'),
    baseUrl: get('STARTGG_BASE_URL', 'https://api.start.gg/gql/alpha'),
  },
  // Live co-stream detection (optional). When a platform's client id+secret are set,
  // the stream-status poller checks each tracked channel and records who's live.
  twitch: {
    clientId: get('TWITCH_CLIENT_ID'),
    clientSecret: get('TWITCH_CLIENT_SECRET'),
  },
  kick: {
    clientId: get('KICK_CLIENT_ID'),
    clientSecret: get('KICK_CLIENT_SECRET'),
  },
  streams: {
    pollSeconds: Math.max(30, Number(get('STREAM_STATUS_POLL_SECONDS', '60')) || 60),
  },
  liquipedia: {
    // REQUIRED by Liquipedia's API ToS: identify the app and a contact.
    userAgent: get(
      'LIQUIPEDIA_USER_AGENT',
      'EsportsCommunityBot/0.1 (set LIQUIPEDIA_USER_AGENT with a contact email)',
    ),
    // During the daily sync, auto-import a Liquipedia tournament's official
    // broadcaster streams as game-scoped co-stream channels (shown under live match
    // cards). Reuses the same cached page fetch as the schedule sync (no extra
    // request). Set to 'false' to disable. On by default.
    importBroadcasters: get('LIQUIPEDIA_IMPORT_BROADCASTERS', 'true') !== 'false',
  },
  lpdb: {
    // LiquipediaDB API (optional). When LPDB_API_KEY is set it's preferred over HTML parsing.
    apiKey: get('LPDB_API_KEY'),
    baseUrl: get('LPDB_BASE_URL', 'https://api.liquipedia.net/api/v3'),
  },
  scheduler: {
    timezone: get('SCHEDULER_TIMEZONE', 'UTC'), // IANA tz, e.g. "Europe/London"
    morningCron: get('MORNING_CRON', '0 8 * * *'),
    livePollIntervalMs: Number(get('LIVE_POLL_INTERVAL_MS', 300_000)), // 5 minutes
    syncOnBoot: get('SYNC_ON_BOOT', 'false') === 'true',
  },
  clubChampionship: {
    // How often to refresh the EWC Club Championship standings embed (minutes).
    refreshMinutes: Number(get('CC_REFRESH_MINUTES', 15)),
  },
  csRankings: {
    // Valve Regional Standings update infrequently; keep this gentle for Liquipedia.
    refreshMinutes: Number(get('CS_RANKINGS_REFRESH_MINUTES', 60)),
  },
  ewcPredictions: {
    // Checks for due prediction snapshots/scoring. Actual Liquipedia requests still go through
    // the global MediaWiki parse limiter, and only happen when a configured round is due.
    refreshMinutes: Number(get('EWC_PREDICTIONS_REFRESH_MINUTES', 60)),
    scoreDelayHours: Number(get('EWC_PREDICTIONS_SCORE_DELAY_HOURS', 24)),
  },
  ewcNews: {
    // How often the news announcer polls for newly published / edited / unpublished posts (ms).
    announceIntervalMs: Number(get('NEWS_ANNOUNCE_INTERVAL_MS', 120_000)),
  },
  dashboard: {
    publicUrl: get('EWC_DASHBOARD_PUBLIC_URL'),
    internalUrl: get('EWC_DASHBOARD_INTERNAL_URL'),
    internalSecret: get('EWC_DASHBOARD_INTERNAL_SECRET'),
  },
  db: {
    path: get('DB_PATH', 'data/bot.sqlite'),
  },
  logLevel: get('LOG_LEVEL', 'info'),
};
