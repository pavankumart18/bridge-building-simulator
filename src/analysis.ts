/**
 * Linear-elastic 2D truss analysis (direct stiffness method) with:
 *  - dead load (member self weight + joint hardware, lumped at joints)
 *  - moving live load: every design vehicle stepped across the deck in both directions
 *  - tension-only cables (iteratively removed when slack under dead load)
 *  - ULS strength check: 1.35·G + 1.5·Q vs characteristic resistance / γM (incl. buckling)
 *  - SLS deflection check: G + Q vs span / n
 *  - road gradient, deck continuity, stability (mechanism) and determinacy reports
 */
import { JOINT_MASS, MATERIALS, capacity, propsOf } from './materials';
import { Sim } from './physics';
import type { DBeam, DNode } from './design';
import type { Level } from './levels';
import { VEHICLES, type VehicleKind } from './vehicles';

export const GAMMA_G = 1.35;
export const GAMMA_Q = 1.5;
const g = 9.81;

export interface MemberResult {
  beamId: number;
  L: number;
  NG: number;
  NQmax: number;
  NQmin: number;
  /** max ULS tension (≥0) and max ULS compression (≥0, magnitude) */
  NEdT: number;
  NEdC: number;
  NtRd: number;
  NcRd: number;
  util: number;
  mode: 'tension' | 'compression' | 'buckling' | 'slack' | 'none';
  slenderness: number;
  slack: boolean;
}

export interface Check { id: string; label: string; ok: boolean; value: string; detail: string }

export interface AnalysisResult {
  stable: boolean;
  mechanismNode: number | null;
  message: string;
  members: Map<number, MemberResult>;
  maxUtil: number;
  criticalBeam: number | null;
  criticalCase: { kind: VehicleKind; rear: number; dir: 1 | -1 } | null;
  deflection: number;
  deflectionLimit: number;
  deflectionNode: number | null;
  shape: Map<number, { dx: number; dy: number }>;
  reactions: { nodeId: number; Rx: number; Ry: number }[];
  gradient: number;
  deckGapAt: number | null;
  determinacy: { m: number; r: number; j: number; degree: number };
  checks: Check[];
  passed: boolean;
  cases: number;
  ms: number;
}

/** dense Cholesky in place; returns index of failing pivot or -1 */
function cholesky(K: Float64Array, n: number, tol: number): number {
  for (let j = 0; j < n; j++) {
    let d = K[j * n + j];
    for (let k = 0; k < j; k++) d -= K[j * n + k] * K[j * n + k];
    if (d <= tol) return j;
    const ljj = Math.sqrt(d);
    K[j * n + j] = ljj;
    for (let i = j + 1; i < n; i++) {
      let s = K[i * n + j];
      for (let k = 0; k < j; k++) s -= K[i * n + k] * K[j * n + k];
      K[i * n + j] = s / ljj;
    }
  }
  return -1;
}

function solveChol(L: Float64Array, n: number, b: Float64Array): Float64Array {
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= L[i * n + k] * y[k];
    y[i] = s / L[i * n + i];
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k < n; k++) s -= L[k * n + i] * x[k];
    x[i] = s / L[i * n + i];
  }
  return x;
}

interface Elem { beam: DBeam; a: number; b: number; L: number; c: number; s: number; EA: number; cable: boolean; road: boolean; mass: number }

function relax(level: Level, nodes: DNode[], beams: DBeam[], maxMove: number) {
  const sim = new Sim(level, nodes, beams, false);
  sim.globalDamping = 6;
  let broke: string | null = null;
  let settled = false;
  const free = [...sim.nodeIndex].filter(([, pi]) => !sim.particles[pi].anchor);
  let worstNode: number | null = null, worst = 0;
  for (let f = 0; f < 60 * 12 && !broke; f++) {
    sim.step();
    for (const e of sim.events) if (e.type === 'break' && !broke) broke = e.mat ? MATERIALS[e.mat].name.toLowerCase() : 'structural';
    sim.events.length = 0;
    if (f % 10 !== 0) continue;
    let vmax = 0;
    for (const [id, pi] of free) {
      const p = sim.particles[pi];
      const nd = nodes.find((x) => x.id === id)!;
      const mv = Math.hypot(p.x - nd.x, p.y - nd.y);
      if (mv > worst) { worst = mv; worstNode = id; }
      vmax = Math.max(vmax, Math.hypot(p.vx, p.vy));
    }
    if (worst > maxMove) break;
    if (f > 90 && vmax < 0.004) { settled = true; break; }
  }
  const pos = new Map<number, { x: number; y: number }>();
  for (const [id, pi] of sim.nodeIndex) pos.set(id, { x: sim.particles[pi].x, y: sim.particles[pi].y });
  const force = new Map<number, number>();
  for (const m of sim.members) if (m.designId >= 0 && !m.debris) force.set(m.designId, m.force);
  return { settled: settled && worst <= maxMove, broke, pos, force, worstNode };
}

export function analyse(level: Level, nodes: DNode[], beams: DBeam[], designKinds?: VehicleKind[]): AnalysisResult {
  const t0 = performance.now();
  const used = new Set<number>();
  for (const b of beams) { used.add(b.a); used.add(b.b); }
  const nodeList = nodes.filter((n) => used.has(n.id));
  const idx = new Map<number, number>(); // node id → dof base (−1 for anchors)
  let n = 0;
  for (const nd of nodeList) {
    if (nd.anchor) idx.set(nd.id, -1);
    else { idx.set(nd.id, n); n += 2; }
  }
  const byId = new Map(nodes.map((x) => [x.id, x]));

  const elems: Elem[] = beams.map((b) => {
    const A = byId.get(b.a)!, B = byId.get(b.b)!;
    const L = Math.hypot(B.x - A.x, B.y - A.y);
    const p = propsOf(b.mat, b.sec);
    return { beam: b, a: b.a, b: b.b, L, c: (B.x - A.x) / L, s: (B.y - A.y) / L, EA: p.E * p.A, cable: MATERIALS[b.mat].fc === 0, road: MATERIALS[b.mat].road, mass: p.massPerM * L };
  });

  const anchorsUsed = nodeList.filter((x) => x.anchor).length;
  const determinacy = { m: beams.length, r: anchorsUsed * 2, j: nodeList.length, degree: beams.length + anchorsUsed * 2 - nodeList.length * 2 };

  // dead load
  const G = new Float64Array(n);
  for (const e of elems) {
    for (const id of [e.a, e.b]) { const d = idx.get(id)!; if (d >= 0) G[d + 1] -= (e.mass / 2) * g; }
  }
  for (const nd of nodeList) { const d = idx.get(nd.id)!; if (d >= 0) G[d + 1] -= JOINT_MASS * g; }

  const empty = (msg: string, node: number | null): AnalysisResult => ({
    stable: false, mechanismNode: node, message: msg, members: new Map(), maxUtil: 0, criticalBeam: null, criticalCase: null,
    deflection: 0, deflectionLimit: level.span / level.deflectionLimit, deflectionNode: null, shape: new Map(), reactions: [],
    gradient: 0, deckGapAt: null, determinacy, checks: [{ id: 'stable', label: 'Stability', ok: false, value: 'Mechanism', detail: msg }],
    passed: false, cases: 0, ms: performance.now() - t0,
  });
  if (!beams.length) return empty('Nothing built yet.', null);

  const active = elems.map(() => true);
  const geo = elems.map(() => 0); // geometric (tension) stiffness N/L
  let Lfac: Float64Array | null = null;
  let uG = new Float64Array(n);

  const assemble = () => {
    const K = new Float64Array(n * n);
    let maxD = 0;
    elems.forEach((e, i) => {
      if (!active[i]) return;
      const k = e.EA / e.L;
      const kg = geo[i];
      const cc = e.c * e.c * k + e.s * e.s * kg, ss = e.s * e.s * k + e.c * e.c * kg, cs = e.c * e.s * (k - kg);
      const da = idx.get(e.a)!, db = idx.get(e.b)!;
      const add = (r: number, c: number, v: number) => { K[r * n + c] += v; };
      const blk = [[cc, cs], [cs, ss]];
      for (let p = 0; p < 2; p++) for (let q = 0; q < 2; q++) {
        if (da >= 0) add(da + p, da + q, blk[p][q]);
        if (db >= 0) add(db + p, db + q, blk[p][q]);
        if (da >= 0 && db >= 0) { add(da + p, db + q, -blk[p][q]); add(db + p, da + q, -blk[p][q]); }
      }
    });
    for (let i = 0; i < n; i++) maxD = Math.max(maxD, K[i * n + i]);
    return { K, maxD };
  };

  const dofNode = (dof: number) => {
    for (const [id, d] of idx) if (d >= 0 && (d === dof || d + 1 === dof)) return id;
    return null;
  };

  const axial = (e: Elem, u: Float64Array) => {
    const da = idx.get(e.a)!, db = idx.get(e.b)!;
    const ua = da >= 0 ? [u[da], u[da + 1]] : [0, 0];
    const ub = db >= 0 ? [u[db], u[db + 1]] : [0, 0];
    return (e.EA / e.L) * ((ub[0] - ua[0]) * e.c + (ub[1] - ua[1]) * e.s);
  };

  // factor + dead-load solve, dropping slack cables
  let NG: number[] = [];
  let relaxed = false;
  for (let it = 0; it < 8; it++) {
    if (n === 0) { Lfac = new Float64Array(0); break; }
    const { K, maxD } = assemble();
    const fail = cholesky(K, n, maxD * 1e-10);
    if (fail >= 0) {
      if (relaxed) return empty('Unstable mechanism: a joint can move without stretching any member. Add a diagonal to make triangles.', dofNode(fail));
      // Linear analysis sees a mechanism. Cable nets and hanging decks are only stiff through their own
      // tension, so settle under self weight (dynamic relaxation) and linearise about that shape.
      const r = relax(level, nodes, beams, Math.max(0.3, level.span / 40));
      if (r.broke) return empty(`Collapses under its own weight — a ${r.broke} member fails before any traffic arrives.`, null);
      if (!r.settled) return empty('Unstable mechanism: a joint can move without stretching any member. Add a diagonal to make triangles.', r.worstNode ?? dofNode(fail));
      relaxed = true;
      elems.forEach((e, i) => {
        const A = r.pos.get(e.a)!, B = r.pos.get(e.b)!;
        const L = Math.hypot(B.x - A.x, B.y - A.y);
        e.c = (B.x - A.x) / L; e.s = (B.y - A.y) / L;
        const N = r.force.get(e.beam.id) ?? 0;
        geo[i] = Math.max(0, N) / L;
        if (e.cable && N < 50) active[i] = false;
      });
      for (const [id, d] of idx) {
        if (d < 0) continue;
        const o = byId.get(id)!, p = r.pos.get(id)!;
        uG[d] = p.x - o.x; uG[d + 1] = p.y - o.y;
      }
      NG = elems.map((e, i) => (active[i] ? r.force.get(e.beam.id) ?? 0 : 0));
      it = -1; // refactor with geometric stiffness
      continue;
    }
    Lfac = K;
    if (relaxed) break;
    uG = solveChol(K, n, G);
    let changed = false;
    elems.forEach((e, i) => {
      if (active[i] && e.cable && axial(e, uG) < -1) { active[i] = false; changed = true; }
    });
    if (!changed) break;
  }
  if (!Lfac) return empty('Analysis failed.', null);

  if (!relaxed) NG = elems.map((e, i) => (active[i] ? axial(e, uG) : 0));
  const NQmax = elems.map(() => 0), NQmin = elems.map(() => 0);
  const NEdT = elems.map((_, i) => Math.max(0, GAMMA_G * NG[i]));
  const NEdC = elems.map((_, i) => Math.max(0, -GAMMA_G * NG[i]));
  const slack = elems.map((e, i) => e.cable && !active[i]);
  const caseOfT = elems.map(() => null as AnalysisResult['criticalCase']);
  const caseOfC = elems.map(() => null as AnalysisResult['criticalCase']);

  // deck surface lookup
  const roads = elems.filter((e, i) => e.road && active[i]);
  const surfaceAt = (x: number) => {
    let best: Elem | null = null, by = -Infinity, bt = 0;
    for (const e of roads) {
      const A = byId.get(e.a)!, B = byId.get(e.b)!;
      const x0 = Math.min(A.x, B.x), x1 = Math.max(A.x, B.x);
      if (x < x0 - 1e-6 || x > x1 + 1e-6 || x1 - x0 < 1e-6) continue;
      const t = (x - A.x) / (B.x - A.x);
      const y = A.y + (B.y - A.y) * t;
      if (y > by) { by = y; best = e; bt = t; }
    }
    return best ? { e: best, t: Math.max(0, Math.min(1, bt)) } : null;
  };

  // deck continuity across the gap
  const leftEdge = Math.min(...level.anchors.slice(0, 2).map((a) => a.x));
  const rightEdge = Math.max(...level.anchors.slice(0, 2).map((a) => a.x));
  let deckGapAt: number | null = null;
  for (let x = leftEdge + 0.05; x < rightEdge; x += 0.25) {
    if (!surfaceAt(x)) { deckGapAt = x; break; }
  }

  // live load cases
  const kinds = designKinds ?? [...new Set(level.vehicles.map((v) => v.kind))];
  if (!kinds.length) kinds.push('car', 'hgv');
  let cases = 0;
  let maxDefl = 0, deflNode: number | null = null;
  let shapeU: Float64Array = uG;
  const deckNodes = new Set<number>();
  for (const e of roads) { deckNodes.add(e.a); deckNodes.add(e.b); }

  for (const kind of kinds) {
    const V = VEHICLES[kind];
    for (const dir of [1, -1] as const) {
      for (let rear = leftEdge - V.length; rear <= rightEdge + 0.01; rear += 0.5) {
        const F = new Float64Array(n);
        let any = false;
        for (const ax of V.axles) {
          const x = dir === 1 ? rear + ax.x : rear + V.length - ax.x;
          if (x <= leftEdge || x >= rightEdge) continue;
          const s = surfaceAt(x);
          if (!s) continue;
          const P = ax.share * V.mass * g;
          const da = idx.get(s.e.a)!, db = idx.get(s.e.b)!;
          if (da >= 0) F[da + 1] -= P * (1 - s.t);
          if (db >= 0) F[db + 1] -= P * s.t;
          any = true;
        }
        if (!any) continue;
        cases++;
        const uQ = n ? solveChol(Lfac, n, F) : F;
        elems.forEach((e, i) => {
          if (!active[i]) return;
          const nq = axial(e, uQ);
          if (nq > NQmax[i]) NQmax[i] = nq;
          if (nq < NQmin[i]) NQmin[i] = nq;
          const ned = GAMMA_G * NG[i] + GAMMA_Q * nq;
          if (ned > NEdT[i]) { NEdT[i] = ned; caseOfT[i] = { kind, rear, dir }; }
          if (-ned > NEdC[i]) { NEdC[i] = -ned; caseOfC[i] = { kind, rear, dir }; }
          if (e.cable && NG[i] + nq < 0) slack[i] = true;
        });
        for (const id of deckNodes) {
          const d = idx.get(id)!;
          if (d < 0) continue;
          const dy = -(uG[d + 1] + uQ[d + 1]);
          if (dy > maxDefl) {
            maxDefl = dy; deflNode = id;
            shapeU = new Float64Array(n);
            for (let k = 0; k < n; k++) shapeU[k] = uG[k] + uQ[k];
          }
        }
      }
    }
  }

  // seismic (EN 1998 style, elastic, q = 1): plateau spectral acceleration Sa = 2.5·ag on the bridge's own
  // mass, horizontal E_h and vertical E_v = 0.9·E_h, combined G ± E_h ± 0.3·E_v and G ± 0.3·E_h ± E_v (all
  // factors 1.0). Enveloped into the strength check and also reported on its own.
  let seisUtil = 0;
  const seisT = elems.map(() => 0), seisC = elems.map(() => 0);
  if (level.seismic && n) {
    const Sa = 2.5 * level.seismic.ag;
    const Eh = new Float64Array(n), Ev = new Float64Array(n);
    const addMass = (id: number, m: number) => { const d = idx.get(id)!; if (d >= 0) { Eh[d] += m * g * Sa; Ev[d + 1] -= m * g * Sa * 0.9; } };
    for (const e of elems) { addMass(e.a, e.mass / 2); addMass(e.b, e.mass / 2); }
    for (const nd of nodeList) addMass(nd.id, JOINT_MASS);
    const uH = solveChol(Lfac, n, Eh), uV = solveChol(Lfac, n, Ev);
    cases += 8;
    elems.forEach((e, i) => {
      if (!active[i]) return;
      const nh = axial(e, uH), nv = axial(e, uV);
      for (const [fh, fv] of [[1, 0.3], [0.3, 1]]) for (const sh of [1, -1]) for (const sv of [1, -1]) {
        const ned = NG[i] + sh * fh * nh + sv * fv * nv;
        seisT[i] = Math.max(seisT[i], ned);
        seisC[i] = Math.max(seisC[i], -ned);
        if (ned > NEdT[i]) { NEdT[i] = ned; caseOfT[i] = null; }
        if (-ned > NEdC[i]) { NEdC[i] = -ned; caseOfC[i] = null; }
        if (e.cable && ned < 0) slack[i] = true;
      }
    });
  }

  // member results
  const members = new Map<number, MemberResult>();
  let maxUtil = 0, critical: number | null = null, criticalCase: AnalysisResult['criticalCase'] = null;
  elems.forEach((e, i) => {
    const cap = capacity(e.beam.mat, e.beam.sec, e.L);
    const gm = MATERIALS[e.beam.mat].gammaM;
    const NtRd = cap.Nt / gm, NcRd = cap.Nc / gm;
    const uT = NEdT[i] / NtRd;
    const uC = e.cable ? 0 : NEdC[i] / Math.max(1, NcRd);
    const util = Math.max(uT, uC);
    if (level.seismic) seisUtil = Math.max(seisUtil, seisT[i] / NtRd, e.cable ? 0 : seisC[i] / Math.max(1, NcRd));
    let mode: MemberResult['mode'] = 'none';
    if (e.cable && slack[i] && uT < 0.05) mode = 'slack';
    else if (util > 0) mode = uT >= uC ? 'tension' : cap.buckling ? 'buckling' : 'compression';
    members.set(e.beam.id, {
      beamId: e.beam.id, L: e.L, NG: NG[i], NQmax: NQmax[i], NQmin: NQmin[i],
      NEdT: NEdT[i], NEdC: e.cable ? 0 : NEdC[i], NtRd, NcRd, util, mode, slenderness: cap.slenderness, slack: slack[i],
    });
    if (util > maxUtil) { maxUtil = util; critical = e.beam.id; criticalCase = uT >= uC ? caseOfT[i] : caseOfC[i]; }
  });

  const shape = new Map<number, { dx: number; dy: number }>();
  for (const [id, d] of idx) if (d >= 0) shape.set(id, { dx: shapeU[d], dy: shapeU[d + 1] });

  // reactions under dead load + worst-ish live (dead only is honest & simple)
  const reactions: AnalysisResult['reactions'] = [];
  for (const nd of nodeList) {
    if (!nd.anchor) continue;
    let Rx = 0, Ry = 0;
    elems.forEach((e, i) => {
      if (!active[i] || (e.a !== nd.id && e.b !== nd.id)) return;
      const N = NG[i];
      const sgn = e.a === nd.id ? 1 : -1; // force on node a from tension pulls toward b
      Rx -= sgn * N * e.c;
      Ry -= sgn * N * e.s;
      Ry += (e.mass / 2) * g;
    });
    reactions.push({ nodeId: nd.id, Rx, Ry });
  }

  let gradient = 0;
  for (const e of roads) {
    if (Math.abs(e.c) < 1e-6) { gradient = Infinity; continue; }
    gradient = Math.max(gradient, Math.abs(e.s / e.c));
  }

  const limit = level.span / level.deflectionLimit;
  const checks: Check[] = [
    { id: 'stable', label: 'Stability', ok: true, value: determinacy.degree >= 0 ? (determinacy.degree === 0 ? 'Determinate' : `Indeterminate °${determinacy.degree}`) : 'Stable', detail: `m + r − 2j = ${determinacy.m} + ${determinacy.r} − ${2 * determinacy.j} = ${determinacy.degree}` },
    { id: 'deck', label: 'Deck continuity', ok: deckGapAt === null, value: deckGapAt === null ? 'Continuous' : `Gap at x = ${deckGapAt.toFixed(1)} m`, detail: 'Road deck must run unbroken from abutment to abutment.' },
    { id: 'uls', label: 'Strength (ULS)', ok: maxUtil <= 1, value: `${Math.round(maxUtil * 100)}% max`, detail: `1.35·G + 1.5·Q, ${cases} load positions` },
    { id: 'sls', label: `Deflection ≤ L/${level.deflectionLimit}`, ok: maxDefl <= limit, value: maxDefl > 0 ? `L/${Math.round(level.span / maxDefl)} (${(maxDefl * 1000).toFixed(0)} mm)` : '—', detail: maxDefl > level.span / 50 ? `limit ${(limit * 1000).toFixed(0)} mm — very flexible: linear estimate overstates large movements, but the structure needs stiffening` : `limit ${(limit * 1000).toFixed(0)} mm under G + Q` },
    { id: 'grad', label: `Gradient ≤ ${Math.round(level.maxGradient * 100)}%`, ok: gradient <= level.maxGradient + 1e-6, value: isFinite(gradient) ? `${(gradient * 100).toFixed(1)}%` : 'vertical', detail: 'Steepest deck panel' },
  ];
  if (level.seismic) checks.push({ id: 'seis', label: `Seismic (ag ${level.seismic.ag}g)`, ok: seisUtil <= 1, value: `${Math.round(seisUtil * 100)}% max`, detail: `G ± E: ${(2.5 * level.seismic.ag).toFixed(2)}·g sideways and ${(2.25 * level.seismic.ag).toFixed(2)}·g vertically on the bridge's own mass` });
  const slackLive = elems.filter((_, i) => slack[i] && active[i]).length;
  if (slackLive) checks.push({ id: 'slack', label: 'Cables taut', ok: false, value: `${slackLive} go slack`, detail: 'Some cables lose all tension under live load — the load path changes.' });

  return {
    stable: true, mechanismNode: null, message: 'Stable', members, maxUtil, criticalBeam: critical, criticalCase,
    deflection: maxDefl, deflectionLimit: limit, deflectionNode: deflNode, shape, reactions, gradient, deckGapAt, determinacy,
    checks, passed: checks.every((c) => c.ok || c.id === 'slack'), cases, ms: performance.now() - t0,
  };
}

/**
 * Single linear load case (no cables / relaxation): member forces and joint displacements
 * for dead load plus the given vertical point loads (N, downward positive). Used by the data story.
 */
export function solveCase(nodes: DNode[], beams: DBeam[], pointLoads: Map<number, number>, includeDead = true) {
  const byId = new Map(nodes.map((x) => [x.id, x]));
  const idx = new Map<number, number>();
  let n = 0;
  for (const nd of nodes) {
    if (!beams.some((b) => b.a === nd.id || b.b === nd.id)) continue;
    if (nd.anchor) idx.set(nd.id, -1);
    else { idx.set(nd.id, n); n += 2; }
  }
  const el = beams.map((b) => {
    const A = byId.get(b.a)!, B = byId.get(b.b)!;
    const L = Math.hypot(B.x - A.x, B.y - A.y);
    const p = propsOf(b.mat, b.sec);
    return { b, L, c: (B.x - A.x) / L, s: (B.y - A.y) / L, EA: p.E * p.A, mass: p.massPerM * L };
  });
  const K = new Float64Array(n * n);
  const F = new Float64Array(n);
  for (const e of el) {
    const k = e.EA / e.L, cc = e.c * e.c * k, ss = e.s * e.s * k, cs = e.c * e.s * k;
    const blk = [[cc, cs], [cs, ss]];
    const da = idx.get(e.b.a)!, db = idx.get(e.b.b)!;
    for (let p = 0; p < 2; p++) for (let q = 0; q < 2; q++) {
      if (da >= 0) K[(da + p) * n + da + q] += blk[p][q];
      if (db >= 0) K[(db + p) * n + db + q] += blk[p][q];
      if (da >= 0 && db >= 0) { K[(da + p) * n + db + q] -= blk[p][q]; K[(db + p) * n + da + q] -= blk[p][q]; }
    }
    if (includeDead) for (const d of [da, db]) if (d >= 0) F[d + 1] -= (e.mass / 2) * g;
  }
  if (includeDead) for (const [, d] of idx) if (d >= 0) F[d + 1] -= JOINT_MASS * g;
  for (const [id, P] of pointLoads) { const d = idx.get(id); if (d !== undefined && d >= 0) F[d + 1] -= P; }
  let maxD = 0;
  for (let i = 0; i < n; i++) maxD = Math.max(maxD, K[i * n + i]);
  if (cholesky(K, n, maxD * 1e-10) >= 0) return null;
  const u = solveChol(K, n, F);
  const forces = new Map<number, number>();
  for (const e of el) {
    const da = idx.get(e.b.a)!, db = idx.get(e.b.b)!;
    const ua = da >= 0 ? [u[da], u[da + 1]] : [0, 0], ub = db >= 0 ? [u[db], u[db + 1]] : [0, 0];
    forces.set(e.b.id, (e.EA / e.L) * ((ub[0] - ua[0]) * e.c + (ub[1] - ua[1]) * e.s));
  }
  const disp = new Map<number, { dx: number; dy: number }>();
  for (const [id, d] of idx) disp.set(id, d >= 0 ? { dx: u[d], dy: u[d + 1] } : { dx: 0, dy: 0 });
  return { forces, disp };
}
