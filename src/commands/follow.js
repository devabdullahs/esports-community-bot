import { InteractionContextType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { config } from '../config.js';
import { getMatchesForGuild } from '../db/matches.js';
import { getPlayerById, listPlayers } from '../db/players.js';
import { getTeamById, listTeams } from '../db/teams.js';
import { getTournamentById, searchActiveTournaments } from '../db/tournaments.js';
import { deleteFollow, getFollow, listFollowsForUser, upsertFollow } from '../db/userFollows.js';
import { buildFollowListPayload, followCopy, safeDiscordText } from '../lib/followComponents.js';
import { gameName, getGame, normalizeGameSlug, searchGames } from '../lib/games.js';
import { isLobbyMatch, normalizeTeamName } from '../lib/render.js';

export const data = new SlashCommandBuilder()
  .setName('follow')
  .setDescription('Follow local games, tournaments, teams, and players.')
  .addSubcommand((subcommand) =>
    subcommand
      .setName('game')
      .setDescription('Follow a game.')
      .addStringOption((option) =>
        option.setName('game').setDescription('Game to follow').setRequired(true).setAutocomplete(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('tournament')
      .setDescription('Follow an active tracked tournament.')
      .addIntegerOption((option) =>
        option.setName('tournament').setDescription('Tracked tournament').setRequired(true).setAutocomplete(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('team')
      .setDescription('Follow a local team.')
      .addIntegerOption((option) => option.setName('team').setDescription('Local team').setRequired(true).setAutocomplete(true))
      .addStringOption((option) => option.setName('game').setDescription('Optional game filter').setAutocomplete(true)),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('player')
      .setDescription('Follow a local player.')
      .addIntegerOption((option) =>
        option.setName('player').setDescription('Local player').setRequired(true).setAutocomplete(true),
      )
      .addStringOption((option) => option.setName('game').setDescription('Optional game filter').setAutocomplete(true)),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('remove')
      .setDescription('Stop following one item.')
      .addStringOption((option) => option.setName('follow').setDescription('Follow to remove').setRequired(true).setAutocomplete(true)),
  )
  .addSubcommand((subcommand) => subcommand.setName('list').setDescription('List and manage your follows.'))
  .setContexts(InteractionContextType.Guild);

function isArabic(interaction) {
  return String(interaction.locale || interaction.guildLocale || '').toLowerCase().startsWith('ar');
}

function localizedMessages(interaction) {
  if (isArabic(interaction)) {
    return {
      following: (label) => `تتابع الآن ${safeDiscordText(label, 160)}.`,
      alreadyFollowing: (label) => `أنت تتابع ${safeDiscordText(label, 160)} بالفعل.`,
      removed: (label) => `تمت إزالة متابعة ${safeDiscordText(label, 160)}.`,
      stale: 'لم تعد هذه المتابعة متاحة.',
      unavailable: 'هذا الهدف غير متاح أو لم يعد متعقباً.',
      invalidGame: 'اختر لعبة معروفة من قائمة الإكمال التلقائي.',
      wrongGame: 'هذا السجل لا يتطابق مع فلتر اللعبة المحدد.',
      limited: 'وصلت إلى حد 200 متابعة. أزل متابعة من صفحة الإدارة أولاً.',
      unknownAction: 'هذا الإجراء لم يعد متاحاً.',
      teamUnavailable: 'ملف هذا الفريق المحلي غير جاهز للمتابعة بعد.',
    };
  }
  return {
    following: (label) => `Now following ${safeDiscordText(label, 160)}.`,
    alreadyFollowing: (label) => `You are already following ${safeDiscordText(label, 160)}.`,
    removed: (label) => `Removed ${safeDiscordText(label, 160)} from your follows.`,
    stale: 'That follow is no longer available.',
    unavailable: 'That target is unavailable or is no longer tracked.',
    invalidGame: 'Choose a known game from autocomplete.',
    wrongGame: 'That record does not match the selected game filter.',
    limited: 'You have reached the 200-follow limit. Remove a follow from the manage page first.',
    unknownAction: 'That follow action is no longer available.',
    teamUnavailable: 'That local team profile is not ready to follow yet.',
  };
}

function ephemeralPayload(payload) {
  return { ...payload, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } };
}

function componentPayload(payload) {
  return { ...payload, allowedMentions: { parse: [] } };
}

function dashboardFollowingUrl(interaction) {
  try {
    const url = new URL(String(config.dashboard.publicUrl || ''));
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    const basePath = url.pathname.replace(/\/+$/, '');
    url.pathname = `${basePath}${isArabic(interaction) ? '/ar' : ''}/me` || '/me';
    url.search = 'tab=following';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function optionalGame(interaction) {
  const raw = interaction.options.getString('game');
  if (!raw) return { game: null, error: null };
  const game = getGame(raw);
  return game ? { game, error: null } : { game: null, error: localizedMessages(interaction).invalidGame };
}

function validId(value) {
  if (!/^\d+$/.test(String(value ?? ''))) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function sameGame(recordGame, selectedGame) {
  if (!selectedGame) return true;
  return normalizeGameSlug(String(recordGame || '').toLowerCase()) === selectedGame.slug;
}

function activeTournamentForGuild(tournament, guildId) {
  return Boolean(
    tournament &&
      guildId &&
      String(tournament.guild_id) === String(guildId) &&
      Number(tournament.active) === 1 &&
      tournament.archived_at == null,
  );
}

function followTarget(entityType, entityKey, entityLabel, entityRef) {
  return { entityType, entityKey: String(entityKey), entityLabel: String(entityLabel || ''), entityRef };
}

async function resolveTournamentTarget(interaction, value) {
  const id = validId(value);
  if (!id) return null;
  const tournament = await getTournamentById(id);
  if (!activeTournamentForGuild(tournament, interaction.guildId)) return null;
  return followTarget(
    'tournament',
    tournament.id,
    tournament.name || tournament.external_id || `Tournament ${tournament.id}`,
    `/tournaments/${tournament.id}`,
  );
}

async function resolveTeamTarget(interaction, value, selectedGame = null) {
  const id = validId(value);
  if (!id) return { target: null, error: null };
  const team = await getTeamById(id);
  if (!team?.name) return { target: null, error: null };
  if (!sameGame(team.game, selectedGame)) return { target: null, error: localizedMessages(interaction).wrongGame };
  return { target: followTarget('team', team.name, team.name, `/teams/${team.id}`), error: null };
}

async function resolvePlayerTarget(interaction, value, selectedGame = null) {
  const id = validId(value);
  if (!id) return { target: null, error: null };
  const player = await getPlayerById(id);
  if (!player?.name) return { target: null, error: null };
  if (!sameGame(player.game, selectedGame)) return { target: null, error: localizedMessages(interaction).wrongGame };
  return { target: followTarget('player', player.id, player.name, `/players/${player.id}`), error: null };
}

async function saveFollow(interaction, target) {
  const messages = localizedMessages(interaction);
  const existing = await getFollow({
    discordUserId: interaction.user.id,
    entityType: target.entityType,
    entityKey: target.entityKey,
  });
  const result = await upsertFollow({
    discordUserId: interaction.user.id,
    entityType: target.entityType,
    entityKey: target.entityKey,
    entityLabel: target.entityLabel,
    entityRef: target.entityRef,
  });
  if (result?.limited) {
    return { content: messages.limited, components: managementComponents(interaction) };
  }
  return {
    content: existing ? messages.alreadyFollowing(target.entityLabel) : messages.following(target.entityLabel),
    components: managementComponents(interaction),
  };
}

function managementComponents(interaction) {
  const url = dashboardFollowingUrl(interaction);
  if (!url) return [];
  return buildFollowListPayload({ locale: interaction.locale, dashboardUrl: url }).components.slice(-1);
}

async function listPayloadFor(interaction, page = 0, notice = '') {
  return buildFollowListPayload({
    follows: await listFollowsForUser(interaction.user.id),
    page,
    locale: interaction.locale,
    dashboardUrl: dashboardFollowingUrl(interaction),
    notice,
  });
}

function focusedOption(interaction) {
  const focused = interaction.options.getFocused(true);
  if (focused && typeof focused === 'object') {
    return { name: String(focused.name || ''), value: String(focused.value || '') };
  }
  return { name: '', value: String(focused || '') };
}

function safeSubcommand(interaction) {
  try {
    return interaction.options.getSubcommand();
  } catch {
    return null;
  }
}

function autocompleteLabel(label, game) {
  const suffix = game ? ` (${gameName(game)})` : '';
  return safeDiscordText(`${label}${suffix}`, 100);
}

export async function autocomplete(interaction) {
  const subcommand = safeSubcommand(interaction);
  const focused = focusedOption(interaction);
  let choices = [];

  if (subcommand === 'game' && focused.name === 'game') {
    choices = searchGames(focused.value);
  } else if (subcommand === 'tournament' && focused.name === 'tournament' && interaction.guildId) {
    const rows = await searchActiveTournaments(interaction.guildId, { q: focused.value, limit: 50 });
    choices = rows.map((row) => ({
      name: autocompleteLabel(row.name || row.external_id || `Tournament ${row.id}`, row.game),
      value: Number(row.id),
    }));
  } else if ((subcommand === 'team' || subcommand === 'player') && focused.name === 'game') {
    choices = searchGames(focused.value);
  } else if ((subcommand === 'team' && focused.name === 'team') || (subcommand === 'player' && focused.name === 'player')) {
    const { game, error } = optionalGame(interaction);
    if (!error) {
      const rows = subcommand === 'team'
        ? await listTeams({ game: game?.slug || null, q: focused.value, limit: 25 })
        : await listPlayers({ game: game?.slug || null, q: focused.value, limit: 25 });
      choices = rows.map((row) => ({
        name: autocompleteLabel(row.name, row.game),
        value: Number(row.id),
      }));
    }
  } else if (subcommand === 'remove' && focused.name === 'follow') {
    const query = focused.value.toLowerCase();
    choices = (await listFollowsForUser(interaction.user.id))
      .filter((row) => `${row.entity_type} ${row.entity_label} ${row.entity_key}`.toLowerCase().includes(query))
      .slice(0, 25)
      .map((row) => ({
        name: safeDiscordText(`${followCopy(interaction.locale)[row.entity_type] || row.entity_type}: ${row.entity_label || row.entity_key}`, 100),
        value: String(row.id),
      }));
  }

  await interaction.respond(choices.slice(0, 25));
}

export async function execute(interaction) {
  const subcommand = safeSubcommand(interaction);
  const messages = localizedMessages(interaction);

  if (subcommand === 'list') {
    await interaction.reply(ephemeralPayload(await listPayloadFor(interaction)));
    return;
  }

  if (subcommand === 'remove') {
    const rowId = validId(interaction.options.getString('follow', true));
    const follow = rowId ? (await listFollowsForUser(interaction.user.id)).find((row) => Number(row.id) === rowId) : null;
    if (!follow) {
      await interaction.reply(ephemeralPayload({ content: messages.stale }));
      return;
    }
    await deleteFollow({ discordUserId: interaction.user.id, entityType: follow.entity_type, entityKey: follow.entity_key });
    await interaction.reply(ephemeralPayload({ content: messages.removed(follow.entity_label || follow.entity_key), components: managementComponents(interaction) }));
    return;
  }

  let target = null;
  let error = null;
  if (subcommand === 'game') {
    const game = getGame(interaction.options.getString('game', true));
    if (!game) error = messages.invalidGame;
    else target = followTarget('game', game.slug, game.name, `/games/${game.slug}`);
  } else if (subcommand === 'tournament') {
    target = await resolveTournamentTarget(interaction, interaction.options.getInteger('tournament', true));
  } else if (subcommand === 'team' || subcommand === 'player') {
    const filter = optionalGame(interaction);
    if (filter.error) error = filter.error;
    else {
      const result = subcommand === 'team'
        ? await resolveTeamTarget(interaction, interaction.options.getInteger('team', true), filter.game)
        : await resolvePlayerTarget(interaction, interaction.options.getInteger('player', true), filter.game);
      target = result.target;
      error = result.error;
    }
  }

  if (!target) {
    await interaction.reply(ephemeralPayload({ content: error || messages.unavailable, components: managementComponents(interaction) }));
    return;
  }
  await interaction.reply(ephemeralPayload(await saveFollow(interaction, target)));
}

function componentPage(value) {
  return /^\d+$/.test(String(value || '')) ? Number(value) : 0;
}

async function updateList(interaction, page, notice) {
  await interaction.update(componentPayload(await listPayloadFor(interaction, page, notice)));
}

async function matchTeamTarget(interaction, match, selected) {
  if (isLobbyMatch(match)) return null;
  const name = selected === 'team_a' ? match.team_a : match.team_b;
  if (!name || /^(?:tbd|tba|to be determined|unknown|n\/?a|-|—)$/i.test(String(name).trim())) return null;
  const rows = await listTeams({ game: match.game || null, q: name, limit: 25 });
  const team = rows.find((row) => normalizeTeamName(row.name) === normalizeTeamName(name));
  if (!team) return null;
  return resolveTeamTarget(interaction, team.id);
}

async function handleMatchComponent(interaction, matchId) {
  const messages = localizedMessages(interaction);
  const id = validId(matchId);
  const selected = interaction.values?.length === 1 ? interaction.values[0] : null;
  if (!id || !['tournament', 'team_a', 'team_b'].includes(selected)) {
    await interaction.reply(ephemeralPayload({ content: messages.unknownAction }));
    return;
  }
  const match = (await getMatchesForGuild(interaction.guildId)).find((row) => Number(row.id) === id);
  if (!match) {
    await interaction.reply(ephemeralPayload({ content: messages.unavailable }));
    return;
  }
  const tournament = await getTournamentById(match.tournament_id);
  if (!activeTournamentForGuild(tournament, interaction.guildId)) {
    await interaction.reply(ephemeralPayload({ content: messages.unavailable }));
    return;
  }
  const result = selected === 'tournament'
    ? { target: await resolveTournamentTarget(interaction, tournament.id), error: null }
    : await matchTeamTarget(interaction, match, selected);
  const target = result?.target || null;
  if (!target) {
    await interaction.reply(ephemeralPayload({ content: selected === 'tournament' ? messages.unavailable : messages.teamUnavailable }));
    return;
  }
  await interaction.reply(ephemeralPayload(await saveFollow(interaction, target)));
}

export async function handleComponent(interaction) {
  const parts = String(interaction.customId || '').split(':');
  const [, action, value] = parts;
  const messages = localizedMessages(interaction);
  if (parts.length !== 3 || !['page', 'remove', 'match'].includes(action)) {
    await interaction.reply(ephemeralPayload({ content: messages.unknownAction }));
    return;
  }
  if (action === 'page') {
    await updateList(interaction, componentPage(value), '');
    return;
  }
  if (action === 'remove') {
    const page = componentPage(value);
    const rowId = interaction.values?.length === 1 ? validId(interaction.values[0]) : null;
    const follow = rowId ? (await listFollowsForUser(interaction.user.id)).find((row) => Number(row.id) === rowId) : null;
    if (!follow) {
      await updateList(interaction, page, messages.stale);
      return;
    }
    await deleteFollow({ discordUserId: interaction.user.id, entityType: follow.entity_type, entityKey: follow.entity_key });
    await updateList(interaction, page, messages.removed(follow.entity_label || follow.entity_key));
    return;
  }
  if (action === 'match') {
    await handleMatchComponent(interaction, value);
    return;
  }
  await interaction.reply(ephemeralPayload({ content: messages.unknownAction }));
}
