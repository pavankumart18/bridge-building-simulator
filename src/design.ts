import { JOINT_COST, MATERIALS, propsOf, type MaterialId } from './materials';
import type { Level, Vec, Zone } from './levels';

export interface DNode { id: number; x: number; y: number; anchor: boolean }
export interface DBeam { id: number; a: number; b: number; mat: MaterialId; sec: number }

export interface DesignData { nodes: DNode[]; beams: DBeam[] }

export function pointInPoly(p: Vec, poly: Vec[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function inZone(p: Vec, z: Zone) {
  return p.x > z.x0 + 1e-6 && p.x < z.x1 - 1e-6 && p.y > z.y0 + 1e-6 && p.y < z.y1 - 1e-6;
}

/** segment vs axis-aligned box (Liang–Barsky) */
function segHitsZone(a: Vec, b: Vec, z: Zone) {
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  const e = 1e-6;
  const clip = (p: number, q: number) => {
    if (Math.abs(p) < 1e-12) return q > 0;
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else { if (r < t0) return false; if (r < t1) t1 = r; }
    return true;
  };
  if (!clip(-dx, a.x - (z.x0 + e))) return false;
  if (!clip(dx, z.x1 - e - a.x)) return false;
  if (!clip(-dy, a.y - (z.y0 + e))) return false;
  if (!clip(dy, z.y1 - e - a.y)) return false;
  return t1 - t0 > 1e-6;
}

export class Design {
  nodes: DNode[] = [];
  beams: DBeam[] = [];
  private nextId = 1;
  private undoStack: string[] = [];
  private redoStack: string[] = [];

  constructor(public level: Level) {
    this.reset();
  }

  reset() {
    this.nodes = this.level.anchors.map((a, i) => ({ id: -(i + 1), x: a.x, y: a.y, anchor: true }));
    this.beams = [];
    this.nextId = 1;
  }

  node(id: number) {
    return this.nodes.find((n) => n.id === id);
  }

  beamLength(b: DBeam) {
    const a = this.node(b.a)!;
    const c = this.node(b.b)!;
    return Math.hypot(c.x - a.x, c.y - a.y);
  }

  beamCost(b: DBeam) {
    return this.beamLength(b) * propsOf(b.mat, b.sec).costPerM;
  }

  cost() {
    let c = 0;
    for (const b of this.beams) c += this.beamCost(b);
    for (const n of this.nodes) if (!n.anchor) c += JOINT_COST;
    return Math.round(c);
  }

  steelTonnes() {
    let kg = 0;
    for (const b of this.beams) kg += this.beamLength(b) * propsOf(b.mat, b.sec).massPerM;
    return kg / 1000;
  }

  // ---------- site constraints ----------
  placeable(p: Vec) {
    const b = this.level.bounds;
    if (p.x < b.minX - 1e-6 || p.x > b.maxX + 1e-6 || p.y < b.minY - 1e-6 || p.y > b.maxY + 1e-6) return false;
    if (this.level.noBuild.some((z) => inZone(p, z))) return false;
    return !this.level.terrain.some((poly) => pointInPoly(p, poly));
  }

  segmentAllowed(a: Vec, b: Vec) {
    return !this.level.noBuild.some((z) => segHitsZone(a, b, z));
  }

  // ---------- history ----------
  serialize(): string {
    return JSON.stringify({ nodes: this.nodes.filter((n) => !n.anchor), beams: this.beams });
  }

  load(json: string) {
    try {
      const d = JSON.parse(json) as DesignData;
      this.reset();
      for (const n of d.nodes) this.nodes.push({ ...n, anchor: false });
      const ids = new Set(this.nodes.map((n) => n.id));
      this.beams = d.beams
        .filter((b) => ids.has(b.a) && ids.has(b.b) && MATERIALS[b.mat])
        .map((b) => ({ ...b, sec: b.sec ?? MATERIALS[b.mat].defaultSection }));
      this.nextId = Math.max(1, ...this.nodes.map((n) => n.id + 1), ...this.beams.map((b) => b.id + 1));
      return true;
    } catch {
      return false;
    }
  }

  checkpoint() {
    this.undoStack.push(this.serialize());
    if (this.undoStack.length > 300) this.undoStack.shift();
    this.redoStack = [];
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  undo() {
    const s = this.undoStack.pop();
    if (s === undefined) return false;
    this.redoStack.push(this.serialize());
    this.load(s);
    return true;
  }

  redo() {
    const s = this.redoStack.pop();
    if (s === undefined) return false;
    this.undoStack.push(this.serialize());
    this.load(s);
    return true;
  }

  // ---------- edits ----------
  addNode(x: number, y: number): DNode {
    const n = { id: this.nextId++, x, y, anchor: false };
    this.nodes.push(n);
    return n;
  }

  findBeam(a: number, b: number) {
    return this.beams.find((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));
  }

  addBeam(a: number, b: number, mat: MaterialId, sec: number) {
    if (a === b) return null;
    const existing = this.findBeam(a, b);
    if (existing) {
      existing.mat = mat;
      existing.sec = sec;
      return existing;
    }
    const beam = { id: this.nextId++, a, b, mat, sec };
    this.beams.push(beam);
    return beam;
  }

  removeBeam(id: number) {
    const beam = this.beams.find((b) => b.id === id);
    if (!beam) return;
    this.beams = this.beams.filter((b) => b.id !== id);
    this.pruneOrphan(beam.a);
    this.pruneOrphan(beam.b);
  }

  removeNode(id: number) {
    const n = this.node(id);
    if (!n || n.anchor) return;
    const neighbours = this.beams.filter((b) => b.a === id || b.b === id).map((b) => (b.a === id ? b.b : b.a));
    this.beams = this.beams.filter((b) => b.a !== id && b.b !== id);
    this.nodes = this.nodes.filter((x) => x.id !== id);
    for (const o of neighbours) this.pruneOrphan(o);
  }

  private pruneOrphan(id: number) {
    const n = this.node(id);
    if (!n || n.anchor) return;
    if (!this.beams.some((b) => b.a === id || b.b === id)) this.nodes = this.nodes.filter((x) => x.id !== id);
  }

  /** would moving node to (x,y) keep every attached beam valid */
  canMove(id: number, x: number, y: number) {
    for (const b of this.beams) {
      if (b.a !== id && b.b !== id) continue;
      const o = this.node(b.a === id ? b.b : b.a)!;
      const L = Math.hypot(o.x - x, o.y - y);
      if (L > MATERIALS[b.mat].maxLength + 1e-6 || L < 0.25) return false;
      if (!this.segmentAllowed(o, { x, y })) return false;
    }
    return true;
  }
}
