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
  /** tower finish: plain concrete (default), Golden Gate orange or Tower Bridge stone */
  pylon?: 'orange' | 'stone';
}

/** the real bridge a Landmark project is modelled on */
export interface Landmark { real: string; facts: string[]; scale: string }

/** a scripted earthquake during the load test, and the matching static seismic design case */
export interface Seismic {
  /** design ground acceleration as a fraction of g (equivalent lateral force) */
  ag: number;
  /** test: start time (s), duration (s), peak ground displacement (m), frequency (Hz) */
  at: number; dur: number; amp: number; freq: number;
}

export type Tier = 'Foundation' | 'Professional' | 'Expert' | 'Landmarks';

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
  seismic?: Seismic;
  tier: Tier;
  landmark?: Landmark;
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
  lossY?: number; playground?: boolean; seismic?: Seismic; tier?: Tier; landmark?: Landmark;
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
    seismic: o.seismic,
    tier: o.tier ?? 'Foundation',
    landmark: o.landmark,
  };
}

export const LEVELS: Level[] = [
  site({
    id: 'l0', code: 'BR-100', name: 'Starter Bridge',
    client: 'Span Academy',
    brief: 'Your first job: carry one small car over an 8 m stream. This starter project comes with a worked, perfect three-star solution in the brief — load it, study why it works, then delete it and build your own.',
    lesson: 'Every bridge does one job: move the weight of traffic sideways to the banks. A row of triangles alongside the deck — above or below it — turns that weight into simple pulls and pushes in each bar.',
    hint: 'Deck panels from anchor to anchor, then a row of light timber triangles above (or below) the deck, joined along their tips. Keep it small — this bridge only carries a car.',
    gap: 8, budget: 7500, seed: 7, trees: 8, deflection: 500,
    vehicles: [{ kind: 'car', delay: 0 }],
  }),
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
    tier: 'Professional',
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
    tier: 'Professional',
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
    tier: 'Professional',
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
    tier: 'Professional',
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
    tier: 'Professional',
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
    tier: 'Professional',
    vehicles: [{ kind: 'design', delay: 0 }, { kind: 'car', delay: 2, dir: -1 }, { kind: 'van', delay: 5 }],
  }),
  // ---------------- Expert ----------------
  site({
    id: 'l10', code: 'BR-610', name: 'Timber Trail', tier: 'Expert',
    client: 'Forestry Commission',
    brief: 'A 22 m crossing on a forest haul road — and the client wants it built from local timber. No steel and no cables: only timber members and a road deck. A bus and service vehicles use it.',
    lesson: 'Timber is about 18× less stiff than steel, so deflection, not strength, usually governs. Depth is the cheapest stiffness you can buy: doubling the depth roughly halves the chord forces and quarters the sag.',
    hint: 'Go deep. A truss about span ÷ 6 deep, with stocky sections on the compression chord and short panels so struts do not buckle.',
    gap: 22, budget: 26500, seed: 113, trees: 16, deflection: 600, materials: ['deck', 'timber'], maxY: 14,
    extraAnchors: [{ x: -0.7, y: -4 }, { x: 22.7, y: -4 }],
    vehicles: [{ kind: 'bus', delay: 0 }, { kind: 'van', delay: 1, dir: -1 }, { kind: 'pickup', delay: 4 }],
  }),
  site({
    id: 'l11', code: 'BR-611', name: 'Heavy Haul', tier: 'Expert',
    client: 'GridLink Energy',
    brief: 'A 72 t transformer must reach the new substation on a seven-axle heavy-haul transporter. It crawls across a 24 m ravine, followed by an escort car. Everything else about this bridge is ordinary — the load is not.',
    lesson: 'A heavy load spread over many axles is kinder than the same weight on a few, but the total still has to reach the banks. Moving loads make every member see its worst case somewhere along the crossing — check the envelope, not one position.',
    hint: 'Steel chords, a deep truss and short panels. The utilisation view shows the worst case over every position of the transporter.',
    gap: 24, budget: 40000, seed: 127, trees: 6, maxY: 14, waterY: -8,
    extraAnchors: [{ x: -0.8, y: -4.5 }, { x: 24.8, y: -4.5 }],
    vehicles: [{ kind: 'haul', delay: 0 }, { kind: 'car', delay: 4 }],
  }),
  site({
    id: 'l12', code: 'BR-712', name: 'Seismic Valley', tier: 'Expert',
    client: 'Andean Roads Authority',
    brief: 'A 36 m valley on an active fault, with a rock spur rising 10 m below road level in the middle. During the load test an earthquake will shake the ground while traffic is on the bridge. The code also asks for a sideways seismic force on the bridge\'s own weight.',
    lesson: 'Earthquakes push sideways. Mass high up on a slender support swings like a pendulum, so tall props must be braced into triangles, and lighter bridges attract smaller seismic forces (F = m·a).',
    hint: 'Either span the whole valley with a deep truss, or build a braced tower on the spur — two legs tied with diagonals in every panel — and span to it from each bank.',
    gap: 36, waterY: -18, minY: -17, budget: 44500, seed: 139, trees: 8, maxY: 14,
    extraTerrain: [pillar(18, -10, 1.6, 13)],
    extraAnchors: [{ x: 17, y: -10 }, { x: 19, y: -10 }, { x: -1, y: -5 }, { x: 37, y: -5 }],
    seismic: { ag: 0.35, at: 3, dur: 11, amp: 0.065, freq: 1.5 },
    vehicles: [{ kind: 'bus', delay: 0 }, { kind: 'van', delay: 1, dir: -1 }, { kind: 'pickup', delay: 3 }],
  }),
  site({
    id: 'l13', code: 'BR-713', name: 'Twin Pier Viaduct', tier: 'Expert',
    client: 'Northern Freight Corridor',
    brief: 'A 54 m river crossing with two rock piers. Quarry trucks run in a convoy, nose to tail, with a bus coming the other way. Three spans, continuous loading — and a budget that does not forgive waste.',
    lesson: 'With several spans, a load on one span lifts the next. Members near the piers see force reversals, so a member that is a tie in one load position can be a strut in another. Design for both.',
    hint: 'Support the deck on both piers. Check every member in the Utilisation view: anything that switches between tension and compression needs to work as a strut too.',
    gap: 54, budget: 67500, seed: 149, trees: 8, boats: true, maxY: 14,
    extraTerrain: [pillar(18, -1.5, 1.4, 17), pillar(36, -1.5, 1.4, 19)],
    extraAnchors: [{ x: 17, y: -1.5 }, { x: 19, y: -1.5 }, { x: 35, y: -1.5 }, { x: 37, y: -1.5 }],
    vehicles: [{ kind: 'hgv', delay: 0 }, { kind: 'hgv', delay: 1.5 }, { kind: 'bus', delay: 2, dir: -1 }, { kind: 'car', delay: 5 }],
  }),
  site({
    id: 'l14', code: 'BR-814', name: 'Harbour Cable-Stay', tier: 'Expert',
    client: 'Port of Kingsmouth',
    brief: 'A 44 m harbour mouth with ships on both sides of a central pier. The navigation channels below the road must stay clear, so the deck has to be held from above. A 14 m tower stands ready on the pier.',
    lesson: 'A cable-stayed bridge hangs its deck straight from the tower with straight cables. The stays pull the deck toward the tower, so the deck works as a long strut: near the tower it carries the horizontal pull of every stay at once.',
    hint: 'Run stays from the tower top to deck joints on both sides, keeping them balanced. Cables can be at most 24 m long, so the far ends may need help from the deck itself.',
    gap: 44, budget: 57000, seed: 157, trees: 6, boats: true, maxY: 18, waterY: -7, deflection: 500,
    extraTerrain: [pillar(22, -1.5, 1.4, 23)],
    extraAnchors: [{ x: 21, y: -1.5 }, { x: 23, y: -1.5 }, { x: 22, y: 14, pylonTo: -1.5 }],
    noBuild: [
      { x0: 2.5, y0: -7, x1: 19.8, y1: -0.6, label: 'Shipping channel' },
      { x0: 24.2, y0: -7, x1: 41.5, y1: -0.6, label: 'Shipping channel' },
    ],
    vehicles: [{ kind: 'bus', delay: 0 }, { kind: 'van', delay: 1, dir: -1 }, { kind: 'hgv', delay: 4 }],
  }),
  site({
    id: 'l15', code: 'BR-915', name: 'Estuary Crossing', tier: 'Expert',
    client: 'Estuary Link Consortium',
    brief: 'The final commission: a 64 m estuary on a seismic coast. Two 14 m towers stand on piers 32 m apart with a shipping channel between them. Heavy trucks and buses cross while the ground shakes.',
    lesson: 'Long-span bridges combine everything: cables for reach, trusses for stiffness, towers for height — and every kilogram you add also adds seismic force.',
    hint: 'Stay the main span from both towers, support the side spans from the piers and banks, and stiffen the deck where cables cannot reach. Watch the seismic check as you add weight.',
    gap: 64, budget: 85000, seed: 163, trees: 10, boats: true, maxY: 18, waterY: -8, deflection: 500,
    extraTerrain: [pillar(16, -1.5, 1.4, 29), pillar(48, -1.5, 1.4, 31)],
    extraAnchors: [
      { x: 15, y: -1.5 }, { x: 17, y: -1.5 }, { x: 47, y: -1.5 }, { x: 49, y: -1.5 },
      { x: 16, y: 14, pylonTo: -1.5 }, { x: 48, y: 14, pylonTo: -1.5 },
    ],
    noBuild: [{ x0: 18.2, y0: -8, x1: 45.8, y1: -0.6, label: 'Shipping channel' }],
    seismic: { ag: 0.2, at: 5, dur: 8, amp: 0.04, freq: 1.4 },
    vehicles: [{ kind: 'hgv', delay: 0 }, { kind: 'bus', delay: 1, dir: -1 }, { kind: 'hgv', delay: 4 }, { kind: 'van', delay: 5, dir: -1 }],
  }),
  // ---------------- Landmarks (real bridges, scaled to fit) ----------------
  site({
    id: 'lm1', code: 'CH-467', name: 'Chenab Arch', tier: 'Landmarks',
    client: 'Northern Railway (USBRL project)',
    brief: 'Carry a railway across a deep Himalayan gorge in the highest seismic zone. It is a single-track line: one train crosses each way, and an earthquake will strike while the first one is on the bridge. The walls of the gorge are solid rock: spring an arch from them, or prove a truss is better.',
    lesson: 'An arch carries load in compression and pushes its thrust into the rock at each end — ideal across a deep gorge where piers would be impossibly tall. The deck sits on posts (spandrel columns) standing on the arch, and diagonal bracing stops the arch from folding when a heavy train is on one half.',
    hint: 'Spring an arch from the low wall anchors, rising to just below the deck at mid-span. Stand posts on it every few metres, add diagonals between posts and deck, and keep the arch members stocky — they are long struts.',
    gap: 60, waterY: -30, minY: -28, maxY: 8, budget: 168500, seed: 211, trees: 10,
    extraAnchors: [{ x: -1.5, y: -16 }, { x: 61.5, y: -16 }, { x: -1, y: -8 }, { x: 61, y: -8 }],
    seismic: { ag: 0.36, at: 4, dur: 10, amp: 0.02, freq: 1.4 },
    vehicles: [{ kind: 'train', delay: 0 }, { kind: 'train', delay: 13, dir: -1 }],
    landmark: {
      real: 'Chenab Bridge, Jammu & Kashmir, India — opened 2025',
      facts: [
        'The world\'s highest railway bridge: the track is 359 m above the Chenab river, higher than the Eiffel Tower.',
        'A 467 m steel arch spans the gorge; the whole bridge is 1,315 m long.',
        'Designed for winds of up to 260 km/h and for India\'s highest seismic zone (Zone V, design acceleration 0.36 g).',
      ],
      scale: 'About 1:8 — the 467 m arch becomes a 60 m gap.',
    },
  }),
  site({
    id: 'lm2', code: 'TB-1894', name: 'Tower Bridge', tier: 'Landmarks',
    client: 'City of London Bridge House Estates',
    brief: 'Two stone towers stand on river piers. Ships need the channel between them kept clear, and London\'s double-decker buses must cross. In this version the central span is fixed rather than lifting, so nothing may sit below it.',
    lesson: 'Tower Bridge mixes two systems: the side spans hang from suspension chains, while the central span is a bascule (a counterweighted lifting leaf). The high-level walkways are not just for people — they tie the towers together against the pull of the chains.',
    hint: 'Hang the deck from the tower tops with cables, or prop it from the piers and span between them with trusses above the road. The hatched channel under the central span must stay empty.',
    gap: 56, waterY: -7, maxY: 18, budget: 67000, seed: 223, trees: 6, houses: true, boats: true,
    extraTerrain: [pillar(18, -1.5, 1.8, 41), pillar(38, -1.5, 1.8, 43)],
    extraAnchors: [
      { x: 17, y: -1.5 }, { x: 19, y: -1.5 }, { x: 37, y: -1.5 }, { x: 39, y: -1.5 },
      { x: 18, y: 14, pylonTo: -1.5, pylon: 'stone' }, { x: 38, y: 14, pylonTo: -1.5, pylon: 'stone' },
    ],
    noBuild: [{ x0: 20.2, y0: -7, x1: 35.8, y1: -0.6, label: 'Pool of London channel' }],
    vehicles: [{ kind: 'dd', delay: 0 }, { kind: 'car', delay: 1, dir: -1 }, { kind: 'dd', delay: 3, dir: -1 }, { kind: 'van', delay: 4 }],
    landmark: {
      real: 'Tower Bridge, London, England — opened 1894',
      facts: [
        'A combined bascule and suspension bridge, 244 m long, designed by Horace Jones with engineer John Wolfe Barry.',
        'The 61 m central span is two bascules that lift to let ships into the Pool of London.',
        'The side spans hang from chains anchored at the shore and pulled tight over the 65 m towers.',
      ],
      scale: 'About 1:4 — the 244 m bridge becomes 56 m.',
    },
  }),
  site({
    id: 'lm3', code: 'HG-1917', name: 'Hell Gate Arch', tier: 'Landmarks',
    client: 'New York Connecting Railroad',
    brief: 'Carry a busy railway over the East River in New York. The whole river must stay open to shipping, so nothing can go below the track — the structure has to rise above it. Two heavy trains cross, one in each direction, one after the other.',
    lesson: 'In a through arch the arch rises above the deck and the deck hangs from it. The deck doubles as a tie: it pulls the two arch feet together, so the arch\'s outward thrust never reaches the banks. Stiffening diagonals between arch and deck stop it buckling under one-sided loads.',
    hint: 'Build an arched top chord above the track — highest at mid-span — with posts and diagonals down to the deck. Make the arch members stocky: they carry the most compression.',
    gap: 60, waterY: -8, maxY: 18, budget: 138500, seed: 233, trees: 6, houses: true, boats: true,
    noBuild: [{ x0: 3, y0: -8, x1: 57, y1: -0.6, label: 'East River navigation' }],
    vehicles: [{ kind: 'train', delay: 0 }, { kind: 'train', delay: 13, dir: -1 }],
    landmark: {
      real: 'Hell Gate Bridge, New York City — opened 1917',
      facts: [
        'A 298 m steel through-arch carrying trains over the East River between Queens and Wards Island.',
        'Designed by Gustav Lindenthal, it was the longest steel arch in the world until 1931.',
        'Painted "Hell Gate Red", it is New York\'s red bridge — and it inspired the Sydney Harbour Bridge.',
      ],
      scale: 'About 1:5 — the 298 m arch becomes 60 m.',
    },
  }),
  site({
    id: 'lm4', code: 'GG-1937', name: 'Golden Gate', tier: 'Landmarks',
    client: 'Golden Gate Bridge District',
    brief: 'The grand finale. Two orange towers rise from piers at the mouth of the bay, and the shipping channel between them must stay clear. Hang an 80 m crossing from cables while trucks, buses and cars cross — on a coast where the San Andreas fault can shake it at any moment.',
    lesson: 'A suspension bridge drapes a main cable over its towers; vertical hangers carry the deck to it. The cable takes a curved shape that keeps it in pure tension. On its own a hanging deck is floppy, so real bridges add a stiffening truss under the road.',
    hint: 'Run a main cable from tower top to tower top, sagging to a few metres above the road at mid-span, with a hanger at every deck joint. Support the side spans from the piers and banks, and stiffen the deck where it bounces.',
    gap: 80, waterY: -9, maxY: 24, budget: 166500, seed: 241, trees: 10, houses: true, boats: true, deflection: 500,
    extraTerrain: [pillar(14, -1.5, 1.6, 47), pillar(66, -1.5, 1.6, 53)],
    extraAnchors: [
      { x: 13, y: -1.5 }, { x: 15, y: -1.5 }, { x: 65, y: -1.5 }, { x: 67, y: -1.5 },
      { x: 14, y: 20, pylonTo: -1.5, pylon: 'orange' }, { x: 66, y: 20, pylonTo: -1.5, pylon: 'orange' },
    ],
    noBuild: [{ x0: 16.5, y0: -9, x1: 63.5, y1: -0.6, label: 'Golden Gate channel' }],
    seismic: { ag: 0.3, at: 6, dur: 9, amp: 0.04, freq: 1.3 },
    vehicles: [{ kind: 'car', delay: 0 }, { kind: 'bus', delay: 0.5, dir: -1 }, { kind: 'hgv', delay: 2 }, { kind: 'van', delay: 4, dir: -1 }, { kind: 'car', delay: 5 }],
    landmark: {
      real: 'Golden Gate Bridge, San Francisco — opened 1937',
      facts: [
        'Its 1,280 m main span was the longest suspension span in the world until 1964.',
        'The towers rise 227 m above the water, painted "International Orange" to stand out in the fog.',
        'It sits close to the San Andreas fault and has been seismically retrofitted since the 1989 Loma Prieta earthquake.',
      ],
      scale: 'About 1:25 — the 1,280 m main span becomes 52 m between towers.',
    },
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
