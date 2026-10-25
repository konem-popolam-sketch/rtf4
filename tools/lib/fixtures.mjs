/**
 * Фикстуры для тестов: рыбы, снасти, наживки/приманки, погода, точки.
 * Значения подобраны так, чтобы бой и поклёвка были предсказуемы и не зависели от src/data/*.
 */

export const FISH_WEAK = { id: 'okun', kg: 0.3, fightPower: 0.2, stamina: 0.2, aggro: 0.2 };
export const FISH_STRONG = { id: 'som', kg: 8, fightPower: 0.9, stamina: 0.9, aggro: 0.8 };

export const TACKLE_HEAVY = {
  maxLoadKg: 12,
  lineTestKg: 12,
  reelSpeed: 0.9,
  maxDragKg: 8,
  rodPower: 0.9,
  sensitivity: 0.9,
  hookStrength: 0.9,
};

export const TACKLE_MID = {
  maxLoadKg: 5,
  lineTestKg: 5,
  reelSpeed: 0.7,
  maxDragKg: 4,
  rodPower: 0.7,
  sensitivity: 0.7,
  hookStrength: 0.7,
};

export const TACKLE_WEAK_LINE = {
  maxLoadKg: 0.6,
  lineTestKg: 0.6,
  reelSpeed: 0.5,
  maxDragKg: 0.4,
  rodPower: 0.3,
  sensitivity: 0.3,
  hookStrength: 0.4,
};

export const BAIT_CHERV = {
  id: 'cherv',
  type: 'bait',
  depthWork: 'mid',
  attraction: { small: 0.9, medium: 0.85, big: 0.55 },
};

export const LURE_VERTUSHKA = {
  id: 'vertushka',
  type: 'lure',
  depthWork: 'mid',
  attraction: { small: 0.6, medium: 0.8, big: 0.9 },
};

export const WEATHER_CLEAR = {
  tempC: 12,
  windMs: 2,
  windDir: 200,
  precip: 'none',
  pressure: 1013,
  cloud: 0.3,
};

export const SPOT_GRASS = { id: 'spot_grass', name: 'Трава', structure: 'grass', depthM: 3 };

/** Резервный ГПСЧ (LCG): тесты боя остаются детерминированными, даже если rng.js сломан. */
export function fallbackRng(seed) {
  let state = (Number(seed) || 1) >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Рыба по схеме docs/API.md §2.1 с переопределяемыми полями. */
export function makeFish(id, over = {}) {
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
