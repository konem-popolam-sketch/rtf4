/**
 * main.js — точка сборки. Владелец: капитан.
 * Загрузчик → сцена → HUD → панели → звук → игровой цикл.
 * Любая ошибка инициализации показывается в #fatal, а не молча ломает страницу.
 */
import { bus } from './core/bus.js';
import { storage } from './core/storage.js';

const g = globalThis;
g.RTF4_DEBUG = /[?&]debug=1/.test(location.search);

function fatal(err) {
  const box = document.getElementById('fatal');
  const text = document.getElementById('fatal-text');
  if (text) text.textContent = String((err && (err.stack || err.message)) || err);
  if (box) box.hidden = false;
  console.error(err);
}

/** Загружает модуль, но не роняет игру, если его ещё нет (сцена в fallback-режиме). */
async function optional(path) {
  try {
    return await import(path);
  } catch (err) {
    console.warn('[boot] необязательный модуль не загрузился:', path, err && err.message);
    return null;
  }
}

async function boot() {
  const status = document.getElementById('loader-status');
  const fill = document.getElementById('loader-fill');
  const setProgress = (p, msg) => {
    if (fill) fill.style.width = `${Math.round(p * 100)}%`;
    if (status && msg) status.textContent = msg;
  };

  setProgress(0.06, 'Загрузка модулей…');

  const [gameMod, rendererMod, hudMod, panelsMod, audioMod, actionsMod] = await Promise.all([
    import('./core/game.js'),
    import('./scene/renderer.js'),
    optional('./ui/hud.js'),
    optional('./ui/panels/index.js'),
    optional('./audio/sfx.js'),
    import('./state/actions.js'),
  ]);

  const { initState } = await import('./state/game.js');
  setProgress(0.28, 'Обживаем водоём…');

  const state = initState(storage);
  const actions = actionsMod.default || actionsMod;

  const renderer = await rendererMod.createRenderer({
    canvas: document.getElementById('scene'),
    state,
    bus,
  });

  setProgress(0.58, 'Готовим снасти…');

  const audio = audioMod?.initAudio ? audioMod.initAudio({ bus }) : null;
  const ambience = await (async () => {
    const ambMod = await optional('./audio/ambience.js');
    if (!ambMod?.createAmbience) return null;
    try {
      // Контекст до первого жеста ещё не создан — передаём геттер, а не сам контекст.
      return ambMod.createAmbience(() => audio && audio.context);
    } catch (err) {
      console.warn('[boot] атмосфера не создалась:', err && err.message);
      return null;
    }
  })();
  const panels = panelsMod?.initPanels ? panelsMod.initPanels({ bus, state, actions }) : null;
  const hud = hudMod?.initHud ? hudMod.initHud({ bus, state, actions }) : null;

  const game = gameMod.createGame({ state, renderer, bus });
  game.hud = hud;
  game.panels = panels;
  game.audio = audio;
  game.ambience = ambience;
  game.actions = actions;
  gameMod.wireGame(game);
  g.RTF4 = { state, renderer, game, bus, actions, hud, panels, audio, ambience };

  // Сцена монтируется после готовности рендера: ей нужны THREE и камера.
  const sceneMod = await optional('./scene/scene.js');
  if (sceneMod?.createScene) {
    try {
      const { WATER_BY_ID } = await import('./data/spots.js');
      game.scene = sceneMod.createScene({
        renderer,
        scene: renderer.scene,
        camera: renderer.camera,
        bus,
        state,
        water: WATER_BY_ID[state.world.waterId] || null,
      });
    } catch (err) {
      console.warn('[boot] сцена не создалась, продолжаем без неё:', err && err.message);
    }
  }

  setProgress(0.92, 'Почти готово…');

  // Атмосфера: ветер/дождь/время суток подтягиваем из событий шины,
  // чтобы не трогать кадровый цикл в core/game.js.
  if (ambience) {
    const wind01 = (w) => Math.min(1, Math.max(0, (Number(w && w.windMs) || 0) / 12));
    bus.on('weather:changed', (w) => {
      ambience.setWind(wind01(w));
      ambience.setRain(w && w.precip && w.precip !== 'none' ? 0.8 : 0);
    });
    bus.on('time:tick', (t) => {
      if (t && t.timeOfDay) ambience.setTimeOfDay(t.timeOfDay);
    });
    bus.on('world:changed', (p) => {
      if (p && p.waterId) ambience.setScene(p.waterId);
    });
  }

  const startBtn = document.getElementById('btn-start');
  const loaderEl = document.getElementById('loader');
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    if (loaderEl) {
      loaderEl.classList.add('loader--hidden');
      setTimeout(() => loaderEl.remove(), 700);
    }
    if (audio && typeof audio.unlock === 'function') audio.unlock();
    if (audio && typeof audio.setVolume === 'function') audio.setVolume(state.settings.volume);
    if (ambience) {
      // setVolume(master, sfx, ambient): третьим идёт громкость окружения.
      try {
        ambience.start(state.world.waterId);
        ambience.setWind(Math.min(1, Math.max(0, (state.world.weather?.windMs || 0) / 12)));
        ambience.setRain(state.world.weather?.precip && state.world.weather.precip !== 'none' ? 0.8 : 0);
        ambience.setTimeOfDay(game.ctx?.().timeOfDay || 'day');
      } catch (err) {
        console.warn('[boot] атмосфера не запустилась:', err && err.message);
      }
    }
    if (hud && typeof hud.start === 'function') hud.start();
    game.start();
  };

  if (startBtn) {
    startBtn.hidden = false;
    startBtn.disabled = false;
    setProgress(1, 'Нажмите «Начать рыбалку»');
    startBtn.addEventListener('click', start, { once: true });
    window.addEventListener('keydown', (e) => {
      if (!started && (e.code === 'Enter' || e.code === 'Space')) {
        e.preventDefault();
        start();
      }
    });
  } else {
    start();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => boot().catch(fatal), { once: true });
} else {
  boot().catch(fatal);
}
