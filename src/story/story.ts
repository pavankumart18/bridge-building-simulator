import './story.css';
import { buildBridge, forcesAt, reactions, selfWeightKN, influence, depthStudy, bucklingCurves, safetyStudy, truckLoads, TRUCK, LEVEL, type Bridge } from './model';
import { bridgeSvg } from './bridge-svg';
import { lineChart, barChart, rangeChart } from './charts';
import { analyse, solveCase } from '../analysis';
import { Sim } from '../physics';
import { MATERIALS, type MaterialId } from '../materials';
import { VEHICLES, type VehicleType, type VehicleKind } from '../vehicles';
import { audio } from '../audio';
import type { DBeam, DNode } from '../design';

const T0 = performance.now();
const $ = (id: string) => document.getElementById(id)!;
/** newtons → '123 kN' */
const kN = (n: number) => `${Math.round(Math.abs(n) / 1000).toLocaleString('en-US')} kN`;
const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const css = (v: string) => getComputedStyle(document.body).getPropertyValue(v).trim();
const set = (key: string, text: string) => document.querySelectorAll(`[data-n="${key}"]`).forEach((el) => (el.textContent = text));
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// links into the simulator (built single file vs dev server)
const gameHref = location.protocol === 'file:' ? 'Play%20Span.html' : 'index.html';
document.querySelectorAll<HTMLAnchorElement>('[data-game]').forEach((a) => (a.href = gameHref + (a.dataset.game ? '#' + a.dataset.game : '')));

// ---------------------------------------------------------------- sound (off by default)
audio.muted = true;
$('soundBtn').addEventListener('click', () => {
  audio.muted = !audio.muted;
  audio.unlock();
  $('soundBtn').textContent = audio.muted ? '🔇 Sound off' : '🔊 Sound on';
  $('soundBtn').setAttribute('aria-pressed', String(!audio.muted));
  if (!audio.muted) audio.click();
});

// ---------------------------------------------------------------- quiz widget
interface QuizOpt { label: string; value: string }
function quiz(id: string, opts: QuizOpt[], correct: string, reveal: () => string) {
  const el = document.querySelector<HTMLElement>(`[data-quiz="${id}"]`);
  if (!el) return;
  el.innerHTML = `<div class="q-opts">${opts.map((o) => `<button data-v="${o.value}">${o.label}</button>`).join('')}</div><div class="q-out" aria-live="polite"></div>`;
  el.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => {
    const ok = b.dataset.v === correct;
    el.querySelectorAll<HTMLButtonElement>('button').forEach((x) => {
      x.disabled = true;
      x.classList.toggle('right', x.dataset.v === correct);
      x.classList.toggle('wrong', x === b && !ok);
    });
    el.querySelector('.q-out')!.innerHTML = `<b>${ok ? '✓ Right!' : '✗ Not quite.'}</b> ${reveal()} <span class="q-next">Keep scrolling ↓</span>`;
    ok ? audio.success() : audio.error();
  }));
}

// ---------------------------------------------------------------- model numbers
const bridge = buildBridge();
const midRear = 8 - TRUCK.length / 2;
const midForces = forcesAt(bridge, midRear).forces;
const inf = influence(bridge, [bridge.midTop, bridge.midDeck, bridge.endDiag]);
const infTop = Math.min(...inf.get(bridge.midTop)!.map((p) => p[1]));
const infDiag = Math.min(...inf.get(bridge.endDiag)!.map((p) => p[1]));
const infDiagAt = inf.get(bridge.endDiag)!.find((p) => p[1] === infDiag)![0];
const allIds = bridge.design.beams.map((b) => b.id);
const peakAbs = (V: VehicleType) => Math.max(...[...influence(bridge, allIds, V).values()].flatMap((pts) => pts.map((p) => Math.abs(p[1] * 1000))));
const maxAbs = peakAbs(TRUCK);
const colourScale = peakAbs(VEHICLES.design); // heaviest vehicle sets the colour scale, so lighter ones look lighter

set('truckT', `${TRUCK.mass / 1000}-tonne`);
set('truckKN', kN(TRUCK.mass * 9.81));
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

// ---------------------------------------------------------------- hero: pick a vehicle, watch it cross
const hero = bridgeSvg($('heroStage'), false);
let heroV: VehicleType = TRUCK;
let heroX = -TRUCK.length - 4;
const PICKS: [VehicleKind, string][] = [['car', 'Car'], ['van', 'Van'], ['bus', 'City bus'], ['hgv', 'Tipper truck'], ['design', 'HL-93 truck']];
const picker = $('picker');
picker.insertAdjacentHTML('beforeend', PICKS.map(([k, n]) => `<button role="radio" data-k="${k}" aria-checked="${k === 'hgv'}">${n}<small>${VEHICLES[k].mass / 1000} t</small></button>`).join(''));
function pickVehicle(k: VehicleKind, sound = true) {
  heroV = VEHICLES[k];
  picker.querySelectorAll<HTMLElement>('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.k === k)));
  set('heroKN', kN(heroV.mass * 9.81));
  set('heroWhat', `${heroV.name.toLowerCase()} weight`);
  set('heroPeak', kN(peakAbs(heroV)));
  heroX = -heroV.length - 2;
  if (reduceMotion) hero.draw(bridge, { forces: forcesAt(bridge, 8 - heroV.length / 2, true, heroV).forces, maxForce: colourScale, truckRear: 8 - heroV.length / 2, vehicle: heroV });
  if (sound) audio.click();
}
picker.querySelectorAll<HTMLElement>('button').forEach((b) => b.addEventListener('click', () => pickVehicle(b.dataset.k as VehicleKind)));
pickVehicle('hgv', false);
function heroLoop() {
  heroX += 0.06;
  if (heroX > 22) heroX = -heroV.length - 6;
  hero.draw(bridge, { forces: forcesAt(bridge, heroX, true, heroV).forces, maxForce: colourScale, truckRear: heroX, vehicle: heroV });
  requestAnimationFrame(heroLoop);
}
if (!reduceMotion) heroLoop();

// ---------------------------------------------------------------- chapter 1
const s1 = bridgeSvg($('s1'));
const ch1: Record<string, () => void> = {
  approach: () => s1.draw(bridge, { truckRear: -TRUCK.length - 2 }),
  axles: () => s1.draw(bridge, { truckRear: midRear, axles: truckLoads(bridge, midRear).axles }),
  reactions: () => s1.draw(bridge, { truckRear: midRear + 1.5, axles: truckLoads(bridge, midRear + 1.5).axles, reactions: reacts }),
};

// ---------------------------------------------------------------- chapter 2: square vs triangle (solved for real)
const sqNodes: DNode[] = [
  { id: -1, x: 0, y: 0, anchor: true }, { id: -2, x: 4, y: 0, anchor: true },
  { id: 1, x: 0, y: 3, anchor: false }, { id: 2, x: 4, y: 3, anchor: false },
];
const sqBeams: DBeam[] = [
  { id: 10, a: -1, b: 1, mat: 'steel', sec: 1 }, { id: 11, a: -2, b: 2, mat: 'steel', sec: 1 }, { id: 12, a: 1, b: 2, mat: 'steel', sec: 1 },
];
// a sideways push: rotate the frame 90° so the solver's vertical load acts horizontally
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
const ch2: Record<string, () => void> = { square: () => s2('square'), triangle: () => s2('triangle'), count: () => s2('count') };

// ---------------------------------------------------------------- chapter 3: predict, drive, influence lines, break it
const groups: [string, string, number[]][] = [
  ['top', 'Top chord', bridge.topChord],
  ['deck', 'Road deck', bridge.deckMembers],
  ['end', 'End diagonals', bridge.design.beams.filter((b) => b.mat !== 'deck' && !bridge.topChord.includes(b.id) && (b.a < 0 || b.b < 0)).map((b) => b.id)],
  ['mid', 'Middle diagonals', bridge.design.beams.filter((b) => b.mat !== 'deck' && !bridge.topChord.includes(b.id) && b.a >= 0 && b.b >= 0).map((b) => b.id)],
];
const squeeze = groups.map(([v, , ids]) => [v, Math.max(0, ...ids.map((id) => -(midForces.get(id) ?? 0)))] as [string, number]);
const hardest = squeeze.reduce((a, b) => (b[1] > a[1] ? b : a));
const gName = (v: string) => groups.find((g) => g[0] === v)![1];
quiz('chord', groups.map(([v, l]) => ({ label: l, value: v })), hardest[0], () =>
  `The most-squeezed ${gName(hardest[0]).toLowerCase().replace(/s$/, '')} member carries ${kN(hardest[1])} of compression. Busiest member in each other group — ${squeeze.filter((x) => x[0] !== hardest[0]).map((x) => `${gName(x[0])}: ${x[1] > 0 ? kN(x[1]) : 'in tension'}`).join(' · ')}.`);

$('s3').innerHTML = `<div id="s3b"></div>
  <div class="drive" id="driveRow"><button id="driveBtn" aria-label="Play">▶</button><input id="driveX" type="range" min="${-TRUCK.length}" max="16" step="0.05" value="${midRear}" aria-label="Truck position"/><span id="driveLbl"></span></div>
  <div id="s3c" class="hidden-soft"></div>`;
const s3 = bridgeSvg($('s3b'));
const slider = $('driveX') as HTMLInputElement;
let labels = true;
let s3mode: 'drive' | 'break' = 'drive';
const infChart = lineChart($('s3c'), [
  { id: 'top', name: 'Top chord (centre)', short: 'Top chord', color: css('--s1'), points: inf.get(bridge.midTop)! },
  { id: 'deck', name: 'Road deck (centre)', short: 'Road deck', color: css('--s2'), points: inf.get(bridge.midDeck)! },
  { id: 'diag', name: 'End diagonal', color: css('--s3'), points: inf.get(bridge.endDiag)! },
], { title: 'Force in three members as the truck crosses', xLabel: 'Truck front position (m)', yLabel: 'Axial force (kN, + tension)', xFmt: (v) => `${v} m`, zeroLine: true, caption: 'Member force (kN) by truck front position' });
function drawDrive() {
  if (s3mode !== 'drive') return;
  const x = Number(slider.value);
  const f = forcesAt(bridge, x).forces;
  s3.draw(bridge, { forces: f, maxForce: maxAbs, truckRear: x, labels });
  infChart.marker(x + TRUCK.length);
  $('driveLbl').textContent = `truck front at ${(x + TRUCK.length).toFixed(1)} m · top chord ${kN(f.get(bridge.midTop)!)}`;
}
let playing = false;
slider.addEventListener('input', () => { playing = false; drawDrive(); });
$('driveBtn').addEventListener('click', () => { playing = !playing; if (Number(slider.value) >= 15.9) slider.value = String(-TRUCK.length); tick(); });
function tick() {
  $('driveBtn').textContent = playing ? '❚❚' : '▶';
  if (!playing) return;
  slider.value = String(Math.min(16, Number(slider.value) + 0.08));
  drawDrive();
  if (Number(slider.value) >= 16) { playing = false; $('driveBtn').textContent = '▶'; return; }
  requestAnimationFrame(tick);
}

// break it: remove members, then run the real dynamic simulation
const removed = new Set<number>();
let breakSim: Sim | null = null;
let breakRaf = 0;
const drawBreakEditor = () => s3.draw(bridge, { removable: true, removed, truckRear: -TRUCK.length - 1.5 });
s3.onMemberClick = (id) => {
  if (s3mode !== 'break' || breakSim) return;
  removed.has(id) ? removed.delete(id) : removed.add(id);
  audio.remove();
  $('breakOut').textContent = removed.size ? `${removed.size} member${removed.size > 1 ? 's' : ''} removed.` : '';
  drawBreakEditor();
};
function stopBreak() {
  cancelAnimationFrame(breakRaf);
  breakSim = null;
}
$('breakReset').addEventListener('click', () => { stopBreak(); removed.clear(); $('breakOut').textContent = ''; drawBreakEditor(); });
$('breakGo').addEventListener('click', () => {
  stopBreak();
  const beams = d.beams.filter((b) => !removed.has(b.id));
  const nodes = d.nodes.filter((n) => beams.some((b) => b.a === n.id || b.b === n.id));
  const linear = solveCase(nodes, beams, new Map(), true);
  const sim = new Sim(LEVEL, nodes, beams);
  breakSim = sim;
  let breaks = 0;
  const t0 = performance.now();
  $('breakOut').innerHTML = linear ? 'Truck on its way…' : '<b>The solver already knows:</b> without that member the truss is a mechanism. Watch…';
  audio.start();
  const loop = () => {
    if (breakSim !== sim) return;
    sim.step();
    for (const e of sim.events) if (e.type === 'break') { breaks++; audio.snap(e.mat); }
    sim.events.length = 0;
    s3.drawSim(sim, bridge, removed, maxAbs);
    const out = sim.outcome;
    if (out !== 'running' || sim.time > 14) {
      const ok = out === 'success';
      $('breakOut').innerHTML = ok
        ? `<b class="okc">✓ It held.</b> Peak member stress ${Math.round(sim.maxRatio * 100)}% of capacity${removed.size ? ' — the bridge found another load path, but with far less margin.' : '.'}`
        : `<b class="badc">✗ Collapse.</b> ${breaks} member${breaks === 1 ? '' : 's'} failed. ${removed.size ? 'Every triangle depends on all three sides.' : ''}`;
      ok ? audio.success() : audio.fail();
      console.info(`[story] break-it sim ${sim.time.toFixed(1)} s in ${(performance.now() - t0).toFixed(0)} ms`);
      breakSim = null;
      return;
    }
    breakRaf = requestAnimationFrame(loop);
  };
  breakRaf = requestAnimationFrame(loop);
});

function enterDrive(showChart: boolean, withLabels: boolean) {
  stopBreak();
  s3mode = 'drive';
  labels = withLabels;
  $('driveRow').classList.remove('hidden-soft');
  $('s3c').classList.toggle('hidden-soft', !showChart);
  drawDrive();
}
const ch3: Record<string, () => void> = {
  predict: () => {
    stopBreak();
    s3mode = 'drive';
    playing = false;
    slider.value = String(midRear);
    $('driveRow').classList.add('hidden-soft');
    $('s3c').classList.add('hidden-soft');
    s3.draw(bridge, { truckRear: midRear });
  },
  colors: () => { slider.value = String(midRear); enterDrive(false, true); },
  drive: () => enterDrive(false, false),
  influence: () => enterDrive(true, false),
  break: () => {
    s3mode = 'break';
    playing = false;
    $('driveRow').classList.add('hidden-soft');
    $('s3c').classList.add('hidden-soft');
    if (!breakSim) drawBreakEditor();
  },
};

// ---------------------------------------------------------------- chapter 4: buckling
const bc = bucklingCurves();
const at = (p: [number, number][], L: number) => p.find((q) => Math.abs(q[0] - L) < 0.01)![1];
set('steelT', kN(at(bc.steelT, 2) * 1000));
set('steelC1', kN(at(bc.steelC, 1) * 1000));
set('steelC4', kN(at(bc.steelC, 4) * 1000));
set('steelC8', kN(at(bc.steelC, 8) * 1000));
const left = Math.round((at(bc.steelC, 8) / at(bc.steelC, 1)) * 100);
quiz('buckle', [
  { label: 'Almost all — 90%', value: '90' }, { label: 'Half — 50%', value: '50' },
  { label: 'A quarter — 25%', value: '25' }, { label: `Only about ${left}%`, value: 'x' },
], 'x', () => `Eight times longer leaves only ${left}% — ${kN(at(bc.steelC, 8) * 1000)} instead of ${kN(at(bc.steelC, 1) * 1000)}. Pulled instead of pushed, the same bar would still hold ${kN(at(bc.steelT, 8) * 1000)}.`);
const buck = lineChart($('s4'), [
  { id: 'st', name: 'Steel 100 mm · pulled', short: 'Steel, pulled', color: css('--s3'), points: bc.steelT, dash: true },
  { id: 'sc', name: 'Steel 100 mm · pushed', short: 'Steel, pushed', color: css('--s1'), points: bc.steelC },
  { id: 'tc', name: 'Timber 100 mm · pushed', short: 'Timber, pushed', color: css('--s2'), points: bc.timberC },
], { title: 'How much load one bar can carry, by its length', xLabel: 'Member length (m)', yLabel: 'Capacity (kN)', xFmt: (v) => `${v} m`, yDomain: [0, 700], caption: 'Characteristic capacity (kN) by member length' });
const ch4: Record<string, () => void> = {
  guess4: () => { buck.focus([]); buck.annotate([]); },
  pull: () => { buck.focus(['st']); buck.annotate([{ x: 6, y: at(bc.steelT, 6), text: 'same at every length', dy: -18 }]); },
  push: () => { buck.focus(['sc', 'tc']); buck.annotate([{ x: 1, y: at(bc.steelC, 1), text: kN(at(bc.steelC, 1) * 1000), dx: 14, dy: -10 }, { x: 4, y: at(bc.steelC, 4), text: kN(at(bc.steelC, 4) * 1000), dy: -16 }, { x: 8, y: at(bc.steelC, 8), text: kN(at(bc.steelC, 8) * 1000), dx: -70, dy: -22 }]); },
  rule: () => { buck.focus(null); buck.annotate([{ x: 4, y: at(bc.steelC, 4), text: '4 m → 8 m: strength falls by ⅔', dy: -26 }]); },
};

// ---------------------------------------------------------------- chapter 5: depth
const depth = depthStudy();
const dAt = (h: number) => depth.find((row) => Math.abs(row.h - h) < 1e-6)!;
set('d1', kN(dAt(1).chord * 1000)); set('d5', kN(dAt(5).chord * 1000));
set('def1', `${dAt(1).defl.toFixed(0)} mm`); set('def5', `${dAt(5).defl.toFixed(0)} mm`);
set('cost1', usd(dAt(1).cost)); set('cost5', usd(dAt(5).cost));
const dch = lineChart($('s5'), [
  { id: 'chord', name: 'Top chord', color: css('--s1'), points: depth.map((row) => [row.h, row.chord]) },
  { id: 'diag', name: 'End diagonal', color: css('--s2'), points: depth.map((row) => [row.h, row.diag]) },
], { title: 'Design force (1.35G + 1.5Q) as the truss gets deeper', xLabel: 'Truss depth (m)', yLabel: 'Compression design force (kN)', xFmt: (v) => `${v} m`, caption: 'Design compression (kN) by truss depth, 16 m span, 26 t truck' });
const ch5: Record<string, () => void> = {
  shallow: () => { dch.focus(['chord']); dch.annotate([{ x: 1, y: dAt(1).chord, text: `1 m deep: ${kN(dAt(1).chord * 1000)}`, dx: 16, dy: 6 }]); },
  deep: () => { dch.focus(['chord']); dch.annotate([{ x: 1, y: dAt(1).chord, text: kN(dAt(1).chord * 1000), dx: 16, dy: 6 }, { x: 5, y: dAt(5).chord, text: `5 m: ${kN(dAt(5).chord * 1000)}`, dx: -90, dy: -22 }]); },
  trade: () => { dch.focus(null); dch.annotate([{ x: 2, y: dAt(2).chord, text: 'span/8 = 2 m', dx: 18, dy: -14 }]); },
};

// ---------------------------------------------------------------- chapter 6: safety (runs the real dynamic test once)
let safety: ReturnType<typeof barChart> | null = null;
let safetyStep = 0;
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
  const ratio = s.NRk / s.peak;
  const choices = [1.1, 1.5, 2.5, 5];
  const best = choices.reduce((a, b) => (Math.abs(b - ratio) < Math.abs(a - ratio) ? b : a));
  const words: Record<string, string> = { '1.1': 'just enough', '1.5': 'a bit more', '2.5': 'well over double', '5': 'a huge margin' };
  quiz('margin', choices.map((c) => ({ label: `×${c} — ${words[String(c)]}`, value: String(c) })), String(best),
    () => `The busiest member peaked at ${kN(s.peak * 1000)} and would fail at ${kN(s.NRk * 1000)} — about ×${ratio.toFixed(1)}. That margin comes from two separate safety factors: one on the loads, one on the material.`);
  timings.safety = s.ms;
  safety.reveal(safetyStep);
  showTiming();
}
const ch6: Record<string, () => void> = {
  guess6: () => { safetyStep = 0; buildSafety(); safety?.reveal(0); },
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
const ch7: Record<string, () => void> = { forms: () => $('s7').classList.remove('you-on'), you: () => $('s7').classList.add('you-on') };

// ---------------------------------------------------------------- your turn: the design challenge
const BUDGET = LEVEL.budget, STAR3 = LEVEL.budget * 0.8;
const ch = { mat: 'timber' as MaterialId, depth: 2.5, panels: 8, chord: 2, web: 1, deck: 0 };
const chView = bridgeSvg($('chBridge'));
let chBridge: Bridge = bridge;
let chSim: Sim | null = null;
let chTest: 'none' | 'pass' | 'fail' = 'none';
let chResult = { cost: 0, util: 0, defl: 0, limit: 0, stars: 0, code: false };
function chControls() {
  const M = MATERIALS[ch.mat];
  const secOpts = (sel: number) => M.sections.map((s, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${s.name} — $${s.costPerM}/m</option>`).join('');
  $('chControls').innerHTML = `
    <label>Material<div class="seg2">${(['timber', 'steel'] as MaterialId[]).map((mm) => `<button data-mat="${mm}" class="${mm === ch.mat ? 'on' : ''}">${MATERIALS[mm].name}</button>`).join('')}</div></label>
    <label>Truss depth <b>${ch.depth.toFixed(1)} m</b><input type="range" min="1" max="4" step="0.5" value="${ch.depth}" data-k="depth"/></label>
    <label>Panels <b>${ch.panels} × ${(16 / ch.panels).toFixed(2)} m</b><input type="range" min="6" max="10" step="2" value="${ch.panels}" data-k="panels"/></label>
    <label>Top chord (compression)<select data-k="chord">${secOpts(ch.chord)}</select></label>
    <label>Diagonals<select data-k="web">${secOpts(ch.web)}</select></label>
    <label>Deck<div class="seg2">${MATERIALS.deck.sections.slice(0, 2).map((s, i) => `<button data-deck="${i}" class="${i === ch.deck ? 'on' : ''}">${s.name}</button>`).join('')}</div></label>
    <div class="ch-btns"><button class="btn-s primary" id="chTest">▶ Run the load test</button><button class="btn-s" id="chShare">⬇ Share card</button></div>`;
  const root = $('chControls');
  root.querySelectorAll<HTMLButtonElement>('[data-mat]').forEach((b) => b.addEventListener('click', () => {
    ch.mat = b.dataset.mat as MaterialId;
    ch.chord = Math.min(ch.chord, MATERIALS[ch.mat].sections.length - 1);
    ch.web = Math.min(ch.web, MATERIALS[ch.mat].sections.length - 1);
    chUpdate(true);
  }));
  root.querySelectorAll<HTMLButtonElement>('[data-deck]').forEach((b) => b.addEventListener('click', () => { ch.deck = Number(b.dataset.deck); chUpdate(true); }));
  root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-k]').forEach((inp) => inp.addEventListener('input', () => {
    (ch as unknown as Record<string, number>)[inp.dataset.k!] = Number(inp.value);
    chUpdate(false);
  }));
  $('chTest').addEventListener('click', runChallengeTest);
  $('chShare').addEventListener('click', shareCard);
}
function chHint(an: ReturnType<typeof analyse>, crit: 'deck' | 'chord' | 'web' | null, cost: number, uls: boolean, sls: boolean) {
  const M = MATERIALS[ch.mat];
  if (!uls) {
    const r = an.criticalBeam !== null ? an.members.get(an.criticalBeam) : null;
    if (crit === 'chord') return r?.mode === 'buckling'
      ? `The top chord buckles. ${ch.chord < M.sections.length - 1 ? 'Pick a bigger top chord' : 'Switch to steel'}, or make the truss deeper so the chord force drops.`
      : `The top chord is overloaded. Pick a bigger top chord or make the truss deeper.`;
    if (crit === 'web') return `The diagonals are overloaded. ${ch.web < M.sections.length - 1 ? 'Pick bigger diagonals' : 'Switch to steel'} — the end diagonals carry the most.`;
    if (crit === 'deck') return 'The deck itself is overloaded — try more panels (shorter deck spans) or the steel deck.';
    return 'Something is over capacity — make the members bigger or the truss deeper.';
  }
  if (!sls) return 'Strong enough but too bendy. A deeper truss is the cheapest way to add stiffness.';
  if (cost > BUDGET) return `Safe but ${usd(cost - BUDGET)} over budget. Timber is cheaper than steel, fewer panels means fewer $150 joints, and lightly used members can be smaller.`;
  if (cost > STAR3) return `${usd(cost - STAR3)} away from three stars. Try 6 panels (fewer joints) and trim whichever section has the most spare capacity.`;
  return 'Three stars! Now run the load test and download your share card.';
}

function chUpdate(rebuildControls: boolean) {
  chSim = null;
  chTest = 'none';
  const t0 = performance.now();
  chBridge = buildBridge(ch.depth, [ch.mat, ch.web], [ch.mat, ch.chord], ch.deck, ch.panels);
  const an = analyse(LEVEL, chBridge.design.nodes, chBridge.design.beams, ['hgv']);
  const forces = new Map<number, number>();
  for (const [id, mr] of an.members) forces.set(id, mr.NEdT / Math.max(1, mr.NtRd) >= mr.NEdC / Math.max(1, mr.NcRd) ? mr.NEdT : -mr.NEdC);
  chView.draw(chBridge, { forces, maxForce: Math.max(1, ...[...forces.values()].map(Math.abs)) });
  const cost = chBridge.design.cost();
  const uls = an.maxUtil <= 1, sls = an.deflection <= an.deflectionLimit;
  const code = an.stable && uls && sls;
  const stars = code ? (cost <= STAR3 ? 3 : cost <= BUDGET ? 2 : 1) : 0;
  chResult = { cost, util: an.maxUtil, defl: an.deflection, limit: an.deflectionLimit, stars, code };
  const crit = an.criticalBeam !== null ? chBridge.design.beams.find((b) => b.id === an.criticalBeam) : null;
  const critName = crit ? (crit.mat === 'deck' ? 'road deck' : chBridge.topChord.includes(crit.id) ? 'top chord' : 'diagonals') : '';
  $('chResult').innerHTML = `
    <div class="ch-stars">${[1, 2, 3].map((k) => `<span class="${k <= stars ? 'on' : ''}">★</span>`).join('')}<em>${stars === 3 ? 'Outstanding engineering!' : stars === 2 ? 'Under budget — can you go leaner?' : stars === 1 ? 'Safe, but over budget' : 'Not safe yet — fix the red checks'}</em></div>
    <div class="ch-facts">
      <div class="${uls ? 'ok' : 'bad'}"><b>${Math.round(an.maxUtil * 100)}%</b><span>max utilisation${critName ? ` · ${critName}` : ''}</span></div>
      <div class="${sls ? 'ok' : 'bad'}"><b>${(an.deflection * 1000).toFixed(0)} mm</b><span>deflection · limit ${(an.deflectionLimit * 1000).toFixed(0)} mm</span></div>
      <div class="${cost <= BUDGET ? 'ok' : 'bad'}"><b>${usd(cost)}</b><span>cost · ★★★ under ${usd(STAR3)}</span></div>
    </div>
    <p class="ch-hint">💡 ${chHint(an, crit ? (crit.mat === 'deck' ? 'deck' : chBridge.topChord.includes(crit.id) ? 'chord' : 'web') : null, cost, uls, sls)}</p>
    <p class="ch-test" id="chTestOut">Load test not run yet.</p>`;
  if (rebuildControls) chControls();
  else {
    const lbls = $('chControls').querySelectorAll('label b');
    if (lbls[0]) lbls[0].textContent = `${ch.depth.toFixed(1)} m`;
    if (lbls[1]) lbls[1].textContent = `${ch.panels} × ${(16 / ch.panels).toFixed(2)} m`;
  }
  timings.challenge = performance.now() - t0;
}
function runChallengeTest() {
  const sim = new Sim(LEVEL, chBridge.design.nodes, chBridge.design.beams);
  chSim = sim;
  let firstBreak: { id: number; force: number } | null = null;
  audio.start();
  $('chTestOut').textContent = 'Truck on its way…';
  const loop = () => {
    if (chSim !== sim) return;
    sim.step();
    for (const e of sim.events) if (e.type === 'break') {
      audio.snap(e.mat);
      if (!firstBreak && e.designId !== undefined) firstBreak = { id: e.designId, force: e.force ?? 0 };
    }
    sim.events.length = 0;
    chView.drawSim(sim, chBridge, new Set(), 400000);
    if (sim.outcome !== 'running' || sim.time > 20) {
      chTest = sim.outcome === 'success' ? 'pass' : 'fail';
      $('chTestOut').innerHTML = chTest === 'pass'
        ? `<b class="okc">✓ Load test passed.</b> Peak member stress ${Math.round(sim.maxRatio * 100)}% of real capacity.`
        : `<b class="badc">✗ The bridge failed the load test.</b> ${firstBreak ? `The first member to go was ${chBridge.topChord.includes(firstBreak.id) ? 'a top-chord member' : chBridge.deckMembers.includes(firstBreak.id) ? 'a deck panel' : 'a diagonal'}, ${firstBreak.force < 0 ? 'crushed or buckled under compression' : 'snapped in tension'}. 💡 ${firstBreak.force < 0 ? 'Bigger section or a deeper truss.' : 'A bigger section — tension capacity is strength × area.'}` : 'Make the red members bigger or the truss deeper.'}`;
      chTest === 'pass' ? audio.success() : audio.fail();
      chSim = null;
      return;
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
function shareCard() {
  const c = document.createElement('canvas');
  c.width = 1200; c.height = 630;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 630);
  grad.addColorStop(0, '#13213a'); grad.addColorStop(1, '#0b1020');
  g.fillStyle = grad; g.fillRect(0, 0, 1200, 630);
  g.fillStyle = '#e3402f'; g.fillRect(60, 60, 8, 60);
  g.fillStyle = '#fff'; g.font = '800 46px Inter, system-ui, sans-serif';
  g.fillText('I designed a 16 m truss bridge', 88, 105);
  g.font = '500 24px Inter, system-ui, sans-serif'; g.fillStyle = '#9fb3d1';
  g.fillText(`${MATERIALS[ch.mat].name} · ${ch.depth.toFixed(1)} m deep · ${ch.panels} panels · for a 26 t truck`, 88, 145);
  const ox = 120, oy = 400, s = 60;
  g.lineCap = 'round';
  g.strokeStyle = '#6b7487'; g.lineWidth = 6; g.beginPath(); g.moveTo(40, oy); g.lineTo(ox, oy); g.moveTo(ox + 16 * s, oy); g.lineTo(1160, oy); g.stroke();
  for (const b of chBridge.design.beams) {
    const A = chBridge.design.node(b.a)!, B = chBridge.design.node(b.b)!;
    g.strokeStyle = b.mat === 'deck' ? '#c3c2b7' : b.mat === 'steel' ? '#ff6a4d' : '#d9a066';
    g.lineWidth = b.mat === 'deck' ? 10 : 6;
    g.beginPath(); g.moveTo(ox + A.x * s, oy - A.y * s); g.lineTo(ox + B.x * s, oy - B.y * s); g.stroke();
  }
  g.fillStyle = '#ffc83d'; g.font = '700 54px Inter, system-ui, sans-serif';
  g.fillText('★'.repeat(chResult.stars) + '☆'.repeat(3 - chResult.stars), 88, 520);
  g.fillStyle = '#fff'; g.font = '700 30px Inter, system-ui, sans-serif';
  g.fillText(`${usd(chResult.cost)}  ·  ${Math.round(chResult.util * 100)}% utilisation  ·  ${(chResult.defl * 1000).toFixed(0)} mm deflection${chTest === 'pass' ? '  ·  load test passed' : ''}`, 88, 575);
  g.fillStyle = '#9fb3d1'; g.font = '500 20px Inter, system-ui, sans-serif';
  g.fillText('Span — How a bridge holds you up', 880, 610);
  c.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'my-span-bridge.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
  audio.click();
}

// ---------------------------------------------------------------- timing
const timings: Record<string, number> = {};
function showTiming() {
  $('timing').textContent = `Computed in your browser: structural model and charts ${timings.model?.toFixed(0) ?? '—'} ms${timings.safety ? ` · dynamic load test ${timings.safety.toFixed(0)} ms` : ''}${timings.challenge ? ` · challenge analysis ${timings.challenge.toFixed(0)} ms` : ''}.`;
  console.info(`[story] model ${timings.model?.toFixed(1)} ms, safety sim ${timings.safety?.toFixed(1) ?? '—'} ms, challenge ${timings.challenge?.toFixed(1) ?? '—'} ms`);
}

chControls();
chUpdate(false);

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
ch1.approach(); ch2.square(); ch3.predict(); ch4.guess4(); ch5.shallow(); ch7.forms();
setTimeout(buildSafety, 600);

addEventListener('scroll', () => {
  const p = scrollY / (document.documentElement.scrollHeight - innerHeight);
  $('progress').style.width = (p * 100).toFixed(1) + '%';
}, { passive: true });

timings.model = performance.now() - T0;
showTiming();
