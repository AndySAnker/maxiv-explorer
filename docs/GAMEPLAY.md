# MAX IV Explorer – player guide

[← back to the README](../README.md) · Play: **https://andysanker.github.io/maxiv-explorer/**

## Controls

| Key | Action |
|---|---|
| W A S D · Shift · Space | move · sprint · jump |
| Mouse (click the game first) · wheel · C | look around · camera distance · camera mode |
| E (hold where asked) | interact: doors, tables, buttons, beamlines, food truck, photo boards |
| F | get on / off a kick scooter (there are scooter racks all over the site) |
| M · H / Esc · T | map · help and credits · chat (multiplayer only) |

## Getting started

You arrive by tram. Walk through the main entrance to the **reception** to get your badge – without it the hall
doors stay locked. Blue markers on the map (**M**) are missions; yellow markers show where to go next.

**Missions:** Welcome to MAX IV, Fika Run, Sample Express, Magnet Trouble, Ring Rally, Femtosecond Sprint,
The Small Ring and CoSAXS Beamtime. The **job board** in the office hands out courier jobs to the beamlines.

## Doing an experiment (CoSAXS and DanMAX)

1. **Mount** a calibrant (green table) or a sample (purple table) in the experimental hutch. DanMAX also has an
   empty capillary for the background.
2. **Search the hutch** – yellow arrows guide you: button 1 at the far end → button 2 by the door → leave → **LOCK**
   outside, all within 30 s. Nobody may stay inside.
3. Go to the **control cabin** and press **E** at the computer. A live hutch camera shows what happens.

| Tab | CoSAXS (SAXS/WAXS, EIGER2 4M) | DanMAX (powder diffraction, PILATUS4 X CdTe 4M) |
|---|---|---|
| 1 Measure | distance, energy, exposure, attenuator, beamstop | same, up to 35 keV; beam at the centre or near the bottom edge (higher Q for PDF) |
| 2 Calibrate | fit AgBeH / LaB₆ rings, save the geometry | fit CeO₂ / LaB₆ rings, save the geometry |
| 3 Reduce | mask + geometry → azimuthal integration, background subtraction | same |
| 4 | Analyse: inspect, sphere fit, Debye structure ranking | PDF: I(Q) → S(Q) → F(Q) → G(r) |
| 5 | – | Analyse in Q-space (peak fits → lattice parameter, Scherrer size) and r-space |
| 🤖 | Autonomous synthesis | Autonomous synthesis |

Good data are paid like an hour of beamtime (≈ kr 6 260, ALBA's published rate); goals pay extra. Accidents cost
what they would in reality – a detector module burnt by the direct beam ≈ kr 350 000 (estimate).

## 🤖 Autonomous synthesis

A synthesis robot stands next to the sample stage in both hutches (press **E** at it for an explanation). In the
**Autonomous synthesis** tab you choose a target gold-particle size and which of the 11 synthesis parameters the
optimiser controls (volumes of H₂O, glycerol, ethanol, HAuCl₄, NaOH and citrate, Au addition speed, mixing, white /
UV-B / UV-C LEDs). Each experiment: the robot doses, mixes and illuminates → the sample flows into the flow cell in
the beam → blank and sample are measured for 1 min each → the loss against the target pattern is computed →
Bayesian optimisation proposes the next recipe. It starts with 2d + 2 random recipes and stops after 6 proposals
without improvement. Six panels show the synthesis, the instrument, data vs target, the loss so far, which
parameters matter, and a database of everything stored. Click a panel to enlarge it; ×1–×8 sets the speed.

The idea and method come from A. S. Anker *et al.*, *ACS Nano* 2026, 20, 6767–6782,
[doi:10.1021/acsnano.5c15488](https://doi.org/10.1021/acsnano.5c15488), where a modular robot made gold
nanoparticles, DanMAX measured total scattering and SAASBO chose the experiments. Simplified in the game: the
chemistry is a made-up model with the trend reported in the paper (bigger particles with more NaOH, less citrate and
less glycerol), the particles are fcc gold spheres, and the optimiser is a lighter GP with a trust region. The
scattering patterns are calculated with DebyeCalculator. The CoSAXS version (SAXS target) is an adaptation – the
paper measured at DanMAX.

## Around the site

* **All 3 GeV beamlines** in their real order, each with a board explaining what it does; photo boards show the real
  MAX IV (press **E**).
* **Exhibition “From MAX I to MAX IV”** – left of CoSAXS as you come in from the reception: ring models with the real
  number of cells and bends, and a “rings to scale” wall.
* **Table tennis** between the future beamline and DanMAX.
* **Food truck** at the east end of the plaza: a different truck and menu every day; lunch restores your health.
* **Golden photons** – 20 to collect around the site.
* **Café** in the office: a coffee restores your health.

## Multiplayer

On a multiplayer server (see the README) everyone in the same room sees each other's avatar and name, and can chat
with **T**. Add `?room=yourclass` to the address for a private room. The GitHub Pages version is single-player.
