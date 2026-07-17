import assert from 'node:assert/strict';
import test from 'node:test';

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
