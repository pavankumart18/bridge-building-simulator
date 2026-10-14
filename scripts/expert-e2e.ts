/** Expert tier in the built game: tiered project grid, briefs, earthquake test (Seismic Valley), heavy haul. */
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import REF from './reference-solutions.json';
const out = process.argv[2] ?? '.video-tmp/shots';
const t0 = Date.now();
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--window-size=1440,900'] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript((ref) => {
  if (sessionStorage.getItem('init')) return;
  localStorage.clear(); localStorage.setItem('span2:seenWelcome', 'true');
  for (const [id, r] of Object.entries(ref)) localStorage.setItem('span2:design:' + id, JSON.stringify((r as { json: string }).json));
  sessionStorage.setItem('init', '1');
}, REF);
const p = await ctx.newPage();
const errors: string[] = [];
p.on('pageerror', (e) => errors.push(e.message));
await p.goto(pathToFileURL(process.cwd() + '/Play Span.html').href);
await p.waitForSelector('#brief:not(.hidden)');
await p.click('#briefCard .btn.primary');
await p.keyboard.press('l');
await p.waitForSelector('#levels:not(.hidden)');
console.log('tiers:', await p.$$eval('.tier-head b', (e) => e.map((x) => x.textContent).join(' / ')), '| cards:', await p.$$eval('#levelGrid .level', (e) => e.length));
await p.screenshot({ path: `${out}/x-grid.jpg`, quality: 60, type: 'jpeg' });
await p.evaluate(() => document.querySelector('[data-level="lm2"]')!.scrollIntoView({ block: 'center' }));
await p.screenshot({ path: `${out}/x-grid-expert.jpg`, quality: 60, type: 'jpeg' });

async function runLevel(id: string, shotAt: number[]) {
  await p.keyboard.press('l');
  await p.click(`[data-level="${id}"]`);
  await p.waitForSelector('#brief:not(.hidden)');
  await p.screenshot({ path: `${out}/x-${id}-brief.jpg`, quality: 60, type: 'jpeg' });
  await p.click('#briefCard .btn.primary');
  await p.screenshot({ path: `${out}/x-${id}-design.jpg`, quality: 60, type: 'jpeg' });
  const checks = await p.$$eval('.check', (e) => e.map((x) => x.textContent!.replace(/\s+/g, ' ').trim().slice(0, 40)));
  await p.click('#playBtn');
  const ts = Date.now();
  if (id === 'l12' || id === 'lm1') {
    await p.waitForFunction(() => document.getElementById('toast')!.textContent!.includes('Earthquake'), null, { timeout: 15000 });
    console.log(`${id}: earthquake alert after ${((Date.now() - ts) / 1000).toFixed(1)} s`);
  }
  for (const s of shotAt) { await p.waitForTimeout(s * 1000 - (Date.now() - ts)); await p.screenshot({ path: `${out}/x-${id}-t${s}.jpg`, quality: 60, type: 'jpeg' }); }
  await p.waitForSelector('#modal:not(.hidden) .result', { timeout: 120000 });
  await p.waitForTimeout(400);
  const stars = await p.$$eval('.stars3 .on, .stars3 svg.on', (e) => e.length).catch(() => -1);
  console.log(`${id}: ${await p.textContent('#modalCard h2')} · stars ${stars} · ${((Date.now() - ts) / 1000).toFixed(1)} s · checks ${checks.join(' | ')}`);
  await p.screenshot({ path: `${out}/x-${id}-result.jpg`, quality: 60, type: 'jpeg' });
  await p.click('[data-act="edit"]');
}
const which = process.argv[3]?.split(',') ?? ['l12', 'l11', 'l15'];
for (const id of which) await runLevel(id, id === 'l12' ? [6, 9] : [8]);
console.log('errors', errors.length ? errors : 'none', '· total', ((Date.now() - t0) / 1000).toFixed(1), 's');
await b.close();
