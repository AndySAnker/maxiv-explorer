// "From MAX I to MAX IV": a small exhibition in the 3 GeV hall, on the left of CoSAXS as you come in from the reception.
// One plinth per ring with a model (cells and bending magnets as in the real lattice), a plaque, a title wall and a
// "rings to scale" wall. Facts: MAX IV Laboratory (Wikipedia) and MAX-lab papers at JACoW.
import * as THREE from 'three';
import { G } from './state.js';
import { mat, canvasTex, DEG } from './util.js';
import { B, M } from './build.js';
import { addCircle, addBox } from './physics.js';

const RINGS = [
  { name: 'MAX I', years: '1985 – 2015', E: '550 MeV', C: 32, cells: 4, bends: 2, lattice: '4 double-bend achromats', emit: '40 nm rad', note: 'The first MAX-lab ring', col: '#e0b33c' },
  { name: 'MAX II', years: '1995 – 2015', E: '1.5 GeV', C: 90, cells: 10, bends: 2, lattice: '10 double-bend achromats', emit: '9 nm rad', note: 'Workhorse for VUV and soft X-rays', col: '#4fb3d9' },
  { name: 'MAX III', years: '2007 – 2015', E: '700 MeV', C: 36, cells: 8, bends: 1, lattice: '8 compact cells', emit: '13 nm rad', note: 'Prototype for the MAX IV magnet design', col: '#7ad36b' },
  { name: 'MAX IV', years: '2016 –', E: '3 GeV', C: 528, cells: 20, bends: 7, lattice: '20 seven-bend achromats', emit: '0.33 nm rad', note: 'First multibend-achromat ring · plus a 1.5 GeV ring (96 m)', col: '#c46bff' },
];
const R0 = 110.5, A0 = 4, DA = 4; // plinths on an arc at radius R0, from angle A0 in steps of DA degrees

function plaque(r) {
  return canvasTex(512, 410, (g, w, h) => {
    g.fillStyle = '#14202c'; g.fillRect(0, 0, w, h); g.fillStyle = r.col; g.fillRect(0, 0, w, 12);
    g.textAlign = 'left'; g.fillStyle = '#fff'; g.font = 'bold 66px Arial'; g.fillText(r.name, 28, 92);
    g.font = '30px Arial'; g.fillStyle = '#9fb3c8'; g.fillText(r.years, 30, 136);
    const rows = [['Energy', r.E], ['Circumference', `${r.C} m`], ['Lattice', r.lattice], ['Emittance', r.emit]];
    rows.forEach(([k, v], i) => { const y = 192 + i * 46; g.fillStyle = '#7f93a8'; g.font = '26px Arial'; g.fillText(k, 30, y); g.fillStyle = '#fff'; g.font = 'bold 28px Arial'; g.fillText(v, 210, y, w - 230); });
    g.fillStyle = r.col; g.font = 'italic 24px Arial'; g.fillText(r.note, 30, h - 22, w - 50);
  });
}
// a ring model: vacuum chamber + bending magnets (red) + quadrupoles (yellow) + insertion devices (blue) in the straights
function ringModel(S, r, cx, cy, cz) {
  const Rm = 0.4, red = mat('#c0392b'), yel = mat('#f2c40f'), blu = mat('#2f6fd0');
  S.add(new THREE.TorusGeometry(Rm, 0.011, 6, 72), mat('#c9d1d8', { metalness: 0.6, roughness: 0.3 }), M(cx, cy, cz, 0, Math.PI / 2, 0));
  const span = 2 * Math.PI / r.cells;
  const at = (th) => [cx + Rm * Math.cos(th), cz + Rm * Math.sin(th)];
  for (let c = 0; c < r.cells; c++) {
    const a0 = c * span;
    for (let b = 0; b < r.bends; b++) {
      const th = a0 + span * (0.18 + 0.64 * (b + 0.5) / r.bends); const [x, z] = at(th);
      S.box(red, x, cy, z, 0.07, 0.05, Math.min(0.12, span * Rm * 0.5 / r.bends), -th);
      if (b < r.bends - 1 || r.bends === 1) { const tq = th + span * 0.32 / r.bends; const [qx, qz] = at(tq); S.box(yel, qx, cy, qz, 0.06, 0.04, 0.025, -tq); }
    }
    const [ux, uz] = at(a0); S.box(blu, ux, cy, uz, 0.045, 0.035, Math.min(0.09, span * Rm * 0.25), -a0);
  }
}
function scaleWall() {
  return canvasTex(1024, 520, (g, w, h) => {
    g.fillStyle = '#101a24'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff'; g.font = 'bold 44px Arial'; g.textAlign = 'left'; g.fillText('Rings to scale', 30, 60);
    g.font = '24px Arial'; g.fillStyle = '#9fb3c8'; g.fillText('Same scale for all rings · circumference in metres', 30, 96);
    const s = 2.55, X = 300, Y = 300; // px per metre
    const circ = (C, col, lw) => { g.strokeStyle = col; g.lineWidth = lw; g.beginPath(); g.arc(X, Y, C / (2 * Math.PI) * s, 0, 2 * Math.PI); g.stroke(); };
    circ(528, '#c46bff', 5);
    g.fillStyle = '#c46bff'; g.font = 'bold 26px Arial'; g.fillText('MAX IV 3 GeV · 528 m', X + 140, Y - 190);
    // the small rings, side by side inside the big one
    const small = [['MAX I', 32, '#e0b33c'], ['MAX III', 36, '#7ad36b'], ['MAX II', 90, '#4fb3d9'], ['MAX IV 1.5 GeV', 96, '#ff9f5a']];
    let x = X - 90;
    small.forEach(([n, C, col], i) => {
      const r = C / (2 * Math.PI) * s; x += r + 8; g.strokeStyle = col; g.lineWidth = 3; g.beginPath(); g.arc(x, Y, r, 0, 2 * Math.PI); g.stroke();
      g.fillStyle = col; g.font = 'bold 20px Arial'; g.textAlign = 'center'; g.fillText(n, x, Y + (i % 2 ? -r - 12 : r + 28)); g.fillText(`${C} m`, x, Y + (i % 2 ? -r - 36 : r + 52)); x += r;
    });
    g.textAlign = 'left'; g.fillStyle = '#9fb3c8'; g.font = '22px Arial';
    ['Brighter means smaller: the emittance fell', 'from 40 nm rad (MAX I) to 0.33 nm rad (MAX IV),', 'thanks to many gentle bends per cell.'].forEach((t, i) => g.fillText(t, 640, 380 + i * 32));
  });
}

export function buildExhibit() {
  const S = B.main; const plinth = mat('#eef0f2', { roughness: 0.6 });
  RINGS.forEach((r, k) => {
    const a = (A0 + k * DA) * DEG; const x = R0 * Math.cos(a), z = R0 * Math.sin(a); const face = Math.atan2(-Math.cos(a), -Math.sin(a));
    S.box(plinth, x, 0.5, z, 1.1, 1.0, 1.1, face); addCircle(x, z, 0.72, 0, 1.2);
    ringModel(S, r, x, 1.08, z);
    const p = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.8), new THREE.MeshBasicMaterial({ map: plaque(r), toneMapped: false }));
    p.position.set(x - Math.cos(a) * 0.56, 0.52, z - Math.sin(a) * 0.56); p.rotation.y = face; G.scene.add(p);
    G.interact.push({ x: x - Math.cos(a) * 1.3, z: z - Math.sin(a) * 1.3, r: 1.3, label: `Read about ${r.name}`,
      act: () => G.ui.big(r.name, `${r.years} · ${r.E} · ${r.C} m · ${r.lattice} · ${r.emit}`, r.col, 7) });
  });
  // two walls behind the plinths
  const wall = (ang, tex, title) => {
    const a = ang * DEG, rr = 114.2; const x = rr * Math.cos(a), z = rr * Math.sin(a); const face = Math.atan2(-Math.cos(a), -Math.sin(a));
    S.box(mat('#2a3542'), x + Math.cos(a) * 0.1, 1.55, z + Math.sin(a) * 0.1, 5.4, 3.1, 0.16, face);
    addBox(x, z, 5.4, 0.4, -Math.sin(a), Math.cos(a), 0, 3.1);
    const p = new THREE.Mesh(new THREE.PlaneGeometry(5.2, title ? 2.6 : 2.64), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    p.position.set(x - Math.cos(a) * 0.0, 1.6, z - Math.sin(a) * 0.0); p.rotation.y = face; G.scene.add(p);
  };
  wall(6.5, canvasTex(1024, 512, (g, w, h) => {
    g.fillStyle = '#101a24'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffd84a'; g.font = 'bold 30px Arial'; g.textAlign = 'center'; g.fillText('EXHIBITION', w / 2, 80);
    g.fillStyle = '#fff'; g.font = 'bold 84px Arial'; g.fillText('From MAX I to MAX IV', w / 2, 190);
    g.fillStyle = '#9fb3c8'; g.font = '32px Arial'; g.fillText('Four generations of electron storage rings in Lund', w / 2, 260);
    g.font = '26px Arial';
    ['MAX I 1985 · MAX II 1995 · MAX III 2007 · MAX IV 2016', 'Walk up to a model and press E to read about it'].forEach((t, i) => g.fillText(t, w / 2, 350 + i * 50));
  }), true);
  wall(15, scaleWall(), false);
}
