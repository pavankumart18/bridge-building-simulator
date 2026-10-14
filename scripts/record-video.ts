/**
 * Records "How to use Span" as a video by driving the real game in Chrome.
 * Needs the dev server (npm run dev, port 5199) and Google Chrome installed.
 * Usage: npx tsx scripts/record-video.ts  → "Span Tutorial.mp4"
 */
import { chromium, type Page } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Design } from '../src/design';
import { PLAYGROUND } from '../src/levels';

const URL = process.env.SPAN_URL ?? 'http://localhost:5199/';
const W = 1440, H = 900;
const OUT_DIR = join(process.cwd(), '.video-tmp');
const T0 = Date.now();
const log = (m: string) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1).padStart(6)}s] ${m}`);

// ready-made Playground bridge (two steel truss spans onto the mid-river pier)
function playgroundDesign() {
  const d = new Design(PLAYGROUND);
  const [L, R, , , P1, P2] = d.nodes;
  const mid = d.addNode(24, 0);
  d.addBeam(P1.id, mid.id, 'steel', 3);
  d.addBeam(P2.id, mid.id, 'steel', 3);
  for (const [a, b] of [[L, mid], [mid, R]]) {
    const n = 10, dk = [a];
    for (let i = 1; i < n; i++) dk.push(d.addNode(a.x + ((b.x - a.x) * i) / n, 0));
    dk.push(b);
    for (let i = 0; i < n; i++) d.addBeam(dk[i].id, dk[i + 1].id, 'deck', 1);
    const top = dk.slice(0, -1).map((p, i) => d.addNode((p.x + dk[i + 1].x) / 2, 3));
    top.forEach((t, i) => {
      d.addBeam(dk[i].id, t.id, 'steel', 2);
      d.addBeam(t.id, dk[i + 1].id, 'steel', 2);
      if (i) d.addBeam(top[i - 1].id, t.id, 'steel', 3);
    });
  }
  return d.serialize();
}

const OVERLAY = `
addEventListener('DOMContentLoaded', () => {
  const css = document.createElement('style');
  css.textContent = \`
    .rec-cursor{position:fixed;left:0;top:0;width:26px;height:26px;z-index:2147483647;pointer-events:none;transform:translate(-3px,-2px);transition:none}
    .rec-cursor svg{filter:drop-shadow(0 2px 3px rgba(0,0,0,.6))}
    .rec-ripple{position:fixed;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;border:3px solid #5aaaff;z-index:2147483646;pointer-events:none;animation:recr .5s ease-out forwards}
    @keyframes recr{to{transform:scale(3.2);opacity:0}}
    .rec-cap{position:fixed;left:50%;top:74px;transform:translateX(-50%);z-index:2147483645;pointer-events:none;
      background:rgba(10,14,22,.94);border:1px solid rgba(90,170,255,.55);border-radius:16px;padding:12px 22px 13px;
      box-shadow:0 14px 40px rgba(0,0,0,.5);text-align:center;max-width:900px;transition:opacity .25s}
    .rec-cap .n{display:inline-block;background:#5aaaff;color:#0b1424;font:800 13px Inter,system-ui;border-radius:8px;padding:2px 9px;margin-right:10px;vertical-align:3px}
    .rec-cap .t{font:800 22px Inter,system-ui;color:#fff;letter-spacing:-.01em}
    .rec-cap .s{font:500 15px Inter,system-ui;color:#c9d6ea;margin-top:5px}
    .rec-title{position:fixed;inset:0;z-index:2147483644;display:grid;place-items:center;background:radial-gradient(circle at 50% 40%,#1d2a44,#0b1020);transition:opacity .6s}
    .rec-title h1{font:800 64px Inter,system-ui;color:#fff;margin:0;letter-spacing:-.03em;text-align:center}
    .rec-title p{font:500 22px Inter,system-ui;color:#9fb3d1;text-align:center;margin:12px 0 0}
    .rec-title .logo{width:90px;height:90px;margin:0 auto 22px}
  \`;
  document.head.appendChild(css);
  const cur = document.createElement('div');
  cur.className = 'rec-cursor';
  cur.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2l15 11-6.5 1.2 3.8 7.3-3 1.5-3.8-7.4L4 20z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  document.body.appendChild(cur);
  addEventListener('mousemove', (e) => { cur.style.left = e.clientX + 'px'; cur.style.top = e.clientY + 'px'; }, true);
  addEventListener('mousedown', (e) => {
    const r = document.createElement('div'); r.className = 'rec-ripple';
    r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px';
    document.body.appendChild(r); setTimeout(() => r.remove(), 600);
  }, true);
  const mk = document.createElement('div');
  mk.style.cssText = 'position:fixed;left:0;bottom:0;width:8px;height:8px;z-index:2147483647;pointer-events:none;background:rgb(0,0,0)';
  document.body.appendChild(mk);
  window.__mark = (k) => { mk.style.background = 'rgb(' + (k * 17) + ',' + (255 - k * 17) + ',200)'; };
  window.__cap = (n, t, s) => {
    let el = document.querySelector('.rec-cap');
    if (!t) { if (el) el.style.opacity = '0'; return; }
    if (!el) { el = document.createElement('div'); el.className = 'rec-cap'; document.body.appendChild(el); }
    el.style.opacity = '1';
    el.innerHTML = '<div class="t">' + (n ? '<span class="n">' + n + '</span>' : '') + t + '</div>' + (s ? '<div class="s">' + s + '</div>' : '');
  };
  window.__title = (t, s, show) => {
    let el = document.querySelector('.rec-title');
    if (!show) { if (el) { el.style.opacity = '0'; setTimeout(() => el.remove(), 700); } return; }
    if (!el) { el = document.createElement('div'); el.className = 'rec-title'; document.body.appendChild(el); }
    el.innerHTML = '<div><svg class="logo" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#e3402f"/><path d="M4 22h24M6 22l5-9 5 9 5-9 5 9M11 13h10" stroke="#fff" stroke-width="2.4" fill="none" stroke-linejoin="round"/></svg><h1>' + t + '</h1><p>' + s + '</p></div>';
  };
});`;

const wait = (p: Page, ms: number) => p.waitForTimeout(ms);
// chapter markers, measured from the moment the page (and its video) starts
let videoT0 = 0;
const chapters: { n: string; title: string; sub: string; t: number }[] = [];
const cap = (p: Page, n: string, t: string, s = '') => {
  const first = n && !chapters.some((c) => c.n === n);
  if (first) chapters.push({ n, title: t, sub: s, t: Math.max(0, (Date.now() - videoT0) / 1000 - 0.5) });
  return p.evaluate(([a, b, c, k]) => { (window as any).__cap(a, b, c); if (k) (window as any).__mark(Number(k)); }, [n, t, s, first ? n : '']);
};

async function moveTo(p: Page, x: number, y: number, ms = 450) {
  const steps = Math.max(8, Math.round(ms / 16));
  await p.mouse.move(x, y, { steps });
}
async function world(p: Page, x: number, y: number) {
  return p.evaluate(([a, b]) => (window as any).__span.toScreen(a, b), [x, y]) as Promise<{ x: number; y: number }>;
}
async function clickSel(p: Page, sel: string, pause = 350) {
  const box = await p.locator(sel).first().boundingBox();
  if (!box) throw new Error('not found: ' + sel);
  await moveTo(p, box.x + box.width / 2, box.y + box.height / 2);
  await wait(p, 120);
  await p.mouse.down(); await wait(p, 70); await p.mouse.up();
  await wait(p, pause);
}
async function hoverSel(p: Page, sel: string, ms = 1500) {
  const box = await p.locator(sel).first().boundingBox();
  if (box) await moveTo(p, box.x + box.width / 2, box.y + Math.min(box.height / 2, 60), 600);
  await wait(p, ms);
}
async function dragWorld(p: Page, a: [number, number], b: [number, number], ms = 650) {
  const s = await world(p, a[0], a[1]);
  const e = await world(p, b[0], b[1]);
  await moveTo(p, s.x, s.y, 350);
  await p.mouse.down();
  await moveTo(p, e.x, e.y, ms);
  await wait(p, 120);
  await p.mouse.up();
  await wait(p, 200);
}
async function clickWorld(p: Page, x: number, y: number, pause = 400) {
  const s = await world(p, x, y);
  await moveTo(p, s.x, s.y, 500);
  await p.mouse.down(); await wait(p, 60); await p.mouse.up();
  await wait(p, pause);
}

async function main() {
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });
  log('launching Chrome');
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: [`--window-size=${W},${H}`] });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: OUT_DIR, size: { width: W, height: H } } });
  await ctx.addInitScript(OVERLAY);
  const pgJson = playgroundDesign();
  await ctx.addInitScript((json) => { try { localStorage.setItem('span2:design:playground', JSON.stringify(json)); localStorage.setItem('span2:view', '"util"'); } catch { /* ignore */ } }, pgJson);
  const p = await ctx.newPage();
  videoT0 = Date.now();
  await p.goto(URL);
  await p.waitForSelector('#welcome, .welcome', { timeout: 15000 });
  await p.evaluate(() => (window as any).__title('How to build a bridge', 'Span — Bridge Engineering Simulator · 3-minute guide', true));
  await wait(p, 3200);
  await p.evaluate(() => (window as any).__title('', '', false));
  await wait(p, 700);
  log('intro');

  // --- skip the welcome, look at the brief
  await cap(p, '', 'Welcome screen', 'Click Skip to go straight to the first project');
  await wait(p, 1200);
  await clickSel(p, '[data-w="skip"]', 600);
  await cap(p, '1', 'Read the project brief', 'Span, design vehicles, deflection limit, budget — and the engineering idea behind the project');
  await hoverSel(p, '#briefCard .constraints', 2600);
  await hoverSel(p, '#briefCard table', 2200);
  await clickSel(p, '#briefCard .btn.primary', 700);
  log('brief');

  // --- the site
  await cap(p, '2', 'The site: a 10 m creek', 'The red triangles are anchors — fixed foundations. Your bridge connects them.');
  const a0 = await world(p, 0, 0), a1 = await world(p, 10, 0);
  await moveTo(p, a0.x, a0.y + 18, 700); await wait(p, 900);
  await moveTo(p, a1.x, a1.y + 18, 900); await wait(p, 1200);

  // --- deck
  await cap(p, '3', 'Choose Road deck', 'Click it in the Tools panel, or press 1. Vehicles can only drive on the deck.');
  await clickSel(p, '.tool[data-tool="deck"]', 900);
  await hoverSel(p, '#sections', 2400);
  await cap(p, '4', 'Drag to build the deck', 'Drag from the left anchor. Panels are max 3 m long, so build five 2 m panels, joint to joint.');
  for (const x of [0, 2, 4, 6, 8]) await dragWorld(p, [x, 0], [x + 2, 0]);
  await wait(p, 900);
  log('deck built');
  await cap(p, '', 'The live checks re-analyse after every change', 'A deck on its own sags like a rope → the deflection check fails (red)');
  await hoverSel(p, '#objectivesSec', 3600);

  // --- truss
  await cap(p, '5', 'Choose Timber', 'Press 2 — light, cheap glulam. Pick a section in the left panel.');
  await clickSel(p, '.tool[data-tool="timber"]', 900);
  await cap(p, '6', 'Add triangles under the deck', 'Drag from each deck joint down 1.5 m to make V shapes — triangles cannot change shape');
  for (const x of [0, 2, 4, 6, 8]) {
    await dragWorld(p, [x, 0], [x + 1, -1.5], 550);
    await dragWorld(p, [x + 1, -1.5], [x + 2, 0], 550);
  }
  await cap(p, '6', 'Join the bottom points', 'This bottom chord carries the tension');
  for (const x of [1, 3, 5, 7]) await dragWorld(p, [x, -1.5], [x + 2, -1.5], 550);
  await wait(p, 800);
  await cap(p, '', 'All checks are green ✓', 'Stable · strength (ULS) · deflection (SLS) · gradient · budget');
  await hoverSel(p, '#objectivesSec', 3200);
  log('truss built');

  // --- views
  await cap(p, '7', 'Read the analysis', 'Utilisation: how hard each member works under the factored design load (green → red)');
  await clickSel(p, '#viewSeg [data-view="util"]', 2200);
  await cap(p, '7', 'Forces view', 'Blue = tension (pulled) · Red = compression (pushed) · labels in kN');
  await clickSel(p, '#viewSeg [data-view="force"]', 2800);
  await clickSel(p, '#viewSeg [data-view="util"]', 600);

  // --- inspect
  await cap(p, '8', 'Inspect a member', 'Press V (Select) and click a member');
  await clickSel(p, '.tool[data-tool="select"]', 500);
  await clickWorld(p, 4, -1.5, 900);
  await cap(p, '8', 'The inspector', 'Section, slenderness L/r, tension & buckling resistance, dead + traffic forces');
  await hoverSel(p, '#inspectorSec', 3400);
  await cap(p, '8', 'Change the section', 'Smaller sections are cheaper — the utilisation goes up');
  await p.locator('#inspSec').selectOption('0');
  await wait(p, 2200);
  await p.locator('#inspSec').selectOption('1');
  await wait(p, 1200);
  log('inspector');

  // --- load test
  await cap(p, '9', 'Run the load test', 'Press Load test (Space). Real vehicles cross; members break if overloaded.');
  await clickSel(p, '#playBtn', 600);
  await cap(p, '9', 'Watching live forces', 'Hover a member to read its force · pause P · step . · speed F · follow C');
  await wait(p, 1800);
  const mm = await world(p, 5, -1.5);
  await moveTo(p, mm.x, mm.y, 700);
  await p.waitForSelector('#modal:not(.hidden) .result', { timeout: 60000 });
  await wait(p, 600);
  await cap(p, '10', 'Results and stars', '★ safe crossing · ★ code compliant · ★ efficient (≤ 80% of budget)');
  await hoverSel(p, '#modalCard .stars3', 4200);
  await clickSel(p, '[data-act="edit"]', 800);
  log('load test');

  // --- playground
  await cap(p, '11', 'The Playground', 'Free testing: unlimited budget, traffic, driving, loads and earthquakes');
  await clickSel(p, '#playgroundBtn', 900);
  await clickSel(p, '#briefCard .btn.primary', 900);
  await clickSel(p, '#playBtn', 800);
  await cap(p, '11', 'Send traffic both ways', 'Pick a vehicle, then Send from either bank');
  await clickSel(p, '.veh[data-kind="bus"]', 300);
  await clickSel(p, '[data-act="spawnL"]', 300);
  await clickSel(p, '.veh[data-kind="hgv"]', 300);
  await clickSel(p, '[data-act="spawnR"]', 300);
  await clickSel(p, '[data-act="traffic"]', 2600);
  await cap(p, '12', 'Drive it yourself', 'Click Drive (or click any vehicle) and use ← → to drive');
  await clickSel(p, '.veh[data-kind="car"]', 300);
  await clickSel(p, '[data-act="drive"]', 1500);
  await p.keyboard.down('ArrowRight');
  await wait(p, 4500);
  await p.keyboard.up('ArrowRight');
  await wait(p, 800);
  await cap(p, '13', 'Drop heavy loads', 'Choose a weight, then click above the deck');
  await clickSel(p, '[data-mass="20000"]', 500);
  await clickWorld(p, 12, 6, 1500);
  await clickWorld(p, 36, 6, 2200);
  await cap(p, '14', 'Earthquake', 'Shake the ground and watch how the structure responds');
  await clickSel(p, '[data-act="quake"]', 5200);
  await clickSel(p, '[data-act="quake"]', 1000);
  log('playground');

  await cap(p, '', '');
  await p.evaluate(() => (window as any).__title("Now it's your turn", 'Projects (L) · Brief (B) · Handbook (?) · Have fun, engineer!', true));
  await wait(p, 3500);

  const video = p.video();
  await ctx.close();
  await browser.close();
  const webm = video ? await video.path() : readdirSync(OUT_DIR).map((f) => join(OUT_DIR, f))[0];
  log(`raw video ${webm} (${(statSync(webm).size / 1e6).toFixed(1)} MB) — converting`);
  writeFileSync(join(process.cwd(), 'src', 'video-chapters.json'), JSON.stringify(chapters, null, 2));
  log(`wrote ${chapters.length} chapters to src/video-chapters.json`);
  const out = join(process.cwd(), 'Span Tutorial.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, '-c:v', 'libx264', '-preset', 'medium', '-crf', '24', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out]);
  rmSync(OUT_DIR, { recursive: true, force: true });
  // read the corner colour code back out of the video to get frame-exact chapter times
  writeFileSync(join(process.cwd(), 'src', 'video-chapters.json'), JSON.stringify(chapters, null, 2));
  const decoded = execFileSync('npx', ['tsx', 'scripts/decode-chapters.ts'], { encoding: 'utf8' }).trim();
  log(`chapter times measured from video: ${decoded}`);
  log(`done → ${out} (${(statSync(out).size / 1e6).toFixed(1)} MB)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
