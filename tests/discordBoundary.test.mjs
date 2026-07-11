import assert from 'node:assert/strict';
import test from 'node:test';

process.env.DB_PATH = ':memory:';
process.env.LOG_LEVEL = 'error';
process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = 'test-client-id';
process.env.DISCORD_GUILD_ID = '111111111111111111';

const { execute, isForeignGuildInteraction } = await import('../src/events/interactionCreate.js');
const { escapeMaskedLinkLabel } = await import('../src/lib/markdownTools.js');

function fakeInteraction(guildId, overrides = {}) {
  return {
    guildId,
    isAutocomplete: () => false,
    isRepliable: () => true,
    isMessageComponent: () => false,
    isModalSubmit: () => false,
    isChatInputCommand: () => true,
    isMessageContextMenuCommand: () => false,
    commandName: 'match',
    client: { commands: new Map() },
    replies: [],
    async reply(payload) {
      this.replies.push(payload);
    },
    async respond(choices) {
      this.responded = choices;
    },
    ...overrides,
  };
}

test('foreign-guild interactions are refused before any dispatch', async () => {
  const foreign = fakeInteraction('222222222222222222');
  assert.equal(isForeignGuildInteraction(foreign), true);
  await execute(foreign);
  assert.equal(foreign.replies.length, 1);
  assert.match(foreign.replies[0].content, /home community/i);
});

test('foreign-guild autocomplete gets an empty response, never command dispatch', async () => {
  const foreign = fakeInteraction('222222222222222222', { isAutocomplete: () => true });
  await execute(foreign);
  assert.deepEqual(foreign.responded, []);
  assert.equal(foreign.replies.length, 0);
});

test('home-guild and DM interactions pass the gate', () => {
  assert.equal(isForeignGuildInteraction(fakeInteraction('111111111111111111')), false);
  assert.equal(isForeignGuildInteraction(fakeInteraction(null)), false);
  // Unconfigured deployments (no DISCORD_GUILD_ID) fail open by explicit choice.
  assert.equal(isForeignGuildInteraction(fakeInteraction('222222222222222222'), null), false);
});

test('masked-link labels neutralize markdown control characters', () => {
  const hostile = 'PewDiePie](https://evil.example/phish) [totally real';
  const escaped = escapeMaskedLinkLabel(hostile);
  // No unescaped "](" may survive inside the LABEL itself — that is the
  // sequence that would terminate the masked link early.
  assert.ok(!/(^|[^\\])\]\(/.test(escaped));
  assert.ok(escaped.includes('\\]') && escaped.includes('\\('));
  assert.equal(escapeMaskedLinkLabel('plain name'), 'plain name');
  assert.equal(escapeMaskedLinkLabel(null), '');
});

test('set_costreams refuses unmentionable, managed, and @everyone mention roles', async () => {
  const { execute: setCostreams } = await import('../src/commands/set_costreams.js');
  const channel = { id: '999', name: 'live', permissionsFor: () => ({ has: () => true }) };
  const attempt = async (role) => {
    const interaction = {
      guildId: '111111111111111111',
      guild: { members: { me: {} } },
      client: { user: {} },
      memberPermissions: { has: () => true },
      appPermissions: { has: () => true },
      replies: [],
      async reply(payload) {
        this.replies.push(payload);
      },
      options: {
        getSubcommand: () => 'announcements',
        getChannel: () => channel,
        getRole: () => role,
        getString: () => null,
      },
    };
    await setCostreams(interaction);
    return interaction.replies[0]?.content || '';
  };

  assert.match(await attempt({ id: '111111111111111111' }), /not @everyone/i);
  assert.match(await attempt({ id: '333', managed: true, mentionable: true }), /managed by an integration/i);
  assert.match(
    await attempt({ id: '444', managed: false, mentionable: false, toString: () => '@Staff' }),
    /not mentionable/i,
  );
});
