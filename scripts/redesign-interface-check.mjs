import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const browser = await chromium.launch();
const results = [];
for (const locale of ['en', 'ar']) {
  // 320 CSS px at 2x density models the reflow area of a 640px window at 200%.
  // CSS zoom is not browser zoom: it leaves viewport media queries unchanged.
  const page = await browser.newPage({ viewport: { width: 320, height: 600 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
  for (const path of ['/', '/live', '/teams', '/players', '/tournaments/2']) {
    const route = `${locale === 'ar' ? '/ar' : ''}${path}`;
    await page.goto(`http://127.0.0.1:3000${route}`, { waitUntil: 'networkidle' });
    const state = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      viewport: innerWidth,
      inputs: [...document.querySelectorAll('main input:not([type=hidden]),main select')].map(e => ({
        size: getComputedStyle(e).fontSize,
        labels: [...e.labels || []].map(l => l.textContent.trim()),
      })),
      moving: [...document.querySelectorAll('*')].filter(e => parseFloat(getComputedStyle(e).animationDuration) > .001).length,
    }));
    await page.keyboard.press('Tab');
    const skip = await page.locator(':focus').textContent();
    await page.keyboard.press('Enter');
    const target = await page.locator(':focus').getAttribute('id');
    results.push({ route, ...state, skip, target });
    await page.screenshot({ path: `plans/redesign-evidence/skill-${locale}-${path.replaceAll('/', '-') || 'home'}.png` });
  }
  await page.emulateMedia({ forcedColors: 'active' });
  await page.keyboard.press('Tab');
  results.push({ locale, forcedFocus: await page.locator(':focus').evaluate(e => ({ outline: getComputedStyle(e).outline, name: e.textContent })) });
  await page.close();
}
await browser.close();
await writeFile('plans/redesign-evidence/interface-check.json', JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
