import { mulberry32 } from "../src/core/rng.js";
import { createFight, stepFight } from "../src/sim/fight.js";
const orig = Math.random;
const seedRun = (seed, fn) => { Math.random = mulberry32(seed); try { return fn(); } finally { Math.random = orig; } };

function run(name, opts, inputFn, maxSec) {
  const r = seedRun(opts.seed, () => {
    const f = createFight({ fish: opts.fish, tackle: opts.tackle, rng: mulberry32(opts.seed) });
    const dt = 0.05;
    let steps = 0;
    let minDist = f.distM, maxT = 0;
    const start = f.distM;
    while (f.status === 'fighting' && steps * dt < maxSec) {
      stepFight(f, inputFn(steps * dt), dt);
      minDist = Math.min(minDist, f.distM); maxT = Math.max(maxT, f.tension);
      steps++;
    }
    return { status: f.status, secs: +(steps * dt).toFixed(2), start:+start.toFixed(2), end:+f.distM.toFixed(2), minDist:+minDist.toFixed(2), maxT:+maxT.toFixed(3), stam:+f.fishStamina.toFixed(3) };
  });
  console.log(name, JSON.stringify(r));
}

const weakFish = { id: 'okun', kg: 0.3, fightPower: 0.2, stamina: 0.2, aggro: 0.2 };
const strongFish = { id: 'som', kg: 8, fightPower: 0.9, stamina: 0.9, aggro: 0.8 };
const strongTackle = { maxLoadKg: 12, lineTestKg: 12, reelSpeed: 0.9, maxDragKg: 8, rodPower: 0.9, sensitivity: 0.9, hookStrength: 0.9 };
const midTackle = { maxLoadKg: 5, lineTestKg: 5, reelSpeed: 0.7, maxDragKg: 4, rodPower: 0.7, sensitivity: 0.7, hookStrength: 0.7 };
const weakLine = { maxLoadKg: 0.6, lineTestKg: 0.6, reelSpeed: 0.5, maxDragKg: 0.4, rodPower: 0.3, sensitivity: 0.3, hookStrength: 0.4 };

for (const seed of [1, 2, 3]) {
  run('reel1-weakfish', { seed, fish: weakFish, tackle: strongTackle }, () => ({ reel: 1 }), 1.2);
  run('reel1-strongfish-weakline', { seed, fish: strongFish, tackle: weakLine }, () => ({ reel: 1 }), 20);
  run('reel0', { seed, fish: weakFish, tackle: midTackle }, () => ({ reel: 0 }), 12);
  run('smart', { seed, fish: weakFish, tackle: midTackle }, (t) => ({ reel: t < 0.5 ? 0.55 : 0.8, rodUp: false }), 60);
  run('smart-strong', { seed, fish: strongFish, tackle: strongTackle }, (t) => ({ reel: 0.55 }), 120);
}
