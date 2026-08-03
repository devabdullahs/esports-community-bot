import { createHash } from 'node:crypto';
import { config } from '../config.js';
import {
  contentHash,
  getOfficialFeedState,
  opaqueWorkbookKey,
  saveOfficialFeedState,
  upsertOfficialTournamentOverview,
} from '../db/officialEwcSheets.js';
import { deleteStaleFinishedMatches, listMatchesForTournament, upsertMatch } from '../db/matches.js';
import { upsertMatchDetails } from '../db/matchDetails.js';
import { replaceTournamentStandings } from '../db/tournamentStandings.js';
import { listActiveTournaments } from '../db/tournaments.js';
import { isEwcTournamentReference } from '../lib/ewcTournament.js';
import { logger } from '../lib/logger.js';
import { normalizeTeamName } from '../lib/render.js';
import { armMatch, stopMatch } from './pollingManager.js';
import { createOfficialSheetsClient } from '../services/officialEwcSheets/client.js';
import {
  isLcqLabel,
  parseOfficialWorkbook,
  workbookDescriptor,
} from '../services/officialEwcSheets/parsers.js';

const MATCH_TIME_WINDOW_SECONDS = 15 * 60;
const FAST_POLL_PAST_GRACE_SECONDS = 6 * 60 * 60;
const ATTRIBUTION = '© Esports Foundation 2026. All rights reserved.';
const DETAIL_SOURCE = 'internal-normalized';
// Bump whenever parsing or reconciliation changes what gets persisted, so already-seen
// workbooks are re-read once instead of waiting for the next unrelated edit.
export const OFFICIAL_PARSER_VERSION = 14;

let running = false;
let client = null;
let lastScanSummary = null;
let fastPollWorkbooks = [];
let fastPollCursor = 0;
let cachedTournaments = [];

// The change token is compared BEFORE the workbook is read, so a parser that learns to
// extract something new stays dormant until an unrelated edit bumps modifiedTime. Folding
// the parser version in re-reads every workbook exactly once after a parser change, then
// returns to plain modified-time gating.
export function officialWorkbookToken(modifiedTime, parserVersion = OFFICIAL_PARSER_VERSION) {
  return contentHash(`v${parserVersion}:${String(modifiedTime || '')}`);
}

export function shouldReadOfficialWorkbook(previous, modifiedToken, { forceRead = false } = {}) {
  return forceRead || previous?.modified_token !== modifiedToken;
}

function normalized(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ');
}

export function normalizedOfficialPair(teamA, teamB) {
  return [normalizeTeamName(teamA), normalizeTeamName(teamB)].sort().join('|');
}

export function officialScheduleAliases(matches, update) {
  const pair = normalizedOfficialPair(update?.teamA, update?.teamB);
  if (!pair || pair === '|') return [];
  const providers = (matches || []).filter(
    (match) =>
      normalizedOfficialPair(match.team_a, match.team_b) === pair &&
      !String(match.external_id || '').startsWith('official:'),
  );
  if (providers.length <= 1) return providers;
  const timestamps = new Set();
  for (const match of providers) {
    const timestamp = Number(match.scheduled_at);
    if (!Number.isFinite(timestamp) || timestamp <= 0) return [];
    timestamps.add(Math.trunc(timestamp));
  }
  return timestamps.size === 1 ? providers : [];
}

function preferredProviderAlias(aliases) {
  return [...aliases].sort((left, right) => {
    const stable = Number(/^Match:/i.test(right.external_id || '')) -
      Number(/^Match:/i.test(left.external_id || ''));
    if (stable) return stable;
    return Number(left.id || 0) - Number(right.id || 0);
  })[0] || null;
}

export function resolveOfficialTournament(tournaments, descriptor) {
  // A last-chance qualifier is a separate workbook AND a separate tournament of the same
  // game, so the two must never see each other as candidates: a main-event needle like
  // "tekken" matches the LCQ too, and two candidates resolve to nothing at all.
  const wantLcq = Boolean(descriptor?.lcq);
  const candidates = (tournaments || []).filter(
    (tournament) =>
      tournament?.active === 1 &&
      tournament?.archived_at == null &&
      tournament?.game === descriptor?.game &&
      isEwcTournamentReference(tournament) &&
      isLcqLabel(`${tournament.name || ''} ${tournament.external_id || ''}`) === wantLcq,
  );
  const needle = normalized(descriptor?.tournamentNeedle);
  const narrowed = needle
    ? candidates.filter((tournament) =>
        normalized(`${tournament.name || ''} ${tournament.external_id || ''} ${tournament.url || ''}`).includes(
          needle,
        ),
      )
    : candidates;
  return narrowed.length === 1 ? narrowed[0] : null;
}

export function findOfficialMatch(matches, update) {
  const pair = normalizedOfficialPair(update?.teamA, update?.teamB);
  if (!pair || pair === '|') return null;
  const candidates = (matches || []).filter(
    (match) => normalizedOfficialPair(match.team_a, match.team_b) === pair,
  );
  const scheduledAt = Number(update?.scheduledAt);
  if (Number.isFinite(scheduledAt) && scheduledAt > 0) {
    const providerAliases = officialScheduleAliases(candidates, update);
    if (providerAliases.length) return preferredProviderAlias(providerAliases);
    const timed = candidates.filter((match) => {
      const stored = Number(match.scheduled_at);
      return Number.isFinite(stored) && Math.abs(stored - scheduledAt) <= MATCH_TIME_WINDOW_SECONDS;
    });
    if (timed.length === 1) return timed[0];
    // A single pairing is unambiguous even when the fallback provider published
    // a substantially different time. Multiple same-pair matches still fail closed.
    return candidates.length === 1 ? candidates[0] : null;
  }
  return candidates.length === 1 ? candidates[0] : null;
}

export function shouldFastPollOfficialWorkbook(
  matches,
  {
    nowSeconds = Math.floor(Date.now() / 1000),
    lookaheadSeconds = config.officialEwcSheets.liveLookaheadSeconds,
  } = {},
) {
  const now = Number(nowSeconds);
  const lookahead = Math.max(0, Number(lookaheadSeconds) || 0);
  return (matches || []).some((match) => {
    if (match?.status === 'running') return true;
    if (match?.status !== 'scheduled' && match?.status !== 'finished') return false;
    const scheduledAt = Number(match.scheduled_at);
    return (
      Number.isFinite(scheduledAt) &&
      scheduledAt >= now - FAST_POLL_PAST_GRACE_SECONDS &&
      scheduledAt <= now + lookahead
    );
  });
}

function publicExternalId(tournament, update) {
  const logical = [
    tournament.id,
    normalizedOfficialPair(update.teamA, update.teamB),
    update.scheduledAt || 'untimed',
    normalized(update.round || update.name),
  ].join('|');
  return `official:${createHash('sha256').update(logical).digest('hex').slice(0, 32)}`;
}

export function officialTeamLogo(matches, existing, team) {
  const target = normalizeTeamName(team);
  if (!target) return null;
  const counts = new Map();
  for (const match of matches || []) {
    if (existing?.id != null && match?.id === existing.id) continue;
    const candidates = [];
    if (normalizeTeamName(match?.team_a) === target) candidates.push(match.logo_a);
    if (normalizeTeamName(match?.team_b) === target) candidates.push(match.logo_b);
    for (const logo of candidates) {
      const value = String(logo || '').trim();
      if (value) counts.set(value, (counts.get(value) || 0) + 1);
    }
  }
  const canonical = [...counts.entries()].sort(
    ([leftLogo, leftCount], [rightLogo, rightCount]) =>
      rightCount - leftCount || leftLogo.localeCompare(rightLogo),
  )[0]?.[0];
  if (canonical) return canonical;

  if (normalizeTeamName(existing?.team_a) === target) return existing.logo_a || null;
  if (normalizeTeamName(existing?.team_b) === target) return existing.logo_b || null;
  return null;
}

function rowFromUpdate(tournament, existing, update, matches) {
  const teamA = update.teamA || existing?.team_a || 'TBD';
  const teamB = update.teamB || existing?.team_b || 'TBD';
  return {
    tournament_id: tournament.id,
    source: existing?.source || tournament.source,
    external_id: existing?.external_id || publicExternalId(tournament, update),
    name: update.name || existing?.name || `${teamA} vs ${teamB}`,
    team_a: teamA,
    team_b: teamB,
    logo_a: officialTeamLogo(matches, existing, teamA),
    logo_b: officialTeamLogo(matches, existing, teamB),
    score_a: update.scoreA ?? existing?.score_a ?? null,
    score_b: update.scoreB ?? existing?.score_b ?? null,
    status: update.status || existing?.status || 'scheduled',
    scheduled_at: update.scheduledAt ?? existing?.scheduled_at ?? null,
    stream_platform: existing?.stream_platform || null,
    stream_url: existing?.stream_url || null,
  };
}

function authorityFields(update) {
  const fields = [];
  if (update.name) fields.push('name');
  if (update.teamA) fields.push('team_a');
  if (update.teamB) fields.push('team_b');
  if (update.scoreA !== null && update.scoreA !== undefined) fields.push('score_a');
  if (update.scoreB !== null && update.scoreB !== undefined) fields.push('score_b');
  if (update.status) fields.push('status');
  if (update.scheduledAt !== null && update.scheduledAt !== undefined) fields.push('scheduled_at');
  return fields;
}

function matchDetailsBase(kind) {
  return { version: 1, kind, patch: null, casters: [], attribution: ATTRIBUTION };
}

export async function prioritizeOfficialWorkbooks(
  workbooks,
  tournaments,
  {
    loadMatches = listMatchesForTournament,
    nowSeconds = Math.floor(Date.now() / 1000),
  } = {},
) {
  const ranked = [];
  for (const [index, workbook] of (workbooks || []).entries()) {
    const descriptor = workbookDescriptor(workbook.name);
    const tournament = descriptor
      ? resolveOfficialTournament(tournaments, descriptor)
      : null;
    let running = false;
    let nextAt = Number.POSITIVE_INFINITY;
    if (tournament) {
      const matches = await loadMatches(tournament.id);
      running = matches.some((match) => match?.status === 'running');
      for (const match of matches) {
        if (match?.status !== 'scheduled') continue;
        const scheduledAt = Number(match.scheduled_at);
        if (Number.isFinite(scheduledAt) && scheduledAt >= nowSeconds) {
          nextAt = Math.min(nextAt, scheduledAt);
        }
      }
    }
    ranked.push({ workbook, index, running, nextAt });
  }
  return ranked
    .sort((left, right) => {
      if (left.running !== right.running) return left.running ? -1 : 1;
      if (left.nextAt !== right.nextAt) return left.nextAt - right.nextAt;
      return left.index - right.index;
    })
    .map(({ workbook }) => workbook);
}

export function deriveOfficialOverwatchSeriesResult(maps, match) {
  if (!Array.isArray(maps) || !match) return null;
  const matchTeamA = normalizeTeamName(match.team_a);
  const matchTeamB = normalizeTeamName(match.team_b);
  if (!matchTeamA || !matchTeamB || matchTeamA === matchTeamB) return null;

  let scoreA = 0;
  let scoreB = 0;
  const completedMaps = new Set();
  for (const map of maps) {
    if (normalizedOfficialPair(map?.teamA, map?.teamB) !== normalizedOfficialPair(match.team_a, match.team_b)) {
      continue;
    }
    const mapKey = `${normalized(map?.map)}|${normalized(map?.mode)}`;
    if (mapKey === '|' || completedMaps.has(mapKey)) continue;

    const mapTeamA = normalizeTeamName(map.teamA);
    const mapTeamB = normalizeTeamName(map.teamB);
    const winner = normalizeTeamName(map.winner);
    let winningTeam = '';
    if (winner === mapTeamA || winner === mapTeamB) {
      winningTeam = winner;
    } else if (Number.isFinite(map.scoreA) && Number.isFinite(map.scoreB) && map.scoreA !== map.scoreB) {
      winningTeam = map.scoreA > map.scoreB ? mapTeamA : mapTeamB;
    }
    if (!winningTeam) continue;

    completedMaps.add(mapKey);
    if (winningTeam === matchTeamA) scoreA += 1;
    else if (winningTeam === matchTeamB) scoreB += 1;
  }

  const round = normalized(maps.find((map) => map?.round)?.round);
  const winsRequired = round.includes('grand final') ? 4 : 3;
  if (completedMaps.size === 0) return null;
  const status = Math.max(scoreA, scoreB) >= winsRequired && scoreA !== scoreB
    ? 'finished'
    : 'running';
  return { scoreA, scoreB, status };
}

export function shouldApplyOfficialOverwatchSeriesResult(
  match,
  result,
  { terminalMatchIds = null } = {},
) {
  if (!result || !match) return false;
  if (terminalMatchIds?.has(match.id)) return false;

  // MATCH INFO MASTER can lag the schedule/provider by one map. Never reopen a
  // terminal match from that incomplete snapshot; a terminal official result is
  // still allowed through and can correct a stale fallback score.
  return !(match.status === 'finished' && result.status === 'running');
}

async function persistAuthoritativeMatchUpdate(
  tournament,
  existing,
  update,
  matches,
  observedAt,
  ttlSeconds,
  { allowTerminalCorrection = false, authorityFieldsOverride = null } = {},
) {
  const stored = await upsertMatch(rowFromUpdate(tournament, existing, update, matches), {
    authoritative: true,
    authorityTtlSeconds: ttlSeconds,
    observedAt,
    authorityFields: authorityFieldsOverride || authorityFields(update),
    allowTerminalCorrection,
  });
  if (existing) Object.assign(existing, stored);
  return stored;
}

async function applyMatchUpdate(tournament, matches, update, observedAt, ttlSeconds) {
  const scheduleAliases = update.scheduledAt == null
    ? []
    : officialScheduleAliases(matches, update);
  const existing = findOfficialMatch(matches, update);
  const stored = await persistAuthoritativeMatchUpdate(
    tournament,
    existing,
    update,
    matches,
    observedAt,
    ttlSeconds,
  );
  if (!existing) matches.push(stored);
  for (const alias of scheduleAliases) {
    if (alias === existing) continue;
    await persistAuthoritativeMatchUpdate(
      tournament,
      alias,
      {
        teamA: alias.team_a,
        teamB: alias.team_b,
        scheduledAt: update.scheduledAt,
      },
      matches,
      observedAt,
      ttlSeconds,
      { authorityFieldsOverride: ['scheduled_at'] },
    );
  }
  return stored;
}

async function applyScheduleUpdates(tournament, matches, updates, observedAt, ttlSeconds) {
  const terminalMatchIds = new Set();
  const updatedMatchIds = new Set();
  for (const update of updates) {
    const stored = await applyMatchUpdate(tournament, matches, update, observedAt, ttlSeconds);
    if (stored) updatedMatchIds.add(stored.id);
    if (
      stored &&
      update.status === 'finished' &&
      update.scoreA !== null &&
      update.scoreA !== undefined &&
      update.scoreB !== null &&
      update.scoreB !== undefined
    ) {
      terminalMatchIds.add(stored.id);
    }
  }
  return { terminalMatchIds, updatedMatchIds };
}

function syncOfficialWatchers(tournament, matches, candidateIds = new Set()) {
  let armed = 0;
  let stopped = 0;
  for (const match of matches) {
    if (match.status === 'finished' || match.status === 'cancelled') {
      if (stopMatch(match.external_id)) stopped += 1;
      continue;
    }
    if (candidateIds.has(match.id) && armMatch(match, tournament)) armed += 1;
  }
  return { armed, stopped };
}

function detailMatchByLabel(matches, label) {
  const key = normalized(label);
  if (!key) return null;
  const candidates = matches.filter((match) => {
    const values = [match.name, match.team_a, match.team_b].map(normalized);
    return values.some((value) => value === key || value.includes(key) || key.includes(value));
  });
  return candidates.length === 1 ? candidates[0] : null;
}

async function applyDetails(
  tournament,
  matches,
  parsed,
  observedAt,
  ttlSeconds,
  { persistDetails = true, terminalMatchIds = null, updatedMatchIds = null } = {},
) {
  for (const result of parsed.individualResults) {
    const match = findOfficialMatch(matches, result);
    if (!match) continue;
    if (persistDetails) {
      await upsertMatchDetails({
        matchId: match.id,
        sourcePage: DETAIL_SOURCE,
        game: tournament.game,
        payload: {
          ...matchDetailsBase('individual'),
          round: result.round || null,
          scoreA: result.scoreA,
          scoreB: result.scoreB,
          penaltyA: result.penaltyA,
          penaltyB: result.penaltyB,
        },
      });
    }
  }

  // Keyed by pair AND series: the same two teams can meet twice in one event (group
  // stage then playoffs), and merging those would file one series' maps under the other.
  const mapsBySeries = new Map();
  for (const map of parsed.mapDetails) {
    const key = `${normalizedOfficialPair(map.teamA, map.teamB)}#${normalized(map.round)}`;
    const bucket = mapsBySeries.get(key) || [];
    bucket.push(map);
    mapsBySeries.set(key, bucket);
  }
  for (const maps of mapsBySeries.values()) {
    const first = maps[0];
    const match = findOfficialMatch(matches, first);
    if (!match) continue;
    if (persistDetails) {
      await upsertMatchDetails({
        matchId: match.id,
        sourcePage: DETAIL_SOURCE,
        game: tournament.game,
        payload: {
          ...matchDetailsBase('teamSeries'),
          maps: maps.map((map) => ({
            name: map.map || null,
            mode: map.mode || null,
            round: map.round || null,
            pickedBy: map.pickedBy || null,
            scoreA: map.scoreA,
            scoreB: map.scoreB,
            winner: map.winner || null,
            bans: map.banA || map.banB
              ? {
                  a: map.banA ? { hero: map.banA, order: map.banOrderA ?? null } : null,
                  b: map.banB ? { hero: map.banB, order: map.banOrderB ?? null } : null,
                }
              : null,
          })),
        },
      });
    }
    if (tournament.game === 'overwatch') {
      const result = deriveOfficialOverwatchSeriesResult(maps, match);
      if (shouldApplyOfficialOverwatchSeriesResult(match, result, { terminalMatchIds })) {
        await persistAuthoritativeMatchUpdate(
          tournament,
          match,
          {
            teamA: match.team_a,
            teamB: match.team_b,
            scheduledAt: match.scheduled_at,
            ...result,
          },
          matches,
          observedAt,
          ttlSeconds,
          { allowTerminalCorrection: true },
        );
        updatedMatchIds?.add(match.id);
      }
    }
  }

  for (const game of parsed.battleRoyaleGames) {
    const match = detailMatchByLabel(matches, game.label);
    if (!match) continue;
    if (persistDetails) {
      await upsertMatchDetails({
        matchId: match.id,
        sourcePage: DETAIL_SOURCE,
        game: tournament.game,
        payload: {
          ...matchDetailsBase('battleRoyale'),
          gameLabel: game.label,
          standings: game.standings,
        },
      });
    }
  }
}

async function refreshWorkbook(
  workbook,
  tournaments,
  sheetsClient,
  { forceRead = false, liveOnly = false } = {},
) {
  const descriptor = workbookDescriptor(workbook.name);
  if (!descriptor) return { changed: false, reason: 'unsupported' };
  const tournament = resolveOfficialTournament(tournaments, descriptor);
  if (!tournament) return { changed: false, reason: 'unresolved' };

  const workbookKey = opaqueWorkbookKey(workbook.id);
  const modifiedToken = officialWorkbookToken(workbook.modifiedTime);
  const previous = await getOfficialFeedState(workbookKey);
  if (!shouldReadOfficialWorkbook(previous, modifiedToken, { forceRead })) {
    // Undrawn bracket placeholders outlive the workbook edit that replaced them, and the
    // sweep inside the read path never runs for a workbook that stops changing (and is
    // suppressed entirely on live ticks). Sweeping here retires them once per full scan.
    const stale = liveOnly ? 0 : await deleteStaleFinishedMatches(tournament.id, { nowSeconds: Math.floor(Date.now() / 1000) });
    if (stale) {
      logger.info(`[tournament-feed] removed ${stale} stale placeholder match(es) for tournament ${tournament.id}`);
    }
    return { changed: false, reason: 'unchanged' };
  }

  const liveTabs = liveOnly && descriptor.game === 'overwatch'
    ? ['Schedule', 'MATCH INFO MASTER']
    : null;
  const tabs = await sheetsClient.readWorkbook(
    workbook.id,
    liveTabs ? { tabTitles: liveTabs } : undefined,
  );
  const parsed = parseOfficialWorkbook(workbook.name, tabs);
  if (!parsed) return { changed: false, reason: 'unsupported' };
  const hash = contentHash({ parserVersion: OFFICIAL_PARSER_VERSION, parsed });
  if (previous?.content_hash === hash) {
    // Liquipedia is a fallback provider, so its result must not reclaim an
    // unchanged official Overwatch series merely because the short authority
    // lease expired between sheet polls. Reassert the schedule and derived
    // series result without rewriting the already-persisted map payload.
    const renewOverwatchAuthority = descriptor.game === 'overwatch' &&
      (parsed.schedule.length > 0 || parsed.mapDetails.length > 0);
    if (renewOverwatchAuthority) {
      const observedAt = Math.floor(Date.now() / 1000);
      let matches = await listMatchesForTournament(tournament.id);
      const { terminalMatchIds, updatedMatchIds } = await applyScheduleUpdates(
        tournament,
        matches,
        parsed.schedule,
        observedAt,
        config.officialEwcSheets.authorityTtlSeconds,
      );
      await applyDetails(
        tournament,
        matches,
        parsed,
        observedAt,
        config.officialEwcSheets.authorityTtlSeconds,
        { persistDetails: false, terminalMatchIds, updatedMatchIds },
      );
      const stale = liveOnly
        ? 0
        : await deleteStaleFinishedMatches(tournament.id, { nowSeconds: observedAt });
      if (stale) {
        logger.info(`[tournament-feed] removed ${stale} stale finished match(es) for tournament ${tournament.id}`);
        matches = await listMatchesForTournament(tournament.id);
      }
      syncOfficialWatchers(tournament, matches, updatedMatchIds);
    }
    if (previous.modified_token !== modifiedToken) {
      await saveOfficialFeedState({
        workbookKey,
        modifiedToken,
        hash,
        observedAt: Math.floor(Date.now() / 1000),
      });
    }
    return {
      changed: renewOverwatchAuthority,
      reason: renewOverwatchAuthority ? 'authority-renewed' : 'unchanged',
      game: descriptor.game,
      matches: parsed.schedule.length + parsed.individualResults.length,
      standings: parsed.standings.reduce((sum, section) => sum + section.entries.length, 0),
    };
  }

  const observedAt = Math.floor(Date.now() / 1000);
  const ttlSeconds = config.officialEwcSheets.authorityTtlSeconds;
  let matches = await listMatchesForTournament(tournament.id);
  const individualUpdates = liveOnly
    ? []
    : parsed.individualResults.map((result) => ({
        ...result,
        name: `${result.teamA} vs ${result.teamB}`,
        status: 'finished',
        scheduledAt: null,
      }));
  const updates = [...parsed.schedule, ...individualUpdates];
  const { terminalMatchIds, updatedMatchIds } = await applyScheduleUpdates(
    tournament,
    matches,
    updates,
    observedAt,
    ttlSeconds,
  );

  if (!liveOnly && parsed.standings.some((section) => section.entries?.length >= 2)) {
    await replaceTournamentStandings(tournament.id, parsed.standings, {
      authoritative: true,
      observedAt,
      authorityTtlSeconds: ttlSeconds,
    });
  }

  await applyDetails(tournament, matches, parsed, observedAt, ttlSeconds, {
    terminalMatchIds,
    updatedMatchIds,
  });
  const stale = liveOnly
    ? 0
    : await deleteStaleFinishedMatches(tournament.id, { nowSeconds: observedAt });
  if (stale) {
    logger.info(`[tournament-feed] removed ${stale} stale finished match(es) for tournament ${tournament.id}`);
    matches = await listMatchesForTournament(tournament.id);
  }
  syncOfficialWatchers(tournament, matches, updatedMatchIds);
  if (!liveOnly) {
    await upsertOfficialTournamentOverview(
      tournament.id,
      { ...parsed.overview, attribution: ATTRIBUTION },
      { observedAt, ttlSeconds },
    );
  }
  await saveOfficialFeedState({ workbookKey, modifiedToken, hash, observedAt });
  return {
    changed: true,
    game: tournament.game,
    matches: parsed.schedule.length + parsed.individualResults.length,
    standings: parsed.standings.reduce((sum, section) => sum + section.entries.length, 0),
  };
}

async function selectFastPollWorkbooks(workbooks, tournaments) {
  const selected = [];
  const nowSeconds = Math.floor(Date.now() / 1000);
  for (const workbook of workbooks) {
    const descriptor = workbookDescriptor(workbook.name);
    if (!descriptor) continue;
    const tournament = resolveOfficialTournament(tournaments, descriptor);
    if (!tournament) continue;
    const matches = await listMatchesForTournament(tournament.id);
    const hasRunningMatch = matches.some((match) => match?.status === 'running');
    if (
      shouldFastPollOfficialWorkbook(matches, {
        nowSeconds,
        lookaheadSeconds: config.officialEwcSheets.liveLookaheadSeconds,
      })
    ) {
      selected.push({ ...workbook, fastPollPriority: hasRunningMatch ? 0 : 1 });
    }
  }
  return selected.sort((left, right) => left.fastPollPriority - right.fastPollPriority);
}

// The live poller reads one workbook per tick, so the rotation length IS each
// workbook's refresh latency. The fast-poll predicate admits anything scheduled within
// hours, which during an EWC week is most of the folder — rotating over all of them
// stretches a 2s tick into a ~34s wait for the event actually being played. Rotate
// inside the running tier when one exists, and fall back to the full list otherwise.
export function liveRotationWorkbooks(workbooks) {
  const live = (workbooks || []).filter((entry) => entry?.fastPollPriority === 0);
  return live.length ? live : workbooks || [];
}

function safeFeedFailure(error) {
  const status = Number(error?.status);
  return Number.isInteger(status) ? ` (${status})` : '';
}

export async function refreshOfficialEwcSheets() {
  if (!config.officialEwcSheets.enabled || running) return;
  running = true;
  try {
    client ||= createOfficialSheetsClient({
      clientEmail: config.officialEwcSheets.clientEmail,
      privateKey: config.officialEwcSheets.privateKey,
    });
    const [workbooks, tournaments] = await Promise.all([
      client.listWorkbooks(config.officialEwcSheets.folderId),
      listActiveTournaments(),
    ]);
    cachedTournaments = tournaments;
    const orderedWorkbooks = await prioritizeOfficialWorkbooks(workbooks, tournaments);
    let changed = 0;
    const reasons = new Map();
    for (const workbook of orderedWorkbooks) {
      try {
        const result = await refreshWorkbook(workbook, tournaments, client);
        reasons.set(result.reason || 'refreshed', (reasons.get(result.reason || 'refreshed') || 0) + 1);
        if (result.changed) {
          changed += 1;
          logger.info(
            `[tournament-feed] refreshed ${result.game}: ${result.matches} matches, ${result.standings} standings rows`,
          );
        }
      } catch (error) {
        reasons.set('failed', (reasons.get('failed') || 0) + 1);
        logger.warn(`[tournament-feed] workbook refresh failed${safeFeedFailure(error)}`);
      }
    }
    if (changed) logger.info(`[tournament-feed] refresh completed for ${changed} tournament(s)`);
    const summary = [
      `workbooks=${workbooks.length}`,
      `refreshed=${changed}`,
      `unchanged=${reasons.get('unchanged') || 0}`,
      `unresolved=${reasons.get('unresolved') || 0}`,
      `unsupported=${reasons.get('unsupported') || 0}`,
      `failed=${reasons.get('failed') || 0}`,
    ].join(' ');
    if (summary !== lastScanSummary) {
      logger.info(`[tournament-feed] scan completed: ${summary}`);
      lastScanSummary = summary;
    }
    fastPollWorkbooks = await selectFastPollWorkbooks(workbooks, tournaments);
    fastPollCursor = 0;
  } catch {
    logger.warn('[tournament-feed] refresh failed');
  } finally {
    running = false;
  }
}

export async function refreshLiveOfficialEwcSheets() {
  if (!config.officialEwcSheets.enabled || running || !fastPollWorkbooks.length) return;
  running = true;
  try {
    client ||= createOfficialSheetsClient({
      clientEmail: config.officialEwcSheets.clientEmail,
      privateKey: config.officialEwcSheets.privateKey,
    });
    const tournaments = cachedTournaments.length
      ? cachedTournaments
      : await listActiveTournaments();
    const rotation = liveRotationWorkbooks(fastPollWorkbooks);
    if (fastPollCursor >= rotation.length) fastPollCursor = 0;
    const workbook = rotation[fastPollCursor];
    fastPollCursor = (fastPollCursor + 1) % rotation.length;
    try {
      // Formula-backed cells can recalculate without changing Drive modifiedTime.
      // Live polling must read the values; the content hash still suppresses writes.
      const descriptor = workbookDescriptor(workbook.name);
      const result = await refreshWorkbook(workbook, tournaments, client, {
        forceRead: true,
        liveOnly: descriptor?.game === 'overwatch',
      });
      if (result.changed) {
        logger.info(
          `[tournament-feed] live refresh ${result.game}: ${result.matches} matches, ${result.standings} standings rows`,
        );
      }
    } catch (error) {
      logger.warn(`[tournament-feed] live workbook refresh failed${safeFeedFailure(error)}`);
    }
  } catch {
    logger.warn('[tournament-feed] live refresh failed');
  } finally {
    running = false;
  }
}

export function startOfficialEwcSheets() {
  if (!config.officialEwcSheets.enabled) return null;
  if (
    !config.officialEwcSheets.folderId ||
    !config.officialEwcSheets.clientEmail ||
    !config.officialEwcSheets.privateKey
  ) {
    logger.warn('[tournament-feed] enabled but credentials are incomplete');
    return null;
  }
  const boot = setTimeout(
    () => refreshOfficialEwcSheets(),
    config.officialEwcSheets.bootDelayMs,
  );
  boot.unref?.();
  const interval = setInterval(
    () => refreshOfficialEwcSheets(),
    config.officialEwcSheets.pollMs,
  );
  interval.unref?.();
  const liveInterval = setInterval(
    () => refreshLiveOfficialEwcSheets(),
    config.officialEwcSheets.livePollMs,
  );
  liveInterval.unref?.();
  return interval;
}

export const officialTournamentAttribution = ATTRIBUTION;
