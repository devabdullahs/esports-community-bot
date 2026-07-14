export const PUBLIC_SEARCH_KINDS = [
  "game",
  "tournament",
  "match",
  "team",
  "player",
  "news",
] as const;

export type PublicSearchKind = (typeof PUBLIC_SEARCH_KINDS)[number];

type PublicSearchResultBase<Kind extends PublicSearchKind> = {
  kind: Kind;
  id: string | number;
  title: string;
  subtitle: string;
  href: string;
  imageUrl?: string;
};

export type PublicSearchResult = {
  [Kind in PublicSearchKind]: PublicSearchResultBase<Kind>;
}[PublicSearchKind];

export type PublicSearchGroups = {
  [Kind in PublicSearchKind]: Array<Extract<PublicSearchResult, { kind: Kind }>>;
};

export type PublicSearchResponse = {
  results: PublicSearchGroups;
};
