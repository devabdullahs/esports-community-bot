import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import { isLobbyMatch, normalizeTeamName } from './render.js';

export const FOLLOWS_PER_PAGE = 10;

function isArabic(locale) {
  return String(locale || '').toLowerCase().startsWith('ar');
}

export function followCopy(locale) {
  if (isArabic(locale)) {
    return {
      title: 'المتابَعات',
      empty: 'لا تتابع أي ألعاب أو بطولات أو فرق أو لاعبين بعد.',
      page: 'الصفحة',
      remove: 'إلغاء متابعة',
      previous: 'السابق',
      next: 'التالي',
      manage: 'إدارة المتابَعات',
      tournament: 'بطولة',
      team: 'فريق',
      player: 'لاعب',
      game: 'لعبة',
    };
  }
  return {
    title: 'Following',
    empty: 'You are not following any games, tournaments, teams, or players yet.',
    page: 'Page',
    remove: 'Remove a follow',
    previous: 'Previous',
    next: 'Next',
    manage: 'Manage follows',
    tournament: 'Tournament',
    team: 'Team',
    player: 'Player',
    game: 'Game',
  };
}

export function safeDiscordText(value, max = 100) {
  const text = String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/@/g, '@\u200b')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

function escapedLabel(value, max = 160) {
  return safeDiscordText(value, max).replace(/[\\`*_~|>[\]()]/g, '\\$&');
}

function typeLabel(entityType, copy) {
  return copy[entityType] || safeDiscordText(entityType, 30);
}

function validDashboardUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function pageNumber(value, totalPages) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(Math.max(parsed, 0), Math.max(totalPages - 1, 0));
}

export function buildFollowListPayload({ follows = [], page = 0, locale, dashboardUrl = null, notice = '' } = {}) {
  const copy = followCopy(locale);
  const totalPages = Math.max(1, Math.ceil(follows.length / FOLLOWS_PER_PAGE));
  const currentPage = pageNumber(page, totalPages);
  const start = currentPage * FOLLOWS_PER_PAGE;
  const rows = follows.slice(start, start + FOLLOWS_PER_PAGE);
  const description = rows.length
    ? rows
        .map((row) => `• **${typeLabel(row.entity_type, copy)}:** ${escapedLabel(row.entity_label || row.entity_key)}`)
        .join('\n')
    : copy.empty;
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(copy.title)
    .setDescription(description)
    .setFooter({ text: `${copy.page} ${currentPage + 1}/${totalPages}` });
  const components = [];

  if (rows.length) {
    const options = rows.map((row) => ({
      label: safeDiscordText(row.entity_label || row.entity_key || 'Unknown follow', 100),
      value: String(row.id),
      description: safeDiscordText(typeLabel(row.entity_type, copy), 100),
    }));
    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`follow:remove:${currentPage}`)
          .setPlaceholder(copy.remove)
          .addOptions(options),
      ),
    );
  }

  components.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`follow:page:${Math.max(0, currentPage - 1)}`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel(copy.previous)
        .setDisabled(currentPage === 0),
      new ButtonBuilder()
        .setCustomId(`follow:page:${Math.min(totalPages - 1, currentPage + 1)}`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel(copy.next)
        .setDisabled(currentPage >= totalPages - 1),
    ),
  );

  if (validDashboardUrl(dashboardUrl)) {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(copy.manage).setURL(dashboardUrl),
      ),
    );
  }

  const payload = {
    embeds: [embed],
    components,
  };
  if (notice) payload.content = safeDiscordText(notice, 500);
  return payload;
}

function placeholderTeamName(value) {
  const name = String(value ?? '').replace(/\s+/g, ' ').trim();
  return !name || /^(?:tbd|tba|to be determined|unknown|n\/?a|-|—)$/i.test(name);
}

export function buildMatchFollowRow(match, { locale } = {}) {
  const matchId = Number(match?.id);
  const tournamentId = Number(match?.tournament_id);
  if (!Number.isSafeInteger(matchId) || matchId < 1 || !Number.isSafeInteger(tournamentId) || tournamentId < 1) return null;

  const copy = followCopy(locale);
  const options = [
    {
      label: safeDiscordText(`${copy.tournament}: ${match.tournament_name || match.name || tournamentId}`, 100),
      value: 'tournament',
    },
  ];
  if (!isLobbyMatch(match)) {
    const seenTeams = new Set();
    for (const [value, team] of [
      ['team_a', match.team_a],
      ['team_b', match.team_b],
    ]) {
      if (placeholderTeamName(team)) continue;
      const key = normalizeTeamName(team);
      if (!key || seenTeams.has(key)) continue;
      seenTeams.add(key);
      options.push({ label: safeDiscordText(`${copy.team}: ${team}`, 100), value });
    }
  }

  if (!options.length) return null;
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`follow:match:${matchId}`)
      .setPlaceholder(isArabic(locale) ? 'متابعة...' : 'Follow...')
      .addOptions(options),
  );
}
