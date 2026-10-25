/**
 * src/scene/palette.js — суточная палитра сцены.
 * Все расчёты идемпотентны: зависят только от игровых минут и облачности,
 * поэтому update() можно вызывать сколько угодно раз за кадр.
 */

export const DEFAULT_AMBIENT = {
  fogColor: '#b9c6cc',
  waterColor: '#2f5a60',
  skyTop: '#6e9dc6',
  skyBottom: '#dbe7ef',
  groundColor: '#4a5a3a',
  reeds: true,
  boats: 1,
};

const NIGHT_TOP = '#060b19';
const NIGHT_BOTTOM = '#101c30';

export function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : Number.isFinite(v) ? v : 0;
}

export function smoothstep(edge0, edge1, x) {
  const t = clamp01((x - edge0) / (edge1 - edge0 || 1e-6));
  return t * t * (3 - 2 * t);
}

function parseHex(hex) {
  let s = typeof hex === 'string' ? hex.trim().replace('#', '') : '';
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  if (s.length !== 6 || /[^0-9a-f]/i.test(s)) return { r: 255, g: 255, b: 255 };
  return { r: parseInt(s.slice(0, 2), 16), g: parseInt(s.slice(2, 4), 16), b: parseInt(s.slice(4, 6), 16) };
}

function toHex(c) {
  const h = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

/** Линейное смешение двух hex-цветов. */
export function mixHex(a, b, t) {
  const ca = parseHex(a);
  const cb = parseHex(b);
  const k = clamp01(t);
  return toHex({ r: ca.r + (cb.r - ca.r) * k, g: ca.g + (cb.g - ca.g) * k, b: ca.b + (cb.b - ca.b) * k });
}

/** Разница цветов по каналам 0..255 — для троттлинга перерисовки неба. */
export function hexDelta(a, b) {
  const ca = parseHex(a);
  const cb = parseHex(b);
  return Math.max(Math.abs(ca.r - cb.r), Math.abs(ca.g - cb.g), Math.abs(ca.b - cb.b));
}

/** Нормализованный вектор из массива. */
function norm(v) {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

/**
 * Состояние неба и света на игровые минуты.
 * -> { minutes, elev, dayness, top, bottom, fog, sunColor, sunI, hemiSky,
 *      hemiGround, hemiI, waterTint, exposure, sunDir, moonDir, moonI }
 */
export function sampleSky(opts = {}) {
  const ambient = { ...DEFAULT_AMBIENT, ...(opts.ambient || {}) };
  const raw = Number.isFinite(opts.minutes) ? opts.minutes : 720;
  const minutes = ((raw % 1440) + 1440) % 1440;
  const cloud = clamp01(opts.cloud ?? 0);
  const theta = ((minutes - 360) / 720) * Math.PI;
  const elev = Math.sin(theta);
  const dayness = smoothstep(-0.1, 0.22, elev);
  const warmth = clamp01(1 - Math.abs(elev) / 0.42) * smoothstep(-0.24, 0.02, elev);

  let top = mixHex(NIGHT_TOP, ambient.skyTop, dayness);
  let bottom = mixHex(NIGHT_BOTTOM, ambient.skyBottom, dayness);
  top = mixHex(top, '#2c3c6a', warmth * 0.45);
  bottom = mixHex(bottom, '#e8a878', warmth * 0.8);
  const grey = cloud * (0.25 + dayness * 0.75);
  top = mixHex(top, '#8d9aa6', grey * 0.35);
  bottom = mixHex(bottom, '#c3ccd2', grey * 0.4);

  const fog = mixHex(mixHex(ambient.fogColor, '#0a1220', (1 - dayness) * 0.85), '#8f9aa2', cloud * 0.2);
  const sunColor = mixHex('#ffd2a1', '#fff6e0', smoothstep(0.05, 0.6, elev));
  const sunI = (0.15 + 1.05 * clamp01(elev + 0.15)) * dayness * (1 - cloud * 0.55) + 0.05;
  const moonI = smoothstep(0.02, -0.15, elev) * 0.5;
  const hemiI = 0.2 + dayness * 0.75 * (1 - cloud * 0.25);
  const sunDir = norm([Math.cos(theta) * 0.85, Math.max(elev, 0.015), -0.55]);
  const moonDir = norm([-Math.cos(theta) * 0.6, Math.max(-elev, 0.08), -0.55]);

  return {
    minutes,
    elev,
    dayness,
    cloud,
    top,
    bottom,
    fog,
    sunColor,
    sunI,
    moonI,
    hemiSky: mixHex('#1b2b44', top, 0.65),
    hemiGround: mixHex('#0e1410', ambient.groundColor, 0.35 + dayness * 0.5),
    hemiI,
    waterTint: mixHex('#33455e', '#ffffff', 0.12 + 0.88 * dayness),
    exposure: 0.88 + 0.22 * dayness,
    sunDir,
    moonDir,
  };
}
