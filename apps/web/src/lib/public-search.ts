import "server-only";

import { listPlayersDirectory, listTeamsDirectory } from "@/lib/entity-directory";
import { listGamesCached, type GameRecord } from "@/lib/games";
import { localizedPath, type Locale } from "@/lib/i18n";
import { searchPublishedNewsPostsCached, type NewsPost } from "@/lib/news";
import {
  publicDirectoryPlayer,
  publicDirectoryTeam,
} from "@/lib/public-directory-projections";
import {
  type PublicSearchGroups,
  type PublicSearchKind,
  type PublicSearchResponse,
  type PublicSearchResult,
} from "@/lib/public-search-types";
import { listTournamentSummariesCached, type TournamentSummary } from "@/lib/tournaments";

export { PUBLIC_SEARCH_KINDS } from "@/lib/public-search-types";
export type {
  PublicSearchGroups,
  PublicSearchKind,
  PublicSearchResponse,
  PublicSearchResult,
} from "@/lib/public-search-types";

export const PUBLIC_SEARCH_QUERY_MAX_LENGTH = 80;
export const PUBLIC_SEARCH_GROUP_LIMIT = 5;
export const PUBLIC_SEARCH_TOTAL_LIMIT = 24;

type SearchQuery = { value: string; normalized: string };
type RankedResult = { result: PublicSearchResult; rank: number; order: number };

function cleanText(value: unknown, maxLength = 180): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maxLength);
}

export function normalizePublicSearchText(value: unknown): string {
  return cleanText(value, PUBLIC_SEARCH_QUERY_MAX_LENGTH).toLocaleLowerCase();
}

export function parsePublicSearchQuery(value: unknown): SearchQuery | null {
  if (typeof value !== "string") return null;
  const clean = cleanText(value, PUBLIC_SEARCH_QUERY_MAX_LENGTH + 1);
  if (
    [...clean].length < 2 ||
    [...clean].length > PUBLIC_SEARCH_QUERY_MAX_LENGTH ||
    /[\u0000-\u001f\u007f%_]/u.test(clean)
  ) {
    return null;
  }
  return { value: clean, normalized: normalizePublicSearchText(clean) };
}

function localizedText(value: GameRecord["title"], locale: Locale) {
  return cleanText(value[locale] || value.en || value.ar);
}

function safeSegment(value: string | number) {
  return encodeURIComponent(String(value).trim());
}

export function publicSearchHref(pathname: string, locale: Locale) {
  const path = pathname.split(/[?#]/u, 1)[0] || "/";
  return localizedPath(path.startsWith("/") ? path : `/${path}`, locale).split(/[?#]/u, 1)[0] || "/";
}

function newsHref(post: NewsPost, locale: Locale) {
  if (post.mediaSlug) {
    return publicSearchHref(`/media/${safeSegment(post.mediaSlug)}/news/${post.id}`, locale);
  }
  if (post.gameSlug) {
    return publicSearchHref(`/games/${safeSegment(post.gameSlug)}/news/${post.id}`, locale);
  }
  return publicSearchHref(`/news/${post.id}`, locale);
}

function matchTitle(summary: TournamentSummary) {
  const match = summary.featuredMatch;
  if (!match) return "";
  return cleanText(match.name || [match.team_a, match.team_b].filter(Boolean).join(" vs "));
}

function resultRank(query: string, values: Array<string | null | undefined>) {
  let contains = false;
  for (const value of values) {
    const text = normalizePublicSearchText(value);
    if (!text) continue;
    if (text.startsWith(query)) return 0;
    if (text.includes(query)) contains = true;
  }
  return contains ? 1 : null;
}

function rankResults(
  query: string,
  candidates: Array<{ result: PublicSearchResult; values: Array<string | null | undefined> }>,
) {
  const ranked: RankedResult[] = [];
  for (const [order, candidate] of candidates.entries()) {
    const rank = resultRank(query, candidate.values);
    if (rank !== null) ranked.push({ result: candidate.result, rank, order });
  }
  return ranked
    .sort((left, right) => left.rank - right.rank || left.order - right.order)
    .slice(0, PUBLIC_SEARCH_GROUP_LIMIT)
    .map(({ result }) => result);
}

export function emptyPublicSearchGroups(): PublicSearchGroups {
  return {
    game: [],
    tournament: [],
    match: [],
    team: [],
    player: [],
    news: [],
  };
}

function groupResults<Kind extends PublicSearchKind>(kind: Kind, results: PublicSearchResult[]) {
  return results.filter((result): result is Extract<PublicSearchResult, { kind: Kind }> => result.kind === kind);
}

export async function getPublicSearchResults(
  rawQuery: string,
  locale: Locale,
): Promise<PublicSearchResponse> {
  const query = parsePublicSearchQuery(rawQuery);
  if (!query) throw new TypeError("Invalid public search query.");

  const [games, tournaments, teamDirectory, playerDirectory, publishedNews] = await Promise.all([
    listGamesCached(),
    listTournamentSummariesCached(),
    listTeamsDirectory({ q: query.value, limit: 100, offset: 0 }),
    listPlayersDirectory({ q: query.value, limit: 100, offset: 0 }),
    searchPublishedNewsPostsCached(query.value, locale, "", "", false, 24, 0),
  ]);

  const gameResults = rankResults(
    query.normalized,
    games.map((game) => {
      const title = localizedText(game.title, locale);
      return {
        result: {
          kind: "game" as const,
          id: game.slug,
          title,
          subtitle: localizedText(game.status, locale),
          href: publicSearchHref(`/games/${safeSegment(game.slug)}`, locale),
        },
        values: [title, game.slug],
      };
    }),
  );

  const tournamentResults = rankResults(
    query.normalized,
    tournaments.map((tournament) => {
      const title = cleanText(tournament.name);
      return {
        result: {
          kind: "tournament" as const,
          id: tournament.id,
          title,
          subtitle: cleanText(tournament.game),
          href: publicSearchHref(`/tournaments/${tournament.id}`, locale),
        },
        values: [title, tournament.game],
      };
    }),
  );

  const matchResults = rankResults(
    query.normalized,
    tournaments.flatMap((tournament) => {
      const match = tournament.featuredMatch;
      if (!match) return [];
      const title = matchTitle(tournament);
      if (!title) return [];
      return [{
        result: {
          kind: "match" as const,
          id: match.id,
          title,
          subtitle: cleanText(tournament.name),
          href: publicSearchHref(`/tournaments/${tournament.id}`, locale),
        },
        values: [title, match.team_a, match.team_b, tournament.name, tournament.game],
      }];
    }),
  );

  const teamResults = rankResults(
    query.normalized,
    teamDirectory.teams.map((team) => {
      const safe = publicDirectoryTeam(team);
      return {
        result: {
          kind: "team" as const,
          id: safe.id,
          title: cleanText(safe.name),
          subtitle: cleanText(safe.game),
          href: publicSearchHref(`/teams/${safe.id}`, locale),
        },
        values: [safe.name, safe.slug, safe.acronym, safe.game],
      };
    }),
  );

  const playerResults = rankResults(
    query.normalized,
    playerDirectory.players.map((player) => {
      const safe = publicDirectoryPlayer(player);
      return {
        result: {
          kind: "player" as const,
          id: safe.id,
          title: cleanText(safe.name),
          subtitle: cleanText(safe.current_team_name || safe.game || safe.role),
          href: publicSearchHref(`/players/${safe.id}`, locale),
        },
        values: [safe.name, safe.slug, safe.first_name, safe.last_name, safe.current_team_name, safe.game],
      };
    }),
  );

  const newsResults = rankResults(
    query.normalized,
    publishedNews.map((post) => ({
      result: {
        kind: "news" as const,
        id: post.id,
        title: cleanText(post.title),
        subtitle: cleanText(post.summary || post.gameSlug),
        href: newsHref(post, locale),
      },
      values: [post.title, post.summary, post.body],
    })),
  );

  let remaining = PUBLIC_SEARCH_TOTAL_LIMIT;
  const game = groupResults("game", gameResults).slice(0, Math.min(PUBLIC_SEARCH_GROUP_LIMIT, remaining));
  remaining -= game.length;
  const tournament = groupResults("tournament", tournamentResults).slice(0, Math.min(PUBLIC_SEARCH_GROUP_LIMIT, remaining));
  remaining -= tournament.length;
  const match = groupResults("match", matchResults).slice(0, Math.min(PUBLIC_SEARCH_GROUP_LIMIT, remaining));
  remaining -= match.length;
  const team = groupResults("team", teamResults).slice(0, Math.min(PUBLIC_SEARCH_GROUP_LIMIT, remaining));
  remaining -= team.length;
  const player = groupResults("player", playerResults).slice(0, Math.min(PUBLIC_SEARCH_GROUP_LIMIT, remaining));
  remaining -= player.length;
  const news = groupResults("news", newsResults).slice(0, Math.min(PUBLIC_SEARCH_GROUP_LIMIT, remaining));

  return { results: { game, tournament, match, team, player, news } };
}
