/**
 * Каркас панели: общая жизнь (открытие/закрытие/перерисовка) и безопасные
 * обёртки над actions. Ни одна панель не мутирует state напрямую.
 * Владелец: ui-programmer.
 */
import { createSheet } from './common.js';

/**
 * @param {HTMLElement} root пустой контейнер панели (создаёт агрегатор)
 * @param {{bus:object,state:object,actions:object,panel?:string}} ctx
 * @param {{title:string, subtitle?:string, className?:string, events?:string[],
 *          render:(api:object)=>void, onOpen?:Function, onClose?:Function, onDispose?:Function}} cfg
 */
export function mountPanel(root, ctx, cfg) {
  const { bus } = ctx;
  root.classList.add('pn-mount');
  root.hidden = true;
  const sheet = createSheet(root, {
    title: cfg.title,
    subtitle: cfg.subtitle || '',
    className: cfg.className || '',
  });
  const view = cfg.makeView ? cfg.makeView() : {};
  const life = createLifecycle(root, ctx, cfg, sheet, view);

  const offs = (cfg.events || ['state:changed']).map((name) => bus.on(name, life.render));

  sheet.onClose(life.requestClose);
  root.addEventListener('mousedown', life.onBackdrop);

  return {
    open: life.open,
    close: life.close,
    dispose: () => {
      offs.forEach((off) => off());
      root.removeEventListener('mousedown', life.onBackdrop);
      life.dispose();
    },
    render: life.render,
    get isOpen() {
      return life.isOpen();
    },
  };
}

/** Жизненный цикл панели: открытие/закрытие, перерисовка, очистка обработчиков. */
function createLifecycle(root, ctx, cfg, sheet, view) {
  const { bus } = ctx;
  let opened = false;
  let payload = null;
  let cleanup = null;

  const runCleanup = () => {
    if (!cleanup) return;
    try {
      cleanup();
    } catch {
      /* обработчики могли быть удалены вместе с DOM */
    }
    cleanup = null;
  };

  const api = () => ({
    sheet,
    bus,
    state: ctx.state,
    actions: ctx.actions,
    panel: ctx.panel || cfg.name || '',
    payload,
    view,
    render: render,
    close: requestClose,
  });

  function render() {
    if (!opened) return;
    runCleanup();
    const result = cfg.render(api());
    if (typeof result === 'function') cleanup = result;
  }

  function close() {
    if (!opened) return;
    opened = false;
    root.hidden = true;
    runCleanup();
    if (cfg.onClose) cfg.onClose();
  }

  function open(data) {
    payload = data && typeof data === 'object' ? data : null;
    if (!opened) {
      opened = true;
      root.hidden = false;
    }
    if (cfg.onOpen) cfg.onOpen(view, payload);
    render();
  }

  function requestClose() {
    bus.emit('ui:panel', { name: null });
    close();
  }

  function onBackdrop(event) {
    if (event.target === root) requestClose();
  }

  return {
    open,
    close,
    render,
    requestClose,
    onBackdrop,
    dispose() {
      runCleanup();
      if (cfg.onDispose) cfg.onDispose();
      root.innerHTML = '';
      root.classList.remove('pn-mount');
      root.hidden = true;
    },
    isOpen: () => opened,
  };
}

export function toast(bus, text, kind = 'info') {
  if (bus) bus.emit('toast', { text: String(text), kind });
}

export function clickSfx(bus) {
  if (bus) bus.emit('sfx', { name: 'click' });
}

/** Поставить наживку: сначала профильное действие, затем общий setTackle. */
export function equipBait(actions, bus, baitId) {
  if (actions && typeof actions.setBait === 'function') {
    actions.setBait(baitId);
    return true;
  }
  if (actions && typeof actions.setTackle === 'function') {
    actions.setTackle({ baitId, lureId: null });
    return true;
  }
  toast(bus, 'Смена наживки пока недоступна', 'bad');
  return false;
}

/** Поставить приманку на спиннинг. */
export function equipLure(actions, bus, lureId, lureUid) {
  if (actions && typeof actions.setLure === 'function') {
    actions.setLure(lureId, lureUid);
    return true;
  }
  if (actions && typeof actions.setTackle === 'function') {
    const patch = { lureId, baitId: null };
    if (lureUid) patch.lureUid = lureUid;
    actions.setTackle(patch);
    return true;
  }
  toast(bus, 'Смена приманки пока недоступна', 'bad');
  return false;
}

/** Экипировать снасть: patch вида { rodId: 'rod_float_1' }. */
export function setGear(actions, bus, patch) {
  if (actions && typeof actions.setTackle === 'function') {
    actions.setTackle(patch);
    return true;
  }
  toast(bus, 'Экипировка пока недоступна', 'bad');
  return false;
}

/** Сменить оснастку. */
export function setRig(actions, bus, rig) {
  if (actions && typeof actions.setRig === 'function') {
    actions.setRig(rig);
    return true;
  }
  if (actions && typeof actions.setTackle === 'function') {
    actions.setTackle({ rig });
    return true;
  }
  toast(bus, 'Смена оснастки пока недоступна', 'bad');
  return false;
}

const BUY_NAMES = {
  bait: ['buyBait'],
  lure: ['buyLure'],
  tackle: ['buyTackle'],
  item: ['buyItem'],
};

/** Покупка: профильное действие по виду товара, затем общий buyItem. */
export function buyGood(actions, bus, kind, id, qty = 1) {
  const names = BUY_NAMES[kind] || ['buyItem'];
  for (const name of names) {
    if (actions && typeof actions[name] === 'function') {
      return actions[name](id, qty) !== false;
    }
  }
  if (actions && typeof actions.buyItem === 'function') {
    return actions.buyItem(id, qty, kind) !== false;
  }
  toast(bus, 'Покупка пока недоступна', 'bad');
  return false;
}

export function sellFish(actions, bus, uid) {
  if (actions && typeof actions.sellFish === 'function') {
    actions.sellFish(uid);
    return true;
  }
  toast(bus, 'Продажа пока недоступна', 'bad');
  return false;
}

export function sellAllFish(actions, bus) {
  if (actions && typeof actions.sellAllFish === 'function') {
    actions.sellAllFish();
    return true;
  }
  toast(bus, 'Продажа улова пока недоступна', 'bad');
  return false;
}

/** Простое делегирование кликов: data-act + data-id. */
export function bindDelegated(container, handlers) {
  const onClick = (event) => {
    const target = event.target.closest('[data-act]');
    if (!target || !container.contains(target)) return;
    const handler = handlers[target.dataset.act];
    if (!handler) return;
    event.preventDefault();
    event.stopPropagation();
    handler(target, event);
  };
  container.addEventListener('click', onClick);
  return () => container.removeEventListener('click', onClick);
}

export function bindDelegatedInput(container, handler) {
  const onInput = (event) => {
    const target = event.target;
    if (!target || !target.dataset || !target.dataset.act) return;
    handler(target, event);
  };
  container.addEventListener('input', onInput);
  container.addEventListener('change', onInput);
  return () => {
    container.removeEventListener('input', onInput);
    container.removeEventListener('change', onInput);
  };
}
