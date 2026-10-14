/** Loads weak bridges into the built game and checks the failure hints end to end. */
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { Design } from '../src/design';
import { ALL_LEVELS } from '../src/levels';
import type { MaterialId } from '../src/materials';

function truss(levelId: string, h: number, web: [MaterialId, number], chord: [MaterialId, number], deck: number, panel: number) {
  const d = new Design(ALL_LEVELS.find((l) => l.id === levelId)!);
  const [L, R] = d.nodes;
  const n = Math.round((R.x - L.x) / panel), dk = [L];
  for (let i = 1; i < n; i++) dk.push(d.addNode(L.x + ((R.x - L.x) * i) / n, L.y + ((R.y - L.y) * i) / n));
  dk.push(R);
  for (let i = 0; i < n; i++) d.addBeam(dk[i].id, dk[i + 1].id, 'deck', deck);
  const top = dk.slice(0, -1).map((p, i) => d.addNode((p.x + dk[i + 1].x) / 2, (p.y + dk[i + 1].y) / 2 + h));
  top.forEach((t, i) => { d.addBeam(dk[i].id, t.id, ...web); d.addBeam(t.id, dk[i + 1].id, ...web); if (i) d.addBeam(top[i - 1].id, t.id, ...chord); });
  return d.serialize();
}
const out = process.argv[2];
const t0 = Date.now();
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--window-size=1440,900'] });
for (const [name, levelId, json] of [
  ['collapse', 'l8', truss('l8', 3.5, ['steel', 1], ['steel', 2], 0, 3)],
  ['improve', 'l3', truss('l3', 2.5, ['timber', 1], ['timber', 2], 0, 2)],
] as const) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(([id, j]) => { localStorage.setItem('span2:level', JSON.stringify(id)); localStorage.setItem('span2:design:' + id, JSON.stringify(j)); localStorage.setItem('span2:seenWelcome', 'true'); }, [levelId, json]);
  const p = await ctx.newPage();
  const errors: string[] = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(pathToFileURL(process.cwd() + '/Play Span.html').href);
  await p.click('#briefCard .btn.primary');
  await p.waitForTimeout(500);
  const hints = await p.$$eval('#checks .hint', (els) => els.map((e) => e.textContent));
  console.log(`[${name}] check hints:`, hints);
  await p.click('#speedBtn'); await p.click('#speedBtn'); // 4×
  await p.click('#playBtn');
  await p.waitForSelector('#modal:not(.hidden) .result', { timeout: 60000 });
  await p.waitForTimeout(500);
  console.log(`[${name}] result:`, (await p.textContent('#modalCard h2')), '|', (await p.textContent('.diag-head b').catch(() => 'no diag')));
  console.log(`[${name}] why:`, await p.textContent('.diag p').catch(() => '—'));
  await p.screenshot({ path: `${out}/h-${name}-modal.jpg`, quality: 55, type: 'jpeg' });
  if (await p.$('[data-act="showme"]')) {
    await p.click('[data-act="showme"]');
    await p.waitForTimeout(700);
    console.log(`[${name}] after show-me: selected inspector title =`, await p.textContent('#inspector .title').catch(() => '—'));
    await p.screenshot({ path: `${out}/h-${name}-showme.jpg`, quality: 55, type: 'jpeg' });
  }
  console.log(`[${name}] errors:`, errors);
  await ctx.close();
}
await b.close();
console.log('ms', Date.now() - t0);
