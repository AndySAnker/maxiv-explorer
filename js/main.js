// MAX IV Explorer – an open-world romp around the MAX IV synchrotron in Lund, Sweden.
import * as THREE from 'three';
import { RoomEnvironment } from '../vendor/addons/environments/RoomEnvironment.js';
import { G } from './state.js';
import { earn, charge, canPay, fmt, PRICE } from './economy.js';
import { clamp, lerp, rand, pick, angDiff, TAU, DEG } from './util.js';
import { buildGrid, blocked, groundY, collide } from './physics.js';
import { initBatchers, finishBatchers } from './build.js';
import { buildSite, W } from './site.js';
import { Player, NPC, Vehicle, LoopPath, Tram } from './actors.js';
import { initHUD, updateHUD } from './hud.js';
import { initAudio, engineSound, sfx } from './audio.js';
import { initMissions, updateMissions, missionInteract, failMission, dumpBeam, spawnVehicle, MS } from './missions.js';
import { LOOP, PHRASES, R3, PARKING } from './data.js';
import { initCoSAXSUI, openExperiment, pipPose } from './cosaxs.js';
import { initNet, netTick, openChat, initChatInput } from './net.js';
import { initAnalyse } from './cosaxs_analysis.js';

// ---------------- renderer / scene ----------------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.82;
const scene = new THREE.Scene(); G.scene = scene; G.renderer = renderer;
scene.fog = new THREE.Fog('#d4e6f4', 260, 1700);
const pmrem = new THREE.PMREMGenerator(renderer); scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.3;
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 6000); G.camera = camera;
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

const hemi = new THREE.HemisphereLight('#cfe3ff', '#56653f', 0.6); scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff1dc', 1.9); sun.castShadow = true; G.sun = sun;
sun.shadow.mapSize.set(2048, 2048); const SC = sun.shadow.camera; SC.left = SC.bottom = -70; SC.right = SC.top = 70; SC.near = 10; SC.far = 400;
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04; scene.add(sun, sun.target);
const SUN_DIR = new THREE.Vector3(-0.45, 0.78, 0.43).normalize();

// ---------------- build world (staged, with a loading bar) ----------------
const load = document.getElementById('loadtxt'), bar = document.getElementById('loadbar');
let player, road, tram;
const tick = (p, label) => { bar.style.width = (p * 100).toFixed(0) + '%'; load.textContent = label; return new Promise((r) => setTimeout(r, 0)); };
async function boot() {
  const t0 = performance.now();
  initBatchers(scene);
  await buildSite(scene, tick);
  await tick(0.8, 'Merging geometry…');
  finishBatchers(); buildGrid(); initCoSAXSUI(); initAnalyse(); initHUD();
  await tick(0.86, 'Waking up the scientists…');
  spawnActors();
  setupInteractables();
  await tick(0.92, 'Warming up the GPU…');
  updateCamera(0.016);
  try { if (renderer.compileAsync) await renderer.compileAsync(scene, camera); else renderer.compile(scene, camera); } catch (e) { console.warn(e); }
  await tick(1, 'Ready');
  console.log('[build] total ms', Math.round(performance.now() - t0));
  document.getElementById('startbtn').disabled = false; document.getElementById('title').classList.add('ready');
  frame();
}
function spawnActors() {
player = new Player(); G.player = player;
player.pos.set(150, 0, 35); player.yaw = Math.PI; // on the plaza, facing the main entrance
window.__G = G;

// people
const kinds = ['scientist', 'scientist', 'scientist', 'tech', 'tech', 'visitor', 'visitor', 'visitor'];
for (let i = 0; i < 48; i++) { const n = pick(G.nav.nodes); G.npcs.push(new NPC(pick(kinds), n.x + rand(-2, 2), n.z + rand(-2, 2))); }
// kick scooters (no cars or bikes on site)
const SCOOTERS = [[121, 31, 0], [122.4, 31, 0], [123.8, 31, 0], [125.2, 31, 0], [127, 31, 0], [176, 31, 0], [177.4, 31, 0],
  [10.6, 127.2, Math.PI], [11.8, 127.2, Math.PI], [13, 127.2, Math.PI], [14.2, 127.2, Math.PI], [140, 160, Math.PI / 2], [142, 160, Math.PI / 2],
  [108, 10, Math.PI], [108, -12, 0], [-108, -12, 0], [10, -108, -Math.PI / 2], [-12, 108, Math.PI / 2], [-118, -60, Math.PI], [2, -158, 0], [-110, -100, 0], [150, 62, 0], [20, 20, 1]];
for (const [x, z, h] of SCOOTERS) spawnVehicle('scooter', x, z, h);
road = new LoopPath(LOOP, 2.6);
tram = new Tram();
initMissions();

}

// ---------------- input ----------------
const keys = {}; let mouseT = 99; let camYaw = 0, camPitch = 0.32, camDist = 5.5, curDist = 5.5, zoomMode = 1;
let started = false; G.paused = true;
try { document.getElementById('nameIn').value = localStorage.getItem('beamtime.name') || ''; } catch { /* storage unavailable */ }
window.__cam = (y, p, d) => { camYaw = y; camPitch = p; camDist = d; mouseT = 0; };
addEventListener('keydown', (e) => {
  if (!started) return;
  const tg = e.target; if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.tagName === 'SELECT')) return;
  keys[e.code] = true;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  if (G.ui.overlayOpen()) { if (['Escape', 'KeyE', 'KeyM', 'KeyH', 'Enter'].includes(e.code)) { G.ui.closeOverlays(); keys.KeyE = false; } return; }
  if (e.code === 'KeyF') enterExit();
  if (e.code === 'KeyT') { e.preventDefault(); openChat(); }
  if (e.code === 'KeyM') G.ui.toggle('mapov');
  if (e.code === 'KeyH' || e.code === 'Escape') G.ui.toggle('helpov');
  if (e.code === 'KeyC') { zoomMode = (zoomMode + 1) % 3; }
  if (e.code === 'KeyE') eDown = true;
});
addEventListener('keyup', (e) => { keys[e.code] = false; if (e.code === 'KeyE') { eDown = false; holdT = 0; } });
let dragging = false;
canvas.addEventListener('mousedown', () => { if (!started) return; if (!document.pointerLockElement) { try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch {} } dragging = true; });
addEventListener('mouseup', () => (dragging = false));
addEventListener('mousemove', (e) => {
  if (!started || G.ui.overlayOpen()) return;
  if (document.pointerLockElement === canvas || dragging) {
    camYaw -= e.movementX * 0.0028; camPitch = clamp(camPitch + e.movementY * 0.0022, -0.15, 1.25); mouseT = 0;
  }
});
addEventListener('wheel', (e) => { camDist = clamp(camDist + Math.sign(e.deltaY) * 0.8, 3, 16); }, { passive: true });
document.getElementById('startbtn').addEventListener('click', () => {
  const raw = Array.from(document.getElementById('nameIn').value || '').filter((ch) => { const c = ch.codePointAt(0); return c >= 32 && !(c >= 0x7f && c <= 0x9f) && !(c >= 0x200b && c <= 0x200f) && !(c >= 0x2028 && c <= 0x202e) && !(c >= 0x2060 && c <= 0x206f) && c !== 0xfeff && c !== 0xad; }).join('').trim().slice(0, 20);
  const myName = raw || 'Guest ' + Math.floor(100 + Math.random() * 900);
  try { localStorage.setItem('beamtime.name', myName); } catch { /* storage unavailable */ }
  G.myName = myName; initNet(myName); initChatInput();
  started = true; G.paused = false; const ttl = document.getElementById('title'); ttl.classList.add('gone'); setTimeout(() => (ttl.style.display = 'none'), 900); initAudio(); try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch {}
});
function inputState() {
  const k = keys;
  return {
    f: (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0),
    r: (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0),
    sprint: !!(k.ShiftLeft || k.ShiftRight), jump: !!k.Space,
  };
}

// ---------------- vehicles: enter / exit ----------------
function enterExit() {
  const v = player.vehicle;
  if (v) {
    if (Math.abs(v.speed) > 4 && v.type !== 'bike' && v.type !== 'scooter') { G.ui.toast('Slow down before jumping out!'); return; }
    const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
    for (const side of [1, -1]) {
      const off = v.T.wid / 2 + 0.7; const p = { x: v.pos.x + fz * off * side, z: v.pos.z - fx * off * side };
      if (!blocked(p.x, p.z, v.pos.y + 0.5, 0.35)) { player.pos.set(p.x, groundY(p.x, p.z), p.z); break; }
      if (side === -1) player.pos.set(v.pos.x, v.pos.y + 0.0, v.pos.z);
    }
    v.speed = 0;
    player.vehicle = null; player.yaw = v.heading;
    return;
  }
  let best = null, bd = 3.6;
  for (const c of G.vehicles) { const d = Math.hypot(c.pos.x - player.pos.x, c.pos.z - player.pos.z) - (c.T.len / 2) * 0.6; if (d < bd) { bd = d; best = c; } }
  if (!best) return;
  if (player.carry === 'dewar' && best.type === 'bike') { G.ui.toast('You can’t ride a bike while carrying a dewar.'); return; }
  if (best.driver) { // carjacking!
    best.driver = false; best.ai = null;
    const fx = Math.sin(best.heading), fz = Math.cos(best.heading);
    const n = new NPC('visitor', best.pos.x + fz * 2, best.pos.z - fx * 2); n.state = 'flee'; n.t = 6; n.say(pick(['My car!!', 'Hey! That’s my Volvo-ish thing!', 'Thief!', 'I’m calling the safety office!']), '#ff8a8a'); G.npcs.push(n);
    crime(1, 'Vehicle theft!');
  }
  player.vehicle = best; best.speed = Math.min(best.speed, 3); player.setCarry(player.carry);
  mouseT = 99;
}

// ---------------- crimes & safety officers ----------------
function crime(n, why) {
  const before = G.wanted; G.wanted = clamp(G.wanted + n, 0, 5); G.wantedCool = 0;
  if (G.wanted > before) { G.ui.toast(`<span class="bad">☢ SAFETY ALERT:</span> ${why}`); sfx('star'); }
}
G.crime = crime;
function updateWanted(dt) {
  const pp = player.vehicle ? player.vehicle.pos : player.pos;
  const want = G.wanted > 0 ? Math.min(8, G.wanted * 2) : 0;
  const chasing = G.officers.filter((o) => o.state === 'chase' || o.state === 'knocked');
  if (chasing.length < want && Math.random() < dt * 1.5) {
    const cand = G.nav.nodes.filter((n) => { const d = Math.hypot(n.x - pp.x, n.z - pp.z); return d > 35 && d < 85; });
    const n = cand.length ? pick(cand) : { x: pp.x + 50, z: pp.z };
    const o = new NPC('officer', n.x, n.z); o.state = 'chase'; o.say(pick(PHRASES.officer), '#ffd27a'); G.officers.push(o);
  }
  let near = false;
  for (const o of G.officers) {
    const d = Math.hypot(o.pos.x - pp.x, o.pos.z - pp.z);
    if (d < 30) near = true;
    if (o.state === 'chase' && G.wanted > 0) {
      const v = player.vehicle;
      if ((!v && d < 1.25 && player.knock <= 0) || (v && d < v.T.wid / 2 + 1.4 && Math.abs(v.speed) < 1.5)) { G.bustT = (G.bustT || 0) + dt; if (G.bustT > 0.5) return busted(); }
    }
  }
  if (!G.officers.some((o) => Math.hypot(o.pos.x - pp.x, o.pos.z - pp.z) < 1.6)) G.bustT = 0;
  if (G.wanted > 0) {
    G.wantedCool += dt * (near ? 0.15 : 1);
    if (G.wantedCool > 14) { G.wanted--; G.wantedCool = 0; if (G.wanted === 0) G.ui.toast('The safety officers lost track of you.'); }
  }
  if (G.wanted === 0) for (const o of G.officers) if (o.state === 'chase') { o.state = 'leave'; }
  G.officers = G.officers.filter((o) => { const d = Math.hypot(o.pos.x - pp.x, o.pos.z - pp.z); if (o.state === 'leave' && d > 45) { o.dispose(); return false; } return true; });
}
function respawn(title, sub, fine) {
  if (player.vehicle) { player.vehicle.speed = 0; player.vehicle = null; }
  failMission('');
  charge(fine); G.wanted = 0; G.health = 100; player.knock = 0; player.setCarry(null);
  for (const o of G.officers) o.dispose(); G.officers = [];
  player.pos.set(150, 0, 18.5); player.vel.set(0, 0, 0); camYaw = 0;
  G.ui.big(title, sub, '#ff5050', 5); sfx('fail');
}
function busted() { G.bustT = 0; respawn('ESCORTED OUT', `Sent back to radiation-safety training: ${fmt(PRICE.escort)}`, PRICE.escort); }

// ---------------- interaction ----------------
let eDown = false, holdT = 0, lastLabel = '';
function forcedDoorTarget() {
  const pp = player.pos; if (player.vehicle) return null;
  for (const k of ['3', '1']) {
    const t = W['tunnelDoor' + k]; if (!t) continue;
    if (!G.ring.access && Math.hypot(pp.x - t.out.x, pp.z - t.out.z) < 2.6)
      return { label: '<span class="bad">Force the interlocked tunnel door</span> (hold E)', hold: 3, act: () => { crime(3, 'Interlock broken – BEAM DUMPED! Every user in the building is furious.'); dumpBeam(true); charge(PRICE.beamDump, 'Lost beamtime on 16 beamlines'); sfx('alarm'); for (const n of G.npcs) if (Math.random() < 0.5) n.say(pick(PHRASES.angry), '#ff8a8a'); } };
  }
  return null;
}
function updateInteract(dt) {
  if (player.vehicle) { G.ui.prompt('<b>F</b> step off'); return; }
  let it = missionInteract();
  if (!it) it = forcedDoorTarget();
  if (!it) {
    let bd = 1e9;
    for (const c of G.interact) { if (c.cond && !c.cond()) continue; const d = Math.hypot(c.x - player.pos.x, c.z - player.pos.z); if (d < c.r && d < bd) { bd = d; it = c; } }
  }
  // locked doors
  let doorMsg = null;
  for (const d of G.doors) if (d.kind === 'hall' && !G.badge && Math.hypot(d.x - player.pos.x, d.z - player.pos.z) < 3.5) doorMsg = 'Locked – you need a badge from the reception';
  for (const b of G.beamlines) if (b.door && !b.shutter && !b.door.allow() && Math.hypot(b.expDoorOut.x - player.pos.x, b.expDoorOut.z - player.pos.z) < 2) doorMsg = `🔒 ${b.name}: beamtime in progress – closed to visitors`;
  // vehicles
  let vMsg = null; for (const c of G.vehicles) { if (Math.hypot(c.pos.x - player.pos.x, c.pos.z - player.pos.z) < c.T.len / 2 + 1.5) { vMsg = `<b>F</b> ${c.driver ? 'steal' : 'ride'} ${c.T.label}`; break; } }
  if (!it) { holdT = 0; G.ui.prompt(doorMsg || vMsg); return; }
  const label = typeof it.label === 'function' ? it.label() : it.label;
  if (label !== lastLabel) { holdT = 0; lastLabel = label; }
  if (eDown) {
    if (it.hold) { holdT += dt; if (holdT >= it.hold) { holdT = 0; eDown = false; it.act(); } }
    else { eDown = false; it.act(); }
  }
  G.ui.prompt(`<b>E</b> ${label}` + (vMsg ? `&nbsp;&nbsp; ${vMsg}` : ''), it.hold ? holdT / it.hold : 0);
}
function setupInteractables() {
// world interactables that need game logic
G.interact.push({ x: W.jobBoard.x, z: W.jobBoard.z, r: 2.2, label: 'Take a courier job', act: () => G.onJobBoard() });
G.interact.push({ x: W.cafe.x, z: W.cafe.z, r: 2.2, label: `Buy a coffee (${fmt(PRICE.coffee)}, restores health)`, cond: () => !MS.active || MS.active.id !== 'fika', act: () => { if (!canPay(PRICE.coffee)) return G.ui.toast('Not enough kronor. Do some jobs!'); charge(PRICE.coffee); G.health = 100; sfx('pickup'); G.ui.toast('☕ Fika! Health restored.'); } });
G.interact.push({ x: W.controlRoom.x, z: W.controlRoom.z, r: 2.5, label: 'Talk to the control room operator', cond: () => !!MS.active || MS.done.magnet, act: () => G.ui.toast(pick(['“Ring current 400 mA, emittance 330 pm·rad. All good!”', '“Please don’t open interlocked doors. The paperwork is horrible.”', '“The 3 GeV ring was the first multibend-achromat ring in the world.”', '“Top-up every few minutes keeps the current constant.”'])) });
for (const b of G.beamlines) {
  if (!b.cabinPos) continue;
  if (!b.info.visit) continue;
  if (b.info.custom) { const key = b.info.custom; G.interact.push({ x: b.cabinPos.x, z: b.cabinPos.z, r: 1.7, label: 'Use ' + b.name, act: () => openExperiment(key) }); continue; }
  G.interact.push({ x: b.cabinPos.x, z: b.cabinPos.z, r: 1.7, label: () => (b.shutter ? `Close the ${b.name} shutter` : `Open the ${b.name} shutter`), act: () => {
    if (!b.shutter) {
      if (!G.ring.beamOn && b.ring !== 'L') return G.ui.toast('No beam in the ring right now.');
      if (b.expZone.test(player.pos.x, player.pos.z)) return;
      b.setShutter(true); sfx('beep'); G.ui.toast(`Shutter open – photons hitting the ${b.name} sample!`);
    } else { b.setShutter(false); sfx('beep'); }
  } });
}
// initial beamline states
for (const b of G.beamlines) if (b.setShutter) b.setShutter(Math.random() < 0.55 && b.name !== 'FemtoMAX' && !b.info.visit);

}

// ---------------- per-frame systems ----------------
function updateDoors(dt) {
  const pp = player.vehicle ? player.vehicle.pos : player.pos;
  for (const d of G.doors) {
    let want = false;
    const dp = Math.hypot(d.x - pp.x, d.z - pp.z);
    if (dp < 5) want = d.allow ? d.allow() : d.kind === 'hall' ? G.badge : true;
    if (!want && (d.kind === 'hall' || d.kind === 'office')) for (const n of G.npcs) if (Math.abs(n.pos.x - d.x) < 3.5 && Math.abs(n.pos.z - d.z) < 3.5) { want = true; break; }
    if (d.allow && !d.allow()) want = false;
    const prev = d.open; d.open = clamp(d.open + (want ? 2.5 : -2.5) * dt, 0, 1);
    if ((prev === 0 && d.open > 0) && dp < 15) sfx('door');
    for (const p of d.panels) p.m.position.set(p.bx + p.dx * p.dist * d.open, p.m.position.y, p.bz + p.dz * p.dist * d.open);
    d.collider.enabled = d.open < 0.75;
  }
  for (const k of ['3', '1']) { const t = W['tunnelDoor' + k]; if (t) { t.door.lamp.material.color.set(G.ring.access ? '#30ff70' : (G.time * 2 | 0) % 2 ? '#ff2a1a' : '#550000'); } }
}
let curZoneName = '';
function updateZones() {
  const pp = player.vehicle ? player.vehicle.pos : player.pos;
  let best = null; const hideSet = new Set(); let flags = {};
  for (const z of G.zones) {
    const inside = z.test(pp.x, pp.z);
    if (z.hideObj) for (const o of z.hideObj) o.visible = !inside;
    if (!inside) continue;
    if (z.hide) z.hide.forEach((h) => hideSet.add(h));
    if (z.flags) flags = Object.assign({}, flags, z.flags);
    if (!best || (z.prio ?? 0) > (best.prio ?? 0)) best = z;
  }
  for (const k in G.hide) G.hide[k].visible = !hideSet.has(k);
  G.zoneFlags = flags; G.indoor = hideSet.size > 0 || (best && best.prio === 6); G.inHutch = !!(best && best.prio === 6);
  if (best && best.name !== curZoneName) { curZoneName = best.name; G.ui.zone(best.name); G.onZoneEnter?.(best); }
}
let hallCrimeT = 0;
function updateRing(dt) {
  const r = G.ring;
  if (r.beamOn) {
    r.cur3 -= dt * 0.035; r.cur1 -= dt * 0.05; r.topup -= dt;
    if (r.injecting > 0) { r.injecting -= dt; r.cur3 = lerp(r.cur3, 400, dt * 2); r.cur1 = lerp(r.cur1, 500, dt * 2); }
    if (r.topup <= 0) { r.topup = 60 + rand(-5, 5); r.injecting = 2.5; }
  }
  const inTun = G.zoneFlags.tunnel;
  if (r.restorePending && !r.planned && (!r.restoreAt || G.time > r.restoreAt) && !inTun) {
    r.restorePending = false; r.restoreAt = 0; r.access = false; r.beamOn = true; r.injecting = 4; r.topup = 60; r.cur3 = 0; r.cur1 = 0;
    G.ui.toast('Control room: tunnel searched and locked. Injecting beam… 🔵');
    for (const b of G.beamlines) if (b.setShutter && b.name !== 'FemtoMAX' && !b.info.visit && Math.random() < 0.5 && !b.locked) b.setShutter(true);
  }
  // dose: residual activation in the tunnel right after a dump, prompt dose if somebody is inside with beam
  if (inTun && G.badge) {
    const since = G.time - r.dumpT; G.dose += dt * (r.beamOn ? 4 : 0.02 * Math.exp(-since / 60));
    if (r.beamOn) G.ui.prompt('<span class="bad">☢ RADIATION! GET OUT!</span>');
    if (G.dose >= 20) { G.dose = 0; respawn('OVEREXPOSED', `Your dosimeter maxed out. New dosimeter + incident report: ${fmt(PRICE.dosimeter)}`, PRICE.dosimeter); }
  }
  // cars inside the halls
  const v = player.vehicle;
  if (v && v.T.crime && G.zoneFlags.hall) { hallCrimeT -= dt; if (hallCrimeT <= 0) { crime(1, `A ${v.T.label} in the experimental hall?! Vibrations ruin the nanometre beams!`); hallCrimeT = 8; } }
  else hallCrimeT = Math.min(hallCrimeT, 1);
}
function vehicleContacts(dt) {
  const v = player.vehicle;
  const pp = player.pos;
  for (const c of G.vehicles) {
    if (c === v) continue;
    if (!v) { // vehicle vs player on foot
      if (Math.abs(c.speed) > 4 && player.knock <= 0) for (const cc of c.circles()) if (Math.hypot(cc.x - pp.x, cc.z - pp.z) < c.r + 0.4) { player.knockDown(Math.abs(c.speed) * 2.2); c.speed *= 0.3; break; }
      // keep the player out of parked cars
      for (const cc of c.circles()) { const dx = pp.x - cc.x, dz = pp.z - cc.z, d = Math.hypot(dx, dz), m = c.r + 0.38; if (d < m && d > 1e-4) { pp.x += dx / d * (m - d); pp.z += dz / d * (m - d); } }
      continue;
    }
    for (const a of v.circles()) for (const b of c.circles()) {
      const dx = a.x - b.x, dz = a.z - b.z, d = Math.hypot(dx, dz), m = v.r + c.r;
      if (d < m && d > 1e-4) {
        const pen = (m - d) / 2; v.pos.x += dx / d * pen; v.pos.z += dz / d * pen; c.pos.x -= dx / d * pen; c.pos.z -= dz / d * pen;
        if (Math.abs(v.speed) > 6) { sfx('crash'); G.ui.shake(0.4); if (c.driver) { crime(1, 'Hit-and-run on Fotongatan!'); } }
        c.speed = v.speed * 0.5; v.speed *= 0.4; c.sync();
      }
    }
  }
  if (!v) return;
  for (const n of [...G.npcs, ...G.officers]) {
    if (n.state === 'knocked') continue;
    for (const a of v.circles()) {
      const dx = n.pos.x - a.x, dz = n.pos.z - a.z, d = Math.hypot(dx, dz);
      if (d < v.r + 0.35) {
        if (Math.abs(v.speed) > 3) {
          n.knock(Math.sin(v.heading) * v.speed * 0.6 + dx * 2, Math.cos(v.heading) * v.speed * 0.6 + dz * 2, Math.abs(v.speed));
          crime(n.kind === 'officer' ? 2 : 1, n.kind === 'officer' ? 'You ran over a safety officer!' : 'Pedestrian knocked over!'); v.speed *= 0.75;
        } else if (d > 1e-4) { n.pos.x += dx / d * (v.r + 0.35 - d); n.pos.z += dz / d * (v.r + 0.35 - d); }
      }
    }
  }
}
function updatePhotons(dt) {
  const pp = player.vehicle ? player.vehicle.pos : player.pos;
  for (const p of G.photons) {
    if (p.got) continue;
    p.mesh.rotation.y += dt * 2; p.mesh.position.y = p.y + Math.sin(G.time * 2 + p.x) * 0.15;
    if (Math.hypot(pp.x - p.x, pp.z - p.z) < 1.4 && Math.abs(pp.y + 1 - p.y) < 2.2) {
      p.got = true; p.mesh.visible = false; G.stats.photons++; earn(2000); sfx('pickup');
      G.ui.toast(`✦ Golden photon ${G.stats.photons}/${G.photons.length}! +${fmt(2000)}`);
      if (G.stats.photons === G.photons.length) G.ui.big('ALL GOLDEN PHOTONS', `You are officially the brightest source in Sweden. +${fmt(100000)}`, '#ffd84a', 6), earn(100000);
    }
  }
}

// ---------------- camera ----------------
const camTarget = new THREE.Vector3();
function updateCamera(dt) {
  const v = player.vehicle; const p = v ? v.pos : player.pos;
  mouseT += dt;
  if (v && mouseT > 1.2 && Math.abs(v.speed) > 1.5) camYaw += angDiff(camYaw, v.heading + Math.PI + (v.speed < 0 ? Math.PI : 0)) * Math.min(1, dt * 2.5);
  const base = v ? (v.type === 'bike' || v.type === 'scooter' ? 5.5 : v.type === 'van' ? 10 : v.type === 'cart' ? 6.5 : 8.5) : camDist;
  const want = base * [1, 1.6, 0.7][zoomMode];
  camTarget.set(p.x, p.y + (v ? 1.6 : 1.55), p.z);
  const pitch = G.inHutch ? Math.max(camPitch, 0.9) : camPitch;
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const dx = Math.sin(camYaw) * cp, dy = sp, dz = Math.cos(camYaw) * cp;
  // collision march
  let allowed = want; const steps = 22;
  for (let i = 1; i <= steps; i++) {
    const t = want * i / steps; const x = camTarget.x + dx * t, z = camTarget.z + dz * t;
    // under a hidden roof the camera may rise over low interior walls
    const y = G.indoor ? Math.max(camTarget.y + dy * t, camTarget.y + dy * want) : camTarget.y + dy * t;
    if (blocked(x, z, y, 0.25) || y < groundY(x, z) + 0.25) { allowed = Math.max(0.6, want * (i - 1) / steps); break; }
  }
  curDist = allowed < curDist ? allowed : lerp(curDist, allowed, Math.min(1, dt * 3));
  camera.position.set(camTarget.x + dx * curDist, camTarget.y + dy * curDist, camTarget.z + dz * curDist);
  const sh = G.ui.getShake(); if (sh > 0) camera.position.add(new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(sh * 0.3));
  camera.lookAt(camTarget);
  const targetFov = v ? 62 + clamp(Math.abs(v.speed) - 10, 0, 20) * 0.5 : 62; camera.fov = lerp(camera.fov, targetFov, dt * 3); camera.updateProjectionMatrix();
  // sun follows the player for crisp shadows
  sun.position.copy(camTarget).addScaledVector(SUN_DIR, 200); sun.target.position.copy(camTarget); G.skyMesh.position.copy(camera.position);
}

// ---------------- main loop ----------------
const clock = new THREE.Clock();
function simulate(dt) {
  G.time += dt;
  const inp = inputState();
  if (player.vehicle) { player.vehicle.drive(dt, player.knock > 0 ? { f: 0, r: 0 } : inp); if (inp.f > 0 && player.vehicle.speed < player.vehicle.T.max - 0.3) player.kickT = 0.3; }
  player.update(dt, inp, camYaw);
  if (player.vehicle) player.pos.copy(player.vehicle.pos);
  for (const c of G.vehicles) if (c !== player.vehicle && c.ai) c.aiUpdate(dt, road, player); else if (c !== player.vehicle && Math.abs(c.speed) > 0.05) { c.speed *= Math.max(0, 1 - dt * 1.5); c.steer = 0; c.move(dt); }
  vehicleContacts(dt);
  const pp = player.pos;
  for (const n of G.npcs) { if (Math.abs(n.pos.x - pp.x) < 220 && Math.abs(n.pos.z - pp.z) < 220) n.update(dt, player); }
  for (const o of G.officers) o.update(dt, player);
  tram.update(dt, player);
  updateDoors(dt); updateZones(); updateRing(dt); updateWanted(dt); updatePhotons(dt);
  updateInteract(dt); updateMissions(dt);
  if (G.health <= 0) respawn('KNOCKED OUT', `You wake up at the emergency room. Patient fee: ${fmt(PRICE.medical)}`, PRICE.medical);
  G.health = Math.min(100, G.health + dt * 1.5);
  for (const f of G.tickers) f(dt);
  for (const s of G.spinners) s.obj.rotation[s.axis] += s.speed * dt;
  for (const b of G.blinkers) b.mesh.material.color.set((G.time / b.period | 0) % 2 ? '#ff2020' : '#400000');
  for (const k in G.flags) G.flags[k].rotation.y = Math.sin(G.time * 1.3 + k.length) * 0.15;
  engineSound(player.vehicle);
}
function frame() {
  requestAnimationFrame(frame);
  let dt = Math.min(clock.getDelta(), 0.05);
  if (G.paused || G.ui.overlayOpen()) dt = 0;
  if (dt > 0) simulate(dt);
  netTick(Math.min(clock.elapsedTime ? 0.05 : 0.016, Math.max(dt, 0.016)));
  updateCamera(Math.max(dt, 0.001));
  updateHUD(dt, camYaw);
  if (G.pip && G.pip.active() && pipPose()) { renderer.render(scene, G.pip.cam); G.pip.draw(renderer); }
  renderer.render(scene, camera);
}
// debug/test hook: advance the simulation n frames with optional held keys, e.g. __step(120, ['KeyW'])
window.__step = (n, hold = []) => { hold.forEach((k) => (keys[k] = true)); for (let i = 0; i < n; i++) { simulate(1 / 60); updateCamera(1 / 60); updateHUD(1 / 60, camYaw); } hold.forEach((k) => (keys[k] = false)); renderer.render(scene, camera); };
window.__key = (code) => dispatchEvent(new KeyboardEvent('keydown', { code })) || dispatchEvent(new KeyboardEvent('keyup', { code }));
boot();
