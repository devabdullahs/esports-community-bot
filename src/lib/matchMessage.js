import { AttachmentBuilder, EmbedBuilder } from 'discord.js';
import {
  displayTeamName,
  formatRiyadhDateTime,
  renderAllGamesStatusCard,
  renderCardForMatch,
  renderScheduleCard,
  renderStatusCard,
} from './matchCard.js';
import { gameName, gameTag, matchTagEwc } from './games.js';
import { isLobbyMatch, matchLabel, matchUrl, tournamentUrl } from './render.js';

const LIQUIPEDIA_FOOTER = 'Data from Liquipedia — CC-BY-SA 3.0';
const NEXT_UP_LOOKAHEAD_SECONDS = 3 * 60 * 60;

export const MATCH_STATUS = {
  running: { label: 'Live now', color: 0xed4245, order: 0 },
  scheduled: { label: 'Upcoming', color: 0x5865f2, order: 1 },
  finished: { label: 'Finished', color: 0x57f287, order: 2 },
};

export function matchScoreText(m) {
  if (m.status === 'scheduled' || m.score_a == null || m.score_b == null) return 'VS';
  return `${m.score_a} - ${m.score_b}`;
}

function timeLine(m) {
  if (!m.scheduled_at) return null;
  if (m.status === 'scheduled') return `Starts <t:${m.scheduled_at}:F> (<t:${m.scheduled_at}:R>)`;
  if (m.status === 'running') return `Started <t:${m.scheduled_at}:R>`;
  return `Played <t:${m.scheduled_at}:f>`;
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function isLiquipediaMatch(m) {
  return m?.source === 'liquipedia' || m?.tournament_source === 'liquipedia';
}

function nextUpcomingSoon(matches, current) {
  const now = nowSec();
  const cutoff = now + NEXT_UP_LOOKAHEAD_SECONDS;
  return matches
    .filter(
      (m) =>
        m.id !== current?.id &&
        m.status === 'scheduled' &&
        m.scheduled_at &&
        m.scheduled_at >= now &&
        m.scheduled_at <= cutoff,
    )
    .sort(byUpcomingTime)[0] ?? null;
}

function nextMatchLabel(m, showGameTag = false) {
  const label = matchLabel({
    ...m,
    team_a: displayTeamName(m.team_a),
    team_b: isLobbyMatch(m) ? m.team_b : displayTeamName(m.team_b),
  });
  const tag = showGameTag ? gameTag(m.game) : '';
  return tag ? `${tag}: ${label}` : label;
}

function nextMatchEmbedLine(m, showGameTag = false) {
  const label = nextMatchLabel(m, showGameTag);
  const url = matchUrl(m);
  const linked = url ? `[${label}](${url})` : label;
  const when = m.scheduled_at ? ` - <t:${m.scheduled_at}:R>` : '';
  return `Next up: **${linked}**${when}`;
}

function nextMatchImageText(m, showGameTag = false) {
  const time = m.scheduled_at ? formatRiyadhDateTime(m.scheduled_at).text : 'Time TBD';
  return `Next: ${nextMatchLabel(m, showGameTag)} - ${time}`;
}

export function buildMatchEmbed(m, imageName, { nextMatch = null, showNextGameTag = false } = {}) {
  const meta = MATCH_STATUS[m.status] ?? MATCH_STATUS.scheduled;
  const tag = gameTag(m.game);
  const url = tournamentUrl(m);
  const lines = [`Status: **${meta.label}**`, `Score: **${matchScoreText(m)}**`];
  const when = timeLine(m);
  if (when) lines.push(when);
  if (tag) lines.push(`Game: \`${tag}\``);
  if (m.tournament_name) lines.push(`Tournament: **${m.tournament_name}**`);
  if (url) lines.push(`[Full match details](${url})`);
  if (nextMatch) lines.push(nextMatchEmbedLine(nextMatch, showNextGameTag));

  const embed = new EmbedBuilder()
    .setColor(meta.color)
    .setTitle(matchLabel(m))
    .setDescription(lines.join('\n'))
    .setImage(`attachment://${imageName}`)
    .setTimestamp(new Date());

  if (url) embed.setURL(url);
  if (isLiquipediaMatch(m)) embed.setFooter({ text: LIQUIPEDIA_FOOTER });
  return embed;
}

export async function buildMatchCardPayload(m, { matches = [], showNextGameTag = false } = {}) {
  const nextMatch = nextUpcomingSoon(matches, m);
  const imageName = `match-card-${m.id || 'preview'}-${Date.now()}.png`;
  const attachment = new AttachmentBuilder(
    await renderCardForMatch(m, { nextText: nextMatch ? nextMatchImageText(nextMatch, showNextGameTag) : null }),
    { name: imageName },
  );
  return {
    embeds: [buildMatchEmbed(m, imageName, { nextMatch, showNextGameTag })],
    files: [attachment],
  };
}

function safeName(s) {
  return String(s || 'all')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function nextUpcoming(matches) {
  return upcomingMatches(matches, 1)[0];
}

function byUpcomingTime(a, b) {
  return (a.scheduled_at ?? Number.MAX_SAFE_INTEGER) - (b.scheduled_at ?? Number.MAX_SAFE_INTEGER);
}

function byLiveTime(a, b) {
  return (a.scheduled_at ?? Number.MAX_SAFE_INTEGER) - (b.scheduled_at ?? Number.MAX_SAFE_INTEGER) || a.id - b.id;
}

function upcomingMatches(matches, limit = 5, { diversify = false } = {}) {
  const scheduled = matches
    .filter((m) => m.status === 'scheduled')
    .sort(byUpcomingTime);

  if (!diversify) return scheduled.slice(0, limit);

  const selected = [];
  const seenGames = new Set();
  for (const match of scheduled) {
    if (seenGames.has(match.game || 'unknown')) continue;
    selected.push(match);
    seenGames.add(match.game || 'unknown');
    if (selected.length >= limit) return selected.sort(byUpcomingTime);
  }
  for (const match of scheduled) {
    if (selected.some((m) => m.id === match.id)) continue;
    selected.push(match);
    if (selected.length >= limit) break;
  }
  return selected.sort(byUpcomingTime);
}

function allGamesUpcoming(matches, limit = 10) {
  const scheduled = matches.filter((m) => m.status === 'scheduled').sort(byUpcomingTime);
  const selected = [];
  const seenGames = new Set();

  for (const match of scheduled) {
    const game = gameTag(match.game) || match.game || 'unknown';
    if (seenGames.has(game)) continue;
    selected.push(match);
    seenGames.add(game);
    if (selected.length >= limit) return selected.sort(byUpcomingTime);
  }

  for (const match of scheduled) {
    if (selected.some((m) => m.id === match.id)) continue;
    selected.push(match);
    if (selected.length >= limit) break;
  }

  return selected.sort(byUpcomingTime);
}

export async function buildAllGamesStatusPayload(matches) {
  const live = matches.filter((m) => m.status === 'running').sort(byLiveTime).slice(0, 5);
  const upcoming = allGamesUpcoming(matches, 10);
  const imageName = `match-card-all-status-${Date.now()}.png`;
  const attachment = new AttachmentBuilder(await renderAllGamesStatusCard({ live, upcoming }), { name: imageName });

  const lines = [];
  if (live.length) {
    lines.push(
      '**Live now**',
      ...live.map((m) => {
        const tag = matchTagEwc(m);
        const score = m.score_a != null && m.score_b != null ? ` — **${m.score_a} - ${m.score_b}**` : '';
        const url = matchUrl(m);
        const label = `${tag ? `\`${tag}\` ` : ''}${matchLabel(m)}`;
        return `${url ? `[${label}](${url})` : label}${score}`;
      }),
    );
  } else {
    lines.push('**Live now**', 'No live matches right now.');
  }

  lines.push('');
  if (upcoming.length) {
    lines.push(
      '**Upcoming**',
      ...upcoming.map((m) => {
        const tag = matchTagEwc(m);
        const label = `${tag ? `\`${tag}\` ` : ''}${matchLabel(m)}`;
        const url = matchUrl(m);
        const when = m.scheduled_at ? `<t:${m.scheduled_at}:F> (<t:${m.scheduled_at}:R>)` : '`Time TBD`';
        return `${url ? `[${label}](${url})` : label} — ${when}`;
      }),
    );
  } else {
    lines.push('**Upcoming**', 'No upcoming matches found.');
  }

  const embed = new EmbedBuilder()
    .setColor(live.length ? MATCH_STATUS.running.color : MATCH_STATUS.scheduled.color)
    .setTitle('All Games Status')
    .setDescription(lines.join('\n'))
    .setImage(`attachment://${imageName}`)
    .setTimestamp(new Date());
  if (matches.some(isLiquipediaMatch)) embed.setFooter({ text: LIQUIPEDIA_FOOTER });

  return {
    embeds: [embed],
    files: [attachment],
  };
}

export async function buildUpcomingSchedulePayload(game, matches) {
  const upcoming = upcomingMatches(matches, 5, { diversify: game === 'all' });
  const title = game === 'all' ? 'Upcoming Matches' : `${gameName(game)} Upcoming`;
  const subtitle = game === 'all' ? 'Next tracked matches across games' : `Next 5 tracked ${gameName(game)} matches`;
  const imageName = `match-card-schedule-${safeName(game)}-${Date.now()}.png`;
  const attachment = new AttachmentBuilder(
    await renderScheduleCard({
      title,
      subtitle,
      matches: upcoming,
      accent: 'rgba(88,101,242,0.65)',
      showGameTags: game === 'all',
    }),
    { name: imageName },
  );

  const lines = upcoming.map((m) => {
    const time = m.scheduled_at ? `<t:${m.scheduled_at}:F> (<t:${m.scheduled_at}:R>)` : '`Time TBD`';
    const tag = game === 'all' ? gameTag(m.game) : null;
    const tournamentName = m.tournament_name ? (tag ? `${tag} - ${m.tournament_name}` : m.tournament_name) : tag;
    const tournament = tournamentName ? ` - ${tournamentName}` : '';
    const label = matchLabel({
      ...m,
      team_a: displayTeamName(m.team_a),
      team_b: isLobbyMatch(m) ? m.team_b : displayTeamName(m.team_b),
    });
    const url = matchUrl(m);
    const linked = url ? `[${label}](${url})` : label;
    return `**${linked}** - ${time}${tournament}`;
  });
  const embed = new EmbedBuilder()
    .setColor(MATCH_STATUS.scheduled.color)
    .setTitle(title)
    .setDescription(lines.join('\n'))
    .setImage(`attachment://${imageName}`)
    .setTimestamp(new Date());
  if (upcoming.some(isLiquipediaMatch)) embed.setFooter({ text: LIQUIPEDIA_FOOTER });

  return {
    embeds: [embed],
    files: [attachment],
  };
}

export async function buildIdleMatchCardPayload(game, matches) {
  if (upcomingMatches(matches, 1).length) return buildUpcomingSchedulePayload(game, matches);

  const title = game === 'all' ? 'All Games Match Cards' : `${gameName(game)} Match Cards`;
  const next = nextUpcoming(matches);
  const detail = next
    ? `Next: ${next.team_a || 'TBD'} vs ${next.team_b || 'TBD'}`
    : 'Cards will appear here when a tracked match goes live.';
  const imageName = `match-card-idle-${safeName(game)}-${Date.now()}.png`;
  const attachment = new AttachmentBuilder(
    renderStatusCard({
      title,
      subtitle: next?.tournament_name || null,
      statusText: 'No live matches',
      detail,
      accent: 'rgba(88,101,242,0.65)',
    }),
    { name: imageName },
  );

  const lines = ['No live matches right now.'];
  if (next) {
    const when = next.scheduled_at ? ` - <t:${next.scheduled_at}:R>` : '';
    lines.push(`Next: **${matchLabel(next)}**${when}`);
  } else {
    lines.push('Live match cards will appear here automatically.');
  }

  const embed = new EmbedBuilder()
    .setColor(MATCH_STATUS.scheduled.color)
    .setTitle(title)
    .setDescription(lines.join('\n'))
    .setImage(`attachment://${imageName}`)
    .setTimestamp(new Date());
  if (matches.some(isLiquipediaMatch)) embed.setFooter({ text: LIQUIPEDIA_FOOTER });

  return {
    embeds: [embed],
    files: [attachment],
  };
}
