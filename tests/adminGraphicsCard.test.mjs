import assert from 'node:assert/strict';
import test from 'node:test';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const { renderAdminGraphic } = await import('../src/lib/adminGraphicsCard.js');

test('news promo renders mixed Arabic and Latin text with bundled fonts', async () => {
  const image = await renderAdminGraphic({
    template: 'news-promo',
    owner: 'Apex Legends (EWC)',
    title: '\u0628\u0637\u0648\u0644\u0629 Apex Legends \u0641\u064a \u0643\u0623\u0633 \u0627\u0644\u0639\u0627\u0644\u0645 \u0644\u0644\u0631\u064a\u0627\u0636\u0627\u062a \u0627\u0644\u0625\u0644\u0643\u062a\u0631\u0648\u0646\u064a\u0629',
    summary: '\u0645\u0644\u062e\u0635 \u0627\u0644\u062e\u0628\u0631 \u0645\u0639 EWC 2026 \u0648\u0623\u0633\u0645\u0627\u0621 \u0627\u0644\u0641\u0631\u0642.',
  });

  assert.ok(Buffer.isBuffer(image) && image.length > 10_000, 'renders a non-empty image');
  assert.deepEqual([...image.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
});

test('graphics renderer honors portrait format, theme, alignment, and export scale', async () => {
  const image = await renderAdminGraphic({
    template: 'match-result',
    tournament: 'Esports World Cup 2026',
    game: 'Dota 2',
    teamA: 'Team Falcons',
    teamB: 'Vici Gaming',
    logoA: null,
    logoB: null,
    scoreA: 2,
    scoreB: 0,
    format: '4:5',
    language: 'both',
    alignment: 'center',
    style: 'light',
    scale: 2,
  });
  const decoded = await loadImage(image);
  assert.equal(decoded.width, 2160);
  assert.equal(decoded.height, 2700);
});

test('16:9 renders at broadcast resolution and every style produces a PNG', async () => {
  const input = {
    template: 'match-result',
    tournament: 'Esports World Cup 2026',
    game: 'Dota 2',
    teamA: 'Team Falcons',
    teamB: 'Vici Gaming',
    logoA: null,
    logoB: null,
    scoreA: 0,
    scoreB: 2,
    format: '16:9',
    language: 'en',
    alignment: 'center',
    scale: 1,
  };
  for (const style of ['ewc-teal', 'midnight', 'carbon', 'slate', 'light']) {
    const image = await renderAdminGraphic({ ...input, style });
    const decoded = await loadImage(image);
    assert.equal(decoded.width, 1920, `${style} width`);
    assert.equal(decoded.height, 1080, `${style} height`);
  }
});

test('Arabic language renders the mirrored RTL match layout', async () => {
  const image = await renderAdminGraphic({
    template: 'match-result',
    tournament: 'كأس العالم للرياضات الإلكترونية ٢٠٢٦',
    game: 'Dota 2',
    teamA: 'Team Falcons',
    teamB: 'Vici Gaming',
    logoA: null,
    logoB: null,
    scoreA: 0,
    scoreB: 2,
    format: '16:9',
    language: 'ar',
    alignment: 'center',
    style: 'ewc-teal',
    scale: 1,
  });
  assert.ok(Buffer.isBuffer(image) && image.length > 10_000, 'renders a non-empty image');
  assert.deepEqual([...image.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
});

test('media branding is composited into the exported PNG above card content', async () => {
  const logoCanvas = createCanvas(80, 40);
  const logoContext = logoCanvas.getContext('2d');
  logoContext.fillStyle = '#ff00ff';
  logoContext.fillRect(0, 0, 80, 40);

  const image = await renderAdminGraphic({
    template: 'match-result',
    tournament: 'Esports World Cup 2026',
    game: 'Dota 2',
    teamA: 'Team Falcons',
    teamB: 'Vici Gaming',
    logoA: null,
    logoB: null,
    scoreA: 2,
    scoreB: 0,
    format: '1:1',
    language: 'en',
    alignment: 'center',
    style: 'ewc-teal',
    scale: 1,
    brandPlacement: 'custom',
    brandX: 50,
    brandY: 50,
    brandSize: 12,
    brandImage: await loadImage(logoCanvas.toBuffer('image/png')),
  });

  const decoded = await loadImage(image);
  const output = createCanvas(decoded.width, decoded.height);
  const outputContext = output.getContext('2d');
  outputContext.drawImage(decoded, 0, 0);
  const center = outputContext.getImageData(decoded.width / 2, decoded.height / 2, 1, 1).data;
  assert.deepEqual([...center], [255, 0, 255, 255]);
});
