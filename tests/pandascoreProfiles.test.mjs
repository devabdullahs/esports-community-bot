import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'pandascore-profiles-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.LOG_LEVEL = 'error';
process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = 'test-client-id';
process.env.PANDASCORE_TOKEN = 'test-token';
process.env.PANDASCORE_PROFILES_ENABLED = 'false';
process.env.PANDASCORE_PROFILES_GAMES = '';

const { closeDb } = await import('../src/db/index.js');
const { addTournament } = await import('../src/db/tournaments.js');
const { getPlayerById, getPlayerByPandaScoreId, upsertPlayer } = await import('../src/db/players.js');
const { getTeamByPandaScoreId, upsertTeam } = await import('../src/db/teams.js');
const {
  isQuietHour,
  refreshPandaScoreProfiles,
  trackedPandaScoreGames,
} = await import('../src/jobs/pandascoreProfiles.js');

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

test('team and player profile upserts are idempotent', async () => {
  const firstTeam = await upsertTeam({
    game: 'valorant',
    pandascore_id: 101,
    name: 'Team Alpha',
    slug: 'team-alpha',
    acronym: 'ALP',
    image_url: 'https://img.example/team-alpha.png',
    raw_json: { id: 101 },
  });

  const updatedTeam = await upsertTeam({
    game: 'valorant',
    pandascore_id: 101,
    name: 'Team Alpha Prime',
    slug: null,
    image_url: null,
    raw_json: { id: 101, changed: true },
  });

  assert.equal(updatedTeam.id, firstTeam.id);
  assert.equal(updatedTeam.name, 'Team Alpha Prime');
  assert.equal(updatedTeam.slug, 'team-alpha');
  assert.equal(updatedTeam.image_url, 'https://img.example/team-alpha.png');

  const firstPlayer = await upsertPlayer({
    game: 'valorant',
    pandascore_id: 201,
    name: 'Player One',
    slug: 'player-one',
    image_url: 'https://img.example/player-one.png',
    current_team_id: updatedTeam.id,
    current_team_pandascore_id: 101,
    current_team_name: 'Team Alpha Prime',
    raw_json: { id: 201 },
  });

  const updatedPlayer = await upsertPlayer({
    game: 'valorant',
    pandascore_id: 201,
    name: 'Player One',
    slug: null,
    image_url: null,
    current_team_id: null,
    current_team_pandascore_id: 101,
    raw_json: { id: 201, changed: true },
  });

  assert.equal(updatedPlayer.id, firstPlayer.id);
  assert.equal(updatedPlayer.slug, 'player-one');
  assert.equal(updatedPlayer.image_url, 'https://img.example/player-one.png');

  const hydratedPlayer = await getPlayerById(firstPlayer.id);
  assert.equal(hydratedPlayer.resolved_team_name, 'Team Alpha Prime');
});

test('quiet-hour helper handles same-day and overnight windows', () => {
  assert.equal(isQuietHour(new Date('2026-06-29T00:30:00Z'), 'UTC', 0, 6), true);
  assert.equal(isQuietHour(new Date('2026-06-29T07:00:00Z'), 'UTC', 0, 6), false);
  assert.equal(isQuietHour(new Date('2026-06-29T23:00:00Z'), 'UTC', 22, 3), true);
  assert.equal(isQuietHour(new Date('2026-06-29T04:00:00Z'), 'UTC', 22, 3), false);
});

test('profile refresh uses tracked PandaScore games and stores teams before players', async () => {
  await addTournament({
    source: 'liquipedia',
    external_id: 'valorant-event',
    game: 'valorant',
    name: 'Valorant Event',
    guild_id: 'guild-1',
  });
  await addTournament({
    source: 'liquipedia',
    external_id: 'fighters-event',
    game: 'fighters',
    name: 'Fighters Event',
    guild_id: 'guild-1',
  });

  const calls = [];
  const mockPandaScore = {
    hasPandaScoreToken: () => true,
    canonicalPandaScoreGame: (game) => (game === 'valorant' ? 'valorant' : null),
    pandascoreGamePath: (game) => (game === 'valorant' ? 'valorant' : null),
    fetchTeamsForGame: async (game) => {
      calls.push(`teams:${game}`);
      return [
        {
          game,
          pandascore_id: 301,
          name: 'Mock Team',
          slug: 'mock-team',
          image_url: 'https://img.example/mock-team.png',
          raw_json: { id: 301 },
        },
      ];
    },
    fetchPlayersForGame: async (game, teamByPandaScoreId) => {
      calls.push(`players:${game}:${teamByPandaScoreId.has(301)}`);
      return [
        {
          game,
          pandascore_id: 401,
          name: 'Mock Player',
          current_team_pandascore_id: 301,
          raw_json: { id: 401 },
        },
      ];
    },
  };

  const games = await trackedPandaScoreGames({ pandaScore: mockPandaScore });
  assert.deepEqual(games, ['valorant']);

  const summary = await refreshPandaScoreProfiles({ force: true, pandaScore: mockPandaScore });
  assert.deepEqual(summary.errors, []);
  assert.deepEqual(summary.games, ['valorant']);
  assert.equal(summary.teams, 1);
  assert.equal(summary.players, 1);
  assert.deepEqual(calls, ['teams:valorant', 'players:valorant:true']);

  const storedTeam = await getTeamByPandaScoreId(301);
  assert.equal(storedTeam.name, 'Mock Team');

  const storedPlayer = await getPlayerByPandaScoreId(401);
  assert.equal(storedPlayer.name, 'Mock Player');
  const hydratedStoredPlayer = await getPlayerById(storedPlayer.id);
  assert.equal(hydratedStoredPlayer.resolved_team_name, 'Mock Team');
});
