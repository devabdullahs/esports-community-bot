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
  parseBroadcasterStreams,
  parseMatchInfo,
  parseMatchlistMatch,
  parseSwissMatches,
  streamChannelFromUrl,
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
  fetchTournamentBroadcasters,
  fetchValveRegionalStandings,
  resolveTournamentTitle,
} from './liquipedia/fetchers.js';
