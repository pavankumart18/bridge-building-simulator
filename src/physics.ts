/**
 * XPBD ("small steps") dynamic simulation of the truss + traffic.
 *
 * - Every member is a compliant distance constraint with compliance = L / (E·A), so the
 *   Lagrange multiplier is the real axial force: N = λ / h².
 * - Members fail when |N| exceeds their characteristic resistance (tension yield/rupture,
 *   or compression incl. Euler buckling via Rankine–Gordon).
 * - Vehicles are multi-axle particle rigs with suspension; wheel contact forces flow into the
 *   deck joints, so traffic genuinely loads the structure (including dynamic effects).
 */
import { JOINT_MASS, MATERIALS, capacity, propsOf, type MaterialId } from './materials';
import type { DBeam, DNode } from './design';
import type { Level, Vec } from './levels';
import { VEHICLES, type VehicleKind } from './vehicles';

export const GRAVITY = -9.81;
export const FRAME_DT = 1 / 60;
export const SUBSTEPS = 40;

export interface Particle {
  x: number; y: number;
  px: number; py: number;
  vx: number; vy: number;
  w: number;
  r: number;
  drive: number; // target tangential speed (NaN = no drive → brakes/friction)
  mu: number;
  spin: number;
  wet: boolean;
  anchor: boolean;
  bx: number; by: number; // base position (anchors, for ground motion)
  dead: boolean;
}

export interface Member {
  a: number; b: number;
  rest: number;
  compliance: number;
  Nt: number;
  Nc: number; // 0 = tension-only
  mat: MaterialId | null;
  sec: number;
  road: boolean;
  broken: boolean;
  debris: boolean;
  force: number;
  ratio: number;
  peak: number;
  damping: number;
  designId: number;
}

export interface Vehicle {
  id: number;
  kind: VehicleKind;
  dir: 1 | -1;
  wheels: number[];
  body: number[];
  required: boolean;
  arrived: boolean;
  lost: boolean;
  removed: boolean;
  manual: boolean;
  throttle: number;
  cruise: number;
}

export interface Load { p: number; mass: number }

export interface SimEvent {
  type: 'break' | 'splash' | 'arrive' | 'lost' | 'spawn';
  x: number; y: number;
  mat?: MaterialId | null;
  force?: number;
  designId?: number;
  ratio?: number;
}

interface Segment { ax: number; ay: number; bx: number; by: number }

export class Sim {
  particles: Particle[] = [];
  members: Member[] = [];
  vehicles: Vehicle[] = [];
  loads: Load[] = [];
  events: SimEvent[] = [];
  terrainSegs: Segment[] = [];
  time = 0;
  maxRatio = 0;
  maxDeflection = 0;
  nodeIndex = new Map<number, number>();
  quake: { amp: number; freq: number } | null = null;
  groundX = 0;
  /** viscous damping on all joints, 1/s (dynamic relaxation uses a large value) */
  globalDamping = 0.25;
  stepMs = 0;
  private roadMembers: number[] = [];
  private queue: { kind: VehicleKind; dir: 1 | -1; at: number; required: boolean }[] = [];
  private nextVid = 1;
  private deckRest = new Map<number, number>(); // particle → rest y for deflection tracking
  private leftEdge: number;
  private rightEdge: number;

  constructor(public level: Level, nodes: DNode[], beams: DBeam[], spawnLevelTraffic = true) {
    for (const poly of level.terrain) {
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        this.terrainSegs.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y });
      }
    }
    this.leftEdge = Math.min(level.anchors[0].x, level.anchors[1].x);
    this.rightEdge = Math.max(level.anchors[0].x, level.anchors[1].x);

    const byId = new Map(nodes.map((n) => [n.id, n]));
    const mass = new Map<number, number>();
    for (const n of nodes) mass.set(n.id, JOINT_MASS);
    for (const b of beams) {
      const na = byId.get(b.a)!, nb = byId.get(b.b)!;
      const m = Math.hypot(nb.x - na.x, nb.y - na.y) * propsOf(b.mat, b.sec).massPerM;
      mass.set(b.a, mass.get(b.a)! + m / 2);
      mass.set(b.b, mass.get(b.b)! + m / 2);
    }
    for (const n of nodes) {
      const i = this.addParticle(n.x, n.y, n.anchor ? 0 : 1 / mass.get(n.id)!);
      this.particles[i].anchor = n.anchor;
      this.nodeIndex.set(n.id, i);
    }
    for (const b of beams) {
      const p = propsOf(b.mat, b.sec);
      const ia = this.nodeIndex.get(b.a)!, ib = this.nodeIndex.get(b.b)!;
      const pa = this.particles[ia], pb = this.particles[ib];
      const L = Math.hypot(pb.x - pa.x, pb.y - pa.y);
      const cap = capacity(b.mat, b.sec, L);
      this.members.push({
        a: ia, b: ib, rest: L, compliance: L / (p.E * p.A),
        Nt: cap.Nt, Nc: cap.Nc, mat: b.mat, sec: b.sec, road: MATERIALS[b.mat].road,
        broken: false, debris: false, force: 0, ratio: 0, peak: 0, damping: 60, designId: b.id,
      });
      if (MATERIALS[b.mat].road) {
        if (!pa.anchor) this.deckRest.set(ia, pa.y);
        if (!pb.anchor) this.deckRest.set(ib, pb.y);
      }
    }
    this.refreshRoad();
    if (spawnLevelTraffic) for (const v of level.vehicles) this.queue.push({ kind: v.kind, dir: v.dir ?? 1, at: v.delay, required: true });
  }

  private addParticle(x: number, y: number, w: number, r = 0): number {
    this.particles.push({ x, y, px: x, py: y, vx: 0, vy: 0, w, r, drive: NaN, mu: 0.9, spin: 0, wet: false, anchor: false, bx: x, by: y, dead: false });
    return this.particles.length - 1;
  }

  private refreshRoad() {
    this.roadMembers = [];
    this.members.forEach((m, i) => { if (m.road && !m.broken) this.roadMembers.push(i); });
  }

  // ---------------- traffic ----------------
  enqueue(kind: VehicleKind, dir: 1 | -1, required = false, delay = 0) {
    this.queue.push({ kind, dir, at: this.time + delay, required });
  }

  get queued() { return this.queue.length; }

  private spawnClear(dir: 1 | -1, len: number) {
    const sx = dir === 1 ? this.level.spawnL.x : this.level.spawnR.x;
    for (const v of this.vehicles) {
      if (v.removed || v.dir !== dir) continue;
      const c = this.vehicleCenter(v);
      const vl = VEHICLES[v.kind].length;
      if (Math.abs(c.x - sx) < (vl + len) / 2 + 2.5) return false;
    }
    return true;
  }

  private spawnVehicle(kind: VehicleKind, dir: 1 | -1, required: boolean) {
    const V = VEHICLES[kind];
    const spawn = dir === 1 ? this.level.spawnL : this.level.spawnR;
    const rear = spawn.x - (dir * V.length) / 2;
    const y0 = spawn.y + V.wheelR + 0.01;
    const wheels: number[] = [];
    for (const ax of V.axles) {
      const p = this.addParticle(rear + dir * ax.x, y0, 1 / (ax.share * V.mass * 0.85), V.wheelR);
      this.particles[p].drive = dir * V.speed;
      wheels.push(p);
    }
    const bodyH = (V.height - V.wheelR) * 0.7;
    const bm = V.mass * 0.075;
    const b0 = this.addParticle(rear + dir * 0.3, y0 + bodyH, 1 / bm, 0.15);
    const b1 = this.addParticle(rear + dir * (V.length - 0.3), y0 + bodyH, 1 / bm, 0.15);
    for (const b of [b0, b1]) this.particles[b].mu = 0.5;
    const link = (a: number, b: number, compliance: number) => {
      const pa = this.particles[a], pb = this.particles[b];
      this.members.push({
        a, b, rest: Math.hypot(pb.x - pa.x, pb.y - pa.y), compliance,
        Nt: Infinity, Nc: Infinity, mat: null, sec: 0, road: false, broken: false, debris: false,
        force: 0, ratio: 0, peak: 0, damping: 150, designId: -1,
      });
    };
    const susp = 0.06 / (V.mass * 9.81);
    for (let i = 1; i < wheels.length; i++) link(wheels[i - 1], wheels[i], 1e-9);
    for (const w of wheels) { link(w, b0, susp); link(w, b1, susp); }
    link(b0, b1, 1e-9);
    const v: Vehicle = {
      id: this.nextVid++, kind, dir, wheels, body: [b0, b1], required,
      arrived: false, lost: false, removed: false, manual: false, throttle: 0, cruise: V.speed,
    };
    this.vehicles.push(v);
    this.events.push({ type: 'spawn', x: spawn.x, y: spawn.y });
    return v;
  }

  removeVehicle(v: Vehicle) {
    v.removed = true;
    for (const i of [...v.wheels, ...v.body]) this.kill(i);
  }

  private kill(i: number) {
    const p = this.particles[i];
    p.dead = true; p.w = 0; p.r = 0;
  }

  dropLoad(x: number, y: number, mass: number) {
    const p = this.addParticle(x, y, 1 / mass, 0.3 + Math.cbrt(mass / 2400) * 0.45);
    this.particles[p].mu = 0.7;
    this.loads.push({ p, mass });
  }

  clearLoads() {
    for (const l of this.loads) this.kill(l.p);
    this.loads = [];
  }

  vehicleCenter(v: Vehicle): Vec {
    let x = 0, y = 0;
    const ids = [...v.wheels, ...v.body];
    for (const i of ids) { x += this.particles[i].x; y += this.particles[i].y; }
    return { x: x / ids.length, y: y / ids.length };
  }

  vehicleSpeed(v: Vehicle) {
    let s = 0;
    for (const i of v.wheels) s += this.particles[i].vx;
    return s / v.wheels.length;
  }

  private ground(t: number) {
    if (!this.quake) return 0;
    const { amp, freq } = this.quake;
    const w = 2 * Math.PI * freq;
    return amp * (Math.sin(w * t) * 0.7 + Math.sin(w * 1.73 * t + 1.3) * 0.3);
  }

  // ---------------- step ----------------
  step() {
    const t0 = performance.now();
    const h = FRAME_DT / SUBSTEPS;
    const h2 = h * h;
    const P = this.particles;
    const M = this.members;

    // spawn queue (oldest first)
    for (let i = 0; i < this.queue.length; i++) {
      const q = this.queue[i];
      if (this.time < q.at) continue;
      if (!this.spawnClear(q.dir, VEHICLES[q.kind].length)) continue;
      this.queue.splice(i--, 1);
      this.spawnVehicle(q.kind, q.dir, q.required);
    }

    // driver model: cruise + keep distance to the vehicle ahead in the same lane
    const live = this.vehicles.filter((v) => !v.removed && !v.lost);
    const centers = new Map(live.map((v) => [v, this.vehicleCenter(v)]));
    for (const v of live) {
      const V = VEHICLES[v.kind];
      let target: number;
      if (v.manual) target = v.throttle * V.speed * 1.4;
      else {
        target = v.cruise;
        const c = centers.get(v)!;
        for (const o of live) {
          if (o === v || o.dir !== v.dir) continue;
          const oc = centers.get(o)!;
          const gap = (oc.x - c.x) * v.dir - (V.length + VEHICLES[o.kind].length) / 2;
          if (gap < -1) continue;
          target = Math.min(target, Math.max(0, V.speed * ((gap - 2.5) / 8)));
        }
        target *= v.dir;
      }
      for (const w of v.wheels) P[w].drive = target;
    }

    for (const m of M) m.force = 0;

    for (let s = 0; s < SUBSTEPS; s++) {
      this.groundX = this.ground(this.time + s * h);
      for (const p of P) {
        if (p.anchor) { p.x = p.bx + this.groundX; continue; }
        if (p.w === 0) continue;
        p.vy += GRAVITY * h;
        p.px = p.x; p.py = p.y;
        p.x += p.vx * h; p.y += p.vy * h;
      }

      for (const m of M) {
        if (m.broken) continue;
        const pa = P[m.a], pb = P[m.b];
        const w = pa.w + pb.w;
        if (w === 0) continue;
        let dx = pb.x - pa.x, dy = pb.y - pa.y;
        const len = Math.hypot(dx, dy);
        if (len < 1e-9) continue;
        dx /= len; dy /= len;
        const C = len - m.rest;
        if (C < 0 && m.Nc === 0) continue; // slack cable
        const dl = -C / (w + m.compliance / h2);
        pa.x -= pa.w * dl * dx; pa.y -= pa.w * dl * dy;
        pb.x += pb.w * dl * dx; pb.y += pb.w * dl * dy;
        m.force += -dl / h2;
      }

      for (const p of P) {
        if (p.r === 0 || p.w === 0) continue;
        this.collideRoad(p);
        this.collideTerrain(p);
      }

      const inv = 1 / h;
      for (const p of P) {
        if (p.w === 0) continue;
        p.vx = (p.x - p.px) * inv;
        p.vy = (p.y - p.py) * inv;
        if (this.globalDamping && p.r === 0) {
          const k = 1 - this.globalDamping * h;
          p.vx *= k; p.vy *= k;
        }
        if (p.y < this.level.waterY) {
          const k = Math.max(0, 1 - 3 * h);
          p.vx *= k; p.vy = p.vy * k + 8 * h;
        }
      }

      for (const m of M) {
        if (m.broken) continue;
        const pa = P[m.a], pb = P[m.b];
        const w = pa.w + pb.w;
        if (w === 0) continue;
        let dx = pb.x - pa.x, dy = pb.y - pa.y;
        const len = Math.hypot(dx, dy) || 1;
        dx /= len; dy /= len;
        const vr = (pb.vx - pa.vx) * dx + (pb.vy - pa.vy) * dy;
        const imp = (-vr * Math.min(1, m.damping * h)) / w;
        pa.vx -= pa.w * imp * dx; pa.vy -= pa.w * imp * dy;
        pb.vx += pb.w * imp * dx; pb.vy += pb.w * imp * dy;
      }

      this.applyFriction(h);
    }

    // forces, failure
    let broke = false;
    for (let i = 0; i < M.length; i++) {
      const m = M[i];
      if (m.broken || m.mat === null) continue;
      m.force /= SUBSTEPS;
      if (m.debris) { m.ratio = 0; continue; }
      const lim = m.force >= 0 ? m.Nt : m.Nc;
      m.ratio = lim > 0 ? Math.abs(m.force) / lim : 0;
      if (m.ratio > m.peak) m.peak = m.ratio;
      if (m.ratio > this.maxRatio) this.maxRatio = Math.min(m.ratio, 1);
      if (m.ratio >= 1) { this.breakMember(i); broke = true; }
    }
    if (broke) this.refreshRoad();

    for (const [pi, y0] of this.deckRest) {
      const d = y0 - P[pi].y;
      if (d > this.maxDeflection && d < 3) this.maxDeflection = d;
    }

    // vehicle bookkeeping
    for (const v of this.vehicles) {
      if (v.removed) continue;
      const c = this.vehicleCenter(v);
      if (!v.arrived && !v.lost) {
        if ((v.dir === 1 && c.x > this.rightEdge + 7) || (v.dir === -1 && c.x < this.leftEdge - 7)) {
          v.arrived = true;
          this.events.push({ type: 'arrive', x: c.x, y: c.y });
        } else if (c.y < this.level.lossY || c.y < this.level.waterY) {
          v.lost = true;
          this.events.push({ type: 'lost', x: c.x, y: c.y });
        }
      }
      const far = 40;
      if (c.x > this.level.spawnR.x + far || c.x < this.level.spawnL.x - far || c.y < this.level.waterY - 25) this.removeVehicle(v);
    }
    for (const p of P) {
      if (!p.wet && !p.dead && p.w > 0 && p.y < this.level.waterY) {
        p.wet = true;
        this.events.push({ type: 'splash', x: p.x, y: this.level.waterY });
      }
    }

    this.time += FRAME_DT;
    this.stepMs = performance.now() - t0;
  }

  private breakMember(i: number) {
    const m = this.members[i];
    m.broken = true;
    const pa = this.particles[m.a], pb = this.particles[m.b];
    const p = propsOf(m.mat!, m.sec);
    const mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2;
    const tipMass = (m.rest * p.massPerM) / 4 + 2;
    for (const [end, side] of [[m.a, -1], [m.b, 1]] as const) {
      const e = this.particles[end];
      const tx = mx + side * 0.04 * (pb.x - pa.x), ty = my + side * 0.04 * (pb.y - pa.y);
      const t = this.addParticle(tx, ty, 1 / tipMass);
      const tp = this.particles[t];
      tp.vx = e.vx + (Math.random() - 0.5) * 1.5;
      tp.vy = e.vy + (Math.random() - 0.5) * 1.5;
      this.members.push({
        a: end, b: t, rest: Math.hypot(tx - e.x, ty - e.y) || m.rest / 2,
        compliance: m.compliance / 2, Nt: Infinity, Nc: m.Nc === 0 ? 0 : Infinity,
        mat: m.mat, sec: m.sec, road: m.road, broken: false, debris: true,
        force: 0, ratio: 0, peak: 0, damping: 30, designId: m.designId,
      });
    }
    this.events.push({ type: 'break', x: mx, y: my, mat: m.mat, force: m.force, designId: m.designId, ratio: m.ratio });
  }

  // ---------------- contacts ----------------
  private contacts: { p: Particle; nx: number; ny: number; jn: number; m: number; t: number }[] = [];

  private collideRoad(p: Particle) {
    const P = this.particles;
    for (const mi of this.roadMembers) {
      const m = this.members[mi];
      if (m.broken) continue;
      const a = P[m.a], b = P[m.b];
      if (p.x + p.r < Math.min(a.x, b.x) || p.x - p.r > Math.max(a.x, b.x)) continue;
      const ex = b.x - a.x, ey = b.y - a.y;
      const l2 = ex * ex + ey * ey;
      if (l2 < 1e-9) continue;
      let t = ((p.x - a.x) * ex + (p.y - a.y) * ey) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = a.x + ex * t, qy = a.y + ey * t;
      let dx = p.x - qx, dy = p.y - qy;
      const d = Math.hypot(dx, dy);
      if (d >= p.r || d < 1e-9) continue;
      dx /= d; dy /= d;
      let ux = -ey, uy = ex;
      if (uy < 0) { ux = -ux; uy = -uy; }
      if (t > 0 && t < 1 && ux * dx + uy * dy < 0) continue; // underneath the deck
      const C = d - p.r;
      const ws = p.w + (1 - t) * (1 - t) * a.w + t * t * b.w;
      const dl = -C / ws;
      p.x += p.w * dl * dx; p.y += p.w * dl * dy;
      a.x -= a.w * (1 - t) * dl * dx; a.y -= a.w * (1 - t) * dl * dy;
      b.x -= b.w * t * dl * dx; b.y -= b.w * t * dl * dy;
      this.contacts.push({ p, nx: dx, ny: dy, jn: dl, m: mi, t });
    }
  }

  private collideTerrain(p: Particle) {
    const gx = this.groundX;
    for (const s of this.terrainSegs) {
      const ax = s.ax + gx, bx = s.bx + gx;
      if (p.x + p.r < Math.min(ax, bx) || p.x - p.r > Math.max(ax, bx)) continue;
      if (p.y + p.r < Math.min(s.ay, s.by) || p.y - p.r > Math.max(s.ay, s.by)) continue;
      const ex = bx - ax, ey = s.by - s.ay;
      const l2 = ex * ex + ey * ey;
      let t = ((p.x - ax) * ex + (p.y - s.ay) * ey) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = ax + ex * t, qy = s.ay + ey * t;
      let dx = p.x - qx, dy = p.y - qy;
      const d = Math.hypot(dx, dy);
      if (d >= p.r || d < 1e-9) continue;
      dx /= d; dy /= d;
      const C = d - p.r;
      p.x -= C * dx; p.y -= C * dy;
      this.contacts.push({ p, nx: dx, ny: dy, jn: -C / p.w, m: -1, t: 0 });
    }
  }

  private applyFriction(h: number) {
    const P = this.particles;
    for (const c of this.contacts) {
      const p = c.p;
      const tx = c.ny, ty = -c.nx;
      let a: Particle | null = null, b: Particle | null = null;
      let svx = 0, svy = 0;
      if (c.m >= 0) {
        const m = this.members[c.m];
        a = P[m.a]; b = P[m.b];
        svx = a.vx * (1 - c.t) + b.vx * c.t;
        svy = a.vy * (1 - c.t) + b.vy * c.t;
      }
      const vt = (p.vx - svx) * tx + (p.vy - svy) * ty;
      const want = (p.drive === p.drive ? p.drive : 0) - vt;
      const ws = p.w + (a && b ? (1 - c.t) ** 2 * a.w + c.t * c.t * b.w : 0);
      let J = want / ws;
      const maxJ = (p.mu * Math.max(0, c.jn)) / h;
      if (J > maxJ) J = maxJ; else if (J < -maxJ) J = -maxJ;
      p.vx += p.w * J * tx; p.vy += p.w * J * ty;
      if (a && b) {
        a.vx -= a.w * (1 - c.t) * J * tx; a.vy -= a.w * (1 - c.t) * J * ty;
        b.vx -= b.w * c.t * J * tx; b.vy -= b.w * c.t * J * ty;
      }
      if (p.r > 0.25) p.spin -= (vt * h) / p.r;
    }
    this.contacts.length = 0;
  }

  get outcome(): 'running' | 'success' | 'fail' {
    const req = this.vehicles.filter((v) => v.required);
    if (req.some((v) => v.lost)) return 'fail';
    const pending = this.queue.some((q) => q.required);
    if (!pending && req.length && req.every((v) => v.arrived)) return 'success';
    if (this.time > 90 && req.length) return 'fail';
    return 'running';
  }
}
