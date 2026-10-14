/** Verifies the tutorial's guided bridge is buildable and passes every check (otherwise the tutorial would stall). */
import { Design } from '../src/design';
import { LEVELS } from '../src/levels';
import { analyse } from '../src/analysis';
import { Sim } from '../src/physics';

const t0 = performance.now();
const d = new Design(LEVELS[0]);
const id = (x: number, y: number) => (d.nodes.find((n) => n.x === x && n.y === y) ?? d.addNode(x, y)).id;
const place = (x: number, y: number) => d.nodes.some((n) => n.x === x && n.y === y) || d.placeable({ x, y });
let ok = true;
for (const x of [0, 2, 4, 6, 8]) { ok &&= place(x + 2, 0); d.addBeam(id(x, 0), id(x + 2, 0), 'deck', 0); }
const deckOnly = analyse(d.level, d.nodes, d.beams);
console.log('deck only  :', deckOnly.checks.map((c) => `${c.ok ? '✓' : '✗'}${c.id}`).join(' '));
for (const x of [0, 2, 4, 6, 8]) { ok &&= place(x + 1, -1.5); d.addBeam(id(x, 0), id(x + 1, -1.5), 'timber', 1); d.addBeam(id(x + 1, -1.5), id(x + 2, 0), 'timber', 1); }
for (const x of [1, 3, 5, 7]) d.addBeam(id(x, -1.5), id(x + 2, -1.5), 'timber', 1);
const an = analyse(d.level, d.nodes, d.beams);
console.log('with truss :', an.checks.map((c) => `${c.ok ? '✓' : '✗'}${c.id}`).join(' '), `ULS ${Math.round(an.maxUtil * 100)}% cost $${d.cost()} / $${d.level.budget}`, 'placeable', ok);
const sim = new Sim(d.level, d.nodes, d.beams);
let f = 0;
while (sim.outcome === 'running' && f++ < 6000) sim.step();
console.log(`load test  : ${sim.outcome} peak ${Math.round(sim.maxRatio * 100)}% in ${(performance.now() - t0).toFixed(0)}ms`);
