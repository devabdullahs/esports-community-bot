// Automated supplement to keyboard and visual review; loopback previews only.
import { chromium } from '@playwright/test';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const origin = process.argv[2] || 'http://127.0.0.1:3000';
if (!['127.0.0.1','localhost'].includes(new URL(origin).hostname)) throw Error('Use a loopback preview.');
const axe = await readFile(require.resolve('axe-core/axe.min.js'), 'utf8');
const browser = await chromium.launch();
const report = [];
for (const {width,locale,theme} of [{width:1440,locale:'en',theme:'light'},{width:390,locale:'ar',theme:'dark'}]) {
  const context = await browser.newContext({viewport:{width,height:900}});
  await context.addInitScript(theme => localStorage.setItem('theme',theme),theme);
  const page = await context.newPage();
  for (const path of ['/', '/live', '/tournaments', '/tournaments/2', '/games', '/games/valorant', '/news', '/games/valorant/news/4', '/media/hype-cast/news/5', '/teams/1', '/players/1', '/compare', '/leaderboard', '/predictions', '/mvp', '/login', '/docs/mcp']) {
    const route = locale === 'ar' ? `/ar${path === '/' ? '' : path}` : path;
    await page.goto(origin+route,{waitUntil:'networkidle'});
    await page.evaluate(()=>document.fonts.ready);
    await page.addScriptTag({content:axe});
    const result = await page.evaluate(async()=>{
      const result=await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','best-practice']}});
      return result.violations.map(v=>({id:v.id,impact:v.impact,description:v.description,nodes:v.nodes.map(n=>({target:n.target,html:n.html,summary:n.failureSummary}))}));
    });
    report.push({route,width,theme,violations:result});
    console.log(JSON.stringify(report.at(-1)));
  }
  await context.close();
}
await browser.close();
await mkdir('plans/redesign-evidence',{recursive:true});
await writeFile(resolve('plans/redesign-evidence/accessibility.json'),JSON.stringify(report,null,2));
