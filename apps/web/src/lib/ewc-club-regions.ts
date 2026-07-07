export const CLUB_REGION_IDS = [
  "all",
  "gulf",
  "west_asia_africa",
  "europe",
  "north_america",
  "south_america",
  "asia_pacific",
  "other",
] as const;

export type ClubRegionId = (typeof CLUB_REGION_IDS)[number];

export type ClubRegionProfile = {
  location?: string | null;
  nationality?: string | null;
  facts?: Record<string, unknown> | null;
};

const FEATURED_REGION_ENTRIES: Array<{
  region: Exclude<ClubRegionId, "all">;
  names: string[];
}> = [
  {
    region: "gulf",
    names: [
      "Team Falcons",
      "Falcons",
      "Twisted Minds",
      "Geekay Esports",
      "Geekay",
      "AlUla Club",
      "Al Ula",
      "Al-Ula",
      "Alula",
      "Al Qadsiah",
      "Al-Qadsiah",
      "Al Qadsiah Esports",
      "AlQadsiah Esports",
      "Qadsiah",
      "NASR Esports",
      "NASR",
      "Nasr Esports",
      "Nasr eSports",
      "R8 Esports",
      "R8",
      "ROC Esports",
      "ROC",
      "Team Stallions",
      "Stallions",
      "Team Vision",
      "Vision Esports",
      "Vision",
    ],
  },
  {
    region: "west_asia_africa",
    names: ["FUT Esports", "FUT"],
  },
  {
    region: "europe",
    names: [
      "Fnatic",
      "G2 Esports",
      "G2",
      "Gentle Mates",
      "HEROIC",
      "MOUZ",
      "Natus Vincere",
      "NAVI",
      "NIP.eStar",
      "Ninjas in Pyjamas",
      "Team Heretics",
      "Team Liquid",
      "Liquid",
      "Team Secret",
      "Team Spirit",
      "Team Vitality",
      "Vitality",
      "Virtus.pro",
    ],
  },
  {
    region: "north_america",
    names: ["100 Thieves", "Cloud9", "C9", "NRG", "NRG Esports", "Sentinels"],
  },
  {
    region: "south_america",
    names: [
      "9z Globant",
      "9z Gaming",
      "9z",
      "Alpha7 Esports",
      "Alpha7",
      "Fluxo W7M",
      "Fluxo",
      "FURIA",
      "Leviatan",
      "Leviatan Esports",
      "LOUD",
      "paiN Gaming",
    ],
  },
  {
    region: "asia_pacific",
    names: [
      "AG.AL",
      "AG.AL Esports International",
      "All Gamers",
      "Edward Gaming",
      "EDG",
      "GAM Esports",
      "Gen.G",
      "Gen.G Esports",
      "GodLike Esports",
      "GodLike",
      "JD Gaming",
      "JDG",
      "ONIC",
      "ONIC Esports",
      "REJECT",
      "Rex Regum Qeon",
      "Team RRQ",
      "RRQ",
      "S8UL",
      "S8UL Esports",
      "T1",
      "Titan Esports Club",
      "Weibo Gaming",
      "Wolves Esports",
      "ZETA DIVISION",
      "ZETA",
    ],
  },
];

const REGION_BY_CLUB_KEY = new Map<string, Exclude<ClubRegionId, "all">>();
const FEATURED_CLUB_KEYS = new Set<string>();

for (const entry of FEATURED_REGION_ENTRIES) {
  for (const name of entry.names) {
    for (const key of clubKeys(name)) {
      REGION_BY_CLUB_KEY.set(key, entry.region);
      FEATURED_CLUB_KEYS.add(key);
    }
  }
}

const COUNTRY_CODE_REGION: Record<string, Exclude<ClubRegionId, "all">> = {
  AE: "gulf",
  BH: "gulf",
  KW: "gulf",
  OM: "gulf",
  QA: "gulf",
  SA: "gulf",
  DZ: "west_asia_africa",
  EG: "west_asia_africa",
  IL: "west_asia_africa",
  IQ: "west_asia_africa",
  IR: "west_asia_africa",
  JO: "west_asia_africa",
  LB: "west_asia_africa",
  MA: "west_asia_africa",
  PS: "west_asia_africa",
  SY: "west_asia_africa",
  TN: "west_asia_africa",
  TR: "west_asia_africa",
  YE: "west_asia_africa",
  CA: "north_america",
  MX: "north_america",
  US: "north_america",
  AR: "south_america",
  BR: "south_america",
  CL: "south_america",
  CO: "south_america",
  PE: "south_america",
  CN: "asia_pacific",
  HK: "asia_pacific",
  ID: "asia_pacific",
  IN: "asia_pacific",
  JP: "asia_pacific",
  KR: "asia_pacific",
  MY: "asia_pacific",
  PH: "asia_pacific",
  SG: "asia_pacific",
  TH: "asia_pacific",
  TW: "asia_pacific",
  VN: "asia_pacific",
};

const LOCATION_PATTERNS: Array<{
  region: Exclude<ClubRegionId, "all">;
  test: RegExp;
}> = [
  {
    region: "gulf",
    test: /\b(saudi|saudi arabia|ksa|united arab emirates|uae|emirates|qatar|kuwait|bahrain|oman)\b/i,
  },
  {
    region: "west_asia_africa",
    test: /\b(mena|middle east|west asia|africa|north africa|turkey|turkiye|egypt|morocco|tunisia|algeria|jordan|lebanon|iraq|iran|israel|palestine|syria|yemen)\b/i,
  },
  {
    region: "europe",
    test: /\b(europe|france|germany|spain|portugal|netherlands|sweden|norway|denmark|finland|poland|ukraine|russia|serbia|united kingdom|uk|england|italy|belgium|romania|czech|croatia|bosnia)\b/i,
  },
  {
    region: "north_america",
    test: /\b(north america|united states|usa|u\.s\.a\.|canada|mexico)\b/i,
  },
  {
    region: "south_america",
    test: /\b(south america|latin america|latam|brazil|argentina|chile|peru|colombia|venezuela|uruguay|paraguay|bolivia|ecuador)\b/i,
  },
  {
    region: "asia_pacific",
    test: /\b(asia|asia-pacific|apac|china|korea|south korea|japan|india|indonesia|philippines|thailand|vietnam|malaysia|singapore|taiwan|hong kong)\b/i,
  },
];

export function cleanClubRegion(value: unknown): ClubRegionId {
  return typeof value === "string" && (CLUB_REGION_IDS as readonly string[]).includes(value)
    ? (value as ClubRegionId)
    : "gulf";
}

export function clubKey(value: unknown) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u200b-\u200f\ufeff]/g, "")
    .replace(/&/g, " and ")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function clubKeys(value: unknown) {
  const base = clubKey(value);
  if (!base) return [];
  const noTeamPrefix = base.replace(/^team\s+/, "");
  const noEsportsSuffix = base.replace(/\s+esports$/, "");
  const compact = base.replace(/[^a-z0-9]+/g, "");
  return [...new Set([base, noTeamPrefix, noEsportsSuffix, compact].filter(Boolean))];
}

export function isFeaturedClubName(name: unknown) {
  return clubKeys(name).some((key) => FEATURED_CLUB_KEYS.has(key));
}

export function regionFromLocation(value: unknown): Exclude<ClubRegionId, "all"> | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  const codeRegion = COUNTRY_CODE_REGION[trimmed.toUpperCase()];
  if (codeRegion) return codeRegion;
  for (const pattern of LOCATION_PATTERNS) {
    if (pattern.test.test(trimmed)) return pattern.region;
  }
  return null;
}

function stringFact(facts: Record<string, unknown> | null | undefined, key: string) {
  const value = facts?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function classifyClubRegion(
  name: unknown,
  profile: ClubRegionProfile | null | undefined = null,
): Exclude<ClubRegionId, "all"> {
  const curated = clubKeys(name)
    .map((key) => REGION_BY_CLUB_KEY.get(key))
    .find(Boolean);
  if (curated) return curated;

  const facts = profile?.facts ?? null;
  const fromProfile =
    regionFromLocation(profile?.location) ??
    regionFromLocation(stringFact(facts, "location")) ??
    regionFromLocation(stringFact(facts, "country")) ??
    regionFromLocation(stringFact(facts, "region")) ??
    regionFromLocation(profile?.nationality);

  return fromProfile ?? "other";
}
