import assert from 'node:assert/strict';
import test from 'node:test';
import { renderEwcShareCard } from '../src/lib/ewcShareCard.js';

function isPng(buf) {
  return Buffer.isBuffer(buf) && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
}

const picks = ['Team Falcons', 'Team Liquid', 'Twisted Minds', 'Gen.G', 'T1', 'Cloud9'];

test('renderEwcShareCard returns a PNG (English, full pick list)', async () => {
  const png = await renderEwcShareCard({ displayName: 'Tester', seasonPicks: picks, weeklyCount: 3, locale: 'en' });
  assert.ok(isPng(png), 'expected a PNG buffer');
});

test('renderEwcShareCard returns a PNG (Arabic)', async () => {
  const png = await renderEwcShareCard({ displayName: 'عبدالله', seasonPicks: picks.slice(0, 3), locale: 'ar' });
  assert.ok(isPng(png), 'expected a PNG buffer');
});

test('renderEwcShareCard handles a member with no picks', async () => {
  const png = await renderEwcShareCard({ displayName: 'Empty', seasonPicks: [], weeklyCount: 0, locale: 'en' });
  assert.ok(isPng(png), 'expected a PNG buffer even with no picks');
});

test('renderEwcShareCard accepts optional avatar + qr PNG buffers', async () => {
  // A previously-rendered card is a valid PNG, so reuse it to exercise the
  // optional avatar (loadImage/clip) and qr (drawOptionalQr) image paths.
  const image = await renderEwcShareCard({ displayName: 'Seed', seasonPicks: ['A'] });
  const png = await renderEwcShareCard({ displayName: 'Q', seasonPicks: picks, avatar: image, qr: image, locale: 'en' });
  assert.ok(isPng(png), 'expected a PNG buffer with avatar + qr buffers');
});
