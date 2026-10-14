/** Finds the cheapest code-compliant designs in the story's design challenge (checks 3 stars are reachable). */
import { buildBridge, LEVEL } from '../src/story/model';
import { analyse } from '../src/analysis';
import { Sim } from '../src/physics';
import type { MaterialId } from '../src/materials';
const t0 = performance.now();
const rows: { k: string; cost: number; util: number; defl: number }[] = [];
for (const mat of ['timber', 'steel'] as MaterialId[]) for (let depth = 1; depth <= 4; depth += 0.5) for (const panels of [6, 8, 10])
  for (let chord = 0; chord < (mat === 'timber' ? 4 : 5); chord++) for (let web = 0; web <= chord; web++) for (const deck of [0, 1]) {
    const b = buildBridge(depth, [mat, web], [mat, chord], deck, panels);
    const an = analyse(LEVEL, b.design.nodes, b.design.beams, ['hgv']);
    if (an.stable && an.maxUtil <= 1 && an.deflection <= an.deflectionLimit) rows.push({ k: `${mat} d${depth} p${panels} c${chord} w${web} deck${deck}`, cost: b.design.cost(), util: an.maxUtil, defl: an.deflection * 1000 });
  }
rows.sort((a, b) => a.cost - b.cost);
console.log(`${rows.length} compliant designs; budget ${LEVEL.budget}, 3★ ≤ ${LEVEL.budget * 0.8}`);
for (const r of rows.slice(0, 6)) console.log(r.k, r.cost, `${Math.round(r.util * 100)}%`, `${r.defl.toFixed(0)}mm`);
const best = rows[0].k.match(/(\w+) d([\d.]+) p(\d+) c(\d) w(\d) deck(\d)/)!;
const b = buildBridge(+best[2], [best[1] as MaterialId, +best[5]], [best[1] as MaterialId, +best[4]], +best[6], +best[3]);
const sim = new Sim(LEVEL, b.design.nodes, b.design.beams);
while (sim.outcome === 'running' && sim.time < 30) sim.step();
console.log('cheapest design load test:', sim.outcome, `peak ${Math.round(sim.maxRatio * 100)}%`, `total ${(performance.now() - t0).toFixed(0)}ms`);
