/**
 * src/scene/rod.js — удочка от первого лица справа + леска до поплавка.
 * Удочка живёт в системе координат камеры (камера в сцене), леска — в мировой:
 * её точки каждый кадр считаются от кончика удилища к поплавку с провисом.
 */
import * as THREE from 'three';
import { sagOffset, damp } from './util.js';

const ROD_LEN = 2.55;
const LINE_SEGMENTS = 18; // 12..20 по контракту
const LOCAL_TIP = new THREE.Vector3();

/** Собрать удилище: рукоять, бланк, катушка, кольца, вершинка. */
function buildRodModel() {
  const group = new THREE.Group();
  const geoms = [];
  const mats = [];

  const corkMat = new THREE.MeshStandardMaterial({ color: '#8b6b4a', roughness: 0.85 });
  const blankMat = new THREE.MeshStandardMaterial({ color: '#2a2f35', roughness: 0.35, metalness: 0.35 });
  const metalMat = new THREE.MeshStandardMaterial({ color: '#9aa3ab', roughness: 0.3, metalness: 0.85 });
  const tipMat = new THREE.MeshStandardMaterial({ color: '#e8ecef', roughness: 0.4 });
  mats.push(corkMat, blankMat, metalMat, tipMat);

  // Рукоять вдоль +Y, основание в нуле группы.
  const gripGeo = new THREE.CylinderGeometry(0.021, 0.026, 0.34, 10);
  const grip = new THREE.Mesh(gripGeo, corkMat);
  grip.position.y = 0.17;
  geoms.push(gripGeo);

  // Бланк — сужающийся цилиндр на всю длину.
  const blankGeo = new THREE.CylinderGeometry(0.0055, 0.019, ROD_LEN, 9);
  const blank = new THREE.Mesh(blankGeo, blankMat);
  blank.position.y = 0.34 + ROD_LEN / 2;
  geoms.push(blankGeo);

  // Вершинка (контрастный кончик) — видна на фоне воды.
  const tipGeo = new THREE.CylinderGeometry(0.0055, 0.0075, 0.16, 8);
  const tip = new THREE.Mesh(tipGeo, tipMat);
  tip.position.y = 0.34 + ROD_LEN - 0.07;
  geoms.push(tipGeo);

  // Катушка сбоку у рукояти.
  const reelBodyGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.058, 12);
  const reelBody = new THREE.Mesh(reelBodyGeo, metalMat);
  reelBody.rotation.z = Math.PI / 2;
  reelBody.position.set(0.052, 0.28, 0.012);
  geoms.push(reelBodyGeo);

  const spoolGeo = new THREE.CylinderGeometry(0.036, 0.036, 0.032, 12);
  const spool = new THREE.Mesh(spoolGeo, blankMat);
  spool.rotation.z = Math.PI / 2;
  spool.position.set(0.086, 0.28, 0.012);
  geoms.push(spoolGeo);

  const handleGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.07, 6);
  const handle = new THREE.Mesh(handleGeo, metalMat);
  handle.position.set(0.086, 0.33, 0.05);
  handle.rotation.x = Math.PI / 2.6;
  geoms.push(handleGeo);

  // Два «кольца» — короткие полые цилиндры вдоль бланка.
  for (let i = 0; i < 2; i++) {
    const ringGeo = new THREE.CylinderGeometry(0.016, 0.016, 0.012, 8, 1, true);
    const ring = new THREE.Mesh(ringGeo, metalMat);
    ring.position.y = 1.05 + i * 0.75;
    ring.position.z = 0.016;
    ring.rotation.x = 0.12;
    geoms.push(ringGeo);
    group.add(ring);
  }

  group.add(grip, blank, tip, reelBody, spool, handle);
  return { group, geoms, mats, spool, tipMesh: tip };
}

/**
 * Удочка + леска.
 * -> { group, line, update(dt, opts), tipWorld, dispose }
 */
export function createRod({ scene, camera, rodRig }) {
  const model = buildRodModel();
  const group = model.group;

  // Положение «в руках» справа: чуть ниже центра, ближе к правому краю кадра.
  group.position.set(0.34, -0.52, -0.5);
  group.rotation.set(-1.16, 0.16, -0.22);

  // Удочка — ребёнок камеры (или её подгруппы): всегда в кадре, справа внизу.
  const parent = rodRig && typeof rodRig.add === 'function' ? rodRig : camera;
  const holder = new THREE.Group();
  holder.name = 'rod-holder';
  holder.add(group);
  parent.add(holder);

  // Леска: одна линия с фиксированным числом вершин — двигаем только позиции.
  const positions = new Float32Array(LINE_SEGMENTS * 3);
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const lineMat = new THREE.LineBasicMaterial({ color: '#e9eef2', transparent: true, opacity: 0.55, fog: true });
  const line = new THREE.Line(lineGeo, lineMat);
  line.frustumCulled = false;
  scene.add(line);

  const tipWorld = new THREE.Vector3();
  const target = new THREE.Vector3(0, 0.05, -8);
  let bend = 0;
  let sag = 0.55;
  let reel = 0;
  let time = 0;

  /** Мировая точка кончика удилища (для скелета лески и натяжения). */
  function computeTip() {
    group.updateWorldMatrix(true, false);
    LOCAL_TIP.set(0, 0.34 + ROD_LEN, 0);
    tipWorld.copy(LOCAL_TIP).applyMatrix4(group.matrixWorld);
    return tipWorld;
  }

  /**
   * Каждый кадр: изгиб удилища по фазе, провис лески, позиции 18 вершин.
   * opts: { bobber: Vector3, phase, fightLoad 0..1, bite 0..1, reelSpeed 0..1 }
   */
  function update(dt, opts = {}) {
    time += dt;
    const phase = opts.phase || 'idle';
    const load = Math.min(1, Math.max(0, opts.fightLoad || 0));
    const bite = Math.min(1, Math.max(0, opts.bite || 0));

    // Удилище гнётся вниз при вываживании и в момент подсечки.
    const bendTarget = phase === 'fight' ? 0.16 + load * 0.42 : phase === 'bite' ? 0.1 + bite * 0.1 : phase === 'cast' ? -0.06 : 0;
    bend = damp(bend, bendTarget, 7, dt);
    group.rotation.x = -1.16 + bend;
    group.rotation.z = -0.22 + Math.sin(time * 1.7) * 0.004 + (phase === 'fight' ? Math.sin(time * 9) * 0.01 * load : 0);
    group.position.z = -0.5 + (phase === 'fight' ? Math.sin(time * 6.2) * 0.012 * load : 0);

    // Катушка вращается при подмотке.
    reel += dt * (opts.reelSpeed || 0) * 14;
    if (model.spool && model.spool.rotation) model.spool.rotation.x = reel;

    computeTip();
    if (opts.bobber) target.copy(opts.bobber);
    const dist = Math.max(0.6, tipWorld.distanceTo(target));

    // Провис зависит от дистанции и натяжения: в бое — почти прямая.
    const sagTarget = phase === 'fight' ? 0.06 + (1 - load) * 0.3 : Math.min(1.4, 0.28 + dist * 0.035);
    sag = damp(sag, sagTarget, 4, dt);

    const pos = lineGeo.attributes.position.array;
    for (let i = 0; i < LINE_SEGMENTS; i++) {
      const t = i / (LINE_SEGMENTS - 1);
      const x = tipWorld.x + (target.x - tipWorld.x) * t;
      const z = tipWorld.z + (target.z - tipWorld.z) * t;
      const baseY = tipWorld.y + (target.y - tipWorld.y) * t;
      // Провис — парабола, плюс лёгкое дрожание от ветра.
      const wobble = Math.sin(time * 2.4 + t * 5.5) * 0.012 * t * (1 - t) * 4;
      pos[i * 3] = x;
      pos[i * 3 + 1] = baseY + sagOffset(t, sag) + wobble;
      pos[i * 3 + 2] = z;
    }
    lineGeo.attributes.position.needsUpdate = true;
    lineGeo.computeBoundingSphere();
    line.visible = !!opts.visible;
  }

  /** Смена снасти/оснастки: цвет бланка и длина не меняются, но леску можно спрятать. */
  function setVisible(visible) {
    group.visible = visible;
    line.visible = visible;
  }

  function dispose() {
    scene.remove(line);
    parent.remove(holder);
    holder.remove(group);
    lineGeo.dispose();
    lineMat.dispose();
    for (const g of model.geoms) g.dispose();
    for (const m of model.mats) m.dispose();
  }

  return { group, line, update, computeTip, tipWorld, setVisible, dispose };
}
