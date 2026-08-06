import type {
  BracketMatchInput,
  BracketRoundKind,
  BracketWinner,
  TournamentBracket,
} from "@/lib/tournament-brackets";
import { matchWinner, type MatchStatus, type ResultReason } from "@/lib/match-lifecycle";

/**
 * The drawn bracket as a graph.
 *
 * `projectTournamentBracket` reads a *label* off each match row and groups by it. That works
 * only where a round label survives ingest, which for the official EWC tournaments it does
 * not: `matches` has no round column and every provider stores `name = "<A> vs <B>"`. The
 * official sheets, meanwhile, are read as a real draw — sections, rounds as columns, slots,
 * and feeder edges taken from cell text ("Winner of UB 2.1") rather than from bracket
 * arithmetic — and persisted whole under `tournament_overviews.payload_json.bracket`.
 *
 * This module turns that persisted graph into the model the view renders, and adapts the
 * label projection into the same model so the view has exactly one rendering path.
 */

export type DrawOutcome = "winner" | "loser";
/** `declared` was read off the sheet; `traced` follows a decided team into a later slot. */
export type DrawEdgeKind = "declared" | "traced";
export type DrawBranch = "upper" | "lower" | null;

export type DrawAwaiting = { outcome: DrawOutcome; slot: string };

export type DrawEdge = {
  from: string;
  to: string;
  /** Which side of the receiving slot this feeds. */
  side: "a" | "b";
  outcome: DrawOutcome;
  kind: DrawEdgeKind;
};

export type DrawSlot = {
  key: string;
  label: string | null;
  branch: DrawBranch;
  teamA: string | null;
  teamB: string | null;
  /** Set when a side names its feeder instead of a team, so it renders as a chip. */
  awaitingA: DrawAwaiting | null;
  awaitingB: DrawAwaiting | null;
  logoA: string | null;
  logoB: string | null;
  scoreA: number | null;
  scoreB: number | null;
  status: MatchStatus;
  winner: BracketWinner;
  /** Why the result stands — a walkover or forfeit reads differently from a played score. */
  resultReason: ResultReason;
  /** Present only when the slot joined a stored match row; otherwise the card is not a link. */
  matchId: number | null;
};

export type DrawRound = {
  key: string;
  /** The sheet column this round was drawn in — the author already aligned the branches. */
  column: number;
  title: string | null;
  branch: DrawBranch;
  bestOf: number | null;
  /** Set only in fallback mode, where the round was recognized well enough to be localized. */
  phase: { kind: BracketRoundKind; number: number | null; roundOf: number | null } | null;
  slots: DrawSlot[];
};

export type DrawSection = {
  key: string;
  title: string | null;
  rounds: DrawRound[];
  edges: DrawEdge[];
};

export type TournamentDraw = {
  sections: DrawSection[];
  source: "sheet" | "labels";
};

const ATTRIBUTION = "© Esports Foundation 2026. All rights reserved.";
const MAX_SECTIONS = 12;
const MAX_ROUNDS_PER_SECTION = 16;
const MAX_SLOTS_PER_ROUND = 64;
const PLACEHOLDER_RE = /^(?:tbd|t\.b\.d\.?|q|qualifier)$/i;
const SOURCE_RE = /\b(?:winner|loser)\s+of\b/i;

type RawGroup = {
  column?: unknown;
  section?: unknown;
  title?: unknown;
  bracket?: unknown;
  bestOf?: unknown;
  slots?: unknown;
};

export type DrawMatchRow = Pick<
  BracketMatchInput,
  "id" | "team_a" | "team_b" | "logo_a" | "logo_b" | "score_a" | "score_b" | "status"
> &
  Partial<Pick<BracketMatchInput, "winner_side" | "result_reason">>;

export type ProjectDrawOptions = {
  /**
   * The bot's `normalizeTeamName`, which carries the cross-source aliases. Injected rather
   * than imported so this module stays free of `@bot/*` and can ship to the client.
   */
  normalizeName?: (value: string | null | undefined) => string;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Same discipline `publicTournamentOverview` applies: sheet text is untrusted input. */
function drawText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text || text.length > max) return null;
  if (/https?:\/\/|docs\.google|drive\.google|spreadsheets\/d\//i.test(text)) return null;
  return text;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function defaultNormalizeName(value: string | null | undefined): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/^team\s+/, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

/** A slot key ignores the parenthetical the sheet hangs off a label ("LB 2.2 (loser out)"). */
function slotKeyOf(label: string | null): string {
  return String(label ?? "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

export function isPlaceholderCompetitor(value: string | null | undefined): boolean {
  const text = String(value ?? "").trim();
  if (!text) return true;
  return PLACEHOLDER_RE.test(text) || SOURCE_RE.test(text);
}

function awaitingOf(value: unknown): DrawAwaiting | null {
  const source = record(value);
  const outcome = drawText(source?.outcome, 12)?.toLowerCase();
  const slot = drawText(source?.slot, 60);
  if (!slot || (outcome !== "winner" && outcome !== "loser")) return null;
  return { outcome, slot };
}

function branchOf(value: unknown): DrawBranch {
  const kind = drawText(value, 12)?.toLowerCase();
  return kind === "upper" || kind === "lower" ? kind : null;
}

function statusOf(value: unknown): MatchStatus {
  const status = drawText(value, 16)?.toLowerCase();
  return status === "running" || status === "finished" ? status : "scheduled";
}

function winnerOf(slot: { scoreA: number | null; scoreB: number | null; status: MatchStatus }): BracketWinner {
  if (slot.status !== "finished" || slot.scoreA == null || slot.scoreB == null) return null;
  if (slot.scoreA === slot.scoreB) return "draw";
  return slot.scoreA > slot.scoreB ? "a" : "b";
}

type SlotIndexEntry = { slot: DrawSlot; column: number; ambiguous: boolean };

/**
 * Reads the persisted draw. Returns null — leaving the caller on the label projection — for
 * anything that fails the attribution gate, the shape checks, or the sanitizer, so bad or
 * hostile sheet content degrades to exactly today's site rather than to a wrong bracket.
 */
export function projectTournamentDraw(
  row: { payload?: unknown; updatedAt?: string | null } | null | undefined,
  matchRows: readonly DrawMatchRow[] = [],
  options: ProjectDrawOptions = {},
): TournamentDraw | null {
  const payload = record(row?.payload);
  if (!payload || payload.attribution !== ATTRIBUTION) return null;
  const groups = Array.isArray(payload.bracket) ? (payload.bracket as RawGroup[]) : null;
  if (!groups?.length) return null;

  const normalizeName = options.normalizeName ?? defaultNormalizeName;
  const bySection = new Map<string, { title: string | null; rounds: DrawRound[] }>();

  groups.forEach((raw, groupIndex) => {
    const group = record(raw);
    if (!group) return;
    const rawSlots = Array.isArray(group.slots) ? group.slots : [];
    if (!rawSlots.length) return;

    const title = drawText(group.title, 80);
    const sectionTitle = drawText(group.section, 80);
    const sectionKey = slotKeyOf(sectionTitle) || "draw";
    const roundBranch = branchOf(group.bracket);
    const column = finiteNumber(group.column) ?? groupIndex;

    const slots: DrawSlot[] = [];
    for (const rawSlot of rawSlots.slice(0, MAX_SLOTS_PER_ROUND)) {
      const entry = record(rawSlot);
      if (!entry) continue;
      const teamA = drawText(entry.teamA, 80);
      const teamB = drawText(entry.teamB, 80);
      if (!teamA && !teamB) continue;
      const label = drawText(entry.label, 60);
      const awaitingA = awaitingOf(entry.sourceA);
      const awaitingB = awaitingOf(entry.sourceB);
      const status = statusOf(entry.status);
      const scoreA = finiteNumber(entry.scoreA);
      const scoreB = finiteNumber(entry.scoreB);
      const base = {
        key: `${groupIndex}-${slots.length}`,
        label,
        branch: branchOf(entry.bracket) ?? roundBranch,
        // A side that names its feeder is not a competitor, so it carries no team name.
        teamA: awaitingA || isPlaceholderCompetitor(teamA) ? null : teamA,
        teamB: awaitingB || isPlaceholderCompetitor(teamB) ? null : teamB,
        awaitingA,
        awaitingB,
        logoA: null,
        logoB: null,
        scoreA,
        scoreB,
        status,
        resultReason: "unknown" as ResultReason,
        matchId: null,
      };
      slots.push({ ...base, winner: winnerOf({ scoreA, scoreB, status }) });
    }
    if (!slots.length) return;

    const section = bySection.get(sectionKey) ?? { title: sectionTitle, rounds: [] };
    if (section.rounds.length >= MAX_ROUNDS_PER_SECTION) return;
    section.rounds.push({
      key: `${sectionKey}-${groupIndex}`,
      column,
      title,
      branch: roundBranch,
      bestOf: finiteNumber(group.bestOf),
      phase: null,
      slots,
    });
    if (!bySection.has(sectionKey)) bySection.set(sectionKey, section);
  });

  const sections: DrawSection[] = [];
  for (const [key, section] of [...bySection].slice(0, MAX_SECTIONS)) {
    const rounds = [...section.rounds].sort((a, b) => a.column - b.column);
    sections.push({ key, title: section.title, rounds, edges: resolveEdges(rounds, normalizeName) });
  }
  if (!sections.length) return null;

  joinMatchRows(sections, matchRows, normalizeName);
  return { sections, source: "sheet" };
}

/**
 * Both edge kinds come from complete information: an edge the sheet wrote down, or a team
 * that literally appears in two slots. Ambiguity produces no edge, because a wrong connector
 * asserts a result that never happened.
 */
function resolveEdges(
  rounds: readonly DrawRound[],
  normalizeName: (value: string | null | undefined) => string,
): DrawEdge[] {
  const byLabel = new Map<string, SlotIndexEntry>();
  for (const round of rounds) {
    for (const slot of round.slots) {
      const key = slotKeyOf(slot.label);
      if (!key) continue;
      const existing = byLabel.get(key);
      if (existing) existing.ambiguous = true;
      else byLabel.set(key, { slot, column: round.column, ambiguous: false });
    }
  }

  const edges: DrawEdge[] = [];
  const seen = new Set<string>();
  const push = (edge: DrawEdge) => {
    const id = `${edge.from}>${edge.to}:${edge.side}`;
    if (seen.has(id)) return;
    seen.add(id);
    edges.push(edge);
  };

  for (const round of rounds) {
    for (const slot of round.slots) {
      for (const side of ["a", "b"] as const) {
        const awaiting = side === "a" ? slot.awaitingA : slot.awaitingB;
        if (awaiting) {
          const source = byLabel.get(slotKeyOf(awaiting.slot));
          // A reference into another section, a typo, or a duplicated label resolves to
          // nothing; the side still renders its awaiting chip.
          if (source && !source.ambiguous && source.slot.key !== slot.key) {
            push({ from: source.slot.key, to: slot.key, side, outcome: awaiting.outcome, kind: "declared" });
          }
          continue;
        }
        const team = side === "a" ? slot.teamA : slot.teamB;
        const traced = traceSource(team, round, rounds, normalizeName);
        if (traced) push({ ...traced, to: slot.key, side, kind: "traced" });
      }
    }
  }
  return edges;
}

/** Where a decided slot in an earlier column produced this team. */
function traceSource(
  team: string | null,
  round: DrawRound,
  rounds: readonly DrawRound[],
  normalizeName: (value: string | null | undefined) => string,
): { from: string; outcome: DrawOutcome } | null {
  const key = normalizeName(team);
  if (!key) return null;

  let bestColumn: number | null = null;
  let found: { from: string; outcome: DrawOutcome } | null = null;
  for (const earlier of rounds) {
    if (earlier.column >= round.column) continue;
    if (bestColumn != null && earlier.column < bestColumn) continue;
    for (const slot of earlier.slots) {
      if (slot.winner !== "a" && slot.winner !== "b") continue;
      const isA = normalizeName(slot.teamA) === key;
      const isB = normalizeName(slot.teamB) === key;
      if (!isA && !isB) continue;
      if (bestColumn === earlier.column && found) return null; // two candidates in one column
      bestColumn = earlier.column;
      const won = (isA && slot.winner === "a") || (isB && slot.winner === "b");
      found = { from: slot.key, outcome: won ? "winner" : "loser" };
    }
  }
  return found;
}

/**
 * Joins a slot to the stored match row for the same fixture, which carries the link target,
 * the logos, and the authority-leased score. Matched on the unordered normalized pair, the
 * same reading the sheets job uses, so the sides may be drawn either way round.
 */
function joinMatchRows(
  sections: readonly DrawSection[],
  matchRows: readonly DrawMatchRow[],
  normalizeName: (value: string | null | undefined) => string,
): void {
  const byPair = new Map<string, DrawMatchRow[]>();
  for (const row of matchRows) {
    const a = normalizeName(row.team_a);
    const b = normalizeName(row.team_b);
    if (!a || !b) continue;
    const pair = [a, b].sort().join("|");
    const bucket = byPair.get(pair);
    if (bucket) bucket.push(row);
    else byPair.set(pair, [row]);
  }

  const taken = new Set<number>();
  for (const section of sections) {
    for (const round of section.rounds) {
      for (const slot of round.slots) {
        const a = normalizeName(slot.teamA);
        const b = normalizeName(slot.teamB);
        if (!a || !b) continue;
        const candidates = (byPair.get([a, b].sort().join("|")) ?? []).filter((row) => !taken.has(row.id));
        // Teams meet twice — group stage then playoffs, or a grand-final reset — so an
        // ambiguous pair is disambiguated by the score and otherwise left unlinked.
        const row = candidates.length === 1 ? candidates[0] : scoreMatch(candidates, slot, normalizeName);
        if (!row) continue;
        taken.add(row.id);
        slot.matchId = row.id;
        const flipped = normalizeName(row.team_a) === b && normalizeName(row.team_b) === a && a !== b;
        slot.logoA = (flipped ? row.logo_b : row.logo_a) ?? null;
        slot.logoB = (flipped ? row.logo_a : row.logo_b) ?? null;
        const rowScoreA = flipped ? row.score_b : row.score_a;
        const rowScoreB = flipped ? row.score_a : row.score_b;
        if (rowScoreA != null || rowScoreB != null) {
          slot.scoreA = rowScoreA ?? null;
          slot.scoreB = rowScoreB ?? null;
        }
        slot.status = row.status;
        slot.resultReason = row.result_reason ?? "unknown";
        const winner = matchWinner(row);
        slot.winner = flipped && (winner === "a" || winner === "b") ? (winner === "a" ? "b" : "a") : winner;
      }
    }
  }
}

function scoreMatch(
  candidates: readonly DrawMatchRow[],
  slot: DrawSlot,
  normalizeName: (value: string | null | undefined) => string,
): DrawMatchRow | null {
  if (slot.scoreA == null || slot.scoreB == null) return null;
  const wanted = [slot.scoreA, slot.scoreB].sort((x, y) => x - y).join("|");
  const hits = candidates.filter(
    (row) =>
      row.score_a != null &&
      row.score_b != null &&
      [row.score_a, row.score_b].sort((x, y) => x - y).join("|") === wanted &&
      normalizeName(row.team_a) !== "",
  );
  return hits.length === 1 ? hits[0] : null;
}

/**
 * The label projection wrapped in the same model: one section, sequential columns, every slot
 * already joined, and no edges — matches within a round are time-sorted rather than
 * draw-sorted, so any feeder line drawn here would be confidently wrong.
 */
export function drawFromLabelProjection(bracket: TournamentBracket): TournamentDraw {
  const rounds: DrawRound[] = bracket.rounds.map((round, index) => ({
    key: round.key,
    column: index,
    title: round.label,
    branch: round.branch,
    bestOf: null,
    phase: { kind: round.kind, number: round.number, roundOf: round.roundOf },
    slots: round.matches.map((match) => ({
      key: `m${match.id}`,
      label: null,
      branch: round.branch,
      teamA: match.team_a,
      teamB: match.team_b,
      awaitingA: null,
      awaitingB: null,
      logoA: match.logo_a,
      logoB: match.logo_b,
      scoreA: match.score_a,
      scoreB: match.score_b,
      status: match.status,
      winner: match.winner,
      resultReason: match.result_reason ?? "unknown",
      matchId: match.id,
    })),
  }));
  return { sections: [{ key: "draw", title: null, rounds, edges: [] }], source: "labels" };
}
