/**
 * src/scene/renderer.js — WebGL-контекст, камера, небо/свет и суточный цикл.
 * Контракт: docs/API.md §5. createRenderer НИКОГДА не бросает: без WebGL
 * включается 2D-fallback (renderer.isFallback = true), игра остаётся играбельной.
 */
import * as THREE from 'three';
import { DEFAULT_AMBIENT, sampleSky } from './palette.js';
import { createSky } from './sky.js';
import { makeRendererShim, makeFallbackPainter } from './fallback.js';

function readCanvasSize(canvas) {
  const w = Math.max(1, Math.round(canvas.clientWidth || canvas.width || 1280));
  const h = Math.max(1, Math.round(canvas.clientHeight || canvas.height || 720));
  return { w, h };
}

/** Плотность пикселей ограничена двойкой — требование SPEC §2. */
function readDpr() {
  const d = typeof globalThis !== 'undefined' ? globalThis.devicePixelRatio : 1;
  return Math.min(2, Math.max(1, Number.isFinite(d) ? d : 1));
}

/** Палитра неба на кадр: минуты и облачность из ctx, иначе из state. */
function resolveSky(ctx, state, ambient) {
  const minutes = Number.isFinite(ctx?.minutes)
    ? ctx.minutes
    : Number.isFinite(state?.world?.minutes)
      ? state.world.minutes
      : 720;
  const cloud = ctx?.weather?.cloud ?? state?.world?.weather?.cloud ?? 0.35;
  return sampleSky({ minutes, cloud, ambient });
}

/**
 * Создать рендерер, сцену и камеру.
 * @param {{canvas?: HTMLCanvasElement, state?: object, bus?: object}} opts
 */
export async function createRenderer({ canvas, state, bus } = {}) {
  const el = canvas || (typeof document !== 'undefined' ? document.createElement('canvas') : null);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.08, 900);
  camera.position.set(0, 1.6, 8);
  camera.lookAt(0, 1.3, -6);
  scene.add(camera);

  // ambient водоёма может прийти из state до первого setWater
  const ambient = { ...DEFAULT_AMBIENT };
  const view = { bob: 0, roll: 0, shake: 0, backlight: 0, phase: 'idle', bobber: { x: 0, y: 0.02, z: -12 } };
  const frameHooks = [];
  const waterHooks = [];

  let gl = null;
  try {
    if (!el) throw new Error('canvas недоступен: WebGL некуда рисовать');
    gl = new THREE.WebGLRenderer({
      canvas: el,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    gl.setPixelRatio(readDpr());
    gl.outputColorSpace = THREE.SRGBColorSpace;
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 1;
    gl.shadowMap.enabled = false;
    gl.setClearColor('#0b1418', 1);
    gl.isFallback = false;
  } catch (err) {
    gl = null;
  }

  const isFallback = !gl;
  const renderer = gl || makeRendererShim(el);
  const painter = isFallback ? makeFallbackPainter(el) : null;

  const sky = createSky({ scene, camera, ambient });

  let lastCtx = null;
  let lastSky = resolveSky(null, state, ambient);
  let elapsed = 0;
  let updatedThisFrame = false;

  /** Поза камеры: дыхание, покачивание, тряска при вываживании. */
  function applyCamera(dt) {
    elapsed += dt;
    const fight = view.phase === 'fight' ? 1 : 0;
    const breathe = Math.sin(elapsed * 0.9) * 0.012 + Math.sin(elapsed * 2.3) * 0.004;
    const sway = Math.sin(elapsed * 0.42) * 0.03;
    const shake = view.shake > 0 ? Math.sin(elapsed * 47) * view.shake * 0.035 : 0;
    view.bob = breathe + shake;
    camera.position.set(sway * 0.4 + shake * 0.5, 1.6 + breathe + fight * 0.02, 8 - fight * 0.06);
    camera.rotation.set(-0.04 + fight * 0.05 - shake * 0.02, sway * 0.35, view.roll * 0.12 + shake * 0.05);
    view.shake = Math.max(0, view.shake - dt * 0.9);
  }

  function update(dt, ctx) {
    const step = Number.isFinite(dt) ? Math.min(0.1, Math.max(0, dt)) : 0.016;
    if (ctx) lastCtx = ctx;
    lastSky = resolveSky(lastCtx, state, ambient);
    const exposure = sky.update(lastSky, view);
    if (gl) gl.toneMappingExposure = exposure;
    // Точка поплавка для 2D-фолбэка: знаем дистанцию заброса из ctx.cast.
    const dist = Number.isFinite(lastCtx?.cast?.distM) ? lastCtx.cast.distM : 12;
    view.bobber = { x: 0, y: 0.02, z: -Math.max(2, Math.min(60, dist)), bite: lastCtx?.phase === 'bite' ? 1 : 0 };
    applyCamera(step);
    for (let i = 0; i < frameHooks.length; i++) {
      try {
        frameHooks[i](step, { ...(lastCtx || {}), sky: lastSky, view });
      } catch (err) {
        if (typeof window !== 'undefined' && window.RTF4_DEBUG) console.error('[scene] frame hook failed', err);
      }
    }
    updatedThisFrame = true;
  }

  function render(dt) {
    const step = Number.isFinite(dt) ? dt : 0.016;
    if (!updatedThisFrame) update(step, lastCtx);
    updatedThisFrame = false;
    if (isFallback) {
      if (painter) painter.paint(lastSky, view);
      return;
    }
    renderer.render(scene, camera);
  }

  /** Пересчитать размер canvas и аспект камеры. */
  function resize() {
    if (!el) return;
    const { w, h } = readCanvasSize(el);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (isFallback) {
      const dpr = readDpr();
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
      return;
    }
    renderer.setPixelRatio(readDpr());
    renderer.setSize(w, h, false);
  }

  /** Смена водоёма: палитра неба/туман + уведомить подписчиков сцены. */
  function setWater(water) {
    if (water && water.ambient) Object.assign(ambient, water.ambient);
    sky.setAmbient(water?.ambient || null);
    lastSky = resolveSky(lastCtx, state, ambient);
    sky.update(lastSky, view);
    for (let i = 0; i < waterHooks.length; i++) {
      try {
        waterHooks[i](water, ambient);
      } catch (err) {
        if (typeof window !== 'undefined' && window.RTF4_DEBUG) console.error('[scene] water hook failed', err);
      }
    }
  }

  /** Полное освобождение: геометрии, материалы, текстуры, контекст. */
  function dispose() {
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('resize', resize);
    }
    frameHooks.length = 0;
    waterHooks.length = 0;
    scene.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose?.();
      const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
      for (const m of mats) {
        if (!m) continue;
        if (m.map) m.map.dispose?.();
        if (m.normalMap && m.normalMap !== m.map) m.normalMap.dispose?.();
        m.dispose?.();
      }
    });
    sky.dispose();
    scene.clear();
    renderer.dispose?.();
  }

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('resize', resize);
  }
  resize();
  sky.update(lastSky, view);

  return {
    THREE,
    renderer,
    scene,
    camera,
    isFallback,
    view,
    ambient,
    frameHooks,
    waterHooks,
    resize,
    render,
    update,
    setWater,
    dispose,
    /** Текущая палитра неба (scene/fx читают без пересчёта). */
    getSky: () => lastSky,
    /** Шина для внутренних модулей сцены. */
    bus: bus || null,
  };
}
