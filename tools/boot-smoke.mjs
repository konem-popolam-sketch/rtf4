/**
 * boot-smoke.mjs — запуск игры в Node без браузера.
 *
 * Зачем: в этой песочнице нельзя запустить ни headless Chrome, ни puppeteer
 * (spawn EPERM), поэтому единственный способ поймать ошибки инициализации —
 * подставить минимальный DOM/Canvas и прогнать реальный boot из src/main.js.
 * Проверяется: все импорты разрешаются, boot доходит до кнопки «Начать»,
 * старт игры и несколько кадров не бросают исключений.
 *
 * Запуск: node tools/boot-smoke.mjs
 * Выход 0 — игра поднялась; 1 — упала (печатается стек).
 */

/* --------------------- резолвер голого `three` для Node ---------------------
 * В браузере `import * as THREE from 'three'` находит vendor/three.module.js
 * через importmap в index.html. В Node importmap не существует, поэтому без
 * этой регистрации смоук падал на первом же импорте сцены и не проверял НИЧЕГО
 * из того, что идёт после. Регистрируем ровно тот же vendor-файл — тогда смоук
 * гоняет тот three.js, который реально уедет на сайт.
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

if (typeof register === 'function') {
  register('./three-resolver.mjs', pathToFileURL(`${import.meta.dirname}/`));
}

/* ------------------------------ DOM-заглушки ------------------------------ */

const noop = () => {};

function makeStyle() {
  return new Proxy(
    {},
    {
      get: (t, k) => (k in t ? t[k] : ''),
      set: (t, k, v) => {
        t[k] = v;
        return true;
      },
    },
  );
}

function makeClassList(node) {
  const set = new Set();
  return {
    add: (...names) => names.forEach((n) => set.add(n)),
    remove: (...names) => names.forEach((n) => set.delete(n)),
    toggle: (n, force) => {
      const want = force === undefined ? !set.has(n) : Boolean(force);
      if (want) set.add(n);
      else set.delete(n);
      return want;
    },
    contains: (n) => set.has(n),
    replace: (a, b) => {
      set.delete(a);
      set.add(b);
    },
    get length() {
      return set.size;
    },
    _set: set,
    _node: node,
  };
}

let nodeSeq = 0;

/* ------------------------- мини-парсер HTML для заглушки -------------------------
 * Панели строят разметку через innerHTML, поэтому заглушке нужен хоть какой-то
 * парсер. Поддерживается подмножество, которого хватает интерфейсу: теги,
 * атрибуты в кавычках и без, текст, комментарии, VOID-теги. Этого достаточно,
 * чтобы querySelector из панелей находил свои узлы.
 */

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', laquo: '«', raquo: '»', mdash: '—', ndash: '–' };

function decodeEntities(text) {
  return String(text).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** Разобрать HTML в массив узлов и повесить их на parent. */
function parseHtmlInto(parent, html, ownerDoc) {
  const src = String(html == null ? '' : html);
  let i = 0;
  const stack = [parent];

  const pushText = (text) => {
    if (!text) return;
    const decoded = decodeEntities(text);
    if (!decoded.trim()) {
      // Пробельные узлы не нужны интерфейсу, но textContent должен их видеть.
      const top = stack[stack.length - 1];
      top._text = (top._text || '') + decoded;
      return;
    }
    const node = { nodeType: 3, textContent: decoded, parentElement: stack[stack.length - 1], parentNode: stack[stack.length - 1] };
    const top = stack[stack.length - 1];
    top.children.push(node);
    top.childNodes.push(node);
    top._text = (top._text || '') + decoded;
  };

  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) {
      pushText(src.slice(i));
      break;
    }
    if (lt > i) pushText(src.slice(i, lt));

    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      i = end < 0 ? src.length : end + 3;
      continue;
    }
    if (src.startsWith('<!', lt) || src.startsWith('<?', lt)) {
      const end = src.indexOf('>', lt);
      i = end < 0 ? src.length : end + 1;
      continue;
    }

    const gt = src.indexOf('>', lt);
    if (gt < 0) {
      pushText(src.slice(lt));
      break;
    }
    const raw = src.slice(lt + 1, gt);
    i = gt + 1;

    if (raw[0] === '/') {
      const name = raw.slice(1).trim().toLowerCase();
      for (let s = stack.length - 1; s > 0; s -= 1) {
        if (stack[s].tagName.toLowerCase() === name) {
          stack.length = s;
          break;
        }
      }
      continue;
    }

    const selfClosing = raw.endsWith('/');
    const body = selfClosing ? raw.slice(0, -1) : raw;
    const m = /^([a-zA-Z][\w:-]*)([\s\S]*)$/.exec(body);
    if (!m) continue;
    const tag = m[1].toLowerCase();
    const node = el(tag, ownerDoc);
    applyAttributes(node, m[2] || '');
    stack[stack.length - 1].appendChild(node);
    if (!selfClosing && !VOID_TAGS.has(tag)) stack.push(node);
  }
}

const ATTR_RE = /([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

function applyAttributes(node, text) {
  ATTR_RE.lastIndex = 0;
  let m = ATTR_RE.exec(text);
  while (m) {
    const name = m[1].toLowerCase();
    const value = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
    node.attributes[name] = value;
    if (name === 'class') {
      node.className = value;
      for (const cls of value.split(/\s+/).filter(Boolean)) node.classList.add(cls);
    } else if (name === 'id') {
      node.id = value;
    } else if (name === 'hidden') {
      node.hidden = true;
    } else if (name === 'disabled') {
      node.disabled = true;
    } else if (name === 'value') {
      node.value = value;
    } else if (name === 'checked') {
      node.checked = true;
    } else if (name.startsWith('data-')) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      node.dataset[key] = value;
    } else if (name === 'style') {
      for (const part of value.split(';')) {
        const [prop, val] = part.split(':');
        if (prop && val) node.style[prop.trim()] = val.trim();
      }
    }
    m = ATTR_RE.exec(text);
  }
}

/* ------------------------------ селекторы ------------------------------ */

function splitSelector(selector) {
  // Поддерживаем только потомков (пробел) — остального интерфейсу не нужно.
  return String(selector).trim().split(/\s+/).filter(Boolean);
}

function matchCompound(node, compound) {
  if (!node || node.nodeType !== 1) return false;
  const re = /([#.]?)([\w-]+|\[[^\]]+\])/g;
  let m = re.exec(compound);
  let any = false;
  while (m) {
    any = true;
    const kind = m[1];
    const name = m[2];
    if (kind === '#') {
      if (node.id !== name) return false;
    } else if (kind === '.') {
      if (!node.classList.contains(name)) return false;
    } else if (name[0] === '[') {
      const inner = name.slice(1, -1);
      const eq = inner.indexOf('=');
      if (eq < 0) {
        if (!(inner in node.attributes)) return false;
      } else {
        const key = inner.slice(0, eq).trim();
        const want = inner.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
        if (String(node.attributes[key] ?? '') !== want) return false;
      }
    } else if (String(node.tagName).toLowerCase() !== name.toLowerCase()) {
      return false;
    }
    m = re.exec(compound);
  }
  return any;
}

function matchChain(node, parts) {
  let current = [node];
  for (let p = parts.length - 1; p >= 0; p -= 1) {
    const compound = parts[p];
    const next = [];
    for (const candidate of current) {
      // Для последней части проверяем сам узел, для остальных — предков.
      if (p === parts.length - 1) {
        if (matchCompound(candidate, compound)) next.push(candidate);
      } else {
        let up = candidate;
        while ((up = up.parentElement)) {
          if (matchCompound(up, compound)) {
            next.push(candidate);
            break;
          }
        }
      }
    }
    if (next.length === 0) return null;
    if (p === 0) return next[0] || null;
    current = next;
  }
  return null;
}

function collectDescendants(node, out = []) {
  for (const child of node.children || []) {
    if (child.nodeType === 1) {
      out.push(child);
      collectDescendants(child, out);
    }
  }
  return out;
}

/** Текстовое содержимое поддерева. */
function subtreeText(node) {
  if (!node || node.nodeType === 3) return node ? node.textContent : '';
  let text = node._text || '';
  return text;
}

function el(tagName = 'div', ownerDoc = null) {
  const node = {
    tagName: String(tagName).toUpperCase(),
    nodeType: 1,
    __id: ++nodeSeq,
    id: '',
    className: '',
    hidden: false,
    disabled: false,
    width: 1600,
    height: 900,
    clientWidth: 1600,
    clientHeight: 900,
    offsetWidth: 1600,
    offsetHeight: 900,
    value: '',
    textContent: '',
    innerHTML: '',
    innerText: '',
    checked: false,
    dataset: {},
    style: makeStyle(),
    attributes: {},
    children: [],
    childNodes: [],
    parentElement: null,
    parentNode: null,
    ownerDocument: ownerDoc,
    scrollTop: 0,
    scrollHeight: 100,
    _listeners: new Map(),
  };

  node.classList = makeClassList(node);
  node.appendChild = (child) => {
    if (!child) return child;
    child.parentElement = node;
    child.parentNode = node;
    node.children.push(child);
    node.childNodes.push(child);
    return child;
  };
  node.insertBefore = (child) => node.appendChild(child);
  node.removeChild = (child) => {
    node.children = node.children.filter((c) => c !== child);
    node.childNodes = node.childNodes.filter((c) => c !== child);
    if (child) child.parentElement = null;
    return child;
  };
  node.replaceChild = (next, prev) => {
    node.removeChild(prev);
    return node.appendChild(next);
  };
  node.remove = () => {
    if (node.parentElement) node.parentElement.removeChild(node);
  };
  node.append = (...kids) => kids.forEach((k) => (typeof k === 'string' ? noop() : node.appendChild(k)));
  node.prepend = (k) => node.appendChild(k);

  // innerHTML: разбор подмножества HTML, достаточного панелям интерфейса.
  Object.defineProperty(node, 'innerHTML', {
    configurable: true,
    get: () => node._html || '',
    set: (html) => {
      node._html = String(html == null ? '' : html);
      node.children = [];
      node.childNodes = [];
      node._text = '';
      parseHtmlInto(node, node._html, ownerDoc);
    },
  });
  Object.defineProperty(node, 'textContent', {
    configurable: true,
    get: () => {
      if (node._ownText != null) return node._ownText;
      return node._text || '';
    },
    set: (text) => {
      node._ownText = String(text == null ? '' : text);
      node._text = node._ownText;
      node.children = [];
      node.childNodes = [];
      node._html = '';
    },
  });
  Object.defineProperty(node, 'firstElementChild', {
    configurable: true,
    get: () => node.children.find((c) => c && c.nodeType === 1) || null,
  });
  Object.defineProperty(node, 'lastElementChild', {
    configurable: true,
    get: () => {
      const list = node.children.filter((c) => c && c.nodeType === 1);
      return list[list.length - 1] || null;
    },
  });
  Object.defineProperty(node, 'childElementCount', {
    configurable: true,
    get: () => node.children.filter((c) => c && c.nodeType === 1).length,
  });

  node.querySelector = (selector) => {
    const parts = splitSelector(selector);
    if (parts.length === 0) return null;
    for (const candidate of collectDescendants(node)) {
      if (matchChain(candidate, parts)) return candidate;
    }
    return null;
  };
  node.querySelectorAll = (selector) => {
    const parts = splitSelector(selector);
    if (parts.length === 0) return [];
    return collectDescendants(node).filter((candidate) => matchChain(candidate, parts));
  };
  node.closest = (selector) => {
    const parts = splitSelector(selector);
    let up = node;
    while (up) {
      if (up.nodeType === 1 && matchChain(up, parts)) return up;
      up = up.parentElement;
    }
    return null;
  };
  node.matches = (selector) => matchCompound(node, String(selector).trim());
  node.getElementsByTagName = (name) => {
    const want = String(name).toLowerCase();
    return collectDescendants(node).filter((c) => c.tagName.toLowerCase() === want);
  };
  node.getElementsByClassName = (name) => collectDescendants(node).filter((c) => c.classList.contains(name));
  node.contains = (other) => {
    let up = other;
    while (up) {
      if (up === node) return true;
      up = up.parentElement;
    }
    return false;
  };
  node.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, width: 1600, height: 900, right: 1600, bottom: 900 });
  node.getAttribute = (k) => (k in node.attributes ? node.attributes[k] : null);
  node.setAttribute = (k, v) => {
    node.attributes[k] = String(v);
    if (k === 'class') {
      node.className = String(v);
      for (const cls of String(v).split(/\s+/).filter(Boolean)) node.classList.add(cls);
    } else if (k === 'id') node.id = String(v);
  };
  node.removeAttribute = (k) => {
    delete node.attributes[k];
  };
  node.hasAttribute = (k) => k in node.attributes;
  node.focus = noop;
  node.blur = noop;
  node.click = () => node.dispatchEvent({ type: 'click', target: node });
  node.scrollIntoView = noop;
  node.setPointerCapture = noop;
  node.releasePointerCapture = noop;
  node.attachShadow = () => node;
  node.cloneNode = () => el(tagName, ownerDoc);
  node.animate = () => ({ finished: Promise.resolve(), cancel: noop, finish: noop });

  node.addEventListener = (type, fn, opts) => {
    if (typeof fn !== 'function') return;
    if (!node._listeners.has(type)) node._listeners.set(type, []);
    const list = node._listeners.get(type);
    if (!list.includes(fn)) list.push(fn);
    // once-подписки помечаем, чтобы dispatchEvent снимал их после вызова.
    if (opts && (opts === true || opts.once)) fn.__once = true;
  };
  node.removeEventListener = (type, fn) => {
    const list = node._listeners.get(type);
    if (list) node._listeners.set(type, list.filter((f) => f !== fn));
  };
  node.dispatchEvent = (event) => {
    const ev = event && typeof event === 'object' ? event : { type: String(event) };
    ev.target = ev.target || node;
    ev.currentTarget = node;
    ev.preventDefault = ev.preventDefault || noop;
    ev.stopPropagation = ev.stopPropagation || noop;
    const list = (node._listeners.get(ev.type) || []).slice();
    for (const fn of list) {
      try {
        fn.call(node, ev);
      } catch (err) {
        reportError(`listener ${ev.type}`, err);
      }
      if (fn.__once) node.removeEventListener(ev.type, fn);
    }
    return !ev.defaultPrevented;
  };

  return node;
}

/** Контекст 2D: всё, что ни спросят — тихий no-op или пустой объект. */
function make2dContext(canvas) {
  const state = { canvas, fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, font: '10px sans-serif' };
  const gradient = { addColorStop: noop };
  return new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'createLinearGradient' || key === 'createRadialGradient' || key === 'createPattern') return () => gradient;
      if (key === 'createImageData') return (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(4 * w * h) });
      if (key === 'getImageData') return (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(4 * w * h) });
      if (key === 'measureText') return () => ({ width: 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 });
      if (key === 'isPointInPath') return () => false;
      return () => undefined;
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    },
  });
}

function makeCanvas(ownerDoc) {
  const canvas = el('canvas', ownerDoc);
  canvas.getContext = (kind) => {
    if (kind === '2d') return make2dContext(canvas);
    // WebGL отдаём null: рендерер обязан уйти в fallback и не упасть.
    return null;
  };
  canvas.toDataURL = () => 'data:image/png;base64,';
  canvas.toBlob = (cb) => cb && cb(null);
  canvas.transferControlToOffscreen = () => canvas;
  canvas.captureStream = () => ({ getTracks: () => [] });
  return canvas;
}

function createDocument() {
  const doc = {
    readyState: 'complete',
    hidden: false,
    visibilityState: 'visible',
    title: '',
    _byId: new Map(),
    _listeners: new Map(),
    documentElement: el('html'),
    head: el('head'),
    body: el('body'),
    fonts: { ready: Promise.resolve(), add: noop, load: () => Promise.resolve([]) },
  };

  doc.createElement = (tag) => (String(tag).toLowerCase() === 'canvas' ? makeCanvas(doc) : el(tag, doc));
  doc.createElementNS = (_ns, tag) => doc.createElement(tag);
  doc.createTextNode = (text) => ({ nodeType: 3, textContent: String(text), parentElement: null });
  doc.createDocumentFragment = () => el('fragment', doc);
  doc.getElementById = (id) => {
    if (!doc._byId.has(id)) {
      const node = el(id === 'scene' ? 'canvas' : 'div', doc);
      node.id = id;
      if (id === 'scene') Object.assign(node, makeCanvas(doc), { id });
      doc._byId.set(id, node);
      doc.body.appendChild(node);
    }
    return doc._byId.get(id);
  };
  doc.querySelector = (sel) => (typeof sel === 'string' && sel.startsWith('#') ? doc.getElementById(sel.slice(1)) : null);
  doc.querySelectorAll = () => [];
  doc.getElementsByTagName = () => [];
  doc.getElementsByClassName = () => [];
  doc.addEventListener = (type, fn) => {
    if (!doc._listeners.has(type)) doc._listeners.set(type, []);
    doc._listeners.get(type).push(fn);
  };
  doc.removeEventListener = (type, fn) => {
    const list = doc._listeners.get(type);
    if (list) doc._listeners.set(type, list.filter((f) => f !== fn));
  };
  doc.dispatchEvent = (event) => {
    const list = (doc._listeners.get(event && event.type) || []).slice();
    for (const fn of list) fn.call(doc, event);
    return true;
  };
  doc.exitPointerLock = noop;
  doc.exitFullscreen = () => Promise.resolve();
  doc.elementFromPoint = () => null;
  return doc;
}

/* ------------------------------ окружение ------------------------------ */

const problems = [];

function reportError(where, err) {
  problems.push(`${where}: ${err && (err.stack || err.message ? (err.stack || err.message) : err)}`);
}

const documentStub = createDocument();
const windowListeners = new Map();

const localStorageStub = (() => {
  const map = new Map();
  return {
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(String(k)) ? map.get(String(k)) : null),
    setItem: (k, v) => map.set(String(k), String(v)),
    removeItem: (k) => map.delete(String(k)),
    clear: () => map.clear(),
  };
})();

let rafSeq = 0;
const rafQueue = new Map();

const windowStub = {
  document: documentStub,
  name: 'rtf4-smoke',
  innerWidth: 1600,
  innerHeight: 900,
  devicePixelRatio: 1,
  location: { href: 'http://127.0.0.1:8080/', search: '', hash: '', pathname: '/', origin: 'http://127.0.0.1:8080' },
  navigator: { userAgent: 'node-smoke', language: 'ru-RU', maxTouchPoints: 0, hardwareConcurrency: 4 },
  localStorage: localStorageStub,
  matchMedia: (q) => ({ matches: false, media: q, addEventListener: noop, removeEventListener: noop, addListener: noop }),
  requestAnimationFrame: (cb) => {
    const id = ++rafSeq;
    rafQueue.set(id, cb);
    return id;
  },
  cancelAnimationFrame: (id) => rafQueue.delete(id),
  setTimeout: (fn, ms) => setTimeout(fn, Math.min(Number(ms) || 0, 5)),
  clearTimeout: (id) => clearTimeout(id),
  setInterval: (fn, ms) => setInterval(fn, Math.max(Number(ms) || 0, 1000)),
  clearInterval: (id) => clearInterval(id),
  addEventListener: (type, fn) => {
    if (!windowListeners.has(type)) windowListeners.set(type, []);
    windowListeners.get(type).push(fn);
  },
  removeEventListener: (type, fn) => {
    const list = windowListeners.get(type);
    if (list) windowListeners.set(type, list.filter((f) => f !== fn));
  },
  dispatchEvent: (event) => {
    const list = (windowListeners.get(event && event.type) || []).slice();
    for (const fn of list) fn.call(windowStub, event);
    return true;
  },
  getComputedStyle: () => ({ getPropertyValue: () => '', fontSize: '16px', width: '1600px', height: '900px' }),
  alert: noop,
  confirm: () => true,
  prompt: () => null,
  scrollTo: noop,
  focus: noop,
  open: () => null,
  URL: globalThis.URL,
  AudioContext: undefined,
  webkitAudioContext: undefined,
  OffscreenCanvas: undefined,
  performance: globalThis.performance,
};

globalThis.window = windowStub;
globalThis.document = documentStub;
globalThis.localStorage = localStorageStub;
// navigator в Node 21+ — геттер без сеттера: подменяем определение, а не значение.
try {
  Object.defineProperty(globalThis, 'navigator', { value: windowStub.navigator, configurable: true, writable: true });
} catch {
  /* остаёмся на встроенном navigator */
}
globalThis.requestAnimationFrame = windowStub.requestAnimationFrame;
globalThis.cancelAnimationFrame = windowStub.cancelAnimationFrame;
globalThis.devicePixelRatio = 1;
globalThis.location = windowStub.location;
globalThis.self = globalThis;
globalThis.HTMLCanvasElement = function HTMLCanvasElement() {};
globalThis.Image = class Image {
  constructor() {
    this.src = '';
    this.width = 1;
    this.height = 1;
  }
  addEventListener() {}
  removeEventListener() {}
};
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close: noop });
globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};
globalThis.IntersectionObserver = class IntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};
globalThis.PointerEvent = class PointerEvent {
  constructor(type, init) {
    Object.assign(this, init || {}, { type });
  }
};
if (!globalThis.matchMedia) globalThis.matchMedia = windowStub.matchMedia;

process.on('unhandledRejection', (err) => reportError('unhandledRejection', err));
process.on('uncaughtException', (err) => reportError('uncaughtException', err));

/* ------------------------------ сам прогон ------------------------------ */

const realError = console.error;
console.error = (...args) => {
  // Ошибки, которые код печатает сам, — тоже провал смоука.
  const first = args[0];
  if (typeof first === 'string' && /\[(boot|game|scene|hud|panels|audio)\]/.test(first)) {
    problems.push(`console.error: ${args.map((a) => (a && a.message) || String(a)).join(' ')}`);
  }
  realError(...args);
};
const realWarn = console.warn;
console.warn = (...args) => {
  const first = args[0];
  if (typeof first === 'string' && /не загрузился|не создалась|не запустилась/.test(first)) {
    problems.push(`console.warn: ${args.map((a) => (a && a.message) || String(a)).join(' ')}`);
  }
  realWarn(...args);
};

function pumpFrames(count) {
  for (let i = 0; i < count; i += 1) {
    const batch = [...rafQueue.entries()];
    rafQueue.clear();
    for (const [, cb] of batch) {
      try {
        cb(performance.now());
      } catch (err) {
        reportError('requestAnimationFrame', err);
      }
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await import('../src/main.js');

  // Ждём, пока boot() пройдёт асинхронные импорты.
  for (let i = 0; i < 60 && !globalThis.RTF4; i += 1) {
    await sleep(20);
    pumpFrames(1);
  }

  // #fatal в реальной разметке скрыт атрибутом hidden. В заглушке элемента может
  // не быть вовсе, поэтому судим по тексту: показанная панель ошибки всегда с текстом.
  const fatalText = documentStub.getElementById('fatal-text');
  const fatalTextBox = fatalText && fatalText.textContent;
  if (fatalTextBox && String(fatalTextBox).trim()) {
    problems.push(`#fatal показан: ${String(fatalTextBox).trim().slice(0, 400)}`);
  }

  if (!globalThis.RTF4) {
    problems.push('boot не дошёл до глобального RTF4 — игра не поднялась');
  } else {
    const { game, state, renderer } = globalThis.RTF4;
    if (!state || !state.world) problems.push('state.world отсутствует');
    if (!renderer || typeof renderer.update !== 'function') problems.push('renderer без update()');
    if (!game || typeof game.start !== 'function') problems.push('game без start()');
    else {
      // Старт — как у игрока: кнопкой на загрузочном экране, а не вызовом start().
      const startBtn = documentStub.getElementById('btn-start');
      if (startBtn && typeof startBtn.click === 'function') {
        try {
          startBtn.click();
        } catch (err) {
          reportError('клик «Начать рыбалку»', err);
        }
      }
      if (!game.started) problems.push('кнопка «Начать рыбалку» не запустила игру');
      try {
        game.start();
      } catch (err) {
        reportError('game.start', err);
      }
      pumpFrames(30);
      // Один заброс целиком: cast → wait → bite → strike → fight.
      try {
        game.actionCast?.(0.8);
      } catch (err) {
        reportError('actionCast', err);
      }
      // Полёт поплавка — настоящий setTimeout на 0.45..1.4 с, поэтому ждём по-настоящему.
      const seen = new Set();
      const observe = () => {
        if (game.phase) seen.add(game.phase);
      };
      for (let i = 0; i < 40; i += 1) {
        pumpFrames(2);
        observe();
        await sleep(40);
      }
      pumpFrames(20);
      observe();
      if (!seen.has('wait')) problems.push(`после заброса не наступила фаза ожидания (видели: ${[...seen].join(' → ') || '—'})`);
      if (!game.cast) problems.push('game.cast не заполнен после заброса');
      if (!state.stats || (state.stats.casts || 0) < 1) problems.push('state.stats.casts не вырос после заброса');
      // Подсечка: если рыба уже клюнула — проверяем вход в вываживание.
      try {
        game.actionStrike?.();
      } catch (err) {
        reportError('actionStrike', err);
      }
      pumpFrames(60);
      observe();
      console.log(`   фазы за прогон: ${[...seen].join(' → ')}`);

      // Полный цикл улова: поклёвка → подсечка → вываживание → садок.
      // Кадры приходится раздвигать по-настоящему по времени: update() берёт dt
      // из performance.now(), и без паузы весь бой уложился бы в 0 секунд.
      const busy = (ms) => {
        const until = performance.now() + ms;
        while (performance.now() < until) { /* ждём кадр */ }
      };
      try {
        game.biteTimer = 0;
        pumpFrames(2);
        if (game.phase !== 'bite') problems.push(`поклёвка не наступила (фаза ${game.phase})`);
        game.actionStrike?.();
        pumpFrames(2);
        if (game.phase !== 'fight') problems.push(`подсечка не начала вываживание (фаза ${game.phase})`);
        const catchesBefore = Number(state.stats.catches) || 0;
        const fishBefore = state.inventory.fish.length;
        let endStatus = '—';
        let maxTension = 0;
        const { bus } = globalThis.RTF4;
        bus?.on?.('fight:end', (e) => {
          endStatus = e?.status || '—';
        });
        let frames = 0;
        while (game.phase === 'fight' && frames < 5000) {
          // Так играет человек: тянет, пока натяжение в безопасной середине, и
          // отпускает, когда леска вот-вот лопнет.
          const tension = Number(game.fight?.tension) || 0;
          game.actionReel?.(tension < 0.6 ? 0.9 : 0.0);
          busy(9);
          pumpFrames(1);
          if (game.fight) maxTension = Math.max(maxTension, Number(game.fight.tension) || 0);
          frames += 1;
        }
        const landed = (Number(state.stats.catches) || 0) > catchesBefore;
        const inShed = state.inventory.fish.length > fishBefore;
        if (!landed || !inShed) {
          problems.push(
            `вываживание не довело рыбу до садка (фаза ${game.phase}, кадров ${frames}, ` +
            `итог ${endStatus}, максимум натяжения ${maxTension.toFixed(2)}, дистанция ${(Number(game.fight?.distM) || 0).toFixed(1)} м)`,
          );
        } else {
          const last = state.inventory.fish[state.inventory.fish.length - 1]; console.log(`   улов: ${last ? last.fishId + " " + last.kg + " кг/" + last.cm + " см" : "?"} за ${frames} кадров (~${(frames * 9 / 1000).toFixed(0)} с боя)`);
        }
      } catch (err) {
        reportError('полный цикл улова', err);
      }
    }
    console.log(`   fallback-рендер: ${renderer && renderer.isFallback ? 'да (WebGL нет)' : 'нет'}`);
  }

  console.log('');
  if (problems.length === 0) {
    console.log('=== boot-smoke: OK ===');
    console.log('Игра поднимается, старт и 200+ кадров без исключений.');
    process.exit(0);
  }
  console.log(`=== boot-smoke: ПРОВАЛ (${problems.length}) ===`);
  for (const p of problems.slice(0, 12)) console.log(`  • ${p}`);
  process.exit(1);
}

main().catch((err) => {
  realError('boot-smoke упал до старта:', err);
  process.exit(1);
});


