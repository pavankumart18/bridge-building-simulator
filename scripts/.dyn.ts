import REF from './reference-solutions.json';
import { Design } from '../src/design';
import { ALL_LEVELS } from '../src/levels';
import { analyse } from '../src/analysis';
import { Sim } from '../src/physics';
import { VEHICLES } from '../src/vehicles';
const t0 = performance.now();
const [id, kind, speedArg] = process.argv.slice(2);
const lv0 = ALL_LEVELS.find((l) => l.id === id)!;
const lv = { ...lv0, seismic: undefined, vehicles: [{ kind: kind as any, delay: 0 }] };
const d = new Design(lv as any); d.load((REF as any)[id].json);
const an = analyse(lv as any, d.nodes, d.beams);
if (speedArg) (VEHICLES as any)[kind].speed = +speedArg;
const sim = new Sim(lv as any, d.nodes, d.beams);
const peak = new Map<number, number>();
while (sim.outcome === 'running' && sim.time < 60) {
  sim.step();
  for (const m of sim.members) if (m.designId >= 0 && !m.broken) peak.set(m.designId, Math.max(peak.get(m.designId) ?? 0, Math.abs(m.force)));
}
const rows = d.beams.map((b) => { const r = an.members.get(b.id)!; const st = Math.max(Math.abs(r.NG + r.NQmax), Math.abs(r.NG + r.NQmin)); return { b, st, dy: peak.get(b.id) ?? 0, ratio: (peak.get(b.id) ?? 0) / Math.max(st, 1) }; })
  .filter((r) => r.st > 20000).sort((a, b) => b.ratio - a.ratio);
console.log(`${id} ${kind} speed ${VEHICLES[kind as 'car'].speed} outcome ${sim.outcome} t=${sim.time.toFixed(1)}`);
for (const r of rows.slice(0, 6)) { const A = d.node(r.b.a)!, B = d.node(r.b.b)!; console.log(`  ${r.b.mat} (${A.x},${A.y})-(${B.x},${B.y}) static G+Q ${(r.st / 1000).toFixed(0)} kN · dynamic ${(r.dy / 1000).toFixed(0)} kN · ×${r.ratio.toFixed(2)}`); }
console.log(((performance.now() - t0) / 1000).toFixed(1) + ' s');
