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
    profilesEnabled: get('PANDASCORE_PROFILES_ENABLED', 'false') === 'true',
    profilesCron: get('PANDASCORE_PROFILES_CRON', '30 3 * * *'),
    profilesTimezone: get('PANDASCORE_PROFILES_TIMEZONE', 'Asia/Riyadh'),
    profilesGames: get('PANDASCORE_PROFILES_GAMES', ''),
    profilesQuietStartHour: Number(get('PANDASCORE_PROFILES_QUIET_START_HOUR', 2)),
    profilesQuietEndHour: Number(get('PANDASCORE_PROFILES_QUIET_END_HOUR', 6)),
    profilesMinGapMs: Math.max(250, Number(get('PANDASCORE_PROFILES_MIN_GAP_MS', 1500)) || 1500),
    profilesBackoffMs: Math.max(60_000, Number(get('PANDASCORE_PROFILES_BACKOFF_MS', 1_200_000)) || 1_200_000),
    profilesPerPage: Math.min(100, Math.max(1, Number(get('PANDASCORE_PROFILES_PER_PAGE', 50)) || 50)),
    profilesMaxPages: Math.max(1, Number(get('PANDASCORE_PROFILES_MAX_PAGES', 3)) || 3),
  },
  logoWarmup: {
    // Pre-download tracked-match crests into the shared cache so the web logo
    // proxy can serve them (it never fetches upstream on public page views).
    // Downloads reuse logoSource's serial, 10s-paced, back-off-protected queue.
    enabled: get('LOGO_WARMUP_ENABLED', 'true') === 'true',
    cron: get('LOGO_WARMUP_CRON', '20 */3 * * *'),
    timezone: get('LOGO_WARMUP_TIMEZONE', 'Asia/Riyadh'),
    maxDownloadsPerRun: Math.max(1, Number(get('LOGO_WARMUP_MAX_DOWNLOADS_PER_RUN', 40)) || 40),
    bootDelayMs: Math.max(0, Number(get('LOGO_WARMUP_BOOT_DELAY_MS', 30000)) || 0),
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
