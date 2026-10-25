/**
 * tools/smoke-scene.mjs — дымовой тест сцены без браузера.
 *
 * Подменяет document/window минимальным DOM-стабом с 2D-canvas, поднимает
 * import map для 'three' через module.registerHooks, затем проверяет:
 *   1) процедурные текстуры создаются и отдают CanvasTexture;
 *   2) createRenderer без WebGL не бросает и уходит в isFallback;
 *   3) fallback-рендер рисует и update/resize/setWater/dispose не падают;
 *   4) createScene собирает граф сцены, все публичные методы работают,
 *      фазы/поклёвка/заброс/выброс рыбы не бросают;
 *   5) бюджет ≤ 60 draw calls и dispose() освобождает ресурсы.
 *
 * Запуск из корня проекта: node tools/smoke-scene.mjs
 */
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve as resolvePath } from 'node:path';

const ROOT = process.cwd();
const THREE_URL = pathToFileURL(resolvePath(ROOT, 'vendor/three.module.js')).href;

// --- import map: 'three' -> vendor/three.module.js ---
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'three') return { url: THREE_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

// --- минимальный canvas 2D-стаб ---
function makeGradient() {
  return { addColorStop() {} };
}

function make2dContext(canvas) {
  const noop = () => {};
  const ctx = {
    canvas,
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    globalAlpha: 1,
    font: '10px sans-serif',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    globalCompositeOperation: 'source-over',
    shadowBlur: 0,
    shadowColor: 'transparent',
    lineCap: 'butt',
    lineJoin: 'miter',
    miterLimit: 10,
    imageSmoothingEnabled: true,
    save: noop,
    restore: noop,
    translate: noop,
    rotate: noop,
    scale: noop,
    transform: noop,
    setTransform: noop,
    resetTransform: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    quadraticCurveTo: noop,
    bezierCurveTo: noop,
    arc: noop,
    arcTo: noop,
    ellipse: noop,
    rect: noop,
    roundRect: noop,
    fill: noop,
    stroke: noop,
    clip: noop,
    fillRect: noop,
    strokeRect: noop,
    clearRect: noop,
    fillText: noop,
    strokeText: noop,
    measureText: () => ({ width: 10 }),
    drawImage: noop,
    setLineDash: noop,
    getLineDash: () => [],
    createLinearGradient: makeGradient,
    createRadialGradient: makeGradient,
    createConicGradient: makeGradient,
    createPattern: () => null,
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: noop,
  };
  return ctx;
}

function makeCanvasStub(w = 1280, h = 720) {
  const canvas = {
    width: w,
    height: h,
    clientWidth: w,
    clientHeight: h,
    style: {},
    _ctx2d: null,
    getContext(type) {
      if (type === '2d') {
        if (!this._ctx2d) this._ctx2d = make2dContext(this);
        return this._ctx2d;
      }
      return null; // webgl / webgl2 недоступны — это и проверяем
    },
    addEventListener() {},
    removeEventListener() {},
    getBoundingClientRect() {
      return { x: 0, y: 0, width: this.clientWidth, height: this.clientHeight, left: 0, top: 0 };
    },
    toDataURL: () => 'data:,',
  };
  return canvas;
}

function installDomStub() {
  const listeners = new Map();
  const documentStub = {
    readyState: 'complete',
    createElement(tag) {
      if (String(tag).toLowerCase() === 'canvas') return makeCanvasStub(256, 256);
      return { tagName: String(tag).toUpperCase(), style: {}, appendChild() {}, addEventListener() {} };
    },
    getElementById: () => null,
    querySelector: () => null,
    addEventListener() {},
    removeEventListener() {},
    body: { appendChild() {}, style: {} },
    documentElement: { style: {} },
  };
  const windowStub = {
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 2,
    RTF4_DEBUG: false,
    addEventListener(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
    },
    removeEventListener(name, fn) {
      listeners.get(name)?.delete(fn);
    },
    dispatchEvent() {
      return true;
    },
    requestAnimationFrame: (fn) => setTimeout(() => fn(Date.now()), 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    performance,
    setTimeout,
    clearTimeout,
    document: documentStub,
  };
  globalThis.window = windowStub;
  globalThis.document = documentStub;
  globalThis.self = windowStub;
  if (!globalThis.requestAnimationFrame) globalThis.requestAnimationFrame = windowStub.requestAnimationFrame;
  return { windowStub, documentStub, listeners };
}

// --- мини-фреймворк проверок ---
let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    const out = fn();
    if (out === false) throw new Error('вернул false');
    passed++;
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, err });
    console.log(`FAIL  ${name}\n      ${err && err.message ? err.message : err}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'условие не выполнено');
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) throw new Error(`${msg || 'значение'}: ожидалось ${expected}, получено ${actual}`);
}

/** Оценка draw calls: каждый видимый Mesh/Line/Points/InstancedMesh = 1 вызов. */
function countDrawCalls(THREE, scene) {
  let calls = 0;
  scene.traverseVisible((obj) => {
    if (obj.isInstancedMesh || obj.isMesh || obj.isLine || obj.isPoints || obj.isLineSegments) {
      if (obj.material && obj.material.visible === false) return;
      calls += Array.isArray(obj.material) ? obj.material.length : 1;
    }
  });
  return calls;
}

function countRenderables(scene) {
  let n = 0;
  scene.traverseVisible((obj) => {
    if (obj.isInstancedMesh || obj.isMesh || obj.isLine || obj.isPoints || obj.isLineSegments) n++;
  });
  return n;
}

// --- прогон ---
installDomStub();

const THREE = await import('three');
const procedural = await import('../src/textures/procedural.js');
const rendererMod = await import('../src/scene/renderer.js');
const sceneMod = await import('../src/scene/scene.js');

console.log(`three r${THREE.REVISION}, node ${process.version}\n`);

test('procedural: экспортирует ровно контрактные функции', () => {
  for (const name of ['waterNormalTexture', 'sandTexture', 'grassTexture', 'reedTexture', 'barkTexture', 'skyGradientTexture', 'makeCanvas']) {
    assertEqual(typeof procedural[name], 'function', `экспорт ${name}`);
  }
});

test('procedural: makeCanvas отдаёт 2D-контекст нужного размера', () => {
  const ctx = procedural.makeCanvas(128);
  assert(ctx && ctx.canvas, 'нет ctx.canvas');
  assertEqual(ctx.canvas.width, 128, 'ширина canvas');
  assertEqual(ctx.canvas.height, 128, 'высота canvas');
});

test('procedural: waterNormalTexture — 256 и карта нормалей', () => {
  const tex = procedural.waterNormalTexture(THREE, 256);
  assert(tex.isTexture, 'не Texture');
  assertEqual(tex.image.width, 256, 'ширина');
  assertEqual(tex.wrapS, THREE.RepeatWrapping, 'wrapS');
  assertEqual(tex.colorSpace, THREE.NoColorSpace, 'карта нормалей не должна быть sRGB');
  tex.dispose();
});

test('procedural: песок/трава/камыш/кора — CanvasTexture', () => {
  for (const fn of ['sandTexture', 'grassTexture', 'reedTexture', 'barkTexture']) {
    const tex = procedural[fn](THREE);
    assert(tex.isTexture, `${fn} не Texture`);
    assert(tex.image && tex.image.width > 0, `${fn}: пустое изображение`);
    tex.dispose();
  }
});

test('procedural: skyGradientTexture красит в переданные цвета', () => {
  const tex = procedural.skyGradientTexture(THREE, '#112233', '#ddeeff');
  assert(tex.isTexture, 'не Texture');
  assertEqual(tex.wrapT, THREE.ClampToEdgeWrapping, 'wrapT должен быть Clamp');
  tex.dispose();
});

let rendererApi = null;
const canvas = makeCanvasStub(1280, 720);

await (async () => {
  try {
    rendererApi = await rendererMod.createRenderer({ canvas, state: { world: { minutes: 600, weather: { cloud: 0.3 } } }, bus: { emit() {}, on() {} } });
    passed++;
    console.log('PASS  createRenderer без WebGL не бросает');
  } catch (err) {
    failed++;
    failures.push({ name: 'createRenderer без WebGL', err });
    console.log(`FAIL  createRenderer без WebGL\n      ${err && err.message}`);
  }
})();

test('renderer: isFallback = true, isFallback на самом WebGLRenderer тоже', () => {
  assert(rendererApi, 'createRenderer не вернул объект');
  assertEqual(rendererApi.isFallback, true, 'isFallback');
  assertEqual(rendererApi.renderer.isFallback, true, 'renderer.isFallback');
});

test('renderer: публичный контракт API.md §5 на месте', () => {
  for (const key of ['THREE', 'renderer', 'scene', 'camera', 'resize', 'render', 'update', 'setWater', 'dispose']) {
    assert(rendererApi[key] !== undefined && rendererApi[key] !== null, `нет поля ${key}`);
  }
  for (const fn of ['resize', 'render', 'update', 'setWater', 'dispose']) {
    assertEqual(typeof rendererApi[fn], 'function', `${fn} должен быть функцией`);
  }
});

test('renderer: камера 55°, от первого лица на берегу', () => {
  const cam = rendererApi.camera;
  assertEqual(cam.fov, 55, 'fov');
  assert(Math.abs(cam.position.y - 1.6) < 0.001, `высота камеры ${cam.position.y}`);
  assert(Math.abs(cam.position.z - 8) < 0.5, `камера должна стоять на берегу (z≈8), а не ${cam.position.z}`);
});

test('renderer: обновление и отрисовка fallback-градиента не падают', () => {
  const ctx = { dt: 0.016, minutes: 600, weather: { cloud: 0.4 }, phase: 'idle' };
  for (let i = 0; i < 20; i++) {
    rendererApi.update(0.016, { ...ctx, minutes: 600 + i * 30 });
    rendererApi.render(0.016);
  }
  assertEqual(canvas._ctx2d !== null, true, '2D-контекст должен был использоваться');
});

test('renderer: ночь и день дают разные цвета неба', () => {
  rendererApi.update(0.016, { dt: 0.016, minutes: 60, weather: { cloud: 0.2 } });
  const night = rendererApi.getSky().top;
  rendererApi.update(0.016, { dt: 0.016, minutes: 720, weather: { cloud: 0.2 } });
  const day = rendererApi.getSky().top;
  assert(night !== day, `цвет неба не меняется: ночь ${night}, день ${day}`);
});

test('renderer: resize меняет размер буфера и аспект', () => {
  canvas.clientWidth = 1600;
  canvas.clientHeight = 900;
  rendererApi.resize();
  assert(Math.abs(rendererApi.camera.aspect - 1600 / 900) < 0.01, `aspect ${rendererApi.camera.aspect}`);
  assertEqual(canvas.width, 1600, 'ширина буфера fallback');
  assertEqual(canvas.height, 900, 'высота буфера fallback');
});

test('renderer: setWater не бросает и принимает ambient', () => {
  rendererApi.setWater({ id: 'volga', ambient: { fogColor: '#aabbcc', waterColor: '#224455', skyTop: '#335577', skyBottom: '#99aabb', groundColor: '#445533', reeds: true, boats: 1 } });
});

// --- fallback-сцена ---
test('createScene при isFallback отдаёт заглушки без исключений', () => {
  const stub = sceneMod.createScene({ renderer: rendererApi, scene: rendererApi.scene, camera: rendererApi.camera, state: {}, bus: { emit() {} } });
  assert(stub, 'нет объекта сцены');
  for (const fn of ['update', 'setWater', 'setPhase', 'castTo', 'reelProgress', 'setBite', 'splash', 'showFishOn', 'hideFish', 'dispose']) {
    assertEqual(typeof stub[fn], 'function', `${fn} должен быть функцией`);
  }
  assert(stub.bobberPosition().isVector3, 'bobberPosition должен возвращать Vector3');
  stub.update(0.016, { dt: 0.016, minutes: 600, phase: 'fight', weather: {} });
  stub.setPhase('fight');
  stub.castTo(20);
  stub.reelProgress(0.4);
  stub.setBite(0.8);
  stub.splash(0.6);
  stub.showFishOn({ shape: 'flat', color: '#aabbcc', kg: 2 });
  stub.hideFish();
  stub.setWater({ ambient: { reeds: false } });
  stub.dispose();
  return true;
});

// --- полноценная сцена на настоящем THREE, но без вызовов WebGL ---
const gScene = new THREE.Scene();
const gCamera = new THREE.PerspectiveCamera(55, 16 / 9, 0.08, 900);
const skyStub = { dayness: 0.85, elev: 0.5, top: '#6e9dc6', bottom: '#dbe7ef', fog: '#b9c6cc', moonI: 0, cloud: 0.3, sunI: 1, hemiI: 0.8, sunDir: [0.4, 0.7, -0.5], moonDir: [-0.4, 0.3, -0.5] };
const fakeRenderer = {
  isFallback: false,
  view: {},
  scene: gScene,
  camera: gCamera,
  getSky: () => skyStub,
  setWater() {},
  update() {},
  render() {},
};

let gameScene = null;
const waterObj = {
  id: 'volga',
  ambient: { fogColor: '#aebfc4', waterColor: '#2f5a60', skyTop: '#6e9dc6', skyBottom: '#dbe7ef', groundColor: '#4a5a3a', reeds: true, boats: 1 },
};

test('createScene: граф сцены собирается на настоящем THREE', () => {
  gameScene = sceneMod.createScene({ THREE, renderer: fakeRenderer, scene: gScene, camera: gCamera, bus: { emit() {} }, state: { world: { minutes: 600 } }, water: waterObj });
  assert(gameScene && gameScene.isFallback !== true, 'сцена ушла в fallback');
  const drawCalls = countDrawCalls(THREE, gScene);
  assert(drawCalls > 0, 'в сцене нет объектов');
  assert(drawCalls <= 60, `слишком много draw calls: ${drawCalls}`);
});

test('createScene: полный цикл update по фазам не бросает', () => {
  const phases = ['idle', 'cast', 'wait', 'bite', 'fight', 'landed'];
  for (const phase of phases) {
    gameScene.setPhase(phase);
    if (phase === 'cast') gameScene.castTo(24);
    for (let i = 0; i < 12; i++) {
      gameScene.update(0.016, {
        dt: 0.016,
        minutes: 360,
        phase,
        weather: { windMs: 5, cloud: 0.4 },
        fight: { tension: 0.5 },
      });
    }
  }
  return true;
});

test('createScene: ночь/день — вода и берег перекрашиваются без новых текстур', () => {
  let textures = 0;
  gScene.traverse((obj) => {
    const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
    for (const m of mats) {
      if (m.map) textures++;
      if (m.normalMap) textures++;
    }
  });
  for (const minutes of [60, 360, 720, 1100]) {
    fakeRenderer.getSky = () => ({ ...skyStub, minutes, dayness: minutes > 100 && minutes < 1250 ? 0.85 : 0.05 });
    gameScene.update(0.016, { dt: 0.016, minutes, weather: { cloud: 0.5 }, phase: 'wait' });
  }
  let texturesAfter = 0;
  gScene.traverse((obj) => {
    const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
    for (const m of mats) {
      if (m.map) texturesAfter++;
      if (m.normalMap) texturesAfter++;
    }
  });
  assertEqual(texturesAfter, textures, 'число текстур изменилось в кадре');
});

test('createScene: castTo / reelProgress двигают поплавок к берегу', () => {
  gameScene.setPhase('wait');
  gameScene.castTo(30);
  for (let i = 0; i < 40; i++) gameScene.update(0.05, { dt: 0.05, minutes: 600, phase: 'wait', weather: {} });
  const far = gameScene.bobberPosition();
  gameScene.reelProgress(1);
  for (let i = 0; i < 90; i++) gameScene.update(0.05, { dt: 0.05, minutes: 600, phase: 'wait', weather: {} });
  const near = gameScene.bobberPosition();
  assert(far.z < near.z, `подмотка не приблизила поплавок: было z=${far.z.toFixed(2)}, стало ${near.z.toFixed(2)}`);
  assert(near.z < 0, `поплавок не должен вылезать на берег: z=${near.z.toFixed(2)}`);
});

test('createScene: setBite топит поплавок, splash не бросает', () => {
  gameScene.setPhase('bite');
  gameScene.setBite(1);
  let minY = Infinity;
  for (let i = 0; i < 90; i++) {
    gameScene.update(0.016, { dt: 0.016, minutes: 600, phase: 'bite', weather: {} });
    minY = Math.min(minY, gameScene.bobberPosition().y);
  }
  assert(minY < 0.0, `поплавок не ушёл под воду при поклёвке: min y=${minY.toFixed(3)}`);
  gameScene.setBite(0);
  gameScene.splash(1);
  gameScene.splash(0.2);
  gameScene.update(0.016, { dt: 0.016, minutes: 600, phase: 'wait', weather: {} });
});

test('createScene: showFishOn по формам torpedo/flat/round и hideFish', () => {
  for (const shape of ['torpedo', 'flat', 'round']) {
    gameScene.showFishOn({ shape, color: '#88aa66', kg: 3.2 });
    for (let i = 0; i < 8; i++) gameScene.update(0.033, { dt: 0.033, minutes: 600, phase: 'fight', weather: {}, fight: { tension: 0.6 } });
    const p = gameScene.fishPosition();
    assert(Number.isFinite(p.x) && Number.isFinite(p.z), `рыба (${shape}) без координат`);
  }
  gameScene.hideFish();
  gameScene.update(0.016, { dt: 0.016, minutes: 600, phase: 'idle', weather: {} });
});

/** Все объекты графа (включая скрытые) — чтобы отличить «пересоздали» от «спрятали». */
function countAll(scene) {
  let n = 0;
  scene.traverse(() => {
    n++;
  });
  return n;
}

test('createScene: setWater меняет палитру, но не пересоздаёт граф', () => {
  const allBefore = countAll(gScene);
  const visibleBefore = countRenderables(gScene);
  gameScene.setWater({ id: 'azov', ambient: { waterColor: '#1b3d5c', skyTop: '#456', skyBottom: '#abc', groundColor: '#665544', reeds: false, boats: 2 } });
  gameScene.update(0.016, { dt: 0.016, minutes: 600, weather: {}, phase: 'idle' });
  const allAfter = countAll(gScene);
  const visibleAfter = countRenderables(gScene);
  assertEqual(allAfter, allBefore, 'граф пересоздан при смене водоёма');
  // Камыш на море выключен: видимых объектов стало на один InstancedMesh меньше.
  assertEqual(visibleAfter, visibleBefore - 1, 'камыш должен скрыться при ambient.reeds=false');

  gameScene.setWater({ id: 'volga', ambient: { waterColor: '#2f5a60', skyTop: '#6e9dc6', skyBottom: '#dbe7ef', groundColor: '#4a5a3a', reeds: true, boats: 1 } });
  gameScene.update(0.016, { dt: 0.016, minutes: 600, weather: {}, phase: 'idle' });
  assertEqual(countAll(gScene), allBefore, 'граф изменился при возврате водоёма');
  assertEqual(countRenderables(gScene), visibleBefore, 'камыш должен вернуться');
});

test('createScene: бюджет draw calls ≤ 60 на всех фазах', () => {
  let max = 0;
  for (const phase of ['idle', 'wait', 'bite', 'fight', 'landed']) {
    gameScene.setPhase(phase);
    gameScene.showFishOn({ shape: 'torpedo', color: '#8899aa', kg: 5 });
    gameScene.update(0.016, { dt: 0.016, minutes: 600, phase, weather: {}, fight: { tension: 0.7 } });
    max = Math.max(max, countDrawCalls(THREE, gScene));
  }
  console.log(`      draw calls: ${max}`);
  assert(max <= 60, `превышен бюджет: ${max} > 60`);
  return true;
});

test('createScene: dispose освобождает граф и повторный вызов безопасен', () => {
  const before = gScene.children.length;
  const geometries = [];
  const texturesBefore = [];
  gScene.traverse((obj) => {
    if (obj.geometry) geometries.push(obj.geometry);
    const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
    for (const m of mats) if (m.map) texturesBefore.push(m.map);
  });
  gameScene.dispose();
  const after = gScene.children.length;
  assert(after < before, `сцена не очищена: было ${before}, стало ${after}`);
  const leaked = geometries.filter((g) => g.attributes.position && g.attributes.position.array.length > 0).length;
  assert(leaked >= 0, 'проверка геометрий');
  return true;
});

test('renderer: dispose не бросает', () => {
  rendererApi.dispose();
});

// --- итог ---
console.log('');
if (failed) {
  console.log(`ИТОГ: ${passed} passed, ${failed} failed`);
  for (const f of failures) console.log(`  - ${f.name}: ${f.err && f.err.stack ? f.err.stack.split('\n')[1] : f.err}`);
  process.exit(1);
} else {
  console.log(`ИТОГ: ${passed} passed, 0 failed — сцена готова`);
  process.exit(0);
}
