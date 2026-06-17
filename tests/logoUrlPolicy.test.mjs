import assert from 'node:assert/strict';
import test from 'node:test';

process.env.LOG_LEVEL = 'error';
process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = 'test-client-id';
process.env.DB_PATH = ':memory:';

const { normalizeImageUrl } = await import('../src/services/liquipedia/parsers.js');
const { isAllowedLogoRedirect, isAllowedLogoUrl } = await import('../src/lib/logoSource.js');

test('normalizeImageUrl resolves relative + protocol-relative URLs to liquipedia.net https', () => {
  assert.equal(
    normalizeImageUrl('/commons/images/foo.png'),
    'https://liquipedia.net/commons/images/foo.png',
  );
  assert.equal(
    normalizeImageUrl('//liquipedia.net/commons/images/foo.png'),
    'https://liquipedia.net/commons/images/foo.png',
  );
  assert.equal(
    normalizeImageUrl('https://liquipedia.net/commons/images/foo.png'),
    'https://liquipedia.net/commons/images/foo.png',
  );
  assert.equal(normalizeImageUrl('data:image/png;base64,AAAA'), null);
  assert.equal(normalizeImageUrl(''), null);
});

test('isAllowedLogoUrl admits only https liquipedia.net', () => {
  assert.equal(isAllowedLogoUrl('https://liquipedia.net/commons/images/foo.png'), true);
  // wrong scheme
  assert.equal(isAllowedLogoUrl('http://liquipedia.net/commons/images/foo.png'), false);
  // wrong host
  assert.equal(isAllowedLogoUrl('https://example.com/logo.png'), false);
  // look-alike host must not be treated as a subdomain match
  assert.equal(isAllowedLogoUrl('https://liquipedia.net.attacker.com/x.png'), false);
  assert.equal(isAllowedLogoUrl('https://evil-liquipedia.net/x.png'), false);
  // malformed / empty
  assert.equal(isAllowedLogoUrl('not-a-url'), false);
  assert.equal(isAllowedLogoUrl(''), false);
  assert.equal(isAllowedLogoUrl(null), false);
});

test('isAllowedLogoRedirect admits only https liquipedia.net redirect hops', () => {
  assert.equal(isAllowedLogoRedirect({ protocol: 'https:', hostname: 'liquipedia.net' }), true);
  assert.equal(isAllowedLogoRedirect({ protocol: 'https:', hostname: '169.254.169.254' }), false);
  assert.equal(isAllowedLogoRedirect({ protocol: 'http:', hostname: 'liquipedia.net' }), false);
  assert.equal(isAllowedLogoRedirect({ protocol: 'https:', hostname: 'evil.example' }), false);
  assert.equal(isAllowedLogoRedirect({}), false);
});
