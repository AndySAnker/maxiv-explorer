# Developing MAX IV Explorer

Plain JavaScript (ES modules) with [three.js](https://threejs.org) r160 vendored in `vendor/`. No npm packages, no
framework, no build step needed while developing. Python is only used to bundle and to precompute scattering data.

## Quick start

```bash
git clone https://github.com/AndySAnker/maxiv-explorer.git && cd maxiv-explorer
python3 -m http.server 8000      # or: npm run dev
```

Open **http://localhost:8000/dev.html**. It loads the modules in `js/` directly, so you just edit and reload.
(`index.html` loads the bundle `game.bundle.js` instead – that is what players get.)

Before committing, rebuild the bundle (needs Python 3 and Pillow: `pip install pillow`):

```bash
./build.sh                       # or: npm run build
```

To test multiplayer locally: `node server/server.mjs` (Node ≥ 18) and open `http://localhost:8080` in two windows.

## How the code is organised

| File | What it does |
|---|---|
| `js/main.js` | Entry point: renderer, camera, input, interaction prompt, main loop, interactables that need game logic |
| `js/state.js` | `G` – the shared mutable game state (scene, player, money, interactables, tickers, …) |
| `js/data.js` | Static world data: ring geometry, roads, buildings, all beamlines with descriptions, photo credits, phrases |
| `js/site.js` | Builds the site: terrain, roads, office, linac, tram, scenery, zones, photo boards, navigation graph |
| `js/world.js` | Storage rings, halls, tunnels, magnets and the beamlines (hutches, cabins, info boards, doors) |
| `js/build.js` | Geometry helpers: `B.main` static batcher, `M()` matrices, `wallLine`, revolved walls |
| `js/physics.js` | 2.5D collision world (`addBox`, `addRect`, `addCircle`, arcs) and terrain height |
| `js/actors.js` | Player, people (NPCs), scooters, the tram |
| `js/missions.js` | Mission engine, story missions, courier jobs, mission markers |
| `js/hud.js` | HUD, minimap, big map, overlays (`G.ui.toast`, `prompt`, `big`, `showPhoto`, `toggle`) |
| `js/economy.js` | Money: `earn`, `charge`, `PRICE` – real figures where they are published |
| `js/cosaxs.js` | The two working beamlines (CoSAXS + DanMAX): hutch hardware, sample tables, hutch search and its guide, control screen tabs 1–3, detector simulation |
| `js/cosaxs_analysis.js` | Analyse / PDF tabs |
| `js/scatterlab.js` | Autonomous synthesis: robot, simulated chemistry, Gaussian-process Bayesian optimisation, panels |
| `js/exhibit.js`, `js/pingpong.js`, `js/foodtruck.js` | Exhibition, table tennis, daily food truck |
| `js/net.js` | Multiplayer client (WebSocket relay in `server/server.mjs`, or the claude.ai artifact room) |
| `js/plot.js`, `js/util.js`, `js/audio.js` | Canvas plotter, small helpers (materials, textures, text), sound effects |
| `js/*_data.js`, `js/photodata.js` | **Generated** – precomputed scattering patterns and embedded photos (do not edit by hand) |
| `server/server.mjs` | Zero-dependency Node server: serves the game and the multiplayer relay |
| `tools/` | Bundler, photo embedding, artifact export, scattering-data generators |

## Main ideas

* **Units and axes:** metres, y up. The 3 GeV ring is centred at the origin; the office is east (+x), Fotongatan and
  the tram south (+z). Beamlines have a local frame `bl.P(s, l)`: `s` along the beam, `l` sideways.
* **Static geometry** goes into the batcher – `B.main.box(material, x, y, z, sx, sy, sz, rotY)` – and is merged into a
  few meshes at the end of loading. Things that move or change get their own `THREE.Mesh` added to `G.scene`.
* **Collisions** are separate from the visuals: add a collider with `addBox` / `addRect` / `addCircle`.
* **Interactions:** push an object onto `G.interact`; the closest one in range shows a prompt and runs on **E**:

  ```js
  G.interact.push({ x, z, r: 1.5, label: 'Read the sign', cond: () => G.badge, act: () => G.ui.toast('Hello!') });
  ```
* **Per-frame logic:** `G.tickers.push((dt) => { … })`.
* **Missions** are data – see the examples at the top of `js/missions.js`: `D.push({ id, title, reward, start, steps: [{ text, at, r, done }] })`.
* **Money:** `earn(amount, 'why')` and `charge(amount, 'why')` from `js/economy.js`.

## Recipes

* **New object or building:** add a function to `js/site.js` (or its own module, like `js/foodtruck.js`), call it from
  `buildSite()`, use `B.main.box(…)` for the visuals and `addRect(…)` for collisions.
* **New interaction:** `G.interact.push({...})` as above. For a bigger screen, open an overlay like
  `js/foodtruck.js` (`openMenu`) or `G.ui.showPhoto(null, { name, tech, desc })`.
* **New mission:** add a `D.push({...})` in `js/missions.js`; it gets a blue start marker on the map automatically.
* **New beamline description:** edit the beamline list in `js/data.js`.
* **New sample at CoSAXS / DanMAX:** add it to `SAMPLES` in `tools/cosaxs_debye.py` or `tools/danmax_debye.py`, then
  regenerate the data (below).

## Scattering data

The browser cannot run DebyeCalculator (Python/PyTorch), so patterns are precomputed into `js/*_data.js` by
`tools/cosaxs_debye.py`, `tools/danmax_debye.py`, `tools/analysis_debye.py` and `tools/scatterlab_debye.py`.
Regenerate everything with the latest DebyeCalculator (installed in a local `.venv-debye`) and rebuild:

```bash
./tools/regenerate_data.sh          # latest release · add --git for DebyeCalculator's main branch
```

## Build pipeline (`./build.sh`)

1. `tools/embed_photos.py` – resizes the photos in `assets/photos/` and embeds them in `js/photodata.js`, so the game
   also works from `file://`.
2. `tools/bundle.py` – a tiny bundler: `js/main.js` and everything it imports → `game.bundle.js`. It supports only
   `import { a, b as c } from '…'`, `import * as X from '…'`, `export function/class/const …` and `export { … }`
   (no `export let`, no dynamic `import()`).
3. `tools/make_artifact.py` – `artifact/beamtime.html`, the page shape used for the claude.ai version.

## Debugging

In the browser console: `__G` (game state), `__XP.cosaxs` / `__XP.danmax` (beamline states), `__SL` (autonomous
synthesis), `__pp` (table tennis). Loading times per stage are logged as `[build] stage ms`.

## Multiplayer protocol

The client sends `{"t":"p","p":{name,c,x,y,z,h,v,say}}` (only changed fields); the server answers with `welcome`,
`upd`, `leave` and `said`, sanitising every field. See the comments in `server/server.mjs` and `HOSTING.md`.

## Contributing

1. Fork, make a branch, change things in `js/` and test with `dev.html`.
2. Run `./build.sh` and check `index.html` (the bundled game) once.
3. Open a pull request describing what you changed.

Please keep the game dependency-free, keep it running from `file://`, and keep the science honest: say in the game
when something is simplified or simulated. Photos must have a free licence and be added to
`assets/photos/credits.json` and to the photo list in `js/data.js`.
