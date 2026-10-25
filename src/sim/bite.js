/**
 * bite.js — выбор рыбы и решение «будет ли поклёвка». Чистая логика.
 * Никаких ссылок на DOM, three.js или состояние игры: на вход данные, на выход решение.
 */
import { clamp } from '../core/util.js';

/** Вес редкости: редкая рыба должна быть редкой, но не невидимой. */
const RARITY_WEIGHT = [160, 90, 48, 22, 9, 3];

const SIZE_ATTRACT = { small: 'small', medium: 'medium', big: 'big' };

/** Размер рыбы по массе — чтобы подобрать притяжение наживки/приманки. */
function sizeClassOf(fish) {
  const kg = (Number(fish.minKg) || 0.05) + (Number(fish.maxKg) || 0.1);
  if (kg < 0.6) return SIZE_ATTRACT.small;
  if (kg < 4) return SIZE_ATTRACT.medium;
  return SIZE_ATTRACT.big;
}

/** Совместима ли наживка/приманка с рыбой. */
function baitMatch(fish, baitId, lureId) {
  if (lureId) {
    if (!Array.isArray(fish.lure) || fish.lure.length === 0) return 0;
    return fish.lure.includes(lureId) ? 1 : 0.08;
  }
  if (!baitId) return 0.25;
  if (!Array.isArray(fish.bait) || fish.bait.length === 0) return 0.1;
  // Первая наживка в списке — любимая, даёт полный вес.
  const idx = fish.bait.indexOf(baitId);
  if (idx < 0) return 0.08;
  return idx === 0 ? 1 : 0.72;
}

/** Глубина: где держится рыба против того, как работает снасть. */
function depthMatch(fish, depthWork) {
  if (!depthWork) return 0.8;
  if (depthWork === fish.depth) return 1;
  const order = { bottom: 0, mid: 1, surface: 2 };
  const delta = Math.abs((order[depthWork] ?? 1) - (order[fish.depth] ?? 1));
  return delta === 1 ? 0.6 : 0.25;
}

function seasonMatch(fish, season) {
  if (!Array.isArray(fish.seasons) || fish.seasons.length === 0) return 0.8;
  return fish.seasons.includes(season) ? 1 : 0.25;
}

function timeMatch(fish, timeOfDay) {
  const t = fish.timeOfDay || {};
  const v = Number(t[timeOfDay]);
  return Number.isFinite(v) ? clamp(v, 0, 1.2) : 0.6;
}

function weatherMatch(fish, weather) {
  const p = fish.weatherPenalty || {};
  // Ключ выбирается по фактической погоде: гроза и сильный дождь считаются дождём,
  // сильный ветер — ветром, всё остальное — ясно.
  const precip = weather?.precip ?? 'none';
  const windMs = Number(weather?.windMs) || 0;
  if (precip === 'rain' || precip === 'storm') return Number(p.rain) || 0.85;
  if (windMs >= 7) return Number(p.wind) || 0.85;
  return Number(p.clear) || 1;
}

function structureBonus(fish, spot) {
  const structure = spot?.structure;
  if (!structure) return 1;
  // Рыба у дна любит ямы и коряги, хищник — свал и траву, мелочь — песок и камыш.
  const affinity = {
    pit: fish.depth === 'bottom' ? 1.25 : 0.9,
    snag: fish.depth === 'bottom' ? 1.2 : 0.95,
    grass: fish.depth === 'mid' ? 1.2 : 0.95,
    dropoff: fish.depth === 'surface' ? 1.1 : 1.05,
    sand: fish.rarity <= 1 ? 1.1 : 0.9,
    reed: fish.depth === 'mid' ? 1.15 : 0.95,
  };
  return affinity[structure] ?? 1;
}

/**
 * Оценивает шанс поклёвки на текущей точке и выбирает рыбу.
 * fishTable — массив рыбы (FISH), уже отфильтрованный по типу водоёма вызывающим.
 */
export function evaluateBite({
  fishTable,
  bait,
  lure,
  tackle,
  spot,
  weather,
  timeOfDay,
  season,
  skillLuring = 0,
  airPressureDelta = 0,
  rng,
}) {
  const random = typeof rng === 'function' ? rng : Math.random;
  const list = Array.isArray(fishTable) ? fishTable : [];
  if (list.length === 0) {
    return { willBite: false, delaySec: 20, chosenFishId: null, confidence: 0 };
  }

  const baitId = bait?.id ?? null;
  const lureId = lure?.id ?? null;
  const depthWork = lureId ? lure?.depthWork : bait?.depthWork;
  const skill = clamp(Number(skillLuring) || 0, 0, 10);

  // Отбор кандидатов с весом.
  const candidates = [];
  for (const fish of list) {
    if (!fish || !fish.id) continue;
    const rw = RARITY_WEIGHT[clamp(Math.round(Number(fish.rarity) || 0), 0, 5)] || 10;
    const baitW = baitMatch(fish, baitId, lureId);
    if (baitW < 0.05) continue;
    const depthW = depthMatch(fish, depthWork);
    const seasonW = seasonMatch(fish, season);
    const timeW = timeMatch(fish, timeOfDay);
    const weatherW = weatherMatch(fish, weather);
    const structW = structureBonus(fish, spot);

    // Притяжение по размеру: мелкая наживка ловит мелочь, крупная — трофеев.
    const sizeClass = sizeClassOf(fish);
    const attract = lureId ? lure?.attraction : bait?.attraction;
    const sizeW = clamp(Number(attract?.[sizeClass]) || 0.5, 0.05, 1);

    const weight =
      rw * baitW ** 2 * depthW * seasonW * timeW * weatherW * structW * (0.4 + sizeW * 0.9);
    if (weight > 0) candidates.push({ fish, weight });
  }

  if (candidates.length === 0) {
    return { willBite: false, delaySec: 25 + random() * 30, chosenFishId: null, confidence: 0 };
  }

  // Выбор рыбы пропорционально весам.
  let total = 0;
  for (const c of candidates) total += c.weight;
  let roll = random() * total;
  let chosen = candidates[candidates.length - 1].fish;
  for (const c of candidates) {
    roll -= c.weight;
    if (roll <= 0) {
      chosen = c.fish;
      break;
    }
  }

  // Давление резко падает → клёв хуже; растёт → лучше.
  const pressureW = clamp(1 + clamp(Number(airPressureDelta) || 0, -8, 8) * 0.05, 0.65, 1.3);
  const skillW = 0.72 + skill * 0.06;
  const rodSensitivity = clamp(Number(tackle?.sensitivity) || 0.5, 0.1, 1);
  const confidence = clamp(
    (chosen.timeOfDay?.[timeOfDay] ?? 0.6) *
      weatherMatch(chosen, weather) *
      (0.55 + rodSensitivity * 0.45) *
      skillW *
      pressureW,
    0,
    1,
  );

  // Вероятность, что на этом забросе вообще клюнет.
  const willBiteChance = clamp(0.35 + confidence * 0.55, 0.12, 0.92);
  const willBite = random() < willBiteChance;

  // Задержка: уверенный клёв быстрее, редкая рыба — дольше подходит.
  const greed = clamp(1.15 - confidence * 0.8, 0.3, 1.15);
  const rarityDelay = 1 + clamp(Number(chosen.rarity) || 0, 0, 5) * 0.22;
  const delaySec = clamp((4 + random() * 46) * greed * rarityDelay, 4, 120);

  return {
    willBite,
    delaySec,
    chosenFishId: willBite ? chosen.id : null,
    confidence,
  };
}

/** Случайная масса рыбы в пределах вида с уклоном к мелкой (крупная — редкость). */
export function rollFishWeight(fish, rng) {
  const random = typeof rng === 'function' ? rng : Math.random;
  const min = Math.max(0.01, Number(fish?.minKg) || 0.05);
  const max = Math.max(min + 0.01, Number(fish?.maxKg) || min * 5);
  // Степень 2.2 даёт перекос в сторону мелких особей, но трофей возможен.
  const t = random() ** 2.2;
  const kg = min + (max - min) * t;
  return Math.round(kg * 1000) / 1000;
}
