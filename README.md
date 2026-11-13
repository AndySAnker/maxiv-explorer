# MAX IV Explorer – an open-world game at the MAX IV synchrotron

Walk and ride a kick scooter around a playful 3D version of MAX IV in Lund: the 528 m, 3 GeV ring hall with all its
beamlines in their real order from the reception (CoSAXS, ForMAX, BALDER, …), the storage-ring tunnel, the 1.5 GeV ring,
the 300 m linac, the office, Fotongatan and the tram. Two beamlines can be visited and used: **CoSAXS** and **DanMAX**.

## Play
Double-click **`index.html`** (works straight from disk, no server needed).
WASD move · Shift sprint · mouse look · F scooter · E interact · M map · H help · T chat (online version).

## Visitable beamlines
In the hutch, take a calibrant (green table) or a sample (purple table; DanMAX also has an empty capillary for the background), then **search the hutch**:
button 1 at the far end → button 2 by the door → leave → LOCK outside within 30 s. In the control cabin
(live hutch camera on screen):

| Tab | CoSAXS (SAXS/WAXS, EIGER2 4M) | DanMAX (powder diffraction, PILATUS4 X CdTe 4M) |
|---|---|---|
| 1 Measure | distance, energy, exposure, attenuator, beamstop | same, up to 35 keV; beam at the centre or near the bottom edge (higher Q for PDF) |
| 2 Calibrate | fit AgBeH / LaB₆ rings, save the geometry | fit CeO₂ / LaB₆ rings, save the geometry |
| 3 Reduce | mask + geometry → azimuthal integration, background | same |
| 4 | Analyse: inspect, sphere fit, Debye structure ranking | **PDF**: your I(Q) → S(Q) → F(Q) → G(r) (composition, empty capillary, Compton/smooth-background removal, Q range, Lorch) |
| 5 | – | **Analyse** in Q-space (Bragg peak fits → lattice parameter, Scherrer size) and r-space (crystal-sphere fit → lattice parameter, particle size), PDFs to 200 Å |

## Around the site
* **Exhibition “From MAX I to MAX IV”** – on the left as you come in from the reception, next to CoSAXS: ring models
  with the real number of cells and bends, plus a “rings to scale” wall.
* **Table tennis** in the open hall space between the future beamline and DanMAX.
* **Money (kr)** – good data are worth an hour of beamtime (≈ kr 6 260, ALBA’s published rate), goals and analyses pay
  more; accidents cost what they would in reality (burnt detector module ≈ kr 350 000, estimate).
* **Multiplayer** (online version only): pick a name at the start, see and chat with other players.

## Rebuilding after code changes
Sources are in `js/`; `index.html` loads the single bundle `game.bundle.js`. After editing, run `./build.sh`
(Python 3 + Pillow). `dev.html` loads the ES modules directly (needs a local web server, e.g. `start.command`).

Scattering data are precomputed with DebyeCalculator ≥ 1.1 (grid pair sum, PR #44) and ASE:
`tools/cosaxs_debye.py`, `tools/analysis_debye.py` and `tools/danmax_debye.py`.

## Credits
* Photos: Wikimedia Commons under CC licences (CC BY 2.0/3.0, CC BY-SA 3.0/4.0, CC0) – authors and licence links in the
  in-game help (H), source list in `js/data.js` and `assets/photos/credits.json`. Photos are resized.
* 3D engine: [three.js](https://threejs.org) r160 (MIT), vendored in `vendor/`.
* Scattering patterns: [DebyeCalculator](https://github.com/FrederikLizakJohansen/DebyeCalculator) (Apache 2.0).
* X-ray form factors: Cromer–Mann coefficients, International Tables for Crystallography Vol. C.
* Detector specifications: DECTRIS data sheets; DanMAX detectors: MAX IV website.
* Literature example in the CoSAXS analysis tab: Bi-oxido cluster growth SAXS data, *Angew. Chem. Int. Ed.* 2021,
  e202103641, via the course app `saxs_analysis` – **measured elsewhere, not at CoSAXS** (see `assets/example_data/README.md`).
* Fan-made game, not affiliated with MAX IV Laboratory or Lund University.
