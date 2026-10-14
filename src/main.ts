import './style.css';
import { MATERIALS, MATERIAL_ORDER, JOINT_COST, capacity, propsOf, sectionOf, type MaterialId } from './materials';
import { ALL_LEVELS, LEVELS, PLAYGROUND, type Level, type Vec } from './levels';
import { Design, type DBeam } from './design';
import { Sim, FRAME_DT, type Vehicle } from './physics';
import { analyse, GAMMA_G, GAMMA_Q, type AnalysisResult } from './analysis';
import { Renderer, utilColor, forceColor, type Overlay, type ViewMode } from './render';
import { VEHICLES, VEHICLE_ORDER, tonnes, type VehicleKind } from './vehicles';
import { audio } from './audio';
import { Tutorial, type Seg, type TutStep } from './tutorial';
import { GUIDE, VIDEO_SRC } from './walkthrough';
import { diagnoseTest, improvementTips, checkHint, type TestInfo, type Diagnosis } from './hints';
import CHAPTERS from './video-chapters.json';
import EXAMPLES_RAW from './examples.json';

interface Example { json: string; cost: number; desc: string; util: number; defl: number; peak: number }
const EXAMPLES = EXAMPLES_RAW as Record<string, Example>;

type Tool = 'select' | MaterialId | 'move' | 'delete' | 'drop';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('view');
const R = new Renderer(canvas);
R.insets = { left: 292, right: 350, top: 70, bottom: 80 };

// ---------------- persistence ----------------
const store = {
  get<T>(k: string, d: T): T {
    try {
      const v = localStorage.getItem('span2:' + k);
      return v === null ? d : (JSON.parse(v) as T);
    } catch { return d; }
  },
  set(k: string, v: unknown) {
    try { localStorage.setItem('span2:' + k, JSON.stringify(v)); } catch { /* storage unavailable */ }
  },
};

interface Progress { stars: number; best: number }
const progress: Record<string, Progress> = store.get('progress', {});

// ---------------- state ----------------
let level: Level = ALL_LEVELS.find((l) => l.id === store.get('level', 'l0')) ?? LEVELS[0];
let design = new Design(level);
let sim: Sim | null = null;
let analysis: AnalysisResult | null = null;
let analysisTimer = 0;
let tool: Tool = 'deck';
const secByMat: Record<MaterialId, number> = { deck: 0, timber: 1, steel: 1, cable: 1 };
let view: ViewMode = store.get('view', 'util');
let labels = store.get('labels', true);
let shapeOn = store.get('shape', true);
let grid = store.get('grid', true);
let paused = false;
let follow = false;
let speedIdx = 1;
const SPEEDS = [0.25, 0.5, 1, 2, 4];
speedIdx = 2;
let selected = new Set<number>();
let peaks: Map<number, number> | null = null;
let driving: number | null = null;
let resultShown = false;
let outcomeAt = 0;
let time = 0;
let acc = 0;
let lastTest: 'none' | 'pass' | 'fail' = 'none';
let testInfo: TestInfo = { passed: false, firstBreak: null, breaks: 0, lost: false, timedOut: false };
const fails: Record<string, number> = store.get('fails', {});
/** serialized example design while it is loaded unmodified (stars are not awarded for it) */
let exampleActive: string | null = null;
audio.muted = store.get('muted', false);

const pg = {
  kind: 'car' as VehicleKind,
  traffic: false,
  rate: 10, // vehicles per minute
  trafficAcc: 0,
  loadMass: 5000,
  quake: false,
  amp: 0.08,
  freq: 1.2,
};

interface Drag {
  kind: 'beam' | 'pan' | 'move' | 'erase';
  startNode: number | null;
  sx: number; sy: number;
  px: number; py: number;
  moved: boolean;
}
let drag: Drag | null = null;
let mouse: Vec = { x: 0, y: 0 };
let hoverNode: number | null = null;
let hoverBeam: number | null = null;
let preview: Overlay['preview'] = null;
const keys = new Set<string>();

const fmt = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
const kNs = (n: number, d = 0) => (n / 1000).toFixed(d) + ' kN';
const pct = (r: number) => Math.round(r * 100) + '%';

// ---------------- geometry ----------------
const snapPx = 16;
function segDist(p: Vec, a: Vec, b: Vec) {
  const ex = b.x - a.x, ey = b.y - a.y;
  const l2 = ex * ex + ey * ey || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / l2));
  return Math.hypot(p.x - a.x - ex * t, p.y - a.y - ey * t);
}
function nodeAt(w: Vec, exclude: number | null = null) {
  const r = snapPx / R.cam.zoom;
  let best: number | null = null, bd = r;
  for (const n of design.nodes) {
    if (n.id === exclude) continue;
    const d = Math.hypot(n.x - w.x, n.y - w.y);
    if (d < bd) { bd = d; best = n.id; }
  }
  return best;
}
function beamAt(w: Vec) {
  const r = 9 / R.cam.zoom;
  let best: number | null = null, bd = r;
  for (const b of design.beams) {
    const d = segDist(w, design.node(b.a)!, design.node(b.b)!);
    if (d < bd) { bd = d; best = b.id; }
  }
  return best;
}
function simMemberAt(w: Vec) {
  if (!sim) return null;
  const r = 10 / R.cam.zoom;
  let best: number | null = null, bd = r;
  sim.members.forEach((m, i) => {
    if (m.broken || m.mat === null || m.debris) return;
    const d = segDist(w, sim!.particles[m.a], sim!.particles[m.b]);
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}
function vehicleAt(w: Vec): Vehicle | null {
  if (!sim) return null;
  for (const v of sim.vehicles) {
    if (v.removed) continue;
    const c = sim.vehicleCenter(v);
    const V = VEHICLES[v.kind];
    if (Math.abs(w.x - c.x) < V.length / 2 + 0.3 && Math.abs(w.y - c.y) < V.height) return v;
  }
  return null;
}
function gridSnap(p: Vec, free: boolean): Vec {
  if (!grid || free) return { x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 };
  return { x: Math.round(p.x * 2) / 2, y: Math.round(p.y * 2) / 2 };
}

function beamEnd(start: Vec, startNode: number | null, cursor: Vec, mat: MaterialId, free: boolean) {
  const max = MATERIALS[mat].maxLength;
  const nid = nodeAt(cursor, startNode);
  if (nid !== null) {
    const n = design.node(nid)!;
    if (Math.hypot(n.x - start.x, n.y - start.y) <= max + 1e-6) return { x: n.x, y: n.y, node: nid as number | null };
  }
  let dx = cursor.x - start.x, dy = cursor.y - start.y;
  const L = Math.hypot(dx, dy);
  let tx = cursor.x, ty = cursor.y;
  if (L > max) { dx /= L; dy /= L; tx = start.x + dx * max; ty = start.y + dy * max; }
  let p = gridSnap({ x: tx, y: ty }, free);
  if (Math.hypot(p.x - start.x, p.y - start.y) > max + 1e-6) {
    let best: Vec | null = null, bd = Infinity;
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
      const q = { x: p.x + i * 0.5, y: p.y + j * 0.5 };
      if (Math.hypot(q.x - start.x, q.y - start.y) > max + 1e-6) continue;
      const d = Math.hypot(q.x - tx, q.y - ty);
      if (d < bd) { bd = d; best = q; }
    }
    p = best ?? { x: tx, y: ty };
  }
  const existing = design.nodes.find((n) => Math.abs(n.x - p.x) < 1e-6 && Math.abs(n.y - p.y) < 1e-6 && n.id !== startNode);
  return { x: p.x, y: p.y, node: existing ? existing.id : null };
}

// ---------------- analysis ----------------
function designKinds(): VehicleKind[] | undefined {
  return level.playground ? ['car', 'bus', 'hgv'] : undefined;
}
function runAnalysis() {
  clearTimeout(analysisTimer);
  const t0 = performance.now();
  analysis = analyse(level, design.nodes, design.beams, designKinds());
  console.info(`[span] analysis: ${analysis.cases} load cases, ${design.beams.length} members in ${(performance.now() - t0).toFixed(1)} ms`);
  renderChecks();
  renderInspector();
}
function scheduleAnalysis() {
  clearTimeout(analysisTimer);
  analysisTimer = window.setTimeout(runAnalysis, 140);
}

function designChanged() {
  if (exampleActive && design.serialize() !== exampleActive) exampleActive = null;
  peaks = null;
  lastTest = 'none';
  selected = new Set([...selected].filter((id) => design.beams.some((b) => b.id === id)));
  store.set('design:' + level.id, design.serialize());
  syncHud();
  scheduleAnalysis();
  renderInspector();
}

// ---------------- left panel ----------------
const ICONS = {
  select: '<svg viewBox="0 0 24 24"><path d="M5 3l14 8-6 2-3 6z"/></svg>',
  move: '<svg viewBox="0 0 24 24"><path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/></svg>',
  delete: '<svg viewBox="0 0 24 24"><path d="M20 20H9L4 15l10-10 7 7-8 8"/><path d="M8 11l6 6"/></svg>',
  drop: '<svg viewBox="0 0 24 24"><rect x="7" y="11" width="10" height="9" rx="1"/><path d="M12 3v5M9.5 5.5L12 8l2.5-2.5"/></svg>',
};

function buildTools() {
  const el = $('tools');
  const items: [Tool, string, string, string][] = [];
  for (const id of MATERIAL_ORDER) {
    if (!level.materials.includes(id)) continue;
    const m = MATERIALS[id];
    const sw = `<span class="swatch" style="background:${id === 'deck' ? '#555b66' : m.color};${id === 'cable' ? 'height:3px;margin:9px 0 7px' : ''}"></span>`;
    items.push([id, m.name.replace('Road ', ''), m.hotkey, sw]);
  }
  items.push(['select', 'Select', 'V', ICONS.select], ['move', 'Joints', 'J', ICONS.move], ['delete', 'Delete', 'X', ICONS.delete]);
  if (level.playground) items.push(['drop', 'Drop load', 'O', ICONS.drop]);
  el.innerHTML = items.map(([id, name, key, icon]) => `<button class="tool" data-tool="${id}" title="${name} (${key})"><kbd>${key}</kbd>${icon}${name}</button>`).join('');
  el.querySelectorAll<HTMLElement>('.tool').forEach((b) => (b.onclick = () => setTool(b.dataset.tool as Tool)));
  syncTools();
}

function setTool(t: Tool) {
  if (t === 'drop' && !level.playground) return;
  tool = t;
  preview = null;
  audio.click();
  syncTools();
  renderSections();
}

function syncTools() {
  $('tools').querySelectorAll<HTMLElement>('.tool').forEach((el) => el.classList.toggle('on', el.dataset.tool === tool));
  canvas.className = '';
  if (tool === 'delete' && !sim) canvas.classList.add('del');
  else if ((tool === 'move' || tool === 'select') && !sim) canvas.classList.add('select');
  else if (tool === 'drop') canvas.classList.add('drop');
  else if (sim) canvas.classList.add('pan');
}

/** material whose section list the left panel should show */
function activeMat(): MaterialId {
  if (MATERIAL_ORDER.includes(tool as MaterialId)) return tool as MaterialId;
  const sel = selectedBeams();
  if (sel.length) return sel[0].mat;
  return 'steel';
}

function renderSections() {
  const mat = activeMat();
  const M = MATERIALS[mat];
  const sel = selectedBeams().filter((b) => b.mat === mat);
  const current = sel.length ? sel[0].sec : secByMat[mat];
  $('sectionTitle').innerHTML = `${M.name} · <span style="text-transform:none;letter-spacing:0">${M.grade}</span>`;
  $('sections').innerHTML = M.sections.map((s, i) => {
    const p = propsOf(mat, i);
    const cap = capacity(mat, i, 3);
    return `<button class="secrow ${i === current ? 'on' : ''}" data-sec="${i}">
      <b>${s.name}</b><span class="price">$${s.costPerM}/m</span>
      <span class="props"><span>${p.massPerM} kg/m</span><span>T ${kNs(cap.Nt)}</span>${p.fc ? `<span>C@3m ${kNs(cap.Nc)}</span>` : '<span>no compression</span>'}</span>
    </button>`;
  }).join('');
  $('sections').querySelectorAll<HTMLElement>('.secrow').forEach((b) => (b.onclick = () => {
    const i = Number(b.dataset.sec);
    secByMat[mat] = i;
    const targets = selectedBeams().filter((x) => x.mat === mat);
    if (targets.length && !sim) {
      design.checkpoint();
      for (const t of targets) t.sec = i;
      designChanged();
      toast(`${targets.length} member${targets.length > 1 ? 's' : ''} → ${M.sections[i].name}`);
    }
    audio.click();
    renderSections();
  }));
  $('sectionNote').innerHTML = `${M.blurb} Max length ${M.maxLength} m. E = ${(M.E / 1e9).toFixed(1)} GPa, γ<sub>M</sub> = ${M.gammaM}.`;
}

function renderLegend() {
  const el = $('legend');
  if (view === 'util') {
    const stops = [0, 0.25, 0.5, 0.75, 0.95, 1, 1.2].map((v) => `${utilColor(v)} ${(v / 1.2) * 100}%`).join(',');
    el.innerHTML = `<h4>Utilisation</h4><div class="scale" style="background:linear-gradient(90deg,${stops})"></div>
      <div class="ticks"><span>0%</span><span>50%</span><span>100%</span><span>120%</span></div>
      <p>${sim ? 'Live: actual force ÷ characteristic resistance. At 100% the member fails.' : 'Design: factored force (1.35G + 1.5Q) ÷ design resistance. Must be ≤ 100%.'}</p>`;
  } else if (view === 'force') {
    el.innerHTML = `<h4>Axial force</h4>
      <div class="row"><span class="chip" style="background:${forceColor(1e5, 1e5)}"></span>Tension (+) — member is pulled</div>
      <div class="row"><span class="chip" style="background:${forceColor(-1e5, 1e5)}"></span>Compression (−) — member is pushed</div>
      <div class="row"><span class="chip" style="background:${forceColor(0, 1)}"></span>Zero-force / slack</div>
      <p>Labels show the governing design force in kN. Compression members can buckle — keep them short.</p>`;
  } else {
    el.innerHTML = `<h4>Materials</h4>${MATERIAL_ORDER.map((m) => `<div class="row"><span class="chip" style="background:${m === 'deck' ? '#555b66' : MATERIALS[m].color}"></span>${MATERIALS[m].name} <span class="muted">· ${MATERIALS[m].grade}</span></div>`).join('')}
      <p>Joints are pinned connections ($${JOINT_COST} each). Anchors are fixed foundations.</p>`;
  }
}

// ---------------- right panel ----------------
function selectedBeams(): DBeam[] {
  return design.beams.filter((b) => selected.has(b.id));
}

function checkRow(ok: boolean | null, label: string, value: string, detail = '') {
  const cls = ok === null ? 'wait' : ok ? 'ok' : 'bad';
  return `<div class="check ${cls}"><span class="ic">${ok === null ? '·' : ok ? '✓' : '!'}</span><span class="lbl">${label}</span><span class="val">${value}</span>${detail ? `<span class="det">${detail}</span>` : ''}</div>`;
}

function renderChecks() {
  const el = $('checks');
  const pill = $('checkPill');
  const cost = design.cost();
  let html = '';
  if (!analysis) html = checkRow(null, 'Analysis', 'pending');
  else {
    for (const c of analysis.checks) {
      const h = c.ok ? null : checkHint(design, analysis, c.id, level);
      html += checkRow(c.ok, c.label, c.value, h ? `<span class="hint">💡 ${h.text}</span>${h.beams.length || h.node !== null ? ` <a class="hint-show" data-hint="${c.id}">show</a>` : ''}` : c.detail);
    }
  }
  if (!level.playground) {
    html += checkRow(cost <= level.budget, 'Budget', `${fmt(cost)} / ${fmt(level.budget)}`, cost <= level.budget * 0.8 ? 'Efficient — under 80% of budget' : '');
    html += checkRow(lastTest === 'none' ? null : lastTest === 'pass', 'Load test', lastTest === 'none' ? 'not run' : lastTest === 'pass' ? 'passed' : 'failed', 'Real traffic, real dynamics');
  }
  el.innerHTML = html;
  el.querySelectorAll<HTMLElement>('[data-hint]').forEach((a) => a.addEventListener('click', () => {
    if (!analysis || sim) return;
    const h = checkHint(design, analysis, a.dataset.hint!, level);
    if (h) focusOn(h.beams, h.node);
  }));
  if (!analysis) { pill.className = 'pill wait'; pill.textContent = '…'; return; }
  const issues = analysis.checks.filter((c) => !c.ok).length + (!level.playground && cost > level.budget ? 1 : 0);
  pill.className = 'pill ' + (issues ? 'bad' : 'ok');
  pill.textContent = issues ? `${issues} issue${issues > 1 ? 's' : ''}` : 'Code compliant';
}

function renderInspector() {
  const el = $('inspector');
  if (sim) {
    const live = sim.vehicles.filter((v) => !v.removed);
    const onDeck = live.filter((v) => { const c = sim!.vehicleCenter(v); return c.x > level.anchors[0].x && c.x < level.anchors[1].x; });
    const loadOnDeck = onDeck.reduce((s, v) => s + VEHICLES[v.kind].mass, 0);
    const broken = sim.members.filter((m) => m.broken && m.mat !== null && !m.debris).length;
    el.innerHTML = `<div class="kv">
      <span>Simulated time</span><span>${sim.time.toFixed(1)} s</span>
      <span>Vehicles on bridge</span><span>${onDeck.length}</span>
      <span>Live load on deck</span><span>${tonnes(loadOnDeck)}</span>
      <span>Peak member stress</span><span class="${sim.maxRatio > 0.9 ? 'bad' : ''}">${pct(sim.maxRatio)}</span>
      <span>Peak deck deflection</span><span>${(sim.maxDeflection * 1000).toFixed(0)} mm</span>
      <span>Failed members</span><span class="${broken ? 'bad' : 'ok'}">${broken}</span>
      ${sim.quake ? `<span>Ground motion</span><span>${(sim.groundX * 100).toFixed(1)} cm</span>` : ''}
    </div><p class="note">Hover any member to read its live axial force. ${level.playground ? 'Click a vehicle to take the wheel.' : ''}</p>`;
    return;
  }
  const sel = selectedBeams();
  if (!sel.length) {
    const byMat = MATERIAL_ORDER.map((m) => {
      const bs = design.beams.filter((b) => b.mat === m);
      return bs.length ? `<span>${MATERIALS[m].name} (${bs.length})</span><span>${fmt(bs.reduce((s, b) => s + design.beamCost(b), 0))}</span>` : '';
    }).join('');
    const joints = design.nodes.filter((n) => !n.anchor).length;
    const d = analysis?.determinacy;
    el.innerHTML = design.beams.length
      ? `<div class="kv">${byMat}<span>Joints (${joints})</span><span>${fmt(joints * JOINT_COST)}</span><span class="hr"></span>
        <span>Total</span><span>${fmt(design.cost())}</span><span>Self weight</span><span>${design.steelTonnes().toFixed(1)} t</span>
        ${d ? `<span>m + r − 2j</span><span>${d.m} + ${d.r} − ${2 * d.j} = ${d.degree}</span>` : ''}</div>
        <p class="note">Use the <b>Select</b> tool (V) and click a member to see its section properties, buckling capacity and design forces.</p>`
      : `<p class="empty">Nothing built yet. Pick <b>Road deck</b> (1) and drag from a red anchor to start the deck, then brace it with timber or steel triangles.</p>`;
    return;
  }
  if (sel.length > 1) {
    const mats = [...new Set(sel.map((b) => b.mat))];
    const maxU = Math.max(...sel.map((b) => analysis?.members.get(b.id)?.util ?? 0));
    el.innerHTML = `<div class="title">${sel.length} members selected</div><div class="kv">
      <span>Materials</span><span>${mats.map((m) => MATERIALS[m].name).join(', ')}</span>
      <span>Total length</span><span>${sel.reduce((s, b) => s + design.beamLength(b), 0).toFixed(1)} m</span>
      <span>Cost</span><span>${fmt(sel.reduce((s, b) => s + design.beamCost(b), 0))}</span>
      <span>Max utilisation</span><span class="${maxU > 1 ? 'bad' : 'ok'}">${pct(maxU)}</span></div>
      <p class="note">Pick a section in the left panel to apply it to every selected ${mats.length === 1 ? MATERIALS[mats[0]].name.toLowerCase() : ''} member. Delete/Backspace removes them.</p>`;
    return;
  }
  const b = sel[0];
  const M = MATERIALS[b.mat];
  const s = sectionOf(b.mat, b.sec);
  const p = propsOf(b.mat, b.sec);
  const L = design.beamLength(b);
  const cap = capacity(b.mat, b.sec, L);
  const r = analysis?.members.get(b.id);
  const A = design.node(b.a)!, B = design.node(b.b)!;
  const angle = Math.abs(Math.atan2(B.y - A.y, B.x - A.x) * 180 / Math.PI);
  const pk = peaks?.get(b.id);
  const ucol = r ? utilColor(r.util) : '#555';
  let note = '';
  if (r && r.util > 1) {
    note = r.mode === 'buckling'
      ? `<p class="note warn">Buckling governs: N<sub>cr</sub> = π²EI/L² = ${kNs(cap.Ncr)}. Shorten this member (add a joint to brace it) or choose a section with a larger I.</p>`
      : r.mode === 'tension'
        ? `<p class="note warn">Tension exceeds resistance. Pick a larger section — tension capacity is simply f·A.</p>`
        : `<p class="note warn">Compression exceeds the squash load. Use a larger section.</p>`;
  } else if (r?.slack) note = `<p class="note warn">This cable goes slack under some load positions — it is not doing any work then.</p>`;
  else if (r && r.util < 0.15 && r.util > 0) note = `<p class="note">Lightly loaded (${pct(r.util)}). A smaller section would save money.</p>`;
  el.innerHTML = `<div class="title"><span class="sw" style="background:${b.mat === 'deck' ? '#555b66' : M.color}"></span>${M.name} · ${s.name}</div>
    <select id="inspSec">${M.sections.map((x, i) => `<option value="${i}" ${i === b.sec ? 'selected' : ''}>${x.name} — $${x.costPerM}/m</option>`).join('')}</select>
    ${r ? `<div class="utilbar"><i style="width:${Math.min(100, r.util * 100)}%;background:${ucol}"></i></div>` : ''}
    <div class="kv">
      ${r ? `<span>Utilisation (ULS)</span><span class="${r.util > 1 ? 'bad' : 'ok'}">${r.mode === 'slack' ? 'slack' : pct(r.util)} ${r.mode !== 'none' && r.mode !== 'slack' ? `· ${r.mode}` : ''}</span>` : ''}
      ${pk !== undefined ? `<span>Last load test peak</span><span class="${pk >= 1 ? 'bad' : ''}">${pk >= 1 ? 'FAILED' : pct(pk)}</span>` : ''}
      <span class="hr"></span>
      <span>Length</span><span>${L.toFixed(2)} m</span>
      <span>Angle</span><span>${angle.toFixed(0)}°</span>
      <span>Mass</span><span>${(p.massPerM * L).toFixed(0)} kg</span>
      <span>Cost</span><span>${fmt(design.beamCost(b))}</span>
      <span class="hr"></span>
      <span>Area A</span><span>${(p.A * 1e4).toFixed(1)} cm²</span>
      ${p.I ? `<span>Inertia I</span><span>${(p.I * 1e8).toFixed(0)} cm⁴</span><span>Slenderness L/r</span><span class="${cap.slenderness > 180 ? 'bad' : ''}">${cap.slenderness.toFixed(0)}</span>` : ''}
      <span>N<sub>t,Rd</sub> (tension)</span><span>${kNs(cap.Nt / M.gammaM)}</span>
      ${p.fc ? `<span>N<sub>c,Rd</sub> (compr.)</span><span>${kNs(cap.Nc / M.gammaM)}</span><span>Euler N<sub>cr</sub></span><span>${kNs(cap.Ncr)}</span>` : '<span>Compression</span><span>none (slack)</span>'}
      ${r ? `<span class="hr"></span>
        <span>N dead (G)</span><span>${kNs(r.NG, 1)}</span>
        <span>N live (Q) range</span><span>${kNs(r.NQmin, 0)} … ${kNs(r.NQmax, 0)}</span>
        <span>N<sub>Ed</sub> tension</span><span>${kNs(r.NEdT)}</span>
        ${p.fc ? `<span>N<sub>Ed</sub> compression</span><span>${kNs(r.NEdC)}</span>` : ''}` : ''}
    </div>${note}`;
  const selEl = document.getElementById('inspSec') as HTMLSelectElement | null;
  if (selEl) selEl.onchange = () => {
    design.checkpoint();
    b.sec = Number(selEl.value);
    secByMat[b.mat] = b.sec;
    designChanged();
    renderSections();
  };
}

// ---------------- playground panel ----------------
function renderPlayground() {
  const sec = $('playgroundSec');
  sec.classList.toggle('hidden', !level.playground);
  if (!level.playground) return;
  const el = $('playground');
  const drv = driving !== null && sim ? sim.vehicles.find((v) => v.id === driving) : null;
  el.innerHTML = `
    <div class="pg-group"><div class="pg-label"><span>Vehicle</span><span>${VEHICLES[pg.kind].name} · ${tonnes(VEHICLES[pg.kind].mass)}</span></div>
      <div class="veh-grid">${VEHICLE_ORDER.map((k) => `<button class="veh ${k === pg.kind ? 'on' : ''}" data-kind="${k}">${VEHICLES[k].name.replace('HL-93 design truck', 'HL-93').replace('3-axle tipper', 'Tipper').replace('Delivery van', 'Van').replace('City bus', 'Bus')}<small>${tonnes(VEHICLES[k].mass)}</small></button>`).join('')}</div>
      <div class="row3" style="margin-top:6px"><button class="btn" data-act="spawnL">→ Send</button><button class="btn" data-act="spawnR">Send ←</button><button class="btn primary" data-act="drive">Drive</button></div>
    </div>
    ${drv ? `<div class="pg-group"><div class="pg-label"><span>Driving ${VEHICLES[drv.kind].name}</span><span>←/→ or A/D</span></div>
      <div class="speedo"><b id="speedo">0</b><span class="muted">km/h</span><span style="margin-left:auto" class="muted">release = brake</span></div>
      <button class="btn" data-act="release" style="width:100%;margin-top:6px">Hand back to autopilot</button></div>` : ''}
    <div class="pg-group"><div class="pg-label"><span>Continuous traffic</span><span>${pg.rate}/min</span></div>
      <input type="range" min="2" max="30" value="${pg.rate}" data-in="rate"/>
      <button class="btn ${pg.traffic ? 'on' : ''}" data-act="traffic" style="width:100%;margin-top:4px">${pg.traffic ? 'Traffic ON — mixed, both ways' : 'Start traffic'}</button></div>
    <div class="pg-group"><div class="pg-label"><span>Drop load (tool O)</span><span>${tonnes(pg.loadMass)}</span></div>
      <div class="row3">${[1000, 5000, 20000].map((m) => `<button class="btn ${pg.loadMass === m ? 'on' : ''}" data-mass="${m}">${m / 1000} t</button>`).join('')}</div>
      <div class="row2" style="margin-top:6px"><button class="btn ${tool === 'drop' ? 'on' : ''}" data-act="droptool">Place loads</button><button class="btn" data-act="clearloads">Clear loads</button></div></div>
    <div class="pg-group"><div class="pg-label"><span>Earthquake</span><span>${(pg.amp * 100).toFixed(0)} cm · ${pg.freq.toFixed(1)} Hz</span></div>
      <input type="range" min="1" max="30" value="${Math.round(pg.amp * 100)}" data-in="amp"/>
      <input type="range" min="3" max="40" value="${Math.round(pg.freq * 10)}" data-in="freq"/>
      <button class="btn danger ${pg.quake ? 'on' : ''}" data-act="quake" style="width:100%;margin-top:4px">${pg.quake ? 'Shaking — click to stop' : 'Start ground motion'}</button></div>
    <div class="pg-group"><button class="btn" data-act="reset" style="width:100%">Rebuild bridge & restart</button></div>`;
  el.querySelectorAll<HTMLElement>('[data-kind]').forEach((b) => (b.onclick = () => { pg.kind = b.dataset.kind as VehicleKind; audio.click(); renderPlayground(); }));
  el.querySelectorAll<HTMLElement>('[data-mass]').forEach((b) => (b.onclick = () => { pg.loadMass = Number(b.dataset.mass); setTool('drop'); renderPlayground(); }));
  el.querySelectorAll<HTMLInputElement>('[data-in]').forEach((inp) => (inp.oninput = () => {
    const v = Number(inp.value);
    if (inp.dataset.in === 'rate') pg.rate = v;
    if (inp.dataset.in === 'amp') pg.amp = v / 100;
    if (inp.dataset.in === 'freq') pg.freq = v / 10;
    if (sim && pg.quake) sim.quake = { amp: pg.amp, freq: pg.freq };
    const lbl = inp.closest('.pg-group')!.querySelector('.pg-label span:last-child')!;
    lbl.textContent = inp.dataset.in === 'rate' ? `${pg.rate}/min` : `${(pg.amp * 100).toFixed(0)} cm · ${pg.freq.toFixed(1)} Hz`;
  }));
  el.querySelectorAll<HTMLElement>('[data-act]').forEach((b) => (b.onclick = () => pgAction(b.dataset.act!)));
}

function ensureSim() {
  if (!sim) startSim();
  return sim!;
}

function pgAction(act: string) {
  audio.click();
  if (act === 'spawnL' || act === 'spawnR') ensureSim().enqueue(pg.kind, act === 'spawnL' ? 1 : -1);
  else if (act === 'drive') {
    const s = ensureSim();
    s.enqueue(pg.kind, 1);
    pendingDrive = true;
    follow = true;
  } else if (act === 'release') {
    releaseDrive();
  } else if (act === 'traffic') {
    pg.traffic = !pg.traffic;
    if (pg.traffic) ensureSim();
  } else if (act === 'droptool') setTool(tool === 'drop' ? 'select' : 'drop');
  else if (act === 'clearloads') sim?.clearLoads();
  else if (act === 'quake') {
    pg.quake = !pg.quake;
    const s = pg.quake ? ensureSim() : sim;
    if (s) s.quake = pg.quake ? { amp: pg.amp, freq: pg.freq } : null;
  } else if (act === 'reset') {
    stopSim();
    startSim();
  }
  renderPlayground();
  syncHud();
}
let pendingDrive = false;

function takeControl(v: Vehicle) {
  if (!sim) return;
  for (const o of sim.vehicles) o.manual = false;
  v.manual = true;
  v.throttle = 0;
  driving = v.id;
  follow = true;
  toast(`Driving the ${VEHICLES[v.kind].name.toLowerCase()} — ←/→ to drive, release to brake`);
  renderPlayground();
}
function releaseDrive() {
  if (sim && driving !== null) {
    const v = sim.vehicles.find((x) => x.id === driving);
    if (v) { v.manual = false; v.dir = v.throttle < 0 ? -1 : v.dir; }
  }
  driving = null;
  renderPlayground();
}

// ---------------- top bar ----------------
function syncHud() {
  $('levelCode').textContent = level.code;
  $('levelName').textContent = level.name;
  const cost = design.cost();
  $('cost').textContent = fmt(cost);
  $('budget').textContent = level.playground ? 'unlimited' : fmt(level.budget);
  const p = Math.min(1, cost / level.budget);
  const fill = $('budgetFill');
  fill.style.width = (level.playground ? 0 : p * 100).toFixed(1) + '%';
  fill.style.background = cost > level.budget ? 'var(--bad)' : p > 0.8 ? 'var(--warn)' : 'var(--good)';
  document.querySelector('.budget')!.classList.toggle('over', cost > level.budget);
  $('labelsBtn').classList.toggle('on', labels);
  $('shapeBtn').classList.toggle('on', shapeOn);
  $('gridBtn').classList.toggle('on', grid);
  $('soundBtn').classList.toggle('on', !audio.muted);
  $('playgroundBtn').classList.toggle('on', !!level.playground);
  document.querySelectorAll<HTMLElement>('#viewSeg button').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  for (const id of ['undoBtn', 'redoBtn', 'clearBtn']) ($(id) as HTMLButtonElement).disabled = !!sim;
  ($('undoBtn') as HTMLButtonElement).disabled = !!sim || !design.canUndo;
  ($('redoBtn') as HTMLButtonElement).disabled = !!sim || !design.canRedo;
  $('playBtn').classList.toggle('running', !!sim);
  $('playLabel').textContent = sim ? 'Stop test' : level.playground ? 'Start sim' : 'Load test';
  $('speedBtn').textContent = SPEEDS[speedIdx] + '×';
  $('pauseBtn').classList.toggle('on', paused);
  ($('pauseBtn') as HTMLButtonElement).disabled = !sim;
  ($('stepBtn') as HTMLButtonElement).disabled = !sim || !paused;
  $('followBtn').classList.toggle('on', follow);
  renderLegend();
  syncTools();
}

let toastTimer = 0;
function toast(msg: string) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove('show'), 2200);
}

// ---------------- level flow ----------------
function loadLevel(l: Level, showBrief = true) {
  if (tut.active && showBrief) tut.stop();
  stopSim();
  level = l;
  store.set('level', l.id);
  design = new Design(level);
  const saved = store.get<string | null>('design:' + level.id, null);
  if (saved) design.load(saved);
  selected = new Set();
  peaks = null;
  lastTest = 'none';
  driving = null;
  pg.traffic = false;
  pg.quake = false;
  if (tool === 'drop' && !level.playground) tool = 'deck';
  buildTools();
  renderSections();
  fitView();
  syncHud();
  renderPlayground();
  analysis = null;
  renderChecks();
  runAnalysis();
  if (showBrief) openBrief();
}

function loadExample() {
  const ex = EXAMPLES[level.id];
  if (!ex) return;
  stopSim();
  design.checkpoint();
  design.load(ex.json);
  selected = new Set();
  designChanged();
  exampleActive = design.serialize();
  document.querySelectorAll('.overlay').forEach((o) => o.classList.add('hidden'));
  fitView();
  view = 'util';
  syncHud();
  toast(`Perfect solution loaded (${fmt(ex.cost)}) — study it, then rebuild it yourself`);
  audio.place();
}

function exampleCard() {
  const ex = EXAMPLES[level.id];
  if (!ex || level.playground) return '';
  return `<h3>The perfect 3★ solution</h3>
    <div class="example"><div class="ex-stars">★★★</div><div><p>${ex.desc}</p>
      <div class="ex-facts"><span>${fmt(ex.cost)} · ${Math.round((ex.cost / level.budget) * 100)}% of budget</span><span>max utilisation ${Math.round(ex.util * 100)}%</span><span>deflection ${ex.defl.toFixed(0)} mm</span><span>load test peak ${Math.round(ex.peak * 100)}%</span></div>
      <p class="muted small" style="margin:0 0 10px">The cheapest design we found that passes every check and the load test. This is the only project with a worked solution — from the next one on, you're the engineer.</p>
      <button class="btn" data-ex="1">Load the perfect solution</button><span class="muted small"> Replaces your design (⌘Z restores it). It earns no stars — rebuild it yourself to earn them.</span></div></div>`;
}

function openBrief() {
  const kinds = [...new Set(level.vehicles.map((v) => v.kind))];
  const rows = kinds.map((k) => {
    const V = VEHICLES[k];
    const ax = V.axles.map((a) => (a.share * V.mass * 9.81 / 1000).toFixed(0)).join(' + ');
    return `<tr><td>${V.name}</td><td>${tonnes(V.mass)}</td><td>${ax} kN</td><td>${(V.speed * 3.6).toFixed(0)} km/h</td></tr>`;
  }).join('');
  const p = progress[level.id];
  $('briefCard').innerHTML = `
    <div class="card-head"><div><div class="mono muted">${level.code} · ${level.client}</div><h2>${level.name}</h2></div>
      ${p ? `<div class="mono" style="color:#ffc83d">${'★'.repeat(p.stars)}${'☆'.repeat(3 - p.stars)}</div>` : ''}</div>
    <p class="lead">${level.brief}</p>
    ${level.playground ? '' : `<h3>Design requirements</h3>
    <div class="constraints">
      <div><b>${fmt(level.budget)}</b><span>Budget (≤ ${fmt(level.budget * 0.8)} for ★★★)</span></div>
      <div><b>${level.span.toFixed(0)} m</b><span>Clear span between abutments</span></div>
      <div><b>L/${level.deflectionLimit}</b><span>Live-load deflection limit (${(level.span / level.deflectionLimit * 1000).toFixed(0)} mm)</span></div>
      <div><b>${Math.round(level.maxGradient * 100)}%</b><span>Maximum deck gradient</span></div>
      ${level.noBuild.map((z) => `<div><b>${z.label}</b><span>No members or joints in the hatched zone</span></div>`).join('')}
      <div><b>${GAMMA_G} G + ${GAMMA_Q} Q</b><span>Strength load combination</span></div>
    </div>
    <h3>Design traffic</h3>
    <table><tr><th>Vehicle</th><th>Gross</th><th>Axle loads</th><th>Speed</th></tr>${rows}</table>`}
    <h3>Engineering concept</h3>
    <div class="lesson">${level.lesson}</div>
    <p class="muted" style="margin:12px 0 0">Hint: ${level.hint}</p>
    ${exampleCard()}
    <div class="btns"><button class="btn" data-close>Close</button><button class="btn primary" data-close>Start designing</button></div>`;
  $('briefCard').querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => $('brief').classList.add('hidden')));
  $('briefCard').querySelector('[data-ex]')?.addEventListener('click', loadExample);
  $('brief').classList.remove('hidden');
}

function startSim() {
  if (sim) return;
  if (!level.playground && !design.beams.some((b) => b.mat === 'deck')) toast('Vehicles can only drive on the road deck');
  const t0 = performance.now();
  sim = new Sim(level, design.nodes, design.beams, !level.playground);
  if (pg.quake && level.playground) sim.quake = { amp: pg.amp, freq: pg.freq };
  console.info(`[span] sim built: ${sim.particles.length} particles, ${sim.members.length} members in ${(performance.now() - t0).toFixed(2)} ms`);
  simWall = performance.now();
  testInfo = { passed: false, firstBreak: null, breaks: 0, lost: false, timedOut: false };
  acc = 0;
  paused = false;
  resultShown = false;
  outcomeAt = 0;
  drag = null;
  preview = null;
  selected = new Set();
  audio.start();
  syncHud();
  renderInspector();
  renderPlayground();
}
let simWall = 0;

function stopSim() {
  if (!sim) return;
  peaks = new Map();
  for (const m of sim.members) {
    if (m.mat === null || m.designId < 0) continue;
    const v = m.broken || m.debris ? 1 : m.peak;
    peaks.set(m.designId, Math.max(peaks.get(m.designId) ?? 0, Math.min(1, v)));
  }
  console.info(`[span] sim stopped: ${sim.time.toFixed(2)} s simulated in ${((performance.now() - simWall) / 1000).toFixed(2)} s wall`);
  sim = null;
  driving = null;
  pendingDrive = false;
  paused = false;
  $('modal').classList.add('hidden');
  if (tool === 'drop') tool = 'select';
  syncHud();
  renderInspector();
  renderPlayground();
}

function handleEvents() {
  if (!sim) return;
  for (const e of sim.events) {
    if (e.type === 'break') {
      R.burst(e.x, e.y, e.mat);
      audio.snap(e.mat);
      testInfo.breaks++;
      if (!testInfo.firstBreak && e.designId !== undefined && e.designId >= 0) {
        testInfo.firstBreak = { designId: e.designId, force: e.force ?? 0, mat: e.mat };
        if (!level.playground) toast(`${e.mat ? MATERIALS[e.mat].name : 'A'} member ${(e.force ?? 0) < 0 ? 'failed in compression' : 'snapped in tension'} — tips will follow`);
      }
    }
    else if (e.type === 'splash') { R.splash(e.x, e.y); audio.splash(false); }
    else if (e.type === 'lost') { R.splash(e.x, level.waterY, true); audio.splash(true); testInfo.lost = true; }
    else if (e.type === 'arrive') audio.click();
  }
  sim.events.length = 0;
}

// ---------------- results ----------------
const STAR = '<svg viewBox="0 0 24 24"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z"/></svg>';

/** select and frame the members (or joint) a hint is about */
function focusOn(beams: number[], node: number | null) {
  const pts: Vec[] = [];
  for (const id of beams) {
    const b = design.beams.find((x) => x.id === id);
    if (b) pts.push(design.node(b.a)!, design.node(b.b)!);
  }
  if (node !== null) { const n = design.node(node); if (n) pts.push(n); }
  if (!pts.length) return;
  selected = new Set(beams.filter((id) => design.beams.some((b) => b.id === id)));
  tool = 'select';
  view = 'util';
  const x0 = Math.min(...pts.map((p) => p.x)), x1 = Math.max(...pts.map((p) => p.x));
  const y0 = Math.min(...pts.map((p) => p.y)), y1 = Math.max(...pts.map((p) => p.y));
  const availW = R.W - R.insets.left - R.insets.right, availH = R.H - R.insets.top - R.insets.bottom;
  const z = Math.max(fitZoom, Math.min(fitZoom * 2.2, availW / (x1 - x0 + 10), availH / (y1 - y0 + 7)));
  R.cam.zoom = z;
  R.cam.x = (x0 + x1) / 2 - ((R.insets.left - R.insets.right) / 2) / z;
  R.cam.y = (y0 + y1) / 2 + ((R.insets.top - R.insets.bottom) / 2) / z;
  syncHud();
  renderSections();
  renderInspector();
}
let pendingFocus: { beams: number[]; node: number | null } | null = null;

function diagHtml(d: Diagnosis, kind: 'fail' | 'improve') {
  pendingFocus = d.focusBeams.length || d.focusNode !== null ? { beams: d.focusBeams, node: d.focusNode } : null;
  return `<div class="diag ${kind}"><div class="diag-head"><span class="diag-ic">${d.icon}</span><div><small>${kind === 'fail' ? 'What went wrong' : 'How to earn more stars'}</small><b>${d.title}</b></div></div>
    <p>${d.why}</p><ul>${d.tips.map((t) => `<li>${t}</li>`).join('')}</ul>
    ${kind === 'fail' && (fails[level.id] ?? 0) >= 2 && EXAMPLES[level.id] ? `<button class="btn" data-act="example" style="margin-bottom:6px">★ Load the perfect solution to study</button>` : ''}
    ${pendingFocus ? `<button class="btn" data-act="showme">🔍 Show me ${d.focusNode !== null && !d.focusBeams.length ? 'the joint' : d.focusBeams.length > 1 ? 'these members' : 'the member'}</button>` : ''}</div>`;
}

function showResult() {
  if (!sim) return;
  runAnalysis();
  const an = analysis!;
  const cost = design.cost();
  const passedTest = sim.outcome === 'success';
  lastTest = passedTest ? 'pass' : 'fail';
  const structural = an.stable && an.deckGapAt === null;
  const s1 = passedTest && structural && cost <= level.budget;
  const code = an.checks.filter((c) => c.id !== 'slack').every((c) => c.ok);
  const s2 = s1 && code;
  const s3 = s2 && cost <= level.budget * 0.8;
  const stars = s3 ? 3 : s2 ? 2 : s1 ? 1 : 0;
  testInfo.passed = passedTest;
  testInfo.timedOut = !passedTest && !testInfo.lost && !testInfo.firstBreak;
  const usedExample = !!exampleActive;
  if (!s1) fails[level.id] = (fails[level.id] ?? 0) + 1;
  else if (!usedExample) fails[level.id] = 0;
  store.set('fails', fails);
  let diag = '';
  if (!passedTest || !structural) diag = diagHtml(diagnoseTest(level, design, an, testInfo, fails[level.id] ?? 1), 'fail');
  else if (!s3) {
    const imp = improvementTips(level, design, an);
    if (imp) diag = diagHtml(imp, 'improve');
  }
  if (usedExample) diag = `<div class="diag improve"><div class="diag-head"><span class="diag-ic">★</span><div><small>Worked solution</small><b>This is the built-in perfect solution</b></div></div><p>It doesn't earn stars. Study how it works in the Utilisation and Forces views, clear it, and build it yourself — then move on to the next project, where there is no worked solution.</p></div>` + diag;
  if (stars && !usedExample) {
    const prev = progress[level.id];
    progress[level.id] = { stars: Math.max(prev?.stars ?? 0, stars), best: Math.min(prev?.best ?? Infinity, cost) };
    store.set('progress', progress);
  }
  const why1 = !passedTest ? (sim.vehicles.some((v) => v.lost) ? 'A vehicle was lost in the load test.' : 'Traffic did not get across.') : !structural ? 'The structure is not a stable, continuous bridge.' : cost > level.budget ? `${fmt(cost - level.budget)} over budget.` : 'All traffic crossed safely.';
  const failing = an.checks.filter((c) => !c.ok && c.id !== 'slack').map((c) => c.label).join(', ');
  const why2 = !s1 ? 'Requires a successful load test first.' : code ? 'Strength, deflection and gradient all satisfied.' : `Fails: ${failing}.`;
  const why3 = !s2 ? 'Requires a code-compliant design.' : s3 ? `${pct(cost / level.budget)} of budget.` : `Get below ${fmt(level.budget * 0.8)} (now ${fmt(cost)}).`;
  const cls = s1 ? 'ok' : passedTest ? 'meh' : 'bad';
  const title = s3 ? 'Outstanding engineering' : s2 ? 'Approved for construction' : s1 ? 'Load test passed' : passedTest ? 'Test passed — design rejected' : 'Structural failure';
  const icon = s1 ? '<path d="M5 12.5l4.5 4.5L19 7.5"/>' : passedTest ? '<path d="M12 7v6M12 17h.01"/>' : '<path d="M7 7l10 10M17 7L7 17"/>';
  const hasNext = LEVELS.findIndex((l) => l.id === level.id) < LEVELS.length - 1 && !level.playground;
  $('modalCard').innerHTML = `<div class="result ${cls}"><div class="badge"><svg viewBox="0 0 24 24">${icon}</svg></div>
    <h2>${title}</h2><p>${level.code} · ${level.name}</p>
    <div class="stars3">
      <div class="star-row ${s1 ? 'on' : ''}">${STAR}<div><b>Safe crossing</b><span>${why1}</span></div></div>
      <div class="star-row ${s2 ? 'on' : ''}">${STAR}<div><b>Code compliant</b><span>${why2}</span></div></div>
      <div class="star-row ${s3 ? 'on' : ''}">${STAR}<div><b>Efficient</b><span>${why3}</span></div></div>
    </div>
    <div class="facts"><div><b>${fmt(cost)}</b><span>Cost</span></div><div><b>${pct(sim.maxRatio)}</b><span>Peak stress</span></div>
      <div><b>${(sim.maxDeflection * 1000).toFixed(0)} mm</b><span>Max deflection</span></div><div><b>${pct(an.maxUtil)}</b><span>Max ULS util.</span></div></div>
    ${diag}
    <div class="btns center"><button class="btn" data-act="edit">Back to design</button><button class="btn" data-act="replay">Replay</button>
    ${!passedTest ? '<button class="btn" data-act="watch">Keep watching</button>' : ''}
    ${hasNext && s1 ? '<button class="btn primary" data-act="next">Next project →</button>' : ''}</div></div>`;
  (s1 ? audio.success : audio.fail).call(audio);
  tutSawResult = true;
  $('modal').classList.remove('hidden');
  renderChecks();
}

$('modal').addEventListener('click', (e) => {
  const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
  if (!act) return;
  if (act === 'edit') { stopSim(); view = 'util'; syncHud(); }
  else if (act === 'replay') { stopSim(); startSim(); }
  else if (act === 'next') { const i = LEVELS.findIndex((l) => l.id === level.id); loadLevel(LEVELS[i + 1]); }
  else if (act === 'watch') $('modal').classList.add('hidden');
  else if (act === 'example') loadExample();
  else if (act === 'showme' && pendingFocus) { const f = pendingFocus; stopSim(); focusOn(f.beams, f.node); toast('Highlighted in blue — the inspector shows its numbers'); }
});

function openLevels() {
  const card = (l: Level, i: number) => {
    const p = progress[l.id];
    const stars = [0, 1, 2].map((k) => STAR.replace('<svg', `<svg class="${p && k < p.stars ? 'on' : ''}"`)).join('');
    const kinds = [...new Set(l.vehicles.map((v) => VEHICLES[v.kind].name))].join(' · ');
    return `<button class="level ${l.id === level.id ? 'current' : ''} ${l.playground ? 'pg' : ''}" data-level="${l.id}">
      <div class="lv-top"><span class="lv-code">${l.playground ? 'LAB' : `${String(i + 1).padStart(2, '0')} · ${l.code}`}</span><span class="mini-stars">${l.playground ? '' : stars}</span></div>
      <div class="lv-name">${l.name}</div>
      <div class="lv-meta">${l.playground ? 'Unlimited budget · free testing' : `${l.span} m span · ${fmt(l.budget)}${p ? ` · best ${fmt(p.best)}` : ''}`}</div>
      <div class="lv-meta">${l.playground ? 'Spawn traffic, drive, drop loads, earthquakes' : kinds}</div></button>`;
  };
  $('levelGrid').innerHTML = LEVELS.map(card).join('') + card(PLAYGROUND, 0);
  $('levels').classList.remove('hidden');
}
$('levelGrid').addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-level]');
  if (!el) return;
  $('levels').classList.add('hidden');
  loadLevel(ALL_LEVELS.find((l) => l.id === el.dataset.level)!);
});

function openHelp() {
  $('helpCard').innerHTML = `<div class="card-head"><h2>Engineer's handbook</h2><button class="btn primary" id="helpWalk" style="margin-left:auto;margin-right:8px">▶ Walkthrough</button><button class="btn" id="helpTut" style="margin-right:8px">Interactive tutorial</button><button class="icon" data-close><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg></button></div>
  <div class="cols"><div>
    <h3 style="margin-top:0">Workflow</h3>
    <p><b>1. Read the brief.</b> Span, design traffic, deflection and gradient limits, clearance zones and budget.</p>
    <p><b>2. Lay the deck</b> between the abutment anchors, then form a stable truss of triangles from timber, steel and cable.</p>
    <p><b>3. Check the design.</b> The right panel re-analyses after every edit: stability, strength (ULS), deflection (SLS), gradient. Switch the view to <i>Utilisation</i> or <i>Forces</i>.</p>
    <p><b>4. Size the members.</b> Select a member to see its forces, buckling capacity and slenderness; pick a lighter section where it is under-used.</p>
    <p><b>5. Load test.</b> Real vehicles cross with real dynamics. Members break at their characteristic strength.</p>
    <h3>Key ideas</h3>
    <p><b>Triangulate.</b> A pin-jointed truss is stable only if m + r ≥ 2j and every panel is braced.</p>
    <p><b>Buckling.</b> Compression capacity ≈ π²EI/L². Doubling a strut's length quarters its buckling load.</p>
    <p><b>Load factors.</b> Design forces are 1.35·dead + 1.5·live; resistances are divided by γ<sub>M</sub>. A bridge that survives the test may still fail the code.</p>
  </div><div>
    <h3 style="margin-top:0">Controls</h3>
    <div class="keys">
      <div><kbd>Drag</kbd> build a member</div><div><kbd>Right-click</kbd> delete</div>
      <div><kbd>1</kbd>–<kbd>4</kbd> materials</div><div><kbd>V</kbd> select · <kbd>J</kbd> move joints</div>
      <div><kbd>X</kbd> delete tool</div><div><kbd>Shift</kbd> free placement / multi-select</div>
      <div><kbd>Space</kbd> load test</div><div><kbd>P</kbd> pause · <kbd>.</kbd> step</div>
      <div><kbd>F</kbd> speed · <kbd>C</kbd> follow</div><div><kbd>Tab</kbd> cycle view</div>
      <div><kbd>N</kbd> labels · <kbd>D</kbd> deflection</div><div><kbd>+</kbd> <kbd>−</kbd> zoom · <kbd>0</kbd>/<kbd>R</kbd> fit</div>
      <div><kbd>⌘Z</kbd> undo · <kbd>⇧⌘Z</kbd> redo</div><div><kbd>Scroll</kbd> pan · <kbd>Pinch/⌘</kbd> zoom</div>
      <div><kbd>B</kbd> brief · <kbd>L</kbd> projects</div><div><kbd>←</kbd><kbd>→</kbd> drive (Playground)</div>
    </div>
    <h3>Model</h3>
    <p class="muted">2D pin-jointed truss representing one main truss plane carrying the full lane. Static analysis: direct stiffness method with moving-load envelope (0.5 m steps, both directions), tension-only cables, and geometric stiffness for cable-supported decks. Dynamics: XPBD with ${40} substeps per frame; axial force from constraint multipliers, failure at characteristic resistance (Rankine–Gordon buckling).</p>
  </div></div>`;
  $('helpCard').querySelector('[data-close]')!.addEventListener('click', () => $('help').classList.add('hidden'));
  $('helpCard').querySelector('#helpTut')!.addEventListener('click', startTutorial);
  $('helpCard').querySelector('#helpWalk')!.addEventListener('click', openWalkthrough);
  $('help').classList.remove('hidden');
}

// ---------------- tutorial ----------------
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
/** is there a member between these two points already */
function builtAt(g: Seg) {
  return design.beams.some((b) => {
    const A = design.node(b.a)!, B = design.node(b.b)!;
    return (near(A.x, g.ax) && near(A.y, g.ay) && near(B.x, g.bx) && near(B.y, g.by)) ||
      (near(A.x, g.bx) && near(A.y, g.by) && near(B.x, g.ax) && near(B.y, g.ay));
  });
}
const worldRect = (x0: number, y0: number, x1: number, y1: number) => {
  const a = R.toScreen(x0, y1), b = R.toScreen(x1, y0);
  return new DOMRect(a.x, a.y, b.x - a.x, b.y - a.y);
};
const checkOk = (id: string) => !!analysis?.checks.find((c) => c.id === id)?.ok;
const DECK_GUIDE: Seg[] = [0, 2, 4, 6, 8].map((x) => ({ ax: x, ay: 0, bx: x + 2, by: 0 }));
const TRUSS_GUIDE: Seg[] = [
  ...[0, 2, 4, 6, 8].flatMap((x) => [{ ax: x, ay: 0, bx: x + 1, by: -1.5 }, { ax: x + 1, ay: -1.5, bx: x + 2, by: 0 }]),
  ...[1, 3, 5, 7].map((x) => ({ ax: x, ay: -1.5, bx: x + 2, by: -1.5 })),
];
let tutSawResult = false;

const TUT_STEPS: TutStep[] = [
  {
    title: 'Welcome, engineer 👷',
    body: 'In about three minutes you will design, check and load-test your first bridge. This guide reacts to what you do — just follow the <b>blue highlights</b>.<span class="tip">You can exit any time with ✕ and restart from the <b>Tutorial</b> button in the top bar.</span>',
    next: true,
  },
  {
    title: 'The site',
    body: 'This is <b>Farm Track</b>: a 10 m creek. The <b>red triangles</b> are anchors — fixed foundations in the rock. The road on each bank ends at an anchor, so your deck has to run from one to the other.',
    target: () => worldRect(-1, -0.8, 11, 0.8),
    next: true,
  },
  {
    title: 'Pick the road deck',
    body: 'Vehicles can only drive on <b>Road deck</b>. Click it in the Tools panel, or press <kbd>1</kbd>.',
    target: () => document.querySelector('.tool[data-tool="deck"]'),
    done: () => tool === 'deck',
  },
  {
    title: 'Sections',
    body: 'Every material comes in standard sections. Each row shows weight, cost per metre, tension capacity <b>T</b> and compression capacity <b>C@3m</b> (for a 3 m long member — longer members buckle sooner). <b>Timber plank</b> is the cheapest deck; keep it selected.',
    target: () => $('sections'),
    next: true,
  },
  {
    title: 'Build the deck',
    body: 'Deck panels are at most 3 m long, so build it in <b>five 2 m panels</b> along the dashed blue line: drag from the left anchor to the first blue dot, then drag from that new joint to the next dot, and so on to the right anchor.<span class="tip">Mistake? <b>Right-click</b> a member to delete it, or press <kbd>⌘Z</kbd>.</span>',
    target: () => worldRect(-0.5, -0.6, 10.5, 0.6),
    guide: () => DECK_GUIDE,
    enter: () => setTool('deck'),
    done: () => design.beams.some((b) => b.mat === 'deck') && !!analysis && analysis.deckGapAt === null,
  },
  {
    title: 'Live design checks',
    body: 'The right panel re-analyses the bridge after every change. A chain of pinned panels cannot resist bending — it sags like a rope — so the <b>deflection</b> check fails. Engineers fix this with <b>triangles</b>.',
    target: () => $('objectivesSec'),
    next: true,
  },
  {
    title: 'Pick timber',
    body: 'Select <b>Timber</b> — light, cheap glulam. Click it or press <kbd>2</kbd>.',
    target: () => document.querySelector('.tool[data-tool="timber"]'),
    done: () => tool === 'timber',
  },
  {
    title: 'Build a truss',
    body: 'Hang triangles under the deck: from each deck joint, drag <b>down to the blue points</b> 1.5 m below, making V shapes. Then join the bottom points to each other. Watch the checks turn green.<span class="tip">A triangle cannot change shape without stretching a member — that is why trusses are stiff.</span>',
    guide: () => TRUSS_GUIDE,
    enter: () => setTool('timber'),
    done: () => design.beams.some((b) => b.mat === 'timber') && checkOk('stable') && checkOk('uls') && checkOk('sls') && checkOk('deck'),
  },
  {
    title: 'Utilisation view',
    body: 'Switch to <b>Utilisation</b>. Each member is coloured by how hard it works under the factored design load (1.35 × dead + 1.5 × traffic): green is relaxed, red is over 100%. <kbd>Tab</kbd> cycles views.',
    target: () => $('viewSeg'),
    enter: () => { if (view === 'util') { view = 'material'; syncHud(); } },
    done: () => view === 'util',
  },
  {
    title: 'Inspect a member',
    body: 'Choose <b>Select</b> (<kbd>V</kbd>) and click any member of your bridge.',
    target: () => (tool === 'select' ? worldRect(-0.5, -2, 10.5, 0.5) : document.querySelector('.tool[data-tool="select"]')),
    done: () => selected.size > 0,
  },
  {
    title: 'The inspector',
    body: 'Here is everything an engineer needs: section size, slenderness <b>L/r</b>, tension and buckling resistance, and the forces from dead load (G) and traffic (Q). Try another section from the dropdown — the checks update instantly.',
    target: () => $('inspectorSec'),
    next: true,
  },
  {
    title: 'Run the load test',
    body: 'Time to prove it. Press <b>Load test</b> (<kbd>Space</kbd>). Real vehicles will drive across, and any member pushed past its strength will break.',
    target: () => $('playBtn'),
    enter: () => { tutSawResult = false; },
    done: () => !!sim,
  },
  {
    title: 'Watch it work',
    body: 'Hover a member to read its live force. The bar below has <b>pause</b> (<kbd>P</kbd>), <b>step</b> (<kbd>.</kbd>), <b>speed</b> (<kbd>F</kbd>) and <b>follow camera</b> (<kbd>C</kbd>). Wait for the vehicles to reach the far bank.',
    target: () => $('simbar'),
    done: () => tutSawResult,
  },
  {
    title: 'Results & stars',
    body: 'Each project awards three stars: <b>safe crossing</b>, <b>code compliant</b> (strength, deflection, gradient) and <b>efficient</b> (≤ 80% of budget). Read each project\'s <b>Brief</b> (<kbd>B</kbd>), and try anything you like in the <b>Playground</b>. Good luck, engineer!',
    target: () => (document.querySelector('#modal:not(.hidden) .card') as Element | null),
    finish: 'Start building',
  },
];

const tut = new Tutorial(TUT_STEPS, (completed) => {
  store.set('tutorialDone', completed || store.get('tutorialDone', false));
  if (completed) toast('Tutorial complete — open Projects (L) to continue');
}, () => audio.place());

function startTutorial() {
  document.querySelectorAll('.overlay').forEach((o) => o.classList.add('hidden'));
  const l1 = LEVELS.find((l) => l.id === 'l1')!;
  if (level.id !== l1.id || sim) loadLevel(l1, false);
  if (design.beams.length) {
    design.checkpoint();
    design.reset();
    selected = new Set();
    designChanged();
    toast('Your previous design is saved in undo (⌘Z)');
  }
  view = 'material';
  fitView();
  syncHud();
  tut.start();
}

function openWelcome() {
  $('modalCard').innerHTML = `<div class="welcome"><div class="big">🌉</div><h2>Welcome to Span</h2>
    <p class="lead" style="margin-top:8px">A bridge engineering simulator. Design with real materials and sections, check your bridge against design-code limits, then load-test it with live traffic.</p>
    <ul><li>Walkthrough video + written guide — about 3 minutes</li><li>9 engineering projects + a free Playground</li><li>Handbook any time with <kbd>?</kbd></li></ul>
    <div class="btns center"><button class="btn" data-w="skip">Skip</button><button class="btn" data-w="tut">Interactive tutorial</button><button class="btn primary" data-w="walk">▶ Watch the walkthrough</button></div></div>`;
  $('modal').classList.remove('hidden');
  $('modalCard').querySelector('[data-w="tut"]')!.addEventListener('click', () => { $('modal').classList.add('hidden'); startTutorial(); });
  $('modalCard').querySelector('[data-w="skip"]')!.addEventListener('click', () => { $('modal').classList.add('hidden'); openBrief(); });
  $('modalCard').querySelector('[data-w="walk"]')!.addEventListener('click', () => { $('modal').classList.add('hidden'); openWalkthrough(); });
}

const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const chapterTime = (n: string) => (CHAPTERS as { n: string; t: number }[]).find((c) => c.n === n)?.t ?? null;

function openWalkthrough() {
  document.querySelectorAll('.overlay').forEach((o) => o.classList.add('hidden'));
  if (tut.active) tut.stop();
  const chapters = CHAPTERS as { n: string; title: string; sub: string; t: number }[];
  const card = $('walkCard');
  card.innerHTML = `<div class="card-head"><div><h2>Walkthrough</h2><div class="muted">Watch the video, jump to any chapter, or follow the written steps below.</div></div>
      <div style="display:flex;gap:8px"><button class="btn" id="walkTut">Try it interactively</button><button class="icon" data-close><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg></button></div></div>
    <div class="walk-top">
      <div id="vidWrap"><video id="walkVid" src="${VIDEO_SRC}" controls playsinline preload="metadata"></video></div>
      <div class="chapters">${chapters.map((c) => `<button class="chap" data-ch="${c.n}"><span class="cn">${c.n}</span><span class="ct">${c.title}</span><span class="ts">${mmss(c.t)}</span></button>`).join('')}</div>
    </div>
    <div class="guide">${GUIDE.map((g) => {
      const t = chapterTime(g.ch);
      return `<section class="gsec" data-sec="${g.ch}"><h4><span class="cn">${g.ch}</span>${g.title}${t !== null ? `<button data-ch="${g.ch}">▶ ${mmss(t)}</button>` : ''}</h4>
        <ol>${g.steps.map((s) => `<li>${s}</li>`).join('')}</ol>${g.tip ? `<div class="tip">💡 ${g.tip}</div>` : ''}</section>`;
    }).join('')}</div>`;
  const vid = card.querySelector('video') as HTMLVideoElement;
  vid.addEventListener('error', () => {
    $('vidWrap').innerHTML = `<div class="vid-missing"><div><b>Video file not found</b><br>Keep <code>Span Tutorial.mp4</code> in the same folder as this page.<br>The written guide below covers every step.</div></div>`;
  });
  const seek = (n: string) => {
    const t = chapterTime(n);
    const v = document.getElementById('walkVid') as HTMLVideoElement | null;
    if (t === null || !v) return;
    v.currentTime = t;
    void v.play().catch(() => undefined);
    v.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  card.querySelectorAll<HTMLElement>('[data-ch]').forEach((b) => (b.onclick = () => seek(b.dataset.ch!)));
  vid.addEventListener('timeupdate', () => {
    let cur = '';
    for (const c of chapters) if (vid.currentTime >= c.t) cur = c.n;
    card.querySelectorAll<HTMLElement>('.chap').forEach((el) => el.classList.toggle('on', el.dataset.ch === cur));
    card.querySelectorAll<HTMLElement>('.gsec').forEach((el) => el.classList.toggle('on', el.dataset.sec === cur));
  });
  card.querySelector('[data-close]')!.addEventListener('click', () => { vid.pause(); $('walk').classList.add('hidden'); });
  card.querySelector('#walkTut')!.addEventListener('click', () => { vid.pause(); $('walk').classList.add('hidden'); startTutorial(); });
  $('walk').classList.remove('hidden');
}

// ---------------- buttons ----------------
$('levelBtn').onclick = openLevels;
$('briefBtn').onclick = openBrief;
$('walkBtn').onclick = openWalkthrough;
$('playgroundBtn').onclick = () => (level.playground ? openBrief() : loadLevel(PLAYGROUND));
$('helpBtn').onclick = openHelp;
$('playBtn').onclick = () => (sim ? stopSim() : startSim());
$('pauseBtn').onclick = () => { paused = !paused; syncHud(); };
$('stepBtn').onclick = () => { if (sim && paused) { sim.step(); handleEvents(); } };
$('speedBtn').onclick = () => { speedIdx = (speedIdx + 1) % SPEEDS.length; syncHud(); };
$('followBtn').onclick = () => { follow = !follow; syncHud(); };
$('undoBtn').onclick = () => { if (!sim && design.undo()) { designChanged(); audio.remove(); } };
$('redoBtn').onclick = () => { if (!sim && design.redo()) { designChanged(); audio.place(); } };
$('clearBtn').onclick = () => {
  if (sim || !design.beams.length) return;
  design.checkpoint();
  design.reset();
  selected = new Set();
  designChanged();
  audio.remove();
  toast('Design cleared — ⌘Z to undo');
};
document.querySelectorAll<HTMLElement>('#viewSeg button').forEach((b) => (b.onclick = () => { view = b.dataset.view as ViewMode; store.set('view', view); syncHud(); }));
$('labelsBtn').onclick = () => { labels = !labels; store.set('labels', labels); syncHud(); };
$('shapeBtn').onclick = () => { shapeOn = !shapeOn; store.set('shape', shapeOn); syncHud(); };
$('gridBtn').onclick = () => { grid = !grid; store.set('grid', grid); syncHud(); };
$('soundBtn').onclick = () => { audio.muted = !audio.muted; store.set('muted', audio.muted); syncHud(); };
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('.overlay')!.classList.add('hidden')));
document.querySelectorAll('.overlay').forEach((o) => o.addEventListener('click', (e) => { if (e.target === o && o.id !== 'modal') { o.querySelector('video')?.pause(); o.classList.add('hidden'); } }));

// ---------------- pointer input ----------------
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('pointerdown', (e) => {
  audio.unlock();
  canvas.setPointerCapture(e.pointerId);
  mouse = { x: e.offsetX, y: e.offsetY };
  const w = R.toWorld(mouse.x, mouse.y);
  const base = { sx: w.x, sy: w.y, px: mouse.x, py: mouse.y, moved: false, startNode: null };
  const pan = () => { drag = { ...base, kind: 'pan' }; canvas.classList.add('panning'); };

  if (e.button === 1 || (e.button === 0 && e.altKey)) return pan();

  if (sim) {
    if (e.button === 0 && tool === 'drop' && level.playground) {
      sim.dropLoad(w.x, w.y, pg.loadMass);
      audio.place();
      return;
    }
    if (e.button === 0 && level.playground) {
      const v = vehicleAt(w);
      if (v) { takeControl(v); return; }
    }
    return pan();
  }

  if (e.button === 2) {
    if (drag?.kind === 'beam') { drag = null; preview = null; return; }
    eraseAt(w);
    drag = { ...base, kind: 'erase' };
    return;
  }
  if (e.button !== 0) return;

  if (tool === 'delete') {
    eraseAt(w);
    drag = { ...base, kind: 'erase' };
    return;
  }
  if (tool === 'drop') {
    // dropping loads needs a running simulation
    ensureSim().dropLoad(w.x, w.y, pg.loadMass);
    audio.place();
    return;
  }
  if (tool === 'select') {
    const bid = beamAt(w);
    if (bid !== null) {
      if (e.shiftKey || e.metaKey) selected.has(bid) ? selected.delete(bid) : selected.add(bid);
      else selected = new Set([bid]);
      const b = design.beams.find((x) => x.id === bid)!;
      secByMat[b.mat] = b.sec;
    } else if (!e.shiftKey) selected = new Set();
    renderInspector();
    renderSections();
    if (bid === null) pan();
    return;
  }
  if (tool === 'move') {
    const nid = nodeAt(w);
    if (nid !== null && !design.node(nid)!.anchor) {
      design.checkpoint();
      drag = { ...base, kind: 'move', startNode: nid };
    } else pan();
    return;
  }
  // build
  const nid = nodeAt(w);
  let start: Vec;
  if (nid !== null) {
    const n = design.node(nid)!;
    start = { x: n.x, y: n.y };
  } else {
    start = gridSnap(w, e.shiftKey);
    const existing = design.nodes.find((n) => Math.abs(n.x - start.x) < 1e-6 && Math.abs(n.y - start.y) < 1e-6);
    if (!existing && !design.placeable(start)) return pan();
  }
  drag = { ...base, kind: 'beam', startNode: nid, sx: start.x, sy: start.y };
  updatePreview(e.shiftKey);
});

function eraseAt(w: Vec) {
  const nid = nodeAt(w);
  if (nid !== null && !design.node(nid)!.anchor) {
    design.checkpoint();
    design.removeNode(nid);
  } else {
    const bid = beamAt(w);
    if (bid === null) return;
    design.checkpoint();
    design.removeBeam(bid);
  }
  designChanged();
  audio.remove();
}

function updatePreview(free: boolean) {
  if (!drag || drag.kind !== 'beam' || !MATERIAL_ORDER.includes(tool as MaterialId)) { preview = null; return; }
  const mat = tool as MaterialId;
  const w = R.toWorld(mouse.x, mouse.y);
  const start = { x: drag.sx, y: drag.sy };
  const end = beamEnd(start, drag.startNode, w, mat, free);
  const L = Math.hypot(end.x - start.x, end.y - start.y);
  let valid = true, reason = '';
  if (L < 0.3) { valid = false; reason = 'Too short'; }
  else if (end.node === null && !design.placeable(end)) { valid = false; reason = level.noBuild.some((z) => end.x > z.x0 && end.x < z.x1 && end.y > z.y0 && end.y < z.y1) ? 'Inside clearance zone' : 'Cannot place joint here'; }
  else if (!design.segmentAllowed(start, end)) { valid = false; reason = 'Crosses clearance zone'; }
  else if (drag.startNode !== null && end.node !== null) {
    const dup = design.findBeam(drag.startNode, end.node);
    if (dup && dup.mat === mat && dup.sec === secByMat[mat]) { valid = false; reason = 'Already built'; }
  }
  preview = { ax: start.x, ay: start.y, bx: end.x, by: end.y, mat, sec: secByMat[mat], valid, maxLen: MATERIALS[mat].maxLength, reason };
}

canvas.addEventListener('pointermove', (e) => {
  const prev = mouse;
  mouse = { x: e.offsetX, y: e.offsetY };
  const w = R.toWorld(mouse.x, mouse.y);
  if (drag) {
    if (Math.hypot(mouse.x - drag.px, mouse.y - drag.py) > 3) drag.moved = true;
    if (drag.kind === 'pan') {
      R.cam.x -= (mouse.x - prev.x) / R.cam.zoom;
      R.cam.y += (mouse.y - prev.y) / R.cam.zoom;
      follow = false;
    } else if (drag.kind === 'beam') updatePreview(e.shiftKey);
    else if (drag.kind === 'move' && drag.startNode !== null) {
      const p = gridSnap(w, e.shiftKey);
      const n = design.node(drag.startNode)!;
      if ((p.x !== n.x || p.y !== n.y) && design.placeable(p) && design.canMove(n.id, p.x, p.y) && !design.nodes.some((o) => o.id !== n.id && Math.hypot(o.x - p.x, o.y - p.y) < 0.1)) {
        n.x = p.x; n.y = p.y;
        syncHud();
        scheduleAnalysis();
      }
    } else if (drag.kind === 'erase') {
      const nid = nodeAt(w), bid = beamAt(w);
      if ((nid !== null && !design.node(nid)!.anchor) || bid !== null) eraseAt(w);
    }
  }
  updateHover(w);
});

canvas.addEventListener('pointerup', (e) => {
  if (!drag) return;
  if (drag.kind === 'beam' && preview?.valid) commitBeam();
  else if (drag.kind === 'beam' && preview && !preview.valid && drag.moved) { audio.error(); toast(preview.reason); }
  if (drag.kind === 'move') designChanged();
  drag = null;
  preview = null;
  canvas.classList.remove('panning');
  canvas.releasePointerCapture(e.pointerId);
  updateHover(R.toWorld(mouse.x, mouse.y));
});

function commitBeam() {
  if (!drag || !preview) return;
  const mat = tool as MaterialId;
  design.checkpoint();
  const a = drag.startNode ?? findOrAdd(preview.ax, preview.ay);
  const b = design.nodes.find((n) => Math.abs(n.x - preview!.bx) < 1e-6 && Math.abs(n.y - preview!.by) < 1e-6)?.id ?? findOrAdd(preview.bx, preview.by);
  design.addBeam(a, b, mat, secByMat[mat]);
  designChanged();
  audio.place();
}
function findOrAdd(x: number, y: number) {
  const n = design.nodes.find((o) => Math.abs(o.x - x) < 1e-6 && Math.abs(o.y - y) < 1e-6);
  return n ? n.id : design.addNode(x, y).id;
}

const tooltip = $('tooltip');
function updateHover(w: Vec) {
  hoverNode = null;
  hoverBeam = null;
  let html = '';
  if (sim) {
    const mi = simMemberAt(w);
    const v = level.playground ? vehicleAt(w) : null;
    if (v) {
      const V = VEHICLES[v.kind];
      html = `<b>${V.name}</b> · ${tonnes(V.mass)}<br><span class="muted">${(Math.abs(sim.vehicleSpeed(v)) * 3.6).toFixed(0)} km/h · click to drive</span>`;
    } else if (mi !== null) {
      hoverBeam = mi;
      const m = sim.members[mi];
      const slack = m.Nc === 0 && m.force <= 0;
      const kind = m.force >= 0 ? 'tension' : 'compression';
      html = `<span class="dot" style="background:${utilColor(m.ratio)}"></span><b>${MATERIALS[m.mat!].name} ${sectionOf(m.mat!, m.sec).name}</b><br>
        <span class="muted">${slack ? 'slack — no load' : `${kNs(Math.abs(m.force), 1)} ${kind} · ${pct(m.ratio)} of capacity`}</span>`;
    }
  } else if (!drag || drag.kind === 'erase') {
    hoverNode = nodeAt(w);
    if (hoverNode === null) hoverBeam = beamAt(w);
    if (hoverBeam !== null) {
      const b = design.beams.find((x) => x.id === hoverBeam)!;
      const r = analysis?.members.get(b.id);
      const L = design.beamLength(b);
      html = `<b>${MATERIALS[b.mat].name} ${sectionOf(b.mat, b.sec).name}</b> · ${L.toFixed(2)} m · ${fmt(design.beamCost(b))}`;
      if (r && analysis?.stable) {
        const N = r.NEdT / Math.max(1, r.NtRd) >= r.NEdC / Math.max(1, r.NcRd) ? r.NEdT : -r.NEdC;
        html += `<br><span class="dot" style="background:${utilColor(r.util)}"></span>${r.mode === 'slack' ? 'slack under some loads' : `N<sub>Ed</sub> ${N >= 0 ? '+' : '−'}${kNs(Math.abs(N))} · ${pct(r.util)} ${r.mode}`}`;
      }
    } else if (hoverNode !== null) {
      const n = design.node(hoverNode)!;
      if (n.anchor) {
        const re = analysis?.reactions.find((x) => x.nodeId === n.id);
        html = `<b>Anchor</b> · fixed foundation${re ? `<br><span class="muted">dead-load reaction H ${kNs(re.Rx, 1)}, V ${kNs(re.Ry, 1)}</span>` : ''}`;
      } else {
        const sh = analysis?.shape.get(n.id);
        html = `<b>Joint</b> · (${n.x.toFixed(2)}, ${n.y.toFixed(2)}) m${sh ? `<br><span class="muted">worst SLS deflection ${(Math.hypot(sh.dx, sh.dy) * 1000).toFixed(1)} mm</span>` : ''}`;
      }
    }
  }
  tooltip.innerHTML = html;
  tooltip.classList.toggle('show', !!html);
  tooltip.style.left = mouse.x + 'px';
  tooltip.style.top = mouse.y + 'px';
}

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const isMouseWheel = e.deltaMode === 1 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY));
  if (e.ctrlKey || e.metaKey || isMouseWheel) {
    zoomAnim = null;
    const before = R.toWorld(e.offsetX, e.offsetY);
    const k = Math.exp(-e.deltaY * (e.ctrlKey && !isMouseWheel ? 0.012 : 0.0015));
    R.cam.zoom = Math.max(5, Math.min(160, R.cam.zoom * k));
    const after = R.toWorld(e.offsetX, e.offsetY);
    R.cam.x += before.x - after.x;
    R.cam.y += before.y - after.y;
  } else {
    R.cam.x += e.deltaX / R.cam.zoom;
    R.cam.y -= e.deltaY / R.cam.zoom;
    follow = false;
  }
  updateHover(R.toWorld(mouse.x, mouse.y));
}, { passive: false });

// ---------------- zoom controls ----------------
let fitZoom = 40;
let zoomAnim: { from: number; to: number; ax: number; ay: number; t: number } | null = null;
/** zoom around a screen point (default: centre of the free canvas area), animated */
function zoomBy(factor: number, sx?: number, sy?: number) {
  const ax = sx ?? (R.insets.left + (R.W - R.insets.right - R.insets.left) / 2);
  const ay = sy ?? (R.insets.top + (R.H - R.insets.bottom - R.insets.top) / 2);
  const base = zoomAnim ? zoomAnim.to : R.cam.zoom;
  zoomAnim = { from: R.cam.zoom, to: Math.max(5, Math.min(160, base * factor)), ax, ay, t: 0 };
}
function fitView() {
  R.fit(level);
  fitZoom = R.cam.zoom;
  zoomAnim = null;
}
function stepZoom(dt: number) {
  if (!zoomAnim) return;
  zoomAnim.t = Math.min(1, zoomAnim.t + dt / 0.18);
  const e = 1 - (1 - zoomAnim.t) ** 3;
  const before = R.toWorld(zoomAnim.ax, zoomAnim.ay);
  R.cam.zoom = zoomAnim.from * (zoomAnim.to / zoomAnim.from) ** e;
  const after = R.toWorld(zoomAnim.ax, zoomAnim.ay);
  R.cam.x += before.x - after.x;
  R.cam.y += before.y - after.y;
  if (zoomAnim.t >= 1) zoomAnim = null;
}
$('zoomIn').onclick = () => zoomBy(1.3);
$('zoomOut').onclick = () => zoomBy(1 / 1.3);
$('zoomFit').onclick = fitView;
$('zoomVal').onclick = fitView;

// ---------------- keyboard ----------------
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener('keydown', (e) => {
  const tag = (e.target as HTMLElement).tagName;
  if (tag === 'INPUT' || tag === 'SELECT') return;
  const mod = e.metaKey || e.ctrlKey;
  const k = e.key.toLowerCase();
  if (mod && k === 'z') { e.preventDefault(); (e.shiftKey ? $('redoBtn') : $('undoBtn')).click(); return; }
  if (mod && k === 'y') { e.preventDefault(); $('redoBtn').click(); return; }
  if (mod) return;
  const drivingNow = sim && driving !== null;
  if (drivingNow && ['arrowleft', 'arrowright', 'a', 'd'].includes(k)) { keys.add(k); e.preventDefault(); return; }
  if (e.key === 'Escape') {
    if (drag?.kind === 'beam') { drag = null; preview = null; return; }
    const open = document.querySelector('.overlay:not(.hidden)');
    if (open) { open.querySelector('video')?.pause(); open.classList.add('hidden'); return; }
    if (driving !== null) { releaseDrive(); return; }
    if (selected.size) { selected = new Set(); renderInspector(); return; }
    if (sim) stopSim();
    return;
  }
  if (e.key === 'Tab') {
    e.preventDefault();
    const order: ViewMode[] = ['material', 'util', 'force'];
    view = order[(order.indexOf(view) + 1) % 3];
    store.set('view', view);
    syncHud();
    return;
  }
  if (e.key === ' ') { e.preventDefault(); $('playBtn').click(); return; }
  if ((e.key === 'Delete' || e.key === 'Backspace') && selected.size && !sim) {
    design.checkpoint();
    for (const id of selected) design.removeBeam(id);
    selected = new Set();
    designChanged();
    audio.remove();
    return;
  }
  const mat = MATERIAL_ORDER.find((m) => MATERIALS[m].hotkey === e.key);
  if (mat && level.materials.includes(mat)) setTool(mat);
  else if (k === 'v') setTool('select');
  else if (k === 'j') setTool('move');
  else if (k === 'x' || e.key === 'Delete') setTool('delete');
  else if (k === 'o' && level.playground) setTool('drop');
  else if (k === 'g') $('gridBtn').click();
  else if (k === 'n') $('labelsBtn').click();
  else if (k === 'd') $('shapeBtn').click();
  else if (k === 'p') $('pauseBtn').click();
  else if (e.key === '.') $('stepBtn').click();
  else if (k === 'f') $('speedBtn').click();
  else if (k === 'c') $('followBtn').click();
  else if (k === 'l') openLevels();
  else if (k === 'b') openBrief();
  else if (k === 'w') openWalkthrough();
  else if (k === 'r') fitView();
  else if (e.key === '?') openHelp();
  else if (e.key === '=' || e.key === '+') zoomBy(1.3);
  else if (e.key === '-' || e.key === '_') zoomBy(1 / 1.3);
  else if (e.key === '0') fitView();
  else if (e.key.startsWith('Arrow')) {
    const s = 60 / R.cam.zoom;
    if (e.key === 'ArrowLeft') R.cam.x -= s;
    if (e.key === 'ArrowRight') R.cam.x += s;
    if (e.key === 'ArrowUp') R.cam.y += s;
    if (e.key === 'ArrowDown') R.cam.y -= s;
  }
});

window.addEventListener('resize', () => R.resize());

// ---------------- main loop ----------------
const statsEl = $('stats');
let last = performance.now();
let fpsAcc = 0, fpsFrames = 0, physAcc = 0, renderMs = 0, inspAcc = 0;

function updateDriving() {
  if (!sim) return;
  if (pendingDrive) {
    const v = [...sim.vehicles].reverse().find((x) => !x.removed && x.kind === pg.kind && !x.manual);
    if (v) { pendingDrive = false; takeControl(v); }
  }
  if (driving === null) return;
  const v = sim.vehicles.find((x) => x.id === driving);
  if (!v || v.removed) { driving = null; renderPlayground(); return; }
  const fwd = keys.has('arrowright') || keys.has('d');
  const back = keys.has('arrowleft') || keys.has('a');
  v.throttle = fwd && !back ? 1 : back && !fwd ? -1 : 0;
  const sp = document.getElementById('speedo');
  if (sp) sp.textContent = (Math.abs(sim.vehicleSpeed(v)) * 3.6).toFixed(0);
}

function updateTraffic(dt: number) {
  if (!sim || !pg.traffic) return;
  pg.trafficAcc += dt;
  const interval = 60 / pg.rate;
  if (pg.trafficAcc < interval) return;
  pg.trafficAcc = 0;
  const mix: VehicleKind[] = ['car', 'car', 'car', 'pickup', 'van', 'van', 'bus', 'hgv'];
  const kind = mix[Math.floor(Math.random() * mix.length)];
  if (sim.queued < 6) sim.enqueue(kind, Math.random() < 0.5 ? 1 : -1);
}

function updateFollow() {
  if (!sim || !follow) return;
  let target: Vec | null = null;
  if (driving !== null) {
    const v = sim.vehicles.find((x) => x.id === driving);
    if (v && !v.removed) target = sim.vehicleCenter(v);
  }
  if (!target) {
    const live = sim.vehicles.filter((v) => !v.removed && !v.arrived);
    if (live.length) {
      const cs = live.map((v) => sim!.vehicleCenter(v));
      target = { x: cs.reduce((s, c) => s + c.x, 0) / cs.length, y: cs.reduce((s, c) => s + c.y, 0) / cs.length };
    }
  }
  if (!target) return;
  const offX = (R.insets.left - R.insets.right) / 2 / R.cam.zoom;
  R.cam.x += (target.x - offX - R.cam.x) * 0.06;
  R.cam.y += (target.y + 2 - R.cam.y) * 0.04;
}

function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  time += dt;

  if (sim) {
    updateDriving();
    const t0 = performance.now();
    if (!paused) {
      acc += dt * SPEEDS[speedIdx];
      updateTraffic(dt * SPEEDS[speedIdx]);
      let steps = 0;
      while (acc >= FRAME_DT && steps < 8) {
        sim.step();
        acc -= FRAME_DT;
        steps++;
      }
      if (steps === 8) acc = 0;
    }
    physAcc += performance.now() - t0;
    handleEvents();
    updateFollow();
    if (!level.playground && sim.outcome !== 'running' && !resultShown) {
      if (!outcomeAt) outcomeAt = now;
      if (now - outcomeAt > (sim.outcome === 'success' ? 800 : 1800)) {
        resultShown = true;
        showResult();
      }
    }
    inspAcc += dt;
    if (inspAcc > 0.25) { inspAcc = 0; renderInspector(); }
  }

  stepZoom(dt);
  $('zoomVal').textContent = `${Math.round((R.cam.zoom / fitZoom) * 100)}%`;
  const r0 = performance.now();
  R.draw(level, design, sim, {
    mode: sim ? 'sim' : 'build',
    view, grid, labels, shape: shapeOn,
    hoverNode, hoverBeam, selected, preview, peaks,
    analysis,
    moveNode: drag?.kind === 'move' ? drag.startNode : null,
    driving,
    loadCursor: tool === 'drop' && level.playground ? { ...R.toWorld(mouse.x, mouse.y), mass: pg.loadMass } : null,
    guide: sim ? [] : tut.guide().filter((g) => !builtAt(g)),
    time,
  }, dt);
  tut.tick(now);
  renderMs = renderMs * 0.9 + (performance.now() - r0) * 0.1;

  fpsAcc += dt; fpsFrames++;
  if (fpsAcc >= 0.5) {
    const fps = fpsFrames / fpsAcc;
    const physMs = physAcc / fpsFrames;
    statsEl.textContent = `${Math.round(fps)} fps · render ${renderMs.toFixed(1)} ms` +
      (sim ? ` · physics ${physMs.toFixed(2)} ms/frame` : analysis ? ` · analysis ${analysis.ms.toFixed(1)} ms (${analysis.cases} cases)` : '');
    $('simTime').innerHTML = sim
      ? `<b>t = ${sim.time.toFixed(1)} s</b> · ${sim.vehicles.filter((v) => !v.removed).length} vehicles · peak ${pct(sim.maxRatio)}${paused ? ' · <b>paused</b>' : ''}`
      : `Design mode · ${design.beams.length} members · ${design.nodes.filter((n) => !n.anchor).length} joints`;
    fpsAcc = 0; fpsFrames = 0; physAcc = 0;
  }
  requestAnimationFrame(frame);
}

($('storyLink') as HTMLAnchorElement).href = location.protocol === 'file:' ? 'Bridge%20Story.html' : 'story.html';
loadLevel(level, false);
if (location.hash === '#walkthrough') {
  store.set('seenWelcome', true);
  openWalkthrough();
} else if (!store.get('seenWelcome', false)) {
  store.set('seenWelcome', true);
  openWelcome();
} else openBrief();
requestAnimationFrame(frame);

// hook used by scripts/record-video.ts to aim the cursor at world coordinates
(window as unknown as { __span: unknown }).__span = { toScreen: (x: number, y: number) => R.toScreen(x, y) };
