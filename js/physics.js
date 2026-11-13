// 2.5D collision world: boxes, arcs (curved walls with door gaps) and circles, plus terrain height.
import { clamp, smooth, TAU, normAng, DEG } from './util.js';
import { R3, R1, LOOP, ROADS, PATHS, OFFICE, LINAC, PARKING, PLAZA, BIKE_RING_R, TRAM, ESS } from './data.js';

export const colliders = [];

export function addBox(cx, cz, len, wid, dirx, dirz, y0, y1, extra = {}) {
  const l = Math.hypot(dirx, dirz) || 1; const ux = dirx / l, uz = dirz / l;
  const c = Object.assign({ type: 'box', x: cx, z: cz, ux, uz, wx: -uz, wz: ux, hx: len / 2, hz: wid / 2, y0, y1, enabled: true }, extra);
  c.br = Math.hypot(c.hx, c.hz);
  colliders.push(c); return c;
}
// axis-aligned rectangle helper
export function addRect(x0, z0, x1, z1, y0, y1, extra) {
  return addBox((x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0, 1, 0, y0, y1, extra);
}
export function addCircle(x, z, r, y0, y1, extra = {}) {
  const c = Object.assign({ type: 'circle', x, z, r, y0, y1, enabled: true, br: r }, extra);
  colliders.push(c); return c;
}
// gaps: array of [centerDeg, widthMetres]
export function addArc(cx, cz, r, thick, gaps, y0, y1, extra = {}) {
  const g = gaps.map(([a, w]) => { const half = (w / 2) / r; return [normAng(a * DEG - half), 2 * half]; });
  const c = Object.assign({ type: 'arc', x: cx, z: cz, r, half: thick / 2, gaps: g, y0, y1, enabled: true }, extra);
  colliders.push(c);
  for (const [a0, span] of g) { // door jambs
    for (const a of [a0, a0 + span]) addCircle(cx + r * Math.cos(a), cz + r * Math.sin(a), thick / 2, y0, y1);
  }
  return c;
}

// ---- spatial hash: arcs are global, everything else is bucketed in 16 m cells ----
const CELL = 16; let grid = null; let globals = [];
const key = (i, j) => i * 100003 + j;
export function buildGrid() {
  grid = new Map(); globals = [];
  for (const c of colliders) {
    if (c.type === 'arc') { globals.push(c); continue; }
    const m = c.br + 2.5;
    const i0 = Math.floor((c.x - m) / CELL), i1 = Math.floor((c.x + m) / CELL), j0 = Math.floor((c.z - m) / CELL), j1 = Math.floor((c.z + m) / CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const k = key(i, j); let l = grid.get(k); if (!l) { l = []; grid.set(k, l); } l.push(c); }
  }
}
const EMPTY = [];
function cands(x, z) { return grid ? (grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL))) || EMPTY) : colliders; }
// Pushes point p {x,z} out of colliders. Returns true when something was hit (normal in lastNormal).
export const lastNormal = { x: 0, z: 0 };
export function collide(p, rad, y, h, skip) {
  let hit = false;
  for (let k = 0; k < 2; k++) {
    const list = cands(p.x, p.z); const ng = grid ? globals.length : 0; const tot = ng + list.length;
    for (let i = 0; i < tot; i++) {
      const c = i < ng ? globals[i] : list[i - ng];
      if (!c.enabled || c === skip || y >= c.y1 || y + h <= c.y0) continue;
      if (c.type === 'arc') {
        const dx = p.x - c.x, dz = p.z - c.z; const rho = Math.hypot(dx, dz);
        const pen = c.half + rad - Math.abs(rho - c.r);
        if (pen <= 0 || rho < 1e-6) continue;
        const phi = normAng(Math.atan2(dz, dx)); let inGap = false;
        for (const [a0, span] of c.gaps) if (normAng(phi - a0) < span) { inGap = true; break; }
        if (inGap) continue;
        const s = rho > c.r ? 1 : -1; const nx = dx / rho * s, nz = dz / rho * s;
        p.x += nx * pen; p.z += nz * pen; lastNormal.x = nx; lastNormal.z = nz; hit = true;
      } else {
        const dx = p.x - c.x, dz = p.z - c.z;
        if (dx * dx + dz * dz > (c.br + rad) * (c.br + rad)) continue;
        if (c.type === 'circle') {
          const d = Math.hypot(dx, dz); const pen = c.r + rad - d;
          if (pen > 0) { const nx = d > 1e-6 ? dx / d : 1, nz = d > 1e-6 ? dz / d : 0; p.x += nx * pen; p.z += nz * pen; lastNormal.x = nx; lastNormal.z = nz; hit = true; }
        } else {
          const lx = dx * c.ux + dz * c.uz, lz = dx * c.wx + dz * c.wz;
          const qx = clamp(lx, -c.hx, c.hx), qz = clamp(lz, -c.hz, c.hz);
          let ex = lx - qx, ez = lz - qz; const d = Math.hypot(ex, ez);
          let mx, mz, pen;
          if (d > 1e-6) { if (d >= rad) continue; mx = ex / d; mz = ez / d; pen = rad - d; }
          else { // inside: push along smallest penetration
            const px = c.hx - Math.abs(lx), pz = c.hz - Math.abs(lz);
            if (px < pz) { mx = Math.sign(lx) || 1; mz = 0; pen = px + rad; } else { mx = 0; mz = Math.sign(lz) || 1; pen = pz + rad; }
          }
          const nx = mx * c.ux + mz * c.wx, nz = mx * c.uz + mz * c.wz;
          p.x += nx * pen; p.z += nz * pen; lastNormal.x = nx; lastNormal.z = nz; hit = true;
        }
      }
    }
    if (!hit) break;
  }
  return hit;
}

// Is a point blocked (used for camera)?
export function blocked(x, z, y, rad) {
  const list = cands(x, z); const ng = grid ? globals.length : 0; const tot = ng + list.length;
  for (let i = 0; i < tot; i++) {
    const c = i < ng ? globals[i] : list[i - ng];
    if (!c.enabled || c.noCam || y > c.y1 + 0.25 || y < c.y0 - 0.25) continue;
    const dx = x - c.x, dz = z - c.z;
    if (c.type === 'arc') {
      const rho = Math.hypot(dx, dz); if (Math.abs(rho - c.r) > c.half + rad) continue;
      const phi = normAng(Math.atan2(dz, dx)); let inGap = false;
      for (const [a0, span] of c.gaps) if (normAng(phi - a0) < span) { inGap = true; break; }
      if (!inGap) return true;
    } else if (c.type === 'circle') { if (dx * dx + dz * dz < (c.r + rad) ** 2) return true; }
    else {
      if (dx * dx + dz * dz > (c.br + rad) ** 2) continue;
      const lx = dx * c.ux + dz * c.uz, lz = dx * c.wx + dz * c.wz;
      if (Math.abs(lx) < c.hx + rad && Math.abs(lz) < c.hz + rad) return true;
    }
  }
  return false;
}

// ---------------- Terrain ----------------
export function segDist(px, pz, x0, z0, x1, z1) {
  const vx = x1 - x0, vz = z1 - z0; const t = clamp(((px - x0) * vx + (pz - z0) * vz) / (vx * vx + vz * vz || 1), 0, 1);
  return Math.hypot(px - x0 - vx * t, pz - z0 - vz * t);
}
function rectDist(px, pz, r) {
  const dx = Math.max(r.x0 - px, 0, px - r.x1), dz = Math.max(r.z0 - pz, 0, pz - r.z1); return Math.hypot(dx, dz);
}
const FLAT_RECTS = [OFFICE, LINAC, PARKING, PLAZA, ESS, { x0: TRAM.x0, z0: TRAM.z - 9, x1: TRAM.x1, z1: TRAM.z + 4 }];
function flatMask(x, z) {
  let m = 1;
  for (let i = 0; i < LOOP.length; i++) {
    const a = LOOP[i], b = LOOP[(i + 1) % LOOP.length];
    const d = segDist(x, z, a[0], a[1], b[0], b[1]); if (d < 22) m = Math.min(m, smooth(6, 14, d));
  }
  for (const r of ROADS) { const d = segDist(x, z, r[0], r[1], r[2], r[3]); if (d < 22) m = Math.min(m, smooth(r[4] / 2 + 1, r[4] / 2 + 9, d)); }
  for (const r of PATHS) { const d = segDist(x, z, r[0], r[1], r[2], r[3]); if (d < 14) m = Math.min(m, smooth(r[4] / 2 + 0.6, r[4] / 2 + 6, d)); }
  for (const r of FLAT_RECTS) { const d = rectDist(x, z, r); if (d < 14) m = Math.min(m, smooth(2, 9, d)); }
  return m;
}
export function terrainH(x, z) {
  let h = 0;
  const r = Math.hypot(x - R3.cx, z - R3.cz);
  const band = smooth(127, 135, r) * (1 - smooth(215, 245, r));
  if (band > 0) {
    const a = Math.atan2(z, x);
    h += band * (1.45 + 1.45 * Math.cos((r - 127) * 0.45 + 0.9 * Math.sin(a * 3) + 0.4 * Math.sin(a * 7)));
  }
  const r1 = Math.hypot(x - R1.cx, z - R1.cz);
  const b1 = smooth(44, 50, r1) * (1 - smooth(78, 92, r1));
  if (b1 > 0) h += b1 * (0.85 + 0.85 * Math.cos((r1 - 44) * 0.5));
  // bike path ring around R3 stays flat
  const dRing = Math.abs(r - BIKE_RING_R); if (dRing < 8) h *= smooth(2, 7, dRing);
  // very gentle rolling fields far away
  const far = smooth(300, 420, Math.hypot(x, z));
  if (far > 0) h += far * (1.2 * Math.sin(x * 0.006) * Math.cos(z * 0.005) + 1.2);
  if (h > 0.001) h *= flatMask(x, z);
  return h;
}

// Walkable bridges over the storage ring tunnel
export const bridges = [];
for (const a of R3.bridges) {
  const ar = a * DEG;
  bridges.push({ cx: R3.cx, cz: R3.cz, dx: Math.cos(ar), dz: Math.sin(ar), s0: 66, s1: 74, s2: 94, s3: 102, w: 1.6, top: 4.6 });
}
export function bridgeH(x, z) {
  let h = -1;
  for (const b of bridges) {
    const dx = x - b.cx, dz = z - b.cz; const s = dx * b.dx + dz * b.dz; const l = -dx * b.dz + dz * b.dx;
    if (Math.abs(l) < b.w && s > b.s0 && s < b.s3) {
      const bh = s < b.s1 ? b.top * (s - b.s0) / (b.s1 - b.s0) : s < b.s2 ? b.top : b.top * (b.s3 - s) / (b.s3 - b.s2);
      h = Math.max(h, bh);
    }
  }
  return h;
}
export function groundY(x, z) {
  const t = terrainH(x, z); const b = bridgeH(x, z); return b > t ? b : t;
}
