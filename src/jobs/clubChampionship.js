import { ContainerBuilder, SeparatorSpacingSize, MessageFlags } from 'discord.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import * as defaultLiquipedia from '../services/liquipedia.js';
import * as defaultSnapshots from '../db/ewcClubChampionshipSnapshots.js';
import { getSettings, setClubChampionshipMessage, getGuildsWithClubChampionship } from '../db/settings.js';
import { LIQUIPEDIA_ATTRIBUTION } from '../lib/render.js';

const nowSec = () => Math.floor(Date.now() / 1000);
export const EWC_CLUB_DIRECTORY_REFRESH_MS = 6 * 60 * 60 * 1000;

// Season -> last directory fetch attempt, successful or not. Only failures are
// recorded here; a success updates clubsFetchedAt on the snapshot and is paced
// by that instead. See the rejection branch for why an attempt has to count.
const directoryAttemptedAt = new Map();

// Test seam: a rejected fetch is held for six hours, which no test wants to wait
// out and none should silently inherit from another.
export function resetClubDirectoryAttemptsForTests() {
  directoryAttemptedAt.clear();
}

function rankLabel(rank) {
  return rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `**${rank}.**`;
}

function eligibilityIcon(e) {
  return e === 'champion' ? '🟡 ' : e === 'prize' ? '🟢 ' : '';
}

export function clubChampionshipSeason(page) {
  return String(page ?? '').match(/(?:^|\/)(\d{4})(?:\/|$)/)?.[1] ?? null;
}

function clubChampionshipSourceUrl(wiki, page) {
  const standingsPage = defaultLiquipedia.clubChampionshipStandingsPage(page);
  return `https://liquipedia.net/${wiki}/${standingsPage}`;
}

// Components V2 container for the Club Championship.
export function buildClubChampionshipContainer(label, data) {
  const c = new ContainerBuilder().setAccentColor(0xf1c40f);
  c.addTextDisplayComponents((td) => td.setContent(`## 🏆 ${label}\n-# Updated <t:${nowSec()}:R>`));

  if (data.standings.length) {
    const lines = data.standings
      .slice(0, 15)
      .map((s) => `${rankLabel(s.rank)} ${eligibilityIcon(s.eligibility)}${s.team} — \`${s.points.toLocaleString()}\``);
    c.addSeparatorComponents((s) => s.setSpacing(SeparatorSpacingSize.Small).setDivider(true));
    c.addTextDisplayComponents((td) => td.setContent(`### 📊 Club Points Standings\n${lines.join('\n')}`));
    // Eligibility legend (only appears once a live event marks teams green/yellow).
    if (data.standings.some((s) => s.eligibility)) {
      c.addTextDisplayComponents((td) =>
        td.setContent('-# 🟡 eligible to win the Championship · 🟢 eligible for the prize pool (≥2 Top-8 finishes)'),
      );
    }
  } else {
    c.addSeparatorComponents((s) => s.setSpacing(SeparatorSpacingSize.Small));
    c.addTextDisplayComponents((td) =>
      td.setContent('_Points standings will appear here once EWC matches begin._'),
    );
  }

  const prizes = data.prizepool.filter((p) => p.prize).slice(0, 6);
  if (prizes.length) {
    const lines = prizes.map((p) => {
      const names = p.teams?.length ? p.teams : p.team && p.team !== 'TBD' ? [p.team] : [];
      const who = names.length ? ` — **${names.join(' / ')}**` : '';
      return `\`${p.place.padEnd(4)}\` ${p.prize}${who}`;
    });
    c.addSeparatorComponents((s) => s.setSpacing(SeparatorSpacingSize.Small).setDivider(true));
    c.addTextDisplayComponents((td) => td.setContent(`### 💰 Prize Pool\n${lines.join('\n')}`));
  }

  c.addSeparatorComponents((s) => s.setSpacing(SeparatorSpacingSize.Small));
  c.addTextDisplayComponents((td) => td.setContent(`-# ${LIQUIPEDIA_ATTRIBUTION}`));
  return c;
}

// Fetch + post/edit the standings message for one guild.
export async function updateClubChampionship(
  client,
  guildId,
  { liquipedia = defaultLiquipedia, snapshots = defaultSnapshots } = {},
) {
  const s = await getSettings(guildId);
  if (!s.cc_channel_id || !s.cc_page) return false;

  let data;
  try {
    const wiki = s.cc_wiki || 'esports';
    const fetched = await liquipedia.fetchClubChampionship(wiki, s.cc_page);
    data = {
      ...fetched,
      standings: fetched?.standings ?? [],
      prizepool: fetched?.prizepool ?? [],
    };
    const season = clubChampionshipSeason(s.cc_page);
    if (!season) throw new Error(`could not determine a season from ${s.cc_page}`);
    const existing = typeof snapshots.getEwcClubChampionshipSnapshot === 'function'
      ? await snapshots.getEwcClubChampionshipSnapshot(season).catch(() => null)
      : null;
    const directoryAge = existing?.clubsFetchedAt ? Date.now() - new Date(existing.clubsFetchedAt).getTime() : Infinity;
    // In-process only: a restart may cost one extra attempt, which is the right
    // trade against persisting a failure that a page fix should clear.
    const lastAttemptAt = directoryAttemptedAt.get(season) ?? 0;
    const attemptAge = Date.now() - lastAttemptAt;
    let directory = null;
    if (
      attemptAge >= EWC_CLUB_DIRECTORY_REFRESH_MS
      && (!existing?.clubs?.length || !Number.isFinite(directoryAge) || directoryAge >= EWC_CLUB_DIRECTORY_REFRESH_MS)
    ) {
      try {
        const fetchedDirectory = await liquipedia.fetchEwcClubs(Number(season));
        const validClubs = fetchedDirectory?.clubs?.length
          && fetchedDirectory.clubs.every((club) => (
            String(club?.name ?? '').trim()
            && Number.isInteger(Number(club?.qualifiedCount))
            && Number(club.qualifiedCount) >= 0
          ));
        if (validClubs) {
          directory = {
            clubs: fetchedDirectory.clubs,
            clubsSourceUrl: fetchedDirectory.sourceUrl,
            clubsFetchedAt: new Date(),
          };
        } else {
          // A rejected directory used to log the same sentence whatever went
          // wrong, so a page that had been re-laid-out looked exactly like one
          // whose rows failed validation.
          const headings = Array.isArray(fetchedDirectory?.headingsSeen) ? fetchedDirectory.headingsSeen : null;
          const detail = !fetchedDirectory?.clubs?.length
            ? (headings?.length
              ? `no club table matched; tables on the page start with: ${headings.join(' // ')}`
              : 'no club table matched and the page carried no sortable tables')
            : `${fetchedDirectory.clubs.length} row(s) parsed but at least one lacked a name or a qualified count`;
          logger.warn(`[cc] EWC ${season} clubs directory rejected (${detail}); preserving the last good copy`);
          // A rejected fetch still cost a Liquipedia parse. Without recording the
          // attempt the age check stays stale, so the next run re-fetches and
          // re-rejects — once every job tick, indefinitely. Hold the failure to
          // the same cadence as a success so a broken page costs the same budget
          // as a working one rather than a request every few minutes.
          directoryAttemptedAt.set(season, Date.now());
        }
      } catch (error) {
        const level = /backing off after a rate limit/i.test(error.message) ? 'debug' : 'warn';
        logger[level](`[cc] EWC ${season} clubs directory refresh failed: ${error.message}`);
      }
    }
    await snapshots.upsertEwcClubChampionshipSnapshot({
      season,
      sourceUrl: data.sourceUrl || clubChampionshipSourceUrl(wiki, s.cc_page),
      standings: data.standings,
      prizepool: data.prizepool,
      ...(directory ?? {}),
      fetchedAt: new Date(),
    });
  } catch (e) {
    const level = /backing off after a rate limit/i.test(e.message) ? 'debug' : 'error';
    logger[level](`[cc] refresh failed for ${s.cc_wiki}/${s.cc_page}: ${e.message}`);
    return false;
  }

  // Snapshot storage happens first so a Discord permission or delivery failure
  // never discards a successful external refresh.
  const channel = await client.channels.fetch(s.cc_channel_id).catch(() => null);
  if (!channel?.isTextBased?.()) return false;

  const payload = {
    components: [buildClubChampionshipContainer(s.cc_label || 'EWC Club Championship', data)],
    flags: MessageFlags.IsComponentsV2,
  };

  if (s.cc_message_id) {
    const msg = await channel.messages.fetch(s.cc_message_id).catch(() => null);
    if (msg) {
      await msg.edit(payload);
      return true;
    }
  }
  const sent = await channel.send(payload);
  await setClubChampionshipMessage(guildId, sent.id);
  logger.info(`[cc] posted standings message ${sent.id} in guild ${guildId}`);
  return true;
}

let timer = null;
let bootTimer = null;
let running = false;

export function startClubChampionship(client) {
  const minutes = Math.max(5, config.clubChampionship.refreshMinutes);
  const run = async () => {
    if (running) {
      logger.debug('[cc] previous refresh still running; skipping this tick');
      return;
    }
    running = true;
    try {
      for (const guildId of await getGuildsWithClubChampionship()) {
        await updateClubChampionship(client, guildId).catch((e) => logger.error(`[cc] ${guildId}: ${e.message}`));
      }
    } finally {
      running = false;
    }
  };
  timer = setInterval(() => run().catch((e) => logger.error(`[cc] ${e.message}`)), minutes * 60 * 1000);
  timer.unref?.();
  logger.info(`[cc] Club Championship refresh every ${minutes}m.`);
  bootTimer = setTimeout(
    () => run().catch((e) => logger.error(`[cc] ${e.message}`)),
    config.clubChampionship.bootDelayMs,
  );
  bootTimer.unref?.();
}

export function stopClubChampionship() {
  if (bootTimer) clearTimeout(bootTimer);
  bootTimer = null;
  if (timer) clearInterval(timer);
  timer = null;
  running = false;
}
