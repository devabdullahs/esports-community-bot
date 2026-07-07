import assert from 'node:assert/strict';
import test from 'node:test';

process.env.LOG_LEVEL = 'error';
process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = 'test-client-id';
process.env.DB_PATH = ':memory:';

const {
  renderAllGamesStatusCard,
  renderCardForMatch,
  renderMatchCard,
  renderScheduleCard,
  renderStatusCard,
} = await import('../src/lib/matchCard.js');

function assertPng(buf) {
  assert.ok(Buffer.isBuffer(buf) && buf.length > 1000, 'non-empty buffer');
  assert.deepEqual([...buf.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], 'PNG magic');
}

const baseTime = 1_783_500_000;

function matchRow(overrides = {}) {
  return {
    id: 1,
    game: 'overwatch2',
    source: 'test',
    external_id: 'test:match:1',
    tournament_name: 'EWC Test Cup',
    team_a: 'Falcons',
    team_b: 'Twisted Minds',
    logo_a: null,
    logo_b: null,
    scheduled_at: baseTime,
    status: 'scheduled',
    score_a: null,
    score_b: null,
    ...overrides,
  };
}

test('match card renderers return PNG buffers', async () => {
  assertPng(
    await renderScheduleCard({
      title: 'Upcoming Matches',
      subtitle: 'Riyadh schedule',
      accent: 'rgba(88,101,242,0.65)',
      matches: [
        matchRow(),
        matchRow({ id: 2, team_a: 'Ninjas in Pyjamas', team_b: 'Team Liquid', scheduled_at: baseTime + 3600 }),
        matchRow({ id: 3, team_a: 'Group A - Game 1', team_b: 'Lobby', scheduled_at: baseTime + 7200 }),
      ],
    }),
  );

  assertPng(renderAllGamesStatusCard({ live: [], upcoming: [matchRow(), matchRow({ id: 2 })], updatedAt: baseTime * 1000 }));

  assertPng(
    renderAllGamesStatusCard({
      live: [matchRow({ status: 'running', score_a: 1, score_b: 0 })],
      upcoming: [matchRow({ id: 2, scheduled_at: baseTime + 3600 })],
      updatedAt: baseTime * 1000,
    }),
  );

  assertPng(
    await renderMatchCard({
      tournament: 'EWC Test Cup',
      subtitle: 'Upper bracket',
      timeText: '18:00',
      scoreText: 'VS',
      teamA: 'Falcons',
      teamB: 'Twisted Minds',
      logoA: null,
      logoB: null,
      accent: 'rgba(88,101,242,0.65)',
      nextText: 'All times UTC+3',
    }),
  );

  assertPng(await renderCardForMatch(matchRow()));

  assertPng(
    renderStatusCard({
      title: 'Match cards',
      subtitle: 'Renderer check',
      statusText: 'No live matches',
      detail: 'Cards will update automatically.',
    }),
  );
});
