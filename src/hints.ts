/**
 * Turns a failed load test or failing design checks into a plain-language diagnosis
 * and concrete fixes. Hints escalate with repeated failures on the same project.
 */
import { MATERIALS, capacity, sectionOf, type MaterialId } from './materials';
import type { Design, DBeam } from './design';
import type { AnalysisResult } from './analysis';
import type { Level } from './levels';

export interface BreakInfo { designId: number; force: number; mat: MaterialId | null | undefined; t?: number }
export interface TestInfo {
  passed: boolean;
  firstBreak: BreakInfo | null;
  breaks: number;
  lost: boolean;
  timedOut: boolean;
}

export interface Diagnosis {
  icon: string;
  title: string;
  why: string;
  tips: string[];
  focusBeams: number[];
  focusNode: number | null;
}

const pct = (r: number) => `${Math.round(r * 100)}%`;
const kN = (n: number) => `${Math.round(Math.abs(n) / 1000)} kN`;

function role(design: Design, b: DBeam) {
  if (b.mat === 'deck') return 'road deck panel';
  if (b.mat === 'cable') return 'cable';
  const A = design.node(b.a)!, B = design.node(b.b)!;
  const dx = Math.abs(B.x - A.x), dy = Math.abs(B.y - A.y);
  if (dy < 0.15 * dx) return 'chord';
  if (dx < 0.15 * dy) return 'post';
  return 'diagonal';
}

function nextSection(b: DBeam) {
  const M = MATERIALS[b.mat];
  return b.sec + 1 < M.sections.length ? M.sections[b.sec + 1].name : null;
}

/** what actually happened in the load test, and what to do about it */
export function diagnoseTest(level: Level, design: Design, an: AnalysisResult, test: TestInfo, failCount: number): Diagnosis {
  const tips: string[] = [];
  let d: Diagnosis;

  if (!an.stable) {
    d = {
      icon: '△', title: 'The structure can fold',
      why: an.message.includes('slack')
        ? 'Some joints hang only from cables, and cables go slack when pushed — so nothing holds those joints in place.'
        : 'At least one joint can move without stretching or squashing any member. Pin-jointed squares fold like a parallelogram.',
      tips: ['Add a diagonal across every four-sided panel so the structure is made of triangles.', 'The joint pulsing red in design mode is the one that can move freely.'],
      focusBeams: [], focusNode: an.mechanismNode,
    };
  } else if (an.deckGapAt !== null) {
    d = {
      icon: '⊔', title: 'There is a gap in the road',
      why: `Vehicles need an unbroken road deck from bank to bank. The deck is missing near x = ${an.deckGapAt.toFixed(1)} m.`,
      tips: ['Use the Road deck tool (1) and connect every deck panel joint to joint, from the left anchor to the right anchor.', 'Truss members do not count as road — wheels pass straight through them.'],
      focusBeams: [], focusNode: null,
    };
  } else if (test.firstBreak) {
    const b = design.beams.find((x) => x.id === test.firstBreak!.designId);
    if (b) {
      const L = design.beamLength(b);
      const cap = capacity(b.mat, b.sec, L);
      const compression = test.firstBreak.force < 0;
      const buckled = compression && cap.buckling;
      const name = `${MATERIALS[b.mat].name} ${sectionOf(b.mat, b.sec).name} ${role(design, b)}`;
      const bigger = nextSection(b);
      if (buckled) {
        tips.push(`Shorten it: add a joint halfway and brace that joint with another member. Half the length gives roughly four times the buckling strength.`);
        if (bigger) tips.push(`Or use a stockier section — try ${bigger}.`);
        if (b.mat === 'timber') tips.push('Steel is about 18× stiffer than timber, so steel struts buckle much later.');
      } else if (compression) {
        tips.push(bigger ? `Use a bigger section — try ${bigger}.` : 'This is already the largest section; share the load with a second member or a deeper truss.');
      } else {
        tips.push(bigger ? `Tension capacity is simply strength × area: a bigger section (${bigger}) fixes it.` : 'Already the largest section — add a parallel member or deepen the truss to reduce the force.');
        if (b.mat === 'timber') tips.push('Steel is about 18× stronger than timber in tension per area.');
      }
      const q = level.seismic;
      if (q && test.firstBreak.t !== undefined && test.firstBreak.t >= q.at && test.firstBreak.t <= q.at + q.dur + 1) {
        tips.unshift('It failed while the ground was shaking. Earthquake forces come from the bridge\'s own mass, so a lighter structure feels less — and any tall support needs diagonal bracing in every panel.');
      }
      if (role(design, b) === 'chord' || b.mat === 'deck') tips.push('A deeper truss reduces chord forces: force ≈ bending moment ÷ depth. Aim for a depth around span ÷ 8.');
      d = {
        icon: buckled ? '⌇' : compression ? '⇥' : '⇿',
        title: buckled ? 'A strut buckled' : compression ? 'A member was crushed' : 'A member snapped in tension',
        why: `The first member to fail was a ${name}, ${L.toFixed(1)} m long, carrying ${kN(test.firstBreak.force)} of ${compression ? 'compression' : 'tension'}. ${buckled ? `Its buckling capacity at that length is only ${kN(cap.Nc)} — long thin members fail sideways when pushed.` : `Its capacity is ${kN(compression ? cap.Nc : cap.Nt)}.`}${test.breaks > 1 ? ` Then ${test.breaks - 1} more member${test.breaks > 2 ? 's' : ''} failed as the load moved to its neighbours.` : ''}`,
        tips, focusBeams: [b.id], focusNode: null,
      };
    } else {
      d = { icon: '!', title: 'A member failed', why: 'A member was overloaded during the test.', tips: ['Switch to the Utilisation view and strengthen anything orange or red.'], focusBeams: [], focusNode: null };
    }
  } else if (test.lost) {
    d = {
      icon: '≈', title: 'A vehicle fell off',
      why: an.gradient > level.maxGradient ? 'Part of the deck is too steep, so a vehicle lost grip and slid off.' : 'No member broke, but a vehicle left the road — usually a sagging or uneven deck, or a gap at a joint.',
      tips: ['Keep the deck straight and level between the anchors.', 'Stiffen the deck with a truss so it cannot sag into a dip under the wheels.'],
      focusBeams: [], focusNode: null,
    };
  } else if (test.timedOut) {
    d = {
      icon: '⏱', title: 'Traffic got stuck',
      why: 'The vehicles never reached the far bank — usually the deck sags into a dip too steep to climb out of.',
      tips: ['Make the bridge stiffer: deeper truss, bigger chords, or supports underneath.', `Check the gradient: it must stay below ${Math.round(level.maxGradient * 100)}%.`],
      focusBeams: [], focusNode: null,
    };
  } else {
    d = { icon: '!', title: 'The test failed', why: 'The vehicles did not cross.', tips: ['Check the design panel for red items.'], focusBeams: [], focusNode: null };
  }

  if (failCount >= 2) d.tips.push(`Hint from the brief: ${level.hint}`);
  if (failCount >= 3) d.tips.push(`Still stuck? A dependable start for a ${level.span} m span: a road deck in panels of about 2–3 m, a row of triangles about ${(level.span / 8).toFixed(1)} m deep, and the largest sections on the top chord. Make it work first, then make it cheaper.`);
  return d;
}

/** a passing test that still misses stars: what to improve next */
export function improvementTips(level: Level, design: Design, an: AnalysisResult): Diagnosis | null {
  const cost = design.cost();
  const tips: string[] = [];
  const focus: number[] = [];
  const failing = an.checks.filter((c) => !c.ok && c.id !== 'slack');
  for (const c of failing) {
    if (c.id === 'uls' && an.criticalBeam !== null) {
      const b = design.beams.find((x) => x.id === an.criticalBeam);
      if (b) {
        const r = an.members.get(b.id)!;
        focus.push(b.id);
        tips.push(`Strength: a ${role(design, b)} is at ${pct(r.util)} of its design capacity (${r.mode}). ${r.mode === 'buckling' ? 'Brace it halfway or pick a stockier section.' : `Pick a bigger section${nextSection(b) ? ` — ${nextSection(b)}` : ''}.`} It survived the test, but the code demands a safety margin.`);
      }
    } else if (c.id === 'sls') tips.push(`Deflection: the deck moves ${(an.deflection * 1000).toFixed(0)} mm, more than ${(an.deflectionLimit * 1000).toFixed(0)} mm. Deepen the truss or use stiffer (steel) chords.`);
    else if (c.id === 'seis') tips.push('Seismic: under the earthquake load case a member is over capacity. Lighten heavy parts (a concrete deck adds a lot of mass), brace tall supports with diagonals, and enlarge the highlighted members.');
    else if (c.id === 'grad') tips.push(`Gradient: the steepest deck panel is ${(an.gradient * 100).toFixed(1)}%; keep it under ${Math.round(level.maxGradient * 100)}% by lining the deck up straight between the anchors.`);
  }
  if (cost > level.budget * 0.8) {
    const light = design.beams.filter((b) => { const r = an.members.get(b.id); return r && r.util < 0.25 && b.sec > 0 && b.mat !== 'deck'; });
    if (light.length) {
      tips.push(`Cost: ${light.length} member${light.length > 1 ? 's use' : ' uses'} less than 25% of their capacity — select them (highlighted) and choose a smaller section.`);
      focus.push(...light.map((b) => b.id));
    }
    const joints = design.nodes.filter((n) => !n.anchor).length;
    tips.push(`Every joint costs $150 — you have ${joints}. Longer panels mean fewer joints.`);
    if (design.beams.some((b) => b.mat === 'steel')) tips.push('Timber is far cheaper per metre than steel — use steel only where forces are high.');
  }
  if (!tips.length) return null;
  return { icon: '↗', title: failing.length ? 'Make it code compliant' : 'Make it leaner', why: failing.length ? 'The bridge survived the test, but the design checks show it has too little safety margin.' : `You are at ${pct(cost / level.budget)} of the budget; get under 80% for the third star.`, tips, focusBeams: focus, focusNode: null };
}

/** one-line hint shown under each failing design check */
export function checkHint(design: Design, an: AnalysisResult, id: string, level: Level): { text: string; beams: number[]; node: number | null } | null {
  switch (id) {
    case 'stable':
      return { text: 'The red pulsing joint can move freely. Add a diagonal to make a triangle.', beams: [], node: an.mechanismNode };
    case 'deck':
      return { text: 'Connect the road deck all the way between the two road-level anchors.', beams: [], node: null };
    case 'uls': {
      const b = an.criticalBeam !== null ? design.beams.find((x) => x.id === an.criticalBeam) : null;
      if (!b) return null;
      const r = an.members.get(b.id)!;
      const over = design.beams.filter((x) => (an.members.get(x.id)?.util ?? 0) > 1).map((x) => x.id);
      return {
        text: r.mode === 'buckling'
          ? `${over.length} member${over.length > 1 ? 's' : ''} over 100%. Worst: a ${role(design, b)} buckling at ${pct(r.util)} — shorten it or use a stockier section.`
          : `${over.length} member${over.length > 1 ? 's' : ''} over 100%. Worst: a ${role(design, b)} at ${pct(r.util)} in ${r.mode} — use a bigger section or a deeper truss.`,
        beams: over, node: null,
      };
    }
    case 'sls':
      return { text: 'Too bendy: deepen the truss, add supports underneath, or use stiffer steel chords.', beams: [], node: null };
    case 'grad':
      return { text: `Flatten the deck: no panel steeper than ${Math.round(level.maxGradient * 100)}%.`, beams: design.beams.filter((b) => b.mat === 'deck').filter((b) => { const A = design.node(b.a)!, B = design.node(b.b)!; return Math.abs((B.y - A.y) / (B.x - A.x || 1e-6)) > level.maxGradient; }).map((b) => b.id), node: null };
    case 'seis': {
      const over = design.beams.filter((x) => (an.members.get(x.id)?.util ?? 0) > 1).map((x) => x.id);
      return { text: 'Too weak for the earthquake case. Lighter decks attract less force; brace tall supports and enlarge the highlighted members.', beams: over, node: null };
    }
    case 'slack':
      return { text: 'Some cables go slack under traffic — they need a downward pull (deck weight) to stay taut, or a different angle.', beams: [], node: null };
  }
  return null;
}
