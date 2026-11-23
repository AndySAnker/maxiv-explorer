// Lunch food truck on the east end of the plaza, outside the office. A different truck comes every day (picked
// from the date, so everyone playing on the same day sees the same one), with a menu chosen from its dishes.
import * as THREE from 'three';
import { G } from './state.js';
import { charge, canPay, fmt } from './economy.js';
import { mat, canvasTex, textPlane, seeded } from './util.js';
import { B, M, CYL } from './build.js';
import { addRect, addCircle } from './physics.js';
import { sfx } from './audio.js';

export const FOODTRUCK = { x: 189, z: 33 }; // truck centre; long side along z, serving hatch facing west (−x)

// Fictional trucks. Dishes: [name, description, price in kr, vegetarian]
const TRUCKS = [
  { name: 'Beamtime Burgers', tag: 'Smash burgers, 3 GeV of flavour', body: '#d64933', accent: '#ffd166', icon: '🍔', dishes: [
    ['Smash burger', 'double patty, cheddar, pickles, house sauce', 125, false],
    ['Halloumi burger', 'grilled halloumi, chili mayo, pickled onion', 119, true],
    ['Skåne bacon burger', 'local beef, crispy bacon, Västerbotten cheese', 135, false],
    ['Crispy chicken burger', 'buttermilk chicken, slaw, jalapeño', 125, false],
    ['Beyond burger', 'plant-based patty, avocado, tomato', 122, true]] },
  { name: 'Tacos Brunnshög', tag: 'Tortillas pressed fresh every morning', body: '#2a9d8f', accent: '#f4a261', icon: '🌮', dishes: [
    ['Tacos al pastor', 'marinated pork, pineapple, coriander', 115, false],
    ['Birria tacos', 'slow-cooked beef, consommé for dipping', 129, false],
    ['Baja fish tacos', 'beer-battered cod, lime slaw', 125, false],
    ['Hongos tacos', 'oyster mushrooms, black beans, salsa verde', 109, true],
    ['Burrito bowl', 'rice, beans, corn, pico de gallo, guacamole', 112, true]] },
  { name: 'Pho-ton Kitchen', tag: 'Broth simmered for 12 hours', body: '#219ebc', accent: '#ffffff', icon: '🍜', dishes: [
    ['Pho bò', 'beef noodle soup, Thai basil, lime', 125, false],
    ['Pho gà', 'chicken noodle soup, ginger, spring onion', 119, false],
    ['Bánh mì', 'pork belly, pickled carrot, pâté, chili', 99, false],
    ['Tofu bánh mì', 'lemongrass tofu, cucumber, coriander', 95, true],
    ['Summer rolls', 'rice paper rolls with peanut dip', 89, true]] },
  { name: 'Pizza Undulator', tag: 'Wood-fired at 450 °C', body: '#9b2226', accent: '#e9d8a6', icon: '🍕', dishes: [
    ['Margherita', 'San Marzano tomato, fior di latte, basil', 115, true],
    ['Quattro formaggi', 'four cheeses, honey, walnuts', 129, true],
    ['Diavola', 'spicy salami, chili oil, oregano', 129, false],
    ['Nduja & burrata', 'spreadable salami, burrata, rocket', 139, false],
    ['Funghi', 'mushrooms, thyme, garlic cream', 122, true]] },
  { name: 'Falafel Fotongatan', tag: 'Crispy outside, green inside', body: '#588157', accent: '#fefae0', icon: '🧆', dishes: [
    ['Falafel wrap', 'tahini, pickles, tomato, parsley', 99, true],
    ['Falafel plate', 'hummus, tabbouleh, flatbread', 115, true],
    ['Chicken shawarma', 'garlic sauce, pickled turnip, fries', 119, false],
    ['Sabich', 'fried aubergine, egg, amba, salad', 105, true],
    ['Halloumi plate', 'grilled halloumi, couscous, pomegranate', 119, true]] },
  { name: 'Curry Cavity', tag: 'Resonating with spice', body: '#e76f51', accent: '#264653', icon: '🍛', dishes: [
    ['Butter chicken', 'tomato-cream curry, basmati, naan', 125, false],
    ['Chana masala', 'chickpea curry, basmati, raita', 109, true],
    ['Lamb rogan josh', 'slow-cooked lamb, cardamom, naan', 135, false],
    ['Palak paneer', 'spinach curry with paneer, rice', 115, true],
    ['Samosa box', 'three samosas, tamarind chutney', 89, true]] },
  { name: 'Ramen Ring', tag: 'Noodles in a closed loop', body: '#264653', accent: '#e9c46a', icon: '🍥', dishes: [
    ['Tonkotsu ramen', 'pork broth, chashu, soft egg', 135, false],
    ['Miso ramen', 'miso broth, corn, tofu, bok choy', 125, true],
    ['Spicy tantanmen', 'sesame-chili broth, minced pork', 135, false],
    ['Gyoza', 'six pan-fried dumplings, ponzu', 85, false],
    ['Karaage don', 'fried chicken on rice, kewpie mayo', 119, false]] },
  { name: 'Mormors Skånska Kök', tag: 'Husmanskost like grandma made it', body: '#6d597a', accent: '#f2cc8f', icon: '🥔', dishes: [
    ['Köttbullar', 'meatballs, mashed potato, lingonberries', 125, false],
    ['Äggakaka med fläsk', 'Skåne oven pancake, crispy pork, lingonberries', 129, false],
    ['Kroppkakor', 'potato dumplings, melted butter, lingonberries', 115, false],
    ['Raggmunk', 'potato pancakes, lingonberries (veg version)', 105, true],
    ['Ålagille-style fish plate', 'smoked fish, egg, dill potatoes', 139, false]] },
  { name: 'Poké Positron', tag: 'Bowls with a positive charge', body: '#ef476f', accent: '#06d6a0', icon: '🥗', dishes: [
    ['Salmon poké', 'sushi rice, edamame, mango, sesame', 135, false],
    ['Tuna poké', 'spicy tuna, avocado, seaweed salad', 139, false],
    ['Tofu poké', 'teriyaki tofu, pickled ginger, cucumber', 119, true],
    ['Chicken teriyaki bowl', 'glazed chicken, rice, crispy onions', 125, false],
    ['Green bowl', 'quinoa, avocado, kale, miso dressing', 115, true]] },
];

const dayNumber = (d) => Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5);

// Today's truck and menu: three dishes, the first is "Dagens" (today's special) at kr 15 off.
export function truckOfDay(d = new Date()) {
  const n = dayNumber(d); const L = TRUCKS.length;
  const truck = TRUCKS[((n % L) + L) % L]; const tomorrow = TRUCKS[(((n + 1) % L) + L) % L];
  const rnd = seeded(n * 2654435761); const pool = truck.dishes.slice();
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const menu = pool.slice(0, 3).map(([name, desc, price, veg], i) => ({ name, desc, price: i === 0 ? price - 15 : price, veg, special: i === 0 }));
  const date = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  return { truck, menu, date, tomorrow };
}

let today = null;
export function buildFoodTruck() {
  today = truckOfDay();
  const { truck } = today; const S = B.main; const { x: X, z: Z } = FOODTRUCK;
  const body = mat(truck.body, { roughness: 0.45, metalness: 0.2 });
  const x0 = X - 1.1, x1 = X + 1.1, zb0 = Z - 2.4, zb1 = Z + 3.2; // box body; the cab is at the north end (−z)
  S.box(body, X, 1.8, (zb0 + zb1) / 2, x1 - x0, 2.5, zb1 - zb0);
  S.box(mat('#f4f4f4', { roughness: 0.4 }), X, 3.1, (zb0 + zb1) / 2, x1 - x0 + 0.04, 0.1, zb1 - zb0 + 0.04); // roof trim
  S.box(body, X, 1.45, zb0 - 0.85, x1 - x0, 1.8, 1.7);                                                         // cab
  S.box(mat('#1d2a33', { roughness: 0.15, metalness: 0.5 }), X, 1.85, zb0 - 1.71, x1 - x0 - 0.3, 0.75, 0.04);   // windscreen
  for (const sx of [-1, 1]) S.box(mat('#1d2a33', { roughness: 0.15, metalness: 0.5 }), X + sx * 1.11, 1.9, zb0 - 0.75, 0.04, 0.6, 1.0); // side windows
  S.box(mat('#2b2f35'), X, 0.45, (zb0 - 1.7 + zb1) / 2, x1 - x0 - 0.1, 0.25, zb1 - zb0 + 1.7);              // chassis
  S.box(mat('#d9d9d9', { metalness: 0.6, roughness: 0.3 }), X, 0.5, zb0 - 1.75, x1 - x0, 0.22, 0.12);         // bumper
  for (const sx of [-1, 1]) for (const wz of [zb0 - 0.9, zb1 - 1.2]) {
    S.add(CYL, mat('#151515', { roughness: 0.9 }), M(X + sx * 1.0, 0.42, wz, 0, 0, Math.PI / 2, 0.42, 0.3, 0.42));
    S.add(CYL, mat('#bfc4c8', { metalness: 0.7, roughness: 0.3 }), M(X + sx * 1.16, 0.42, wz, 0, 0, Math.PI / 2, 0.2, 0.02, 0.2));
  }
  // serving hatch on the west side: dark interior, steel counter, striped awning
  const hz0 = Z - 1.6, hz1 = Z + 2.0, hzc = (hz0 + hz1) / 2;
  S.box(mat('#2a2622'), x0 - 0.01, 1.95, hzc, 0.02, 1.0, hz1 - hz0);
  S.box(mat('#c9ced2', { metalness: 0.7, roughness: 0.25 }), x0 - 0.22, 1.42, hzc, 0.45, 0.06, hz1 - hz0);
  const stripes = canvasTex(256, 64, (g, w, h) => { for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#ffffff' : truck.accent; g.fillRect(i * w / 8, 0, w / 8, h); } });
  const awn = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.04, hz1 - hz0 + 0.3), [mat('#ffffff'), mat('#ffffff'), new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.8 }), mat(truck.accent), mat('#ffffff'), mat('#ffffff')]);
  awn.position.set(x0 - 0.5, 2.62, hzc); awn.rotation.z = 0.28; awn.castShadow = true; G.scene.add(awn);
  // the name on both sides and on a roof sign, the menu on a chalkboard
  const name = (rot, xx) => { const p = textPlane([truck.name, truck.tag], 4.4, 0.9, { bg: truck.body, fg: '#ffffff', font: 'bold 110px Trebuchet MS, Arial', sub: 'italic 52px Trebuchet MS, Arial' }); p.position.set(xx, rot < 0 ? 0.98 : 1.8, Z + 0.4); p.rotation.y = rot; G.scene.add(p); };
  name(-Math.PI / 2, x0 - 0.015); name(Math.PI / 2, x1 + 0.015);
  const roof = textPlane([`${truck.icon} ${truck.name}`], 3.6, 0.7, { bg: truck.accent, fg: '#151515', font: 'bold 120px Trebuchet MS, Arial' });
  roof.position.set(X - 0.04, 3.55, Z + 0.4); roof.rotation.y = -Math.PI / 2; G.scene.add(roof);
  const roof2 = roof.clone(); roof2.position.x = X + 0.04; roof2.rotation.y = Math.PI / 2; G.scene.add(roof2);
  S.box(mat('#2b2f35'), X, 3.55, Z + 0.4, 0.06, 0.74, 3.64);
  for (const dz of [-1.2, 2.0]) S.box(mat('#2b2f35'), X, 3.2, Z + dz, 0.06, 0.2, 0.06);
  // A-frame chalkboard with today's menu, facing the plaza
  const bx = X - 3.4, bz = Z - 3.1;
  const board = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.55), new THREE.MeshBasicMaterial({ map: menuTex(today), toneMapped: false }));
  board.position.set(bx - 0.18, 0.95, bz); board.rotation.set(0, -Math.PI / 2, -0.2, 'YXZ'); G.scene.add(board);
  S.add(new THREE.BoxGeometry(0.06, 1.7, 1.35), mat('#6b4b32'), M(bx, 0.85, bz, 0, 0, -0.2));
  S.add(new THREE.BoxGeometry(0.06, 1.7, 1.35), mat('#6b4b32'), M(bx + 0.36, 0.85, bz, 0, 0, 0.2));
  addRect(bx - 0.4, bz - 0.7, bx + 0.6, bz + 0.7, 0, 1.7);
  // standing tables
  for (const [tx, tz] of [[X - 4.6, Z + 1.0], [X - 4.2, Z + 4.4]]) {
    S.add(CYL, mat('#f4f4f4'), M(tx, 1.08, tz, 0, 0, 0, 0.42, 0.05, 0.42)); S.add(CYL, mat('#2b2f35'), M(tx, 0.54, tz, 0, 0, 0, 0.05, 1.08, 0.05));
    S.add(CYL, mat('#2b2f35'), M(tx, 0.02, tz, 0, 0, 0, 0.3, 0.04, 0.3)); addCircle(tx, tz, 0.45, 0, 1.1);
  }
  addRect(x0 - 0.05, zb0 - 1.8, x1 + 0.05, zb1 + 0.05, 0, 3.3);
  G.interact.push({ x: x0 - 1.4, z: hzc, r: 2.1, label: () => `Order lunch at ${truck.name}`, act: openMenu });
}

function menuTex({ truck, menu, date }) {
  return canvasTex(480, 620, (g, w, h) => {
    g.fillStyle = '#23302a'; g.fillRect(0, 0, w, h); g.strokeStyle = '#8a6a48'; g.lineWidth = 18; g.strokeRect(0, 0, w, h);
    g.textAlign = 'center'; g.fillStyle = '#ffffff'; g.font = 'bold 40px Trebuchet MS, Arial'; g.fillText('TODAY’S LUNCH', w / 2, 62);
    g.fillStyle = truck.accent === '#ffffff' ? '#9fe3ff' : truck.accent; g.font = 'bold 34px Trebuchet MS, Arial'; g.fillText(truck.name, w / 2, 108, w - 40);
    g.fillStyle = '#cfd8d3'; g.font = 'italic 24px Trebuchet MS, Arial'; g.fillText(date, w / 2, 142);
    let y = 205; g.textAlign = 'left';
    for (const d of menu) {
      g.fillStyle = d.special ? '#ffd166' : '#ffffff'; g.font = 'bold 30px Trebuchet MS, Arial';
      g.fillText((d.special ? '★ ' : '') + d.name + (d.veg ? ' (V)' : ''), 32, y, w - 64);
      g.fillStyle = '#b9c4be'; g.font = '22px Trebuchet MS, Arial'; g.fillText(d.desc, 32, y + 34, w - 170);
      g.fillStyle = d.special ? '#ffd166' : '#ffffff'; g.font = 'bold 28px Trebuchet MS, Arial';
      g.textAlign = 'right'; g.fillText(`${d.price} kr`, w - 32, y + 36); g.textAlign = 'left';
      y += 118;
    }
    g.textAlign = 'center'; g.fillStyle = '#ffd166'; g.font = 'bold 24px Trebuchet MS, Arial'; g.fillText('★ = Dagens, kr 15 off', w / 2, h - 50);
  });
}

function openMenu() {
  let ov = document.getElementById('ftov');
  if (!ov) {
    ov = document.createElement('div'); ov.id = 'ftov'; ov.className = 'overlay';
    document.body.appendChild(ov);
    ov.addEventListener('click', (e) => {
      if (e.target === ov || e.target.classList.contains('close')) return ov.classList.remove('show');
      const b = e.target.closest('[data-dish]'); if (b) buy(today.menu[+b.dataset.dish], ov);
    });
  }
  const { truck, menu, date, tomorrow } = today;
  ov.innerHTML = `<div class="card" style="max-width:520px"><button class="close">✕ close (Esc)</button>
    <h2 style="color:${truck.accent === '#ffffff' ? '#9fe3ff' : truck.accent}">${truck.icon} ${truck.name}</h2>
    <h3>${truck.tag} · ${date}</h3>
    ${menu.map((d, i) => `<div style="display:flex;gap:14px;align-items:center;justify-content:space-between;padding:10px 0;border-top:1px solid #2a3646">
      <div><b style="${d.special ? 'color:#ffd166' : ''}">${d.special ? '★ Dagens: ' : ''}${d.name}</b>${d.veg ? ' <span style="color:#7dffb0">(V)</span>' : ''}<br><span class="dim" style="font-size:14px">${d.desc}</span></div>
      <button data-dish="${i}" style="flex:none;cursor:pointer;background:#2f6f4f;color:#fff;border:0;border-radius:8px;padding:8px 14px;font:bold 15px var(--font)">${fmt(d.price)}</button></div>`).join('')}
    <p class="dim" style="font-size:13px;margin:10px 0 0">A good lunch restores your health. A new truck parks here every day – tomorrow: <b>${tomorrow.icon} ${tomorrow.name}</b>.</p></div>`;
  document.querySelectorAll('.overlay').forEach((o) => o.classList.remove('show'));
  ov.classList.add('show'); document.exitPointerLock?.();
}

function buy(d, ov) {
  if (!canPay(d.price)) return G.ui.toast('Not enough kronor for lunch. Do some jobs!');
  charge(d.price); G.health = 100; G.stats.lunches = (G.stats.lunches || 0) + 1; sfx('pickup');
  ov.classList.remove('show');
  G.ui.toast(`${today.truck.icon} ${d.name} from ${today.truck.name} – delicious! Health restored. <b>−${fmt(d.price)}</b>`);
}
