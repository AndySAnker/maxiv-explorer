// Visitable beamlines: CoSAXS (SAXS/WAXS) and DanMAX (powder diffraction / PDF).
// One engine, one state per beamline. In the hutch you mount a sample or a calibrant and search the hutch; in the
// control cabin you measure (with a live hutch camera), calibrate and save the geometry, reduce 2D → 1D (mask +
// PONI geometry) and analyse. Detector images are simulated from patterns calculated with DebyeCalculator (grid pair
// sum, PR #44): tools/cosaxs_debye.py and tools/danmax_debye.py.
import * as THREE from 'three';
import { G } from './state.js';
import { earn, charge, canPay, fmt, PRICE, BEAMTIME_HOUR } from './economy.js';
import { mat, clamp, textPlane } from './util.js';
import { B, M, BOX, CYL } from './build.js';
import { addBox, addCircle } from './physics.js';
import { COSAXS } from './cosaxs_data.js';
import { DANMAX } from './danmax_data.js';
import { plotXY } from './plot.js';

// ---------------- beamline configurations ----------------
const cubicPeaks = (a, lattice, qmax = 18) => {
  const out = new Map();
  for (let h = 0; h <= 12; h++) for (let k = 0; k <= h; k++) for (let l = 0; l <= k; l++) {
    const s = h * h + k * k + l * l; if (!s) continue;
    if (lattice === 'fcc' && !((h % 2 === k % 2) && (k % 2 === l % 2))) continue;
    const q = 2 * Math.PI * Math.sqrt(s) / a; if (q > qmax) continue;
    if (!out.has(s)) out.set(s, { q, hkl: `${h}${k}${l}` });
  }
  return [...out.values()].sort((x, y) => x.q - y.q);
};
const CFG = {
  cosaxs: {
    key: 'cosaxs', title: 'CoSAXS', color: '#c9a8ff', data: COSAXS, calKey: 'beamtime.cosaxs.calibrations',
    DET: { W: 155.1, H: 162.2, nx: 310, ny: 324, cx: 0.52, cy: 0.55, bs: 2.6, gaps: { vx: [0.5], vw: 0.004, hy: [0.25, 0.5, 0.75], hw: 0.009 } },
    PIX: 0.075, DPX: { nx: 2068, ny: 2162 },
    det: { name: 'EIGER2 4M', info: 'DECTRIS EIGER2 4M: 2068 × 2162 pixels of 75 µm on 155 × 162 mm. Small pixels resolve the closely spaced rings at small angles; it moves inside the evacuated flight tube to change the sample–detector distance.' }, TRUE: { dL: 0.137, bx: 1.8, by: -1.2 },
    L: [0.25, 12, 0.05, 3.0], E: [6, 20, 0.1, 12.4], Lref: 3, FLUX: 3.0e6, RATE_MAX: 2.0e6, DIRECT: 5.0e10, motor: 1.6,
    REL: { au: 1.0, ceo2: 0.55, zno: 0.3, agbeh: 0.6, lab6: 0.8 }, logI: true, linBins: false, minRings: (s) => (s.id === 'lab6' ? 1 : 2), // one LaB₆ ring is enough when λ is known
    BG: (q) => 1.5e-6 + (q < 0.04 ? 4e-5 * Math.pow(Math.max(q, 1e-4) / 0.003, -3) : 0),
    peaks: (s) => s.peaks.map((q, i) => ({ q, hkl: s.id === 'agbeh' ? `00${i + 1}` : ['100', '110', '111', '200', '210', '211'][i] || '' })),
    cal: [{ id: 'agbeh', sub: 'SAXS – long distance (≥ 1 m)' }, { id: 'lab6', sub: 'WAXS – short distance + high energy (e.g. 0.3 m at 12.4 keV)' }],
    calTask: (f) => (f.std === 'agbeh' && f.L >= 2 ? 'cal_saxs' : f.std === 'lab6' && f.L <= 0.6 ? 'cal_waxs' : null),
    unit: 'qA', log: true, bins: 200,
    tasks: [
      { id: 'cal_saxs', text: 'Calibrate with AgBeH (≥ 2 m)', reward: 20000 },
      { id: 'cal_waxs', text: 'Calibrate with LaB₆ (≤ 0.6 m, high energy)', reward: 20000 },
      { id: 'reduce_ok', text: 'Clean 2D → 1D reduction', reward: 25000, ok: () => true },
      { id: 'au_saxs', text: 'Au: size fringes (q 0.05–0.3 Å⁻¹)', reward: 30000, ok: (r) => r.id === 'au' && r.qa < 0.05 && r.qb > 0.3 },
      { id: 'zno_rod', text: 'ZnO: rod slope (q 0.01–0.08 Å⁻¹)', reward: 30000, ok: (r) => r.id === 'zno' && r.qa < 0.01 && r.qb > 0.08 },
      { id: 'ceo2_bragg', text: 'CeO₂: (111) peak at 2.01 Å⁻¹', reward: 30000, ok: (r) => r.id === 'ceo2' && r.qb > 2.06 },
      { id: 'au_bragg', text: 'Au: (111) + (200) peaks', reward: 50000, ok: (r) => r.id === 'au' && r.qb > 3.15 },
      { id: 'bg_sub', text: 'Subtract a background', reward: 25000, ok: (r) => r.bgUsed },
    ],
  },
  danmax: {
    key: 'danmax', title: 'DanMAX', color: '#ff8f8f', data: DANMAX, calKey: 'beamtime.danmax.calibrations.p4cdte4m',
    // DECTRIS PILATUS4 X CdTe 4M: 4 × 8 modules (76.95 × 38.25 mm), gaps 7 px between columns and 20 px between rows
    DET: { W: 311.0, H: 327.0, nx: 311, ny: 327, cx: 0.5, cy: 0.5, bs: 1.6,
      gaps: { vx: [1, 2, 3].map((k) => (k * 76.95 + (k - 0.5) * 1.05) / 311.0), vw: 0.0019, hy: [1, 2, 3, 4, 5, 6, 7].map((k) => (k * 38.25 + (k - 0.5) * 3.0) / 327.0), hw: 0.0047 } },
    PIX: 0.150, DPX: { nx: 2073, ny: 2180 }, offY: 140.0, empty: 'empty capillary', noLog: true, // mm the beam spot moves down on the detector in 'bottom' mode
    det: { name: 'PILATUS4 X CdTe 4M', info: 'DECTRIS PILATUS4 X CdTe 4M: 2073 × 2180 pixels of 150 µm on 311 × 327 mm, in 32 modules (4 × 8) with thin gaps between them. A 1 mm CdTe sensor stops hard X-rays (8–100 keV) that would pass through silicon, and every pixel counts single photons, so there is no readout noise – up to 1000 frames/s. A big area close to the sample reaches high Q, which is what a PDF needs. MAX IV lists a PILATUS3 X 2M CdTe (1475 × 1679 pixels of 172 µm) as DanMAX’s area detector; PILATUS4 CdTe detectors have been used at DanMAX for fast high-energy powder diffraction.' }, TRUE: { dL: 0.0123, bx: -0.9, by: 1.3 },
    L: [0.12, 1.0, 0.01, 0.25], E: [15, 35, 0.5, 35], Lref: 0.25, FLUX: 2.0e3, RATE_MAX: 5.0e6, DIRECT: 5.0e10, motor: 0.3,
    REL: { au: 1.0, tio2: 1.0, ni: 1.0, ceo2: 1.0, lab6: 1.0 }, logI: false, linBins: true, minRings: 3,
    BG: (q) => 0.01 + 0.06 * Math.exp(-(((q - 1.55) / 0.55) ** 2)) + 0.03 * Math.exp(-(((q - 3.0) / 1.2) ** 2)) + (q < 0.15 ? 0.02 * (0.15 / Math.max(q, 0.005)) ** 2 : 0),
    peaks: (s) => cubicPeaks(s.a, s.lattice),
    cal: [{ id: 'ceo2', sub: 'fcc line standard, a = 5.411 Å' }, { id: 'lab6', sub: 'cubic line standard, a = 4.157 Å' }],
    calTask: () => 'dx_cal',
    unit: 'qA', log: false, bins: 1000,
    tasks: [
      { id: 'dx_cal', text: 'Calibrate with CeO₂ or LaB₆', reward: 20000 },
      { id: 'dx_red', text: 'Clean 2D → 1D reduction', reward: 20000, ok: () => true },
      { id: 'dx_ni', text: 'Ni: reach Q = 15 Å⁻¹', reward: 30000, ok: (r) => r.id === 'ni' && r.qb > 15 },
      { id: 'dx_tio2', text: 'TiO₂: Q 1–10 Å⁻¹ in one shot', reward: 30000, ok: (r) => r.id === 'tio2' && r.qa < 1 && r.qb > 10 },
      { id: 'dx_bg', text: 'Subtract the empty capillary', reward: 25000, ok: (r) => r.bgUsed },
      { id: 'dx_pdf', text: 'Make a PDF with Qmax ≥ 14 Å⁻¹ (Analyse)', reward: 30000 },
    ],
  },
};
for (const c of Object.values(CFG)) {
  const d = c.data; c.SAMPLES = d.samples; c.Q0 = d.q[0]; c.DQ = d.q[1] - d.q[0]; c.NQ = d.q.length; c.LOGI = {};
  for (const s of d.samples) { const i0 = c.logI ? s.I[0] : 1; c.LOGI[s.id] = Float32Array.from(s.I, (v) => (c.logI ? Math.log(Math.max(v / i0, 1e-30)) : v)); }
}

// ---------------- shared datasets (all beamlines; kept between visits) ----------------
const DS_KEY = 'beamtime.cosaxs.datasets';
export const DATASETS = (() => { try { const v = JSON.parse(localStorage.getItem(DS_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } })();
for (const d of DATASETS) { d.bl ||= 'cosaxs'; if (!d.formula) d.formula = d.id ? (CFG.cosaxs.SAMPLES.find((s) => s.id === d.id)?.formula || d.id) : 'empty'; }
function storeDatasets() { try { localStorage.setItem(DS_KEY, JSON.stringify(DATASETS.slice(-30))); } catch { /* storage unavailable */ } }

// ---------------- per-beamline state; `use(st)` switches the engine to one beamline ----------------
function makeState(cfg) {
  const st = { cfg, bl: null, sample: null, L: cfg.L[3], Ltarget: cfg.L[3], E: cfg.E[3], exposure: 1, att: 1, bsIn: true, oy: 0,
    last: null, red: null, tasks: {}, busy: false, bg: {}, damaged: false, fit: null, loaded: null, datasets: DATASETS };
  try { const v = JSON.parse(localStorage.getItem(cfg.calKey) || '[]'); st.calibs = Array.isArray(v) ? v : []; } catch { st.calibs = []; }
  return st;
}
const STATES = { cosaxs: makeState(CFG.cosaxs), danmax: makeState(CFG.danmax) };
export const COSAXS_STATE = STATES.cosaxs;
export const DANMAX_STATE = STATES.danmax;
let CX = STATES.cosaxs, C = CFG.cosaxs, DET = C.DET, TRUE = C.TRUE, SAMPLES = C.SAMPLES, PIX = C.PIX, TASKS = C.tasks;
function use(st) { CX = st; C = st.cfg; DET = C.DET; TRUE = C.TRUE; SAMPLES = C.SAMPLES; PIX = C.PIX; TASKS = C.tasks; window.__CX = CX; }
window.__CX = CX; window.__XP = STATES; window.__use = (k) => use(STATES[k]); // debug handles

const byId = (id) => SAMPLES.find((s) => s.id === id);
export const byIdIn = (key, id) => CFG[key]?.SAMPLES.find((s) => s.id === id);
export { byId, CFG };
function sampleI(id, q) {
  if (!id) return 0;
  const x = clamp((q - C.Q0) / C.DQ, 0, C.NQ - 1.001); const i = Math.floor(x), f = x - i; const L = C.LOGI[id];
  const v = L[i] + (L[i + 1] - L[i]) * f;
  return (C.REL[id] ?? 1) * (C.logI ? Math.exp(v) : v);
}
const model = (id, q) => C.BG(q) + sampleI(id, q);
export { sampleI, model };
const kOf = (E) => 4 * Math.PI / (12.398 / E);
const qOf = (rmm, L, E) => kOf(E) * Math.sin(Math.atan(rmm / (L * 1000)) / 2);
const storeCalibs = () => { try { localStorage.setItem(C.calKey, JSON.stringify(CX.calibs)); } catch { /* storage unavailable */ } };
function addDataset(r, prof, clean, bgUsed) {
  const n = (DATASETS.reduce((m, d) => Math.max(m, d.n), 0) || 0) + 1;
  const ok = prof.filter((p) => (C.logI ? p.I > 0 : Number.isFinite(p.I)));
  DATASETS.push({ n, bl: C.key, id: r.id, formula: r.id ? byId(r.id).formula : emptyName(), L: r.L, E: r.E, T: r.T, oy: r.oy || 0, clean, bgUsed,
    q: ok.map((p) => +p.q.toPrecision(5)), I: ok.map((p) => +p.I.toPrecision(5)), err: ok.map((p) => +p.err.toPrecision(3)) });
  if (DATASETS.length > 30) DATASETS.splice(0, DATASETS.length - 30);
  storeDatasets(); return n;
}
const sameSet = (c, L, E, oy = 0) => Math.abs(c.L - L) < 1e-3 && Math.abs(c.E - E) < 1e-3 && Math.abs((c.oy || 0) - (oy || 0)) < 1e-6;
const savedFor = (L, E, oy) => CX.calibs.find((c) => sameSet(c, L, E, oy));
const posTag = (oy) => (oy ? ' · beam low' : '');
const emptyName = () => C.empty || 'empty';
function qRange(L, E, bx = 0, by = 0) {
  const xs = [-DET.W * DET.cx - bx, DET.W * (1 - DET.cx) - bx], ys = [-DET.H * DET.cy - by, DET.H * (1 - DET.cy) - by];
  let rmax = 0; for (const x of xs) for (const y of ys) rmax = Math.max(rmax, Math.hypot(x, y));
  return [qOf(DET.bs, L, E), qOf(rmax, L, E)];
}
const trueRange = () => qRange(CX.L + TRUE.dL, CX.E, TRUE.bx, TRUE.by + CX.oy);
const geoFactor = (Lm) => (C.Lref / Lm) ** 2;

// ---------------- 3D hardware ----------------
const LAMP_ORANGE = new THREE.MeshBasicMaterial({ color: '#ffa31a', toneMapped: false });
const LAMP_GREEN = new THREE.MeshBasicMaterial({ color: '#2aff6a', toneMapped: false });
export function buildExperimentHardware(key, bl, opt) {
  const st = STATES[key]; use(st); st.bl = bl; bl.searched = false; bl.locked = false;
  if (key === 'cosaxs') buildCoSAXSHw(st, bl, opt); else buildDanMAXHw(st, bl, opt);
  buildTables(st, bl, opt);
  buildSearch(st, bl, opt);
  setDet(st.L);
}
function buildCoSAXSHw(st, bl, { d, ds, beamY, ry }) {
  const P = bl.P, t = bl.t; const S = B.main;
  const sp = P(ds, 0);
  S.box(mat('#2b2f35'), sp.x, 0.4, sp.z, 0.9, 0.8, 0.9, ry);
  S.add(CYL, mat('#c9ced3', { metalness: 0.6, roughness: 0.3 }), M(sp.x, beamY - 0.3, sp.z, 0, 0, 0, 0.28, 0.35, 0.28));
  S.add(CYL, mat('#8a4fd8'), M(sp.x, beamY - 0.1, sp.z, 0, 0, 0, 0.06, 0.08, 0.06));
  addCircle(sp.x, sp.z, 0.6, 0, 1.6);
  st.vial = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.14, 12), mat('#ffffff'));
  st.vial.position.set(sp.x, beamY, sp.z); st.vial.visible = false; G.scene.add(st.vial);
  const a = ds + 0.4, b = d.e1 - 0.6;
  const tm = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, b - a, 28, 1, true), new THREE.MeshStandardMaterial({ color: '#b8c7d6', transparent: true, opacity: 0.22, metalness: 0.4, roughness: 0.2, side: THREE.DoubleSide, depthWrite: false }));
  const tc = P((a + b) / 2, 0); tm.position.set(tc.x, beamY, tc.z); tm.rotation.set(Math.PI / 2, ry, 0, 'YXZ'); G.scene.add(tm);
  for (let k = a; k <= b + 0.01; k += 1.5) { const q = P(k, 0); S.add(CYL, mat('#9aa3ab', { metalness: 0.6, roughness: 0.35 }), M(q.x, beamY, q.z, ry, Math.PI / 2, 0, 0.47, 0.08, 0.47)); }
  for (let k = a + 0.6; k < b; k += 2.2) { const q = P(k, 0); S.box(mat('#5d646b'), q.x, (beamY - 0.42) / 2, q.z, 0.5, beamY - 0.42, 0.2, ry); }
  S.add(CYL, mat('#2a2f36'), M(P(b + 0.15, 0).x, beamY, P(b + 0.15, 0).z, ry, Math.PI / 2, 0, 0.5, 0.3, 0.5));
  { const q = P((a + b) / 2, 0); addBox(q.x, q.z, b - a + 0.6, 1.0, t.x, t.z, 0, beamY + 0.5); }
  { const q = P(ds - 0.6, 0); S.box(mat('#3b6fb0'), q.x, beamY, q.z, 0.35, 0.35, 0.3, ry); }
  const det = new THREE.Group();
  det.add(new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.46, 0.16), mat('#1c1f24')));
  const sens = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.36), new THREE.MeshBasicMaterial({ color: '#3a2a6a', toneMapped: false })); sens.position.z = -0.081; sens.rotation.y = Math.PI; det.add(sens);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.5), mat('#2f5f9a')); frame.position.y = -0.3; det.add(frame);
  const label = new THREE.Mesh(new THREE.BoxGeometry(0.47, 0.08, 0.17), mat('#8a4fd8')); label.position.y = 0.2; det.add(label);
  det.rotation.y = ry; G.scene.add(det); st.det = det; st.beamY = beamY; st.ds = ds;
  st.pip = (L) => ({ pos: P(ds + Math.max(0.2, L * 0.5) - 2.6, -1.85), y: 2.85, look: P(ds + Math.max(0.3, L * 0.55), 0), ly: beamY - 0.1 });
  makeCone(st, '#c9a8ff');
}
function buildDanMAXHw(st, bl, { d, ds, beamY, ry }) {
  const P = bl.P, t = bl.t; const S = B.main;
  const sp = P(ds, 0);
  // diffractometer: base, goniometer and a spinning capillary across the beam
  S.box(mat('#2b2f35'), sp.x, 0.4, sp.z, 0.8, 0.8, 0.8, ry);
  S.add(CYL, mat('#c9ced3', { metalness: 0.6, roughness: 0.3 }), M(sp.x, beamY - 0.25, sp.z, 0, 0, 0, 0.22, 0.3, 0.22));
  const hold = P(ds, -0.18); S.box(mat('#3b6fb0'), hold.x, beamY, hold.z, 0.12, 0.12, 0.12, ry);
  addCircle(sp.x, sp.z, 0.55, 0, 1.6);
  st.vial = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 10), mat('#ffffff'));
  st.vial.rotation.set(0, ry, Math.PI / 2, 'YXZ'); st.vial.position.set(sp.x, beamY, sp.z); st.vial.visible = false; G.scene.add(st.vial);
  // detector rail on the floor, along the beam
  const r0 = ds + 0.08, r1 = ds + 1.15; const rc = P((r0 + r1) / 2, 0);
  S.box(mat('#5d646b'), rc.x, 0.06, rc.z, 0.5, 0.12, r1 - r0, ry);
  addBox(rc.x, rc.z, r1 - r0 + 0.5, 0.75, t.x, t.z, 0, 1.9);
  // big area detector on a carriage
  const det = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.43, 0.30), mat('#1c1f24')); det.add(body);
  const sens = new THREE.Mesh(new THREE.PlaneGeometry(0.311, 0.327), new THREE.MeshBasicMaterial({ color: '#5a1c1c', toneMapped: false })); sens.position.z = -0.151; sens.rotation.y = Math.PI; det.add(sens);
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, beamY - 0.12, 0.12), mat('#9aa3ab')); post.position.y = -(beamY - 0.12) / 2 - 0.05; det.add(post);
  const foot = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.08, 0.36), mat('#c0392b')); foot.position.y = -beamY + 0.12; det.add(foot);
  const label = new THREE.Mesh(new THREE.BoxGeometry(0.41, 0.07, 0.31), mat('#c8302f')); label.position.y = 0.25; det.add(label);
  det.rotation.y = ry; G.scene.add(det); st.det = det; st.beamY = beamY; st.ds = ds;
  st.pip = () => ({ pos: P(ds - 0.9, -1.75), y: 2.15, look: P(ds + 0.5, 0), ly: beamY - 0.1 });
  makeCone(st, '#ffb0a0');
}
function makeCone(st, color) {
  const cone = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 32, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
  cone.visible = false; G.scene.add(cone); st.cone = cone;
}
function buildTables(st, bl, { d, ds, ry }) {
  const P = bl.P, t = bl.t; const S = B.main; const cfg = st.cfg;
  const SAMP = cfg.SAMPLES.filter((x) => !x.std);
  const vial = (smp, q, y, h) => { const v = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, h, 12), mat(smp.color, { roughness: 0.3 })); v.position.set(q.x, y, q.z); G.scene.add(v); return v; };
  const sign = (text, bg, q, rot) => {
    const sg = textPlane([text], 1.2, 0.3, { bg, font: 'bold 110px Arial' }); sg.position.set(q.x, 1.5, q.z); sg.rotation.y = rot; G.scene.add(sg);
    S.box(mat('#5d646b'), q.x, 1.15, q.z, 0.04, 0.5, 0.04, ry);
  };
  st.rackVials = {};
  const rk = P(d.e0 + 0.45, 1.3);
  S.box(mat('#d9dcdf'), rk.x, 0.45, rk.z, 1.4, 0.9, 0.5, ry); addBox(rk.x, rk.z, 1.4, 0.55, bl.n.x, bl.n.z, 0, 1.0);
  SAMP.forEach((smp, k) => { st.rackVials[smp.id] = vial(smp, P(d.e0 + 0.45, 0.85 + k * 0.45), 1.0, 0.18); });
  if (cfg.empty) st.rackVials._empty = vial({ color: '#dff1fb' }, P(d.e0 + 0.45, 0.85 + SAMP.length * 0.45), 1.0, 0.18);
  sign('SAMPLES', '#5b2d9e', P(d.e0 + 0.3, 1.3), ry);
  const st1 = P(d.e0 + 1.25, 1.3);
  G.interact.push({ x: st1.x, z: st1.z, r: 1.1, label: 'Samples table', act: () => { use(st); choose(st.calibs.length ? 'Samples' : 'Samples <small class="d">Tip: calibrate first with a calibrant</small>',
    [...SAMP.map((x) => ({ label: `${x.formula}`, sub: x.shape, act: () => mount(x.id) })), { label: cfg.empty ? 'Empty capillary' : 'Empty holder', sub: 'measure it as background', act: () => mount(null) }]); } });
  st.sampStand = st1;
  const ct = P(ds + 2.6, 1.9);
  S.box(mat('#d9dcdf'), ct.x, 0.45, ct.z, 0.5, 0.9, 1.2, ry); addBox(ct.x, ct.z, 1.2, 0.55, t.x, t.z, 0, 1.0);
  cfg.cal.forEach((c, k) => { st.rackVials[c.id] = vial(cfg.SAMPLES.find((s) => s.id === c.id), P(ds + 2.3 + k * 0.6, 1.9), 0.94, 0.06); });
  sign('CALIBRANTS', '#14632f', P(ds + 2.6, 2.05), Math.atan2(-bl.n.x, -bl.n.z));
  const st2 = P(ds + 2.6, 1.05);
  G.interact.push({ x: st2.x, z: st2.z, r: 0.9, label: 'Calibrants table', act: () => { use(st); choose('Calibrant', cfg.cal.map((c) => ({ label: cfg.SAMPLES.find((s) => s.id === c.id).formula, sub: c.sub, act: () => mount(c.id) }))); } });
  st.calStand = st2;
  const prev = G.onZoneEnter;
  G.onZoneEnter = (z) => { prev?.(z); if (z !== bl.expZone) return;
    G.ui.toast(st.calibs.length ? 'Mount a sample from the <b>SAMPLES</b> table, then search the hutch' : `<b>Step 1:</b> mount a calibrant (${cfg.cal.map((c) => cfg.SAMPLES.find((s) => s.id === c.id).formula).join(' or ')}) from the green <b>CALIBRANTS</b> table`, 6); };
}
// hutch search: button 1 (far end) → button 2 (by the door) → leave → LOCK outside, within 30 s
function buildSearch(st, bl, { d, ry }) {
  const P = bl.P, n = bl.n; const doorAt = d.e1 - 2.2; const S = B.main;
  const pad = (q, face) => {
    S.box(mat('#f2c40f'), q.x, 1.35, q.z, 0.24, 0.32, 0.1, Math.atan2(face.x, face.z));
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 12), new THREE.MeshBasicMaterial({ color: '#2a7bff', toneMapped: false }));
    b.position.set(q.x + face.x * 0.06, 1.37, q.z + face.z * 0.06); b.rotation.set(Math.PI / 2, Math.atan2(face.x, face.z), 0, 'YXZ'); G.scene.add(b); return b;
  };
  const tIn = { x: bl.t.x, z: bl.t.z }, nIn = { x: -n.x, z: -n.z }, nOut = { x: n.x, z: n.z };
  const b1 = pad(P(d.e0 + 0.09, -d.ew + 0.45), tIn), b2 = pad(P(doorAt - 1.3, d.ew - 0.09), nIn), bl3 = pad(P(doorAt + 1.4, d.ew + 0.09), nOut);
  const sg = textPlane(['HUTCH SEARCH', '1 far end · 2 by door · LOCK here'], 1.0, 0.3, { bg: '#2b2f35', font: 'bold 64px Arial', sub: 'bold 34px Arial' });
  const sq = P(doorAt + 1.4, d.ew + 0.1); sg.position.set(sq.x, 1.78, sq.z); sg.rotation.y = Math.atan2(n.x, n.z); G.scene.add(sg);
  const srch = { stage: 0, t: 0, beep: 0 }; st.search = srch;
  const inside = () => bl.expZone.test(G.player.pos.x, G.player.pos.z);
  const lit = () => { b1.material.color.set(srch.stage >= 1 ? '#30ff70' : '#2a7bff'); b2.material.color.set(srch.stage >= 2 ? '#30ff70' : '#2a7bff'); bl3.material.color.set(bl.searched ? '#30ff70' : srch.stage === 2 ? '#ffd000' : '#2a7bff'); };
  const setLamp = () => { if (!bl.shutter && bl.lamp) bl.lamp.material = bl.searched ? LAMP_ORANGE : LAMP_GREEN; };
  const p1 = P(d.e0 + 0.65, -d.ew + 0.5), p2 = P(doorAt - 1.3, d.ew - 0.55), p3 = P(doorAt + 1.4, d.ew + 0.65);
  G.interact.push({ x: p1.x, z: p1.z, r: 0.8, label: 'Search button 1', cond: () => inside() && !bl.searched && srch.stage === 0,
    act: () => { srch.stage = 1; srch.t = 30; lit(); G.sfx?.('beep'); G.ui.toast('Search started – check the hutch, then press <b>button 2</b> by the door', 5); } });
  G.interact.push({ x: p2.x, z: p2.z, r: 0.8, label: 'Search button 2', cond: () => inside() && srch.stage === 1,
    act: () => { srch.stage = 2; lit(); G.sfx?.('beep'); G.ui.toast('Leave the hutch and press <b>LOCK</b> outside the door', 5); } });
  G.interact.push({ x: p3.x, z: p3.z, r: 1.0, label: () => (srch.stage === 2 ? 'LOCK hutch (search done)' : bl.searched ? 'Open hutch (cancels search)' : 'Hutch not searched – start at button 1 inside'),
    act: () => {
      if (srch.stage === 2 && !inside()) { srch.stage = 0; bl.searched = true; bl.locked = true; lit(); setLamp(); G.sfx?.('success'); G.ui.toast('🔒 Hutch searched and locked – you can measure', 4); STATES[st.cfg.key] === CX && uiAlive() && refresh(); }
      else if (bl.searched) { bl.searched = false; bl.locked = false; lit(); setLamp(); G.sfx?.('door'); G.ui.toast('Hutch open – search needed again before measuring', 4); }
      else G.ui.toast('Start the search at <b>button 1</b> at the far end inside the hutch', 4);
    } });
  G.tickers.push((dt) => {
    if (srch.stage > 0) { srch.t -= dt; srch.beep -= dt; if (srch.beep <= 0) { G.sfx?.('beep'); srch.beep = 1; } if (srch.t <= 0) { srch.stage = 0; lit(); G.ui.toast('Search timed out – start again at button 1', 4); } }
    if (bl.searched && inside()) { bl.searched = false; bl.locked = false; lit(); }
  });
  bl.onShutter = () => { if (!bl.shutter) setLamp(); };
}
// small pick-one menu (click or press 1, 2, 3 …)
function choose(title, opts) {
  let el = $('cxChoose');
  if (!el) { el = document.createElement('div'); el.id = 'cxChoose'; el.className = 'overlay'; document.body.appendChild(el); el.addEventListener('click', (e) => { if (e.target === el) close(); }); }
  const close = () => { el.classList.remove('show'); window.removeEventListener('keydown', kh, true); };
  const pickN = (i) => { close(); opts[i].act(); };
  const kh = (e) => { const n = parseInt(e.key, 10); if (n >= 1 && n <= opts.length) { e.stopPropagation(); e.preventDefault(); pickN(n - 1); } else if (e.code === 'Escape' || e.code === 'KeyE') close(); };
  el.innerHTML = `<div class="card" style="min-width:280px;max-width:400px"><h3 style="color:#fff;margin:0 0 8px">${title}</h3>`
    + opts.map((o, i) => `<button class="cxpick" data-i="${i}"><b>${i + 1}</b>${o.label}${o.sub ? `<small>${o.sub}</small>` : ''}</button>`).join('')
    + '<button class="cxpick alt" data-i="x">Cancel</button></div>';
  el.querySelectorAll('.cxpick').forEach((b) => b.addEventListener('click', () => (b.dataset.i === 'x' ? close() : pickN(+b.dataset.i))));
  document.querySelectorAll('.overlay').forEach((o) => o.classList.remove('show'));
  el.classList.add('show'); document.exitPointerLock?.(); window.addEventListener('keydown', kh, true);
}
function mount(id) {
  CX.sample = id; const s = id ? byId(id) : null;
  CX.vial.visible = !!s || !!C.empty; if (s) CX.vial.material = mat(s.color, { roughness: 0.3 }); else if (C.empty) CX.vial.material = mat('#dff1fb', { roughness: 0.1 });
  const on = id ?? (C.empty ? '_empty' : null);
  for (const [vid, v] of Object.entries(CX.rackVials)) v.visible = vid !== on;
  G.sfx?.('pickup');
  G.ui.toast(`${s ? `<b>${s.formula}</b> mounted` : C.empty ? '<b>Empty capillary</b> mounted' : 'Holder empty'} – now search: button 1 → button 2 → LOCK outside`, 5);
}
function setDet(L) { const p = CX.bl.P(CX.ds + L, 0); CX.det.position.set(p.x, CX.beamY + CX.oy / 1000, p.z); } // raised detector = beam near its bottom edge

// ---------------- control UI: 1 Measure · 2 Calibrate · 3 Reduce · 4 Analyse ----------------
const $ = (id) => document.getElementById(id);
const uiAlive = () => !!$('cosaxsov')?.classList.contains('show');
let analyseHooks = null;
export function setAnalyseHooks(h) { analyseHooks = h; }
// small ⓘ button: a click shows/hides a short explanation right below it
export const info = (html) => `<button type="button" class="ib" title="More info">i</button><span class="ibx" hidden>${html}</span>`;
document.addEventListener('click', (e) => { const b = e.target.closest?.('.ib'); if (!b) return; e.preventDefault(); const x = b.nextElementSibling; if (x) x.hidden = !x.hidden; });
export function awardTask(key, id) { const st = STATES[key]; const t = st.cfg.tasks.find((x) => x.id === id); if (!t || st.tasks[id]) return; st.tasks[id] = true; G.sfx?.('success'); earn(t.reward, `✓ ${t.text}`); }
const pipCam = new THREE.PerspectiveCamera(55, 16 / 9, 0.05, 200);

export function initCoSAXSUI() {
  const css = document.createElement('style');
  css.textContent = `
  .cx { max-width: min(1260px, 97vw) !important; }
  .cxtabs { display: flex; gap: 6px; margin: 6px 0 10px; flex-wrap: wrap; }
  .cxtabs button { background: #1d2733; color: #b9c7d6; border: 1px solid #2a3646; border-radius: 8px; padding: 7px 14px; font: bold 14px var(--font); cursor: pointer; }
  .cxtabs button.on { background: #8a4fd8; color: #fff; border-color: #8a4fd8; }
  .cxpanel { display: none; } .cxpanel.on { display: block; }
  .cxgrid { display: grid; grid-template-columns: 310px 320px 1fr; gap: 16px; align-items: start; }
  @media (max-width: 1050px) { .cxgrid { grid-template-columns: 1fr; } }
  .cxrow { margin-bottom: 9px; } .cxrow label, .cxlab { display: block; font-size: 13px; color: #9fb3c8; margin-bottom: 3px; } .cxrow label b { color: #fff; }
  .cxrow input[type=range] { width: 100%; accent-color: #8a4fd8; }
  .cx h4 { margin: 10px 0 6px; color: #e8dcff; font-size: 14px; }
  #cxSample { font-size: 16px; font-weight: bold; } #cxSample small, .cxrow small, .cx small.d { display: block; font-weight: normal; font-size: 12px; color: #8597aa; }
  .cx select, .cx input[type=number] { background: #1d2733; color: #fff; border: 1px solid #2a3646; border-radius: 5px; padding: 3px 6px; }
  .cx input[type=number] { width: 110px; font-family: monospace; }
  .cx input[type=text] { background: #1d2733; color: #fff; border: 1px solid #2a3646; border-radius: 5px; padding: 3px 6px; width: 190px; }
  #cbList div { display: flex; justify-content: space-between; align-items: center; font-size: 13px; padding: 3px 0; border-bottom: 1px solid #222c38; }
  #cbList button { background: none; border: 0; color: #ff8a8a; cursor: pointer; font-size: 14px; }
  .cxbtn { width: 100%; font: bold 15px var(--font); padding: 9px; border: 0; border-radius: 8px; background: #8a4fd8; color: #fff; cursor: pointer; margin-top: 4px; }
  .cxbtn.alt { background: #2a3646; } .cxbtn.poor { opacity: .7; } .cxbtn:disabled { opacity: .45; cursor: default; }
  .cxbox { font-size: 13px; padding: 7px 9px; border-radius: 6px; margin: 8px 0; } .cxbox.ok { background: #123222; color: #8dffb8; } .cxbox.bad { background: #3a2412; color: #ffc27a; } .cxbox.info { background: #18222e; color: #c9d6e3; }
  .cxbox code { font-size: 12.5px; color: #fff; }
  #cxInfo { font: 12.5px/1.5 monospace; color: #b9c7d6; margin: 8px 0; }
  #cxTasks { font-size: 13px; } #cxTasks div { margin: 3px 0; } #cxTasks .done { color: #7dffb0; }
  .cx canvas { background: #0a0d12; border-radius: 6px; display: block; max-width: 100%; }
  #cxPip { width: 100%; aspect-ratio: 16 / 9; }
  #cxBar { height: 4px; background: #2a3646; border-radius: 2px; margin-top: 6px; overflow: hidden; } #cxBar i { display: block; height: 100%; width: 0; background: #c9a8ff; }
  .cxinl { display: flex; gap: 10px; align-items: center; font-size: 13px; flex-wrap: wrap; }
  .cxgeo { display: grid; grid-template-columns: auto auto; gap: 5px 10px; align-items: center; font-size: 13px; color: #9fb3c8; }
  .cxchk label { display: block; font-size: 13px; color: #c9d6e3; margin: 3px 0; }
  .cxpick { display: block; width: 100%; text-align: left; background: #1d2733; color: #fff; border: 1px solid #2a3646; border-radius: 8px; padding: 10px 12px; margin: 6px 0; font: bold 16px var(--font); cursor: pointer; }
  .cxpick:hover { border-color: #8a4fd8; } .cxpick b { color: #c9a8ff; margin-right: 10px; } .cxpick small { display: block; font-weight: normal; color: #8597aa; font-size: 12px; margin: 2px 0 0 22px; }
  .cxpick.alt { background: none; color: #9fb3c8; text-align: center; font-weight: normal; }
  .ib { width: 17px; height: 17px; border-radius: 50%; border: 1px solid #5d7aa0; background: #1b2a3a; color: #9fc3ff; font: bold 11px Georgia, serif; font-style: italic; cursor: pointer; padding: 0; margin-left: 4px; vertical-align: 1px; line-height: 15px; }
  .ib:hover { background: #2a4260; } .ibx { display: block; font: 12px/1.45 Arial, sans-serif; color: #c9d6e3; background: #141f2b; border-left: 3px solid #5d7aa0; padding: 6px 8px; margin: 4px 0 6px; text-transform: none; letter-spacing: 0; font-weight: normal; } .ibx[hidden] { display: none; }
  .angrid { display: grid; grid-template-columns: 330px 1fr; gap: 16px; align-items: start; }
  .anp { display: grid; grid-template-columns: 92px 1fr 92px 38px; gap: 6px; align-items: center; margin: 6px 0; font-size: 13px; color: #c9d6e3; }
  .anp input[type=range] { width: 100%; accent-color: #8a4fd8; } .anp input[type=number] { width: 88px; }
  .anf { font-size: 11px; color: #9fb3c8; display: flex; align-items: center; gap: 2px; }
  @media (max-width: 1050px) { .angrid { grid-template-columns: 1fr; } }`;
  document.head.appendChild(css);
  const ov = document.createElement('div'); ov.id = 'cosaxsov'; ov.className = 'overlay';
  ov.innerHTML = `<div class="card cx"><button class="close">✕ close (Esc)</button>
    <h2 id="cxTitle" style="color:#c9a8ff">CoSAXS</h2>
    <div class="cxtabs"><button data-t="M" class="on">1 Measure</button><button data-t="C">2 Calibrate</button><button data-t="R">3 Reduce</button><button data-t="P" id="cxTabPBtn">4 PDF</button><button data-t="A" id="cxTabABtn">4 Analyse</button></div>
    <div class="cxpanel on" id="cxTabM"><div class="cxgrid">
      <div>
        <div class="cxrow"><label>Sample</label><div id="cxSample"></div></div>
        <div class="cxrow"><label>Detector</label><div id="cxDetName"></div></div>
        <div id="cxHutch" class="cxbox"></div>
        <div class="cxrow"><label>Distance <b id="cxLv"></b></label><input type="range" id="cxL"><small id="cxLpos"></small></div>
        <div class="cxrow"><label>Energy <b id="cxEv"></b></label><input type="range" id="cxE"></div>
        <div class="cxrow cxinl"><div><label>Exposure</label><select id="cxT"><option value="0.1">0.1 s</option><option value="1" selected>1 s</option><option value="10">10 s</option><option value="30">30 s</option><option value="60">1 min</option><option value="300">5 min</option><option value="1800">30 min</option><option value="3600">1 h</option></select></div>
          <div><label>Attenuator</label><select id="cxA"><option value="1">none</option><option value="0.1">10 %</option><option value="0.01">1 %</option><option value="0.001">0.1 %</option></select></div></div>
        <div class="cxrow cxinl"><label style="margin:0"><input type="checkbox" id="cxBS" checked> Beamstop</label></div>
        <div class="cxrow" id="cxPosRow"><label>Beam on detector ${info('For a PDF you want high Q. Raise the detector so the direct beam lands just above its bottom edge: on the upper side the detector then reaches about twice the scattering angle, so Q max goes up a lot at the same distance. Rings become arcs, so each Q is averaged over fewer pixels. The beam centre moves, so calibrate again in this position.')}</label>
          <select id="cxPos"><option value="0">Centre – full rings</option><option value="1">Near bottom edge – higher Q</option></select></div>
        <button id="cxGo" class="cxbtn">Expose</button><div id="cxBar"><i></i></div>
        <div id="cxCal" class="cxbox"></div>
        <button id="cxFix" class="cxbtn alt" style="display:none">Repair detector</button>
      </div>
      <div><canvas id="cxDet" width="310" height="324"></canvas></div>
      <div><canvas id="cxPip" width="480" height="270"></canvas><small class="d">Live hutch camera</small><div id="cxInfo"></div>
        <h4>Goals</h4><div id="cxTasks"></div></div>
    </div></div>
    <div class="cxpanel" id="cxTabC"><div class="angrid">
      <div>
        <div class="cxbox info" id="cbSrc"></div>
        <button id="cbFit" class="cxbtn">Fit rings</button>${info('The calibrant has rings at exactly known Q. Fitting where they fall on the detector gives the true distance, beam centre and wavelength. Save it, then load it in 3 Reduce.')}
        <div id="cbRes" class="cxbox info"></div>
        <div class="cxgeo"><span>Name</span><input type="text" id="cbName"></div>
        <button id="cbSave" class="cxbtn alt">Save calibration</button>
        <h4>Saved calibrations</h4><div id="cbList" class="cxchk"></div>
      </div>
      <div><canvas id="cbDet" width="310" height="324"></canvas><small class="d">Green = fitted rings</small></div>
    </div></div>
    <div class="cxpanel" id="cxTabR"><div class="cxgrid">
      <div>
        <div class="cxbox info" id="rgSrc"></div>
        <h4>1 · Mask ${info('Hide pixels that must not be averaged: the beamstop shadow, the gaps between detector modules and bad (hot or saturated) pixels.')}</h4>
        <div class="cxchk"><label><input type="checkbox" id="rmBS"> Beamstop</label><label><input type="checkbox" id="rmGap"> Gaps</label><label><input type="checkbox" id="rmHot"> Bad pixels</label></div>
        <h4>2 · Geometry ${info('Load the calibration saved for this distance and energy (✓). It gives the sample–detector distance, the beam centre on the detector and the wavelength, which convert each pixel to Q.')}</h4>
        <select id="rgCalSel" style="width:100%;margin-bottom:6px"></select>
        <div class="cxgeo">
          <span>Distance (mm)</span><input type="number" id="rgD" step="0.1">
          <span>Centre X (px)</span><input type="number" id="rgX" step="0.1">
          <span>Centre Y (px)</span><input type="number" id="rgY" step="0.1">
          <span>Wavelength (Å)</span><input type="number" id="rgW" step="0.00001">
          <span>Pixel (µm)</span><input type="number" id="rgP" step="0.1">
        </div>
        <button id="rgNom" class="cxbtn alt">Reset to motor values</button>
        <div id="rgCal" class="cxbox"></div>
        <h4>3 · Integrate ${info('Average all unmasked pixels at the same Q (azimuthal integration) to turn the 2D image into a 1D pattern. Tick Subtract background to remove a matching empty-holder measurement.')}</h4>
        <div class="cxinl"><div><span class="cxlab">Bins</span><select id="rgN"><option>100</option><option>200</option><option>400</option><option>1000</option></select></div>
          <div><span class="cxlab">Unit</span><select id="rgU"><option value="qA">q (Å⁻¹)</option><option value="qnm">q (nm⁻¹)</option><option value="tth">2θ (°)</option></select></div></div>
        <div class="cxchk" style="margin-top:6px"><label><input type="checkbox" id="rgSub"> Subtract background</label><label><input type="checkbox" id="rgMod" checked> Show model</label><label id="rgLogL"><input type="checkbox" id="rgLog"> Log axes</label></div>
        <button id="rgGo" class="cxbtn">Integrate</button>
        <div id="rgMsg"></div>
      </div>
      <div><canvas id="rgDet" width="310" height="324"></canvas><small class="d">Red = mask · + = centre · green = calibrant rings</small></div>
      <div><canvas id="rgPlot" width="560" height="380"></canvas></div>
    </div></div>
    <div class="cxpanel" id="cxTabP"></div>
    <div class="cxpanel" id="cxTabA"></div>
    <p class="dim" style="font-size:11px;margin:8px 0 0">Model: <a href="https://github.com/FrederikLizakJohansen/DebyeCalculator" target="_blank" rel="noopener">DebyeCalculator</a> · more in Help (H)</p>
  </div>`;
  document.body.appendChild(ov);
  ov.querySelectorAll('.cxtabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.t)));
  $('cxL').addEventListener('input', (e) => { CX.Ltarget = +e.target.value; refresh(); });
  $('cxE').addEventListener('input', (e) => { CX.E = +e.target.value; refresh(); });
  $('cxT').addEventListener('change', (e) => { CX.exposure = +e.target.value; });
  $('cxA').addEventListener('change', (e) => { CX.att = +e.target.value; refresh(); });
  $('cxPos').addEventListener('change', (e) => { CX.oy = +e.target.value ? C.offY : 0; setDet(CX.L); refresh(); });
  $('cxBS').addEventListener('change', (e) => { CX.bsIn = e.target.checked; if (!CX.bsIn) G.ui.toast('⚠ Beamstop out – use 0.1 % attenuator'); refresh(); });
  $('cxGo').addEventListener('click', expose);
  $('cbFit').addEventListener('click', fitRings);
  $('cbSave').addEventListener('click', saveFit);
  $('cbList').addEventListener('click', (e) => { const i = e.target.dataset?.del; if (i === undefined) return; CX.calibs.splice(+i, 1); storeCalibs(); refreshCal(); refresh(); });
  $('rgCalSel').addEventListener('change', (e) => { const c = CX.calibs[+e.target.value]; if (!c) return; CX.loaded = c;
    $('rgD').value = (c.Lfit * 1000).toFixed(1); $('rgX').value = c.px.toFixed(1); $('rgY').value = c.py.toFixed(1); $('rgW').value = c.lam.toFixed(5); $('rgP').value = String(PIX * 1000); refreshReduce(); drawReduceDet(); });
  $('cxFix').addEventListener('click', () => { if (!CX.damaged) return; if (!canPay(PRICE.detector)) return G.ui.toast(`A new detector module costs ${fmt(PRICE.detector)} – you have ${fmt(G.money)}. Until then, mask the bad pixels and keep measuring.`, 6); charge(PRICE.detector, 'New detector module installed'); CX.damaged = false; refresh(); });
  $('rgNom').addEventListener('click', fillNominal);
  $('rgGo').addEventListener('click', integrate);
  for (const id of ['rmBS', 'rmGap', 'rmHot', 'rgD', 'rgX', 'rgY', 'rgW', 'rgP']) $(id).addEventListener('input', () => drawReduceDet());
  for (const id of ['rgMod', 'rgLog', 'rgU']) $(id).addEventListener('change', () => drawReducePlot());
  window.__cxExpose = expose; window.__cxCalibrate = () => { fitRings(); saveFit(); }; window.__cxIntegrate = integrate;
  ov.addEventListener('keydown', (e) => { if (e.code !== 'Escape') e.stopPropagation(); });
  // live hutch camera: main.js renders it into the canvas while the Measure tab is open
  G.pip = { cam: pipCam, active: () => uiAlive() && $('cxTabM').classList.contains('on') && !!CX.pip, draw: drawPip };
}
function showTab(t) {
  document.querySelectorAll('#cosaxsov .cxtabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
  for (const k of ['M', 'C', 'R', 'P', 'A']) $('cxTab' + k).classList.toggle('on', k === t);
  if (t === 'C') refreshCal();
  if (t === 'R') { refreshReduce(); drawReduceDet(); drawReducePlot(); }
  if (t === 'A') analyseHooks?.open($('cxTabA'));
  if (t === 'P') analyseHooks?.pdf($('cxTabP'));
}
// open the control screen for one beamline
export function openExperiment(key) {
  const st = STATES[key]; const switched = CX !== st || !$('cxTitle').dataset.key; use(st);
  if (switched || $('cxTitle').dataset.key !== key) {
    $('cxTitle').textContent = C.title; $('cxTitle').style.color = C.color; $('cxTitle').dataset.key = key;
    const L = $('cxL'); L.min = C.L[0]; L.max = C.L[1]; L.step = C.L[2]; L.value = CX.Ltarget;
    const E = $('cxE'); E.min = C.E[0]; E.max = C.E[1]; E.step = C.E[2]; E.value = CX.E;
    $('cxT').value = String(CX.exposure); $('cxA').value = String(CX.att); $('cxBS').checked = CX.bsIn;
    $('cxPosRow').style.display = C.offY ? '' : 'none'; $('cxPos').value = CX.oy ? '1' : '0';
    for (const id of ['cxDet', 'cbDet', 'rgDet']) { $(id).width = DET.nx; $(id).height = DET.ny; }
    $('rgN').value = String(C.bins); $('rgU').value = C.unit; $('rgLog').checked = C.log; $('rgMsg').innerHTML = '';
    const pdf = key === 'danmax'; $('cxTabPBtn').style.display = pdf ? '' : 'none'; $('rgLogL').style.display = C.noLog ? 'none' : ''; $('cxTabABtn').textContent = pdf ? '5 Analyse' : '4 Analyse';
    $('cxDetName').innerHTML = C.det ? C.det.name + info(C.det.info) : '';
    fillNominal(); showTab('M');
  }
  const ov = $('cosaxsov'); document.querySelectorAll('.overlay').forEach((o) => o.classList.remove('show')); ov.classList.add('show'); document.exitPointerLock?.();
  refresh(); if (CX.last) drawRaw($('cxDet'), CX.last); else blank($('cxDet'));
  let prev = performance.now();
  const loop = (now) => {
    if (!ov.classList.contains('show')) return;
    const dt = Math.min(0.1, (now - prev) / 1000); prev = now;
    if (Math.abs(CX.L - CX.Ltarget) > 1e-4) { const step = C.motor * dt; CX.L += clamp(CX.Ltarget - CX.L, -step, step); if (Math.abs(CX.L - CX.Ltarget) < 1e-4) CX.L = CX.Ltarget; setDet(CX.L); refresh(); }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
export const openCoSAXS = () => openExperiment('cosaxs');

const poniText = (c) => `<code>${(c.Lfit * 1000).toFixed(1)} mm</code> · X <code>${c.px.toFixed(1)}</code> · Y <code>${c.py.toFixed(1)}</code> · λ <code>${c.lam.toFixed(5)} Å</code>`;
function refresh() {
  const s = CX.sample ? byId(CX.sample) : null;
  $('cxSample').innerHTML = s ? `<span style="color:${s.color}">${s.formula}</span> <span class="dim" style="font-weight:normal;font-size:13px">${s.std ? 'calibrant' : s.shape}</span>` : '<span class="dim">empty – mount in hutch</span>';
  const moving = Math.abs(CX.L - CX.Ltarget) > 1e-4;
  $('cxLv').textContent = CX.Ltarget.toFixed(2) + ' m'; $('cxEv').textContent = CX.E.toFixed(1) + ' keV';
  $('cxLpos').textContent = moving ? `moving… ${CX.L.toFixed(2)} m` : '';
  const [qa, qb] = qRange(CX.L, CX.E);
  const hut = $('cxHutch'); const searched = !!CX.bl?.searched;
  hut.className = 'cxbox ' + (searched ? 'ok' : 'bad'); hut.innerHTML = searched ? '🔒 Hutch searched and locked' : 'Hutch not searched – button 1 → button 2 → LOCK outside';
  const cal = $('cxCal'); const sv = savedFor(CX.L, CX.E, CX.oy);
  cal.className = 'cxbox ' + (sv ? 'ok' : 'bad'); cal.innerHTML = sv ? `✓ Calibration saved: ${sv.name}` : 'No calibration saved for this distance, energy and beam position';
  $('cxInfo').innerHTML = `Q ${qa.toFixed(3)} – ${qb.toFixed(2)} Å⁻¹` + (C.key === 'danmax' ? ` · λ ${(12.398 / CX.E).toFixed(3)} Å` : '') + (CX.damaged ? '<br><span class="bad">Burnt detector module – mask bad pixels, or replace it</span>' : '') + (G.ring.beamOn ? '' : '<br><span class="bad">No beam</span>');
  $('cxGo').disabled = moving || CX.busy || !searched;
  $('cxGo').textContent = searched ? 'Expose' : 'Expose (search the hutch first)';
  $('cxFix').style.display = CX.damaged ? 'block' : 'none'; $('cxFix').textContent = `Replace burnt module (${fmt(PRICE.detector)})`; $('cxFix').classList.toggle('poor', !canPay(PRICE.detector));
  $('cxTasks').innerHTML = TASKS.map((t) => `<div class="${CX.tasks[t.id] ? 'done' : ''}">${CX.tasks[t.id] ? '✓' : '○'} ${t.text}</div>`).join('');
}
// live hutch camera with labels (called by main.js right after rendering the hutch view)
function drawPip(renderer) {
  const cv = $('cxPip'); const g = cv.getContext('2d'); const W = cv.width, H = cv.height;
  const src = renderer.domElement; const sa = src.width / src.height, da = W / H;
  let sw = src.width, sh = src.height, sx = 0, sy = 0;
  if (sa > da) { sw = sh * da; sx = (src.width - sw) / 2; } else { sh = sw / da; sy = (src.height - sh) / 2; }
  g.drawImage(src, sx, sy, sw, sh, 0, 0, W, H);
  const lab = (p3, text, col = '#ffffff') => {
    const v = p3.clone().project(pipCam); if (v.z > 1) return;
    const X = ((v.x + 1) / 2 * src.width - sx) / sw * W, Y = ((1 - v.y) / 2 * src.height - sy) / sh * H;
    g.font = 'bold 13px Trebuchet MS, Arial'; const w = g.measureText(text).width + 10;
    g.fillStyle = 'rgba(10,14,20,0.75)'; g.fillRect(X - w / 2, Y - 30, w, 18); g.fillStyle = col; g.textAlign = 'center'; g.fillText(text, X, Y - 17); g.textAlign = 'left';
    g.strokeStyle = col; g.beginPath(); g.moveTo(X, Y - 12); g.lineTo(X, Y - 3); g.stroke();
  };
  const sp = CX.bl.P(CX.ds, 0); const s = CX.sample ? byId(CX.sample) : null;
  lab(new THREE.Vector3(sp.x, CX.beamY + 0.08, sp.z), s ? `Sample: ${s.formula}` : 'Sample: empty', s ? s.color : '#9fb3c8');
  lab(CX.det.position.clone().add(new THREE.Vector3(0, 0.3, 0)), `Detector ${CX.L.toFixed(2)} m${CX.oy ? ' · raised' : ''}`, '#c9a8ff');
  g.font = 'bold 12px monospace'; g.fillStyle = CX.bl.shutter ? '#ff5050' : CX.bl.searched ? '#ffa31a' : '#7dffb0';
  g.fillText(CX.bl.shutter ? '● BEAM ON' : CX.bl.searched ? '● SEARCHED – READY' : '● OPEN – NOT SEARCHED', 8, 16);
}
export function pipPose() {
  if (!CX.pip) return false;
  const p = CX.pip(CX.L); pipCam.position.set(p.pos.x, p.y, p.pos.z); pipCam.lookAt(p.look.x, p.ly, p.look.z);
  const src = G.renderer.domElement; pipCam.aspect = src.width / src.height; pipCam.updateProjectionMatrix(); return true;
}

// ---------------- simulation (raw detector frames) ----------------
function gauss() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function poisson(m) { if (m < 25) { const L = Math.exp(-m); let k = 0, p = 1; do { k++; p *= Math.random(); } while (p > L); return k - 1; } return Math.max(0, Math.round(m + Math.sqrt(m) * gauss())); }
const pixXY = (ix, iy) => [(ix + 0.5) * DET.W / DET.nx - DET.W * DET.cx, (iy + 0.5) * DET.H / DET.ny - DET.H * DET.cy];
function gapMask(x, y) {
  const fx = (x + DET.W * DET.cx) / DET.W, fy = (y + DET.H * DET.cy) / DET.H; const g = DET.gaps;
  for (const gx of g.vx) if (Math.abs(fx - gx) < g.vw) return true;
  for (const gy of g.hy) if (Math.abs(fy - gy) < g.hw) return true;
  return false;
}
const SAT_VAL = 4294967295;
// truth mask codes (what a perfect mask would remove): 1 beamstop shadow, 2 gap, 3 saturated, 4 dead
function simulate() {
  const { nx, ny } = DET; const T = CX.exposure, id = CX.sample, E = CX.E, att = CX.att;
  const Lt = CX.L + TRUE.dL, k = kOf(E);
  const counts = new Float64Array(nx * ny), mask = new Uint8Array(nx * ny);
  let sat = 0; const damage = !CX.bsIn && C.DIRECT * att > 1e9; // unattenuated direct beam burns the module it hits
  for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) {
    const j = iy * nx + ix; const [x, y] = pixXY(ix, iy); const xt = x - TRUE.bx, yt = y - TRUE.by - CX.oy; const r = Math.hypot(xt, yt);
    if (gapMask(x, y)) { mask[j] = 2; counts[j] = -1; continue; }
    if (CX.damaged && r < 5) { mask[j] = 4; counts[j] = 0; continue; }
    const tth = Math.atan(r / (Lt * 1000)); const q = k * Math.sin(tth / 2);
    const c = Math.cos(tth), cp = xt / (r || 1); const pol = 1 - Math.sin(tth) ** 2 * cp * cp;
    let rate = c * c * c * geoFactor(Lt) * pol * C.FLUX * att * model(id, q);
    if (CX.bsIn && (r < DET.bs || (Math.abs(yt) < 0.9 && xt < 0))) { mask[j] = 1; counts[j] = poisson(rate * T * 0.002); continue; }
    if (!CX.bsIn && r < Math.max(0.35, 0.75 * DET.W / DET.nx)) rate += C.DIRECT * att;
    if (rate > C.RATE_MAX) { mask[j] = 3; counts[j] = SAT_VAL; sat++; continue; }
    counts[j] = poisson(rate * T);
  }
  const [qa, qb] = trueRange();
  return { counts, mask, sat, damage, id, L: CX.L, E, T, att, qa, qb, oy: CX.oy };
}

// ---------------- raw image display ----------------
const LUT = ['#000004', '#1b0c41', '#4a0c6b', '#781c6d', '#a52c60', '#cf4446', '#ed6925', '#fb9b06', '#f7d13d', '#fcffa4'].map((h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
function cmap(v) { v = clamp(v, 0, 1) * (LUT.length - 1); const i = Math.min(LUT.length - 2, Math.floor(v)), f = v - i; return LUT[i].map((c, k) => c + (LUT[i + 1][k] - c) * f); }
function drawRaw(cv, res, userMask = null) {
  if (cv.width !== DET.nx) { cv.width = DET.nx; cv.height = DET.ny; }
  const g = cv.getContext('2d'); const img = g.createImageData(DET.nx, DET.ny);
  let mx = 1; for (let j = 0; j < res.counts.length; j++) { const v = res.counts[j]; if (v < SAT_VAL && v > mx) mx = v; }
  const lm = Math.log10(mx + 1);
  for (let j = 0; j < res.counts.length; j++) {
    const v = res.counts[j]; let col = v < 0 ? [0, 0, 0] : v >= SAT_VAL ? [0, 255, 255] : cmap(Math.log10(v + 1) / lm);
    if (userMask && userMask[j]) col = [col[0] * 0.35 + 160, col[1] * 0.35, col[2] * 0.35];
    img.data[j * 4] = col[0]; img.data[j * 4 + 1] = col[1]; img.data[j * 4 + 2] = col[2]; img.data[j * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  g.fillStyle = '#fff'; g.font = '11px monospace';
  g.fillText(`${res.id ? byId(res.id).formula : emptyName()} · ${res.T >= 60 ? res.T / 60 + ' min' : res.T + ' s'} · ${res.L.toFixed(2)} m · ${res.E.toFixed(1)} keV`, 6, DET.ny - 6);
  if (res.sat && !userMask) { g.fillStyle = '#00ffff'; g.fillText('saturated – use attenuator', 6, 14); }
}
function blank(cv) { if (cv.width !== DET.nx) { cv.width = DET.nx; cv.height = DET.ny; } const g = cv.getContext('2d'); g.fillStyle = '#0a0d12'; g.fillRect(0, 0, DET.nx, DET.ny); g.fillStyle = '#556'; g.font = '13px Arial'; g.fillText('No exposure yet', DET.nx / 2 - 50, DET.ny / 2); }
const ringsOf = (s, k) => C.peaks(s).filter((p) => p.q < k);

// ---------------- calibration ----------------
// what to change so that enough rings land on the detector (between the beamstop and the detector edge)
function ringAdvice(s, need, r) {
  CX.calHintFor = r;
  const pk = C.peaks(s); const fits = (L, E) => { const [qa, qb] = qRange(L + TRUE.dL, E, TRUE.bx, TRUE.by + (r.oy || 0)); return pk.filter((p) => p.q > qa * 1.3 && p.q < qb * 0.97).length >= need; };
  const tip = [];
  for (let L = r.L; L >= C.L[0] - 1e-9; L -= C.L[2]) if (fits(L, r.E)) { tip.push(`distance ≤ ${L.toFixed(2)} m at ${r.E.toFixed(1)} keV`); break; }
  for (let L = r.L; L <= C.L[1] + 1e-9; L += C.L[2]) if (fits(L, r.E)) { if (!tip.length) tip.push(`distance ≥ ${L.toFixed(2)} m at ${r.E.toFixed(1)} keV`); break; }
  for (let E = r.E; E <= C.E[1] + 1e-9; E += C.E[2]) if (fits(r.L, E)) { tip.push(`energy ≥ ${E.toFixed(1)} keV at ${r.L.toFixed(2)} m`); break; }
  const shown = pk.filter((p) => { const [qa, qb] = qRange(r.L + TRUE.dL, r.E, TRUE.bx, TRUE.by + (r.oy || 0)); return p.q > qa * 1.3 && p.q < qb * 0.97; }).length;
  return `${shown ? `Only ${shown} ${s.formula} ring` : `No ${s.formula} ring`} on the detector – need ${need}. Try ${tip.length ? tip.join(' or ') : 'another distance or energy'}.`;
}
function fitRings() {
  const r = CX.last; const s = r && r.id && byId(r.id); if (!s || !s.std) return;
  const [qa, qb] = qRange(r.L + TRUE.dL, r.E, TRUE.bx, TRUE.by + (r.oy || 0));
  const seen = C.peaks(s).filter((p) => p.q > qa * 1.3 && p.q < qb * 0.97);
  const need = typeof C.minRings === 'function' ? C.minRings(s) : C.minRings;
  if (seen.length < need) { CX.fit = null; CX.calHint = ringAdvice(s, need, r); refreshCal(); return G.ui.toast(CX.calHint, 6); }
  if (r.sat > 2000) { CX.fit = null; refreshCal(); return G.ui.toast('Saturated – use an attenuator'); }
  const n = () => (Math.random() - 0.5);
  const bx = TRUE.bx + n() * 0.03, by = TRUE.by + (r.oy || 0) + n() * 0.03;
  CX.calHint = null;
  CX.fit = { L: r.L, E: r.E, oy: r.oy || 0, std: s.id, rings: seen.length, Lfit: r.L + TRUE.dL + n() * 0.0008 * r.L, bx, by,
    px: (DET.W * DET.cx + bx) / PIX, py: (DET.H * DET.cy + by) / PIX, lam: 12.398 / r.E * (1 + n() * 2e-5) };
  $('cbName').value = `${s.formula} ${r.L.toFixed(2)} m ${r.E.toFixed(1)} keV${posTag(r.oy)}`;
  G.sfx?.('success'); refreshCal();
}
function saveFit() {
  const f = CX.fit; if (!f) return;
  const name = $('cbName').value.trim() || `${byId(f.std).formula} ${f.L.toFixed(2)} m ${f.E.toFixed(1)} keV${posTag(f.oy)}`;
  CX.calibs = CX.calibs.filter((c) => c.name !== name && !sameSet(c, f.L, f.E, f.oy));
  CX.calibs.push({ name, ...f }); storeCalibs();
  G.ui.toast(`💾 Saved: ${name}`, 3);
  const task = C.calTask(f); if (task) awardTask(C.key, task);
  CX.fit = null; refreshCal(); refresh();
}
function refreshCal() {
  const r = CX.last; const s = r && r.id && byId(r.id);
  $('cbSrc').innerHTML = s && s.std ? `Image: <b>${s.formula}</b> · ${r.L.toFixed(2)} m · ${r.E.toFixed(1)} keV` : `Measure ${C.cal.map((c) => byId(c.id).formula).join(' or ')} first (1 Measure)`;
  $('cbFit').disabled = !(s && s.std);
  const f = CX.fit;
  $('cbRes').innerHTML = f ? `${f.rings} ring${f.rings > 1 ? 's' : ''} fitted<br>${poniText(f)}` : CX.calHint && r === CX.calHintFor ? `<span class="bad">${CX.calHint}</span>` : 'Not fitted yet';
  $('cbRes').className = 'cxbox ' + (f ? 'ok' : CX.calHint && r === CX.calHintFor ? 'bad' : 'info');
  $('cbSave').disabled = !f; $('cbName').disabled = !f;
  $('cbList').innerHTML = CX.calibs.length ? CX.calibs.map((c, i) => `<div><span>${c.name}</span><button data-del="${i}" title="Delete">✕</button></div>`).join('') : '<span class="dim">None yet</span>';
  const cv = $('cbDet'); if (!(s && s.std)) return blank(cv);
  drawRaw(cv, r);
  if (f) {
    const g = cv.getContext('2d'); const sc = DET.nx / DET.W; const k = kOf(r.E);
    const cx0 = f.px * PIX * sc, cy0 = f.py * PIX * sc; g.strokeStyle = 'rgba(80,255,160,0.9)'; g.lineWidth = 1.2;
    for (const p of ringsOf(s, k)) { const rc = Math.tan(2 * Math.asin(p.q / k)) * f.Lfit * 1000 * sc; if (rc > 2 && rc < 800) { g.beginPath(); g.arc(cx0, cy0, rc, 0, Math.PI * 2); g.stroke(); } }
  }
}

// ---------------- reduction: mask + PONI geometry + azimuthal integration ----------------
function fillNominal() {
  const r = CX.last; const L = r ? r.L : CX.L, E = r ? r.E : CX.E;
  $('rgD').value = (L * 1000).toFixed(1); $('rgX').value = (DET.W * DET.cx / PIX).toFixed(1); $('rgY').value = ((DET.H * DET.cy + ((r ? r.oy : CX.oy) || 0)) / PIX).toFixed(1);
  $('rgW').value = (12.398 / E).toFixed(5); $('rgP').value = String(PIX * 1000);
  CX.loaded = null; refreshReduce(); drawReduceDet();
}
function readForm() {
  return { Lmm: +$('rgD').value, cx: +$('rgX').value, cy: +$('rgY').value, lam: +$('rgW').value, pix: +$('rgP').value / 1000,
    bs: $('rmBS').checked, gap: $('rmGap').checked, hot: $('rmHot').checked, nb: +$('rgN').value };
}
function refreshReduce() {
  const r = CX.last;
  $('rgSrc').innerHTML = r ? `Image: <b>${r.id ? byId(r.id).formula : emptyName()}</b> · ${r.L.toFixed(2)} m · ${r.E.toFixed(1)} keV${posTag(r.oy)}` + (r.sat ? ' · <span class="bad">saturated</span>' : '') : 'No image yet';
  const sel = $('rgCalSel'); const cur = CX.loaded ? CX.calibs.indexOf(CX.loaded) : -1;
  sel.innerHTML = `<option value="">Load saved calibration…</option>` + CX.calibs.map((c, i) => `<option value="${i}" ${i === cur ? 'selected' : ''}>${c.name}${r && sameSet(c, r.L, r.E, r.oy) ? '  ✓' : ''}</option>`).join('');
  const el = $('rgCal'); const c = CX.loaded;
  if (!c) { el.className = 'cxbox bad'; el.innerHTML = CX.calibs.length ? 'Load a calibration ↑ (✓ = matches image)' : 'No saved calibration – make one in 2 Calibrate'; }
  else if (r && sameSet(c, r.L, r.E, r.oy)) { el.className = 'cxbox ok'; el.innerHTML = `✓ ${c.name}`; }
  else { el.className = 'cxbox bad'; el.innerHTML = `⚠ ${c.name} – image is ${r ? r.L.toFixed(2) + ' m ' + r.E.toFixed(1) + ' keV' : '–'}`; }
}
function userMaskOf(r, f) {
  const m = new Uint8Array(r.counts.length);
  for (let j = 0; j < m.length; j++) { const t = r.mask[j]; if ((f.bs && t === 1) || (f.gap && t === 2) || (f.hot && (t === 3 || t === 4))) m[j] = 1; }
  return m;
}
function drawReduceDet() {
  const cv = $('rgDet'); const r = CX.last; if (!r) return blank(cv);
  const f = readForm(); drawRaw(cv, r, userMaskOf(r, f));
  const g = cv.getContext('2d'); const sc = DET.nx / DET.W;
  const bxp = f.cx * PIX * sc, byp = f.cy * PIX * sc;
  g.strokeStyle = '#7dffb0'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(bxp - 8, byp); g.lineTo(bxp + 8, byp); g.moveTo(bxp, byp - 8); g.lineTo(bxp, byp + 8); g.stroke();
  const s = r.id && byId(r.id);
  if (s && s.std && f.Lmm > 0 && f.lam > 0 && f.pix > 0) {
    const k = 4 * Math.PI / f.lam; g.strokeStyle = 'rgba(80,255,160,0.85)'; g.lineWidth = 1;
    for (const p of ringsOf(s, k)) { const rmm = Math.tan(2 * Math.asin(p.q / k)) * f.Lmm * (PIX / f.pix); const rc = rmm * sc; if (rc > 2 && rc < 800) { g.beginPath(); g.arc(bxp, byp, rc, 0, Math.PI * 2); g.stroke(); } }
  }
}
function integrate() {
  const r = CX.last; if (!r) return G.ui.toast('Expose first');
  const f = readForm(); if (!(f.Lmm > 0 && f.lam > 0 && f.pix > 0)) return G.ui.toast('Check the geometry values');
  const um = userMaskOf(r, f); const { nx, ny } = DET; const k = 4 * Math.PI / f.lam;
  const qs = new Float64Array(nx * ny), wn = new Float64Array(nx * ny); let qmin = 1e9, qmax = 0;
  for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) {
    const j = iy * nx + ix; if (um[j]) continue;
    const [x, y] = pixXY(ix, iy); const Xp = (x + DET.W * DET.cx) / PIX, Yp = (y + DET.H * DET.cy) / PIX;
    const dx = (Xp - f.cx) * f.pix, dy = (Yp - f.cy) * f.pix; const rr = Math.hypot(dx, dy);
    const tth = Math.atan(rr / f.Lmm); const q = k * Math.sin(tth / 2); if (!(q > 0)) continue;
    const c = Math.cos(tth), cp = dx / (rr || 1); const pol = 1 - Math.sin(tth) ** 2 * cp * cp;
    qs[j] = q; wn[j] = c * c * c * geoFactor(f.Lmm / 1000) * pol * C.FLUX * r.att * r.T; qmin = Math.min(qmin, q); qmax = Math.max(qmax, q);
  }
  const nb = f.nb; const lin = C.linBins; const la = lin ? qmin : Math.log(qmin), lb = lin ? qmax : Math.log(qmax);
  const sum = new Float64Array(nb), ws = new Float64Array(nb), n = new Uint32Array(nb);
  for (let j = 0; j < qs.length; j++) { if (!qs[j]) continue; const v = lin ? qs[j] : Math.log(qs[j]); const b = Math.min(nb - 1, Math.floor((v - la) / (lb - la) * nb)); sum[b] += r.counts[j]; ws[b] += wn[j]; n[b]++; }
  let prof = []; for (let b = 0; b < nb; b++) if (n[b] > 3) { const c0 = la + (b + 0.5) / nb * (lb - la); prof.push({ b, q: lin ? c0 : Math.exp(c0), I: sum[b] / ws[b], err: Math.sqrt(Math.max(Math.abs(sum[b]), 1)) / ws[b] }); }
  const Lt = (r.L + TRUE.dL) * 1000, cxT = (DET.W * DET.cx + TRUE.bx) / PIX, cyT = (DET.H * DET.cy + TRUE.by + (r.oy || 0)) / PIX, lamT = 12.398 / r.E;
  const geomOK = Math.abs(f.Lmm - Lt) / Lt < 0.005 && Math.hypot(f.cx - cxT, f.cy - cyT) * PIX < 0.4 && Math.abs(f.lam - lamT) / lamT < 0.003 && Math.abs(f.pix - PIX) < 0.0005;
  const maskOK = f.bs && f.gap && (f.hot || (!r.sat && !CX.damaged));
  const key = JSON.stringify([f.Lmm, f.cx, f.cy, f.lam, f.pix, f.bs, f.gap, f.hot, nb, r.L, r.E, r.att, r.T]);
  let bgUsed = false;
  if (!r.id) CX.bg[key] = prof.map((p) => ({ ...p }));
  else if ($('rgSub').checked) {
    const bg = CX.bg[key];
    if (bg) { const m = new Map(bg.map((p) => [p.b, p])); prof = prof.filter((p) => m.has(p.b)).map((p) => { const o = m.get(p.b); return { ...p, I: p.I - o.I, err: Math.hypot(p.err, o.err) }; }); bgUsed = true; }
    else G.ui.toast(`No matching background – reduce the ${C.empty || 'empty holder'} with the same settings`);
  }
  CX.red = { id: r.id, prof, geomOK, maskOK, bgUsed, sat: r.sat, qa: r.qa, qb: r.qb, f, raw: r };
  CX.red.n = addDataset(r, prof, geomOK && maskOK && !r.sat, bgUsed);
  const msgs = [];
  if (!f.bs) msgs.push('Mask the beamstop');
  if (!f.gap) msgs.push('Mask the gaps');
  if (r.sat && !f.hot) msgs.push('Mask bad pixels');
  if (r.sat && f.hot) msgs.push('Saturated – use an attenuator');
  if (!geomOK) msgs.push('Geometry off – check the rings');
  const good = geomOK && maskOK;
  $('rgMsg').innerHTML = `<div class="cxbox ${good ? 'ok' : 'bad'}">${good ? '✓ Good reduction' + (C.key === 'danmax' && r.id && !byId(r.id).std ? ' → next: <b>4 PDF</b>' : '') : msgs.map((m) => '• ' + m).join('<br>')}${bgUsed ? '<br>Background subtracted' : ''}</div>`;
  if (good && r.sat === 0) {
    if (r.id && !byId(r.id).std && !r.paid) { r.paid = true; earn(BEAMTIME_HOUR, 'Good data – worth an hour of beamtime'); }
    const redTask = TASKS.find((t) => t.ok && t.ok.length === 0); if (redTask) awardTask(C.key, redTask.id);
    if (r.id && !byId(r.id).std) for (const t of TASKS) if (t.ok && t.ok.length && !CX.tasks[t.id] && t.ok(CX.red)) awardTask(C.key, t.id);
  }
  G.sfx?.('beep'); drawReducePlot(); refresh();
}
function drawReducePlot() {
  const cv = $('rgPlot'); const red = CX.red; const unit = $('rgU').value; const log = !C.noLog && $('rgLog').checked;
  const conv = (q) => (unit === 'qnm' ? q * 10 : unit === 'tth' ? 2 * Math.asin(Math.min(1, q / (4 * Math.PI / (red?.f.lam || 1)))) * 180 / Math.PI : q);
  const xl = unit === 'qnm' ? 'Q (nm⁻¹)' : unit === 'tth' ? '2θ (°)' : 'Q (Å⁻¹)';
  const series = [];
  if (red) {
    const ok = red.prof.filter((p) => p.I > 0 || !log);
    series.push({ x: ok.map((p) => conv(p.q)), y: ok.map((p) => p.I), err: ok.map((p) => p.err), color: red.geomOK ? '#ffffff' : '#ffb24d', kind: 'dot', size: C.linBins ? 1.1 : 1.6 });
    if ($('rgMod').checked && red.id) {
      const lamT = 12.398 / red.raw.E; const xs = [], ys = [];
      const q0 = red.prof[0]?.q || 0.01, q1 = red.prof[red.prof.length - 1]?.q || 1;
      for (let i = 0; i <= 800; i++) { const q = C.linBins ? q0 + (q1 - q0) * i / 800 : q0 * (q1 / q0) ** (i / 800); xs.push(unit === 'tth' ? 2 * Math.asin(q / (4 * Math.PI / lamT)) * 180 / Math.PI : unit === 'qnm' ? q * 10 : q); ys.push(red.bgUsed ? sampleI(red.id, q) : model(red.id, q)); }
      series.unshift({ x: xs, y: ys, color: '#f472b6', kind: 'line', alpha: 0.9, width: 1.3 });
    }
  }
  if (!series.length) { const g = cv.getContext('2d'); g.fillStyle = '#0a0d12'; g.fillRect(0, 0, cv.width, cv.height); g.fillStyle = '#556'; g.font = '13px Arial'; g.fillText('Make a mask, enter the geometry and integrate.', 120, 190); return; }
  const s = red.id && byId(red.id);
  const marks = s?.std ? C.peaks(s).filter((p, i) => i < 12).map((p) => [conv(p.q), p.hkl]) : [];
  plotXY(cv, { series, xlog: log, ylog: log, xlabel: xl, xcolor: red.geomOK ? '#b9c7d6' : '#ffb24d', ylabel: C.logI ? 'I(q) / I(0)' : 'I(Q) (norm.)', marks, legend: [['#fff', 'data'], ['#f472b6', 'model']] });
}

// ---------------- exposure ----------------
async function expose() {
  const bl = CX.bl;
  if (!G.ring.beamOn) { G.ui.toast('No beam'); return; }
  if (bl.expZone.test(G.player.pos.x, G.player.pos.z)) { G.ui.toast('Leave the hutch first'); return; }
  if (!bl.searched) { G.ui.toast('Search the hutch first: button 1 → button 2 → LOCK outside'); return; }
  CX.busy = true; refresh();
  bl.setShutter(true); G.sfx?.('beep');
  const sp = bl.P(CX.ds, 0), dp = bl.P(CX.ds + CX.L, 0); const [, qb] = trueRange();
  const ang = Math.min(1.0, 2 * Math.asin(Math.min(1, qb / kOf(CX.E))));
  const rad = Math.min(C.key === 'danmax' ? 0.25 : 0.4, Math.tan(ang) * CX.L);
  CX.cone.scale.set(rad, CX.L, rad); CX.cone.position.set((sp.x + dp.x) / 2, CX.beamY, (sp.z + dp.z) / 2); CX.cone.rotation.set(-Math.PI / 2, Math.atan2(bl.t.x, bl.t.z), 0, 'YXZ'); CX.cone.visible = true;
  const dur = Math.min(4, 0.6 + Math.log10(1 + CX.exposure) * 0.9); const t0 = performance.now();
  await new Promise((res) => { const tick = () => { const f = (performance.now() - t0) / 1000 / dur; $('cxBar').firstElementChild.style.width = Math.min(100, f * 100) + '%'; if (f < 1) setTimeout(tick, 30); else res(); }; tick(); });
  const r = simulate();
  bl.setShutter(false); CX.cone.visible = false; CX.busy = false; $('cxBar').firstElementChild.style.width = '0';
  if (r.damage) { CX.damaged = true; G.sfx?.('alarm'); G.crime?.(1, `Direct beam burnt a detector module! A new one costs ${fmt(PRICE.detector)}`); }
  CX.last = r; drawRaw($('cxDet'), r);
  G.ui.toast(r.id && byId(r.id).std ? 'Image recorded → 2 Calibrate' : 'Image recorded → 3 Reduce', 3);
  refresh();
}
