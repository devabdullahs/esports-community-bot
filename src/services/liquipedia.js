// Re-export facade. All implementation lives in the sub-modules:
//   liquipedia/parsers.js  — pure HTML parser functions
//   liquipedia/client.js   — HTTP client, throttle, caches
//   liquipedia/fetchers.js — fetch orchestrators (client + parsers)

export { parsePage, searchPages, searchPageUrl } from './liquipedia/client.js';

export {
  parseBracketMatch,
  parseClubPrizepool,
  parseClubStandings,
  parseEwcClubs,
  parseEwcEventPlacements,
  parseEwcEventSchedule,
  parseEwcPlayerList,
  parseMatchInfo,
  parseMatchlistMatch,
  parseMatchStream,
  parseSwissMatches,
  valveRankingRegions,
} from './liquipedia/parsers.js';

export {
  fetchClubChampionship,
  fetchEwcClubStandings,
  fetchEwcClubs,
  fetchEwcEventPlacements,
  fetchEwcEventSchedule,
  fetchEwcPlayerList,
  fetchEwcWeekGameResults,
  fetchGameMatches,
  fetchSchedule,
  fetchValveRegionalStandings,
  fetchEventStandings,
  resolveTournamentTitle,
} from './liquipedia/fetchers.js';

export {
  parseBattleRoyaleStandings,
  parseEventStandings,
  parseGroupTableStandings,
} from './liquipedia/standingsParsers.js';

export {
  fetchPlayerEntity,
  fetchTeamEntity,
  pageFromUrl,
  resolveEntityPage,
  wikiForGame,
} from './liquipedia/entityFetchers.js';

export {
  normalizeEntityFacts,
  parseEntityInfobox,
  parseTeamRoster,
} from './liquipedia/entityParsers.js';
