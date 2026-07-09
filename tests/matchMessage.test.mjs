import assert from 'node:assert/strict';
import test from 'node:test';

process.env.LOG_LEVEL = 'error';
process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = 'test-client-id';
process.env.DB_PATH = ':memory:';

const { selectAllGamesStatusMatches } = await import('../src/lib/matchMessage.js');

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
