/**
 * src/scene/shore.js — берег: песок у воды, трава выше, камыш инстансами,
 * деревья (цилиндр+конус) и мостки с лодкой из боксов.
 * Все текстуры создаются один раз в createShore и переиспользуются.
 */
import * as THREE from 'three';
import { sandTexture, grassTexture, reedTexture, barkTexture } from '../textures/procedural.js';
import { seededRnd, toColor } from './util.js';

const BANK_Z = 1;      // линия уреза воды
const SAND_DEPTH = 7;  // ширина песчаной полосы
const GRASS_FAR = 120; // докуда тянется трава

/** Клонировать текстуру берега с нужным повтором (сам canvas общий). */
function tiled(tex, rx, ry) {
  const t = tex.clone();
  t.needsUpdate = true;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  return t;
}

/** Горизонтальная плоскость берега с текстурой. */
function groundPlane(width, depth, zCenter, y, map) {
  const geo = new THREE.PlaneGeometry(width, depth, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.94, metalness: 0.02 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(0, y, zCenter);
  mesh.receiveShadow = false;
  return mesh;
}

/** Крест из двух плоскостей: один инстанс-меш даёт «объёмный» куст камыша. */
function makeCrossGeometry(w, h) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const quad = (ax, az, bx, bz) => {
    const base = positions.length / 3;
    positions.push(ax, 0, az, bx, 0, bz, bx, h, bz, ax, h, az);
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  quad(-w * 0.5, 0, w * 0.5, 0);
  quad(0, -w * 0.5, 0, w * 0.5);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Камыш: 40..200 инстансов скрещённых билбордов — 1 draw call. */
function buildReeds(reedTex) {
  const geo = makeCrossGeometry(0.9, 1.9);
  const mat = new THREE.MeshBasicMaterial({
    map: reedTex,
    transparent: true,
    alphaTest: 0.32,
    side: THREE.DoubleSide,
    depthWrite: true,
  });
  const count = 120;
  const inst = new THREE.InstancedMesh(geo, mat, count);
  inst.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  const rnd = seededRnd(90210);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const axisY = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const scale = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    // Две куртины по краям, чтобы середина воды оставалась свободной для заброса.
    const side = i % 2 === 0 ? -1 : 1;
    pos.set(side * (12 + rnd() * 62), 0.9, 2.6 + rnd() * 4.6);
    q.setFromAxisAngle(axisY, rnd() * Math.PI);
    const s = 0.72 + rnd() * 0.8;
    scale.set(s, s * (0.85 + rnd() * 0.5), s);
    m.compose(pos, q, scale);
    inst.setMatrixAt(i, m);
  }
  inst.instanceMatrix.needsUpdate = true;
  inst.frustumCulled = false;
  return { inst, geo, mat, count };
}

/** Дерево: ствол-цилиндр и две конические кроны — 3 draw call на дерево. */
function buildTree({ height, radius, crown, seed, barkTex }) {
  const rnd = seededRnd(seed);
  const group = new THREE.Group();
  const trunkGeo = new THREE.CylinderGeometry(radius * 0.7, radius, height * 0.62, 7, 1);
  const trunkMat = new THREE.MeshStandardMaterial({ map: barkTex, color: '#9b8465', roughness: 0.95 });
  const trunk = new THREE.Mesh(trunkGeo, trunkMat);
  trunk.position.y = height * 0.31;
  const crownMat = new THREE.MeshStandardMaterial({ color: crown, roughness: 0.9, flatShading: true });
  const crownGeoA = new THREE.ConeGeometry(radius * 8.5, height * 0.52, 8);
  const crownGeoB = new THREE.ConeGeometry(radius * 6.2, height * 0.4, 8);
  const c1 = new THREE.Mesh(crownGeoA, crownMat);
  c1.position.y = height * 0.62;
  const c2 = new THREE.Mesh(crownGeoB, crownMat);
  c2.position.y = height * 0.84;
  group.add(trunk, c1, c2);
  group.rotation.y = rnd() * Math.PI * 2;
  group.scale.setScalar(0.9 + rnd() * 0.35);
  return { group, geoms: [trunkGeo, crownGeoA, crownGeoB], mats: [trunkMat, crownMat], crownMat };
}

/** Мостки: настил, сваи и доски — инстансами, лодки — боксами. */
function buildPier(boats) {
  const group = new THREE.Group();
  const woodMat = new THREE.MeshStandardMaterial({ color: '#6b503a', roughness: 0.9 });
  const darkMat = new THREE.MeshStandardMaterial({ color: '#3f342a', roughness: 0.95 });
  const boatMat = new THREE.MeshStandardMaterial({ color: '#5c6b57', roughness: 0.85 });
  const geoms = [];
  const m4 = new THREE.Matrix4();
  const add = (geo, mat, x, y, z, ry = 0) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.rotation.y = ry;
    group.add(mesh);
    geoms.push(geo);
    return mesh;
  };

  add(new THREE.BoxGeometry(2.6, 0.14, 9), woodMat, 3.2, 0.42, -1.6);

  const postGeo = new THREE.BoxGeometry(0.2, 1.5, 0.2);
  const posts = new THREE.InstancedMesh(postGeo, darkMat, 4);
  for (let i = 0; i < 4; i++) {
    m4.makeTranslation(2.1 + (i % 2) * 2.2, 0.12, 0.9 - Math.floor(i / 2) * 4.4);
    posts.setMatrixAt(i, m4);
  }
  posts.instanceMatrix.needsUpdate = true;
  group.add(posts);
  geoms.push(postGeo);

  const plankGeo = new THREE.BoxGeometry(2.7, 0.06, 0.16);
  const planks = new THREE.InstancedMesh(plankGeo, darkMat, 3);
  for (let i = 0; i < 3; i++) {
    m4.makeTranslation(3.2, 0.5, 1.4 - i * 0.5);
    planks.setMatrixAt(i, m4);
  }
  planks.instanceMatrix.needsUpdate = true;
  group.add(planks);
  geoms.push(plankGeo);

  if (boats > 0) {
    add(new THREE.BoxGeometry(1.5, 0.42, 3.4), boatMat, -2.6, 0.16, -0.4, 0.32);
    const bow = add(new THREE.ConeGeometry(0.75, 1.1, 4), boatMat, -2.6 + Math.sin(0.32) * 2.2, 0.16, -0.4 + Math.cos(0.32) * 2.2, 0.32);
    bow.rotation.z = Math.PI / 2;
    add(new THREE.BoxGeometry(1.3, 0.08, 0.4), darkMat, -2.6, 0.4, -0.2, 0.32);
  }
  if (boats > 1) {
    add(new THREE.BoxGeometry(1.2, 0.34, 2.8), boatMat, -9.5, 0.13, -3.2, -0.5);
  }
  return { group, geoms, mats: [woodMat, darkMat, boatMat] };
}

/** Системное время в секундах — для лёгкого покачивания камыша. */
function nowSec() {
  return (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) / 1000;
}

/**
 * Собрать берег под конкретный водоём.
 * -> { group, reeds, reedsEnabled, trees, pier, applyAmbient, animate, setWater, dispose }
 */
export function createShore({ scene, ambient }) {
  const group = new THREE.Group();
  scene.add(group);

  // Текстуры — ровно пять, все создаются здесь и переиспользуются.
  const sandTex = tiled(sandTexture(THREE), 26, 2);
  const grassTex = tiled(grassTexture(THREE), 40, 16);
  const reedTex = reedTexture(THREE);
  const barkTex = barkTexture(THREE);

  const sand = groundPlane(300, SAND_DEPTH, BANK_Z + SAND_DEPTH / 2 - 0.4, 0.004, sandTex);
  const grass = groundPlane(320, GRASS_FAR, BANK_Z + SAND_DEPTH + GRASS_FAR / 2 - 0.4, 0.02, grassTex);
  group.add(sand, grass);

  const reedsOn = ambient?.reeds !== false;
  const reeds = buildReeds(reedTex);
  reeds.inst.visible = reedsOn;
  group.add(reeds.inst);

  const trees = [
    buildTree({ height: 8.5, radius: 0.3, crown: '#33512c', seed: 3, barkTex }),
    buildTree({ height: 6.4, radius: 0.22, crown: '#3d5b2f', seed: 8, barkTex }),
    buildTree({ height: 5.2, radius: 0.18, crown: '#2c4626', seed: 15, barkTex }),
  ];
  const treeSpots = [
    [14, BANK_Z + 9.5],
    [-17, BANK_Z + 12.5],
    [26, BANK_Z + 16],
  ];
  trees.forEach((t, i) => {
    t.group.position.set(treeSpots[i][0], 0, treeSpots[i][1]);
    group.add(t.group);
  });

  const pier = buildPier(Number.isFinite(ambient?.boats) ? ambient.boats : 1);
  group.add(pier.group);

  const groundTint = new THREE.Color('#4a5a3a');
  const sandTint = new THREE.Color('#d8c49a');
  const reedTint = new THREE.Color('#8d9a5a');
  let t = 0;

  /** Смена водоёма: цвет земли/травы/камыша и наличие камыша и лодок. */
  function applyAmbient(next) {
    if (!next) return;
    groundTint.copy(toColor(THREE, next.groundColor || '#4a5a3a'));
    grass.material.color.copy(groundTint);
    sand.material.color.copy(sandTint).lerp(groundTint, 0.18);
    reedTint.copy(toColor(THREE, next.reedsColor || '#8d9a5a'));
    reeds.mat.color.copy(reedTint);
    reeds.inst.visible = next.reeds !== false;
    const boats = Number.isFinite(next.boats) ? next.boats : 1;
    let idx = 0;
    for (const child of pier.group.children) {
      // Первые три объекта — настил/сваи/доски, остальное — лодки.
      const isBoat = child.material === pier.mats[2];
      child.visible = !isBoat || boats > 0;
      if (isBoat) idx++;
      if (boats < 2 && idx > 0 && child.position.x < -6) child.visible = false;
    }
  }

  // Базовые цвета крон — чтобы вечером притушить их, не теряя исходный оттенок.
  for (const tree of trees) tree.crownMat.userData.base = tree.crownMat.color.clone();

  /** Покачивание камыша и крон, притухание зелени ночью. */
  function animate(dt, sky) {
    t += dt;
    const wind = 0.5 + Math.sin(t * 0.23) * 0.5;
    if (reeds.inst.visible) {
      reeds.inst.rotation.z = Math.sin(t * 0.9) * 0.012 * wind;
      reeds.inst.rotation.x = Math.sin(t * 0.63 + 1.1) * 0.008 * wind;
    }
    for (let i = 0; i < trees.length; i++) {
      trees[i].group.rotation.z = Math.sin(t * 0.42 + i * 1.7) * 0.006 * (0.5 + wind);
    }
    const light = sky ? 0.22 + sky.dayness * 0.78 : 1;
    for (const tree of trees) {
      tree.crownMat.color.copy(tree.crownMat.userData.base).multiplyScalar(light);
    }
    reeds.mat.color.copy(reedTint).multiplyScalar(light);
  }

  function dispose() {
    scene.remove(group);
    for (const mesh of [sand, grass]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    sandTex.dispose();
    grassTex.dispose();
    reeds.geo.dispose();
    reeds.mat.dispose();
    barkTex.dispose();
    reedTex.dispose();
    for (const tree of trees) {
      for (const g of tree.geoms) g.dispose();
      for (const m of tree.mats) m.dispose();
    }
    for (const g of pier.geoms) g.dispose();
    for (const m of pier.mats) m.dispose();
  }

  return {
    group,
    reeds: reeds.inst,
    reedsEnabled: () => reeds.inst.visible,
    reedCount: reeds.count,
    trees,
    pier,
    sand,
    grass,
    applyAmbient,
    animate,
    nowSec,
    dispose,
  };
}
