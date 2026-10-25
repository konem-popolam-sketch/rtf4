/**
 * src/scene/sky.js — небо, светила, звёзды, туман и свет сцены.
 * Всё, что зависит от времени суток, живёт здесь: renderer только вызывает
 * update(state) и отдаёт готовую палитру остальным модулям.
 */
import * as THREE from 'three';
import { skyGradientTexture } from '../textures/procedural.js';
import { hexDelta, clamp01 } from './palette.js';

const SKY_RADIUS = 420;
const FOG_NEAR = 16;
const FOG_FAR = 240;
const REPAINT_EPS = 3;
/** Не чаще одного перерисовывания неба в столько секунд: экономим fill-rate. */
const REPAINT_MIN_INTERVAL = 0.35;

/**
 * Перерисовать градиент прямо в canvas существующей текстуры.
 * Текстура при этом остаётся той же самой: новых GPU-текстур в кадре нет.
 */
function repaintCanvas(canvas, top, bottom) {
  if (!canvas || typeof canvas.getContext !== 'function') return false;
  const c = canvas.getContext('2d');
  if (!c) return false;
  const h = canvas.height || 256;
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, top);
  g.addColorStop(0.55, top);
  g.addColorStop(1, bottom);
  c.fillStyle = g;
  c.fillRect(0, 0, canvas.width || 256, h);
  return true;
}

/** Диски солнца и луны: повёрнуты к камере, всегда за сценой. */
function makeCelestial(disposables) {
  const group = new THREE.Group();
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
  group.renderOrder = -900;
  return { group, sun, glow, moon };
}

/** Звёзды: одна Points-система, проявляется ночью. */
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

/** Купол неба: большая сфера с градиентной CanvasTexture. */
function makeDome(disposables, top, bottom) {
  const geo = new THREE.SphereGeometry(SKY_RADIUS, 28, 18);
  const tex = skyGradientTexture(THREE, top, bottom);
  const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false, toneMapped: false });
  disposables.push(geo, mat, tex);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  // canvas этой текстуры перерисовывается при смене времени суток — без новых текстур.
  const canvas = tex.image && tex.image.width ? tex.image : null;
  return { mesh, mat, tex, canvas };
}

/**
 * Создать небо и свет.
 * -> { group, update(state, view), setAmbient(ambient), dispose }
 */
export function createSky({ scene, camera, ambient }) {
  const disposables = [];
  const dome = makeDome(disposables, ambient.skyTop, ambient.skyBottom);
  const celestial = makeCelestial(disposables);
  const stars = makeStars(disposables);
  scene.add(dome.mesh, celestial.group, stars);

  scene.fog = new THREE.Fog(ambient.fogColor, FOG_NEAR, FOG_FAR);
  scene.background = new THREE.Color(ambient.fogColor);

  const hemi = new THREE.HemisphereLight('#cfe2f2', '#33402a', 0.9);
  const fill = new THREE.AmbientLight('#8fa4b8', 0.14);
  const sunLight = new THREE.DirectionalLight('#fff0d2', 1.1);
  sunLight.position.set(40, 60, -50);
  sunLight.castShadow = false;
  scene.add(hemi, fill, sunLight);

  let paintedTop = '';
  let paintedBottom = '';
  let exposure = 1;
  let repaintCooldown = 0;

  /**
   * Перекрасить градиент неба. Текстура остаётся одной и той же —
   * меняем только пиксели её canvas и просим GPU перезалить её один раз.
   */
  function repaint(top, bottom, force = false) {
    if (!force && repaintCooldown > 0) return;
    if (hexDelta(top, paintedTop) < REPAINT_EPS && hexDelta(bottom, paintedBottom) < REPAINT_EPS) return;
    if (!repaintCanvas(dome.canvas, top, bottom)) return;
    dome.tex.needsUpdate = true;
    paintedTop = top;
    paintedBottom = bottom;
    repaintCooldown = REPAINT_MIN_INTERVAL;
  }

  /**
   * Применить палитру кадра.
   * state — результат sampleSky(); view — { backlight 0..1 }.
   */
  function update(state, view = {}) {
    if (!state) return exposure;
    repaintCooldown = Math.max(0, repaintCooldown - (view.dt || 0.016));
    repaint(state.top, state.bottom);
    scene.background.set(state.fog);
    scene.fog.color.set(state.fog);
    scene.fog.near = FOG_NEAR;
    scene.fog.far = FOG_FAR + (state.cloud > 0.6 ? 40 : 0);

    const backlight = clamp01(view.backlight || 0);
    hemi.color.set(state.hemiSky);
    hemi.groundColor.set(state.hemiGround);
    hemi.intensity = state.hemiI * (1 - backlight * 0.25);
    fill.intensity = 0.08 + state.moonI * 0.12;

    // Днём светит солнце, ночью — луна; в бое свет сзади, силуэт читается.
    const isDay = state.dayness > 0.12;
    const dir = isDay ? state.sunDir : state.moonDir;
    sunLight.position.set(dir[0] * 120, Math.max(dir[1], 0.05) * 120, dir[2] * 120);
    sunLight.color.set(isDay ? state.sunColor : '#a9bcff');
    sunLight.intensity = isDay ? state.sunI * (1 + backlight * 0.5) : state.moonI;

    const dist = SKY_RADIUS * 0.9;
    celestial.sun.position.set(state.sunDir[0] * dist, state.sunDir[1] * dist, state.sunDir[2] * dist);
    celestial.glow.position.copy(celestial.sun.position);
    celestial.glow.scale.setScalar(1.4 + (1 - state.cloud) * 0.8);
    celestial.sun.material.opacity = clamp01(state.elev * 4 + 0.15);
    celestial.glow.material.opacity = clamp01(state.elev * 2) * 0.3;
    celestial.moon.position.set(state.moonDir[0] * dist, state.moonDir[1] * dist, state.moonDir[2] * dist);
    celestial.moon.material.opacity = clamp01(0.25 + state.moonI);
    if (camera) {
      celestial.sun.lookAt(camera.position);
      celestial.glow.lookAt(camera.position);
      celestial.moon.lookAt(camera.position);
    }

    stars.material.opacity = clamp01(1 - state.dayness * 2.4);
    stars.visible = stars.material.opacity > 0.01;

    exposure = state.exposure * (0.9 + backlight * 0.18);
    return exposure;
  }

  function setAmbient(next) {
    if (!next) return;
    if (next.skyTop) ambient.skyTop = next.skyTop;
    if (next.skyBottom) ambient.skyBottom = next.skyBottom;
    if (next.fogColor) ambient.fogColor = next.fogColor;
  }

  function dispose() {
    scene.remove(dome.mesh, celestial.group, stars);
    scene.remove(hemi, fill, sunLight);
    for (const d of disposables) d.dispose?.();
    if (dome.mat.map) dome.mat.map.dispose();
    dome.mat.dispose();
    disposables.length = 0;
  }

  return { update, repaint, setAmbient, dispose, get group() { return dome.mesh; }, hemi, fill, sunLight, stars, celestial };
}
