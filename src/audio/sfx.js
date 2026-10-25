/**
 * sfx.js — короткие звуки на WebAudio: только синтез, ни файлов, ни сети.
 * Контракт docs/API.md §7: initAudio({bus}) -> {unlock, setVolume, sfx, destroy}; playSfx(name, opts).
 * Примитивы синтеза — здесь, композиция конкретных звуков — в recipes.js.
 */
import { buildRecipes } from './recipes.js';

const VOLUMES = { master: 0.85, sfx: 0.9, ambient: 0.6 };
const volumeListeners = new Set();
const curveCache = new Map();
const core = { ctx: null, master: null, sfxBus: null, noise: null, unlocked: false, offBus: null, gestureOff: null };

const clamp01 = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? (n < 0 ? 0 : n > 1 ? 1 : n) : fallback;
};

/* ---------- контекст и шины ---------- */

function ensureContext() {
  if (core.ctx) return core.ctx;
  const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (typeof Ctor !== 'function') return null;
  let ctx;
  try {
    ctx = new Ctor({ latencyHint: 'interactive' });
  } catch {
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
  }
  // Мягкий лимитер: залпы звуков не должны клипповать.
  const limiter = ctx.createDynamicsCompressor();
  for (const [k, v] of [['threshold', -14], ['knee', 20], ['ratio', 6], ['attack', 0.003], ['release', 0.25]]) limiter[k].value = v;
  const master = ctx.createGain();
  master.gain.value = VOLUMES.master;
  master.connect(limiter).connect(ctx.destination);
  const sfxBus = ctx.createGain();
  sfxBus.gain.value = VOLUMES.sfx;
  sfxBus.connect(master);
  Object.assign(core, { ctx, master, sfxBus, noise: null });
  return ctx;
}

function resumeQuietly(ctx) {
  if (!ctx || ctx.state !== 'suspended' || typeof ctx.resume !== 'function') return;
  try {
    const p = ctx.resume();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch {
    /* автоплей запрещён политикой браузера — ждём жеста */
  }
}

/** Контекст, готовый к планированию, либо null (до unlock() вызовы — no-op). */
function audioReady() {
  const ctx = core.ctx;
  if (!ctx || !core.unlocked || ctx.state === 'closed') return null;
  if (ctx.state === 'suspended') resumeQuietly(ctx);
  return ctx;
}

/* ---------- примитивы синтеза ---------- */

/** Общий зацикленный буфер шума: смесь белого и коричневого. */
function getNoise() {
  if (core.noise) return core.noise;
  const ctx = core.ctx;
  const length = Math.max(1024, Math.floor(ctx.sampleRate * 2));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let brown = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    brown = brown * 0.97 + white * 0.03;
    data[i] = Math.max(-1, Math.min(1, white * 0.7 + brown * 2.2));
  }
  core.noise = buffer;
  return buffer;
}

function noiseSource(t, dur, rate = 1) {
  const buffer = getNoise();
  const src = core.ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  src.playbackRate.value = rate;
  src.start(t, Math.random() * buffer.duration * 0.9);
  src.stop(t + dur + 0.06);
  return src;
}

function osc(type, from, to, dur, t, detune = 0) {
  const o = core.ctx.createOscillator();
  o.type = type;
  o.detune.value = detune;
  o.frequency.setValueAtTime(Math.max(1, from), t);
  if (to && to !== from) o.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
  o.start(t);
  o.stop(t + dur + 0.03);
  return o;
}

function biquad(type, freq, q, t, sweepTo = 0, dur = 0) {
  const f = core.ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(Math.max(20, freq), t);
  if (q) f.Q.value = q;
  if (sweepTo && dur > 0) f.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t + dur);
  return f;
}

/** Огибающая attack → (hold) → экспоненциальный спад. */
function envelope(t, peak, attack, decay, hold = 0) {
  const g = core.ctx.createGain();
  const p = Math.max(0.0002, peak);
  const a = Math.max(0.001, attack);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(p, t + a);
  if (hold > 0) g.gain.setValueAtTime(p, t + a + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + Math.max(0.01, decay));
  return g;
}

function link(...nodes) {
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
  return nodes[nodes.length - 1];
}

/** Кривая: 's' — квантование (грубый «подсэмпленный» удар), 'd' — мягкий драйв. */
function shapeCurve(kind, amount) {
  const key = `${kind}${amount}`;
  if (curveCache.has(key)) return curveCache.get(key);
  const size = 1024;
  const curve = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const x = (i * 2) / (size - 1) - 1;
    curve[i] = kind === 's' ? Math.round(x * amount) / amount : ((1 + amount) * x) / (1 + amount * Math.abs(x));
  }
  curveCache.set(key, curve);
  return curve;
}

function waveShaper(curve) {
  const ws = core.ctx.createWaveShaper();
  ws.curve = curve;
  ws.oversample = '2x';
  return ws;
}

/** Шумовой всплеск: источник → фильтр (с развёрткой) → огибающая → шина sfx. */
function burst(t, o) {
  const dur = o.dur || 0.2;
  link(
    noiseSource(t, dur, o.rate || 1),
    biquad(o.filter || 'bandpass', o.freq || 1000, o.q || 1, t, o.to || 0, o.sweep || 0),
    envelope(t, o.peak || 0.2, o.attack || 0.004, o.decay || dur, o.hold || 0),
    core.sfxBus,
  );
}

/** Тональный элемент; steps/drive включают WaveShaper. */
function tone(t, o) {
  const dur = o.dur || 0.2;
  const from = o.from || 440;
  let node = osc(o.type || 'sine', from, o.to || from, dur, t, o.detune || 0);
  if (o.steps) node = link(node, waveShaper(shapeCurve('s', o.steps)));
  else if (o.drive) node = link(node, waveShaper(shapeCurve('d', o.drive)));
  link(node, envelope(t, o.peak || 0.15, o.attack || 0.005, o.decay || dur, o.hold || 0), core.sfxBus);
}

/** Арпеджио: ноты треугольником плюс тихий октавный блеск. */
function arpeggio(t, notes, gap, peak, tail) {
  notes.forEach((freq, i) => {
    const tt = t + i * gap;
    const last = i === notes.length - 1;
    const dur = last ? tail : gap * 1.8;
    tone(tt, { type: 'triangle', from: freq, dur, peak, attack: 0.01, hold: last ? 0.05 : 0 });
    tone(tt, { from: freq * 2, dur: dur * 0.8, peak: peak * 0.33, attack: 0.008, decay: dur * 0.8, detune: 4 });
  });
}

const SOUNDS = buildRecipes({ burst, tone, arpeggio });

/** Имена всех доступных звуков (для настроек и автопроверок). */
export const SFX_NAMES = Object.keys(SOUNDS);

/* ---------- публичный API ---------- */

/**
 * Проиграть звук по имени. До unlock() или без WebAudio — тихий no-op.
 * @returns {boolean} удалось ли запланировать синтез
 */
export function playSfx(name, opts) {
  const ctx = audioReady();
  if (!ctx) return false;
  const build = SOUNDS[name];
  if (typeof build !== 'function') {
    if (globalThis.RTF4_DEBUG) console.warn('[sfx] неизвестный звук:', name);
    return false;
  }
  try {
    build(ctx.currentTime + 0.005, opts && typeof opts === 'object' ? opts : {});
    return true;
  } catch (err) {
    if (globalThis.RTF4_DEBUG) console.warn('[sfx] не удалось синтезировать', name, err);
    return false;
  }
}

function unlock() {
  const ctx = ensureContext();
  if (!ctx) return false;
  core.unlocked = true;
  resumeQuietly(ctx);
  // Пустой буфер «разогревает» аудиовыход на мобильных браузерах.
  try {
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    src.connect(ctx.destination);
    src.start(0);
  } catch {
    /* примирование не критично */
  }
  return true;
}

function applyVolumes() {
  const ctx = core.ctx;
  if (ctx) {
    const now = ctx.currentTime;
    if (core.master) core.master.gain.setTargetAtTime(VOLUMES.master, now, 0.04);
    if (core.sfxBus) core.sfxBus.gain.setTargetAtTime(VOLUMES.sfx, now, 0.04);
  }
  for (const fn of Array.from(volumeListeners)) {
    try {
      fn({ ...VOLUMES });
    } catch {
      /* подписчик не должен ломать звук */
    }
  }
  return { ...VOLUMES };
}

/** master/sfx/ambient: 0..1; undefined или null — соответствующую шину не менять. */
function setVolume(master, sfx, ambient) {
  if (master !== undefined && master !== null) VOLUMES.master = clamp01(master, VOLUMES.master);
  if (sfx !== undefined && sfx !== null) VOLUMES.sfx = clamp01(sfx, VOLUMES.sfx);
  if (ambient !== undefined && ambient !== null) VOLUMES.ambient = clamp01(ambient, VOLUMES.ambient);
  return applyVolumes();
}

/** Снять подписки и закрыть контекст. */
function destroy() {
  if (core.offBus) core.offBus();
  if (core.gestureOff) core.gestureOff();
  const ctx = core.ctx;
  Object.assign(core, { ctx: null, master: null, sfxBus: null, noise: null, unlocked: false, offBus: null, gestureOff: null });
  if (!ctx) return;
  try {
    const p = ctx.close();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch {
    /* контекст мог быть уже закрыт браузером */
  }
}

/** Разблокировка по первому жесту: страховка, если капитан не позовёт unlock(). */
function attachGestureUnlock() {
  if (core.gestureOff || typeof document === 'undefined') return;
  const detach = () => {
    document.removeEventListener('pointerdown', onGesture, true);
    document.removeEventListener('keydown', onGesture, true);
    core.gestureOff = null;
  };
  const onGesture = () => {
    unlock();
    detach();
  };
  document.addEventListener('pointerdown', onGesture, { capture: true, passive: true });
  document.addEventListener('keydown', onGesture, { capture: true });
  core.gestureOff = detach;
}

/**
 * Инициализация аудио. Контекст создаётся лениво — на первом жесте (unlock).
 * @param {{bus?: {on:Function}}} params
 */
export function initAudio({ bus } = {}) {
  if (core.offBus) {
    core.offBus();
    core.offBus = null;
  }
  if (bus && typeof bus.on === 'function') {
    core.offBus = bus.on('sfx', (payload) => {
      const name = typeof payload === 'string' ? payload : payload && payload.name;
      if (name) playSfx(name, payload && typeof payload === 'object' ? payload : {});
    });
  }
  attachGestureUnlock();
  return {
    unlock,
    setVolume,
    sfx: playSfx,
    destroy,
    get context() {
      return core.ctx;
    },
    get unlocked() {
      return core.unlocked;
    },
  };
}

/** Текущий AudioContext (null до unlock) — можно передать в createAmbience(). */
export function getAudioContext() {
  return core.ctx;
}

/** Итоговая громкость окружения: master × ambient. */
export function getAmbientVolume() {
  return VOLUMES.master * VOLUMES.ambient;
}

/** Подписка на изменение громкостей; возвращает функцию отписки. */
export function onVolumeChange(fn) {
  if (typeof fn !== 'function') return () => {};
  volumeListeners.add(fn);
  return () => volumeListeners.delete(fn);
}
