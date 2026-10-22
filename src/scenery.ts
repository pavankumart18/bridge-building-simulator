/**
 * Place-specific backdrops for the Landmark (and mountain) projects: skylines, snowy ranges, fog,
 * plus the sky / water / rock palettes that go with them. Drawn in screen space with parallax.
 */
import { rng } from './levels';

export type Theme = 'default' | 'himalaya' | 'london' | 'nyc' | 'sf';

export interface Palette {
  sky: [string, string, string];
  water: [string, string];
  rockTint: string | null;
  masonry: boolean;
  haze: string;
}

export const PALETTES: Record<Theme, Palette> = {
  default: { sky: ['#4f9ee0', '#bfe0f5', '#f3e6cf'], water: ['rgba(46,140,190,0.72)', 'rgba(14,52,92,0.96)'], rockTint: null, masonry: false, haze: '240,235,220' },
  himalaya: { sky: ['#2a6fc6', '#bcdcf4', '#eef3f6'], water: ['rgba(70,170,170,0.75)', 'rgba(16,70,80,0.96)'], rockTint: 'rgba(110,115,122,0.5)', masonry: false, haze: '225,235,245' },
  london: { sky: ['#7f97ad', '#c9d2d9', '#e6e3dc'], water: ['rgba(96,110,96,0.8)', 'rgba(40,48,40,0.97)'], rockTint: null, masonry: true, haze: '215,218,220' },
  nyc: { sky: ['#3b7cc6', '#cfe0ee', '#f4dcbc'], water: ['rgba(60,110,140,0.78)', 'rgba(18,40,62,0.97)'], rockTint: null, masonry: true, haze: '240,226,205' },
  sf: { sky: ['#5f9fd6', '#d6e6f0', '#eef1f2'], water: ['rgba(40,120,140,0.75)', 'rgba(10,46,66,0.97)'], rockTint: 'rgba(120,100,70,0.25)', masonry: false, haze: '238,242,245' },
};

export interface ParallaxView { W: number; H: number; camX: number; camY: number; zoom: number }

/** world→screen for a parallax layer, matching the renderer's mountain layers */
function layer(v: ParallaxView, f: number, baseWorldY: number) {
  const z = v.zoom * f + 4;
  const baseY = v.H / 2 + (v.camY - baseWorldY) * z;
  const sx = (wx: number) => (wx - v.camX * f * 1.4) * z + v.W / 2;
  return { z, baseY, sx };
}

interface Bldg { x: number; w: number; h: number; kind: string }

function cityBlocks(seed: number, from: number, to: number, hMin: number, hMax: number): Bldg[] {
  const r = rng(seed);
  const out: Bldg[] = [];
  for (let x = from; x < to;) {
    const w = 2.2 + r() * 3.5;
    out.push({ x, w, h: hMin + r() * r() * (hMax - hMin), kind: 'block' });
    x += w + 0.15 + r() * 0.6;
  }
  return out;
}

function drawBuilding(ctx: CanvasRenderingContext2D, b: Bldg, L: ReturnType<typeof layer>, col: string, win: string, seed: number) {
  const x0 = L.sx(b.x), x1 = L.sx(b.x + b.w), y0 = L.baseY, top = y0 - b.h * L.z * 0.5, w = x1 - x0, h = y0 - top;
  ctx.fillStyle = col;
  ctx.beginPath();
  switch (b.kind) {
    case 'shard': // The Shard: tall glass pyramid
      ctx.moveTo(x0, y0); ctx.lineTo(x0 + w * 0.42, top); ctx.lineTo(x0 + w * 0.5, top - h * 0.04); ctx.lineTo(x1, y0); break;
    case 'gherkin': // 30 St Mary Axe
      ctx.moveTo(x0, y0); ctx.bezierCurveTo(x0 - w * 0.1, y0 - h * 0.6, x0 + w * 0.2, top, x0 + w / 2, top);
      ctx.bezierCurveTo(x1 - w * 0.2, top, x1 + w * 0.1, y0 - h * 0.6, x1, y0); break;
    case 'stpauls': { // drum + dome + lantern
      ctx.rect(x0, y0 - h * 0.45, w, h * 0.45);
      ctx.moveTo(x0 + w * 0.15, y0 - h * 0.45); ctx.arc(x0 + w / 2, y0 - h * 0.45, w * 0.35, Math.PI, 0); ctx.closePath();
      ctx.rect(x0 + w * 0.45, top, w * 0.1, h * 0.22);
      break;
    }
    case 'empire': { // stepped setbacks + mast
      const steps = [[0, 0.5], [0.12, 0.72], [0.25, 0.86], [0.38, 0.93]];
      for (const [inset, hh] of steps) ctx.rect(x0 + w * inset, y0 - h * hh, w * (1 - 2 * inset), h * hh);
      ctx.rect(x0 + w * 0.47, top, w * 0.06, h * 0.1);
      break;
    }
    case 'chrysler': {
      ctx.rect(x0, y0 - h * 0.7, w, h * 0.7);
      ctx.moveTo(x0 + w * 0.15, y0 - h * 0.7);
      for (let i = 0; i < 4; i++) { const k = i / 4; ctx.lineTo(x0 + w * (0.15 + k * 0.3), y0 - h * (0.7 + k * 0.22)); }
      ctx.lineTo(x0 + w / 2, top); ctx.lineTo(x0 + w * 0.85 - 0.01, y0 - h * 0.7); ctx.closePath();
      break;
    }
    case 'wtc': // One World Trade Center: chamfered taper + spire
      ctx.moveTo(x0, y0); ctx.lineTo(x0 + w * 0.12, y0 - h * 0.85); ctx.lineTo(x1 - w * 0.12, y0 - h * 0.85); ctx.lineTo(x1, y0); ctx.closePath();
      ctx.rect(x0 + w * 0.48, top, w * 0.04, h * 0.15); break;
    case 'transamerica':
      ctx.moveTo(x0, y0); ctx.lineTo(x0 + w / 2, top); ctx.lineTo(x1, y0); ctx.closePath(); break;
    case 'salesforce':
      ctx.moveTo(x0, y0); ctx.lineTo(x0 + w * 0.05, top + w * 0.5); ctx.quadraticCurveTo(x0 + w / 2, top - w * 0.2, x1 - w * 0.05, top + w * 0.5); ctx.lineTo(x1, y0); ctx.closePath(); break;
    default:
      ctx.rect(x0, top, w, h);
  }
  ctx.fill();
  // lit windows on ordinary blocks
  if (b.kind === 'block' && w > 6 && h > 14) {
    const r = rng(seed + Math.round(b.x * 10));
    ctx.fillStyle = win;
    for (let yy = top + 4; yy < y0 - 4; yy += 6) for (let xx = x0 + 3; xx < x1 - 3; xx += 5) if (r() < 0.3) ctx.fillRect(xx, yy, 2, 2.5);
  }
}

/** skyline, peaks or headlands behind the river */
export function drawBackdrop(ctx: CanvasRenderingContext2D, theme: Theme, v: ParallaxView, waterY: number, seed: number, deckY = 0) {
  if (theme === 'himalaya') {
    // ranges rise from the horizon at road level, not from the river deep in the gorge
    const base = Math.max(waterY + 3, deckY - 5);
    // two snowy ranges with sharp ridgelines
    for (const [f, hh, col, snowAt] of [[0.12, 70, '#9aaabb', 0.95], [0.22, 46, '#7d8f9f', 1.08]] as [number, number, string, number][]) {
      const L = layer(v, f, base);
      const tri = (p: number) => 1 - Math.abs((((p % 1) + 1) % 1) * 2 - 1);
      const ridge = (x: number) => {
        const wx = (x - v.W / 2) / L.z + v.camX * f * 1.4;
        const y = 0.55 * tri(wx * 0.045 + seed * 0.37) + 0.3 * tri(wx * 0.11 + seed * 0.71) + 0.15 * tri(wx * 0.29);
        return L.baseY - (0.25 + y) * hh * L.z * 0.5;
      };
      const rg = ctx.createLinearGradient(0, L.baseY - hh * L.z * 0.62, 0, L.baseY);
      rg.addColorStop(0, col); rg.addColorStop(1, '#c4d2de');
      ctx.fillStyle = rg;
      ctx.beginPath(); ctx.moveTo(0, v.H);
      for (let x = 0; x <= v.W + 6; x += 6) ctx.lineTo(x, ridge(x));
      ctx.lineTo(v.W, v.H); ctx.closePath(); ctx.fill();
      // snow above the snowline, following the ridge
      ctx.save(); ctx.clip();
      const snowY = L.baseY - hh * L.z * 0.5 * snowAt;
      ctx.fillStyle = 'rgba(250,252,255,0.92)';
      ctx.beginPath(); ctx.moveTo(0, snowY);
      for (let x = 0; x <= v.W + 10; x += 10) ctx.lineTo(x, snowY + Math.sin(x * 0.09 + seed) * 6 + Math.sin(x * 0.23) * 4);
      ctx.lineTo(v.W, 0); ctx.lineTo(0, 0); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    // forested foothills with pines
    const L = layer(v, 0.45, base - 7);
    ctx.fillStyle = '#6d8a78';
    ctx.beginPath(); ctx.moveTo(0, v.H);
    for (let x = 0; x <= v.W + 8; x += 8) { const wx = (x - v.W / 2) / L.z + v.camX * 0.63; ctx.lineTo(x, L.baseY - (Math.sin(wx * 0.07 + seed) * 0.5 + 0.8) * 9 * L.z * 0.5); }
    ctx.lineTo(v.W, v.H); ctx.closePath(); ctx.fill();
    return;
  }
  if (theme === 'sf') {
    // Marin headlands on the right, the city on the left, a fog bank rolling in
    const H = layer(v, 0.3, waterY + 1);
    ctx.fillStyle = '#8a9a6a';
    ctx.beginPath(); ctx.moveTo(v.W * 0.45, v.H);
    for (let x = v.W * 0.45; x <= v.W + 8; x += 8) { const k = (x - v.W * 0.45) / (v.W * 0.55); ctx.lineTo(x, H.baseY - Math.sin(k * Math.PI * 0.9 + 0.2) * 22 * H.z * 0.5 - Math.sin(x * 0.03) * 6); }
    ctx.lineTo(v.W, v.H); ctx.closePath(); ctx.fill();
    const L = layer(v, 0.32, waterY + 1.5);
    const city: Bldg[] = [...cityBlocks(seed, -150, -40, 4, 16), { x: -95, w: 4, h: 30, kind: 'transamerica' }, { x: -78, w: 5, h: 34, kind: 'salesforce' }];
    for (const b of city) drawBuilding(ctx, b, L, '#9aa6b2', 'rgba(255,240,200,0.5)', seed);
    const fog = ctx.createLinearGradient(0, L.baseY - 60, 0, L.baseY + 10);
    fog.addColorStop(0, 'rgba(245,247,250,0)'); fog.addColorStop(0.6, 'rgba(245,247,250,0.75)'); fog.addColorStop(1, 'rgba(245,247,250,0.35)');
    ctx.fillStyle = fog; ctx.fillRect(0, L.baseY - 60, v.W, 70);
    return;
  }
  if (theme === 'london' || theme === 'nyc') {
    const far = layer(v, 0.18, waterY + 2), near = layer(v, 0.3, waterY + 1.2);
    const london = theme === 'london';
    const farB = cityBlocks(seed + 1, -160, 220, london ? 5 : 10, london ? 14 : 34);
    for (const b of farB) drawBuilding(ctx, b, far, london ? '#b2b9c0' : '#a9b6c4', 'rgba(255,255,255,0.0)', seed);
    const icons: Bldg[] = london
      ? [{ x: -40, w: 6, h: 62, kind: 'shard' }, { x: 60, w: 4.5, h: 34, kind: 'gherkin' }, { x: 20, w: 9, h: 26, kind: 'stpauls' }]
      : [{ x: -30, w: 6, h: 70, kind: 'empire' }, { x: 8, w: 4.5, h: 58, kind: 'chrysler' }, { x: 70, w: 7, h: 86, kind: 'wtc' }];
    const nearB = [...cityBlocks(seed + 2, -170, 230, london ? 4 : 8, london ? 12 : 30).filter((b) => !icons.some((i) => b.x < i.x + i.w && b.x + b.w > i.x)), ...icons];
    for (const b of nearB) drawBuilding(ctx, b, near, london ? '#8d969f' : '#7f8d9c', london ? 'rgba(255,236,190,0.45)' : 'rgba(255,240,200,0.55)', seed);
  }
}
