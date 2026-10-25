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
 * @param {{bus:object, state?:object, actions?:object, root?:HTMLElement}} params
 * @returns {{open:(name:string, payload?:object)=>void, close:()=>void,
 *            isOpen:()=>string|null, toggle:(name:string)=>void, dispose:()=>void,
 *            names:string[], current:()=>string|null, refresh:()=>void}}
 */
export function initPanels({ bus, state, actions, root } = {}) {
  if (!bus || typeof bus.on !== 'function') throw new TypeError('initPanels: bus обязателен');

  const host = root || panelsRoot();
  let stateRef = state || null;
  let actionsRef = actions || null;
  let current = null;
  let disposed = false;
  const panels = new Map();

  // Если капитан ещё не передал стор/действия — берём их позже, когда появятся.
  const lazyState = () => {
    if (stateRef) return stateRef;
    const runtime = globalThis.RTF4;
    return (runtime && runtime.state) || EMPTY_STATE;
  };
  const lazyActions = () => {
    if (actionsRef) return actionsRef;
    const runtime = globalThis.RTF4;
    return (runtime && runtime.actions) || null;
  };

  const ctx = {
    bus,
    panel: '',
    get state() {
      return lazyState();
    },
    get actions() {
      return lazyActions();
    },
  };

  for (const [name, mountFn] of PANEL_MODULES) {
    const container = makeContainer(host, name);
    const panelCtx = {
      bus,
      panel: name,
      get state() {
        return lazyState();
      },
      get actions() {
        return lazyActions();
      },
    };
    const panel = mountFn(container, panelCtx);
    panels.set(name, { panel, container });
  }

  function setPanelViaStore(name) {
    const storeActions = lazyActions();
    if (storeActions && typeof storeActions.setPanel === 'function') {
      storeActions.setPanel(name);
      return true;
    }
    return false;
  }

  function apply(name) {
    if (disposed) return;
    const next = name && panels.has(name) ? name : null;
    if (next === current) return;
    if (current) {
      const prev = panels.get(current);
      if (prev) prev.panel.close();
    }
    current = next;
    if (next) {
      const entry = panels.get(next);
      if (entry) entry.panel.open({ source: 'aggregator' });
    }
  }

  function open(name, payload) {
    if (!name || !panels.has(name)) {
      if (name) bus.emit('toast', { text: 'Такого экрана нет', kind: 'bad' });
      return;
    }
    const entry = panels.get(name);
    if (name === current) {
      entry.panel.open(payload || {});
      return;
    }
    if (setPanelViaStore(name)) {
      if (payload && entry.panel.open) entry.panel.open(payload);
      return;
    }
    bus.emit('ui:panel', { name });
    apply(name);
  }

  function close() {
    if (!current) return;
    if (setPanelViaStore(null)) return;
    bus.emit('ui:panel', { name: null });
    apply(null);
  }

  function refresh() {
    if (current) {
      const entry = panels.get(current);
      if (entry) entry.panel.render();
    }
  }

  function toggle(name) {
    if (current === name) close();
    else open(name);
  }

  const onPanelEvent = (payload) => {
    const name = payload && typeof payload === 'object' ? payload.name : payload;
    apply(name || null);
  };
  const offPanel = bus.on('ui:panel', onPanelEvent);

  const onKeyDown = (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (!current) return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };
  window.addEventListener('keydown', onKeyDown, true);

  const onWindowBlur = () => {
    /* панель остаётся открытой: игра на паузе по своим правилам */
  };
  window.addEventListener('blur', onWindowBlur);

  // Синхронизация с уже сохранённым открытым экраном из сейва/состояния.
  const savedPanel = lazyState() && lazyState().ui && lazyState().ui.panel;
  if (savedPanel && panels.has(savedPanel)) apply(savedPanel);

  // Фолбэк: если state/actions не передали — подхватываем стор, когда он появится.
  if (!stateRef || !actionsRef) {
    Promise.all([
      import('../../state/game.js').catch(() => null),
      import('../../state/actions.js').catch(() => null),
    ])
      .then(([gameMod, actionsMod]) => {
        if (disposed) return;
        if (!stateRef && gameMod && typeof gameMod.getState === 'function') stateRef = gameMod.getState();
        if (!actionsRef && actionsMod) actionsRef = actionsMod.default || actionsMod;
        if (current) refresh();
      })
      .catch(() => {
        /* стор ещё не готов — панели откроются, когда капитан передаст его явно */
      });
  }

  const instance = {
    open,
    close,
    toggle,
    refresh,
    isOpen: () => current,
    current: () => current,
    names: PANEL_MODULES.map(([name]) => name),
    panels,
    dispose() {
      disposed = true;
      offPanel();
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('blur', onWindowBlur);
      for (const entry of panels.values()) entry.panel.dispose();
      panels.clear();
      current = null;
    },
  };

  return instance;
}

export default initPanels;
