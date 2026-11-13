// HUD, minimap, big map and overlays.
import { G } from './state.js';
import { fmt } from './economy.js';
import { R3, R1, LOOP, ROADS, PATHS, OFFICE, LINAC, PARKING, PLAZA, TRAM, ESS, BIKE_RING_R, PHOTOS, BEAMLINES3 } from './data.js';
import { TAU, clamp } from './util.js';

const $ = (id) => document.getElementById(id);
const MAP = { x0: -330, z0: -270, x1: 330, z1: 250, s: 2 };
let mapImg = null;

export function initHUD() {
  const ui = G.ui = {};
  let toastT = 0, bigT = 0, zoneT = 0, shakeA = 0;
  ui.toast = (msg, dur = 4.5) => { const el = $('toast'); el.innerHTML = msg; el.style.opacity = 1; toastT = dur; };
  ui.big = (title, sub = '', color = '#ffcc33', dur = 3.5) => { const el = $('bigmsg'); el.innerHTML = `<div style="color:${color}">${title}</div><small>${sub}</small>`; el.style.opacity = 1; bigT = dur; };
  ui.zone = (name) => { const el = $('zone'); el.textContent = name; el.style.opacity = 1; zoneT = 2.8; };
  ui.shake = (a) => { shakeA = Math.max(shakeA, a); };
  ui.getShake = () => shakeA;
  ui.tick = (dt) => {
    if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('toast').style.opacity = 0; }
    if (bigT > 0) { bigT -= dt; if (bigT <= 0) $('bigmsg').style.opacity = 0; }
    if (zoneT > 0) { zoneT -= dt; if (zoneT <= 0) $('zone').style.opacity = 0; }
    shakeA = Math.max(0, shakeA - dt * 2);
  };
  ui.prompt = (text, hold = 0) => {
    const el = $('prompt'); if (!text) { el.style.opacity = 0; $('holdbar').style.opacity = 0; return; }
    el.innerHTML = text; el.style.opacity = 1;
    $('holdbar').style.opacity = hold > 0 ? 1 : 0; $('holdbar').firstElementChild.style.width = (hold * 100).toFixed(0) + '%';
  };
  ui.overlayOpen = () => document.querySelector('.overlay.show') !== null;
  ui.showPhoto = (file, info) => {
    const box = $('photoov');
    const p = file ? PHOTOS[file] : null;
    $('pimg').style.display = file ? 'block' : 'none'; if (file) $('pimg').src = 'assets/photos/' + file;
    let html = '';
    if (info) html += `<h2 style="color:${info.color || '#fff'}">${info.name}</h2><h3>${info.tech || ''}</h3><p>${info.desc || ''}</p>`;
    if (p) html += `<p class="cap">${p.cap}</p><p class="cred">Photo: ${p.by} · <a href="${p.url}" target="_blank" rel="noopener">${p.lic} – Wikimedia Commons</a></p>`;
    $('ptext').innerHTML = html; box.classList.add('show'); document.exitPointerLock?.();
  };
  ui.closeOverlays = () => { document.querySelectorAll('.overlay').forEach((o) => o.classList.remove('show')); };
  ui.toggle = (id) => { const o = $(id); const on = !o.classList.contains('show'); ui.closeOverlays(); if (on) { o.classList.add('show'); document.exitPointerLock?.(); if (id === 'mapov') drawBigMap(); } };
  document.querySelectorAll('.overlay').forEach((o) => o.addEventListener('click', (e) => { if (e.target === o || e.target.classList.contains('close')) o.classList.remove('show'); }));
  // credits list
  const LIC = { 'CC BY 2.0': 'https://creativecommons.org/licenses/by/2.0/', 'CC BY 3.0': 'https://creativecommons.org/licenses/by/3.0/', 'CC BY-SA 3.0': 'https://creativecommons.org/licenses/by-sa/3.0/', 'CC BY-SA 4.0': 'https://creativecommons.org/licenses/by-sa/4.0/', CC0: 'https://creativecommons.org/publicdomain/zero/1.0/' };
  $('credits').innerHTML = Object.entries(PHOTOS).map(([f, p]) => `<li>${p.cap} — ${p.by}, <a href="${p.url}" target="_blank" rel="noopener">Wikimedia Commons</a>, ${LIC[p.lic] ? `<a href="${LIC[p.lic]}" target="_blank" rel="noopener">${p.lic}</a>` : p.lic} (resized)</li>`).join('');
  buildMapImage();
}

// ---------------- HUD per-frame ----------------
let accT = 0;
export function updateHUD(dt, camYaw) {
  G.ui.tick(dt);
  accT += dt;
  drawMinimap(camYaw);
  if (accT < 0.1) return; accT = 0;
  const r = G.ring;
  $('ring3').innerHTML = `<b>R3</b> 3 GeV &nbsp;${r.beamOn ? r.cur3.toFixed(1) + ' mA' : '<span class="bad">NO BEAM</span>'}`;
  $('ring1').innerHTML = `<b>R1</b> 1.5 GeV &nbsp;${r.beamOn ? r.cur1.toFixed(1) + ' mA' : '<span class="bad">NO BEAM</span>'}`;
  $('topup').textContent = r.beamOn ? (r.injecting > 0 ? 'Top-up injection…' : `Next top-up ${Math.ceil(r.topup)} s`) : (r.access ? 'Tunnel access open' : 'Beam restoring…');
  $('dose').innerHTML = G.badge ? `Dosimeter <b>${G.dose.toFixed(2)}</b> / 20 mSv` : '<span class="dim">No badge – visit reception</span>';
  $('money').textContent = fmt(G.money); $('money').classList.toggle('debt', G.money < 0);
  $('photons').textContent = `✦ ${G.stats.photons}/${G.photons.length} golden photons`;
  let st = ''; for (let i = 0; i < 5; i++) st += `<span class="${i < G.wanted ? 'on' : ''}">☢</span>`;
  $('stars').innerHTML = st; $('stars').classList.toggle('flash', G.wanted > 0 && G.officers.some((o) => o.state === 'chase'));
  $('health').firstElementChild.style.width = clamp(G.health, 0, 100) + '%';
  const v = G.player.vehicle; $('speed').textContent = v ? Math.round(Math.abs(v.speed) * 3.6) + ' km/h' : '';
}

// ---------------- Map rendering ----------------
function W2M(x, z) { return [(x - MAP.x0) * MAP.s, (z - MAP.z0) * MAP.s]; }
function buildMapImage() {
  const c = document.createElement('canvas'); c.width = (MAP.x1 - MAP.x0) * MAP.s; c.height = (MAP.z1 - MAP.z0) * MAP.s;
  const g = c.getContext('2d'); const s = MAP.s;
  g.fillStyle = '#5b7f45'; g.fillRect(0, 0, c.width, c.height);
  // ripple landscape
  g.strokeStyle = 'rgba(140,180,100,0.35)'; g.lineWidth = 4;
  for (let r = 130; r < 240; r += 14) { g.beginPath(); g.arc(...W2M(0, 0), r * s, 0, TAU); g.stroke(); }
  const line = (pts, w, col, closed) => { g.strokeStyle = col; g.lineWidth = w * s; g.lineJoin = 'round'; g.lineCap = 'round'; g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(...W2M(p[0], p[1])) : g.moveTo(...W2M(p[0], p[1])))); if (closed) g.closePath(); g.stroke(); };
  const rect = (r, col) => { g.fillStyle = col; const [a, b] = W2M(r.x0, r.z0); g.fillRect(a, b, (r.x1 - r.x0) * s, (r.z1 - r.z0) * s); };
  const disk = (cx, cz, r, col) => { g.fillStyle = col; g.beginPath(); g.arc(...W2M(cx, cz), r * s, 0, TAU); g.fill(); };
  const ringL = (cx, cz, r, w, col) => { g.strokeStyle = col; g.lineWidth = w * s; g.beginPath(); g.arc(...W2M(cx, cz), r * s, 0, TAU); g.stroke(); };
  // tram
  line([[TRAM.x0, TRAM.z], [TRAM.x1, TRAM.z]], 3.5, '#8b8378');
  line([[TRAM.x0, TRAM.z], [TRAM.x1, TRAM.z]], 0.6, '#d0c8bb');
  // roads
  line(LOOP, 11, '#3c3f43', true); for (const r of ROADS) line([[r[0], r[1]], [r[2], r[3]]], r[4] + 1, '#3c3f43');
  line(LOOP, 0.5, '#e8e8e8', true);
  for (const r of PATHS) line([[r[0], r[1]], [r[2], r[3]]], r[4], '#c9c1b0');
  ringL(0, 0, BIKE_RING_R, 3.2, '#a97a6c');
  rect(PARKING, '#5a5d61'); rect(PLAZA, '#cfc9be');
  // buildings
  disk(0, 0, R3.outer, '#c7ccd2'); disk(0, 0, R3.inner, '#6f9c49');
  ringL(0, 0, R3.inner + 0.2, 0.8, '#9aa1a8'); ringL(0, 0, R3.outer - 0.2, 1.2, '#7c848c');
  ringL(0, 0, (R3.tunIn + R3.tunOut) / 2, R3.tunOut - R3.tunIn + 1.2, '#8b8c88');
  ringL(0, 0, R3.rBeam, 0.8, '#3d6596');
  g.strokeStyle = '#d8cfb8'; g.lineWidth = 2; for (let k = 1; k < 9; k++) { g.beginPath(); g.arc(...W2M(0, 0), k * 6.8 * s, k, k + TAU - 0.5); g.stroke(); }
  disk(R1.cx, R1.cz, R1.outer, '#c7ccd2'); ringL(R1.cx, R1.cz, (R1.tunIn + R1.tunOut) / 2, R1.tunOut - R1.tunIn + 1, '#8b8c88'); ringL(R1.cx, R1.cz, R1.rBeam, 0.6, '#3d6596');
  rect(OFFICE, '#e9ebee'); rect({ x0: 108, z0: -30, x1: 176, z1: 12 }, 'rgba(255,255,255,0.35)');
  rect(LINAC, '#9fae7a'); line([[LINAC.x0 + 4, -171.5], [113, -171.5]], 1.2, '#c27a3e');
  rect(ESS, '#56606b');
  // beamlines
  for (const z of G.zones) if (z.poly) { g.fillStyle = z.color; g.beginPath(); z.poly.forEach((p, i) => (i ? g.lineTo(...W2M(p.x, p.z)) : g.moveTo(...W2M(p.x, p.z)))); g.closePath(); g.fill(); }
  for (const b of G.beamlines) if (b.samplePos) { g.strokeStyle = '#ffe680'; g.lineWidth = 1; g.beginPath(); g.moveTo(...W2M(b.S.x, b.S.z)); g.lineTo(...W2M(b.samplePos.x, b.samplePos.z)); g.stroke(); }
  mapImg = c;
}
function labels(g, k, ox, oy, sc) {
  g.save(); g.font = `bold ${Math.round(11 * k)}px Trebuchet MS, Arial`; g.textAlign = 'center'; g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,0.75)'; g.fillStyle = '#fff';
  const L = (t, x, z) => { const px = ox + (x - MAP.x0) * sc, py = oy + (z - MAP.z0) * sc; g.strokeText(t, px, py); g.fillText(t, px, py); };
  for (const b of G.beamlines) { const p = b.samplePos || b.center; if (p) L(b.name + (b.info.visit ? ' ★ open' : ''), p.x, p.z); }
  L('Courtyard', 0, -10); L('Office & Reception', 152, 0); L('Parking', 160, 70); L('Linac 300 m', -60, -184); L('1.5 GeV ring', R1.cx, R1.cz + 3);
  L('Tram: MAX IV', TRAM.stopX, TRAM.z + 10); L('Fotongatan', -60, 160); L('→ ESS', 310, 140); L('3 GeV ring', 0, 20);
  g.restore();
}
function drawMinimap(camYaw) {
  const c = $('minimap'); const g = c.getContext('2d'); const W = c.width, H = c.height; const p = G.player; const pp = p.vehicle ? p.vehicle.pos : p.pos;
  const zoom = 1.25; // px per metre on minimap
  g.save(); g.clearRect(0, 0, W, H);
  g.beginPath(); g.arc(W / 2, H / 2, W / 2 - 2, 0, TAU); g.clip();
  g.fillStyle = '#5b7f45'; g.fillRect(0, 0, W, H);
  g.translate(W / 2, H / 2); g.rotate(camYaw);
  const k = zoom / MAP.s; g.scale(k, k);
  g.drawImage(mapImg, -(pp.x - MAP.x0) * MAP.s, -(pp.z - MAP.z0) * MAP.s);
  g.setTransform(1, 0, 0, 1, 0, 0);
  // blips (in world -> screen)
  const toScr = (x, z) => { const dx = (x - pp.x) * zoom, dz = (z - pp.z) * zoom; const c1 = Math.cos(camYaw), s1 = Math.sin(camYaw); return [W / 2 + dx * c1 - dz * s1, H / 2 + dx * s1 + dz * c1]; };
  const blip = (x, z, col, r = 4, clampEdge = false, shape = 'dot') => {
    let [sx, sy] = toScr(x, z); const dx = sx - W / 2, dy = sy - H / 2; const d = Math.hypot(dx, dy); const R = W / 2 - 9;
    if (d > R) { if (!clampEdge) return; sx = W / 2 + dx / d * R; sy = H / 2 + dy / d * R; }
    g.fillStyle = col; g.strokeStyle = '#000'; g.lineWidth = 1.5; g.beginPath();
    if (shape === 'sq') g.rect(sx - r, sy - r, r * 2, r * 2); else g.arc(sx, sy, r, 0, TAU); g.fill(); g.stroke();
  };
  for (const o of G.remoteBlips || []) blip(o.x, o.z, '#7dffb0', 4);
  for (const o of G.officers) blip(o.pos.x, o.pos.z, (G.time * 4 | 0) % 2 ? '#ff3b3b' : '#3b7bff', 3.5);
  for (const m of G.missionBlips || []) blip(m.x, m.z, m.color, m.r || 5, true, m.shape);
  g.restore();
  // player arrow (always points along the player's facing relative to camera)
  const yaw = p.vehicle ? p.vehicle.heading : p.yaw;
  g.save(); g.translate(W / 2, H / 2); g.rotate(camYaw - yaw + Math.PI);
  g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(0, -8); g.lineTo(6, 6); g.lineTo(0, 3); g.lineTo(-6, 6); g.closePath(); g.fill(); g.stroke(); g.restore();
  // north marker
  g.save(); g.translate(W / 2, H / 2); g.rotate(camYaw); g.fillStyle = '#fff'; g.font = 'bold 13px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.translate(0, -(W / 2 - 12)); g.rotate(-camYaw); g.fillText('N', 0, 0); g.restore();
}
function drawBigMap() {
  const c = $('bigmap'); const W = c.width = Math.min(innerWidth - 60, 1300), H = c.height = Math.min(innerHeight - 110, 1000);
  const g = c.getContext('2d'); const sc = Math.min(W / (MAP.x1 - MAP.x0), H / (MAP.z1 - MAP.z0));
  const ox = (W - (MAP.x1 - MAP.x0) * sc) / 2, oy = (H - (MAP.z1 - MAP.z0) * sc) / 2;
  g.fillStyle = '#1a222b'; g.fillRect(0, 0, W, H);
  g.drawImage(mapImg, ox, oy, (MAP.x1 - MAP.x0) * sc, (MAP.z1 - MAP.z0) * sc);
  labels(g, 1.1, ox, oy, sc);
  const T = (x, z) => [ox + (x - MAP.x0) * sc, oy + (z - MAP.z0) * sc];
  for (const m of G.missionBlips || []) { const [x, y] = T(m.x, m.z); g.fillStyle = m.color; g.strokeStyle = '#000'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 7, 0, TAU); g.fill(); g.stroke(); if (m.label) { g.fillStyle = '#fff'; g.font = 'bold 12px Arial'; g.fillText(m.label, x + 10, y + 4); } }
  const p = G.player; const pp = p.vehicle ? p.vehicle.pos : p.pos; const yaw = p.vehicle ? p.vehicle.heading : p.yaw;
  const [px, py] = T(pp.x, pp.z); g.save(); g.translate(px, py); g.rotate(-yaw + Math.PI); g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, -11); g.lineTo(8, 8); g.lineTo(0, 4); g.lineTo(-8, 8); g.closePath(); g.fill(); g.stroke(); g.restore();
}
