/**
 * ambience.js — фоновые слои WebAudio: ветер, дождь, вода у берега, редкие птицы.
 * Всё синтезируется из шума и осцилляторов: ни файлов, ни внешних импульсов.
 * Контракт docs/API.md §7: createAmbience(audioCtx) -> { start, stop, setWind, setRain }.
 */
import { getAmbientVolume, onVolumeChange } from './sfx.js';

const FADE = 0.8; // секунды плавного перехода громкости слоёв

/** Настройки атмосферы по водоёму: сила ветра, воды, птиц и высота «гула». */
const SCENES = {
  volga: { wind: 0.5, water: 0.55, gurgleHz: 260, birds: 0.9, wave: 1.0 },
  seliger: { wind: 0.38, water: 0.62, gurgleHz: 210, birds: 1.0, wave: 0.9 },
  prud_dachny: { wind: 0.22, water: 0.42, gurgleHz: 300, birds: 1.1, wave: 0.7 },
  azov: { wind: 0.78, water: 0.8, gurgleHz: 150, birds: 0.7, wave: 1.4 },
};
const DEFAULT_SCENE = { wind: 0.4, water: 0.5, gurgleHz: 240, birds: 0.9, wave: 1.0 };

const clamp01 = (value, fallback) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return n < 0 ? 0 : n > 1 ? 1 : n;
};

/** Зацикленный шумовой буфер: смесь белого и коричневого шума. */
function makeNoise(ctx, seconds, brownMix = 0.5) {
  const length = Math.max(2048, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let brown = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    brown = brown * 0.98 + white * 0.02;
    data[i] = white * (1 - brownMix) + brown * brownMix * 4.5;
  }
  // Сшивка краёв, чтобы петля не щёлкала.
  const edge = Math.min(256, Math.floor(length / 16));
  for (let i = 0; i < edge; i++) {
    const k = i / edge;
    data[i] *= k;
    data[length - 1 - i] *= k;
  }
  return buffer;
}

function loopSource(ctx, buffer, offset = 0) {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  src.start(ctx.currentTime, offset % buffer.duration);
  return src;
}

/** Слой ветра: шум с полосовым фильтром и медленной LFO-модуляцией громкости. */
function buildWind(ctx, out, noiseA) {
  const src = loopSource(ctx, noiseA);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 520;
  filter.Q.value = 0.9;
  const mod = ctx.createGain();
  mod.gain.value = 0.62;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  src.connect(filter).connect(mod).connect(gain).connect(out);
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 0.055;
  const lfoDepth = ctx.createGain();
  lfoDepth.gain.value = 0.34;
  lfo.connect(lfoDepth).connect(mod.gain);
  lfo.start();
  const lfo2 = ctx.createOscillator();
  lfo2.type = 'sine';
  lfo2.frequency.value = 0.017;
  const lfo2Depth = ctx.createGain();
  lfo2Depth.gain.value = 0.18;
  lfo2.connect(lfo2Depth).connect(filter.frequency);
  lfo2.start();
  return { src, filter, gain, lfo, lfo2 };
}

/** Слой дождя: полосовой шум + едва заметный «шелест» сверху. */
function buildRain(ctx, out, noiseB) {
  const src = loopSource(ctx, noiseB, 0.4);
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 1700;
  band.Q.value = 0.6;
  const high = ctx.createBiquadFilter();
  high.type = 'highpass';
  high.frequency.value = 700;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  src.connect(band).connect(high).connect(gain).connect(out);
  return { src, band, gain };
}

/** Слой воды у берега: низкий гул + всплески (планируются отдельно). */
function buildWater(ctx, out, noiseA) {
  const src = loopSource(ctx, noiseA, 0.7);
  const low = ctx.createBiquadFilter();
  low.type = 'lowpass';
  low.frequency.value = 320;
  low.Q.value = 1.1;
  const swell = ctx.createGain();
  swell.gain.value = 0.5;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  src.connect(low).connect(swell).connect(gain).connect(out);
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 0.09;
  const depth = ctx.createGain();
  depth.gain.value = 0.3;
  lfo.connect(depth).connect(swell.gain);
  lfo.start();
  return { src, low, swell, gain, lfo };
}

/** Короткий всплеск у берега (буфер шума общий, чтобы не мусорить в памяти). */
function splashOnce(ctx, dest, peak, buffer) {
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = 0.85 + Math.random() * 0.4;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(900 + Math.random() * 900, t);
  filter.frequency.exponentialRampToValueAtTime(420, t + 0.25);
  filter.Q.value = 0.9;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.001, peak), t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  src.connect(filter).connect(g).connect(dest);
  src.start(t);
  src.stop(t + 0.34);
}

/** Короткий FM-писк птицы (2–3 слога). */
function chirp(ctx, dest, level) {
  const t = ctx.currentTime;
  const syllables = 2 + Math.floor(Math.random() * 2);
  const base = 2400 + Math.random() * 1800;
  for (let i = 0; i < syllables; i++) {
    const at = t + i * (0.07 + Math.random() * 0.06);
    const dur = 0.05 + Math.random() * 0.07;
    const carrier = ctx.createOscillator();
    carrier.type = 'sine';
    carrier.frequency.setValueAtTime(base * (1 + i * 0.08), at);
    carrier.frequency.exponentialRampToValueAtTime(base * (0.55 + Math.random() * 0.3), at + dur);
    const modOsc = ctx.createOscillator();
    modOsc.type = 'sine';
    modOsc.frequency.value = 55 + Math.random() * 90;
    const modDepth = ctx.createGain();
    modDepth.gain.value = 180 + Math.random() * 420;
    modOsc.connect(modDepth).connect(carrier.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(Math.max(0.001, peakOf(level)), at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    carrier.connect(g).connect(dest);
    carrier.start(at);
    carrier.stop(at + dur + 0.02);
    modOsc.start(at);
    modOsc.stop(at + dur + 0.02);
  }
}

function peakOf(level) {
  return 0.012 + 0.05 * clamp01(level, 0.8);
}

function resolveContext(input) {
  if (!input) return null;
  const ctx = typeof input === 'function' ? input() : input;
  if (!ctx) return null;
  const isCtx = typeof ctx.createGain === 'function' && typeof ctx.createBuffer === 'function';
  if (!isCtx || ctx.state === 'closed') return null;
  return ctx;
}

/**
 * Создать атмосферу. Аргумент — AudioContext (или функция, возвращающая его:
 * удобно передать `() => audio.context`, т.к. до unlock контекста ещё нет).
 */
export function createAmbience(audioCtx) {
  const state = {
    ctx: resolveContext(audioCtx),
    input: audioCtx,
    out: null,
    noiseA: null,
    noiseB: null,
    wind: null,
    rain: null,
    water: null,
    windLevel: 0.35,
    rainLevel: 0,
    targetWind: 0.35,
    targetRain: 0,
    scene: DEFAULT_SCENE,
    sceneId: null,
    started: false,
    isDay: true,
    timers: [],
    unsubVolume: null,
  };

  function ensureGraph() {
    if (state.out) return true;
    const ctx = resolveContext(state.ctx || state.input);
    if (!ctx) return false;
    state.ctx = ctx;
    const out = ctx.createGain();
    out.gain.value = getAmbientVolume();
    out.connect(ctx.destination);
    state.out = out;
    state.noiseA = makeNoise(ctx, 2.4, 0.62);
    state.noiseB = makeNoise(ctx, 1.9, 0.18);
    state.wind = buildWind(ctx, out, state.noiseA);
    state.rain = buildRain(ctx, out, state.noiseB);
    state.water = buildWater(ctx, out, state.noiseA);
    if (!state.unsubVolume) {
      state.unsubVolume = onVolumeChange(() => {
        if (!state.out) return;
        state.out.gain.setTargetAtTime(getAmbientVolume(), state.ctx.currentTime, 0.08);
      });
    }
    return true;
  }

  function ramp(node, value, fade = FADE) {
    if (!node || !state.ctx) return;
    const now = state.ctx.currentTime;
    const param = node.gain;
    param.cancelScheduledValues(now);
    param.setTargetAtTime(Math.max(0.0001, value), now, Math.max(0.05, fade / 3));
  }

  function applyLevels(fade = FADE) {
    const scene = state.scene;
    const wind = clamp01(state.windLevel, 0.35);
    const rain = clamp01(state.rainLevel, 0);
    ramp(state.wind && state.wind.gain, 0.34 * wind * (0.55 + scene.wind * 0.9), fade);
    ramp(state.rain && state.rain.gain, 0.3 * rain, fade * 0.8);
    ramp(state.water && state.water.gain, 0.3 * scene.water * (1 - rain * 0.35), fade);
    if (state.wind && state.ctx) {
      const target = 380 + wind * 620;
      state.wind.filter.frequency.setTargetAtTime(target, state.ctx.currentTime, Math.max(0.2, fade));
    }
    if (state.rain && state.ctx) {
      state.rain.band.frequency.setTargetAtTime(1500 + rain * 900, state.ctx.currentTime, 0.3);
    }
  }

  function clearTimers() {
    for (const id of state.timers) clearTimeout(id);
    state.timers.length = 0;
  }

  function later(fn, minMs, maxMs) {
    const delay = minMs + Math.random() * (maxMs - minMs);
    const id = setTimeout(() => {
      state.timers = state.timers.filter((x) => x !== id);
      if (state.started && state.ctx && state.ctx.state !== 'closed') fn();
    }, delay);
    state.timers.push(id);
    return id;
  }

  function scheduleSplashes() {
    if (!state.started || !state.water) return;
    splashOnce(state.ctx, state.water.gain, (0.05 + Math.random() * 0.08) * state.scene.wave, state.noiseB);
    later(scheduleSplashes, 2200, 6500);
  }

  function scheduleBirds() {
    if (!state.started || !state.out) return;
    if (state.isDay && Math.random() < state.scene.birds) {
      chirp(state.ctx, state.out, state.targetWind > 0.6 ? 0.5 : 0.9);
    }
    later(scheduleBirds, 4500, 13000);
  }

  function stopNodes(layers) {
    for (const layer of layers) {
      if (!layer) continue;
      for (const key of ['src', 'lfo', 'lfo2']) {
        const node = layer[key];
        if (!node) continue;
        try {
          node.stop();
        } catch {
          /* уже остановлен */
        }
      }
    }
  }

  function start(sceneId, opts) {
    state.sceneId = sceneId || state.sceneId;
    state.scene = SCENES[state.sceneId] || state.scene;
    if (opts && typeof opts === 'object' && opts.timeOfDay) state.isDay = opts.timeOfDay !== 'night';
    const ctx = resolveContext(state.ctx || state.input);
    if (!ctx) return false; // до unlock — тихо ждём; start() можно повторить
    if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
      try {
        const p = ctx.resume();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch {
        /* resume недоступен до жеста */
      }
    }
    if (!ensureGraph()) return false;
    if (!state.started) {
      state.started = true;
      scheduleSplashes();
      scheduleBirds();
    }
    state.windLevel = state.targetWind;
    state.rainLevel = state.targetRain;
    applyLevels(FADE);
    return true;
  }

  function stop() {
    state.started = false;
    clearTimers();
    if (!state.out) return;
    const layers = [state.wind, state.rain, state.water];
    const out = state.out;
    for (const layer of layers) if (layer) ramp(layer.gain, 0, 0.5);
    Object.assign(state, { out: null, wind: null, rain: null, water: null });
    // Даём громкости упасть, только потом глушим источники.
    // Таймер не входит в state.timers: уборка должна случиться даже при повторном stop().
    setTimeout(() => {
      stopNodes(layers);
      try {
        out.disconnect();
      } catch {
        /* уже отключён */
      }
    }, 600);
  }

  function setWind(value) {
    state.targetWind = clamp01(value, state.targetWind);
    state.windLevel = state.targetWind;
    applyLevels();
    return state.targetWind;
  }

  function setRain(value) {
    state.targetRain = clamp01(value, state.targetRain);
    state.rainLevel = state.targetRain;
    applyLevels();
    return state.targetRain;
  }

  function dispose() {
    stop();
    if (state.unsubVolume) {
      state.unsubVolume();
      state.unsubVolume = null;
    }
    state.ctx = null;
    state.input = null;
  }

  return {
    start,
    stop,
    setWind,
    setRain,
    /** Дополнительно: день/ночь влияет только на птиц. */
    setTimeOfDay(tod) {
      state.isDay = tod !== 'night';
      return state.isDay;
    },
    /** Дополнительно: смена настроек без перезапуска (например, погода). */
    setScene(sceneId) {
      if (sceneId) state.scene = SCENES[sceneId] || state.scene;
      if (state.started) applyLevels();
    },
    dispose,
  };
}
