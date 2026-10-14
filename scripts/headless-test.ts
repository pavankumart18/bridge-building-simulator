/**
 * Headless regression + balancing harness.
 *  1. Validates the dynamic XPBD solver against the static stiffness-method solver (dead load).
 *  2. Builds reference bridges per level and runs the code checks + the full traffic test.
 * Usage: npm run test:physics [filter]
 */
import { Design } from '../src/design';
import { ALL_LEVELS } from '../src/levels';
import type { MaterialId } from '../src/materials';
import { Sim, FRAME_DT } from '../src/physics';
import { analyse } from '../src/analysis';

type MS = [MaterialId, number];
interface TrussOpts { height: number; web: MS; chord: MS; deck?: number; below?: boolean; panel?: number }

function truss(levelId: string, o: TrussOpts, from = 0, to = 1) {
  const level = ALL_LEVELS.find((l) => l.id === levelId)!;
  const d = new Design(level);
  addTruss(d, d.nodes[from], d.nodes[to], o);
  return d;
}

function addTruss(d: Design, L: { id: number; x: number; y: number }, R: { id: number; x: number; y: number }, o: TrussOpts) {
  const span = R.x - L.x;
  const n = Math.max(1, Math.round(span / (o.panel ?? 2)));
  const deck = [L];
  for (let i = 1; i < n; i++) deck.push(d.addNode(L.x + (span * i) / n, L.y + ((R.y - L.y) * i) / n));
  deck.push(R);
  for (let i = 0; i < n; i++) d.addBeam(deck[i].id, deck[i + 1].id, 'deck', o.deck ?? 0);
  if (o.height <= 0) return d;
  const sgn = o.below ? -1 : 1;
  const top = [] as typeof deck;
  for (let i = 0; i < n; i++) {
    const a = deck[i], b = deck[i + 1];
    top.push(d.addNode((a.x + b.x) / 2, (a.y + b.y) / 2 + sgn * o.height));
  }
  for (let i = 0; i < n; i++) {
    d.addBeam(deck[i].id, top[i].id, o.web[0], o.web[1]);
    d.addBeam(top[i].id, deck[i + 1].id, o.web[0], o.web[1]);
    if (i > 0) d.addBeam(top[i - 1].id, top[i].id, o.chord[0], o.chord[1]);
  }
  return d;
}

function run(name: string, d: Design) {
  const t0 = performance.now();
  const an = analyse(d.level, d.nodes, d.beams);
  const tA = performance.now() - t0;
  const sim = new Sim(d.level, d.nodes, d.beams);
  let frames = 0, broken = 0, first = '';
  const t1 = performance.now();
  while (sim.outcome === 'running' && frames < 60 * 95) {
    sim.step();
    frames++;
    for (const e of sim.events) if (e.type === 'break') {
      if (!broken) first = `${e.mat}@(${e.x.toFixed(1)},${e.y.toFixed(1)}) ${((e.force ?? 0) / 1000).toFixed(0)}kN t=${sim.time.toFixed(1)}`;
      broken++;
    }
    sim.events.length = 0;
  }
  const wall = performance.now() - t1;
  if (!an.stable) console.log('   ', an.message, an.mechanismNode, JSON.stringify(d.node(an.mechanismNode ?? 0)));
  const checks = an.checks.map((c) => `${c.ok ? '✓' : '✗'}${c.id}`).join(' ');
  console.log(
    `${name.padEnd(36)} ${sim.outcome.padEnd(7)} $${String(d.cost()).padEnd(6)}/${String(d.level.budget).padEnd(6)} ` +
      `dyn ${String(Math.round(sim.maxRatio * 100)).padStart(3)}% ULS ${String(Math.round(an.maxUtil * 100)).padStart(4)}% ` +
      `δ ${(sim.maxDeflection * 1000).toFixed(0)}dyn ${(an.deflection * 1000).toFixed(0).padStart(4)}/${(an.deflectionLimit * 1000).toFixed(0)}mm [${checks}] ` +
      `an ${tA.toFixed(0)}ms sim ${(frames * FRAME_DT).toFixed(1)}s/${wall.toFixed(0)}ms ${first}`,
  );
}

function validate() {
  const d = truss('l3', { height: 2.5, web: ['steel', 2], chord: ['steel', 2], deck: 1 });
  const an = analyse(d.level, d.nodes, d.beams);
  const sim = new Sim(d.level, d.nodes, d.beams, false);
  const t0 = performance.now();
  for (let i = 0; i < 60 * 6; i++) sim.step();
  let maxErr = 0, worst = '';
  for (const m of sim.members) {
    if (m.mat === null) continue;
    const s = an.members.get(m.designId)!.NG;
    const rel = Math.abs(m.force - s) / Math.max(5000, Math.abs(s));
    if (rel > maxErr) { maxErr = rel; worst = `${m.mat} static ${(s / 1000).toFixed(1)}kN dynamic ${(m.force / 1000).toFixed(1)}kN`; }
  }
  console.log(`validation (dead load, 6 s settle, ${(performance.now() - t0).toFixed(0)}ms): max deviation ${(maxErr * 100).toFixed(1)}% — ${worst}`);
}

function suspension(stiff = false) {
  const level = ALL_LEVELS.find((l) => l.id === 'l7')!;
  const d = new Design(level);
  const [L, R, TL, TR, BL, BR] = d.nodes;
  const n = 16, span = R.x - L.x;
  const deck = [L];
  for (let i = 1; i < n; i++) deck.push(d.addNode((span * i) / n, 0));
  deck.push(R);
  for (let i = 0; i < n; i++) d.addBeam(deck[i].id, deck[i + 1].id, 'deck', 0);
  if (stiff) {
    // stiffening truss below the deck
    const bot = deck.slice(0, -1).map((p, i) => d.addNode((p.x + deck[i + 1].x) / 2, -1.6));
    bot.forEach((b, i) => { d.addBeam(deck[i].id, b.id, 'timber', 1); d.addBeam(b.id, deck[i + 1].id, 'timber', 1); if (i) d.addBeam(bot[i - 1].id, b.id, 'timber', 2); });
  }
  const main = [TL];
  for (let i = 1; i < n; i++) {
    const x = (span * i) / n;
    const u = (x - span / 2) / (TR.x - TL.x) * 2;
    const y = 2.2 + (14 - 2.2) * u * u;
    const c = d.addNode(x, y);
    main.push(c);
    d.addBeam(c.id, deck[i].id, 'cable', 0);
  }
  main.push(TR);
  for (let i = 0; i < main.length - 1; i++) d.addBeam(main[i].id, main[i + 1].id, 'cable', 2);
  // backstays (cable max 24 m → intermediate joint on ground-level anchor line is not needed: 14 m rise, 9.5 m run)
  d.addBeam(TL.id, BL.id, 'cable', 2);
  d.addBeam(TR.id, BR.id, 'cable', 2);
  return d;
}

const T = performance.now();
const only = process.argv[2];
if (!only) validate();
const S = (sec: number): MS => ['steel', sec];
const W = (sec: number): MS => ['timber', sec];
const cases: [string, () => Design][] = [
  ['l1 deck only (expect fail)', () => truss('l1', { height: 0, web: W(0), chord: W(0) })],
  ['l1 timber 100 below 1.5', () => truss('l1', { height: 1.5, web: W(0), chord: W(0), below: true, panel: 2.5 })],
  ['l1 timber 160 above 1.5', () => truss('l1', { height: 1.5, web: W(1), chord: W(1), panel: 2.5 })],
  ['l2 timber 160 below 2', () => truss('l2', { height: 2, web: W(1), chord: W(1), below: true, panel: 2.8 })],
  ['l3 steel 100 above 2.5', () => truss('l3', { height: 2.5, web: S(1), chord: S(1), deck: 1 })],
  ['l3 steel 150/200 above 2.5', () => truss('l3', { height: 2.5, web: S(2), chord: S(3), deck: 1 })],
  ['l3 timber 220/300 above 2.5', () => truss('l3', { height: 2.5, web: W(2), chord: W(3), deck: 0 })],
  ['l4 steel 150/200 above 3', () => truss('l4', { height: 3, web: S(2), chord: S(3), deck: 1, panel: 3 })],
  ['l5 steel 150 below 2', () => truss('l5', { height: 2, web: S(2), chord: S(2), deck: 1, below: true, panel: 3 })],
  ['l6 steel 150/200 above 3', () => truss('l6', { height: 3, web: S(2), chord: S(3), deck: 1, panel: 3.2 })],
  ['l8 steel 200 above 3.5', () => truss('l8', { height: 3.5, web: S(2), chord: S(3), deck: 1, panel: 3 })],
  ['l9 steel 200/300 above 3.5', () => truss('l9', { height: 3.5, web: S(3), chord: S(4), deck: 1, panel: 3 })],
  ['x l1 timber100 below 1.5 p3.3', () => truss('l1', { height: 1.5, web: W(0), chord: W(0), below: true, panel: 3.34 })],
  ['x l2 timber100 below 2 p2.8', () => truss('l2', { height: 2, web: W(0), chord: W(0), below: true, panel: 2.8 })],
  ['x l3 timber160/220 above 2.5', () => truss('l3', { height: 2.5, web: W(1), chord: W(2), deck: 0 })],
  ['x l3 timber160 above 2.5', () => truss('l3', { height: 2.5, web: W(1), chord: W(1), deck: 0 })],
  ['x l4 timber220/300 above 3', () => truss('l4', { height: 3, web: W(2), chord: W(3), deck: 0, panel: 3 })],
  ['x l4 steel100/150 above 3', () => truss('l4', { height: 3, web: S(1), chord: S(2), deck: 1, panel: 3 })],
  ['x l4 steel100/150 timberdeck', () => truss('l4', { height: 3, web: S(1), chord: S(2), deck: 0, panel: 3 })],
  ['x l5 timber160 below 2 p3', () => truss('l5', { height: 2, web: W(1), chord: W(1), deck: 0, below: true, panel: 3 })],
  ['x l6 steel100/150 above 3 td', () => truss('l6', { height: 3, web: S(1), chord: S(2), deck: 0, panel: 3.2 })],
  ['x l6 timber220/300 above 3', () => truss('l6', { height: 3, web: W(2), chord: W(3), deck: 0, panel: 3.2 })],
  ['x l8 steel100/150 above 3.5 td', () => truss('l8', { height: 3.5, web: S(1), chord: S(2), deck: 0, panel: 3 })],
  ['x l9 steel150/200 above 3.5 td', () => truss('l9', { height: 3.5, web: S(2), chord: S(3), deck: 0, panel: 3 })],
  ['x l9 steel150/200 above 3.5 sd', () => truss('l9', { height: 3.5, web: S(2), chord: S(3), deck: 1, panel: 3 })],
  ['x l8 timber220/300 above 3.5', () => truss('l8', { height: 3.5, web: W(2), chord: W(3), deck: 0, panel: 3 })],
  ['x l7 suspension', () => suspension()],
  ['x l7 suspension + stiffening truss', () => suspension(true)],
];
for (const [name, mk] of cases) if (!only || name.startsWith(only)) run(name, mk());
console.log(`total ${(performance.now() - T).toFixed(0)}ms`);
