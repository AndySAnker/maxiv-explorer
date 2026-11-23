// MAX IV Explorer – game server with multiplayer relay. No dependencies: Node.js ≥ 18 only.
//
//   node server/server.mjs            → http://localhost:8080  (PORT=… to change)
//
// Serves the game (index.html + game.bundle.js) and a WebSocket relay on /ws. Players in the same room
// (?room=name in the page URL, default "lobby") see each other's name, colour, position, scooter and chat.
// Nothing is written to disk; the server only keeps who is online right now.
//
// Environment: PORT (8080) · MAX_PER_ROOM (40) · MAX_TOTAL (400) · MAX_PER_IP (8) · ALLOWED_ORIGINS (comma list; empty = any)
//              TRUST_PROXY=1 when behind a reverse proxy (Render, Fly, nginx), so the client IP comes from X-Forwarded-For
import http from 'node:http';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = +(process.env.PORT || 8080);
const MAX_PER_ROOM = +(process.env.MAX_PER_ROOM || 40);
const MAX_TOTAL = +(process.env.MAX_TOTAL || 400);
const ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
const MAX_PER_IP = +(process.env.MAX_PER_IP || 8);
const TRUST_PROXY = /^(1|true|yes)$/i.test(process.env.TRUST_PROXY || '');
const perIP = new Map(); // address -> open connections
const ipOf = (req) => (TRUST_PROXY && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '?';

// ---------------- static files (only what the game needs) ----------------
const FILES = { '/': 'index.html', '/index.html': 'index.html', '/game.bundle.js': 'game.bundle.js' };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const cache = new Map();
function load(rel) {
  const file = path.join(ROOT, rel); const st = fs.statSync(file); const hit = cache.get(rel);
  if (hit && hit.mtime === st.mtimeMs) return hit;
  const body = fs.readFileSync(file);
  const e = { mtime: st.mtimeMs, body, gz: zlib.gzipSync(body, { level: 9 }), etag: `"${st.size.toString(16)}-${Math.round(st.mtimeMs).toString(16)}"`, type: TYPES[path.extname(rel)] || 'application/octet-stream' };
  cache.set(rel, e); return e;
}
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/healthz') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(`ok ${clients.size} online\n`); }
  const rel = FILES[url.pathname];
  if (!rel || (req.method !== 'GET' && req.method !== 'HEAD')) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('Not found\n'); }
  let f; try { f = load(rel); } catch { res.writeHead(500); return res.end('Missing build – run ./build.sh\n'); }
  if (req.headers['if-none-match'] === f.etag) { res.writeHead(304); return res.end(); }
  const gz = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  res.writeHead(200, { 'content-type': f.type, etag: f.etag, 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff', ...(gz ? { 'content-encoding': 'gzip' } : {}), vary: 'accept-encoding' });
  res.end(req.method === 'HEAD' ? undefined : gz ? f.gz : f.body);
});

// ---------------- minimal WebSocket (RFC 6455): text frames, ping/pong, close ----------------
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MSG = 2048;
function frame(op, payload = Buffer.alloc(0)) {
  const n = payload.length; const head = n < 126 ? Buffer.from([0x80 | op, n]) : n < 65536 ? Buffer.from([0x80 | op, 126, n >> 8, n & 255]) : null;
  if (!head) throw new Error('frame too big'); return Buffer.concat([head, payload]);
}
server.on('upgrade', (req, sock) => {
  const url = new URL(req.url, 'http://x'); const key = req.headers['sec-websocket-key'];
  const bad = (code, msg) => { sock.end(`HTTP/1.1 ${code} ${msg}\r\nConnection: close\r\n\r\n`); };
  if (url.pathname !== '/ws' || !key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') return bad(400, 'Bad Request');
  if (ORIGINS.length && !ORIGINS.includes(req.headers.origin)) return bad(403, 'Forbidden');
  if (clients.size >= MAX_TOTAL) return bad(503, 'Server Full');
  const ip = ipOf(req); if ((perIP.get(ip) || 0) >= MAX_PER_IP) return bad(429, 'Too Many Connections');
  const roomName = cleanText(url.searchParams.get('room') || 'lobby', 32).toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'lobby';
  const room = rooms.get(roomName) || new Map();
  if (room.size >= MAX_PER_ROOM) return bad(503, 'Room Full');
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  sock.setNoDelay(true);
  perIP.set(ip, (perIP.get(ip) || 0) + 1);
  join(sock, roomName, room, ip);
});

// ---------------- rooms and players ----------------
const rooms = new Map(); // room name -> Map(id -> client)
const clients = new Set();
let nextId = 1;
function join(sock, roomName, room, ip) {
  const c = { id: 'p' + (nextId++).toString(36), sock, roomName, room, ip, pres: {}, buf: Buffer.alloc(0), alive: true, tokens: 30, last: Date.now(), chat: [] };
  room.set(c.id, c); rooms.set(roomName, room); clients.add(c);
  send(c, { t: 'welcome', id: c.id, room: roomName, peers: [...room.values()].filter((o) => o !== c).map((o) => ({ peer: o.id, presence: o.pres })) });
  sock.on('data', (d) => onData(c, d));
  sock.on('close', () => leave(c)); sock.on('error', () => leave(c)); sock.on('end', () => leave(c));
}
function leave(c) {
  if (!clients.has(c)) return; clients.delete(c); c.room.delete(c.id);
  const n = (perIP.get(c.ip) || 1) - 1; if (n > 0) perIP.set(c.ip, n); else perIP.delete(c.ip);
  if (!c.room.size) rooms.delete(c.roomName); else broadcast(c, { t: 'leave', peer: c.id });
  try { c.sock.destroy(); } catch { /* already closed */ }
}
function send(c, obj) { try { c.sock.write(frame(1, Buffer.from(JSON.stringify(obj)))); } catch { leave(c); } }
function broadcast(from, obj) { const data = frame(1, Buffer.from(JSON.stringify(obj))); for (const o of from.room.values()) if (o !== from) { try { o.sock.write(data); } catch { leave(o); } } }
function onData(c, chunk) {
  c.buf = Buffer.concat([c.buf, chunk]);
  while (c.buf.length >= 2) {
    const b0 = c.buf[0], b1 = c.buf[1]; const op = b0 & 15, fin = b0 & 128, masked = b1 & 128; let len = b1 & 127, off = 2;
    if (len === 126) { if (c.buf.length < 4) return; len = c.buf.readUInt16BE(2); off = 4; } else if (len === 127) return leave(c);
    if (!masked || !fin || len > MAX_MSG) return leave(c); // clients must mask; no fragments; small messages only
    if (c.buf.length < off + 4 + len) return;
    const mask = c.buf.subarray(off, off + 4); const data = Buffer.from(c.buf.subarray(off + 4, off + 4 + len));
    for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
    c.buf = c.buf.subarray(off + 4 + len);
    if (op === 8) return leave(c);
    if (op === 9) { try { c.sock.write(frame(10, data)); } catch { leave(c); } continue; }
    if (op === 10) { c.alive = true; continue; }
    if (op === 1) onMessage(c, data.toString('utf8'));
  }
}

// ---------------- what players may share (everything else is dropped) ----------------
const BAD = (n) => n < 32 || (n >= 0x7f && n <= 0x9f) || n === 0xad || (n >= 0x200b && n <= 0x200f) || (n >= 0x2028 && n <= 0x202e) || (n >= 0x2060 && n <= 0x206f) || n === 0xfeff;
function cleanText(s, n) { return Array.from(String(s ?? '')).filter((ch) => !BAD(ch.codePointAt(0))).join('').trim().slice(0, n); }
// a short list of slurs and obscenities (English, Danish, Swedish) is masked in names and chat
const BLOCK = ['fuck', 'shit', 'cunt', 'nigger', 'nigga', 'faggot', 'retard', 'whore', 'bitch', 'kuk', 'fitta', 'hora', 'knulla', 'luder', 'fisse', 'pik', 'kusse', 'neger', 'bøsserøv'];
const BLOCK_RE = new RegExp(`(${BLOCK.join('|')})`, 'gi');
const tidy = (s, n) => cleanText(s, n).replace(BLOCK_RE, (m) => '*'.repeat(m.length));
const num = (v, lim) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(-lim, Math.min(lim, Math.round(v * 100) / 100)) : undefined);
function sanitize(c, p) {
  const out = {};
  if ('name' in p) out.name = tidy(p.name, 20) || 'Someone';
  if ('c' in p && /^#[0-9a-f]{6}$/i.test(p.c)) out.c = p.c;
  for (const k of ['x', 'y', 'z']) if (k in p) { const v = num(p[k], 2000); if (v !== undefined) out[k] = v; }
  if ('h' in p) { const v = num(p.h, 100); if (v !== undefined) out.h = v; }
  if ('v' in p) out.v = p.v === 'scooter' ? 'scooter' : '';
  if ('say' in p) {
    const now = Date.now(); c.chat = c.chat.filter((t) => now - t < 60000);
    if (c.chat.length < 12 && (!c.chat.length || now - c.chat[c.chat.length - 1] > 800)) { const t = tidy(p.say, 200); if (t) { out.say = t; out.sayT = now; c.chat.push(now); } }
  }
  return out;
}
function onMessage(c, txt) {
  const now = Date.now(); c.tokens = Math.min(30, c.tokens + (now - c.last) * 0.03); c.last = now; // ~30 messages/s sustained at most
  if (c.tokens < 1) return; c.tokens -= 1;
  let m; try { m = JSON.parse(txt); } catch { return; }
  if (!m || m.t !== 'p' || typeof m.p !== 'object' || m.p === null) return;
  const patch = sanitize(c, m.p); if (!Object.keys(patch).length) return;
  const { say, sayT, ...keep } = patch; Object.assign(c.pres, keep); if (say) { c.pres.say = say; c.pres.sayT = sayT; }
  broadcast(c, { t: 'upd', peer: c.id, presence: patch });
  if (say) send(c, { t: 'said', say, sayT }); // echo the cleaned text to the speaker
}

// drop connections that stopped answering pings
setInterval(() => {
  for (const c of clients) { if (!c.alive) { leave(c); continue; } c.alive = false; try { c.sock.write(frame(9)); } catch { leave(c); } }
}, 25000).unref();

server.listen(PORT, () => console.log(`MAX IV Explorer on http://localhost:${PORT}  (relay: /ws, health: /healthz)`));
