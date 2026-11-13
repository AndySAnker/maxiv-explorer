// Money in MAX IV Explorer, in Swedish kronor (kr).
// Costs are tied to real figures where they are published; vendors do not publish detector prices, so those are
// labelled estimates. Rewards are sized so that a careful player can pay for an accident by doing good science.
import { G } from './state.js';

export const SEK_PER_EUR = 11.5;
// ALBA (Spain) charges 544.44 € per hour of beamtime (cells.es/en/industry/services/rates) – used as the value of
// one hour at a beamline, since MAX IV does not publish a rate.
export const BEAMTIME_HOUR = Math.round(544.44 * SEK_PER_EUR); // ≈ kr 6 260

export const PRICE = {
  coffee: 35,            // a coffee at the café
  medical: 400,          // Region Skåne fee for an emergency-department visit (1177.se, 2025)
  escort: 1500,          // redo the radiation-safety training (estimate)
  dosimeter: 2500,       // replacement dosimeter + incident report (estimate)
  beamDump: 16 * BEAMTIME_HOUR, // forcing an interlock dumps the beam: ~1 h lost on 16 beamlines
  detector: 350000,      // swap of one beam-burnt hybrid-pixel detector module by the vendor (estimate, ~€30k)
};

export const fmt = (n) => 'kr ' + (n < 0 ? '−' : '') + Math.abs(Math.round(n)).toLocaleString('sv-SE');

export function earn(n, why) {
  G.money += n; G.stats.earned = (G.stats.earned || 0) + n;
  if (why) G.ui.toast(`${why} <b>+${fmt(n)}</b>`, 4);
}
// bills can push you into debt (shown in red); pay them off by measuring and doing jobs
export function charge(n, why) {
  G.money -= n;
  if (why) G.ui.toast(`<span class="bad">${why} −${fmt(n)}</span>`, 5);
}
export function canPay(n) { return G.money >= n; }
