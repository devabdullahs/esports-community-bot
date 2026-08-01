import assert from 'node:assert/strict';
import test from 'node:test';

process.env.LOG_LEVEL = 'error';
process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = 'test-client-id';
process.env.DB_PATH = ':memory:';

const { fetchEwcEventPlacements, fetchEwcWeekGameResults } = await import('../src/services/liquipedia/fetchers.js');

test('successful EWC result fetches normalize the configured key to gameKey', async () => {
  const result = await fetchEwcEventPlacements({
    key: 'apex-legends-2',
    game: 'Apex Legends',
    eventUrl: 'https://liquipedia.net/apexlegends/Event/Finals',
  }, [], {
    parse: async () => ({
      parse: {
        text: {
          '*': `<div class="panel-table">
            <div class="panel-table__row row--header"></div>
            <div class="panel-table__row">
              <div class="cell--rank" data-sort-val="1">1st</div>
              <div class="cell--team" data-sort-val="UNLIMIT">UNLIMIT</div>
            </div>
          </div>`,
        },
      },
    }),
  });

  assert.equal(result.gameKey, 'apex-legends-2');
  assert.deepEqual(result.placements, [
    { club: 'UNLIMIT', place: '1', points: 1000, participant: null },
  ]);
  assert.deepEqual(result.evidence, {
    kind: 'final-standings-panel',
    authoritative: true,
    coveredRanks: [1],
  });
});

test('failed EWC result fetches still retain gameKey for pending-result tracking', async () => {
  const result = await fetchEwcEventPlacements({
    key: 'fatal-fury-3',
    game: 'Fatal Fury: City of the Wolves',
    eventUrl: 'https://liquipedia.net/fighters/Event',
  }, [], { parse: async () => ({ parse: { text: {} } }) });

  assert.equal(result.gameKey, 'fatal-fury-3');
  assert.deepEqual(result.placements, []);
  assert.deepEqual(result.evidence, { kind: 'untrusted', authoritative: false, coveredRanks: [] });
  assert.equal(result.error, 'Empty event page');
});

test('team event result fetches do not request the global EWC player list', async () => {
  let playerFetches = 0;
  const results = await fetchEwcWeekGameResults([
    { key: 'overwatch-1', game: 'Overwatch 2' },
    { key: 'mobile-legends-2', game: 'Mobile Legends: Bang Bang' },
  ], {
    fetchPlayers: async () => {
      playerFetches += 1;
      return { players: [] };
    },
    fetchPlacements: async (game, players) => ({ ...game, gameKey: game.key, players }),
  });

  assert.equal(playerFetches, 0);
  assert.deepEqual(results.map((result) => result.players), [[], []]);
});

test('solo event result fetches share one global EWC player list request', async () => {
  let playerFetches = 0;
  const players = [{ id: 'Player', team: 'Club' }];
  const results = await fetchEwcWeekGameResults([
    { key: 'fc-1', game: 'EA SPORTS FC 26' },
    { key: 'fighters-2', game: 'Street Fighter 6' },
  ], {
    fetchPlayers: async () => {
      playerFetches += 1;
      return { players };
    },
    fetchPlacements: async (game, resolvedPlayers) => ({ ...game, gameKey: game.key, players: resolvedPlayers }),
  });

  assert.equal(playerFetches, 1);
  assert.deepEqual(results.map((result) => result.players), [players, players]);
});
