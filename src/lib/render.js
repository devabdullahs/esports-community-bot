// Shared formatting helpers for embeds, the leaderboard, and voice-channel names.
import { gameTag } from './games.js';

export { gameTag };

// Required attribution for Liquipedia data (content is CC-BY-SA 3.0).
export const LIQUIPEDIA_ATTRIBUTION = 'Data from [Liquipedia](https://liquipedia.net) — CC-BY-SA 3.0';

export function scoreText(m) {
  return m.score_a != null && m.score_b != null ? `\`${m.score_a}–${m.score_b}\`` : '';
}

export function truncate(s, max) {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

// Liquipedia page for a match's tournament (so the game tag can link to it).
function tournamentUrl(m) {
  if (m.tournament_url) return m.tournament_url;
  if (m.tournament_source === 'liquipedia' && m.tournament_path) {
    return `https://liquipedia.net/${m.tournament_path}`;
  }
  return null;
}

// One markdown line describing a match, tuned per status. The game tag links to the
// tournament's Liquipedia page when available.
export function matchLine(m) {
  const tag = gameTag(m.game);
  const url = tournamentUrl(m);
  const tagText = tag ? `\`${tag}\`` : '';
  const prefix = tag ? `${url ? `[${tagText}](${url})` : tagText} ` : '';
  if (m.status === 'running') {
    return `🔴 ${prefix}**${m.team_a}** vs **${m.team_b}** ${scoreText(m)}`.trimEnd();
  }
  if (m.status === 'finished') {
    // Bold the winner (higher score).
    const aWins = m.score_a != null && m.score_b != null && m.score_a > m.score_b;
    const bWins = m.score_a != null && m.score_b != null && m.score_b > m.score_a;
    const a = aWins ? `**${m.team_a}**` : m.team_a;
    const b = bWins ? `**${m.team_b}**` : m.team_b;
    return `✅ ${prefix}${a} vs ${b} ${scoreText(m)}`.trimEnd();
  }
  const when = m.scheduled_at ? ` · <t:${m.scheduled_at}:R>` : '';
  return `🗓️ ${prefix}${m.team_a} vs ${m.team_b}${when}`;
}
