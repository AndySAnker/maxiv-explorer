// Terrain, roads, office, linac, tram, scenery, navigation graph and collectibles.
import * as THREE from 'three';
import { mergeGeometries } from '../vendor/addons/utils/BufferGeometryUtils.js';
import { DEG, TAU, mat, canvasTex, noiseTex, textPlane, rand, seeded, smooth, clamp } from './util.js';
import { addBox, addRect, addCircle, addArc, terrainH, groundY, segDist, bridges } from './physics.js';
import { G } from './state.js';
import { R3, R1, LOOP, ROADS, PATHS, OFFICE, LINAC, PARKING, PLAZA, TRAM, ESS, BIKE_RING_R, BEAMLINES3, BEAMLINES1 } from './data.js';
import { B, HB, M, BOX, CYL, SPH, revolveGeom, wallSeg, wallLine } from './build.js';
import { buildPingPong } from './pingpong.js';
import { buildExhibit } from './exhibit.js';
import { buildFoodTruck } from './foodtruck.js';
import { W, MAT, initMaterials, buildRing, ringBeamline, buildBeamline, registerSources, photoBoard, makeSlideDoor } from './world.js';

export { W };

export async function buildSite(scene, tick = async () => {}) {
  const T = {}; let t = performance.now();
  const step = async (p, label, fn) => { await tick(p, label); const a = performance.now(); fn(); T[label] = Math.round(performance.now() - a); };
  await step(0.02, 'Mixing the sky…', () => { initMaterials(); sky(scene); });
  await step(0.06, 'Shaping the vibration-damping landscape…', () => terrain(scene));
  await step(0.30, 'Paving Fotongatan…', () => roads());
  await step(0.36, 'Building the 3 GeV ring (528 m)…', () => { registerSources(); buildRing(R3, '3', true); });
  await step(0.44, 'Building the 1.5 GeV ring…', () => buildRing(R1, '1', false));
  await step(0.50, 'Installing beamlines…', () => { for (const b of BEAMLINES3) ringBeamline(R3, b, '3'); for (const b of BEAMLINES1) ringBeamline(R1, b, '1'); r3Extras(); buildExhibit(); });
  await step(0.58, 'Opening the office and the café…', () => { office(); buildPingPong(); buildFoodTruck(); });
  await step(0.62, 'Laying 300 m of linac…', () => { linac(); tram(); });
  await step(0.68, 'Planting trees in Skåne…', () => scenery());
  await step(0.76, 'Hanging up photos…', () => { zones(); boards(); photons(); nav(); });
  console.log('[build] stage ms', T, 'total', Math.round(performance.now() - t));
}

// ---------------- Sky ----------------
function sky(scene) {
  const g = new THREE.SphereGeometry(4000, 32, 16);
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color('#2f6fc4') }, hor: { value: new THREE.Color('#d4e6f4') } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 hor; varying vec3 vP; void main(){ float h = max(vP.y,0.0); gl_FragColor = vec4(mix(hor, top, pow(h,0.55)),1.0); \n#include <colorspace_fragment>\n }',
  });
  const s = new THREE.Mesh(g, m); s.renderOrder = -1; s.frustumCulled = false; scene.add(s); G.skyMesh = s;
  // clouds
  const ct = canvasTex(256, 128, (c, w, h) => {
    for (let i = 0; i < 18; i++) { const x = rand(50, w - 50), y = rand(40, h - 30), r = rand(18, 40); const gr = c.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = gr; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill(); }
  });
  const cm = new THREE.SpriteMaterial({ map: ct, transparent: true, depthWrite: false, fog: false, opacity: 0.9 });
  for (let i = 0; i < 30; i++) { const sp = new THREE.Sprite(cm); const a = rand(0, TAU), r = rand(300, 1800); sp.position.set(Math.cos(a) * r, rand(180, 320), Math.sin(a) * r); const sc = rand(180, 380); sp.scale.set(sc, sc * 0.45, 1); scene.add(sp); }
}

// ---------------- Terrain ----------------
function terrain(scene) {
  const fieldCols = ['#d8c437', '#c7b26a', '#6f9a3e', '#5b8636', '#8d7150', '#b8a65a', '#7aa447'].map((c) => new THREE.Color(c));
  const lawn = new THREE.Color('#5f8f3a'), lawn2 = new THREE.Color('#7aa64a'), col = new THREE.Color();
  const dryLow = new THREE.Color('#6d8540'), dryTop = new THREE.Color('#b5a964');
  const colorAt = (x, z, h) => {
    const r = Math.hypot(x + 20, z);
    if (r > 330) {
      const ca = 0.35; const u = x * Math.cos(ca) - z * Math.sin(ca), v = x * Math.sin(ca) + z * Math.cos(ca);
      const ci = Math.floor(u / 110), cj = Math.floor(v / 75); const hsh = Math.abs(Math.sin(ci * 12.9898 + cj * 78.233) * 43758.5453) % 1;
      col.copy(fieldCols[Math.floor(hsh * fieldCols.length)]);
      // furrows
      const f = 0.93 + 0.07 * Math.sin(u * 1.2); col.multiplyScalar(f);
      const blend = smooth(330, 380, r); col.lerp(lawn, 1 - blend);
    } else if (h > 0.05) { // the wave landscape: tall, dry, golden-green grass (see the Infomastern photos)
      const t = clamp(h / 2.6, 0, 1); col.copy(dryLow).lerp(dryTop, t * 0.85 + Math.random() * 0.15);
    } else { col.copy(lawn).lerp(lawn2, Math.random() * 0.3); }
    return col;
  };
  const NX0 = -820, NX1 = 700, NZ0 = -360, NZ1 = 320;
  const mk = (w, d, sx, sz, cx, cz, lowerInside) => {
    const g = new THREE.PlaneGeometry(w, d, sx, sz); g.rotateX(-Math.PI / 2); g.translate(cx, 0, cz);
    const p = g.attributes.position; const cols = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i); let h = terrainH(x, z);
      if (lowerInside && x > NX0 + 3 && x < NX1 - 3 && z > NZ0 + 3 && z < NZ1 - 3) h -= 0.8;
      p.setY(i, h); const c = colorAt(x, z, h); cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3)); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, map: grassDetail }));
    m.receiveShadow = true; scene.add(m); return m;
  };
  mk(NX1 - NX0, NZ1 - NZ0, 608, 272, (NX0 + NX1) / 2, (NZ0 + NZ1) / 2, false);
  mk(4400, 4400, 220, 220, 0, 0, true);
  grassTufts(scene);
}

// fine grass detail multiplied over the vertex colours
const grassDetail = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#d8d8d8'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 5000; i++) { const v = 170 + Math.random() * 85 | 0; g.strokeStyle = `rgb(${v},${v},${v * 0.92 | 0})`; const x = Math.random() * w, y = Math.random() * h; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (Math.random() - 0.5) * 3, y - 2 - Math.random() * 5); g.stroke(); }
}, [900, 900]);
// tall grass tufts on the waves
function grassTufts(scene) {
  const tex = canvasTex(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) {
      const x = 10 + Math.random() * (w - 20), lean = (Math.random() - 0.5) * 30, top = 8 + Math.random() * 50;
      const v = Math.random(); g.strokeStyle = v < 0.5 ? '#c9bd7a' : v < 0.8 ? '#a6a95f' : '#7f9450'; g.lineWidth = 1.5 + Math.random() * 1.5;
      g.beginPath(); g.moveTo(x, h); g.quadraticCurveTo(x + lean * 0.3, (h + top) / 2, x + lean, top); g.stroke();
    }
  });
  const geos = []; for (let k = 0; k < 3; k++) { const p = new THREE.PlaneGeometry(1.4, 0.95); p.translate(0, 0.47, 0); p.rotateY(k * Math.PI / 3); geos.push(p); }
  const geo = mergeGeometries(geos);
  const N = 16000; const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 1 }), N);
  const c = new THREE.Color(); const rnd = seeded(7); let n = 0;
  for (let tries = 0; tries < N * 6 && n < N; tries++) {
    const r1 = rnd() < 0.82; const cx = r1 ? 0 : R1.cx, cz = r1 ? 0 : R1.cz;
    const a = rnd() * TAU, r = r1 ? 128 + rnd() * 112 : 46 + rnd() * 40;
    const x = cx + r * Math.cos(a), z = cz + r * Math.sin(a); const y = terrainH(x, z);
    if (y < 0.35) continue;
    const s = 0.5 + rnd() * 0.6;
    im.setMatrixAt(n, M(x, y - 0.05, z, rnd() * TAU, 0, 0, s, s * (0.8 + rnd() * 0.6), s));
    im.setColorAt(n, c.setHSL(0.14 + rnd() * 0.06, 0.4, 0.66 + rnd() * 0.16)); n++;
  }
  im.count = n; scene.add(im);
}

// ---------------- Roads ----------------
const asphaltTex = canvasTex(64, 256, (g, w, h) => {
  g.fillStyle = '#4a4d51'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 400; i++) { g.fillStyle = Math.random() < 0.5 ? '#55585c' : '#3f4246'; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
  g.fillStyle = '#f2f2f2'; g.fillRect(w / 2 - 1.5, 0, 3, h * 0.5);
  g.fillStyle = '#e8e8e8'; g.fillRect(1, 0, 2, h); g.fillRect(w - 3, 0, 2, h);
}); asphaltTex.wrapT = THREE.RepeatWrapping;
function ribbon(pts, width, closed, y, material, vScale = 10) {
  const pos = [], uv = [], idx = []; const n = pts.length; let L = 0;
  const N = closed ? n + 1 : n;
  for (let k = 0; k < N; k++) {
    const i = k % n; const p = pts[i];
    const a = pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)], b = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0], tz = b[1] - a[1]; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    if (k > 0) { const q = pts[(k - 1) % n]; L += Math.hypot(p[0] - q[0], p[1] - q[1]); }
    const nx = -tz, nz = tx;
    pos.push(p[0] + nx * width / 2, y, p[1] + nz * width / 2, p[0] - nx * width / 2, y, p[1] - nz * width / 2);
    uv.push(0, L / vScale, 1, L / vScale);
    if (k > 0) { const o = (k - 1) * 2; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, material); m.receiveShadow = true; G.scene.add(m); return m;
}
function roads() {
  const road = new THREE.MeshStandardMaterial({ map: asphaltTex, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const road2 = road.clone(); road2.polygonOffsetFactor = -3; road2.polygonOffsetUnits = -3;
  const pathM = new THREE.MeshStandardMaterial({ map: noiseTex('#b7b0a2', 14, 64, [1, 1]), roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  ribbon(LOOP, 10, true, 0.05, road);
  for (const r of ROADS) ribbon([[r[0], r[1]], [r[2], r[3]]], r[4], false, 0.06, road2);
  for (const r of PATHS) ribbon([[r[0], r[1]], [r[2], r[3]]], r[4], false, 0.06, pathM);
  // bike ring around the 3 GeV building
  const bikeM = new THREE.MeshStandardMaterial({ color: '#9a6a5c', roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const br = new THREE.Mesh(revolveGeom([[BIKE_RING_R - 1.6, 0.05], [BIKE_RING_R + 1.6, 0.05]], 0, 360, 0, 0, 1), bikeM); br.receiveShadow = true; G.scene.add(br);
  // parking
  const pk = canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = '#505357'; g.fillRect(0, 0, w, h); g.strokeStyle = '#e9e9e9'; g.lineWidth = 3;
    for (const row of [0.12, 0.45, 0.78]) for (let x = 0; x < w; x += 18) { g.beginPath(); g.moveTo(x, h * row); g.lineTo(x, h * row + h * 0.14); g.stroke(); }
  });
  const pm = new THREE.Mesh(new THREE.PlaneGeometry(PARKING.x1 - PARKING.x0, PARKING.z1 - PARKING.z0), new THREE.MeshStandardMaterial({ map: pk, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  pm.rotation.x = -Math.PI / 2; pm.position.set((PARKING.x0 + PARKING.x1) / 2, 0.04, (PARKING.z0 + PARKING.z1) / 2); pm.receiveShadow = true; G.scene.add(pm);
  const pl = new THREE.Mesh(new THREE.PlaneGeometry(PLAZA.x1 - PLAZA.x0, PLAZA.z1 - PLAZA.z0), new THREE.MeshStandardMaterial({ map: noiseTex('#cfcac0', 10, 128, [12, 3], (g, w) => { g.strokeStyle = '#b9b3a8'; for (let i = 0; i < w; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, w); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(w, i); g.stroke(); } }), roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  pl.rotation.x = -Math.PI / 2; pl.position.set((PLAZA.x0 + PLAZA.x1) / 2, 0.045, (PLAZA.z0 + PLAZA.z1) / 2); pl.receiveShadow = true; G.scene.add(pl);
  // street name signs
  for (const [x, z, t] of [[100, 143, 'Fotongatan'], [-120, 143, 'Fotongatan'], [300, 143, 'Fotongatan → ESS'], [-300, 143, '← Lund C']]) {
    const s = textPlane([t], 3.2, 0.6, { bg: '#1d4f9c', font: 'bold 80px Arial' }); s.position.set(x, 2.6, z); s.rotation.y = Math.PI; G.scene.add(s);
    const s2 = s.clone(); s2.rotation.y = 0; s2.position.z += 0.02; G.scene.add(s2);
    B.main.box(MAT.grey, x, 1.3, z - 0.05, 0.08, 2.6, 0.08); addCircle(x, z, 0.15, 0, 3);
  }
}

// ---------------- 3 GeV extras: bridges, racks, courtyard ----------------
function r3Extras() {
  const S = B.main;
  // bridges over the tunnel
  for (const b of bridges) {
    const ry = Math.atan2(b.dx, b.dz);
    const P = (s, l) => ({ x: b.cx + b.dx * s - b.dz * l, z: b.cz + b.dz * s + b.dx * l });
    const ramp = (sa, sb, ya, yb) => {
      const L = Math.hypot(sb - sa, yb - ya); const pitch = -Math.atan2(yb - ya, sb - sa); const c = P((sa + sb) / 2, 0);
      S.add(BOX, mat('#7d8a96'), M(c.x, (ya + yb) / 2 - 0.15, c.z, ry, pitch, 0, b.w * 2, 0.3, L));
      for (const l of [-1, 1]) { const q = P((sa + sb) / 2, l * (b.w + 0.1)); S.add(BOX, MAT.steel, M(q.x, (ya + yb) / 2 + 0.55, q.z, ry, pitch, 0, 0.08, 1.1, L)); }
    };
    ramp(b.s0, b.s1, 0, b.top); ramp(b.s1, b.s2, b.top, b.top); ramp(b.s2, b.s3, b.top, 0);
    for (const l of [-1, 1]) { const q = P((b.s0 + b.s3) / 2, l * (b.w + 0.15)); addBox(q.x, q.z, b.s3 - b.s0, 0.3, b.dx, b.dz, 0, 6); }
    // supports under the ramps
    for (const s of [b.s0 + 4, b.s3 - 4]) { const q = P(s, 0); S.box(MAT.grey, q.x, 1.1, q.z, 2.8, 2.2, 0.4, ry); }
  }
  // electronics racks along the inner side of the tunnel
  const racks = []; const ex = [[90, 7], [270, 7], [180, 7]];
  const r = R3.rackR;
  for (let a = 0; a < 360; a += 1.0) {
    if (ex.some(([c, w]) => Math.abs(((a - c + 540) % 360) - 180) < w)) continue;
    const ar = a * DEG; racks.push(M(r * Math.cos(ar), 1.1, r * Math.sin(ar), Math.atan2(-Math.sin(ar), Math.cos(ar)), 0, 0, 0.95, 2.2, 1.2));
  }
  const rt = canvasTex(64, 128, (g, w, h) => { g.fillStyle = '#26303b'; g.fillRect(0, 0, w, h); for (let i = 0; i < 40; i++) { g.fillStyle = ['#3cff6a', '#ffb02e', '#2ec7ff'][i % 3]; g.fillRect(6 + (i % 6) * 9, 10 + Math.floor(i / 6) * 16, 3, 3); } g.strokeStyle = '#4b5866'; g.strokeRect(2, 2, w - 4, h - 4); });
  const im = new THREE.InstancedMesh(BOX, new THREE.MeshStandardMaterial({ map: rt, roughness: 0.6 }), racks.length);
  racks.forEach((m, i) => im.setMatrixAt(i, m)); im.castShadow = true; im.receiveShadow = true; G.scene.add(im);
  addArc(0, 0, R3.rackR, 1.0, [[90, 18], [270, 18], [180, 18]], 0, 2.2);
  // courtyard: grass with the spiralling path garden (see the 2016 aerial photo)
  const ct = canvasTex(1024, 1024, (g, w) => {
    g.fillStyle = '#6a9a40'; g.fillRect(0, 0, w, w); const c = w / 2;
    for (let i = 0; i < 3000; i++) { g.fillStyle = Math.random() < 0.5 ? '#5f8f3a' : '#77a84b'; g.fillRect(Math.random() * w, Math.random() * w, 4, 4); }
    g.strokeStyle = '#d8cfb8'; g.lineWidth = 10; g.lineCap = 'round';
    for (let k = 1; k < 9; k++) { const rr = k * 56; const gap = (k * 0.9) % TAU; g.beginPath(); g.arc(c, c, rr, gap + 0.25, gap + TAU - 0.25); g.stroke(); }
    g.lineWidth = 14; g.beginPath(); g.moveTo(c, 0); g.lineTo(c, w); g.stroke();
  });
  const cy = new THREE.Mesh(new THREE.CircleGeometry(R3.inner - 0.2, 96), new THREE.MeshStandardMaterial({ map: ct, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  cy.rotation.x = -Math.PI / 2; cy.rotation.z = Math.PI / 2; cy.position.y = 0.05; cy.receiveShadow = true; G.scene.add(cy);
  for (let i = 0; i < 6; i++) { const a = i * TAU / 6 + 0.3; const x = 22 * Math.cos(a), z = 22 * Math.sin(a); S.box(MAT.wood, x, 0.45, z, 2.0, 0.1, 0.6, a); S.box(MAT.dark, x, 0.22, z, 1.8, 0.44, 0.1, a); addCircle(x, z, 0.8, 0, 0.6); }
}

// ---------------- Office ----------------
function office() {
  const O = OFFICE, S = B.main, up = HB('office');
  const h = O.h, T = 0.4;
  // ground-floor walls
  wallLine(S, MAT.glass, O.x0, O.z1, O.x1, O.z1, T, h, [{ at: 28, w: 6 }]);            // south, glass, main entrance
  wallLine(S, MAT.white, O.x0, O.z0, O.x1, O.z0, T, h);                                 // north
  wallLine(S, MAT.white, O.x0, O.z0, O.x0, O.z1, T, h, [{ at: 36, w: 5 }]);             // west, to the ring
  wallLine(S, MAT.white, O.x1, O.z0, O.x1, O.z1, T, h);                                 // east
  for (let x = O.x0 + 5; x < O.x1; x += 5) if (Math.abs(x - 150) > 4) S.box(MAT.dark, x, h / 2, O.z1, 0.15, h, 0.5);
  makeSlideDoor({ x: 150, z: O.z1, ax: 1, az: 0, w: 6, h: 3.2, thick: 0.1, material: MAT.glass, split: true, kind: 'office' });
  // connector corridor to the ring hall
  const cxs = Math.sqrt(R3.outer ** 2 - 9) - 0.4;
  wallLine(S, MAT.white, cxs, -3, O.x0, -3, 0.3, 4.2); wallLine(S, MAT.white, cxs, 3, O.x0, 3, 0.3, 4.2);
  up.box(MAT.white, (cxs + O.x0) / 2, 4.3, 0, O.x0 - cxs, 0.2, 6.6);
  S.box(mat('#a49d90'), (O.x0 + O.x1) / 2, 0.06, (O.z0 + O.z1) / 2, O.x1 - O.x0, 0.06, O.z1 - O.z0);
  S.box(mat('#d6d0c4'), (cxs + O.x0) / 2, 0.06, 0, O.x0 - cxs, 0.06, 6);
  // upper floors (hidden when you are inside)
  const bands = canvasTex(256, 256, (g, w, hh) => { g.fillStyle = '#f3f4f5'; g.fillRect(0, 0, w, hh); for (let k = 0; k < 3; k++) { g.fillStyle = '#26333f'; g.fillRect(0, hh * (k / 3 + 0.08), w, hh * 0.13); g.fillStyle = '#5d7a90'; g.fillRect(0, hh * (k / 3 + 0.1), w, hh * 0.02); } });
  const bandM = new THREE.MeshStandardMaterial({ map: bands, roughness: 0.6 });
  up.box(bandM, (O.x0 + O.x1) / 2, h + 7.5, (O.z0 + O.z1) / 2, O.x1 - O.x0, 15, O.z1 - O.z0);
  up.box(bandM, 142, 23.5, -9, 68, 7, 42);
  up.box(MAT.white, 142, 27.1, -9, 68.4, 0.2, 42.4);
  const logo = textPlane(['MAX IV'], 16, 3.6, { bg: null, fg: '#1b2733', font: 'bold 200px Arial' });
  logo.position.set(150, 23.5, 12.05); up.parent.add(logo);
  // reception desk
  S.box(MAT.white, 150, 0.55, 14, 7, 1.1, 1.2); S.box(MAT.wood, 150, 1.12, 14, 7.2, 0.06, 1.4); addRect(146.5, 13.4, 153.5, 14.6, 0, 1.2);
  sign('RECEPTION', 150, 3.6, 14, 0, '#16324f');
  W.reception = { x: 150, z: 16.3 };
  // café
  S.box(MAT.wood, 172, 0.55, 12, 7, 1.1, 1.2); addRect(168.5, 11.4, 175.5, 12.6, 0, 1.2);
  S.box(MAT.dark, 170, 1.45, 11.9, 0.6, 0.7, 0.5); S.box(MAT.steel, 174, 1.35, 11.9, 0.5, 0.5, 0.5);
  sign('CAFÉ · FIKA', 172, 3.6, 12, 0, '#7a3e12');
  W.cafe = { x: 172, z: 14.3 };
  for (const [x, z] of [[166, 19], [172, 21], [178, 18], [178, 0], [170, 2]]) { S.add(CYL, MAT.white, M(x, 0.74, z, 0, 0, 0, 0.6, 0.05, 0.6)); S.add(CYL, MAT.dark, M(x, 0.37, z, 0, 0, 0, 0.06, 0.74, 0.06)); addCircle(x, z, 0.6, 0, 1); }
  // control room
  for (const z of [-26, -30]) {
    S.box(MAT.white, 136, 0.37, z, 18, 0.74, 1.2); addRect(127, z - 0.6, 145, z + 0.6, 0, 1);
    for (let x = 128; x <= 144; x += 1.2) { const s = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.55), MAT.screen); s.position.set(x, 1.1, z - 0.35); G.scene.add(s); }
  }
  const big = new THREE.Mesh(new THREE.PlaneGeometry(18, 3), new THREE.MeshBasicMaterial({ map: controlScreenTex(), toneMapped: false }));
  big.position.set(136, 2.6, O.z0 + 0.25); G.scene.add(big);
  sign('CONTROL ROOM', 136, 4.5, O.z0 + 0.3, 0, '#0d3a26', true);
  W.controlRoom = { x: 136, z: -22.5 };
  W.jobBoard = { x: 138, z: 21.5 };
  S.box(MAT.dark, 138, 1.4, 20.4, 3.0, 2.0, 0.1); const jb = textPlane(['JOB BOARD', 'Beamline courier jobs', 'Press E'], 2.8, 1.8, { bg: '#2b3b4f', font: 'bold 70px Arial', sub: 'bold 40px Arial' }); jb.position.set(138, 1.4, 20.47); G.scene.add(jb);
  addRect(136.4, 20.2, 139.6, 20.6, 0, 2.5);
  for (const [x, z] of [[135, -6], [165, -6], [150, -12]]) { S.add(CYL, MAT.white, M(x, h / 2, z, 0, 0, 0, 0.35, h, 0.35)); addCircle(x, z, 0.4, 0, h); }
  // plaza: flags and sign
  for (const [x, f] of [[128, 'se'], [132, 'max'], [136, 'lu']]) {
    S.add(CYL, MAT.white, M(x, 5, 38, 0, 0, 0, 0.06, 10, 0.06)); addCircle(x, 38, 0.15, 0, 10);
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.5), new THREE.MeshStandardMaterial({ map: flagTex(f), side: THREE.DoubleSide })); fl.position.set(x + 1.25, 9.1, 38); G.scene.add(fl); G.flags['flag' + x] = fl;
  }
  S.box(mat('#6b6e70'), 178, 1.0, 100, 6, 2, 0.8); addRect(175, 99.6, 181, 100.4, 0, 2);
  const st = textPlane(['MAX IV', 'LABORATORY'], 5.6, 1.7, { bg: '#6b6e70', font: 'bold 150px Arial', sub: 'bold 60px Arial' }); st.position.set(178, 1.05, 100.42); G.scene.add(st);
}
function sign(text, x, y, z, ry, bg, noBack) {
  const s = textPlane([text], 4.5, 0.7, { bg, font: 'bold 100px Arial' }); s.position.set(x, y, z + 0.02); s.rotation.y = ry; G.scene.add(s);
  if (!noBack) { const s2 = s.clone(); s2.rotation.y = ry + Math.PI; s2.position.z = z - 0.02; G.scene.add(s2); }
}
function flagTex(kind) {
  return canvasTex(192, 120, (g, w, h) => {
    if (kind === 'se') { g.fillStyle = '#006aa7'; g.fillRect(0, 0, w, h); g.fillStyle = '#fecc00'; g.fillRect(w * 0.3, 0, w * 0.13, h); g.fillRect(0, h * 0.42, w, h * 0.16); }
    else if (kind === 'max') { g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); g.fillStyle = '#1b2733'; g.font = 'bold 54px Arial'; g.textAlign = 'center'; g.fillText('MAX IV', w / 2, h * 0.62); }
    else { g.fillStyle = '#e5e1d5'; g.fillRect(0, 0, w, h); g.fillStyle = '#7a1f2b'; g.font = 'bold 30px Georgia'; g.textAlign = 'center'; g.fillText('LUND', w / 2, h * 0.45); g.fillText('UNIVERSITY', w / 2, h * 0.75); }
  });
}
function controlScreenTex() {
  return canvasTex(1536, 256, (g, w, h) => {
    g.fillStyle = '#04101e'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#7fe3ff'; g.font = 'bold 34px monospace'; g.fillText('MAX IV CONTROL ROOM', 30, 46);
    g.font = '24px monospace'; g.fillStyle = '#b4ffc6';
    g.fillText('R3 3 GeV  400 mA  top-up  ε=328 pm·rad', 30, 100); g.fillText('R1 1.5 GeV  500 mA', 30, 140); g.fillText('LINAC 3 GeV  SPF: FemtoMAX', 30, 180);
    g.strokeStyle = '#38d1ff'; g.lineWidth = 3; g.beginPath(); g.arc(1000, 128, 95, 0, TAU); g.stroke();
    g.strokeStyle = '#ff5a5a'; g.beginPath(); g.arc(760, 128, 40, 0, TAU); g.stroke();
    g.strokeStyle = '#ffd34d'; g.beginPath(); g.moveTo(560, 40); g.lineTo(1450, 40); g.stroke();
    for (let i = 0; i < 20; i++) { const a = i * TAU / 20; g.fillStyle = '#ffffff'; g.fillRect(1000 + 95 * Math.cos(a) - 3, 128 + 95 * Math.sin(a) - 3, 6, 6); }
    g.strokeStyle = '#9cffb0'; g.beginPath(); for (let x = 1150; x < 1500; x += 3) g.lineTo(x, 200 - 30 * Math.abs(Math.sin(x * 0.02)) - (x % 120) * 0.1); g.stroke();
  });
}

// ---------------- Linac + FemtoMAX ----------------
function linac() {
  const L = LINAC, S = B.main, roof = HB('linac'); const h = L.h, T = 0.5;
  wallLine(S, MAT.offwhite, L.x0, L.z1, L.x1, L.z1, T, h, [{ at: 200, w: 3.5 }]);   // south (door at x=0)
  wallLine(S, MAT.offwhite, L.x0, L.z0, L.x1, L.z0, T, h, [{ at: 342, w: 4 }]);     // north (door at x=142)
  wallLine(S, MAT.offwhite, L.x0, L.z0, L.x0, L.z1, T, h, [{ at: 7, w: 3.5 }]);     // west (door at z=-171)
  wallLine(S, MAT.offwhite, L.x1, L.z0, L.x1, L.z1, T, h);
  wallLine(S, MAT.offwhite, L.femtoX, L.z0, L.femtoX, L.z1, 0.4, h, [{ at: 11.5, w: 3 }]); // FemtoMAX partition, door at z=-166.5
  roof.box(MAT.sedum, (L.x0 + L.x1) / 2, h + 0.15, (L.z0 + L.z1) / 2, L.x1 - L.x0 + 0.6, 0.3, L.z1 - L.z0 + 0.6);
  S.box(mat('#b9bcbd'), (L.x0 + L.x1) / 2, 0.05, (L.z0 + L.z1) / 2, L.x1 - L.x0, 0.06, L.z1 - L.z0);
  for (const [x, z] of [[0, -164], [142, -178], [-200, -171]]) {
    const d = makeSlideDoor({ x, z, ax: z === -171 ? 0 : 1, az: z === -171 ? 1 : 0, w: x === 142 ? 4 : 3.5, h: 3.2, thick: 0.12, material: mat('#9aa3ab', { metalness: 0.4 }), split: true, kind: 'hall' });
  }
  // accelerator: girder + copper accelerating structures
  const bz = -171.5, by = 1.25;
  S.box(mat('#5d646b'), (L.x0 + 4 + 113) / 2, 0.45, bz, 113 - (L.x0 + 4), 0.9, 0.8);
  addRect(L.x0 + 4, bz - 0.8, 113, bz + 0.8, 0, 1.8);
  const n = Math.floor((113 - (L.x0 + 6)) / 6.2); const im = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.22, 5.2, 16), MAT.copper, n);
  for (let i = 0; i < n; i++) im.setMatrixAt(i, M(L.x0 + 8 + i * 6.2, by, bz, 0, 0, Math.PI / 2)); im.castShadow = true; G.scene.add(im);
  S.add(CYL, MAT.steel, M((L.x0 + 4 + 113) / 2, by, bz, 0, 0, Math.PI / 2, 0.05, 113 - L.x0 - 4, 0.05));
  // electron gun at the west end
  S.box(mat('#2f5f9a'), L.x0 + 3, 1.2, bz, 1.6, 2.4, 1.6); sign('ELECTRON GUN', L.x0 + 3, 3.4, bz + 0.85, 0, '#2f5f9a', true);
  W.linacGun = { x: L.x0 + 5, z: -167 };
  // klystron modulators along the north wall
  const km = []; for (let x = L.x0 + 10; x < 108; x += 9) km.push(M(x, 1.2, -176.3, 0, 0, 0, 2.6, 2.4, 1.8));
  const ki = new THREE.InstancedMesh(BOX, mat('#e9ecef'), km.length); km.forEach((m, i) => ki.setMatrixAt(i, m)); ki.castShadow = true; G.scene.add(ki);
  const kr = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.4, 0.4, 1.4, 12), MAT.red, km.length);
  km.forEach((m, i) => { const p = new THREE.Vector3().setFromMatrixPosition(m); kr.setMatrixAt(i, M(p.x, 3.1, -175.6)); }); G.scene.add(kr);
  addRect(L.x0 + 8, -177.75, 109.5, -175.0, 0, 3.6);
  sign('LINAC · 3 GeV · 300 m', -40, 4.6, -164.5, 0, '#40205a', true);
  // FemtoMAX at the end of the linac (short-pulse facility)
  const fm = buildBeamline({ name: 'FemtoMAX', board: [31, -3], color: '#2e86c1', tech: 'Ultrafast X-ray science', desc: 'Femtosecond X-ray pulses from the linac short-pulse facility capture atoms in motion – melting, phase transitions and chemical reactions.' },
    { x: 113, z: bz }, { x: 1, z: 0 }, { x: 0, z: 1 },
    { o0: null, e0: 7, e1: 23, ew: 3.3, c0: 27, c1: 35, cl0: 3.1, cl1: 6.4 }, by, 3.4, 'L');
  W.femto = fm;
}

// ---------------- Tram ----------------
function tram() {
  const S = B.main; const z = TRAM.z;
  const ballast = new THREE.Mesh(new THREE.PlaneGeometry(TRAM.x1 - TRAM.x0, 4.2), new THREE.MeshStandardMaterial({ map: noiseTex('#7a746b', 30, 128, [200, 1]), roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  ballast.rotation.x = -Math.PI / 2; ballast.position.set((TRAM.x0 + TRAM.x1) / 2, 0.04, z); ballast.receiveShadow = true; G.scene.add(ballast);
  for (const o of [-0.72, 0.72]) S.box(MAT.steel, (TRAM.x0 + TRAM.x1) / 2, 0.12, z + o, TRAM.x1 - TRAM.x0, 0.12, 0.08);
  // stops
  for (const [x, name] of [[TRAM.stopX, 'MAX IV'], [TRAM.essX, 'ESS']]) {
    S.box(mat('#bdbab3'), x, 0.15, z - 3.6, 34, 0.3, 3.4);
    S.box(MAT.glass, x, 1.4, z - 5.1, 6, 2.6, 0.1); addRect(x - 3, z - 5.2, x + 3, z - 5.0, 0, 2.7);
    S.box(MAT.dark, x, 2.8, z - 4.2, 6.4, 0.12, 2.2);
    const s = textPlane([name, 'Spårväg Lund'], 2.6, 0.9, { bg: '#0f5b39', font: 'bold 110px Arial', sub: 'bold 48px Arial' }); s.position.set(x + 5, 3.2, z - 3.0); G.scene.add(s);
    const s2 = s.clone(); s2.rotation.y = Math.PI; s2.position.z -= 0.04; G.scene.add(s2);
    S.box(MAT.grey, x + 5, 1.4, z - 3.02, 0.1, 2.8, 0.1);
  }
  W.tramStop = { x: TRAM.stopX, z: z - 4.5 };
  // overhead line poles
  for (let x = TRAM.x0; x < TRAM.x1; x += 40) { S.box(MAT.grey, x, 3.2, z - 2.6, 0.18, 6.4, 0.18); S.box(MAT.grey, x, 6.2, z - 1.4, 0.08, 0.08, 2.6); }
  S.box(MAT.dark, (TRAM.x0 + TRAM.x1) / 2, 5.9, z, TRAM.x1 - TRAM.x0, 0.03, 0.03);
}

// ---------------- Scenery ----------------
function scenery() {
  const S = B.main; const rnd = seeded(42);
  // ESS (European Spallation Source) on the horizon
  S.box(mat('#56606b'), 560, 12, -60, 120, 24, 70); S.box(mat('#3d464f'), 640, 22, -10, 40, 44, 40); S.box(mat('#8a8f94'), 520, 8, 10, 60, 16, 50);
  addRect(500, -95, 620, -25, 0, 30); addRect(620, -30, 660, 10, 0, 50); addRect(490, -15, 550, 35, 0, 20);
  const ess = textPlane(['ESS', 'European Spallation Source'], 30, 9, { bg: null, fg: '#ffffff', font: 'bold 180px Arial', sub: 'bold 60px Arial' }); ess.position.set(560, 18, -24.9); G.scene.add(ess);
  // Lund on the western horizon: houses + cathedral silhouette
  for (let i = 0; i < 90; i++) { const x = -880 - rnd() * 400, z = -350 + rnd() * 700, w = 10 + rnd() * 25, hgt = 6 + rnd() * 18; S.box(mat(['#b9a48a', '#c6b8a5', '#9d6b53', '#d8d2c8'][i % 4]), x, hgt / 2, z, w, hgt, w * (0.6 + rnd())); }
  S.box(mat('#8a7a66'), -980, 11, 60, 70, 22, 24);
  for (const dz of [-6, 6]) { S.box(mat('#8a7a66'), -1020, 27, 60 + dz, 10, 54, 9); S.add(new THREE.ConeGeometry(7.5, 16, 4), mat('#5b6b5e'), M(-1020, 62, 60 + dz, Math.PI / 4)); }
  // wind turbines
  for (const [x, z] of [[-520, -420], [-380, -560], [700, -450], [820, 260], [-620, 430], [300, -700], [-150, -760], [420, 520]]) {
    const y0 = terrainH(x, z);
    S.add(CYL, mat('#f1f2f2'), M(x, y0 + 40, z, 0, 0, 0, 1.6, 80, 1.6)); S.box(mat('#f1f2f2'), x, y0 + 81, z, 2.6, 2.6, 6);
    const rot = new THREE.Group(); rot.position.set(x, y0 + 81, z + 3.2);
    for (let k = 0; k < 3; k++) { const bl = new THREE.Mesh(BOX, mat('#f7f7f7')); bl.scale.set(1.4, 34, 0.3); bl.position.set(0, 17, 0); const arm = new THREE.Group(); arm.rotation.z = k * TAU / 3; arm.add(bl); rot.add(arm); }
    G.scene.add(rot); G.spinners.push({ obj: rot, axis: 'z', speed: 0.6 + rnd() * 0.3 });
  }
  // trees
  const trees = [];
  const free = (x, z) => {
    if (Math.hypot(x, z) < 132 || Math.hypot(x - R1.cx, z - R1.cz) < 50) return false;
    for (const r of [OFFICE, LINAC, PARKING, PLAZA, ESS]) if (x > r.x0 - 6 && x < r.x1 + 6 && z > r.z0 - 6 && z < r.z1 + 6) return false;
    if (Math.abs(z - TRAM.z) < 7) return false;
    for (let i = 0; i < LOOP.length; i++) { const a = LOOP[i], b = LOOP[(i + 1) % LOOP.length]; if (segDist(x, z, a[0], a[1], b[0], b[1]) < 9) return false; }
    for (const r of ROADS) if (segDist(x, z, r[0], r[1], r[2], r[3]) < r[4] / 2 + 4) return false;
    for (const r of PATHS) if (segDist(x, z, r[0], r[1], r[2], r[3]) < r[4] / 2 + 2) return false;
    return true;
  };
  const addTree = (x, z, s = 1) => { if (free(x, z)) trees.push([x, z, s]); };
  for (let x = -250; x < 230; x += 14) { addTree(x, 140.5, 1); addTree(x + 7, 160, 0.9); }
  for (let x = 118; x < 205; x += 9) { addTree(x, 99, 0.8); addTree(x, 36.5 + 70, 0); }
  for (let z = 44; z < 95; z += 9) { addTree(110, z, 0.8); addTree(210, z, 0.8); }
  for (let i = 0; i < 260; i++) { // hedgerows and copses
    const cx = -700 + rnd() * 1400, cz = -350 + rnd() * 650; const along = rnd() < 0.5;
    if (Math.hypot(cx, cz) < 260) continue; // keep the wave landscape open, like the real one
    for (let k = 0; k < 6; k++) addTree(cx + (along ? k * 8 : rnd() * 6), cz + (along ? rnd() * 3 : k * 8), 0.8 + rnd() * 0.6);
  }
  const N = trees.length;
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.28, 1, 6), mat('#6b4b32'), N);
  const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), mat('#ffffff', { roughness: 0.9 }), N);
  const c = new THREE.Color();
  trees.forEach(([x, z, s], i) => {
    s = s || 1; const y = terrainH(x, z); const hgt = 3.2 * s;
    trunk.setMatrixAt(i, M(x, y + hgt / 2, z, 0, 0, 0, s, hgt, s));
    crown.setMatrixAt(i, M(x, y + hgt + 1.4 * s, z, rnd() * 3, 0, 0, 2.2 * s, 2.6 * s, 2.2 * s));
    crown.setColorAt(i, c.set(['#3f7a2f', '#4f8a35', '#2f6a2a', '#5f9440'][i % 4]));
    if (Math.hypot(x, z) < 450) addCircle(x, z, 0.35 * s, y, y + 5);
  });
  trunk.castShadow = crown.castShadow = true; crown.receiveShadow = true; G.scene.add(trunk, crown);
  // bike rack near the south door
  for (let k = 0; k < 6; k++) S.box(MAT.steel, 10 + k * 1.2, 0.45, 128, 0.06, 0.9, 1.4);
  W.bikeRack = { x: 13, z: 126 };
}

// ---------------- Zones ----------------
function zones() {
  const r3 = (x, z) => Math.hypot(x - R3.cx, z - R3.cz), r1 = (x, z) => Math.hypot(x - R1.cx, z - R1.cz);
  const ri3 = R3.tunIn + R3.tunInT / 2, ro3 = R3.tunOut - R3.tunOutT / 2;
  const ri1 = R1.tunIn + R1.tunInT / 2, ro1 = R1.tunOut - R1.tunOutT / 2;
  const inRect = (x, z, r) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1;
  G.zones.push(
    { name: '3 GeV storage ring tunnel', prio: 5, test: (x, z) => { const r = r3(x, z); return r > ri3 && r < ro3; }, hide: ['roof3', 'tun3'], flags: { hall: true, tunnel: '3' } },
    { name: '3 GeV experimental hall', prio: 3, test: (x, z) => { const r = r3(x, z); return r > R3.inner && r < R3.outer; }, hide: ['roof3'], flags: { hall: true } },
    { name: 'Courtyard garden', prio: 3, test: (x, z) => r3(x, z) < R3.inner, flags: {} },
    { name: '1.5 GeV storage ring tunnel', prio: 5, test: (x, z) => { const r = r1(x, z); return r > ri1 && r < ro1; }, hide: ['roof1', 'tun1'], flags: { hall: true, tunnel: '1' } },
    { name: '1.5 GeV ring hall', prio: 3, test: (x, z) => r1(x, z) < R1.outer, hide: ['roof1'], flags: { hall: true } },
    { name: 'MAX IV office & reception', prio: 3, test: (x, z) => (inRect(x, z, OFFICE) || (x > 112 && x < OFFICE.x0 && Math.abs(z) < 3)) && r3(x, z) > R3.outer, hide: ['office'], flags: {} },
    { name: 'Linac – 3 GeV injector', prio: 3, test: (x, z) => inRect(x, z, LINAC) && x < LINAC.femtoX, hide: ['linac'], flags: { hall: true } },
    { name: 'FemtoMAX – short pulse facility', prio: 3, test: (x, z) => inRect(x, z, LINAC) && x >= LINAC.femtoX, hide: ['linac'], flags: { hall: true } },
    { name: 'Parking', prio: 1, test: (x, z) => inRect(x, z, PARKING), flags: {} },
    { name: 'MAX IV tram stop', prio: 1, test: (x, z) => Math.abs(x - TRAM.stopX) < 20 && Math.abs(z - TRAM.z) < 9, flags: {} },
    { name: 'Fotongatan', prio: 1, test: (x, z) => Math.abs(z - 150) < 6 && x > -760 && x < 540, flags: {} },
    { name: 'ESS – European Spallation Source', prio: 1, test: (x, z) => x > ESS.x0 - 40 && x < ESS.x1 + 40 && z > ESS.z0 - 40 && z < ESS.z1 + 60, flags: {} },
    { name: 'Vibration-damping landscape', prio: 0, test: (x, z) => { const r = r3(x, z); return r > 127 && r < 245; }, flags: {} },
    { name: 'Brunnshög fields', prio: -1, test: () => true, flags: {} },
  );
}

// ---------------- Photo boards ----------------
function boards() {
  photoBoard('building_2016.jpg', 166, 162.2, 0, null);               // tram stop, facing the platform
  photoBoard('aerial_ring_2020.jpg', 120, 33, 0, null);                // plaza
  photoBoard('hall_2023.jpg', 119, 88, Math.PI / 2, null);             // parking
  photoBoard('building_2022.jpg', -9, 120.2, 0, null);                 // outside the south door
  photoBoard('aerial_2016.jpg', 12, 40, Math.PI, null);                 // courtyard
  photoBoard('linac.jpg', LINAC.x0 + 10, -164.9, Math.PI, null, null, 2.6); // linac (wall)
  // tunnel access corridor (inner side of R3 at 180°)
  photoBoard('magnet_block.jpg', -70.5, 6, Math.PI / 2, null);
  photoBoard('magnet_danfysik.jpg', -70.5, -6, Math.PI / 2, null);
  // the wave landscape: photo viewpoints on the bike path, looking at what the photographer saw
  const view = (f, a) => photoBoard(f, 128.5 * Math.cos(a), 128.5 * Math.sin(a), Math.atan2(-Math.cos(a), -Math.sin(a)), null);
  view('infomastern_1.jpg', -0.55); view('infomastern_2.jpg', -0.95); view('infomastern_3.jpg', 1.0);
  photoBoard('quadrupole_evenkolder.jpg', -70.5, 14, Math.PI / 2, null);
  photoBoard('brunnshog_2017.jpg', 60, 142.6, Math.PI, null);
  photoBoard('construction_2013b.jpg', 136, 162.2, 0, null);
  photoBoard('aerial_2014b.jpg', 156, OFFICE.z0 + 0.25, 0, null, null, 2.4);
  photoBoard('r1_ring_inside.jpg', R1.cx + 30, R1.cz + 8, -Math.PI / 2, null); // R1 hall
  // office photo gallery
  const gal = ['layout_ipac2016.jpg', 'aerial_2014.jpg', 'construction_2013.jpg', 'construction_2015a.jpg', 'construction_2015b.jpg', 'building_2020b.jpg'];
  gal.slice(0, 5).forEach((f, i) => photoBoard(f, OFFICE.x1 - 0.25, -28 + i * 9.5, -Math.PI / 2, null, null, 2.4));
  photoBoard(gal[5], 168, OFFICE.z0 + 0.25, 0, null, null, 2.4);
}

// ---------------- Golden photons ----------------
function photons() {
  const P = []; const bl = (n) => G.beamlines.find((b) => b.name === n);
  const pt = (x, z) => P.push({ x, z });
  pt(0, 0); pt(70, 0); pt(82 * Math.cos(300 * DEG), 82 * Math.sin(300 * DEG));
  P.push({ x: 0, z: -84, y: 5.6 });
  const cs = bl('CoSAXS'); pt(cs.P(cs.ds + 6, -1.5).x, cs.P(cs.ds + 6, -1.5).z);
  pt(176, 20); pt(128, -33); pt(202, 92); pt(TRAM.stopX - 14, TRAM.z - 4);
  pt(LINAC.x0 + 2, -166); pt(W.femto.P(16, -4.6).x, W.femto.P(16, -4.6).z);
  pt(R1.cx - 25, R1.cz + 15); pt(R1.cx + 16.8 * Math.cos(200 * DEG), R1.cz + 16.8 * Math.sin(200 * DEG));
  pt(-150, 122); pt(600, 60); pt(-600, 300); pt(-60, -205); pt(-255, -225); pt(-720, 150);
  const ve = bl('VERITAS'); pt(ve.P(ve.dims.c1 + 3.2, ve.dims.cl0).x, ve.P(ve.dims.c1 + 3.2, ve.dims.cl0).z);
  const geo = new THREE.OctahedronGeometry(0.45);
  const m = new THREE.MeshStandardMaterial({ color: '#ffd84a', emissive: '#ffb000', emissiveIntensity: 1.2, metalness: 0.8, roughness: 0.2 });
  for (const p of P) {
    const y = p.y ?? groundY(p.x, p.z) + 1.2;
    const mesh = new THREE.Mesh(geo, m); mesh.position.set(p.x, y, p.z); G.scene.add(mesh);
    G.photons.push({ x: p.x, z: p.z, y, mesh, got: false });
  }
}

// ---------------- Navigation graph for pedestrians ----------------
function nav() {
  const nodes = G.nav.nodes;
  const add = (x, z) => { nodes.push({ x, z, nb: [] }); return nodes.length - 1; };
  const link = (a, b) => { if (a === b) return; nodes[a].nb.push(b); nodes[b].nb.push(a); };
  const ring = (cx, cz, r, step, a0 = 0) => { const ids = []; for (let a = a0; a < 360 + a0 - 0.01; a += step) ids.push(add(cx + r * Math.cos(a * DEG), cz + r * Math.sin(a * DEG))); ids.forEach((id, i) => link(id, ids[(i + 1) % ids.length])); return ids; };
  const at = (ids, step, a) => ids[Math.round(((a % 360) + 360) % 360 / step) % ids.length];
  const outer = ring(0, 0, 110, 10), inner = ring(0, 0, 69, 15), bike = ring(0, 0, BIKE_RING_R, 10), court = ring(0, 0, 35, 45);
  const cc = add(0, 0); court.forEach((c) => link(c, cc));
  for (const a of [90, 270]) {
    const top = add(84 * Math.cos(a * DEG), 84 * Math.sin(a * DEG)); link(at(inner, 15, a), top); link(top, at(outer, 10, a));
    const cd = add(57 * Math.cos(a * DEG), 57 * Math.sin(a * DEG)); link(cd, at(inner, 15, a)); link(cd, at(court, 45, a));
  }
  for (const a of [0, 90, 180, 270]) link(at(outer, 10, a), at(bike, 10, a));
  for (const b of G.beamlines) {
    if (b.ring !== '3') continue;
    const near = (p) => { let best = outer[0], bd = 1e9; for (const id of outer) { const d = Math.hypot(nodes[id].x - p.x, nodes[id].z - p.z); if (d < bd) { bd = d; best = id; } } return best; };
    if (b.cabinDoorOut) { const n1 = add(b.cabinDoorOut.x, b.cabinDoorOut.z); link(n1, near(b.cabinDoorOut)); const n2 = add(b.expDoorOut.x, b.expDoorOut.z); link(n2, n1); }
    else if (b.center) { const n1 = add(b.center.x, b.center.z); link(n1, near(b.center)); }
  }
  // office / plaza / parking / tram
  const lobby = add(150, 20), l2 = add(165, 6), l3 = add(135, 8), l4 = add(128, 0), cor = add(118.5, 0), cr = add(140, -20), cafe = add(170, 16);
  link(lobby, l2); link(lobby, l3); link(l3, l4); link(l4, cor); link(cor, at(outer, 10, 0)); link(l3, cr); link(l2, cafe); link(l2, cr);
  const plaza = add(150, 32), pk1 = add(150, 62), pk2 = add(185, 62), pk3 = add(130, 78), pk4 = add(160, 92), sp = add(160, 120), fs = add(160, 143), ts = add(150, 162);
  link(plaza, lobby); link(plaza, pk1); link(pk1, pk2); link(pk1, pk3); link(pk3, pk4); link(pk2, pk4); link(pk4, sp); link(sp, fs); link(fs, ts);
  // Fotongatan sidewalk
  const sw = []; for (let x = -240; x <= 200; x += 40) sw.push(add(x, 143)); sw.forEach((id, i) => i && link(id, sw[i - 1]));
  link(fs, sw[sw.length - 2]); const s0 = add(0, 140); link(s0, at(bike, 10, 90)); link(s0, sw[6]);
  // north to the linac
  const n1 = add(0, -150), n2 = add(0, -167); link(at(bike, 10, 270), n1); link(n1, n2);
  const lin = []; for (let x = LINAC.x0 + 6; x < 112; x += 30) lin.push(add(x, -167)); lin.forEach((id, i) => i && link(id, lin[i - 1]));
  let best = lin[0]; for (const id of lin) if (Math.abs(nodes[id].x) < Math.abs(nodes[best].x)) best = id; link(n2, best);
  // west: R3 loading door -> R1
  const w1 = add(-121, -50), w2 = add(-121, -96), r1o = add(R1.cx + 44, R1.cz), r1i = add(R1.cx + 30, R1.cz);
  link(at(bike, 10, 180), w1); link(w1, w2); link(w2, r1o); link(r1o, r1i);
  const r1ring = ring(R1.cx, R1.cz, 30, 30); link(r1i, r1ring[0]);
  const r1s = add(R1.cx, R1.cz + 46); link(r1s, r1ring[3]); link(r1s, w1);
}
