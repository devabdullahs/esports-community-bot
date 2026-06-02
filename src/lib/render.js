// Shared formatting helpers for embeds, the leaderboard, and voice-channel names.
import { gameTag, isLobbyGame } from './games.js';

export { gameTag };

// Required attribution for Liquipedia data (content is CC-BY-SA 3.0).
export const LIQUIPEDIA_ATTRIBUTION = 'Data from Liquipedia — CC-BY-SA 3.0';

export function scoreText(m) {
  return m.score_a != null && m.score_b != null ? `\`${m.score_a}–${m.score_b}\`` : '';
}

// Normalized key for recognizing the same team/player across sources and name forms — e.g.
// the bracket says "Team Canada" while the upcoming-matches widget says "Canada", or Liquipedia
// and PandaScore spell a team slightly differently. Used ONLY as a dedupe key, never displayed.
export function normalizeTeamName(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/^team\s+/, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

export function truncate(s, max) {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

// Public page for a match's tournament (so tags / detail cards can link to it).
export function tournamentUrl(m) {
  if (m.tournament_url) return m.tournament_url;
  if (m.tournament_source === 'liquipedia' && m.tournament_path) {
    return `https://liquipedia.net/${m.tournament_path}`;
  }
  if (m.tournament_source === 'startgg' && m.tournament_path) {
    return `https://www.start.gg/tournament/${m.tournament_path}`;
  }
  return null;
}

export function matchUrl(m) {
  if (m.source === 'liquipedia' && m.game && /^Match:/i.test(m.external_id || '')) {
    return `https://liquipedia.net/${m.game}/${m.external_id}`;
  }
  return tournamentUrl(m);
}

export function isLobbyMatch(m) {
  return isLobbyGame(m.game) || !m.team_b || /^lobby$/i.test(String(m.team_b));
}

export function matchLabel(m) {
  if (!isLobbyMatch(m)) return `${m.team_a} vs ${m.team_b}`;
  const detail = m.team_b && !/^lobby$/i.test(String(m.team_b)) ? ` — ${m.team_b}` : '';
  return `${m.team_a || m.name || m.tournament_name || 'Event'}${detail}`;
}

// One markdown line describing a match, tuned per status. The game tag links to the
// tournament's Liquipedia page when available.
export function matchLine(m) {
  const tag = gameTag(m.game);
  const url = tournamentUrl(m);
  const tagText = tag ? `\`${tag}\`` : '';
  const prefix = tag ? `${url ? `[${tagText}](${url})` : tagText} ` : '';
  const label = matchLabel(m);
  if (m.status === 'running') {
    return `🔴 ${prefix}**${label}** ${scoreText(m)}`.trimEnd();
  }
  if (m.status === 'finished') {
    if (isLobbyMatch(m)) return `✅ ${prefix}${label} ${scoreText(m)}`.trimEnd();
    // Bold the winner (higher score).
    const aWins = m.score_a != null && m.score_b != null && m.score_a > m.score_b;
    const bWins = m.score_a != null && m.score_b != null && m.score_b > m.score_a;
    const a = aWins ? `**${m.team_a}**` : m.team_a;
    const b = bWins ? `**${m.team_b}**` : m.team_b;
    return `✅ ${prefix}${a} vs ${b} ${scoreText(m)}`.trimEnd();
  }
  const when = m.scheduled_at ? ` · <t:${m.scheduled_at}:R>` : '';
  return `🗓️ ${prefix}${label}${when}`;
}
