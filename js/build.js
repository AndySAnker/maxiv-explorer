// Geometry helpers: static batching, revolved (curved) walls, boxes with colliders.
import * as THREE from 'three';
import { mergeGeometries } from '../vendor/addons/utils/BufferGeometryUtils.js';
import { DEG, normAng } from './util.js';
import { addBox } from './physics.js';
import { G } from './state.js';

export const BOX = new THREE.BoxGeometry(1, 1, 1);
export const CYL = new THREE.CylinderGeometry(1, 1, 1, 14);
export const CYL6 = new THREE.CylinderGeometry(1, 1, 1, 6);
export const SPH = new THREE.SphereGeometry(1, 12, 8);

const _o = new THREE.Object3D();
export function M(x, y, z, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _o.position.set(x, y, z); _o.rotation.set(rx, ry, rz, 'YXZ'); _o.scale.set(sx, sy, sz); _o.updateMatrix();
  return _o.matrix.clone();
}

export class Batcher {
  constructor(parent, shadow = true) { this.parent = parent; this.map = new Map(); this.shadow = shadow; }
  add(geom, material, matrix) {
    let g = geom.index ? geom.toNonIndexed() : geom.clone();
    g.applyMatrix4(matrix);
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.clearGroups();
    let e = this.map.get(material); if (!e) { e = []; this.map.set(material, e); } e.push(g);
  }
  box(material, x, y, z, sx, sy, sz, ry = 0) { this.add(BOX, material, M(x, y, z, ry, 0, 0, sx, sy, sz)); }
  finish() {
    for (const [m, list] of this.map) {
      const mesh = new THREE.Mesh(mergeGeometries(list, false), m);
      mesh.castShadow = this.shadow && !m.transparent; mesh.receiveShadow = !m.transparent;
      this.parent.add(mesh);
    }
    this.map.clear();
  }
}

// Static batcher for the whole world + one batcher per hideable group
export const B = { main: null, groups: {} };
export function initBatchers(scene) { B.main = new Batcher(scene); }
export function HB(name) {
  if (!B.groups[name]) {
    const grp = new THREE.Group(); grp.name = name; G.scene.add(grp); G.hide[name] = grp;
    B.groups[name] = new Batcher(grp);
  }
  return B.groups[name];
}
export function finishBatchers() { B.main.finish(); for (const k in B.groups) B.groups[k].finish(); }

// Revolve a 2D profile [[r,y],...] around (cx,cz) between angles a0..a1 (degrees)
export function revolveGeom(profile, a0, a1, cx = 0, cz = 0, segPerDeg = 1, uScale = 8) {
  const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) * segPerDeg));
  const P = profile.length; const pos = [], uv = [], idx = [];
  // cumulative profile length for v
  const vl = [0]; for (let i = 1; i < P; i++) vl.push(vl[i - 1] + Math.hypot(profile[i][0] - profile[i - 1][0], profile[i][1] - profile[i - 1][1]));
  for (let j = 0; j <= n; j++) {
    const a = (a0 + (a1 - a0) * j / n) * DEG; const c = Math.cos(a), s = Math.sin(a);
    for (let i = 0; i < P; i++) {
      const [r, y] = profile[i];
      pos.push(cx + r * c, y, cz + r * s);
      uv.push(a * r / uScale, vl[i] / uScale);
    }
  }
  for (let j = 0; j < n; j++) for (let i = 0; i < P - 1; i++) {
    const a = j * P + i, b = (j + 1) * P + i, c = (j + 1) * P + i + 1, d = j * P + i + 1;
    idx.push(a, d, b, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
// angular intervals (deg) that remain after cutting gaps [{a,w}] at radius r
export function gapIntervals(gaps, r) {
  if (!gaps.length) return [[0, 360]];
  const gs = gaps.map(({ a, w }) => { const h = (w / 2) / r / DEG; return [normAng((a - h) * DEG) / DEG, 2 * h]; }).sort((p, q) => p[0] - q[0]);
  const out = [];
  for (let i = 0; i < gs.length; i++) {
    const start = gs[i][0] + gs[i][1]; const next = i + 1 < gs.length ? gs[i + 1][0] : gs[0][0] + 360;
    out.push([start, next]);
  }
  return out;
}
export function revolveGaps(batch, material, profile, gaps, refR, cx, cz, segPerDeg = 1, uScale = 8) {
  for (const [a0, a1] of gapIntervals(gaps, refR)) batch.add(revolveGeom(profile, a0, a1, cx, cz, segPerDeg, uScale), material, new THREE.Matrix4());
}
// thick curved wall profile
export function wallProfile(r, t, h, y0 = 0) {
  const a = r - t / 2, b = r + t / 2;
  return [[a, y0], [a, h], [a, h], [b, h], [b, h], [b, y0]];
}

// Oriented wall segment along direction (dx,dz) of length len, centred at (cx,cz); with collider
export function wallSeg(batch, material, cx, cz, len, thick, h, dx, dz, y0 = 0, collide = true) {
  const ry = Math.atan2(dx, dz);
  batch.box(material, cx, y0 + (h - y0) / 2, cz, thick, h - y0, len, ry);
  if (collide) return addBox(cx, cz, len, thick, dx, dz, y0, h);
}
// Axis-aligned wall from (x0,z0) to (x1,z1) (must be horizontal or vertical) with door gaps [{at, w}] (at = distance from start)
export function wallLine(batch, material, x0, z0, x1, z1, thick, h, doors = [], lintel = true) {
  const len = Math.hypot(x1 - x0, z1 - z0); const dx = (x1 - x0) / len, dz = (z1 - z0) / len;
  const ds = doors.slice().sort((p, q) => p.at - q.at); let s = 0;
  const seg = (a, b, y0 = 0, hh = h, col = true) => { if (b - a < 0.01) return; const m = (a + b) / 2; wallSeg(batch, material, x0 + dx * m, z0 + dz * m, b - a, thick, hh, dx, dz, y0, col); };
  for (const d of ds) {
    seg(s, d.at - d.w / 2);
    if (lintel && h > 3.2) seg(d.at - d.w / 2, d.at + d.w / 2, d.h || 3, h, false);
    s = d.at + d.w / 2;
  }
  seg(s, len);
}
