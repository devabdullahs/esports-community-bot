import {
  SlashCommandBuilder,
  InteractionContextType,
  MessageFlags,
  AttachmentBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  LabelBuilder,
  ModalBuilder,
  SectionBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { config } from '../config.js';
import {
  countOverallScored,
  countSeasonScored,
  countWeeklyScored,
  getEwcSeason,
  getEwcWeek,
  getSeasonPrediction,
  getWeeklyPrediction,
  listEwcWeeks,
  overallLeaderboard,
  seasonLeaderboard,
  userPredictionProfile,
  weeklyLeaderboard,
} from '../db/ewcPredictions.js';
import { getEwcProfileLinkByDiscordUser } from '../db/ewcProfileLinks.js';
import { effectiveEwcWeekStatus, formatShortDate, formatTimestamp, normalizeClubName } from '../lib/ewcPredictions.js';
import { predictionRoundCompletion, selectCurrentOpenEwcWeek } from '../lib/ewcPredictionRounds.js';
import { searchEwcClubChoices } from '../lib/ewcClubCache.js';
import { ewcGameParticipantTeams } from '../lib/ewcGameTeams.js';
import { submitSeasonSlot, submitWeeklyGamePick } from '../lib/ewcPredictionWrites.js';
import { weeklyModalSelection, weeklyPickerPage, weeklyPickerPageForGame } from '../lib/ewcWeeklyPicker.js';
import { announceEwcParticipation } from '../lib/ewcParticipation.js';
import { updateEwcPredictionLeaderboard } from '../jobs/ewcPredictions.js';
import { renderEwcShareCard } from '../lib/ewcShareCard.js';
import { logger } from '../lib/logger.js';
import { projectSeasonScoreBreakdown, projectWeeklyScoreBreakdown } from '../lib/ewcPredictionBreakdown.js';
import { seasonPicksVisible, weeklyPickVisible } from '../lib/ewcPredictionVisibility.js';
import QRCode from 'qrcode';

const DEFAULT_SEASON = '2026';
const PAGE_SIZE = 20;
const WEEKLY_PICK_PAGE_SIZE = 25;
const SHARE_DISCORD_URL = 'https://esportscommunity.net/discord';

let shareQrPromise = null;

function getShareQr() {
  shareQrPromise ??= QRCode.toBuffer(SHARE_DISCORD_URL, {
    type: 'png',
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 320,
    color: {
      dark: '#0b1628',
      light: '#f3f6fb',
    },
  }).catch((error) => {
    shareQrPromise = null;
    throw error;
  });
  return shareQrPromise;
}

let builder = new SlashCommandBuilder()
  .setName('ewc_predict')
  .setDescription('Submit EWC predictions and view prediction leaderboards.')
  .addSubcommand((s) =>
    s
      .setName('weekly')
      .setDescription('Open the guided weekly EWC pick menu.')
      .addStringOption((o) => o.setName('week').setDescription('Week key').setAutocomplete(true).setRequired(false)),
  );

function seasonCommand(s) {
  return s
    .setName('season')
    .setDescription('Predict your top clubs for the whole EWC season.');
}

builder = builder
  .addSubcommand(seasonCommand)
  .addSubcommand((s) =>
    s
      .setName('leaderboard')
      .setDescription('Show an EWC prediction leaderboard.')
      .addStringOption((o) =>
        o
          .setName('type')
          .setDescription('Leaderboard type')
          .setRequired(true)
          .addChoices(
            { name: 'Overall', value: 'overall' },
            { name: 'Weekly', value: 'weekly' },
            { name: 'Season', value: 'season' },
          ),
      )
      .addStringOption((o) => o.setName('week').setDescription('Week key for weekly leaderboard').setAutocomplete(true))
      .addIntegerOption((o) => o.setName('page').setDescription('Page number').setMinValue(1)),
  )
  .addSubcommand((s) =>
    s
      .setName('profile')
      .setDescription('Show your EWC prediction profile.')
      .addUserOption((o) => o.setName('member').setDescription('Member to inspect')),
  )
  .addSubcommand((s) =>
    s
      .setName('share')
      .setDescription('Generate a shareable image of your EWC predictions for X/Twitter.')
      .addStringOption((o) =>
        o
          .setName('language')
          .setDescription('Card language')
          .addChoices({ name: 'English', value: 'en' }, { name: 'العربية', value: 'ar' }),
      ),
  )
  .addSubcommand((s) => s.setName('guide').setDescription('Show the EWC prediction guide (Arabic + English).'))
  .addSubcommand((s) =>
    s
      .setName('teams')
      .setDescription('Search the EWC club list.')
      .addStringOption((o) => o.setName('query').setDescription('Club name').setAutocomplete(true)),
  )
  .addSubcommand((s) =>
    s
      .setName('link')
      .setDescription('Connect your Discord profile showcase on the EWC dashboard.'),
  )
  .addSubcommand((s) =>
    s
      .setName('sync')
      .setDescription('Re-sync your EWC Discord profile showcase.'),
  )
  .addSubcommand((s) => s.setName('unlink').setDescription('Remove your EWC Discord profile showcase link.'))
  .setContexts(InteractionContextType.Guild);

export const data = builder;

function dashboardPublicUrl() {
  return config.dashboard.publicUrl?.replace(/\/$/, '');
}

function dashboardProfileUrl(interaction, seasonYear) {
  const base = dashboardPublicUrl();
  if (!base) return null;
  const params = new URLSearchParams({
    guildId: interaction.guildId,
    season: seasonYear,
  });
  return `${base}/me?${params.toString()}`;
}

async function dashboardInternalRequest(path, body) {
  if (!config.dashboard.internalUrl || !config.dashboard.internalSecret) {
    throw new Error('Dashboard internal sync is not configured.');
  }
  const response = await fetch(`${config.dashboard.internalUrl.replace(/\/$/, '')}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-ewc-internal-secret': config.dashboard.internalSecret,
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Dashboard request failed (${response.status})`);
  return data;
}

export async function refreshLinkedProfileAfterFirstWeeklyPick({ firstPick, discordUserId, guildId, season }) {
  if (!firstPick) return;
  try {
    if (!(await getEwcProfileLinkByDiscordUser(discordUserId))) return;
    await dashboardInternalRequest('/api/internal/ewc-profile/sync', {
      discordUserId,
      guildId,
      season,
    });
  } catch (error) {
    logger.warn(`[ewc-predict] linked profile refresh failed for ${discordUserId}: ${error.message}`);
  }
}

function season() {
  // Member-facing prediction commands always target the current EWC season.
  return DEFAULT_SEASON;
}

function roundClosedMessage(round) {
  if (!round) return 'That prediction round does not exist.';
  if (round.status !== 'open') return `That round is already \`${round.status}\`.`;
  const now = Math.floor(Date.now() / 1000);
  if (round.open_at && now < round.open_at) return `That round opens ${formatTimestamp(round.open_at)}.`;
  if (round.close_at && now >= round.close_at) return `That round closed ${formatTimestamp(round.close_at)}.`;
  return null;
}

function gameLabel(game) {
  if (!game) return 'Unknown game';
  return `${game.game || 'Game'}${game.event ? ` - ${game.event}` : ''}`;
}

function findRoundGame(round, gameKey) {
  return (round?.games || []).find((game) => game.key === gameKey) || null;
}

function gameClosedMessage(round, game) {
  if (!round) return 'That prediction round does not exist.';
  if (!game) return 'That game is not configured for this week.';
  if (round.status === 'scored') return `That round is already \`${round.status}\`.`;
  const now = Math.floor(Date.now() / 1000);
  if (round.open_at && now < round.open_at) return `That round opens ${formatTimestamp(round.open_at)}.`;
  if (game.lockAt && now >= game.lockAt) return `${game.game} picks locked ${formatTimestamp(game.lockAt)}.`;
  if (round.status !== 'open') return `That round is already \`${round.status}\`.`;
  return null;
}

function interactionSubmittedAt(interaction) {
  const createdAt = Number(interaction.createdTimestamp);
  if (Number.isFinite(createdAt) && createdAt > 0) return Math.floor(createdAt / 1000);
  return Math.floor(Date.now() / 1000);
}

function formatPicks(picks) {
  return picks.map((pick, index) => `**${index + 1}.** ${pick}`).join('\n');
}

function weeklyGameId(seasonYear, weekKey, gameKey, page, ownerId) {
  return `ewc_predict:wg:${seasonYear}:${weekKey}:${gameKey}:${page}:${ownerId}`;
}

function weeklyPickModalId(seasonYear, weekKey, gameKey, page, ownerId) {
  return `ewc_predict:wpm:${seasonYear}:${weekKey}:${gameKey}:${page}:${ownerId}`;
}

function weeklyPageId(seasonYear, weekKey, page, ownerId) {
  return `ewc_predict:wp:${seasonYear}:${weekKey}:${page}:${ownerId}`;
}

function weeklyWeekSelectId(seasonYear, ownerId) {
  return `ewc_predict:ww:${seasonYear}:${ownerId}`;
}

function seasonSlotId(seasonYear, index, ownerId) {
  return `ewc_predict:sg:${seasonYear}:${index}:${ownerId}`;
}

function seasonSlotModalId(seasonYear, index, ownerId) {
  return `ewc_predict:spm:${seasonYear}:${index}:${ownerId}`;
}

function chunk(items, size) {
  const rows = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

function weeklySelectStatus(week) {
  const state = effectiveEwcWeekStatus(week);
  if (state.label === 'opens') return `Opens ${formatShortDate(state.at)}`;
  if (state.label === 'partly open') return `Open ${state.openGames}/${state.totalGames}`;
  if (state.label === 'open') return 'Open';
  if (state.label === 'locked') return 'Locked';
  if (state.label === 'closed') return 'Closed';
  if (state.label === 'scored') return 'Scored';
  return String(state.label || 'Unknown').replace(/^\w/, (c) => c.toUpperCase());
}

function weeklySelectDescription(week) {
  const range = week.start_at || week.end_at ? `${formatShortDate(week.start_at)} - ${formatShortDate(week.end_at)}` : '';
  return [weeklySelectStatus(week), range].filter(Boolean).join(' | ').slice(0, 100);
}

function visibleWeeklySelectWeeks(weeks, currentWeekKey) {
  const withGames = weeks.filter((week) => Array.isArray(week.games) && week.games.length);
  if (withGames.length <= 25) return withGames;
  const currentIndex = Math.max(0, withGames.findIndex((week) => week.week_key === currentWeekKey));
  const start = Math.min(Math.max(0, currentIndex - 12), withGames.length - 25);
  return withGames.slice(start, start + 25);
}

export async function weeklyPickPayload(guildId, seasonYear, weekKey, userId, page = 0) {
  const round = await getEwcWeek(guildId, seasonYear, weekKey);
  if (!round) return { error: 'That prediction round does not exist.' };
  if (!round.games?.length) {
    return { error: 'This is an old aggregate weekly round. Ask an admin to regenerate the official EWC weeks before weekly picks open.' };
  }

  const saved = await getWeeklyPrediction(guildId, round.id, userId);
  const picks = saved?.picks || [];
  const pageModel = weeklyPickerPage(round.games, picks, page);
  const completion = predictionRoundCompletion(round, picks);
  const deadline = completion.nextLockAt ? `Next lock ${formatTimestamp(completion.nextLockAt)}` : 'No upcoming lock';
  const completionState = completion.isComplete
    ? '✅ All picks complete'
    : completion.missedGames.length
      ? `⚠ ${completion.missedGames.length} missed`
      : `${completion.openUnpickedGames.length} remaining`;

  // Components V2: one Section per game so its button sits in line with the game,
  // and the message edits in place to show each pick. (V2 messages can't carry an embed.)
  const container = new ContainerBuilder().setAccentColor(0xf1c40f);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## EWC Weekly Picks — ${round.label || round.week_key}\n-# Each game locks independently before it starts. Tap a game to pick or change it.`,
    ),
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `-# Status: ${weeklySelectStatus(round)} · ${pageModel.pickedGames}/${pageModel.totalGames} picked · ${completionState} · ${deadline} · Page ${pageModel.page + 1}/${pageModel.totalPages}`,
    ),
  );
  pageModel.games.forEach((game) => {
    const existing = game.existingPick;
    const locked = Boolean(gameClosedMessage(round, game));
    const lockTxt = game.lockAt ? ` · locks ${formatTimestamp(game.lockAt)}` : '';
    const status = locked ? '🔒 Locked' : existing?.pick ? `Pick: **${existing.pick}**` : '*No pick yet*';
    const text = `**${game.game || 'Game'}**${game.event ? ` — ${game.event}` : ''}\n${status}${lockTxt}`;
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(text.slice(0, 4000)))
        .setButtonAccessory(
          new ButtonBuilder()
            .setCustomId(weeklyGameId(seasonYear, round.week_key, game.key, pageModel.page, userId))
            .setLabel(locked ? 'Locked' : existing?.pick ? 'Change' : 'Pick')
            .setStyle(locked ? ButtonStyle.Secondary : existing?.pick ? ButtonStyle.Success : ButtonStyle.Primary)
            .setDisabled(locked),
        ),
    );
  });

  const weeks = visibleWeeklySelectWeeks(await listEwcWeeks(guildId, seasonYear), round.week_key);
  if (weeks.length > 1) {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(weeklyWeekSelectId(seasonYear, userId))
          .setPlaceholder('Switch week')
          .setMinValues(1)
          .setMaxValues(1)
          .addOptions(
            weeks.map((week) =>
              new StringSelectMenuOptionBuilder()
                .setLabel(`${week.label || week.week_key} - ${weeklySelectStatus(week)}`.slice(0, 100))
                .setDescription(weeklySelectDescription(week))
                .setValue(week.week_key)
                .setDefault(week.week_key === round.week_key),
            ),
          ),
      ),
    );
  }

  if (pageModel.totalPages > 1) {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(weeklyPageId(seasonYear, round.week_key, pageModel.page - 1, userId))
          .setLabel('Previous')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(pageModel.page === 0),
        new ButtonBuilder()
          .setCustomId(weeklyPageId(seasonYear, round.week_key, pageModel.page + 1, userId))
          .setLabel('Next')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(pageModel.page >= pageModel.totalPages - 1),
      ),
    );
  }

  return { components: [container] };
}

// The week members should predict right now: the soonest-to-lock still-open round.
export async function currentOpenWeek(guildId, seasonYear) {
  const weeks = await listEwcWeeks(guildId, seasonYear);
  return selectCurrentOpenEwcWeek(weeks);
}

// Season picks fill strictly top-down: you can change an already-set rank or set the
// next empty one, but not skip ahead (a gap would be silently collapsed by storage).
// 'filled' = rank already set, 'next' = the one settable empty rank, 'locked' = skip-ahead.
export function seasonSlotState(picks, index) {
  const filled = (picks || []).filter((p) => typeof p === 'string' && p.trim()).length;
  if (index < filled) return 'filled';
  if (index === filled) return 'next';
  return 'locked';
}

async function seasonPickPayload(guildId, seasonYear, userId) {
  const round = await getEwcSeason(guildId, seasonYear);
  const closed = roundClosedMessage(round);
  if (closed) return { error: closed };

  const saved = await getSeasonPrediction(guildId, seasonYear, userId);
  const picks = saved?.picks || [];
  const filled = picks.filter((p) => typeof p === 'string' && p.trim()).length;

  // Components V2: one Section per slot so its button sits in line with the slot,
  // and the message edits in place to show each pick. (V2 messages can't carry an embed.)
  const container = new ContainerBuilder().setAccentColor(0xf1c40f);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## EWC ${seasonYear} Season Picks — choose ${round.top_size} clubs\n-# ${
        filled >= round.top_size
          ? `All ${round.top_size} picked — tap any rank to change it.`
          : `${filled}/${round.top_size} picked — fill in order (Pick #${filled + 1} is next).`
      }`,
    ),
  );
  // V2 budget is 40 components total; each slot uses 3 (section + text + button), so 10 slots = 30, under budget.
  // Picks fill strictly top-down: only the next empty rank is settable, so no gaps can form.
  for (let i = 0; i < round.top_size; i += 1) {
    const pick = picks[i];
    const state = seasonSlotState(picks, i);
    const value = pick ? `**${pick}**` : state === 'next' ? '*tap Set →*' : '🔒 *locked*';
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Pick #${i + 1}** — ${value}`.slice(0, 4000)))
        .setButtonAccessory(
          new ButtonBuilder()
            .setCustomId(seasonSlotId(seasonYear, i, userId))
            .setLabel(state === 'filled' ? 'Change' : state === 'next' ? 'Set' : 'Locked')
            .setStyle(state === 'filled' ? ButtonStyle.Success : state === 'next' ? ButtonStyle.Primary : ButtonStyle.Secondary)
            .setDisabled(state === 'locked'),
        ),
    );
  }

  return { components: [container] };
}

async function getExistingGamePick(guildId, round, userId, gameKey) {
  const saved = await getWeeklyPrediction(guildId, round.id, userId);
  return (saved?.picks || []).find((pick) => pick && typeof pick === 'object' && pick.gameKey === gameKey) || null;
}

const HIDDEN_PICK_SUMMARY = 'Participated - picks hidden until lock.';
const HIDDEN_SEASON_SUMMARY = 'Participated - picks hidden until the season locks.';

function summarizeWeeklyPicks(row, { isOwner = false } = {}) {
  const picks = row.picks || [];
  if (!picks.length) return 'No picks';
  if (picks.every((pick) => typeof pick === 'string')) {
    if (!isOwner && !weeklyPickVisible(row, picks[0])) return HIDDEN_PICK_SUMMARY;
    return picks.join(', ');
  }
  if (!isOwner && !picks.some((pick) => weeklyPickVisible(row, pick))) return HIDDEN_PICK_SUMMARY;
  return picks
    .filter((pick) => pick && typeof pick === 'object')
    .map((pick) => {
      if (!isOwner && !weeklyPickVisible(row, pick)) return `${pick.game || pick.gameKey}: hidden`;
      return `${pick.game || pick.gameKey}: ${pick.pick}`;
    })
    .join(' | ') || 'No picks';
}

function limitDiscordText(value, limit = 1024) {
  const normalized = String(value || '').trim();
  return normalized.length <= limit ? normalized || '-' : `${normalized.slice(0, limit - 3)}...`;
}

function scoreBreakdownField(row, index, kind) {
  if (kind === 'weekly-per-game') {
    return {
      name: limitDiscordText(row.game || `Game ${index + 1}`, 256),
      value: limitDiscordText(
        `Pick: ${row.pick || '—'}\nResult: ${row.matchedClub || 'No matching result'}${row.placement ? ` (${row.placement})` : ''}\nPoints: ${row.points}${row.winner ? `\nWinner: ${row.winner}` : ''}\nStatus: ${row.status}`,
      ),
    };
  }
  if (kind === 'weekly-aggregate') {
    return {
      name: limitDiscordText(`Pick ${index + 1}: ${row.pick || '—'}`, 256),
      value: limitDiscordText(
        `Matched team: ${row.matchedTeam || 'No matching team'}\nWeekly rank: ${row.weeklyRank || '—'}\nPoints: ${row.points}\nStatus: ${row.status}`,
      ),
    };
  }
  return {
    name: limitDiscordText(`Predicted #${row.predictedRank || index + 1}: ${row.pick || '—'}`, 256),
    value: limitDiscordText(
      `Matched team: ${row.matchedTeam || 'No matching team'}\nActual rank: ${row.actualRank || '—'}\nHit points: ${row.hitPoints}\nExact-rank bonus: ${row.exactBonus}\nTotal: ${row.points}\nStatus: ${row.status}`,
    ),
  };
}

export function buildScoreBreakdownEmbed(title, breakdown) {
  const embed = new EmbedBuilder()
    .setColor(breakdown?.integrity === 'mismatch' ? 0xed4245 : 0x5865f2)
    .setTitle(limitDiscordText(`Score details — ${title}`, 256));
  if (!breakdown?.available) {
    return embed.setDescription('The stored score details are unavailable for this historical result.');
  }
  const integrity = breakdown.integrity === 'mismatch' ? '\n⚠️ Stored total does not match its detail rows. Contact an admin.' : '';
  embed.setDescription(limitDiscordText(`Total: **${breakdown.total}**\nBonus: **${breakdown.bonus}**${integrity}`, 4096));
  const fields = breakdown.rows.slice(0, 20).map((row, index) => scoreBreakdownField(row, index, breakdown.kind));
  if (fields.length) embed.addFields(fields);
  return embed;
}

export function buildProfileDetailsComponents(profile, seasonYear, targetUserId, ownerId) {
  const options = [];
  if (profile.season?.score != null) {
    options.push(
      new StringSelectMenuOptionBuilder()
        .setLabel('Season result')
        .setDescription(`Score: ${Number(profile.season.score).toLocaleString()}`)
        .setValue('season'),
    );
  }
  for (const week of profile.weekly.filter((row) => row.score != null).slice(-5).reverse()) {
    options.push(
      new StringSelectMenuOptionBuilder()
        .setLabel(limitDiscordText(week.label || week.week_key, 100))
        .setDescription(limitDiscordText(`Score: ${Number(week.score).toLocaleString()}`, 100))
        .setValue(`week:${week.week_key}`),
    );
  }
  if (!options.length) return [];
  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`ewc_predict:pd:${seasonYear}:${targetUserId}:${ownerId}`)
        .setPlaceholder('View scored result details')
        .addOptions(options.slice(0, 25)),
    ),
  ];
}

function leaderboardLines(rows) {
  if (!rows.length) return 'No scored predictions yet.';
  return rows
    .map((row) => `**${row.rank}.** <@${row.user_id}> — \`${Number(row.score || 0).toLocaleString()}\``)
    .join('\n');
}

// custom_id: "ewc_predict:<action>:<type>:<season>:<week|->:<page>" — parsed by the interaction
// router (first segment = command name) and by handleComponent/handleModal below.
const lbId = (action, type, season, week, page, ownerId) =>
  `ewc_predict:${action}:${type}:${season}:${week || '-'}:${page}:${ownerId}`;

// Resolve title + total count + a page fetcher for a leaderboard type. null if the round is gone.
async function leaderboardData(guildId, type, season, week) {
  if (type === 'weekly') {
    const round = await getEwcWeek(guildId, season, week);
    if (!round) return null;
    return {
      title: `EWC Weekly Predictions — ${round.label || round.week_key}`,
      count: await countWeeklyScored(round.id),
      fetch: (limit, offset) => weeklyLeaderboard(round.id, limit, offset),
    };
  }
  if (type === 'season') {
    return {
      title: `EWC ${season} Season Predictions`,
      count: await countSeasonScored(guildId, season),
      fetch: (limit, offset) => seasonLeaderboard(guildId, season, limit, offset),
    };
  }
  const best = (await getEwcSeason(guildId, season))?.best_weeks;
  return {
    title: `EWC ${season} Prediction Leaderboard${best ? ` · best ${best} weeks` : ''}`,
    count: await countOverallScored(guildId, season),
    fetch: (limit, offset) => overallLeaderboard(guildId, season, limit, offset),
  };
}

// Build a leaderboard page: embed + (Prev / Page X/Y / Next) buttons. Buttons only appear when
// there is more than one page. The middle button opens a "go to page" modal.
async function buildLeaderboardPage(guildId, type, season, week, page = 1, ownerId = '') {
  const data = await leaderboardData(guildId, type, season, week);
  if (!data) return null;
  const totalPages = Math.max(1, Math.ceil(data.count / PAGE_SIZE));
  const p = Math.min(Math.max(1, Math.floor(Number(page)) || 1), totalPages);
  const offset = (p - 1) * PAGE_SIZE;
  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(data.title)
    .setDescription(leaderboardLines(await data.fetch(PAGE_SIZE, offset)))
    .setFooter({ text: `Page ${p} / ${totalPages} · ${data.count} ranked` });

  const components = [];
  if (totalPages > 1) {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(lbId('lb', type, season, week, p - 1, ownerId))
          .setLabel('◀ Prev')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(p <= 1),
        new ButtonBuilder()
          .setCustomId(lbId('lbgoto', type, season, week, p, ownerId))
          .setLabel(`Page ${p}/${totalPages}`)
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(lbId('lb', type, season, week, p + 1, ownerId))
          .setLabel('Next ▶')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(p >= totalPages),
      ),
    );
  }
  return { embeds: [embed], components, totalPages, page: p };
}

async function autocompleteWeek(interaction) {
  const q = String(interaction.options.getFocused() || '').toLowerCase();
  const seasonYear = season(interaction);
  const weeks = await listEwcWeeks(interaction.guildId, seasonYear);
  await interaction.respond(
    weeks
      .filter((week) => !q || week.week_key.toLowerCase().includes(q) || String(week.label || '').toLowerCase().includes(q))
      .slice(0, 25)
      .map((week) => ({ name: `${week.label || week.week_key} (${weekChoiceStatus(week)})`.slice(0, 100), value: week.week_key })),
  );
}

function weekChoiceStatus(week) {
  const state = effectiveEwcWeekStatus(week);
  if (state.label === 'opens') return `opens ${formatShortDate(state.at)}`;
  if (state.label === 'partly open') return `open ${state.openGames}/${state.totalGames}`;
  return state.label;
}

export async function autocomplete(interaction) {
  const focused = interaction.options.getFocused(true);
  if (focused.name === 'week') {
    await autocompleteWeek(interaction);
    return;
  }
  await interaction.respond([]);
}

function modalSelectValues(interaction, customId) {
  try {
    return interaction.fields.getStringSelectValues(customId) || [];
  } catch {
    return [];
  }
}

function modalTextValue(interaction, customId) {
  try {
    return interaction.fields.getTextInputValue(customId) || '';
  } catch {
    return '';
  }
}

// Team options for a weekly game pick: the game's actual qualified/participating
// teams (from tracked EWC standings/matches) first, then any EWC Club Championship
// clubs for that game not already listed. Surfaces game-specific qualifiers (e.g.
// Free Fire's EVOS Divine) that are not season-long club members. Optional `query`
// filters for autocomplete. Returns Discord {name, value} options.
async function weeklyGameTeamOptions(game, query = '', { limit = 25 } = {}) {
  const q = normalizeClubName(query);
  const [participants, clubChoices] = await Promise.all([
    ewcGameParticipantTeams(game.game, { eventUrl: game.eventUrl }),
    searchEwcClubChoices(query, { game: game.game, strictGame: true }),
  ]);
  const seen = new Set();
  const out = [];
  for (const value of [...participants, ...clubChoices.map((choice) => choice.value)]) {
    const key = normalizeClubName(value);
    if (!key || seen.has(key) || (q && !key.includes(q))) continue;
    seen.add(key);
    out.push({ name: value.slice(0, 100), value: value.slice(0, 100) });
    if (out.length >= limit) break;
  }
  return out;
}

function weeklySelectedValues(interaction) {
  return ['club', 'club_2', 'club_3', 'club_4'].flatMap((customId) => modalSelectValues(interaction, customId));
}

async function showWeeklyPickModal(interaction, { seasonYear, weekKey, gameKey, page, ownerId }) {
  if (ownerId && interaction.user.id !== ownerId) {
    await interaction.reply({
      content: 'These buttons belong to whoever ran `/ewc_predict weekly`.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const round = await getEwcWeek(interaction.guildId, seasonYear, weekKey);
  const game = findRoundGame(round, gameKey);
  if (!round || !game) {
    await interaction.reply({ content: '❌ This weekly round changed — rerun `/ewc_predict weekly`.', flags: MessageFlags.Ephemeral });
    return;
  }
  const closed = gameClosedMessage(round, game);
  if (closed) {
    await interaction.reply({ content: `❌ ${closed}`, flags: MessageFlags.Ephemeral });
    return;
  }

  const current = await getExistingGamePick(interaction.guildId, round, interaction.user.id, gameKey);
  const choices = await weeklyGameTeamOptions(game, '', { limit: 100 });
  const modal = new ModalBuilder()
    .setCustomId(weeklyPickModalId(seasonYear, weekKey, gameKey, page, interaction.user.id))
    .setTitle(`${game.game || 'Game'} pick`.slice(0, 45));

  if (choices.length) {
    const choiceChunks = chunk(choices, 25);
    for (const [index, choiceChunk] of choiceChunks.entries()) {
      const start = index * 25 + 1;
      const end = start + choiceChunk.length - 1;
      const select = new StringSelectMenuBuilder()
        .setCustomId(index === 0 ? 'club' : `club_${index + 1}`)
        .setPlaceholder(choiceChunks.length > 1 ? `Choose a pick (${start}-${end})` : 'Choose a pick')
        .setRequired(false)
        .addOptions(
          choiceChunk.map((choice) => new StringSelectMenuOptionBuilder().setLabel(choice.value.slice(0, 100)).setValue(choice.value.slice(0, 100))),
        );
      modal.addLabelComponents(
        new LabelBuilder()
          .setLabel(choiceChunks.length > 1 ? `Pick ${start}-${end}` : 'Pick')
          .setDescription(`${index === 0 && current?.pick ? `Current pick: ${current.pick}. ` : ''}Use the manual field if your pick is not listed.`.slice(0, 100))
          .setStringSelectMenuComponent(select),
      );
    }
  }

  const input = new TextInputBuilder()
    .setCustomId('club_text')
    .setStyle(TextInputStyle.Short)
    .setRequired(!choices.length)
    .setMaxLength(100)
    .setPlaceholder('GO1');
  modal.addLabelComponents(
    new LabelBuilder()
      .setLabel(choices.length ? 'Manual pick' : 'Pick')
      .setDescription(choices.length ? 'Optional. This overrides the select menu.' : 'Type the official pick name.')
      .setTextInputComponent(input),
  );

  await interaction.showModal(modal);
}

async function handleWeeklyPickModal(interaction, { seasonYear, weekKey, gameKey, page, ownerId }) {
  if (ownerId && interaction.user.id !== ownerId) {
    await interaction.reply({
      content: 'This modal belongs to whoever opened the weekly picker.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // The modal was opened from a button on the (ephemeral) picker message, so defer as an update
  // and edit that message in place; errors surface as a separate ephemeral follow-up.
  const submittedAt = interactionSubmittedAt(interaction);
  await interaction.deferUpdate();
  const round = await getEwcWeek(interaction.guildId, seasonYear, weekKey);
  const game = findRoundGame(round, gameKey);
  if (!round || !game) {
    await interaction.followUp({ content: '❌ This weekly round changed — rerun `/ewc_predict weekly`.', flags: MessageFlags.Ephemeral });
    return;
  }
  const closed = gameClosedMessage(round, game);
  if (closed) {
    await interaction.followUp({ content: `❌ ${closed}`, flags: MessageFlags.Ephemeral });
    return;
  }

  const manual = modalTextValue(interaction, 'club_text').replace(/\s+/g, ' ').trim();
  const selection = weeklyModalSelection({ manual, selections: weeklySelectedValues(interaction) });
  if (selection.kind === 'empty') {
    await interaction.followUp({ content: '❌ Choose a club from the list or type one manually.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (selection.kind === 'ambiguous') {
    await interaction.followUp({ content: '❌ Choose only one club or type your pick manually.', flags: MessageFlags.Ephemeral });
    return;
  }
  const rawPick = selection.pick;

  const write = await submitWeeklyGamePick({
    guildId: interaction.guildId,
    season: seasonYear,
    userId: interaction.user.id,
    weekKey,
    gameKey,
    rawPick,
    submittedAt,
  });
  if (!write.ok) {
    await interaction.followUp({ content: `❌ ${write.message}`, flags: MessageFlags.Ephemeral });
    return;
  }
  const saved = write.prediction;

  // Re-render the picker in place so the new pick shows in line with its game.
  const payload = await weeklyPickPayload(
    interaction.guildId,
    seasonYear,
    weekKey,
    interaction.user.id,
    weeklyPickerPageForGame(round.games, gameKey),
  );
  if (payload.error) {
    await interaction.followUp({ content: `❌ ${payload.error}`, flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.editReply({ components: payload.components });
  if (saved.firstPick) {
    await announceWeeklyParticipation(interaction, write.round);
    void refreshLinkedProfileAfterFirstWeeklyPick({
      firstPick: true,
      discordUserId: interaction.user.id,
      guildId: interaction.guildId,
      season: seasonYear,
    });
  }
}

async function showSeasonSlotModal(interaction, { seasonYear, index, ownerId }) {
  if (ownerId && interaction.user.id !== ownerId) {
    await interaction.reply({
      content: 'These buttons belong to whoever ran `/ewc_predict season`.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const round = await getEwcSeason(interaction.guildId, seasonYear);
  const closed = roundClosedMessage(round);
  if (closed) {
    await interaction.reply({ content: `❌ ${closed}`, flags: MessageFlags.Ephemeral });
    return;
  }

  const slot = Number(index);
  const saved = await getSeasonPrediction(interaction.guildId, seasonYear, interaction.user.id);
  const picks = saved?.picks || [];
  if (seasonSlotState(picks, slot) === 'locked') {
    const filled = picks.filter((p) => typeof p === 'string' && p.trim()).length;
    await interaction.reply({
      content: `❌ Set Pick #${filled + 1} first — season picks fill in order.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const current = picks[slot] || null;
  const choices = await searchEwcClubChoices('', {});
  const modal = new ModalBuilder()
    .setCustomId(seasonSlotModalId(seasonYear, slot, interaction.user.id))
    .setTitle(`Season pick #${slot + 1}`.slice(0, 45));

  if (choices.length) {
    const select = new StringSelectMenuBuilder()
      .setCustomId('club')
      .setPlaceholder('Choose a club')
      .setRequired(false)
      .addOptions(
        choices.map((choice) => {
          const option = new StringSelectMenuOptionBuilder().setLabel(choice.value.slice(0, 100)).setValue(choice.value.slice(0, 100));
          if (current === choice.value) option.setDefault(true);
          return option;
        }),
      );
    modal.addLabelComponents(
      new LabelBuilder()
        .setLabel('Club pick')
        .setDescription('Use the manual field if your club is not listed.')
        .setStringSelectMenuComponent(select),
    );
  }

  const input = new TextInputBuilder()
    .setCustomId('club_text')
    .setStyle(TextInputStyle.Short)
    .setRequired(!choices.length)
    .setMaxLength(100)
    .setPlaceholder('Team Falcons');
  if (current && !choices.some((choice) => choice.value === current)) input.setValue(current.slice(0, 100));

  modal.addLabelComponents(
    new LabelBuilder()
      .setLabel(choices.length ? 'Manual club name' : 'Club name')
      .setDescription(choices.length ? 'Optional. This overrides the select menu.' : 'Type the official club name.')
      .setTextInputComponent(input),
  );

  await interaction.showModal(modal);
}

async function handleSeasonSlotModal(interaction, { seasonYear, index, ownerId }) {
  if (ownerId && interaction.user.id !== ownerId) {
    await interaction.reply({
      content: 'This modal belongs to whoever opened the season picker.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // The modal was opened from a button on the (ephemeral) picker message, so defer as an update
  // and edit that message in place; errors surface as a separate ephemeral follow-up.
  const submittedAt = interactionSubmittedAt(interaction);
  await interaction.deferUpdate();
  const round = await getEwcSeason(interaction.guildId, seasonYear);
  const closed = roundClosedMessage(round);
  if (closed) {
    await interaction.followUp({ content: `❌ ${closed}`, flags: MessageFlags.Ephemeral });
    return;
  }

  const slot = Number(index);
  const manual = modalTextValue(interaction, 'club_text').replace(/\s+/g, ' ').trim();
  const selected = modalSelectValues(interaction, 'club')[0] || '';
  const rawPick = manual || selected;
  if (!rawPick) {
    await interaction.followUp({ content: '❌ Choose a club from the list or type one manually.', flags: MessageFlags.Ephemeral });
    return;
  }

  const write = await submitSeasonSlot({
    guildId: interaction.guildId,
    season: seasonYear,
    userId: interaction.user.id,
    index: slot,
    rawPick,
    submittedAt,
  });
  if (!write.ok) {
    await interaction.followUp({ content: `❌ ${write.message}`, flags: MessageFlags.Ephemeral });
    return;
  }
  const saved = write.prediction;

  // Re-render the picker in place so the new pick shows in line with its slot.
  const payload = await seasonPickPayload(interaction.guildId, seasonYear, interaction.user.id);
  if (payload.error) {
    await interaction.followUp({ content: `❌ ${payload.error}`, flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.editReply({ components: payload.components });
  if (saved.firstPick) await announceSeasonParticipation(interaction, write.round, seasonYear);
}

// Publicly note (once per member) that someone joined the season predictions,
// without revealing their picks — the picker itself stays ephemeral.
function announceSeasonParticipation(interaction, round, seasonYear) {
  refreshPredictionBoard(interaction);
  return announceEwcParticipation(
    interaction.client,
    interaction.guildId,
    `🎯 <@${interaction.user.id}> locked in their **${round.label || `EWC ${seasonYear}`}** season predictions! 🔒`,
    { channelId: interaction.channelId },
  );
}

// Publicly note (once per member per week) that someone joined this week's
// predictions, without revealing their picks — the picker itself stays ephemeral.
function announceWeeklyParticipation(interaction, round) {
  refreshPredictionBoard(interaction);
  return announceEwcParticipation(
    interaction.client,
    interaction.guildId,
    `🎯 <@${interaction.user.id}> started picks for **${round.label || round.week_key}**. Picks stay secret until each game locks. 🔒`,
    { channelId: interaction.channelId },
  );
}

// Refresh the public leaderboard's "Predicting now" list. Fire-and-forget: the
// canvas re-render + Discord edit must never block or fail the pick interaction.
function refreshPredictionBoard(interaction) {
  void updateEwcPredictionLeaderboard(interaction.client, interaction.guildId).catch(() => {});
}

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const seasonYear = season(interaction);

  if (sub === 'weekly') {
    let weekKey = interaction.options.getString('week');
    if (!weekKey) {
      const current = await currentOpenWeek(interaction.guildId, seasonYear);
      if (!current) {
        await interaction.reply({ content: '❌ No EWC week is open for predictions right now.', flags: MessageFlags.Ephemeral });
        return;
      }
      weekKey = current.week_key;
    }
    const payload = await weeklyPickPayload(interaction.guildId, seasonYear, weekKey, interaction.user.id);
    if (payload.error) {
      await interaction.reply({ content: `❌ ${payload.error}`, flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.reply({
      components: payload.components,
      flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    });
    return;
  }

  if (sub === 'season') {
    const payload = await seasonPickPayload(interaction.guildId, seasonYear, interaction.user.id);
    if (payload.error) {
      await interaction.reply({ content: `❌ ${payload.error}`, flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.reply({
      components: payload.components,
      flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    });
    return;
  }

  if (sub === 'leaderboard') {
    const type = interaction.options.getString('type', true);
    const page = interaction.options.getInteger('page') || 1;
    let week = null;
    if (type === 'weekly') {
      week = interaction.options.getString('week');
      if (!week) {
        await interaction.reply({ content: '❌ Choose a `week` for the weekly leaderboard.', flags: MessageFlags.Ephemeral });
        return;
      }
      if (!(await getEwcWeek(interaction.guildId, seasonYear, week))) {
        await interaction.reply({ content: `❌ Week \`${week}\` does not exist.`, flags: MessageFlags.Ephemeral });
        return;
      }
    }
    const payload = await buildLeaderboardPage(interaction.guildId, type, seasonYear, week, page, interaction.user.id);
    await interaction.reply({ embeds: payload.embeds, components: payload.components });
    return;
  }

  if (sub === 'profile') {
    const user = interaction.options.getUser('member') || interaction.user;
    const isOwner = user.id === interaction.user.id;
    const seasonRound = await getEwcSeason(interaction.guildId, seasonYear);
    const profile = await userPredictionProfile(interaction.guildId, seasonYear, user.id);
    const weekly = profile.weekly
      .filter((row) => row.picks?.length || row.score != null)
      .slice(-5)
      .map((row) => `• **${row.label || row.week_key}** — ${summarizeWeeklyPicks(row, { isOwner })}${row.score != null ? ` — \`${row.score}\`` : ''}`);
    const showSeasonPicks = isOwner || seasonPicksVisible(seasonRound, profile.season?.score);
    const seasonPicks = profile.season?.picks?.length
      ? showSeasonPicks
        ? profile.season.picks.join(', ')
        : HIDDEN_SEASON_SUMMARY
      : 'No season picks yet.';
    const seasonValue = `${seasonPicks}${profile.season?.score != null ? ` — \`${profile.season.score}\`` : ''}`;
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setAuthor({ name: `${user.globalName || user.username} — EWC Prediction Profile`, iconURL: user.displayAvatarURL() })
          .addFields(
            { name: 'Season picks', value: seasonValue.slice(0, 1024) },
            { name: 'Recent weekly picks', value: (weekly.length ? weekly.join('\n') : 'No weekly picks yet.').slice(0, 1024) },
          ),
      ],
      components: buildProfileDetailsComponents(profile, seasonYear, user.id, interaction.user.id),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'share') {
    // Self-only by design: a member shares their OWN picks (their choice), so this is allowed
    // even during the hidden period — it never exposes anyone else's hidden predictions.
    const lang = interaction.options.getString('language') === 'ar' ? 'ar' : 'en';
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const profile = await userPredictionProfile(interaction.guildId, seasonYear, interaction.user.id);
    const seasonPicks = (profile.season?.picks || []).filter((p) => typeof p === 'string' && p.trim());
    const weeklyCount = (profile.weekly || []).reduce(
      (n, w) => n + (Array.isArray(w.picks) ? w.picks.filter((p) => p && typeof p === 'object').length : 0),
      0,
    );
    if (!seasonPicks.length && !weeklyCount) {
      await interaction.editReply({
        content:
          lang === 'ar'
            ? '❌ لا توجد لديك توقعات لمشاركتها بعد — استخدم `/ewc_predict season` أو `weekly` أولاً.'
            : '❌ You have no predictions to share yet — make some with `/ewc_predict season` or `weekly` first.',
      });
      return;
    }
    let avatar = null;
    try {
      const res = await fetch(interaction.user.displayAvatarURL({ extension: 'png', size: 256, forceStatic: true }));
      if (res.ok) avatar = Buffer.from(await res.arrayBuffer());
    } catch {
      /* placeholder initials drawn instead */
    }
    let qr = null;
    try {
      qr = await getShareQr();
    } catch {
      /* QR placeholder drawn instead */
    }
    const png = await renderEwcShareCard({
      displayName: interaction.user.globalName || interaction.user.username,
      avatar,
      qr,
      seasonPicks,
      weeklyCount,
      season: seasonYear,
      communityName: interaction.guild?.name || 'Esports Community',
      discordUrl: SHARE_DISCORD_URL,
      locale: lang,
    });
    const file = new AttachmentBuilder(png, { name: `ewc-${seasonYear}-predictions.png` });
    const tweet =
      lang === 'ar'
        ? `سجّلت توقعاتي لـ EWC ${seasonYear}! 🏆 انضم إلى مجتمعنا وشارك بتوقعاتك 👉 ${SHARE_DISCORD_URL}`
        : `I locked in my EWC ${seasonYear} predictions! 🏆 Join the community and make yours 👉 ${SHARE_DISCORD_URL}`;
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel(lang === 'ar' ? 'انشر على X 🐦' : 'Share on X 🐦')
        .setURL(`https://twitter.com/intent/tweet?text=${encodeURIComponent(tweet)}`),
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel(lang === 'ar' ? 'رابط الدعوة' : 'Discord invite')
        .setURL(SHARE_DISCORD_URL),
    );
    await interaction.editReply({
      content:
        lang === 'ar'
          ? '📸 احفظ الصورة، ثم اضغط «انشر على X» وأرفقها في تغريدتك.'
          : '📸 Save the image, then tap **Share on X** and attach it to your tweet.',
      files: [file],
      components: [row],
    });
    return;
  }

  if (sub === 'guide') {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle('دليل توقّعات كأس العالم للرياضات الإلكترونية')
          .setDescription(
            '**العربية**\n' +
              '**الفكرة:** النظام فيه توقّعات أسبوعية لكل لعبة، وتوقّع للموسم الكامل. الهدف أنك تتوقع الأندية التي ستحقق أفضل نتائج في بطولات EWC.\n\n' +
              '**الأسبوعي:** استخدم `/ewc_predict weekly` واختر الأسبوع، اللعبة، والنادي. لكل لعبة اختيار ووقت قفل مستقل. تقدر تغيّر اختيارك قبل وقت القفل فقط، وتعديل لعبة واحدة لا يغيّر باقي اختياراتك.\n\n' +
              '**النقاط:** المركز الأول 1000، الثاني 750، الثالث 500، الرابع 300، الخامس 200، السادس 150، السابع 100، والثامن 50. إذا كان اختيارك خارج التوب 8 لا تحصل على نقاط لتلك اللعبة. إذا أصبت أبطال كل ألعاب الأسبوع تحصل على مكافأة إضافية.\n\n' +
              '**الألعاب الممتدة:** إذا امتدت بطولة لعبة لأكثر من أسبوع، تُحسب في الأسبوع الذي تنتهي فيه، لكن توقّعها يُقفل قبل بداية منافستها.\n\n' +
              '**الموسم الكامل:** استخدم `/ewc_predict season` لاختيار أفضل الأندية للموسم كاملًا. يفتح افتراضيًا قبل أول منافسة بـ 14 يومًا، ويغلق قبل أول منافسة بـ 8 ساعات. بعد الإغلاق لا يمكن التعديل. تُحسب نقاط الموسم بعد نهاية EWC حسب الترتيب النهائي للأندية، مع مكافأة للتوقعات المطابقة للمركز الصحيح.\n\n' +
              '**الترتيب:** `/ewc_predict leaderboard` للترتيب، `/ewc_predict profile` لتوقعاتك ونتائجك، و`/ewc_predict teams` للبحث عن الأندية. الترتيب العام يجمع نقاط الأسابيع والموسم، وقد يحسب كل الأسابيع أو أفضل عدد محدد منها حسب إعدادات الإدارة.\n\n' +
              '**English**\n' +
              '**Idea:** The system has weekly per-game predictions and one full-season prediction. The goal is to predict which clubs will perform best across EWC.\n\n' +
              '**Weekly:** Use `/ewc_predict weekly` and choose the week. The bot opens a private game menu; choose a game button, then pick a club from the modal select menu or type the club manually. Each game has its own pick and lock time. You can change that game pick only before it locks, and changing one game does not affect your other picks.\n\n' +
              '**Scoring:** 1st place gives 1000 points, 2nd 750, 3rd 500, 4th 300, 5th 200, 6th 150, 7th 100, and 8th 50. A pick outside top 8 scores 0 for that game. Picking every weekly game winner gives an extra bonus.\n\n' +
              '**Multi-week events:** If a game event spans multiple weeks, it scores in the week where the event ends, but its prediction locks before that game event starts.\n\n' +
              '**Season:** Use `/ewc_predict season` to pick your top clubs for the whole season. By default, it opens 14 days before the first EWC competition and closes 8 hours before it. After closing, picks cannot be changed. Season points are scored after EWC ends using the final club standings, with bonuses for exact rank predictions.\n\n' +
              '**Commands:** `/ewc_predict leaderboard` shows rankings, `/ewc_predict profile` shows your picks and results, and `/ewc_predict teams` searches participating clubs. The overall leaderboard combines weekly and season points; admins may count all weeks or only your best N weeks.',
          ),
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle('اربط عرض EWC على ملفك في ديسكورد / Link your EWC showcase')
          .setDescription(
            '**العربية**\n' +
              '**ما هو العرض؟** عرض EWC الخاص بك هو ترتيبك ونقاطك وانتصاراتك الأسبوعية معروضة على ملفك في ديسكورد كرتبة مرتبطة، فيراها الجميع دون فتح اللوحة.\n\n' +
              '**كيف تربطه؟** استخدم `/ewc_predict link`، ثم اضغط **Open my dashboard** وسجّل الدخول بنفس حساب ديسكورد. يتم الربط تلقائيًا — لا حاجة لإعداد إضافي.\n\n' +
              '**التحديث والإزالة:** اضغط زر **التحديث** في اللوحة (أو استخدم `/ewc_predict sync`) لتحديث الإحصاءات المعروضة، واستخدم `/ewc_predict unlink` لإزالة الربط في أي وقت.\n\n' +
              '**English**\n' +
              '**What it is:** Your EWC showcase is your EWC rank, points and weekly wins displayed on your Discord profile as a linked role, so everyone sees them without opening the dashboard.\n\n' +
              '**How to link:** Run `/ewc_predict link`, then tap **Open my dashboard** and sign in with the same Discord account. It links automatically — no extra setup.\n\n' +
              '**Update & remove:** Tap **Refresh** on the dashboard (or use `/ewc_predict sync`) to update the stats shown, and use `/ewc_predict unlink` to remove the link anytime.',
          ),
      ],
    });
    return;
  }

  if (sub === 'teams') {
    const query = interaction.options.getString('query') || '';
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const choices = await searchEwcClubChoices(query, { wait: true });
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle(`EWC Clubs${query ? ` — “${query}”` : ''}`)
          .setDescription(
            (choices.length ? choices.map((c) => `• ${c.name}`).join('\n') : 'No EWC clubs matched that search.').slice(0, 4000),
          ),
      ],
    });
    return;
  }

  if (sub === 'link') {
    const url = dashboardProfileUrl(interaction, seasonYear);
    if (!url) {
      await interaction.reply({
        content: 'Dashboard public URL is not configured yet.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle('اربط عرض EWC الخاص بك / Link your EWC showcase')
          .setDescription(
            '**العربية**\n' +
              '**ماذا تحصل؟** يظهر ترتيبك ونقاطك وانتصاراتك الأسبوعية في EWC على ملفك في ديسكورد (رتبة مرتبطة) ليراها الجميع.\n\n' +
              '**الخطوات:**\n' +
              '1. اضغط **Open my dashboard**.\n' +
              '2. سجّل الدخول بنفس حساب ديسكورد.\n' +
              '3. خلاص — يتم الربط تلقائيًا. اضغط زر **التحديث** في اللوحة في أي وقت لتحديث إحصاءاتك.\n\n' +
              '**English**\n' +
              '**What you get:** Your EWC rank, points and weekly wins show on your Discord profile (a linked role) for everyone to see.\n\n' +
              '**Steps:**\n' +
              '1. Tap **Open my dashboard**.\n' +
              '2. Sign in with the same Discord account.\n' +
              '3. Done — it links automatically. Tap **Refresh** on the dashboard anytime to update your stats.',
          ),
      ],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(url).setLabel('Open my dashboard'),
          new ButtonBuilder()
            .setStyle(ButtonStyle.Link)
            .setURL(`${dashboardPublicUrl()}/leaderboard/${interaction.guildId}/${seasonYear}`)
            .setLabel('Public leaderboard'),
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'sync') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await dashboardInternalRequest('/api/internal/ewc-profile/sync', {
      discordUserId: interaction.user.id,
      guildId: interaction.guildId,
      season: seasonYear,
    });
    await interaction.editReply('Your Discord profile showcase has been synced.');
    return;
  }

  if (sub === 'unlink') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await dashboardInternalRequest('/api/internal/ewc-profile/unlink', {
      discordUserId: interaction.user.id,
    });
    await interaction.editReply('Your EWC profile showcase link has been removed.');
    return;
  }
}

// --- Leaderboard pagination (routed here via the "ewc_predict:" custom_id prefix) ---
export async function handleComponent(interaction) {
  const parts = interaction.customId.split(':');
  const action = parts[1];
  if (action === 'wg') {
    const [, , seasonYear, weekKey, gameKey, page, ownerId] = parts;
    await showWeeklyPickModal(interaction, { seasonYear, weekKey, gameKey, page, ownerId });
    return;
  }
  if (action === 'sg') {
    const [, , seasonYear, index, ownerId] = parts;
    await showSeasonSlotModal(interaction, { seasonYear, index, ownerId });
    return;
  }
  if (action === 'ww') {
    const [, , seasonYear, ownerId] = parts;
    if (ownerId && interaction.user.id !== ownerId) {
      await interaction.reply({
        content: 'This week selector belongs to whoever opened the weekly picker.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const weekKey = interaction.values?.[0];
    if (!weekKey) {
      await interaction.reply({ content: 'Choose a week first.', flags: MessageFlags.Ephemeral });
      return;
    }
    const payload = await weeklyPickPayload(interaction.guildId, seasonYear, weekKey, interaction.user.id);
    if (payload.error) {
      await interaction.reply({ content: `❌ ${payload.error}`, flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.update({ components: payload.components });
    return;
  }
  if (action === 'wp') {
    const [, , seasonYear, weekKey, page, ownerId] = parts;
    if (ownerId && interaction.user.id !== ownerId) {
      await interaction.reply({
        content: 'These page controls belong to whoever opened the weekly picker.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const payload = await weeklyPickPayload(interaction.guildId, seasonYear, weekKey, interaction.user.id, Number(page) || 0);
    if (payload.error) {
      await interaction.reply({ content: `❌ ${payload.error}`, flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.update({ components: payload.components });
    return;
  }
  if (action === 'pd') {
    const [, , seasonYear, targetUserId, ownerId] = parts;
    if (!ownerId || interaction.user.id !== ownerId) {
      await interaction.reply({
        content: 'These score details belong to whoever opened the prediction profile.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const selected = interaction.values?.[0];
    const profile = await userPredictionProfile(interaction.guildId, seasonYear, targetUserId);
    const seasonDetails = selected === 'season' ? projectSeasonScoreBreakdown(profile.season) : null;
    const weekKey = typeof selected === 'string' && selected.startsWith('week:') ? selected.slice(5) : null;
    const week = weekKey ? profile.weekly.find((row) => row.week_key === weekKey) : null;
    const weeklyDetails = week ? projectWeeklyScoreBreakdown(week) : null;
    const breakdown = seasonDetails || weeklyDetails;
    if (!breakdown) {
      await interaction.reply({ content: 'That scored result is no longer available.', flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.reply({
      embeds: [buildScoreBreakdownEmbed(week?.label || (selected === 'season' ? `EWC ${seasonYear} season` : 'Prediction result'), breakdown)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === 'open') {
    const seasonYear = parts[2] || DEFAULT_SEASON;
    const current = await currentOpenWeek(interaction.guildId, seasonYear);
    if (current) {
      const payload = await weeklyPickPayload(interaction.guildId, seasonYear, current.week_key, interaction.user.id);
      if (payload.error) {
        await interaction.reply({ content: `❌ ${payload.error}`, flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.reply({ components: payload.components, flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
      return;
    }
    // No weekly week is open yet — offer the season picker if that round is open.
    const seasonPayload = await seasonPickPayload(interaction.guildId, seasonYear, interaction.user.id);
    if (!seasonPayload.error) {
      await interaction.reply({ components: seasonPayload.components, flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
      return;
    }
    await interaction.reply({ content: '❌ Nothing is open for EWC predictions right now.', flags: MessageFlags.Ephemeral });
    return;
  }

  const [, , type, season, weekRaw, pageRaw, ownerId] = parts;
  const week = weekRaw === '-' ? null : weekRaw;

  // Only the member who ran /ewc_predict leaderboard can drive its buttons.
  if (ownerId && interaction.user.id !== ownerId) {
    await interaction.reply({
      content: 'These buttons belong to whoever ran the command — use `/ewc_predict leaderboard` to get your own.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === 'lbgoto') {
    const data = await leaderboardData(interaction.guildId, type, season, week);
    const totalPages = data ? Math.max(1, Math.ceil(data.count / PAGE_SIZE)) : 1;
    const modal = new ModalBuilder()
      .setCustomId(`ewc_predict:lbmodal:${type}:${season}:${week || '-'}:${ownerId}`)
      .setTitle(`Go to page (1-${totalPages})`)
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('page')
            .setLabel(`Page number (1-${totalPages})`)
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(6)
            .setPlaceholder(String(pageRaw || 1)),
        ),
      );
    await interaction.showModal(modal);
    return;
  }

  // action === 'lb' → jump to the page baked into the button's custom_id.
  const payload = await buildLeaderboardPage(interaction.guildId, type, season, week, Number(pageRaw) || 1, ownerId);
  if (!payload) {
    await interaction.deferUpdate().catch(() => {});
    return;
  }
  await interaction.update({ embeds: payload.embeds, components: payload.components });
}

export async function handleModal(interaction) {
  const parts = interaction.customId.split(':');
  const action = parts[1];
  if (action === 'wpm') {
    const [, , seasonYear, weekKey, gameKey, page, ownerId] = parts;
    await handleWeeklyPickModal(interaction, { seasonYear, weekKey, gameKey, page, ownerId });
    return;
  }
  if (action === 'spm') {
    const [, , seasonYear, index, ownerId] = parts;
    await handleSeasonSlotModal(interaction, { seasonYear, index, ownerId });
    return;
  }

  const [, , type, season, weekRaw, ownerId] = parts;
  const week = weekRaw === '-' ? null : weekRaw;
  const requested = parseInt(interaction.fields.getTextInputValue('page'), 10);
  const payload = await buildLeaderboardPage(
    interaction.guildId,
    type,
    season,
    week,
    Number.isFinite(requested) ? requested : 1,
    ownerId,
  );
  if (!payload) {
    await interaction.reply({ content: 'That leaderboard is no longer available.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (interaction.isFromMessage()) {
    await interaction.update({ embeds: payload.embeds, components: payload.components });
  } else {
    await interaction.reply({ embeds: payload.embeds, components: payload.components });
  }
}
