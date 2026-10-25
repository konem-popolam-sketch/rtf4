/**
 * fight.js — вываживание рыбы. Чистая логика, без DOM и без three.js.
 * Все коэффициенты берутся из рыбы и снасти; в UI ничего не хардкодим.
 *
 * Модель:
 *  - distM      — дистанция от берега до рыбы, 5..60 м; растёт от рывков, падает от подмотки.
 *  - tension    — натяжение лески 0..1; выше 1 → обрыв, долго около 0 → сход.
 *  - fishStamina— 0..1, падает при нагрузке; на нуле рыба идёт к берегу сама.
 *  - pulse      — текущий рывок рыбы 0..1 (затухает), задаёт прирост дистанции.
 */
import { clamp } from '../core/util.js';

const MIN_DIST = 5;
const MAX_DIST = 60;
const LANDING_DIST = 5;
const BASE_SLACK_LIMIT = 2.4; // секунд без натяжения до схода

/** Собирает рабочую копию параметров снасти (с безопасными значениями по умолчанию). */
function resolveTackle(tackle) {
  const t = tackle || {};
  return {
    maxLoadKg: Math.max(0.2, Number(t.maxLoadKg) || 3),
    lineTestKg: Math.max(0.2, Number(t.lineTestKg) || 2.5),
    reelSpeed: clamp(Number(t.reelSpeed) || 0.5, 0.05, 1),
    maxDragKg: Math.max(0.25, Number(t.maxDragKg) || 2),
    rodPower: clamp(Number(t.rodPower) || 0.5, 0.05, 1),
    sensitivity: clamp(Number(t.sensitivity) || 0.5, 0.05, 1),
    hookStrength: clamp(Number(t.hookStrength) || 0.5, 0.05, 1),
  };
}

export function createFight({ fish, tackle, rng, distM }) {
  const random = typeof rng === 'function' ? rng : Math.random;
  const t = resolveTackle(tackle);
  const kg = clamp(Number(fish?.kg) || 0.5, 0.02, 200);
  const fightPower = clamp(Number(fish?.fightPower) || 0.4, 0, 1);
  const stamina = clamp(Number(fish?.stamina) || 0.4, 0, 1);
  const aggro = clamp(Number(fish?.aggro) || 0.4, 0, 1);

  // Стартовая дистанция: рыба там, где стоял поплавок. Если заброс не передан
  // (например, в тестах), берём разумную случайную.
  const castDist = Number(distM);
  const startDist = Number.isFinite(castDist) && castDist > 0
    ? clamp(castDist, MIN_DIST + 1, MAX_DIST - 5)
    : clamp(MIN_DIST + 8 + random() * 18, MIN_DIST + 1, MAX_DIST - 5);

  // Прочность лески в «единицах рыбы»: во сколько раз рыба тяжелее теста — решает исход.
  const loadRatio = t.lineTestKg / Math.max(0.05, kg);

  // Скорость подмотки. Мелкую рыбу просто протаскивают по воде: чем сильнее
  // снасть превосходит рыбу, тем быстрее она идёт к берегу. Трофей, наоборот,
  // приходится выкачивать помедленнее и с подъёмом удилища.
  const overpower = clamp(loadRatio, 0.45, 3.2);
  const lightFish = kg <= 0.25 ? 1.45 : 1;
  const reelRate = (0.9 + t.reelSpeed * 0.9 + t.rodPower * 0.5) * overpower * lightFish;

  return {
    status: 'fighting',
    distM: startDist,
    tension: 0.35,
    fishStamina: 1,
    fishPower: fightPower,
    fishKg: kg,
    aggro,
    reelRate,
    loadRatio,
    drag: clamp(t.maxDragKg / Math.max(0.1, t.lineTestKg), 0.3, 2),
    hookHold: clamp(0.55 + t.hookStrength * 0.5, 0.4, 1.05),
    rodPower: t.rodPower,
    lineTestKg: t.lineTestKg,
    maxLoadKg: t.maxLoadKg,
    sensitivity: t.sensitivity,
    pulse: 0,
    pulseTimer: 0.8 + random() * 1.6,
    pulseCount: 0,
    slackTimer: 0,
    timeSec: 0,
    maxTension: 0,
    tackle: t,
    fish: { id: fish?.id ?? 'unknown', kg, fightPower, stamina },
  };
}

/** Рывок: сила зависит от бойкости рыбы, накопленной усталости и агрессии. */
function triggerPulse(f, random) {
  const fatigue = 1 - f.fishStamina * 0.65;
  const power = clamp(
    (0.28 + f.fishPower * 0.7 + f.aggro * 0.22) * fatigue * (0.75 + random() * 0.5),
    0.08,
    1.6,
  );
  f.pulse = Math.max(f.pulse, power);
  f.pulseCount += 1;
  // Усталая рыба реже и слабее дёргается.
  f.pulseTimer = clamp(0.7 + random() * 2.1, 0.55, 3) * (0.5 + f.fishStamina * 0.8);
}

export function stepFight(fightState, input, dtSec) {
  const f = fightState;
  if (!f || f.status !== 'fighting') return f;

  const dt = clamp(Number(dtSec) || 0, 0, 0.12);
  const cmd = input || {};
  const reel = clamp(Number(cmd.reel) || 0, 0, 1);
  const rodUp = Boolean(cmd.rodUp);
  const pump = Boolean(cmd.pump);

  f.timeSec += dt;

  // --- рывки ---
  f.pulseTimer -= dt;
  if (f.pulseTimer <= 0) triggerPulse(f, Math.random);
  f.pulse = Math.max(0, f.pulse - dt * 1.35);

  // --- выносливость рыбы ---
  // Нагрузка на рыбу: натяжение + подъём удилища + подмотка.
  const loadOnFish = clamp(f.tension * (0.6 + reel * 0.7) + (rodUp ? 0.25 : 0), 0, 1.6);
  const staminaRate = (0.05 + f.fishPower * 0.1) * loadOnFish * (pump ? 1.35 : 1);
  f.fishStamina = clamp(f.fishStamina - dt * staminaRate, 0, 1);

  // Измождённая рыба почти не сопротивляется.
  const resist = (0.35 + f.fishStamina * 0.9) * (0.5 + f.fishPower * 0.85);

  // --- натяжение ---
  // Подмотка натягивает, рывок рвёт, усталость рыбы снижает сопротивление.
  const tensionDelta =
    reel * (0.62 + f.rodPower * 0.3) * (pump ? 1.15 : 1) -
    (1 - reel) * 0.5 -
    f.pulse * resist * 0.55 -
    (rodUp ? 0.34 : 0) * (0.6 + f.rodPower * 0.5);
  f.tension = clamp(f.tension + tensionDelta * dt, 0, 1.45);
  f.maxTension = Math.max(f.maxTension, f.tension);

  // --- дистанция ---
  const pullIn = reel * f.reelRate * dt * (rodUp ? 1.25 : 1) * (pump ? 1.2 : 1);
  const pullOut = f.pulse * (0.55 + f.fishPower * 1.15) * resist * dt * 3.4;
  const driftOut = f.fishStamina > 0.15 ? dt * 0.12 * f.fishPower : -dt * 0.5;
  f.distM = clamp(f.distM - pullIn + pullOut + driftOut, MIN_DIST - 1, MAX_DIST);

  // --- обрыв лески ---
  // Чем тоньше леска относительно рыбы, тем раньше она рвётся: 1.35 для лёгкой рыбы, 1.0 для трофея.
  const lineRatio = clamp(f.lineTestKg / Math.max(0.05, f.fishKg), 0, 8);
  const breakTension = clamp(1 + lineRatio * 0.05, 1.0, 1.35);
  if (f.tension >= breakTension) {
    f.status = 'broken';
    f.tension = 1.45;
    return f;
  }

  // --- сход: долгая слабина или рывок на слабом крючке ---
  if (f.tension < 0.12) f.slackTimer += dt;
  else f.slackTimer = Math.max(0, f.slackTimer - dt * 1.6);

  const slackLimit = BASE_SLACK_LIMIT / f.hookHold;
  if (f.slackTimer >= slackLimit) {
    f.status = 'escaped';
    return f;
  }

  // Сход при резком рывке, если крючок держит слабо.
  if (f.pulse > 0.9 && f.tension > 1.05 && Math.random() > f.hookHold) {
    f.status = 'escaped';
    return f;
  }

  // --- посадка ---
  if (f.distM <= LANDING_DIST && f.fishStamina < 0.92) {
    f.status = 'landed';
    f.distM = LANDING_DIST;
    return f;
  }

  return f;
}

/** Вспомогательное: 0..1 насколько близко к берегу (для UI-полосы). */
export function fightProgress(f) {
  if (!f) return 0;
  return clamp(1 - (f.distM - LANDING_DIST) / (MAX_DIST - LANDING_DIST), 0, 1);
}

export const FIGHT_CONSTANTS = { MIN_DIST, MAX_DIST, LANDING_DIST };
