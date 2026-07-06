import cron from 'node-cron';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { normalizeTeamName } from '../lib/render.js';
import { listActiveTournaments } from '../db/tournaments.js';
import { listTrackedTeamNamesForGame } from '../db/matches.js';
import { listStandingsTeamNamesForGame } from '../db/tournamentStandings.js';
import {
  createLiquipediaTeam,
  listTeamNamesForGame,
  saveTeamLiquipedia,
  stampTeamLiquipedia,
} from '../db/teams.js';
import {
  clearDroppedRosterPlayers,
  createLiquipediaPlayer,
  listPlayerNamesForGame,
  rememberPlayerLiquipediaUrl,
  savePlayerLiquipedia,
  setPlayerVerifiedTeam,
  stampPlayerLiquipedia,
} from '../db/players.js';
import * as defaultLiquipedia from '../services/liquipedia.js';
import { isPlaceholderTeam } from './pollingManager.js';

let task = null;
let running = false;

// Team/player entity enrichment from Liquipedia, scoped to the tracked scene.
// This is the PRIMARY entity source for games PandaScore doesn't cover (battle
// royale wikis, TFT) and a gap-filler for the rest. Every request rides the
// existing serialized Liquipedia queue (>=30s parse gap, persisted backoff), the
// job is quiet-hours cron only, and each run is capped by a parse budget so a
// run can never occupy the queue for long. Freshness: an entity (hit OR miss)
// is stamped and not retried until the TTL lapses — no thrashing on unresolvable
// names.
function splitName(full) {
  const text = String(full ?? '').trim();
  if (!text) return { firstName: null, lastName: null };
  const parts = text.split(/\s+/);
  return parts.length > 1
    ? { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] }
    : { firstName: text, lastName: null };
}

function isFresh(parsedAt, ttlMs, now) {
  if (!parsedAt) return false;
  const at = Date.parse(`${parsedAt}Z`);
  return Number.isFinite(at) && now - at < ttlMs;
}

// BR/lobby schedule rows stored in `matches` (team_a = "Grand Finals - Game 3",
// "Survival Stage - Match", team_b = "Lobby") are lobby time slots, not teams.
// Searching Liquipedia for them is a guaranteed miss that burns the whole run's
// budget (prod stored 62 such "teams" for pubgmobile alone before this filter).
function isScheduleRowName(name) {
  const text = String(name ?? '').trim();
  return /\bgame\s*\d+\b/i.test(text) || /\s-\s*match$/i.test(text) || /^lobby$/i.test(text);
}

function parseTimeMs(value) {
  if (!value) return null;
  const text = String(value);
  const at = Date.parse(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(text) ? `${text}Z` : text);
  return Number.isFinite(at) ? at : null;
}

function hasRosterRaw(raw) {
  const text = String(raw ?? '');
  return /roster-card/i.test(text) || /table2(?:__|&#95;&#95;)table/i.test(text);
}

function needsRosterBackfill(team, cutoffMs) {
  if (!cutoffMs || !team?.liquipedia_raw || hasRosterRaw(team.liquipedia_raw)) return false;
  const parsedAt = parseTimeMs(team.liquipedia_parsed_at);
  return Boolean(parsedAt && parsedAt < cutoffMs);
}

function isEwcTournament(tournament) {
  const text = `${tournament?.name ?? ''} ${tournament?.external_id ?? ''} ${tournament?.url ?? ''}`.toLowerCase();
  return Number(tournament?.ewc || 0) === 1 || text.includes('esports_world_cup') || text.includes('esports world cup');
}

function playerUrl(wiki, page) {
  return page ? `https://liquipedia.net/${wiki}/${encodeURIComponent(page)}` : null;
}

export async function runLiquipediaEnrichment({
  liquipedia = defaultLiquipedia,
  maxParses = config.liquipedia.enrichMaxParses,
  ttlMs = config.liquipedia.enrichTtlDays * 24 * 60 * 60 * 1000,
  now = Date.now(),
  random = Math.random,
  rosterBackfillBefore = config.liquipedia.rosterBackfillBefore,
} = {}) {
  if (running) {
    logger.debug('[lp-enrich] already running - skipping overlapping run.');
    return { skipped: 'already-running' };
  }
  running = true;
  const summary = {
    games: 0,
    teamsParsed: 0,
    playersParsed: 0,
    rosterBackfilled: 0,
    created: 0,
    misses: 0,
    skippedFresh: 0,
  };
  let budget = Math.max(1, Number(maxParses) || 1);
  const rosterBackfillCutoff = parseTimeMs(rosterBackfillBefore);

  try {
    const tournaments = await listActiveTournaments();
    const ewcGames = new Set(tournaments.filter(isEwcTournament).map((t) => t.game).filter(Boolean));
    const games = [...new Set(tournaments.map((t) => t.game).filter(Boolean))].filter((g) =>
      liquipedia.wikiForGame(g),
    );
    // The budget exhausts most runs, so a STABLE game order starves the tail —
    // prod had zero enrichment for counterstrike/valorant/dota2 after days while
    // the head games re-ran. Shuffle per run: fresh entities skip for free, so
    // progress accumulates across runs no matter where the budget cuts off.
    const shuffle = (items) => {
      for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
      }
    };
    const priorityGames = games.filter((game) => ewcGames.has(game));
    const remainingGames = games.filter((game) => !ewcGames.has(game));
    shuffle(priorityGames);
    shuffle(remainingGames);
    const orderedGames = [...priorityGames, ...remainingGames];

    for (const game of orderedGames) {
      if (budget <= 0) break;
      summary.games += 1;
      const wiki = liquipedia.wikiForGame(game);

      // Existing rows (PandaScore or previous runs) by normalized name, so the
      // tracked-match names below reuse rows instead of creating duplicates.
      const existing = await listTeamNamesForGame(game);
      const byName = new Map();
      for (const row of existing) {
        const key = normalizeTeamName(row.name);
        if (key && !byName.has(key)) byName.set(key, row);
      }

      // Player rows by normalized nick, shared by roster verification (below)
      // and the bio-parse queue — matched before creating to avoid duplicates.
      const existingPlayers = await listPlayerNamesForGame(game);
      const playersByName = new Map();
      for (const row of existingPlayers) {
        const key = normalizeTeamName(row.name);
        if (key && !playersByName.has(key)) playersByName.set(key, row);
      }

      const playerQueue = [];
      const queuedPlayerIds = new Set();
      const queuePlayer = ({ player, page = null, url = null, role = null }) => {
        const resolvedPage = page || liquipedia.pageFromUrl?.(url);
        if (!player?.id || !resolvedPage || queuedPlayerIds.has(player.id)) return;
        queuedPlayerIds.add(player.id);
        playerQueue.push({ player, page: resolvedPage, url: url || playerUrl(wiki, resolvedPage), role });
      };
      const stalePlayers = existingPlayers.filter(
        (player) => player.current_team_id && player.liquipedia_url && !isFresh(player.liquipedia_parsed_at, ttlMs, now),
      );

      // Tracked scene = teams in active tournaments' matches PLUS battle-royale /
      // TFT participants (which live in tournament_standings, not matches), so
      // those events' teams and rosters get enriched too. Dedupe by NORMALIZED
      // name (not exact string) so two aliases of one team — e.g. a match's
      // "Team Falcons" and a standings row's "Falcons" — are processed once,
      // never re-parsing the same team and wasting the Liquipedia budget.
      const [ewcMatchNames, ewcStandingsNames, matchNames, standingsNames] = await Promise.all([
        listTrackedTeamNamesForGame(game, { ewcOnly: true }),
        listStandingsTeamNamesForGame(game, { ewcOnly: true }),
        listTrackedTeamNamesForGame(game),
        listStandingsTeamNamesForGame(game),
      ]);
      const seenTrackedKeys = new Set();
      const ewcTrackedKeys = new Set();
      const priorityNames = [];
      const remainingNames = [];
      const appendNames = (names, { ewc = false } = {}) => {
        for (const name of names) {
          if (isScheduleRowName(String(name ?? ''))) continue;
          const key = normalizeTeamName(name);
          if (!key) continue;
          if (ewc) ewcTrackedKeys.add(key);
          if (seenTrackedKeys.has(key)) continue;
          seenTrackedKeys.add(key);
          (ewc ? priorityNames : remainingNames).push(name);
        }
      };
      appendNames([...ewcMatchNames, ...ewcStandingsNames], { ewc: true });
      appendNames([...matchNames, ...standingsNames]);

      const ewcTeamIds = new Set();
      for (const key of ewcTrackedKeys) {
        const team = byName.get(key);
        if (team?.id) ewcTeamIds.add(team.id);
      }
      const isEwcPlayer = (player) =>
        ewcTeamIds.has(player.current_team_id) || ewcTrackedKeys.has(normalizeTeamName(player.current_team_name));

      const processTeams = async (trackedNames, { ewc = false } = {}) => {
        for (const teamName of trackedNames) {
          if (budget <= 0) break;
          if (isPlaceholderTeam(teamName)) continue;
          const key = normalizeTeamName(teamName);
          if (!key) continue;

          let team = byName.get(key);
          if (!team) {
            team = await createLiquipediaTeam({ game, name: teamName, slug: key });
            byName.set(key, team);
            summary.created += 1;
          }
          if (ewc && team?.id) ewcTeamIds.add(team.id);
          const rosterBackfill = needsRosterBackfill(team, rosterBackfillCutoff);
          if (!rosterBackfill && isFresh(team.liquipedia_parsed_at, ttlMs, now)) {
            summary.skippedFresh += 1;
            continue;
          }
          if (rosterBackfill) summary.rosterBackfilled += 1;

          // Refreshes reuse the stored page URL and skip the search round-trip;
          // only never-resolved names spend a search. EVERY Liquipedia request
          // (search or parse) costs one budget unit, so the cap truly bounds the
          // run's queue occupancy.
          let page = liquipedia.pageFromUrl?.(team.liquipedia_url) ?? null;
          let url = team.liquipedia_url ?? null;
          if (!page) {
            const resolved = await liquipedia.resolveEntityPage(wiki, teamName);
            budget -= 1;
            if (resolved.status === 'transient') continue; // backoff/queue-full: retry next run, no stamp
            if (resolved.status !== 'ok') {
              // Durable miss (search worked, nothing matched): stamp WITHOUT
              // touching any previously stored raw/facts.
              await stampTeamLiquipedia(team.id, {});
              summary.misses += 1;
              continue;
            }
            page = resolved.page;
            url = resolved.url;
          }
          if (budget <= 0) break;
          const entity = await liquipedia.fetchTeamEntity(wiki, page);
          budget -= 1;
          if (!entity) {
            await stampTeamLiquipedia(team.id, { url });
            summary.misses += 1;
            continue;
          }
          await saveTeamLiquipedia(team.id, {
            url,
            raw: entity.raw,
            facts: entity.facts,
            image: entity.image,
            location: entity.normalized.location,
          });
          summary.teamsParsed += 1;

          // Roster precedence: the parsed active roster is the source of truth
          // for who plays here — PandaScore's current_team can lag transfers by
          // months. Verify every member (existing rows included, no budget cost),
          // then clear players our DB still places on this team but who are gone
          // from the roster. Absence is only meaningful when the roster parse was
          // COMPLETE: an empty roster (pageless stub) or a truncated one (parser
          // row cap hit) must never clear anyone.
          const confirmedIds = [];
          for (const member of entity.roster) {
            const memberKey = normalizeTeamName(member.name);
            if (!memberKey) continue;
            const memberUrl = playerUrl(wiki, member.page);
            let player = playersByName.get(memberKey);
            if (!player) {
              player = await createLiquipediaPlayer({
                game,
                name: member.name,
                slug: memberKey,
                currentTeamId: team.id,
                currentTeamName: teamName,
                liquipediaUrl: memberUrl,
              });
              playersByName.set(memberKey, player);
              summary.created += 1;
            } else if (memberUrl && !player.liquipedia_url) {
              player = await rememberPlayerLiquipediaUrl(player.id, memberUrl);
              playersByName.set(memberKey, player);
            }
            await setPlayerVerifiedTeam(player.id, { teamId: team.id, teamName });
            confirmedIds.push(player.id);
            if (member.page) queuePlayer({ player, page: member.page, url: memberUrl, role: member.role });
          }
          if (confirmedIds.length && !entity.rosterTruncated) {
            await clearDroppedRosterPlayers(game, team.id, confirmedIds);
          }
        }
      };

      // Roster players: their rows were created/verified during the roster
      // pass above, and their pages came straight from the team page links, so
      // no search round-trip is needed - just a parse each, budget permitting.
      const drainPlayerQueue = async () => {
        while (playerQueue.length && budget > 0) {
          const member = playerQueue.shift();
          const player = member.player;
          if (isFresh(player.liquipedia_parsed_at, ttlMs, now)) {
            summary.skippedFresh += 1;
            continue;
          }
          const entity = await liquipedia.fetchPlayerEntity(wiki, member.page);
          budget -= 1;
          if (!entity) {
            await stampPlayerLiquipedia(player.id, { url: member.url });
            summary.misses += 1;
            continue;
          }
          const nameParts = splitName(entity.normalized.romanizedName);
          await savePlayerLiquipedia(player.id, {
            url: member.url,
            raw: entity.raw,
            facts: entity.facts,
            image: entity.image,
            nationality: entity.normalized.nationality,
            role: member.role || entity.normalized.role,
            firstName: nameParts.firstName,
            lastName: nameParts.lastName,
          });
          summary.playersParsed += 1;
        }
      };

      await processTeams(priorityNames, { ewc: true });
      for (const player of stalePlayers) {
        if (isEwcPlayer(player)) queuePlayer({ player, url: player.liquipedia_url });
      }
      await drainPlayerQueue();
      for (const player of stalePlayers) {
        if (!isEwcPlayer(player)) queuePlayer({ player, url: player.liquipedia_url });
      }
      await processTeams(remainingNames);
      await drainPlayerQueue();
    }

    logger.info(
      `[lp-enrich] ${summary.teamsParsed} team(s) + ${summary.playersParsed} player(s) parsed across ${summary.games} game(s); ` +
        `${summary.rosterBackfilled} roster backfill(s), ${summary.created} created, ${summary.skippedFresh} fresh, ${summary.misses} misses.`,
    );
    return summary;
  } finally {
    running = false;
  }
}

export function startLiquipediaEnrichment() {
  if (!config.liquipedia.enrichEnabled) {
    logger.info('[lp-enrich] disabled (set LIQUIPEDIA_ENRICH_ENABLED=true to enable).');
    return;
  }
  if (!cron.validate(config.liquipedia.enrichCron)) {
    logger.warn(`[lp-enrich] invalid cron "${config.liquipedia.enrichCron}" - enrichment disabled.`);
    return;
  }
  const runSafe = () => runLiquipediaEnrichment().catch((e) => logger.warn(`[lp-enrich] ${e.message}`));
  task = cron.schedule(config.liquipedia.enrichCron, runSafe, {
    timezone: config.liquipedia.enrichTimezone,
  });
  logger.info(`[lp-enrich] scheduled "${config.liquipedia.enrichCron}" (${config.liquipedia.enrichTimezone}).`);
}

export function stopLiquipediaEnrichment() {
  if (task) {
    task.stop();
    task = null;
  }
}
