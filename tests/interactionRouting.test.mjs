import assert from 'node:assert/strict';
import test from 'node:test';

const { execute } = await import('../src/events/interactionCreate.js');

test('message component interactions route to command handleComponent', async () => {
  let routed = false;
  const interaction = {
    customId: 'ewc_predict:ww:2026:user',
    client: {
      commands: new Map([
        [
          'ewc_predict',
          {
            async handleComponent(value) {
              routed = value === interaction;
            },
          },
        ],
      ]),
    },
    isAutocomplete: () => false,
    isMessageComponent: () => true,
    isModalSubmit: () => false,
  };

  await execute(interaction);

  assert.equal(routed, true);
});
