/**
 * game.js — единый стор игры. Владелец: капитан.
 * Только здесь живёт объект state и его сохранение; менять состояние можно
 * исключительно через src/state/actions.js. Читать — можно откуда угодно.
 */
import { bus } from '../core/bus.js';
import { QUESTS } from '../data/quests.js';

const SAVE_KEY = 'save.v1';
const MAX_LOG = 200;
const MAX_FISH = 120;
const AUTOSAVE_MS = 400;

/** Порог опыта для перехода с уровня `level` на следующий. */
export function xpNext(level) {
  return Math.round(120 * Math.pow(Math.max(1, Math.floor(Number(level) || 1)), 1.25));
}

function defaultState() {
  return {
    version: 1,
    player: {
      name: 'Рыбак',
      level: 1,
      xp: 0,
      money: 450,
      energy: 100,
      satiety: 100,
      skillPoints: 0,
      skills: { casting: 0, reeling: 0, tackle: 0, luring: 0 },
    },
    world: {
      waterId: 'prud_dachny',
      spotId: 'prud_karas',
      day: 1,
      minutes: 6 * 60,
      season: 'autumn',
      weather: { tempC: 9, windMs: 3, windDir: 220, precip: 'none', pressure: 1014, cloud: 0.35 },
    },
    tackle: {
      rodId: 'rod_float_1',
      reelId: 'reel_1',
      lineId: 'line_1',
      hookId: 'hook_m',
      floatId: 'float_s',
      sinkerId: 'sinker_s',
      feederId: null,
      rig: 'float',
      baitId: 'cherv',
      lureId: null,
      extra: { groundbait: false },
    },
    inventory: {
      baits: { cherv: 25, oparysh: 15, motyl: 10, kukuruza: 10, testo: 8 },
      lures: [],
      fish: [],
      items: {},
      tackleOwned: ['rod_float_1', 'reel_1', 'line_1', 'hook_m', 'hook_s', 'float_s', 'sinker_s'],
    },
    stats: {
      casts: 0,
      bites: 0,
      catches: 0,
      escapes: 0,
      biggestKg: 0,
      totalKg: 0,
      sessionStart: Date.now(),
      playMinutes: 0,
      earnedMoney: 0,
      caughtByFish: {},
    },
    settings: {
      volume: { master: 0.8, sfx: 0.9, ambient: 0.6 },
      timeScale: 1,
    },
    quests: {
      progress: {},
      activeIds: QUESTS.map((q) => q.id),
      claimedIds: [],
      doneIds: [],
    },
    log: [],
    ui: { panel: null, casting: false, fighting: false, paused: false },
  };
}

function isPlainObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

/** Рекурсивно дополняет сейв недостающими полями из эталона. Массивы берутся из сейва целиком. */
function mergeDeep(base, saved) {
  if (Array.isArray(base)) return Array.isArray(saved) ? saved : base.slice();
  if (!isPlainObject(base)) {
    if (saved === undefined || saved === null) return base;
    if (typeof saved !== typeof base && typeof base === 'number') {
      const n = Number(saved);
      return Number.isFinite(n) ? n : base;
    }
    return typeof saved === typeof base ? saved : base;
  }
  const out = {};
  const keys = new Set([...Object.keys(base), ...(isPlainObject(saved) ? Object.keys(saved) : [])]);
  for (const key of keys) {
    if (!(key in base)) {
      out[key] = saved[key];
      continue;
    }
    out[key] = mergeDeep(base[key], isPlainObject(saved) ? saved[key] : undefined);
  }
  return out;
}

function clampState(s) {
  s.player.level = Math.max(1, Math.floor(Number(s.player.level) || 1));
  s.player.xp = Math.max(0, Number(s.player.xp) || 0);
  s.player.money = Math.max(0, Math.round(Number(s.player.money) || 0));
  s.player.energy = Math.min(100, Math.max(0, Number(s.player.energy) ?? 100));
  s.player.satiety = Math.min(100, Math.max(0, Number(s.player.satiety) ?? 100));
  s.world.minutes = ((Number(s.world.minutes) || 0) % 1440 + 1440) % 1440;
  s.world.day = Math.max(1, Math.floor(Number(s.world.day) || 1));
  s.settings.timeScale = Math.min(8, Math.max(1, Number(s.settings.timeScale) || 1));
  const v = s.settings.volume || {};
  s.settings.volume = {
    master: Math.min(1, Math.max(0, Number(v.master) ?? 0.8)),
    sfx: Math.min(1, Math.max(0, Number(v.sfx) ?? 0.9)),
    ambient: Math.min(1, Math.max(0, Number(v.ambient) ?? 0.6)),
  };
  if (!Array.isArray(s.log)) s.log = [];
  if (s.log.length > MAX_LOG) s.log = s.log.slice(-MAX_LOG);
  if (!Array.isArray(s.inventory.fish)) s.inventory.fish = [];
  if (s.inventory.fish.length > MAX_FISH) s.inventory.fish = s.inventory.fish.slice(-MAX_FISH);
  if (!Array.isArray(s.inventory.lures)) s.inventory.lures = [];
  if (!Array.isArray(s.inventory.tackleOwned) || s.inventory.tackleOwned.length === 0) {
    s.inventory.tackleOwned = defaultState().inventory.tackleOwned;
  }
  if (!isPlainObject(s.stats.caughtByFish)) s.stats.caughtByFish = {};
  if (!isPlainObject(s.quests.progress)) s.quests.progress = {};
  return s;
}

let current = null;
let storageRef = null;
let saveTimer = null;
let dirty = false;

/** Загружает сейв (или создаёт новый) и делает его текущим состоянием игры. */
export function initState(storage) {
  storageRef = storage;
  const saved = storage && typeof storage.get === 'function' ? storage.get(SAVE_KEY, null) : null;
  current = clampState(mergeDeep(defaultState(), isPlainObject(saved) ? saved : {}));
  current.stats.sessionStart = Date.now();
  current.ui = { panel: null, casting: false, fighting: false, paused: false };
  return current;
}

export function getState() {
  return current;
}

/** Помечает состояние изменённым: сохраняет (с задержкой) и рассылает событие. */
export function markChanged() {
  dirty = true;
  if (!saveTimer && typeof setTimeout === 'function') {
    saveTimer = setTimeout(() => {
      saveTimer = null;
      flushSave();
    }, AUTOSAVE_MS);
  }
  bus.emit('state:changed', current);
  return current;
}

export function saveState(state) {
  if (state) current = state;
  return flushSave();
}

export function flushSave() {
  if (!dirty || !current) return false;
  if (!storageRef || typeof storageRef.set !== 'function') return false;
  dirty = false;
  return storageRef.set(SAVE_KEY, current);
}

export function resetState() {
  if (storageRef && typeof storageRef.remove === 'function') storageRef.remove(SAVE_KEY);
  current = defaultState();
  dirty = true;
  flushSave();
  bus.emit('state:changed', current);
  return current;
}

export function subscribe(fn) {
  if (typeof fn !== 'function') return () => {};
  return bus.on('state:changed', (s) => fn(s || current));
}

export { defaultState };

if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('pagehide', () => flushSave());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSave();
  });
}
