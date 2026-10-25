/**
 * Детерминированный ГПСЧ и утилиты взвешенного выбора.
 * Используется и в игре, и в unit-тестах (одинаковый seed → одинаковый результат).
 */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  const s = String(str);
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** entries: [{ value, weight }] → value. Нулевые/отрицательные веса игнорируются. */
export function pickWeighted(rng, entries) {
  if (!Array.isArray(entries) || entries.length === 0) return undefined;
  let total = 0;
  for (const e of entries) {
    const w = Number(e && e.weight);
    if (Number.isFinite(w) && w > 0) total += w;
  }
  if (total <= 0) return entries[0].value;
  let roll = rng() * total;
  for (const e of entries) {
    const w = Number(e && e.weight);
    if (!Number.isFinite(w) || w <= 0) continue;
    roll -= w;
    if (roll <= 0) return e.value;
  }
  return entries[entries.length - 1].value;
}

export function randRange(rng, min, max) {
  return min + (max - min) * rng();
}

export function randInt(rng, min, max) {
  return Math.floor(min + (max - min + 1) * rng());
}

/** Нормальное распределение (Box–Muller) с обрезкой в [min,max]. */
export function randNormal(rng, mean, sd, min = -Infinity, max = Infinity) {
  const u1 = Math.max(1e-9, rng());
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.min(max, Math.max(min, mean + z * sd));
}

export function chance(rng, p) {
  return rng() < p;
}

export function shuffle(rng, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
