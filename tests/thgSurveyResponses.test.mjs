import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'thg-survey-'));
process.env.DB_PATH = join(dir, 'bot.sqlite');
process.env.DISCORD_TOKEN ||= 'test-token';
process.env.DISCORD_CLIENT_ID ||= 'test-client-id';
process.env.LOG_LEVEL = 'error';

const { closeDb } = await import('../src/db/index.js');
const {
  getSurveyResponse,
  listSurveyResponses,
  markSurveyNotificationSent,
  recordSurveyResponse,
} = await import('../src/db/thgSurveyResponses.js');
const { THG_SURVEY, respondentHash } = await import('../src/lib/thgSurvey.js');
const { deliverSurveyNotifications, surveyConfigStatus, testSurveyNotifications } = await import(
  '../src/lib/thgSurveyNotifications.js'
);
const surveyCommand = await import('../src/commands/thg_survey.js');
const { execute: routeInteraction } = await import('../src/events/interactionCreate.js');

const GUILD = '111111111111111111';
const SECRET = 'unit-test-secret';
const ANSWERS = { q1: ['fps'], q2: ['mods'], q3: 'maybe', q4: '' };

const hashFor = (userId, guildId = GUILD) => respondentHash(SECRET, guildId, userId);
const countFor = async (surveyVersion) => (await listSurveyResponses({ guildId: GUILD, surveyVersion })).length;

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

// --- Duplicate prevention ----------------------------------------------------
test('a first response is stored and numbered', async () => {
  const saved = await recordSurveyResponse({
    guildId: GUILD,
    surveyVersion: THG_SURVEY.version,
    respondentHash: hashFor('member-a'),
    answers: ANSWERS,
    submittedAt: 1_760_000_000,
  });
  assert.equal(saved.created, true);
  assert.equal(saved.response.responseNumber, 1);
  assert.deepEqual(saved.response.answers, ANSWERS);
  assert.equal(saved.response.surveyVersion, THG_SURVEY.version);
  assert.equal(saved.response.notifications.logChannel.sentAt, null);
});

test('the same member answering twice is rejected without overwriting', async () => {
  const duplicate = await recordSurveyResponse({
    guildId: GUILD,
    surveyVersion: THG_SURVEY.version,
    respondentHash: hashFor('member-a'),
    answers: { ...ANSWERS, q3: 'no' },
    submittedAt: 1_760_000_500,
  });
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.response.responseNumber, 1);
  assert.equal(duplicate.response.answers.q3, 'maybe', 'the original answer is preserved');
  assert.equal(await countFor(THG_SURVEY.version), 1);
});

test('another member can still answer', async () => {
  const saved = await recordSurveyResponse({
    guildId: GUILD,
    surveyVersion: THG_SURVEY.version,
    respondentHash: hashFor('member-b'),
    answers: { ...ANSWERS, q1: ['moba'] },
    submittedAt: 1_760_000_600,
  });
  assert.equal(saved.created, true);
  assert.equal(saved.response.responseNumber, 2);
  assert.equal(await countFor(THG_SURVEY.version), 2);
});

test('a new survey version lets a previous respondent answer again', async () => {
  const saved = await recordSurveyResponse({
    guildId: GUILD,
    surveyVersion: 'thg-saudi-cyber-2026-v3',
    respondentHash: hashFor('member-a'),
    answers: ANSWERS,
    submittedAt: 1_760_001_000,
  });
  assert.equal(saved.created, true);
  assert.equal(saved.response.responseNumber, 1, 'numbering restarts per version');
  assert.equal(await countFor(THG_SURVEY.version), 2);
  assert.equal(await countFor('thg-saudi-cyber-2026-v3'), 1);
});

test('concurrent submissions from one member still yield exactly one response', async () => {
  const submit = () =>
    recordSurveyResponse({
      guildId: GUILD,
      surveyVersion: THG_SURVEY.version,
      respondentHash: hashFor('member-c'),
      answers: ANSWERS,
      submittedAt: 1_760_002_000,
    });
  const results = await Promise.all([submit(), submit(), submit()]);
  assert.equal(results.filter((result) => result.created).length, 1);
  assert.equal(new Set(results.map((result) => result.response.id)).size, 1);
});

test('stored rows carry no Discord identity', async () => {
  const responses = await listSurveyResponses({ guildId: GUILD, surveyVersion: THG_SURVEY.version });
  assert.ok(responses.length > 0);
  for (const response of responses) {
    assert.ok(!('userId' in response) && !('username' in response) && !('displayName' in response));
  }
  const { db } = await import('../src/db/index.js');
  const columns = db
    .prepare('PRAGMA table_info(thg_survey_responses)')
    .all()
    .map((column) => column.name);
  assert.ok(!columns.some((column) => /user|name|avatar|email|phone/i.test(column)), columns.join(','));
});

// --- Notification delivery ---------------------------------------------------
function fakeClient({ channelSend, dmSend } = {}) {
  return {
    channels: {
      fetch: async () => ({ isTextBased: () => true, send: channelSend || (async () => ({ id: 'log-message' })) }),
    },
    users: { fetch: async () => ({ send: dmSend || (async () => ({ id: 'dm-message' })) }) },
  };
}

const SETTINGS = {
  hashSecret: SECRET,
  logChannelId: '222222222222222222',
  recipientUserId: '333333333333333333',
};

test('a successful delivery records both receipts', async () => {
  const saved = await recordSurveyResponse({
    guildId: GUILD,
    surveyVersion: THG_SURVEY.version,
    respondentHash: hashFor('member-notify'),
    answers: ANSWERS,
    submittedAt: 1_760_003_000,
  });
  const result = await deliverSurveyNotifications(fakeClient(), saved.response, { settings: SETTINGS });
  assert.deepEqual(result, {
    logChannel: { ok: true, error: null },
    thgDm: { ok: true, error: null },
  });

  const stored = await getSurveyResponse({
    guildId: GUILD,
    surveyVersion: THG_SURVEY.version,
    respondentHash: hashFor('member-notify'),
  });
  assert.equal(stored.notifications.logChannel.messageId, 'log-message');
  assert.equal(stored.notifications.thgDm.messageId, 'dm-message');
  assert.ok(stored.notifications.logChannel.sentAt > 0);
});

test('an already-delivered response is not notified twice', async () => {
  const stored = await getSurveyResponse({
    guildId: GUILD,
    surveyVersion: THG_SURVEY.version,
    respondentHash: hashFor('member-notify'),
  });
  let sends = 0;
  const client = fakeClient({
    channelSend: async () => {
      sends += 1;
      return { id: 'second-log' };
    },
    dmSend: async () => {
      sends += 1;
      return { id: 'second-dm' };
    },
  });
  assert.deepEqual(await deliverSurveyNotifications(client, stored, { settings: SETTINGS }), {});
  assert.equal(sends, 0);

  const unchanged = await getSurveyResponse({
    guildId: GUILD,
    surveyVersion: THG_SURVEY.version,
    respondentHash: hashFor('member-notify'),
  });
  assert.equal(unchanged.notifications.logChannel.messageId, 'log-message');
});

test('a delivery receipt is written once, so a retry cannot overwrite it', async () => {
  const stored = await getSurveyResponse({
    guildId: GUILD,
    surveyVersion: THG_SURVEY.version,
    respondentHash: hashFor('member-notify'),
  });
  assert.equal(
    await markSurveyNotificationSent({ id: stored.id, channel: 'thgDm', messageId: 'retry-dm' }),
    false,
  );
  const unchanged = await getSurveyResponse({
    guildId: GUILD,
    surveyVersion: THG_SURVEY.version,
    respondentHash: hashFor('member-notify'),
  });
  assert.equal(unchanged.notifications.thgDm.messageId, 'dm-message');
  await assert.rejects(
    () => markSurveyNotificationSent({ id: stored.id, channel: 'nope' }),
    /Unknown survey notification channel/,
  );
});

test('a failing THG DM does not fail the log, the response, or the caller', async () => {
  const saved = await recordSurveyResponse({
    guildId: GUILD,
    surveyVersion: THG_SURVEY.version,
    respondentHash: hashFor('member-dm-closed'),
    answers: ANSWERS,
    submittedAt: 1_760_004_000,
  });
  const client = fakeClient({
    dmSend: async () => {
      throw new Error('Cannot send messages to this user');
    },
  });
  const result = await deliverSurveyNotifications(client, saved.response, { settings: SETTINGS });
  assert.equal(result.logChannel.ok, true);
  assert.equal(result.thgDm.ok, false);
  assert.match(result.thgDm.error, /Cannot send messages/);

  const stored = await getSurveyResponse({
    guildId: GUILD,
    surveyVersion: THG_SURVEY.version,
    respondentHash: hashFor('member-dm-closed'),
  });
  assert.equal(stored.notifications.logChannel.messageId, 'log-message');
  assert.equal(stored.notifications.thgDm.sentAt, null, 'a failed DM leaves no receipt, so it can be retried');
  assert.deepEqual(stored.answers, ANSWERS, 'the response itself is untouched');
});

test('a deleted log channel does not stop the THG DM', async () => {
  const saved = await recordSurveyResponse({
    guildId: GUILD,
    surveyVersion: THG_SURVEY.version,
    respondentHash: hashFor('member-no-channel'),
    answers: ANSWERS,
    submittedAt: 1_760_005_000,
  });
  const client = {
    channels: {
      fetch: async () => {
        throw new Error('Unknown Channel');
      },
    },
    users: { fetch: async () => ({ send: async () => ({ id: 'dm-only' }) }) },
  };
  const result = await deliverSurveyNotifications(client, saved.response, { settings: SETTINGS });
  assert.equal(result.logChannel.ok, false);
  assert.equal(result.thgDm.ok, true);
});

test('unconfigured destinations are reported, not thrown', async () => {
  const saved = await recordSurveyResponse({
    guildId: GUILD,
    surveyVersion: THG_SURVEY.version,
    respondentHash: hashFor('member-unconfigured'),
    answers: ANSWERS,
    submittedAt: 1_760_006_000,
  });
  const result = await deliverSurveyNotifications(fakeClient(), saved.response, { settings: { hashSecret: SECRET } });
  assert.equal(result.logChannel.ok, false);
  assert.match(result.logChannel.error, /not configured/);
  assert.equal(result.thgDm.ok, false);
  assert.match(result.thgDm.error, /not configured/);
});

// --- Identity boundary through the real delivery path ------------------------
test('delivery puts the respondent in the log embed and never in the THG DM', async () => {
  const saved = await recordSurveyResponse({
    guildId: GUILD,
    surveyVersion: THG_SURVEY.version,
    respondentHash: hashFor('member-identity'),
    answers: ANSWERS,
    submittedAt: 1_760_007_000,
  });

  const sent = {};
  const client = {
    channels: {
      fetch: async () => ({
        isTextBased: () => true,
        send: async (payload) => {
          sent.log = JSON.stringify(payload.embeds[0].toJSON());
          return { id: 'log-message' };
        },
      }),
    },
    users: {
      fetch: async () => ({
        send: async (payload) => {
          sent.dm = JSON.stringify(payload.embeds[0].toJSON());
          return { id: 'dm-message' };
        },
      }),
    },
  };

  const userId = '1524368113259380766';
  const result = await deliverSurveyNotifications(client, saved.response, {
    respondent: { userId },
    settings: SETTINGS,
  });
  assert.equal(result.logChannel.ok, true);
  assert.equal(result.thgDm.ok, true);

  assert.ok(sent.log.includes('Submitted By'), 'the log embed names the respondent');
  assert.ok(sent.log.includes(`<@${userId}>`), 'the log embed carries the mention');
  assert.ok(sent.log.includes('Discord User ID'), 'the log embed carries the id field');
  assert.ok(sent.log.includes(userId));

  assert.ok(!sent.dm.includes('Submitted By'), 'the THG DM must not name the respondent');
  assert.ok(!sent.dm.includes('Discord User ID'));
  assert.ok(!sent.dm.includes(userId), 'the THG DM must not carry the Discord id');
  assert.ok(!/<@/.test(sent.dm), 'the THG DM must not carry a mention');
  assert.ok(!sent.dm.includes(hashFor('member-identity')), 'the THG DM must not carry the respondent hash');
});

test('the notification test sends the admin identity to the log channel only', async () => {
  const sent = {};
  const client = {
    channels: {
      fetch: async () => ({
        isTextBased: () => true,
        send: async (payload) => {
          sent.log = JSON.stringify(payload.embeds[0].toJSON());
          return { id: 'log-test' };
        },
      }),
    },
    users: {
      fetch: async () => ({
        send: async (payload) => {
          sent.dm = JSON.stringify(payload.embeds[0].toJSON());
          return { id: 'dm-test' };
        },
      }),
    },
  };

  const result = await testSurveyNotifications(client, {
    requestedBy: 'admin (1234567890123456789)',
    settings: SETTINGS,
  });
  assert.equal(result.logChannel.ok, true);
  assert.equal(result.thgDm.ok, true);
  assert.ok(sent.log.includes('Requested By'));
  assert.ok(sent.log.includes('1234567890123456789'));
  assert.ok(!sent.dm.includes('Requested By'), 'the THG copy omits who ran the test');
  assert.ok(!sent.dm.includes('1234567890123456789'));
});

// --- Configuration validation ------------------------------------------------
test('configuration status flags a missing secret and malformed snowflakes', () => {
  assert.deepEqual(surveyConfigStatus(SETTINGS), {
    hashSecret: 'configured',
    logChannel: 'configured',
    thgRecipient: 'configured',
    definitionProblems: [],
    canAcceptResponses: true,
  });

  const missing = surveyConfigStatus({});
  assert.equal(missing.hashSecret, 'missing');
  assert.equal(missing.logChannel, 'missing');
  assert.equal(missing.thgRecipient, 'missing');
  assert.equal(missing.canAcceptResponses, false, 'no secret means no de-duplication, so no submissions');

  const malformed = surveyConfigStatus({ hashSecret: SECRET, logChannelId: '#news', recipientUserId: 'thg' });
  assert.equal(malformed.logChannel, 'invalid');
  assert.equal(malformed.thgRecipient, 'invalid');
  assert.equal(malformed.canAcceptResponses, true, 'a broken destination still allows collecting answers');
});

// --- Command surface ---------------------------------------------------------
test('every survey subcommand sits behind Manage Server', () => {
  const json = surveyCommand.data.toJSON();
  assert.equal(json.name, 'thg_survey');
  assert.equal(json.default_member_permissions, String(1n << 5n), 'ManageGuild');
  assert.deepEqual(
    json.options.map((option) => option.name).sort(),
    ['export', 'post', 'results', 'test_notifications'],
  );
});

test('a normal member is refused even if the Discord-side gate is overridden', async () => {
  const denied = { memberPermissions: { has: () => false } };
  assert.equal(surveyCommand.hasSurveyAdminPermission(denied), false);
  assert.equal(surveyCommand.hasSurveyAdminPermission({ memberPermissions: { has: () => true } }), true);
  assert.equal(surveyCommand.hasSurveyAdminPermission({}), false);

  let replied = null;
  await surveyCommand.execute({
    ...denied,
    options: {
      getSubcommand: () => {
        throw new Error('the permission gate must run before any subcommand work');
      },
    },
    reply: async (payload) => {
      replied = payload;
    },
  });
  assert.match(replied.content, /Manage Server/);
});

test('survey button and modal interactions route to this command', async () => {
  const routed = [];
  const commands = new Map([
    [
      'thg_survey',
      { handleComponent: async () => routed.push('component'), handleModal: async () => routed.push('modal') },
    ],
  ]);
  const base = {
    guildId: GUILD,
    client: { commands },
    isAutocomplete: () => false,
    isChatInputCommand: () => false,
    isMessageContextMenuCommand: () => false,
  };
  await routeInteraction({
    ...base,
    customId: 'thg_survey:start',
    isMessageComponent: () => true,
    isModalSubmit: () => false,
  });
  await routeInteraction({
    ...base,
    customId: 'thg_survey:submit',
    isMessageComponent: () => false,
    isModalSubmit: () => true,
  });
  assert.deepEqual(routed, ['component', 'modal']);
});
