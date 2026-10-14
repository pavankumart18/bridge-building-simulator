import { MATERIALS, drawWidth, type MaterialId } from './materials';
import { rng, type Level, type Vec } from './levels';
import type { Design } from './design';
import type { AnalysisResult } from './analysis';
import type { Sim } from './physics';
import { VEHICLES, type VehicleKind } from './vehicles';

export interface Camera { x: number; y: number; zoom: number }
export interface Insets { left: number; right: number; top: number; bottom: number }

export type ViewMode = 'material' | 'util' | 'force';

export interface Fx {
  x: number; y: number; vx: number; vy: number;
  life: number; max: number; size: number; color: string; kind: 'chip' | 'spark' | 'drop' | 'dust';
  rot: number; vr: number;
}

export interface Overlay {
  mode: 'build' | 'sim';
  view: ViewMode;
  grid: boolean;
  labels: boolean;
  shape: boolean;
  hoverNode: number | null;
  hoverBeam: number | null; // design beam id (build) or member index (sim)
  selected: Set<number>;
  preview: { ax: number; ay: number; bx: number; by: number; mat: MaterialId; sec: number; valid: boolean; maxLen: number; reason: string } | null;
  peaks: Map<number, number> | null;
  analysis: AnalysisResult | null;
  moveNode: number | null;
  driving: number | null;
  loadCursor: { x: number; y: number; mass: number } | null;
  guide: { ax: number; ay: number; bx: number; by: number }[];
  time: number;
}

export function utilColor(r: number): string {
  const t = Math.max(0, Math.min(1.2, r));
  const stops: [number, number, number, number][] = [
    [0, 52, 199, 120],
    [0.5, 168, 214, 60],
    [0.75, 245, 196, 45],
    [0.95, 245, 120, 40],
    [1.0, 230, 40, 40],
    [1.2, 150, 20, 60],
  ];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, r0, g0, b0] = stops[i - 1];
      const [t1, r1, g1, b1] = stops[i];
      const k = (t - t0) / (t1 - t0);
      return `rgb(${Math.round(r0 + (r1 - r0) * k)},${Math.round(g0 + (g1 - g0) * k)},${Math.round(b0 + (b1 - b0) * k)})`;
    }
  }
  return 'rgb(150,20,60)';
}

/** tension blue, compression red, intensity by ratio */
export function forceColor(N: number, cap: number): string {
  const k = Math.max(0.15, Math.min(1, Math.abs(N) / Math.max(1, cap)));
  if (Math.abs(N) < 500) return 'rgb(150,156,168)';
  return N > 0
    ? `rgb(${Math.round(180 - 150 * k)},${Math.round(200 - 110 * k)},${Math.round(240 - 10 * k)})`
    : `rgb(${Math.round(240 - 10 * k)},${Math.round(190 - 150 * k)},${Math.round(170 - 140 * k)})`;
}

function hash(n: number) {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}
function noise1(x: number) {
  const i = Math.floor(x), f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash(i) * (1 - u) + hash(i + 1) * u;
}
function fbm(x: number) {
  return noise1(x) * 0.55 + noise1(x * 2.1 + 13) * 0.28 + noise1(x * 4.3 + 7) * 0.17;
}
function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt);
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

interface Tree { x: number; y: number; h: number; kind: number }
interface House { x: number; y: number; w: number; h: number; color: string }

export class Renderer {
  ctx: CanvasRenderingContext2D;
  W = 0; H = 0; dpr = 1;
  cam: Camera = { x: 0, y: 0, zoom: 40 };
  insets: Insets = { left: 0, right: 0, top: 0, bottom: 0 };
  shake = 0;
  fx: Fx[] = [];
  private rockPattern: CanvasPattern | null = null;
  private trees: Tree[] = [];
  private houses: House[] = [];
  private sceneFor = '';

  constructor(public canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();
    this.rockPattern = this.makeRockPattern();
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = this.canvas.clientWidth;
    this.H = this.canvas.clientHeight;
    this.canvas.width = Math.round(this.W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
  }

  toScreen(x: number, y: number): Vec {
    return { x: (x - this.cam.x) * this.cam.zoom + this.W / 2, y: this.H / 2 - (y - this.cam.y) * this.cam.zoom };
  }
  toWorld(sx: number, sy: number): Vec {
    return { x: (sx - this.W / 2) / this.cam.zoom + this.cam.x, y: (this.H / 2 - sy) / this.cam.zoom + this.cam.y };
  }

  fit(level: Level) {
    // frame the working area (anchors + room for a truss), not the whole build envelope
    const b = level.bounds;
    const xs = level.anchors.map((a) => a.x), ys = level.anchors.map((a) => a.y);
    const deckY = Math.max(level.anchors[0].y, level.anchors[1].y);
    const x0 = Math.max(b.minX - 2, Math.min(...xs) - 5), x1 = Math.min(b.maxX + 2, Math.max(...xs) + 5);
    const y0 = Math.max(b.minY - 1, Math.min(Math.min(...ys) - 3, deckY - 6)), y1 = Math.min(b.maxY + 1, Math.max(Math.max(...ys) + 3, deckY + 6));
    const I = this.insets;
    const availW = Math.max(200, this.W - I.left - I.right - 40);
    const availH = Math.max(200, this.H - I.top - I.bottom - 60);
    this.cam.zoom = Math.max(6, Math.min(70, Math.min(availW / (x1 - x0), availH / (y1 - y0))));
    const cxScreen = I.left + 20 + availW / 2, cyScreen = I.top + 30 + availH / 2;
    this.cam.x = (x0 + x1) / 2 - (cxScreen - this.W / 2) / this.cam.zoom;
    this.cam.y = (y0 + y1) / 2 + (cyScreen - this.H / 2) / this.cam.zoom;
  }

  private makeRockPattern() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = '#7a6552';
    g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 260; i++) {
      const x = hash(i * 3.1) * 128, y = hash(i * 7.7) * 128, r = 1 + hash(i * 1.3) * 5;
      g.fillStyle = `rgba(${hash(i) > 0.5 ? '255,235,210' : '40,25,15'},${0.05 + hash(i * 9.1) * 0.1})`;
      g.beginPath();
      g.ellipse(x, y, r * 1.6, r, hash(i * 2.2) * 3, 0, Math.PI * 2);
      g.fill();
    }
    for (let i = 0; i < 6; i++) {
      g.strokeStyle = 'rgba(40,25,15,0.18)';
      g.lineWidth = 1.5;
      g.beginPath();
      const y = i * 22 + 8;
      g.moveTo(0, y);
      for (let x = 0; x <= 128; x += 16) g.lineTo(x, y + (hash(x + i * 50) - 0.5) * 6);
      g.stroke();
    }
    return this.ctx.createPattern(c, 'repeat');
  }

  private buildScenery(level: Level) {
    if (this.sceneFor === level.id) return;
    this.sceneFor = level.id;
    const r = rng(level.scenery.seed * 31 + 7);
    const leftTop = level.anchors[0].y, rightTop = level.anchors[1].y;
    const R = level.span;
    this.trees = [];
    for (let i = 0; i < level.scenery.trees; i++) {
      const left = i % 2 === 0;
      const x = left ? -4 - r() * 34 : R + 4 + r() * 34;
      if (Math.abs(x - level.spawnL.x) < 2 || Math.abs(x - level.spawnR.x) < 2) continue;
      this.trees.push({ x, y: left ? leftTop : rightTop, h: 4 + r() * 5, kind: Math.floor(r() * 3) });
    }
    this.houses = [];
    if (level.scenery.houses) {
      const cols = ['#e8d7b9', '#d9c3a5', '#f0e6d2', '#c9b6a0'];
      for (let i = 0; i < 4; i++) {
        const left = i < 2;
        this.houses.push({ x: left ? -30 - i * 11 - r() * 4 : R + 26 + (i - 2) * 11 + r() * 4, y: left ? leftTop : rightTop, w: 6 + r() * 3, h: 4 + r() * 2, color: cols[i] });
      }
    }
  }

  // ------------------------------------------------------------------

  draw(level: Level, design: Design, sim: Sim | null, ov: Overlay, dt: number) {
    const { ctx, dpr } = this;
    this.buildScenery(level);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawBackground(level, ov.time);

    const sx = this.shake > 0 ? (Math.random() - 0.5) * this.shake : 0;
    const sy = this.shake > 0 ? (Math.random() - 0.5) * this.shake : 0;
    this.shake = Math.max(0, this.shake - dt * 30);
    const z = this.cam.zoom;
    const worldT = () => ctx.setTransform(z * dpr, 0, 0, -z * dpr, (this.W / 2 - this.cam.x * z + sx) * dpr, (this.H / 2 + this.cam.y * z + sy) * dpr);
    worldT();

    const gx = sim?.groundX ?? 0, gy = sim?.groundY ?? 0;
    if (level.boats) this.drawBoats(level, ov.time, true);
    ctx.save();
    ctx.translate(gx, gy);
    if (level.highwayY !== null) this.drawHighway(level, ov.time);
    this.drawHouses();
    this.drawPylons(level);
    this.drawTerrain(level);
    this.drawTrees(ov.time);
    this.drawZones(level);
    ctx.restore();

    if (ov.mode === 'build') this.drawGrid(level, ov.grid);
    this.drawSigns(level);

    // far-lane traffic behind the bridge
    if (sim) this.drawSimVehicles(sim, -1, ov);
    if (sim) this.drawSimBridge(sim, ov);
    else this.drawDesign(design, ov);
    ctx.save();
    ctx.translate(gx, gy);
    this.drawAnchors(level);
    ctx.restore();
    if (sim) {
      this.drawSimVehicles(sim, 1, ov);
      this.drawLoads(sim);
    } else this.drawParkedTraffic(level);

    if (!sim && ov.analysis) this.drawAnalysisExtras(design, ov.analysis, ov);
    if (!sim) this.drawSpanDimension(level);

    this.updateDrawFx(dt, level.waterY);
    this.drawWater(level, ov.time);
    if (level.boats) this.drawBoats(level, ov.time, false);

    if (ov.guide.length) this.drawGuide(ov.guide, ov.time);
    if (ov.preview) this.drawPreview(ov.preview);
    if (ov.loadCursor) this.drawLoadGhost(ov.loadCursor);

    // screen-space labels
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (ov.labels && ov.view !== 'material') this.drawForceLabels(design, sim, ov);
    if (ov.preview) {
      const p = ov.preview;
      const L = Math.hypot(p.bx - p.ax, p.by - p.ay);
      const m = this.toScreen((p.ax + p.bx) / 2, (p.ay + p.by) / 2);
      this.label(p.valid ? `${L.toFixed(2)} m` : p.reason, m.x, m.y - 20, p.valid ? '#fff' : '#ffb4b4');
    }
    for (const zn of level.noBuild) {
      const s = this.toScreen((zn.x0 + zn.x1) / 2 + gx, (zn.y0 + zn.y1) / 2);
      if (this.cam.zoom > 9) this.label(zn.label, s.x, s.y, '#ffd9a0', 'rgba(60,30,10,0.75)');
    }
    this.drawScaleBar();
  }

  label(text: string, x: number, y: number, color = '#fff', bg = 'rgba(15,20,30,0.85)', size = 12) {
    const { ctx } = this;
    ctx.font = `600 ${size}px Inter, system-ui, sans-serif`;
    const w = ctx.measureText(text).width + 12;
    const h = size + 9;
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + 0.5);
  }

  private drawScaleBar() {
    const { ctx } = this;
    const targetPx = 120;
    const raw = targetPx / this.cam.zoom;
    const nice = [0.5, 1, 2, 5, 10, 20, 50].find((v) => v >= raw * 0.6) ?? 50;
    const px = nice * this.cam.zoom;
    const x = this.insets.left + 18, y = this.H - this.insets.bottom - 22;
    ctx.fillStyle = 'rgba(10,14,22,0.6)';
    ctx.fillRect(x - 6, y - 18, px + 12, 28);
    ctx.fillStyle = '#fff';
    ctx.fillRect(x, y, px, 3);
    ctx.fillRect(x, y - 5, 2, 8);
    ctx.fillRect(x + px - 2, y - 5, 2, 8);
    ctx.font = '600 11px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(`${nice} m`, x + px / 2, y - 5);
  }

  // ---------------- background ----------------
  private drawBackground(level: Level, time: number) {
    const { ctx, W, H } = this;
    const horizon = this.toScreen(0, Math.max(level.waterY, level.highwayY ?? -99)).y;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#4f9ee0');
    g.addColorStop(Math.max(0.05, Math.min(0.95, horizon / H)) * 0.85, '#bfe0f5');
    g.addColorStop(1, '#f3e6cf');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    const sunX = W * 0.72 - this.cam.x * this.cam.zoom * 0.02, sunY = H * 0.17;
    const sg = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, 170);
    sg.addColorStop(0, 'rgba(255,250,225,0.95)');
    sg.addColorStop(0.18, 'rgba(255,240,190,0.7)');
    sg.addColorStop(1, 'rgba(255,240,190,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(sunX - 170, sunY - 170, 340, 340);

    for (let i = 0; i < 8; i++) {
      const f = 0.08 + hash(i) * 0.08;
      const span = W + 400;
      let x = (hash(i * 3.3) * span + time * (5 + hash(i * 5) * 7) - this.cam.x * this.cam.zoom * f) % span;
      if (x < 0) x += span;
      x -= 200;
      const y = H * (0.06 + hash(i * 1.7) * 0.24);
      const s = 0.7 + hash(i * 2.9) * 0.9;
      ctx.fillStyle = 'rgba(255,255,255,0.72)';
      ctx.beginPath();
      for (let k = 0; k < 5; k++) ctx.ellipse(x + k * 26 * s, y + Math.sin(k * 1.7) * 5 * s, 30 * s, 16 * s + hash(i + k) * 8 * s, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // birds
    ctx.strokeStyle = 'rgba(40,50,60,0.55)';
    ctx.lineWidth = 1.3;
    for (let i = 0; i < 5; i++) {
      const bx = ((hash(i * 9.1) * W + time * (18 + i * 4)) % (W + 100)) - 50;
      const by = H * (0.12 + hash(i * 4.4) * 0.15) + Math.sin(time * 0.7 + i) * 8;
      const f = Math.sin(time * 8 + i * 2) * 3;
      ctx.beginPath();
      ctx.moveTo(bx - 6, by - f); ctx.quadraticCurveTo(bx - 3, by - 3, bx, by);
      ctx.quadraticCurveTo(bx + 3, by - 3, bx + 6, by - f);
      ctx.stroke();
    }

    const layers = [
      { f: 0.15, h: 28, col: '#a9c3d6', scale: 0.025, base: 4 },
      { f: 0.3, h: 18, col: '#8fb0c4', scale: 0.04, base: 1 },
      { f: 0.55, h: 10, col: '#6f9a86', scale: 0.07, base: -1 },
    ];
    for (const L of layers) {
      const z = this.cam.zoom * L.f + 4;
      const baseY = H / 2 + (this.cam.y - (level.waterY + L.base)) * z;
      ctx.fillStyle = L.col;
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let x = 0; x <= W + 8; x += 8) {
        const wx = (x - W / 2) / z + this.cam.x * (L.f * 1.4);
        ctx.lineTo(x, baseY - fbm(wx * L.scale * 4 + L.f * 100) * L.h * z * 0.6);
      }
      ctx.lineTo(W, H);
      ctx.closePath();
      ctx.fill();
    }
    const hz = ctx.createLinearGradient(0, horizon - 120, 0, horizon + 20);
    hz.addColorStop(0, 'rgba(240,235,220,0)');
    hz.addColorStop(1, 'rgba(240,235,220,0.45)');
    ctx.fillStyle = hz;
    ctx.fillRect(0, horizon - 120, W, 140);
  }

  private drawGrid(level: Level, grid: boolean) {
    const { ctx } = this;
    const b = level.bounds;
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fillRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
    if (grid) {
      const step = this.cam.zoom > 30 ? 0.5 : 1;
      ctx.lineWidth = 1 / this.cam.zoom;
      for (let x = Math.ceil(b.minX / step) * step; x <= b.maxX + 1e-6; x += step) {
        ctx.strokeStyle = Math.abs(x - Math.round(x)) < 1e-6 ? 'rgba(255,255,255,0.26)' : 'rgba(255,255,255,0.1)';
        ctx.beginPath(); ctx.moveTo(x, b.minY); ctx.lineTo(x, b.maxY); ctx.stroke();
      }
      for (let y = Math.ceil(b.minY / step) * step; y <= b.maxY + 1e-6; y += step) {
        ctx.strokeStyle = Math.abs(y - Math.round(y)) < 1e-6 ? 'rgba(255,255,255,0.26)' : 'rgba(255,255,255,0.1)';
        ctx.beginPath(); ctx.moveTo(b.minX, y); ctx.lineTo(b.maxX, y); ctx.stroke();
      }
    }
    ctx.setLineDash([0.3, 0.2]);
    ctx.lineWidth = 2 / this.cam.zoom;
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.strokeRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
    ctx.restore();
  }

  private drawZones(level: Level) {
    const { ctx } = this;
    for (const z of level.noBuild) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(z.x0, z.y0, z.x1 - z.x0, z.y1 - z.y0);
      ctx.fillStyle = 'rgba(255,150,40,0.12)';
      ctx.fill();
      ctx.clip();
      ctx.strokeStyle = 'rgba(255,150,40,0.45)';
      ctx.lineWidth = 0.06;
      for (let x = z.x0 - (z.y1 - z.y0); x < z.x1; x += 0.6) {
        ctx.beginPath(); ctx.moveTo(x, z.y0); ctx.lineTo(x + (z.y1 - z.y0), z.y1); ctx.stroke();
      }
      ctx.restore();
      ctx.setLineDash([0.25, 0.15]);
      ctx.strokeStyle = 'rgba(255,170,60,0.9)';
      ctx.lineWidth = 0.06;
      ctx.strokeRect(z.x0, z.y0, z.x1 - z.x0, z.y1 - z.y0);
      ctx.setLineDash([]);
    }
  }

  private drawPylons(level: Level) {
    const { ctx } = this;
    for (const a of level.anchors) {
      if (a.pylonTo === undefined) continue;
      const tall = a.y - a.pylonTo > 6;
      const wTop = tall ? 0.9 : 1.1, wBot = tall ? 1.6 : 1.3;
      const g = ctx.createLinearGradient(a.x - wBot / 2, 0, a.x + wBot / 2, 0);
      const [c0, c1, c2] = a.pylon === 'orange' ? ['#8f2a1c', '#d8573c', '#7a2416'] : a.pylon === 'stone' ? ['#a89f8a', '#e2d9c3', '#948b77'] : ['#9da3a8', '#d9dde0', '#858b91'];
      g.addColorStop(0, c0);
      g.addColorStop(0.5, c1);
      g.addColorStop(1, c2);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(a.x - wBot / 2, a.pylonTo);
      ctx.lineTo(a.x - wTop / 2, a.y + 0.3);
      ctx.lineTo(a.x + wTop / 2, a.y + 0.3);
      ctx.lineTo(a.x + wBot / 2, a.pylonTo);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.1)';
      for (let y = a.pylonTo + 1.5; y < a.y; y += 1.5) ctx.fillRect(a.x - wBot / 2, y, wBot, 0.05);
      ctx.fillStyle = '#7d8388';
      ctx.fillRect(a.x - wTop / 2 - 0.2, a.y + 0.2, wTop + 0.4, 0.35);
      if (a.pylon === 'stone') {
        // gothic turret roof
        ctx.fillStyle = '#4e5a63';
        ctx.beginPath(); ctx.moveTo(a.x - wTop / 2 - 0.3, a.y + 0.55); ctx.lineTo(a.x, a.y + 2.4); ctx.lineTo(a.x + wTop / 2 + 0.3, a.y + 0.55); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(40,40,40,0.35)';
        for (let y = a.pylonTo + 2.5; y < a.y - 1; y += 3) ctx.fillRect(a.x - 0.12, y, 0.24, 0.9);
      }
      if (tall) {
        ctx.fillStyle = '#e3402f';
        ctx.beginPath(); ctx.arc(a.x, a.y + 0.75, 0.12, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  private drawTerrain(level: Level) {
    const { ctx } = this;
    for (const poly of level.terrain) {
      ctx.beginPath();
      poly.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.save();
      ctx.clip();
      if (this.rockPattern) {
        ctx.save();
        ctx.scale(1 / 24, -1 / 24);
        ctx.fillStyle = this.rockPattern;
        ctx.fillRect(-4000, -3000, 8000, 6000);
        ctx.restore();
      }
      const top = Math.max(...poly.map((p) => p.y));
      const g = ctx.createLinearGradient(0, top, 0, top - 20);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(20,10,5,0.6)');
      ctx.fillStyle = g;
      ctx.fillRect(-300, top - 80, 600, 81);
      ctx.restore();
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#4b3a2c';
      ctx.lineWidth = 0.12;
      ctx.stroke();

      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        if (Math.abs(a.y - b.y) > 0.01 || Math.abs(a.y - top) > 0.01) continue;
        const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
        const isFloor = level.highwayY !== null && Math.abs(top - level.highwayY) < 0.01;
        ctx.fillStyle = '#5c9a3c';
        ctx.fillRect(x0, top - 0.55, x1 - x0, 0.55);
        ctx.fillStyle = '#76b84c';
        ctx.fillRect(x0, top - 0.2, x1 - x0, 0.2);
        if (x1 - x0 > 5 && !isFloor) this.tarmac(x0, x1, top);
        if (isFloor) {
          ctx.fillStyle = '#4a4e57';
          ctx.fillRect(level.anchors[0].x - 1, top - 0.35, level.span + 2, 0.35);
          ctx.fillStyle = '#d9dde2';
          ctx.fillRect(level.span / 2 - 0.6, top, 1.2, 0.8); // median barrier
        }
      }
    }
  }

  private tarmac(x0: number, x1: number, top: number) {
    const { ctx } = this;
    ctx.fillStyle = '#3b3f47';
    ctx.fillRect(x0, top - 0.32, x1 - x0, 0.32);
    ctx.fillStyle = '#5a5f69';
    ctx.fillRect(x0, top - 0.06, x1 - x0, 0.06);
    ctx.fillStyle = '#e8c547';
    for (let x = Math.ceil(x0); x < x1 - 1; x += 3) ctx.fillRect(x, top - 0.18, 1.5, 0.05);
  }

  private drawTrees(t: number) {
    const { ctx } = this;
    for (const tr of this.trees) {
      const sway = Math.sin(t * 1.3 + tr.x) * 0.06;
      ctx.fillStyle = '#5b4030';
      ctx.fillRect(tr.x - 0.12, tr.y, 0.24, tr.h * 0.45);
      const cx = tr.x + sway * tr.h, cy = tr.y + tr.h * 0.62;
      if (tr.kind === 0) {
        ctx.fillStyle = '#2f6b3a';
        for (let k = 0; k < 3; k++) {
          const yy = tr.y + tr.h * (0.3 + k * 0.22), w = tr.h * (0.42 - k * 0.1);
          ctx.beginPath(); ctx.moveTo(cx - w, yy); ctx.lineTo(cx + w, yy); ctx.lineTo(cx + sway, yy + tr.h * 0.38); ctx.closePath(); ctx.fill();
        }
      } else {
        ctx.fillStyle = tr.kind === 1 ? '#3f7d3a' : '#5a8f3c';
        ctx.beginPath();
        ctx.ellipse(cx, cy, tr.h * 0.32, tr.h * 0.36, 0, 0, Math.PI * 2);
        ctx.ellipse(cx - tr.h * 0.18, cy - tr.h * 0.1, tr.h * 0.22, tr.h * 0.22, 0, 0, Math.PI * 2);
        ctx.ellipse(cx + tr.h * 0.2, cy - tr.h * 0.06, tr.h * 0.22, tr.h * 0.24, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,200,0.12)';
        ctx.beginPath(); ctx.ellipse(cx + tr.h * 0.08, cy + tr.h * 0.12, tr.h * 0.16, tr.h * 0.14, 0, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  private drawHouses() {
    const { ctx } = this;
    for (const h of this.houses) {
      ctx.fillStyle = h.color;
      ctx.fillRect(h.x, h.y, h.w, h.h);
      ctx.fillStyle = '#9b4a3a';
      ctx.beginPath(); ctx.moveTo(h.x - 0.4, h.y + h.h); ctx.lineTo(h.x + h.w / 2, h.y + h.h + 2.4); ctx.lineTo(h.x + h.w + 0.4, h.y + h.h); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#6a8fb0';
      for (let i = 0; i < 2; i++) ctx.fillRect(h.x + 0.9 + i * (h.w - 2.6), h.y + h.h * 0.45, 0.8, 1);
      ctx.fillStyle = '#6b4a35';
      ctx.fillRect(h.x + h.w / 2 - 0.45, h.y, 0.9, 1.9);
    }
  }

  private drawSigns(level: Level) {
    const { ctx } = this;
    // load-rating sign at both approaches
    const maxT = Math.max(0, ...level.vehicles.map((v) => VEHICLES[v.kind].mass)) / 1000;
    for (const [x, y] of [[level.anchors[0].x - 5, level.anchors[0].y], [level.anchors[1].x + 5, level.anchors[1].y]]) {
      ctx.fillStyle = '#9aa1a8';
      ctx.fillRect(x - 0.04, y, 0.08, 2.2);
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(x, y + 2.5, 0.42, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#d42a1e'; ctx.lineWidth = 0.09; ctx.stroke();
      if (maxT > 0) {
        ctx.save();
        ctx.translate(x, y + 2.5);
        ctx.scale(1 / 40, -1 / 40);
        ctx.fillStyle = '#111';
        ctx.font = '700 13px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${Math.ceil(maxT)}t`, 0, 1);
        ctx.restore();
      }
    }
  }

  private drawHighway(level: Level, t: number) {
    const { ctx } = this;
    const y = level.highwayY!;
    // passing traffic (purely visual)
    for (let i = 0; i < 6; i++) {
      const dir = i % 2 ? -1 : 1;
      const speed = 14 + hash(i) * 6;
      const period = level.span + 60;
      let x = ((hash(i * 5.7) * period + t * speed) % period) - 30;
      if (dir < 0) x = level.span - x;
      const kinds: VehicleKind[] = ['car', 'van', 'hgv', 'car', 'bus', 'car'];
      const k = kinds[i];
      const V = VEHICLES[k];
      const rear = x - (dir * V.length) / 2;
      const wy = y + V.wheelR;
      const wheels = V.axles.map((a) => ({ x: rear + dir * a.x, y: wy }));
      ctx.globalAlpha = dir < 0 ? 0.8 : 1;
      this.drawVehicle(k, wheels, dir, t * speed / V.wheelR * -dir, false);
      ctx.globalAlpha = 1;
    }
  }

  private drawBoats(level: Level, t: number, behind: boolean) {
    const { ctx } = this;
    const wy = level.waterY;
    const boats = behind ? [{ s: 1.2, off: 0.3, col: '#f2f2ee', h: 2.2 }] : [{ s: 1.6, off: 0, col: '#c8452f', h: 3.2 }];
    for (const b of boats) {
      const period = level.span + 90;
      const x = ((t * b.s + b.off * period) % period) - 45;
      const bob = Math.sin(t * 1.4 + b.off * 10) * 0.08;
      const L = behind ? 6 : 9;
      ctx.save();
      ctx.translate(x, wy + bob);
      if (behind) ctx.globalAlpha = 0.75;
      ctx.fillStyle = b.col;
      ctx.beginPath();
      ctx.moveTo(-L / 2, 0.9); ctx.lineTo(L / 2 + 0.8, 0.9); ctx.lineTo(L / 2, -0.4); ctx.lineTo(-L / 2 + 0.3, -0.4); ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#2b2f36';
      ctx.fillRect(-L / 2, 0.75, L + 0.6, 0.15);
      ctx.fillStyle = '#eef0f2';
      ctx.fillRect(-L / 2 + 0.8, 0.9, L * 0.35, b.h * 0.6);
      ctx.fillStyle = '#6a8fb0';
      ctx.fillRect(-L / 2 + 1.1, 0.9 + b.h * 0.35, L * 0.28, 0.4);
      ctx.fillStyle = '#555';
      ctx.fillRect(-L / 2 + 1.4, 0.9 + b.h * 0.6, 0.15, b.h * 0.5);
      ctx.restore();
    }
  }

  private drawFlag(x: number, y: number, t: number) {
    const { ctx } = this;
    ctx.fillStyle = '#ddd';
    ctx.fillRect(x - 0.05, y, 0.1, 3.6);
    const w = 1.4, h = 0.9, cols = 6, rows = 4;
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const wave = (k: number) => Math.sin(t * 5 - k * 2.2) * 0.08 * k;
      const x0 = x + (i / cols) * w, x1 = x + ((i + 1) / cols) * w;
      const y0 = y + 3.5 - (j / rows) * h, y1 = y + 3.5 - ((j + 1) / rows) * h;
      ctx.fillStyle = (i + j) % 2 ? '#111' : '#fff';
      ctx.beginPath();
      ctx.moveTo(x0, y0 + wave(i / cols)); ctx.lineTo(x1, y0 + wave((i + 1) / cols));
      ctx.lineTo(x1, y1 + wave((i + 1) / cols)); ctx.lineTo(x0, y1 + wave(i / cols));
      ctx.fill();
    }
  }

  private drawWater(level: Level, t: number) {
    const { ctx } = this;
    if (level.waterY < -35) return;
    const left = this.toWorld(0, 0).x - 2, right = this.toWorld(this.W, 0).x + 2;
    const bottom = this.toWorld(0, this.H).y - 2;
    const wy = level.waterY;
    const wave = (x: number) => Math.sin(x * 0.9 + t * 1.6) * 0.08 + Math.sin(x * 2.3 - t * 2.4) * 0.04;
    ctx.beginPath();
    ctx.moveTo(left, bottom);
    for (let x = left; x <= right; x += 0.5) ctx.lineTo(x, wy + wave(x));
    ctx.lineTo(right, bottom);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, wy, 0, wy - 14);
    g.addColorStop(0, 'rgba(46,140,190,0.72)');
    g.addColorStop(1, 'rgba(14,52,92,0.96)');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.65)';
    ctx.lineWidth = 0.08;
    ctx.beginPath();
    for (let x = left; x <= right; x += 0.5) (x === left ? ctx.moveTo(x, wy + wave(x)) : ctx.lineTo(x, wy + wave(x)));
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    for (let i = 0; i < 40; i++) {
      const gx = left + ((hash(i) * (right - left) + t * (0.3 + hash(i * 3) * 0.6)) % (right - left));
      ctx.fillRect(gx, wy - 0.4 - hash(i * 7) * 4, 0.6 + hash(i * 5), 0.04);
    }
  }

  // ---------------- members ----------------
  private member(ax: number, ay: number, bx: number, by: number, mat: MaterialId, sec: number, color: string | null, highlight = 0, alpha = 1) {
    const { ctx } = this;
    const M = MATERIALS[mat];
    const w = drawWidth(mat, sec);
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';
    if (highlight) {
      ctx.strokeStyle = highlight === 2 ? 'rgba(90,170,255,0.9)' : 'rgba(255,255,255,0.85)';
      ctx.lineWidth = w + 0.22;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    }
    if (mat === 'deck') {
      const len = Math.hypot(bx - ax, by - ay) || 1;
      let nx = -(by - ay) / len, ny = (bx - ax) / len;
      if (ny < 0) { nx = -nx; ny = -ny; }
      ctx.fillStyle = color ?? (sec === 0 ? '#8a6a46' : sec === 1 ? '#555b66' : '#8f949b');
      ctx.beginPath();
      ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
      ctx.lineTo(bx - nx * w, by - ny * w); ctx.lineTo(ax - nx * w, ay - ny * w);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = M.edge;
      ctx.lineWidth = 0.04;
      ctx.stroke();
      // wearing surface + guard rail
      ctx.strokeStyle = '#33373e';
      ctx.lineWidth = 0.1;
      ctx.beginPath(); ctx.moveTo(ax, ay - ny * 0.05); ctx.lineTo(bx, by - ny * 0.05); ctx.stroke();
      if (!color) {
        ctx.strokeStyle = 'rgba(205,210,216,0.85)';
        ctx.lineWidth = 0.05;
        ctx.beginPath(); ctx.moveTo(ax + nx * 0.85, ay + ny * 0.85); ctx.lineTo(bx + nx * 0.85, by + ny * 0.85); ctx.stroke();
        const n = Math.max(1, Math.round(len / 1));
        for (let i = 0; i <= n; i++) {
          const t = i / n, px = ax + (bx - ax) * t, py = ay + (by - ay) * t;
          ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + nx * 0.85, py + ny * 0.85); ctx.stroke();
        }
      }
    } else {
      ctx.strokeStyle = M.edge;
      ctx.lineWidth = w + 0.05;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      ctx.strokeStyle = color ?? M.color;
      ctx.lineWidth = w;
      ctx.stroke();
      if (!color && mat === 'steel') {
        ctx.strokeStyle = 'rgba(80,20,8,0.5)';
        ctx.lineWidth = w * 0.3;
        ctx.stroke();
      } else if (!color && mat === 'timber') {
        ctx.strokeStyle = 'rgba(255,220,170,0.22)';
        ctx.lineWidth = w * 0.25;
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  private joint(x: number, y: number, hl = false, size = 0.13) {
    const { ctx } = this;
    ctx.fillStyle = hl ? '#ffffff' : '#d9dde3';
    ctx.strokeStyle = '#2b2f36';
    ctx.lineWidth = 0.05;
    ctx.beginPath();
    ctx.arc(x, y, hl ? size + 0.05 : size, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  private memberColor(ov: Overlay, beamId: number, liveRatio?: number, liveForce?: number, cap?: number): string | null {
    if (ov.view === 'material') return null;
    if (liveRatio !== undefined) {
      if (ov.view === 'util') return utilColor(liveRatio);
      return forceColor(liveForce ?? 0, cap ?? 1);
    }
    const r = ov.analysis?.members.get(beamId);
    if (r) {
      if (ov.view === 'util') return utilColor(r.util);
      const N = r.NEdT / Math.max(1, r.NtRd) >= r.NEdC / Math.max(1, r.NcRd) ? r.NEdT : -r.NEdC;
      return forceColor(N, N > 0 ? r.NtRd : r.NcRd);
    }
    const pk = ov.peaks?.get(beamId);
    return pk !== undefined ? utilColor(pk) : null;
  }

  private drawDesign(d: Design, ov: Overlay) {
    const order: MaterialId[] = ['cable', 'timber', 'steel', 'deck'];
    for (const mat of order) {
      for (const b of d.beams) {
        if (b.mat !== mat) continue;
        const a = d.node(b.a)!, c = d.node(b.b)!;
        const hl = ov.selected.has(b.id) ? 2 : ov.hoverBeam === b.id ? 1 : 0;
        this.member(a.x, a.y, c.x, c.y, mat, b.sec, this.memberColor(ov, b.id), hl);
      }
    }
    for (const n of d.nodes) if (!n.anchor) this.joint(n.x, n.y, ov.hoverNode === n.id || ov.moveNode === n.id);
    if (ov.hoverNode !== null) {
      const n = d.node(ov.hoverNode);
      if (n?.anchor) {
        this.ctx.strokeStyle = '#fff';
        this.ctx.lineWidth = 0.06;
        this.ctx.beginPath(); this.ctx.arc(n.x, n.y, 0.4, 0, Math.PI * 2); this.ctx.stroke();
      }
    }
  }

  private drawAnalysisExtras(d: Design, an: AnalysisResult, ov: Overlay) {
    const { ctx } = this;
    if (!an.stable && an.mechanismNode !== null) {
      const n = d.node(an.mechanismNode);
      if (n) {
        const r = 0.45 + Math.sin(ov.time * 6) * 0.12;
        ctx.strokeStyle = '#ff4d4d';
        ctx.lineWidth = 0.1;
        ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(n.x, n.y, r + 0.3, 0, Math.PI * 2); ctx.globalAlpha = 0.4; ctx.stroke(); ctx.globalAlpha = 1;
      }
      return;
    }
    if (ov.view === 'material') return;
    // deflected shape (exaggerated)
    if (ov.shape && an.shape.size && an.deflection > 1e-5) {
      const scale = Math.min(200, 0.8 / an.deflection);
      ctx.save();
      ctx.setLineDash([0.18, 0.12]);
      ctx.strokeStyle = 'rgba(40,120,255,0.9)';
      ctx.lineWidth = 0.06;
      for (const b of d.beams) {
        const A = d.node(b.a)!, B = d.node(b.b)!;
        const ua = an.shape.get(A.id) ?? { dx: 0, dy: 0 }, ub = an.shape.get(B.id) ?? { dx: 0, dy: 0 };
        ctx.beginPath();
        ctx.moveTo(A.x + ua.dx * scale, A.y + ua.dy * scale);
        ctx.lineTo(B.x + ub.dx * scale, B.y + ub.dy * scale);
        ctx.stroke();
      }
      ctx.restore();
    }
    // reactions
    for (const r of an.reactions) {
      const n = d.node(r.nodeId)!;
      const mag = Math.hypot(r.Rx, r.Ry);
      if (mag < 100) continue;
      const len = Math.min(2.2, 0.6 + mag / 150000);
      const ux = r.Rx / mag, uy = r.Ry / mag;
      const sx = n.x - ux * (len + 0.35), sy = n.y - uy * (len + 0.35);
      const ex = n.x - ux * 0.35, ey = n.y - uy * 0.35;
      ctx.strokeStyle = '#18a35a';
      ctx.fillStyle = '#18a35a';
      ctx.lineWidth = 0.08;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - ux * 0.3 - uy * 0.15, ey - uy * 0.3 + ux * 0.15);
      ctx.lineTo(ex - ux * 0.3 + uy * 0.15, ey - uy * 0.3 - ux * 0.15);
      ctx.fill();
    }
  }

  private drawSpanDimension(level: Level) {
    const { ctx } = this;
    const a = level.anchors[0], b = level.anchors[1];
    const y = Math.min(a.y, b.y) - Math.min(2.2, (a.y - level.waterY) * 0.35);
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 0.035;
    ctx.beginPath();
    ctx.moveTo(a.x, y); ctx.lineTo(b.x, y);
    ctx.moveTo(a.x, y - 0.25); ctx.lineTo(a.x, y + 0.25);
    ctx.moveTo(b.x, y - 0.25); ctx.lineTo(b.x, y + 0.25);
    ctx.stroke();
    ctx.save();
    ctx.translate((a.x + b.x) / 2, y + 0.12);
    ctx.scale(1 / this.cam.zoom, -1 / this.cam.zoom);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '600 11px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`span ${level.span.toFixed(1)} m`, 0, 0);
    ctx.restore();
  }

  private drawForceLabels(d: Design, sim: Sim | null, ov: Overlay) {
    if (this.cam.zoom < 16) return;
    if (sim) {
      sim.members.forEach((m) => {
        if (m.broken || m.debris || m.mat === null) return;
        const a = sim.particles[m.a], b = sim.particles[m.b];
        if (Math.abs(m.force) < 1000) return;
        const s = this.toScreen((a.x + b.x) / 2, (a.y + b.y) / 2);
        const txt = ov.view === 'util' ? `${Math.round(m.ratio * 100)}%` : `${m.force > 0 ? '+' : '−'}${Math.abs(m.force / 1000).toFixed(0)}`;
        this.label(txt, s.x, s.y, '#fff', 'rgba(15,20,30,0.7)', 10);
      });
      return;
    }
    const an = ov.analysis;
    if (!an || !an.stable) return;
    for (const b of d.beams) {
      const r = an.members.get(b.id);
      if (!r) continue;
      const A = d.node(b.a)!, B = d.node(b.b)!;
      const s = this.toScreen((A.x + B.x) / 2, (A.y + B.y) / 2);
      let txt: string;
      if (ov.view === 'util') txt = r.mode === 'slack' ? 'slack' : `${Math.round(r.util * 100)}%`;
      else {
        const N = r.NEdT / Math.max(1, r.NtRd) >= r.NEdC / Math.max(1, r.NcRd) ? r.NEdT : -r.NEdC;
        txt = `${N >= 0 ? '+' : '−'}${Math.abs(N / 1000).toFixed(0)}`;
      }
      const bad = r.util > 1;
      this.label(txt, s.x, s.y, bad ? '#ffd0d0' : '#fff', bad ? 'rgba(140,20,20,0.85)' : 'rgba(15,20,30,0.72)', 10);
    }
  }

  private drawSimBridge(sim: Sim, ov: Overlay) {
    const P = sim.particles;
    const order: MaterialId[] = ['cable', 'timber', 'steel', 'deck'];
    for (const mat of order) {
      sim.members.forEach((m, i) => {
        if (m.broken || m.mat !== mat) return;
        const a = P[m.a], b = P[m.b];
        const color = m.debris ? null : this.memberColor(ov, m.designId, m.ratio, m.force, m.force >= 0 ? m.Nt : m.Nc);
        this.member(a.x, a.y, b.x, b.y, mat, m.sec, color, ov.hoverBeam === i ? 1 : 0, m.debris ? 0.9 : 1);
      });
    }
    const joined = new Set<number>();
    for (const m of sim.members) {
      if (m.broken || m.mat === null) continue;
      joined.add(m.a);
      if (!m.debris) joined.add(m.b);
    }
    for (const [, pi] of sim.nodeIndex) {
      const p = P[pi];
      if (!p.anchor && joined.has(pi)) this.joint(p.x, p.y);
    }
  }

  private drawAnchors(level: Level) {
    const { ctx } = this;
    for (const a of level.anchors) {
      ctx.fillStyle = '#e3402f';
      ctx.strokeStyle = '#6d140b';
      ctx.lineWidth = 0.06;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(a.x - 0.3, a.y - 0.42);
      ctx.lineTo(a.x + 0.3, a.y - 0.42);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#6d140b';
      ctx.beginPath();
      for (let k = -2; k <= 2; k++) { ctx.moveTo(a.x + k * 0.13, a.y - 0.42); ctx.lineTo(a.x + k * 0.13 - 0.1, a.y - 0.55); }
      ctx.stroke();
      ctx.fillStyle = '#ffd8d2';
      ctx.beginPath(); ctx.arc(a.x, a.y, 0.11, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  }

  private drawPreview(p: NonNullable<Overlay['preview']>) {
    const { ctx } = this;
    ctx.save();
    ctx.setLineDash([0.18, 0.14]);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 0.04;
    ctx.beginPath(); ctx.arc(p.ax, p.ay, p.maxLen, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    this.member(p.ax, p.ay, p.bx, p.by, p.mat, p.sec, p.valid ? null : '#e04848', 0, 0.75);
    this.joint(p.bx, p.by, true);
  }

  private drawGuide(segs: Overlay['guide'], t: number) {
    const { ctx } = this;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.setLineDash([0.28, 0.2]);
    ctx.lineDashOffset = -t * 0.8;
    ctx.strokeStyle = `rgba(90,170,255,${0.65 + Math.sin(t * 4) * 0.25})`;
    ctx.lineWidth = 0.12;
    for (const s of segs) { ctx.beginPath(); ctx.moveTo(s.ax, s.ay); ctx.lineTo(s.bx, s.by); ctx.stroke(); }
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(90,170,255,0.9)';
    const pts = new Set<string>();
    for (const s of segs) { pts.add(`${s.ax},${s.ay}`); pts.add(`${s.bx},${s.by}`); }
    for (const k of pts) {
      const [x, y] = k.split(',').map(Number);
      ctx.beginPath(); ctx.arc(x, y, 0.1 + Math.sin(t * 4) * 0.03, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  private drawLoadGhost(l: { x: number; y: number; mass: number }) {
    const s = 0.3 + Math.cbrt(l.mass / 2400) * 0.45;
    this.ctx.globalAlpha = 0.5;
    this.block(l.x, l.y, s, l.mass);
    this.ctx.globalAlpha = 1;
    this.ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    this.ctx.setLineDash([0.2, 0.2]);
    this.ctx.lineWidth = 0.04;
    this.ctx.beginPath(); this.ctx.moveTo(l.x, l.y - s); this.ctx.lineTo(l.x, l.y - 30); this.ctx.stroke();
    this.ctx.setLineDash([]);
  }

  private block(x: number, y: number, r: number, mass: number) {
    const { ctx } = this;
    ctx.fillStyle = '#a3a7ad';
    ctx.strokeStyle = '#4b5058';
    ctx.lineWidth = 0.05;
    ctx.beginPath(); ctx.roundRect(x - r, y - r, r * 2, r * 2, 0.08); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fillRect(x - r, y - r, r * 2, r * 0.4);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1 / 40, -1 / 40);
    ctx.fillStyle = '#1d2026';
    ctx.font = `800 ${Math.round(r * 22)}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${(mass / 1000).toFixed(0)}t`, 0, 0);
    ctx.restore();
  }

  private drawLoads(sim: Sim) {
    for (const l of sim.loads) {
      const p = sim.particles[l.p];
      if (!p.dead) this.block(p.x, p.y, p.r, l.mass);
    }
  }

  // ---------------- vehicles ----------------
  private drawParkedTraffic(level: Level) {
    const shown = new Set<number>();
    level.vehicles.forEach((v, i) => {
      const dir = v.dir ?? 1;
      if (shown.has(dir)) return;
      shown.add(dir);
      const V = VEHICLES[v.kind];
      const spawn = dir === 1 ? level.spawnL : level.spawnR;
      const rear = spawn.x - (dir * V.length) / 2;
      const wheels = V.axles.map((a) => ({ x: rear + dir * a.x, y: spawn.y + V.wheelR }));
      this.drawVehicle(v.kind, wheels, dir, 0, false);
      void i;
    });
    this.drawFlag(level.anchors[1].x + 7, level.anchors[1].y, performance.now() / 1000);
  }

  private drawSimVehicles(sim: Sim, lane: 1 | -1, ov: Overlay) {
    for (const v of sim.vehicles) {
      if (v.removed || v.dir !== lane) continue;
      const wheels = v.wheels.map((i) => sim.particles[i]);
      const spin = sim.particles[v.wheels[0]].spin;
      if (lane === -1) this.ctx.globalAlpha = 0.92;
      this.drawVehicle(v.kind, wheels, v.dir, spin, ov.driving === v.id, sim.particles[v.body[0]], sim.particles[v.body[1]]);
      this.ctx.globalAlpha = 1;
    }
  }

  drawVehicle(kind: VehicleKind, wheels: Vec[], dir: number, spin: number, driven: boolean, b0?: Vec, b1?: Vec) {
    const { ctx } = this;
    const V = VEHICLES[kind];
    const first = wheels[0], last = wheels[wheels.length - 1];
    // local +x runs rear → front along the axle line
    const ang = Math.atan2(last.y - first.y, last.x - first.x);
    const ax0 = V.axles[0].x;
    let lift = 0;
    if (b0 && b1) {
      const mid = { x: (b0.x + b1.x) / 2, y: (b0.y + b1.y) / 2 };
      const wm = { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 };
      lift = ((mid.y - wm.y) - (V.height - V.wheelR) * 0.7) * 0.6;
    }
    ctx.save();
    ctx.translate(first.x, first.y);
    ctx.rotate(ang);
    if (dir < 0) ctx.scale(1, -1);
    ctx.translate(-ax0, lift);
    const L = V.length, H = V.height, r = V.wheelR;
    const y0 = -r * 0.3;
    const body = V.color, dark = shade(body, -0.35), glass = '#bfe3f7';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 0.05;
    ctx.strokeStyle = dark;
    ctx.fillStyle = body;
    switch (kind) {
      case 'car': {
        ctx.beginPath();
        ctx.moveTo(0, y0 + 0.2); ctx.lineTo(0, y0 + 0.75);
        ctx.quadraticCurveTo(0.1, y0 + 0.9, 0.7, y0 + 0.92);
        ctx.lineTo(1.25, y0 + H - 0.05); ctx.lineTo(2.75, y0 + H - 0.05);
        ctx.lineTo(3.45, y0 + 0.92);
        ctx.quadraticCurveTo(L, y0 + 0.85, L, y0 + 0.5); ctx.lineTo(L, y0 + 0.2);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = glass;
        ctx.beginPath();
        ctx.moveTo(0.9, y0 + 0.97); ctx.lineTo(1.35, y0 + H - 0.16); ctx.lineTo(1.95, y0 + H - 0.16); ctx.lineTo(1.95, y0 + 0.97); ctx.closePath();
        ctx.moveTo(2.07, y0 + 0.97); ctx.lineTo(2.07, y0 + H - 0.16); ctx.lineTo(2.68, y0 + H - 0.16); ctx.lineTo(3.25, y0 + 0.97); ctx.closePath();
        ctx.fill();
        break;
      }
      case 'pickup': {
        ctx.beginPath();
        ctx.moveTo(0, y0 + 0.25); ctx.lineTo(0, y0 + 1.05); ctx.lineTo(2.2, y0 + 1.05); ctx.lineTo(2.3, y0 + H - 0.05);
        ctx.lineTo(3.7, y0 + H - 0.05); ctx.lineTo(4.25, y0 + 1.1); ctx.lineTo(L, y0 + 1.0); ctx.lineTo(L, y0 + 0.25);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = glass;
        ctx.beginPath(); ctx.moveTo(2.45, y0 + 1.12); ctx.lineTo(2.5, y0 + H - 0.18); ctx.lineTo(3.6, y0 + H - 0.18); ctx.lineTo(4.05, y0 + 1.12); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#7a5a36';
        ctx.fillRect(0.15, y0 + 1.05, 1.9, 0.35);
        break;
      }
      case 'van': {
        ctx.beginPath();
        ctx.moveTo(0, y0 + 0.2); ctx.lineTo(0, y0 + H - 0.1); ctx.lineTo(L - 1.2, y0 + H - 0.1);
        ctx.lineTo(L - 0.25, y0 + 1.1); ctx.lineTo(L, y0 + 0.2); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = glass;
        ctx.beginPath(); ctx.moveTo(L - 1.25, y0 + H - 0.25); ctx.lineTo(L - 0.45, y0 + 1.2); ctx.lineTo(L - 1.25, y0 + 1.2); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fillRect(0.4, y0 + 1.1, L - 2.0, 0.5);
        break;
      }
      case 'bus': {
        ctx.beginPath(); ctx.roundRect(0, y0 + 0.2, L, H - 0.15, 0.35); ctx.fill(); ctx.stroke();
        ctx.fillStyle = glass;
        for (let i = 0; i < 8; i++) ctx.fillRect(0.5 + i * 1.3, y0 + 1.45, 1.1, H - 1.95);
        ctx.fillRect(L - 0.3, y0 + 1.0, 0.25, H - 1.4);
        ctx.fillStyle = '#f5f5f0';
        ctx.fillRect(0, y0 + 1.15, L, 0.14);
        break;
      }
      case 'dd': {
        ctx.beginPath(); ctx.roundRect(0, y0 + 0.2, L, H - 0.15, [0.3, 0.3, 0.55, 0.55]); ctx.fill(); ctx.stroke();
        ctx.fillStyle = glass;
        for (let i = 0; i < 7; i++) ctx.fillRect(0.5 + i * 1.4, y0 + 1.25, 1.2, 1.0);
        for (let i = 0; i < 7; i++) ctx.fillRect(0.5 + i * 1.4, y0 + 2.75, 1.2, 1.05);
        ctx.fillRect(L - 0.3, y0 + 1.2, 0.25, 1.1);
        ctx.fillStyle = '#f2d16b';
        ctx.fillRect(0, y0 + 2.42, L, 0.12);
        break;
      }
      case 'train': {
        // two coaches with a gangway between them
        const car = (x0: number, x1: number, noseL: boolean, noseR: boolean) => {
          ctx.fillStyle = body;
          ctx.beginPath();
          ctx.moveTo(x0 + (noseL ? 1.4 : 0), y0 + H - 0.1);
          ctx.lineTo(x1 - (noseR ? 1.4 : 0), y0 + H - 0.1);
          if (noseR) ctx.quadraticCurveTo(x1, y0 + H - 0.4, x1, y0 + 1.0); else ctx.lineTo(x1, y0 + H - 0.1);
          ctx.lineTo(x1, y0 + 0.4); ctx.lineTo(x0, y0 + 0.4);
          if (noseL) ctx.lineTo(x0, y0 + 1.0), ctx.quadraticCurveTo(x0, y0 + H - 0.4, x0 + 1.4, y0 + H - 0.1); else ctx.lineTo(x0, y0 + H - 0.1);
          ctx.closePath(); ctx.fill(); ctx.stroke();
          ctx.fillStyle = '#2f5fb3';
          ctx.fillRect(x0 + 0.2, y0 + 0.75, x1 - x0 - 0.4, 0.3);
          ctx.fillStyle = glass;
          for (let x = x0 + 1.6; x < x1 - 1.9; x += 1.5) ctx.fillRect(x, y0 + 1.75, 1.1, 0.9);
          ctx.fillStyle = '#2b2f36';
          ctx.fillRect(x0 + 0.6, y0 + 0.15, x1 - x0 - 1.2, 0.3);
        };
        car(0, 11.8, true, false);
        car(12.2, L, false, true);
        ctx.fillStyle = '#3a3f47';
        ctx.fillRect(11.8, y0 + 0.9, 0.4, H - 1.4);
        break;
      }
      case 'haul': {
        // low-loader trailer carrying a transformer, pulled by a heavy tractor unit
        const cab = 2.4, deckTop = y0 + 0.75;
        ctx.fillStyle = '#2b2f36';
        ctx.fillRect(0, y0 + 0.25, 6.4, 0.5);
        ctx.beginPath(); ctx.moveTo(6.4, y0 + 0.25); ctx.lineTo(6.4, deckTop); ctx.lineTo(7.4, y0 + 1.25); ctx.lineTo(10.6, y0 + 1.25); ctx.lineTo(10.6, y0 + 0.9); ctx.lineTo(7.6, y0 + 0.9); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#5d6b78';
        ctx.beginPath(); ctx.roundRect(0.4, deckTop, 5.6, H - 1.0, 0.12); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#46525e';
        for (let i = 0; i < 6; i++) ctx.fillRect(0.7 + i * 0.9, deckTop + 0.3, 0.45, H - 1.6);
        ctx.fillStyle = '#ffcf33';
        ctx.fillRect(0.4, deckTop + H - 1.15, 5.6, 0.15);
        ctx.fillStyle = '#2b2f36';
        ctx.fillRect(10.2, y0 + 0.2, L - 10.2, 0.45);
        ctx.fillStyle = body;
        ctx.beginPath();
        ctx.moveTo(L - cab, y0 + 0.2); ctx.lineTo(L - cab, y0 + H - 0.4); ctx.lineTo(L - 0.5, y0 + H - 0.4);
        ctx.lineTo(L, y0 + 1.5); ctx.lineTo(L, y0 + 0.2); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = glass;
        ctx.beginPath(); ctx.moveTo(L - cab + 0.2, y0 + H - 0.6); ctx.lineTo(L - 0.58, y0 + H - 0.6); ctx.lineTo(L - 0.12, y0 + 1.6); ctx.lineTo(L - cab + 0.2, y0 + 1.6); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#ffcf33';
        ctx.fillRect(L - cab + 0.3, y0 + H - 0.4, 1.2, 0.18);
        break;
      }
      case 'hgv':
      case 'design': {
        const cab = 2.3;
        // chassis
        ctx.fillStyle = '#2b2f36';
        ctx.fillRect(0, y0 + 0.2, L, 0.4);
        if (kind === 'hgv') {
          ctx.fillStyle = '#c7a24a';
          ctx.beginPath();
          ctx.moveTo(0.1, y0 + 0.6); ctx.lineTo(0, y0 + H - 0.2); ctx.lineTo(L - cab - 0.2, y0 + H - 0.2); ctx.lineTo(L - cab - 0.3, y0 + 0.6); ctx.closePath();
          ctx.fill(); ctx.stroke();
          ctx.fillStyle = '#8b6a3a';
          ctx.beginPath(); ctx.ellipse((L - cab) / 2, y0 + H - 0.2, (L - cab) / 2 - 0.4, 0.45, 0, 0, Math.PI); ctx.fill();
        } else {
          ctx.fillStyle = '#e8e6e1';
          ctx.beginPath(); ctx.roundRect(0, y0 + 0.6, L - cab - 0.3, H - 0.7, 0.08); ctx.fill(); ctx.stroke();
          ctx.fillStyle = '#7d58c9';
          ctx.fillRect(0, y0 + 1.6, L - cab - 0.3, 0.3);
        }
        ctx.fillStyle = body;
        ctx.beginPath();
        ctx.moveTo(L - cab, y0 + 0.2); ctx.lineTo(L - cab, y0 + H - 0.1); ctx.lineTo(L - 0.5, y0 + H - 0.1);
        ctx.lineTo(L, y0 + 1.5); ctx.lineTo(L, y0 + 0.2); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = glass;
        ctx.beginPath(); ctx.moveTo(L - cab + 0.2, y0 + H - 0.3); ctx.lineTo(L - 0.58, y0 + H - 0.3); ctx.lineTo(L - 0.12, y0 + 1.6); ctx.lineTo(L - cab + 0.2, y0 + 1.6); ctx.closePath(); ctx.fill();
        break;
      }
    }
    ctx.fillStyle = '#ffe9a0';
    ctx.fillRect(L - 0.1, y0 + 0.55, 0.1, 0.16);
    ctx.fillStyle = '#d0302a';
    ctx.fillRect(0, y0 + 0.55, 0.08, 0.16);
    if (driven) {
      ctx.fillStyle = '#5aaaff';
      ctx.beginPath();
      const mx = L / 2, my = y0 + H + 0.6;
      ctx.moveTo(mx, my); ctx.lineTo(mx - 0.35, my + 0.5); ctx.lineTo(mx + 0.35, my + 0.5); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    for (const w of wheels) this.wheel(w.x, w.y, r, spin, kind === 'hgv' || kind === 'design' || kind === 'bus' || kind === 'haul' || kind === 'dd' || kind === 'train');
  }

  private wheel(x: number, y: number, r: number, spin: number, heavy: boolean) {
    const { ctx } = this;
    ctx.fillStyle = '#1b1d21';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = heavy ? '#8d939b' : '#b8bec6';
    ctx.beginPath(); ctx.arc(x, y, r * 0.55, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#5c636c';
    ctx.lineWidth = r * 0.1;
    for (let k = 0; k < (heavy ? 8 : 5); k++) {
      const a = spin + (k * Math.PI * 2) / (heavy ? 8 : 5);
      ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * r * 0.2, y + Math.sin(a) * r * 0.2); ctx.lineTo(x + Math.cos(a) * r * 0.5, y + Math.sin(a) * r * 0.5); ctx.stroke();
    }
    ctx.fillStyle = '#2b2f36';
    ctx.beginPath(); ctx.arc(x, y, r * 0.14, 0, Math.PI * 2); ctx.fill();
  }

  // ---------------- particles ----------------
  burst(x: number, y: number, mat: MaterialId | null | undefined) {
    const n = mat === 'cable' ? 8 : 18;
    const steel = mat === 'steel' || mat === 'cable';
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 5;
      this.fx.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + 2,
        life: 0, max: 0.6 + Math.random() * 0.8, size: 0.05 + Math.random() * 0.1,
        color: steel ? (i % 2 ? '#ffd27a' : '#fff3c4') : mat === 'deck' ? '#6b6f78' : '#c48a4f',
        kind: steel && i % 2 ? 'spark' : 'chip', rot: Math.random() * 6, vr: (Math.random() - 0.5) * 20,
      });
    }
    for (let i = 0; i < 6; i++) {
      this.fx.push({ x, y, vx: (Math.random() - 0.5) * 1.5, vy: Math.random() * 1.2, life: 0, max: 1 + Math.random(), size: 0.25 + Math.random() * 0.3, color: 'rgba(200,190,175,', kind: 'dust', rot: 0, vr: 0 });
    }
    this.shake = Math.min(10, this.shake + 3);
  }

  splash(x: number, y: number, big = false) {
    const n = big ? 34 : 10;
    for (let i = 0; i < n; i++) {
      const a = Math.PI / 2 + (Math.random() - 0.5) * 1.6, sp = (big ? 4 : 2) + Math.random() * (big ? 6 : 3);
      this.fx.push({ x: x + (Math.random() - 0.5) * (big ? 2 : 0.6), y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: 0.8 + Math.random() * 0.6, size: 0.06 + Math.random() * 0.1, color: '#e8f6ff', kind: 'drop', rot: 0, vr: 0 });
    }
  }

  private updateDrawFx(dt: number, waterY: number) {
    const { ctx } = this;
    for (const p of this.fx) {
      p.life += dt;
      if (p.kind !== 'dust') p.vy -= 9.81 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      if (p.kind === 'drop' && p.y < waterY && p.vy < 0) p.life = p.max;
      const k = 1 - p.life / p.max;
      if (k <= 0) continue;
      if (p.kind === 'dust') {
        ctx.fillStyle = p.color + (0.35 * k).toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (2 - k), 0, Math.PI * 2); ctx.fill();
      } else if (p.kind === 'spark') {
        ctx.strokeStyle = p.color;
        ctx.globalAlpha = k;
        ctx.lineWidth = 0.04;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03); ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (p.kind === 'drop') {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = Math.min(1, k * 1.5);
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      } else {
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.globalAlpha = Math.min(1, k * 2);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size, -p.size * 0.4, p.size * 2, p.size * 0.8);
        ctx.restore();
      }
    }
    this.fx = this.fx.filter((p) => p.life < p.max);
  }
}
