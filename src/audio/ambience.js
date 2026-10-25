/**
 * ambience.js — фоновые слои WebAudio: ветер, дождь, вода у берега, редкие птицы.
 * Всё синтезируется из шума и осцилляторов: ни файлов, ни внешних импульсов.
 * Контракт docs/API.md §7: createAmbience(audioCtx) -> { start, stop, setWind, setRain }.
 * Строительные блоки слоёв — в layers.js.
 */
import { getAmbientVolume, onVolumeChange, getAudioContext } from './sfx.js';
import { SCENES, DEFAULT_SCENE, resolveContext, makeNoise, buildWind, buildRain, buildWater, splashOnce, chirp, rampGain } from './layers.js';

const FADE = 0.8; // секунды плавного перехода громкости слоёв

const clamp01 = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? (n < 0 ? 0 : n > 1 ? 1 : n) : fallback;
};

/** Плавно применить уровни ветра/дождя/воды к слоям. */
function applyLevels(st, fade = FADE) {
  const wind = clamp01(st.windLevel, 0.35);
  const rain = clamp01(st.rainLevel, 0);
  rampGain(st.ctx, st.wind && st.wind.gain, 0.34 * wind * (0.55 + st.scene.wind * 0.9), fade);
  rampGain(st.ctx, st.rain && st.rain.gain, 0.3 * rain, fade * 0.8);
  rampGain(st.ctx, st.water && st.water.gain, 0.3 * st.scene.water * (1 - rain * 0.35), fade);
  if (!st.ctx) return;
  if (st.wind) st.wind.filter.frequency.setTargetAtTime(380 + wind * 620, st.ctx.currentTime, Math.max(0.2, fade));
  if (st.rain) st.rain.band.frequency.setTargetAtTime(1500 + rain * 900, st.ctx.currentTime, 0.3);
}

/** Сборка графа слоёв на первом доступном контексте. */
function buildGraph(st) {
  if (st.out) return true;
  const ctx = resolveContext(st.ctx || st.input);
  if (!ctx) return false;
  st.ctx = ctx;
  const out = ctx.createGain();
  out.gain.value = getAmbientVolume();
  out.connect(ctx.destination);
  st.out = out;
  st.noise = makeNoise(ctx, 2.4, 0.62);
  const rainNoise = makeNoise(ctx, 1.9, 0.18);
  st.wind = buildWind(ctx, out, st.noise);
  st.rain = buildRain(ctx, out, rainNoise);
  st.water = buildWater(ctx, out, st.noise);
  if (!st.unsubVolume) {
    st.unsubVolume = onVolumeChange(() => {
      if (!st.out) return;
      st.out.gain.setTargetAtTime(getAmbientVolume(), st.ctx.currentTime, 0.08);
    });
  }
  return true;
}

function stopLayer(layer) {
  if (!layer) return;
  for (const node of [layer.src, ...(layer.lfos || [])]) {
    if (!node) continue;
    try {
      node.stop();
    } catch {
      /* уже остановлен */
    }
  }
}

/** Отложенное событие атмосферы; само снимается из списка после запуска. */
function later(st, fn, minMs, maxMs) {
  const id = setTimeout(() => {
    st.timers = st.timers.filter((x) => x !== id);
    if (st.started && st.ctx && st.ctx.state !== 'closed') fn();
  }, minMs + Math.random() * (maxMs - minMs));
  st.timers.push(id);
  return id;
}

function clearTimers(st) {
  for (const id of st.timers) clearTimeout(id);
  st.timers.length = 0;
}

function scheduleSplashes(st) {
  if (!st.started || !st.water) return;
  splashOnce(st.ctx, st.water.gain, (0.05 + Math.random() * 0.08) * st.scene.wave, st.noise);
  later(st, () => scheduleSplashes(st), 2200, 6500);
}

function scheduleBirds(st) {
  if (!st.started || !st.out) return;
  if (st.isDay && Math.random() < st.scene.birds) chirp(st.ctx, st.out, st.windLevel > 0.6 ? 0.5 : 0.9);
  later(st, () => scheduleBirds(st), 4500, 13000);
}

/** Старт атмосферы для водоёма; до unlock() вернёт false — можно повторить. */
function start(st, sceneId, opts) {
  st.sceneId = sceneId || st.sceneId;
  st.scene = SCENES[st.sceneId] || st.scene;
  if (opts && typeof opts === 'object' && opts.timeOfDay) st.isDay = opts.timeOfDay !== 'night';
  const ctx = resolveContext(st.ctx || st.input);
  if (!ctx) return false;
  if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
    try {
      const p = ctx.resume();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      /* resume недоступен до жеста */
    }
  }
  if (!buildGraph(st)) return false;
  if (!st.started) {
    st.started = true;
    scheduleSplashes(st);
    scheduleBirds(st);
  }
  applyLevels(st, FADE);
  return true;
}

/** Плавное затухание и остановка слоёв атмосферы. */
function stop(st) {
  st.started = false;
  clearTimers(st);
  if (!st.out) return;
  const layers = [st.wind, st.rain, st.water];
  const out = st.out;
  for (const layer of layers) if (layer) rampGain(st.ctx, layer.gain, 0, 0.5);
  Object.assign(st, { out: null, wind: null, rain: null, water: null });
  // Даём громкости упасть, только потом глушим источники.
  setTimeout(() => {
    for (const layer of layers) stopLayer(layer);
    try {
      out.disconnect();
    } catch {
      /* уже отключён */
    }
  }, 600);
}

/**
 * Создать атмосферу. Аргумент — AudioContext или функция, возвращающая его
 * (до unlock контекста ещё нет: удобно передать `() => audio.context`).
 * Если контекст не передан, берётся общий контекст из sfx.js — тогда start()
 * сработает сразу после unlock, даже если фабрику создали раньше.
 */
export function createAmbience(audioCtx) {
  const st = {
    ctx: resolveContext(audioCtx),
    // Без аргумента берём общий контекст из sfx.js (лениво, на момент start),
    // явный null означает «звука нет» — тогда все методы тихие no-op.
    input: audioCtx === undefined ? getAudioContext : audioCtx,
    out: null,
    noise: null,
    wind: null,
    rain: null,
    water: null,
    windLevel: 0.35,
    rainLevel: 0,
    scene: DEFAULT_SCENE,
    sceneId: null,
    started: false,
    isDay: true,
    timers: [],
    unsubVolume: null,
  };

  return {
    start: (sceneId, opts) => start(st, sceneId, opts),
    stop: () => stop(st),
    setWind(value) {
      st.windLevel = clamp01(value, st.windLevel);
      applyLevels(st);
      return st.windLevel;
    },
    setRain(value) {
      st.rainLevel = clamp01(value, st.rainLevel);
      applyLevels(st);
      return st.rainLevel;
    },
    /** День/ночь влияет только на птиц. */
    setTimeOfDay(tod) {
      st.isDay = tod !== 'night';
      return st.isDay;
    },
    /** Смена настроек водоёма без перезапуска. */
    setScene(sceneId) {
      if (sceneId) st.scene = SCENES[sceneId] || st.scene;
      if (st.started) applyLevels(st);
    },
    dispose() {
      stop(st);
      if (st.unsubVolume) st.unsubVolume();
      st.unsubVolume = null;
      st.ctx = null;
      st.input = null;
    },
  };
}
