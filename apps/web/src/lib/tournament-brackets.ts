export type BracketMatchStatus = "running" | "scheduled" | "finished";
export type BracketWinner = "a" | "b" | "draw" | null;

export type BracketMatchInput = {
  id: number;
  name?: string | null;
  /** A public, display-safe stage label when the source data provides one. */
  round?: string | null;
  /** Accepted for callers that still use the upstream naming. */
  stage?: string | null;
  /** Server-only callers may use this to derive a safe `round` label. */
  external_id?: string | null;
  team_a: string | null;
  team_b: string | null;
  team_a_id?: number | null;
  team_b_id?: number | null;
  logo_a: string | null;
  logo_b: string | null;
  score_a: number | null;
  score_b: number | null;
  status: BracketMatchStatus;
  scheduled_at: number | null;
  has_details?: boolean;
};

export type BracketRoundKind =
  | "numeric"
  | "round-of"
  | "quarterfinal"
  | "semifinal"
  | "final"
  | "grand-final"
  | "third-place"
  | "upper"
  | "lower";

export type BracketRound = {
  key: string;
  /** The source label, retained for a non-standard but still recognizable round. */
  label: string;
  kind: BracketRoundKind;
  branch: "upper" | "lower" | null;
  number: number | null;
  roundOf: number | null;
  matches: Array<Omit<BracketMatchInput, "external_id" | "stage"> & { winner: BracketWinner }>;
};

export type TournamentBracket = {
  rounds: BracketRound[];
};

type RoundDescriptor = Omit<BracketRound, "matches"> & { sortOrder: number };

const GROUP_FORMAT_RE = /\b(?:group|swiss|league|round\s*robin|pool|lobby)\b/i;
const MATCHUP_RE = /\b(?:vs\.?|versus)\b/i;
const EXTERNAL_ROUND_RE = /(?:^|[_:\s-])r(?:ound)?[_\s-]?0*(\d{1,2})(?=[_:\s-]|$)/i;

function cleanLabel(value: string | null | undefined): string | null {
  const label = String(value ?? "").replace(/\s+/g, " ").trim();
  return label || null;
}

function roundNumber(value: string): number | null {
  const match = value.match(/\b(?:round|r)\s*0*(\d{1,2})\b/i);
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function roundOf(value: string): number | null {
  const match = value.match(/\bround\s+of\s+(\d{1,3})\b/i);
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isSafeInteger(number) && number > 1 ? number : null;
}

function normalizedKey(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

function phaseOrder(kind: BracketRoundKind, number: number | null, of: number | null): number {
  if (kind === "round-of") return 1_000 - (of ?? 0);
  if (kind === "quarterfinal") return 2_000;
  if (kind === "semifinal") return 3_000;
  if (kind === "final") return 4_000;
  if (kind === "grand-final") return 60_000;
  if (kind === "third-place") return 50_000;
  if (kind === "numeric") return number ?? Number.MAX_SAFE_INTEGER;
  return 0;
}

function descriptorForLabel(value: string | null | undefined): RoundDescriptor | null {
  const label = cleanLabel(value);
  if (!label || GROUP_FORMAT_RE.test(label)) return null;

  const normalized = label.toLocaleLowerCase();
  const branch = /\bupper\s+bracket\b/i.test(label)
    ? "upper"
    : /\blower\s+bracket\b/i.test(label)
      ? "lower"
      : null;
  const number = roundNumber(label);
  const of = roundOf(label);

  let kind: BracketRoundKind | null = null;
  if (/\bgrand\s*finals?\b/i.test(label)) {
    kind = "grand-final";
  } else if (/\b(?:third|3rd|bronze)\b.*\b(?:place|match|final)\b/i.test(label)) {
    kind = "third-place";
  } else if (/\b(?:semi[-\s]?finals?)\b/i.test(label)) {
    kind = "semifinal";
  } else if (/\b(?:quarter[-\s]?finals?)\b/i.test(label)) {
    kind = "quarterfinal";
  } else if (of != null) {
    kind = "round-of";
  } else if (/\bfinals?\b/i.test(label)) {
    kind = "final";
  } else if (number != null) {
    kind = "numeric";
  } else if (branch === "upper") {
    kind = "upper";
  } else if (branch === "lower") {
    kind = "lower";
  }

  if (!kind) return null;
  const branchOrder = branch === "upper" ? 0 : branch === "lower" ? 10_000 : 20_000;
  const sortOrder = branch ? branchOrder + phaseOrder(kind, number, of) : phaseOrder(kind, number, of);
  return {
    key: normalizedKey(normalized),
    label,
    kind,
    branch,
    number,
    roundOf: of,
    sortOrder,
  };
}

function labelFromExternalId(value: string | null | undefined): string | null {
  const externalId = cleanLabel(value);
  const match = externalId?.match(EXTERNAL_ROUND_RE);
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isSafeInteger(number) && number > 0 ? `Round ${number}` : null;
}

/**
 * Gets a bracket stage from persisted match fields without exposing a provider's
 * raw identifier to public clients. Explicit stage fields win; a match title is
 * only considered when it is itself a stage label, not a team-vs-team title.
 */
export function bracketRoundFromStoredMatch(match: Pick<BracketMatchInput, "round" | "stage" | "name" | "external_id">): string | null {
  for (const candidate of [match.round, match.stage]) {
    if (descriptorForLabel(candidate)) return cleanLabel(candidate);
  }

  const name = cleanLabel(match.name);
  if (name && !MATCHUP_RE.test(name) && descriptorForLabel(name)) return name;
  return labelFromExternalId(match.external_id);
}

function sourceRound(match: BracketMatchInput): string | null {
  return bracketRoundFromStoredMatch(match);
}

function resultWinner(match: BracketMatchInput): BracketWinner {
  if (match.status !== "finished" || match.score_a == null || match.score_b == null) return null;
  if (match.score_a > match.score_b) return "a";
  if (match.score_b > match.score_a) return "b";
  return "draw";
}

function publicBracketMatch(match: BracketMatchInput): BracketRound["matches"][number] {
  return {
    id: match.id,
    name: match.name,
    round: match.round,
    team_a: match.team_a,
    team_b: match.team_b,
    team_a_id: match.team_a_id,
    team_b_id: match.team_b_id,
    logo_a: match.logo_a,
    logo_b: match.logo_b,
    score_a: match.score_a,
    score_b: match.score_b,
    status: match.status,
    scheduled_at: match.scheduled_at,
    has_details: match.has_details,
    winner: resultWinner(match),
  };
}

function compareMatches(a: BracketMatchInput, b: BracketMatchInput): number {
  const aTime = a.scheduled_at;
  const bTime = b.scheduled_at;
  const aKnown = aTime != null && Number.isFinite(aTime);
  const bKnown = bTime != null && Number.isFinite(bTime);
  if (aKnown && bKnown && aTime !== bTime) return aTime - bTime;
  if (aKnown !== bKnown) return aKnown ? -1 : 1;
  return a.id - b.id;
}

function numericRoundsLookLikeBracket(rounds: BracketRound[]): boolean {
  const ordered = [...rounds].sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
  if (ordered.some((round) => round.kind !== "numeric" || round.number == null)) return false;
  return ordered.some((round, index) => index > 0 && round.matches.length < ordered[index - 1].matches.length);
}

/**
 * Projects saved match rows into bracket columns. It deliberately refuses
 * group/Swiss schedules and ambiguous numeric round sequences, leaving those
 * formats to the regular match list.
 */
export function projectTournamentBracket(matches: readonly BracketMatchInput[]): TournamentBracket | null {
  const groups = new Map<string, { descriptor: RoundDescriptor; matches: BracketMatchInput[] }>();

  for (const match of matches) {
    const descriptor = descriptorForLabel(sourceRound(match));
    if (!descriptor) continue;
    const group = groups.get(descriptor.key);
    if (group) {
      group.matches.push(match);
    } else {
      groups.set(descriptor.key, { descriptor, matches: [match] });
    }
  }

  const rounds = [...groups.values()]
    .map(({ descriptor, matches }) => ({
      key: descriptor.key,
      label: descriptor.label,
      kind: descriptor.kind,
      branch: descriptor.branch,
      number: descriptor.number,
      roundOf: descriptor.roundOf,
      sortOrder: descriptor.sortOrder,
      matches: [...matches].sort(compareMatches).map(publicBracketMatch),
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));

  if (rounds.length < 2) return null;
  const publicRounds: BracketRound[] = rounds.map((round) => ({
    key: round.key,
    label: round.label,
    kind: round.kind,
    branch: round.branch,
    number: round.number,
    roundOf: round.roundOf,
    matches: round.matches,
  }));
  const hasNamedEliminationRound = publicRounds.some((round) => round.kind !== "numeric");
  if (!hasNamedEliminationRound && !numericRoundsLookLikeBracket(publicRounds)) return null;

  return { rounds: publicRounds };
}
