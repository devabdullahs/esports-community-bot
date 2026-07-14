import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'follow-command-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.LOG_LEVEL = 'error';
process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = 'test-client-id';
process.env.EWC_DASHBOARD_PUBLIC_URL = 'https://example.test';

const { closeDb } = await import('../src/db/index.js');
const { run } = await import('../src/db/client.js');
const { upsertMatch } = await import('../src/db/matches.js');
const { upsertPlayer } = await import('../src/db/players.js');
const { upsertTeam } = await import('../src/db/teams.js');
const { addTournament } = await import('../src/db/tournaments.js');
const { deleteFollow, getFollow, listFollowsForUser, upsertFollow } = await import('../src/db/userFollows.js');
const { collectCommandJson } = await import('../src/lib/commandRegistry.js');
const { buildFollowListPayload, buildMatchFollowRow } = await import('../src/lib/followComponents.js');
const { autocomplete, data, execute, handleComponent } = await import('../src/commands/follow.js');

const GUILD = 'guild-follow-command';
const OTHER_GUILD = 'guild-follow-command-other';
const USER = '300000000000000001';
const OTHER_USER = '300000000000000002';

let tournament;
let archivedTournament;
let foreignTournament;
let team;
let player;
let match;
let lobbyMatch;

function commandInteraction({ userId = USER, subcommand, strings = {}, integers = {}, locale = 'en-US' } = {}) {
  return {
    guildId: GUILD,
    locale,
    user: { id: userId },
    replies: [],
    options: {
      getSubcommand: () => subcommand,
      getString: (name) => strings[name] ?? null,
      getInteger: (name) => integers[name] ?? null,
    },
    async reply(payload) {
      this.replies.push(payload);
    },
  };
}

function autocompleteInteraction({ userId = USER, subcommand, focused, strings = {} } = {}) {
  return {
    guildId: GUILD,
    locale: 'en-US',
    user: { id: userId },
    options: {
      getSubcommand: () => subcommand,
      getFocused: (details) => (details ? focused : focused.value),
      getString: (name) => strings[name] ?? null,
    },
    async respond(choices) {
      this.choices = choices;
    },
  };
}

function componentInteraction({ userId = USER, customId, values = [], locale = 'en-US' } = {}) {
  return {
    guildId: GUILD,
    locale,
    user: { id: userId },
    customId,
    values,
    replies: [],
    updates: [],
    async reply(payload) {
      this.replies.push(payload);
    },
    async update(payload) {
      this.updates.push(payload);
    },
  };
}

function assertEphemeralAndPingFree(payload) {
  assert.equal(payload.flags, 64);
  assert.deepEqual(payload.allowedMentions, { parse: [] });
  assert.ok(!String(payload.content || '').includes('<@'));
}

function componentJson(payload) {
  return payload.components.map((component) => component.toJSON());
}

test.before(async () => {
  tournament = await addTournament({
    source: 'liquipedia',
    external_id: 'follow-command/cup',
    game: 'valorant',
    name: 'Follow Command Cup',
    url: 'https://liquipedia.net/valorant/Follow_Command/Cup',
    guild_id: GUILD,
  });
  archivedTournament = await addTournament({
    source: 'liquipedia',
    external_id: 'follow-command/archive',
    game: 'valorant',
    name: 'Archived Follow Cup',
    url: 'https://liquipedia.net/valorant/Archived_Follow_Cup',
    guild_id: GUILD,
  });
  foreignTournament = await addTournament({
    source: 'liquipedia',
    external_id: 'follow-command/foreign',
    game: 'valorant',
    name: 'Foreign Follow Cup',
    url: 'https://liquipedia.net/valorant/Foreign_Follow_Cup',
    guild_id: OTHER_GUILD,
  });
  await run('UPDATE tournaments SET archived_at = $1 WHERE id = $2', [Math.floor(Date.now() / 1000), archivedTournament.id]);

  team = await upsertTeam({ game: 'valorant', pandascore_id: 7001, name: 'Team Liquid' });
  await upsertTeam({ game: 'valorant', pandascore_id: 7002, name: 'Team Falcons' });
  for (let index = 0; index < 30; index += 1) {
    await upsertTeam({ game: 'valorant', pandascore_id: 7100 + index, name: `Bulk Team ${String(index).padStart(2, '0')}` });
  }
  player = await upsertPlayer({
    game: 'valorant',
    pandascore_id: 8001,
    name: 'Follow Command Player',
    current_team_id: team.id,
    current_team_pandascore_id: 7001,
    current_team_name: 'Team Liquid',
  });
  match = await upsertMatch({
    tournament_id: tournament.id,
    source: 'liquipedia',
    external_id: 'Match:follow-command',
    team_a: 'Team Liquid',
    team_b: 'Team Falcons',
    status: 'scheduled',
    scheduled_at: Math.floor(Date.now() / 1000) + 3600,
  });
  lobbyMatch = await upsertMatch({
    tournament_id: tournament.id,
    source: 'liquipedia',
    external_id: 'Match:follow-command-lobby',
    team_a: 'Lobby',
    team_b: 'Lobby',
    status: 'scheduled',
    scheduled_at: Math.floor(Date.now() / 1000) + 7200,
  });
});

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

test('command serializes and dynamic command discovery includes follow', async () => {
  const json = data.toJSON();
  assert.equal(json.name, 'follow');
  assert.deepEqual(json.options.map((option) => option.name), ['game', 'tournament', 'team', 'player', 'remove', 'list']);
  const commands = await collectCommandJson();
  assert.ok(commands.some((command) => command.name === 'follow'));
});

test('local-only autocomplete validates each focused option and caps choices', async () => {
  const gameAutocomplete = autocompleteInteraction({ subcommand: 'game', focused: { name: 'game', value: 'valo' } });
  await autocomplete(gameAutocomplete);
  assert.deepEqual(gameAutocomplete.choices, [{ name: 'Valorant', value: 'valorant' }]);

  const tournamentAutocomplete = autocompleteInteraction({
    subcommand: 'tournament',
    focused: { name: 'tournament', value: 'command' },
  });
  await autocomplete(tournamentAutocomplete);
  assert.deepEqual(tournamentAutocomplete.choices.map((choice) => choice.value), [tournament.id]);

  const teamAutocomplete = autocompleteInteraction({
    subcommand: 'team',
    focused: { name: 'team', value: 'bulk' },
    strings: { game: 'valorant' },
  });
  await autocomplete(teamAutocomplete);
  assert.equal(teamAutocomplete.choices.length, 25);
  assert.ok(teamAutocomplete.choices.every((choice) => choice.value > 0 && choice.name.length <= 100));

  const playerAutocomplete = autocompleteInteraction({
    subcommand: 'player',
    focused: { name: 'player', value: 'follow command' },
    strings: { game: 'valorant' },
  });
  await autocomplete(playerAutocomplete);
  assert.deepEqual(playerAutocomplete.choices.map((choice) => choice.value), [player.id]);

  const invalidFilter = autocompleteInteraction({
    subcommand: 'team',
    focused: { name: 'team', value: '' },
    strings: { game: 'not-a-game' },
  });
  await autocomplete(invalidFilter);
  assert.deepEqual(invalidFilter.choices, []);

  const unknownFocused = autocompleteInteraction({ subcommand: 'team', focused: { name: 'unknown', value: '' } });
  await autocomplete(unknownFocused);
  assert.deepEqual(unknownFocused.choices, []);
});

test('remove autocomplete only exposes the caller follow rows', async () => {
  await upsertFollow({ discordUserId: OTHER_USER, entityType: 'team', entityKey: 'Private Team', entityLabel: 'Private Team' });
  const caller = autocompleteInteraction({ userId: USER, subcommand: 'remove', focused: { name: 'follow', value: 'private' } });
  await autocomplete(caller);
  assert.deepEqual(caller.choices, []);

  const owner = autocompleteInteraction({ userId: OTHER_USER, subcommand: 'remove', focused: { name: 'follow', value: 'private' } });
  await autocomplete(owner);
  assert.equal(owner.choices.length, 1);
  assert.match(owner.choices[0].name, /Private Team/);
});

test('all four follow types resolve canonical local records and remain idempotent', async () => {
  const game = commandInteraction({ subcommand: 'game', strings: { game: 'valorant' } });
  await execute(game);
  assertEphemeralAndPingFree(game.replies[0]);

  const tournamentFollow = commandInteraction({ subcommand: 'tournament', integers: { tournament: tournament.id } });
  await execute(tournamentFollow);
  assertEphemeralAndPingFree(tournamentFollow.replies[0]);

  const teamFollow = commandInteraction({ subcommand: 'team', integers: { team: team.id }, strings: { game: 'valorant' } });
  await execute(teamFollow);
  assertEphemeralAndPingFree(teamFollow.replies[0]);

  const playerFollow = commandInteraction({ subcommand: 'player', integers: { player: player.id }, strings: { game: 'valorant' } });
  await execute(playerFollow);
  assertEphemeralAndPingFree(playerFollow.replies[0]);

  const follows = await listFollowsForUser(USER);
  assert.deepEqual(follows.map((row) => row.entity_type).sort(), ['game', 'player', 'team', 'tournament']);
  assert.equal(follows.find((row) => row.entity_type === 'team').entity_key, 'liquid');
  assert.equal(follows.find((row) => row.entity_type === 'player').entity_ref, `/players/${player.id}`);
  assert.equal(follows.find((row) => row.entity_type === 'tournament').entity_ref, `/tournaments/${tournament.id}`);

  const again = commandInteraction({ subcommand: 'game', strings: { game: 'valorant' } });
  await execute(again);
  assert.match(again.replies[0].content, /already following/i);
  assert.equal((await listFollowsForUser(USER)).length, 4);
});

test('writes reject invalid, archived, foreign, and game-mismatched records', async () => {
  const invalidTeam = commandInteraction({ subcommand: 'team', integers: { team: 999999 }, strings: { game: 'valorant' } });
  await execute(invalidTeam);
  assertEphemeralAndPingFree(invalidTeam.replies[0]);
  assert.match(invalidTeam.replies[0].content, /unavailable/i);

  const archived = commandInteraction({ subcommand: 'tournament', integers: { tournament: archivedTournament.id } });
  await execute(archived);
  assert.match(archived.replies[0].content, /unavailable/i);

  const foreign = commandInteraction({ subcommand: 'tournament', integers: { tournament: foreignTournament.id } });
  await execute(foreign);
  assert.match(foreign.replies[0].content, /unavailable/i);

  const wrongGame = commandInteraction({ subcommand: 'team', integers: { team: team.id }, strings: { game: 'dota2' } });
  await execute(wrongGame);
  assert.match(wrongGame.replies[0].content, /does not match/i);
});

test('quota response remains ephemeral and links to follow management', async () => {
  const quotaUser = '300000000000000003';
  for (let index = 0; index < 200; index += 1) {
    await upsertFollow({ discordUserId: quotaUser, entityType: 'team', entityKey: `Quota Team ${index}` });
  }
  const interaction = commandInteraction({ userId: quotaUser, subcommand: 'game', strings: { game: 'dota2' } });
  await execute(interaction);
  assertEphemeralAndPingFree(interaction.replies[0]);
  assert.match(interaction.replies[0].content, /200-follow limit/i);
  const rows = componentJson(interaction.replies[0]);
  assert.equal(rows[0].components[0].url, 'https://example.test/me?tab=following');
});

test('Arabic follow lists hand off to the localized dashboard tab', async () => {
  const interaction = commandInteraction({ userId: '300000000000000008', subcommand: 'list', locale: 'ar' });
  await execute(interaction);
  assertEphemeralAndPingFree(interaction.replies[0]);
  const rows = componentJson(interaction.replies[0]);
  assert.equal(rows.at(-1).components[0].url, 'https://example.test/ar/me?tab=following');
});

test('follow list builders handle 0, 1, 11, and 200 rows within Discord limits', () => {
  for (const count of [0, 1, 11, 200]) {
    const follows = Array.from({ length: count }, (_, index) => ({
      id: index + 1,
      entity_type: 'team',
      entity_key: `team-${index + 1}`,
      entity_label: `Team ${index + 1}`,
    }));
    const payload = buildFollowListPayload({ follows, page: 99, dashboardUrl: 'https://example.test/me?tab=following' });
    const rows = componentJson(payload);
    assert.ok(rows.length <= 5);
    assert.ok(rows.every((row) => row.components.length <= 5));
    const select = rows.find((row) => row.components[0]?.type === 3);
    if (count) {
      assert.ok(select.components[0].options.length >= 1 && select.components[0].options.length <= 10);
      assert.ok(select.components[0].options.every((option) => option.label.length <= 100 && option.value.length <= 100));
    } else {
      assert.equal(select, undefined);
    }
    assert.ok(rows.flatMap((row) => row.components).every((component) => !component.custom_id || component.custom_id.length <= 100));
  }
});

test('list components re-query the clicking user for stale, forged, and copied controls', async () => {
  const listUser = '300000000000000004';
  await upsertFollow({ discordUserId: listUser, entityType: 'game', entityKey: 'valorant', entityLabel: 'Valorant' });
  const only = (await listFollowsForUser(listUser))[0];

  const stalePage = componentInteraction({ userId: listUser, customId: 'follow:page:99' });
  await handleComponent(stalePage);
  assert.equal(stalePage.updates.length, 1);
  assert.deepEqual(stalePage.updates[0].allowedMentions, { parse: [] });
  const pageButtons = componentJson(stalePage.updates[0]).find((row) => row.components[0]?.type === 2);
  assert.ok(pageButtons.components.every((button) => button.disabled));

  const forged = componentInteraction({ userId: listUser, customId: 'follow:remove:0', values: ['99999999'] });
  await handleComponent(forged);
  assert.match(forged.updates[0].content, /no longer available/i);
  assert.ok(await getFollow({ discordUserId: listUser, entityType: 'game', entityKey: 'valorant' }));

  await deleteFollow({ discordUserId: listUser, entityType: only.entity_type, entityKey: only.entity_key });
  const stale = componentInteraction({ userId: listUser, customId: 'follow:remove:0', values: [String(only.id)] });
  await handleComponent(stale);
  assert.match(stale.updates[0].content, /no longer available/i);

  const owner = '300000000000000005';
  await upsertFollow({ discordUserId: owner, entityType: 'team', entityKey: 'Owner Team', entityLabel: 'Owner Team' });
  const ownerFollow = (await listFollowsForUser(owner))[0];
  const copied = componentInteraction({ userId: OTHER_USER, customId: 'follow:remove:0', values: [String(ownerFollow.id)] });
  await handleComponent(copied);
  assert.match(copied.updates[0].content, /no longer available/i);
  assert.ok(await getFollow({ discordUserId: owner, entityType: 'team', entityKey: 'Owner Team' }));
});

test('remove components delete only the caller row and report the result', async () => {
  const removeUser = '300000000000000006';
  await upsertFollow({ discordUserId: removeUser, entityType: 'team', entityKey: 'Remove Team', entityLabel: 'Remove Team' });
  const follow = (await listFollowsForUser(removeUser))[0];
  const interaction = componentInteraction({ userId: removeUser, customId: 'follow:remove:0', values: [String(follow.id)] });
  await handleComponent(interaction);
  assert.match(interaction.updates[0].content, /Removed Remove Team/i);
  assert.equal(await getFollow({ discordUserId: removeUser, entityType: 'team', entityKey: 'Remove Team' }), null);
});

test('match follow rows use only a match id and trusted option enums', async () => {
  const normal = buildMatchFollowRow({
    id: 123,
    tournament_id: 456,
    tournament_name: 'Cup',
    game: 'valorant',
    team_a: 'Team Liquid',
    team_b: 'Team Falcons',
  });
  const normalJson = normal.toJSON();
  assert.equal(normalJson.components[0].custom_id, 'follow:match:123');
  assert.deepEqual(normalJson.components[0].options.map((option) => option.value), ['tournament', 'team_a', 'team_b']);
  assert.ok(!normalJson.components[0].custom_id.includes('Liquid'));

  const placeholder = buildMatchFollowRow({
    id: 124,
    tournament_id: 456,
    tournament_name: 'Cup',
    game: 'valorant',
    team_a: 'Team Liquid',
    team_b: 'TBD',
  }).toJSON();
  assert.deepEqual(placeholder.components[0].options.map((option) => option.value), ['tournament', 'team_a']);

  const lobby = buildMatchFollowRow({
    id: 125,
    tournament_id: 456,
    tournament_name: 'Cup',
    game: 'pubg',
    team_a: 'Lobby',
    team_b: 'Lobby',
  }).toJSON();
  assert.deepEqual(lobby.components[0].options.map((option) => option.value), ['tournament']);
});

test('match components reload canonical records and reject forged, stale, and archived targets', async () => {
  const componentUser = '300000000000000007';
  const valid = componentInteraction({ userId: componentUser, customId: `follow:match:${match.id}`, values: ['team_a'] });
  await handleComponent(valid);
  assertEphemeralAndPingFree(valid.replies[0]);
  assert.ok(await getFollow({ discordUserId: componentUser, entityType: 'team', entityKey: 'Team Liquid' }));

  const existing = componentInteraction({ userId: componentUser, customId: `follow:match:${match.id}`, values: ['team_a'] });
  await handleComponent(existing);
  assert.match(existing.replies[0].content, /already following/i);

  const forged = componentInteraction({ userId: componentUser, customId: `follow:match:${match.id}`, values: ['team_name:Team Liquid'] });
  await handleComponent(forged);
  assert.match(forged.replies[0].content, /no longer available/i);

  const malformed = componentInteraction({ userId: componentUser, customId: `follow:match:${match.id}:extra`, values: ['team_a'] });
  await handleComponent(malformed);
  assert.match(malformed.replies[0].content, /action is no longer available/i);

  const stale = componentInteraction({ userId: componentUser, customId: 'follow:match:999999', values: ['tournament'] });
  await handleComponent(stale);
  assert.match(stale.replies[0].content, /unavailable/i);

  const lobby = componentInteraction({ userId: componentUser, customId: `follow:match:${lobbyMatch.id}`, values: ['team_a'] });
  await handleComponent(lobby);
  assert.match(lobby.replies[0].content, /profile is not ready/i);

  await run('UPDATE tournaments SET archived_at = $1 WHERE id = $2', [Math.floor(Date.now() / 1000), tournament.id]);
  const archived = componentInteraction({ userId: componentUser, customId: `follow:match:${match.id}`, values: ['tournament'] });
  await handleComponent(archived);
  assert.match(archived.replies[0].content, /unavailable/i);
});
