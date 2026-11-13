// ③ Analyse – inspired by the course app "saxs_analysis":
//   1 inspect the curve (lin/log, q range) · 2 polydisperse sphere form factor · 3 Debye scattering of candidate
//   atomic structures (auto-scaled by weighted least squares, judged by Rwp, lock in your pick, reveal the ranking).
// Datasets: your own reduced CoSAXS measurement, or a literature example (Bi-oxido clusters,
// Angew. Chem. Int. Ed. 2021, e202103641) that was measured elsewhere – NOT at CoSAXS.
import { G } from './state.js';
import { earn } from './economy.js';
import { DATASETS as DSETS, setAnalyseHooks, byIdIn, awardTask, info } from './cosaxs.js';
import { DANMAX } from './danmax_data.js';
import { ANALYSIS } from './analysis_data.js';
import { plotXY, autoScale } from './plot.js';

const $ = (id) => document.getElementById(id);
const A = { ds: null, seenN: 0, seenBy: {}, dsBy: {}, blKey: null, pdfp: { qmin: 1.0, qmax: 15, lorch: true, rmax: 30, show: 'G' }, rsc: { sc: 1, free: { sc: true }, for: null }, sph: { sc: null, bg: null, free: { R: true, pd: true, sc: true, bg: true } }, str: { sc: null, bg: null, free: { sc: true, bg: true }, for: null }, step: 1, log: true, q0: null, q1: null, R: 7, pd: 0.1, fit: null, sel: 0, guess: {}, done: {}, yaw: 0.6, pitch: 0.35, drag: null, open: false, best: {} };
const EL = { Ti: ['#c9d6e3', 4.5], Ni: ['#9aa3ab', 4], Bi: ['#a855f7', 7], O: ['#ef4444', 4.5], Si: ['#f59e0b', 5], C: ['#64748b', 4], H: ['#e2e8f0', 2.2], Au: ['#e0b33c', 4], Ce: ['#f1ead2', 4.5], Zn: ['#9fb9d0', 4] };

function dataset() {
  if (A.ds === 'bi') {
    const b = ANALYSIS.bi;
    return { name: b.title, q: b.data.q, I: b.data.I, err: null, mq: b.mq, models: b.structures, key: 'bi', lit: true };
  }
  const e = DSETS.find((x) => 'r' + x.n === A.ds);
  if (!e || !e.q.length) return null;
  if (e.bl === 'danmax') return makeD(e);
  return { name: dsLabel(e), q: e.q, I: e.I, err: e.err, mq: ANALYSIS.cand_q, models: (e.id && ANALYSIS.cand[e.id]) || [], key: 'r' + e.n, lit: false, entry: e };
}
const dsName = (e) => (e.id ? (e.formula || byIdIn(e.bl || 'cosaxs', e.id)?.formula || e.id) : e.bl === 'danmax' ? 'empty capillary' : 'empty holder');
const dsLabel = (e) => `#${e.n} ${e.bl === 'danmax' ? 'DanMAX' : 'CoSAXS'} · ${dsName(e)} · ${e.L.toFixed(2)} m · ${e.E.toFixed(1)} keV${e.oy ? ' · beam low' : ''}${e.bgUsed ? ' · bkg sub.' : ''}${e.clean ? '' : ' ⚠'}`;
function pickDefault() {
  const key = BL(); const sets = mine(); const newest = sets[sets.length - 1];
  if (A.blKey !== key) { A.blKey = key; A.ds = A.dsBy[key] ?? null; }
  const known = A.ds && ((A.ds === 'bi' && key === 'cosaxs') || sets.some((x) => 'r' + x.n === A.ds));
  if (newest && (newest.n > (A.seenBy[key] || 0) || !known)) { A.ds = 'r' + newest.n; A.seenBy[key] = newest.n; resetFor(); }
  else if (!known) { A.ds = key === 'cosaxs' ? 'bi' : null; resetFor(); }
  A.dsBy[key] = A.ds;
}
// each beamline analyses only its own data
const BL = () => document.getElementById('cxTitle')?.dataset.key || 'cosaxs';
const mine = () => DSETS.filter((e) => (e.bl || 'cosaxs') === BL());
function resetFor() {
  A.q0 = A.q1 = null; A.sel = 0; A.fit = null; A.step = 1; A.R = A.ds === 'bi' ? 7 : 25; A.pd = 0.1; A.sph.sc = A.sph.bg = null; A.str.for = null; A.rsc.for = null;
  const e = DSETS.find((x) => 'r' + x.n === A.ds); const pdf = e && e.bl === 'danmax';
  A.log = !pdf; A.w0 = A.w1 = null; A.pk = null;
  if (pdf && A.pds !== A.ds) { A.pds = A.ds; pdfDefaults(e); }
}
const interp = (xs, ys, x) => { if (x < xs[0] || x > xs[xs.length - 1]) return NaN; let lo = 0, hi = xs.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] > x) hi = m; else lo = m; } const f = (x - xs[lo]) / (xs[hi] - xs[lo]); return ys[lo] + (ys[hi] - ys[lo]) * f; };

// polydisperse sphere (Gaussian on radius, V² weighted like SasView's sphere); shape only – scale + background are fitted
function sphereShape(q, R, pd) {
  const P = (qr) => { if (qr < 1e-6) return 1; const f = 3 * (Math.sin(qr) - qr * Math.cos(qr)) / (qr * qr * qr); return f * f; };
  if (pd <= 0.001) return P(q * R);
  const s = R * pd, n = 24, lo = Math.max(R - 3 * s, R * 0.05), hi = R + 3 * s; let num = 0, den = 0;
  for (let i = 0; i < n; i++) { const r = lo + (hi - lo) * i / (n - 1); const w = Math.exp(-0.5 * ((r - R) / s) ** 2); const V = r * r * r; num += w * V * V * P(q * r); den += w * V * V; }
  return num / den;
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fmt = (v) => (!Number.isFinite(v) ? '' : v !== 0 && (Math.abs(v) >= 1e5 || Math.abs(v) < 1e-3) ? v.toExponential(3) : String(+v.toPrecision(5)));
// slider + typed number (+ optional "fit" checkbox) for one parameter
function paramRow(key, label, unit, free) {
  return `<div class="anp"><span class="anl">${label}${unit ? ` <span class="dim">${unit}</span>` : ''}</span>
    <input type="range" id="anS_${key}" min="0" max="1000"><input type="number" id="anN_${key}" step="any">
    ${free === undefined ? '<span></span>' : `<label class="anf" title="fit this parameter"><input type="checkbox" id="anF_${key}" ${free ? 'checked' : ''}>fit</label>`}</div>`;
}
function bindParam(key, cfg, get, set, onFree) {
  const S = $('anS_' + key), N = $('anN_' + key), F = $('anF_' + key);
  const lo = cfg.log ? Math.log10(cfg.min) : cfg.min, hi = cfg.log ? Math.log10(cfg.max) : cfg.max;
  const toS = (v) => clamp(((cfg.log ? Math.log10(Math.max(v, 1e-300)) : v) - lo) / (hi - lo || 1) * 1000, 0, 1000);
  const frS = (x) => { const t = lo + (hi - lo) * x / 1000; return cfg.log ? 10 ** t : t; };
  const show = () => { const v = get(); S.value = toS(v); if (document.activeElement !== N) N.value = fmt(v); };
  S.addEventListener('input', () => { set(frS(+S.value)); N.value = fmt(get()); plot(); });
  N.addEventListener('change', () => { const v = parseFloat(String(N.value).replace(',', '.')); if (Number.isFinite(v)) { set(v); plot(); } show(); });
  if (F && onFree) F.addEventListener('change', () => onFree(F.checked));
  show(); return show;
}
// weighted residual (weights 1/I, as in the course app)
function rwp(d, qa, qb, mf) {
  let num = 0, den = 0;
  for (let i = 0; i < d.q.length; i++) { const q = d.q[i]; if (q < qa || q > qb) continue; const D = d.I[i], w = 1 / Math.max(Math.abs(D), 1e-12), m = mf(q); if (!Number.isFinite(m)) continue; num += w * (D - m) ** 2; den += w * D * D; }
  return den > 0 ? Math.sqrt(num / den) : NaN;
}
// Nelder–Mead simplex minimiser
function nelderMead(f, x0, step, iters = 400) {
  const n = x0.length; let pts = [x0.slice()]; for (let i = 0; i < n; i++) { const p = x0.slice(); p[i] += step[i]; pts.push(p); }
  let val = pts.map(f);
  for (let it = 0; it < iters; it++) {
    const idx = val.map((v, i) => i).sort((a, b) => val[a] - val[b]); pts = idx.map((i) => pts[i]); val = idx.map((i) => val[i]);
    if (Math.abs(val[n] - val[0]) < 1e-9 * (Math.abs(val[0]) + 1e-12)) break;
    const c = Array(n).fill(0); for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += pts[i][j] / n;
    const at = (t) => c.map((cj, j) => cj + t * (pts[n][j] - cj));
    const xr = at(-1), fr = f(xr);
    if (fr < val[0]) { const xe = at(-2), fe = f(xe); if (fe < fr) { pts[n] = xe; val[n] = fe; } else { pts[n] = xr; val[n] = fr; } }
    else if (fr < val[n - 1]) { pts[n] = xr; val[n] = fr; }
    else { const xc = at(0.5), fc = f(xc); if (fc < val[n]) { pts[n] = xc; val[n] = fc; } else { for (let i = 1; i <= n; i++) { pts[i] = pts[i].map((v, j) => pts[0][j] + 0.5 * (v - pts[0][j])); val[i] = f(pts[i]); } } }
  }
  return pts[0];
}
function fitSphere(d, qa, qb) {
  const P = A.sph; const fr = P.free;
  if (!fr.R && !fr.pd && !fr.sc && !fr.bg) return G.ui.toast('Tick “fit” on at least one parameter');
  const sub = { q: [], I: [] }; for (let i = 0; i < d.q.length; i++) if (d.q[i] >= qa && d.q[i] <= qb) { sub.q.push(d.q[i]); sub.I.push(d.I[i]); }
  const bgS = Math.max(Math.abs(P.bg), Math.min(...sub.I.filter((v) => v > 0)) * 0.1, 1e-12);
  const keys = ['R', 'pd', 'sc', 'bg'].filter((k) => fr[k]);
  const get = { R: () => Math.log(A.R), pd: () => A.pd, sc: () => Math.log(Math.abs(P.sc) || 1e-12), bg: () => P.bg / bgS };
  const put = (x) => { const o = { R: A.R, pd: A.pd, sc: P.sc, bg: P.bg }; keys.forEach((k, i) => { o[k] = k === 'R' ? Math.exp(x[i]) : k === 'pd' ? clamp(x[i], 0, 0.6) : k === 'sc' ? Math.exp(x[i]) : x[i] * bgS; }); return o; };
  const obj = (x) => { const o = put(x); if (o.R < 0.5 || o.R > 500) return 1e9; return rwp(sub, qa, qb, (q) => o.sc * sphereShape(q, o.R, o.pd) + o.bg); };
  const step = keys.map((k) => (k === 'R' ? 0.2 : k === 'pd' ? 0.05 : k === 'sc' ? 0.5 : 0.5));
  const best = put(nelderMead(obj, keys.map((k) => get[k]()), step));
  A.R = best.R; A.pd = best.pd; P.sc = best.sc; P.bg = best.bg; G.sfx?.('beep');
}
function fitLinear(d, mfn, qa, qb, P) {
  if (!P.free.sc && !P.free.bg) return G.ui.toast('Tick “fit” on at least one parameter');
  if (P.free.sc && P.free.bg) { const f = autoScale(d.q, d.I, mfn, qa, qb); P.sc = f.a; P.bg = f.b; G.sfx?.('beep'); return; }
  let num = 0, den = 0;
  for (let i = 0; i < d.q.length; i++) { const q = d.q[i]; if (q < qa || q > qb) continue; const m = mfn(q); if (!Number.isFinite(m)) continue; const w = 1 / Math.max(Math.abs(d.I[i]), 1e-12);
    if (P.free.sc) { num += w * m * (d.I[i] - P.bg); den += w * m * m; } else { num += w * (d.I[i] - P.sc * m); den += w; } }
  if (den > 0) { if (P.free.sc) P.sc = num / den; else P.bg = num / den; } G.sfx?.('beep');
}
function qWindow(d) { const q0 = A.q0 ?? d.q[0], q1 = A.q1 ?? d.q[d.q.length - 1]; return [Math.max(q0, d.q[0]), Math.min(q1, d.q[d.q.length - 1])]; }

export function initAnalyse() {
  setAnalyseHooks({ open: (el) => { A.open = true; render(el); loop(); }, pdf: (el) => renderPdf(el) });
}
function render(el) {
  A.view = 'A';
  el.innerHTML = `
    <div class="cxinl"><span class="cxlab" style="margin:0">Data</span>
      <select id="anDs" style="flex:1"></select></div>
    <div id="anCite" class="cxbox info"></div>
    <div class="cxtabs" id="anSteps"><button data-s="1">Inspect</button><button data-s="2">Sphere</button><button data-s="3">Structures</button></div>
    <div class="angrid" id="anGrid">
      <div id="anCtl"></div>
      <div><canvas id="anPlot" width="660" height="410"></canvas><div id="anFoot" class="dim" style="font-size:12px;margin-top:4px"></div></div>
    </div>`;
  pickDefault();
  const sets = mine();
  $('anDs').innerHTML = (sets.length ? `<optgroup label="My data">${sets.slice().reverse().map((e) => `<option value="r${e.n}">${dsLabel(e)}</option>`).join('')}</optgroup>` : `<option value="">No ${BL() === 'danmax' ? 'DanMAX' : 'CoSAXS'} data yet – measure and reduce first</option>`)
    + (BL() === 'cosaxs' ? '<optgroup label="Literature example"><option value="bi">Bi clusters (not measured here)</option></optgroup>' : '');
  $('anDs').value = A.ds;
  $('anDs').addEventListener('change', (e) => { A.ds = e.target.value || null; A.dsBy[BL()] = A.ds; resetFor(); draw(); });
  $('anSteps').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { A.step = +b.dataset.s; draw(); }));
  draw();
}
function draw() {
  const d = dataset();
  if (d?.pdf && A.step === 2) A.step = 1;
  $('anSteps').querySelectorAll('button').forEach((b) => { b.classList.toggle('on', +b.dataset.s === A.step); if (b.dataset.s === '2') b.style.display = d?.pdf ? 'none' : ''; if (b.dataset.s === '3') b.textContent = d?.pdf ? 'Fit' : 'Structures'; });
  const cite = $('anCite');
  if (A.ds === 'bi') cite.innerHTML = `Example from the literature, not measured at CoSAXS · <i>${ANALYSIS.bi.cite}</i> (<a href="${ANALYSIS.bi.doi}" target="_blank" rel="noopener">doi</a>)`;
  else cite.innerHTML = d ? `Your ${d.pdf ? 'DanMAX' : 'CoSAXS'} data: <b>${dsLabel(d.entry).replace(' ⚠', '')}</b>${d.entry.clean ? '' : ' <span class="bad">· reduction not clean</span>'}` : '<span class="bad">No data</span>';
  const ctl = $('anCtl');
  if (!d) { ctl.innerHTML = ''; blankPlot(); return; }
  if (d.pdf) { drawDmx(ctl, d); plot(); return; }
  const [qa, qb] = qWindow(d);
  if (A.step === 1) {
    ctl.innerHTML = `
      <div class="cxchk"><label><input type="radio" name="anAx" value="log" ${A.log ? 'checked' : ''}> Log</label><label><input type="radio" name="anAx" value="lin" ${A.log ? '' : 'checked'}> Linear</label></div>
      ${paramRow('q0', 'q min', 'Å⁻¹')}${paramRow('q1', 'q max', 'Å⁻¹')}
      <button class="cxbtn" id="anNext">Next →</button>`;
    const qc = { min: d.q[0], max: d.q[d.q.length - 1], log: true };
    bindParam('q0', qc, () => qWindow(d)[0], (v) => { A.q0 = clamp(v, d.q[0], qWindow(d)[1] * 0.95); });
    bindParam('q1', qc, () => qWindow(d)[1], (v) => { A.q1 = clamp(v, qWindow(d)[0] * 1.05, d.q[d.q.length - 1]); });
    document.querySelectorAll('input[name=anAx]').forEach((r) => r.addEventListener('change', (e) => { A.log = e.target.value === 'log'; plot(); }));
    $('anNext').addEventListener('click', () => { A.step = 2; draw(); });
  } else if (A.step === 2) {
    const P = A.sph;
    if (P.sc === null) { const f = autoScale(d.q, d.I, (q) => sphereShape(q, A.R, A.pd), qa, qb); P.sc = f.a; P.bg = f.b; }
    const Imin = Math.min(...d.I.filter((_, i) => d.q[i] >= qa && d.q[i] <= qb).filter((v) => v > 0));
    ctl.innerHTML = paramRow('R', 'Radius', 'Å', P.free.R) + paramRow('pd', 'Size spread', 'σ/R', P.free.pd) + paramRow('sc', 'Scale', '', P.free.sc) + paramRow('bg', 'Background', '', P.free.bg)
      + `<button class="cxbtn" id="anFitBtn">Fit ✓ parameters</button><div class="cxbox info" id="anFit"></div><button class="cxbtn alt" id="anNext">Next →</button>`;
    const sh = [
      bindParam('R', { min: 1, max: 300, log: true }, () => A.R, (v) => { A.R = Math.max(0.5, v); }, (f) => (P.free.R = f)),
      bindParam('pd', { min: 0, max: 0.5 }, () => A.pd, (v) => { A.pd = clamp(v, 0, 0.8); }, (f) => (P.free.pd = f)),
      bindParam('sc', { min: Math.abs(P.sc) / 1e3 || 1e-6, max: Math.abs(P.sc) * 1e3 || 1, log: true }, () => P.sc, (v) => { P.sc = v; }, (f) => (P.free.sc = f)),
      bindParam('bg', { min: 0, max: 2 * Imin }, () => P.bg, (v) => { P.bg = v; }, (f) => (P.free.bg = f)),
    ];
    $('anFitBtn').addEventListener('click', () => { fitSphere(d, qa, qb); sh.forEach((f) => f()); plot(); });
    $('anNext').addEventListener('click', () => { A.step = 3; draw(); });
  } else if (!d.models.length) {
    ctl.innerHTML = `<div class="cxbox info">No candidate structures for ${d.entry ? dsName(d.entry) : 'this data'} – try the sphere model.</div>`;
  } else {
    const ms = d.models; const P = A.str;
    const autoStr = () => { const f = debyeFit(d, A.sel, qa, qb); P.sc = f.a; P.bg = f.b; P.for = d.key + ':' + A.sel; };
    if (P.for !== d.key + ':' + A.sel) autoStr();
    ctl.innerHTML = `
      <div id="anList" class="cxchk"></div>
      <canvas id="anView" width="330" height="240" style="cursor:grab"></canvas>
      ${paramRow('ssc', 'Scale', '', P.free.sc)}${paramRow('sbg', 'Background', '', P.free.bg)}
      <button class="cxbtn" id="anFitBtn">Fit ✓ parameters</button>
      <div class="cxbox info" id="anFit"></div>
      <button class="cxbtn" id="anLock">Lock in</button><button class="cxbtn alt" id="anReveal">Reveal</button><div id="anRank"></div>`;
    $('anList').innerHTML = ms.map((m, i) => `<label><input type="radio" name="anS" value="${i}" ${i === A.sel ? 'checked' : ''}> ${m.label}</label>`).join('');
    document.querySelectorAll('input[name=anS]').forEach((r) => r.addEventListener('change', (e) => { A.sel = +e.target.value; autoStr(); draw(); }));
    const Imin = Math.min(...d.I.filter((_, i) => d.q[i] >= qa && d.q[i] <= qb).filter((v) => v > 0));
    const sh = [
      bindParam('ssc', { min: Math.abs(P.sc) / 1e3 || 1e-9, max: Math.abs(P.sc) * 1e3 || 1, log: true }, () => P.sc, (v) => { P.sc = v; }, (f) => (P.free.sc = f)),
      bindParam('sbg', { min: 0, max: 2 * Imin }, () => P.bg, (v) => { P.bg = v; }, (f) => (P.free.bg = f)),
    ];
    $('anFitBtn').addEventListener('click', () => { fitLinear(d, (q) => interp(d.mq, ms[A.sel].I, q), Math.max(qa, d.mq[0]), Math.min(qb, d.mq[d.mq.length - 1]), P); sh.forEach((f) => f()); plot(); });
    $('anLock').addEventListener('click', () => { A.guess[d.key] = A.sel; G.ui.toast(`Locked in: ${ms[A.sel].label}`); });
    $('anReveal').addEventListener('click', reveal);
    const v = $('anView');
    v.addEventListener('pointerdown', (e) => { A.drag = [e.clientX, e.clientY, A.yaw, A.pitch]; v.setPointerCapture(e.pointerId); });
    v.addEventListener('pointermove', (e) => { if (!A.drag) return; A.yaw = A.drag[2] + (e.clientX - A.drag[0]) * 0.01; A.pitch = Math.max(-1.4, Math.min(1.4, A.drag[3] + (e.clientY - A.drag[1]) * 0.01)); });
    v.addEventListener('pointerup', () => { A.drag = null; });
  }
  plot();
}
function blankPlot() { const g = $('anPlot').getContext('2d'); g.fillStyle = '#0a0d12'; g.fillRect(0, 0, 660, 410); }
function debyeFit(d, i, qa, qb) { const m = d.models[i]; return autoScale(d.q, d.I, (q) => interp(d.mq, m.I, q), Math.max(qa, d.mq[0]), Math.min(qb, d.mq[d.mq.length - 1])); }
function plot() {
  if (A.view === 'P') return plotPdf();
  const d = dataset(); if (!d || !$('anPlot')) return;
  if (d.pdf) return plotDmx(d);
  const [qa, qb] = qWindow(d);
  const inR = d.q.map((q) => q >= qa && q <= qb);
  const series = [
    { x: d.q.filter((_, i) => !inR[i]), y: d.I.filter((_, i) => !inR[i]), color: 'rgba(148,163,184,0.45)', kind: 'dot', size: 1.3 },
    { x: d.q.filter((_, i) => inR[i]), y: d.I.filter((_, i) => inR[i]), color: '#38bdf8', kind: 'dot', size: 1.6 },
  ];
  const legend = [['#38bdf8', 'data']];
  let foot = '';
  if (A.step === 2 && A.sph.sc !== null) {
    const P = A.sph; const mf = (q) => P.sc * sphereShape(q, A.R, A.pd) + P.bg;
    const xs = [], ys = []; for (let i = 0; i <= 400; i++) { const q = qa * (qb / qa) ** (i / 400); xs.push(q); ys.push(mf(q)); }
    series.push({ x: xs, y: ys, color: '#22c55e', kind: 'line' }); legend.push(['#22c55e', 'sphere']);
    const R = rwp(d, qa, qb, mf); const best = bestSphere(d, qa, qb);
    if ($('anFit')) $('anFit').innerHTML = `R<sub>wp</sub> <b>${(R * 100).toFixed(1)} %</b><br>radius ${A.R.toFixed(1)} Å = ${(A.R / 10).toFixed(2)} nm · diameter <b>${(A.R / 5).toFixed(2)} nm</b>`;
    const key = (d.lit ? 'bi' : 'mine:' + d.entry.id) + ':sphere';
    if (!A.done[key] && Number.isFinite(R) && R <= best.R * 1.12 + 0.004) { A.done[key] = true; G.sfx?.('success'); earn(25000, '✓ Good sphere fit'); }
  } else if (A.step === 3 && d.models.length && A.str.sc !== null) {
    const m = d.models[A.sel]; const P = A.str; const mf = (q) => P.sc * interp(d.mq, m.I, q) + P.bg;
    const xs = d.mq.filter((q) => q >= qa * 0.9 && q <= qb * 1.1), ys = xs.map(mf);
    series.push({ x: xs, y: ys, color: '#f472b6', kind: 'line' }); legend.push(['#f472b6', m.label]);
    if ($('anFit')) $('anFit').innerHTML = `R<sub>wp</sub> <b>${(rwp(d, Math.max(qa, d.mq[0]), Math.min(qb, d.mq[d.mq.length - 1]), mf) * 100).toFixed(1)} %</b>`;
  }
  foot = '';
  plotXY($('anPlot'), { series, xlog: A.log, ylog: A.log, xlabel: d.pdf ? 'Q (Å⁻¹)' : 'q (Å⁻¹)', ylabel: d.lit ? 'I(q) (a.u.)' : d.pdf ? 'I(Q) (norm.)' : 'I(q) / I(0)', shade: [qa, qb], legend });
  $('anFoot').textContent = foot;
}
function bestSphere(d, qa, qb) {
  const key = d.key + `|${qa.toFixed(5)}|${qb.toFixed(5)}`; if (A.best[key]) return A.best[key];
  let best = { R: Infinity };
  for (let R = 2; R <= 80; R *= 1.04) for (const pd of [0, 0.05, 0.1, 0.15, 0.2, 0.3]) { const f = autoScale(d.q, d.I, (q) => sphereShape(q, R, pd), qa, qb); if (f.R < best.R) best = { R: f.R, r: R, pd }; }
  A.best[key] = best; return best;
}
function reveal() {
  const d = dataset(); if (!d || !d.models.length) return;
  const [qa, qb] = qWindow(d);
  const order = d.models.map((m, i) => ({ i, label: m.label, R: debyeFit(d, i, qa, qb).R })).sort((a, b) => a.R - b.R);
  const g = A.guess[d.key];
  let html = '<table style="font-size:13px;margin-top:6px;width:100%"><tr><th align=left>#</th><th align=left>Structure</th><th align=right>R<sub>wp</sub></th></tr>';
  order.forEach((o, k) => { html += `<tr style="${k === 0 ? 'color:#7dffb0' : ''}"><td>${k + 1}</td><td>${o.label}${k === 0 ? ' ★' : ''}${o.i === g ? ' ← your pick' : ''}</td><td align=right>${(o.R * 100).toFixed(1)} %</td></tr>`; });
  html += '</table>';
  let verdict;
  if (g === undefined) verdict = `<div class="cxbox info">Best: ${order[0].label}</div>`;
  else if (g === order[0].i) {
    verdict = `<div class="cxbox ok">✓ Correct: ${order[0].label}</div>`;
    const rk = (d.lit ? 'bi' : 'mine:' + d.entry.id) + ':debye'; if (!A.done[rk]) { A.done[rk] = true; const rew = d.lit ? 40000 : 30000; G.sfx?.('success'); earn(rew, `✓ ${order[0].label}`); }
  } else verdict = `<div class="cxbox bad">✗ Best is ${order[0].label}</div>`;
  $('anRank').innerHTML = verdict + html;
}
function loop() {
  const step = () => {
    const ov = $('cosaxsov'); if (!ov || !ov.classList.contains('show') || !$('cxTabA').classList.contains('on')) { A.open = false; return; }
    if (A.step === 3 && $('anView')) { if (!A.drag) A.yaw += 0.008; drawMol(); }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function drawMol() {
  const d = dataset(); const cv = $('anView'); if (!d || !cv || !d.models.length) return; const m = d.models[A.sel]; const g = cv.getContext('2d');
  g.fillStyle = '#0a0d12'; g.fillRect(0, 0, cv.width, cv.height);
  const n = m.el.length; const cy = Math.cos(A.yaw), sy = Math.sin(A.yaw), cp = Math.cos(A.pitch), sp = Math.sin(A.pitch);
  let rmax = 1; const pts = [];
  for (let i = 0; i < n; i++) {
    const x = m.xyz[3 * i], y = m.xyz[3 * i + 1], z = m.xyz[3 * i + 2];
    const x1 = cy * x + sy * z, z1 = -sy * x + cy * z; const y2 = cp * y - sp * z1, z2 = sp * y + cp * z1;
    pts.push([x1, y2, z2, m.el[i]]); rmax = Math.max(rmax, Math.hypot(x, y, z));
  }
  pts.sort((a, b) => a[2] - b[2]);
  const sc = Math.min(cv.width, cv.height) * 0.42 / rmax; const big = n > 200;
  for (const [x, y, z, e] of pts) {
    const [col, rad] = EL[e] || ['#ccc', 4]; const shade = 0.55 + 0.45 * (z / rmax + 1) / 2;
    g.globalAlpha = shade; g.fillStyle = col; g.beginPath(); g.arc(cv.width / 2 + x * sc, cv.height / 2 - y * sc, Math.max(1.2, (big ? rad * 0.5 : rad) * (0.8 + 0.2 * shade)), 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = 1; g.fillStyle = '#c9d6e3'; g.font = '12px Arial'; g.fillText(`${m.label} · ${m.formula || ''}`, 8, 16);
}

// ================= DanMAX =================
// 4 PDF tab: reduced I(Q) → S(Q) → F(Q) → G(r).   5 Analyse: inspect and fit in Q-space (Bragg peaks → lattice
// parameter + Scherrer size) and in r-space (PDFgui-style attenuated-crystal model → lattice parameter + particle size).
const PD = A.pdfp; PD.bg = ''; PD.bgs = 1; PD.rpoly = 0.9; PD.comp = {};
Object.assign(A, { view: 'A', space: 'Q', qv: 'I', r0: 1, r1: 20, pds: null, pdSeen: 0, peaks: {}, w0: null, w1: null, pk: null, rf: {}, res: {} });
const ZOF = { Au: 79, Ni: 28, Ti: 22, O: 8, Ce: 58, La: 57, B: 5 };
const dmxSample = (e) => e && DANMAX.samples.find((x) => x.id === e.id);
function makeD(e) {
  if (!e) return null; const smp = dmxSample(e);
  return { name: dsLabel(e), q: e.q, I: e.I, err: e.err, models: [], key: 'r' + e.n, lit: false, entry: e, pdf: true, smp };
}
const lorchW = (q, qmax) => { const x = Math.PI * q / qmax; return x < 1e-9 ? 1 : Math.sin(x) / x; };
function sineFT(q, F, qmin, qmax, lorch, rmax, rstep = 0.02, r0 = 0.5) {
  const Q = [], Fw = []; for (let i = 0; i < q.length; i++) if (q[i] >= qmin && q[i] <= qmax && Number.isFinite(F[i])) { Q.push(q[i]); Fw.push(F[i] * (lorch ? lorchW(q[i], qmax) : 1)); }
  const r = [], G = []; for (let x = r0; x <= rmax + 1e-9; x += rstep) {
    let sum = 0; for (let i = 1; i < Q.length; i++) sum += 0.5 * (Fw[i] * Math.sin(Q[i] * x) + Fw[i - 1] * Math.sin(Q[i - 1] * x)) * (Q[i] - Q[i - 1]);
    r.push(+x.toFixed(3)); G.push(2 / Math.PI * sum);
  }
  return { r, G };
}
// background: an empty-capillary dataset measured at the same distance and energy
function bgEntry(d) { if (!PD.bg) return null; const b = DSETS.find((x) => 'r' + x.n === PD.bg); return b && Math.abs(b.L - d.entry.L) < 1e-6 && Math.abs(b.E - d.entry.E) < 1e-6 && (b.oy || 0) === (d.entry.oy || 0) ? b : null; }
function corrI(d) { const b = bgEntry(d); if (!b) return d.I; return d.I.map((v, i) => { const bv = interp(b.q, b.I, d.q[i]); return Number.isFinite(bv) ? v - PD.bgs * bv : v; }); }
// X-ray atomic form factors f0(Q), Cromer–Mann coefficients (International Tables Vol. C)
const CM = {
  H: [0.489918, 20.6593, 0.262003, 7.74039, 0.196767, 49.5519, 0.049879, 2.20159, 0.001305],
  B: [2.0545, 23.2185, 1.3326, 1.021, 1.0979, 60.3498, 0.7068, 0.1403, -0.1932],
  C: [2.31, 20.8439, 1.02, 10.2075, 1.5886, 0.5687, 0.865, 51.6512, 0.2156],
  N: [12.2126, 0.0057, 3.1322, 9.8933, 2.0125, 28.9975, 1.1663, 0.5826, -11.529],
  O: [3.0485, 13.2771, 2.2868, 5.7011, 1.5463, 0.3239, 0.867, 32.9089, 0.2508],
  Ti: [9.7595, 7.8508, 7.3558, 0.5, 1.6991, 35.6338, 1.9021, 116.105, 1.2807],
  Ni: [12.8376, 3.8785, 7.292, 0.2565, 4.4438, 12.1763, 2.38, 66.3421, 1.0341],
  Au: [16.8819, 0.4611, 18.5913, 8.6216, 25.5582, 1.4826, 5.86, 36.3956, 12.0658],
};
const f0 = (el, q) => { const c = CM[el]; const s2 = (q / (4 * Math.PI)) ** 2; return c[0] * Math.exp(-c[1] * s2) + c[2] * Math.exp(-c[3] * s2) + c[4] * Math.exp(-c[5] * s2) + c[6] * Math.exp(-c[7] * s2) + c[8]; };
const SUBS = '₀₁₂₃₄₅₆₇₈₉';
const plainFormula = (f) => [...(f || '')].map((ch) => (SUBS.includes(ch) ? String(SUBS.indexOf(ch)) : ch)).join('');
function parseComp(txt) {
  const out = {}; const re = /([A-Z][a-z]?)(\d*\.?\d*)/g; let m, any = false; const t = plainFormula(txt).replace(/\s+/g, '');
  while ((m = re.exec(t))) { if (!m[1]) break; any = true; if (!CM[m[1]]) return { err: `No form factor for ${m[1]}` }; out[m[1]] = (out[m[1]] || 0) + (m[2] ? +m[2] : 1); }
  return any ? { c: out } : { err: 'Enter a composition, e.g. TiO2' };
}
const compOf = (d) => (PD.comp[d.key] ??= plainFormula(d.smp?.formula || ''));
// least-squares polynomial a1·Q + … + an·Q^n (through the origin), as PDFgetX3's r_poly correction
function polyFit(x, y, n) {
  if (n < 1) return () => 0; const xs = Math.max(...x) || 1; const N = n; const M = Array.from({ length: N }, () => new Float64Array(N + 1));
  for (let i = 0; i < x.length; i++) { const t = x[i] / xs; const p = []; let v = t; for (let k = 0; k < N; k++) { p.push(v); v *= t; } for (let a = 0; a < N; a++) { for (let b = 0; b < N; b++) M[a][b] += p[a] * p[b]; M[a][N] += p[a] * y[i]; } }
  for (let c = 0; c < N; c++) { let piv = c; for (let r = c + 1; r < N; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r; [M[c], M[piv]] = [M[piv], M[c]]; const dv = M[c][c] || 1e-30; for (let k = c; k <= N; k++) M[c][k] /= dv; for (let r = 0; r < N; r++) if (r !== c) { const f = M[r][c]; for (let k = c; k <= N; k++) M[r][k] -= f * M[c][k]; } }
  const co = M.map((row) => row[N]); return (q) => { const t = q / xs; let v = t, s = 0; for (let k = 0; k < N; k++) { s += co[k] * v; v *= t; } return s; };
}
// measured I(Q) → S(Q) (Faber–Ziman): S = 1 + (I/s − ⟨f²⟩)/⟨f⟩², with s matching I to ⟨f²⟩ at high Q
const sqMemo = new Map();
function dataSQ(d) {
  const pc = parseComp(compOf(d)); if (pc.err) return { err: pc.err };
  const k = d.key + '|' + JSON.stringify(pc.c) + '|' + PD.bg + '|' + PD.bgs; if (sqMemo.has(k)) return sqMemo.get(k);
  const I = corrI(d); const els = Object.keys(pc.c); const tot = els.reduce((s, e) => s + pc.c[e], 0);
  const f2 = [], fb2 = []; for (const q of d.q) { let a = 0, b = 0; for (const e of els) { const f = f0(e, q); a += pc.c[e] * f * f; b += pc.c[e] * f; } f2.push(a / tot); fb2.push((b / tot) ** 2); }
  const qmaxD = d.q[d.q.length - 1]; let num = 0, den = 0;
  for (let i = 0; i < d.q.length; i++) if (d.q[i] >= 0.6 * qmaxD && Number.isFinite(I[i])) { num += I[i] * f2[i]; den += f2[i] * f2[i]; }
  const s = den ? num / den : 1; const out = { q: d.q, I, f2, s, S: d.q.map((q, i) => 1 + (I[i] / s - f2[i]) / fb2[i]) };
  if (sqMemo.size > 30) sqMemo.clear(); sqMemo.set(k, out); return out;
}
function dataFQ(d) {
  const sq = dataSQ(d); if (sq.err) return null;
  const raw = d.q.map((q, i) => q * (sq.S[i] - 1)); const n = Math.max(0, Math.round(PD.rpoly * PD.qmax / Math.PI));
  const sel = d.q.map((q, i) => i).filter((i) => d.q[i] >= PD.qmin && d.q[i] <= PD.qmax && Number.isFinite(raw[i]));
  const p = polyFit(sel.map((i) => d.q[i]), sel.map((i) => raw[i]), n);
  return { q: d.q, F: raw.map((f, i) => f - p(d.q[i])), raw, poly: p };
}
const memo = new Map();
const pkey = (d) => `${PD.qmin}|${PD.qmax}|${PD.lorch}|${PD.rmax}|${PD.bg}|${PD.bgs}|${PD.rpoly}|${d ? compOf(d) : ''}`;
function pdfOf(tag, fq, d) { const k = tag + '|' + pkey(d); if (!memo.has(k)) { if (memo.size > 40) memo.clear(); memo.set(k, fq ? sineFT(fq.q, fq.F, PD.qmin, PD.qmax, PD.lorch, PD.rmax) : { r: [], G: [] }); } return memo.get(k); }
const dataG = (d) => pdfOf(d.key, dataFQ(d), d);
const lsq = (D, Mo) => { let a = 0, b = 0; for (let k = 0; k < D.length; k++) if (Number.isFinite(Mo[k])) { a += D[k] * Mo[k]; b += Mo[k] * Mo[k]; } return b ? a / b : 1; };
function offsetOf(arr) { let lo = 0, hi = 0; for (const g of arr) { lo = Math.min(lo, g); hi = Math.max(hi, g); } return lo - 0.25 * (hi - lo); }

// ---------- 4 PDF tab: processes YOUR reduced data ----------
function pdfSets() { return DSETS.filter((e) => e.bl === 'danmax' && e.id && !dmxSample(e)?.std); }
function renderPdf(el) {
  A.view = 'P'; const sets = pdfSets(); const nw = sets[sets.length - 1];
  if (nw && (nw.n > A.pdSeen || !sets.some((e) => 'r' + e.n === A.pds))) { A.pds = 'r' + nw.n; A.pdSeen = nw.n; pdfDefaults(nw); }
  const empties = DSETS.filter((e) => e.bl === 'danmax' && !e.id);
  const d = makeD(DSETS.find((x) => 'r' + x.n === A.pds));
  el.innerHTML = `<div class="cxinl"><span class="cxlab" style="margin:0">Data</span><select id="pdDs" style="flex:1"></select></div>
    <div class="angrid"><div>
      <h4>1 · Background ${info('The empty capillary scatters too. Measure it at the same distance and energy, reduce it, and subtract it here.')}</h4>
      <select id="pdBg" style="width:100%"><option value="">None</option>${empties.slice().reverse().map((e) => `<option value="r${e.n}">Empty capillary #${e.n} · ${e.L.toFixed(2)} m · ${e.E.toFixed(1)} keV${e.oy ? ' · beam low' : ''}</option>`).join('')}</select>
      <h4>2 · I(Q) → S(Q) ${info('S(Q) = 1 + [I(Q)/s − ⟨f²⟩] / ⟨f⟩². The atomic form factors f(Q) of the composition you type set ⟨f²⟩ and ⟨f⟩². The scale s is chosen so that I/s follows ⟨f²⟩ at high Q, where S(Q) → 1.')}</h4>
      <div class="cxinl"><span class="cxlab" style="margin:0;min-width:92px">Composition</span><input type="text" id="pdComp" style="flex:1" value="${d ? compOf(d) : ''}"></div>
      <h4>3 · S(Q) → F(Q) ${info('F(Q) = Q[S(Q) − 1], used between Q min and Q max.')}</h4>
      ${paramRow('pq0', 'Q min', 'Å⁻¹')}${paramRow('pq1', 'Q max', 'Å⁻¹')}
      <div class="dim" style="font-size:12px;margin-top:6px">Remove Compton &amp; smooth background ${info('Not everything the detector counts is coherent (Bragg + diffuse) scattering. Compton (incoherent) scattering grows with Q; fluorescence, multiple scattering and small errors in the background or normalisation add more. All of these vary slowly with Q, so a smooth polynomial fitted to F(Q) (orange) is removed. A smooth curve in Q only gives features at small r, so this changes G(r) only below r<sub>poly</sub> – where there are no atom pairs. Keep r<sub>poly</sub> below the shortest bond (≈ 0.9 Å).')}</div>
      ${paramRow('prp', 'r<sub>poly</sub>', 'Å')}
      <h4>4 · F(Q) → G(r) ${info('G(r) = (2/π) ∫ F(Q) sin(Qr) dQ. Higher Q max gives sharper peaks (Δr ≈ π/Q max). Lorch damping trades a little resolution for fewer termination ripples.')}</h4>
      ${paramRow('prm', 'r max', 'Å')}
      <div class="cxchk"><label><input type="checkbox" id="pdLorch" ${PD.lorch ? 'checked' : ''}> Lorch damping</label></div>
      <div class="cxbox info" id="pdMsg"></div>
      <button class="cxbtn" id="pdGo">Analyse →</button>
    </div><div>
      <canvas id="pdS" width="660" height="170"></canvas><canvas id="pdF" width="660" height="170"></canvas><canvas id="pdG" width="660" height="230"></canvas>
    </div></div>`;
  $('pdDs').innerHTML = sets.length ? sets.slice().reverse().map((e) => `<option value="r${e.n}">${dsLabel(e)}</option>`).join('') : '<option>Reduce a DanMAX sample first (3 Reduce)</option>';
  if (A.pds) $('pdDs').value = A.pds; $('pdBg').value = PD.bg;
  $('pdDs').addEventListener('change', (e) => { A.pds = e.target.value; pdfDefaults(DSETS.find((x) => 'r' + x.n === A.pds)); renderPdf(el); });
  $('pdBg').addEventListener('change', (e) => { PD.bg = e.target.value; memo.clear(); plotPdf(); });
  $('pdComp').addEventListener('change', (e) => { if (d) { PD.comp[d.key] = e.target.value.trim(); memo.clear(); plotPdf(); } });
  const qmaxD = d ? d.q[d.q.length - 1] : 25;
  bindParam('pq0', { min: 0.3, max: 5 }, () => PD.qmin, (v) => { PD.qmin = clamp(v, d ? d.q[0] : 0.3, PD.qmax - 1); });
  bindParam('pq1', { min: 5, max: Math.max(5.1, qmaxD) }, () => PD.qmax, (v) => { PD.qmax = clamp(v, PD.qmin + 1, qmaxD); });
  bindParam('prp', { min: 0, max: 2 }, () => PD.rpoly, (v) => { PD.rpoly = clamp(v, 0, 3); });
  bindParam('prm', { min: 5, max: 200 }, () => PD.rmax, (v) => { PD.rmax = clamp(v, 5, 200); });
  $('pdLorch').addEventListener('change', (e) => { PD.lorch = e.target.checked; plotPdf(); });
  $('pdGo').addEventListener('click', () => { if (!A.pds) return; A.ds = A.pds; A.dsBy.danmax = A.ds; A.blKey = 'danmax'; A.seenBy.danmax = Math.max(0, ...pdfSets().map((x) => x.n), ...DSETS.filter((x) => x.bl === 'danmax').map((x) => x.n)); resetFor(); document.querySelector('#cosaxsov .cxtabs button[data-t=A]').click(); });
  plotPdf();
}
function pdfDefaults(e) { if (!e) return; PD.qmax = Math.min(e.q[e.q.length - 1], 18); PD.qmin = Math.max(0.8, e.q[0]); PD.bg = ''; memo.clear(); }
function plotPdf() {
  const d = makeD(DSETS.find((x) => 'r' + x.n === A.pds));
  for (const id of ['pdS', 'pdF', 'pdG']) { const g = $(id).getContext('2d'); g.fillStyle = '#0a0d12'; g.fillRect(0, 0, 660, 300); }
  const say = (t) => { const g = $('pdS').getContext('2d'); g.fillStyle = '#8597aa'; g.font = '14px Arial'; g.textAlign = 'center'; g.fillText(t, 330, 90); g.textAlign = 'left'; };
  if (!d) return say('Reduce a DanMAX sample (3 Reduce), then come back here.');
  const sq = dataSQ(d); if (sq.err) { $('pdMsg').innerHTML = `<span class="bad">${sq.err}</span>`; return say(sq.err); }
  const fq = dataFQ(d), D = dataG(d); const win = [PD.qmin, PD.qmax];
  const neg = sq.I.some((v, i) => d.q[i] > 1 && v < 0);
  plotXY($('pdS'), { series: [{ x: d.q, y: d.q.map(() => 1), color: '#3b4756', kind: 'line', width: 1 }, { x: d.q, y: sq.S, color: '#38bdf8', kind: 'line', width: 1.2 }], xlabel: 'Q (Å⁻¹)', ylabel: 'S(Q)', shade: win });
  plotXY($('pdF'), { series: [{ x: d.q, y: fq.raw.map((f, i) => fq.poly(d.q[i])), color: '#f59e0b', kind: 'line', width: 1, alpha: PD.rpoly > 0 ? 0.8 : 0 }, { x: d.q, y: fq.F, color: '#38bdf8', kind: 'line', width: 1.1 }], xlabel: 'Q (Å⁻¹)', ylabel: 'F(Q)', shade: win, legend: PD.rpoly > 0 ? [['#38bdf8', 'F(Q)'], ['#f59e0b', 'Compton & smooth background (removed)']] : null });
  plotXY($('pdG'), { series: [{ x: D.r, y: D.G, color: '#38bdf8', kind: 'line', width: 1.5 }], xlabel: 'r (Å)', ylabel: 'G(r) (Å⁻²)' });
  const b = bgEntry(d); const msg = [];
  if (PD.bg && !b) msg.push('<span class="bad">Background is from another distance or energy – not used</span>');
  if (neg) msg.push('<span class="bad">Negative intensity after background subtraction</span>');
  msg.push(`Δr ≈ ${(Math.PI / PD.qmax).toFixed(2)} Å`);
  if (!d.entry.clean) msg.push('<span class="bad">Reduction not clean</span>');
  $('pdMsg').innerHTML = msg.join(' · ');
  if (PD.qmax >= 14 && d.entry.clean && !neg) awardTask('danmax', 'dx_pdf');
}

// ---------- reflections of a unit cell (for indexing Bragg peaks) ----------
const reflMemo = {};
function reflections(cell) {
  const k = JSON.stringify([cell.a, cell.c, cell.basis.length]); if (reflMemo[k]) return reflMemo[k];
  const byQ = new Map();
  for (let h = -7; h <= 7; h++) for (let kk = -7; kk <= 7; kk++) for (let l = -12; l <= 12; l++) {
    if (!h && !kk && !l) continue; const q = 2 * Math.PI * Math.sqrt((h * h + kk * kk) / cell.a ** 2 + l * l / cell.c ** 2); if (q > 20) continue;
    let re = 0, im = 0; for (const [el, x, y, z] of cell.basis) { const ph = 2 * Math.PI * (h * x + kk * y + l * z); re += ZOF[el] * Math.cos(ph); im += ZOF[el] * Math.sin(ph); }
    const F2 = re * re + im * im; if (F2 < 1e-3) continue;
    const key = q.toFixed(4); const o = byQ.get(key) || { q, I: 0, hkl: null };
    const lab = cell.tetra ? [Math.max(Math.abs(h), Math.abs(kk)), Math.min(Math.abs(h), Math.abs(kk)), Math.abs(l)] : [Math.abs(h), Math.abs(kk), Math.abs(l)].sort((a, b) => b - a);
    o.I += F2; if (!o.hkl) o.hkl = lab; byQ.set(key, o);
  }
  const list = [...byQ.values()].sort((a, b) => a.q - b.q); const mx = Math.max(...list.map((x) => x.I / (x.q * x.q)));
  for (const r of list) r.rel = r.I / (r.q * r.q) / mx;
  return (reflMemo[k] = list.filter((r) => r.rel > 0.01));
}
const hklS = (h) => h.join('');

// ---------- r-space model: attenuated crystal (like PDFgui's spherical envelope) ----------
const shellMemo = new Map();
function shells(cell, a, c, rmax) {
  const ratio = (c / a).toFixed(4); const key = cell.basis.length + '|' + ratio + '|' + Math.ceil(rmax / a);
  if (!shellMemo.has(key)) {
    const cr = +ratio; const B = cell.basis; const n = B.length; const zb = B.reduce((s, b) => s + ZOF[b[0]], 0) / n;
    const nu = Math.ceil(rmax / a) + 1, nw = Math.ceil(rmax / (a * cr)) + 1; const step = 0.002; const bins = new Map();
    for (const [ei, xi, yi, zi] of B) for (const [ej, xj, yj, zj] of B) {
      const w = ZOF[ei] * ZOF[ej] / (zb * zb * n);
      for (let u = -nu; u <= nu; u++) for (let v = -nu; v <= nu; v++) for (let t = -nw; t <= nw; t++) {
        const dx = u + xj - xi, dy = v + yj - yi, dz = (t + zj - zi) * cr; const r = Math.sqrt(dx * dx + dy * dy + dz * dz); // in units of a
        if (r < 1e-6 || r * a > rmax) continue; const b = Math.round(r / step); bins.set(b, (bins.get(b) || 0) + w);
      }
    }
    shellMemo.set(key, [...bins.entries()].map(([b, w]) => [b * step, w]).sort((p, q) => p[0] - q[0]));
    if (shellMemo.size > 30) shellMemo.delete(shellMemo.keys().next().value);
  }
  return shellMemo.get(key).map(([r, w]) => [r * a, w]);
}
const envelope = (r, D) => (r >= D ? 0 : 1 - 1.5 * r / D + 0.5 * (r / D) ** 3);
// F(Q) of a sphere of crystal (diameter D Å) with isotropic displacement U (Å²), on the q grid; then the same transform as the data
function modelGr(cell, p, q, rstep, rmax) {
  const sh = shells(cell, p.a, p.c, Math.min(p.D, rmax + 6)); const F = new Float64Array(q.length);
  for (const [r, w] of sh) { const e = envelope(r, p.D) * w / r; if (e <= 0) continue; for (let i = 0; i < q.length; i++) F[i] += e * Math.sin(q[i] * r); }
  for (let i = 0; i < q.length; i++) F[i] *= Math.exp(-p.U * q[i] * q[i]);
  return sineFT(q, F, PD.qmin, PD.qmax, PD.lorch, rmax, rstep);
}
function rfState(d) {
  const c = d.smp.cell; const k = d.key;
  if (!A.rf[k]) A.rf[k] = { a: +(c.a * 1.012).toFixed(3), c: +(c.c * 1.012).toFixed(3), D: 40, U: 0.008, sc: 1, lo: 1.5, hi: 30, free: { a: true, c: !!c.tetra, D: true, U: true }, M: null, Rw: null };
  return A.rf[k];
}
function rwR(D, Mo, lo, sc, hi = Infinity) { let num = 0, den = 0; for (let k = 0; k < D.r.length; k++) if (D.r[k] >= lo && D.r[k] <= hi && Number.isFinite(Mo.G[k])) { num += (D.G[k] - sc * Mo.G[k]) ** 2; den += D.G[k] ** 2; } return den ? Math.sqrt(num / den) : NaN; }
function scaleR(D, Mo, lo, hi = Infinity) { let a = 0, b = 0; for (let k = 0; k < D.r.length; k++) if (D.r[k] >= lo && D.r[k] <= hi) { a += D.G[k] * Mo.G[k]; b += Mo.G[k] ** 2; } return b ? a / b : 1; }
function fitRspace(d) {
  const P = rfState(d); const cell = d.smp.cell; const keys = ['a', 'c', 'D', 'U'].filter((k) => P.free[k] && (k !== 'c' || cell.tetra));
  const qf = d.q.filter((q, i) => i % 2 === 0 && q >= PD.qmin && q <= PD.qmax);
  if (!dataFQ(d)) return G.ui.toast('Check the composition in 4 PDF');
  const Dd = (() => { const fq = dataFQ(d); return sineFT(fq.q, fq.F, PD.qmin, PD.qmax, PD.lorch, P.hi, 0.05); })();
  const put = (x) => { const o = { a: P.a, c: cell.tetra ? P.c : P.a * cell.c / cell.a, D: P.D, U: P.U }; keys.forEach((k, i) => { o[k] = k === 'D' ? Math.exp(x[i]) : k === 'U' ? Math.abs(x[i]) : x[i]; }); if (!cell.tetra) o.c = o.a; return o; };
  const obj = (x) => { const o = put(x); if (o.D < 8 || o.D > 300 || o.a < cell.a * 0.9 || o.a > cell.a * 1.1) return 9; const Mo = modelGr(cell, o, qf, 0.05, P.hi); return rwR(Dd, Mo, P.lo, scaleR(Dd, Mo, P.lo)); };
  const x0 = keys.map((k) => (k === 'D' ? Math.log(P.D) : P[k])); const st = keys.map((k) => (k === 'D' ? 0.3 : k === 'U' ? 0.003 : 0.02));
  let best = x0; if (keys.length) { best = nelderMead(obj, x0, st, 160); best = nelderMead(obj, best, st.map((s) => s * 0.2), 120); }
  Object.assign(P, put(best)); G.sfx?.('beep');
}
function evalR(d) {
  const P = rfState(d); const cell = d.smp.cell; const D = dataG(d);
  const Mo = modelGr(cell, { a: P.a, c: cell.tetra ? P.c : P.a, D: P.D, U: P.U }, d.q.filter((q) => q >= PD.qmin && q <= PD.qmax), 0.02, PD.rmax);
  if (P.free.sc !== false) P.sc = scaleR(D, Mo, P.lo, P.hi); P.M = Mo; P.Rw = rwR(D, Mo, P.lo, P.sc, P.hi); return { D, Mo, P };
}

// ---------- Q-space: Bragg peak fits ----------
function peakState(d) { return (A.peaks[d.key] ||= []); }
function gaussFit(q, I, lo, hi) {
  const X = [], Y = []; for (let i = 0; i < q.length; i++) if (q[i] >= lo && q[i] <= hi && Number.isFinite(I[i])) { X.push(q[i]); Y.push(I[i]); }
  if (X.length < 8) return null;
  let im = 0; for (let i = 1; i < Y.length; i++) if (Y[i] > Y[im]) im = i;
  const b0 = Math.min(Y[0], Y[Y.length - 1]); const f = (p) => { const [A0, q0, s, c0, c1] = p; if (s <= 0.001 || q0 < lo || q0 > hi) return 1e30; let e = 0; for (let i = 0; i < X.length; i++) { const m = A0 * Math.exp(-0.5 * ((X[i] - q0) / s) ** 2) + c0 + c1 * (X[i] - lo); e += (Y[i] - m) ** 2; } return e; };
  let p = nelderMead(f, [Y[im] - b0, X[im], (hi - lo) / 8, b0, 0], [Y[im] * 0.2, 0.01, (hi - lo) / 30, Math.abs(b0) * 0.2 + 1e-6, 0.1 * Math.abs(b0) + 1e-6], 600);
  p = nelderMead(f, p, [p[0] * 0.05, 0.002, p[2] * 0.1, Math.abs(p[3]) * 0.05 + 1e-6, Math.abs(p[4]) * 0.1 + 1e-6], 400);
  return { A: p[0], q0: p[1], s: Math.abs(p[2]), c0: p[3], c1: p[4], lo, hi, fwhm: 2.3548 * Math.abs(p[2]) };
}
function index(cell, q0) { let best = null; for (const r of reflections(cell)) { if (r.rel < 0.02) continue; const dq = Math.abs(r.q - q0); if (dq < 0.12 && (!best || dq < best.dq - 1e-9)) best = { ...r, dq }; } return best; }
// lattice estimates from indexed peaks (cubic: a = d·√(h²+k²+l²); tetragonal: a from (hk0), c from (00l) or mixed)
function latticeFrom(cell, peaks) {
  const ok = peaks.filter((p) => p.hkl); if (!ok.length) return null;
  const dOf = (p) => 2 * Math.PI / p.q0;
  if (!cell.tetra) { const as = ok.map((p) => dOf(p) * Math.hypot(...p.hkl)); return { a: as.reduce((s, v) => s + v, 0) / as.length }; }
  const as = ok.filter((p) => p.hkl[2] === 0).map((p) => dOf(p) * Math.hypot(p.hkl[0], p.hkl[1]));
  const a = as.length ? as.reduce((s, v) => s + v, 0) / as.length : null;
  const cs = ok.map((p) => { const [h, k, l] = p.hkl; if (!l) return null; const inv = 1 / dOf(p) ** 2 - (h * h + k * k) / (a || cell.a) ** 2; return h === 0 && k === 0 ? dOf(p) * l : a && inv > 0 ? l / Math.sqrt(inv) : null; }).filter((v) => v);
  return { a, c: cs.length ? cs.reduce((s, v) => s + v, 0) / cs.length : null };
}
const scherrer = (fwhm) => 0.9 * 2 * Math.PI / fwhm / 10; // nm

// ---------- Analyse UI for DanMAX ----------
function drawDmx(ctl, d) {
  const sp = `<div class="cxchk" style="margin-bottom:4px"><label><input type="radio" name="anSp" value="Q" ${A.space === 'Q' ? 'checked' : ''}> Q-space</label><label><input type="radio" name="anSp" value="r" ${A.space === 'r' ? 'checked' : ''}> r-space</label></div>`;
  const cell = d.smp?.cell;
  if (!d.smp) { ctl.innerHTML = '<div class="cxbox info">Calibrants are for calibration – pick a sample dataset.</div>'; return; }
  if (A.step === 1 && A.space === 'Q') {
    ctl.innerHTML = sp + `<div class="cxchk"><label><input type="radio" name="anQv" value="I" ${A.qv === 'I' ? 'checked' : ''}> I(Q)</label><label><input type="radio" name="anQv" value="S" ${A.qv === 'S' ? 'checked' : ''}> S(Q)</label><label><input type="radio" name="anQv" value="F" ${A.qv === 'F' ? 'checked' : ''}> F(Q)</label></div>
      ${paramRow('q0', 'Q min', 'Å⁻¹')}${paramRow('q1', 'Q max', 'Å⁻¹')}<div class="cxbox info" id="anFit"></div><button class="cxbtn" id="anNext">Fit →</button>`;
    const qc = { min: d.q[0], max: d.q[d.q.length - 1] };
    bindParam('q0', qc, () => qWindow(d)[0], (v) => { A.q0 = clamp(v, d.q[0], qWindow(d)[1] - 0.2); });
    bindParam('q1', qc, () => qWindow(d)[1], (v) => { A.q1 = clamp(v, qWindow(d)[0] + 0.2, d.q[d.q.length - 1]); });
    document.querySelectorAll('input[name=anQv]').forEach((r) => r.addEventListener('change', (e) => { A.qv = e.target.value; plot(); }));
  } else if (A.step === 1) {
    ctl.innerHTML = sp + `${paramRow('r0', 'r min', 'Å')}${paramRow('r1', 'r max', 'Å')}<div class="cxbox info" id="anFit"></div><button class="cxbtn" id="anNext">Fit →</button>`;
    bindParam('r0', { min: 0.5, max: 50 }, () => A.r0, (v) => { A.r0 = clamp(v, 0.5, A.r1 - 1); });
    bindParam('r1', { min: 3, max: 200, log: true }, () => A.r1, (v) => { A.r1 = clamp(v, A.r0 + 1, 200); if (A.r1 > PD.rmax) PD.rmax = Math.ceil(A.r1); });
  } else if (A.space === 'Q') {
    const pk = peakState(d); const [qa, qb] = qWindow(d);
    if (A.w0 === null) { const sq = d.I; let im = -1; for (let i = 0; i < d.q.length; i++) if (d.q[i] > Math.max(qa, 1) && d.q[i] < qb && (im < 0 || sq[i] > sq[im])) im = i; const qc = im >= 0 ? d.q[im] : 3; A.w0 = qc - 0.3; A.w1 = qc + 0.3; }
    ctl.innerHTML = sp + `<div class="dim" style="font-size:12px">Bragg peaks ${info('Set a Q window around one peak and press Fit peak (Gaussian + sloping background). The peak is indexed (hkl) from its position. Positions give d = 2π/Q and the lattice parameter; widths give the crystallite size, Scherrer: D ≈ 0.9 · 2π / FWHM.')}</div>
      ${paramRow('w0', 'From', 'Å⁻¹')}${paramRow('w1', 'To', 'Å⁻¹')}
      <button class="cxbtn" id="anPk">Fit peak</button><div id="anPkRes" class="cxbox info"></div>
      <div id="anPkTab"></div><div id="anSum"></div>`;
    const wc = { min: d.q[0], max: d.q[d.q.length - 1] };
    bindParam('w0', wc, () => A.w0, (v) => { A.w0 = clamp(v, d.q[0], A.w1 - 0.05); A.pk = null; });
    bindParam('w1', wc, () => A.w1, (v) => { A.w1 = clamp(v, A.w0 + 0.05, d.q[d.q.length - 1]); A.pk = null; });
    $('anPk').addEventListener('click', () => {
      const f = gaussFit(d.q, corrI(d), A.w0, A.w1); if (!f) return G.ui.toast('Window too narrow');
      const ix = index(cell, f.q0); f.hkl = ix ? ix.hkl : null; A.pk = f;
      if (f.hkl && !pk.some((p) => Math.abs(p.q0 - f.q0) < 0.02)) pk.push(f); pk.sort((a, b) => a.q0 - b.q0); G.sfx?.('beep'); drawDmxTable(d); plot();
    });
    drawDmxTable(d);
  } else {
    const P = rfState(d); evalR(d);
    ctl.innerHTML = sp + `<div class="dim" style="font-size:12px">Crystal-sphere model ${info(`G(r) of the ${d.smp.formula} crystal, multiplied by the envelope of a sphere of diameter D (as in PDFgui), with Gaussian peak widths from U<sub>iso</sub>. Tick the parameters to refine, then Fit. R<sub>w</sub> is the misfit.`)}</div>
      ${paramRow('ra', 'a', 'Å', P.free.a)}${cell.tetra ? paramRow('rc', 'c', 'Å', P.free.c) : ''}${paramRow('rD', 'Diameter', 'nm', P.free.D)}${paramRow('rU', 'U<sub>iso</sub>', 'Å²', P.free.U)}${paramRow('rlo', 'Fit from r', 'Å')}${paramRow('rhi', 'Fit to r', 'Å')}${paramRow('rmx', 'Show to r', 'Å')}
      <button class="cxbtn" id="anFitBtn">Fit ✓ parameters</button><div class="cxbox info" id="anFit"></div><div id="anSum"></div>`;
    const sh = [
      bindParam('ra', { min: cell.a * 0.95, max: cell.a * 1.05 }, () => P.a, (v) => { P.a = clamp(v, cell.a * 0.9, cell.a * 1.1); }, (f) => (P.free.a = f)),
      cell.tetra && bindParam('rc', { min: cell.c * 0.95, max: cell.c * 1.05 }, () => P.c, (v) => { P.c = clamp(v, cell.c * 0.9, cell.c * 1.1); }, (f) => (P.free.c = f)),
      bindParam('rD', { min: 1, max: 30, log: true }, () => P.D / 10, (v) => { P.D = clamp(v, 0.8, 40) * 10; }, (f) => (P.free.D = f)),
      bindParam('rU', { min: 0.001, max: 0.03 }, () => P.U, (v) => { P.U = clamp(v, 0, 0.05); }, (f) => (P.free.U = f)),
      bindParam('rlo', { min: 1, max: 10 }, () => P.lo, (v) => { P.lo = clamp(v, 0.8, P.hi - 2); }),
      bindParam('rhi', { min: 5, max: 200, log: true }, () => P.hi, (v) => { P.hi = clamp(v, P.lo + 2, 200); if (P.hi > PD.rmax) PD.rmax = Math.ceil(P.hi); }),
      bindParam('rmx', { min: 5, max: 200, log: true }, () => PD.rmax, (v) => { PD.rmax = clamp(v, Math.max(5, P.hi), 200); }),
    ].filter(Boolean);
    $('anFitBtn').addEventListener('click', () => { $('anFit').textContent = 'Fitting…'; setTimeout(() => { fitRspace(d); sh.forEach((f) => f()); plot(); }, 20); });
  }
  document.querySelectorAll('input[name=anSp]').forEach((r) => r.addEventListener('change', (e) => { A.space = e.target.value; draw(); }));
  $('anNext')?.addEventListener('click', () => { A.step = 3; draw(); });
}
function drawDmxTable(d) {
  const pk = peakState(d); const cell = d.smp.cell; const el = $('anPkTab'); if (!el) return;
  el.innerHTML = pk.length ? `<table style="font-size:12px;width:100%;margin-top:6px"><tr><th align=left>hkl</th><th align=right>Q₀</th><th align=right>d (Å)</th><th align=right>FWHM</th><th align=right>size (nm)</th><th></th></tr>`
    + pk.map((p, i) => `<tr><td>${p.hkl ? '(' + hklS(p.hkl) + ')' : '?'}</td><td align=right>${p.q0.toFixed(3)}</td><td align=right>${(2 * Math.PI / p.q0).toFixed(4)}</td><td align=right>${p.fwhm.toFixed(3)}</td><td align=right>${scherrer(p.fwhm).toFixed(1)}</td><td><a href="#" data-del="${i}" style="color:#ff8a8a">✕</a></td></tr>`).join('') + '</table>'
    : '<div class="dim" style="font-size:12px">No peaks fitted yet.</div>';
  el.querySelectorAll('[data-del]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); pk.splice(+a.dataset.del, 1); drawDmxTable(d); plot(); }));
  const lat = latticeFrom(cell, pk); const sizes = pk.map((p) => scherrer(p.fwhm)); const Dq = sizes.length ? sizes.reduce((s, v) => s + v, 0) / sizes.length : null;
  const R = (A.res[d.key] ||= {}); R.Q = lat && { a: lat.a, c: lat.c, D: Dq };
  if (A.pk && $('anPkRes')) $('anPkRes').innerHTML = `Peak at Q₀ = <b>${A.pk.q0.toFixed(3)} Å⁻¹</b> → d = 2π/Q₀ = <b>${(2 * Math.PI / A.pk.q0).toFixed(4)} Å</b><br>${A.pk.hkl ? `Indexed as (${hklS(A.pk.hkl)}) of ${d.smp.formula} – added to the table` : '<span class="bad">No reflection of this phase here – not added</span>'} · FWHM ${A.pk.fwhm.toFixed(3)} Å⁻¹`;
  else if ($('anPkRes')) $('anPkRes').innerHTML = 'Scherrer: size ≈ 0.9 · 2π / FWHM';
  drawSummary(d);
  const t = d.smp.cell; const okA = lat?.a && Math.abs(lat.a / t.a - 1) < 0.005, okC = !t.tetra || (lat?.c && Math.abs(lat.c / t.c - 1) < 0.008);
  if (pk.length >= 2 && okA && okC && Dq && Math.abs(Dq / t.D - 1) < 0.35) { const k = 'dmax:' + d.entry.id + ':Q'; if (!A.done[k]) { A.done[k] = true; G.sfx?.('success'); earn(30000, '✓ Lattice and size from the Bragg peaks'); } }
}
function drawSummary(d) {
  const el = $('anSum'); if (!el) return; const R = A.res[d.key] || {}; const t = d.smp.cell; const f = (v, n = 3) => (v ? v.toFixed(n) : '–');
  const row = (lab, o) => `<tr><td>${lab}</td><td align=right>${f(o?.a)}</td>${t.tetra ? `<td align=right>${f(o?.c)}</td>` : ''}<td align=right>${f(o?.D, 1)}</td></tr>`;
  el.innerHTML = `<table style="font-size:12px;width:100%;margin-top:8px"><tr><th align=left>Your results</th><th align=right>a (Å)</th>${t.tetra ? '<th align=right>c (Å)</th>' : ''}<th align=right>size (nm)</th></tr>${row('Q-space (peaks)', R.Q)}${row('r-space (PDF)', R.r)}</table>
    <div class="dim" style="font-size:11px">Compare both spaces ${info('Scherrer sizes come out a bit smaller than the real diameter: peak widths measure a volume-weighted column length, the PDF measures how far the atomic order reaches.')}</div>`;
}
function plotDmx(d) {
  const cv = $('anPlot'); if (!d.smp) return blankPlot();
  if (A.space === 'Q' && A.step === 1) {
    const [qa, qb] = qWindow(d); const sq = dataSQ(d); const fq = dataFQ(d); const y = A.qv === 'I' || sq.err ? corrI(d) : A.qv === 'S' ? sq.S : fq.F;
    const inR = d.q.map((q) => q >= qa && q <= qb); const xs = d.q.filter((_, i) => inR[i]), ys = y.filter((_, i) => inR[i]);
    plotXY(cv, { series: [{ x: xs, y: ys, color: '#38bdf8', kind: 'line', width: 1.2 }], xlabel: 'Q (Å⁻¹)', ylabel: A.qv === 'I' ? 'I(Q)' : A.qv === 'S' ? 'S(Q)' : 'F(Q)', legend: [['#38bdf8', 'your data']] });
    let im = 0; for (let i = 1; i < xs.length; i++) if (ys[i] > ys[im]) im = i;
    if ($('anFit') && xs.length) $('anFit').innerHTML = `Strongest peak at Q = <b>${xs[im].toFixed(3)} Å⁻¹</b> → d = 2π/Q = <b>${(2 * Math.PI / xs[im]).toFixed(3)} Å</b>`;
  } else if (A.step === 1) {
    const D = dataG(d); const keep = D.r.map((r) => r >= A.r0 && r <= A.r1); const xs = D.r.filter((_, i) => keep[i]), ys = D.G.filter((_, i) => keep[i]);
    plotXY(cv, { series: [{ x: xs, y: ys, color: '#38bdf8', kind: 'line', width: 1.5 }], xlabel: 'r (Å)', ylabel: 'G(r) (Å⁻²)', legend: [['#38bdf8', 'your G(r)']] });
    const mx = Math.max(...D.G); let r1 = null; for (let i = 1; i < D.r.length - 1; i++) if (D.r[i] > 1.2 && D.G[i] > 0.3 * mx && D.G[i] >= D.G[i - 1] && D.G[i] >= D.G[i + 1]) { r1 = D.r[i]; break; }
    let last = null; for (let i = D.r.length - 1; i > 0; i--) if (Math.abs(D.G[i]) > 0.08 * mx) { last = D.r[i]; break; }
    if ($('anFit')) $('anFit').innerHTML = `${r1 ? `First peak at r = <b>${r1.toFixed(2)} Å</b> (nearest neighbours)` : ''}${last && last < PD.rmax - 1 ? `<br>Ripples die out by r ≈ <b>${(last / 10).toFixed(1)} nm</b> → particle size` : '<br>Ripples continue to r max → large crystallites'}`;
  } else if (A.space === 'Q') {
    const I = corrI(d); const lo = Math.max(d.q[0], A.w0 - 0.6), hi = Math.min(d.q[d.q.length - 1], A.w1 + 0.6);
    const inR = d.q.map((q) => q >= lo && q <= hi); const series = [{ x: d.q.filter((_, i) => inR[i]), y: I.filter((_, i) => inR[i]), color: '#38bdf8', kind: 'dot', size: 1.8 }]; const legend = [['#38bdf8', 'your I(Q)']];
    for (const p of [...peakState(d), ...(A.pk && !peakState(d).includes(A.pk) ? [A.pk] : [])]) { if (p.q0 < lo || p.q0 > hi) continue; const xs = [], ys = []; for (let i = 0; i <= 120; i++) { const x = p.lo + (p.hi - p.lo) * i / 120; xs.push(x); ys.push(p.A * Math.exp(-0.5 * ((x - p.q0) / p.s) ** 2) + p.c0 + p.c1 * (x - p.lo)); } series.push({ x: xs, y: ys, color: '#22c55e', kind: 'line', width: 1.6 }); }
    if (series.length > 1) legend.push(['#22c55e', 'peak fit']);
    const marks = reflections(d.smp.cell).filter((r) => r.q >= lo && r.q <= hi && r.rel > 0.03).map((r) => [r.q, hklS(r.hkl)]);
    plotXY(cv, { series, xlabel: 'Q (Å⁻¹)', ylabel: 'I(Q)', shade: [A.w0, A.w1], legend, marks });
    drawSummary(d);
  } else {
    const { D, Mo, P } = evalR(d); const mg = Mo.G.map((g) => P.sc * g); const off = offsetOf(D.G);
    plotXY(cv, { series: [{ x: D.r, y: D.G, color: '#38bdf8', kind: 'line', width: 1.5 }, { x: Mo.r, y: mg, color: '#f472b6', kind: 'line', width: 1.2 },
      { x: D.r, y: D.G.map((g, k) => g - (mg[k] ?? 0) + off), color: '#8b97a6', kind: 'line', width: 1 }],
      xlabel: 'r (Å)', ylabel: 'G(r) (Å⁻²)', shade: [P.lo, P.hi], legend: [['#38bdf8', 'your G(r)'], ['#f472b6', 'crystal-sphere model'], ['#8b97a6', 'difference']] });
    if ($('anFit')) $('anFit').innerHTML = `R<sub>w</sub> <b>${(P.Rw * 100).toFixed(1)} %</b> · scale ${P.sc.toPrecision(3)}`;
    const R = (A.res[d.key] ||= {}); R.r = { a: P.a, c: d.smp.cell.tetra ? P.c : null, D: P.D / 10 }; drawSummary(d);
    const t = d.smp.cell; if (P.Rw < 0.3 && Math.abs(P.a / t.a - 1) < 0.004 && (!t.tetra || Math.abs(P.c / t.c - 1) < 0.006) && Math.abs(P.D / 10 / t.D - 1) < 0.25) { const k = 'dmax:' + d.entry.id + ':r'; if (!A.done[k]) { A.done[k] = true; G.sfx?.('success'); earn(30000, '✓ Lattice and size from the PDF'); } }
  }
}
