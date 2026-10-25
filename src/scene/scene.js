/**
 * src/scene/scene.js — сборка игровой сцены из модулей: вода, берег, камыш,
 * деревья, мостки/лодка, удочка от первого лица, поплавок, леска, брызги,
 * силуэт рыбы. Контракт: docs/API.md §5.
 *
 * При renderer.isFallback возвращается объект с теми же методами, но каждый —
 * безопасная заглушка: игра остаётся играбельной на 2D-фоне.
 */
import * as THREE from 'three';
import { createWater } from './water.js';
import { createShore } from './shore.js';
import { createRod } from './rod.js';
import { createBobber } from './bobber.js';
import { createFx } from './fx.js';
import { createFish3d } from './fish3d.js';
import { DEFAULT_AMBIENT } from './palette.js';
import { clamp, damp } from './util.js';

const PHASES = new Set(['idle', 'cast', 'wait', 'bite', 'fight', 'landed']);

/** Заглушки для fallback-режима: тот же интерфейс, ничего не делает. */
function fallbackScene(reason) {
  const noop = () => {};
  return {
    isFallback: true,
    fallbackReason: reason,
    update: noop,
    setWater: noop,
    setPhase: noop,
    castTo: noop,
    reelProgress: noop,
    setBite: noop,
    splash: noop,
    showFishOn: noop,
    hideFish: noop,
    dispose: noop,
    bobberPosition: () => new THREE.Vector3(0, 0, -12),
    fishPosition: () => new THREE.Vector3(0, 0, -12),
  };
}

/**
 * Создать сцену игры.
 * @param {{THREE: object, renderer: object, scene: object, camera: object,
 *          bus?: object, state?: object, water?: object}} deps
 */
export function createScene({ renderer, scene, camera, bus, state, water } = {}) {
  if (!renderer || renderer.isFallback) return fallbackScene('webgl-unavailable');
  if (!scene || !camera) return fallbackScene('scene-or-camera-missing');

  const ambient = { ...DEFAULT_AMBIENT, ...(water?.ambient || {}) };

  // Камера — «глаза» рыболова на берегу, чуть выше воды.
  camera.position.set(0, 1.6, 8);
  camera.lookAt(0, 1.3, -6);

  // Группа для удочки: держим её в камере, но через промежуточную группу,
  // чтобы не ломать трансформ самой камеры.
  const rodRig = new THREE.Group();
  rodRig.name = 'rod-rig';
  camera.add(rodRig);

  const waterApi = createWater({ scene, ambient });
  const shoreApi = createShore({ scene, ambient });
  const bobberApi = createBobber({ scene });
  const rodApi = createRod({ scene, camera, rodRig });
  const fxApi = createFx({ scene });
  const fishApi = createFish3d({ scene });

  // Кончик удилища нужен до первого update: считаем сразу.
  rodApi.computeTip();

  const view = renderer.view || {};
  let phase = 'idle';
  let castT = 0;             // 0..1 — прогресс заброса
  let reelT = 0;             // 0..1 — прогресс подмотки
  let biteStrength = 0;
  let fightLoad = 0;
  let backlight = 0;         // 0..1 — контражур в вываживании
  let backlightTarget = 0;
  let time = 0;
  let lastSplash = 0;
  const bobberVec = new THREE.Vector3(0, 0.02, -12);

  /** Текущая палитра неба: renderer считает её каждый кадр, читаем без пересчёта. */
  function currentSky() {
    if (typeof renderer.getSky === 'function') {
      const s = renderer.getSky();
      if (s) return s;
    }
    return { dayness: 1, elev: 0.5, top: '#6e9dc6', bottom: '#dbe7ef', fog: '#b9c6cc', moonI: 0 };
  }

  /** Смена водоёма: перекрасить воду/берег/небо под ambient нового места. */
  function setWater(next) {
    if (!next) return;
    Object.assign(ambient, next.ambient || {});
    waterApi.setAmbient(next.ambient || {});
    shoreApi.applyAmbient(next.ambient || {});
    if (renderer && typeof renderer.setWater === 'function') renderer.setWater(next);
    const sky = currentSky();
    waterApi.applySky(sky);
  }

  /** Фаза игры влияет на свет и позу удочки. fight — контражур. */
  function setPhase(next) {
    if (!PHASES.has(next)) return;
    phase = next;
    if (view) view.phase = next;
    // Контражур в вываживании: силуэт рыбы читается на фоне светлой воды.
    backlightTarget = next === 'fight' ? 1 : 0;
    if (view) view.backlight = backlight;
    if (next === 'idle' || next === 'cast') {
      reelT = 0;
      biteStrength = 0;
      fishApi.hide();
    }
    if (next === 'landed') {
      fightLoad = 0;
      fishApi.hide();
    }
  }

  /** Заброс на дистанцию distM: поплавок летит по дуге, затем всплеск. */
  function castTo(distM) {
    const d = clamp(Number.isFinite(distM) ? distM : 12, 2, 60);
    castT = 0;
    bobberApi.castTo(d);
    bobberApi.show();
    const p = bobberApi.position;
    fxApi.splash(p.x, p.z - 0.6, 0.35);
    if (bus && typeof bus.emit === 'function') bus.emit('sfx', { name: 'cast' });
  }

  /** Подмотка: 0..1 двигает поплавок к берегу, в бое — добавляет натяжение. */
  function reelProgress(f) {
    reelT = clamp(f, 0, 1);
    bobberApi.reelTo(reelT);
  }

  /** Поклёвка: сила 0..1 (0 = покой). */
  function setBite(strength) {
    biteStrength = clamp(strength, 0, 1);
    bobberApi.setBite(biteStrength);
  }

  /** Всплеск в точке поплавка. */
  function splash(size) {
    const p = bobberApi.position;
    fxApi.splash(p.x, p.z, clamp(Number.isFinite(size) ? size : 0.5, 0.05, 1));
    lastSplash = time;
  }

  function showFishOn(fishObj) {
    fishApi.show(fishObj || { shape: 'torpedo', color: '#7f8f6a', kg: 1 });
    splash(0.55);
  }

  function hideFish() {
    fishApi.hide();
  }

  /** Каждый кадр: вода, берег, поплавок, леска, брызги, силуэт, свет. */
  function update(dt, ctx) {
    const step = Number.isFinite(dt) ? Math.min(0.1, Math.max(0, dt)) : 0.016;
    time += step;
    const sky = ctx && ctx.sky ? ctx.sky : currentSky();
    const phaseNow = (ctx && ctx.phase) || phase;
    if (phaseNow !== phase && PHASES.has(phaseNow)) setPhase(phaseNow);

    const weather = ctx?.weather || state?.world?.weather || null;
    const wind = clamp((weather?.windMs ?? 3) / 12, 0, 1);

    // Вода течёт быстрее на ветру; цвет — по небу.
    waterApi.animate(step, 0.7 + wind * 0.8);
    waterApi.applySky(sky);

    // Берег покачивает камыш и тенится под время суток.
    shoreApi.animate(step, sky);

    // Заброс — плавное нарастание прогресса до 1 за ~0.6 с.
    if (phaseNow === 'cast') castT = Math.min(1, castT + step * 1.7);

    // В бое поплавок уходит под воду, леска натягивается.
    fightLoad = damp(fightLoad, phaseNow === 'fight' ? clamp(ctx?.fight?.tension ?? 0.45, 0, 1) : 0, 4, step);
    backlight = damp(backlight, backlightTarget, 5, step);
    if (view) view.backlight = backlight;
    if (view) view.shake = phaseNow === 'fight' ? fightLoad * 0.9 : Math.max(0, (view.shake || 0) - step);
    const biteNow = phaseNow === 'bite' ? Math.max(biteStrength, 0.55) : biteStrength;
    bobberApi.update(step, {
      waveHeightAt: waterApi.waveHeightAt,
      phase: phaseNow,
      bite: biteNow,
      reel: phaseNow === 'fight' ? 1.1 : 0,
      fight: fightLoad,
    });
    bobberVec.copy(bobberApi.position);
    // Отдаём точку поплавка рендереру: fallback-режим рисует его на 2D-фоне.
    if (view) view.bobber = { x: bobberVec.x, y: bobberVec.y, z: bobberVec.z, bite: biteNow };

    // Леска: от кончика удилища к поплавку, с натяжением в бое.
    rodApi.update(step, {
      bobber: bobberVec,
      phase: phaseNow,
      fightLoad,
      bite: biteNow,
      reelSpeed: phaseNow === 'fight' ? 0.6 + fightLoad * 0.8 : 0,
      visible: phaseNow !== 'idle' || castT > 0.05,
    });

    fxApi.update(step);
    fishApi.update(step, { bobber: bobberVec, fight: fightLoad, phase: phaseNow });

    // Рыба при вываживании иногда бьёт по воде — всплеск с затуханием.
    if (phaseNow === 'fight' && time - lastSplash > 1.6 && fightLoad > 0.35) {
      splash(0.4 + fightLoad * 0.5);
    }
  }

  function dispose() {
    camera.remove(rodRig);
    waterApi.dispose();
    shoreApi.dispose();
    bobberApi.dispose();
    rodApi.dispose();
    fxApi.dispose();
    fishApi.dispose();
  }

  // Стартовая подстройка под водоём из state (если капитан уже его выбрал).
  const startAmbient = water?.ambient || null;
  if (startAmbient) {
    shoreApi.applyAmbient(startAmbient);
    waterApi.setAmbient(startAmbient);
  }
  waterApi.applySky(currentSky());

  return {
    update,
    setWater,
    setPhase,
    castTo,
    reelProgress,
    setBite,
    splash,
    showFishOn,
    hideFish,
    dispose,
    // Диагностика для капитана/QA: где сейчас поплавок и рыба.
    bobberPosition: () => bobberApi.position.clone(),
    fishPosition: () => fishApi.group.position.clone(),
    getPhase: () => phase,
    get isFallback() {
      return false;
    },
  };
}
