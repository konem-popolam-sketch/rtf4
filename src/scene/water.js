/**
 * src/scene/water.js — плоскость воды: нормаль-карта, UV-течение, цвет водоёма.
 * Один draw call: одна геометрия, один материал. Волнение — смещение вершин
 * 41×41 сетки на CPU, мелкая рябь — анимированный offset нормаль-карты.
 */
import * as THREE from 'three';
import { waterNormalTexture } from '../textures/procedural.js';

const SIZE = 700;
const SEG = 40;
/** Вода начинается у линии берега (z ≈ 1) и уходит вдаль до -699. */
const CENTER_Z = -340;

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
      const z = base[i + 2];
      arr[i + 1] =
        Math.sin(x * 0.11 + time * 0.85) * amp +
        Math.sin(z * 0.14 - time * 0.62) * amp * 0.8 +
        Math.sin((x + z) * 0.05 + time * 0.41) * amp * 1.2;
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

  /** Куда бьёт «вода»: отдаём высоту волны в точке — поплавок качается в такт. */
  function waveHeightAt(x, z) {
    return (
      Math.sin(x * 0.11 + time * 0.85) * 0.085 +
      Math.sin(z * 0.14 - time * 0.62) * 0.068 +
      Math.sin((x + z) * 0.05 + time * 0.41) * 0.102
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
