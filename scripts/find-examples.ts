/**
 * Searches for a verified 3-star example bridge for every project:
 * code compliant (stable, deck, ULS, SLS, gradient), cost ≤ 80% of budget,
 * respects lengths / terrain / clearance zones, and passes the dynamic load test.
 * Writes src/examples.json.   Usage: npx tsx scripts/find-examples.ts [levelId]
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { Design, type DNode } from '../src/design';
import { LEVELS, type Level } from '../src/levels';
import { MATERIALS, type MaterialId } from '../src/materials';
import { analyse } from '../src/analysis';
import { Sim } from '../src/physics';

type MS = [MaterialId, number];
interface Candidate { d: Design; desc: string }

const T0 = performance.now();
const valid = (d: Design) => {
  for (const n of d.nodes) if (!n.anchor && !d.placeable(n)) return false;
  for (const b of d.beams) {
    const A = d.node(b.a)!, B = d.node(b.b)!;
    if (d.beamLength(b) > MATERIALS[b.mat].maxLength + 1e-6) return false;
    if (!d.segmentAllowed(A, B)) return false;
  }
  return true;
};
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Warren truss from node L to node R (deck between them) */
function truss(d: Design, L: DNode, R: DNode, n: number, h: number, below: boolean, web: MS, chord: MS, deck: number) {
  const dk = [L];
  for (let i = 1; i < n; i++) dk.push(d.addNode(r2(L.x + ((R.x - L.x) * i) / n), r2(L.y + ((R.y - L.y) * i) / n)));
  dk.push(R);
  for (let i = 0; i < n; i++) d.addBeam(dk[i].id, dk[i + 1].id, 'deck', deck);
  const s = below ? -1 : 1;
  const top = dk.slice(0, -1).map((p, i) => d.addNode(r2((p.x + dk[i + 1].x) / 2), r2((p.y + dk[i + 1].y) / 2 + s * h)));
  top.forEach((t, i) => {
    d.addBeam(dk[i].id, t.id, web[0], web[1]);
    d.addBeam(t.id, dk[i + 1].id, web[0], web[1]);
    if (i) d.addBeam(top[i - 1].id, t.id, chord[0], chord[1]);
  });
  return dk;
}

const SECS: MS[] = [['timber', 0], ['timber', 1], ['timber', 2], ['timber', 3], ['steel', 0], ['steel', 1], ['steel', 2], ['steel', 3]];
const name = (m: MS) => `${MATERIALS[m[0]].name.toLowerCase()} ${MATERIALS[m[0]].sections[m[1]].name}`;

function* simpleTrusses(level: Level, sides: boolean[] = [false, true]): Generator<Candidate> {
  const span = level.span;
  for (const below of sides) for (let h = 1; h <= 6.01; h += 0.5) for (let n = Math.ceil(span / 3); n <= Math.ceil(span / 3) + 3; n++)
    for (const web of SECS) for (const chord of SECS) for (const deck of [0, 1]) {
      if (web[0] === 'steel' && chord[0] === 'timber') continue;
      const d = new Design(level);
      truss(d, d.nodes[0], d.nodes[1], n, h, below, web, chord, deck);
      yield { d, desc: `${below ? 'Deck truss (triangles below the road)' : 'Through truss (triangles above the road)'}, ${h} m deep, ${n} panels. Diagonals: ${name(web)}; ${below ? 'bottom' : 'top'} chord: ${name(chord)}; deck: ${MATERIALS.deck.sections[deck].name.toLowerCase()}.` };
    }
}

/** two spans meeting over an intermediate support */
function* pierTrusses(level: Level, pierX: number, postFrom: number[]): Generator<Candidate> {
  for (let h = 1; h <= 4.01; h += 0.5) for (const extra of [0, 1]) for (const web of SECS) for (const chord of SECS) for (const post of [['timber', 2], ['timber', 3], ['steel', 1], ['steel', 2]] as MS[]) {
    if (web[0] === 'steel' && chord[0] === 'timber') continue;
    const d = new Design(level);
    const mid = d.addNode(pierX, 0);
    for (const a of postFrom) d.addBeam(d.nodes[a].id, mid.id, post[0], post[1]);
    const nL = Math.ceil(pierX / 3) + extra, nR = Math.ceil((level.span - pierX) / 3) + extra;
    truss(d, d.nodes[0], mid, nL, h, false, web, chord, 0);
    truss(d, mid, d.nodes[1], nR, h, false, web, chord, 0);
    yield { d, desc: `Two through-truss spans meeting over the pier, ${h} m deep. Diagonals: ${name(web)}; top chord: ${name(chord)}; pier posts: ${name(post)}; timber plank deck.` };
  }
}

/** suspension: main cable between tower tops, hangers to every deck joint, optional stiffening truss below */
function* suspensions(level: Level): Generator<Candidate> {
  const [L, R, TL, TR, BL, BR] = new Design(level).nodes;
  void L; void R;
  for (const low of [1.5, 2.5, 3.5]) for (const n of [15, 16, 18]) for (const cab of [1, 2]) for (const stiff of [0, 1, 1.5, 2]) for (const sw of SECS.slice(0, 6)) for (const deck of [0, 1]) {
    if (stiff === 0 && sw !== SECS[0]) continue;
    const d = new Design(level);
    const [dL, dR, tL, tR, bL, bR] = d.nodes;
    const dk = truss(d, dL, dR, n, 0, false, sw, sw, deck);
    // remove the zero-height truss members the helper added (h = 0 makes degenerate triangles)
    d.beams = d.beams.filter((b) => b.mat === 'deck');
    d.nodes = d.nodes.filter((nd) => nd.anchor || d.beams.some((b) => b.a === nd.id || b.b === nd.id));
    if (stiff > 0) {
      const bot = dk.slice(0, -1).map((p, i) => d.addNode(r2((p.x + dk[i + 1].x) / 2), -stiff));
      bot.forEach((t, i) => { d.addBeam(dk[i].id, t.id, sw[0], sw[1]); d.addBeam(t.id, dk[i + 1].id, sw[0], sw[1]); if (i) d.addBeam(bot[i - 1].id, t.id, sw[0], sw[1]); });
    }
    const main = [tL];
    const span = tR.x - tL.x, mid = (tL.x + tR.x) / 2;
    for (let i = 1; i < n; i++) {
      const x = dk[i].x;
      const u = (x - mid) / (span / 2);
      const c = d.addNode(x, r2(low + (tL.y - low) * u * u));
      main.push(c);
      d.addBeam(c.id, dk[i].id, 'cable', 0);
    }
    main.push(tR);
    for (let i = 0; i < main.length - 1; i++) d.addBeam(main[i].id, main[i + 1].id, 'cable', cab);
    d.addBeam(tL.id, bL.id, 'cable', cab);
    d.addBeam(tR.id, bR.id, 'cable', cab);
    void TL; void TR; void BL; void BR;
    yield { d, desc: `Suspension bridge: main cable (${MATERIALS.cable.sections[cab].name}) from tower to tower dipping to ${low} m above the road, hangers to every deck joint, backstays to the rear anchors${stiff ? `, and a ${stiff} m deep ${name(sw)} stiffening truss under the deck` : ''}. Deck: ${MATERIALS.deck.sections[deck].name.toLowerCase()}.` };
  }
}

function familyFor(level: Level): Generator<Candidate>[] {
  switch (level.id) {
    case 'l4': return [simpleTrusses(level, [false])];
    case 'l6': return [pierTrusses(level, 16, [2, 3]), simpleTrusses(level)];
    case 'l7': return process.env.FAMILY === 'cable' ? [suspensions(level)] : [suspensions(level), simpleTrusses(level, [false])];
    case 'l9': return [pierTrusses(level, 15, [2]), simpleTrusses(level, [false])];
    default: return [simpleTrusses(level)];
  }
}

const out: Record<string, { json: string; cost: number; desc: string; util: number; defl: number; peak: number }> =
  existsSync('src/examples.json') ? JSON.parse(readFileSync('src/examples.json', 'utf8')) : {};
const only = process.argv[2] ?? 'l0'; // only the Starter project ships an example
for (const level of LEVELS) {
  if (only && level.id !== only) continue;
  const t0 = performance.now();
  const target = process.env.ANYCOST ? Infinity : level.budget * 0.8;
  const pass: { c: Candidate; cost: number; util: number; defl: number }[] = [];
  let tried = 0;
  for (const fam of familyFor(level)) for (const c of fam) {
    tried++;
    const cost = c.d.cost();
    if (cost > target || !valid(c.d)) continue;
    const an = analyse(level, c.d.nodes, c.d.beams);
    if (an.passed && an.checks.every((k) => k.ok || k.id === 'slack')) pass.push({ c, cost, util: an.maxUtil, defl: an.deflection });
  }
  pass.sort((a, b) => a.cost - b.cost);
  let chosen: (typeof pass)[number] | null = null, peak = 0;
  for (const p of pass.slice(0, 12)) {
    // prefer a little reserve so the example is robust, not razor-edge
    if (p.util > 0.92) continue;
    const sim = new Sim(level, p.c.d.nodes, p.c.d.beams);
    while (sim.outcome === 'running' && sim.time < 95) sim.step();
    if (sim.outcome === 'success' && sim.maxRatio < 0.95) { chosen = p; peak = sim.maxRatio; break; }
  }
  const ms = performance.now() - t0;
  if (chosen) {
    out[level.id] = { json: chosen.c.d.serialize(), cost: chosen.cost, desc: chosen.c.desc, util: +chosen.util.toFixed(3), defl: +(chosen.defl * 1000).toFixed(1), peak: +peak.toFixed(3) };
    console.log(`${level.id.padEnd(4)} ✓ $${chosen.cost} ≤ $${target} · ULS ${Math.round(chosen.util * 100)}% · test peak ${Math.round(peak * 100)}% · ${pass.length}/${tried} 3★-compliant · ${(ms / 1000).toFixed(1)} s\n      ${chosen.c.desc}`);
    if (process.env.ANYCOST) console.log(`      → budget for 3★ at this cost: ≥ $${Math.ceil(chosen.cost / 0.8)}`);
  } else console.log(`${level.id.padEnd(4)} ✗ no verified 3★ design (${pass.length} compliant under $${target} of ${tried}) · ${(ms / 1000).toFixed(1)} s`);
}
if (!process.env.DRYRUN) writeFileSync('src/examples.json', JSON.stringify(out, null, 1));
console.log(`total ${((performance.now() - T0) / 1000).toFixed(1)} s`);
