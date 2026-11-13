// People, vehicles and the tram.
import * as THREE from 'three';
import { clamp, lerp, rand, pick, angDiff, TAU, mat, bubbleSprite } from './util.js';
import { collide, groundY, lastNormal } from './physics.js';
import { G } from './state.js';
import { LOOP, TRAM, PHRASES } from './data.js';

// ---------------- Humanoids ----------------
const gBox = new THREE.BoxGeometry(1, 1, 1);
const gHead = new THREE.SphereGeometry(0.15, 12, 10);
const gHair = new THREE.SphereGeometry(0.158, 12, 8, 0, TAU, 0, Math.PI * 0.55);
const gHat = new THREE.SphereGeometry(0.175, 12, 8, 0, TAU, 0, Math.PI * 0.5);
const SKIN = ['#f1c7a5', '#d9a47c', '#a86f4c', '#6e4a32', '#f6d8c0'];
const HAIR = ['#2a1e16', '#6b4a2b', '#d9b26a', '#1a1a1a', '#9a9a9a', '#b5502b'];
const SHIRT = ['#2c6fbe', '#c23b3b', '#3c8a4a', '#7a5ab8', '#e0a030', '#2b2f35', '#4aa3b3', '#d86f9c'];
const PANTS = ['#26324a', '#3a3a3a', '#5a4632', '#2a3f2a', '#1d2a4a'];

function part(geo, color, sx, sy, sz, x, y, z, parent) {
  const m = new THREE.Mesh(geo, mat(color, { roughness: 0.8 })); m.scale.set(sx, sy, sz); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m;
}
export function makeHuman(o = {}) {
  const g = new THREE.Group();
  const skin = o.skin || pick(SKIN), shirt = o.shirt || pick(SHIRT), pants = o.pants || pick(PANTS);
  const legL = new THREE.Group(), legR = new THREE.Group(); legL.position.set(-0.11, 0.92, 0); legR.position.set(0.11, 0.92, 0);
  part(gBox, pants, 0.17, 0.88, 0.2, 0, -0.44, 0, legL); part(gBox, pants, 0.17, 0.88, 0.2, 0, -0.44, 0, legR);
  part(gBox, '#222222', 0.18, 0.08, 0.28, 0, -0.88, 0.04, legL); part(gBox, '#222222', 0.18, 0.08, 0.28, 0, -0.88, 0.04, legR);
  const body = new THREE.Group(); body.position.y = 0.92; g.add(body, legL, legR);
  part(gBox, shirt, 0.46, 0.62, 0.26, 0, 0.33, 0, body);
  if (o.coat) part(gBox, '#f4f6f7', 0.5, 0.95, 0.3, 0, 0.18, 0, body);
  if (o.vest) part(gBox, o.vest, 0.49, 0.48, 0.29, 0, 0.36, 0, body);
  if (o.backpack) part(gBox, o.backpack, 0.36, 0.42, 0.16, 0, 0.36, -0.2, body);
  const head = part(gHead, skin, 1, 1.08, 1, 0, 0.84, 0, body);
  if (o.hat) part(gHat, o.hat, 1, 1, 1, 0, 0.88, 0, body); else part(gHair, o.hair || pick(HAIR), 1, 1, 1, 0, 0.87, -0.01, body);
  const armL = new THREE.Group(), armR = new THREE.Group(); armL.position.set(-0.3, 0.6, 0); armR.position.set(0.3, 0.6, 0); body.add(armL, armR);
  const sleeve = o.coat ? '#f4f6f7' : shirt;
  part(gBox, sleeve, 0.13, 0.6, 0.15, 0, -0.28, 0, armL); part(gBox, sleeve, 0.13, 0.6, 0.15, 0, -0.28, 0, armR);
  part(gBox, skin, 0.11, 0.12, 0.12, 0, -0.62, 0, armL); part(gBox, skin, 0.11, 0.12, 0.12, 0, -0.62, 0, armR);
  return { g, legL, legR, armL, armR, body, head };
}
export function animHuman(h, phase, amt, carry) {
  const s = Math.sin(phase) * amt;
  h.legL.rotation.x = s; h.legR.rotation.x = -s;
  if (carry) { h.armL.rotation.x = h.armR.rotation.x = -1.2; }
  else { h.armL.rotation.x = -s * 0.8; h.armR.rotation.x = s * 0.8; }
  h.body.position.y = 0.92 + Math.abs(Math.cos(phase)) * amt * 0.06;
}

// ---------------- Player ----------------
export class Player {
  constructor() {
    this.h = makeHuman({ shirt: '#d8452f', pants: '#2a3550', skin: '#e9bf9b', hair: '#3a2a1c', backpack: '#2b2f35' });
    G.scene.add(this.h.g);
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.yaw = Math.PI; this.vy = 0;
    this.onGround = true; this.vehicle = null; this.phase = 0; this.knock = 0; this.carry = null;
    this.carryMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.45, 12), mat('#c9d3dc', { metalness: 0.6, roughness: 0.3 }));
    this.carryMesh.position.set(0, 0.25, 0.32); this.carryMesh.visible = false; this.h.body.add(this.carryMesh);
  }
  setCarry(kind) {
    this.carry = kind; this.carryMesh.visible = !!kind;
    if (kind === 'fika') { this.carryMesh.material = mat('#c9853e'); this.carryMesh.scale.set(1.3, 0.4, 1.0); }
    else { this.carryMesh.material = mat('#c9d3dc', { metalness: 0.6, roughness: 0.3 }); this.carryMesh.scale.set(1, 1, 1); }
  }
  update(dt, inp, camYaw) {
    const h = this.h;
    if (this.vehicle) { h.g.visible = this.vehicle.type === 'bike' || this.vehicle.type === 'scooter'; if (h.g.visible) this.rideBike(dt); return; }
    h.g.visible = true; h.g.rotation.z = 0;
    if (this.knock > 0) { // lying on the ground
      this.knock -= dt; h.g.rotation.x = -Math.PI / 2 * Math.min(1, (1.6 - this.knock) * 5); h.g.position.copy(this.pos); h.g.position.y += 0.2;
      if (this.knock <= 0) h.g.rotation.x = 0; return;
    }
    h.g.rotation.x = 0;
    const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw), rx = -fz, rz = fx;
    let mx = fx * inp.f + rx * inp.r, mz = fz * inp.f + rz * inp.r; const ml = Math.hypot(mx, mz);
    const sprint = inp.sprint && !this.carry; const sp = ml > 0.01 ? (sprint ? 9.2 : 5.0) * (this.carry ? 0.85 : 1) : 0;
    if (ml > 0.01) { mx /= ml; mz /= ml; }
    const acc = this.onGround ? 14 : 3;
    this.vel.x = lerp(this.vel.x, mx * sp, Math.min(1, acc * dt)); this.vel.z = lerp(this.vel.z, mz * sp, Math.min(1, acc * dt));
    const p = { x: this.pos.x + this.vel.x * dt, z: this.pos.z + this.vel.z * dt };
    collide(p, 0.38, this.pos.y, 1.8);
    this.pos.x = p.x; this.pos.z = p.z;
    // vertical
    const gy = groundY(this.pos.x, this.pos.z);
    if (this.onGround && inp.jump) { this.vy = 7.5; this.onGround = false; G.sfx?.('jump'); }
    this.vy -= 22 * dt; this.pos.y += this.vy * dt;
    if (this.pos.y <= gy) { this.pos.y = gy; this.vy = 0; this.onGround = true; }
    else if (this.pos.y - gy > 0.25) this.onGround = false;
    else if (this.vy <= 0) { this.pos.y = gy; this.onGround = true; }
    const spd = Math.hypot(this.vel.x, this.vel.z);
    if (spd > 0.3) this.yaw = this.yaw + angDiff(this.yaw, Math.atan2(this.vel.x, this.vel.z)) * Math.min(1, 12 * dt);
    this.phase += spd * dt * 2.1;
    animHuman(h, this.phase, this.onGround ? Math.min(0.9, spd * 0.12) : 0.3, !!this.carry);
    h.g.position.copy(this.pos); h.g.rotation.y = this.yaw;
  }
  rideBike(dt) {
    const v = this.vehicle, h = this.h;
    if (v.type === 'scooter') { // stand on the deck, one foot kicks while speeding up
      h.g.position.set(v.pos.x, v.pos.y + 0.19, v.pos.z); h.g.rotation.set(0, v.heading, v.lean || 0, 'YXZ');
      const kicking = this.kickT > 0; this.kickT = Math.max(0, (this.kickT || 0) - dt);
      this.phase += dt * 7;
      h.legL.rotation.x = 0.05; h.legR.rotation.x = kicking ? 0.5 + Math.sin(this.phase) * 0.55 : 0.12;
      h.armL.rotation.x = h.armR.rotation.x = -0.95; h.body.position.y = 0.92; return;
    }
    h.g.position.set(v.pos.x, v.pos.y + 0.35, v.pos.z); h.g.rotation.set(0, v.heading, v.lean || 0, 'YXZ');
    this.phase += v.speed * dt * 1.6;
    h.legL.rotation.x = -0.9 + Math.sin(this.phase) * 0.6; h.legR.rotation.x = -0.9 - Math.sin(this.phase) * 0.6;
    h.armL.rotation.x = h.armR.rotation.x = -1.0;
  }
  knockDown(dmg) {
    if (this.knock > 0 || this.vehicle) return;
    this.knock = 1.6; G.health -= dmg; G.sfx?.('hit');
  }
}

// ---------------- NPCs ----------------
export class NPC {
  constructor(kind, x, z) {
    this.kind = kind;
    const o = kind === 'scientist' ? { coat: true } : kind === 'tech' ? { vest: '#e8ff2a', hat: '#f5f5f5' } : kind === 'officer' ? { vest: '#ff8a00', hat: '#ffd000', shirt: '#22303f', pants: '#22303f' } : {};
    this.h = makeHuman(o); G.scene.add(this.h.g);
    this.pos = new THREE.Vector3(x, groundY(x, z), z); this.yaw = rand(0, TAU); this.phase = rand(0, 6);
    this.state = 'walk'; this.node = -1; this.target = null; this.wait = 0; this.vel = new THREE.Vector3(); this.vy = 0; this.t = 0;
    this.stuckT = 0; this.lastPos = { x, z }; this.bubble = null; this.bubbleT = 0; this.talkCD = rand(3, 12); this.speed = rand(1.2, 1.6);
    this.pickNearest();
  }
  pickNearest() {
    const N = G.nav.nodes; let best = 0, bd = 1e9;
    for (let i = 0; i < N.length; i++) { const d = Math.hypot(N[i].x - this.pos.x, N[i].z - this.pos.z); if (d < bd) { bd = d; best = i; } }
    this.node = best; this.prev = -1; this.target = N[best];
  }
  nextNode() {
    const N = G.nav.nodes; const nb = N[this.node].nb; if (!nb.length) return;
    let opts = nb.filter((k) => k !== this.prev); if (!opts.length) opts = nb;
    this.prev = this.node; this.node = pick(opts); this.target = N[this.node];
    this.tx = this.target.x + rand(-1.2, 1.2); this.tz = this.target.z + rand(-1.2, 1.2);
  }
  say(text, color) {
    if (this.bubble) this.h.g.remove(this.bubble);
    this.bubble = bubbleSprite(text, color); this.bubble.position.y = 2.45; this.h.g.add(this.bubble); this.bubbleT = 3.2;
  }
  knock(vx, vz, power) {
    if (this.state === 'knocked') return;
    this.state = 'knocked'; this.vel.set(vx, 0, vz); this.vy = Math.min(9, power * 0.35 + 2); this.t = 3.2; this.say(pick(PHRASES.hit), '#ff8a8a'); G.sfx?.('hit');
  }
  update(dt, player) {
    const h = this.h; this.t -= dt;
    if (this.bubbleT > 0) { this.bubbleT -= dt; if (this.bubbleT <= 0 && this.bubble) { h.g.remove(this.bubble); this.bubble = null; } }
    const pp = player.vehicle ? player.vehicle.pos : player.pos;
    const dpx = pp.x - this.pos.x, dpz = pp.z - this.pos.z, dP = Math.hypot(dpx, dpz);
    let mx = 0, mz = 0, sp = 0;
    if (this.state === 'knocked') {
      this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt; this.vel.multiplyScalar(Math.max(0, 1 - 2.5 * dt));
      this.vy -= 22 * dt; this.pos.y += this.vy * dt; const gy = groundY(this.pos.x, this.pos.z); if (this.pos.y < gy) { this.pos.y = gy; this.vy = 0; }
      const p = { x: this.pos.x, z: this.pos.z }; collide(p, 0.35, this.pos.y, 1.8); this.pos.x = p.x; this.pos.z = p.z;
      h.g.rotation.x = lerp(h.g.rotation.x, -Math.PI / 2, Math.min(1, dt * 8)); h.g.position.copy(this.pos); h.g.position.y += 0.18;
      if (this.t <= 0) { h.g.rotation.x = 0; this.state = this.kind === 'officer' ? 'chase' : 'flee'; this.t = 5; }
      return;
    }
    if (this.state === 'chase') { mx = dpx; mz = dpz; sp = 6.6 + G.wanted * 0.45; if (dP < 1.1) sp = 0; }
    else if (this.state === 'flee') { mx = -dpx; mz = -dpz; sp = 4.2; if (this.t <= 0) { this.state = 'walk'; this.pickNearest(); } }
    else if (this.state === 'leave') { mx = -dpx; mz = -dpz; sp = 2.5; }
    else {
      if (this.wait > 0) { this.wait -= dt; }
      else {
        if (this.tx === undefined) { this.tx = this.target.x; this.tz = this.target.z; }
        mx = this.tx - this.pos.x; mz = this.tz - this.pos.z; sp = this.speed;
        if (Math.hypot(mx, mz) < 0.8) { if (Math.random() < 0.15) this.wait = rand(1.5, 5); this.nextNode(); }
      }
      // chatter
      this.talkCD -= dt;
      if (this.talkCD < 0 && dP < 7 && !player.vehicle) { this.say(G.ring.beamOn ? pick(PHRASES.idle) : pick(PHRASES.angry)); this.talkCD = rand(10, 25); }
      // dodge fast cars
      if (player.vehicle && Math.abs(player.vehicle.speed) > 6 && dP < 9) { mx = -dpx; mz = -dpz; sp = 3.5; }
    }
    const ml = Math.hypot(mx, mz);
    if (ml > 0.01 && sp > 0) { mx /= ml; mz /= ml; } else { mx = mz = 0; sp = 0; }
    const p = { x: this.pos.x + mx * sp * dt, z: this.pos.z + mz * sp * dt };
    collide(p, 0.33, this.pos.y, 1.8);
    // avoid the player
    if (!player.vehicle && dP < 0.75 && dP > 0.001) { p.x -= dpx / dP * (0.75 - dP); p.z -= dpz / dP * (0.75 - dP); }
    this.pos.x = p.x; this.pos.z = p.z; this.pos.y = groundY(p.x, p.z);
    // stuck detection
    this.stuckT += dt;
    if (this.stuckT > 2.5) { if (this.state === 'walk' && Math.hypot(this.pos.x - this.lastPos.x, this.pos.z - this.lastPos.z) < 0.5 && this.wait <= 0) { this.pickNearest(); this.nextNode(); } this.stuckT = 0; this.lastPos = { x: this.pos.x, z: this.pos.z }; }
    if (sp > 0) this.yaw += angDiff(this.yaw, Math.atan2(mx, mz)) * Math.min(1, dt * 8);
    this.phase += sp * dt * 2.2;
    animHuman(h, this.phase, Math.min(0.9, sp * 0.13), false);
    h.g.position.copy(this.pos); h.g.rotation.set(0, this.yaw, 0);
  }
  dispose() { G.scene.remove(this.h.g); }
}

// ---------------- Vehicles ----------------
export const VT = {
  car: { len: 4.5, wid: 1.85, max: 32, acc: 10, brake: 22, turn: 1.9, crime: true, label: 'car' },
  van: { len: 5.3, wid: 2.05, max: 25, acc: 7.5, brake: 18, turn: 1.6, crime: true, label: 'van' },
  cart: { len: 2.6, wid: 1.3, max: 10, acc: 6, brake: 14, turn: 2.4, crime: false, label: 'facility cart' },
  bike: { len: 1.8, wid: 0.6, max: 12, acc: 5, brake: 12, turn: 2.6, crime: false, label: 'bike' },
  scooter: { len: 1.1, wid: 0.5, max: 8.5, acc: 4.5, brake: 10, turn: 2.7, crime: false, label: 'scooter' },
};
const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.26, 14); wheelGeo.rotateZ(Math.PI / 2);
const CAR_COL = ['#c9ccd0', '#1c1f24', '#8e1b1b', '#24467a', '#e8e8e8', '#3d5f3a', '#6b6f75', '#b3872d', '#7a2f5c'];
export function vehModel(type, color) {
  const g = new THREE.Group(); const T = VT[type];
  const M = (geo, c, sx, sy, sz, x, y, z, o) => { const m = new THREE.Mesh(geo, mat(c, o || { roughness: 0.4, metalness: 0.3 })); m.scale.set(sx, sy, sz); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
  const wheels = [];
  if (type === 'scooter') { // two-wheeled kick scooter: orange deck, black stem and handlebar, big black wheels
    const tg = new THREE.TorusGeometry(0.1, 0.035, 8, 18); tg.rotateY(Math.PI / 2);
    for (const z of [-0.36, 0.4]) { const w = new THREE.Mesh(tg, mat('#151515')); w.position.set(0, 0.135, z); g.add(w); wheels.push(w);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.06, 10), mat('#2b2b2b')); hub.rotation.z = Math.PI / 2; hub.position.copy(w.position); g.add(hub); }
    M(gBox, color, 0.16, 0.05, 0.62, 0, 0.16, 0.0); M(gBox, '#2a2a2a', 0.13, 0.012, 0.5, 0, 0.19, -0.02);
    const neck = M(gBox, color, 0.08, 0.08, 0.26, 0, 0.24, 0.33); neck.rotation.x = -0.75;
    const stem = M(new THREE.CylinderGeometry(0.025, 0.025, 1, 10), '#1a1a1a', 1, 0.82, 1, 0, 0.72, 0.44); stem.rotation.x = -0.08;
    const bar = M(new THREE.CylinderGeometry(0.018, 0.018, 1, 10), '#1a1a1a', 1, 0.5, 1, 0, 1.12, 0.47); bar.rotation.z = Math.PI / 2;
    for (const x of [-0.22, 0.22]) { const grip = M(new THREE.CylinderGeometry(0.028, 0.028, 1, 10), '#333333', 1, 0.11, 1, x, 1.12, 0.47); grip.rotation.z = Math.PI / 2; }
    M(gBox, '#e06010', 0.05, 0.05, 0.05, 0, 0.6, 0.45);
    const fender = M(gBox, '#1a1a1a', 0.08, 0.02, 0.26, 0, 0.26, -0.36); fender.rotation.x = 0.15;
  } else if (type === 'bike') {
    const tg = new THREE.TorusGeometry(0.33, 0.04, 6, 16); tg.rotateY(Math.PI / 2);
    for (const z of [-0.55, 0.55]) { const w = new THREE.Mesh(tg, mat('#1a1a1a')); w.position.set(0, 0.36, z); g.add(w); wheels.push(w); }
    M(gBox, color, 0.06, 0.06, 1.0, 0, 0.62, 0); M(gBox, color, 0.06, 0.5, 0.06, 0, 0.55, -0.2); M(gBox, '#222', 0.5, 0.04, 0.04, 0, 1.0, 0.45);
    M(gBox, '#222', 0.18, 0.06, 0.26, 0, 0.88, -0.25); M(gBox, color, 0.05, 0.55, 0.05, 0, 0.72, 0.42);
  } else {
    const L = T.len, Wd = T.wid; const isVan = type === 'van', isCart = type === 'cart';
    M(gBox, color, Wd, isCart ? 0.35 : 0.65, L, 0, isCart ? 0.45 : 0.62, 0);
    if (isCart) { M(gBox, '#dddddd', Wd * 0.95, 0.08, L * 0.7, 0, 2.0, -0.1); for (const x of [-1, 1]) for (const z of [-1, 1]) M(gBox, '#888', 0.05, 1.4, 0.05, x * Wd * 0.44, 1.3, z * L * 0.3 - 0.1); M(gBox, '#333', Wd * 0.8, 0.5, 0.5, 0, 0.85, -0.45); }
    else if (isVan) { M(gBox, color, Wd * 0.98, 1.25, L * 0.78, 0, 1.55, -L * 0.1); M(gBox, '#1d2a35', Wd * 0.9, 0.55, 0.05, 0, 1.6, L * 0.3, { roughness: 0.1, metalness: 0.6 }); }
    else { M(gBox, color, Wd * 0.9, 0.55, L * 0.5, 0, 1.2, -L * 0.06); M(gBox, '#1d2a35', Wd * 0.86, 0.45, 0.05, 0, 1.2, L * 0.19, { roughness: 0.1, metalness: 0.6 }); M(gBox, '#1d2a35', Wd * 0.92, 0.4, L * 0.44, 0, 1.22, -L * 0.06, { roughness: 0.1, metalness: 0.6 }); }
    M(gBox, '#fff6d0', 0.35, 0.14, 0.05, -Wd * 0.33, 0.7, L / 2, { emissive: '#fff2b0', emissiveIntensity: 0.6 }); M(gBox, '#fff6d0', 0.35, 0.14, 0.05, Wd * 0.33, 0.7, L / 2, { emissive: '#fff2b0', emissiveIntensity: 0.6 });
    M(gBox, '#a01010', 0.35, 0.12, 0.05, -Wd * 0.33, 0.75, -L / 2, { emissive: '#600', emissiveIntensity: 0.5 }); M(gBox, '#a01010', 0.35, 0.12, 0.05, Wd * 0.33, 0.75, -L / 2, { emissive: '#600', emissiveIntensity: 0.5 });
    for (const x of [-1, 1]) for (const z of [-1, 1]) { const w = new THREE.Mesh(wheelGeo, mat('#151515')); w.position.set(x * Wd * 0.47, 0.34, z * L * 0.32); g.add(w); wheels.push(w); }
    if (isVan) { const lab = makeLabel('MAX IV LOGISTICS'); lab.position.set(Wd * 0.5 + 0.01, 1.55, -L * 0.1); lab.rotation.y = Math.PI / 2; g.add(lab); const l2 = lab.clone(); l2.position.x = -Wd * 0.5 - 0.01; l2.rotation.y = -Math.PI / 2; g.add(l2); }
  }
  return { g, wheels };
}
let labelMat = null;
function makeLabel(t) {
  if (!labelMat) { const c = document.createElement('canvas'); c.width = 512; c.height = 96; const x = c.getContext('2d'); x.fillStyle = '#1b2733'; x.font = 'bold 60px Arial'; x.textAlign = 'center'; x.fillText(t, 256, 66); const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; labelMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true }); }
  return new THREE.Mesh(new THREE.PlaneGeometry(3, 0.56), labelMat);
}

export class Vehicle {
  constructor(type, x, z, heading, color) {
    this.type = type; this.T = VT[type]; this.color = color || (type === 'scooter' ? pick(['#ff6a1a', '#ff6a1a', '#ff6a1a', '#2f7fd0', '#8a4fd8']) : type === 'cart' ? '#f2f2f2' : type === 'van' ? '#f4f4f4' : type === 'bike' ? pick(['#1f5fa8', '#b52a2a', '#2a7a3a', '#222']) : pick(CAR_COL));
    const m = vehModel(type, this.color); this.g = m.g; this.wheels = m.wheels; G.scene.add(this.g);
    this.pos = new THREE.Vector3(x, groundY(x, z), z); this.heading = heading; this.speed = 0; this.steer = 0; this.ai = null; this.driver = false;
    this.r = this.T.wid / 2 + 0.05; this.lean = 0; this.hp = 100; this.honkT = 0;
    this.sync();
  }
  circles() {
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading); const off = this.type === 'bike' || this.type === 'scooter' ? 0 : this.T.len / 2 - this.r;
    return off ? [{ x: this.pos.x + fx * off, z: this.pos.z + fz * off }, { x: this.pos.x - fx * off, z: this.pos.z - fz * off }] : [{ x: this.pos.x, z: this.pos.z }];
  }
  drive(dt, inp) {
    const T = this.T;
    if (inp.f > 0) this.speed += (this.speed < 0 ? T.brake : T.acc) * dt;
    else if (inp.f < 0) this.speed -= (this.speed > 0 ? T.brake : T.acc * 0.6) * dt;
    else this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), 3 * dt);
    if (inp.jump) this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), 25 * dt);
    this.speed = clamp(this.speed, -T.max * 0.3, T.max);
    this.steer = lerp(this.steer, -inp.r, Math.min(1, 6 * dt));
    this.move(dt);
  }
  move(dt) {
    const T = this.T; const sp = this.speed;
    this.heading += this.steer * T.turn * dt * clamp(Math.abs(sp) / 5, 0, 1) * Math.sign(sp) * (1 - clamp(Math.abs(sp) / T.max, 0, 1) * 0.35);
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    this.pos.x += fx * sp * dt; this.pos.z += fz * sp * dt;
    // world collisions
    let hit = false; const cs = this.circles();
    for (const c of cs) {
      const p = { x: c.x, z: c.z };
      if (collide(p, this.r, this.pos.y + 0.2, 1.4)) { hit = true; this.pos.x += p.x - c.x; this.pos.z += p.z - c.z; }
    }
    if (hit && Math.abs(sp) > 1) {
      const n = lastNormal; const along = fx * n.x + fz * n.z;
      if (along < -0.5) { if (Math.abs(sp) > 8) { G.sfx?.('crash'); this.hp -= Math.abs(sp); if (this === G.player.vehicle) G.ui?.shake(Math.abs(sp) / 30); } this.speed *= -0.25; }
      else this.speed *= 0.92;
    }
    this.pos.y = groundY(this.pos.x, this.pos.z);
    this.lean = this.type === 'bike' || this.type === 'scooter' ? lerp(this.lean, -this.steer * clamp(sp / 10, 0, 1) * 0.35, Math.min(1, 6 * dt)) : 0;
    this.sync(dt);
  }
  sync(dt = 0) {
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading); const hl = this.T.len * 0.4;
    const yf = groundY(this.pos.x + fx * hl, this.pos.z + fz * hl), yb = groundY(this.pos.x - fx * hl, this.pos.z - fz * hl);
    this.g.position.copy(this.pos); this.g.position.y = (yf + yb) / 2;
    this.g.rotation.set(-Math.atan2(yf - yb, hl * 2), this.heading, this.lean, 'YXZ');
    for (const w of this.wheels) w.rotation.x += this.speed * dt / 0.34;
  }
  // traffic: follow the ring road
  aiUpdate(dt, path, player) {
    const ai = this.ai; const N = path.pts.length;
    // look ahead point
    let s = ai.s + ai.dir * 9; const p = path.at(s, ai.dir);
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
    const want = Math.atan2(dx, dz);
    this.steer = clamp(angDiff(this.heading, want) * 2.2 / this.T.turn, -1, 1);
    // obstacle check
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    let block = false;
    const chk = (ox, oz, rad) => { const ex = ox - this.pos.x, ez = oz - this.pos.z; const fwd = ex * fx + ez * fz; const lat = Math.abs(-ex * fz + ez * fx); if (fwd > 0 && fwd < 11 && lat < rad) block = true; };
    const pp = player.vehicle ? player.vehicle.pos : player.pos; chk(pp.x, pp.z, 2.2);
    for (const v of G.vehicles) if (v !== this) chk(v.pos.x, v.pos.z, 1.8);
    for (const n of G.npcs) if (Math.abs(n.pos.x - this.pos.x) < 12 && Math.abs(n.pos.z - this.pos.z) < 12) chk(n.pos.x, n.pos.z, 1.6);
    const target = block ? 0 : ai.cruise;
    this.speed = lerp(this.speed, target, Math.min(1, (target < this.speed ? 3.5 : 0.8) * dt));
    if (block && player.pos && Math.hypot(pp.x - this.pos.x, pp.z - this.pos.z) < 9) { this.honkT -= dt; if (this.honkT < 0) { G.sfx?.('honk'); this.honkT = 3; } }
    this.move(dt);
    // advance s to the nearest path parameter
    ai.s = path.nearest(this.pos.x, this.pos.z, ai.s);
  }
  dispose() { G.scene.remove(this.g); }
}

// Closed path utility for traffic
export class LoopPath {
  constructor(pts, lane) {
    // resample to ~2 m
    const out = []; const n = pts.length;
    for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); const k = Math.max(1, Math.round(L / 2)); for (let j = 0; j < k; j++) out.push([a[0] + (b[0] - a[0]) * j / k, a[1] + (b[1] - a[1]) * j / k]); }
    this.pts = out; this.lane = lane;
  }
  at(s, dir) {
    const N = this.pts.length; s = ((s % N) + N) % N; const i = Math.floor(s), f = s - i;
    const a = this.pts[i], b = this.pts[(i + 1) % N]; const x = a[0] + (b[0] - a[0]) * f, z = a[1] + (b[1] - a[1]) * f;
    let tx = (b[0] - a[0]) * dir, tz = (b[1] - a[1]) * dir; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    return { x: x - tz * this.lane, z: z + tx * this.lane };
  }
  nearest(x, z, s0) {
    const N = this.pts.length; let best = s0, bd = 1e9;
    for (let k = -6; k <= 6; k++) { const i = ((Math.round(s0) + k) % N + N) % N; const p = this.pts[i]; const d = (p[0] - x) ** 2 + (p[1] - z) ** 2; if (d < bd) { bd = d; best = i; } }
    return best;
  }
}

// ---------------- Tram ----------------
export class Tram {
  constructor() {
    const g = new THREE.Group(); const L = 32, Wd = 2.65;
    const body = new THREE.Mesh(gBox, mat('#f4f5f2', { roughness: 0.4, metalness: 0.2 })); body.scale.set(L, 2.9, Wd); body.position.y = 1.85; body.castShadow = true; g.add(body);
    const win = new THREE.Mesh(gBox, mat('#1d2a35', { roughness: 0.1, metalness: 0.6 })); win.scale.set(L - 1, 1.0, Wd + 0.04); win.position.y = 2.3; g.add(win);
    const stripe = new THREE.Mesh(gBox, mat('#1a7a4c')); stripe.scale.set(L + 0.02, 0.3, Wd + 0.05); stripe.position.y = 1.1; g.add(stripe);
    for (const x of [-L / 2, L / 2]) { const n = new THREE.Mesh(gBox, mat('#1a7a4c')); n.scale.set(0.3, 2.9, Wd); n.position.set(x, 1.85, 0); g.add(n); }
    for (const x of [-L / 3, 0, L / 3]) { const j = new THREE.Mesh(gBox, mat('#222')); j.scale.set(0.4, 2.8, Wd + 0.06); j.position.set(x, 1.85, 0); g.add(j); }
    const pant = new THREE.Mesh(gBox, mat('#333')); pant.scale.set(1.6, 0.1, 0.1); pant.position.set(0, 4.6, 0); pant.rotation.z = 0.4; g.add(pant);
    G.scene.add(g); this.g = g; this.L = L; this.x = TRAM.stopX + 2; this.dir = 1; this.speed = 0; this.wait = 6; this.z = TRAM.z;
    this.stops = [TRAM.x0 + 30, TRAM.stopX, TRAM.essX, TRAM.x1 - 30];
    g.position.set(this.x, 0.15, this.z);
  }
  update(dt, player) {
    if (this.wait > 0) { this.wait -= dt; if (this.wait <= 0) G.sfx?.('tram'); }
    else {
      const ahead = this.stops.filter((s) => (s - this.x) * this.dir > 1).sort((a, b) => Math.abs(a - this.x) - Math.abs(b - this.x))[0];
      const dist = ahead !== undefined ? Math.abs(ahead - this.x) : 0;
      let target = 15; if (dist < 60) target = Math.max(1.2, dist * 0.25);
      // something on the track?
      const pp = player.vehicle ? player.vehicle.pos : player.pos;
      const fr = this.x + this.dir * this.L / 2; const ahd = (pp.x - fr) * this.dir;
      if (Math.abs(pp.z - this.z) < 2.6 && ahd > 0 && ahd < 25) { target = 0; this.bell = (this.bell || 0) - dt; if (this.bell < 0) { G.sfx?.('tram'); this.bell = 2; } }
      for (const v of G.vehicles) { const a2 = (v.pos.x - fr) * this.dir; if (Math.abs(v.pos.z - this.z) < 2.6 && a2 > 0 && a2 < 25) target = 0; }
      this.speed = lerp(this.speed, target, Math.min(1, dt * 0.8));
      this.x += this.dir * this.speed * dt;
      if (ahead === undefined || dist < 0.6) { this.wait = 9; this.speed = 0; if (ahead === this.stops[0] || ahead === this.stops[3] || ahead === undefined) this.dir *= -1; }
    }
    this.g.position.x = this.x;
    // push / knock the player
    const pp = player.vehicle ? player.vehicle.pos : player.pos;
    if (Math.abs(pp.z - this.z) < 1.33 + 0.4 && Math.abs(pp.x - this.x) < this.L / 2 + 0.4 && pp.y < 4) {
      const side = pp.z < this.z ? -1 : 1; const push = 1.33 + 0.45 - Math.abs(pp.z - this.z);
      if (player.vehicle) { player.vehicle.pos.z += side * push; player.vehicle.speed *= 0.5; }
      else { player.pos.z += side * push; if (this.speed > 3) player.knockDown(25); }
    }
  }
}
