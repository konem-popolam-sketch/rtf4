import { mulberry32 } from "../src/core/rng.js";
import { evaluateBite } from "../src/sim/bite.js";
import { BAITS } from "../src/data/baits.js";
const mk = (id, bait, extra = {}) => ({ id, name: id, rarity: 1, minKg: 0.1, maxKg: 1, depth: 'mid', seasons: ['spring','summer','autumn','winter'], timeOfDay: { dawn: 1, day: 0.7, dusk: 1, night: 0.3 }, weatherPenalty: { rain: 0.9, wind: 0.8, clear: 1 }, bait, lure: [], fightPower: 0.4, stamina: 0.4, aggro: 0.4, ...extra });
const base = { tackle: { sensitivity: 0.7 }, spot: { structure: 'grass' }, weather: { precip: 'none', windMs: 2 }, timeOfDay: 'dawn', season: 'autumn', skillLuring: 3 };
const good = mk('okun', ['cherv','oparysh']);
const bad = mk('som', ['zhivets','boyl']);
const cherv = BAITS.find((b) => b.id === 'cherv');
function rate(table, bait, n = 300) {
  let bites = 0, chosen = {}, delayMin = Infinity, delayMax = -Infinity;
  for (let s = 1; s <= n; s++) {
    const r = evaluateBite({ ...base, fishTable: table, bait, rng: mulberry32(s) });
    if (r.willBite) { bites++; chosen[r.chosenFishId] = (chosen[r.chosenFishId]||0)+1; }
    delayMin = Math.min(delayMin, r.delaySec); delayMax = Math.max(delayMax, r.delaySec);
  }
  return { bites: +(bites/n).toFixed(3), chosen, delayMin: +delayMin.toFixed(2), delayMax: +delayMax.toFixed(2) };
}
console.log('single-good/matching', JSON.stringify(rate([good], cherv)));
console.log('single-good/mismatch', JSON.stringify(rate([good], { ...cherv, id: 'kukuruza' })));
console.log('two/matching', JSON.stringify(rate([good, bad], cherv)));
console.log('empty', JSON.stringify(rate([], cherv)));
console.log('matching-noattraction', JSON.stringify(rate([good], { ...cherv, attraction: { small: 0.01, medium: 0.01, big: 0.01 } })));
