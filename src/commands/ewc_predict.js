import {
  SlashCommandBuilder,
  InteractionContextType,
  MessageFlags,
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
  getWeeklyPrediction,
  listEwcWeeks,
  overallLeaderboard,
  seasonLeaderboard,
  upsertSeasonPrediction,
  upsertWeeklyGamePick,
  userPredictionProfile,
  weeklyLeaderboard,
} from '../db/ewcPredictions.js';
import { effectiveEwcWeekStatus, formatShortDate, formatTimestamp, uniqueClubPicks } from '../lib/ewcPredictions.js';
import { resolveEwcClubPick, searchEwcClubChoices } from '../lib/ewcClubCache.js';
import { announceEwcParticipation } from '../lib/ewcParticipation.js';
import { updateEwcPredictionLeaderboard } from '../jobs/ewcPredictions.js';

const DEFAULT_SEASON = '2026';
const PAGE_SIZE = 20;
const WEEKLY_PICK_PAGE_SIZE = 25;

function addTeamOption(command, index, required) {
  return command.addStringOption((o) =>
    o
      .setName(`team_${index}`)
      .setDescription(`Club pick #${index}`)
      .setAutocomplete(true)
      .setRequired(required),
  );
}

let builder = new SlashCommandBuilder()
  .setName('ewc_predict')
  .setDescription('Submit EWC predictions and view prediction leaderboards.')
  .addSubcommand((s) =>
    s
      .setName('weekly')
      .setDescription('Open the guided weekly EWC pick menu.')
      .addStringOption((o) => o.setName('week').setDescription('Week key').setAutocomplete(true).setRequired(true))
      .addStringOption((o) => o.setName('season').setDescription('Season year').setRequired(false)),
  );

function seasonCommand(s) {
  let cmd = s.setName('season').setDescription('Pick your top 5-10 clubs for the whole EWC season.');
  for (let i = 1; i <= 10; i += 1) cmd = addTeamOption(cmd, i, i <= 5);
  return cmd.addStringOption((o) => o.setName('season').setDescription('Season year').setRequired(false));
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
      .addIntegerOption((o) => o.setName('page').setDescription('Page number').setMinValue(1))
      .addStringOption((o) => o.setName('season').setDescription('Season year').setRequired(false)),
  )
  .addSubcommand((s) =>
    s
      .setName('profile')
      .setDescription('Show your EWC prediction profile.')
      .addUserOption((o) => o.setName('member').setDescription('Member to inspect'))
      .addStringOption((o) => o.setName('season').setDescription('Season year').setRequired(false)),
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
      .setDescription('Connect your Discord profile showcase on the EWC dashboard.')
      .addStringOption((o) => o.setName('season').setDescription('Season year').setRequired(false)),
  )
  .addSubcommand((s) =>
    s
      .setName('sync')
      .setDescription('Re-sync your EWC Discord profile showcase.')
      .addStringOption((o) => o.setName('season').setDescription('Season year').setRequired(false)),
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

function season(interaction) {
  return interaction.options.getString('season') || DEFAULT_SEASON;
}

function teamPicks(interaction, max = 10) {
  const picks = [];
  for (let i = 1; i <= max; i += 1) picks.push(interaction.options.getString(`team_${i}`));
  return picks;
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

function formatPicks(picks) {
  return picks.map((pick, index) => `**${index + 1}.** ${pick}`).join('\n');
}

function formatWeeklyGamePicks(round, picks) {
  const byGame = new Map((picks || []).filter((pick) => typeof pick === 'object').map((pick) => [pick.gameKey, pick]));
  const games = round.games || [];
  if (!games.length) return formatPicks(picks || []);
  return games
    .map((game) => {
      const pick = byGame.get(game.key);
      const lock = game.lockAt ? ` - locks ${formatTimestamp(game.lockAt)}` : '';
      return `**${gameLabel(game)}**\n${pick?.pick ? `Pick: **${pick.pick}**` : '_No pick yet_'}${lock}`;
    })
    .join('\n\n');
}

function weeklyGameId(seasonYear, weekKey, gameKey, ownerId) {
  return `ewc_predict:wg:${seasonYear}:${weekKey}:${gameKey}:${ownerId}`;
}

function weeklyPickModalId(seasonYear, weekKey, gameKey, ownerId) {
  return `ewc_predict:wpm:${seasonYear}:${weekKey}:${gameKey}:${ownerId}`;
}

function chunk(items, size) {
  const rows = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

async function weeklyPickPayload(guildId, seasonYear, weekKey, userId) {
  const round = await getEwcWeek(guildId, seasonYear, weekKey);
  if (!round) return { error: 'That prediction round does not exist.' };
  if (!round.games?.length) {
    return { error: 'This is an old aggregate weekly round. Ask an admin to regenerate the official EWC weeks before weekly picks open.' };
  }

  const saved = await getWeeklyPrediction(guildId, round.id, userId);
  const picks = saved?.picks || [];

  // Components V2: one Section per game so its button sits in line with the game,
  // and the message edits in place to show each pick. (V2 messages can't carry an embed.)
  const container = new ContainerBuilder().setAccentColor(0xf1c40f);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## EWC Weekly Picks — ${round.label || round.week_key}\n-# Each game locks independently before it starts. Tap a game to pick or change it.`,
    ),
  );
  // V2 budget is 40 components total; each game uses 3 (section + text + button), so stay well under.
  round.games.slice(0, 12).forEach((game) => {
    const existing = picks.find((p) => p && typeof p === 'object' && p.gameKey === game.key);
    const locked = Boolean(gameClosedMessage(round, game));
    const lockTxt = game.lockAt ? ` · locks ${formatTimestamp(game.lockAt)}` : '';
    const status = locked ? '🔒 Locked' : existing?.pick ? `Pick: **${existing.pick}**` : '*No pick yet*';
    const text = `**${game.game || 'Game'}**${game.event ? ` — ${game.event}` : ''}\n${status}${lockTxt}`;
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(text.slice(0, 4000)))
        .setButtonAccessory(
          new ButtonBuilder()
            .setCustomId(weeklyGameId(seasonYear, round.week_key, game.key, userId))
            .setLabel(locked ? 'Locked' : existing?.pick ? 'Change' : 'Pick')
            .setStyle(locked ? ButtonStyle.Secondary : existing?.pick ? ButtonStyle.Success : ButtonStyle.Primary)
            .setDisabled(locked),
        ),
    );
  });

  return { components: [container] };
}

async function getExistingGamePick(guildId, round, userId, gameKey) {
  const saved = await getWeeklyPrediction(guildId, round.id, userId);
  return (saved?.picks || []).find((pick) => pick && typeof pick === 'object' && pick.gameKey === gameKey) || null;
}

const HIDDEN_PICK_SUMMARY = 'Participated - picks hidden until lock.';
const HIDDEN_SEASON_SUMMARY = 'Participated - picks hidden until the season locks.';

function seasonPicksVisible(round, score = null, now = Math.floor(Date.now() / 1000)) {
  return Boolean(
    score != null ||
      !round ||
      round.status === 'closed' ||
      round.status === 'scored' ||
      (round.close_at && now >= round.close_at)
  );
}

function weeklyPickVisible(row, pick, now = Math.floor(Date.now() / 1000)) {
  if (row.score != null || row.status === 'scored') return true;
  if (pick && typeof pick === 'object') {
    const game = (row.games || []).find((roundGame) => roundGame.key === pick.gameKey);
    return Boolean(game?.lockAt && now >= game.lockAt);
  }
  return Boolean(row.close_at && now >= row.close_at);
}

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

function leaderboardLines(rows, offset = 0) {
  if (!rows.length) return 'No scored predictions yet.';
  return rows
    .map((row, index) => `**${offset + index + 1}.** <@${row.user_id}> — \`${Number(row.score || 0).toLocaleString()}\``)
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
    .setDescription(leaderboardLines(await data.fetch(PAGE_SIZE, offset), offset))
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

async function autocompleteWeeklyGame(interaction) {
  const q = String(interaction.options.getFocused() || '').toLowerCase();
  const seasonYear = season(interaction);
  const weekKey = interaction.options.getString('week');
  const round = weekKey ? await getEwcWeek(interaction.guildId, seasonYear, weekKey) : null;
  const games = round?.games || [];
  await interaction.respond(
    games
      .filter((game) => {
        const hay = `${game.game || ''} ${game.event || ''}`.toLowerCase();
        return !q || hay.includes(q);
      })
      .slice(0, 25)
      .map((game) => ({
        name: `${game.game}${game.event ? ` - ${game.event}` : ''}`.slice(0, 100),
        value: game.key,
      })),
  );
}

export async function autocomplete(interaction) {
  const focused = interaction.options.getFocused(true);
  if (focused.name === 'week') {
    await autocompleteWeek(interaction);
    return;
  }
  if (focused.name === 'game') {
    await autocompleteWeeklyGame(interaction);
    return;
  }
  if (focused.name === 'team') {
    const seasonYear = season(interaction);
    const weekKey = interaction.options.getString('week');
    const gameKey = interaction.options.getString('game');
    const round = weekKey ? await getEwcWeek(interaction.guildId, seasonYear, weekKey) : null;
    const game = gameKey ? findRoundGame(round, gameKey) : null;
    await interaction.respond(await searchEwcClubChoices(focused.value, { game: game?.game }));
    return;
  }
  await interaction.respond(await searchEwcClubChoices(focused.value));
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

async function showWeeklyPickModal(interaction, { seasonYear, weekKey, gameKey, ownerId }) {
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
  const choices = await searchEwcClubChoices('', { game: game.game, strictGame: true });
  const modal = new ModalBuilder()
    .setCustomId(weeklyPickModalId(seasonYear, weekKey, gameKey, interaction.user.id))
    .setTitle(`${game.game || 'Game'} pick`.slice(0, 45));

  if (choices.length) {
    const select = new StringSelectMenuBuilder()
      .setCustomId('club')
      .setPlaceholder('Choose a club')
      .setRequired(false)
      .addOptions(
        choices.map((choice) => {
          const option = new StringSelectMenuOptionBuilder().setLabel(choice.value.slice(0, 100)).setValue(choice.value.slice(0, 100));
          if (current?.pick === choice.value) option.setDefault(true);
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
  if (current?.pick && !choices.some((choice) => choice.value === current.pick)) input.setValue(current.pick.slice(0, 100));

  modal.addLabelComponents(
    new LabelBuilder()
      .setLabel(choices.length ? 'Manual club name' : 'Club name')
      .setDescription(choices.length ? 'Optional. This overrides the select menu.' : 'Type the official club name.')
      .setTextInputComponent(input),
  );

  await interaction.showModal(modal);
}

async function handleWeeklyPickModal(interaction, { seasonYear, weekKey, gameKey, ownerId }) {
  if (ownerId && interaction.user.id !== ownerId) {
    await interaction.reply({
      content: 'This modal belongs to whoever opened the weekly picker.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // The modal was opened from a button on the (ephemeral) picker message, so defer as an update
  // and edit that message in place; errors surface as a separate ephemeral follow-up.
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
  const selected = modalSelectValues(interaction, 'club')[0] || '';
  const rawPick = manual || selected;
  if (!rawPick) {
    await interaction.followUp({ content: '❌ Choose a club from the list or type one manually.', flags: MessageFlags.Ephemeral });
    return;
  }

  const resolved = await resolveEwcClubPick(rawPick, { wait: true, game: game.game, strictGame: true });
  if (!resolved.ok) {
    await interaction.followUp({ content: `❌ ${resolved.message}`, flags: MessageFlags.Ephemeral });
    return;
  }

  const saved = await upsertWeeklyGamePick({
    guildId: interaction.guildId,
    weekId: round.id,
    userId: interaction.user.id,
    gameKey,
    game: game.game,
    event: game.event,
    pick: resolved.name,
  });

  // Re-render the picker in place so the new pick shows in line with its game.
  const payload = await weeklyPickPayload(interaction.guildId, seasonYear, weekKey, interaction.user.id);
  if (payload.error) {
    await interaction.followUp({ content: `❌ ${payload.error}`, flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.editReply({ components: payload.components });
  if (saved.firstPick) await announceWeeklyParticipation(interaction, round);
}

// Publicly note (once per member per week) that someone joined this week's
// predictions, without revealing their picks — the picker itself stays ephemeral.
function announceWeeklyParticipation(interaction, round) {
  refreshPredictionBoard(interaction);
  return announceEwcParticipation(
    interaction.client,
    interaction.guildId,
    `🎯 <@${interaction.user.id}> is in for **${round.label || round.week_key}** — predictions are open! Picks stay secret until lock. 🔒`,
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
    const weekKey = interaction.options.getString('week', true);
    const gameKey = interaction.options.getString('game');
    const pick = interaction.options.getString('team');
    const round = await getEwcWeek(interaction.guildId, seasonYear, weekKey);

    if (!gameKey && !pick) {
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

    if (!gameKey || !pick) {
      await interaction.reply({
        content: '❌ Use `/ewc_predict weekly` with just the week, then choose a game button.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const game = findRoundGame(round, gameKey);
    const closed = round?.games?.length ? gameClosedMessage(round, game) : roundClosedMessage(round);
    if (closed) {
      await interaction.reply({ content: `❌ ${closed}`, flags: MessageFlags.Ephemeral });
      return;
    }
    if (!round.games?.length) {
      await interaction.reply({
        content: '❌ This is an old aggregate weekly round. Ask an admin to regenerate the official EWC weeks before weekly picks open.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const saved = await upsertWeeklyGamePick({
      guildId: interaction.guildId,
      weekId: round.id,
      userId: interaction.user.id,
      gameKey,
      game: game.game,
      event: game.event,
      pick,
    });
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x57f287)
          .setTitle(`✅ ${game.game} pick locked — ${round.label || round.week_key}`)
          .setDescription(formatWeeklyGamePicks(round, saved.picks))
          .setFooter({ text: 'You can rerun this command before a game locks to change only that game pick.' }),
      ],
      flags: MessageFlags.Ephemeral,
    });
    if (saved.firstPick) await announceWeeklyParticipation(interaction, round);
    return;
  }

  if (sub === 'season') {
    const round = await getEwcSeason(interaction.guildId, seasonYear);
    const closed = roundClosedMessage(round);
    if (closed) {
      await interaction.reply({ content: `❌ ${closed}`, flags: MessageFlags.Ephemeral });
      return;
    }
    const picks = uniqueClubPicks(teamPicks(interaction, 10));
    if (picks.length !== round.top_size) {
      await interaction.reply({
        content: `❌ This season round needs exactly **${round.top_size}** different club picks.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const saved = await upsertSeasonPrediction({ guildId: interaction.guildId, season: seasonYear, userId: interaction.user.id, picks });
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x57f287)
          .setTitle(`✅ Season picks locked — ${round.label || `EWC ${seasonYear}`}`)
          .setDescription(formatPicks(picks)),
      ],
      flags: MessageFlags.Ephemeral,
    });
    if (saved.firstPick) {
      refreshPredictionBoard(interaction);
      await announceEwcParticipation(
        interaction.client,
        interaction.guildId,
        `🎯 <@${interaction.user.id}> locked in their **${round.label || `EWC ${seasonYear}`}** season predictions! 🔒`,
        { channelId: interaction.channelId },
      );
    }
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
      flags: MessageFlags.Ephemeral,
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
    const [, , seasonYear, weekKey, gameKey, ownerId] = parts;
    await showWeeklyPickModal(interaction, { seasonYear, weekKey, gameKey, ownerId });
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
    const [, , seasonYear, weekKey, gameKey, ownerId] = parts;
    await handleWeeklyPickModal(interaction, { seasonYear, weekKey, gameKey, ownerId });
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
