import * as THREE from 'three';

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const normAng = (a) => { a %= TAU; return a < 0 ? a + TAU : a; };
export const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
export function seeded(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

const mats = new Map();
export function mat(color, o = {}) {
  const k = color + '|' + JSON.stringify(o);
  let m = mats.get(k);
  if (!m) { m = new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.75, metalness: 0.05 }, o)); mats.set(k, m); }
  return m;
}

export function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}

export function noiseTex(base, amount = 18, size = 256, repeat = [1, 1], extra) {
  return canvasTex(size, size, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    const img = g.getImageData(0, 0, w, h); const d = img.data;
    for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * amount; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    g.putImageData(img, 0, 0);
    if (extra) extra(g, w, h);
  }, repeat);
}

export function labelTex(lines, { w = 512, h = 128, bg = '#15181c', fg = '#ffffff', font = 'bold 64px Arial', sub = null, border = null } = {}) {
  if (!Array.isArray(lines)) lines = [lines];
  return canvasTex(w, h, (g) => {
    if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
    if (border) { g.strokeStyle = border; g.lineWidth = h * 0.06; g.strokeRect(0, 0, w, h); }
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    const n = lines.length;
    lines.forEach((ln, i) => {
      g.font = i === 0 ? font : (sub || font.replace(/\d+px/, (m) => Math.round(parseInt(m) * 0.5) + 'px'));
      g.fillText(ln, w / 2, h * (i + 0.5) / n, w * 0.94);
    });
  });
}

export function textPlane(lines, width, height, opts = {}) {
  const tex = labelTex(lines, Object.assign({ w: Math.round(256 * width / height) * 2, h: 256 }, opts));
  const m = new THREE.Mesh(new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ map: tex, transparent: !opts.bg, side: opts.double ? THREE.DoubleSide : THREE.FrontSide, toneMapped: false }));
  return m;
}

const bubbleCache = new Map();
export function bubbleSprite(text, color = '#ffffff') {
  const key = text + color;
  let mtl = bubbleCache.get(key);
  if (!mtl) {
    const tex = canvasTex(512, 96, (g, w, h) => {
      g.font = 'bold 34px Trebuchet MS, Arial';
      const tw = Math.min(w - 10, g.measureText(text).width + 40);
      g.fillStyle = 'rgba(15,18,24,0.82)';
      const x = (w - tw) / 2; g.beginPath(); g.roundRect(x, 8, tw, h - 16, 24); g.fill();
      g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, h / 2 + 1, w - 30);
    });
    mtl = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, toneMapped: false });
    bubbleCache.set(key, mtl);
  }
  const s = new THREE.Sprite(mtl); s.scale.set(4.2, 0.8, 1); s.renderOrder = 10;
  return s;
}

import { PHOTO_DATA } from './photodata.js';
const loader = new THREE.TextureLoader();
const photoCache = {};
export function photo(file) {
  if (!photoCache[file]) {
    const t = loader.load(PHOTO_DATA[file] || 'assets/photos/' + file);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    photoCache[file] = t;
  }
  return photoCache[file];
}

// Radiation trefoil sign texture
export function trefoilTex() {
  return canvasTex(256, 256, (g, w) => {
    g.fillStyle = '#ffd400'; g.beginPath(); g.moveTo(w / 2, 8); g.lineTo(w - 8, w - 20); g.lineTo(8, w - 20); g.closePath(); g.fill();
    g.strokeStyle = '#111'; g.lineWidth = 10; g.stroke();
    g.fillStyle = '#111'; const cx = w / 2, cy = w * 0.62;
    for (let i = 0; i < 3; i++) { const a = -Math.PI / 2 + i * TAU / 3; g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, 62, a - 0.52, a + 0.52); g.closePath(); g.fill(); }
    g.fillStyle = '#ffd400'; g.beginPath(); g.arc(cx, cy, 20, 0, TAU); g.fill();
    g.fillStyle = '#111'; g.beginPath(); g.arc(cx, cy, 13, 0, TAU); g.fill();
  });
}
