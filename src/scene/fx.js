/**
 * src/scene/fx.js — всплески на воде: расходящееся кольцо + Points-брызги.
 * Пул эффектов: объекты создаются один раз при сборке сцены и затем
 * только переиспользуются (никаких новых геометрий/материалов в кадре).
 */
import * as THREE from 'three';

const RINGS = 4;
const DROPS = 26;

/** Одно кольцо-волна: плоское CircleGeometry-кольцо, растёт и тает. */
function makeRingGeometry() {
  const geo = new THREE.RingGeometry(0.72, 1, 28);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

function makeDropsGeometry() {
  const pos = new Float32Array(DROPS * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return geo;
}

/**
 * Эффекты всплесков.
 * -> { splash(x, z, size), update(dt), dispose }
 */
export function createFx({ scene }) {
  const ringGeo = makeRingGeometry();
  const dropGeo = makeDropsGeometry();
  const rings = [];
  const splashes = [];

  for (let i = 0; i < RINGS; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: '#dff2f6',
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(ringGeo, mat);
    mesh.rotation.x = 0;
    mesh.visible = false;
    mesh.renderOrder = 5;
    scene.add(mesh);
    rings.push({ mesh, mat, age: 1, life: 1, scale: 1, active: false });
  }

  const dropMat = new THREE.PointsMaterial({
    color: '#eaf7fb',
    size: 0.13,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    sizeAttenuation: true,
    blending: THREE.AdditiveBlending,
  });
  const drops = new THREE.Points(dropGeo, dropMat);
  drops.visible = false;
  drops.frustumCulled = false;
  scene.add(drops);

  // Состояние частиц брызг: скорость и стартовая позиция для каждой капли.
  const dropVel = new Float32Array(DROPS * 3);
  let dropAge = 1;
  let dropLife = 0.85;

  function nextRing() {
    for (const r of rings) if (!r.active) return r;
    // Все заняты — переиспользуем самый старый.
    return rings.reduce((a, b) => (a.age > b.age ? a : b));
  }

  /**
   * Всплеск в точке (x, z) на воде. size 0..1 — сила.
   */
  function splash(x, z, size = 0.5) {
    const s = Math.min(1, Math.max(0.05, Number.isFinite(size) ? size : 0.5));
    const ring = nextRing();
    ring.active = true;
    ring.age = 0;
    ring.life = 0.55 + s * 0.75;
    ring.scale = 0.25 + s * 0.5;
    ring.mat.opacity = 0.85;
    ring.mat.color.set(s > 0.7 ? '#f4fbff' : '#dff2f6');
    ring.mesh.position.set(x, 0.045, z);
    ring.mesh.visible = true;
    ring.mesh.scale.setScalar(ring.scale);

    // Брызги: перезапускаем все капли из точки всплеска.
    const arr = dropGeo.attributes.position.array;
    for (let i = 0; i < DROPS; i++) {
      const a = (i / DROPS) * Math.PI * 2 + Math.random() * 0.5;
      const r = Math.random() * 0.22 * (0.4 + s);
      arr[i * 3] = x + Math.cos(a) * r;
      arr[i * 3 + 1] = 0.03;
      arr[i * 3 + 2] = z + Math.sin(a) * r;
      const sp = (0.5 + Math.random() * 1.5) * (0.45 + s);
      dropVel[i * 3] = Math.cos(a) * sp * 0.45;
      dropVel[i * 3 + 1] = sp;
      dropVel[i * 3 + 2] = Math.sin(a) * sp * 0.45;
    }
    dropGeo.attributes.position.needsUpdate = true;
    dropAge = 0;
    dropLife = 0.55 + s * 0.5;
    dropMat.size = 0.08 + s * 0.1;
    drops.visible = true;
    splashes.push({ x, z, size: s, t: 0 });
  }

  /** Кадр: кольца растут, брызги падают под гравитацией. */
  function update(dt) {
    for (const r of rings) {
      if (!r.active) continue;
      r.age += dt;
      const k = Math.min(1, r.age / r.life);
      const sc = r.scale + k * (2.4 + r.scale * 3);
      r.mesh.scale.setScalar(sc);
      r.mat.opacity = Math.max(0, 0.85 * (1 - k) * (1 - k));
      if (k >= 1) {
        r.active = false;
        r.mesh.visible = false;
      }
    }

    if (drops.visible) {
      dropAge += dt;
      const arr = dropGeo.attributes.position.array;
      for (let i = 0; i < DROPS; i++) {
        dropVel[i * 3 + 1] -= 9.2 * dt;
        arr[i * 3] += dropVel[i * 3] * dt;
        arr[i * 3 + 1] += dropVel[i * 3 + 1] * dt;
        arr[i * 3 + 2] += dropVel[i * 3 + 2] * dt;
        if (arr[i * 3 + 1] < -0.2) arr[i * 3 + 1] = -0.2;
      }
      dropGeo.attributes.position.needsUpdate = true;
      dropMat.opacity = Math.max(0, 0.9 * (1 - dropAge / dropLife));
      if (dropAge >= dropLife) drops.visible = false;
    }

    for (let i = splashes.length - 1; i >= 0; i--) {
      splashes[i].t += dt;
      if (splashes[i].t > 2) splashes.splice(i, 1);
    }
  }

  function dispose() {
    for (const r of rings) {
      scene.remove(r.mesh);
      r.mat.dispose();
    }
    scene.remove(drops);
    ringGeo.dispose();
    dropGeo.dispose();
    dropMat.dispose();
  }

  return { splash, update, dispose, get activeSplashes() { return splashes.length; } };
}
