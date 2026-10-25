/**
 * src/scene/fish3d.js — силуэт рыбы у поверхности при вываживании.
 * Форма зависит от fishObj.shape: torpedo (щука/судак), flat (лещ/камбала),
 * round (карп/карась). Цвет — fishObj.color. Три готовые геометрии
 * создаются один раз, при showFishOn только переключаем видимую.
 */
import * as THREE from 'three';
import { clamp, damp } from './util.js';

/** Торпеда: вытянутое тело + хвостовой плавник (сплюснутый конус). */
function torpedoGeoms() {
  const body = new THREE.SphereGeometry(0.5, 12, 9);
  body.scale(2.6, 0.52, 0.42);
  const tail = new THREE.ConeGeometry(0.34, 0.7, 4);
  tail.rotateX(Math.PI / 2);
  tail.scale(1, 0.28, 1);
  tail.translate(-1.35, 0, 0);
  const fin = new THREE.ConeGeometry(0.2, 0.42, 4);
  fin.scale(0.4, 1, 1);
  fin.translate(0, 0.3, 0);
  return [body, tail, fin];
}

/** Плоская рыба (лещ, камбала): широкое сжатое тело и высокий плавник. */
function flatGeoms() {
  const body = new THREE.SphereGeometry(0.5, 12, 9);
  body.scale(1.9, 0.95, 0.2);
  const tail = new THREE.ConeGeometry(0.3, 0.55, 4);
  tail.rotateX(Math.PI / 2);
  tail.scale(1, 0.24, 1);
  tail.translate(-1.02, 0, 0);
  const fin = new THREE.ConeGeometry(0.26, 0.34, 4);
  fin.scale(0.3, 1, 0.35);
  fin.translate(0, 0.6, 0);
  return [body, tail, fin];
}

/** Круглая рыба (карп, карась): высокое округлое тело. */
function roundGeoms() {
  const body = new THREE.SphereGeometry(0.5, 12, 9);
  body.scale(1.6, 1.05, 0.75);
  const tail = new THREE.ConeGeometry(0.32, 0.55, 4);
  tail.rotateX(Math.PI / 2);
  tail.scale(1, 0.3, 1);
  tail.translate(-0.9, 0, 0);
  const fin = new THREE.ConeGeometry(0.18, 0.4, 4);
  fin.scale(0.4, 1, 1);
  fin.translate(0, 0.55, 0);
  return [body, tail, fin];
}

const SHAPES = { torpedo: torpedoGeoms, flat: flatGeoms, round: roundGeoms };

/**
 * Силуэт рыбы.
 * -> { show(fishObj), hide(), update(dt, opts), dispose, group }
 */
export function createFish3d({ scene }) {
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);

  const built = {};
  const allGeo = [];
  const allMat = [];
  for (const key of Object.keys(SHAPES)) {
    const geoms = SHAPES[key]();
    const mat = new THREE.MeshStandardMaterial({
      color: '#7f8f6a',
      roughness: 0.55,
      metalness: 0.18,
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide,
    });
    const sub = new THREE.Group();
    for (const g of geoms) {
      allGeo.push(g);
      const mesh = new THREE.Mesh(g, mat);
      sub.add(mesh);
    }
    sub.visible = false;
    group.add(sub);
    built[key] = { group: sub, mat };
    allMat.push(mat);
  }

  let current = null;      // 'torpedo' | 'flat' | 'round'
  let size = 1;            // общий масштаб от веса рыбы
  let phaseA = 0;
  let phaseB = 0;
  let heading = 0;
  let radius = 2.2;
  let centerZ = -10;
  let jumpTimer = 0;
  let jumpY = 0;
  let visible = false;

  /** Показать силуэт: форма/цвет по fishObj, размер — от кг. */
  function show(fishObj) {
    const shape = fishObj && SHAPES[fishObj.shape] ? fishObj.shape : 'torpedo';
    if (current && built[current]) built[current].group.visible = false;
    current = shape;
    const node = built[shape];
    node.group.visible = true;
    node.mat.color.set(fishObj?.color || '#7f8f6a');
    const kg = Number.isFinite(fishObj?.kg) ? fishObj.kg : 1;
    size = clamp(0.55 + Math.cbrt(Math.max(0.05, kg)) * 0.42, 0.5, 2.1);
    node.group.scale.setScalar(size);
    phaseA = Math.random() * Math.PI * 2;
    centerZ = -10;
    radius = 2.4 + size * 1.3;
    jumpTimer = 1.2 + Math.random();
    jumpY = 0;
    visible = true;
    group.visible = true;
  }

  function hide() {
    visible = false;
    group.visible = false;
    if (current && built[current]) built[current].group.visible = false;
  }

  /**
   * Рыба ходит у поверхности: описывает дугу перед берегом, иногда прыгает.
   * opts: { bobber: Vector3, fight 0..1, phase }
   */
  function update(dt, opts = {}) {
    if (!visible || !current) return;
    const node = built[current];
    const fight = clamp(opts.fight || 0, 0, 1);
    const bob = opts.bobber;
    const zc = bob ? bob.z : centerZ;
    const xc = bob ? bob.x : 0;

    phaseA += dt * (0.7 + fight * 2.4);
    phaseB += dt * (2.1 + fight * 3.2);

    // Рыба «восьмёркой» ходит вокруг поплавка, при вываживании — ближе к берегу.
    const rx = radius * (1 + Math.sin(phaseA * 0.6) * 0.18);
    const x = xc + Math.cos(phaseA) * rx;
    const z = zc + Math.sin(phaseA * 1.6) * radius * 0.55 + (1 - fight) * 1.5;

    jumpTimer -= dt;
    if (jumpTimer <= 0) {
      jumpTimer = 1.6 + Math.random() * 2.2;
      jumpY = 0.4 + Math.random() * 0.6 * (0.5 + fight);
    }
    jumpY = Math.max(0, jumpY - dt * 1.5);
    const hop = jumpY > 0 ? Math.sin((1 - jumpY) * Math.PI) * jumpY * 1.4 : 0;

    group.position.set(x, 0.02 + hop + Math.sin(phaseB) * 0.03, z);
    // Разворот по направлению движения + рыскание.
    const nextX = xc + Math.cos(phaseA + 0.1) * rx;
    const nextZ = zc + Math.sin((phaseA + 0.1) * 1.6) * radius * 0.55;
    heading = damp(heading, Math.atan2(nextX - x, nextZ - z) + Math.PI / 2, 6, dt);
    group.rotation.y = heading;
    group.rotation.z = Math.sin(phaseB * 1.3) * 0.16;
    group.rotation.x = Math.sin(phaseB * 0.9) * 0.1 + (hop > 0 ? -0.25 : 0);
    node.mat.opacity = 0.72 + 0.2 * Math.sin(phaseB * 0.7);
  }

  function dispose() {
    scene.remove(group);
    for (const g of allGeo) g.dispose();
    for (const m of allMat) m.dispose();
  }

  return { show, hide, update, dispose, group, get shape() { return current; }, get size() { return size; } };
}
