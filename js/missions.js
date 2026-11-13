// Mission engine and story missions.
import * as THREE from 'three';
import { G } from './state.js';
import { earn, fmt } from './economy.js';
import { W } from './world.js';
import { R3, R1, BIKE_RING_R, PHRASES } from './data.js';
import { DEG, pick, rand, mat } from './util.js';
import { groundY } from './physics.js';
import { Vehicle } from './actors.js';
import { COSAXS_STATE as CX, byIdIn } from './cosaxs.js';
const byId = (id) => byIdIn('cosaxs', id);

export const MS = { active: null, step: 0, stepT: 0, timer: null, done: {}, data: {}, cooldown: 0 };
const bl = (n) => G.beamlines.find((b) => b.name === n);
const pos = () => (G.player.vehicle ? G.player.vehicle.pos : G.player.pos);
const inZone = (z) => z && z.test(pos().x, pos().z);
const inTunnel3 = () => { const p = pos(); const r = Math.hypot(p.x, p.z); return r > R3.tunIn + 0.5 && r < R3.tunOut - 0.75; };

// ---------- markers ----------
let markGeo, markMat, arrowGeo, arrowMat, startMat;
const pool = [];
function marker(i) {
  if (!pool[i]) {
    markGeo ||= new THREE.CylinderGeometry(1, 1, 1.4, 32, 1, true);
    markMat ||= new THREE.MeshBasicMaterial({ color: '#ffcc33', transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    startMat ||= new THREE.MeshBasicMaterial({ color: '#3fa9ff', transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    arrowGeo ||= new THREE.ConeGeometry(0.35, 0.8, 4); arrowGeo.rotateX(Math.PI);
    arrowMat ||= new THREE.MeshBasicMaterial({ color: '#ffcc33', toneMapped: false });
    const grp = new THREE.Group(); const c = new THREE.Mesh(markGeo, markMat); c.position.y = 0.7; const a = new THREE.Mesh(arrowGeo, arrowMat);
    grp.add(c, a); grp.userData = { c, a }; G.scene.add(grp); pool[i] = grp;
  }
  return pool[i];
}
function showMarkers(list) {
  pool.forEach((m) => (m.visible = false));
  list.forEach((t, i) => {
    const m = marker(i); m.visible = true; const y = t.y ?? groundY(t.x, t.z);
    m.position.set(t.x, y, t.z); m.userData.c.scale.set(t.r, 1, t.r); m.userData.c.material = t.start ? startMat : markMat;
    m.userData.a.position.y = 2.6 + Math.sin(G.time * 3) * 0.25; m.userData.a.rotation.y = G.time * 2; m.userData.a.material = arrowMat;
    m.userData.a.material.color.set(t.start ? '#3fa9ff' : '#ffcc33');
  });
}

// ---------- mission definitions ----------
const D = [];
D.push({
  id: 'welcome', title: 'Welcome to MAX IV', reward: 10000, auto: true,
  intro: 'You just got off the tram for your first beamtime at MAX IV in Lund – home of the first multibend-achromat storage ring.',
  steps: [{ text: 'Walk through the main entrance to the <b>reception</b>.', at: () => W.reception, r: 2.2, foot: true,
    done: () => { G.badge = true; G.ui.toast('🪪 You got your access badge and a personal dosimeter. Doors to the halls now open for you.<br>Annual dose limit: 20 mSv. Don’t do anything stupid.', 8); } }],
});
D.push({
  id: 'fika', title: 'Fika Run', reward: 15000, start: () => W.cafe, needBadge: true,
  intro: 'The BioMAX team has been collecting protein data for 30 hours straight. They need kanelbullar. Now.',
  steps: [
    { text: 'Take the kanelbullar at the café counter.', at: () => W.cafe, r: 2, interact: 'Take kanelbullar', done: () => G.player.setCarry('fika') },
    { text: 'Deliver the fika to the door of the <b>BioMAX control cabin</b>.', at: () => bl('BioMAX').cabinDoorOut, r: 1.8, foot: true, timer: 120, done: () => { G.player.setCarry(null); G.ui.toast('“Tack så mycket! Now the crystals will diffract for sure.”'); } },
  ],
});
D.push({
  id: 'sample', title: 'Sample Express', reward: 30000, start: () => W.parkingMarker, needBadge: true,
  intro: 'A user brought nanoparticles in a liquid-nitrogen dewar. Scoot them to CoSAXS before they thaw!',
  setup() { MS.data.van = spawnVehicle('scooter', 150, 59, -Math.PI / 2); },
  cleanup() { G.player.setCarry(null); const b = bl('CoSAXS'); b.locked = false; if (b.shutter) b.setShutter(false); },
  steps: [
    { text: 'Step on the <b>scooter</b> (press F).', check: () => G.player.vehicle === MS.data.van, at: () => MS.data.van.pos, r: 2 },
    { text: 'Scoot to the <b>CoSAXS</b> hutch – it is right inside the hall from the reception.', at: () => bl('CoSAXS').expDoorOut, r: 3, timer: 90 },
    { text: 'Carry the dewar on foot to the CoSAXS sample stage.', at: () => bl('CoSAXS').samplePos, r: 1.6, foot: true, timer: 90,
      onStart: () => { const b = bl('CoSAXS'); b.setShutter(false); b.locked = false; if (!G.player.vehicle) G.player.setCarry('dewar'); },
      tick: () => { if (!G.player.vehicle && !G.player.carry) G.player.setCarry('dewar'); } },
    { text: 'Mount the sample. This also completes the hutch search.', at: () => bl('CoSAXS').samplePos, r: 1.8, interact: 'Mount sample & search hutch', done: () => G.player.setCarry(null) },
    { text: 'Leave the hutch – the door will close.', check: () => !inZone(bl('CoSAXS').expZone), at: () => bl('CoSAXS').expDoorOut, r: 1.5, done: () => { const b = bl('CoSAXS'); b.locked = true; b.searched = true; G.sfx?.('beep'); } },
    { text: 'Open the shutter from the <b>CoSAXS cabin</b>.', at: () => bl('CoSAXS').cabinPos, r: 1.8, interact: 'Open shutter', done: () => bl('CoSAXS').setShutter(true) },
    { text: 'Collecting data… don’t touch anything!', wait: 10, done: () => { const b = bl('CoSAXS'); b.locked = false; b.searched = false; b.setShutter(false); G.ui.toast('Data collected!'); } },
  ],
});
D.push({
  id: 'magnet', title: 'Magnet Trouble', reward: 40000, start: () => W.controlRoom, needBadge: true,
  intro: 'Control room: “A magnet power supply in achromat 7 tripped and the beam is gone. Please reset it in the tunnel – and do the search properly!”',
  setup() {
    dumpBeam(false); G.ring.access = true; G.ring.planned = true;
    W.faulty.light.visible = true; W.search.forEach((s) => { s.pressed = false; s.mesh.material = W.searchMatOff; });
  },
  cleanup(ok) { W.faulty.light.visible = false; G.ring.planned = false; G.ring.restorePending = true; },
  steps: [
    { text: 'Go to the <b>3 GeV tunnel access door</b> on the inner side of the ring (west). Cross the tunnel on a bridge (north or south door).', at: () => W.tunnelDoor3.out, r: 3 },
    { text: 'Find the tripped magnet (flashing red) and reset its power supply.', at: () => W.faulty.at, r: 2.2, interact: 'Reset power supply', hold: 2, done: () => { W.faulty.light.visible = false; } },
    { text: 'Search the tunnel: press all <b>3 search buttons</b>.', multi: () => W.search.filter((s) => !s.pressed), multiLabel: 'Press search button', check: () => W.search.every((s) => s.pressed), timer: 150 },
    { text: 'Leave the tunnel before the door is locked!', check: () => !inTunnel3(), at: () => W.tunnelDoor3.out, r: 2.5 },
  ],
});
D.push({
  id: 'rally', title: 'Ring Rally', reward: 25000, start: () => W.bikeRack, needBadge: false,
  intro: 'Scoot once around the 528 m ring building on the path – against the clock!',
  setup() { if (!G.vehicles.some((v) => v.type === 'scooter' && Math.hypot(v.pos.x - W.bikeRack.x, v.pos.z - W.bikeRack.z) < 12)) spawnVehicle('scooter', W.bikeRack.x + 2, W.bikeRack.z + 2, 0); },
  steps: [
    { text: 'Step on a scooter (press F near one).', check: () => G.player.vehicle?.type === 'scooter' },
    ...Array.from({ length: 12 }, (_, k) => {
      const a = (90 + 30 * (k + 1)) * DEG;
      return { text: `Checkpoint ${k + 1} / 12`, at: () => ({ x: BIKE_RING_R * Math.cos(a), z: BIKE_RING_R * Math.sin(a) }), r: 5, timer: k === 0 ? 130 : undefined };
    }),
  ],
});
D.push({
  id: 'femto', title: 'Femtosecond Sprint', reward: 20000, start: () => W.linacWestOut, needBadge: true,
  intro: 'Electrons cross the 300 m linac in a microsecond. You get 50 seconds, on foot, from the gun to the FemtoMAX hutch.',
  setup() { W.femto.setShutter(false); },
  steps: [{ text: 'Sprint through the linac to the <b>FemtoMAX hutch door</b>!', at: () => W.femto.expDoorOut, r: 2, foot: true, timer: 50 }],
});
D.push({
  id: 'smallring', title: 'The Small Ring', reward: 25000, start: () => W.r1Door, needBadge: true,
  intro: 'The 1.5 GeV ring serves soft X-ray and UV beamlines. Two groups need samples swapped – quickly.',
  
  steps: [
    { text: 'Deliver a quantum-material crystal to the <b>Bloch</b> hutch door.', at: () => bl('Bloch').expDoorOut, r: 1.8, foot: true, timer: 140 },
    { text: 'Pick up a reference foil at the <b>FlexPES</b> cabin door.', at: () => bl('FlexPES').cabinDoorOut, r: 1.6 },
    { text: 'Bring it to the <b>SPECIES</b> hutch door.', at: () => bl('SPECIES').expDoorOut, r: 1.8, foot: true },
  ],
});
D.push({
  id: 'cosaxs', title: 'CoSAXS Beamtime', reward: 20000, start: () => bl('CoSAXS').cabinDoorOut, needBadge: true,
  intro: 'CoSAXS is open for visitors. Calibrate first, then measure a sample.',
  setup() { MS.data.cal = CX.calibs.length; MS.data.goals = Object.keys(CX.tasks).filter((k) => !k.startsWith('cal')).length; },
  steps: [
    { text: 'Mount a calibrant (AgBeH or LaB₆) in the <b>CoSAXS</b> hutch.', check: () => !!CX.sample && !!byId(CX.sample).std, at: () => CX.calStand, r: 1.0 },
    { text: 'In the cabin: measure it and save a calibration.', check: () => CX.calibs.length > MS.data.cal, at: () => bl('CoSAXS').cabinPos, r: 1.6 },
    { text: 'Mount a sample, measure, Reduce – complete one goal.', check: () => Object.keys(CX.tasks).filter((k) => !k.startsWith('cal')).length > MS.data.goals, at: () => (CX.sample && !byId(CX.sample).std ? bl('CoSAXS').cabinPos : CX.sampStand), r: 1.1 },
  ],
});
const STORY = D.slice();

function courierJob() {
  const bls = G.beamlines.filter((b) => b.cabinDoorOut && b.ring === '3');
  const A = pick(bls); let B = pick(bls); while (B === A) B = pick(bls);
  const dist = Math.hypot(A.cabinDoorOut.x - B.cabinDoorOut.x, A.cabinDoorOut.z - B.cabinDoorOut.z) + Math.hypot(A.cabinDoorOut.x - 138, A.cabinDoorOut.z - 21);
  const things = ['a sample dewar', 'a spare detector cable', 'a USB stick with 4 TB of data', 'a box of capillaries', 'the beamline manager’s coffee mug', 'a goniometer head'];
  const thing = pick(things);
  return {
    id: 'job', title: 'Courier job', reward: Math.round((3000 + dist * 40) / 100) * 100, job: true,
    intro: `${A.name} needs ${thing} delivered to ${B.name}.`,
    steps: [
      { text: `Pick up ${thing} at the <b>${A.name}</b> cabin.`, at: () => A.cabinDoorOut, r: 1.6, timer: Math.round(dist / 5.5 + 40), done: () => G.player.setCarry('dewar') },
      { text: `Deliver it to the <b>${B.name}</b> cabin.`, at: () => B.cabinDoorOut, r: 1.6, done: () => G.player.setCarry(null) },
    ],
    cleanup() { G.player.setCarry(null); },
  };
}

// ---------- engine ----------
export function initMissions() {
  W.parkingMarker = { x: 150, z: 52 }; W.loadingDoor = { x: -127, z: 0 }; W.linacWestOut = { x: -205, z: -171 }; W.r1Door = { x: R1.cx + 45, z: R1.cz };
  // faulty magnet + search buttons in the 3 GeV tunnel
  const fa = 130 * DEG;
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 8), new THREE.MeshBasicMaterial({ color: '#ff2020', toneMapped: false }));
  light.position.set(84 * Math.cos(fa), 2.2, 84 * Math.sin(fa)); light.visible = false; G.scene.add(light); G.blinkers.push({ mesh: light, period: 0.5 });
  W.faulty = { light, at: { x: 82.2 * Math.cos(fa), z: 82.2 * Math.sin(fa) } };
  W.searchMatOff = new THREE.MeshBasicMaterial({ color: '#2a7bff', toneMapped: false }); W.searchMatOn = new THREE.MeshBasicMaterial({ color: '#30ff70', toneMapped: false });
  W.search = [160, 205, 232].map((ad) => {
    const a = ad * DEG; const r = R3.tunIn + R3.tunInT / 2 + 0.05;
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.4, 0.3), mat('#f2c40f')); box.position.set(r * Math.cos(a), 1.4, r * Math.sin(a)); box.rotation.y = Math.atan2(Math.cos(a), Math.sin(a)); G.scene.add(box);
    const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.1, 10), W.searchMatOff); btn.rotation.z = Math.PI / 2; btn.position.set((r + 0.18) * Math.cos(a), 1.45, (r + 0.18) * Math.sin(a)); btn.rotation.y = -a; G.scene.add(btn);
    return { x: (r + 1.0) * Math.cos(a), z: (r + 1.0) * Math.sin(a), pressed: false, mesh: btn };
  });
  G.onJobBoard = () => { if (MS.active) { G.ui.toast('Finish your current job first.'); return; } start(courierJob()); };
  start(D[0]);
}
export function spawnVehicle(type, x, z, h) { const v = new Vehicle(type, x, z, h); G.vehicles.push(v); return v; }
export function dumpBeam(crime) {
  G.ring.beamOn = false; G.ring.cur3 = 0; G.ring.cur1 = 0; G.ring.dumpT = G.time;
  for (const b of G.beamlines) if (b.setShutter) b.setShutter(false);
  if (crime) { G.ring.access = true; G.ring.restoreAt = G.time + 60; G.ring.restorePending = true; }
}

function start(def) {
  MS.active = def; MS.step = -1; MS.timer = null; MS.data = {};
  def.setup?.();
  G.ui.big(def.title, def.intro, '#ffcc33', 5);
  nextStep();
}
function nextStep() {
  MS.step++; MS.stepT = 0;
  const st = MS.active.steps[MS.step];
  if (!st) return finish(true);
  if (st.timer) MS.timer = st.timer;
  st.onStart?.();
}
function finish(ok, why) {
  const def = MS.active; MS.active = null; MS.timer = null; MS.cooldown = 3;
  def.cleanup?.(ok);
  if (ok) {
    earn(def.reward); if (!def.job) MS.done[def.id] = true; G.stats.missions++;
    G.ui.big(def.job ? 'JOB DONE' : 'MISSION PASSED', `+ ${fmt(def.reward)}`, '#ffcc33', 4); G.sfx?.('success');
    if (def.id === 'welcome') setTimeout(() => G.ui.toast('Blue markers on the map (press M) are new missions. Explore the beamlines – photo boards show the real MAX IV (press E).', 9), 4200);
    if (STORY.every((d) => MS.done[d.id])) setTimeout(() => G.ui.big('ALL MISSIONS DONE', 'You are now a certified MAX IV power user. Try the job board and hunt golden photons!', '#7dffb0', 6), 4500);
  } else { G.ui.big('MISSION FAILED', why || '', '#ff5050', 4); G.sfx?.('fail'); }
}
export function failMission(why) { if (MS.active) finish(false, why); }

export function updateMissions(dt) {
  const blips = []; const marks = [];
  if (MS.cooldown > 0) MS.cooldown -= dt;
  const p = pos();
  if (MS.active) {
    const st = MS.active.steps[MS.step]; MS.stepT += dt;
    if (MS.timer != null) { MS.timer -= dt; if (MS.timer <= 0) return finish(false, 'Out of time!'); }
    st.tick?.();
    let ok = false;
    if (st.wait) ok = MS.stepT >= st.wait;
    else if (st.check) ok = st.check();
    else if (st.at && !st.interact) { const t = st.at(); ok = Math.hypot(p.x - t.x, p.z - t.z) < st.r && (!st.foot || !G.player.vehicle) && Math.abs(p.y - (t.y ?? groundY(t.x, t.z))) < 3; }
    if (st.at && st.foot && G.player.vehicle) { const t = st.at(); if (Math.hypot(p.x - t.x, p.z - t.z) < st.r + 3) G.ui.prompt('Get out of the vehicle first (F)'); }
    if (ok) { st.done?.(); G.sfx?.('pickup'); return nextStep(); }
    if (st.at) { const t = st.at(); marks.push({ x: t.x, z: t.z, r: st.r, y: t.y }); blips.push({ x: t.x, z: t.z, color: '#ffcc33', label: 'Objective' }); }
    if (st.multi) for (const t of st.multi()) { marks.push({ x: t.x, z: t.z, r: 1 }); blips.push({ x: t.x, z: t.z, color: '#ffcc33' }); }
    MS.hud = { title: MS.active.title, text: st.text, timer: MS.timer, dist: st.at ? Math.hypot(p.x - st.at().x, p.z - st.at().z) : null };
  } else {
    MS.hud = null;
    for (const d of STORY) {
      if (MS.done[d.id] || d.auto || !d.start) continue;
      const s = d.start(); blips.push({ x: s.x, z: s.z, color: '#3fa9ff', label: d.title, shape: 'sq' }); marks.push({ x: s.x, z: s.z, r: 1.4, start: true });
      if (MS.cooldown <= 0 && Math.hypot(p.x - s.x, p.z - s.z) < 1.6 && !G.player.vehicle) {
        if (d.needBadge && !G.badge) { G.ui.prompt('You need a badge – visit the reception first'); continue; }
        if (G.wanted > 0) { G.ui.prompt('Lose the safety officers first!'); continue; }
        start(d); break;
      }
    }
    blips.push({ x: W.jobBoard.x, z: W.jobBoard.z, color: '#7dffb0', label: 'Job board', shape: 'sq', r: 3.5 });
  }
  G.missionBlips = blips;
  showMarkers(marks);
  const el = document.getElementById('mission');
  if (MS.hud) {
    el.style.display = 'block';
    document.getElementById('mtitle').textContent = MS.hud.title;
    document.getElementById('mtext').innerHTML = MS.hud.text + (MS.hud.dist != null ? ` <span class="dim">(${Math.round(MS.hud.dist)} m)</span>` : '');
    const t = MS.hud.timer; document.getElementById('mtimer').textContent = t != null ? `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}` : '';
    document.getElementById('mtimer').classList.toggle('bad', t != null && t < 15);
  } else el.style.display = 'none';
}

// Interaction offered by the current mission step (returns {label, act, hold} or null)
export function missionInteract() {
  if (!MS.active) return null;
  const st = MS.active.steps[MS.step]; const p = pos(); if (G.player.vehicle) return null;
  if (st.interact && st.at) { const t = st.at(); if (Math.hypot(p.x - t.x, p.z - t.z) < st.r) return { label: st.interact, hold: st.hold || 0, act: () => { st.done?.(); G.sfx?.('pickup'); nextStep(); }, skipDone: true }; }
  if (st.multi) for (const t of st.multi()) if (Math.hypot(p.x - t.x, p.z - t.z) < 1.4) return { label: st.multiLabel, act: () => { t.pressed = true; t.mesh.material = W.searchMatOn; G.sfx?.('beep'); } };
  return null;
}
