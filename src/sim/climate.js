/**
 * climate.js — время суток, погода и сезоны. Чистая логика.
 * Погода — марковская цепь по пресетам из src/data/weather.js.
 * Смена сезона — каждые 7 игровых дней.
 */
import { clamp } from '../core/util.js';
import { mulberry32, hashSeed } from '../core/rng.js';
import { WEATHER_PRESETS, SEASON_PROFILE, TIME_OF_DAY_BOUNDS } from '../data/weather.js';

export const SEASON_ORDER = ['spring', 'summer', 'autumn', 'winter'];
export const SEASON_NAMES = { spring: 'Весна', summer: 'Лето', autumn: 'Осень', winter: 'Зима' };
export const DAYS_PER_SEASON = 7;

/** Игровые минуты → фаза суток. Границы — из данных. */
export function timeOfDayOf(minutes) {
  const m = ((Number(minutes) || 0) % 1440 + 1440) % 1440;
  const b = TIME_OF_DAY_BOUNDS || {};
  const dawn = Array.isArray(b.dawn) ? b.dawn : [240, 480];
  const day = Array.isArray(b.day) ? b.day : [480, 1080];
  const dusk = Array.isArray(b.dusk) ? b.dusk : [1080, 1320];
  if (m >= dawn[0] && m < dawn[1]) return 'dawn';
  if (m >= day[0] && m < day[1]) return 'day';
  if (m >= dusk[0] && m < dusk[1]) return 'dusk';
  return 'night';
}

export function seasonOfDay(day, startSeason = 'autumn') {
  const idx = Math.max(0, SEASON_ORDER.indexOf(startSeason));
  const seasonsPassed = Math.floor(Math.max(0, (Number(day) || 1) - 1) / DAYS_PER_SEASON);
  const shifted = idx + seasonsPassed;
  return SEASON_ORDER[((shifted % 4) + 4) % 4];
}

function presetsByWeight(random) {
  const list = Array.isArray(WEATHER_PRESETS) ? WEATHER_PRESETS : [];
  const usable = list.filter((p) => p && Number(p.weight) > 0);
  if (usable.length === 0) return null;
  let total = 0;
  for (const p of usable) total += Number(p.weight);
  let roll = random() * total;
  for (const p of usable) {
    roll -= Number(p.weight);
    if (roll <= 0) return p;
  }
  return usable[usable.length - 1];
}

function lerpRange(range, t, fallback) {
  if (!Array.isArray(range) || range.length < 2) return fallback;
  const [a, b] = range;
  return a + (b - a) * clamp(t, 0, 1);
}

/** Начальная погода по сезону и случайности. */
function makeWeather(season, random) {
  const preset = presetsByWeight(random) || {
    id: 'clear',
    name: 'Ясно',
    precip: 'none',
    cloud: [0, 0.3],
    windMs: [0, 4],
    pressure: [1015, 1025],
  };
  const profile = (SEASON_PROFILE || {})[season] || { tempBase: 10, tempAmp: 8 };
  const t = random();
  const cloudMin = Array.isArray(preset.cloud) ? preset.cloud[0] : 0.4;
  const cloudMax = Array.isArray(preset.cloud) ? preset.cloud[1] : 0.6;
  return {
    id: preset.id,
    name: preset.name || preset.id,
    precip: preset.precip || 'none',
    cloud: cloudMin + (cloudMax - cloudMin) * t,
    windMs: lerpRange(preset.windMs, random(), 3),
    windDir: Math.round(random() * 360),
    pressure: lerpRange(preset.pressure, random(), 1013),
    tempC: (Number(profile.tempBase) || 10) + (random() - 0.5) * (Number(profile.tempAmp) || 8),
  };
}

export function createClimate({ seed = 'climate', startMinutes = 360, startDay = 1, season = 'autumn', weather = null } = {}) {
  const rng = mulberry32(hashSeed(String(seed)));
  const random = () => rng();
  // Сохранённую погоду принимаем как есть: иначе после F5 игрок видит не то небо,
  // под которым рыбачил, и сейв врёт про условия ловли.
  const weatherIn = sanitizeWeather(weather);
  const initial = weatherIn || makeWeather(season, random);
  return {
    rng,
    minutes: clamp(Number(startMinutes) || 0, 0, 1439),
    day: Math.max(1, Math.floor(Number(startDay) || 1)),
    season,
    // Сезон первого дня — точка отсчёта. Без неё seasonOfDay(c.day, c.season)
    // считал бы пройденные сезоны от уже сдвинутого сезона и прокручивал круг каждый шаг.
    baseSeason: season,
    weather: initial,
    changeTimer: 120 + random() * 300, // игровые минуты до пересмотра погоды
    pressureHistory: [initial.pressure],
    weatherChanged: false,
    lastTimeOfDay: timeOfDayOf(startMinutes),
  };
}

/**
 * Привести сохранённую погоду к рабочему виду. Битые/чужие поля заменяются
 * разумными значениями, чтобы климат никогда не стартовал с NaN.
 */
function sanitizeWeather(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const num = (v, fallback, min, max) => {
    // null/'' приводить к числу нельзя: Number(null) === 0 и «нет ветра» молча
    // превратится в «ветер 0°». Пустое значение — это именно отсутствие значения.
    if (v === null || v === undefined || v === '') return fallback;
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return clamp(n, min, max);
  };
  const precip = ['none', 'rain', 'storm', 'snow'].includes(raw.precip) ? raw.precip : 'none';
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : 'clear',
    name: typeof raw.name === 'string' && raw.name ? raw.name : 'Ясно',
    precip,
    cloud: num(raw.cloud, 0.4, 0, 1),
    windMs: num(raw.windMs, 3, 0, 40),
    windDir: num(raw.windDir, 220, 0, 360),
    pressure: num(raw.pressure, 1013, 950, 1080),
    tempC: num(raw.tempC, 12, -50, 55),
  };
}

/** Плавное смещение текущей погоды к пресету. */
function blendWeather(current, next, strength) {
  const k = clamp(strength, 0, 1);
  return {
    id: next.id,
    name: next.name || next.id,
    precip: next.precip || 'none',
    cloud: current.cloud + (clamp(next.cloud, 0, 1) - current.cloud) * k,
    windMs: current.windMs + (next.windMs - current.windMs) * k,
    windDir: current.windDir,
    pressure: current.pressure + (next.pressure - current.pressure) * k,
    tempC: current.tempC + (next.tempC - current.tempC) * k,
  };
}

function weatherTarget(season) {
  const profile = (SEASON_PROFILE || {})[season] || { tempBase: 10, tempAmp: 8 };
  const preset = presetsByWeight(Math.random);
  if (!preset) return null;
  return {
    id: preset.id,
    name: preset.name || preset.id,
    precip: preset.precip || 'none',
    cloud: Array.isArray(preset.cloud) ? preset.cloud[0] + Math.random() * (preset.cloud[1] - preset.cloud[0]) : 0.5,
    windMs: lerpRange(preset.windMs, Math.random(), 3),
    pressure: lerpRange(preset.pressure, Math.random(), 1013),
    tempC: (Number(profile.tempBase) || 10) + (Math.random() - 0.5) * (Number(profile.tempAmp) || 8),
  };
}

/**
 * Шаг климата. timeScale — сколько игровых минут за реальную секунду (1 = как в РР4).
 * Возвращает новый объект климата и флаг, сменилось ли что-то значимое.
 */
export function stepClimate(climate, dtSec, timeScale = 1) {
  const c = climate;
  if (!c) return { climate: c, minutes: 0, day: 1, season: 'autumn', weather: null, changed: false };

  const speed = clamp(Number(timeScale) || 1, 0, 240);
  const addMinutes = clamp(Number(dtSec) || 0, 0, 0.25) * speed;
  let changed = false;

  // Плавное изменение погоды к цели.
  const target = weatherTarget(c.season);
  if (target) {
    const strength = 1 - Math.exp(-addMinutes / 240);
    c.weather = blendWeather(c.weather, target, strength);
    c.pressureHistory.push(c.weather.pressure);
    if (c.pressureHistory.length > 90) c.pressureHistory.shift();
  }

  c.changeTimer -= addMinutes;
  c.minutes += addMinutes;
  while (c.minutes >= 1440) {
    c.minutes -= 1440;
    c.day += 1;
    changed = true;
  }

  const newSeason = seasonOfDay(c.day, c.baseSeason || c.season);
  if (newSeason !== c.season) {
    c.season = newSeason;
    changed = true;
  }

  // Редкая резкая смена погоды (гроза налетела).
  if (c.changeTimer <= 0) {
    c.changeTimer = 180 + Math.random() * 420;
    const preset = presetsByWeight(Math.random);
    if (preset && preset.id !== c.weather.id) {
      c.weather = {
        ...c.weather,
        id: preset.id,
        name: preset.name || preset.id,
        precip: preset.precip || 'none',
      };
      changed = true;
    }
  }

  const tod = timeOfDayOf(c.minutes);
  if (tod !== c.lastTimeOfDay) {
    c.lastTimeOfDay = tod;
    changed = true;
  }

  c.weatherChanged = changed;
  return {
    climate: c,
    minutes: c.minutes,
    day: c.day,
    season: c.season,
    weather: c.weather,
    changed,
  };
}

/** Перепад давления за последние ~час игрового времени — влияет на клёв. */
export function pressureDelta(climate) {
  const h = climate?.pressureHistory;
  if (!Array.isArray(h) || h.length < 2) return 0;
  return h[h.length - 1] - h[0];
}
