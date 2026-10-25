/**
 * src/textures/procedural.js — все текстуры рисуются на canvas 2D.
 * Никаких внешних картинок и сетевых запросов: только примитивы контекста.
 * Сигнатуры и экспорт — строго по docs/API.md §5.
 */

const BG = '#101a20';

/** Детерминированный ГПСЧ, чтобы текстуры были одинаковыми при каждом запуске. */
function seeded(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Canvas-контекст 2D с уже залитым фоном.
 * Возвращает именно контекст (как требует API); сам canvas доступен как ctx.canvas.
 */
export function makeCanvas(size = 256) {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    throw new Error('procedural: document.createElement недоступен');
  }
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext('2d');
  if (!ctx) throw new Error('procedural: 2D-контекст недоступен');
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, size, size);
  return ctx;
}

/** Обёртка контекста в CanvasTexture с настройками повтора и цветового пространства. */
function toTexture(THREE, ctx, srgb = true, repeat = true) {
  const tex = new THREE.CanvasTexture(ctx.canvas);
  if (repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  } else {
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
  }
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/** Смешать два hex-цвета средствами three (корректно с color management). */
function mixHex(THREE, a, b, t) {
  return new THREE.Color(a).lerp(new THREE.Color(b), t).getStyle();
}

// Гармоники волн: [амплитуда, kx, ky, фаза]. Целые k дают бесшовный тайл.
const WAVES = [
  [0.55, 3, 1, 0.0], [0.42, -2, 4, 1.7], [0.30, 6, 2, 3.1],
  [0.22, 1, -5, 4.4], [0.16, 9, 7, 2.2], [0.12, -11, 4, 5.5],
  [0.09, 14, -9, 0.9], [0.07, 21, 17, 3.7], [0.05, 27, -13, 5.1],
];

/** Нормаль из суммы синусоид: аналитические производные по u и v. */
function waveNormal(u, v, out) {
  let du = 0;
  let dv = 0;
  for (let i = 0; i < WAVES.length; i++) {
    const w = WAVES[i];
    const c = Math.cos(6.283185307 * (w[1] * u + w[2] * v) + w[3]) * w[0] * 6.283185307;
    du += c * w[1];
    dv += c * w[2];
  }
  const s = 0.042;
  const nx = -du * s;
  const ny = -dv * s;
  const inv = 1 / Math.hypot(nx, ny, 1);
  out[0] = nx * inv;
  out[1] = ny * inv;
  out[2] = inv;
}

/** Карта нормалей воды: гребни и мелкая рябь, бесшовная по обеим осям. */
export function waterNormalTexture(THREE, size = 256) {
  const ctx = makeCanvas(size);
  const n = Math.max(32, Math.floor(size));
  let img = null;
  try {
    img = ctx.createImageData(n, n);
  } catch (err) {
    img = null;
  }
  if (img && img.data && typeof ctx.putImageData === 'function') {
    const data = img.data;
    const normal = [0, 0, 1];
    for (let y = 0; y < n; y++) {
      const v = y / n;
      for (let x = 0; x < n; x++) {
        waveNormal(x / n, v, normal);
        const i = (y * n + x) * 4;
        data[i] = (normal[0] * 0.5 + 0.5) * 255;
        data[i + 1] = (normal[1] * 0.5 + 0.5) * 255;
        data[i + 2] = (normal[2] * 0.5 + 0.5) * 255;
        data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  } else {
    drawStylizedWaves(ctx, n);
  }
  return toTexture(THREE, ctx, false, true);
}

/** Резервный рисунок «ряби» штрихами, если нет доступа к пикселям ImageData. */
function drawStylizedWaves(ctx, n) {
  const rnd = seeded(31);
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 260; i++) {
    const x = rnd() * n;
    const y = rnd() * n;
    const w = 6 + rnd() * 26;
    ctx.strokeStyle = `rgba(${128 + (rnd() * 60) | 0},${140 + (rnd() * 50) | 0},255,.5)`;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + w * 0.5, y - 2 - rnd() * 3, x + w, y);
    ctx.stroke();
  }
}

/** Песок берега: тёплые зёрна, камешки и намывные полосы. */
export function sandTexture(THREE) {
  const s = 256;
  const ctx = makeCanvas(s);
  const rnd = seeded(11);
  const g = ctx.createLinearGradient(0, 0, 0, s);
  g.addColorStop(0, '#cdbb92');
  g.addColorStop(0.55, '#c3ad81');
  g.addColorStop(1, '#d6c7a2');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < 2600; i++) {
    const t = rnd();
    const col = t < 0.5 ? 'rgba(150,130,96,.5)' : t < 0.85 ? 'rgba(230,219,192,.5)' : 'rgba(108,92,66,.45)';
    ctx.fillStyle = col;
    ctx.fillRect(rnd() * s, rnd() * s, 0.7 + rnd() * 1.3, 0.7 + rnd() * 1.3);
  }
  for (let i = 0; i < 26; i++) {
    ctx.beginPath();
    ctx.ellipse(rnd() * s, rnd() * s, 1.6 + rnd() * 2.6, 1.1 + rnd() * 1.9, rnd() * Math.PI, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${120 + (rnd() * 60) | 0},${112 + (rnd() * 50) | 0},${96 + (rnd() * 40) | 0},.7)`;
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(182,164,128,.35)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 16; i++) {
    const y = rnd() * s;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(s * 0.3, y + (rnd() - 0.5) * 14, s * 0.7, y + (rnd() - 0.5) * 14, s, y + (rnd() - 0.5) * 8);
    ctx.stroke();
  }
  return toTexture(THREE, ctx);
}

/** Трава: тёмно-зелёная подложка и плотные пучки травинок. */
export function grassTexture(THREE) {
  const s = 256;
  const ctx = makeCanvas(s);
  const rnd = seeded(23);
  const g = ctx.createLinearGradient(0, 0, 0, s);
  g.addColorStop(0, '#3f5c2b');
  g.addColorStop(0.5, '#365025');
  g.addColorStop(1, '#2b4420');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < 180; i++) {
    ctx.beginPath();
    ctx.ellipse(rnd() * s, rnd() * s, 4 + rnd() * 14, 3 + rnd() * 9, rnd() * Math.PI, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${50 + (rnd() * 30) | 0},${80 + (rnd() * 40) | 0},${36 + (rnd() * 20) | 0},.35)`;
    ctx.fill();
  }
  for (let i = 0; i < 1500; i++) {
    const x = rnd() * s;
    const y = rnd() * s;
    const h = 2 + rnd() * 6;
    ctx.strokeStyle = `rgba(${74 + (rnd() * 60) | 0},${116 + (rnd() * 60) | 0},${44 + (rnd() * 26) | 0},${0.5 + rnd() * 0.45})`;
    ctx.lineWidth = 0.8 + rnd() * 0.8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rnd() - 0.5) * 2.4, y - h);
    ctx.stroke();
  }
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(${190 + (rnd() * 50) | 0},${196 + (rnd() * 40) | 0},${110 + (rnd() * 50) | 0},.55)`;
    ctx.fillRect(rnd() * s, rnd() * s, 1.4, 1.4);
  }
  return toTexture(THREE, ctx);
}

/** Камыш для билбордов: прозрачный фон, стебли, метёлки. */
export function reedTexture(THREE) {
  const s = 128;
  const ctx = makeCanvas(s);
  const rnd = seeded(47);
  if (typeof ctx.clearRect === 'function') ctx.clearRect(0, 0, s, s);
  for (let i = 0; i < 26; i++) {
    const x0 = 10 + rnd() * (s - 20);
    const lean = (rnd() - 0.5) * 30;
    const top = 8 + rnd() * 26;
    ctx.lineWidth = 1.4 + rnd() * 1.8;
    ctx.strokeStyle = `rgba(${78 + (rnd() * 40) | 0},${104 + (rnd() * 40) | 0},${52 + (rnd() * 26) | 0},.95)`;
    ctx.beginPath();
    ctx.moveTo(x0, s);
    ctx.quadraticCurveTo(x0 + lean * 0.4, s * 0.55, x0 + lean, top);
    ctx.stroke();
    if (i % 4 === 0) {
      ctx.fillStyle = 'rgba(96,64,38,.95)';
      ctx.beginPath();
      ctx.ellipse(x0 + lean, top - 5, 2.4 + rnd() * 1.6, 9 + rnd() * 5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    if (i % 3 === 1) {
      ctx.strokeStyle = 'rgba(112,140,68,.8)';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(x0 + lean * 0.6, s * 0.45);
      ctx.quadraticCurveTo(x0 + lean * 0.2 + 14, s * 0.36, x0 + lean * 0.4 + 20, s * 0.28);
      ctx.stroke();
    }
  }
  return toTexture(THREE, ctx, true, false);
}

/** Кора дерева: вертикальные волокна и сучки. */
export function barkTexture(THREE) {
  const s = 128;
  const ctx = makeCanvas(s);
  const rnd = seeded(59);
  const g = ctx.createLinearGradient(0, 0, s, 0);
  g.addColorStop(0, '#4a3524');
  g.addColorStop(0.5, '#573d29');
  g.addColorStop(1, '#402d1f');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < 90; i++) {
    const x = rnd() * s;
    ctx.strokeStyle = `rgba(${18 + (rnd() * 40) | 0},${12 + (rnd() * 26) | 0},${8 + (rnd() * 18) | 0},${0.25 + rnd() * 0.5})`;
    ctx.lineWidth = 0.6 + rnd() * 2.2;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.bezierCurveTo(x + (rnd() - 0.5) * 8, s * 0.33, x + (rnd() - 0.5) * 8, s * 0.66, x + (rnd() - 0.5) * 5, s);
    ctx.stroke();
  }
  for (let i = 0; i < 7; i++) {
    ctx.beginPath();
    ctx.ellipse(rnd() * s, rnd() * s, 3 + rnd() * 4, 6 + rnd() * 8, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(28,20,13,.75)';
    ctx.fill();
  }
  return toTexture(THREE, ctx);
}

/** Вертикальный градиент неба для сферы/плоскости. */
export function skyGradientTexture(THREE, topHex = '#7fb2d9', bottomHex = '#dfeaf2') {
  const s = 256;
  const ctx = makeCanvas(s);
  const g = ctx.createLinearGradient(0, 0, 0, s);
  g.addColorStop(0, topHex);
  g.addColorStop(0.55, mixHex(THREE, topHex, bottomHex, 0.55));
  g.addColorStop(1, bottomHex);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const haze = ctx.createLinearGradient(0, s * 0.5, 0, s);
  haze.addColorStop(0, 'rgba(255,255,255,0)');
  haze.addColorStop(1, 'rgba(255,255,255,0.16)');
  ctx.fillStyle = haze;
  ctx.fillRect(0, s * 0.5, s, s * 0.5);
  const tex = toTexture(THREE, ctx, true, false);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}
