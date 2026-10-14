/** Starter project shows the perfect solution; other projects never offer one, even after repeated failures. */
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
const out = process.argv[2];
const t0 = Date.now();
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--window-size=1440,900'] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => { if (!sessionStorage.getItem('init')) { localStorage.clear(); localStorage.setItem('span2:seenWelcome', 'true'); sessionStorage.setItem('init', '1'); } });
const p = await ctx.newPage();
const errors: string[] = [];
p.on('pageerror', (e) => errors.push(e.message));
await p.goto(pathToFileURL(process.cwd() + '/Play Span.html').href);
await p.waitForSelector('#brief:not(.hidden)');
console.log('first project:', await p.textContent('#levelCode'), await p.textContent('#levelName'), '| solution card:', !!(await p.$('#briefCard [data-ex]')));
await p.evaluate(() => document.querySelector('#briefCard [data-ex]')!.scrollIntoView({ block: 'center' }));
await p.screenshot({ path: `${out}/s-starter-brief.jpg`, quality: 55, type: 'jpeg' });
await p.click('#briefCard [data-ex]');
await p.click('#speedBtn'); await p.click('#speedBtn');
await p.click('#playBtn');
await p.waitForSelector('#modal:not(.hidden) .result', { timeout: 60000 });
console.log('starter test:', await p.textContent('#modalCard h2'), '|', await p.textContent('.diag-head b'));
await p.click('[data-act="edit"]');
// go to Farm Track and fail twice with an empty bridge
await p.keyboard.press('l');
await p.click('[data-level="l1"]');
await p.waitForSelector('#brief:not(.hidden)');
console.log('Farm Track solution card:', !!(await p.$('#briefCard [data-ex]')));
await p.click('#briefCard .btn.primary');
for (let i = 0; i < 2; i++) {
  await p.click('#playBtn');
  await p.waitForSelector('#modal:not(.hidden) .result', { timeout: 60000 });
  await p.waitForTimeout(300);
  console.log(`Farm Track fail ${i + 1}: example button offered =`, !!(await p.$('[data-act="example"]')));
  await p.click('[data-act="edit"]');
}
console.log('errors', errors, 'ms', Date.now() - t0);
await b.close();
