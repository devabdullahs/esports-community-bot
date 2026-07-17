import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'mvp-votes-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.LOG_LEVEL = 'error';

const { closeDb } = await import('../src/db/index.js');
const { run } = await import('../src/db/client.js');
const { addTournament } = await import('../src/db/tournaments.js');
const { upsertMatch } = await import('../src/db/matches.js');
const { upsertMatchDetails } = await import('../src/db/matchDetails.js');
const {
  MvpVoteError,
  castMvpVote,
  ensureDailyMvpSession,
  getCurrentMvpVote,
  getLatestClosedMvpResult,
  getLatestMvpWinForPlayer,
  riyadhMvpWindow,
} = await import('../src/db/mvpVotes.js');

const NOW = 2_000_000_000;
const USER = '300000000000000100';
let session;
let playerId;

test.before(async () => {
  const window = riyadhMvpWindow(NOW);
  await run(
    `INSERT INTO players (game, name, slug) VALUES ($1, $2, $3)`,
    ['valorant', 'Ace', 'ace'],
  );
  const playerRow = await import('../src/db/client.js').then(({ get }) => get('SELECT id FROM players WHERE game = $1 AND slug = $2', ['valorant', 'ace']));
  playerId = playerRow.id;
  const tournament = await addTournament({
    source: 'liquipedia',
    external_id: 'mvp/cup',
    game: 'valorant',
    name: 'MVP Cup',
    guild_id: 'guild-mvp',
  });
  const match = await upsertMatch({
    tournament_id: tournament.id,
    source: 'liquipedia',
    external_id: 'Match:mvp-fixture',
    team_a: 'Alpha',
    team_b: 'Beta',
    status: 'finished',
    scheduled_at: window.matchStart + 3600,
  });
  await upsertMatchDetails({
    matchId: match.id,
    sourcePage: 'Match:mvp-fixture',
    game: 'valorant',
    payload: {
      version: 1,
      kind: 'valorant',
      maps: [{
        players: {
          a: [
            { name: 'Ace', acs: 300, kills: 20, deaths: 8, assists: 4, adr: 180 },
            { name: 'Support', acs: 180, kills: 10, deaths: 10, assists: 12, adr: 120 },
          ],
          b: [
            { name: 'Rival', acs: 250, kills: 17, deaths: 12, assists: 5, adr: 150 },
          ],
        },
      }],
    },
  });
  session = await ensureDailyMvpSession(NOW);
});

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

test('daily session is stable, bounded, and hides totals before a member votes', async () => {
  const duplicate = await ensureDailyMvpSession(NOW);
  assert.equal(duplicate.id, session.id);
  const view = await getCurrentMvpVote({ nowSeconds: NOW });
  assert.equal(view.nominees.length, 2);
  assert.deepEqual(view.nominees.map((row) => row.displayName), ['Ace', 'Rival']);
  assert.equal(view.revealCounts, false);
  assert.ok(view.nominees.every((row) => row.voteCount === null));
});

test('one member vote is upserted, can change, and reveals totals only to that member', async () => {
  const view = await getCurrentMvpVote({ nowSeconds: NOW });
  const [ace, rival] = view.nominees;
  let voted = await castMvpVote({ sessionId: session.id, nomineeId: ace.id, discordUserId: USER, nowSeconds: NOW });
  assert.equal(voted.selectedNomineeId, ace.id);
  assert.equal(voted.nominees.find((row) => row.id === ace.id).voteCount, 1);

  voted = await castMvpVote({ sessionId: session.id, nomineeId: rival.id, discordUserId: USER, nowSeconds: NOW });
  assert.equal(voted.selectedNomineeId, rival.id);
  assert.equal(voted.nominees.find((row) => row.id === ace.id).voteCount, 0);
  assert.equal(voted.nominees.find((row) => row.id === rival.id).voteCount, 1);

  const anonymous = await getCurrentMvpVote({ nowSeconds: NOW });
  assert.ok(anonymous.nominees.every((row) => row.voteCount === null));
});

test('invalid nominees and closed sessions fail without changing the vote', async () => {
  await assert.rejects(
    castMvpVote({ sessionId: session.id, nomineeId: 999_999, discordUserId: USER, nowSeconds: NOW }),
    (error) => error instanceof MvpVoteError && error.code === 'invalid_nominee',
  );
  await assert.rejects(
    castMvpVote({ sessionId: session.id, nomineeId: 1, discordUserId: USER, nowSeconds: session.closes_at }),
    (error) => error instanceof MvpVoteError && error.code === 'closed',
  );
});

test('closed results expose the winner and connect a mapped player profile', async () => {
  const view = await getCurrentMvpVote({ nowSeconds: NOW });
  const ace = view.nominees.find((row) => row.displayName === 'Ace');
  await castMvpVote({ sessionId: session.id, nomineeId: ace.id, discordUserId: '300000000000000101', nowSeconds: NOW });
  await castMvpVote({ sessionId: session.id, nomineeId: ace.id, discordUserId: '300000000000000102', nowSeconds: NOW });
  const result = await getLatestClosedMvpResult(session.closes_at);
  assert.equal(result.winner.displayName, 'Ace');
  assert.equal(result.winner.voteCount, 2);
  assert.deepEqual(await getLatestMvpWinForPlayer(playerId, session.closes_at), {
    voteDate: session.vote_date,
    voteCount: 2,
  });
});
