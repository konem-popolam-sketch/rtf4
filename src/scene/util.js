/**
 * src/scene/util.js — мелкие помощники сцены (ГПСЧ, цвета, easing).
 * Без зависимостей: принимают THREE параметром, чтобы не тянуть его повторно.
 */

/** Детерминированный ГПСЧ (LCG): сцена одинакова при каждом запуске. */
export function seededRnd(seed = 1) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Hex/строка -> THREE.Color; при ошибке — нейтральный цвет. */
export function toColor(THREE, value, fallback = '#808080') {
  try {
    if (value && typeof value === 'object' && value.isColor) return value.clone();
    if (value instanceof THREE.Color) return value.clone();
    return new THREE.Color(value || fallback);
  } catch (err) {
    return new THREE.Color(fallback);
  }
}

export function clamp(v, min, max) {
  if (!Number.isFinite(v)) return min;
  return v < min ? min : v > max ? max : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Экспоненциальное сглаживание, не зависящее от FPS. */
export function damp(current, target, lambda, dt) {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

/** Плавное приближение угла с учётом периода. */
export function dampAngle(current, target, lambda, dt) {
  let delta = (target - current) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return current + delta * (1 - Math.exp(-lambda * dt));
}

/** Высота «провисающей» лески: парабола по расстоянию от удилища к поплавку. */
export function sagOffset(t, sag) {
  return -sag * 4 * t * (1 - t);
}
