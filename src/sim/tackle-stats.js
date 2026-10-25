/**
 * tackle-stats.js — агрегация снасти: state → плоский объект характеристик.
 * Чистая логика, без DOM и three.js. Единственное место, где данные src/data/tackle.js
 * встречаются с состоянием игрока. Результат едят fight.js (maxLoadKg, lineTestKg, reelSpeed,
 * maxDragKg, rodPower, sensitivity, hookStrength) и bite.js (sensitivity, bait, lure, depthWork).
 *
 * Принцип: наружу не выходит ни одного undefined/NaN — fight.js читает числа напрямую.
 * Если слот пуст или в сейве битый id, подставляется дефолт и ставится isFallback=true.
 */
import { clamp } from '../core/util.js';
import { RODS, REELS, LINES, HOOKS, FLOATS, SINKERS, FEEDERS, TACKLE_BY_ID } from '../data/tackle.js';
import { BAIT_BY_ID } from '../data/baits.js';
import { LURE_BY_ID, LURES } from '../data/lures.js';

/** Безопасное число: любые дыры в данных превращаются в конечное значение. */
function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Ищет снасть по id строго в своей категории: чужой id (катушка вместо лески) не подойдёт. */
function pick(list, id) {
  if (!id) return null;
  for (const item of list) if (item && item.id === id) return item;
  return null;
}

/** Дефолтный комплект под каждую оснастку — на случай пустого сейва или битого id. */
const RIG_DEFAULTS = {
  float: { rodId: 'rod_float_1', reelId: 'reel_1', lineId: 'line_1', hookId: 'hook_m', sinkerId: 'sinker_s' },
  spinning: { rodId: 'rod_spin_1', reelId: 'reel_1', lineId: 'line_1', hookId: 'hook_m', sinkerId: null },
  feeder: { rodId: 'rod_feeder_1', reelId: 'reel_1', lineId: 'line_1', hookId: 'hook_m', sinkerId: null },
  bottom: { rodId: 'rod_bottom_1', reelId: 'reel_1', lineId: 'line_1', hookId: 'hook_m', sinkerId: 'sinker_m' },
};

/**
 * Оснастка по факту надетых снастей:
 * есть приманка → спиннинг, есть кормушка → фидер, тяжёлое грузило без поплавка → донка,
 * во всех остальных случаях → поплавок.
 */
export function rigOf(state) {
  const t = state?.tackle || {};
  if (pick(LURES, t.lureId)) return 'spinning';
  if (pick(FEEDERS, t.feederId)) return 'feeder';
  const hasFloat = Boolean(pick(FLOATS, t.floatId));
  const sinker = pick(SINKERS, t.sinkerId);
  if (!hasFloat && sinker && num(sinker.weightG) >= 30) return 'bottom';
  return 'float';
}

/**
 * Обязательный слот (удилище/катушка/леска/крючок): при промахе подставляет дефолт
 * и поднимает флаг isFallback.
 */
function required(list, id, fallbackId, flags) {
  const found = pick(list, id);
  if (found) return found;
  flags.isFallback = true;
  return pick(list, fallbackId) || list[0];
}

const GRADE_WEIGHTS = [
  ['rodPower', 0.18],
  ['maxLoadKg', 0.22],
  ['lineTestKg', 0.22],
  ['reelSpeed', 0.14],
  ['hookStrength', 0.12],
  ['sensitivity', 0.12],
];

const GRADE_LABELS = [
  { upTo: 35, label: 'Новичок' },
  { upTo: 50, label: 'Любитель' },
  { upTo: 68, label: 'Опытный' },
  { upTo: 85, label: 'Мастер' },
  { upTo: Number.POSITIVE_INFINITY, label: 'Эксперт' },
];

/**
 * Необязательные слоты: поплавок, грузило, кормушка.
 * Спиннинг живёт без них, но если оснастка их предполагает, а они не надеты — это fallback.
 */
function optionalSlots(raw, rig, def, flags) {
  let floatItem = pick(FLOATS, raw.floatId);
  if (!floatItem && rig === 'float') {
    floatItem = pick(FLOATS, 'float_s');
    flags.isFallback = true;
  }
  let sinkerItem = pick(SINKERS, raw.sinkerId);
  if (!sinkerItem && def.sinkerId) {
    sinkerItem = pick(SINKERS, def.sinkerId);
    flags.isFallback = true;
  }
  const feederItem = pick(FEEDERS, raw.feederId);
  return { floatItem, sinkerItem, feederItem };
}

/** Наживка и приманка: объекты из справочников либо null (битый id тоже даёт null). */
function baitAndLure(raw, flags) {
  const bait = raw.baitId ? BAIT_BY_ID[raw.baitId] || null : null;
  const lure = raw.lureId ? LURE_BY_ID[raw.lureId] || null : null;
  // Ссылка на несуществующую наживку/приманку — тоже неполные данные.
  if (raw.baitId && !bait) flags.isFallback = true;
  if (raw.lureId && !lure) flags.isFallback = true;
  return { bait, lure };
}

/**
 * Превращает state в плоские характеристики снасти (см. контракт API.md §2.4 / задача t8).
 */
export function resolveTackle(state) {
  const raw = state?.tackle || {};
  const rig = rigOf(state);
  const def = RIG_DEFAULTS[rig] || RIG_DEFAULTS.float;
  const flags = { isFallback: false };

  const rod = required(RODS, raw.rodId, def.rodId, flags);
  const reel = required(REELS, raw.reelId, def.reelId, flags);
  const line = required(LINES, raw.lineId, def.lineId, flags);
  const hook = required(HOOKS, raw.hookId, def.hookId, flags);
  const { floatItem, sinkerItem, feederItem } = optionalSlots(raw, rig, def, flags);
  const { bait, lure } = baitAndLure(raw, flags);

  const rodSensitivity = clamp(num(rod.sensitivity, 0.5), 0.05, 1);
  // Чувствительность оснастки в сборе: удилище + поплавок, иначе только удилище.
  const sensitivity = floatItem
    ? (rodSensitivity + clamp(num(floatItem.sensitivity, 0.5), 0.05, 1)) / 2
    : rodSensitivity;

  const lineTestKg = Math.max(0.2, num(line.lineTestKg, 2.5));
  const maxDragKg = Math.max(0.25, num(reel.maxDragKg, 2));

  // Что реально в воде: на спиннинге — приманка, на остальных оснастках — наживка.
  const lureActive = Boolean(lure) && (rig === 'spinning' || !bait);
  const depthWork = (lureActive ? lure.depthWork : bait?.depthWork) || 'mid';

  return {
    rodId: rod.id,
    reelId: reel.id,
    lineId: line.id,
    hookId: hook.id,
    floatId: floatItem ? floatItem.id : null,
    sinkerId: sinkerItem ? sinkerItem.id : null,
    feederId: feederItem ? feederItem.id : null,
    rig,
    baitId: bait ? bait.id : null,
    lureId: lure ? lure.id : null,

    rodPower: clamp(num(rod.power, 0.4), 0.05, 1),
    maxLoadKg: Math.max(0.2, num(rod.maxLoadKg, 3)),
    castRangeM: Math.max(4, num(rod.castRangeM, 20)),
    sensitivity: clamp(sensitivity, 0.05, 1),
    reelSpeed: clamp(num(reel.reelSpeed, 0.5), 0.05, 1),
    maxDragKg,
    dragRatio: clamp(maxDragKg / lineTestKg, 0.2, 3),
    lineTestKg,
    lineDiameter: Math.max(0.05, num(line.diameterMm, 0.2)),
    invisibility: clamp(num(line.invisibility, 0.4), 0, 1),
    hookStrength: clamp(num(hook.strength, 0.5), 0.05, 1),
    hookSize: hook.size || 'm',
    sinkerWeightG: sinkerItem ? Math.max(0, num(sinkerItem.weightG, 0)) : 0,
    feederWeightG: feederItem ? Math.max(0, num(feederItem.weightG, 0)) : 0,
    bait,
    lure,
    depthWork,
    isFallback: flags.isFallback,
  };
}

/**
 * Оценка «уровня снасти» 0..100 для HUD и магазина:
 * взвешенная сумма нормализованных характеристик. Веса в сумме дают 1.
 */
export function tackleGrade(stats) {
  const s = stats || {};
  const norm = {
    rodPower: clamp(num(s.rodPower, 0.4), 0, 1),
    maxLoadKg: clamp(num(s.maxLoadKg, 3) / 15, 0, 1),
    lineTestKg: clamp(num(s.lineTestKg, 2.5) / 12, 0, 1),
    reelSpeed: clamp(num(s.reelSpeed, 0.5) / 0.9, 0, 1),
    hookStrength: clamp(num(s.hookStrength, 0.5), 0, 1),
    sensitivity: clamp(num(s.sensitivity, 0.5), 0, 1),
  };
  let score = 0;
  for (const [key, weight] of GRADE_WEIGHTS) score += norm[key] * weight;
  score = Math.round(clamp(score, 0, 1) * 100);
  const bucket = GRADE_LABELS.find((row) => score < row.upTo) || GRADE_LABELS[GRADE_LABELS.length - 1];
  return { score, label: bucket.label };
}

/** Есть ли такой id в данных снастей — для панели магазина и валидации покупок. */
export function hasTackle(id) {
  return Boolean(id && TACKLE_BY_ID[id]);
}
