import assert from 'node:assert/strict';
import test from 'node:test';

process.env.LOG_LEVEL = 'error';
process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = 'test-client-id';
process.env.DB_PATH = ':memory:';

const { normalizeImageUrl } = await import('../src/services/liquipedia/parsers.js');
const { isAllowedLogoRedirect, isAllowedLogoUrl, rasterLogoContentType } = await import('../src/lib/logoSource.js');

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

test('isAllowedLogoUrl admits only approved https logo hosts', () => {
  assert.equal(isAllowedLogoUrl('https://liquipedia.net/commons/images/foo.png'), true);
  assert.equal(isAllowedLogoUrl('https://assets.esportscommunity.net/media/channel.png'), true);
  // wrong scheme
  assert.equal(isAllowedLogoUrl('http://liquipedia.net/commons/images/foo.png'), false);
  // wrong host
  assert.equal(isAllowedLogoUrl('https://example.com/logo.png'), false);
  assert.equal(isAllowedLogoUrl('https://assets.esportscommunity.net.attacker.com/logo.png'), false);
  // look-alike host must not be treated as a subdomain match
  assert.equal(isAllowedLogoUrl('https://liquipedia.net.attacker.com/x.png'), false);
  assert.equal(isAllowedLogoUrl('https://evil-liquipedia.net/x.png'), false);
  // malformed / empty
  assert.equal(isAllowedLogoUrl('not-a-url'), false);
  assert.equal(isAllowedLogoUrl(''), false);
  assert.equal(isAllowedLogoUrl(null), false);
});

test('isAllowedLogoRedirect admits only approved https redirect hops', () => {
  assert.equal(isAllowedLogoRedirect({ protocol: 'https:', hostname: 'liquipedia.net' }), true);
  assert.equal(isAllowedLogoRedirect({ protocol: 'https:', hostname: 'assets.esportscommunity.net' }), true);
  assert.equal(isAllowedLogoRedirect({ protocol: 'https:', hostname: '169.254.169.254' }), false);
  assert.equal(isAllowedLogoRedirect({ protocol: 'http:', hostname: 'liquipedia.net' }), false);
  assert.equal(isAllowedLogoRedirect({ protocol: 'https:', hostname: 'evil.example' }), false);
  assert.equal(isAllowedLogoRedirect({}), false);
});

test('rasterLogoContentType allows only inert raster logo bytes', () => {
  assert.equal(rasterLogoContentType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'image/png');
  assert.equal(rasterLogoContentType(Buffer.from([0xff, 0xd8, 0xff, 0x00])), 'image/jpeg');
  assert.equal(rasterLogoContentType(Buffer.from('GIF89a')), 'image/gif');
  assert.equal(rasterLogoContentType(Buffer.from('RIFFxxxxWEBP', 'ascii')), 'image/webp');

  assert.equal(rasterLogoContentType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  assert.equal(rasterLogoContentType(Buffer.from('<?xml version="1.0"?><svg></svg>')), null);
  assert.equal(rasterLogoContentType(Buffer.from('not an image')), null);
});
