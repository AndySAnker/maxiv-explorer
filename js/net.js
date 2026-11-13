// Multiplayer: when the game runs as a shared claude.ai artifact, everyone who has it open is in one "room".
// Each player shares a small presence object (name, colour, position, scooter, last chat line); others are drawn
// as avatars with name tags. Opened from disk there is no room and the game stays single-player.
import * as THREE from 'three';
import { G } from './state.js';
import { makeHuman, animHuman, vehModel } from './actors.js';
import { bubbleSprite, canvasTex } from './util.js';

// keep printable text only (drop control, format and invisible characters)
const BAD = (c) => c < 32 || (c >= 0x7f && c <= 0x9f) || c === 0xad || (c >= 0x200b && c <= 0x200f) || (c >= 0x2028 && c <= 0x202e) || (c >= 0x2060 && c <= 0x206f) || c === 0xfeff;
const clean = (s, n) => Array.from(String(s ?? '')).filter((ch) => !BAD(ch.codePointAt(0))).join('').trim().slice(0, n);
export const NET = { room: null, avatars: new Map(), online: 1, lastSend: 0, lastSig: '', myColor: '#d8452f' };

function nameTag(name, color) {
  const tex = canvasTex(256, 64, (g, w, h) => {
    g.font = 'bold 30px Trebuchet MS, Arial'; const tw = Math.min(w - 8, g.measureText(name).width + 28);
    g.fillStyle = 'rgba(10,14,20,0.7)'; g.beginPath(); g.roundRect((w - tw) / 2, 8, tw, h - 16, 16); g.fill();
    g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(name, w / 2, h / 2 + 1, w - 20);
  });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, toneMapped: false }));
  s.scale.set(2.2, 0.55, 1); s.position.y = 2.25; s.renderOrder = 9; return s;
}
function logLine(text, color = '#c9d6e3') {
  const box = document.getElementById('chatlog'); if (!box) return;
  const d = document.createElement('div'); d.textContent = text; d.style.color = color; box.appendChild(d);
  while (box.children.length > 7) box.removeChild(box.firstChild);
  setTimeout(() => d.classList.add('old'), 15000);
}
function sayBubble(group, text) {
  if (group.userData.bubble) group.remove(group.userData.bubble);
  const b = bubbleSprite(text.length > 60 ? text.slice(0, 58) + '…' : text); b.position.y = 2.75; group.add(b); group.userData.bubble = b;
  clearTimeout(group.userData.bt); group.userData.bt = setTimeout(() => { group.remove(b); if (group.userData.bubble === b) group.userData.bubble = null; }, 6000);
}

export async function initNet(name) {
  NET.myName = name;
  NET.myColor = ['#d8452f', '#2f7fd0', '#2a9d5c', '#8a4fd8', '#e0a030', '#d14f8f', '#1aa6a0'][Math.floor(Math.random() * 7)];
  try { NET.myColor = localStorage.getItem('beamtime.color') || NET.myColor; localStorage.setItem('beamtime.color', NET.myColor); } catch { /* storage unavailable */ }
  updateOnline();
  if (!window.claude || typeof window.claude.use !== 'function') return; // opened from disk: single-player
  let room = null; try { room = await window.claude.use('room'); } catch { room = null; }
  if (!room) return;
  NET.room = room;
  room.onPeers((ch) => {
    for (const p of ch.joined) if (!p.sameTab && p.kind === 'viewer') logLine(`${clean(p.presence?.name, 20) || 'Someone'} joined`, '#7dffb0');
    for (const p of ch.left) { const a = NET.avatars.get(p.peer); if (a) { logLine(`${a.name} left`, '#8597aa'); G.scene.remove(a.group); NET.avatars.delete(p.peer); } }
    for (const p of [...ch.joined, ...ch.updated]) if (!p.sameTab && p.kind === 'viewer') upsert(p);
    NET.online = ch.peers.filter((p) => p.kind === 'viewer').length; updateOnline();
  }, () => { NET.room = null; updateOnline(); });
  logLine('Connected – press T to chat', '#7dffb0');
}
function upsert(p) {
  const pr = p.presence || {}; if (typeof pr.x !== 'number' || typeof pr.z !== 'number') return;
  const name = clean(pr.name, 20) || 'Someone', color = /^#[0-9a-f]{6}$/i.test(pr.c) ? pr.c : '#cccccc';
  let a = NET.avatars.get(p.peer);
  if (!a) {
    const h = makeHuman({ shirt: color }); const group = new THREE.Group(); group.add(h.g);
    const tag = nameTag(name, color); group.add(tag);
    const sc = vehModel('scooter', color); sc.g.visible = false; group.add(sc.g);
    G.scene.add(group);
    a = { group, h, tag, scooter: sc.g, name, color, cur: new THREE.Vector3(pr.x, pr.y || 0, pr.z), tgt: new THREE.Vector3(), yaw: pr.h || 0, phase: 0, sayT: pr.sayT || 0 };
    group.position.copy(a.cur); NET.avatars.set(p.peer, a);
  }
  if (name !== a.name) { a.group.remove(a.tag); a.tag = nameTag(name, color); a.group.add(a.tag); a.name = name; }
  a.tgt.set(pr.x, typeof pr.y === 'number' ? pr.y : 0, pr.z); a.tgtYaw = typeof pr.h === 'number' ? pr.h : a.yaw; a.onScooter = pr.v === 'scooter';
  if (pr.sayT && pr.sayT !== a.sayT && typeof pr.say === 'string') { a.sayT = pr.sayT; const t = clean(pr.say, 200); if (t) { sayBubble(a.group, t); logLine(`${name}: ${t}`); } }
}
function updateOnline() {
  const el = document.getElementById('online'); if (!el) return;
  el.textContent = NET.room ? `👥 ${NET.online} online` : '';
}

// called every frame: share my state, move the other players smoothly
export function netTick(dt) {
  const p = G.player; if (!p) return;
  if (NET.room) {
    const v = p.vehicle; const pos = v ? v.pos : p.pos; const yaw = v ? v.heading : p.yaw;
    const now = performance.now();
    const pres = { name: NET.myName, c: NET.myColor, x: +pos.x.toFixed(2), y: +pos.y.toFixed(2), z: +pos.z.toFixed(2), h: +yaw.toFixed(2), v: v ? v.type : '' };
    const sig = JSON.stringify(pres);
    if (sig !== NET.lastSig && now - NET.lastSend > 66) { NET.lastSig = sig; NET.lastSend = now; NET.room.presence(pres).catch(() => {}); }
  }
  const blips = [];
  for (const a of NET.avatars.values()) {
    const before = a.cur.clone(); a.cur.lerp(a.tgt, Math.min(1, dt * 10));
    if (a.cur.distanceTo(a.tgt) > 30) a.cur.copy(a.tgt);
    a.yaw += (((a.tgtYaw ?? a.yaw) - a.yaw + Math.PI * 3) % (Math.PI * 2) - Math.PI) * Math.min(1, dt * 10);
    a.group.position.copy(a.cur); a.group.rotation.y = 0;
    a.h.g.rotation.y = a.yaw; a.scooter.rotation.y = a.yaw; a.scooter.visible = !!a.onScooter;
    a.h.g.position.y = a.onScooter ? 0.19 : 0;
    const spd = before.distanceTo(a.cur) / Math.max(dt, 1e-3);
    a.phase += spd * dt * 2.1; animHuman(a.h, a.phase, a.onScooter ? 0 : Math.min(0.9, spd * 0.12), false);
    if (a.onScooter) { a.h.armL.rotation.x = a.h.armR.rotation.x = -0.95; }
    blips.push({ x: a.cur.x, z: a.cur.z });
  }
  G.remoteBlips = blips;
}

// chat: T opens the input, Enter sends, Esc cancels
export function openChat() {
  const inp = document.getElementById('chatin'); if (!inp) return;
  if (!NET.room) { G.ui.toast('Chat works when the game is opened from the shared link'); return; }
  inp.style.display = 'block'; inp.value = ''; document.exitPointerLock?.(); setTimeout(() => inp.focus(), 0);
}
export function initChatInput() {
  const inp = document.getElementById('chatin'); if (!inp) return;
  inp.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { const t = clean(inp.value, 200); if (t) say(t); inp.style.display = 'none'; inp.blur(); }
    else if (e.key === 'Escape') { inp.style.display = 'none'; inp.blur(); }
  });
}
function say(text) {
  sayBubble(G.player.h.g, text); logLine(`${NET.myName}: ${text}`, '#ffffff');
  NET.room?.presence({ say: text, sayT: Date.now() }).catch(() => {});
}
