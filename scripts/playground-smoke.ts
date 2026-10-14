/** Headless smoke test of Playground features: two-way traffic, manual driving, dropped loads, earthquake. */
import { Design } from '../src/design';
import { PLAYGROUND } from '../src/levels';
import { Sim } from '../src/physics';
import { analyse } from '../src/analysis';

const d = new Design(PLAYGROUND);
const [L, R, , , P1, P2] = d.nodes;
function span(a: typeof L, b: typeof L) {
  const n = Math.round((b.x - a.x) / 2.4), dk = [a];
  for (let i = 1; i < n; i++) dk.push(d.addNode(a.x + ((b.x - a.x) * i) / n, 0));
  dk.push(b);
  for (let i = 0; i < n; i++) d.addBeam(dk[i].id, dk[i + 1].id, 'deck', 1);
  const top = dk.slice(0, -1).map((p, i) => d.addNode((p.x + dk[i + 1].x) / 2, 3));
  top.forEach((t, i) => { d.addBeam(dk[i].id, t.id, 'steel', 2); d.addBeam(t.id, dk[i + 1].id, 'steel', 2); if (i) d.addBeam(top[i - 1].id, t.id, 'steel', 3); });
  return dk;
}
// two spans onto the pier: deck joint above pier anchors via posts
const mid = d.addNode(24, 0);
d.addBeam(P1.id, mid.id, 'steel', 3); d.addBeam(P2.id, mid.id, 'steel', 3);
span(L, mid); span(mid, R);
const t0 = performance.now();
const an = analyse(PLAYGROUND, d.nodes, d.beams, ['car', 'bus', 'hgv']);
console.log(`analysis ${an.ms.toFixed(0)}ms stable=${an.stable} ULS=${Math.round(an.maxUtil * 100)}% cases=${an.cases} ${an.message}`);
const sim = new Sim(PLAYGROUND, d.nodes, d.beams, false);
for (const k of (process.env.HEAVY ? ['car', 'van', 'bus', 'hgv', 'design', 'pickup'] : ['car', 'van', 'bus', 'pickup', 'car', 'hgv']) as ('car')[]) { sim.enqueue(k, 1); sim.enqueue(k, -1); }
let frames = 0, breaks = 0;
const t1 = performance.now();
for (; frames < 60 * 40; frames++) {
  if (process.env.LOAD && frames === 60 * 5) sim.dropLoad(12, 5, 20000);
  if (frames === 60 * 8) { const v = sim.vehicles.find((x) => !x.removed)!; v.manual = true; v.throttle = 1; }
  if (frames === 60 * 15) sim.quake = { amp: 0.1, freq: 1.5 };
  if (frames === 60 * 25) sim.quake = null;
  sim.step();
  for (const e of sim.events) {
    if (e.type === 'break' && breaks++ < 3) console.log(`  t=${sim.time.toFixed(1)} break ${e.mat} at (${e.x.toFixed(1)},${e.y.toFixed(1)}) ${((e.force ?? 0) / 1000).toFixed(0)}kN`);
    if (e.type === 'lost') console.log(`  t=${sim.time.toFixed(1)} lost at (${e.x.toFixed(1)},${e.y.toFixed(1)})`);
    if (e.type === 'spawn') console.log(`  t=${sim.time.toFixed(1)} spawn at (${e.x.toFixed(1)},${e.y.toFixed(1)})`);
  }
  sim.events.length = 0;
}
const wall = performance.now() - t1;
const arrived = sim.vehicles.filter((v) => v.arrived).length, lost = sim.vehicles.filter((v) => v.lost).length;
const nan = sim.particles.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y));
console.log(`spawned ${sim.vehicles.length}, arrived ${arrived}, lost ${lost}, breaks ${breaks}, peak ${Math.round(sim.maxRatio * 100)}%, NaN=${nan}`);
console.log(`40 s simulated in ${wall.toFixed(0)}ms (${(wall / frames).toFixed(2)} ms/frame); total ${(performance.now() - t0).toFixed(0)}ms`);
