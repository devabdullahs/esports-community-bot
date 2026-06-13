import "server-only";

import { get } from "@bot/db/client.js";

// ---------------------------------------------------------------------------
// Single-guild deployment: the bot serves exactly ONE Discord guild. The public
// site needs that guild id to read tournaments, leaderboards, and seasons, but
// the operator often leaves EWC_DASHBOARD_DEFAULT_GUILD_ID unset. Rather than
// show empty pages, derive the guild from whatever the bot has already written.
//
// Each probe is wrapped in a defensive try/catch that swallows a "no such table"
// error (mirrors safeAccountQuery in ewc-profile-sync.ts) so a fresh DB — where
// some tables may not exist yet — degrades to null instead of throwing.
// ---------------------------------------------------------------------------

async function safeGuildQuery(sql: string): Promise<string | null> {
  try {
    const row = (await get(sql)) as { guild_id?: string | null } | null;
    const id = row?.guild_id;
    return typeof id === "string" && id ? id : null;
  } catch (error) {
    if (/no such table|does not exist/i.test(String((error as Error).message))) return null;
    throw error;
  }
}

// Probes ordered by signal strength: tracked tournaments and prediction seasons
// are the strongest indicators of "the" guild; the settings table is the final
// fallback (it always holds exactly one row in a single-guild deployment).
const PROBES = [
  "SELECT guild_id FROM tournaments GROUP BY guild_id ORDER BY COUNT(*) DESC LIMIT 1",
  "SELECT guild_id FROM ewc_prediction_seasons GROUP BY guild_id ORDER BY COUNT(*) DESC LIMIT 1",
  "SELECT guild_id FROM game_leaderboards GROUP BY guild_id ORDER BY COUNT(*) DESC LIMIT 1",
  "SELECT guild_id FROM guild_settings LIMIT 1",
];

/**
 * The Discord guild id the public site should read from.
 *
 * 1. An explicit EWC_DASHBOARD_DEFAULT_GUILD_ID always wins (operator override).
 * 2. Otherwise derive it from the shared bot DB, taking the first non-null of the
 *    probes above.
 * 3. Returns null only for a genuinely empty DB with no override set.
 */
export async function resolveDefaultGuildId(): Promise<string | null> {
  const override = process.env.EWC_DASHBOARD_DEFAULT_GUILD_ID;
  if (override) return override;

  for (const probe of PROBES) {
    const id = await safeGuildQuery(probe);
    if (id) return id;
  }
  return null;
}
