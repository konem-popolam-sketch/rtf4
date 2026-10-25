/**
 * src/scene/water.js — плоскость воды: нормаль-карта, UV-течение, цвет водоёма.
 * Один draw call: одна геометрия, один материал. Волнение — смещение вершин
 * 41×41 сетки на CPU, мелкая рябь — анимированный offset нормаль-карты.
 */
import * as THREE from 'three';
import { waterNormalTexture } from '../textures/procedural.js';

const SIZE = 700;
const SEG = 40;
/** Вода начинается чуть под песком (z ≈ 0.8) и уходит вдаль. */
const CENTER_Z = 0.8 - SIZE / 2;
/** У берега волны гасим, иначе гребни протыкают песок. */
const SHORE_FADE_M = 14;

export function createWater({ scene, ambient }) {
  const normalMap = waterNormalTexture(THREE, 256);
  normalMap.repeat.set(26, 26);

  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);

  const mat = new THREE.MeshStandardMaterial({
    color: ambient?.waterColor || '#2f5a60',
    normalMap,
    normalScale: new THREE.Vector2(0.55, 0.55),
    metalness: 0.3,
    roughness: 0.26,
    emissive: new THREE.Color('#0b1a22'),
    emissiveIntensity: 0.3,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(0, 0, CENTER_Z);
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  scene.add(mesh);

  const base = Float32Array.from(geo.attributes.position.array);
  const tint = new THREE.Color(ambient?.waterColor || '#2f5a60');
  const scratch = new THREE.Color();
  const deep = new THREE.Color('#0a1620');
  let time = 0;

  /** Волнение: три бегущие волны; нормали задаёт карта, поэтому пересчёт не нужен. */
  function animate(dt, speed = 1) {
    time += dt * speed;
    const pos = geo.attributes.position;
    const arr = pos.array;
    const amp = 0.085;
    for (let i = 0; i < arr.length; i += 3) {
      const x = base[i];
      const zWorld = base[i + 2] + CENTER_Z;
      // У берега волну гасим плавно: гребни не должны протыкать песок.
      const shoreFade = Math.min(1, Math.max(0, -zWorld / SHORE_FADE_M));
      const a = amp * (0.25 + shoreFade * 0.75);
      arr[i + 1] =
        (Math.sin(x * 0.11 + time * 0.85) +
          Math.sin(zWorld * 0.14 - time * 0.62) * 0.8 +
          Math.sin((x + zWorld) * 0.05 + time * 0.41) * 1.2) *
        a;
    }
    pos.needsUpdate = true;
    normalMap.offset.x = (normalMap.offset.x + dt * 0.014) % 1;
    normalMap.offset.y = (normalMap.offset.y + dt * 0.009) % 1;
  }

  /** Цвет и блеск воды следуют суточной палитре (плавно, без скачков). */
  function applySky(sky) {
    if (!sky) return;
    const day = sky.dayness;
    scratch.copy(tint).multiplyScalar(0.3 + day * 0.85).lerp(deep, 1 - day);
    mat.color.lerp(scratch, 0.06);
    mat.emissiveIntensity = 0.16 + day * 0.28;
    mat.roughness = 0.34 - day * 0.12;
    mat.metalness = 0.22 + day * 0.1;
    const ns = 0.4 + day * 0.25;
    mat.normalScale.set(ns, ns);
  }

  /** Смена водоёма: цвет воды берём из ambient.waterColor. */
  function setAmbient(next) {
    if (next?.waterColor) {
      tint.set(next.waterColor);
      mat.color.set(next.waterColor);
    }
  }

  /** Высота волны в мировой точке — поплавок качается в такт с водой. */
  function waveHeightAt(x, z) {
    const shoreFade = Math.min(1, Math.max(0, -z / SHORE_FADE_M));
    const a = 0.25 + shoreFade * 0.75;
    return (
      (Math.sin(x * 0.11 + time * 0.85) +
        Math.sin(z * 0.14 - time * 0.62) * 0.8 +
        Math.sin((x + z) * 0.05 + time * 0.41) * 1.2) *
      0.085 *
      a
    );
  }

  function dispose() {
    scene.remove(mesh);
    geo.dispose();
    mat.dispose();
    normalMap.dispose();
  }

  return { mesh, material: mat, normalMap, animate, applySky, setAmbient, waveHeightAt, dispose };
}
