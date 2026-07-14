import assert from 'node:assert/strict';
import test from 'node:test';

const { matchUrl, tournamentUrl } = await import('../src/lib/render.js');

test('tournamentUrl repairs legacy url: prefixes used in Discord masked links', () => {
  const url = tournamentUrl({
    tournament_url: 'url:https://liquipedia.net/mobilelegends/MWI/2026',
  });

  assert.equal(url, 'https://liquipedia.net/mobilelegends/MWI/2026');
  assert.equal(`[Match](${url})`, '[Match](https://liquipedia.net/mobilelegends/MWI/2026)');
});

test('tournamentUrl rejects unsafe stored schemes and falls back to a trusted source URL', () => {
  assert.equal(tournamentUrl({ tournament_url: 'javascript:alert(1)' }), null);
  assert.equal(
    tournamentUrl({
      tournament_url: 'javascript:alert(1)',
      tournament_source: 'liquipedia',
      tournament_path: 'mobilelegends/MWI/2026',
    }),
    'https://liquipedia.net/mobilelegends/MWI/2026',
  );
});

test('matchUrl keeps direct Liquipedia match links valid', () => {
  assert.equal(
    matchUrl({ source: 'liquipedia', game: 'valorant', external_id: 'Match:Example_123' }),
    'https://liquipedia.net/valorant/Match:Example_123',
  );
});
