/**
 * Public tournaments API route tests.
 *
 * Strategy:
 *  - Real temp SQLite DB (same per-run temp file as setup.ts), seeded via the
 *    bot's @bot/db read/write helpers.
 *  - Set EWC_DASHBOARD_DEFAULT_GUILD_ID so defaultPublicGuildId() resolves to our
 *    seeded guild — the routes read it at request time.
 *  - Assert response shapes, status grouping, finished-list pagination/clamping,
 *    and 400 on a non-numeric id.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, test, vi } from "vitest";

const GUILD_ID = "111111111111111111";

vi.mock("@/lib/request-locale", () => ({
  getRequestLocale: async () => "en",
}));

import { GET as listGET } from "@/app/api/tournaments/route";
import { GET as matchesGET } from "@/app/api/tournaments/[id]/matches/route";
import TournamentArchivePage from "@/app/tournaments/archive/page";
import { listArchivedTournamentSummaries } from "@/lib/tournaments";

function matchesReq(query = ""): Request {
  return new Request(`http://localhost/api/tournaments/x/matches${query}`);
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

let tournamentId: number;
let organizerTaggedTournamentId: number;
let archivedTournamentId: number;
let newestArchivedTournamentId: number;

async function seed(): Promise<void> {
  // Bootstrap the SQLite schema on the shared connection. The tournaments/matches
  // modules now read through the unified async client (which never imports index.js),
  // so nothing else in this test would create the tables — mirror the bot-side ported
  // tests that import index.js up front (e.g. tests/ewcRateLimits.test.mjs).
  await import("@bot/db/index.js");
  const { addTournament, archiveTournament, updateTournamentEwc } = await import("@bot/db/tournaments.js");
  const { upsertMatch } = await import("@bot/db/matches.js");

  const tournament = (await addTournament({
    source: "liquipedia",
    external_id: `EWC/2026/Test-${Date.now()}`,
    game: "cs2",
    name: "EWC 2026 — Test CS2",
    url: "https://liquipedia.net/counterstrike/EWC/2026",
    guild_id: GUILD_ID,
  })) as { id: number };
  tournamentId = tournament.id;

  const organizerTagged = (await addTournament({
    source: "liquipedia",
    external_id: `apexlegends/Apex_Legends_Global_Series/2026/Split_1/Playoffs-${Date.now()}`,
    game: "apexlegends",
    name: "Apex Legends Global Series: 2026 Split 1 Playoffs",
    url: "https://liquipedia.net/apexlegends/Apex_Legends_Global_Series/2026/Split_1/Playoffs",
    guild_id: GUILD_ID,
  })) as { id: number };
  organizerTaggedTournamentId = organizerTagged.id;
  await updateTournamentEwc(organizerTaggedTournamentId, true);

  const base = { tournament_id: tournamentId, source: "liquipedia" };
  // 1 running, 2 scheduled, 5 finished, plus one parser duplicate that should be hidden by public reads.
  await upsertMatch({ ...base, external_id: `Match:run-${tournamentId}`, team_a: "Falcons", team_b: "T1", score_a: 1, score_b: 0, status: "running", scheduled_at: 1_900_000_000 });
  await upsertMatch({ ...base, external_id: `Widget:run-dupe-${tournamentId}`, team_a: "T1", team_b: "Falcons", status: "scheduled", scheduled_at: 1_900_000_300 });
  await upsertMatch({ ...base, external_id: `Match:sch1-${tournamentId}`, team_a: "Vitality", team_b: "NAVI", status: "scheduled", scheduled_at: 1_900_100_000 });
  await upsertMatch({ ...base, external_id: `Match:sch2-${tournamentId}`, team_a: "G2", team_b: "FaZe", status: "scheduled", scheduled_at: 1_900_200_000 });
  for (let i = 0; i < 5; i += 1) {
    await upsertMatch({
      ...base,
      external_id: `Match:fin${i}-${tournamentId}`,
      team_a: `A${i}`,
      team_b: `B${i}`,
      score_a: 2,
      score_b: i % 2,
      status: "finished",
      scheduled_at: 1_800_000_000 + i * 3600,
    });
  }

  for (let i = 0; i < 13; i += 1) {
    const archived = (await addTournament({
      source: "liquipedia",
      external_id: `Archive/Test-${Date.now()}-${i}`,
      game: "valorant",
      name: `Archived Test ${i}`,
      url: `https://liquipedia.net/valorant/Archive/Test_${i}`,
      guild_id: GUILD_ID,
    })) as { id: number };
    if (i === 0) archivedTournamentId = archived.id;
    if (i === 12) newestArchivedTournamentId = archived.id;
    await upsertMatch({
      tournament_id: archived.id,
      source: "liquipedia",
      external_id: `Match:archive-${i}`,
      team_a: `Archive A${i}`,
      team_b: `Archive B${i}`,
      score_a: 2,
      score_b: 1,
      status: "finished",
      scheduled_at: 1_810_000_000 + i * 3600,
    });
    await archiveTournament(archived.id, GUILD_ID, 1_820_000_000 + i);
  }
}

beforeAll(async () => {
  process.env.EWC_DASHBOARD_DEFAULT_GUILD_ID = GUILD_ID;
  await seed();
});

describe("GET /api/tournaments", () => {
  test("returns the seeded tournament with per-status match counts", async () => {
    const res = await listGET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.tournaments)).toBe(true);
    const t = body.tournaments.find((row: { id: number }) => row.id === tournamentId);
    expect(t).toBeTruthy();
    expect(t.game).toBe("cs2");
    expect(t.matchCounts).toEqual({ running: 1, scheduled: 2, finished: 5 });
  });

  test("excludes archived tournaments from the active tournament list", async () => {
    const res = await listGET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tournaments.some((row: { id: number }) => row.id === archivedTournamentId)).toBe(false);
  });

  test("uses stored organizer-based EWC flag for non-EWC page names", async () => {
    const res = await listGET();
    expect(res.status).toBe(200);
    const body = await res.json();
    const t = body.tournaments.find((row: { id: number }) => row.id === organizerTaggedTournamentId);
    expect(t).toBeTruthy();
    expect(t.ewc).toBe(true);
  });
});

describe("GET /api/tournaments/[id]/matches", () => {
  test("groups matches by status with the tournament header and total", async () => {
    const res = await matchesGET(matchesReq(), ctx(String(tournamentId)));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tournament.id).toBe(tournamentId);
    expect(body.tournament.url).toContain("liquipedia.net");
    expect(body.matches.running).toHaveLength(1);
    expect(body.matches.scheduled).toHaveLength(2);
    expect(body.matches.finished).toHaveLength(5);
    expect(body.total).toBe(8);
    // finished ordered most-recent-first (scheduled_at DESC)
    const finishedTimes = body.matches.finished.map((m: { scheduled_at: number }) => m.scheduled_at);
    expect(finishedTimes).toEqual([...finishedTimes].sort((a, b) => b - a));
  });

  test("still serves archived tournament detail data", async () => {
    const res = await matchesGET(matchesReq(), ctx(String(archivedTournamentId)));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tournament.id).toBe(archivedTournamentId);
    expect(body.matches.running).toHaveLength(0);
    expect(body.matches.scheduled).toHaveLength(0);
    expect(body.matches.finished).toHaveLength(1);
    expect(body.total).toBe(1);
  });

  test("clamps limit on the finished list (limit=2 returns 2)", async () => {
    const res = await matchesGET(matchesReq("?limit=2"), ctx(String(tournamentId)));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.matches.finished).toHaveLength(2);
    // running/scheduled are always returned in full regardless of limit
    expect(body.matches.running).toHaveLength(1);
    expect(body.matches.scheduled).toHaveLength(2);
  });

  test("over-max limit is clamped to 200, not rejected", async () => {
    const res = await matchesGET(matchesReq("?limit=99999"), ctx(String(tournamentId)));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.matches.finished).toHaveLength(5);
  });

  test("offset paginates the finished list", async () => {
    const all = await (await matchesGET(matchesReq(), ctx(String(tournamentId)))).json();
    const page2 = await (await matchesGET(matchesReq("?limit=2&offset=2"), ctx(String(tournamentId)))).json();
    expect(page2.matches.finished).toHaveLength(2);
    expect(page2.matches.finished[0].id).toBe(all.matches.finished[2].id);
  });

  test("400 on a non-numeric id", async () => {
    const res = await matchesGET(matchesReq(), ctx("not-a-number"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  test("400 on a zero/negative id", async () => {
    const res = await matchesGET(matchesReq(), ctx("0"));
    expect(res.status).toBe(400);
  });

  test("404 for an unknown tournament id", async () => {
    const res = await matchesGET(matchesReq(), ctx("99999999"));
    expect(res.status).toBe(404);
  });
});

describe("tournaments archive", () => {
  test("lists archived tournaments newest-finished-first with offset pagination", async () => {
    const firstPage = await listArchivedTournamentSummaries({ limit: 2 });
    expect(firstPage).toHaveLength(2);
    expect(firstPage[0].id).toBe(newestArchivedTournamentId);
    expect(firstPage[0].name).toBe("Archived Test 12");
    expect(firstPage[0].matchCounts).toEqual({ running: 0, scheduled: 0, finished: 1 });

    const secondPage = await listArchivedTournamentSummaries({ limit: 2, offset: 2 });
    expect(secondPage).toHaveLength(2);
    expect(secondPage[0].name).toBe("Archived Test 10");
  });

  test("renders the archive route with cards and older/newer pagination", async () => {
    const firstPage = await TournamentArchivePage({
      searchParams: Promise.resolve({ page: "1" }),
    });
    const firstHtml = renderToStaticMarkup(firstPage);
    expect(firstHtml).toContain("Finished tournaments");
    expect(firstHtml).toContain("Archived Test 12");
    expect(firstHtml).toContain("Older");
    expect(firstHtml).not.toContain("Newer");

    const secondPage = await TournamentArchivePage({
      searchParams: Promise.resolve({ page: "2" }),
    });
    const secondHtml = renderToStaticMarkup(secondPage);
    expect(secondHtml).toContain("Archived Test 0");
    expect(secondHtml).toContain("Newer");
  });
});
