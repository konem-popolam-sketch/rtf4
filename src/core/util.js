/** Общие мелкие утилиты. Без зависимостей, работают в Node и в браузере. */

export const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const smoothstep = (t) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

export function round1(v) {
  return Math.round(v * 10) / 10;
}

export function round2(v) {
  return Math.round(v * 100) / 100;
}

/** 1234567 → "1 234 567" */
export function fmtInt(v) {
  const n = Math.round(Number(v) || 0);
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** Масса: 0.42 → "420 г", 3.7 → "3,7 кг" */
export function fmtKg(kg) {
  const v = Number(kg) || 0;
  if (v < 1) return `${Math.round(v * 1000)} г`;
  return `${round2(v).toFixed(2).replace('.', ',')} кг`;
}

export function fmtMoney(v) {
  return `${fmtInt(v)} ₽`;
}

/** Игровые минуты (0..1439) → "06:35" */
export function fmtClock(minutes) {
  const m = ((Math.floor(minutes) % 1440) + 1440) % 1440;
  const hh = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

export function uid(prefix = 'id') {
  const r = Math.floor(Math.random() * 0xffffff).toString(36);
  return `${prefix}_${Date.now().toString(36)}_${r}`;
}

/** Глубокое клонирование только plain-данных (structuredClone есть в браузере и Node 17+). */
export function clone(obj) {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(obj);
    } catch {
      /* fall through */
    }
  }
  return JSON.parse(JSON.stringify(obj));
}

export function sum(arr, sel = (x) => x) {
  let t = 0;
  for (const v of arr) t += sel(v);
  return t;
}

export function byId(list, id) {
  return list.find((x) => x && x.id === id);
}

/** Плавное приближение значения к цели, независимое от FPS. */
export function damp(current, target, lambda, dt) {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

export function nowMs() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}
