/**
 * cast.js — физика заброса, точность и дрейф поплавка. Чистая логика, без DOM и three.js.
 *
 * Система координат сцены: рыбак стоит на берегу в точке (0, 8), вода уходит в -Z.
 * Углы в градусах отсчитываются от +Z по часовой стрелке: вектор направления —
 * (sin(deg), cos(deg)). windDirDeg — куда дует ветер, castDirDeg — куда летит снасть.
 * Совпадение направлений (cos = 1) означает попутный ветер.
 */
import { clamp } from '../core/util.js';

/** Положение рыбака на берегу — общее для заброса и дрейфа. */
export const SHORE_POINT = { x: 0, z: 8 };

const MIN_CAST_M = 4;
const PERFECT_WINDOW = [0.62, 0.78];
const OVERSHOOT_POWER = 0.95;
const DEG = Math.PI / 180;

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Единичный вектор направления по углу в градусах (0° → +Z, 90° → +X). */
function dirVector(deg) {
  const rad = num(deg) * DEG;
  return { x: Math.sin(rad), z: Math.cos(rad) };
}

/** Косинус угла между направлением заброса и ветром: 1 — попутный, -1 — встречный. */
function windAlignment(windDirDeg, castDirDeg) {
  const a = dirVector(windDirDeg);
  const b = dirVector(castDirDeg);
  return clamp(a.x * b.x + a.z * b.z, -1, 1);
}

/** Поправка груза: тяжёлое грузило меньше парусит. На встречном ветре выигрыш больше. */
function sinkerBonus(sinkerWeightG, alignment) {
  const weight = clamp(num(sinkerWeightG, 0), 0, 200);
  const full = clamp(weight / 40, 0, 1); // 40 г и тяжелее — полный эффект
  const headwind = alignment < 0 ? 0.08 : 0.03;
  return 1 + full * headwind;
}

/**
 * Дальность заброса. power01 — сила замаха 0..1 (растёт, пока игрок держит ЛКМ).
 * Идеальное окно 0.62..0.78; пересиленный заброс улетает за предел снасти и теряет точность.
 */
export function castDistance({
  rodCastRangeM,
  power01,
  windMs,
  windDirDeg,
  castDirDeg,
  skillCasting,
  sinkerWeightG,
}) {
  const range = Math.max(MIN_CAST_M, num(rodCastRangeM, 20));
  const power = clamp(num(power01, 0.5), 0, 1);
  const wind = Math.max(0, num(windMs, 0));
  const skill = clamp(num(skillCasting, 0), 0, 10);
  const alignment = windAlignment(windDirDeg, castDirDeg);

  // Базовая дуга заброса: даже слабый замах бросает снасть вперёд.
  let distM = range * (0.45 + 0.55 * power);
  // Навык даёт до +30 % на максимуме.
  distM *= 1 + skill * 0.03;
  // Груз стабилизирует снасть: до +8 % на встречном ветре, до +3 % на попутном.
  distM *= sinkerBonus(sinkerWeightG, alignment);
  // Ветер сносит снасть: попутный добавляет, встречный отнимает.
  distM += wind * 0.06 * alignment;

  const perfect = power >= PERFECT_WINDOW[0] && power <= PERFECT_WINDOW[1];
  // Пересиленный заброс: снасть уходит за паспортный предел и теряет точность.
  const overshoot = power > OVERSHOOT_POWER && distM > range;
  if (overshoot) distM = range * 1.02;

  distM = clamp(distM, MIN_CAST_M, range * 1.05);
  return { distM, perfect, overshoot };
}

/**
 * Точность: доля 0..1 и радиус разброса в метрах.
 * Идеальное окно силы и навык повышают точность, ветер — снижает.
 */
export function castAccuracy({ distM, power01, skillCasting, windMs }) {
  const dist = Math.max(MIN_CAST_M, num(distM, 10));
  const power = clamp(num(power01, 0.5), 0, 1);
  const skill = clamp(num(skillCasting, 0), 0, 10);
  const wind = Math.max(0, num(windMs, 0));
  const perfect = power >= PERFECT_WINDOW[0] && power <= PERFECT_WINDOW[1];

  const accuracy01 = clamp(0.35 + skill * 0.05 + (perfect ? 0.2 : 0) - wind * 0.02, 0.1, 0.98);
  const spreadM = dist * (1 - accuracy01) * 0.25;
  return { accuracy01, spreadM };
}

/** Скорость течения вдоль +X, м за игровую минуту, по типу водоёма. */
const CURRENT_FACTOR = { river: 1, lake: 0.5, pond: 0.12, sea: 0.7 };

/**
 * Дрейф поплавка от течения и ветра. Возвращает смещение от точки заброса.
 * Река тянет по +X, озеро вдвое слабее, пруд почти не тянет, море — 0.7 от реки плюс волна.
 */
export function bobberDrift({ distM, minutes, windMs, windDirDeg, waterType }) {
  const dist = Math.max(MIN_CAST_M, num(distM, 10));
  const mins = clamp(num(minutes, 0), 0, 240);
  const wind = Math.max(0, num(windMs, 0));
  const factor = CURRENT_FACTOR[waterType] ?? CURRENT_FACTOR.river;

  // Течение: река сносит со скоростью 0.02 * distM м/мин, остальные — пропорционально.
  const currentSpeed = 0.02 * dist * factor;
  let x = currentSpeed * mins;
  let z = 0;

  // Море добавляет поперечную волну: качает поплавок даже без течения.
  if (waterType === 'sea') {
    x += Math.sin(mins * 0.7) * wind * 0.02;
    z += Math.cos(mins * 0.55) * wind * 0.03;
  }

  // Ветер гонит поплавок по своему направлению.
  const w = dirVector(windDirDeg);
  const windPush = wind * 0.02 * mins;
  x += w.x * windPush;
  z += w.z * windPush;

  return { x, z };
}

/** Скорость погружения оснастки: тяжёлый груз тонет быстрее. */
function sinkRateM(sinkerWeightG, feederWeightG) {
  const weight = Math.max(num(sinkerWeightG, 0), num(feederWeightG, 0));
  return 3 + weight * 0.12;
}

/**
 * Полный заброс: от силы замаха до точки в мировых координатах.
 * Берег — (0, 8), направление — на выбранную точку spot, дальность — по характеристикам снасти.
 * Итоговая глубина считается по spot.depthM: недолёт до точки означает меньшую глубину.
 */
/** Геометрия заброса: направление от берега к цели и дистанция до неё. */
function aimAt(spot) {
  const dx = num(spot?.x, 0) - SHORE_POINT.x;
  const dz = num(spot?.z, -20) - SHORE_POINT.z;
  const targetDist = Math.max(0.001, Math.hypot(dx, dz));
  return {
    targetDist,
    castDirDeg: Math.atan2(dx, dz) / DEG,
    ux: dx / targetDist,
    uz: dz / targetDist,
    spotDepth: Math.max(0.3, num(spot?.depthM, 3)),
  };
}

/**
 * Полный заброс: от силы замаха до точки в мировых координатах.
 * Берег — (0, 8), направление — на выбранную точку spot, дальность — по характеристикам снасти.
 * Итоговая глубина считается по spot.depthM: недолёт до точки означает меньшую глубину.
 */
export function applyCast({ spot, stats, power01, skillCasting, weather, rng }) {
  const random = typeof rng === 'function' ? rng : Math.random;
  const s = stats || {};
  const aim = aimAt(spot);

  const windMs = Math.max(0, num(weather?.windMs, 0));
  const windDirDeg = num(weather?.windDirDeg, 0);

  const cast = castDistance({
    rodCastRangeM: s.castRangeM,
    power01,
    windMs,
    windDirDeg,
    castDirDeg: aim.castDirDeg,
    skillCasting,
    sinkerWeightG: s.sinkerWeightG,
  });

  const accuracy = castAccuracy({ distM: cast.distM, power01, skillCasting, windMs });

  // Точка падения: вдоль направления заброса плюс случайный разброс по углу.
  // sqrt(random()) даёт равномерное заполнение круга, а не сгусток в центре.
  const angle = random() * Math.PI * 2;
  const radius = accuracy.spreadM * Math.sqrt(random());
  const x = SHORE_POINT.x + aim.ux * cast.distM + Math.cos(angle) * radius;
  const z = SHORE_POINT.z + aim.uz * cast.distM + Math.sin(angle) * radius;

  // Недолёт до выбранной точки = мельче: глубина растёт по мере приближения к точке.
  const reached = clamp(Math.hypot(x - SHORE_POINT.x, z - SHORE_POINT.z) / aim.targetDist, 0.1, 1);
  const waterDepthM = Math.max(0.3, aim.spotDepth * reached);

  const minutesToSettle = clamp(
    waterDepthM / sinkRateM(s.sinkerWeightG, s.feederWeightG) + 0.5 + cast.distM * 0.01,
    0.5,
    12,
  );

  return {
    distM: cast.distM,
    x,
    z,
    accuracy01: accuracy.accuracy01,
    spreadM: accuracy.spreadM,
    perfect: cast.perfect,
    overshoot: cast.overshoot,
    waterDepthM,
    minutesToSettle,
    castDirDeg: aim.castDirDeg,
    targetDist: aim.targetDist,
  };
}
