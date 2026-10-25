/**
 * src/scene/util.js — мелкие помощники сцены: ГПСЧ, цвета, сглаживание.
 * THREE передаётся параметром, чтобы модуль не тянул его повторно.
 */

/** Детерминированный ГПСЧ (LCG): сцена одинакова при каждом запуске. */
export function seededRnd(seed = 1) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Hex/Color -> новый THREE.Color; при ошибке — нейтральный цвет. */
export function toColor(THREE, value, fallback = '#808080') {
  try {
    if (value && typeof value === 'object' && value.isColor) return value.clone();
    return new THREE.Color(value || fallback);
  } catch (err) {
    return new THREE.Color(fallback);
  }
}

/** Ограничение в диапазон с защитой от NaN. */
export function clamp(v, min, max) {
  if (!Number.isFinite(v)) return min;
  return v < min ? min : v > max ? max : v;
}

/** Экспоненциальное сглаживание, не зависящее от FPS. */
export function damp(current, target, lambda, dt) {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

/** Высота «провисающей» лески: парабола по расстоянию от удилища к поплавку. */
export function sagOffset(t, sag) {
  return -sag * 4 * t * (1 - t);
}
