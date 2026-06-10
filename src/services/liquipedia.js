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
  parseEwcEventSchedule,
  parseEwcPlayerList,
  parseMatchInfo,
  parseMatchlistMatch,
  parseSwissMatches,
  valveRankingRegions,
} from './liquipedia/parsers.js';

export {
  fetchClubChampionship,
  fetchEwcClubStandings,
  fetchEwcClubs,
  fetchEwcEventSchedule,
  fetchEwcPlayerList,
  fetchGameMatches,
  fetchSchedule,
  fetchValveRegionalStandings,
  resolveTournamentTitle,
} from './liquipedia/fetchers.js';
