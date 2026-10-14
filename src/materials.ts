/**
 * Engineering materials and standard cross-sections.
 * Properties are typical published values (EN 10219 SHS, GL24h glulam, spiral strand).
 * The 2D model represents ONE main truss plane that carries the full lane load.
 */

export type MaterialId = 'deck' | 'timber' | 'steel' | 'cable';

export interface Section {
  name: string;
  /** cross-section area m² */
  A: number;
  /** second moment of area m⁴ (in-plane buckling) */
  I: number;
  /** self weight kg/m (deck sections include slab + surfacing) */
  massPerM: number;
  /** installed cost $/m */
  costPerM: number;
  /** overrides of the family's mechanical properties */
  E?: number;
  ft?: number;
  fc?: number;
}

export interface Material {
  id: MaterialId;
  name: string;
  grade: string;
  hotkey: string;
  /** Young's modulus Pa */
  E: number;
  /** characteristic tensile strength Pa */
  ft: number;
  /** characteristic compressive strength Pa (0 = tension-only) */
  fc: number;
  /** partial material factor for design checks */
  gammaM: number;
  maxLength: number;
  road: boolean;
  color: string;
  edge: string;
  sections: Section[];
  defaultSection: number;
  blurb: string;
}

export const JOINT_COST = 150;
/** connection hardware mass per joint, kg */
export const JOINT_MASS = 25;

const steelSec = (name: string, A: number, I: number, kgm: number): Section => ({ name, A, I, massPerM: kgm, costPerM: Math.round(kgm * 5) });
const timberSec = (b: number): Section => {
  const s = b / 1000;
  return { name: `${b}×${b}`, A: s * s, I: (s ** 4) / 12, massPerM: +(s * s * 420).toFixed(1), costPerM: Math.round(s * s * 1600) };
};
const cableSec = (d: number, A: number, kgm: number): Section => ({ name: `Ø${d}`, A, I: 0, massPerM: kgm, costPerM: Math.round(kgm * 15) });

export const MATERIALS: Record<MaterialId, Material> = {
  deck: {
    id: 'deck',
    name: 'Road deck',
    grade: 'Deck panel',
    hotkey: '1',
    E: 210e9,
    ft: 355e6,
    fc: 355e6,
    gammaM: 1.0,
    maxLength: 3,
    road: true,
    color: '#3b3f47',
    edge: '#1d2026',
    defaultSection: 0,
    sections: [
      { name: 'Timber plank', A: 0.05, I: 2.0e-4, massPerM: 220, costPerM: 600, E: 11.5e9, ft: 19.2e6, fc: 24e6 },
      { name: 'Steel orthotropic', A: 0.008, I: 1.2e-4, massPerM: 380, costPerM: 1400 },
      { name: 'Concrete composite', A: 0.018, I: 6.0e-4, massPerM: 950, costPerM: 1900 },
    ],
    blurb: 'The driving surface. Carries axle loads into the joints and acts as a chord.',
  },
  timber: {
    id: 'timber',
    name: 'Timber',
    grade: 'Glulam GL24h',
    hotkey: '2',
    E: 11.5e9,
    ft: 19.2e6,
    fc: 24e6,
    gammaM: 1.25,
    maxLength: 4,
    road: false,
    color: '#b5793f',
    edge: '#6e4520',
    defaultSection: 1,
    sections: [timberSec(100), timberSec(160), timberSec(220), timberSec(300)],
    blurb: 'Light and cheap. Low stiffness makes long compression members buckle.',
  },
  steel: {
    id: 'steel',
    name: 'Steel',
    grade: 'S355 hollow section',
    hotkey: '3',
    E: 210e9,
    ft: 355e6,
    fc: 355e6,
    gammaM: 1.0,
    maxLength: 6,
    road: false,
    color: '#d0532f',
    edge: '#7a2a14',
    defaultSection: 1,
    sections: [
      steelSec('SHS 60×4', 8.55e-4, 4.36e-7, 6.71),
      steelSec('SHS 100×5', 1.87e-3, 2.83e-6, 14.7),
      steelSec('SHS 150×8', 4.48e-3, 1.491e-5, 35.1),
      steelSec('SHS 200×10', 7.49e-3, 4.471e-5, 58.8),
      steelSec('SHS 300×12.5', 1.41e-2, 1.926e-4, 111),
    ],
    blurb: 'Strong and stiff. Slender members still buckle — check L/r.',
  },
  cable: {
    id: 'cable',
    name: 'Cable',
    grade: 'Spiral strand 1570',
    hotkey: '4',
    E: 160e9,
    ft: 1570e6,
    fc: 0,
    gammaM: 1.5,
    maxLength: 24,
    road: false,
    color: '#2a2d33',
    edge: '#000000',
    defaultSection: 1,
    sections: [cableSec(16, 1.53e-4, 1.3), cableSec(26, 4.03e-4, 3.4), cableSec(40, 9.5e-4, 8.0), cableSec(60, 2.15e-3, 18)],
    blurb: 'Very strong in tension, zero in compression — it simply goes slack.',
  },
};

export const MATERIAL_ORDER: MaterialId[] = ['deck', 'timber', 'steel', 'cable'];

export function sectionOf(mat: MaterialId, sec: number): Section {
  const m = MATERIALS[mat];
  return m.sections[Math.max(0, Math.min(m.sections.length - 1, sec))];
}

export interface Props { E: number; ft: number; fc: number; A: number; I: number; massPerM: number; costPerM: number }
export function propsOf(mat: MaterialId, sec: number): Props {
  const m = MATERIALS[mat];
  const s = sectionOf(mat, sec);
  return { E: s.E ?? m.E, ft: s.ft ?? m.ft, fc: s.fc ?? m.fc, A: s.A, I: s.I, massPerM: s.massPerM, costPerM: s.costPerM };
}

export interface Capacity {
  /** characteristic tension resistance N */
  Nt: number;
  /** characteristic compression resistance incl. buckling N (Rankine–Gordon) */
  Nc: number;
  /** squash load N */
  Npl: number;
  /** Euler critical load N */
  Ncr: number;
  /** slenderness L / r */
  slenderness: number;
  /** compression is governed by buckling */
  buckling: boolean;
}

export function capacity(mat: MaterialId, sec: number, L: number): Capacity {
  const p = propsOf(mat, sec);
  const Nt = p.ft * p.A;
  if (p.fc === 0) return { Nt, Nc: 0, Npl: 0, Ncr: 0, slenderness: Infinity, buckling: false };
  const Npl = p.fc * p.A;
  const Ncr = (Math.PI ** 2 * p.E * p.I) / (L * L);
  const Nc = (Npl * Ncr) / (Npl + Ncr);
  const r = Math.sqrt(p.I / p.A);
  return { Nt, Nc, Npl, Ncr, slenderness: L / r, buckling: Ncr < Npl * 2 };
}

/** member draw thickness in metres (scaled by section size) */
export function drawWidth(mat: MaterialId, sec: number) {
  const s = sectionOf(mat, sec);
  if (mat === 'deck') return 0.34 + sec * 0.06;
  if (mat === 'cable') return 0.05 + Math.sqrt(s.A) * 1.2;
  return Math.max(0.1, Math.sqrt(s.A) * 1.15);
}

export const kN = (n: number) => n / 1000;
