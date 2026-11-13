// Tiny WebAudio synth for sound effects and an engine hum.
import { G } from './state.js';
let ac = null, master = null, eng = null;
export function initAudio() {
  if (ac) return;
  try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
  master = ac.createGain(); master.gain.value = 0.5; master.connect(ac.destination);
  // engine
  const o = ac.createOscillator(); o.type = 'sawtooth'; const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400;
  const g = ac.createGain(); g.gain.value = 0; o.connect(f); f.connect(g); g.connect(master); o.start(); eng = { o, f, g };
  G.sfx = sfx;
}
function tone(freq, dur, type = 'square', vol = 0.2, slide = 0, delay = 0) {
  if (!ac) return; const t = ac.currentTime + delay;
  const o = ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
  const g = ac.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, vol = 0.3, lp = 1200) {
  if (!ac) return; const n = ac.sampleRate * dur; const b = ac.createBuffer(1, n, ac.sampleRate); const d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const s = ac.createBufferSource(); s.buffer = b; const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp;
  const g = ac.createGain(); g.gain.value = vol; s.connect(f); f.connect(g); g.connect(master); s.start();
}
export function sfx(name) {
  switch (name) {
    case 'jump': tone(300, 0.12, 'sine', 0.08, 200); break;
    case 'hit': noise(0.25, 0.4, 800); tone(140, 0.2, 'square', 0.1, -60); break;
    case 'crash': noise(0.5, 0.6, 600); break;
    case 'honk': tone(392, 0.35, 'square', 0.12); tone(330, 0.35, 'square', 0.1); break;
    case 'tram': tone(1046, 0.25, 'triangle', 0.15); tone(1046, 0.25, 'triangle', 0.15, 0, 0.3); break;
    case 'pickup': tone(880, 0.1, 'sine', 0.2); tone(1320, 0.18, 'sine', 0.2, 0, 0.08); break;
    case 'success': [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.25, 'triangle', 0.18, 0, i * 0.12)); break;
    case 'fail': [392, 330, 262].forEach((f, i) => tone(f, 0.35, 'sawtooth', 0.12, 0, i * 0.2)); break;
    case 'alarm': for (let i = 0; i < 6; i++) tone(i % 2 ? 660 : 880, 0.25, 'square', 0.12, 0, i * 0.27); break;
    case 'beep': tone(1200, 0.08, 'square', 0.1); break;
    case 'door': noise(0.3, 0.08, 400); break;
    case 'star': tone(200, 0.3, 'sawtooth', 0.12, 300); break;
  }
}
export function engineSound(v) {
  if (!eng) return;
  const t = ac.currentTime;
  if (!v || v.type === 'bike' || v.type === 'scooter') { eng.g.gain.setTargetAtTime(0, t, 0.1); return; }
  const sp = Math.abs(v.speed); eng.o.frequency.setTargetAtTime(45 + sp * 4.5 + (v.type === 'cart' ? 60 : 0), t, 0.05);
  eng.f.frequency.setTargetAtTime(300 + sp * 30, t, 0.05); eng.g.gain.setTargetAtTime(v.type === 'cart' ? 0.03 : 0.07, t, 0.1);
}
