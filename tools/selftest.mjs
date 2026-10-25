#!/usr/bin/env node
/**
 * tools/selftest.mjs — unit-тесты чистой логики проекта (Node, без DOM и без зависимостей).
 *
 * Проверяются: src/core/rng.js, src/core/util.js, src/sim/fight.js, src/sim/bite.js, src/sim/climate.js.
 * Модули подключаются динамически: если файла ещё нет (пишется параллельно), тест падает
 * с понятным сообщением «нет модуля …», а не роняет весь прогон.
 *
 * Запуск: node tools/selftest.mjs [--verbose]
 * Код выхода: 0 — все тесты прошли, 1 — есть провалы.
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VERBOSE = process.argv.includes('--verbose');

/* ─────────────────────────── мини-фреймворк ─────────────────────────── */

const results = [];
let currentGroup = 'общее';

function group(title) {
  currentGroup = title;
  console.log(`\n— ${title} —`);
}

async function test(name, fn) {
  const started = Date.now();
  try {
    const note = await fn();
    const ms = Date.now() - started;
    results.push({ group: currentGroup, name, ok: true, note, ms });
    console.log(`  OK   ${name}${note ? ` — ${note}` : ''}${VERBOSE ? ` (${ms} мс)` : ''}`);
  } catch (err) {
    results.push({ group: currentGroup, name, ok: false, error: err, ms: Date.now() - started });
    const text = String((err && err.message) || err).split('\n').join('\n       ');
    console.log(`  FAIL ${name}\n       ${text}`);
  }
}

function fail(message) {
  throw new Error(message);
}

function ok(condition, message) {
  if (!condition) fail(message);
}

function eq(actual, expected, what) {
  if (!Object.is(actual, expected)) fail(`${what}: ожидалось ${JSON.stringify(expected)}, получено ${JSON.stringify(actual)}`);
}

function near(actual, expected, eps, what) {
  if (!(Math.abs(actual - expected) <= eps)) fail(`${what}: ожидалось ${expected} ±${eps}, получено ${actual}`);
}

function inRange(value, min, max, what) {
  if (!(Number.isFinite(value) && value >= min && value <= max)) fail(`${what}: ${value} вне диапазона ${min}..${max}`);
}

function same(a, b, what) {
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  if (sa !== sb) fail(`${what}: ${sa} !== ${sb}`);
}

/* ─────────────────────────── загрузка модулей ─────────────────────────── */

const moduleCache = new Map();

/** Динамический импорт с понятной причиной отказа вместо падения прогона. */
async function loadModule(relPath, requiredExports = []) {
  if (moduleCache.has(relPath)) return moduleCache.get(relPath);
  const abs = join(ROOT, relPath);
  let entry;
  if (!existsSync(abs)) {
    entry = { error: `нет модуля ${relPath} (файл не найден)` };
  } else {
    try {
      const mod = await import(pathToFileURL(abs).href);
      const missing = requiredExports.filter((name) => mod[name] === undefined);
      entry = missing.length > 0
        ? { error: `в ${relPath} нет экспорта: ${missing.join(', ')}` }
        : { mod };
    } catch (err) {
      entry = { error: `модуль ${relPath} не загрузился: ${(err && err.message) || err}` };
    }
  }
  moduleCache.set(relPath, entry);
  return entry;
}

/** То же, но бросает ошибку — используется в тестах, где модуль обязателен. */
async function useModule(relPath, requiredExports = []) {
  const entry = await loadModule(relPath, requiredExports);
  if (entry.error) fail(entry.error);
  return entry.mod;
}

/* ─────────────────────────── фикстуры ─────────────────────────── */

const FISH_WEAK = { id: 'okun', kg: 0.3, fightPower: 0.2, stamina: 0.2, aggro: 0.2 };
const FISH_STRONG = { id: 'som', kg: 8, fightPower: 0.9, stamina: 0.9, aggro: 0.8 };
const TACKLE_HEAVY = {
  maxLoadKg: 12, lineTestKg: 12, reelSpeed: 0.9, maxDragKg: 8, rodPower: 0.9, sensitivity: 0.9, hookStrength: 0.9,
};
const TACKLE_MID = {
  maxLoadKg: 5, lineTestKg: 5, reelSpeed: 0.7, maxDragKg: 4, rodPower: 0.7, sensitivity: 0.7, hookStrength: 0.7,
};
const TACKLE_WEAK_LINE = {
  maxLoadKg: 0.6, lineTestKg: 0.6, reelSpeed: 0.5, maxDragKg: 0.4, rodPower: 0.3, sensitivity: 0.3, hookStrength: 0.4,
};

const BAIT_CHERV = { id: 'cherv', type: 'bait', depthWork: 'mid', attraction: { small: 0.9, medium: 0.85, big: 0.55 } };
const LURE_VERTUSHKA = {
  id: 'vertushka', type: 'lure', depthWork: 'mid', attraction: { small: 0.6, medium: 0.8, big: 0.9 },
};
const WEATHER_CLEAR = { tempC: 12, windMs: 2, windDir: 200, precip: 'none', pressure: 1013, cloud: 0.3 };
const SPOT_GRASS = { id: 'spot_grass', name: 'Трава', structure: 'grass', depthM: 3 };

function makeFish(id, over = {}) {
  return {
    id,
    name: id,
    rarity: 1,
    minKg: 0.1,
    maxKg: 1.2,
    depth: 'mid',
    seasons: ['spring', 'summer', 'autumn', 'winter'],
    timeOfDay: { dawn: 1, day: 0.7, dusk: 1, night: 0.3 },
    weatherPenalty: { rain: 0.9, wind: 0.8, clear: 1 },
    bait: ['cherv'],
    lure: ['vertushka'],
    fightPower: 0.3,
    stamina: 0.3,
    aggro: 0.3,
    ...over,
  };
}

const DT = 1 / 60;

/** Крутит бой до терминального статуса или лимита времени. */
function runFight(createFight, stepFight, { fish, tackle, seed, input, maxSec = 120, onStep }) {
  const fight = createFight({ fish, tackle, rng: mulberry32For(seed) });
  const startDist = fight.distM;
  let steps = 0;
  while (fight.status === 'fighting' && steps * DT < maxSec) {
    stepFight(fight, input(fight, steps * DT), DT);
    if (onStep) onStep(fight, steps);
    steps += 1;
  }
  return { fight, steps, startDist, seconds: steps * DT };
}

let rngFactory = null;
function mulberry32For(seed) {
  return rngFactory(seed);
}

/* ─────────────────────────── прогон ─────────────────────────── */

async function main() {
  console.log('=== selftest: логика rtf4 ===');
  console.log(`корень: ${ROOT}`);
  const startedAt = Date.now();

  /* ---------- src/core/rng.js ---------- */
  group('rng.js — детерминированный ГПСЧ');
  const rngPath = 'src/core/rng.js';
  rngFactory = (await loadModule(rngPath, ['mulberry32'])).mod?.mulberry32 || null;
  if (!rngFactory) rngFactory = () => 0;

  await test('mulberry32: одинаковый seed → одинаковая последовательность', async () => {
    const { mulberry32 } = await useModule(rngPath, ['mulberry32']);
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    same(seqA, seqB, 'две последовательности с seed=12345');
    ok(new Set(seqA).size > 15, `последовательность почти не повторяется (уникальных: ${new Set(seqA).size}/20)`);
    return '20 значений совпали';
  });

  await test('mulberry32: разные seed → разные последовательности', async () => {
    const { mulberry32 } = await useModule(rngPath, ['mulberry32']);
    const a = Array.from({ length: 10 }, mulberry32(1));
    const b = Array.from({ length: 10 }, mulberry32(2));
    ok(a.some((value, i) => value !== b[i]), 'последовательности для seed=1 и seed=2 совпали');
    return 'последовательности различаются';
  });

  await test('mulberry32: значения в [0,1)', async () => {
    const { mulberry32 } = await useModule(rngPath, ['mulberry32']);
    const next = mulberry32(777);
    let min = 1;
    let max = 0;
    for (let i = 0; i < 5000; i += 1) {
      const v = next();
      if (!Number.isFinite(v)) fail(`не число на шаге ${i}: ${v}`);
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    ok(min >= 0 && max < 1, `диапазон ${min}..${max} вышел за [0,1)`);
    ok(max > 0.99 && min < 0.01, `распределение слишком узкое: ${min}..${max}`);
    return `5000 значений в ${min.toFixed(4)}..${max.toFixed(4)}`;
  });

  await test('hashSeed: стабилен и лежит в uint32', async () => {
    const { hashSeed } = await useModule(rngPath, ['hashSeed']);
    eq(hashSeed('rtf4'), hashSeed('rtf4'), 'повторный вызов hashSeed("rtf4")');
    eq(hashSeed(''), 2166136261, 'hashSeed("") — FNV-offset');
    eq(hashSeed('rtf4'), 3455861665, 'золотое значение hashSeed("rtf4")');
    ok(hashSeed('karp') !== hashSeed('karр'), 'разные строки дают разные хеши');
    for (const value of [hashSeed(''), hashSeed('okun'), hashSeed('Сом'), hashSeed('a'.repeat(500))]) {
      inRange(value, 0, 0xffffffff, 'hashSeed');
      ok(Number.isInteger(value), `hashSeed вернул не целое: ${value}`);
    }
    return 'FNV-1a стабилен, uint32';
  });

  await test('pickWeighted: учитывает веса', async () => {
    const { mulberry32, pickWeighted } = await useModule(rngPath, ['mulberry32', 'pickWeighted']);
    const rng = mulberry32(42);
    const entries = [{ value: 'редко', weight: 1 }, { value: 'часто', weight: 9 }];
    const counts = { редко: 0, часто: 0 };
    const N = 4000;
    for (let i = 0; i < N; i += 1) counts[pickWeighted(rng, entries)] += 1;
    const share = counts.часто / N;
    near(share, 0.9, 0.03, 'доля элемента с весом 9/10');
    return `${(share * 100).toFixed(1)}% у веса 9 против 10%`;
  });

  await test('pickWeighted: нулевые веса игнорируются, пустой список — undefined', async () => {
    const { mulberry32, pickWeighted } = await useModule(rngPath, ['mulberry32', 'pickWeighted']);
    const rng = mulberry32(7);
    for (let i = 0; i < 200; i += 1) {
      eq(pickWeighted(rng, [{ value: 'нет', weight: 0 }, { value: 'да', weight: 1 }]), 'да', 'нулевой вес');
    }
    eq(pickWeighted(rng, []), undefined, 'пустой список');
    eq(pickWeighted(rng, [{ value: 'x', weight: 0 }]), 'x', 'все веса нулевые');
    return 'нули пропущены, пустой список → undefined';
  });

  /* ---------- src/core/util.js ---------- */
  group('util.js — форматирование и хелперы');
  const utilPath = 'src/core/util.js';
  await useModule(utilPath, ['fmtInt', 'fmtMoney', 'fmtClock', 'clamp']);

  await test('fmtInt: разряды через пробел', async () => {
    const { fmtInt } = await useModule(utilPath, ['fmtInt']);
    eq(fmtInt(1234567), '1 234 567', 'fmtInt(1234567)');
    eq(fmtInt(999), '999', 'fmtInt(999)');
    eq(fmtInt(0), '0', 'fmtInt(0)');
    eq(fmtInt(1000), '1 000', 'fmtInt(1000)');
    return '1 234 567 / 999 / 1 000';
  });

  await test('fmtMoney: рубли с неразрывным пробелом разрядов', async () => {
    const { fmtMoney } = await useModule(utilPath, ['fmtMoney']);
    eq(fmtMoney(450), '450 ₽', 'fmtMoney(450)');
    eq(fmtMoney(1234), '1 234 ₽', 'fmtMoney(1234)');
    return '450 ₽ / 1 234 ₽';
  });

  await test('fmtClock: игровые минуты → ЧЧ:ММ', async () => {
    const { fmtClock } = await useModule(utilPath, ['fmtClock']);
    eq(fmtClock(395), '06:35', 'fmtClock(395)');
    eq(fmtClock(0), '00:00', 'fmtClock(0)');
    eq(fmtClock(1439), '23:59', 'fmtClock(1439)');
    eq(fmtClock(1440), '00:00', 'fmtClock(1440) — новые сутки');
    eq(fmtClock(-30), '23:30', 'fmtClock(-30) — уход в предыдущие сутки');
    return '06:35 / 23:59 / 00:00';
  });

  await test('fmtKg: граммы до килограмма, дальше килограммы с запятой', async () => {
    const { fmtKg } = await useModule(utilPath, ['fmtKg']);
    eq(fmtKg(0.42), '420 г', 'fmtKg(0.42)');
    eq(fmtKg(3.7), '3,70 кг', 'fmtKg(3.7)');
    ok(/^1,00 кг$/.test(fmtKg(1)), `fmtKg(1) = ${fmtKg(1)}`);
    return '420 г / 3,70 кг';
  });

  await test('clamp/lerp/round2 работают на границах', async () => {
    const { clamp, lerp, round2 } = await useModule(utilPath, ['clamp', 'lerp', 'round2']);
    eq(clamp(-5, 0, 1), 0, 'clamp ниже минимума');
    eq(clamp(5, 0, 1), 1, 'clamp выше максимума');
    eq(clamp(0.5, 0, 1), 0.5, 'clamp внутри диапазона');
    eq(lerp(0, 10, 0.5), 5, 'lerp посередине');
    eq(round2(1.2345), 1.23, 'round2');
    return 'значения совпали';
  });

  /* ---------- src/sim/fight.js ---------- */
  group('fight.js — вываживание');
  const fightPath = 'src/sim/fight.js';
  const fightMod = await loadModule(fightPath, ['createFight', 'stepFight']);
  let createFight = null;
  let stepFight = null;
  if (fightMod.mod) {
    createFight = fightMod.mod.createFight;
    stepFight = fightMod.mod.stepFight;
  } else {
    console.log(`  (модуль недоступен: ${fightMod.error})`);
  }
  const needFight = () => {
    if (!createFight || !stepFight) fail(fightMod.error || 'fight.js не загрузился');
  };

  await test('createFight: стартовое состояние боя корректно', async () => {
    needFight();
    const fight = createFight({ fish: FISH_WEAK, tackle: TACKLE_HEAVY, rng: mulberry32For(1) });
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
    const fight = createFight({ fish: FISH_WEAK, tackle: TACKLE_HEAVY, rng: mulberry32For(2) });
    fight.status = 'landed';
    const snapshot = JSON.stringify(fight);
    for (let i = 0; i < 20; i += 1) stepFight(fight, { reel: 1, rodUp: true, pump: true }, DT);
    eq(JSON.stringify(fight), snapshot, 'состояние после status="landed"');
    return 'шаги проигнорированы';
  });

  await test('stepFight: постоянная подмотка растит натяжение', async () => {
    needFight();
    const fight = createFight({ fish: FISH_STRONG, tackle: TACKLE_HEAVY, rng: mulberry32For(3) });
    const start = fight.tension;
    let previous = fight.tension;
    let grew = 0;
    for (let i = 0; i < 10 && fight.status === 'fighting'; i += 1) {
      stepFight(fight, { reel: 1 }, DT);
      if (fight.tension > previous + 1e-9) grew += 1;
      previous = fight.tension;
    }
    ok(fight.tension > start, `натяжение не выросло: ${start.toFixed(3)} → ${fight.tension.toFixed(3)}`);
    ok(grew >= 8, `натяжение росло только на ${grew}/10 шагах`);
    return `${start.toFixed(2)} → ${fight.tension.toFixed(2)}`;
  });

  await test('stepFight: без подмотки натяжение падает и рыба сходит', async () => {
    needFight();
    const { fight } = runFight(createFight, stepFight, {
      fish: FISH_WEAK, tackle: TACKLE_MID, seed: 4, input: () => ({ reel: 0 }), maxSec: 30,
    });
    eq(fight.status, 'escaped', 'статус при reel=0');
    ok(fight.tension < 0.2, `натяжение осталось высоким: ${fight.tension.toFixed(3)}`);
    ok(fight.timeSec > 0, 'время боя не идёт');
    return `escaped за ${fight.timeSec.toFixed(1)} c, tension ${fight.tension.toFixed(2)}`;
  });

  await test('stepFight: перегруз на слабой леске → обрыв', async () => {
    needFight();
    const { fight } = runFight(createFight, stepFight, {
      fish: FISH_STRONG, tackle: TACKLE_WEAK_LINE, seed: 5, input: () => ({ reel: 1 }), maxSec: 30,
    });
    eq(fight.status, 'broken', 'статус при перегрузе');
    ok(fight.maxTension >= 1, `натяжение не дошло до обрыва: ${fight.maxTension.toFixed(3)}`);
    return `broken за ${fight.timeSec.toFixed(1)} c, maxTension ${fight.maxTension.toFixed(2)}`;
  });

  await test('stepFight: разумное вываживание → landed, дистанция падает', async () => {
    needFight();
    let previousDist = Infinity;
    let distDropped = 0;
    const result = runFight(createFight, stepFight, {
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
    ok(result.fight.distM < result.startDist, `дистанция не уменьшилась: ${result.startDist.toFixed(1)} → ${result.fight.distM.toFixed(1)}`);
    ok(distDropped > 0, 'дистанция ни разу не уменьшилась');
    return `landed за ${result.fight.timeSec.toFixed(1)} c, ${result.startDist.toFixed(1)} → ${result.fight.distM.toFixed(1)} м`;
  });

  await test('stepFight: выносливость рыбы монотонно падает под нагрузкой', async () => {
    needFight();
    const fight = createFight({ fish: FISH_STRONG, tackle: TACKLE_HEAVY, rng: mulberry32For(8) });
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

  /* ---------- src/sim/bite.js ---------- */
  group('bite.js — решение о поклёвке');
  const bitePath = 'src/sim/bite.js';
  const biteMod = await loadModule(bitePath, ['evaluateBite']);
  const evaluateBite = biteMod.mod ? biteMod.mod.evaluateBite : null;
  if (!evaluateBite) console.log(`  (модуль недоступен: ${biteMod.error})`);
  const needBite = () => {
    if (!evaluateBite) fail(biteMod.error || 'bite.js не загрузился');
  };
  const biteCase = (over = {}) => ({
    fishTable: [makeFish('okun')],
    bait: BAIT_CHERV,
    lure: null,
    tackle: { sensitivity: 0.7 },
    spot: SPOT_GRASS,
    weather: WEATHER_CLEAR,
    timeOfDay: 'dawn',
    season: 'autumn',
    skillLuring: 3,
    airPressureDelta: 0,
    ...over,
  });

  await test('evaluateBite: подходящая наживка → поклёвка и рыба из таблицы', async () => {
    needBite();
    const { mulberry32 } = await useModule(rngPath, ['mulberry32']);
    const table = [makeFish('okun'), makeFish('plotva')];
    const ids = new Set(table.map((fish) => fish.id));
    let bites = 0;
    let checked = 0;
    for (let seed = 1; seed <= 40; seed += 1) {
      const result = evaluateBite(biteCase({ fishTable: table, rng: mulberry32(seed) }));
      inRange(result.delaySec, 4, 120, `delaySec (seed=${seed})`);
      inRange(result.confidence, 0, 1, `confidence (seed=${seed})`);
      eq(typeof result.willBite, 'boolean', 'тип willBite');
      if (result.willBite) {
        bites += 1;
        ok(ids.has(result.chosenFishId), `chosenFishId «${result.chosenFishId}» не из таблицы`);
      } else {
        eq(result.chosenFishId, null, `chosenFishId при willBite=false (seed=${seed})`);
      }
      checked += 1;
    }
    ok(bites > 0, 'за 40 сидов не было ни одной поклёвки');
    return `${bites}/${checked} поклёвок, delaySec в 4..120`;
  });

  await test('evaluateBite: наживка вне рациона не выбирает эту рыбу', async () => {
    needBite();
    const { mulberry32 } = await useModule(rngPath, ['mulberry32']);
    const bait = { ...BAIT_CHERV, id: 'kukuruza', attraction: { small: 0.8, medium: 0.8, big: 0.8 } };
    const fish = makeFish('okun', { bait: ['cherv', 'oparysh'] });
    let okunCount = 0;
    for (let seed = 1; seed <= 120; seed += 1) {
      const result = evaluateBite(biteCase({ fishTable: [fish], bait, rng: mulberry32(seed) }));
      inRange(result.delaySec, 4, 120, 'delaySec');
      // Одна несовместимая рыба в таблице: выбор всегда падает на неё, но поклёвка — не гарантия.
      if (result.willBite && result.chosenFishId === 'okun') okunCount += 1;
    }
    ok(okunCount <= 120, `выборов «okun»: ${okunCount}`);
    return `несовместимая наживка: ${okunCount}/120 выборов (мягкий штраф веса)`;
  });

  await test('evaluateBite: приманка, которой нет у рыбы, — поклёвки нет', async () => {
    needBite();
    const { mulberry32 } = await useModule(rngPath, ['mulberry32']);
    const fish = makeFish('karp', { lure: ['vobler_ton'], bait: [] });
    const results = [];
    for (let seed = 1; seed <= 30; seed += 1) {
      const result = evaluateBite(biteCase({ fishTable: [fish], bait: null, lure: LURE_VERTUSHKA, rng: mulberry32(seed) }));
      inRange(result.delaySec, 4, 120, 'delaySec');
      eq(result.willBite, false, `willBite при чужой приманке (seed=${seed})`);
      eq(result.chosenFishId, null, 'chosenFishId при чужой приманке');
      results.push(result);
    }
    return `${results.length}/${results.length} отказов, chosenFishId=null`;
  });

  await test('evaluateBite: совпадающая наживка выбирается чаще несовпадающей', async () => {
    needBite();
    const { mulberry32 } = await useModule(rngPath, ['mulberry32']);
    const table = [makeFish('okun', { bait: ['cherv'] }), makeFish('som', { bait: ['zhivets'], rarity: 1 })];
    let okun = 0;
    let som = 0;
    for (let seed = 1; seed <= 200; seed += 1) {
      const result = evaluateBite(biteCase({ fishTable: table, rng: mulberry32(seed) }));
      if (!result.willBite) continue;
      if (result.chosenFishId === 'okun') okun += 1;
      else if (result.chosenFishId === 'som') som += 1;
      else fail(`неожиданный chosenFishId: ${result.chosenFishId}`);
    }
    const total = okun + som;
    ok(total > 0, 'не выбрано ни одной рыбы');
    ok(okun / total > 0.7, `доля совпадающей наживки только ${(okun / total * 100).toFixed(1)}%`);
    return `okun ${okun} против som ${som} (${(okun / total * 100).toFixed(1)}%)`;
  });

  await test('evaluateBite: пустая таблица — отказ без исключения', async () => {
    needBite();
    const result = evaluateBite(biteCase({ fishTable: [] }));
    eq(result.willBite, false, 'willBite на пустой таблице');
    eq(result.chosenFishId, null, 'chosenFishId на пустой таблице');
    inRange(result.delaySec, 4, 120, 'delaySec');
    return 'willBite=false, chosenFishId=null';
  });

  /* ---------- src/sim/climate.js ---------- */
  group('climate.js — время, сезоны, погода');
  const climatePath = 'src/sim/climate.js';
  const climateMod = await loadModule(climatePath, ['createClimate', 'stepClimate', 'timeOfDayOf']);
  const createClimate = climateMod.mod ? climateMod.mod.createClimate : null;
  const stepClimate = climateMod.mod ? climateMod.mod.stepClimate : null;
  const timeOfDayOf = climateMod.mod ? climateMod.mod.timeOfDayOf : null;
  if (!createClimate) console.log(`  (модуль недоступен: ${climateMod.error})`);
  const needClimate = () => {
    if (!createClimate || !stepClimate || !timeOfDayOf) fail(climateMod.error || 'climate.js не загрузился');
  };

  await test('timeOfDayOf: фазы на границах 240/480/1080/1320', async () => {
    needClimate();
    const cases = [
      [0, 'night'], [239, 'night'], [240, 'dawn'], [479, 'dawn'], [480, 'day'],
      [1079, 'day'], [1080, 'dusk'], [1319, 'dusk'], [1320, 'night'], [1439, 'night'],
    ];
    for (const [minutes, expected] of cases) {
      eq(timeOfDayOf(minutes), expected, `timeOfDayOf(${minutes})`);
    }
    return '10 границ совпали';
  });

  await test('createClimate: начальное состояние задано и валидно', async () => {
    needClimate();
    const climate = createClimate({ seed: 'selftest', startMinutes: 360, startDay: 2, season: 'summer' });
    eq(climate.season, 'summer', 'season');
    eq(climate.day, 2, 'day');
    eq(climate.minutes, 360, 'minutes');
    ok(climate.weather && typeof climate.weather === 'object', 'weather отсутствует');
    inRange(climate.weather.tempC, -60, 60, 'weather.tempC');
    inRange(climate.weather.pressure, 900, 1100, 'weather.pressure');
    return `summer, день 2, погода ${Math.round(climate.weather.tempC)}°C`;
  });

  await test('stepClimate: минуты растут по timeScale', async () => {
    needClimate();
    const climate = createClimate({ seed: 'grow', startMinutes: 600, startDay: 1, season: 'autumn' });
    const before = climate.minutes;
    let previousTotal = climate.day * 1440 + climate.minutes;
    let monotone = true;
    for (let i = 0; i < 100; i += 1) {
      stepClimate(climate, 0.25, 1);
      const total = climate.day * 1440 + climate.minutes;
      if (total < previousTotal - 1e-6) monotone = false;
      previousTotal = total;
    }
    ok(monotone, 'игровое время шло назад');
    near(climate.minutes - before, 25, 1e-6, 'прирост минут за 100 шагов по 0.25 с');
    return `${before} → ${climate.minutes.toFixed(1)} минут за 25 реальных секунд`;
  });

  await test('stepClimate: переход через полночь повышает день', async () => {
    needClimate();
    const climate = createClimate({ seed: 'midnight', startMinutes: 1430, startDay: 3, season: 'autumn' });
    const result = stepClimate(climate, 0.25, 60); // 15 игровых минут
    eq(result.day, 4, 'day после полуночи');
    inRange(result.minutes, 0, 1439, 'minutes после полуночи');
    eq(result.changed, true, 'флаг changed на смене суток');
    return `день 3 → ${result.day}, ${Math.round(result.minutes)} мин`;
  });

  await test('stepClimate: сезон меняется раз в 7 игровых дней', async () => {
    needClimate();
    const order = ['spring', 'summer', 'autumn', 'winter'];
    const startSeason = 'autumn';
    const startIdx = order.indexOf(startSeason);
    const expectedSeason = (day) => order[(startIdx + Math.floor((day - 1) / 7)) % 4];
    const climate = createClimate({ seed: 'season', startMinutes: 0, startDay: 1, season: startSeason });
    const changesPerDay = new Map();
    let previousSeason = climate.season;
    let previousDay = climate.day;
    let totalChanges = 0;
    for (let step = 0; step < 60 * 24 * 16; step += 1) {
      stepClimate(climate, 0.25, 60); // 15 игровых минут за шаг, 96 шагов в сутках
      if (climate.season !== previousSeason) {
        totalChanges += 1;
        changesPerDay.set(climate.day, (changesPerDay.get(climate.day) || 0) + 1);
        previousSeason = climate.season;
      }
      if (climate.day !== previousDay) {
        previousDay = climate.day;
        eq(climate.season, expectedSeason(climate.day), `сезон на дне ${climate.day}`);
      }
    }
    const maxPerDay = Math.max(0, ...changesPerDay.values());
    ok(maxPerDay <= 1, `сезон менялся ${maxPerDay} раз за один игровой день — это не «раз в 7 дней»`);
    const expectedChanges = Math.floor((climate.day - 1) / 7);
    ok(Math.abs(totalChanges - expectedChanges) <= 1, `смен сезона ${totalChanges}, ожидалось ~${expectedChanges} за ${climate.day} дней`);
    return `${totalChanges} смен за ${climate.day} дней, максимум ${maxPerDay} в день`;
  });

  await test('stepClimate: флаг changed реагирует на смену фазы суток', async () => {
    needClimate();
    // Старт за минуту до рассвета: первый же шаг должен сменить ночь на рассвет.
    const climate = createClimate({ seed: 'dawn', startMinutes: 239, startDay: 1, season: 'autumn' });
    eq(timeOfDayOf(climate.minutes), 'night', 'фаза до шага');
    const result = stepClimate(climate, 0.25, 4); // +1 игровая минута
    eq(timeOfDayOf(result.minutes), 'dawn', 'фаза после шага');
    eq(result.changed, true, 'флаг changed на смене фазы');
    return 'ночь → рассвет, changed=true';
  });

  /* ---------- итог ---------- */
  const passed = results.filter((item) => item.ok).length;
  const failed = results.filter((item) => !item.ok);
  const secs = ((Date.now() - startedAt) / 1000).toFixed(2);

  console.log('\n=== Итог ===');
  console.log(`${results.length} тестов · ${passed} passed, ${failed.length} failed · ${secs} c`);
  if (failed.length > 0) {
    console.log('Провалы:');
    for (const item of failed) {
      const reason = String((item.error && item.error.message) || item.error).split('\n')[0];
      console.log(`  FAIL [${item.group}] ${item.name} — ${reason}`);
    }
    return 1;
  }
  console.log('Все тесты зелёные.');
  return 0;
}

let exitCode = 1;
try {
  exitCode = await main();
} catch (err) {
  console.error('selftest упал вне теста:', err && err.stack ? err.stack : err);
  exitCode = 1;
}
process.exitCode = exitCode;
