/**
 * Минимальный фейковый DOM для проверки панелей в Node (браузер в песочнице не запускается).
 * Не претендует на полноту CSSOM — только то, что реально используют панели.
 */
let uidCounter = 0;
export const htmlLog = [];
export const winListeners = [];

export class FakeEl {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.hidden = false;
    this.textContent = '';
    this.value = '';
    this.checked = false;
    this._html = '';
    this._slots = {};
    this._first = null;
    this._listeners = [];
    this.className = '';
    this.classList = { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false };
  }
  set innerHTML(value) {
    this._html = String(value == null ? '' : value);
    htmlLog.push({ slot: this.dataset.slot || '', html: this._html });
    if (htmlLog.length > 40) htmlLog.splice(0, htmlLog.length - 40);
    this._first = new FakeEl('section');
    for (const match of this._html.matchAll(/data-slot="([^"]+)"/g)) {
      const slotEl = new FakeEl('div');
      slotEl.dataset.slot = match[1];
      this._first._slots[match[1]] = slotEl;
    }
    this._slots = this._first._slots;
  }
  get innerHTML() {
    return this._html;
  }
  get firstElementChild() {
    if (!this._first) this._first = new FakeEl('section');
    return this._first;
  }
  appendChild(child) {
    this.children.push(child);
    return child;
  }
  querySelector(sel) {
    const slot = /data-slot="([^"]+)"/.exec(String(sel));
    if (slot && this._slots[slot[1]]) return this._slots[slot[1]];
    const el = new FakeEl('div');
    if (slot) el.dataset.slot = slot[1];
    el._uid = ++uidCounter;
    return el;
  }
  querySelectorAll() {
    return [];
  }
  closest(sel) {
    return this._closestResult || null;
  }
  contains() {
    return true;
  }
  addEventListener(type, fn) {
    this._listeners.push({ type, fn });
  }
  removeEventListener(type, fn) {
    this._listeners = this._listeners.filter((l) => !(l.type === type && l.fn === fn));
  }
  setAttribute() {}
  remove() {}
  focus() {}
  getBoundingClientRect() {
    return { width: 1100, height: 700, top: 20, bottom: 720, left: 40, right: 1140 };
  }
  /** Программный клик по элементу с данным data-act (имитация делегирования). */
  fire(type, init = {}) {
    // Как в браузере: слушатели, добавленные во время dispatch, не вызываются в этом же событии.
    for (const l of this._listeners.slice()) {
      if (l.type === type) l.fn(init);
    }
  }
}

export function makeTarget(dataset) {
  const el = new FakeEl('button');
  el.dataset = dataset || {};
  el._closestResult = el;
  el.textContent = '';
  if (dataset && dataset.value !== undefined) el.value = String(dataset.value);
  if (dataset && dataset.checked !== undefined) el.checked = Boolean(dataset.checked);
  return el;
}

export function setupFakeDom() {
  const doc = {
    readyState: 'complete',
    activeElement: null,
    body: new FakeEl('body'),
    documentElement: new FakeEl('html'),
    getElementById: () => null,
    createElement: (tag) => new FakeEl(tag),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.document = doc;
  globalThis.window = {
    addEventListener(type, fn) {
      winListeners.push({ type, fn });
    },
    removeEventListener() {},
  };
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  return doc;
}

export function makeMemoryStorage() {
  const memory = new Map();
  return {
    get(key, fallback) {
      return memory.has(key) ? memory.get(key) : fallback;
    },
    set(key, value) {
      memory.set(key, value);
      return true;
    },
    remove(key) {
      memory.delete(key);
    },
  };
}
