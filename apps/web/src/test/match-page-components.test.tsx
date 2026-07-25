import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import {
  BattleRoyaleResults,
  DotaGames,
  MatchDetailTabs,
} from "@/components/matches/match-detail-tabs";
import { MatchHeader } from "@/components/matches/match-header";
import { copy } from "@/lib/i18n";
import type {
  BattleRoyaleDetails,
  DotaDetails,
  MatchPageModel,
} from "@/lib/match-details";

function matchModel(overrides: Partial<MatchPageModel> = {}): MatchPageModel {
  return {
    id: 42,
    source: "liquipedia",
    externalId: "Match:fixture",
    status: "scheduled",
    winnerSide: null,
    resultReason: null,
    teamA: "A very long Alpha team name",
    teamB: null,
    logoA: null,
    logoB: null,
    scoreA: null,
    scoreB: null,
    scheduledAt: 1_800_000_000,
    stream: { platform: "twitch", url: "https://twitch.tv/official" },
    coStreams: [],
    tournament: {
      id: 7,
      name: "Fixture Championship",
      game: "valorant",
      source: "liquipedia",
      url: "https://liquipedia.net/valorant/Fixture",
    },
    details: null,
    ...overrides,
  };
}

describe("match destination components", () => {
  test("keeps a thin scheduled match useful with context, watch, and reminder actions", () => {
    const html = renderToStaticMarkup(
      <MatchHeader
        model={matchModel()}
        locale="en"
        gameTitle="Valorant"
        reminderState={{ signedIn: false, reminderMatchIds: [] }}
        callbackPath="/matches/42"
      />,
    );

    expect(html).toContain('href="/tournaments/7"');
    expect(html).toContain("Fixture Championship");
    expect(html).toContain("Valorant");
    expect(html).toContain("Scheduled");
    expect(html).toContain('href="https://liquipedia.net/valorant/Fixture"');
    expect(html).toContain('href="https://twitch.tv/official"');
    expect(html).toContain("Watch now");
    expect(html).toContain("Set match reminder");
    expect(html).toContain("TBD");
    expect(html).toContain('title="A very long Alpha team name"');
  });

  test("renders localized Arabic Dota details with shadcn accordions and named tables", () => {
    const details: DotaDetails = {
      kind: "dota2",
      patch: null,
      casters: [],
      games: [{
        number: 1,
        winner: "a",
        duration: "31:18",
        sides: { a: "radiant", b: "dire" },
        draft: {
          a: { picks: [], bans: [] },
          b: { picks: [], bans: [] },
        },
        teamStats: {
          a: { kills: 20, deaths: 10, assists: 40, gold: "80K", towers: 5, barracks: 1, roshans: 2 },
          b: { kills: 10, deaths: 20, assists: 20, gold: "60K", towers: 2, barracks: 0, roshans: 0 },
        },
        players: {
          a: [{ name: "Alpha", hero: "Axe", kills: 5, deaths: 1, assists: 8, dmg: "20K", lhdn: "200/10", net: "18K", gpm: 600 }],
          b: [{ name: "Bravo", hero: "Puck", kills: 2, deaths: 5, assists: 4, dmg: "10K", lhdn: "120/5", net: "11K", gpm: 420 }],
        },
      }],
    };
    const tabsHtml = renderToStaticMarkup(
      <MatchDetailTabs details={details} teamA="Alpha" teamB="Bravo" locale="ar" />,
    );
    const detailsHtml = renderToStaticMarkup(
      <DotaGames
        details={details}
        teamA="Alpha"
        teamB="Bravo"
        locale="ar"
        text={copy.ar.tournaments}
      />,
    );

    expect(tabsHtml).toContain("\u0623\u0642\u0633\u0627\u0645 \u062a\u0641\u0627\u0635\u064a\u0644 \u0627\u0644\u0645\u0628\u0627\u0631\u0627\u0629");
    expect(detailsHtml).toContain("\u0627\u0644\u0630\u0647\u0628");
    expect(detailsHtml).toContain("\u0627\u0644\u0644\u0627\u0639\u0628");
    expect(detailsHtml).toContain("\u0627\u0644\u0628\u0637\u0644");
    expect(detailsHtml).toContain('data-slot="accordion"');
    expect(detailsHtml).toContain('data-slot="accordion-trigger"');
    expect(detailsHtml).toContain('role="region"');
    expect(detailsHtml).toContain('tabindex="0"');
  });

  test("renders localized PUBG per-game points with shadcn table and avatars", () => {
    const details: BattleRoyaleDetails = {
      kind: "battle-royale",
      patch: null,
      casters: [],
      gameNumber: 11,
      entries: [
        {
          rank: 1,
          team: "Twisted Minds",
          logo: "https://liquipedia.net/commons/images/team.png",
          placement: 1,
          kills: 8,
          points: 18,
        },
        {
          rank: 2,
          team: "Team Falcons",
          logo: null,
          placement: 2,
          kills: 5,
          points: 11,
        },
      ],
    };
    const html = renderToStaticMarkup(
      <BattleRoyaleResults details={details} text={copy.ar.tournaments} />,
    );

    expect(html).toContain("Twisted Minds");
    expect(html).toContain("Team Falcons");
    expect(html).toContain(">18<");
    expect(html).toContain("\u0627\u0644\u0646\u0642\u0627\u0637");
    expect(html).toContain("\u0627\u0644\u0625\u0642\u0635\u0627\u0621\u0627\u062a");
    expect(html).toContain('data-slot="table"');
    expect(html).toContain('data-slot="avatar"');
  });
});
