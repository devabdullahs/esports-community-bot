import { transaction } from '../db/client.js';
import {
  getEwcSeason,
  getEwcWeek,
  getSeasonPrediction,
  swapSeasonClubPicks,
  upsertSeasonClubPick,
  upsertWeeklyGamePick,
} from '../db/ewcPredictions.js';
import { resolveEwcClubPick } from './ewcClubCache.js';
import { ewcGameParticipantTeams, matchParticipant } from './ewcGameTeams.js';

function result(ok, code, message, extra = {}) {
  return { ok, code, message, ...extra };
}

function submittedSecond(submittedAt) {
  const value = Math.floor(Number(submittedAt));
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function weeklyRoundError(round, game, submittedAt) {
  if (!round) return result(false, 'round_not_found', 'That prediction round does not exist.');
  if (!game) return result(false, 'game_not_found', 'That game is not configured for this week.');
  if (round.status !== 'open') return result(false, 'round_closed', `That round is already \`${round.status}\`.`);
  if (round.open_at && submittedAt < round.open_at) return result(false, 'not_open', 'That prediction round is not open yet.');
  if (game.lockAt && submittedAt >= game.lockAt) return result(false, 'locked', `${game.game || 'That game'} picks are locked.`);
  return null;
}

function seasonRoundError(round, submittedAt) {
  if (!round) return result(false, 'round_not_found', 'That season prediction round does not exist.');
  if (round.status !== 'open') return result(false, 'round_closed', `That round is already \`${round.status}\`.`);
  if (round.open_at && submittedAt < round.open_at) return result(false, 'not_open', 'That season prediction round is not open yet.');
  if (round.close_at && submittedAt >= round.close_at) return result(false, 'locked', 'Season predictions are locked.');
  return null;
}

function gameForKey(round, gameKey) {
  return (round?.games || []).find((game) => game?.key === gameKey) || null;
}

function nonEmptyPicks(picks) {
  return (picks || []).filter((pick) => typeof pick === 'string' && pick.trim());
}

async function canonicalWeeklyPick(rawPick, game, resolvers) {
  const participants = await resolvers.participants(game.game, { eventUrl: game.eventUrl });
  const participant = matchParticipant(rawPick, participants);
  if (participant) return result(true, 'ok', '', { pick: participant });
  const resolved = await resolvers.club(rawPick, { wait: true, game: game.game, strictGame: true });
  if (!resolved?.ok) return result(false, 'invalid_pick', resolved?.message || 'That club could not be matched.');
  return result(true, 'ok', '', { pick: resolved.name });
}

async function canonicalSeasonPick(rawPick, resolvers) {
  const resolved = await resolvers.club(rawPick, { wait: true });
  if (!resolved?.ok) return result(false, 'invalid_pick', resolved?.message || 'That club could not be matched.');
  return result(true, 'ok', '', { pick: resolved.name });
}

const defaultResolvers = {
  participants: ewcGameParticipantTeams,
  club: resolveEwcClubPick,
};

export async function submitWeeklyGamePick({
  guildId,
  season = '2026',
  userId,
  weekKey,
  gameKey,
  rawPick,
  submittedAt,
  resolvers = defaultResolvers,
}) {
  const submittedSecondValue = submittedSecond(submittedAt);
  if (!submittedSecondValue || !String(rawPick || '').trim()) return result(false, 'invalid_input', 'Choose a club before saving your pick.');
  const initialRound = await getEwcWeek(guildId, season, weekKey);
  const initialGame = gameForKey(initialRound, gameKey);
  const initialError = weeklyRoundError(initialRound, initialGame, submittedSecondValue);
  if (initialError) return initialError;

  // Club/participant resolution may refresh cached Liquipedia data, so it must finish
  // before the short transaction that revalidates the trusted submission time.
  const canonical = await canonicalWeeklyPick(rawPick, initialGame, resolvers);
  if (!canonical.ok) return canonical;

  return transaction(async (client) => {
    const round = await getEwcWeek(guildId, season, weekKey, client);
    const game = gameForKey(round, gameKey);
    const writeError = weeklyRoundError(round, game, submittedSecondValue);
    if (writeError) return writeError;
    const saved = await upsertWeeklyGamePick({
      guildId,
      weekId: round.id,
      userId,
      gameKey,
      game: game.game || null,
      event: game.event || null,
      pick: canonical.pick,
      pickedAt: submittedSecondValue,
      client,
    });
    return result(true, 'saved', 'Prediction saved.', { prediction: saved, firstPick: saved.firstPick, round, game });
  });
}

export async function submitSeasonSlot({
  guildId,
  season = '2026',
  userId,
  index,
  rawPick,
  submittedAt,
  resolvers = defaultResolvers,
}) {
  const submittedSecondValue = submittedSecond(submittedAt);
  const slot = Number(index);
  if (!submittedSecondValue || !Number.isInteger(slot) || slot < 0 || !String(rawPick || '').trim()) {
    return result(false, 'invalid_input', 'Choose a valid season rank and club.');
  }
  const initialRound = await getEwcSeason(guildId, season);
  const initialError = seasonRoundError(initialRound, submittedSecondValue);
  if (initialError) return initialError;
  if (slot >= Number(initialRound.top_size || 0)) return result(false, 'invalid_input', 'That season rank is not configured.');

  const canonical = await canonicalSeasonPick(rawPick, resolvers);
  if (!canonical.ok) return canonical;

  return transaction(async (client) => {
    const round = await getEwcSeason(guildId, season, client);
    const writeError = seasonRoundError(round, submittedSecondValue);
    if (writeError) return writeError;
    if (slot >= Number(round.top_size || 0)) return result(false, 'invalid_input', 'That season rank is not configured.');
    const existing = await getSeasonPrediction(guildId, season, userId, client);
    const picks = nonEmptyPicks(existing?.picks);
    const filled = picks.length;
    if (slot > filled) return result(false, 'slot_locked', `Set Pick #${filled + 1} first — season picks fill in order.`);
    const existingIndex = picks.findIndex((pick, pickIndex) => pickIndex !== slot && pick === canonical.pick);
    if (existingIndex !== -1) {
      if (slot >= filled) return result(false, 'duplicate_pick', `**${canonical.pick}** is already your Pick #${existingIndex + 1}.`);
      const saved = await swapSeasonClubPicks({ guildId, season, userId, a: slot, b: existingIndex, client });
      return result(true, 'swapped', 'Season picks reordered.', { prediction: saved, firstPick: false, round });
    }
    const saved = await upsertSeasonClubPick({ guildId, season, userId, index: slot, pick: canonical.pick, client });
    return result(true, 'saved', 'Season pick saved.', { prediction: saved, firstPick: saved.firstPick, round });
  });
}

export async function swapSeasonPicks({ guildId, season = '2026', userId, a, b, submittedAt }) {
  const submittedSecondValue = submittedSecond(submittedAt);
  const first = Number(a);
  const second = Number(b);
  if (!submittedSecondValue || !Number.isInteger(first) || !Number.isInteger(second) || first < 0 || second < 0) {
    return result(false, 'invalid_input', 'Choose two valid season ranks.');
  }
  return transaction(async (client) => {
    const round = await getEwcSeason(guildId, season, client);
    const writeError = seasonRoundError(round, submittedSecondValue);
    if (writeError) return writeError;
    const existing = await getSeasonPrediction(guildId, season, userId, client);
    const picks = nonEmptyPicks(existing?.picks);
    if (first >= picks.length || second >= picks.length) return result(false, 'invalid_input', 'Both season ranks need a pick before they can be swapped.');
    const saved = await swapSeasonClubPicks({ guildId, season, userId, a: first, b: second, client });
    return result(true, 'saved', 'Season picks reordered.', { prediction: saved, firstPick: false, round });
  });
}
