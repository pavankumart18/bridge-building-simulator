import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
const out = process.argv[2];
const t0 = Date.now();
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--window-size=1440,900'] });
for (const scheme of ['light', 'dark'] as const) {
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme })).newPage();
  const errors: string[] = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto(pathToFileURL(process.cwd() + '/Bridge Story.html').href);
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${out}/${scheme}-0hero.jpg`, quality: 60, type: 'jpeg' });
  if (scheme === 'dark') { await p.evaluate(() => document.querySelector('[data-step="influence"]')!.scrollIntoView({ block: 'center' })); await p.waitForTimeout(900); await p.screenshot({ path: `${out}/dark-c3.jpg`, quality: 60, type: 'jpeg' }); console.log(scheme, errors); continue; }
  for (const step of ['reactions', 'triangle', 'colors', 'influence', 'push', 'deep', 'nrd', 'you']) {
    await p.evaluate((s) => document.querySelector(`[data-step="${s}"]`)!.scrollIntoView({ block: 'center' }), step);
    await p.waitForTimeout(1100);
    await p.screenshot({ path: `${out}/${scheme}-${step}.jpg`, quality: 60, type: 'jpeg' });
  }
  const text = await p.evaluate(() => [...document.querySelectorAll('[data-n]')].filter((e) => !e.textContent).map((e) => e.getAttribute('data-n')));
  console.log(scheme, 'errors', errors, 'empty numbers', text, 'timing', await p.evaluate(() => document.getElementById('timing')!.textContent));
}
await b.close();
console.log('ms', Date.now() - t0);
