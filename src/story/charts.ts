/** Small hand-rolled SVG charts for the data story: line (with crosshair), horizontal bar, log-scale range. */

export interface Series { id: string; name: string; short?: string; color: string; points: [number, number][]; dash?: boolean }

const NS = 'http://www.w3.org/2000/svg';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function niceTicks(min: number, max: number, count = 5) {
  const span = max - min || 1;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? 10 * mag;
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) ticks.push(+v.toFixed(10));
  return ticks;
}

function tooltip(host: HTMLElement) {
  let el = host.querySelector<HTMLDivElement>('.ch-tip');
  if (!el) {
    el = document.createElement('div');
    el.className = 'ch-tip';
    host.appendChild(el);
  }
  return el;
}

function tableView(host: HTMLElement, head: string[], rows: (string | number)[][], caption: string) {
  const d = document.createElement('details');
  d.className = 'ch-table';
  d.innerHTML = `<summary>Show the data</summary><table><caption>${esc(caption)}</caption><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${typeof c === 'number' ? c.toLocaleString('en-US', { maximumFractionDigits: 1 }) : esc(c)}</td>`).join('')}</tr>`)
    .join('')}</table>`;
  host.appendChild(d);
}

// ---------------------------------------------------------------- line chart

export interface LineOpts {
  title: string;
  xLabel: string;
  yLabel: string;
  xFmt?: (v: number) => string;
  yFmt?: (v: number) => string;
  yDomain?: [number, number];
  zeroLine?: boolean;
  caption: string;
}

export function lineChart(host: HTMLElement, series: Series[], o: LineOpts) {
  const W = 640, H = 340, m = { l: 58, r: 112, t: 14, b: 44 };
  const xs = series.flatMap((s) => s.points.map((p) => p[0]));
  const ys = series.flatMap((s) => s.points.map((p) => p[1]));
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let [y0, y1] = o.yDomain ?? [Math.min(0, ...ys), Math.max(...ys)];
  const pad = (y1 - y0) * 0.06;
  if (!o.yDomain) { y1 += pad; if (y0 < 0) y0 -= pad; }
  const yt = niceTicks(y0, y1);
  y0 = Math.min(y0, yt[0]); y1 = Math.max(y1, yt[yt.length - 1]);
  const X = (v: number) => m.l + ((v - x0) / (x1 - x0)) * (W - m.l - m.r);
  const Y = (v: number) => H - m.b - ((v - y0) / (y1 - y0)) * (H - m.t - m.b);
  const xf = o.xFmt ?? ((v: number) => String(v));
  const yf = o.yFmt ?? ((v: number) => String(Math.round(v)));

  host.classList.add('chart');
  host.innerHTML = `<div class="ch-head"><div class="ch-title">${esc(o.title)}</div>
    ${series.length > 1 ? `<div class="ch-legend">${series.map((s) => `<span data-s="${s.id}"><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>` : ''}</div>`;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', o.title);
  let g = '';
  for (const t of yt) g += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${Y(t)}" y2="${Y(t)}"/><text class="tick" x="${m.l - 8}" y="${Y(t) + 4}" text-anchor="end">${yf(t)}</text>`;
  for (const t of niceTicks(x0, x1, 6)) g += `<text class="tick" x="${X(t)}" y="${H - m.b + 18}" text-anchor="middle">${xf(t)}</text>`;
  g += `<line class="axis" x1="${m.l}" x2="${W - m.r}" y1="${Y(o.zeroLine ? 0 : y0)}" y2="${Y(o.zeroLine ? 0 : y0)}"/>`;
  g += `<text class="axlabel" x="${(m.l + W - m.r) / 2}" y="${H - 6}" text-anchor="middle">${esc(o.xLabel)}</text>`;
  g += `<text class="axlabel" transform="translate(14 ${(m.t + H - m.b) / 2}) rotate(-90)" text-anchor="middle">${esc(o.yLabel)}</text>`;
  for (const s of series) {
    const d = s.points.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
    g += `<path class="line" data-s="${s.id}" d="${d}" stroke="${s.color}" ${s.dash ? 'stroke-dasharray="6 5"' : ''}/>`;
    const last = s.points[s.points.length - 1];
    g += `<text class="dlabel" data-s="${s.id}" x="${X(last[0]) + 8}" y="${Y(last[1]) + 4}">${esc(s.short ?? s.name)}</text>`;
  }
  g += `<line class="xhair" y1="${m.t}" y2="${H - m.b}" x1="-9999" x2="-9999"/><line class="marker" y1="${m.t}" y2="${H - m.b}" x1="-9999" x2="-9999"/>`;
  for (const s of series) g += `<circle class="dot" data-s="${s.id}" r="4.5" fill="${s.color}" cx="-9999" cy="-9999"/>`;
  g += `<rect class="hit" x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}"/>`;
  svg.innerHTML = g;
  host.appendChild(svg);
  const tip = tooltip(host);

  const valueAt = (s: Series, x: number) => {
    const p = s.points;
    if (x <= p[0][0]) return p[0][1];
    for (let i = 1; i < p.length; i++) if (x <= p[i][0]) {
      const k = (x - p[i - 1][0]) / (p[i][0] - p[i - 1][0]);
      return p[i - 1][1] + (p[i][1] - p[i - 1][1]) * k;
    }
    return p[p.length - 1][1];
  };
  const show = (x: number, evt?: MouseEvent) => {
    const xh = svg.querySelector('.xhair')!;
    xh.setAttribute('x1', String(X(x))); xh.setAttribute('x2', String(X(x)));
    for (const s of series) {
      const c = svg.querySelector(`circle[data-s="${s.id}"]`)!;
      c.setAttribute('cx', String(X(x))); c.setAttribute('cy', String(Y(valueAt(s, x))));
    }
    tip.innerHTML = `<b>${esc(o.xLabel)}: ${xf(+x.toFixed(2))}</b>${series.map((s) => `<div><i style="background:${s.color}"></i>${esc(s.name)} <span>${yf(valueAt(s, x))}</span></div>`).join('')}`;
    tip.classList.add('on');
    if (evt) {
      const r = host.getBoundingClientRect();
      const left = evt.clientX - r.left;
      tip.style.left = Math.min(r.width - 210, left + 14) + 'px';
      tip.style.top = evt.clientY - r.top + 14 + 'px';
    }
  };
  const hit = svg.querySelector('.hit') as SVGRectElement;
  hit.addEventListener('mousemove', (e) => {
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const loc = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    const x = x0 + ((loc.x - m.l) / (W - m.l - m.r)) * (x1 - x0);
    show(Math.max(x0, Math.min(x1, x)), e);
  });
  hit.addEventListener('mouseleave', () => {
    tip.classList.remove('on');
    svg.querySelector('.xhair')!.setAttribute('x1', '-9999');
    svg.querySelector('.xhair')!.setAttribute('x2', '-9999');
    for (const c of svg.querySelectorAll('circle.dot')) { c.setAttribute('cx', '-9999'); c.setAttribute('cy', '-9999'); }
  });

  tableView(host, [o.xLabel, ...series.map((s) => s.name)], series[0].points.filter((_, i, a) => i % Math.max(1, Math.round(a.length / 14)) === 0).map((p) => [xf(p[0]), ...series.map((s) => Math.round(valueAt(s, p[0])))]), o.caption);

  return {
    /** vertical marker (e.g. synced to a slider) */
    marker(x: number | null) {
      const mk = svg.querySelector('.marker')!;
      const v = x === null ? -9999 : X(x);
      mk.setAttribute('x1', String(v)); mk.setAttribute('x2', String(v));
    },
    /** fade everything except these series */
    focus(ids: string[] | null) {
      for (const el of host.querySelectorAll<SVGElement | HTMLElement>('[data-s]')) {
        el.classList.toggle('dim', !!ids && !ids.includes(el.getAttribute('data-s')!));
      }
    },
    annotate(items: { x: number; y: number; text: string; dx?: number; dy?: number }[]) {
      svg.querySelectorAll('.anno').forEach((a) => a.remove());
      for (const a of items) {
        const gEl = document.createElementNS(NS, 'g');
        gEl.setAttribute('class', 'anno');
        const tx = X(a.x) + (a.dx ?? 12), ty = Y(a.y) + (a.dy ?? -14);
        gEl.innerHTML = `<circle cx="${X(a.x)}" cy="${Y(a.y)}" r="5"/><line x1="${X(a.x)}" y1="${Y(a.y)}" x2="${tx}" y2="${ty + 4}"/><text x="${tx + 4}" y="${ty}">${esc(a.text)}</text>`;
        svg.insertBefore(gEl, hit);
      }
    },
  };
}

// ---------------------------------------------------------------- horizontal bars

export interface Bar { label: string; value: number; color: string; note?: string }

export function barChart(host: HTMLElement, bars: Bar[], o: { title: string; unit: string; legend: { name: string; color: string }[]; caption: string }) {
  const max = Math.max(...bars.map((b) => b.value)) * 1.08;
  host.classList.add('chart');
  host.innerHTML = `<div class="ch-head"><div class="ch-title">${esc(o.title)}</div><div class="ch-legend">${o.legend.map((l) => `<span><i style="background:${l.color}"></i>${esc(l.name)}</span>`).join('')}</div></div>
    <div class="bars">${bars.map((b, i) => `<div class="bar-row" data-i="${i}">
      <div class="bar-label">${esc(b.label)}${b.note ? `<small>${esc(b.note)}</small>` : ''}</div>
      <div class="bar-track"><div class="bar-fill" style="--w:${((b.value / max) * 100).toFixed(1)}%;background:${b.color}"></div><span class="bar-val">${Math.round(b.value).toLocaleString('en-US')} ${o.unit}</span></div>
    </div>`).join('')}</div>`;
  tableView(host, ['Quantity', `Value (${o.unit})`], bars.map((b) => [b.label, Math.round(b.value)]), o.caption);
  return {
    reveal(n: number) {
      host.querySelectorAll<HTMLElement>('.bar-row').forEach((r, i) => r.classList.toggle('shown', i < n));
    },
  };
}

// ---------------------------------------------------------------- log-scale ranges

export interface Range { label: string; from: number; to: number; color: string; record?: { value: number; name: string }; you?: boolean }

export function rangeChart(host: HTMLElement, rows: Range[], o: { title: string; caption: string }) {
  const lo = 5, hi = 3000;
  const X = (v: number) => ((Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * 100;
  const ticks = [5, 10, 20, 50, 100, 200, 500, 1000, 2000];
  host.classList.add('chart');
  host.innerHTML = `<div class="ch-head"><div class="ch-title">${esc(o.title)}</div>
    <div class="ch-legend"><span><i style="background:var(--ink-3)"></i>Typical economic range</span><span><i class="rec"></i>World record main span</span></div></div>
    <div class="ranges">
      <div class="r-grid">${ticks.map((t) => `<span style="left:${X(t)}%"><em>${t >= 1000 ? t / 1000 + ' km' : t + ' m'}</em></span>`).join('')}</div>
      ${rows.map((r) => `<div class="r-row ${r.you ? 'you' : ''}"><div class="r-label">${esc(r.label)}</div><div class="r-track">
        <div class="r-bar" style="left:${X(r.from)}%;width:${X(r.to) - X(r.from)}%;background:${r.color}" title="${r.from}–${r.to} m"></div>
        ${r.record ? `<div class="r-rec" style="left:${X(r.record.value)}%" title="${esc(r.record.name)}: ${r.record.value} m"><b></b><span>${esc(r.record.name)} · ${r.record.value.toLocaleString('en-US')} m</span></div>` : ''}
      </div></div>`).join('')}
    </div>`;
  tableView(host, ['Bridge type', 'Typical from (m)', 'Typical to (m)', 'Record (m)', 'Record holder'], rows.map((r) => [r.label, r.from, r.to, r.record?.value ?? '—', r.record?.name ?? '—']), o.caption);
}
