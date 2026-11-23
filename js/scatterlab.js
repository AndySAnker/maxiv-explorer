// Autonomous synthesis at CoSAXS and DanMAX – a game version of ScatterLab:
//   A. S. Anker, J. H. Jensen, M. González-Duque, R. Moreno, A. Smolska, M. Juelsholt, V. Hardion, M. R. V. Jørgensen,
//   A. Faíña, J. Quinson, K. Støy, T. Vegge, "Autonomous Synthesis of Nanoparticles with Target Scattering Patterns",
//   ACS Nano 2026, 20, 6767–6782, doi:10.1021/acsnano.5c15488.
// In the paper a modular robot (MODEX) makes gold nanoparticles from an 11-parameter recipe, DanMAX measures total
// scattering for 1 min, the difference between the measured and a target F(Q) + G(r) is the objective, and Bayesian
// optimisation (SAASBO, Gaussian process) proposes the next recipe – a closed loop.
// Scattering patterns: DebyeCalculator (Johansen, Anker et al., J. Open Source Softw. 2024, 9(94), 6024,
// doi:10.21105/joss.06024), precomputed by tools/scatterlab_debye.py.
// What is simulated here (not from the paper): the chemistry is a made-up forward model with plausible trends
// (bigger particles with less citrate, less glycerol and more NaOH, as the paper observed); particles are fcc Au
// spheres; the GP averages a few MAP hyperparameter fits with a sparsity prior instead of fully Bayesian SAASBO, and
// proposals are searched in a trust region around the best recipe (TuRBO-style). The CoSAXS version
// (SAXS target) is our adaptation – the paper measured total scattering/PDF at DanMAX.
import * as THREE from 'three';
import { G } from './state.js';
import { earn } from './economy.js';
import { mat, textPlane, clamp } from './util.js';
import { B, M, CYL } from './build.js';
import { addBox } from './physics.js';
import { plotXY } from './plot.js';
import { SCATTERLAB } from './scatterlab_data.js';

export const PAPER = {
  short: 'Anker et al., ACS Nano 2026, 20, 6767–6782',
  title: 'Autonomous Synthesis of Nanoparticles with Target Scattering Patterns',
  authors: 'A. S. Anker, J. H. Jensen, M. González-Duque, R. Moreno, A. Smolska, M. Juelsholt, V. Hardion, M. R. V. Jørgensen, A. Faíña, J. Quinson, K. Støy, T. Vegge',
  doi: '10.1021/acsnano.5c15488',
  url: 'https://doi.org/10.1021/acsnano.5c15488',
};
const cite = () => `<a href="${PAPER.url}" target="_blank" rel="noopener">${PAPER.short}</a>`;
const info = (html) => `<button type="button" class="ib" title="More info">i</button><span class="ibx" hidden>${html}</span>`;

// ---------------- the 11 synthesis parameters (the paper's search space) ----------------
// Volumes are relative (normalised to a fixed total in the flow cell). Stock concentrations are assumed for the game.
const PARAMS = [
  { id: 'h2o', name: 'H₂O', unit: 'mL', lo: 0, hi: 4.5, def: 1.5 },
  { id: 'gly', name: 'Glycerol', unit: 'mL', lo: 0, hi: 4.5, def: 1.0 },
  { id: 'eth', name: 'Ethanol', unit: 'mL', lo: 0, hi: 3.75, def: 0.5 },
  { id: 'au', name: 'HAuCl₄', unit: 'mL', lo: 0, hi: 1.25, def: 0.6 },
  { id: 'naoh', name: 'NaOH', unit: 'mL', lo: 0, hi: 3.75, def: 1.0 },
  { id: 'ct', name: 'Citrate', unit: 'mL', lo: 0, hi: 3.75, def: 0.5 },
  { id: 'speed', name: 'Au addition speed', unit: '%', lo: 20, hi: 60, def: 40 },
  { id: 'mix', name: 'Mixing', unit: '%', lo: 50, hi: 100, def: 75 },
  { id: 'white', name: 'White LED', unit: '%', lo: 0, hi: 50, def: 20 },
  { id: 'uvb', name: 'UV-B LED', unit: '%', lo: 0, hi: 50, def: 20 },
  { id: 'uvc', name: 'UV-C LED', unit: '%', lo: 0, hi: 50, def: 20 },
];
const D_ = PARAMS.length;
const DEFAULT_CTRL = ['gly', 'au', 'naoh', 'ct', 'mix', 'uvc']; // a 6-D start; tick all 11 to search like the paper
const toPhys = (u, k) => PARAMS[k].lo + u * (PARAMS[k].hi - PARAMS[k].lo);
const toUnit = (v, k) => (v - PARAMS[k].lo) / (PARAMS[k].hi - PARAMS[k].lo);

// ---------------- hidden "true" chemistry (made up for the game) ----------------
function gauss() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
export function synthesise(x, noisy = true) {
  const u = x.map((v, k) => clamp(toUnit(v, k), 0, 1));
  const [h2o, gly, eth, au, naoh, ct, speed, mix, white, uvb, uvc] = u;
  if (au < 0.02) return { D: 0, sig: 0, Y: 0, cAu: 0, agg: 0 };
  const cAu = 0.1 + 3.4 * au * (1 - 0.25 * h2o);   // mM gold in the flow cell (water dilutes a little)
  const light = uvc + 0.5 * uvb + 0.2 * white;      // UV light drives the photoreduction
  const bOH = Math.exp(-((naoh - 0.45 - 0.3 * (au - 0.5)) ** 2) / (2 * 0.3 ** 2)); // the right pH depends on the gold amount
  let Y = (1 - Math.exp(-4 * light * (0.4 + 0.6 * gly + 0.1 * eth))) * (0.3 + 0.7 * bOH) * Math.exp(-2 * Math.max(0, ct - 0.8));
  // bigger particles with more NaOH, less citrate and less glycerol (the trend reported in the paper); slow addition and
  // gentle mixing also give fewer, larger particles
  const z = 1.3 * (naoh - 0.45) - 1.6 * (ct - 0.35) - 1.0 * (gly - 0.4) + 0.5 * (0.5 - speed) - 0.35 * (mix - 0.5) + 0.3 * (au - 0.5) - 0.3 * (uvc - 0.5) + 0.1;
  let D = 1.6 + 9.0 / (1 + Math.exp(-z));          // nm
  const agg = clamp((0.15 - ct) / 0.15, 0, 1) * au; // too little citrate: particles stick together
  let sig = 0.05 + 0.10 * (1 - mix) + 0.04 * speed + 0.2 * agg;
  if (noisy) { D *= 1 + 0.02 * gauss(); Y = clamp(Y * (1 + 0.04 * gauss()), 0, 1); sig = Math.max(0.04, sig * (1 + 0.06 * gauss())); }
  return { D, sig, Y, cAu, agg };
}

// ---------------- scattering patterns ----------------
// Calculated with DebyeCalculator (Johansen, Anker et al., J. Open Source Softw. 2024, 9(94), 6024,
// doi:10.21105/joss.06024) for fcc Au spheres of 1.5–10.5 nm and for AuCl₄⁻: tools/scatterlab_debye.py ->
// js/scatterlab_data.js. Here we interpolate in diameter and average over the size distribution.
const SL = SCATTERLAB, SLD = SL.D;
const sizeDist = (Dnm, sig) => [-1.5, -0.75, 0, 0.75, 1.5].map((t) => ({ D: clamp(Dnm * (1 + sig * t), SLD[0], SLD[SLD.length - 1]), w: Math.exp(-t * t / 2) }));
const QG = SL.qTS;                                                     // Q 0.5–15 Å⁻¹ (DebyeCalculator grid)
const RG = Array.from({ length: 601 }, (_, i) => i * 0.05);            // r 0–30 Å
const qG = Array.from({ length: 130 }, (_, i) => 0.008 * (0.5 / 0.008) ** (i / 129)); // SAXS q 0.008–0.5 Å⁻¹
// SAXS patterns resampled onto qG (log–log interpolation keeps the fringe minima)
const onQG = (I) => qG.map((q) => { const x = (q - SL.qS[0]) / (SL.qS[1] - SL.qS[0]); const i = clamp(Math.floor(x), 0, SL.qS.length - 2), t = x - i;
  return Math.exp(Math.log(Math.max(I[i], 1e-12)) * (1 - t) + Math.log(Math.max(I[i + 1], 1e-12)) * t); });
const SLI = SL.I.map(onQG), PREC_I = onQG(SL.prec.I);
const PREC_F = (() => { const m = Math.max(...SL.prec.F.map(Math.abs)); return SL.prec.F.map((v) => v / m); })(); // AuCl₄⁻, scaled to ~1 per Au
const atD = (arrs, d) => { const k = Math.min(SLD.length - 2, Math.max(0, Math.floor((d - SLD[0]) / (SLD[1] - SLD[0])))); const t = clamp((d - SLD[k]) / (SLD[k + 1] - SLD[k]), 0, 1);
  const a = arrs[k], b = arrs[k + 1]; const out = new Float64Array(a.length); for (let i = 0; i < a.length; i++) out[i] = a[i] + (b[i] - a[i]) * t; return out; };
// size average, weighted by the number of atoms in each size (∝ D³), as both patterns are per atom
function sizeAvg(arrs, o) {
  const dist = sizeDist(o.D, o.sig); let ws = 0; const acc = new Float64Array(arrs[0].length);
  for (const d of dist) { const w = d.w * d.D ** 3; ws += w; const p = atD(arrs, d.D); for (let i = 0; i < acc.length; i++) acc[i] += w * p[i]; }
  for (let i = 0; i < acc.length; i++) acc[i] /= ws; return acc;
}
let SIN = null; // sin(Q r) table for the Fourier transform
function ftG(F) {
  if (!SIN) { SIN = new Float32Array(QG.length * RG.length); for (let j = 0; j < RG.length; j++) for (let i = 0; i < QG.length; i++) SIN[j * QG.length + i] = Math.sin(QG[i] * RG[j]); }
  const dQ = QG[1] - QG[0], out = new Float64Array(RG.length);
  for (let j = 0; j < RG.length; j++) { let s = 0; const o = j * QG.length; for (let i = 0; i < QG.length; i++) s += F[i] * SIN[o + i]; out[j] = 2 / Math.PI * s * dQ; }
  return out;
}
// total scattering: F(Q) of the particles (+ leftover AuCl₄⁻ if reduction was incomplete); G(r) by Fourier transform
function patternTS(o, noise) {
  const F = new Float64Array(QG.length);
  if (o.D > 0) { const p = sizeAvg(SL.F, o); for (let i = 0; i < F.length; i++) F[i] = o.Y * p[i]; }
  const unr = o.cAu > 0 ? 1 - o.Y : 0;
  if (unr > 0) for (let i = 0; i < F.length; i++) F[i] += unr * PREC_F[i];
  if (noise) { // 1 min exposure: noise relative to the signal, worse at low gold concentration and high Q
    let mx = 0; for (const v of F) mx = Math.max(mx, Math.abs(v)); mx = mx || 1;
    const s = 0.006 / Math.sqrt(Math.max(o.cAu, 0.02));
    for (let i = 0; i < QG.length; i++) F[i] += mx * s * (1 + QG[i] / 5) * gauss();
  }
  return { F, Gr: ftG(F) };
}
// SAXS: polydisperse spheres, an aggregation upturn at low q and the leftover precursor
function patternSAXS(o, noise) {
  const I = new Float64Array(qG.length);
  const np = o.D > 0 ? sizeAvg(SLI, o) : null; const Vm = o.D > 0 ? Math.PI / 6 * o.D ** 3 : 0;
  for (let i = 0; i < qG.length; i++)
    I[i] = o.cAu * ((np ? o.Y * np[i] : 0) + o.agg * o.Y * Vm * 0.05 * (qG[i] / 0.008) ** -3 + (1 - o.Y) * PREC_I[i]) + 0.01;
  if (noise) for (let i = 0; i < I.length; i++) { const counts = I[i] * 2000; I[i] = Math.max(1e-4, I[i] + Math.sqrt(counts + 2) / 2000 * gauss()); }
  return { I };
}
const norm = (a) => { let mx = 0; for (const v of a) mx = Math.max(mx, Math.abs(v)); mx = mx || 1; return Array.from(a, (v) => v / mx); };
const mse = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2; return s / a.length; };
function measure(key, o, noise = true) {
  if (key === 'danmax') { const p = patternTS(o, noise); return { F: norm(p.F), Gr: norm(p.Gr) }; }
  const p = patternSAXS(o, noise); const mx = Math.max(...p.I); return { I: Array.from(p.I, (v) => Math.log10(Math.max(v / mx, 1e-4))) };
}
// the objective, as in the paper: mean-squared error after normalising each pattern to its highest peak
function lossOf(key, m, t) { return key === 'danmax' ? mse(m.F, t.F) + mse(m.Gr, t.Gr) : mse(m.I, t.I) / 4; }

// ---------------- Gaussian process + Bayesian optimisation ----------------
function chol(A, n) { const L = new Float64Array(n * n); for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) { let s = A[i * n + j]; for (let k = 0; k < j; k++) s -= L[i * n + k] * L[j * n + k]; if (i === j) { if (s <= 0) return null; L[i * n + i] = Math.sqrt(s); } else L[i * n + j] = s / L[j * n + j]; } return L; }
function solveL(L, n, b) { const y = new Float64Array(n); for (let i = 0; i < n; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= L[i * n + k] * y[k]; y[i] = s / L[i * n + i]; } return y; }
function solveLT(L, n, y) { const x = new Float64Array(n); for (let i = n - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k < n; k++) s -= L[k * n + i] * x[k]; x[i] = s / L[i * n + i]; } return x; }
let ENS = 4; // hyperparameter sets averaged in the GP
const matern = (r2) => { const r = Math.sqrt(5 * r2); return (1 + r + r * r / 3) * Math.exp(-r); };
class GP {
  constructor(d) { this.d = d; this.th = [...Array(d).fill(Math.log(0.6)), 0, Math.log(0.05)]; } // log lengthscales, log signal var, log noise var
  kern(a, b, th) { let r2 = 0; for (let k = 0; k < this.d; k++) { const t = (a[k] - b[k]) / Math.exp(th[k]); r2 += t * t; } return Math.exp(th[this.d]) * matern(r2); }
  nlp(th) { // −(log marginal likelihood + log prior); SAAS-like half-Cauchy prior favours long lengthscales (few relevant parameters)
    const n = this.X.length; const K = new Float64Array(n * n);
    for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) { const v = this.kern(this.X[i], this.X[j], th); K[i * n + j] = K[j * n + i] = v; }
    for (let i = 0; i < n; i++) K[i * n + i] += Math.exp(th[this.d + 1]) + 1e-6;
    const L = chol(K, n); if (!L) return 1e9;
    const a = solveL(L, n, this.y); let q = 0, ld = 0; for (let i = 0; i < n; i++) { q += a[i] * a[i]; ld += Math.log(L[i * n + i]); }
    let pr = 0; for (let k = 0; k < this.d; k++) { const rho = Math.exp(-2 * th[k]); pr += Math.log1p((rho / 3) ** 2); }
    pr += 0.5 * (th[this.d] / 1.5) ** 2 + 0.5 * ((th[this.d + 1] + 3) / 1.5) ** 2;
    return 0.5 * q + ld + pr;
  }
  fit(X, yRaw, iters = 40, restarts = 3) {
    this.X = X; const n = X.length; this.mu = yRaw.reduce((a, b) => a + b, 0) / n;
    this.sd = Math.sqrt(yRaw.reduce((a, b) => a + (b - this.mu) ** 2, 0) / n) || 1; this.y = yRaw.map((v) => (v - this.mu) / this.sd);
    // Adam on finite-difference gradients: warm start from the last fit + a few random sparse restarts, keep the best
    const adam = (th0) => {
      const th = th0.slice(), m = new Array(th.length).fill(0), v = new Array(th.length).fill(0); let best = th.slice(), bf = this.nlp(th);
      for (let it = 1; it <= iters; it++) {
        const f0 = this.nlp(th); if (f0 < bf) { bf = f0; best = th.slice(); }
        for (let k = 0; k < th.length; k++) {
          const h = 1e-3; th[k] += h; const g = (this.nlp(th) - f0) / h; th[k] -= h;
          m[k] = 0.9 * m[k] + 0.1 * g; v[k] = 0.999 * v[k] + 0.001 * g * g;
          th[k] -= 0.1 * (m[k] / (1 - 0.9 ** it)) / (Math.sqrt(v[k] / (1 - 0.999 ** it)) + 1e-8);
          th[k] = clamp(th[k], k < this.d ? Math.log(0.03) : -9, k < this.d ? Math.log(20) : 3);
        }
      }
      return { th: best, f: bf };
    };
    const sols = [adam(this.th)];
    for (let r = 0; r < restarts; r++) sols.push(adam([...Array(this.d)].map(() => Math.log(0.3) + Math.random() * Math.log(40)).concat([0, Math.log(0.05)])));
    sols.sort((a, b) => a.f - b.f);
    // a small ensemble of the best hyperparameter fits, weighted by their posterior – a cheap stand-in for the fully
    // Bayesian (MCMC) treatment of SAASBO in the paper
    const keep = sols.filter((o) => o.f < sols[0].f + 4).slice(0, ENS);
    this.th = sols[0].th; this.n = n; this.comps = [];
    let wsum = 0;
    for (const o of keep) {
      const th = o.th; const K = new Float64Array(n * n);
      for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) { const v2 = this.kern(X[i], X[j], th); K[i * n + j] = K[j * n + i] = v2; }
      for (let i = 0; i < n; i++) K[i * n + i] += Math.exp(th[this.d + 1]) + 1e-6;
      const L = chol(K, n); if (!L) continue; const w = Math.exp(sols[0].f - o.f); wsum += w;
      this.comps.push({ th, L, alpha: solveLT(L, n, solveL(L, n, this.y)), w });
    }
    for (const c of this.comps) c.w /= wsum;
    this.L = this.comps[0].L;
  }
  predict(x) { // mixture mean and sd in standardised units
    const n = this.n; let m1 = 0, m2 = 0;
    for (const c of this.comps) {
      const ks = new Float64Array(n); for (let i = 0; i < n; i++) ks[i] = this.kern(x, this.X[i], c.th);
      let mu = 0; for (let i = 0; i < n; i++) mu += ks[i] * c.alpha[i];
      const v = solveL(c.L, n, ks); let s = Math.exp(c.th[this.d]); for (let i = 0; i < n; i++) s -= v[i] * v[i];
      m1 += c.w * mu; m2 += c.w * (Math.max(s, 1e-12) + mu * mu);
    }
    return { mu: m1, sd: Math.sqrt(Math.max(m2 - m1 * m1, 1e-12)) };
  }
  relevance() { const r = new Array(this.d).fill(0); for (const c of this.comps) for (let k = 0; k < this.d; k++) r[k] += c.w / Math.exp(c.th[k]); return r; }
}
const Phi = (z) => 0.5 * (1 + erf(z / Math.SQRT2)), phi = (z) => Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI);
function erf(x) { const s = Math.sign(x); x = Math.abs(x); const t = 1 / (1 + 0.3275911 * x); return s * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)); }
const EI = (mu, sd, best) => { const z = (best - mu) / sd; return (best - mu) * Phi(z) + sd * phi(z); }; // minimisation
// quasi-random start (Halton with a random shift; the paper used Sobol)
const PRIMES = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31];
const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };

// ---------------- campaign state per beamline ----------------
const S = {};
const TASKS = [
  { id: 'rand', text: 'Finish the random start', reward: 15000 },
  { id: 'beat', text: 'BO beats all random recipes', reward: 25000 },
  { id: 'hit', text: 'Hit the target', reward: 50000 },
];
function st(key) {
  if (!S[key]) {
    S[key] = { key, Dt: 5, ctrl: PARAMS.map((p) => DEFAULT_CTRL.includes(p.id)), val: PARAMS.map((p) => p.def), runs: [], gp: null, busy: false, auto: false, stopped: false,
      noImp: 0, tasks: {}, status: 'Set a target and start a campaign.' };
    setTarget(S[key], 5);
  }
  return S[key];
}
function setTarget(c, Dt) {
  c.Dt = Dt; c.target = measure(c.key, { D: Dt, sig: 0.07, Y: 1, cAu: 3, agg: 0 }, false);
  const fl = []; for (let i = 0; i < 5; i++) fl.push(lossOf(c.key, measure(c.key, { D: Dt, sig: 0.07, Y: 1, cAu: 3, agg: 0 }, true), c.target));
  fl.sort((a, b) => a - b); c.floor = fl[2];
  // goal line: a sample that is nearly right (size 4 % off, 11 % spread, 85 % reduced), measured the same way
  const gd = []; for (let i = 0; i < 5; i++) gd.push(lossOf(c.key, measure(c.key, { D: Dt * 1.04, sig: 0.11, Y: 0.85, cAu: 2, agg: 0.02 }, true), c.target));
  gd.sort((a, b) => a - b); c.good = gd[2];
}
const ctrlIdx = (c) => PARAMS.map((_, k) => k).filter((k) => c.ctrl[k]);
const nInit = (c) => 2 * ctrlIdx(c).length + 2; // as in the paper: 2d + 2 (24 for all 11 parameters)
const bestRun = (c) => c.runs.reduce((b, r) => (!b || r.loss < b.loss ? r : b), null);

let R = {}; // 3D robot parts per beamline
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// one experiment, animated in the Synthesis and Measurement panels (the real one takes ~8 min: 5 min light + 2 × 1 min)
const PHASES = [['dose', 1.0, 'Dosing'], ['mix', 0.5, 'Mixing'], ['light', 1.1, 'LED illumination'], ['blank', 0.7, 'Blank (solvent), 1 min'], ['pump', 0.7, 'Sample into the flow cell'], ['sample', 0.9, 'Sample, 1 min'], ['reduce', 0.3, 'Data reduction']];
async function runExperiment(c, x, kind, hooks) {
  c.busy = true; const rb = R[c.key]; if (rb) rb.active = 1;
  const truth = synthesise(x); const meas = measure(c.key, truth);
  const n = c.runs.length + 1;
  c.anim = { x, truth, meas, n, prof: radialProfile(c.key, meas) };
  const tick = setInterval(() => drawAnim(c), 40);
  for (const [id, dur, label] of PHASES) { const f = (c.auto ? 0.4 : 1) / (c.speed || 1); c.anim.phase = id; c.anim.t0 = performance.now(); c.anim.dur = dur * f * 1000; c.status = `#${n}: ${label}…`; render(c, hooks); await sleep(dur * f * 1000); }
  clearInterval(tick); c.anim.phase = 'done'; drawAnim(c);
  const loss = lossOf(c.key, meas, c.target);
  const prevBest = bestRun(c)?.loss ?? Infinity;
  const run = { n, x, kind, loss, meas, truth, Dt: c.Dt, prof: c.anim.prof, trL: kind === 'bo' ? c.tr?.L ?? 0.8 : null, ei: kind === 'bo' ? c.lastEI : null, best: Math.min(prevBest, loss), newBest: loss < prevBest }; c.runs.push(run);
  c.noImp = loss < prevBest || kind !== 'bo' ? 0 : c.noImp + 1; // the stopping rule counts optimiser proposals only
  if (kind === 'bo') trUpdate(c, loss < prevBest);
  if (rb) rb.active = 0; c.busy = false;
  // goals
  const nR = c.runs.filter((r) => r.kind === 'rand').length;
  if (nR >= nInit(c)) award(c, 'rand');
  const bestRand = Math.min(...c.runs.filter((r) => r.kind === 'rand').map((r) => r.loss));
  if (kind === 'bo' && loss < bestRand) award(c, 'beat');
  if (loss < c.good) award(c, 'hit');
  return run;
}
function award(c, id) { if (c.tasks[id]) return; c.tasks[id] = true; const t = TASKS.find((x) => x.id === id); G.sfx?.('success'); earn(t.reward, `🤖 ${c.key === 'danmax' ? 'DanMAX' : 'CoSAXS'}: ${t.text}`); }
function fullX(c, uCtrl) { const idx = ctrlIdx(c); const x = c.val.slice(); idx.forEach((k, j) => { x[k] = toPhys(uCtrl[j], k); }); return x; }
function ctrlU(c, x) { return ctrlIdx(c).map((k) => clamp(toUnit(x[k], k), 0, 1)); }
// output transform for the GP: log(loss), with the “no particles” plateau capped so it does not dominate the model
let YT = 'log', ACQ = 'ei';
const yT = (c, L) => (YT === 'sqrt' ? Math.sqrt(Math.min(L, 0.3)) : YT === 'log' ? Math.log(Math.min(L, 0.3)) : Math.log(Math.min(L, 0.3) + c.good));
// Trust region (TuRBO-style, Eriksson et al. 2019): search a box around the best recipe, scaled per parameter by the GP
// lengthscales; it doubles after 2 improvements in a row and halves after 3 failures. Global EI explores too much
// with so few experiments in 6–11 dimensions.
let TR = true;
function trUpdate(c, improved) {
  const t = (c.tr ||= { L: 0.8, s: 0, f: 0 });
  if (improved) { t.s++; t.f = 0; } else { t.f++; t.s = 0; }
  if (t.s >= 2) { t.L = Math.min(1.6, t.L * 2); t.s = 0; }
  if (t.f >= 3) { t.L = Math.max(0.03, t.L / 2); t.f = 0; }
}
function propose(c) {
  const idx = ctrlIdx(c); const d = idx.length; const X = c.runs.map((r) => ctrlU(c, r.x)); const y = c.runs.map((r) => yT(c, r.loss));
  if (!c.gp || c.gp.d !== d) c.gp = new GP(d);
  c.gp.fit(X, y, 60, c.gp.L ? 3 : 8);
  const yb = Math.min(...c.gp.y); const order = c.runs.map((r, i) => i).sort((a, b) => y[a] - y[b]).slice(0, 5);
  let best = null, be = -1;
  const acq = (p) => (ACQ === 'lcb' ? -(p.mu - 1.0 * p.sd) : EI(p.mu, p.sd, yb));
  const tryX = (u) => { const p = c.gp.predict(u); const e = acq(p); if (best === null || e > be) { be = e; best = u; } };
  if (TR) {
    const t = (c.tr ||= { L: 0.8, s: 0, f: 0 }); const ctr = X[order[0]];
    const ls = c.gp.th.slice(0, d).map(Math.exp); const gm = Math.exp(ls.reduce((a, v) => a + Math.log(v), 0) / d);
    const hw = ls.map((l) => clamp(t.L / 2 * l / gm, 0.01, 0.5));
    const lo = ctr.map((v, k) => Math.max(0, v - hw[k])), hi = ctr.map((v, k) => Math.min(1, v + hw[k]));
    c.box = { lo, hi };
    for (let i = 0; i < 2000; i++) tryX(lo.map((a, k) => a + Math.random() * (hi[k] - a)));
    for (const sc of [0.3, 0.1]) for (let k = 0; k < 150; k++) tryX(ctr.map((v, j) => clamp(v + sc * hw[j] * gauss(), lo[j], hi[j])));
  } else {
    for (let i = 0; i < 1500; i++) tryX(Array.from({ length: d }, () => Math.random()));
    for (const i of order) for (const sc of [0.15, 0.05, 0.02]) for (let k = 0; k < 60; k++) tryX(X[i].map((v) => clamp(v + sc * gauss(), 0, 1)));
    for (const sc of [0.03, 0.01]) for (let k = 0; k < 80; k++) tryX(best.map((v) => clamp(v + sc * gauss(), 0, 1)));
  }
  c.lastEI = be; return fullX(c, best);
}
async function step(c, hooks) {
  if (c.busy) return;
  if (!hooks.ready()) { c.status = '<span class="bad">Search and lock the hutch first.</span>'; return render(c, hooks); }
  const nR = c.runs.filter((r) => r.kind === 'rand').length;
  if (nR < nInit(c)) {
    const d = ctrlIdx(c).length; if (!c.shift) c.shift = Array.from({ length: d }, () => Math.random());
    const u = c.shift.map((s, j) => (halton(nR + 1, PRIMES[j]) + s) % 1);
    await runExperiment(c, fullX(c, u), 'rand', hooks);
  } else {
    c.status = 'Bayesian optimisation is choosing the next recipe…'; render(c, hooks); await sleep(30);
    const x = propose(c); await runExperiment(c, x, 'bo', hooks);
    // the paper's stopping rule (6 experiments in a row without improvement), applied once the optimiser has had at least
    // as many proposals as the random start – in the paper it stopped at #47, after 23 optimiser proposals
    if (c.noImp >= 6 && c.runs.filter((r) => r.kind === 'bo').length >= nInit(c) && !c.stopped) { c.stopped = true; c.auto = false; }
  }
  const b = bestRun(c); const tem = b.truth.D ? `${b.truth.D.toFixed(1)} nm ± ${(b.truth.sig * 100).toFixed(0)} %` : 'no particles';
  c.status = c.stopped ? `Stopped: 6 experiments without improvement. Best #${b.n} – TEM check: ${tem} (target ${b.Dt.toFixed(1)} nm).` : `Best so far: #${b.n}, loss ${b.loss.toExponential(1)}`;
  render(c, hooks);
}
async function autoRun(c, hooks) {
  if (c.auto) { c.auto = false; return render(c, hooks); }
  c.auto = true; c.stopped = false; c.noImp = Math.min(c.noImp, 0);
  while (c.auto && !c.stopped) { await step(c, hooks); if (!hooks.ready()) { c.auto = false; break; } await sleep(30); }
  c.auto = false; render(c, hooks);
}

// ---------------- UI tab in the control cabin ----------------
const $ = (id) => document.getElementById(id);
let css = false;
export function openRobotTab(panel, key, hooks) {
  if (!css) { css = true; const s = document.createElement('style'); s.textContent = `
    .slgrid { display: grid; grid-template-columns: 330px 1fr; gap: 14px; align-items: start; } @media (max-width: 1050px) { .slgrid { grid-template-columns: 1fr; } }
    .slcite { font-size: 12.5px; line-height: 1.5; background: #1b1530; border-left: 3px solid #c9a8ff; padding: 6px 9px; border-radius: 4px; margin-bottom: 6px; color: #ddd3f5; }
    .slcite a { color: #d9c4ff; }
    .slp { display: grid; grid-template-columns: 20px 1fr 96px 60px; gap: 5px; align-items: center; font-size: 12.5px; color: #c9d6e3; margin: 1px 0; }
    .slp input[type=range] { width: 100%; accent-color: #8a4fd8; } .slp .v { font-family: monospace; text-align: right; white-space: nowrap; }
    .slpanels { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; } @media (max-width: 700px) { .slpanels { grid-template-columns: 1fr; } }
    .slpan { background: #0a0d12; border: 1px solid #222c38; border-radius: 8px; padding: 6px 6px 4px; min-width: 0; }
    .slpan canvas { width: 100%; display: block; } .slpan[data-z] { cursor: zoom-in; } .slpan[data-z]:hover { border-color: #8a4fd8; }
    #slZoom { position: fixed; inset: 0; z-index: 60; background: rgba(5,8,12,.88); display: none; align-items: center; justify-content: center; }
    #slZoom .card { max-width: 96vw; max-height: 94vh; overflow: auto; } #slZoom canvas { display: block; width: min(1100px, 92vw); height: auto; background: #0a0d12; border-radius: 6px; margin-top: 6px; }
    .slh { font-size: 12.5px; font-weight: bold; color: #e8dcff; margin: 0 2px 4px; display: flex; gap: 8px; align-items: center; justify-content: space-between; }
    .sltasks div { font-size: 13px; margin: 2px 0; } .sltasks .done { color: #7dffb0; }
    .sldbt button { background: #1d2733; color: #b9c7d6; border: 1px solid #2a3646; border-radius: 6px; padding: 2px 8px; font: bold 11.5px var(--font); cursor: pointer; margin-left: 3px; }
    .sldbt button.on { background: #8a4fd8; color: #fff; border-color: #8a4fd8; }
    .sldb { height: 250px; overflow: auto; font-size: 11.5px; color: #c9d6e3; } .sldb.big { height: auto; max-height: 72vh; font-size: 13px; }
    .sldb table { border-collapse: collapse; width: 100%; } .sldb th, .sldb td { padding: 2px 6px; text-align: right; white-space: nowrap; border-bottom: 1px solid #1b2330; }
    .sldb th { position: sticky; top: 0; background: #131a23; color: #9fb3c8; font-weight: bold; } .sldb td:first-child, .sldb th:first-child { text-align: left; }
    .sldb .sum { color: #9fb3c8; margin: 2px 2px 6px; } .sldb tr.nb td { color: #7dffb0; } .sldb .sw { display: inline-block; width: 14px; height: 10px; border-radius: 2px; vertical-align: middle; }`; document.head.appendChild(s); }
  const c = st(key); c.panel = panel; hooks.key = key;
  const dan = key === 'danmax'; const running = c.runs.length > 0;
  panel.innerHTML = `<div class="slgrid"><div>
    <div class="slcite">🤖 Idea from our paper: <a href="${PAPER.url}" target="_blank" rel="noopener">Anker <i>et al.</i>, <i>ACS Nano</i> 2026</a>.${dan ? '' : ' Adapted here to SAXS – the paper measured PDF at DanMAX.'}<br>
      Patterns: <a href="https://github.com/FrederikLizakJohansen/DebyeCalculator" target="_blank" rel="noopener">DebyeCalculator</a> (<a href="https://doi.org/10.21105/joss.06024" target="_blank" rel="noopener">Johansen, Anker <i>et al.</i>, <i>JOSS</i> 2024</a>).
      ${info('Simulated in the game: the chemistry is a made-up model with the trend the paper found (bigger particles with more NaOH, less citrate and less glycerol), and the optimiser is a simplified version of the paper\'s.')}</div>
    <h4>1 · Target</h4>
    <div class="slp" style="grid-template-columns:1fr 96px 60px"><span>Gold particle diameter</span><input type="range" id="slDt" min="2" max="10" step="0.5" value="${c.Dt}" ${running ? 'disabled' : ''}><span class="v" id="slDtv">${c.Dt.toFixed(1)} nm</span></div>
    <h4>2 · Parameters ${info('✓ = the optimiser controls it (the paper used all 11). Unticked ones stay at the slider value. The sliders are also your own recipe for “Run my recipe”.')}</h4>
    <div id="slParams"></div>
    <h4>3 · Run</h4>
    <div class="cxinl"><button id="slStep" class="cxbtn" style="flex:1">Next experiment</button><button id="slAuto" class="cxbtn" style="flex:1">Auto-run</button></div>
    <div class="cxinl"><button id="slMine" class="cxbtn alt" style="flex:1">Run my recipe</button><button id="slReset" class="cxbtn alt" style="flex:1">New campaign</button></div>
    <div class="cxinl sldbt" id="slSpeed" style="margin-top:6px"><span class="cxlab" style="margin:0">Speed</span>${[1, 2, 4, 8].map((v) => `<button data-sp="${v}" class="${(c.speed || 1) === v ? 'on' : ''}">×${v}</button>`).join('')}</div>
    <div id="slStatus" class="cxbox info"></div>
    <h4>Goals</h4><div class="sltasks" id="slTasks"></div>
  </div><div class="slpanels">
    <div class="slpan" data-z="syn" title="Click to enlarge"><div class="slh">1 · Synthesis (robot)<span class="dim" id="slSynL"></span></div><canvas id="slSyn" width="420" height="250"></canvas></div>
    <div class="slpan" data-z="meas" title="Click to enlarge"><div class="slh">2 · Measurement (${dan ? 'DanMAX' : 'CoSAXS'})<span class="dim" id="slMeasL"></span></div><canvas id="slMeas" width="420" height="250"></canvas></div>
    <div class="slpan" data-z="data" title="Click to enlarge"><div class="slh" id="slDataH">3 · Data vs target</div>${dan ? '<canvas id="slF" width="420" height="125"></canvas><canvas id="slG" width="420" height="125"></canvas>' : '<canvas id="slI" width="420" height="250"></canvas>'}</div>
    <div class="slpan" data-z="loss" title="Click to enlarge"><div class="slh">4 · Loss so far</div><canvas id="slLoss" width="420" height="250"></canvas></div>
    <div class="slpan" data-z="imp" title="Click to enlarge"><div class="slh">5 · Parameter importance ${info('How much each parameter matters to the model (1 / lengthscale of the Gaussian process).')}</div><canvas id="slImp" width="420" height="250"></canvas></div>
    <div class="slpan" data-z="db" title="Click to enlarge"><div class="slh"><span>6 · Database ${info('Everything the loop stores for each experiment – like the database in the paper: the recipe, the scattering data and the optimiser\'s decisions.')}</span><span class="sldbt" id="slDBt"></span></div><div class="sldb" id="slDB"></div></div>
  </div></div>`;
  const pBox = $('slParams');
  pBox.innerHTML = PARAMS.map((p, k) => `<div class="slp"><input type="checkbox" data-c="${k}" ${c.ctrl[k] ? 'checked' : ''} ${running ? 'disabled' : ''} title="Controlled by the optimiser">
    <span>${p.name}</span><input type="range" data-v="${k}" min="${p.lo}" max="${p.hi}" step="${(p.hi - p.lo) / 100}" value="${c.val[k]}" ${running && !c.ctrl[k] ? 'disabled' : ''}>
    <span class="v" id="slv${k}">${fmtV(c.val[k], k)}</span></div>`).join('');
  pBox.addEventListener('input', (e) => { const k = e.target.dataset.v; if (k === undefined) return; c.val[+k] = +e.target.value; $('slv' + k).textContent = fmtV(c.val[+k], +k); });
  pBox.addEventListener('change', (e) => { const k = e.target.dataset.c; if (k === undefined) return; c.ctrl[+k] = e.target.checked; c.gp = null; c.shift = null; c.tr = null; c.box = null; render(c, hooks); });
  $('slDt').addEventListener('input', (e) => { setTarget(c, +e.target.value); $('slDtv').textContent = c.Dt.toFixed(1) + ' nm'; render(c, hooks); });
  $('slSpeed').addEventListener('click', (e) => { const b = e.target.closest('[data-sp]'); if (!b) return; c.speed = +b.dataset.sp; $('slSpeed').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); });
  $('slStep').addEventListener('click', () => { c.stopped = false; step(c, hooks); });
  $('slAuto').addEventListener('click', () => autoRun(c, hooks));
  $('slMine').addEventListener('click', async () => { if (c.busy) return; if (!hooks.ready()) return step(c, hooks); await runExperiment(c, c.val.slice(), 'you', hooks); const r = c.runs[c.runs.length - 1]; c.status = `Your recipe (#${r.n}): loss ${r.loss.toExponential(1)}`; render(c, hooks); });
  $('slReset').addEventListener('click', () => { if (c.busy) return; c.auto = false; c.runs = []; c.gp = null; c.shift = null; c.tr = null; c.box = null; c.anim = null; c.stopped = false; c.noImp = 0; c.status = ''; openRobotTab(panel, key, hooks); });
  panel.querySelector('.slpanels').addEventListener('click', (e) => { const db = e.target.closest('[data-db]'); if (db) { c.dbTab = db.dataset.db; drawDB(c); drawZoom(c); return; } const pan = e.target.closest('.slpan[data-z]'); if (!pan || e.target.closest('select, .ib, .ibx, a, button')) return; openZoom(c, pan.dataset.z); });
  render(c, hooks);
}
const fmtV = (v, k) => (PARAMS[k].unit === '%' ? v.toFixed(0) + ' %' : v.toFixed(2) + ' mL');

function render(c, hooks) {
  if (!c.panel || !c.panel.isConnected || !$('slStatus')) return;
  const nR = c.runs.filter((r) => r.kind === 'rand').length, need = nInit(c);
  const phase = c.runs.length === 0 ? `First ${need} experiments are random, then Bayesian optimisation (BO) takes over.` : nR < need ? `Random start: ${nR} / ${need}` : 'Bayesian optimisation';
  $('slStatus').innerHTML = (c.status ? c.status + '<br>' : '') + `<span class="dim">${phase}</span>`;
  $('slStep').disabled = c.busy || c.auto; $('slMine').disabled = c.busy || c.auto; $('slReset').disabled = c.busy || c.auto;
  $('slStep').textContent = c.stopped ? 'Keep optimising' : 'Next experiment';
  $('slAuto').textContent = c.auto ? '⏸ Pause' : '▶ Auto-run';
  $('slTasks').innerHTML = TASKS.map((t) => `<div class="${c.tasks[t.id] ? 'done' : ''}">${c.tasks[t.id] ? '✓' : '○'} ${t.text}</div>`).join('');
  if (!c.busy) drawAnim(c);
  drawPatterns(c); drawLoss(c); drawImp(c); drawDB(c); drawZoom(c);
}

// ---------- click a panel to enlarge it (plots are redrawn at full size, animations keep running) ----------
const ZOOM_T = { syn: '1 · Synthesis (robot)', meas: '2 · Measurement', data: '3 · Data vs target', loss: '4 · Loss so far', imp: '5 · Parameter importance', db: '6 · Database' };
const zoomKind = () => { const z = $('slZoom'); return z && z.style.display === 'flex' ? z.dataset.kind : null; };
function openZoom(c, kind) {
  let z = $('slZoom');
  if (!z) {
    z = document.createElement('div'); z.id = 'slZoom'; document.body.appendChild(z);
    z.addEventListener('click', (e) => { const b = e.target.closest('[data-db]'); if (b && z.zc) { z.zc.dbTab = b.dataset.db; drawDB(z.zc); drawZoom(z.zc); return; } if (e.target === z || e.target.classList.contains('close')) z.style.display = 'none'; });
    window.addEventListener('keydown', (e) => { if (z.style.display === 'flex' && (e.code === 'Escape' || e.code === 'KeyE')) { e.stopPropagation(); e.preventDefault(); z.style.display = 'none'; } }, true);
  }
  const two = kind === 'data' && c.key === 'danmax'; const big = (h) => `<canvas width="1100" height="${h}"></canvas>`;
  z.dataset.kind = kind; z.zc = c;
  const body = kind === 'db' ? '<div class="sldbt" id="slZoomDBt" style="margin:6px 0"></div><div class="sldb big" id="slZoomDB" style="width:min(1100px,92vw)"></div>' : two ? big(330) + big(330) : big(['syn', 'meas'].includes(kind) ? 655 : 560);
  z.innerHTML = `<div class="card"><button class="close">✕ close (Esc)</button><h3 style="color:#e8dcff;margin:0" id="slZoomT">${ZOOM_T[kind]}</h3>${body}</div>`;
  z.style.display = 'flex'; drawZoom(c);
}
function drawZoom(c) {
  const kind = zoomKind(); if (!kind) return; const z = $('slZoom'); if (z.zc !== c) return; const cv = [...z.querySelectorAll('canvas')];
  if (kind === 'syn') drawSyn(c, cv[0]); else if (kind === 'meas') drawMeas(c, cv[0]);
  else if (kind === 'data') { drawPatterns(c, c.key === 'danmax' ? { F: cv[0], G: cv[1] } : { I: cv[0] }); const h = $('slDataH'); if (h) $('slZoomT').innerHTML = h.innerHTML; }
  else if (kind === 'loss') drawLoss(c, cv[0]); else if (kind === 'imp') drawImp(c, cv[0]); else if (kind === 'db') drawDB(c, $('slZoomDB'), $('slZoomDBt'), true);
}

// ---------- panel 1: the synthesis in the robot ----------
const mixRGB = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const rgb = (a, al = 1) => `rgba(${a.map((v) => Math.round(v)).join(',')},${al})`;
function productRGB(o) { // colloidal gold: small = brownish red, ~5 nm ruby, larger = purple-red; aggregates turn blue-grey
  if (!o.D) return [236, 214, 120];
  let col = o.D < 3 ? mixRGB([170, 90, 50], [176, 24, 44], (o.D - 1.5) / 1.5) : mixRGB([176, 24, 44], [125, 30, 90], clamp((o.D - 5) / 5, 0, 1));
  col = mixRGB(col, [80, 80, 130], clamp(o.agg * 1.5, 0, 1));
  return mixRGB([236, 214, 120], col, clamp(o.Y, 0, 1));
}
function drawSyn(c, cv = $('slSyn')) {
  if (!cv) return; const g = cv.getContext('2d'); const W = 420, H = 250; g.setTransform(cv.width / W, 0, 0, cv.height / H, 0, 0);
  g.fillStyle = '#0a0d12'; g.fillRect(0, 0, W, H);
  const a = c.anim; const x = a?.x || c.val; const ph = a?.phase || 'idle';
  const p = a && a.dur ? clamp((performance.now() - a.t0) / a.dur, 0, 1) : 1;
  const order = ['dose', 'mix', 'light', 'blank', 'pump', 'sample', 'reduce', 'done'];
  const after = (id) => a && order.indexOf(ph) > order.indexOf(id);
  const dosed = !a ? 0 : ph === 'dose' ? p : 1;
  // six syringes
  const vols = [0, 1, 2, 3, 4, 5]; const names = ['H₂O', 'Glyc.', 'EtOH', 'HAuCl₄', 'NaOH', 'Citr.'];
  const sx = (i) => 22 + i * 40, top = 18, len = 92;
  const vx = 300, vy = 150, vw = 70, vh = 80; // vial
  vols.forEach((i) => {
    const frac = x[i] / PARAMS[i].hi; const left = frac * (1 - dosed);
    g.strokeStyle = '#5d6b7a'; g.lineWidth = 2; g.strokeRect(sx(i), top, 22, len);
    g.fillStyle = i === 3 ? 'rgba(236,200,60,0.9)' : 'rgba(150,200,240,0.55)'; g.fillRect(sx(i) + 2, top + len - left * (len - 4) - 2, 18, left * (len - 4));
    g.fillStyle = '#9aa3ab'; g.fillRect(sx(i) + 4, top + len - left * (len - 4) - 8, 14, 5); // plunger
    g.fillStyle = '#9fb3c8'; g.font = '11px Arial'; g.textAlign = 'center'; g.fillText(names[i], sx(i) + 11, top + len + 14);
    if (ph === 'dose' && frac > 0.01) { // stream into the vial
      g.strokeStyle = i === 3 ? 'rgba(236,200,60,0.8)' : 'rgba(150,200,240,0.6)'; g.lineWidth = i === 3 ? 1 + 3 * toUnit(x[6], 6) : 1.5;
      g.beginPath(); g.moveTo(sx(i) + 11, top + len + 18); g.quadraticCurveTo(sx(i) + 11, vy - 30, vx + vw / 2 - 20 + i * 8, vy - vh / 2 + 6); g.stroke();
    }
  });
  // liquid colour: precursor yellow → product colour during the light step
  const Vt = x.slice(0, 6).reduce((s, v) => s + v, 0); const auF = x[3] / Math.max(Vt, 0.01);
  const pre = mixRGB([200, 225, 245], [236, 200, 60], clamp(auF * 4, 0, 1));
  const prod = a ? productRGB(a.truth) : (c.runs.length ? productRGB(c.runs[c.runs.length - 1].truth) : pre);
  const lit = ph === 'light' ? p : after('light') || !a ? 1 : 0;
  const col = !a && !c.runs.length ? pre : mixRGB(pre, prod, lit);
  const level = (a ? dosed : c.runs.length ? 1 : 0) * clamp(Vt / 10, 0.25, 1) * (after('pump') ? 0.35 : ph === 'pump' ? 1 - 0.65 * p : 1);
  g.strokeStyle = '#c9d6e3'; g.lineWidth = 2; g.beginPath(); g.moveTo(vx, vy - vh / 2); g.lineTo(vx, vy + vh / 2); g.lineTo(vx + vw, vy + vh / 2); g.lineTo(vx + vw, vy - vh / 2); g.stroke();
  if (level > 0) { g.fillStyle = rgb(col, 0.92); g.fillRect(vx + 2, vy + vh / 2 - level * (vh - 4) - 1, vw - 4, level * (vh - 4)); }
  // stirrer
  if ((ph === 'mix' || ph === 'light') && level > 0) { const ang = performance.now() / 1000 * (6 + 18 * toUnit(x[7], 7)); const w = 22 * Math.abs(Math.cos(ang)) + 4; g.fillStyle = '#f2f2f2'; g.fillRect(vx + vw / 2 - w / 2, vy + vh / 2 - 7, w, 4); }
  // LEDs: white, UV-B, UV-C
  const leds = [[8, '#ffffff', 'white'], [9, '#9d7bff', 'UV-B'], [10, '#d07bff', 'UV-C']];
  leds.forEach(([k, cl, lab], i) => {
    const ly = 70 + i * 34, lx = 386; const on = ph === 'light' ? x[k] / 50 : 0;
    if (on > 0.02) { const gr = g.createRadialGradient(lx, ly, 2, lx, ly, 24 + 40 * on); gr.addColorStop(0, cl); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.globalAlpha = 0.35 + 0.5 * on; g.fillStyle = gr; g.beginPath(); g.arc(lx, ly, 24 + 40 * on, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1; }
    g.fillStyle = on > 0.02 ? cl : '#333a44'; g.beginPath(); g.arc(lx, ly, 7, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#9fb3c8'; g.font = '10px Arial'; g.textAlign = 'left'; g.fillText(lab, lx + 10, ly + 4);
  });
  if (ph === 'pump') { g.strokeStyle = rgb(col, 0.9); g.lineWidth = 3; g.beginPath(); g.moveTo(vx + vw / 2, vy + vh / 2); g.lineTo(vx + vw / 2, H - 6); g.lineTo(W - 6, H - 6); g.stroke(); }
  g.textAlign = 'left';
  const L = { idle: c.runs.length ? `last: #${c.runs[c.runs.length - 1].n}` : 'ready', dose: 'dosing', mix: 'mixing', light: 'LED light (5 min)', blank: 'waiting', pump: '→ to the beam', sample: 'done', reduce: 'done', done: 'done' }[ph] ?? '';
  g.setTransform(1, 0, 0, 1, 0, 0);
  const el = $('slSynL'); if (el) el.textContent = a ? `#${a.n} · ${L}` : L;
}

// ---------- panel 2: the detector image builds up during the 1 min exposure ----------
// radial profile (0 = centre, 1 = detector edge) of the brightness shown on the detector
function radialProfile(key, m) {
  const N = 160, out = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    if (key === 'danmax') { const Q = 0.5 + t * 14.5; const j = clamp(Math.round((Q - QG[0]) / (QG[1] - QG[0])), 0, QG.length - 1); out[i] = clamp(0.18 + 0.82 * Math.max(0, m.F[j]), 0, 1) * (1 - 0.35 * t); }
    else { const q = 0.008 + t * (0.5 - 0.008); const j = clamp(Math.round(Math.log(q / qG[0]) / Math.log(qG[1] / qG[0])), 0, qG.length - 1); out[i] = clamp((m.I[j] + 4) / 4, 0, 1); }
  }
  return out;
}
const LUT = ['#000004', '#1b0c41', '#4a0c6b', '#781c6d', '#a52c60', '#cf4446', '#ed6925', '#fb9b06', '#f7d13d', '#fcffa4'].map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
const cmap = (v) => { v = clamp(v, 0, 1) * (LUT.length - 1); const i = Math.min(LUT.length - 2, Math.floor(v)), f = v - i; return LUT[i].map((x, k) => x + (LUT[i + 1][k] - x) * f); };
let detBuf = null;
function drawMeas(c, cv = $('slMeas')) {
  if (!cv) return; const g = cv.getContext('2d'); const W = 420, H = 250; g.setTransform(cv.width / W, 0, 0, cv.height / H, 0, 0);
  g.fillStyle = '#0a0d12'; g.fillRect(0, 0, W, H);
  const a = c.anim; const last = c.runs[c.runs.length - 1];
  const ph = a?.phase || 'idle'; const p = a && a.dur ? clamp((performance.now() - a.t0) / a.dur, 0, 1) : 1;
  const prof = (a && a.prof) || last?.prof; const N = 150;
  detBuf ||= Object.assign(document.createElement('canvas'), { width: N, height: N });
  const dg = detBuf.getContext('2d'); const im = dg.createImageData(N, N); const dan = c.key === 'danmax';
  const expo = !a ? (prof ? 1 : 0) : ph === 'sample' ? p : ['reduce', 'done'].includes(ph) ? 1 : 0;
  const blank = ph === 'blank' ? p : 0; const R = N / 2;
  for (let y = 0; y < N; y++) for (let xx = 0; xx < N; xx++) {
    const r = Math.hypot(xx - R + 0.5, y - R + 0.5) / R; let v = 0;
    if (r < 0.05) v = 0; // beamstop
    else if (r <= 1.0) { const base = prof ? prof[Math.min(prof.length - 1, Math.floor(r * (prof.length - 1)))] : 0; v = expo * base + (blank + expo) * 0.08 * Math.random(); if (expo > 0) v += (Math.random() - 0.5) * 0.25 * (1 - expo * 0.7) * base; }
    const gap = dan ? (xx % 38 < 1 || y % 19 < 1) : (xx % 75 < 1 || y % 38 < 1);
    const col = gap ? [20, 22, 26] : cmap(v); const o = (y * N + xx) * 4; im.data[o] = col[0]; im.data[o + 1] = col[1]; im.data[o + 2] = col[2]; im.data[o + 3] = 255;
  }
  dg.putImageData(im, 0, 0);
  // instrument, side view: X-ray beam → flow cell fed by the robot → (CoSAXS: vacuum flight tube) → detector
  const by = 150, cx0 = 120; const beamOn = ph === 'blank' || ph === 'sample';
  const sol = [200, 225, 245]; const smp = productRGB((a || last)?.truth || { D: 0, Y: 0 });
  let cellCol = null, cellFill = 0, flow = null;
  if (a) {
    if (ph === 'blank') { flow = p < 0.35 ? sol : null; cellCol = sol; cellFill = clamp(p / 0.35, 0, 1); }
    else if (ph === 'pump') { flow = smp; cellCol = mixRGB(sol, smp, p); cellFill = 1; }
    else if (order2(ph) > order2('pump')) { cellCol = smp; cellFill = 1; }
  } else if (last) { cellCol = smp; cellFill = 1; }
  // source (undulator) and beam
  g.fillStyle = '#2a3340'; g.fillRect(6, by - 9, 36, 18); g.fillStyle = '#c0392b'; for (let i = 0; i < 5; i++) g.fillRect(9 + i * 6.5, by - 9, 3, 18);
  g.fillStyle = '#9fb3c8'; g.font = '10px Arial'; g.textAlign = 'left'; g.fillText('X-ray beam', 6, by - 14);
  g.strokeStyle = beamOn ? '#ffe27a' : '#3a4350'; g.lineWidth = beamOn ? 3 : 1.5; g.beginPath(); g.moveTo(42, by); g.lineTo(cx0 - 6, by); g.stroke();
  // robot and tubing down to the flow cell
  g.fillStyle = '#1d2733'; g.strokeStyle = '#5d6b7a'; g.lineWidth = 1.5; g.fillRect(cx0 - 42, 8, 84, 26); g.strokeRect(cx0 - 42, 8, 84, 26);
  g.fillStyle = '#c9d6e3'; g.font = '11px Arial'; g.textAlign = 'center'; g.fillText('🤖 robot', cx0, 25);
  g.strokeStyle = '#3a4350'; g.lineWidth = 7; g.beginPath(); g.moveTo(cx0, 34); g.lineTo(cx0, by - 23); g.stroke();
  if (flow) { g.strokeStyle = rgb(flow, 0.95); g.lineWidth = 4; g.setLineDash([9, 6]); g.lineDashOffset = -performance.now() / 20; g.beginPath(); g.moveTo(cx0, 34); g.lineTo(cx0, by - 23); g.stroke(); g.setLineDash([]); }
  // the flow cell (a capillary across the beam)
  g.fillStyle = '#121820'; g.fillRect(cx0 - 6, by - 23, 12, 46);
  if (cellCol) { const h = 44 * cellFill; g.fillStyle = rgb(cellCol, 0.95); g.fillRect(cx0 - 5, by - 22, 10, h); }
  g.strokeStyle = '#c9d6e3'; g.lineWidth = 1.2; g.strokeRect(cx0 - 6, by - 23, 12, 46);
  g.fillStyle = '#9fb3c8'; g.font = '10px Arial'; g.fillText('flow cell', cx0, by + 37);
  // flight tube (CoSAXS) and the detector, seen at an angle
  const D = dan ? { x: 205, y: 102, s: 128, sk: -0.25, sx: 0.6, name: 'PILATUS4 X CdTe 4M', dist: '0.25 m' } : { x: 305, y: 104, s: 108, sk: -0.2, sx: 0.55, name: 'EIGER2 4M', dist: '3 m' };
  const Pd = (u, v) => [D.x + D.sx * u, D.y + D.sk * u + v];
  if (!dan) { g.fillStyle = '#1b222c'; g.strokeStyle = '#5d6b7a'; g.lineWidth = 1.2; g.fillRect(cx0 + 16, by - 15, D.x - cx0 - 20, 30); g.strokeRect(cx0 + 16, by - 15, D.x - cx0 - 20, 30); g.fillStyle = '#9fb3c8'; g.fillText('vacuum flight tube', (cx0 + D.x) / 2 + 6, by + 29); }
  if (beamOn) {
    const [ax, ay] = Pd(D.s / 2, 2), [bx2, by2] = Pd(D.s / 2, D.s - 2), [mx, my] = Pd(D.s / 2, D.s / 2);
    g.fillStyle = 'rgba(255,226,122,0.12)'; g.beginPath(); g.moveTo(cx0, by); g.lineTo(ax, ay); g.lineTo(bx2, by2); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(255,226,122,0.8)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(cx0 + 6, by); g.lineTo(mx, my); g.stroke();
  }
  g.save(); g.transform(D.sx, D.sk, 0, 1, D.x, D.y); g.imageSmoothingEnabled = false; g.drawImage(detBuf, 0, 0, D.s, D.s);
  g.strokeStyle = '#9aa3ab'; g.lineWidth = 4; g.strokeRect(-2, -2, D.s + 4, D.s + 4); g.restore();
  g.fillStyle = '#9fb3c8'; g.font = '10px Arial'; g.fillText(D.name, Pd(D.s / 2, 0)[0], D.y + D.s + 14);
  g.fillText(`sample → detector ${D.dist}`, (cx0 + D.x) / 2 + 6, by - 22);
  const txt = { idle: last ? `last: #${last.n}` : 'waiting for a sample', dose: 'waiting for the robot', mix: 'waiting for the robot', light: 'waiting for the robot', blank: 'blank: solvent in the beam, 1 min', pump: 'sample flows into the flow cell', sample: 'sample in the beam, 1 min', reduce: 'reduce the image → 1D pattern', done: '' }[ph];
  g.textAlign = 'left'; g.fillStyle = '#c9d6e3'; g.font = '12px Arial'; g.fillText(txt || '', 8, H - 10);
  if (beamOn) { g.fillStyle = '#ffe27a'; g.fillText(`${Math.round(p * 60)} s`, 8, H - 26); }
  g.setTransform(1, 0, 0, 1, 0, 0);
  const el = $('slMeasL'); if (el) el.textContent = a ? `#${a.n}` : '';
}
const order2 = (ph) => ['dose', 'mix', 'light', 'blank', 'pump', 'sample', 'reduce', 'done'].indexOf(ph);
function drawAnim(c) { if (!c.panel?.isConnected) return; drawSyn(c); drawMeas(c); if (['syn', 'meas'].includes(zoomKind())) drawZoom(c); }

// ---------- panel 6: the database (what the loop stores per experiment) ----------
const DBT = [['syn', '1 Synthesis'], ['scat', '2 Scattering'], ['bo', '3 BO']];
const KIND = { rand: 'random', bo: 'BO', you: 'you' };
function spark(arr, w = 90, h = 18) { // tiny inline plot of a pattern
  const n = 45, step = (arr.length - 1) / (n - 1); let mn = Infinity, mx = -Infinity; const v = [];
  for (let i = 0; i < n; i++) { const y = arr[Math.round(i * step)]; v.push(y); mn = Math.min(mn, y); mx = Math.max(mx, y); }
  const pts = v.map((y, i) => `${(i / (n - 1) * w).toFixed(1)},${(h - 1 - (y - mn) / ((mx - mn) || 1) * (h - 2)).toFixed(1)}`).join(' ');
  return `<svg width="${w}" height="${h}" style="vertical-align:middle"><polyline points="${pts}" fill="none" stroke="#c9a8ff" stroke-width="1.2"/></svg>`;
}
function drawDB(c, el = $('slDB'), tabs = $('slDBt'), big = false) {
  if (!el) return; const t = c.dbTab || 'syn'; const rs = c.runs.slice().reverse(); const dan = c.key === 'danmax';
  if (tabs) tabs.innerHTML = DBT.map(([k, lab]) => `<button data-db="${k}" class="${k === t ? 'on' : ''}">${lab}</button>`).join('');
  const sum = `${c.runs.length} experiment${c.runs.length === 1 ? '' : 's'} · ` + { syn: 'recipe sent to the robot (11 parameters) + colour of the product', scat: `${dan ? 'DanMAX total scattering: F(Q) 0.5–15 Å⁻¹ and G(r) 0–30 Å' : 'CoSAXS SAXS: I(q) 0.008–0.5 Å⁻¹'} · blank + sample, 1 min each`, bo: 'who proposed each recipe, its loss and the optimiser\'s state' }[t];
  let head = '', rows = '';
  if (t === 'syn') {
    const ks = big ? PARAMS.map((_, k) => k) : ctrlIdx(c);
    head = `<th>#</th><th>by</th>${ks.map((k) => `<th>${PARAMS[k].name}${c.ctrl[k] ? '' : ' (fixed)'}</th>`).join('')}<th>product</th>`;
    rows = rs.map((r) => `<tr><td>${r.n}</td><td>${KIND[r.kind]}</td>${ks.map((k) => `<td>${PARAMS[k].unit === '%' ? r.x[k].toFixed(0) + ' %' : r.x[k].toFixed(2)}</td>`).join('')}<td><span class="sw" style="background:${rgb(productRGB(r.truth))}"></span></td></tr>`).join('');
  } else if (t === 'scat') {
    head = `<th>#</th><th>beamline</th><th>blank</th><th>sample</th><th>points</th><th>${dan ? 'F(Q)' : 'I(q)'}</th>${dan ? '<th>G(r)</th>' : ''}<th>loss</th>`;
    rows = rs.map((r) => `<tr><td>${r.n}</td><td>${dan ? 'DanMAX' : 'CoSAXS'}</td><td>1 min</td><td>1 min</td><td>${dan ? QG.length + ' + ' + RG.length : qG.length}</td><td>${spark(dan ? r.meas.F : r.meas.I, big ? 160 : 80)}</td>${dan ? `<td>${spark(r.meas.Gr, big ? 160 : 80)}</td>` : ''}<td>${r.loss.toExponential(1)}</td></tr>`).join('');
  } else {
    head = '<th>#</th><th>proposed by</th><th>loss</th><th>best so far</th><th>expected improvement</th><th>trust region</th>';
    rows = rs.map((r) => `<tr class="${r.newBest ? 'nb' : ''}"><td>${r.n}${r.newBest ? ' ★' : ''}</td><td>${KIND[r.kind]}</td><td>${r.loss.toExponential(1)}</td><td>${(r.best ?? r.loss).toExponential(1)}</td><td>${r.ei != null ? r.ei.toExponential(1) : '–'}</td><td>${r.trL != null ? r.trL.toFixed(2) : '–'}</td></tr>`).join('');
  }
  el.innerHTML = `<div class="sum">${sum}</div>` + (c.runs.length ? `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>` : '<div class="dim" style="margin:6px 2px">Empty – run an experiment.</div>');
}

// ---------- panels 3–6 ----------
function drawPatterns(c, cv = { F: $('slF'), G: $('slG'), I: $('slI') }) {
  const b = bestRun(c), last = c.runs[c.runs.length - 1]; const t = c.target;
  const leg = [['#ffffff', 'target'], ...(last ? [['#c9a8ff', `latest #${last.n}`]] : []), ...(b && b !== last ? [['#7dffb0', `best #${b.n}`]] : [])];
  const h = $('slDataH'); if (h) h.innerHTML = '3 · Data vs target' + (last ? ` <span style="font-weight:normal">loss <b style="color:#c9a8ff">${last.loss.toExponential(1)}</b>${b ? ` · best <b style="color:#7dffb0">${b.loss.toExponential(1)}</b>` : ''}</span>` : '');
  if (c.key === 'danmax') {
    const ser = (k, X) => [{ kind: 'line', x: X, y: t[k], color: '#ffffff', width: 2 }, ...(b && b !== last ? [{ kind: 'line', x: X, y: b.meas[k], color: '#7dffb0', width: 1.4 }] : []), ...(last ? [{ kind: 'line', x: X, y: last.meas[k], color: '#c9a8ff', width: 1.2, alpha: 0.85 }] : [])];
    plotXY(cv.F, { series: ser('F', QG), xlabel: 'Q (Å⁻¹)', ylabel: 'F(Q)', legend: leg });
    plotXY(cv.G, { series: ser('Gr', RG), xlabel: 'r (Å)', ylabel: 'G(r)' });
  } else {
    const ser = [{ kind: 'line', x: qG, y: t.I.map((v) => 10 ** v), color: '#ffffff', width: 2 }, ...(b && b !== last ? [{ kind: 'line', x: qG, y: b.meas.I.map((v) => 10 ** v), color: '#7dffb0', width: 1.4 }] : []), ...(last ? [{ kind: 'line', x: qG, y: last.meas.I.map((v) => 10 ** v), color: '#c9a8ff', width: 1.2, alpha: 0.85 }] : [])];
    plotXY(cv.I, { series: ser, xlog: true, ylog: true, ymin: 1e-4, ymax: 1.5, xlabel: 'q (Å⁻¹)', ylabel: 'I(q)', legend: leg });
  }
}
function drawLoss(c, cv = $('slLoss')) {
  const rs = c.runs; const kinds = [['rand', '#9aa7b4', 'random'], ['bo', '#c9a8ff', 'BO'], ['you', '#ffd166', 'yours']];
  const ser = kinds.map(([k, col]) => ({ kind: 'dots', size: 3, color: col, x: rs.filter((r) => r.kind === k).map((r) => r.n), y: rs.filter((r) => r.kind === k).map((r) => r.loss) }));
  let m = Infinity; const bx = [], by = []; for (const r of rs) { m = Math.min(m, r.loss); bx.push(r.n); by.push(m); }
  ser.push({ kind: 'line', x: bx, y: by, color: '#7dffb0', width: 1.8 });
  const n = Math.max(rs.length, nInit(c) + 6); ser.push({ kind: 'line', x: [0, n + 1], y: [c.good, c.good], color: '#ffcc33', width: 1, alpha: 0.7 });
  const ys = rs.map((r) => r.loss).concat([c.good]);
  plotXY(cv, { series: ser, ylog: true, xmin: 0, xmax: n + 1, ymin: Math.min(...ys) / 1.5, ymax: Math.max(...ys, c.good * 10) * 1.5, xlabel: 'experiment #', ylabel: 'loss', legend: [...kinds.map(([, col, t]) => [col, t]), ['#7dffb0', 'best so far'], ['#ffcc33', 'target reached below']] });
}
function drawImp(c, cv = $('slImp')) {
  const g = cv.getContext('2d'); const W = cv.width, H = cv.height; g.fillStyle = '#0a0d12'; g.fillRect(0, 0, W, H);
  const idx = ctrlIdx(c); const fs = Math.round(12 * Math.max(1, H / 250)); g.font = `${fs}px Arial`;
  if (!c.gp?.L) { g.fillStyle = '#8597aa'; g.fillText('Appears once BO starts.', 12, 24); return; }
  const rel = c.gp.relevance(); const mx = Math.max(...rel);
  const bh = Math.min(30 * H / 250, (H - 16) / idx.length), x0 = fs * 11;
  idx.forEach((k, j) => { const y = 8 + j * bh; g.fillStyle = '#b9c7d6'; g.fillText(PARAMS[k].name, 10, y + bh * 0.65); g.fillStyle = '#8a4fd8'; g.fillRect(x0, y + 3, (W - x0 - 15) * rel[j] / mx, bh - 6); });
}

// ---------------- 3D: the modular robot (MODEX-like) next to the sample stage ----------------
export function buildRobot(key, bl, { ds, ry }, openTab) {
  const P = bl.P; const Sb = B.main; const c0 = P(ds - 0.35, -1.35);
  const alu = mat('#c9ced3', { metalness: 0.6, roughness: 0.35 });
  Sb.box(mat('#d9dcdf'), c0.x, 0.42, c0.z, 0.62, 0.84, 1.25, ry);                        // bench
  for (const s of [-0.5, -0.17, 0.17, 0.5]) { const q = P(ds - 0.35 + s, -1.35); Sb.box(alu, q.x, 1.05, q.z, 0.5, 0.42, 0.02, ry); Sb.box(alu, q.x, 1.26, q.z, 0.5, 0.02, 0.3, ry); } // module frames
  for (const [s, l] of [[-0.48, -1.47], [-0.4, -1.27], [-0.32, -1.47], [-0.24, -1.27]]) { // syringe pumps
    const q = P(ds - 0.35 + s, l); Sb.box(mat('#f2f2f2'), q.x, 0.9, q.z, 0.12, 0.1, 0.07, ry);
    Sb.add(CYL, mat('#e8f6ff', { transparent: true, opacity: 0.6, roughness: 0.1 }), M(q.x, 1.0, q.z, 0, 0, 0, 0.018, 0.16, 0.018));
  }
  for (const s of [-0.05, 0.05]) { const q = P(ds - 0.35 + s, -1.5); Sb.box(mat('#2b2f35'), q.x, 0.92, q.z, 0.08, 0.12, 0.08, ry); Sb.add(CYL, mat('#c0392b'), M(q.x, 0.98, q.z, ry, Math.PI / 2, 0, 0.035, 0.09, 0.035)); }
  const mq = P(ds - 0.35 + 0.15, -1.3); Sb.add(CYL, mat('#e8f6ff', { transparent: true, opacity: 0.45, roughness: 0.05 }), M(mq.x, 0.94, mq.z, 0, 0, 0, 0.05, 0.12, 0.05)); // mixing vial
  const spat = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.008), mat('#ffffff')); spat.position.set(mq.x, 0.95, mq.z); G.scene.add(spat);
  const lq = P(ds - 0.35 + 0.42, -1.3); Sb.box(mat('#1c1f24'), lq.x, 0.97, lq.z, 0.16, 0.2, 0.16, ry);                 // LED module
  const led = new THREE.MeshBasicMaterial({ color: '#3a2c55', toneMapped: false });
  const win = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.1), led); const wq = P(ds - 0.35 + 0.42, -1.21); win.position.set(wq.x, 0.98, wq.z); win.rotation.y = ry + Math.PI / 2 * Math.sign(-1) + Math.PI; G.scene.add(win);
  const win2 = win.clone(); win2.rotation.y += Math.PI; G.scene.add(win2);
  // tubing from the robot to the flow cell at the sample position
  const a = P(ds - 0.35 + 0.42, -1.2), bpt = P(ds, -0.08); const len = Math.hypot(bpt.x - a.x, bpt.z - a.z);
  Sb.add(CYL, mat('#f5f0d8', { roughness: 0.4 }), M((a.x + bpt.x) / 2, 1.08, (a.z + bpt.z) / 2, Math.atan2(bpt.x - a.x, bpt.z - a.z), Math.PI / 2, 0, 0.006, len, 0.006));
  addBox(c0.x, c0.z, 1.25, 0.62, bl.t.x, bl.t.z, 0, 1.3);
  const sg = textPlane(['ScatterLab robot', `${PAPER.short}`], 1.25, 0.3, { bg: '#3a1f6b', font: 'bold 64px Arial', sub: 'bold 30px Arial' });
  const sq = P(ds - 0.35, -1.0); sg.position.set(sq.x, 1.55, sq.z); sg.rotation.y = Math.atan2(-bl.n.x, -bl.n.z) + Math.PI; G.scene.add(sg);
  const sg2 = sg.clone(); sg2.rotation.y += Math.PI; G.scene.add(sg2);
  R[key] = { spat, led, active: 0 };
  let t = 0;
  G.tickers.push((dt) => { const r = R[key]; t += dt; if (r.active) { r.spat.rotation.y += dt * 14; r.led.color.setHSL(0.75 + 0.05 * Math.sin(t * 9), 0.9, 0.55 + 0.25 * Math.sin(t * 13)); } else r.led.color.set('#3a2c55'); });
  const iq = P(ds - 0.35, -0.75);
  G.interact.push({ x: iq.x, z: iq.z, r: 0.9, label: 'Look at the synthesis robot', act: () => {
    G.ui.showPhoto(null, { name: '🤖 ScatterLab synthesis robot', color: '#c9a8ff', tech: 'Autonomous synthesis of gold nanoparticles',
      desc: 'Pumps dose the chemicals, a stirrer mixes them and white/UV LEDs turn the gold precursor into nanoparticles. The robot then pumps the sample into the beam for a 1 min measurement.<br><br>'
        + 'Run it from the <b>Autonomous synthesis</b> tab in the control cabin: set a target size and let Bayesian optimisation choose the next recipe after every measurement.'
        + `<br><br><button class="cxbtn" id="slOpenTab" style="max-width:340px">Open the Autonomous synthesis tab</button><br><span class="dim" style="font-size:12px">Idea from our paper: ${cite()}</span>` });
    const b = document.getElementById('slOpenTab'); if (b) b.onclick = () => openTab?.();
  } });
}

window.__SL = { S, synthesise, measure, lossOf, GP, st }; // debug/test hook
