/** Тесты вываживания: src/sim/fight.js. Все сценарии — с фиксированным seed. */
import { group, test, ok, eq, inRange } from '../lib/harness.mjs';
import { loadModule } from '../lib/loader.mjs';
import {
  FISH_STRONG,
  FISH_WEAK,
  TACKLE_HEAVY,
  TACKLE_MID,
  TACKLE_WEAK_LINE,
  fallbackRng,
} from '../lib/fixtures.mjs';

const FIGHT = 'src/sim/fight.js';
const DT = 1 / 60;

let createFight = null;
let stepFight = null;
let loadError = null;
let rngFactory = fallbackRng;

/** Крутит бой до терминального статуса или лимита времени. */
function runFight({ fish, tackle, seed, input, maxSec = 120, onStep }) {
  const fight = createFight({ fish, tackle, rng: rngFactory(seed) });
  const startDist = fight.distM;
  let steps = 0;
  while (fight.status === 'fighting' && steps * DT < maxSec) {
    stepFight(fight, input(fight, steps * DT), DT);
    if (onStep) onStep(fight, steps);
    steps += 1;
  }
  return { fight, seconds: steps * DT, startDist };
}

export async function register() {
  group('fight.js — вываживание');

  const entry = await loadModule(FIGHT, ['createFight', 'stepFight']);
  if (entry.mod) {
    createFight = entry.mod.createFight;
    stepFight = entry.mod.stepFight;
    const rngEntry = await loadModule('src/core/rng.js', ['mulberry32']);
    if (rngEntry.mod) rngFactory = rngEntry.mod.mulberry32;
  } else {
    loadError = entry.error;
    console.log(`  (модуль недоступен: ${loadError})`);
  }

  const needFight = () => {
    if (!createFight || !stepFight) throw new Error(loadError || 'fight.js не загрузился');
  };

  await test('createFight: стартовое состояние боя корректно', async () => {
    needFight();
    const fight = createFight({ fish: FISH_WEAK, tackle: TACKLE_HEAVY, rng: rngFactory(1) });
    eq(fight.status, 'fighting', 'status');
    inRange(fight.distM, 5, 60, 'distM');
    inRange(fight.tension, 0, 1.45, 'tension');
    eq(fight.fishStamina, 1, 'fishStamina');
    eq(fight.fish.id, FISH_WEAK.id, 'fish.id');
    inRange(fight.fish.kg, 0.02, 200, 'fish.kg');
    return `distM ${fight.distM.toFixed(1)} м, tension ${fight.tension}`;
  });

  await test('stepFight: при завершённом бое состояние не меняется', async () => {
    needFight();
    const fight = createFight({ fish: FISH_WEAK, tackle: TACKLE_HEAVY, rng: rngFactory(2) });
    fight.status = 'landed';
    const snapshot = JSON.stringify(fight);
    for (let i = 0; i < 20; i += 1) stepFight(fight, { reel: 1, rodUp: true, pump: true }, DT);
    eq(JSON.stringify(fight), snapshot, 'состояние после status="landed"');
    return 'шаги проигнорированы';
  });

  await test('stepFight: постоянная подмотка растит натяжение', async () => {
    needFight();
    const fight = createFight({ fish: FISH_STRONG, tackle: TACKLE_HEAVY, rng: rngFactory(3) });
    const start = fight.tension;
    let previous = fight.tension;
    let grew = 0;
    const steps = 10;
    for (let i = 0; i < steps && fight.status === 'fighting'; i += 1) {
      stepFight(fight, { reel: 1 }, DT);
      if (fight.tension > previous + 1e-9) grew += 1;
      previous = fight.tension;
    }
    ok(fight.tension > start, `натяжение не выросло: ${start.toFixed(3)} → ${fight.tension.toFixed(3)}`);
    ok(grew >= 8, `натяжение росло только на ${grew}/${steps} шагах`);
    return `${start.toFixed(2)} → ${fight.tension.toFixed(2)}`;
  });

  await test('stepFight: без подмотки натяжение падает и рыба сходит', async () => {
    needFight();
    const { fight } = runFight({
      fish: FISH_WEAK,
      tackle: TACKLE_MID,
      seed: 4,
      input: () => ({ reel: 0 }),
      maxSec: 30,
    });
    eq(fight.status, 'escaped', 'статус при reel=0');
    ok(fight.tension < 0.2, `натяжение осталось высоким: ${fight.tension.toFixed(3)}`);
    ok(fight.timeSec > 0, 'время боя не идёт');
    return `escaped за ${fight.timeSec.toFixed(1)} c, tension ${fight.tension.toFixed(2)}`;
  });

  await test('stepFight: перегруз на слабой леске → обрыв', async () => {
    needFight();
    const { fight } = runFight({
      fish: FISH_STRONG,
      tackle: TACKLE_WEAK_LINE,
      seed: 5,
      input: () => ({ reel: 1 }),
      maxSec: 30,
    });
    eq(fight.status, 'broken', 'статус при перегрузе');
    ok(fight.maxTension >= 1, `натяжение не дошло до обрыва: ${fight.maxTension.toFixed(3)}`);
    return `broken за ${fight.timeSec.toFixed(1)} c, maxTension ${fight.maxTension.toFixed(2)}`;
  });

  await test('stepFight: разумное вываживание → landed, дистанция падает', async () => {
    needFight();
    let previousDist = Infinity;
    let distDropped = 0;
    const result = runFight({
      fish: FISH_WEAK,
      tackle: TACKLE_MID,
      seed: 6,
      maxSec: 120,
      input: (fight) => ({ reel: fight.tension < 0.55 ? 0.55 : 0 }),
      onStep: (fight) => {
        if (fight.distM < previousDist - 1e-9) distDropped += 1;
        previousDist = fight.distM;
      },
    });
    eq(result.fight.status, 'landed', 'статус при аккуратном вываживании');
    ok(result.fight.distM <= 5.0001, `дистанция на посадке ${result.fight.distM}`);
    ok(
      result.fight.distM < result.startDist,
      `дистанция не уменьшилась: ${result.startDist.toFixed(1)} → ${result.fight.distM.toFixed(1)}`,
    );
    ok(distDropped > 0, 'дистанция ни разу не уменьшилась');
    return `landed за ${result.seconds.toFixed(1)} c, ${result.startDist.toFixed(1)} → ${result.fight.distM.toFixed(1)} м`;
  });

  await test('stepFight: выносливость рыбы монотонно падает под нагрузкой', async () => {
    needFight();
    const fight = createFight({ fish: FISH_STRONG, tackle: TACKLE_HEAVY, rng: rngFactory(8) });
    let previous = fight.fishStamina;
    let violations = 0;
    for (let i = 0; i < 300 && fight.status === 'fighting'; i += 1) {
      stepFight(fight, { reel: 0.6, rodUp: true }, DT);
      if (fight.fishStamina > previous + 1e-9) violations += 1;
      previous = fight.fishStamina;
    }
    eq(violations, 0, 'шагов с ростом выносливости');
    ok(fight.fishStamina < 0.95, `выносливость почти не упала: ${fight.fishStamina.toFixed(3)}`);
    inRange(fight.fishStamina, 0, 1, 'fishStamina');
    return `1 → ${fight.fishStamina.toFixed(2)} за ${fight.timeSec.toFixed(1)} c`;
  });
}
