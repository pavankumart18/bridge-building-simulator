/** Regression: every stored 3★ example must still be valid, code compliant, ≤ 80% budget and pass the load test. */
import { Design } from '../src/design';
import { LEVELS } from '../src/levels';
import { MATERIALS } from '../src/materials';
import { analyse } from '../src/analysis';
import { Sim } from '../src/physics';
import EX from '../src/examples.json';
const t0 = performance.now();
let bad = 0;
const stored = EX as Record<string, { json: string }>;
if (!stored.l0) { console.log('l0 ✗ starter solution missing'); bad++; }
for (const level of LEVELS) {
  const ex = stored[level.id];
  if (!ex) continue; // only the Starter project ships a worked solution
  const d = new Design(level);
  d.load(ex.json);
  const geom = d.nodes.every((n) => n.anchor || d.placeable(n)) && d.beams.every((b) => d.beamLength(b) <= MATERIALS[b.mat].maxLength + 1e-6 && d.segmentAllowed(d.node(b.a)!, d.node(b.b)!));
  const an = analyse(level, d.nodes, d.beams);
  const sim = new Sim(level, d.nodes, d.beams);
  while (sim.outcome === 'running' && sim.time < 95) sim.step();
  const ok = geom && an.passed && d.cost() <= level.budget * 0.8 && sim.outcome === 'success';
  if (!ok) bad++;
  console.log(`${level.id.padEnd(4)} ${ok ? '✓' : '✗'} $${d.cost()} / 3★ ≤ $${level.budget * 0.8} · ULS ${Math.round(an.maxUtil * 100)}% · δ ${(an.deflection * 1000).toFixed(0)}/${(an.deflectionLimit * 1000).toFixed(0)} mm · test ${sim.outcome} ${Math.round(sim.maxRatio * 100)}%${geom ? '' : ' · GEOMETRY INVALID'}`);
}
console.log(`${bad ? bad + ' FAILED' : 'all examples verified'} in ${(performance.now() - t0).toFixed(0)} ms`);
process.exit(bad ? 1 : 0);
