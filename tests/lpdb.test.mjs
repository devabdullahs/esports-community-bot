import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DISCORD_TOKEN ||= 'test-token';
process.env.DISCORD_CLIENT_ID ||= 'test-client';
process.env.DISCORD_GUILD_ID ||= 'test-guild';

const { scheduleConditions } = await import('../src/services/lpdb.js');

test('LPDB tournament schedules query the official parent field', () => {
  assert.equal(
    scheduleConditions('FC_Pro_26/World_Championship'),
    '[[parent::FC_Pro_26/World_Championship]] OR [[pagename::FC_Pro_26/World_Championship]]',
  );
});

test('LPDB tournament schedule conditions normalize spaces and reject condition syntax', () => {
  assert.equal(scheduleConditions('FC Pro 26/World Championship'),
    '[[parent::FC_Pro_26/World_Championship]] OR [[pagename::FC_Pro_26/World_Championship]]');
  assert.equal(scheduleConditions('Event]] OR [[finished::0'), null);
  assert.equal(scheduleConditions(''), null);
});
