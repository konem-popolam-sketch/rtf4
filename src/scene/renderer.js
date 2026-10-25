/**
 * src/scene/renderer.js — WebGL-контекст, камера, небо, свет и суточный цикл.
 * Контракт: docs/API.md §5. createRenderer никогда не бросает: без WebGL
 * включается 2D-fallback (renderer.isFallback = true), игра остаётся играбельной.
 */
import * as THREE from 'three';
import { skyGradientTexture } from '../textures/procedural.js';
import { DEFAULT_AMBIENT, sampleSky, hexDelta, clamp01 } from './palette.js';

const SKY_RADIUS = 420;
const FOG_NEAR = 16;
const FOG_FAR = 240;
const SKY_REPAINT_EPS = 4;

/** Заглушка WebGL-рендерера: повторяет нужные капитану поля и ничего не делает. */
function makeShim(canvas) {
  return {
    isFallback: true,
    domElement: canvas,
    shadowMap: { enabled: false },
    info: { render: { calls: 0, triangles: 0 }, memory: { geometries: 0, textures: 0 } },
    setPixelRatio() {},
    setSize() {},
    setClearColor() {},
    render() {},
    clear() {},
    dispose() {},
  };
}

function readCanvasSize(canvas) {
  const w = Math.max(1, Math.round(canvas.clientWidth || canvas.width || 1280));
  const h = Math.max(1, Math.round(canvas.clientHeight || canvas.height || 720));
  return { w, h };
}

function readDpr() {
  const d = typeof globalThis !== 'undefined' ? globalThis.devicePixelRatio : 1;
  return Math.min(2, Math.max(1, Number.isFinite(d) ? d : 1));
}

/** Все цвета неба и света на текущий кадр. */
function resolveSky(ctx, state, ambient) {
  const minutes = Number.isFinite(ctx?.minutes)
    ? ctx.minutes
    : Number.isFinite(state?.world?.minutes)
      ? state.world.minutes
      : 720;
  const cloud = ctx?.weather?.cloud ?? state?.world?.weather?.cloud ?? 0.35;
  return sampleSky({ minutes, cloud, ambient });
}

/** Солнце и луна: диски на «бесконечной» сфере вокруг камеры. */
function makeCelestial(disposables) {
  const group = new THREE.Group();
  group.renderOrder = -900;

  const sunGeo = new THREE.CircleGeometry(11, 24);
  const sunMat = new THREE.MeshBasicMaterial({ color: '#fff2cf', transparent: true, opacity: 0.95, toneMapped: false, fog: false, depthWrite: false });
  const sun = new THREE.Mesh(sunGeo, sunMat);
  disposables.push(sunGeo, sunMat);

  const glowGeo = new THREE.CircleGeometry(26, 24);
  const glowMat = new THREE.MeshBasicMaterial({ color: '#ffd9a0', transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false });
  const glow = new THREE.Mesh(glowGeo, glowMat);
  disposables.push(glowGeo, glowMat);

  const moonGeo = new THREE.CircleGeometry(7.5, 20);
  const moonMat = new THREE.MeshBasicMaterial({ color: '#e6ecff', transparent: true, opacity: 0.9, toneMapped: false, fog: false, depthWrite: false });
  const moon = new THREE.Mesh(moonGeo, moonMat);
  disposables.push(moonGeo, moonMat);

  group.add(sun, glow, moon);
  return { group, sun, glow, moon };
}

/** Звёздное небо: одна Points-система, видна только ночью. */
function makeStars(disposables) {
  const count = 420;
  const pos = new Float32Array(count * 3);
  let seed = 7717;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < count; i++) {
    const az = rnd() * Math.PI * 2;
    const el = 0.06 + rnd() * 1.35;
    const r = SKY_RADIUS * 0.92;
    pos[i * 3] = Math.cos(az) * Math.cos(el) * r;
    pos[i * 3 + 1] = Math.sin(el) * r;
    pos[i * 3 + 2] = Math.sin(az) * Math.cos(el) * r;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color: '#dfe8ff', size: 2.1, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, fog: false });
  disposables.push(geo, mat);
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return points;
}

/** Небо: большая сфера с градиентной CanvasTexture (BackSide). */
function makeSky(disposables) {
  const geo = new THREE.SphereGeometry(SKY_RADIUS, 28, 18);
  const tex = skyGradientTexture(THREE, '#6e9dc6', '#dbe7ef');
  const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false, toneMapped: false });
  disposables.push(geo, mat, tex);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  return { mesh, tex };
}

/** 2D-фолбэк: градиент неба, вода и светило прямо в тот же canvas. */
function makeFallbackPainter(canvas) {
  let ctx2d = null;
  try {
    ctx2d = canvas && typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  } catch (err) {
    ctx2d = null;
  }
  return {
    get ready() {
      return !!ctx2d;
    },
    paint(sky, view) {
      if (!ctx2d) return;
      const w = canvas.width || 1280;
      const h = canvas.height || 720;
      const c = ctx2d;
      const sunX = w * 0.5 + Math.cos((sky.minutes / 1440) * Math.PI * 2) * w * 0.34;
      const horizonY = h * (0.46 + clamp01(view?.bob ?? 0) * 0.004);
      const grad = c.createLinearGradient(0, 0, 0, horizonY);
      grad.addColorStop(0, sky.top);
      grad.addColorStop(0.7, sky.bottom);
      grad.addColorStop(1, sky.fog);
      c.fillStyle = grad;
      c.fillRect(0, 0, w, horizonY);
      const water = c.createLinearGradient(0, horizonY, 0, h);
      water.addColorStop(0, sky.fog);
      water.addColorStop(0.25, sky.waterTint === '#ffffff' ? '#4a7b84' : '#2f5a60');
      water.addColorStop(1, '#12262b');
      c.fillStyle = water;
      c.fillRect(0, horizonY, w, h - horizonY);
      c.beginPath();
      c.arc(sunX, horizonY - h * 0.16 - sky.elev * h * 0.3, sky.dayness > 0.15 ? h * 0.045 : h * 0.03, 0, Math.PI * 2);
      c.fillStyle = sky.dayness > 0.15 ? '#ffe9bd' : '#e8efff';
      c.globalAlpha = 0.9;
      c.fill();
      c.globalAlpha = 1;
      c.strokeStyle = 'rgba(255,255,255,.18)';
      c.lineWidth = 1;
      for (let i = 0; i < 26; i++) {
        const y = horizonY + (h - horizonY) * Math.pow(i / 26, 1.6);
        c.beginPath();
        c.moveTo(w * 0.1, y);
        c.lineTo(w * 0.9, y + Math.sin(i * 1.7 + sky.minutes * 0.01) * 2);
        c.stroke();
      }
    },
    clear() {
      if (ctx2d) ctx2d.clearRect(0, 0, canvas.width, canvas.height);
    },
  };
}

/**
 * Создать рендерер, сцену и камеру.
 * @param {{canvas?: HTMLCanvasElement, state?: object, bus?: object}} opts
 */
export async function createRenderer({ canvas, state, bus } = {}) {
  const disposables = [];
  const el = canvas || (typeof document !== 'undefined' ? document.createElement('canvas') : null);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.08, 900);
  camera.position.set(0, 1.6, 8);
  camera.lookAt(0, 1.28, -6);
  scene.add(camera);

  const ambient = { ...DEFAULT_AMBIENT };
  const view = { bob: 0, roll: 0, shake: 0, backlight: 0, phase: 'idle' };
  const frameHooks = [];
  const waterHooks = [];

  let gl = null;
  try {
    if (!el) throw new Error('canvas недоступен');
    gl = new THREE.WebGLRenderer({
      canvas: el,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
      failIfMajorPerformanceCaveat: false,
    });
    gl.isFallback = false;
    gl.setPixelRatio(readDpr());
    gl.outputColorSpace = THREE.SRGBColorSpace;
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 1;
    gl.shadowMap.enabled = false;
    gl.setClearColor('#0b1418', 1);
  } catch (err) {
    gl = null;
  }

  const isFallback = !gl;
  const renderer = gl || makeShim(el);
  const painter = isFallback ? makeFallbackPainter(el) : null;

  // --- Небо, светила, звёзды ---
  const sky = makeSky(disposables);
  scene.add(sky.mesh);
  const celestial = makeCelestial(disposables);
  scene.add(celestial.group);
  const stars = makeStars(disposables);
  scene.add(stars);

  scene.fog = new THREE.Fog(ambient.fogColor, FOG_NEAR, FOG_FAR);
  scene.background = new THREE.Color(ambient.fogColor);

  const hemi = new THREE.HemisphereLight('#cfe2f2', '#33402a', 0.9);
  const ambientLight = new THREE.AmbientLight('#8fa4b8', 0.14);
  const sun = new THREE.DirectionalLight('#fff0d2', 1.1);
  sun.position.set(40, 60, -50);
  sun.castShadow = false;
  scene.add(hemi, ambientLight, sun);

  let lastCtx = null;
  let ticked = false;
  let skyTopPainted = '';
  let skyBottomPainted = '';
  let lastSky = resolveSky(null, state, ambient);
  let elapsed = 0;

  /** Перекрасить градиент неба (только при заметном изменении цвета). */
  function repaintSky(next) {
    if (hexDelta(next.top, skyTopPainted) < SKY_REPAINT_EPS && hexDelta(next.bottom, skyBottomPainted) < SKY_REPAINT_EPS) return;
    const fresh = skyGradientTexture(THREE, next.top, next.bottom);
    const mat = sky.mesh.material;
    if (mat.map && mat.map !== fresh) mat.map.dispose();
    mat.map = fresh;
    mat.needsUpdate = true;
    sky.tex = fresh;
    skyTopPainted = next.top;
    skyBottomPainted = next.bottom;
  }

  /** Разложить состояние неба по свету, туману и светилам. */
  function applySky(next) {
    lastSky = next;
    repaintSky(next);
    scene.background.set(next.fog);
    scene.fog.color.set(next.fog);
    scene.fog.near = FOG_NEAR;
    scene.fog.far = FOG_FAR + (next.cloud > 0.6 ? 40 : 0);

    hemi.color.set(next.hemiSky);
    hemi.groundColor.set(next.hemiGround);
    hemi.intensity = next.hemiI * (1 - view.backlight * 0.25);
    ambientLight.intensity = 0.08 + next.moonI * 0.12;

    const dir = next.dayness > 0.12 ? next.sunDir : next.moonDir;
    sun.position.set(dir[0] * 120, Math.max(dir[1], 0.05) * 120, dir[2] * 120);
    sun.color.set(next.dayness > 0.12 ? next.sunColor : '#a9bcff');
    sun.intensity = next.dayness > 0.12 ? next.sunI * (1 + view.backlight * 0.5) : next.moonI;

    const sunDist = SKY_RADIUS * 0.9;
    celestial.sun.position.set(next.sunDir[0] * sunDist, next.sunDir[1] * sunDist, next.sunDir[2] * sunDist);
    celestial.glow.position.copy(celestial.sun.position);
    celestial.glow.scale.setScalar(1.4 + (1 - next.cloud) * 0.8);
    celestial.sun.material.opacity = clamp01(next.elev * 4 + 0.15);
    celestial.glow.material.opacity = clamp01(next.elev * 2) * 0.3;
    celestial.moon.position.set(next.moonDir[0] * sunDist, next.moonDir[1] * sunDist, next.moonDir[2] * sunDist);
    celestial.moon.material.opacity = clamp01(0.25 + next.moonI);
    celestial.sun.lookAt(camera.position);
    celestial.glow.lookAt(camera.position);
    celestial.moon.lookAt(camera.position);

    stars.material.opacity = clamp01(1 - next.dayness * 2.4);
    stars.visible = stars.material.opacity > 0.01;

    if (gl) gl.toneMappingExposure = next.exposure * (0.9 + view.backlight * 0.18);
  }

  function applyCamera(dt) {
    elapsed += dt;
    const phase = view.phase;
    const breathe = Math.sin(elapsed * 0.9) * 0.012 + Math.sin(elapsed * 2.3) * 0.004;
    const sway = Math.sin(elapsed * 0.42) * 0.03;
    const shake = view.shake > 0 ? Math.sin(elapsed * 47) * view.shake * 0.035 : 0;
    const fight = phase === 'fight' ? 1 : 0;
    view.bob = breathe + shake;
    camera.position.set(sway * 0.4 + shake * 0.5, 1.6 + breathe + fight * 0.02, 8 - fight * 0.06);
    camera.rotation.set(-0.04 + fight * 0.05 - shake * 0.02, sway * 0.35, view.roll * 0.12 + shake * 0.05);
    view.shake = Math.max(0, view.shake - dt * 0.9);
  }

  function update(dt, ctx) {
    const step = Number.isFinite(dt) ? Math.min(0.1, Math.max(0, dt)) : 0.016;
    lastCtx = ctx || lastCtx;
    applySky(resolveSky(lastCtx, state, ambient));
    applyCamera(step);
    for (let i = 0; i < frameHooks.length; i++) {
      try {
        frameHooks[i](step, { ...(lastCtx || {}), sky: lastSky, view });
      } catch (err) {
        if (typeof window !== 'undefined' && window.RTF4_DEBUG) console.error('[scene] frame hook failed', err);
      }
    }
    ticked = true;
  }

  function render(dt) {
    const step = Number.isFinite(dt) ? dt : 0.016;
    if (!ticked) update(step, lastCtx);
    ticked = false;
    if (isFallback) {
      if (painter) painter.paint(lastSky, view);
      return;
    }
    renderer.render(scene, camera);
  }

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

  function setWater(water) {
    if (water && water.ambient) Object.assign(ambient, water.ambient);
    applySky(resolveSky(lastCtx, state, ambient));
    for (let i = 0; i < waterHooks.length; i++) {
      try {
        waterHooks[i](water, ambient);
      } catch (err) {
        if (typeof window !== 'undefined' && window.RTF4_DEBUG) console.error('[scene] water hook failed', err);
      }
    }
  }

  function dispose() {
    if (typeof window !== 'undefined') window.removeEventListener('resize', resize);
    frameHooks.length = 0;
    waterHooks.length = 0;
    scene.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose?.();
      const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
      for (const m of mats) {
        if (!m) continue;
        if (m.map) m.map.dispose?.();
        m.dispose?.();
      }
    });
    for (const d of disposables) d.dispose?.();
    disposables.length = 0;
    renderer.dispose?.();
  }

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('resize', resize);
  }
  resize();
  applySky(lastSky);

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
    /** Текущая палитра неба (для scene/fx, читается без пересчёта). */
    getSky: () => lastSky,
    /** Удобный доступ к шине для внутренних модулей сцены. */
    bus: bus || null,
  };
}
