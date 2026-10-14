/** Clean diagrammatic SVG of the 16 m bridge, coloured by real member forces. */
import type { Bridge } from './model';
import { TRUCK } from './model';

export interface DrawOpts {
  forces?: Map<number, number> | null; // N, + tension
  maxForce?: number;
  truckRear?: number | null;
  axles?: { x: number; P: number }[] | null;
  reactions?: { x: number; Ry: number }[] | null;
  focus?: number[] | null;
  labels?: boolean;
  ghostSquare?: boolean;
}

const VB = { x0: -7, x1: 23, y0: -5.2, y1: 6.2 };
const sx = (x: number) => x;
const sy = (y: number) => -y;

export function bridgeSvg(host: HTMLElement) {
  host.innerHTML = `<svg class="bsvg" viewBox="${VB.x0} ${-VB.y1} ${VB.x1 - VB.x0} ${VB.y1 - VB.y0}" role="img" aria-label="Diagram of the 16 m truss bridge"></svg>
    <div class="b-legend"></div><div class="b-tip"></div>`;
  const svg = host.querySelector('svg')!;
  const tip = host.querySelector<HTMLDivElement>('.b-tip')!;
  svg.addEventListener('mousemove', (e) => {
    const t = (e.target as Element).closest('[data-f]');
    if (!t) { tip.classList.remove('on'); return; }
    const r = host.getBoundingClientRect();
    tip.innerHTML = t.getAttribute('data-f')!;
    tip.style.left = Math.min(r.width - 200, e.clientX - r.left + 12) + 'px';
    tip.style.top = e.clientY - r.top + 12 + 'px';
    tip.classList.add('on');
  });
  svg.addEventListener('mouseleave', () => tip.classList.remove('on'));

  return (b: Bridge, o: DrawOpts) => {
    const d = b.design;
    let s = '';
    // ground & water
    s += `<rect class="water" x="${VB.x0}" y="${sy(-1.6)}" width="${VB.x1 - VB.x0}" height="${VB.y0 * -1 - 1.6}"/>`;
    s += `<path class="bank" d="M${VB.x0},${sy(0)} L0,${sy(0)} L-0.6,${sy(-2)} L0.4,${sy(-5.2)} L${VB.x0},${sy(-5.2)}Z"/>`;
    s += `<path class="bank" d="M${VB.x1},${sy(0)} L16,${sy(0)} L16.6,${sy(-2)} L15.6,${sy(-5.2)} L${VB.x1},${sy(-5.2)}Z"/>`;
    s += `<line class="road" x1="${VB.x0}" x2="0" y1="0" y2="0"/><line class="road" x1="16" x2="${VB.x1}" y1="0" y2="0"/>`;
    // dimension
    s += `<g class="dim"><line x1="0" x2="16" y1="${sy(-3.9)}" y2="${sy(-3.9)}"/><line x1="0" x2="0" y1="${sy(-3.6)}" y2="${sy(-4.2)}"/><line x1="16" x2="16" y1="${sy(-3.6)}" y2="${sy(-4.2)}"/><text x="8" y="${sy(-3.7)}">16 m span</text></g>`;
    if (o.ghostSquare) {
      s += `<rect class="ghost" x="6" y="${sy(2.5)}" width="4" height="2.5"/>`;
    }
    // members
    const maxF = o.maxForce ?? Math.max(1, ...(o.forces ? [...o.forces.values()].map(Math.abs) : [1]));
    let labelsSvg = '';
    const order = [...d.beams].sort((a, c) => (a.mat === 'deck' ? 1 : 0) - (c.mat === 'deck' ? 1 : 0));
    for (const beam of order) {
      const A = d.node(beam.a)!, B = d.node(beam.b)!;
      const N = o.forces?.get(beam.id) ?? null;
      let cls = 'mem ' + beam.mat;
      let style = '';
      let info = beam.mat === 'deck' ? 'Road deck' : 'Steel member';
      if (N !== null) {
        const k = Math.min(1, Math.abs(N) / maxF);
        cls += N >= 0 ? ' ten' : ' com';
        style = `--k:${(0.25 + 0.75 * k).toFixed(2)}`;
        info = `<b>${beam.mat === 'deck' ? 'Road deck' : beam.id === b.endDiag ? 'End diagonal' : b.topChord.includes(beam.id) ? 'Top chord' : 'Diagonal'}</b><br>${Math.abs(N / 1000).toFixed(0)} kN ${N >= 0 ? 'tension — pulled' : 'compression — pushed'}`;
      }
      if (o.focus && !o.focus.includes(beam.id)) cls += ' faded';
      s += `<line class="${cls}" style="${style}" x1="${sx(A.x)}" y1="${sy(A.y)}" x2="${sx(B.x)}" y2="${sy(B.y)}" data-f="${info.replace(/"/g, '&quot;')}"/>`;
      if (o.labels && N !== null && Math.abs(N) > 2000 && beam.mat !== 'deck') {
        const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
        labelsSvg += `<g class="flabel"><rect x="${mx - 0.62}" y="${sy(my) - 0.3}" width="1.24" height="0.6" rx="0.3"/><text x="${mx}" y="${sy(my) + 0.18}">${N >= 0 ? '+' : '−'}${Math.abs(N / 1000).toFixed(0)}</text></g>`;
      }
    }
    for (const nd of d.nodes) {
      if (!d.beams.some((x) => x.a === nd.id || x.b === nd.id)) continue;
      s += nd.anchor
        ? `<path class="anchor" d="M${nd.x},${sy(nd.y)} l-0.35,0.5 h0.7z"/>`
        : `<circle class="joint" cx="${nd.x}" cy="${sy(nd.y)}" r="0.13"/>`;
    }
    // truck
    if (o.truckRear !== null && o.truckRear !== undefined) {
      const r = o.truckRear, L = TRUCK.length, wr = TRUCK.wheelR;
      const y = wr;
      s += `<g class="truck">
        <rect x="${r}" y="${sy(y + 0.2 + 2.3)}" width="${L * 0.7}" height="2.3" rx="0.12" class="box"/>
        <path d="M${r + L * 0.72},${sy(y + 0.2)} v${-2.7} h${L * 0.2} l${L * 0.08},${1.3} v${1.4}z" class="cab"/>
        <rect x="${r}" y="${sy(y + 0.35)}" width="${L}" height="0.3" class="chassis"/>
        ${TRUCK.axles.map((a) => `<circle cx="${r + a.x}" cy="${sy(y)}" r="${wr}" class="wheel"/>`).join('')}
      </g>`;
    }
    s += labelsSvg;
    if (o.axles) {
      for (const a of o.axles) {
        if (a.x < -6.5 || a.x > 22.5) continue;
        s += `<g class="force down"><line x1="${a.x}" x2="${a.x}" y1="${sy(5.2)}" y2="${sy(TRUCK.height + 0.9)}"/><path d="M${a.x},${sy(TRUCK.height + 0.75)} l-0.22,-0.42 h0.44z"/><text x="${a.x}" y="${sy(5.35)}">${(a.P / 1000).toFixed(0)} kN</text></g>`;
      }
    }
    if (o.reactions) {
      for (const rc of o.reactions) {
        s += `<g class="force up"><line x1="${rc.x}" x2="${rc.x}" y1="${sy(-2.6)}" y2="${sy(-0.75)}"/><path d="M${rc.x},${sy(-0.6)} l-0.22,0.42 h0.44z"/><text x="${rc.x}" y="${sy(-3.05)}">${(rc.Ry / 1000).toFixed(0)} kN</text></g>`;
      }
    }
    svg.innerHTML = s;
    host.querySelector('.b-legend')!.innerHTML = o.forces
      ? '<span><i class="ten"></i>Tension — pulled</span><span><i class="com"></i>Compression — pushed</span><span class="muted">thicker = larger force · hover a member</span>'
      : '';
  };
}
