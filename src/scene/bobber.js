/**
 * src/scene/bobber.js — поплавок (красно-белый) и его физика на воде.
 * Поплавок — маленькая модель: сфера-тело, белая полоса, красная антенна,
 * киль-цилиндр. Положение каждый кадр — сумма волны, покачивания, поклёвки
 * и подмотки; при вываживании уходит под воду.
 */
import * as THREE from 'three';
import { damp, clamp } from './util.js';

const SURFACE_Y = 0.02;

/** Модель поплавка: тело-сфера + антенна + киль. ~3 draw call. */
function buildModel() {
  const group = new THREE.Group();
  const geoms = [];
  const mats = [];

  const bodyMat = new THREE.MeshStandardMaterial({ color: '#f2f1ea', roughness: 0.45, metalness: 0.05 });
  const redMat = new THREE.MeshStandardMaterial({ color: '#d0342c', roughness: 0.4, emissive: new THREE.Color('#3a0805'), emissiveIntensity: 0.5 });
  const darkMat = new THREE.MeshStandardMaterial({ color: '#33383d', roughness: 0.7, metalness: 0.3 });
  mats.push(bodyMat, redMat, darkMat);

  const bodyGeo = new THREE.SphereGeometry(0.075, 12, 10);
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.scale.set(1, 1.18, 1);
  geoms.push(bodyGeo);

  // Красная верхняя полусфера — классическая «красно-белая» раскраска.
  const capGeo = new THREE.SphereGeometry(0.0755, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.46);
  const cap = new THREE.Mesh(capGeo, redMat);
  cap.scale.set(1, 1.18, 1);
  cap.position.y = 0.001;
  geoms.push(capGeo);

  const stemGeo = new THREE.CylinderGeometry(0.0085, 0.0115, 0.2, 7);
  const stem = new THREE.Mesh(stemGeo, redMat);
  stem.position.y = 0.15;
  geoms.push(stemGeo);

  const tipGeo = new THREE.SphereGeometry(0.013, 7, 6);
  const tip = new THREE.Mesh(tipGeo, redMat);
  tip.position.y = 0.252;
  geoms.push(tipGeo);

  const keelGeo = new THREE.CylinderGeometry(0.006, 0.004, 0.16, 6);
  const keel = new THREE.Mesh(keelGeo, darkMat);
  keel.position.y = -0.14;
  geoms.push(keelGeo);

  group.add(body, cap, stem, tip, keel);
  return { group, geoms, mats, body, cap };
}

/**
 * Поплавок.
 * -> { group, position, update(dt, opts), setBite, splash, reelTo, hide, show, dispose }
 */
export function createBobber({ scene }) {
  const model = buildModel();
  const group = model.group;
  // Начальная точка: 12 м от берега по центру.
  group.position.set(0, SURFACE_Y, -12);
  scene.add(group);

  const pos = group.position;
  let bite = 0;          // текущая сила поклёвки 0..1
  let biteImpulse = 0;   // затухающий импульс дёрганья
  let dive = 0;          // насколько утоплен под воду
  let tilt = 0;
  let time = 0;
  let visible = true;
  /** Текущая цель по z: её меняют castTo() и подмотка. */
  const target = { x: 0, z: -12 };

  /** Волна в точке: та же функция, что у воды, берём через waveHeightAt. */
  function waveY(x, z, waveHeightAt) {
    return typeof waveHeightAt === 'function' ? waveHeightAt(x, z) : 0;
  }

  /**
   * Каждый кадр: волна + покачивание + поклёвка + подмотка.
   * opts: { waveHeightAt, phase, bite, reel 0..1, fight 0..1 }
   */
  function update(dt, opts = {}) {
    time += dt;
    const phase = opts.phase || 'idle';
    const biteTarget = clamp(opts.bite ?? bite, 0, 1);
    if (biteTarget > bite) biteImpulse = Math.min(1, biteImpulse + (biteTarget - bite) * 1.6);
    bite = damp(bite, biteTarget, 12, dt);
    biteImpulse = Math.max(0, biteImpulse - dt * 1.9);

    // Подмотка: тянем поплавок к берегу, но не ближе 1.5 м.
    const reel = clamp(opts.reel ?? 0, 0, 1);
    if (reel > 0) target.z = Math.min(-1.5, target.z + reel * 9 * dt);

    pos.x = damp(pos.x, target.x, 6, dt);
    pos.z = damp(pos.z, target.z, 6, dt);

    const sinkTarget = phase === 'fight' ? 0.16 + (opts.fight ?? 0) * 0.2 : biteTarget > 0.05 ? biteTarget * 0.22 : biteImpulse * 0.1;
    dive = damp(dive, sinkTarget, 9, dt);

    const wave = waveY(pos.x, pos.z, opts.waveHeightAt);
    const bob = Math.sin(time * 1.9) * 0.012 + Math.sin(time * 3.3 + 1.4) * 0.006;
    pos.y = SURFACE_Y + wave + bob - dive - biteImpulse * Math.sin(time * 26) * 0.05;
    tilt = damp(tilt, biteImpulse * 0.5 + (phase === 'fight' ? 0.35 : 0), 8, dt);
    group.rotation.x = tilt * 0.6 + Math.sin(time * 1.6) * 0.03;
    group.rotation.z = tilt * 0.4 + Math.sin(time * 1.15 + 0.7) * 0.035;
    group.visible = visible;
  }

  /** Поклёвка: сила 0..1, 0 — покой. */
  function setBite(strength) {
    const s = clamp(strength, 0, 1);
    if (s > bite) biteImpulse = Math.max(biteImpulse, s);
    bite = s;
  }

  /** Всплеск в точке поплавка — отдаём координаты наружу. */
  function positionOf() {
    return pos;
  }

  /** Подтянуть поплавок к берегу (f 0..1 — прогресс подмотки). */
  function reelTo(f) {
    const k = clamp(f, 0, 1);
    target.z = -1.5 - 10.5 * (1 - k);
  }

  /** Поставить поплавок в точку заброса по дистанции (метры от берега). */
  function castTo(distM) {
    const d = clamp(distM, 2, 60);
    target.x = 0;
    target.z = -d;
  }

  function hide() {
    visible = false;
    group.visible = false;
  }

  function show() {
    visible = true;
    group.visible = true;
  }

  function dispose() {
    scene.remove(group);
    for (const g of model.geoms) g.dispose();
    for (const m of model.mats) m.dispose();
  }

  return {
    group,
    position: pos,
    update,
    setBite,
    positionOf,
    reelTo,
    castTo,
    hide,
    show,
    dispose,
    get bite() {
      return bite;
    },
  };
}
