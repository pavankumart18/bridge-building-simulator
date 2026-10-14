import type { MaterialId } from './materials';
import type { VehicleKind } from './vehicles';

export interface Vec { x: number; y: number }

export interface VehicleSpec {
  kind: VehicleKind;
  /** seconds after simulation start */
  delay: number;
  /** +1 drives left→right, −1 right→left */
  dir?: 1 | -1;
}

export interface Anchor extends Vec {
  /** draw a concrete pylon / tower from the anchor down to this y */
  pylonTo?: number;
}

export interface Zone { x0: number; y0: number; x1: number; y1: number; label: string }

export interface Level {
  id: string;
  name: string;
  code: string;
  client: string;
  brief: string;
  lesson: string;
  hint: string;
  budget: number;
  span: number;
  materials: MaterialId[];
  terrain: Vec[][];
  anchors: Anchor[];
  waterY: number;
  /** a vehicle whose centre drops below this is lost */
  lossY: number;
  spawnL: Vec;
  spawnR: Vec;
  vehicles: VehicleSpec[];
  /** SLS deflection limit as span / n */
  deflectionLimit: number;
  /** max road gradient (rise/run) */
  maxGradient: number;
  noBuild: Zone[];
  boats: boolean;
  highwayY: number | null;
  scenery: { trees: number; houses: boolean; seed: number };
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  playground?: boolean;
}

// ---------- terrain helpers ----------

export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function leftBank(edge: number, top: number, seed: number, bottom: number): Vec[] {
  const r = rng(seed);
  const pts: Vec[] = [{ x: -120, y: bottom }, { x: -120, y: top }, { x: edge, y: top }];
  let x = edge;
  for (let y = top - 1.2; y > bottom + 1; y -= 1.4 + r() * 1.6) {
    x = edge - 0.2 - r() * 1.4 + (top - y) * 0.06;
    pts.push({ x, y });
  }
  pts.push({ x: x + 2.5, y: bottom });
  return pts;
}

function rightBank(edge: number, top: number, seed: number, bottom: number): Vec[] {
  const r = rng(seed);
  const face: Vec[] = [];
  let x = edge;
  for (let y = top - 1.2; y > bottom + 1; y -= 1.4 + r() * 1.6) {
    x = edge + 0.2 + r() * 1.4 - (top - y) * 0.06;
    face.push({ x, y });
  }
  return [{ x: x - 2.5, y: bottom }, ...face.reverse(), { x: edge, y: top }, { x: edge + 120, y: top }, { x: edge + 120, y: bottom }];
}

function pillar(cx: number, top: number, halfW: number, seed: number, bottom = -60): Vec[] {
  const r = rng(seed);
  const pts: Vec[] = [{ x: cx - halfW - 2.5, y: bottom }];
  for (let y = bottom + 3; y < top - 1; y += 2 + r() * 2) pts.push({ x: cx - halfW - r() * 1.2 - (top - y) * 0.04, y });
  pts.push({ x: cx - halfW, y: top }, { x: cx + halfW, y: top });
  const right: Vec[] = [];
  for (let y = bottom + 3; y < top - 1; y += 2 + r() * 2) right.push({ x: cx + halfW + r() * 1.2 + (top - y) * 0.04, y });
  pts.push(...right.reverse(), { x: cx + halfW + 2.5, y: bottom });
  return pts;
}

const ALL: MaterialId[] = ['deck', 'timber', 'steel', 'cable'];

interface Opts {
  id: string; name: string; code: string; client: string; brief: string; lesson: string; hint: string;
  gap: number; leftY?: number; rightY?: number; waterY?: number; bottom?: number;
  budget: number; materials?: MaterialId[];
  extraAnchors?: Anchor[]; extraTerrain?: Vec[][];
  vehicles: VehicleSpec[]; seed: number;
  maxY?: number; minY?: number;
  deflection?: number; gradient?: number;
  noBuild?: Zone[]; boats?: boolean; highwayY?: number; trees?: number; houses?: boolean;
  lossY?: number; playground?: boolean;
}

function site(o: Opts): Level {
  const leftY = o.leftY ?? 0;
  const rightY = o.rightY ?? 0;
  const waterY = o.waterY ?? -6;
  const bottom = o.bottom ?? -60;
  return {
    id: o.id, name: o.name, code: o.code, client: o.client, brief: o.brief, lesson: o.lesson, hint: o.hint,
    budget: o.budget,
    span: o.gap,
    materials: o.materials ?? ALL,
    terrain: [leftBank(0, leftY, o.seed, bottom), rightBank(o.gap, rightY, o.seed + 7, bottom), ...(o.extraTerrain ?? [])],
    anchors: [{ x: 0, y: leftY }, { x: o.gap, y: rightY }, ...(o.extraAnchors ?? [])],
    waterY,
    lossY: o.lossY ?? Math.min(leftY, rightY) - 3.5,
    spawnL: { x: -16, y: leftY },
    spawnR: { x: o.gap + 16, y: rightY },
    vehicles: o.vehicles,
    deflectionLimit: o.deflection ?? 800,
    maxGradient: o.gradient ?? 0.1,
    noBuild: o.noBuild ?? [],
    boats: o.boats ?? false,
    highwayY: o.highwayY ?? null,
    scenery: { trees: o.trees ?? 6, houses: o.houses ?? false, seed: o.seed },
    bounds: { minX: -6, maxX: o.gap + 6, minY: o.minY ?? waterY + 0.5, maxY: o.maxY ?? Math.max(leftY, rightY) + 12 },
    playground: o.playground,
  };
}

export const LEVELS: Level[] = [
  site({
    id: 'l1', code: 'BR-101', name: 'Farm Track',
    client: 'Hollins Farm',
    brief: 'A farmer needs to get a pickup and the family car over a 10 m creek. Keep it simple and cheap.',
    lesson: 'A pin-jointed square folds; a triangle cannot change shape without changing a member length. Every stable truss is built from triangles.',
    hint: 'Lay deck panels between the two anchors, then add a row of timber triangles underneath or above.',
    gap: 10, budget: 9500, seed: 11, trees: 9, deflection: 500,
    vehicles: [{ kind: 'pickup', delay: 0 }, { kind: 'car', delay: 3 }],
  }),
  site({
    id: 'l2', code: 'BR-102', name: 'Village Creek',
    client: 'Ashby Parish Council',
    brief: 'Replace the old ford with a 14 m crossing for village traffic. Delivery vans must get through in both directions.',
    lesson: 'Supports below the deck turn a long span into shorter ones. Diagonals carry shear; chords carry bending as tension and compression.',
    hint: 'Use the low anchors on the cliff faces to prop the deck from below — a "kingpost" or "queenpost" layout.',
    gap: 14, budget: 13500, seed: 23, trees: 10, houses: true,
    extraAnchors: [{ x: -0.6, y: -3.5 }, { x: 14.6, y: -3.5 }],
    vehicles: [{ kind: 'van', delay: 0 }, { kind: 'car', delay: 0.5, dir: -1 }, { kind: 'car', delay: 4 }],
  }),
  site({
    id: 'l3', code: 'BR-203', name: 'Quarry Road',
    client: 'Redstone Aggregates Ltd',
    brief: 'Loaded 26 t tipper trucks cross a 16 m gully all day. Slender members will fail by buckling long before they yield.',
    lesson: 'Compression capacity drops with length squared (Euler: Ncr = π²EI/L²). Keep compression members short or stocky; long members are fine in tension.',
    hint: 'Watch the slenderness ratio L/r in the inspector. Put heavy sections in compression, light ones in tension.',
    gap: 16, budget: 19000, seed: 31, trees: 4,
    vehicles: [{ kind: 'hgv', delay: 0 }],
  }),
  site({
    id: 'l4', code: 'BR-204', name: 'Navigation Channel',
    client: 'River Authority',
    brief: 'Barges use this river. A 5 m navigation envelope below the road must stay completely clear, so nothing can hang below the deck in the channel.',
    lesson: 'When clearance is restricted, the structure goes above the road — a through truss. Top chords are in compression; bottom chords (the deck) in tension.',
    hint: 'Build a Pratt or Warren truss above the deck. The hatched zone is off-limits for joints and members.',
    gap: 24, budget: 28000, seed: 43, trees: 7, boats: true, waterY: -6, maxY: 14,
    noBuild: [{ x0: 2.5, y0: -6, x1: 21.5, y1: -0.6, label: 'Navigation clearance 5.0 m' }],
    vehicles: [{ kind: 'van', delay: 0 }, { kind: 'bus', delay: 2 }, { kind: 'car', delay: 3, dir: -1 }],
  }),
  site({
    id: 'l5', code: 'BR-205', name: 'Split Level',
    client: 'Kestrel County Highways',
    brief: 'The banks sit at different levels. Buses can manage a gradient of up to 8% — no steeper on any deck panel.',
    lesson: 'Geometry is a design constraint too. Deck gradient affects drivability, and a sagging deck increases local slopes under load.',
    hint: 'Keep the deck straight between the anchors. Stiffen it enough that it does not sag into a steep dip.',
    gap: 18, leftY: 1.2, rightY: 0, waterY: -7, budget: 19500, seed: 47, trees: 8, gradient: 0.08,
    extraAnchors: [{ x: -0.7, y: -2.5 }, { x: 18.6, y: -4 }],
    vehicles: [{ kind: 'bus', delay: 0 }, { kind: 'car', delay: 1, dir: -1 }, { kind: 'pickup', delay: 4 }],
  }),
  site({
    id: 'l6', code: 'BR-306', name: 'Island Pier',
    client: 'Harbour Trust',
    brief: 'A rock outcrop sits mid-river. Use it as an intermediate support to cross 32 m with a two-span bridge.',
    lesson: 'Continuous spans over an intermediate support reverse the bending: near the pier the top chord goes into tension and the bottom into compression.',
    hint: 'Anchor to the pier and check the force signs near it in Analysis mode — they flip.',
    gap: 32, budget: 38000, seed: 59, trees: 6, boats: true,
    extraTerrain: [pillar(16, -1.5, 1.4, 5)],
    extraAnchors: [{ x: 15, y: -1.5 }, { x: 17, y: -1.5 }],
    vehicles: [{ kind: 'bus', delay: 0 }, { kind: 'van', delay: 2, dir: -1 }, { kind: 'hgv', delay: 4 }],
  }),
  site({
    id: 'l7', code: 'BR-407', name: 'Suspension Gorge',
    client: 'National Parks Service',
    brief: 'A 44 m gorge with towers already built on each rim. Hang a deck from cables — they are strong, light and only pull.',
    lesson: 'In a suspension or cable-stayed bridge the deck is hung from tension members; the towers take the compression and backstays balance the pull.',
    hint: 'Run stays from the tower tops to deck joints. Tie the towers back to the rear anchors so they do not topple inward.',
    gap: 44, budget: 60000, seed: 71, trees: 12, deflection: 500, maxY: 18, waterY: -9,
    extraAnchors: [
      { x: -1.5, y: 14, pylonTo: 0 }, { x: 45.5, y: 14, pylonTo: 0 },
      { x: -11, y: 0 }, { x: 55, y: 0 },
    ],
    vehicles: [{ kind: 'car', delay: 0 }, { kind: 'van', delay: 2, dir: -1 }, { kind: 'bus', delay: 4 }],
  }),
  site({
    id: 'l8', code: 'BR-408', name: 'Canyon Arch',
    client: 'Mineral Rail & Road',
    brief: 'A deep 30 m canyon with solid rock walls. Anchors down the walls invite an arch — but the client wants the cheapest safe option, whatever its form.',
    lesson: 'An arch turns vertical load into compression that thrusts outward into the rock. Under a single moving truck, though, a pin-jointed arch tries to fold — so it needs diagonal bracing to the deck, and that bracing costs money. Weigh an arch against a truss.',
    hint: 'Try both: a braced arch from the wall anchors, and a truss over the deck. Compare their cost and utilisation in the checks panel.',
    gap: 30, waterY: -22, budget: 38500, seed: 83, trees: 5, minY: -21,
    extraAnchors: [{ x: -2, y: -12 }, { x: 32, y: -12 }, { x: -1, y: -6 }, { x: 31, y: -6 }],
    vehicles: [{ kind: 'hgv', delay: 0 }, { kind: 'car', delay: 3, dir: -1 }],
  }),
  site({
    id: 'l9', code: 'BR-509', name: 'Highway Overpass',
    client: 'State DOT',
    brief: 'Carry a side road over a live highway. Highway traffic needs 5.2 m headroom on both carriageways; the central median can take a pier. Design for the HL-93 truck.',
    lesson: 'Real bridges are designed for code load models (here HL-93) with load factors: Strength = 1.35·Dead + 1.5·Live. Passing the test is not the same as passing the code.',
    hint: 'Use the median pier. Run Analysis and get every utilisation below 100% for the code star.',
    gap: 30, waterY: -40, bottom: -9, budget: 50000, seed: 97, trees: 4, houses: true, highwayY: -8, minY: -8, lossY: -5,
    extraTerrain: [[{ x: -10, y: -60 }, { x: -10, y: -8 }, { x: 40, y: -8 }, { x: 40, y: -60 }]],
    extraAnchors: [{ x: 15, y: -2.5, pylonTo: -8 }],
    noBuild: [
      { x0: 2, y0: -8, x1: 14, y1: -2.8, label: 'Headroom 5.2 m' },
      { x0: 16, y0: -8, x1: 28, y1: -2.8, label: 'Headroom 5.2 m' },
    ],
    vehicles: [{ kind: 'design', delay: 0 }, { kind: 'car', delay: 2, dir: -1 }, { kind: 'van', delay: 5 }],
  }),
];

export const PLAYGROUND: Level = site({
  id: 'playground', code: 'LAB', name: 'Playground',
  client: 'You',
  brief: 'Unlimited budget, a 48 m river with a mid-river pier, towers and anchors everywhere. Build anything, then spawn traffic, drive vehicles yourself, drop loads and shake the ground.',
  lesson: 'Experiment freely: compare materials, try the same layout with different sections, and see how the analysis predicts what the test shows.',
  hint: 'Build, then press Test. Use the Playground panel to spawn vehicles and loads while the simulation runs.',
  gap: 48, budget: 10_000_000, seed: 101, trees: 10, maxY: 20, boats: true, playground: true,
  extraTerrain: [pillar(24, -2, 1.5, 9)],
  extraAnchors: [
    { x: -0.8, y: -4 }, { x: 48.8, y: -4 },
    { x: 23, y: -2 }, { x: 25, y: -2 },
    { x: -2, y: 16, pylonTo: 0 }, { x: 50, y: 16, pylonTo: 0 },
    { x: 24, y: 16, pylonTo: -2 },
    { x: -12, y: 0 }, { x: 60, y: 0 },
  ],
  vehicles: [],
});

export const ALL_LEVELS = [...LEVELS, PLAYGROUND];
