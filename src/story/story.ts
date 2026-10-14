import './story.css';
import { buildBridge, forcesAt, reactions, selfWeightKN, influence, depthStudy, bucklingCurves, safetyStudy, truckLoads, TRUCK } from './model';
import { bridgeSvg } from './bridge-svg';
import { lineChart, barChart, rangeChart } from './charts';
import { solveCase } from '../analysis';
import type { DBeam, DNode } from '../design';

const T0 = performance.now();
const $ = (id: string) => document.getElementById(id)!;
/** newtons → '123 kN' */
const kN = (n: number) => `${Math.round(Math.abs(n) / 1000).toLocaleString('en-US')} kN`;
const css = (v: string) => getComputedStyle(document.body).getPropertyValue(v).trim();
const set = (key: string, text: string) => document.querySelectorAll(`[data-n="${key}"]`).forEach((el) => (el.textContent = text));

// links into the simulator (built single file vs dev server)
const gameHref = location.protocol === 'file:' ? 'Play%20Span.html' : 'index.html';
document.querySelectorAll<HTMLAnchorElement>('[data-game]').forEach((a) => (a.href = gameHref + (a.dataset.game ? '#' + a.dataset.game : '')));

// ---------------------------------------------------------------- model numbers
const bridge = buildBridge();
const midRear = 8 - TRUCK.length / 2;
const midForces = forcesAt(bridge, midRear).forces;
const truckKN = (TRUCK.mass * 9.81) / 1000;
const inf = influence(bridge, [bridge.midTop, bridge.midDeck, bridge.endDiag]);
const infTop = Math.min(...inf.get(bridge.midTop)!.map((p) => p[1]));
const infDiag = Math.min(...inf.get(bridge.endDiag)!.map((p) => p[1]));
const infDiagAt = inf.get(bridge.endDiag)!.find((p) => p[1] === infDiag)![0];
const maxAbs = Math.max(...[...influence(bridge, bridge.design.beams.map((b) => b.id)).values()].flatMap((pts) => pts.map((p) => Math.abs(p[1] * 1000))));

set('truckT', `${TRUCK.mass / 1000}-tonne`);
set('truckKN', kN(truckKN * 1000));
set('chordPeak', kN(infTop * 1000));
set('axles', TRUCK.axles.map((a) => kN(a.share * TRUCK.mass * 9.81)).join(', '));
set('selfKN', kN(selfWeightKN(bridge) * 1000));
const reacts = reactions(bridge, forcesAt(bridge, midRear + 1.5).forces);
set('reacts', `${kN(reacts[0].Ry)} on the left and ${kN(reacts[1].Ry)} on the right`);
set('midTop', kN(midForces.get(bridge.midTop)!));
set('infTop', kN(infTop * 1000));
set('infDiag', `${kN(infDiag * 1000)} (truck front at ${infDiagAt.toFixed(1)} m)`);
const d = bridge.design;
const used = d.nodes.filter((n) => d.beams.some((b) => b.a === n.id || b.b === n.id));
const m = d.beams.length, r = used.filter((n) => n.anchor).length * 2, j = used.length;
set('count', `${m} + ${r} = ${m + r} ≥ 2 × ${j} = ${2 * j}`);

// ---------------------------------------------------------------- hero: truck loops across, live colours
const hero = bridgeSvg($('heroStage'));
let heroX = -TRUCK.length - 4;
function heroLoop() {
  heroX += 0.06;
  if (heroX > 22) heroX = -TRUCK.length - 6;
  const f = forcesAt(bridge, heroX).forces;
  hero(bridge, { forces: f, maxForce: maxAbs, truckRear: heroX });
  requestAnimationFrame(heroLoop);
}
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
if (reduceMotion) hero(bridge, { forces: midForces, maxForce: maxAbs, truckRear: midRear });
else heroLoop();

// ---------------------------------------------------------------- chapter 1
const s1 = bridgeSvg($('s1'));
const ch1: Record<string, () => void> = {
  approach: () => s1(bridge, { truckRear: -TRUCK.length - 2 }),
  axles: () => s1(bridge, { truckRear: midRear, axles: truckLoads(bridge, midRear).axles }),
  reactions: () => s1(bridge, { truckRear: midRear + 1.5, axles: truckLoads(bridge, midRear + 1.5).axles, reactions: reacts }),
};

// ---------------------------------------------------------------- chapter 2: square vs triangle (solved for real)
const sqNodes: DNode[] = [
  { id: -1, x: 0, y: 0, anchor: true }, { id: -2, x: 4, y: 0, anchor: true },
  { id: 1, x: 0, y: 3, anchor: false }, { id: 2, x: 4, y: 3, anchor: false },
];
const sqBeams: DBeam[] = [
  { id: 10, a: -1, b: 1, mat: 'steel', sec: 1 }, { id: 11, a: -2, b: 2, mat: 'steel', sec: 1 }, { id: 12, a: 1, b: 2, mat: 'steel', sec: 1 },
];
// horizontal 10 kN push: emulate with a tiny helper — solveCase takes vertical loads, so rotate the problem 90°
const rot = (ns: DNode[]) => ns.map((n) => ({ ...n, x: -n.y, y: n.x }));
const square = solveCase(rot(sqNodes), sqBeams, new Map([[1, -10000]]), false);
const triBeams = [...sqBeams, { id: 13, a: -1, b: 2, mat: 'steel' as const, sec: 1 }];
const tri = solveCase(rot(sqNodes), triBeams, new Map([[1, -10000]]), false);
set('squareVerdict', square ? 'stable' : '“unstable mechanism — the matrix is singular”');
set('diagKN', tri ? kN(tri.forces.get(13)!) : '—');

function frameSvg(host: HTMLElement) {
  host.innerHTML = `<div class="frames"><figure class="fr" id="frSq"><svg viewBox="-1.5 -4.6 7 6"></svg><figcaption></figcaption></figure>
    <figure class="fr" id="frTri"><svg viewBox="-1.5 -4.6 7 6"></svg><figcaption></figcaption></figure></div>`;
  const draw = (id: string, beams: DBeam[], forces: Map<number, number> | null, lean: boolean, caption: string, ok: boolean) => {
    const fig = host.querySelector('#' + id)!;
    const sh = lean ? 1.15 : 0;
    const pos = (n: DNode) => ({ x: n.x + (n.anchor ? 0 : sh), y: n.anchor ? n.y : Math.sqrt(9 - sh * sh) });
    let s = `<line class="ground" x1="-1.2" x2="5.2" y1="0" y2="0"/>`;
    for (const b of beams) {
      const A = pos(sqNodes.find((n) => n.id === b.a)!), B = pos(sqNodes.find((n) => n.id === b.b)!);
      const N = forces?.get(b.id);
      const cls = N === undefined ? 'mem plain' : N >= 0 ? 'mem ten' : 'mem com';
      s += `<line class="${cls}" x1="${A.x}" y1="${-A.y}" x2="${B.x}" y2="${-B.y}" style="--k:${N === undefined ? 0.6 : Math.min(1, 0.35 + Math.abs(N) / 15000)}"/>`;
      if (N !== undefined && Math.abs(N) > 100) s += `<text class="fl" x="${(A.x + B.x) / 2 + 0.25}" y="${-(A.y + B.y) / 2}">${N >= 0 ? '+' : '−'}${Math.abs(N / 1000).toFixed(1)}</text>`;
    }
    for (const n of sqNodes) {
      const p = pos(n);
      s += n.anchor ? `<path class="anchor" d="M${p.x},${-p.y} l-0.3,0.45 h0.6z"/>` : `<circle class="joint" cx="${p.x}" cy="${-p.y}" r="0.12"/>`;
    }
    const top = pos(sqNodes[2]);
    s += `<g class="push"><line x1="${top.x - 1.6}" x2="${top.x - 0.25}" y1="${-top.y}" y2="${-top.y}"/><path d="M${top.x - 0.12},${-top.y} l-0.4,-0.2 v0.4z"/><text x="${top.x - 1.6}" y="${-top.y - 0.3}">10 kN</text></g>`;
    fig.querySelector('svg')!.innerHTML = s;
    fig.querySelector('figcaption')!.innerHTML = `<span class="${ok ? 'ok' : 'bad'}">${ok ? '✓ Stable' : '✗ Mechanism'}</span> ${caption}`;
  };
  return (step: string) => {
    draw('frSq', sqBeams, null, true, 'm + r = 3 + 4 = 7 &lt; 2j = 8 — it leans over', !!square);
    draw('frTri', triBeams, step === 'square' ? null : tri?.forces ?? null, false, 'm + r = 4 + 4 = 8 = 2j — locked solid', !!tri);
    host.querySelector('#frTri')!.classList.toggle('pending', step === 'square');
  };
}
const s2 = frameSvg($('s2'));
const ch2: Record<string, () => void> = {
  square: () => s2('square'),
  triangle: () => s2('triangle'),
  count: () => s2('count'),
};

// ---------------------------------------------------------------- chapter 3: drive it yourself + influence lines
$('s3').innerHTML = `<div id="s3b"></div>
  <div class="drive"><button id="driveBtn" aria-label="Play">▶</button><input id="driveX" type="range" min="${-TRUCK.length}" max="16" step="0.05" value="${midRear}" aria-label="Truck position"/><span id="driveLbl"></span></div>
  <div id="s3c" class="hidden-soft"></div>`;
const s3 = bridgeSvg($('s3b'));
const slider = $('driveX') as HTMLInputElement;
let labels = true;
const infChart = lineChart($('s3c'), [
  { id: 'top', name: 'Top chord (centre)', short: 'Top chord', color: css('--s1'), points: inf.get(bridge.midTop)! },
  { id: 'deck', name: 'Road deck (centre)', short: 'Road deck', color: css('--s2'), points: inf.get(bridge.midDeck)! },
  { id: 'diag', name: 'End diagonal', color: css('--s3'), points: inf.get(bridge.endDiag)! },
], { title: 'Force in three members as the truck crosses', xLabel: 'Truck front position (m)', yLabel: 'Axial force (kN, + tension)', xFmt: (v) => `${v} m`, zeroLine: true, caption: 'Member force (kN) by truck front position' });
function drawDrive() {
  const x = Number(slider.value);
  const f = forcesAt(bridge, x).forces;
  s3(bridge, { forces: f, maxForce: maxAbs, truckRear: x, labels, focus: null });
  infChart.marker(x + TRUCK.length);
  $('driveLbl').textContent = `truck front at ${(x + TRUCK.length).toFixed(1)} m · top chord ${kN(f.get(bridge.midTop)!)}`;
}
slider.addEventListener('input', () => { playing = false; drawDrive(); });
let playing = false;
$('driveBtn').addEventListener('click', () => { playing = !playing; if (Number(slider.value) >= 15.9) slider.value = String(-TRUCK.length); tick(); });
function tick() {
  $('driveBtn').textContent = playing ? '❚❚' : '▶';
  if (!playing) return;
  slider.value = String(Math.min(16, Number(slider.value) + 0.08));
  drawDrive();
  if (Number(slider.value) >= 16) { playing = false; $('driveBtn').textContent = '▶'; return; }
  requestAnimationFrame(tick);
}
const ch3: Record<string, () => void> = {
  colors: () => { slider.value = String(midRear); labels = true; $('s3c').classList.add('hidden-soft'); drawDrive(); },
  drive: () => { labels = false; $('s3c').classList.add('hidden-soft'); drawDrive(); },
  influence: () => { labels = false; $('s3c').classList.remove('hidden-soft'); drawDrive(); },
};

// ---------------------------------------------------------------- chapter 4: buckling
const bc = bucklingCurves();
const at = (p: [number, number][], L: number) => p.find((q) => Math.abs(q[0] - L) < 0.01)![1];
set('steelT', kN(at(bc.steelT, 2) * 1000));
set('steelC1', kN(at(bc.steelC, 1) * 1000));
set('steelC4', kN(at(bc.steelC, 4) * 1000));
set('steelC8', kN(at(bc.steelC, 8) * 1000));
const buck = lineChart($('s4'), [
  { id: 'st', name: 'Steel 100 mm · pulled', short: 'Steel, pulled', color: css('--s3'), points: bc.steelT, dash: true },
  { id: 'sc', name: 'Steel 100 mm · pushed', short: 'Steel, pushed', color: css('--s1'), points: bc.steelC },
  { id: 'tc', name: 'Timber 100 mm · pushed', short: 'Timber, pushed', color: css('--s2'), points: bc.timberC },
], { title: 'How much load one bar can carry, by its length', xLabel: 'Member length (m)', yLabel: 'Capacity (kN)', xFmt: (v) => `${v} m`, yDomain: [0, 700], caption: 'Characteristic capacity (kN) by member length' });
const ch4: Record<string, () => void> = {
  pull: () => { buck.focus(['st']); buck.annotate([{ x: 6, y: at(bc.steelT, 6), text: 'same at every length', dy: -18 }]); },
  push: () => { buck.focus(['sc', 'tc']); buck.annotate([{ x: 1, y: at(bc.steelC, 1), text: kN(at(bc.steelC, 1) * 1000), dx: 14, dy: -10 }, { x: 4, y: at(bc.steelC, 4), text: kN(at(bc.steelC, 4) * 1000), dy: -16 }, { x: 8, y: at(bc.steelC, 8), text: kN(at(bc.steelC, 8) * 1000), dx: -70, dy: -22 }]); },
  rule: () => { buck.focus(null); buck.annotate([{ x: 4, y: at(bc.steelC, 4), text: '4 m → 8 m: strength falls by ⅔', dy: -26 }]); },
};

// ---------------------------------------------------------------- chapter 5: depth
const depth = depthStudy();
const dAt = (h: number) => depth.find((r) => Math.abs(r.h - h) < 1e-6)!;
set('d1', kN(dAt(1).chord * 1000)); set('d5', kN(dAt(5).chord * 1000));
set('def1', `${dAt(1).defl.toFixed(0)} mm`); set('def5', `${dAt(5).defl.toFixed(0)} mm`);
set('cost1', `$${dAt(1).cost.toLocaleString('en-US')}`); set('cost5', `$${dAt(5).cost.toLocaleString('en-US')}`);
const dch = lineChart($('s5'), [
  { id: 'chord', name: 'Top chord', color: css('--s1'), points: depth.map((r) => [r.h, r.chord]) },
  { id: 'diag', name: 'End diagonal', color: css('--s2'), points: depth.map((r) => [r.h, r.diag]) },
], { title: 'Design force (1.35G + 1.5Q) as the truss gets deeper', xLabel: 'Truss depth (m)', yLabel: 'Compression design force (kN)', xFmt: (v) => `${v} m`, caption: 'Design compression (kN) by truss depth, 16 m span, 26 t truck' });
const ch5: Record<string, () => void> = {
  shallow: () => { dch.focus(['chord']); dch.annotate([{ x: 1, y: dAt(1).chord, text: `1 m deep: ${kN(dAt(1).chord * 1000)}`, dx: 16, dy: 6 }]); },
  deep: () => { dch.focus(['chord']); dch.annotate([{ x: 1, y: dAt(1).chord, text: kN(dAt(1).chord * 1000), dx: 16, dy: 6 }, { x: 5, y: dAt(5).chord, text: `5 m: ${kN(dAt(5).chord * 1000)}`, dx: -90, dy: -22 }]); },
  trade: () => { dch.focus(null); dch.annotate([{ x: 2, y: dAt(2).chord, text: 'span/8 = 2 m', dx: 18, dy: -14 }]); },
};

// ---------------------------------------------------------------- chapter 6: safety (runs the real dynamic test once)
let safety: ReturnType<typeof barChart> | null = null;
let safetyStep = 1;
function buildSafety() {
  if (safety) return;
  const s = safetyStudy();
  set('sPeak', kN(s.peak * 1000)); set('sNEd', kN(s.NEd * 1000)); set('sNRd', kN(s.NRd * 1000)); set('sNRk', kN(s.NRk * 1000));
  safety = barChart($('s6'), [
    { label: 'Peak force in the load test', value: s.peak, color: css('--s1'), note: 'measured, dynamic' },
    { label: 'Design force', value: s.NEd, color: css('--s1'), note: '1.35 × dead + 1.5 × traffic' },
    { label: 'Design resistance', value: s.NRd, color: css('--s3'), note: 'strength ÷ 1.25' },
    { label: 'Actual failure load', value: s.NRk, color: css('--s3'), note: 'buckling + crushing' },
  ], { title: `One member, four numbers — ${s.member}`, unit: 'kN', legend: [{ name: 'Load on the member', color: css('--s1') }, { name: 'Member strength', color: css('--s3') }], caption: 'Critical member demand vs capacity (kN)' });
  timings.safety = s.ms;
  safety.reveal(safetyStep);
  showTiming();
}
const ch6: Record<string, () => void> = {
  peak: () => { safetyStep = 1; buildSafety(); safety?.reveal(1); },
  ned: () => { safetyStep = 2; buildSafety(); safety?.reveal(2); },
  nrd: () => { safetyStep = 4; buildSafety(); safety?.reveal(4); },
};

// ---------------------------------------------------------------- chapter 7: forms
const gray = css('--ink-3');
rangeChart($('s7'), [
  { label: 'Beam / girder', from: 10, to: 200, color: gray, record: { value: 301, name: 'Stolma' } },
  { label: 'Truss', from: 40, to: 500, color: gray, record: { value: 549, name: 'Québec' } },
  { label: 'Arch', from: 40, to: 500, color: gray, record: { value: 552, name: 'Chaotianmen' } },
  { label: 'Cable-stayed', from: 150, to: 1000, color: gray, record: { value: 1104, name: 'Russky' } },
  { label: 'Suspension', from: 350, to: 2000, color: gray, record: { value: 2023, name: '1915 Çanakkale' } },
  { label: 'Your bridges in Span', from: 10, to: 48, color: css('--s1'), you: true },
], { title: 'Main span by bridge type (log scale)', caption: 'Typical economic main-span range and a record example, metres' });
const ch7: Record<string, () => void> = {
  forms: () => $('s7').classList.remove('you-on'),
  you: () => $('s7').classList.add('you-on'),
};

// ---------------------------------------------------------------- scroll engine
const handlers: Record<string, Record<string, () => void>> = { c1: ch1, c2: ch2, c3: ch3, c4: ch4, c5: ch5, c6: ch6, c7: ch7 };
const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    const step = e.target as HTMLElement;
    const chap = step.closest('.chapter')!;
    chap.querySelectorAll('.step').forEach((s) => s.classList.toggle('active', s === step));
    handlers[chap.id]?.[step.dataset.step!]?.();
  }
}, { rootMargin: '-45% 0px -45% 0px' });
document.querySelectorAll('.step').forEach((s) => io.observe(s));
// initial states so stages are never empty
ch1.approach(); ch2.square(); ch3.colors(); ch4.pull(); ch5.shallow(); ch7.forms();
// precompute the dynamic test shortly after first paint
setTimeout(buildSafety, 600);

addEventListener('scroll', () => {
  const p = scrollY / (document.documentElement.scrollHeight - innerHeight);
  $('progress').style.width = (p * 100).toFixed(1) + '%';
}, { passive: true });

// ---------------------------------------------------------------- timing
const timings: Record<string, number> = { model: performance.now() - T0 };
function showTiming() {
  $('timing').textContent = `Computed in your browser: structural model and charts ${timings.model.toFixed(0)} ms${timings.safety ? ` · dynamic load test ${timings.safety.toFixed(0)} ms` : ''}.`;
  console.info(`[story] model ${timings.model.toFixed(1)} ms, safety sim ${timings.safety?.toFixed(1) ?? '—'} ms`);
}
showTiming();
