// The storage rings, their halls, tunnels, magnets and beamlines.
import * as THREE from 'three';
import { DEG, TAU, mat, canvasTex, noiseTex, textPlane, trefoilTex, photo, rand } from './util.js';
import { addArc, addBox, addCircle } from './physics.js';
import { G } from './state.js';
import { R3, R1, PHOTOS } from './data.js';
import { B, HB, M, BOX, CYL, SPH, revolveGeom, revolveGaps, wallProfile, wallSeg } from './build.js';
import { buildExperimentHardware } from './cosaxs.js';

export const W = {}; // named places used by missions
export const MAT = {};

export function initMaterials() {
  const rib = canvasTex(256, 64, (g, w, h) => {
    g.fillStyle = '#c4c9cf'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 16; i++) { const x = i * 16; const gr = g.createLinearGradient(x, 0, x + 16, 0); gr.addColorStop(0, '#f2f4f6'); gr.addColorStop(0.5, '#b6bcc3'); gr.addColorStop(1, '#e3e6ea'); g.fillStyle = gr; g.fillRect(x, 0, 16, h); }
  }, [1, 1]);
  MAT.facade = new THREE.MeshStandardMaterial({ map: rib, color: '#e8ebee', metalness: 0.5, roughness: 0.38, side: THREE.DoubleSide });
  MAT.sedum = new THREE.MeshStandardMaterial({ map: noiseTex('#6f8a3c', 40, 256, [1, 1], (g, w) => { for (let i = 0; i < 300; i++) { g.fillStyle = Math.random() < 0.5 ? '#8f8a3f' : '#567a2f'; g.fillRect(Math.random() * w, Math.random() * w, 6, 6); } }), roughness: 1, side: THREE.DoubleSide });
  MAT.concrete = new THREE.MeshStandardMaterial({ map: noiseTex('#a3a29d', 22, 256, [1, 1]), roughness: 0.95, side: THREE.DoubleSide });
  MAT.floor = new THREE.MeshStandardMaterial({ map: noiseTex('#7f8589', 10, 128, [1, 1]), roughness: 0.55, side: THREE.DoubleSide });
  MAT.white = mat('#eef0f2'); MAT.offwhite = mat('#d9dcdf'); MAT.grey = mat('#8d949b'); MAT.dark = mat('#2b2f35');
  MAT.steel = mat('#a7b0b8', { metalness: 0.6, roughness: 0.35 });
  MAT.copper = mat('#c27a3e', { metalness: 0.7, roughness: 0.3 });
  MAT.glass = new THREE.MeshStandardMaterial({ color: '#9fc4d8', transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0.2, depthWrite: false });
  MAT.yellow = mat('#f2c40f'); MAT.red = mat('#c0392b'); MAT.blue = mat('#2f5f9a'); MAT.wood = mat('#a7764a');
  MAT.lead = mat('#e6e2d8');
  MAT.lampRed = new THREE.MeshBasicMaterial({ color: '#ff2a1a', toneMapped: false });
  MAT.lampGreen = new THREE.MeshBasicMaterial({ color: '#2aff6a', toneMapped: false });
  MAT.screen = new THREE.MeshBasicMaterial({ map: canvasTex(256, 160, (g, w, h) => {
    g.fillStyle = '#071425'; g.fillRect(0, 0, w, h); g.strokeStyle = '#38d1ff'; g.lineWidth = 3; g.beginPath();
    for (let x = 0; x < w; x += 4) g.lineTo(x, h * 0.6 - Math.exp(-((x - w * 0.55) ** 2) / 300) * 70 + Math.random() * 6); g.stroke();
    g.fillStyle = '#9cffb0'; g.font = '16px monospace'; g.fillText('I = 400 mA  ε = 0.33 nm·rad', 8, 20); g.fillText('photons/s: 1.2e13', 8, h - 12);
  }), toneMapped: false });
  MAT.trefoil = new THREE.MeshBasicMaterial({ map: trefoilTex(), transparent: true });
  MAT.hazard = new THREE.MeshStandardMaterial({ map: canvasTex(128, 32, (g, w, h) => { g.fillStyle = '#f2c40f'; g.fillRect(0, 0, w, h); g.fillStyle = '#111'; for (let x = -h; x < w; x += 24) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + 12, h); g.lineTo(x + 12 + h, 0); g.lineTo(x + h, 0); g.fill(); } }) });
}

// ---------------- Rings ----------------
export function buildRing(cfg, key, courtyard) {
  const S = B.main, roof = HB('roof' + key), tun = HB('tun' + key);
  const { cx, cz } = cfg, R = cfg.outer, H = cfg.hallH;
  const spd = R > 80 ? 1 : 0.6;
  // outer facade (lower band with doors, upper curved band)
  revolveGaps(S, MAT.facade, [[R, 0], [R, 4]], cfg.outerDoors, R, cx, cz, spd);
  S.add(revolveGeom([[R, 4], [R, H - 5.5], [R - 0.8, H - 2.5], [R - 2.5, H - 0.7], [R - 5, H]], 0, 360, cx, cz, spd), MAT.facade, new THREE.Matrix4());
  addArc(cx, cz, R, 0.5, cfg.outerDoors.map((d) => [d.a, d.w]), 0, H);
  const rIn = courtyard ? cfg.inner : 0.01;
  roof.add(revolveGeom([[R - 5, H], [rIn + (courtyard ? 2 : 0), H]], 0, 360, cx, cz, spd, 12), MAT.sedum, new THREE.Matrix4());
  if (courtyard) {
    const r = cfg.inner;
    revolveGaps(S, MAT.facade, [[r, 0], [r, 4]], cfg.innerDoors, r, cx, cz, spd);
    S.add(revolveGeom([[r, 4], [r, H - 3], [r + 0.6, H - 1], [r + 2, H]], 0, 360, cx, cz, spd), MAT.facade, new THREE.Matrix4());
    addArc(cx, cz, r, 0.5, cfg.innerDoors.map((d) => [d.a, d.w]), 0, H);
  }
  S.add(revolveGeom([[courtyard ? cfg.inner : 0.01, 0.03], [R, 0.03]], 0, 360, cx, cz, spd, 6), MAT.floor, new THREE.Matrix4());
  // doors in facades
  for (const d of cfg.outerDoors) ringDoor(cx, cz, R - 0.2, d, 'hall');
  if (courtyard) for (const d of cfg.innerDoors) ringDoor(cx, cz, cfg.inner + 0.2, d, 'hall');

  // shielding tunnel
  const tdGap = [{ a: cfg.tunnelDoor, w: 2.4 }];
  const doorIn = courtyard; // R3 door on inner wall, R1 on outer wall
  revolveGaps(S, MAT.concrete, wallProfile(cfg.tunIn, cfg.tunInT, cfg.tunH), doorIn ? tdGap : [], cfg.tunIn, cx, cz, spd, 4);
  revolveGaps(S, MAT.concrete, wallProfile(cfg.tunOut, cfg.tunOutT, cfg.tunH), doorIn ? [] : tdGap, cfg.tunOut, cx, cz, spd, 4);
  addArc(cx, cz, cfg.tunIn, cfg.tunInT, doorIn ? [[cfg.tunnelDoor, 2.4]] : [], 0, cfg.tunH);
  addArc(cx, cz, cfg.tunOut, cfg.tunOutT, doorIn ? [] : [[cfg.tunnelDoor, 2.4]], 0, cfg.tunH);
  const ri = cfg.tunIn - cfg.tunInT / 2, ro = cfg.tunOut + cfg.tunOutT / 2, th = cfg.tunH;
  tun.add(revolveGeom([[ri, th], [ri, th + 0.25], [ri, th + 0.25], [ro, th + 0.25], [ro, th + 0.25], [ro, th]], 0, 360, cx, cz, spd, 4), MAT.concrete, new THREE.Matrix4());
  S.add(revolveGeom([[ri + 0.5, 0.04], [ro - 0.5, 0.04]], 0, 360, cx, cz, spd, 4), mat('#9da3a0'), new THREE.Matrix4());
  // cable tray on the outer tunnel wall
  S.add(revolveGeom([[cfg.tunOut - cfg.tunOutT / 2 - 0.5, th - 1.2], [cfg.tunOut - cfg.tunOutT / 2 - 0.02, th - 1.2]], 0, 360, cx, cz, spd), MAT.steel, new THREE.Matrix4());
  // beam pipe
  S.add(new THREE.TorusGeometry(cfg.rBeam, 0.05, 6, Math.round(cfg.rBeam * 6)), MAT.steel, M(cx, key === '3' ? 1.25 : 1.1, cz, 0, Math.PI / 2));
  // magnet line collider (walk on the inner/outer side only)
  addArc(cx, cz, cfg.rBeam, 1.3, [], 0, 1.7, { noCam: true });
  magnets(cfg, key);
  tunnelDoor(cfg, key, doorIn);
}

function ringDoor(cx, cz, r, d, kind) {
  const a = d.a * DEG; const x = cx + r * Math.cos(a), z = cz + r * Math.sin(a);
  makeSlideDoor({ x, z, ax: -Math.sin(a), az: Math.cos(a), w: d.w, h: 3.6, thick: 0.12, material: MAT.glass, split: true, kind });
}

export function makeSlideDoor({ x, z, ax, az, w, h, thick, material, split, kind, allow, label, frame = true }) {
  const ry = Math.atan2(ax, az); const panels = [];
  const mk = (cxp, czp, pw, dir) => {
    const m = new THREE.Mesh(BOX, material); m.scale.set(thick, h, pw); m.rotation.y = ry; m.position.set(cxp, h / 2, czp);
    m.castShadow = !material.transparent; G.scene.add(m); panels.push({ m, bx: cxp, bz: czp, dx: ax * dir, dz: az * dir, dist: pw * 0.92 });
  };
  if (split) { mk(x - ax * w / 4, z - az * w / 4, w / 2, -1); mk(x + ax * w / 4, z + az * w / 4, w / 2, 1); }
  else mk(x, z, w, 1);
  if (frame) B.main.box(MAT.dark, x, h + 0.08, z, thick + 0.1, 0.16, w + 0.1, ry);
  const collider = addBox(x, z, w, thick + 0.3, ax, az, 0, h);
  const door = { x, z, panels, collider, open: 0, kind, allow: allow || null, label };
  G.doors.push(door); return door;
}

function magnets(cfg, key) {
  const step = key === '3' ? 1.25 : 4.5;
  const sources = (key === '3' ? R3Sources : R1Sources);
  const types = [
    { geo: [0.75, 0.75, 1.5], color: '#3d6596', y: 0.0 },  // dipole (gradient bend)
    { geo: [0.9, 0.9, 0.45], color: '#c0392b', y: 0.0 },   // quadrupole
    { geo: [0.8, 0.8, 0.35], color: '#e3b505', y: 0.0 },   // sextupole
    { geo: [0.9, 0.9, 0.45], color: '#c0392b', y: 0.0 },
  ];
  const by = key === '3' ? 1.25 : 1.1;
  const lists = types.map(() => []); const girders = [];
  let i = 0;
  for (let ad = 0; ad < 360; ad += step, i++) {
    let skip = false; for (const s of sources) { const dd = ((ad - s) % 360 + 540) % 360 - 180; if (dd > -4.2 && dd < 0.8) skip = true; }
    if (skip) continue;
    const a = ad * DEG; const x = cfg.cx + cfg.rBeam * Math.cos(a), z = cfg.cz + cfg.rBeam * Math.sin(a);
    const ry = Math.atan2(-Math.sin(a), Math.cos(a));
    lists[i % 4].push(M(x, by, z, ry)); girders.push(M(x, (by - 0.4) / 2, z, ry, 0, 0, 0.9, by - 0.4, cfg.rBeam * step * DEG * 0.98));
  }
  types.forEach((t, k) => {
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(...t.geo), mat(t.color, { roughness: 0.45, metalness: 0.3 }), lists[k].length);
    lists[k].forEach((m, j) => im.setMatrixAt(j, m)); im.castShadow = true; im.receiveShadow = true; G.scene.add(im);
    if (k === 0) { // copper coils on dipoles
      const coil = new THREE.InstancedMesh(new THREE.BoxGeometry(0.95, 0.22, 1.2), MAT.copper, lists[k].length);
      lists[k].forEach((m, j) => coil.setMatrixAt(j, m)); G.scene.add(coil);
    }
  });
  const gm = new THREE.InstancedMesh(BOX, mat('#5d646b'), girders.length); girders.forEach((m, j) => gm.setMatrixAt(j, m)); gm.receiveShadow = true; G.scene.add(gm);
  // undulators in the straight sections before each source point
  for (const s of sources) {
    const a = s * DEG; const t = { x: -Math.sin(a), z: Math.cos(a) }; const ry = Math.atan2(t.x, t.z);
    const sx = cfg.cx + cfg.rBeam * Math.cos(a) - t.x * 2.4, sz = cfg.cz + cfg.rBeam * Math.sin(a) - t.z * 2.4;
    B.main.box(mat('#d9dde2', { metalness: 0.6, roughness: 0.3 }), sx, by + 0.42, sz, 0.7, 0.55, 3.8, ry);
    B.main.box(mat('#d9dde2', { metalness: 0.6, roughness: 0.3 }), sx, by - 0.42, sz, 0.7, 0.55, 3.8, ry);
    B.main.box(mat('#2a5aa8'), sx, by, sz, 0.9, 1.6, 0.25, ry);
    B.main.box(mat('#3b3f45'), sx, (by - 0.7) / 2, sz, 0.8, by - 0.7, 3.6, ry);
  }
}
const R3Sources = []; const R1Sources = [];

function tunnelDoor(cfg, key, doorIn) {
  const a = cfg.tunnelDoor * DEG; const r = doorIn ? cfg.tunIn : cfg.tunOut;
  const x = cfg.cx + r * Math.cos(a), z = cfg.cz + r * Math.sin(a);
  const ax = -Math.sin(a), az = Math.cos(a);
  const door = makeSlideDoor({ x, z, ax, az, w: 2.4, h: Math.min(3, cfg.tunH - 0.3), thick: doorIn ? cfg.tunInT * 0.8 : cfg.tunOutT * 0.8, material: mat('#d6d23a', { roughness: 0.5 }), split: false, kind: 'tunnel', frame: false });
  door.allow = () => G.ring.access;
  door.ring = key;
  // warning signs + beacons on the access side
  const side = doorIn ? -1 : 1; const off = (doorIn ? cfg.tunInT : cfg.tunOutT) / 2 + 0.03;
  const nx = Math.cos(a) * side, nz = Math.sin(a) * side;
  for (const s of [-1, 1]) {
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), MAT.trefoil);
    sign.position.set(x + nx * off + ax * s * 2.2, 1.9, z + nz * off + az * s * 2.2); sign.rotation.y = Math.atan2(nx, nz); G.scene.add(sign);
  }
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.3, 10), MAT.lampRed.clone());
  lamp.position.set(x + nx * (off + 0.1), Math.min(3, cfg.tunH - 0.3) + 0.4, z + nz * (off + 0.1)); G.scene.add(lamp);
  door.lamp = lamp;
  const label = textPlane(['STORAGE RING ' + (key === '3' ? '3 GeV' : '1.5 GeV'), 'Interlocked area – no entry with beam'], 3.2, 0.7, { bg: '#7a1010', font: 'bold 70px Arial' });
  label.position.set(x + nx * off, Math.min(3, cfg.tunH - 0.3) + 0.4 + 0.6, z + nz * off); label.rotation.y = Math.atan2(nx, nz); G.scene.add(label);
  const out = { x: x + nx * 2, z: z + nz * 2 }, inside = { x: x - nx * 1.5, z: z - nz * 1.5 };
  W['tunnelDoor' + key] = { door, out, inside, x, z };
}

// ---------------- Beamlines ----------------
export function registerSources() {
  for (const b of R3_BL()) if (!b.platform) R3Sources.push(b.a);
  for (const b of R1_BL()) R1Sources.push(b.a);
}
import { BEAMLINES3, BEAMLINES1 } from './data.js';
const R3_BL = () => BEAMLINES3, R1_BL = () => BEAMLINES1;

export function ringBeamline(cfg, info, ringKey) {
  const a = info.a * DEG; const c = Math.cos(a), s = Math.sin(a);
  const S = { x: cfg.cx + cfg.rBeam * c, z: cfg.cz + cfg.rBeam * s };
  return buildBeamline(info, S, { x: -s, z: c }, { x: c, z: s }, cfg.dims, ringKey === '3' ? 1.25 : 1.1, ringKey === '3' ? 3.6 : 3.2, ringKey);
}

export function buildBeamline(info, S, t, n, d, beamY, hutchH, ringKey) {
  d = Object.assign({}, d, info.dims || {});
  const P = (dd, lat) => ({ x: S.x + t.x * dd + n.x * lat, z: S.z + t.z * dd + n.z * lat });
  const ry = Math.atan2(t.x, t.z); // local z = t, local x = n
  const Sb = B.main;
  const bl = { name: info.name, info, S, t, n, P, ring: ringKey, shutter: false, locked: false, searched: false, hutches: [] };
  const color = info.color;

  if (info.construction || info.platform) { specialSlot(bl, d); G.beamlines.push(bl); return bl; }

  // pipe from the source to the experimental hutch
  const pipeMat = MAT.steel.clone(); bl.pipeMat = pipeMat;
  const ds = info.ds != null ? d.e0 + info.ds : (d.e0 + d.e1) / 2 - 1; bl.ds = ds; bl.beamY = beamY; bl.hutchH = hutchH; bl.dims = d;
  const pc = P(d.e0 / 2, 0);
  const pipe = new THREE.Mesh(CYL, pipeMat); pipe.scale.set(0.08, d.e0, 0.08); pipe.position.set(pc.x, beamY, pc.z); pipe.rotation.set(Math.PI / 2, ry, 0, 'YXZ'); G.scene.add(pipe);
  for (let k = 26; k < d.e0; k += 4) { const q = P(k, 0); Sb.box(MAT.grey, q.x, beamY / 2, q.z, 0.3, beamY, 0.3, ry); }
  // photon beam (visible in air inside the experimental hutch when the shutter is open)
  const bm = new THREE.Mesh(CYL, new THREE.MeshBasicMaterial({ color: '#fff7c2', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  const bc = P((d.e0 + ds) / 2, 0); bm.scale.set(0.035, ds - d.e0, 0.035); bm.position.set(bc.x, beamY, bc.z); bm.rotation.set(Math.PI / 2, ry, 0, 'YXZ'); bm.visible = false; G.scene.add(bm);
  bl.beamMesh = bm;

  const hutch = (d0, d1, l0, l1, h, wallMat, door, name) => {
    const T = 0.16;
    const wallT = (dd, la, lb) => { const q = P(dd, (la + lb) / 2); wallSeg(Sb, wallMat, q.x, q.z, lb - la, T, h, n.x, n.z); };
    const wallS = (la, lb, lat) => { if (lb - la < 0.01) return; const q = P((la + lb) / 2, lat); wallSeg(Sb, wallMat, q.x, q.z, lb - la, T, h, t.x, t.z); };
    wallT(d0, l0, l1);
    if (door && door.wall === 'd1') {
      wallT(d1, l0, door.at - door.w / 2); wallT(d1, door.at + door.w / 2, l1);
      const q = P(d1, door.at); Sb.box(wallMat, q.x, (h + 2.3) / 2, q.z, door.w, h - 2.3, T, ry);
    } else wallT(d1, l0, l1);
    wallS(d0, d1, l0);
    if (door && door.wall === 'l1') {
      wallS(d0, door.at - door.w / 2, l1); wallS(door.at + door.w / 2, d1, l1);
      const q = P(door.at, l1); Sb.box(wallMat, q.x, (h + 2.4) / 2, q.z, T, h - 2.4, door.w, ry);
    } else wallS(d0, d1, l1);
    const rc = P((d0 + d1) / 2, (l0 + l1) / 2);
    const roofM = new THREE.Mesh(BOX, wallMat); roofM.scale.set(l1 - l0 + 0.16, 0.14, d1 - d0 + 0.16); roofM.position.set(rc.x, h, rc.z); roofM.rotation.y = ry; roofM.castShadow = false; G.scene.add(roofM);
    const zone = { name: info.name + ' – ' + name, prio: 6, hideObj: [roofM], bl, kind: name, flags: { hall: true, hutch: name === 'Experimental hutch' ? bl : null },
      test: (x, z) => { const dx = x - S.x, dz = z - S.z; const dd = dx * t.x + dz * t.z, la = dx * n.x + dz * n.z; return dd > d0 && dd < d1 && la > l0 && la < l1; } };
    zone.poly = [P(d0, l0), P(d1, l0), P(d1, l1), P(d0, l1)]; zone.color = wallMat.color.getStyle();
    G.zones.push(zone); bl.hutches.push(zone);
    return zone;
  };

  // optics hutch (white lead-lined)
  if (d.o0 != null) hutch(d.o0, d.o1, -d.ow, d.ow, hutchH - 0.4, MAT.lead, null, 'Optics hutch');
  // experimental hutch (beamline colour)
  const doorAt = d.e1 - 2.2;
  const hutchMat = mat(color, { roughness: 0.6 });
  bl.expZone = hutch(d.e0, d.e1, -d.ew, d.ew, hutchH, hutchMat, { wall: 'l1', at: doorAt, w: 1.8 }, 'Experimental hutch');
  const dq = P(doorAt, d.ew + 0.03);
  bl.door = makeSlideDoor({ x: dq.x, z: dq.z, ax: -t.x, az: -t.z, w: 1.8, h: 2.4, thick: 0.12, material: mat(color, { roughness: 0.4, metalness: 0.2 }), split: false, kind: 'hutch', frame: false });
  bl.door.bl = bl;
  bl.door.allow = () => !!info.visit && !bl.shutter && !bl.locked;
  { // visitor status plate next to the door
    const vq = P(doorAt, d.ew + 0.1);
    const plate = textPlane(info.visit ? ['OPEN FOR VISITORS', 'green lamp: walk in'] : ['NOT DEVELOPED YET', 'no entry'], 1.9, 0.5, { bg: info.visit ? '#14632f' : '#7a1010', font: 'bold 64px Arial', sub: 'bold 34px Arial' });
    plate.position.set(vq.x, 2.75, vq.z); plate.rotation.y = Math.atan2(n.x, n.z); G.scene.add(plate);
  }
  bl.expDoorOut = P(doorAt, d.ew + 1.3); bl.expDoorIn = P(doorAt, d.ew - 1.0);
  // inside the experimental hutch
  const sp = P(ds, 0); bl.samplePos = sp;
  if (info.custom) buildExperimentHardware(info.custom, bl, { d, ds, beamY, hutchH, ry });
  else {
  Sb.box(MAT.dark, sp.x, (beamY - 0.35) / 2, sp.z, 1.0, beamY - 0.35, 1.0, ry);
  Sb.add(CYL, MAT.steel, M(sp.x, beamY - 0.2, sp.z, 0, 0, 0, 0.18, 0.3, 0.18));
  const det = P(ds + 2.6, 0); Sb.box(MAT.dark, det.x, beamY, det.z, 1.1, 1.1, 0.5, ry); Sb.box(MAT.grey, det.x, (beamY - 0.55) / 2, det.z, 0.5, beamY - 0.55, 0.5, ry);
  addCircle(sp.x, sp.z, 0.6, 0, 2); addCircle(det.x, det.z, 0.65, 0, 2);
  const rk = P(d.e0 + 1.4, -d.ew + 0.45); Sb.box(MAT.dark, rk.x, 1.0, rk.z, 0.7, 2.0, 1.2, ry); addCircle(rk.x, rk.z, 0.6, 0, 2);
  if (info.name === 'BioMAX') { // sample changer robot + dewar (see photo)
    const rb = P(ds - 1.6, -1.3);
    Sb.add(CYL, mat('#1d2a3a'), M(rb.x, 0.5, rb.z, 0, 0, 0, 0.45, 1.0, 0.45));
    Sb.add(CYL, mat('#3d8fe0'), M(rb.x + 0.6 * t.x, 1.3, rb.z + 0.6 * t.z, 0, 0.6, 0, 0.12, 1.4, 0.12));
    Sb.box(mat('#3d8fe0'), rb.x + 0.2 * t.x, 1.05, rb.z + 0.2 * t.z, 0.35, 0.3, 0.35, ry);
  }
  }
  // lamp on the roof
  const lp = P(d.e0 + 0.8, d.ew - 0.4);
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.35, 10), MAT.lampGreen); lamp.position.set(lp.x, hutchH + 0.25, lp.z); G.scene.add(lamp); bl.lamp = lamp;
  // signs on both sides of the hutch
  for (const side of [1, -1]) {
    const sg = textPlane([info.name, info.tech], 6.2, 1.15, { bg: color, font: 'bold 120px Arial', sub: 'bold 46px Arial' });
    const q = P((d.e0 + d.e1) / 2, side * (d.ew + 0.1)); sg.position.set(q.x, hutchH - 0.75, q.z); sg.rotation.y = Math.atan2(n.x * side, n.z * side); G.scene.add(sg);
  }
  // control cabin
  const cl = (d.cl0 + d.cl1) / 2;
  bl.cabinZone = hutch(d.c0, d.c1, d.cl0, d.cl1, 2.8, MAT.offwhite, { wall: 'd1', at: cl, w: 1.1 }, 'Control cabin');
  const desk = P(d.c0 + 0.8, cl); Sb.box(MAT.wood, desk.x, 0.75, desk.z, d.cl1 - d.cl0 - 0.5, 0.06, 0.8, ry); Sb.box(MAT.dark, desk.x, 0.37, desk.z, d.cl1 - d.cl0 - 0.6, 0.72, 0.5, ry);
  addBox(desk.x, desk.z, d.cl1 - d.cl0 - 0.5, 0.9, n.x, n.z, 0, 1.0);
  for (const k of [-0.8, 0, 0.8]) {
    const q = P(d.c0 + 0.65, cl + k); const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.4), MAT.screen);
    scr.position.set(q.x, 1.08, q.z); scr.rotation.y = ry; G.scene.add(scr);
  }
  bl.cabinPos = P(d.c0 + 1.9, cl);
  bl.cabinDoorOut = P(d.c1 + 1.0, cl);
  if (!info.visit) { // closed beamline: shut cabin door, barrier in front of the hutch door, and a sign
    const cq = P(d.c1, cl); wallSeg(Sb, mat('#9aa3ab', { metalness: 0.4 }), cq.x, cq.z, 1.1, 0.12, 2.3, n.x, n.z);
    const bq = P(doorAt, d.ew + 0.9); wallSeg(Sb, MAT.hazard, bq.x, bq.z, 2.6, 0.12, 1.0, t.x, t.z);
    const sq = P(d.c1 + 1.5, cl);
    for (const back of [0, 1]) {
      const sg = textPlane([info.name, 'Not developed yet'], 2.2, 0.8, { bg: '#2b2f35', font: 'bold 100px Arial', sub: 'bold 52px Arial' });
      sg.position.set(sq.x - t.x * 0.03 * back, 1.75, sq.z - t.z * 0.03 * back); sg.rotation.y = ry + Math.PI * back; G.scene.add(sg);
    }
    Sb.box(MAT.grey, sq.x, 0.68, sq.z, 0.08, 1.36, 0.08, ry); addCircle(sq.x, sq.z, 0.2, 0, 2.2);
  }
  // info board with photo (or text) outside the cabin
  const bp = info.board ? P(info.board[0], info.board[1]) : P(d.c1 + 2.6, d.cl1 + 0.4);
  photoBoard(info.photo || null, bp.x, bp.z, ry, info.photo ? null : [info.name, info.tech, info.desc], info);
  if (info.photo2) { const bp2 = P(d.o1 - 1.5, d.ow + 2.2); photoBoard(info.photo2, bp2.x, bp2.z, Math.atan2(n.x, n.z), null, info); }
  bl.setShutter = (open) => {
    bl.shutter = open; bm.visible = open; lamp.material = open ? MAT.lampRed : MAT.lampGreen;
    pipeMat.emissive.set(open ? '#a07a10' : '#000000');
    bl.onShutter?.();
  };
  G.beamlines.push(bl);
  return bl;
}

function specialSlot(bl, d) {
  const { P, t, n } = bl; const ry = Math.atan2(t.x, t.z); const Sb = B.main;
  if (bl.info.construction) {
    // fenced construction site
    const d0 = d.o0, d1 = d.e1, l0 = -3, l1 = d.cl1;
    const fence = (pa, pb) => { const dx = pb.x - pa.x, dz = pb.z - pa.z; const L = Math.hypot(dx, dz); wallSeg(Sb, MAT.hazard, (pa.x + pb.x) / 2, (pa.z + pb.z) / 2, L, 0.15, 1.1, dx / L, dz / L); };
    fence(P(d0, l0), P(d1, l0)); fence(P(d0, l0), P(d0, l1)); fence(P(d0, l1), P(d1 - 6, l1)); fence(P(d1, l0), P(d1, l1 - 3));
    for (let k = 0; k < 7; k++) { const q = P(rand(d0 + 2, d1 - 2), rand(l0 + 1, l1 - 1)); const s = rand(0.8, 1.5); Sb.box(MAT.wood, q.x, s / 2, q.z, s, s, s, rand(0, 3)); addCircle(q.x, q.z, s * 0.6, 0, s); }
    for (let k = 0; k < 6; k++) { const q = P(d1 - 5 + k * 0.8, l1 - 1.5); Sb.add(new THREE.ConeGeometry(0.2, 0.6, 10), mat('#ff6a00'), M(q.x, 0.3, q.z)); }
    const sg = textPlane(['FUTURE BEAMLINE', 'construction site – hard hats required'], 5, 1.2, { bg: '#f2c40f', fg: '#111', font: 'bold 90px Arial' });
    const q = P((d0 + d1) / 2, l1 + 0.1); sg.position.set(q.x, 1.8, q.z); sg.rotation.y = Math.atan2(n.x, n.z); G.scene.add(sg);
    Sb.box(MAT.grey, q.x, 0.9, q.z, 0.1, 1.8, 0.1, ry);
    bl.center = P((d0 + d1) / 2, 2);
  } else {
    // visitor platform with photo boards
    const c0 = P(d.e0, 2);
    Sb.box(MAT.wood, c0.x, 0.15, c0.z, 7, 0.3, 10, ry);
    photoBoard('layout_ipac2016.jpg', P(d.e0 - 3, 4).x, P(d.e0 - 3, 4).z, ry);
    photoBoard('beamline_evenkolder.jpg', P(d.e0, 4.5).x, P(d.e0, 4.5).z, ry);
    photoBoard('aerial_2016.jpg', P(d.e0 + 3, 4).x, P(d.e0 + 3, 4).z, ry);
    bl.center = c0;
  }
}

// ---------------- Photo boards ----------------
const ASPECT = { 'aerial_2014b.jpg': 1.5, 'construction_2013b.jpg': 1.6, 'quadrupole_evenkolder.jpg': 1.78, 'beamline_evenkolder.jpg': 1.13, 'brunnshog_2017.jpg': 1.51, 'infomastern_1.jpg': 1.5, 'infomastern_2.jpg': 1.5, 'infomastern_3.jpg': 1.5, 'aerial_ring_2020.jpg': 1.5, 'building_2020b.jpg': 1.58, 'building_2022.jpg': 1.5, 'hall_2023.jpg': 1.69, 'nanomax.jpg': 1.63, 'biomax_robot.jpg': 1.33, 'biomax_kb_mirror.jpg': 1.33, 'linac.jpg': 1.01, 'r1_ring_inside.jpg': 1.33, 'construction_2013.jpg': 2.13, 'layout_ipac2016.jpg': 1.6, 'aerial_2016.jpg': 1.74, 'building_2016.jpg': 1.5, 'construction_2015a.jpg': 1.5, 'construction_2015b.jpg': 1.79, 'magnet_danfysik.jpg': 1.5, 'magnet_block.jpg': 1.5, 'aerial_2014.jpg': 2.01 };
// file: photo name; ry: facing direction; text: alt lines when no photo; wall: mount on a wall at height y
export function photoBoard(file, x, z, ry, text = null, info = null, wall = null) {
  const h = 1.9; const w = file ? Math.min(3.6, h * (ASPECT[file] || 1.5)) : 2.8;
  const y = wall ? wall : 2.0;
  const fx = Math.sin(ry), fz = Math.cos(ry);
  B.main.box(MAT.dark, x - fx * 0.04, y, z - fz * 0.04, w + 0.16, h + 0.16, 0.06, ry);
  if (!wall) { B.main.box(MAT.dark, x - fx * 0.1, (y - h / 2) / 2, z - fz * 0.1, 0.12, y - h / 2, 0.12, ry); addCircle(x, z, 0.25, 0, 3); }
  let m;
  if (file) m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: photo(file), toneMapped: false }));
  else m = textPlane([text[0], text[1]], w, h * 0.45, { bg: '#1c2430', font: 'bold 110px Arial', sub: 'bold 52px Arial' });
  m.position.set(x, file ? y : y + h * 0.2, z); m.rotation.y = ry; G.scene.add(m);
  if (!file) { const t2 = textPlane(['Press E to read more'], w, h * 0.3, { bg: '#2a3442', font: 'bold 60px Arial' }); t2.position.set(x, y - h * 0.25, z); t2.rotation.y = ry; G.scene.add(t2); }
  if (file && PHOTOS[file]) {
    const cap = textPlane([PHOTOS[file].cap.slice(0, 60)], w, 0.32, { bg: '#11161d', font: 'bold 48px Arial' });
    cap.position.set(x, y - h / 2 - 0.25, z); cap.rotation.y = ry; G.scene.add(cap);
  }
  G.interact.push({ x: x + fx * 1.2, z: z + fz * 1.2, r: 2.6, label: file ? 'View photo' : 'Read about ' + text[0], act: () => G.ui.showPhoto(file, info) });
}
