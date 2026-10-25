import { mulberry32 } from "../src/core/rng.js";
import { createFight, stepFight } from "../src/sim/fight.js";
const orig = Math.random;
function seedRun(seed, fn) { Math.random = mulberry32(seed); try { return fn(); } finally { Math.random = orig; } }
function run(name, { seed, fish, tackle, ctrl, maxSec = 90 }) {
  const r = seedRun(seed, () => {
    const f = createFight({ fish, tackle, rng: mulberry32(seed) });
    const dt = 1/60; let steps = 0; const start = f.distM; let minD = start;
    while (f.status === 'fighting' && steps * dt < maxSec) {
      const input = ctrl(f, steps * dt);
      stepFight(f, input, dt); minD = Math.min(minD, f.distM); steps++;
    }
    return { status: f.status, secs: +(steps*dt).toFixed(2), start:+start.toFixed(2), end:+f.distM.toFixed(2), minD:+minD.toFixed(2), stam:+f.fishStamina.toFixed(3), tension:+f.tension.toFixed(3) };
  });
  console.log(name, JSON.stringify(r));
}
const weak = { id: 'okun', kg: 0.3, fightPower: 0.2, stamina: 0.2, aggro: 0.2 };
const strong = { id: 'som', kg: 8, fightPower: 0.9, stamina: 0.9, aggro: 0.8 };
const heavy = { maxLoadKg: 12, lineTestKg: 12, reelSpeed: 0.9, maxDragKg: 8, rodPower: 0.9, sensitivity: 0.9, hookStrength: 0.9 };
const mid = { maxLoadKg: 5, lineTestKg: 5, reelSpeed: 0.7, maxDragKg: 4, rodPower: 0.7, sensitivity: 0.7, hookStrength: 0.7 };
const ctrl1 = (f) => ({ reel: f.tension < 0.5 ? 0.7 : 0.05 });
const ctrl2 = (f) => ({ reel: f.tension < 0.55 ? 0.55 : 0 });
const ctrl3 = (f) => ({ reel: f.tension < 0.6 ? 0.45 : 0 });
for (const seed of [1,2,3,7]) {
  run('weakfish-heavy/ctrl1', { seed, fish: weak, tackle: heavy, ctrl: ctrl1 });
  run('weakfish-mid/ctrl3', { seed, fish: weak, tackle: mid, ctrl: ctrl3 });
  run('strongfish-heavy/ctrl1', { seed, fish: strong, tackle: heavy, ctrl: ctrl1 });
}
