/**
 * Finds a cheap, verified 3-star reference design for the Expert projects so their budgets are fair:
 * generates candidate topologies (trusses, multi-span over piers, braced towers, cable stays), sizes
 * every member individually (fully-stressed design, then greedy downsizing), and runs the real load test.
 * Writes scripts/reference-solutions.json (not shipped in the game — players get no worked solution).
 * Usage: npx tsx scripts/level-solutions.ts [levelId ...]      env: QUICK=1 fewer topologies
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { Design, type DNode } from '../src/design';
import { LEVELS, type Level } from '../src/levels';
import { MATERIALS, capacity, type MaterialId } from '../src/materials';
import { analyse, type AnalysisResult } from '../src/analysis';
import { Sim } from '../src/physics';

const T0 = performance.now();
type Sec = [MaterialId, number];
const r2 = (v: number) => Math.round(v * 100) / 100;

// ---------- section ladders (cheapest first) ----------
function ladder(level: Level, kind: 'frame' | 'cable' | 'deck'): Sec[] {
  if (kind === 'deck') return [['deck', 0], ['deck', 1], ['deck', 2]];
  if (kind === 'cable') return MATERIALS.cable.sections.map((_, i) => ['cable', i] as Sec);
  const out: Sec[] = [];
  for (const m of ['timber', 'steel'] as MaterialId[]) if (level.materials.includes(m)) MATERIALS[m].sections.forEach((_, i) => out.push([m, i]));
  return out.sort((a, b) => MATERIALS[a[0]].sections[a[1]].costPerM - MATERIALS[b[0]].sections[b[1]].costPerM);
}

// ---------- topology helpers ----------
interface Topo { d: Design; desc: string; kind: Map<number, 'frame' | 'cable' | 'deck'> }

function newTopo(level: Level, desc: string): Topo { return { d: new Design(level), desc, kind: new Map() }; }
function beam(t: Topo, a: DNode, b: DNode, k: 'frame' | 'cable' | 'deck') {
  const s: Sec = k === 'deck' ? ['deck', 0] : k === 'cable' ? ['cable', 0] : [t.d.level.materials.includes('timber') ? 'timber' : 'steel', 0];
  const bm = t.d.addBeam(a.id, b.id, s[0], s[1]);
  if (bm) t.kind.set(bm.id, k);
  return bm;
}
const anchor = (t: Topo, x: number, y: number) => t.d.nodes.find((n) => n.anchor && Math.abs(n.x - x) < 1e-6 && Math.abs(n.y - y) < 1e-6)!;

/** deck chain from L to R in n panels, returns the joints */
function deck(t: Topo, L: DNode, R: DNode, n: number) {
  const pts = [L];
  for (let i = 1; i < n; i++) pts.push(t.d.addNode(r2(L.x + ((R.x - L.x) * i) / n), r2(L.y + ((R.y - L.y) * i) / n)));
  pts.push(R);
  for (let i = 0; i < n; i++) beam(t, pts[i], pts[i + 1], 'deck');
  return pts;
}

/** Warren triangles on a deck chain; returns the chord joints */
function triangles(t: Topo, dk: DNode[], h: number, below: boolean, link: DNode | null = null) {
  const s = below ? -1 : 1;
  const top = dk.slice(0, -1).map((p, i) => t.d.addNode(r2((p.x + dk[i + 1].x) / 2), r2((p.y + dk[i + 1].y) / 2 + s * h)));
  top.forEach((c, i) => {
    beam(t, dk[i], c, 'frame'); beam(t, c, dk[i + 1], 'frame');
    if (i) beam(t, top[i - 1], c, 'frame');
  });
  if (link) beam(t, link, top[0], 'frame');
  return top;
}

const panels = (len: number, p: number) => Math.max(1, Math.ceil(len / p - 1e-9));

// ---------- topology families ----------
function* fullTrusses(level: Level): Generator<Topo> {
  const [L, R] = new Design(level).nodes;
  const hs = [level.span / 10, level.span / 8, level.span / 6, level.span / 5].map((h) => Math.min(5.5, r2(h)));
  for (const below of [false, true]) for (const h of hs) for (const p of [2, 2.5, 3]) {
    const t = newTopo(level, `${below ? 'Deck' : 'Through'} truss over the full ${level.span} m, ${h} m deep, ${p} m panels`);
    const dk = deck(t, t.d.node(L.id)!, t.d.node(R.id)!, panels(level.span, p));
    triangles(t, dk, h, below);
    yield t;
  }
}

/** spans meeting at deck joints above piers; each pier joint propped from its two pier anchors */
function* pierSpans(level: Level, piers: { x: number; anchors: [number, number][] }[], opts: { below?: boolean[]; hs?: number[] } = {}): Generator<Topo> {
  for (const below of opts.below ?? [false]) for (const h of opts.hs ?? [1.5, 2, 3, 4]) for (const p of [2.5, 3]) for (const cont of [false, true]) {
    const t = newTopo(level, `${piers.length + 1} ${below ? 'deck' : 'through'}-truss spans over ${piers.length === 1 ? 'the pier' : 'the piers'}, ${h} m deep${cont ? ', chords continuous over the supports' : ''}`);
    const [L, R] = t.d.nodes;
    const stops = [L, ...piers.map((pr) => {
      const n = t.d.addNode(pr.x, 0);
      for (const [ax, ay] of pr.anchors) beam(t, anchor(t, ax, ay), n, 'frame');
      return n;
    }), R];
    let prev: DNode | null = null;
    for (let i = 0; i < stops.length - 1; i++) {
      const dk = deck(t, stops[i], stops[i + 1], panels(stops[i + 1].x - stops[i].x, p));
      const top = triangles(t, dk, h, below, cont ? prev : null);
      prev = top[top.length - 1];
    }
    yield t;
  }
}

/** braced ladder tower from two anchors up to road level, then spans to it from each bank */
function* towerSpans(level: Level, ax0: number, ax1: number, ay: number): Generator<Topo> {
  for (const step of [2.5, 3.4]) for (const h of [1.5, 2, 3]) for (const xBrace of [false, true]) {
    const t = newTopo(level, `Braced tower on the spur (${step} m panels${xBrace ? ', X-braced' : ''}) with through-truss spans ${h} m deep from each bank`);
    const [L, R] = t.d.nodes;
    let a = anchor(t, ax0, ay), b = anchor(t, ax1, ay);
    const levels = Math.ceil(-ay / step);
    for (let k = 1; k <= levels; k++) {
      const y = k === levels ? 0 : r2(ay + (k * -ay) / levels);
      const na = t.d.addNode(ax0, y), nb = t.d.addNode(ax1, y);
      beam(t, a, na, 'frame'); beam(t, b, nb, 'frame'); beam(t, k % 2 ? a : b, k % 2 ? nb : na, 'frame');
      if (xBrace) beam(t, k % 2 ? b : a, k % 2 ? na : nb, 'frame');
      if (k < levels) beam(t, na, nb, 'frame');
      a = na; b = nb;
    }
    const stops = [L, a, b, R];
    for (let i = 0; i < 3; i++) triangles(t, deck(t, stops[i], stops[i + 1], panels(stops[i + 1].x - stops[i].x, 3)), h, false);
    yield t;
  }
}

/** deck stayed from tower-top anchors; optional shallow stiffening truss above; pier joints propped */
function* stayed(level: Level, towers: { x: number; y: number }[], piers: { x: number; anchors: [number, number][] }[]): Generator<Topo> {
  for (const p of [2.75, 3]) for (const every of [1, 2]) for (const stiff of [0, 1, 1.5]) {
    if (every === 2 && !stiff) continue;
    const t = newTopo(level, `Cable-stayed deck: stays from ${towers.length > 1 ? 'both towers' : 'the tower'} to ${every === 1 ? 'every' : 'every other'} deck joint${stiff ? `, ${stiff} m stiffening truss above the road` : ''}`);
    const [L, R] = t.d.nodes;
    const stops = [L, ...piers.map((pr) => {
      const n = t.d.addNode(pr.x, 0);
      for (const [ax, ay] of pr.anchors) beam(t, anchor(t, ax, ay), n, 'frame');
      return n;
    }), R];
    const joints: DNode[] = [];
    for (let i = 0; i < stops.length - 1; i++) {
      const dk = deck(t, stops[i], stops[i + 1], panels(stops[i + 1].x - stops[i].x, p));
      if (stiff) triangles(t, dk, stiff, false);
      joints.push(...dk.slice(i ? 1 : 0));
    }
    let k = 0;
    for (const j of joints) {
      if (j.anchor || stops.includes(j)) continue;
      if (k++ % every) continue;
      const tw = towers.map((tp) => anchor(t, tp.x, tp.y)).sort((u, v) => Math.hypot(u.x - j.x, u.y - j.y) - Math.hypot(v.x - j.x, v.y - j.y))[0];
      if (Math.hypot(tw.x - j.x, tw.y - j.y) <= MATERIALS.cable.maxLength) beam(t, tw, j, 'cable');
    }
    yield t;
  }
}

function families(level: Level): Generator<Topo>[] {
  switch (level.id) {
    case 'l12': return [towerSpans(level, 17, 19, -10), fullTrusses(level)];
    case 'l13': return [pierSpans(level, [{ x: 18, anchors: [[17, -1.5], [19, -1.5]] }, { x: 36, anchors: [[35, -1.5], [37, -1.5]] }], { below: [false, true] })];
    case 'l14': return [stayed(level, [{ x: 22, y: 14 }], [{ x: 22, anchors: [[21, -1.5], [23, -1.5]] }]), pierSpans(level, [{ x: 22, anchors: [[21, -1.5], [23, -1.5]] }])];
    case 'l15': return [stayed(level, [{ x: 16, y: 14 }, { x: 48, y: 14 }], [{ x: 16, anchors: [[15, -1.5], [17, -1.5]] }, { x: 48, anchors: [[47, -1.5], [49, -1.5]] }])];
    default: return [fullTrusses(level)];
  }
}

// ---------- validity + sizing ----------
function valid(d: Design) {
  for (const n of d.nodes) if (!n.anchor && !d.placeable(n)) return false;
  for (const b of d.beams) {
    if (d.beamLength(b) > MATERIALS[b.mat].maxLength + 1e-6) return false;
    if (!d.segmentAllowed(d.node(b.a)!, d.node(b.b)!)) return false;
  }
  return true;
}

const codeOk = (an: AnalysisResult) => an.stable && an.checks.every((c) => c.ok || c.id === 'slack');

/** can this section be used at this member length? (frame members switch material, so check its limit) */
const fits = (s: Sec, len: number) => MATERIALS[s[0]].maxLength + 1e-6 >= len;

function size(t: Topo, maxIter = 40): AnalysisResult | null {
  const { d } = t;
  const level = d.level;
  const lad = { frame: ladder(level, 'frame'), cable: ladder(level, 'cable'), deck: ladder(level, 'deck') };
  const pos = (b: (typeof d.beams)[number]) => lad[t.kind.get(b.id)!].findIndex((s) => s[0] === b.mat && s[1] === b.sec);
  const set = (b: (typeof d.beams)[number], s: Sec) => { b.mat = s[0]; b.sec = s[1]; };
  // start every frame member on the cheapest section that fits its length
  for (const b of d.beams) if (t.kind.get(b.id) === 'frame') { const s = lad.frame.find((x) => fits(x, d.beamLength(b))); if (!s) return null; set(b, s); }
  /** next ladder entry with more capacity in the governing mode */
  const upgrade = (b: (typeof d.beams)[number], mode: string) => {
    const L = d.beamLength(b), k = t.kind.get(b.id)!, i = pos(b);
    const cap = (s: Sec) => { const c = capacity(s[0], s[1], L); const gm = MATERIALS[s[0]].gammaM; return mode === 'tension' ? c.Nt / gm : c.Nc / gm; };
    const now = cap([b.mat, b.sec]);
    for (let j = i + 1; j < lad[k].length; j++) if (fits(lad[k][j], L) && cap(lad[k][j]) > now * 1.05) { set(b, lad[k][j]); return true; }
    return false;
  };
  let an = analyse(level, d.nodes, d.beams);
  if (!an.stable) return null;
  for (let it = 0; it < maxIter && !codeOk(an); it++) {
    let changed = false;
    for (const b of d.beams) {
      const r = an.members.get(b.id);
      if (r && r.util > 0.97) changed = upgrade(b, r.mode === 'tension' ? 'tension' : 'compression') || changed;
    }
    const sls = an.checks.find((c) => c.id === 'sls');
    if (sls && !sls.ok) {
      // stiffen: the most heavily used members gain area
      const ranked = d.beams.filter((b) => (an.members.get(b.id)?.util ?? 0) > 0.3).sort((a, b) => an.members.get(b.id)!.util - an.members.get(a.id)!.util);
      for (const b of ranked.slice(0, Math.max(4, ranked.length >> 2))) changed = upgrade(b, an.members.get(b.id)!.mode === 'tension' ? 'tension' : 'compression') || changed;
    }
    if (!changed) return null;
    an = analyse(level, d.nodes, d.beams);
    if (!an.stable) return null;
  }
  if (!codeOk(an)) return null;
  // greedy downsizing, most expensive members first, keeping a little reserve
  const order = [...d.beams].sort((a, b) => d.beamCost(b) - d.beamCost(a));
  for (const b of order) {
    const k = t.kind.get(b.id)!, L = d.beamLength(b);
    for (;;) {
      const i = pos(b);
      let j = i - 1;
      while (j >= 0 && !fits(lad[k][j], L)) j--;
      if (j < 0) break;
      const old: Sec = [b.mat, b.sec];
      set(b, lad[k][j]);
      const a2 = analyse(level, d.nodes, d.beams);
      if (codeOk(a2) && a2.maxUtil <= 0.92) an = a2; else { set(b, old); break; }
    }
  }
  return an;
}

function loadTest(d: Design) {
  const sim = new Sim(d.level, d.nodes, d.beams);
  while (sim.outcome === 'running' && sim.time < 95) sim.step();
  return { ok: sim.outcome === 'success' && sim.maxRatio < 0.97, peak: sim.maxRatio, outcome: sim.outcome };
}

// ---------- main ----------
const file = 'scripts/reference-solutions.json';
const out: Record<string, { json: string; cost: number; desc: string; util: number; peak: number; budget: number }> =
  existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
const want = process.argv.slice(2);
for (const level of LEVELS.filter((l) => l.tier === 'Expert' && (!want.length || want.includes(l.id)))) {
  const t0 = performance.now();
  const found: { t: Topo; an: AnalysisResult; cost: number }[] = [];
  let tried = 0, sized = 0;
  for (const fam of families(level)) for (const t of fam) {
    tried++;
    if (!valid(t.d)) continue;
    const an = size(t);
    if (!an) continue;
    sized++;
    found.push({ t, an, cost: t.d.cost() });
    if (process.env.QUICK && sized >= 4) break;
  }
  found.sort((a, b) => a.cost - b.cost);
  let best: (typeof found)[number] | null = null, peak = 0;
  for (const f of found.slice(0, 6)) {
    const lt = loadTest(f.t.d);
    console.log(`   ${level.id} $${f.cost} · ULS ${Math.round(f.an.maxUtil * 100)}% · test ${lt.outcome} peak ${Math.round(lt.peak * 100)}% · ${f.t.desc}`);
    if (lt.ok) { best = f; peak = lt.peak; break; }
  }
  const s = ((performance.now() - t0) / 1000).toFixed(1);
  if (!best) { console.log(`${level.id} ✗ nothing passed (${sized} sized of ${tried}) · ${s} s`); continue; }
  // 3★ line = reference cost + 15% headroom → budget = that ÷ 0.8, rounded up to $500
  const budget = Math.ceil((best.cost * 1.15) / 0.8 / 500) * 500;
  out[level.id] = { json: best.t.d.serialize(), cost: best.cost, desc: best.t.desc, util: +best.an.maxUtil.toFixed(3), peak: +peak.toFixed(3), budget };
  console.log(`${level.id} ✓ $${best.cost} · ULS ${Math.round(best.an.maxUtil * 100)}% · test peak ${Math.round(peak * 100)}% · ${sized}/${tried} sized → budget $${budget} (3★ ≤ $${budget * 0.8}) · ${s} s\n    ${best.t.desc}`);
}
writeFileSync(file, JSON.stringify(out, null, 1));
console.log(`total ${((performance.now() - T0) / 1000).toFixed(1)} s`);
