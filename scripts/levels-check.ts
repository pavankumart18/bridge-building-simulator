/**
 * Verifies every Expert project is fair: its stored reference design (scripts/reference-solutions.json, not
 * shipped) is valid, code compliant, within the 3-star cost line and passes the real load test — earthquake included.
 * Usage: npm run test:levels
 */
import REF from './reference-solutions.json';
import { Design } from '../src/design';
import { LEVELS } from '../src/levels';
import { MATERIALS } from '../src/materials';
import { analyse } from '../src/analysis';
import { Sim } from '../src/physics';

const T0 = performance.now();
let bad = 0;
for (const level of LEVELS.filter((l) => l.tier === 'Expert')) {
  const t0 = performance.now();
  const ref = (REF as Record<string, { json: string }>)[level.id];
  if (!ref) { console.log(`${level.id} ✗ no reference design`); bad++; continue; }
  const d = new Design(level);
  d.load(ref.json);
  const errs: string[] = [];
  for (const n of d.nodes) if (!n.anchor && !d.placeable(n)) errs.push(`joint (${n.x},${n.y}) not placeable`);
  for (const b of d.beams) {
    if (!level.materials.includes(b.mat)) errs.push(`${b.mat} not allowed`);
    if (d.beamLength(b) > MATERIALS[b.mat].maxLength + 1e-6) errs.push(`${b.mat} member too long`);
    if (!d.segmentAllowed(d.node(b.a)!, d.node(b.b)!)) errs.push('member crosses a no-build zone');
  }
  const an = analyse(level, d.nodes, d.beams);
  const failing = an.checks.filter((c) => !c.ok && c.id !== 'slack').map((c) => c.label);
  if (failing.length) errs.push(`fails ${failing.join(', ')}`);
  const cost = d.cost();
  if (cost > level.budget * 0.8) errs.push(`$${cost} over the 3★ line $${level.budget * 0.8}`);
  const sim = new Sim(level, d.nodes, d.beams);
  while (sim.outcome === 'running' && sim.time < 95) sim.step();
  if (sim.outcome !== 'success') errs.push(`load test ${sim.outcome}`);
  const ms = performance.now() - t0;
  if (errs.length) bad++;
  console.log(`${level.id.padEnd(4)} ${errs.length ? '✗' : '✓'} ${level.name.padEnd(20)} $${cost} / 3★ $${level.budget * 0.8} · ULS ${Math.round(an.maxUtil * 100)}% · test peak ${Math.round(sim.maxRatio * 100)}% · ${(ms / 1000).toFixed(1)} s${errs.length ? '\n      ' + errs.join('; ') : ''}`);
}
console.log(`${bad ? bad + ' FAILED' : 'all Expert projects verified solvable at 3★'} in ${((performance.now() - T0) / 1000).toFixed(1)} s`);
process.exit(bad ? 1 : 0);
