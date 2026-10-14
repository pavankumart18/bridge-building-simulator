/** Diagrammatic SVG of the 16 m bridge: static force colours, or a live dynamic simulation. Zoomable. */
import type { Bridge } from './model';
import { TRUCK } from './model';
import type { Sim } from '../physics';
import { VEHICLES, type VehicleType } from '../vehicles';

export interface DrawOpts {
  forces?: Map<number, number> | null; // N, + tension
  maxForce?: number;
  truckRear?: number | null;
  vehicle?: VehicleType;
  axles?: { x: number; P: number }[] | null;
  reactions?: { x: number; Ry: number }[] | null;
  focus?: number[] | null;
  labels?: boolean;
  removable?: boolean;
  removed?: Set<number>;
}

const VB = { x0: -7, x1: 23, y0: -5.2, y1: 6.2 };
const sy = (y: number) => -y;

export interface BridgeView {
  draw(b: Bridge, o: DrawOpts): void;
  drawSim(sim: Sim, b: Bridge, removed: Set<number>, maxForce: number): void;
  onMemberClick: ((beamId: number) => void) | null;
}

export function bridgeSvg(host: HTMLElement, zoomable = true): BridgeView {
  host.classList.add('bhost');
  host.innerHTML = `<div class="bwrap"><svg class="bsvg" role="img" aria-label="Diagram of the 16 m truss bridge"></svg>
    ${zoomable ? `<div class="bzoom"><button data-z="in" title="Zoom in">+</button><button data-z="out" title="Zoom out">−</button><button data-z="fit" title="Reset view">⤢</button></div>` : ''}</div>
    <div class="b-legend"></div><div class="b-tip"></div>`;
  const svg = host.querySelector('svg')!;
  const tip = host.querySelector<HTMLDivElement>('.b-tip')!;
  // view state (zoom around centre, drag to pan)
  const cam = { cx: (VB.x0 + VB.x1) / 2, cy: -(VB.y0 + VB.y1) / 2, z: 1 };
  const apply = () => {
    const w = (VB.x1 - VB.x0) / cam.z, h = (VB.y1 - VB.y0) / cam.z;
    svg.setAttribute('viewBox', `${cam.cx - w / 2} ${cam.cy - h / 2} ${w} ${h}`);
    host.classList.toggle('zoomed', cam.z > 1.01);
  };
  apply();
  const zoom = (f: number, px = 0.5, py = 0.5) => {
    const w = (VB.x1 - VB.x0) / cam.z, h = (VB.y1 - VB.y0) / cam.z;
    const fx = cam.cx - w / 2 + px * w, fy = cam.cy - h / 2 + py * h;
    const nz = Math.max(1, Math.min(6, cam.z * f));
    const k = cam.z / nz;
    cam.cx = fx + (cam.cx - fx) * k;
    cam.cy = fy + (cam.cy - fy) * k;
    cam.z = nz;
    if (nz === 1) { cam.cx = (VB.x0 + VB.x1) / 2; cam.cy = -(VB.y0 + VB.y1) / 2; }
    apply();
  };
  host.querySelectorAll<HTMLButtonElement>('[data-z]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.z === 'in') zoom(1.5);
    else if (b.dataset.z === 'out') zoom(1 / 1.5);
    else zoom(1 / cam.z);
  }));
  svg.addEventListener('wheel', (e) => {
    if (!zoomable || !(e.ctrlKey || e.metaKey)) return; // plain scroll keeps scrolling the story
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    zoom(Math.exp(-e.deltaY * 0.01), (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  }, { passive: false });
  let pan: { x: number; y: number } | null = null;
  svg.addEventListener('pointerdown', (e) => {
    if (cam.z <= 1.01 || (e.target as Element).closest('.removable')) return;
    pan = { x: e.clientX, y: e.clientY };
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove', (e) => {
    if (!pan) return;
    const r = svg.getBoundingClientRect();
    const w = (VB.x1 - VB.x0) / cam.z;
    cam.cx -= ((e.clientX - pan.x) / r.width) * w;
    cam.cy -= ((e.clientY - pan.y) / r.width) * w;
    pan = { x: e.clientX, y: e.clientY };
    apply();
  });
  svg.addEventListener('pointerup', () => (pan = null));

  svg.addEventListener('mousemove', (e) => {
    const t = (e.target as Element).closest('[data-f]');
    if (!t || pan) { tip.classList.remove('on'); return; }
    const r = host.getBoundingClientRect();
    tip.innerHTML = t.getAttribute('data-f')!;
    tip.style.left = Math.min(r.width - 200, e.clientX - r.left + 12) + 'px';
    tip.style.top = e.clientY - r.top + 12 + 'px';
    tip.classList.add('on');
  });
  svg.addEventListener('mouseleave', () => tip.classList.remove('on'));

  const view: BridgeView = { draw, drawSim, onMemberClick: null };
  svg.addEventListener('click', (e) => {
    const t = (e.target as Element).closest<SVGElement>('[data-id]');
    if (t && view.onMemberClick) view.onMemberClick(Number(t.getAttribute('data-id')));
  });

  const ground = () => {
    let s = `<rect class="water" x="${VB.x0 - 40}" y="${sy(-1.6)}" width="${VB.x1 - VB.x0 + 80}" height="${-VB.y0 + 8}"/>`;
    s += `<path class="bank" d="M${VB.x0 - 40},${sy(0)} L0,${sy(0)} L-0.6,${sy(-2)} L0.4,${sy(-9)} L${VB.x0 - 40},${sy(-9)}Z"/>`;
    s += `<path class="bank" d="M${VB.x1 + 40},${sy(0)} L16,${sy(0)} L16.6,${sy(-2)} L15.6,${sy(-9)} L${VB.x1 + 40},${sy(-9)}Z"/>`;
    s += `<line class="road" x1="${VB.x0 - 40}" x2="0" y1="0" y2="0"/><line class="road" x1="16" x2="${VB.x1 + 40}" y1="0" y2="0"/>`;
    s += `<g class="dim"><line x1="0" x2="16" y1="${sy(-3.9)}" y2="${sy(-3.9)}"/><line x1="0" x2="0" y1="${sy(-3.6)}" y2="${sy(-4.2)}"/><line x1="16" x2="16" y1="${sy(-3.6)}" y2="${sy(-4.2)}"/><text x="8" y="${sy(-3.7)}">16 m span</text></g>`;
    return s;
  };

  const vehicleSvg = (V: VehicleType, rear: number, base: number, ang = 0) => {
    const L = V.length, wr = V.wheelR, H = Math.min(V.height, 3.4);
    const y = base + wr;
    const box = V.id === 'car' || V.id === 'pickup'
      ? `<path class="cab" d="M${rear},${sy(y + 0.25)} v${-(H - wr - 0.6)} l${L * 0.2},${-0.55} h${L * 0.45} l${L * 0.2},${0.55} h${L * 0.15} v${H - wr - 0.6}z"/>`
      : V.id === 'bus' || V.id === 'van'
        ? `<rect class="cab" x="${rear}" y="${sy(y + H - wr)}" width="${L}" height="${H - wr - 0.2}" rx="0.25"/>`
        : `<rect x="${rear}" y="${sy(y + 0.2 + (H - 1))}" width="${L * 0.7}" height="${H - 1}" rx="0.12" class="box"/>
           <path d="M${rear + L * 0.72},${sy(y + 0.2)} v${-(H - 0.6)} h${L * 0.2} l${L * 0.08},${(H - 0.6) / 2} v${(H - 0.6) / 2}z" class="cab"/>`;
    return `<g class="truck" transform="rotate(${(-ang * 180) / Math.PI} ${rear} ${sy(base)})">${box}
      <rect x="${rear}" y="${sy(y + 0.35)}" width="${L}" height="0.3" class="chassis"/>
      ${V.axles.map((a) => `<circle cx="${rear + a.x}" cy="${sy(y)}" r="${wr}" class="wheel"/>`).join('')}</g>`;
  };

  function memberName(b: Bridge, id: number, mat: string) {
    return mat === 'deck' ? 'Road deck' : id === b.endDiag ? 'End diagonal' : b.topChord.includes(id) ? 'Top chord' : 'Diagonal';
  }

  function draw(b: Bridge, o: DrawOpts) {
    const d = b.design;
    const V = o.vehicle ?? TRUCK;
    let s = ground();
    const maxF = o.maxForce ?? Math.max(1, ...(o.forces ? [...o.forces.values()].map(Math.abs) : [1]));
    let labels = '';
    const order = [...d.beams].sort((a, c) => (a.mat === 'deck' ? 1 : 0) - (c.mat === 'deck' ? 1 : 0));
    for (const beam of order) {
      const A = d.node(beam.a)!, B = d.node(beam.b)!;
      const gone = o.removed?.has(beam.id);
      const N = o.forces?.get(beam.id) ?? null;
      let cls = 'mem ' + beam.mat;
      let style = '';
      let info = memberName(b, beam.id, beam.mat);
      if (gone) cls += ' gone';
      else if (N !== null) {
        const k = Math.min(1, Math.abs(N) / maxF);
        cls += N >= 0 ? ' ten' : ' com';
        style = `--k:${(0.25 + 0.75 * k).toFixed(2)}`;
        info = `<b>${info}</b><br>${Math.abs(N / 1000).toFixed(0)} kN ${N >= 0 ? 'tension — pulled' : 'compression — pushed'}`;
      }
      if (o.removable) { cls += ' removable'; info = gone ? `<b>${info}</b><br>removed — click to restore` : `<b>${info}</b><br>click to remove`; }
      if (o.focus && !o.focus.includes(beam.id)) cls += ' faded';
      s += `<line class="${cls}" style="${style}" x1="${A.x}" y1="${sy(A.y)}" x2="${B.x}" y2="${sy(B.y)}" data-f="${info.replace(/"/g, '&quot;')}" ${o.removable ? `data-id="${beam.id}"` : ''}/>`;
      if (o.labels && N !== null && Math.abs(N) > 2000 && beam.mat !== 'deck') {
        const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
        labels += `<g class="flabel"><rect x="${mx - 0.62}" y="${sy(my) - 0.3}" width="1.24" height="0.6" rx="0.3"/><text x="${mx}" y="${sy(my) + 0.18}">${N >= 0 ? '+' : '−'}${Math.abs(N / 1000).toFixed(0)}</text></g>`;
      }
    }
    for (const nd of d.nodes) {
      if (!d.beams.some((x) => x.a === nd.id || x.b === nd.id)) continue;
      s += nd.anchor ? `<path class="anchor" d="M${nd.x},${sy(nd.y)} l-0.35,0.5 h0.7z"/>` : `<circle class="joint" cx="${nd.x}" cy="${sy(nd.y)}" r="0.13"/>`;
    }
    if (o.truckRear !== null && o.truckRear !== undefined) s += vehicleSvg(V, o.truckRear, 0);
    s += labels;
    if (o.axles) {
      const top = Math.min(V.height, 3.4) + 0.9;
      for (const a of o.axles) {
        if (a.x < -6.5 || a.x > 22.5) continue;
        s += `<g class="force down"><line x1="${a.x}" x2="${a.x}" y1="${sy(5.2)}" y2="${sy(top)}"/><path d="M${a.x},${sy(top - 0.15)} l-0.22,-0.42 h0.44z"/><text x="${a.x}" y="${sy(5.35)}">${(a.P / 1000).toFixed(0)} kN</text></g>`;
      }
    }
    if (o.reactions) {
      for (const rc of o.reactions) {
        s += `<g class="force up"><line x1="${rc.x}" x2="${rc.x}" y1="${sy(-2.6)}" y2="${sy(-0.75)}"/><path d="M${rc.x},${sy(-0.6)} l-0.22,0.42 h0.44z"/><text x="${rc.x}" y="${sy(-3.05)}">${(rc.Ry / 1000).toFixed(0)} kN</text></g>`;
      }
    }
    svg.innerHTML = s;
    host.querySelector('.b-legend')!.innerHTML = o.forces
      ? '<span><i class="ten"></i>Tension — pulled</span><span><i class="com"></i>Compression — pushed</span><span class="muted">thicker = larger force · hover a member · ⌘/Ctrl + scroll to zoom</span>'
      : o.removable ? '<span class="muted">Click members to remove or restore them · ⌘/Ctrl + scroll to zoom</span>' : '';
  }

  function drawSim(sim: Sim, b: Bridge, removed: Set<number>, maxForce: number) {
    let s = ground();
    const P = sim.particles;
    for (const m of sim.members) {
      if (m.broken || m.mat === null) continue;
      const a = P[m.a], c = P[m.b];
      const k = m.debris ? 0.6 : Math.min(1, Math.abs(m.force) / maxForce);
      const cls = `mem ${m.mat} ${m.debris ? 'debris' : m.force >= 0 ? 'ten' : 'com'}`;
      s += `<line class="${cls}" style="--k:${(0.25 + 0.75 * k).toFixed(2)}" x1="${a.x}" y1="${sy(a.y)}" x2="${c.x}" y2="${sy(c.y)}"/>`;
    }
    for (const [id, pi] of sim.nodeIndex) {
      const p = P[pi];
      if (!b.design.beams.some((x) => !removed.has(x.id) && (x.a === id || x.b === id))) continue;
      s += p.anchor ? `<path class="anchor" d="M${p.x},${sy(p.y)} l-0.35,0.5 h0.7z"/>` : `<circle class="joint" cx="${p.x}" cy="${sy(p.y)}" r="0.13"/>`;
    }
    for (const v of sim.vehicles) {
      if (v.removed) continue;
      const V = VEHICLES[v.kind];
      const w0 = P[v.wheels[0]], w1 = P[v.wheels[v.wheels.length - 1]];
      const ang = Math.atan2(w1.y - w0.y, w1.x - w0.x);
      s += vehicleSvg(V, w0.x - V.axles[0].x, w0.y - V.wheelR, ang);
    }
    svg.innerHTML = s;
    host.querySelector('.b-legend')!.innerHTML = '<span><i class="ten"></i>Tension</span><span><i class="com"></i>Compression</span><span class="muted">live dynamic simulation</span>';
  }

  return view;
}
