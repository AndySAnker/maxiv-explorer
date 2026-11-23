// Minimal canvas plotter (lin/log axes, dots with error bars, lines, shaded ranges, markers).
const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
const sup = (n) => String(n).split('').map((c) => SUP[c] ?? c).join('');
function niceTicks(a, b, n = 6) {
  const span = b - a; if (!(span > 0)) return [a];
  const step0 = span / n; const p = 10 ** Math.floor(Math.log10(step0)); const m = step0 / p;
  const step = (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p; const out = [];
  for (let v = Math.ceil(a / step) * step; v <= b + 1e-9 * span; v += step) out.push(Math.abs(v) < step * 1e-6 ? 0 : +v.toPrecision(12));
  return out;
}
export function plotXY(cv, o) {
  const g = cv.getContext('2d'), W = cv.width, H = cv.height;
  const L = { l: 64, r: 14, t: 26, b: 40 };
  const all = []; for (const s of o.series) for (let i = 0; i < s.x.length; i++) { const x = s.x[i], y = s.y[i]; if (Number.isFinite(x) && Number.isFinite(y) && (!o.xlog || x > 0) && (!o.ylog || y > 0)) all.push([x, y]); }
  let [x0, x1] = [o.xmin, o.xmax], [y0, y1] = [o.ymin, o.ymax];
  if (x0 === undefined) x0 = Math.min(...all.map((p) => p[0])); if (x1 === undefined) x1 = Math.max(...all.map((p) => p[0]));
  const yIn = all.filter((p) => p[0] >= x0 && p[0] <= x1).map((p) => p[1]);
  if (y0 === undefined) y0 = yIn.length ? Math.min(...yIn) : 1; if (y1 === undefined) y1 = yIn.length ? Math.max(...yIn) : 10;
  if (o.ylog) { y0 = Math.max(y0, y1 * 1e-9); const f = Math.log10(y1 / y0) * 0.06 + 0.02; y0 /= 10 ** f; y1 *= 10 ** f; } else { const pad = (y1 - y0) * 0.06 || 1; y0 -= pad; y1 += pad; }
  if (!(x1 > x0)) x1 = x0 * 1.1 + 1e-6;
  const tx = (v) => (o.xlog ? Math.log10(v) : v), ty = (v) => (o.ylog ? Math.log10(Math.max(v, 1e-30)) : v);
  const X = (v) => L.l + (tx(v) - tx(x0)) / (tx(x1) - tx(x0)) * (W - L.l - L.r);
  const Y = (v) => H - L.b - (ty(v) - ty(y0)) / (ty(y1) - ty(y0)) * (H - L.t - L.b);
  g.fillStyle = '#0a0d12'; g.fillRect(0, 0, W, H);
  if (o.shade) { g.fillStyle = 'rgba(138,79,216,0.18)'; const a = Math.max(o.shade[0], x0), b = Math.min(o.shade[1], x1); if (b > a) g.fillRect(X(a), L.t, X(b) - X(a), H - L.t - L.b); }
  g.strokeStyle = '#26303c'; g.fillStyle = '#8597aa'; g.font = '11px Arial'; g.lineWidth = 1;
  const xt = o.xlog ? Array.from({ length: Math.floor(Math.log10(x1)) - Math.ceil(Math.log10(x0)) + 1 }, (_, i) => 10 ** (Math.ceil(Math.log10(x0)) + i)) : niceTicks(x0, x1);
  g.textAlign = 'center'; for (const v of xt) { const x = X(v); g.beginPath(); g.moveTo(x, L.t); g.lineTo(x, H - L.b); g.stroke(); g.fillText(o.xlog ? '10' + sup(Math.round(Math.log10(v))) : +v.toPrecision(4) + '', x, H - L.b + 14); }
  const yt = o.ylog ? Array.from({ length: Math.floor(Math.log10(y1)) - Math.ceil(Math.log10(y0)) + 1 }, (_, i) => 10 ** (Math.ceil(Math.log10(y0)) + i)) : niceTicks(y0, y1);
  g.textAlign = 'right'; for (const v of yt) { const y = Y(v); g.beginPath(); g.moveTo(L.l, y); g.lineTo(W - L.r, y); g.stroke(); g.fillText(o.ylog ? '10' + sup(Math.round(Math.log10(v))) : +v.toPrecision(4) + '', L.l - 5, y + 4); }
  g.textAlign = 'left';
  g.save(); g.beginPath(); g.rect(L.l, L.t, W - L.l - L.r, H - L.t - L.b); g.clip();
  for (const s of o.series) {
    g.globalAlpha = s.alpha ?? 1;
    if (s.kind === 'line') {
      g.strokeStyle = s.color; g.lineWidth = s.width || 1.8; g.beginPath(); let on = false;
      for (let i = 0; i < s.x.length; i++) { const x = s.x[i], y = s.y[i]; if (!Number.isFinite(y) || (o.ylog && y <= 0) || (o.xlog && x <= 0)) { on = false; continue; } on ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)); on = true; }
      g.stroke();
    } else {
      g.fillStyle = s.color; const r = s.size || 1.6;
      for (let i = 0; i < s.x.length; i++) {
        const x = s.x[i], y = s.y[i]; if (!Number.isFinite(y) || (o.ylog && y <= 0)) continue;
        g.fillRect(X(x) - r, Y(y) - r, 2 * r, 2 * r);
        if (s.err) { const e = s.err[i]; const ya = Y(Math.max(y - e, o.ylog ? y * 0.05 : y - e)), yb = Y(y + e); g.fillRect(X(x) - 0.5, yb, 1, ya - yb); }
      }
    }
  }
  g.globalAlpha = 1; g.restore();
  if (o.marks) { g.fillStyle = '#8fa0b2'; o.marks.forEach(([v, lab], k) => { if (v < x0 || v > x1) return; const x = X(v); g.fillRect(x, L.t, 1, 8); g.fillText(lab, x - 8, L.t - 4 - (k % 2) * 10 + 10); }); }
  g.fillStyle = o.xcolor || '#b9c7d6'; g.textAlign = 'center'; g.fillText(o.xlabel || '', (L.l + W - L.r) / 2, H - 6);
  g.save(); g.translate(13, (L.t + H - L.b) / 2); g.rotate(-Math.PI / 2); g.fillStyle = '#b9c7d6'; g.fillText(o.ylabel || '', 0, 0); g.restore(); g.textAlign = 'left';
  if (o.legend) { let y = L.t + 14; for (const [c, t] of o.legend) { g.fillStyle = c; g.fillRect(L.l + 8, y - 7, 10, 3); g.fillStyle = '#c9d6e3'; g.fillText(t, L.l + 24, y - 3); y += 14; } }
}
// weighted least squares for I = a*M + b (weights 1/I, as in the course app); returns {a,b,R}
export function autoScale(dq, dI, mFn, qlo, qhi) {
  let Sw = 0, SwM = 0, SwMM = 0, SwD = 0, SwMD = 0; const M = [], D = [], Wt = [];
  for (let i = 0; i < dq.length; i++) {
    const q = dq[i]; if (q < qlo || q > qhi) continue; const m = mFn(q); if (!Number.isFinite(m)) continue;
    const d = dI[i]; const w = 1 / Math.max(Math.abs(d), 1e-12); M.push(m); D.push(d); Wt.push(w);
    Sw += w; SwM += w * m; SwMM += w * m * m; SwD += w * d; SwMD += w * m * d;
  }
  const den = Sw * SwMM - SwM * SwM; const a = den ? (Sw * SwMD - SwM * SwD) / den : 0, b = den ? (SwMM * SwD - SwM * SwMD) / den : 0;
  let num = 0, dd = 0; for (let i = 0; i < M.length; i++) { const r = D[i] - (a * M[i] + b); num += Wt[i] * r * r; dd += Wt[i] * D[i] * D[i]; }
  return { a, b, R: dd > 0 ? Math.sqrt(num / dd) : NaN, n: M.length };
}
