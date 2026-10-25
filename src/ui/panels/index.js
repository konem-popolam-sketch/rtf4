/**
 * Агрегатор игровых панелей.
 * Монтирует семь панелей в #panels-root, открывает/закрывает их по bus-событию
 * `ui:panel`, закрывает по ESC и клику по подложке. Панели не трогают state
 * напрямую — только переданный объект actions.
 * Владелец: ui-programmer.
 */
import { mount as mountInventory } from './inventory.js';
import { mount as mountShop } from './shop.js';
import { mount as mountMap } from './map.js';
import { mount as mountAtlas } from './atlas.js';
import { mount as mountTackle } from './tackle.js';
import { mount as mountQuests } from './quests.js';
import { mount as mountSettings } from './settings.js';

const PANEL_MODULES = [
  ['inventory', mountInventory],
  ['shop', mountShop],
  ['map', mountMap],
  ['atlas', mountAtlas],
  ['tackle', mountTackle],
  ['quests', mountQuests],
  ['settings', mountSettings],
];

const EMPTY_STATE = Object.freeze({});

/** Контейнер панелей: #panels-root, при отсутствии создаём сами. */
function panelsRoot() {
  let host = document.getElementById('panels-root');
  if (!host) {
    host = document.createElement('div');
    host.id = 'panels-root';
    (document.getElementById('app') || document.body).appendChild(host);
  }
  return host;
}

function makeContainer(host, name) {
  const el = document.createElement('div');
  el.className = 'pn-container';
  el.dataset.panel = name;
  host.appendChild(el);
  return el;
}

/**
 * Создаёт «ленивый» контекст: state/actions можно передать позже, панели
 * всё равно получат актуальные значения на момент отрисовки.
 */
function createRuntime(state, actions) {
  let stateRef = state || null;
  let actionsRef = actions || null;

  const activeActions = () => (actionsRef && actionsRef.actions) || actionsRef || null;

  const mem = {
    get state() {
      if (stateRef) return stateRef;
      const runtime = globalThis.RTF4;
      return (runtime && runtime.state) || EMPTY_STATE;
    },
    get actions() {
      const own = activeActions();
      if (own) return own;
      const runtime = globalThis.RTF4;
      return (runtime && runtime.actions) || null;
    },
    setState(next) {
      stateRef = next;
    },
    setActions(next) {
      actionsRef = next;
    },
    hasState: () => Boolean(stateRef),
    hasActions: () => Boolean(activeActions()),
  };
  return mem;
}

/** Создаёт контекст для конкретной панели (state/actions читаются на лету). */
function panelContext(bus, runtime, name) {
  return {
    bus,
    panel: name,
    get state() {
      return runtime.state;
    },
    get actions() {
      return runtime.actions;
    },
  };
}

/** Монтирует все панели и возвращает карту имя → {panel, container}. */
function mountAll(host, bus, runtime) {
  const panels = new Map();
  for (const [name, mountFn] of PANEL_MODULES) {
    const container = makeContainer(host, name);
    const panel = mountFn(container, panelContext(bus, runtime, name));
    panels.set(name, { panel, container });
  }
  return panels;
}

/** Переключение видимой панели: закрыть предыдущую, открыть следующую. */
function createSwitcher(bus, runtime, panels) {
  let current = null;
  let disposed = false;

  const apply = (name) => {
    if (disposed) return;
    const next = name && panels.has(name) ? name : null;
    if (next === current) return;
    if (current) {
      const prev = panels.get(current);
      if (prev) prev.panel.close();
    }
    current = next;
    if (next) panels.get(next).panel.open({ source: 'aggregator' });
  };

  /** Закрытие через стор, чтобы игра сняла паузу; иначе эмитим событие сами. */
  const viaStore = (name) => {
    const actions = runtime.actions;
    const store = runtime.state;
    if (!actions || typeof actions.setPanel !== 'function' || !store || !store.ui) return false;
    actions.setPanel(name);
    return true;
  };

  const open = (name, payload) => {
    if (!name || !panels.has(name)) {
      if (name) bus.emit('toast', { text: 'Такого экрана нет', kind: 'bad' });
      return;
    }
    const entry = panels.get(name);
    if (name === current) {
      entry.panel.open(payload || {});
      return;
    }
    if (viaStore(name)) {
      if (payload) entry.panel.open(payload);
      return;
    }
    bus.emit('ui:panel', { name });
    apply(name);
  };

  const close = () => {
    if (!current) return;
    if (viaStore(null)) return;
    bus.emit('ui:panel', { name: null });
    apply(null);
  };

  const refresh = () => {
    if (!current) return;
    const entry = panels.get(current);
    if (entry) entry.panel.render();
  };

  const onPanelEvent = (payload) => {
    const name = payload && typeof payload === 'object' ? payload.name : payload;
    apply(name || null);
  };

  return {
    open,
    close,
    refresh,
    apply,
    onPanelEvent,
    toggle: (name) => (current === name ? close() : open(name)),
    isOpen: () => current,
    reset() {
      current = null;
    },
    dispose() {
      disposed = true;
      current = null;
    },
  };
}

/** Горячая клавиша ESC: закрывает активную панель и снимает флаг события. */
function bindEscape(switcher) {
  const onKeyDown = (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (!switcher.isOpen()) return;
    event.preventDefault();
    event.stopPropagation();
    switcher.close();
  };
  window.addEventListener('keydown', onKeyDown, true);
  return () => window.removeEventListener('keydown', onKeyDown, true);
}

/** Страховка: если state/actions не передали — подхватываем модули стора. */
function loadStoreFallback(runtime, onReady) {
  if (runtime.hasState() && runtime.hasActions()) return;
  Promise.all([import('../../state/game.js').catch(() => null), import('../../state/actions.js').catch(() => null)])
    .then(([gameMod, actionsMod]) => {
      if (!runtime.hasState() && gameMod && typeof gameMod.getState === 'function') {
        runtime.setState(gameMod.getState());
      }
      if (!runtime.hasActions() && actionsMod) runtime.setActions(actionsMod.actions || actionsMod);
      onReady();
    })
    .catch(() => {
      /* стор ещё не готов — панели откроются, когда капитан передаст его явно */
    });
}

/**
 * @param {{bus:object, state?:object, actions?:object, root?:HTMLElement}} params
 * @returns {{open:(name:string, payload?:object)=>void, close:()=>void,
 *            isOpen:()=>string|null, toggle:(name:string)=>void, dispose:()=>void,
 *            names:string[], current:()=>string|null, refresh:()=>void}}
 */
export function initPanels({ bus, state, actions, root } = {}) {
  if (!bus || typeof bus.on !== 'function') throw new TypeError('initPanels: bus обязателен');

  const host = root || panelsRoot();
  const runtime = createRuntime(state, actions);
  const panels = mountAll(host, bus, runtime);
  const switcher = createSwitcher(bus, runtime, panels);
  const offPanel = bus.on('ui:panel', switcher.onPanelEvent);
  const offEscape = bindEscape(switcher);

  // Синхронизация с уже сохранённым открытым экраном из сейва/состояния.
  const savedPanel = runtime.state && runtime.state.ui && runtime.state.ui.panel;
  if (savedPanel && panels.has(savedPanel)) switcher.apply(savedPanel);

  loadStoreFallback(runtime, switcher.refresh);

  return {
    open: switcher.open,
    close: switcher.close,
    toggle: switcher.toggle,
    refresh: switcher.refresh,
    isOpen: switcher.isOpen,
    current: switcher.isOpen,
    names: PANEL_MODULES.map(([name]) => name),
    panels,
    dispose() {
      offPanel();
      offEscape();
      for (const entry of panels.values()) entry.panel.dispose();
      panels.clear();
      switcher.dispose();
    },
  };
}

export default initPanels;
