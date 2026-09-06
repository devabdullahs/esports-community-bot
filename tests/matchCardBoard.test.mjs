import assert from 'node:assert/strict';
import test from 'node:test';

process.env.DB_PATH = ':memory:';
process.env.LOG_LEVEL = 'error';
process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = 'test-client-id';
const { run } = await import('../src/db/client.js');
const { addTournament } = await import('../src/db/tournaments.js');
const { upsertMatch } = await import('../src/db/matches.js');
const { setGameMatchCard, setMatchCardMessage, getMatchCardMessages } = await import('../src/db/settings.js');
const { updateMatchCards } = await import('../src/jobs/matchCardBoard.js');

let sequence = 0;
function channelMock() {
  const messages = new Map();
  const state = { sent: 0, deleted: 0, edited: 0, fetchError: null, deleteError: null };
  const channel = {
    isTextBased: () => true,
    messages: { fetch: async id => {
      if (state.fetchError) throw state.fetchError;
      if (!messages.has(id)) throw Object.assign(new Error('Unknown Message'), { code: 10008 });
      return messages.get(id);
    } },
    send: async () => {
      state.sent++;
      return { id: `sent-${state.sent}` };
    },
  };
  const add = id => messages.set(id, {
    edit: async () => { state.edited++; },
    delete: async () => {
      if (state.deleteError) throw state.deleteError;
      state.deleted++;
      messages.delete(id);
    },
  });
  return { channel, state, add };
}

async function fixture({ game = 'leagueoflegends', status = 'finished', age = 0 } = {}) {
  const guild = `cards-${++sequence}`;
  const tournament = await addTournament({ source: 'liquipedia', external_id: guild, name: 'Test cup', game, guild_id: guild });
  await upsertMatch({ tournament_id: tournament.id, source: 'liquipedia', external_id: guild,
    team_a: 'T1', team_b: 'FEARX', status, scheduled_at: Math.floor(Date.now() / 1000) - age });
  // Resolve the actual inserted ID without assuming another test's insertion order.
  const { getMatchesForGuild } = await import('../src/db/matches.js');
  const [match] = await getMatchesForGuild(guild);
  await setGameMatchCard(guild, game, guild);
  await setMatchCardMessage(guild, game, match.id, guild, 'old');
  const mock = channelMock();
  mock.add('old');
  const client = { channels: { fetch: async () => mock.channel } };
  return { guild, game, match, mock, client };
}

test('failed deletion retains tracking and retries successfully next refresh', async () => {
  const f = await fixture();
  f.mock.state.deleteError = Object.assign(new Error('Missing Permissions'), { code: 50013 });
  await updateMatchCards(f.client, f.guild);
  assert.equal((await getMatchCardMessages(f.guild, f.game))[0].message_id, 'old');
  assert.equal(f.mock.state.sent, 0);
  f.mock.state.deleteError = null;
  await updateMatchCards(f.client, f.guild);
  assert.equal(f.mock.state.deleted, 1);
  assert.equal((await getMatchCardMessages(f.guild, f.game))[0].match_id, 0);
});

test('temporary message fetch failure never creates a duplicate live card', async () => {
  const f = await fixture({ game: 'valorant', status: 'running' });
  f.mock.state.fetchError = new Error('Connection reset');
  await updateMatchCards(f.client, f.guild);
  assert.equal(f.mock.state.sent, 0);
  assert.equal((await getMatchCardMessages(f.guild, f.game))[0].message_id, 'old');
  f.mock.state.fetchError = null;
  await updateMatchCards(f.client, f.guild);
  assert.equal(f.mock.state.edited, 1);
});

test('Discord-confirmed missing messages are replaced', async () => {
  const f = await fixture({ status: 'running' });
  f.mock.state.fetchError = Object.assign(new Error('Unknown Message'), { code: 10008 });
  await updateMatchCards(f.client, f.guild);
  assert.equal(f.mock.state.sent, 1);
  assert.equal((await getMatchCardMessages(f.guild, f.game))[0].message_id, 'sent-1');
});

test('a failing League board does not stop another game board', async () => {
  const f = await fixture();
  const other = channelMock();
  await setGameMatchCard(f.guild, 'dota2', 'other');
  f.mock.state.deleteError = new Error('Network error');
  f.client.channels.fetch = async id => id === 'other' ? other.channel : f.mock.channel;
  await updateMatchCards(f.client, f.guild);
  assert.equal(other.state.sent, 1);
  assert.equal((await getMatchCardMessages(f.guild, f.game))[0].message_id, 'old');
});

test('days-old live cards are removed across dedicated game boards', async () => {
  for (const game of ['leagueoflegends', 'dota2', 'counterstrike', 'valorant']) {
    const f = await fixture({ game, status: 'running', age: 7 * 86400 });
    await updateMatchCards(f.client, f.guild);
    assert.equal(f.mock.state.deleted, 1, game);
    assert.equal((await getMatchCardMessages(f.guild, game))[0].match_id, 0, game);
  }
});

test.after(async () => { await run('DELETE FROM match_card_messages'); });
