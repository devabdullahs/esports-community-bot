import assert from 'node:assert/strict';
import test from 'node:test';

process.env.LOG_LEVEL = 'error';
process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = 'test-client-id';
process.env.DB_PATH = ':memory:';

const { buildMatchEmbed, selectAllGamesStatusMatches } = await import('../src/lib/matchMessage.js');

const baseTime = 1_783_500_000;

function matchRow(overrides = {}) {
  return {
    id: 1,
    game: 'dota2',
    source: 'liquipedia',
    external_id: `test:${overrides.id ?? 1}`,
    tournament_name: 'Esports World Cup 2026',
    tournament_path: 'dota2/Esports_World_Cup/2026',
    team_a: 'Team A',
    team_b: 'Team B',
    status: 'scheduled',
    scheduled_at: baseTime,
    score_a: null,
    score_b: null,
    ...overrides,
  };
}

function fatalFuryRow(overrides = {}) {
  return matchRow({
    game: 'fighters',
    tournament_name: 'Fatal Fury: City of the Wolves - Esports World Cup 2026',
    tournament_path: 'fighters/Esports_World_Cup/2026/CotW',
    ...overrides,
  });
}

test('all-games live status keeps a fighting-game player match beyond the old five-row cap', () => {
  const matches = [
    matchRow({ id: 1, game: 'valorant', team_a: 'Team Heretics', team_b: 'BBL Esports', status: 'running', scheduled_at: baseTime }),
    matchRow({ id: 2, game: 'dota2', team_a: 'L1GA TEAM', team_b: 'Aurora Gaming', status: 'running', scheduled_at: baseTime + 60 }),
    matchRow({ id: 3, game: 'dota2', team_a: 'PlayTime', team_b: 'Level UP', status: 'running', scheduled_at: baseTime + 120 }),
    matchRow({ id: 4, game: 'dota2', team_a: 'Nigma Galaxy', team_b: 'Team Liquid', status: 'running', scheduled_at: baseTime + 180 }),
    matchRow({ id: 5, game: 'apexlegends', team_a: 'Group Stage - B vs C - Game 4', team_b: 'Lobby', status: 'running', scheduled_at: baseTime + 240 }),
    fatalFuryRow({ id: 6, team_a: 'H-DOPE', team_b: 'Kindevu', status: 'running', scheduled_at: baseTime + 300 }),
  ];

  const { live } = selectAllGamesStatusMatches(matches, { liveLimit: 5 });

  assert.ok(live.some((m) => m.team_a === 'H-DOPE' && m.team_b === 'Kindevu'));
  assert.equal(live.length, 6);
});

test('all-games upcoming treats fighting-game player pairings as distinct rows', () => {
  const matches = [
    fatalFuryRow({ id: 1, team_a: 'Mi2ha4', team_b: 'Senaru', scheduled_at: baseTime }),
    matchRow({ id: 2, game: 'dota2', team_a: 'MOUZ', team_b: 'Team Nemesis', scheduled_at: baseTime + 60 }),
    matchRow({ id: 3, game: 'valorant', team_a: 'Gentle Mates', team_b: 'NRG', scheduled_at: baseTime + 120 }),
    fatalFuryRow({ id: 4, team_a: 'H-DOPE', team_b: 'Kindevu', scheduled_at: baseTime + 180 }),
    matchRow({ id: 5, game: 'apexlegends', team_a: 'Group Stage - B vs C - Game 6', team_b: 'Lobby', scheduled_at: baseTime + 240 }),
  ];

  const { upcoming } = selectAllGamesStatusMatches(matches, { upcomingLimit: 3 });

  assert.deepEqual(
    upcoming.map((m) => `${m.team_a} vs ${m.team_b}`),
    ['Mi2ha4 vs Senaru', 'MOUZ vs Team Nemesis', 'Gentle Mates vs NRG', 'H-DOPE vs Kindevu'],
  );
});

test('sheet-backed match embeds include the required official attribution', () => {
  const embed = buildMatchEmbed(
    matchRow({
      status: 'finished',
      score_a: 2,
      score_b: 1,
      official_authoritative: 1,
    }),
    'match.png',
  );

  assert.match(
    embed.toJSON().description,
    /\*\*\*© Esports Foundation 2026\. All rights reserved\.\*\*\*/,
  );
  assert.equal(embed.toJSON().footer?.text, 'Data from Liquipedia — CC-BY-SA 3.0');
});

// The all-games status card stopped updating in production on 2026-07-31: every refresh
// threw "Invalid string length" because the embed description had grown past Discord's
// 4096-character limit. ensureFightingGameMatches appends EVERY fighting-game match
// after the cap has already been applied, so an SF6 bracket full of "Time TBD"
// placeholders pushed the card over the edge and froze it.
test('an SF6 bracket cannot grow the all-games status past Discord limits', async () => {
  const { buildAllGamesStatusDescription } = await import('../src/lib/matchMessage.js');
  const matches = [
    matchRow({ id: 1, game: 'counterstrike', team_a: 'Astralis', team_b: 'PaiN Gaming', status: 'running' }),
    matchRow({ id: 2, game: 'callofduty', team_a: 'Group B - Game 9', team_b: 'Lobby', status: 'running' }),
  ];
  // A full double-elimination bracket of undrawn slots, exactly the shape that broke it.
  for (let index = 0; index < 40; index += 1) {
    matches.push(
      fatalFuryRow({
        id: 100 + index,
        tournament_name: 'Street Fighter 6 - Esports World Cup 2026',
        team_a: `Loser of UB ${index}.1`,
        team_b: `Winner of LB ${index}.2`,
        scheduled_at: null,
      }),
    );
  }

  const { live, upcoming } = selectAllGamesStatusMatches(matches);
  assert.ok(upcoming.length <= 20, `upcoming stayed bounded, got ${upcoming.length}`);
  assert.ok(upcoming.some((m) => m.game === 'fighters'), 'fighting-game matches are still surfaced');

  const description = buildAllGamesStatusDescription(live, upcoming);
  assert.ok(
    description.length <= 4096,
    `description must fit Discord's embed limit, got ${description.length}`,
  );
});
