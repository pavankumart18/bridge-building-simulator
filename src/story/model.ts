/** Everything the story shows is computed here with the game's own engine. */
import { Design, type DBeam } from '../design';
import { LEVELS, type Level } from '../levels';
import { analyse, solveCase, GAMMA_G, GAMMA_Q } from '../analysis';
import { capacity, MATERIALS, propsOf, type MaterialId } from '../materials';
import { Sim } from '../physics';
import { VEHICLES } from '../vehicles';

export const LEVEL: Level = LEVELS.find((l) => l.id === 'l3')!; // 16 m Quarry Road
export const TRUCK = VEHICLES.hgv;
const g = 9.81;

export interface Bridge { design: Design; deck: number[]; top: number[]; topChord: number[]; deckMembers: number[]; endDiag: number; midTop: number; midDeck: number }

/** Warren truss over the 16 m gap */
export function buildBridge(height = 2.5, web: [MaterialId, number] = ['steel', 2], chord: [MaterialId, number] = ['steel', 3]): Bridge {
  const d = new Design(LEVEL);
  const L = d.nodes[0], R = d.nodes[1];
  const n = 8;
  const deck = [L];
  for (let i = 1; i < n; i++) deck.push(d.addNode((16 * i) / n, 0));
  deck.push(R);
  const deckMembers: number[] = [];
  for (let i = 0; i < n; i++) deckMembers.push(d.addBeam(deck[i].id, deck[i + 1].id, 'deck', 1)!.id);
  const top = deck.slice(0, -1).map((p, i) => d.addNode((p.x + deck[i + 1].x) / 2, height));
  const topChord: number[] = [];
  let endDiag = -1;
  top.forEach((t, i) => {
    const a = d.addBeam(deck[i].id, t.id, web[0], web[1])!;
    if (i === 0) endDiag = a.id;
    d.addBeam(t.id, deck[i + 1].id, web[0], web[1]);
    if (i) topChord.push(d.addBeam(top[i - 1].id, t.id, chord[0], chord[1])!.id);
  });
  return {
    design: d, deck: deck.map((x) => x.id), top: top.map((x) => x.id), topChord, deckMembers, endDiag,
    midTop: topChord[Math.floor(topChord.length / 2)], midDeck: deckMembers[n / 2],
  };
}

/** axle loads (N) for a truck whose rear bumper is at x, distributed to deck joints */
export function truckLoads(b: Bridge, rear: number) {
  const d = b.design;
  const loads = new Map<number, number>();
  const axles: { x: number; P: number }[] = [];
  for (const ax of TRUCK.axles) {
    const x = rear + ax.x;
    const P = ax.share * TRUCK.mass * g;
    axles.push({ x, P });
    if (x <= 0 || x >= 16) continue;
    const i = Math.min(7, Math.floor(x / 2));
    const t = (x - i * 2) / 2;
    const a = b.deck[i], c = b.deck[i + 1];
    loads.set(a, (loads.get(a) ?? 0) + P * (1 - t));
    loads.set(c, (loads.get(c) ?? 0) + P * t);
  }
  void d;
  return { loads, axles };
}

export function forcesAt(b: Bridge, rear: number | null, dead = true) {
  const loads = rear === null ? new Map<number, number>() : truckLoads(b, rear).loads;
  return solveCase(b.design.nodes, b.design.beams, loads, dead)!;
}

/** vertical support reactions (kN) at the two abutments */
export function reactions(b: Bridge, forces: Map<number, number>) {
  const d = b.design;
  const out: { id: number; x: number; Ry: number }[] = [];
  for (const nd of d.nodes.slice(0, 2)) {
    let Ry = 0;
    for (const beam of d.beams) {
      if (beam.a !== nd.id && beam.b !== nd.id) continue;
      const A = d.node(beam.a)!, B = d.node(beam.b)!;
      const L = Math.hypot(B.x - A.x, B.y - A.y);
      const s = (B.y - A.y) / L;
      const N = forces.get(beam.id)!;
      Ry -= (beam.a === nd.id ? 1 : -1) * N * s;
      Ry += (propsOf(beam.mat, beam.sec).massPerM * L / 2) * g;
    }
    out.push({ id: nd.id, x: nd.x, Ry });
  }
  return out;
}

export function selfWeightKN(b: Bridge) {
  return b.design.beams.reduce((s, x) => s + b.design.beamLength(x) * propsOf(x.mat, x.sec).massPerM, 0) * g / 1000;
}

/** member force (kN) vs truck position for chosen members */
export function influence(b: Bridge, ids: number[]) {
  const out = new Map<number, [number, number][]>(ids.map((i) => [i, []]));
  for (let rear = -TRUCK.length; rear <= 16.001; rear += 0.25) {
    const f = forcesAt(b, rear).forces;
    const front = rear + TRUCK.length;
    for (const id of ids) out.get(id)!.push([front, f.get(id)! / 1000]);
  }
  return out;
}

/** design force in the top chord and cost as the truss gets deeper */
export function depthStudy() {
  const rows: { h: number; chord: number; diag: number; cost: number; defl: number }[] = [];
  for (let h = 1; h <= 5.001; h += 0.5) {
    const b = buildBridge(h);
    const an = analyse(LEVEL, b.design.nodes, b.design.beams, ['hgv']);
    const chord = Math.max(...b.topChord.map((id) => an.members.get(id)!.NEdC)) / 1000;
    const diag = an.members.get(b.endDiag)!.NEdC / 1000;
    rows.push({ h, chord, diag, cost: b.design.cost(), defl: an.deflection * 1000 });
  }
  return rows;
}

export function bucklingCurves() {
  const pts = (mat: MaterialId, sec: number, kind: 'Nt' | 'Nc') => {
    const out: [number, number][] = [];
    for (let L = 0.5; L <= 8.001; L += 0.1) out.push([+L.toFixed(1), capacity(mat, sec, L)[kind] / 1000]);
    return out;
  };
  return { steelT: pts('steel', 1, 'Nt'), steelC: pts('steel', 1, 'Nc'), timberC: pts('timber', 0, 'Nc') };
}

/** run the real dynamic load test and compare the critical member with the code numbers */
export function safetyStudy() {
  const b = buildBridge(2.5, ['timber', 2], ['timber', 2]);
  const an = analyse(LEVEL, b.design.nodes, b.design.beams, ['hgv']);
  const crit = b.midTop;
  const r = an.members.get(crit)!;
  const t0 = performance.now();
  const sim = new Sim(LEVEL, b.design.nodes, b.design.beams);
  let peak = 0;
  let frames = 0;
  while (sim.outcome === 'running' && frames++ < 60 * 30) {
    sim.step();
    for (const m of sim.members) if (m.designId === crit) peak = Math.max(peak, Math.abs(m.force));
  }
  const beam = b.design.beams.find((x) => x.id === crit) as DBeam;
  const L = b.design.beamLength(beam);
  const cap = capacity(beam.mat, beam.sec, L);
  return {
    member: `${MATERIALS[beam.mat].name} ${MATERIALS[beam.mat].sections[beam.sec].name}, ${L.toFixed(1)} m top chord`,
    peak: peak / 1000,
    NEd: r.NEdC / 1000,
    NRd: (cap.Nc / MATERIALS[beam.mat].gammaM) / 1000,
    NRk: cap.Nc / 1000,
    outcome: sim.outcome,
    ms: performance.now() - t0,
    factors: [GAMMA_G, GAMMA_Q],
  };
}
