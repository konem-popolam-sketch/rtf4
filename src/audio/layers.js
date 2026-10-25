/**
 * layers.js — строительные блоки атмосферы: шумовые буферы, слои ветра/дождя/воды,
 * точечные всплески и птицы. Всё синтез, без файлов. Обслуживает ambience.js.
 */

/** Настройки атмосферы по водоёму: сила ветра, воды, птиц и всплесков. */
export const SCENES = {
  volga: { wind: 0.5, water: 0.55, birds: 0.9, wave: 1.0 },
  seliger: { wind: 0.38, water: 0.62, birds: 1.0, wave: 0.9 },
  prud_dachny: { wind: 0.22, water: 0.42, birds: 1.1, wave: 0.7 },
  azov: { wind: 0.78, water: 0.8, birds: 0.7, wave: 1.4 },
};

export const DEFAULT_SCENE = { wind: 0.4, water: 0.5, birds: 0.9, wave: 1.0 };

/**
 * AudioContext из аргумента: сам контекст, объект с .context, фабрика-функция
 * или null (до unlock контекста ещё нет). Никогда не бросает.
 */
export function resolveContext(input) {
  if (!input) return null;
  try {
    if (typeof input === 'function') return resolveContext(input());
    if (typeof input.createGain === 'function' && typeof input.createBuffer === 'function') {
      return input.state === 'closed' ? null : input;
    }
    if (input.context) return resolveContext(input.context);
  } catch {
    return null;
  }
  return null;
}

/** Зацикленный шумовой буфер: смесь белого и коричневого, края сшиты. */
export function makeNoise(ctx, seconds, brownMix = 0.5) {
  const length = Math.max(2048, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let brown = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    brown = brown * 0.98 + white * 0.02;
    data[i] = white * (1 - brownMix) + brown * brownMix * 4.5;
  }
  // Плавные края: петля не должна щёлкать.
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

function lfo(ctx, freq, depth) {
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.value = freq;
  const gain = ctx.createGain();
  gain.gain.value = depth;
  o.connect(gain);
  o.start();
  return { osc: o, depth: gain };
}

/** Слой ветра: шум через lowpass с медленной модуляцией громкости и высоты. */
export function buildWind(ctx, out, noise) {
  const src = loopSource(ctx, noise);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 520;
  filter.Q.value = 0.9;
  const mod = ctx.createGain();
  mod.gain.value = 0.62;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  src.connect(filter).connect(mod).connect(gain).connect(out);
  const gust = lfo(ctx, 0.055, 0.34);
  gust.depth.connect(mod.gain);
  const drift = lfo(ctx, 0.017, 0.18);
  drift.depth.connect(filter.frequency);
  return { src, filter, gain, lfos: [gust.osc, drift.osc] };
}

/** Слой дождя: полосовой шум с подрезанным низом. */
export function buildRain(ctx, out, noise) {
  const src = loopSource(ctx, noise, 0.4);
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
  return { src, band, gain, lfos: [] };
}

/** Слой воды у берега: низкий гул с медленной «зыбью». */
export function buildWater(ctx, out, noise) {
  const src = loopSource(ctx, noise, 0.7);
  const low = ctx.createBiquadFilter();
  low.type = 'lowpass';
  low.frequency.value = 320;
  low.Q.value = 1.1;
  const swell = ctx.createGain();
  swell.gain.value = 0.5;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  src.connect(low).connect(swell).connect(gain).connect(out);
  const tide = lfo(ctx, 0.09, 0.3);
  tide.depth.connect(swell.gain);
  return { src, low, swell, gain, lfos: [tide.osc] };
}

/** Короткий всплеск у берега из общего шумового буфера. */
export function splashOnce(ctx, dest, peak, buffer) {
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

/** Короткий FM-писк птицы: 2–3 слога, носитель модулирован по частоте. */
export function chirp(ctx, dest, level) {
  const t = ctx.currentTime;
  const syllables = 2 + Math.floor(Math.random() * 2);
  const base = 2400 + Math.random() * 1800;
  const peak = 0.012 + 0.05 * Math.min(1, Math.max(0, Number(level) || 0.8));
  for (let i = 0; i < syllables; i++) {
    const at = t + i * (0.07 + Math.random() * 0.06);
    const dur = 0.05 + Math.random() * 0.07;
    const carrier = ctx.createOscillator();
    carrier.type = 'sine';
    carrier.frequency.setValueAtTime(base * (1 + i * 0.08), at);
    carrier.frequency.exponentialRampToValueAtTime(base * (0.55 + Math.random() * 0.3), at + dur);
    const modulator = ctx.createOscillator();
    modulator.type = 'sine';
    modulator.frequency.value = 55 + Math.random() * 90;
    const depth = ctx.createGain();
    depth.gain.value = 180 + Math.random() * 420;
    modulator.connect(depth).connect(carrier.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    carrier.connect(g).connect(dest);
    carrier.start(at);
    carrier.stop(at + dur + 0.02);
    modulator.start(at);
    modulator.stop(at + dur + 0.02);
  }
}

/** Плавно изменить громкость узла (fade в секундах). */
export function rampGain(ctx, node, value, fade) {
  if (!node || !ctx) return;
  const now = ctx.currentTime;
  const param = node.gain;
  param.cancelScheduledValues(now);
  param.setTargetAtTime(Math.max(0.0001, value), now, Math.max(0.05, fade / 3));
}
