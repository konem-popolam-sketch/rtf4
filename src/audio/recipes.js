/**
 * recipes.js — «рецепты» звуков: только композиция примитивов WebAudio.
 * Примитивы (шум, осциллятор, фильтр, огибающая) живут в sfx.js и передаются в buildRecipes().
 */

// Примитивы текущего аудио-контекста; выставляются в buildRecipes().
const P = { burst: null, tone: null, arpeggio: null };

const clamp01 = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? (n < 0 ? 0 : n > 1 ? 1 : n) : fallback;
};

// cast — свист лески: шумовой всплеск с подъёмом фильтра и слабым тоном.
function sCast(t, o) {
  const p = clamp01(o.power, 0.7);
  const dur = 0.5 + p * 0.3;
  P.burst(t, { dur, freq: 700 + 500 * p, to: 2600 + 900 * p, sweep: dur, q: 1.4, peak: 0.2 + 0.16 * p, attack: 0.04, hold: 0.04, decay: dur * 0.9 });
  P.tone(t, { from: 1400, to: 2400 + 900 * p, dur: dur * 0.8, peak: 0.05, attack: 0.05, decay: dur * 0.7 });
}

// splash — всплеск: шум + низкий «бульк» и брызги сверху.
function sSplash(t, o) {
  const size = clamp01(o.size !== undefined ? o.size : o.power, 0.5);
  const dur = 0.35 + size * 0.35;
  P.burst(t, { dur, filter: 'lowpass', freq: 1600, to: 320, sweep: dur, q: 0.9, peak: 0.3 + 0.2 * size, attack: 0.01, decay: dur });
  P.tone(t, { from: 150 + 60 * size, to: 55, dur: dur * 0.8, peak: 0.22 + 0.15 * size, attack: 0.01, decay: dur * 0.7 });
  P.burst(t + 0.05, { dur: dur * 0.5, filter: 'highpass', freq: 2400, q: 0.7, peak: 0.08 + 0.06 * size, attack: 0.02 });
}

// bite — поклёвка: два коротких щелчка.
function sBite(t) {
  for (let i = 0; i < 2; i++) {
    const tt = t + i * 0.085;
    P.burst(tt, { dur: 0.05, filter: 'highpass', freq: 2200, q: 0.8, peak: 0.24, attack: 0.002, decay: 0.035 });
    P.tone(tt, { type: 'triangle', from: 980 - i * 160, to: 640 - i * 80, dur: 0.045, peak: 0.1, attack: 0.002, decay: 0.04 });
  }
}

// strike — подсечка: резкий удар с «подсэмплированным» квадратом.
function sStrike(t) {
  P.burst(t, { dur: 0.18, filter: 'lowpass', freq: 5200, to: 700, sweep: 0.15, q: 0.9, peak: 0.5, attack: 0.002, decay: 0.16 });
  P.tone(t, { type: 'square', from: 320, to: 64, dur: 0.14, peak: 0.15, attack: 0.003, decay: 0.15, detune: 8, steps: 6 });
}

// reel — трещотка катушки: серия импульсов с акцентом на каждый четвёртый.
function sReel(t, o) {
  const dur = Math.min(1.2, Math.max(0.15, Number(o.duration) || 0.5));
  const step = 0.055 - clamp01(o.speed, 0.6) * 0.028;
  const count = Math.min(26, Math.max(2, Math.floor(dur / step)));
  for (let i = 0; i < count; i++) {
    const tt = t + i * step;
    const accent = i % 4 === 0 ? 1 : 0.6;
    P.burst(tt, { dur: 0.03, filter: 'highpass', freq: 1800 + i * 30, to: 3400, sweep: 0.02, q: 0.7, peak: 0.11 * accent, attack: 0.001, decay: 0.022 });
    P.tone(tt, { type: 'square', from: 1500 + (i % 5) * 90, to: 900, dur: 0.02, peak: 0.03 * accent, attack: 0.001, decay: 0.016 });
  }
}

// snap — обрыв: резкий шум с падением фильтра и «провисающим» тоном лески.
function sSnap(t) {
  P.burst(t, { dur: 0.3, filter: 'lowpass', freq: 7000, to: 260, sweep: 0.28, q: 0.8, peak: 0.5, attack: 0.001, decay: 0.3 });
  P.tone(t, { type: 'sawtooth', from: 420, to: 42, dur: 0.22, peak: 0.18, attack: 0.002, decay: 0.25, drive: 4 });
}

// land — фанфары на три ноты.
function sLand(t) {
  P.arpeggio(t, [523.25, 659.25, 783.99], 0.16, 0.2, 0.65);
}

// levelup — восходящее арпеджио из пяти нот.
function sLevelup(t) {
  P.arpeggio(t, [523.25, 659.25, 783.99, 1046.5, 1318.5], 0.09, 0.14, 0.62);
}

// sell — звон монет: три высоких синуса с треугольным блеском.
function sSell(t) {
  [2093, 2637, 3136].forEach((freq, i) => {
    const tt = t + i * 0.06;
    P.tone(tt, { from: freq, to: freq * 1.004, dur: 0.55, peak: 0.1, attack: 0.004, decay: 0.5 });
    P.tone(tt, { type: 'triangle', from: freq * 1.5, dur: 0.2, peak: 0.03, attack: 0.003, decay: 0.18 });
  });
}

// click — клик интерфейса.
function sClick(t) {
  P.burst(t, { dur: 0.02, filter: 'bandpass', freq: 1600, q: 0.9, peak: 0.1, attack: 0.001, decay: 0.02 });
  P.tone(t, { type: 'square', from: 1200, to: 800, dur: 0.03, peak: 0.035, attack: 0.001, decay: 0.03 });
}

// wind_gust — порыв ветра: две полосы шума с разной высотой.
function sWindGust(t, o) {
  const p = clamp01(o.power, 0.7);
  const dur = 1.1 + p * 0.8;
  P.burst(t, { dur, freq: 500, to: 1500, sweep: dur, q: 0.7, peak: 0.12 + 0.12 * p, attack: dur * 0.25, hold: 0.05, decay: dur * 0.6 });
  P.burst(t + 0.05, { dur: dur * 0.7, filter: 'highpass', freq: 2200, q: 0.6, peak: 0.05 + 0.04 * p, attack: dur * 0.3, decay: dur * 0.5 });
}

// rain_start — начало дождя: нарастающий шум и редкие капли.
function sRainStart(t, o) {
  const p = clamp01(o.power, 0.6);
  P.burst(t, { dur: 1.4, freq: 2600, q: 0.55, peak: 0.16 + 0.1 * p, attack: 0.6, decay: 0.8 });
  P.burst(t + 0.1, { dur: 1.1, filter: 'lowpass', freq: 900, q: 0.6, peak: 0.05, attack: 0.5, decay: 0.8 });
  for (let i = 0; i < 5 + Math.floor(p * 4); i++) {
    const tt = t + 0.2 + Math.random() * 0.9;
    P.tone(tt, { from: 1400 + Math.random() * 1800, to: 900, dur: 0.05, peak: 0.02 + Math.random() * 0.02, attack: 0.002, decay: 0.05 });
  }
}

/** Карта имя → рецепт. Примитивы запоминаются в модуле. */
export function buildRecipes(primitives) {
  Object.assign(P, primitives);
  return {
    cast: sCast,
    splash: sSplash,
    bite: sBite,
    strike: sStrike,
    reel: sReel,
    snap: sSnap,
    land: sLand,
    levelup: sLevelup,
    sell: sSell,
    click: sClick,
    wind_gust: sWindGust,
    rain_start: sRainStart,
  };
}
