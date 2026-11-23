# MAX IV Explorer – an open-world game at the MAX IV synchrotron

Walk and ride a kick scooter around a playful 3D version of MAX IV in Lund: the 528 m, 3 GeV ring hall with all its
beamlines in their real order from the reception (CoSAXS, ForMAX, BALDER, …), the storage-ring tunnel, the 1.5 GeV ring,
the 300 m linac, the office, Fotongatan and the tram. Two beamlines can be visited and used: **CoSAXS** and **DanMAX**.

## Play
Double-click **`index.html`** (works straight from disk, single-player), or run `node server/server.mjs` and open
`http://localhost:8080` to play together.
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

### 🤖 Autonomous synthesis (both beamlines)
A synthesis robot stands next to the sample stage in each hutch; run it from the **Autonomous synthesis** tab in the
control cabin. Pick a target gold-nanoparticle size and which of the 11 synthesis parameters the optimiser controls
(volumes of H₂O, glycerol, ethanol, HAuCl₄, NaOH and citrate, Au addition speed, mixing speed, white/UV-B/UV-C LEDs).
The robot makes a sample, the beamline measures it for 1 min (simulated), the loss against the target pattern is
computed, and Bayesian optimisation (Gaussian process + expected improvement in a trust region) proposes the next recipe: 2d + 2
quasi-random experiments first, then it keeps optimising until 6 proposals in a row bring no improvement (checked once it
has made at least 2d + 2 proposals; in the paper the campaign stopped at #47).

**The idea and the method are from our paper:** A. S. Anker, J. H. Jensen, M. González-Duque, R. Moreno, A. Smolska,
M. Juelsholt, V. Hardion, M. R. V. Jørgensen, A. Faíña, J. Quinson, K. Støy, T. Vegge, “Autonomous Synthesis of
Nanoparticles with Target Scattering Patterns” (ScatterLab), *ACS Nano* 2026, 20, 6767–6782,
[doi:10.1021/acsnano.5c15488](https://doi.org/10.1021/acsnano.5c15488). There, a modular robot (MODEX) made Au
nanoparticles, DanMAX measured total scattering, the target was F(Q) + G(r) and SAASBO chose the experiments.
The scattering patterns of the particles and of the precursor are calculated with DebyeCalculator (see Credits),
with the paper's settings (Q = 0.5–15 Å⁻¹, B = 0.3 Å²). *Simplified in the game:* the chemistry is a made-up model with plausible trends (bigger particles with less citrate,
less glycerol and more NaOH, as reported in the paper), particles are fcc Au spheres, and the GP averages a few
best-fit hyperparameter sets with a sparsity prior instead of fully Bayesian SAASBO. Each next recipe is searched in a
trust region around the best one so far (TuRBO-style; Eriksson et al., NeurIPS 2019), which beats plain global search
with this few experiments. The CoSAXS version (SAXS target) is our
adaptation – the paper measured at DanMAX.

## Around the site
* **Exhibition “From MAX I to MAX IV”** – on the left as you come in from the reception, next to CoSAXS: ring models
  with the real number of cells and bends, plus a “rings to scale” wall.
* **Table tennis** in the open hall space between the future beamline and DanMAX.
* **Food truck** at the east end of the plaza in front of the main entrance (orange square on the minimap): a
  different truck every day with a three-dish menu on the chalkboard (★ Dagens is kr 15 off). Lunch restores your health.
* **Money (kr)** – good data are worth an hour of beamtime (≈ kr 6 260, ALBA’s published rate), goals and analyses pay
  more; accidents cost what they would in reality (burnt detector module ≈ kr 350 000, estimate).
* **Multiplayer**: pick a name at the start, see and chat with other players (T). Works in the shared claude.ai
  version and on your own server – `node server/server.mjs`, then open `http://localhost:8080/?room=yourclass`.
  See **[HOSTING.md](HOSTING.md)** for Render, Docker and GitHub Pages.

## Rebuilding after code changes
Sources are in `js/`; `index.html` loads the single bundle `game.bundle.js`. After editing, run `./build.sh`
(Python 3 + Pillow). `dev.html` loads the ES modules directly (needs a local web server, e.g. `start.command`).

Scattering data are precomputed with DebyeCalculator ≥ 1.1 (grid pair sum, PR #44) and ASE:
`tools/cosaxs_debye.py`, `tools/analysis_debye.py`, `tools/danmax_debye.py` and `tools/scatterlab_debye.py` (gold spheres
1.5–10.5 nm + AuCl₄⁻ for the Autonomous-synthesis tab). The browser cannot run DebyeCalculator, so improvements to it
reach the game only when the data are regenerated: `./tools/regenerate_data.sh` installs the latest DebyeCalculator
in a local virtual environment, reruns all four scripts and rebuilds (`--git` uses the newest code on GitHub `main`).

## Credits
* Photos: Wikimedia Commons under CC licences (CC BY 2.0/3.0, CC BY-SA 3.0/4.0, CC0) – authors and licence links in the
  in-game help (H), source list in `js/data.js` and `assets/photos/credits.json`. Photos are resized.
* 3D engine: [three.js](https://threejs.org) r160 (MIT), vendored in `vendor/`.
* Scattering patterns: [DebyeCalculator](https://github.com/FrederikLizakJohansen/DebyeCalculator) (Apache 2.0). Please cite:
  F. L. Johansen, A. S. Anker, U. Friis-Jensen, E. B. Dam, K. M. Ø. Jensen, R. Selvan, “A GPU-Accelerated Open-Source
  Python Package for Calculating Powder Diffraction, Small-Angle-, and Total Scattering with the Debye Scattering
  Equation”, *J. Open Source Softw.* 2024, 9(94), 6024, [doi:10.21105/joss.06024](https://doi.org/10.21105/joss.06024).
* Autonomous synthesis: A. S. Anker *et al.*, “Autonomous Synthesis of Nanoparticles with Target Scattering Patterns”,
  *ACS Nano* 2026, 20, 6767–6782, [doi:10.1021/acsnano.5c15488](https://doi.org/10.1021/acsnano.5c15488).
* X-ray form factors: Cromer–Mann coefficients, International Tables for Crystallography Vol. C.
* Detector specifications: DECTRIS data sheets; DanMAX detectors: MAX IV website.
* Literature example in the CoSAXS analysis tab: Bi-oxido cluster growth SAXS data, *Angew. Chem. Int. Ed.* 2021,
  e202103641, via the course app `saxs_analysis` – **measured elsewhere, not at CoSAXS** (see `assets/example_data/README.md`).
* Fan-made game, not affiliated with MAX IV Laboratory or Lund University.
