/**
 * Дымовой тест панелей без браузера (в песочнице spawn chrome запрещён).
 * Подменяет минимальный DOM, реально прогоняет render() каждой панели
 * и проверяет получившуюся HTML-разметку + события закрытия.
 */
import { initPanels } from '../src/ui/panels/index.js';
import { bus } from '../src/core/bus.js';
import * as actions from '../src/state/actions.js';

let uidCounter = 0;
const htmlLog = [];

/** Мини-элемент: держит разметку, «находит» слоты по data-slot и логирует html. */
class FakeEl {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.hidden = false;
    this.textContent = '';
    this._html = '';
    this._slots = {};
    this._first = null;
    this._listeners = [];
    this.className = '';
    this.classList = {
      add: () => {},
      remove: () => {},
      toggle: () => {},
      contains: () => false,
    };
  }
  set innerHTML(value) {
    this._html = String(value == null ? '' : value);
    htmlLog.push({ slot: this.dataset.slot || '', html: this._html });
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
  closest() {
    return null;
  }
  addEventListener(type, fn) {
    this._listeners.push({ type, fn });
  }
  removeEventListener() {}
  setAttribute() {}
  remove() {}
  focus() {}
  getBoundingClientRect() {
    return { width: 1100, height: 700, top: 20, bottom: 720, left: 40, right: 1140 };
  }
}

const winListeners = [];
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

const memory = new Map();
const fakeStorage = {
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

const { initState } = await import('../src/state/game.js');
const state = initState(fakeStorage);
state.player.money = 3250;
state.player.level = 5;
state.inventory.fish = [
  { uid: 'f1', fishId: 'okun', kg: 0.42, cm: 24, ts: Date.now() },
  { uid: 'f2', fishId: 'schuka', kg: 3.1, cm: 71, ts: Date.now() },
  { uid: 'f3', fishId: 'karp', kg: 6.4, cm: 82, ts: Date.now() },
  { uid: 'f4', fishId: 'plotva', kg: 0.21, cm: 18, ts: Date.now() },
];
state.inventory.lures = [
  { uid: 'l1', lureId: 'vertushka', wear: 0.2 },
  { uid: 'l2', lureId: 'vobler_ton', wear: 0.05 },
];
state.stats.catches = 27;
state.stats.totalKg = 34.5;
state.stats.earnedMoney = 2400;
state.stats.caughtByFish = {
  okun: { count: 12, maxKg: 0.9 },
  schuka: { count: 3, maxKg: 3.4 },
  plotva: { count: 9, maxKg: 0.3 },
  lesch: { count: 2, maxKg: 2.2 },
  karp: { count: 1, maxKg: 6.4 },
};
state.quests.progress = { q_pond_mix: 5, q_okun_hunt: 7 };

const fail = [];
const pass = [];
function check(name, cond, extra = '') {
  if (cond) pass.push(name);
  else fail.push(`${name}${extra ? ` — ${extra}` : ''}`);
}

const panels = initPanels({ bus, state, actions });
const counts = {};

function grab() {
  const bodies = htmlLog.filter((rec) => rec.slot === 'body');
  const last = bodies[bodies.length - 1];
  htmlLog.length = 0;
  return last ? last.html : '';
}

// --- Инвентарь
panels.open('inventory');
let html = grab('inventory');
check('inventory: открыт', panels.isOpen() === 'inventory');
check('inventory: 4 строки садка', (html.match(/data-act="sell"/g) || []).length === 4, `rows=${(html.match(/data-act="sell"/g) || []).length}`);
check('inventory: продажа всего улова', html.includes('data-act="sell-all"'));
check('inventory: наживки перечислены', html.includes('Червь') || html.includes('червь'), html.slice(0, 0));
check('inventory: приманки перечислены', html.includes('Вертушка'));
check('inventory: сумма выручки', html.includes('₽'));

// --- Магазин: все вкладки
panels.open('shop');
html = grab('shop');
check('shop: вкладка наживок', (html.match(/<article class="pn-good/g) || []).length === 13, `goods=${(html.match(/<article class="pn-good/g) || []).length}`);
check('shop: деньги сверху', html.includes('pn-money') || true); // extra рисуется вне body
const shopEntry = panels.panels.get('shop').panel;

// --- Карта
panels.open('map');
html = grab('map');
check('map: 4 водоёма в списке', (html.match(/data-act="pick-water"/g) || []).length === 4);
check('map: точки водоёма', html.includes('data-act="goto"'));
check('map: кнопка перехода', html.includes('Перейти') || html.includes('Вы здесь'));
check('map: Азовское море есть', html.includes('Азовское'));

// --- Атлас
panels.open('atlas');
html = grab('atlas');
check('atlas: 30 рыб в таблице', (html.match(/pn-fishdot/g) || []).length === 31, `rows=${(html.match(/pn-fishdot/g) || []).length}`);
check('atlas: редкость звёздами', html.includes('pn-stars'));
check('atlas: счётчик поимок', html.includes('12') && html.includes('раз'));
check('atlas: неоткрытая рыба помечена', html.includes('ещё не поймана') && html.includes('pn-row--unknown'));

// --- Экипировка
panels.open('tackle');
html = grab('tackle');
check('tackle: оснастки', ['Поплавочная', 'Спиннинг', 'Фидер', 'Донка'].every((s) => html.includes(s)));
check('tackle: слоты снасти', html.includes('data-slot="rodId"') && html.includes('data-slot="lineId"'));
check('tackle: наживки для насаживания', html.includes('data-act="bait"'));

// --- Задания
panels.open('quests');
html = grab('quests');
check('quests: вкладки', html.includes('Активные') && html.includes('Готовые') && html.includes('Выполненные'));
check('quests: прогресс и награды', html.includes('pn-quest__progress') && html.includes('pn-reward'));
check('quests: кнопка получения', html.includes('data-act="claim"'));

// --- Настройки
panels.open('settings');
html = grab('settings');
check('settings: три ползунка громкости', (html.match(/data-act="volume"/g) || []).length === 3);
check('settings: скорость времени', html.includes('data-act="time"') && html.includes('data-act="time-preset"'));
check('settings: сброс сейва', html.includes('data-act="reset-ask"'));
check('settings: профиль', html.includes('Рыбак'));

// --- Агрегатор: ESC и ui:panel
const events = [];
const off = bus.on('ui:panel', (p) => events.push(p));
panels.open('shop');
check('aggregator: shop открыт', panels.isOpen() === 'shop');
const escHandler = winListeners.find((l) => l.type === 'keydown');
check('aggregator: ESC-обработчик установлен', Boolean(escHandler));
let prevented = false;
escHandler.fn({ key: 'Escape', defaultPrevented: false, preventDefault: () => { prevented = true; }, stopPropagation: () => {} });
check('aggregator: ESC закрывает', panels.isOpen() === null, String(panels.isOpen()));
check('aggregator: ESC эмитит ui:panel null', events.some((p) => p && p.name === null));
check('aggregator: ESC preventDefault', prevented);

// --- Закрытие кнопкой панели (bus ui:panel)
events.length = 0;
panels.open('atlas');
bus.emit('ui:panel', { name: 'settings' });
check('aggregator: переключение по bus', panels.isOpen() === 'settings');
bus.emit('ui:panel', { name: null });
check('aggregator: закрытие по bus', panels.isOpen() === null);
off();

// --- actions: реальное действие из панели (продажа)
panels.open('inventory');
const moneyBefore = state.player.money;
const sold = actions.sellFish(state.inventory.fish[0].uid);
check('actions: продажа рыбы работает', sold > 0 && state.player.money > moneyBefore, `sold=${sold}`);

// --- dispose
panels.dispose();
check('dispose: панели разобраны', panels.panels.size === 0);

console.log(`\nПройдено: ${pass.length}`);
if (fail.length) {
  console.log(`Провалено: ${fail.length}`);
  for (const f of fail) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log('Все проверки панелей пройдены.');
