import assert from 'node:assert/strict';
import test from 'node:test';
process.env.DB_PATH = ':memory:';
process.env.LOG_LEVEL = 'error';
process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = 'test-client';
const { parseTournamentDiscovery, discoveryIdentity } = await import('../src/services/liquipedia/discoveryParsers.js');
const { queueDiscoveredTournaments } = await import('../src/jobs/tournamentDiscovery.js');
const { listDiscoveryGames, hasDiscoveredTournament } = await import('../src/db/tournamentDiscovery.js');
const { setGameMatchCard } = await import('../src/db/settings.js');
const { addTournament, archiveTournament } = await import('../src/db/tournaments.js');

test('main-page cards require an explicit eligible tier and deduplicate icon/name links', () => {
  const card = (page, tier) => `<div class="tournaments-list-item"><div class="tournaments-list-item__name"><a href="/leagueoflegends/${page}">${page}</a></div><div class="tournament-badge__chip">${tier}</div></div>`;
  const html = card('LCK/2026', 'S-Tier') + card('LCK/2026', 'S-Tier') + card('Regional/2026', 'A-Tier') + card('Lower/2026', 'B-Tier') + card('Unknown', '') + '<a href="/leagueoflegends/S-Tier_Tournaments">S-Tier</a>';
  const parsed = parseTournamentDiscovery(html, 'leagueoflegends');
  assert.deepEqual(parsed.candidates.map(row => row.sourceId), ['leagueoflegends/LCK/2026', 'leagueoflegends/Regional/2026']);
  assert.equal(parsed.unknownTier, 1);
});

test('supports numeric tier grids and legacy tables, excluding lower tiers and red links', () => {
  const html = `<div class="gridRow"><div class="divCell Tier">Tier 2</div><div class="divCell Tournament"><a href="/dota2/Event/2026">Event</a></div></div>
  <div class="gridRow"><div class="Tier">Tier 3</div><div class="Tournament"><a href="/dota2/Lower/2026">Lower</a></div></div>
  <div class="gridRow"><div class="Tier">Tier 1</div><div class="Tournament"><a class="new" href="/dota2/Missing/2026">Missing</a></div></div>
  <table><tr><th>Tier</th><th>Tournament</th></tr><tr><td>Tier 1</td><td><a href="/dota2/Another/2026">Another</a></td></tr></table>`;
  assert.deepEqual(parseTournamentDiscovery(html, 'dota2').candidates.map(row => row.sourceId), ['dota2/Event/2026', 'dota2/Another/2026']);
  for (const href of ['https://evil.test/dota2/Event/2026', '/valorant/Event/2026', '/dota2/File:logo.png', '/dota2/Event?x=1']) assert.equal(discoveryIdentity(href, 'dota2'), null);
});

test('community games exclude the all-games board; archived tournaments stay excluded from discovery', async () => {
  await setGameMatchCard('123', 'all', '456');
  await setGameMatchCard('123', 'leagueoflegends', '457');
  const identity = discoveryIdentity('/leagueoflegends/LCK/2026', 'leagueoflegends');
  const tournament = await addTournament({ source: 'liquipedia', external_id: identity.sourceId, url: identity.url, game: identity.game, guild_id: '123' });
  await archiveTournament(tournament.id, '123');
  assert.deepEqual(await listDiscoveryGames('123'), ['leagueoflegends']);
  assert.equal(await hasDiscoveredTournament('123', identity), true);
  assert.equal(await hasDiscoveredTournament('999', identity), false);
});

test('repeated discovery uses durable idempotency and queues only provider validation', async () => {
  const candidate = discoveryIdentity('/dota2/Example/2026', 'dota2');
  const options = { exists: async () => false };
  assert.equal(await queueDiscoveredTournaments('123', [candidate], options), 1);
  assert.equal(await queueDiscoveredTournaments('123', [candidate], options), 0);
  let writes = 0;
  assert.equal(await queueDiscoveredTournaments('123', [candidate], { exists: async () => true, enqueue: async () => { writes++; } }), 0);
  assert.equal(writes, 0);
});

test('discovery activation cannot reactivate an event archived while its validation was queued', async () => {
  const row = { source: 'liquipedia', external_id: 'dota2/Race/2026', game: 'dota2', guild_id: '123' };
  const tournament = await addTournament(row);
  await archiveTournament(tournament.id, '123');
  assert.equal(await addTournament(row, { preserveExisting: true }), null);
  const { getTournamentById } = await import('../src/db/tournaments.js');
  assert.ok((await getTournamentById(tournament.id)).archived_at);
});



test('Dota main-page name rows use numeric badge text as well as qualifier chips', () => {
  const html = `<div><div class="tournament-badge"><div class="tournament-badge__text">Tier 1</div></div><span class="tournaments-list-name"><span class="tournament-name"><a href="/dota2/The_International/2026">TI</a></span></span></div>`;
  assert.equal(parseTournamentDiscovery(html, 'dota2').candidates[0].sourceId, 'dota2/The_International/2026');
});
