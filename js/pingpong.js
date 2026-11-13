// Table tennis in the open hall between the future beamline and DanMAX: a 3D table you walk up to, and a top-down match against the computer.
import * as THREE from 'three';
import { G } from './state.js';
import { earn, fmt } from './economy.js';
import { mat, canvasTex } from './util.js';
import { B, M, CYL } from './build.js';
import { addRect } from './physics.js';

const T = { cx: 14.5, cz: -103 }; // table centre (long side along x), 3 GeV hall at about −82°
export function buildPingPong() {
  const S = B.main;
  const top = canvasTex(512, 286, (g, w, h) => {
    g.fillStyle = '#1f4f8f'; g.fillRect(0, 0, w, h); g.strokeStyle = '#ffffff'; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6);
    g.lineWidth = 3; g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
  });
  const topMesh = new THREE.Mesh(new THREE.BoxGeometry(2.74, 0.04, 1.525), [mat('#163a6a'), mat('#163a6a'), new THREE.MeshStandardMaterial({ map: top, roughness: 0.5 }), mat('#163a6a'), mat('#163a6a'), mat('#163a6a')]);
  topMesh.position.set(T.cx, 0.74, T.cz); topMesh.castShadow = true; topMesh.receiveShadow = true; G.scene.add(topMesh);
  for (const dx of [-1.1, 1.1]) for (const dz of [-0.6, 0.6]) S.box(mat('#2b2f35'), T.cx + dx, 0.36, T.cz + dz, 0.06, 0.72, 0.06);
  S.box(mat('#f2f2f2', { transparent: true, opacity: 0.85 }), T.cx, 0.84, T.cz, 0.02, 0.15, 1.7);
  S.add(CYL, mat('#c0392b'), M(T.cx + 0.9, 0.77, T.cz + 0.3, 0, 0, 0, 0.08, 0.015, 0.08));
  S.add(CYL, mat('#111111'), M(T.cx - 0.9, 0.77, T.cz - 0.3, 0, 0, 0, 0.08, 0.015, 0.08));
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 8), mat('#ffffff')); ball.position.set(T.cx, 0.78, T.cz + 0.1); G.scene.add(ball);
  addRect(T.cx - 1.4, T.cz - 0.8, T.cx + 1.4, T.cz + 0.8, 0, 0.9);
  const sg = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.4), new THREE.MeshBasicMaterial({ map: canvasTex(400, 100, (g, w, h) => { g.fillStyle = '#16324f'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.font = 'bold 54px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('TABLE TENNIS', w / 2, h / 2); }), toneMapped: false }));
  sg.position.set(T.cx, 2.3, T.cz - 1.3); G.scene.add(sg);
  G.interact.push({ x: T.cx, z: T.cz + 1.4, r: 1.6, label: 'Play table tennis', act: openGame });
}

// ---------------- the match (top-down; you are at the bottom) ----------------
const L = 2.74, Wt = 1.525, NET = 0.1525, GRAV = 9.8, SLOW = 0.55;
let st = null;
function newState() { return { you: 0, cpu: 0, server: 'you', serves: 0, ball: null, px: 0, cx: 0, msg: 'Click or press Space to serve', over: false, rally: 0, last: performance.now(), keys: {} }; }
window.__pp = { step: (dt) => step(dt), serve: (w) => serve(w), get st() { return st; }, set st(v) { st = v; }, fresh: () => (st = newState()) }; // debug/test hook
function openGame() {
  let ov = document.getElementById('ppov');
  if (!ov) {
    ov = document.createElement('div'); ov.id = 'ppov'; ov.className = 'overlay';
    ov.innerHTML = `<div class="card" style="padding:14px;text-align:center"><button class="close">✕ close (Esc)</button>
      <h2 style="margin:0 0 6px">Table tennis</h2><div id="ppScore" style="font:bold 22px monospace;margin-bottom:6px"></div>
      <canvas id="ppCv" width="420" height="600" style="background:#2a3240;border-radius:8px;cursor:none;max-width:100%"></canvas>
      <div id="ppMsg" class="dim" style="margin-top:6px;font-size:14px"></div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener('click', (e) => { if (e.target === ov || e.target.classList.contains('close')) ov.classList.remove('show'); });
    const cv = ov.querySelector('#ppCv');
    cv.addEventListener('mousemove', (e) => { const r = cv.getBoundingClientRect(); st.px = ((e.clientX - r.left) / r.width - 0.5) * 2.4; });
    cv.addEventListener('mousedown', () => serve('you'));
    addEventListener('keydown', (e) => { if (!ov.classList.contains('show')) return; st.keys[e.code] = true; if (e.code === 'Space') { e.preventDefault(); serve('you'); } });
    addEventListener('keyup', (e) => { if (st) st.keys[e.code] = false; });
  }
  document.querySelectorAll('.overlay').forEach((o) => o.classList.remove('show'));
  ov.classList.add('show'); document.exitPointerLock?.();
  if (!st || st.over) st = newState();
  st.last = performance.now();
  const loop = (now) => { if (!ov.classList.contains('show')) return; const dt = Math.min(0.033, (now - st.last) / 1000); st.last = now; step(dt); draw(); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
}
// ball coordinates: x across (−0.76..0.76), y along (you at +L/2, cpu at −L/2), z height above the table
function launch(fromSide, x0, y0, z0, aimX) {
  const dir = fromSide === 'you' ? -1 : 1;                   // you hit towards −y
  const ty = dir * (0.35 + Math.random() * 0.9);             // land on the other half
  const tx = Math.max(-0.65, Math.min(0.65, aimX));
  const vy = dir * (3.6 + Math.random() * 1.2 + Math.min(st.rally, 10) * 0.08);
  const Tt = (ty - y0) / vy; let vz = (0 - z0 + 0.5 * GRAV * Tt * Tt) / Tt;
  const tn = (0 - y0) / vy; if (z0 + vz * tn - 0.5 * GRAV * tn * tn < NET + 0.05) vz += 0.6; // clear the net
  st.ball = { x: x0, y: y0, z: z0, vx: (tx - x0) / Tt, vy, vz, from: fromSide, bounced: false };
}
function serve(who) {
  if (st.over) { st = newState(); return; }
  if (st.ball || st.server !== who) return;
  st.msg = ''; st.rally = 0;
  if (who === 'you') launch('you', st.px, L / 2 + 0.05, 0.25, -st.px * 0.4 + (Math.random() - 0.5) * 0.6);
  else launch('cpu', st.cx, -L / 2 - 0.05, 0.25, (Math.random() - 0.5) * 1.0);
}
function point(winner, why) {
  st[winner]++; st.ball = null; st.msg = why; st.serves++;
  if (st.serves % 2 === 0) st.server = st.server === 'you' ? 'cpu' : 'you';
  const lead = st.you - st.cpu;
  if ((st.you >= 11 || st.cpu >= 11) && Math.abs(lead) >= 2) {
    st.over = true; st.msg = lead > 0 ? `You win! +${fmt(1000)} – click to play again` : 'The computer wins – click to play again';
    if (lead > 0) { earn(1000); G.sfx?.('success'); } else G.sfx?.('fail');
    return;
  }
  if (st.server === 'cpu') setTimeout(() => { if (st && !st.ball && st.server === 'cpu' && !st.over) serve('cpu'); }, 1100);
  else st.msg += ' · your serve';
}
function step(dt) {
  const k = st.keys; if (k.KeyA || k.ArrowLeft) st.px -= 2.2 * dt; if (k.KeyD || k.ArrowRight) st.px += 2.2 * dt;
  st.px = Math.max(-1.2, Math.min(1.2, st.px));
  const b = st.ball;
  // computer bat follows the ball with limited speed and a little error
  const want = b ? b.x + (b.vy < 0 ? 0 : 0) : 0; const spd = 1.35 + Math.min(st.rally, 12) * 0.03;
  st.cx += Math.max(-spd * dt, Math.min(spd * dt, want - st.cx + Math.sin(performance.now() / 700) * 0.06));
  if (!b) return;
  const h = dt * SLOW;
  b.x += b.vx * h; b.y += b.vy * h; b.vz -= GRAV * h; b.z += b.vz * h;
  // net
  if ((b.y - b.vy * h) * b.y < 0 && b.z < NET) return point(b.from === 'you' ? 'cpu' : 'you', 'Into the net');
  // bounce on the table
  if (b.z <= 0 && b.vz < 0) {
    const on = Math.abs(b.x) <= Wt / 2 && Math.abs(b.y) <= L / 2;
    const ownSide = b.from === 'you' ? b.y > 0 : b.y < 0;
    if (!on) return point(b.from === 'you' ? 'cpu' : 'you', 'Out!');
    if (ownSide || b.bounced) return point(b.from === 'you' ? 'cpu' : 'you', b.bounced ? 'Double bounce' : 'Bounced on own side');
    b.bounced = true; b.z = 0; b.vz = -b.vz * 0.82;
  }
  // hitting: the receiver's bat line
  const recv = b.from === 'you' ? 'cpu' : 'you';
  const lineY = recv === 'you' ? L / 2 + 0.2 : -L / 2 - 0.2, batX = recv === 'you' ? st.px : st.cx;
  const crossed = recv === 'you' ? b.y >= lineY : b.y <= lineY;
  if (crossed) {
    if (b.bounced && Math.abs(b.x - batX) < 0.2 && b.z < 0.9) {
      st.rally++; G.sfx?.('beep');
      const aim = recv === 'you' ? -(b.x - batX) * 4 + (Math.random() - 0.5) * 0.3 : (Math.random() - 0.5) * 1.2 + (st.px > 0 ? -0.3 : 0.3);
      launch(recv, b.x, lineY, Math.max(0.12, b.z), aim);
    } else return b.bounced ? point(b.from, recv === 'you' ? 'Missed!' : 'Point!') : point(recv, 'Out!');
  }
  if (Math.abs(b.y) > L / 2 + 1.2 || Math.abs(b.x) > 2) point(b.from === 'you' ? 'cpu' : 'you', 'Out!');
}
function draw() {
  const cv = document.getElementById('ppCv'); const g = cv.getContext('2d'); const W = cv.width, H = cv.height;
  const sc = 150, ox = W / 2, oy = H / 2; const X = (x) => ox + x * sc, Y = (y) => oy + y * (H / 2 - 40) / (L / 2 + 0.25);
  g.fillStyle = '#2a3240'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#1f4f8f'; g.fillRect(X(-Wt / 2), Y(-L / 2), Wt * sc, Y(L / 2) - Y(-L / 2));
  g.strokeStyle = '#fff'; g.lineWidth = 3; g.strokeRect(X(-Wt / 2), Y(-L / 2), Wt * sc, Y(L / 2) - Y(-L / 2));
  g.lineWidth = 1.5; g.beginPath(); g.moveTo(X(0), Y(-L / 2)); g.lineTo(X(0), Y(L / 2)); g.stroke();
  g.fillStyle = '#e8e8e8'; g.fillRect(X(-Wt / 2 - 0.1), Y(0) - 3, (Wt + 0.2) * sc, 6);
  const bat = (x, y, col) => { g.fillStyle = col; g.beginPath(); g.ellipse(X(x), Y(y), 0.15 * sc, 9, 0, 0, Math.PI * 2); g.fill(); g.fillStyle = '#7a5a3a'; g.fillRect(X(x) - 4, Y(y) + (y > 0 ? 8 : -20), 8, 12); };
  bat(st.cx, -L / 2 - 0.2, '#111'); bat(st.px, L / 2 + 0.2, '#c0392b');
  const b = st.ball;
  if (b) {
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.arc(X(b.x), Y(b.y), 5, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(X(b.x), Y(b.y) - b.z * 60, 5 + b.z * 4, 0, Math.PI * 2); g.fill();
  } else if (!st.over && st.server === 'you') { g.fillStyle = '#fff'; g.beginPath(); g.arc(X(st.px), Y(L / 2 + 0.05) - 15, 5, 0, Math.PI * 2); g.fill(); }
  document.getElementById('ppScore').textContent = `You ${st.you} – ${st.cpu} CPU`;
  document.getElementById('ppMsg').textContent = st.msg || (st.ball ? '' : st.server === 'you' ? 'Click or Space to serve' : '');
}
