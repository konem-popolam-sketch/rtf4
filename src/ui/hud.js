/**
 * hud.js — весь DOM-интерфейс поверх сцены. Владелец: капитан.
 * Ничего не мутирует в state напрямую: все действия уходят в actions.*,
 * все реакции — с шины событий. HUD перерисовывается только по факту изменений,
 * а полосы вываживания обновляются каждый кадр.
 */
import { clamp, fmtInt, fmtKg, fmtMoney, fmtClock, round1 } from '../core/util.js';
import { FISH_BY_ID } from '../data/fish.js';
import { WATER_BY_ID, ALL_SPOTS } from '../data/spots.js';
import { BAIT_BY_ID } from '../data/baits.js';
import { LURE_BY_ID } from '../data/lures.js';
import { TACKLE_BY_ID } from '../data/tackle.js';
import * as actions from '../state/actions.js';
import { xpNext } from '../state/game.js';

const SEASON_LABEL = { spring: 'Весна', summer: 'Лето', autumn: 'Осень', winter: 'Зима' };
const PRECIP_ICON = { none: '☀', rain: '🌧', storm: '⛈' };

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function weatherIcon(w) {
  if (!w) return '☀';
  if (w.precip === 'storm') return '⛈';
  if (w.precip === 'rain') return '🌧';
  if ((w.cloud ?? 0) > 0.75) return '☁';
  if ((w.cloud ?? 0) > 0.4) return '⛅';
  return PRECIP_ICON.none;
}

function nameOf(list, id, fallback = '—') {
  const item = list[id];
  return item ? item.name : fallback;
}

/** Строит разметку HUD один раз; дальше только точечно обновляем значения. */
function build(root) {
  root.className = 'hud';

  const top = el('div', 'hud-top');
  const money = el('div', 'hud-cluster');
  const moneyVal = el('div', 'hud-money', '0 ₽');
  money.append(moneyVal);

  const levelBox = el('div', 'hud-cluster hud-level');
  const levelLabel = el('div', 'hud-level__label');
  const levelNum = el('span', null, '1 ур.');
  const levelXp = el('span', null, '0 / 120');
  levelLabel.append(levelNum, levelXp);
  const xpBar = el('div', 'hud-bar');
  const xpFill = el('div', 'hud-bar__fill hud-bar__fill--xp');
  xpBar.append(xpFill);
  levelBox.append(levelLabel, xpBar);

  const vitals = el('div', 'hud-cluster hud-vitals');
  const energyRow = el('div', 'hud-vital');
  const energyIcon = el('span', 'hud-vital__icon', '⚡');
  const energyBar = el('div', 'hud-bar');
  const energyFill = el('div', 'hud-bar__fill hud-bar__fill--energy');
  energyBar.append(energyFill);
  energyRow.append(energyIcon, energyBar);
  const satietyRow = el('div', 'hud-vital');
  const satietyIcon = el('span', 'hud-vital__icon', '🍲');
  const satietyBar = el('div', 'hud-bar');
  const satietyFill = el('div', 'hud-bar__fill hud-bar__fill--satiety');
  satietyBar.append(satietyFill);
  satietyRow.append(satietyIcon, satietyBar);
  vitals.append(energyRow, satietyRow);

  const timeBox = el('div', 'hud-cluster hud-time');
  const clock = el('div', 'hud-time__clock', '06:00');
  const dayLine = el('div', 'hud-time__day', 'День 1 · Осень');
  timeBox.append(clock, dayLine);

  const weatherBox = el('div', 'hud-cluster hud-weather');
  const wIcon = el('div', 'hud-weather__icon', '☀');
  const wText = el('div', 'hud-weather__text');
  const wTemp = el('div', 'hud-weather__temp', '—');
  const wWind = el('div', null, '—');
  wText.append(wTemp, wWind);
  weatherBox.append(wIcon, wText);

  const waterBox = el('div', 'hud-cluster hud-time');
  const waterName = el('div', 'hud-time__clock', 'Водоём');
  const spotName = el('div', 'hud-time__day', 'Точка');
  waterBox.append(waterName, spotName);

  top.append(money, levelBox, vitals, timeBox, weatherBox, waterBox);

  // --- снасть справа ---
  const tackleBox = el('div', 'hud-tackle');
  tackleBox.append(el('div', 'hud-tackle__title', 'Снасть'));
  const tackleRows = {};
  for (const [key, label] of [
    ['rod', 'Удилище'],
    ['reel', 'Катушка'],
    ['line', 'Леска'],
    ['hook', 'Крючок'],
    ['bait', 'Насадка'],
    ['rig', 'Оснастка'],
  ]) {
    const row = el('div', 'hud-tackle__row');
    row.append(el('span', null, label));
    const val = el('b', null, '—');
    row.append(val);
    tackleRows[key] = val;
    tackleBox.append(row);
  }

  // --- хотбар ---
  const hotbar = el('div', 'hud-hotbar');
  const slots = [];
  const slotDefs = [
    { key: '1', icon: '🎣', label: 'Заброс', action: 'cast' },
    { key: '2', icon: '✊', label: 'Подсечка', action: 'strike' },
    { key: '3', icon: '🎡', label: 'Вываживать', action: 'reel' },
    { key: '4', icon: '🪱', label: 'Наживка', action: 'bait' },
    { key: '5', icon: '🗺', label: 'Карта', action: 'map' },
    { key: '6', icon: '🎒', label: 'Садок', action: 'inventory' },
    { key: '7', icon: '🛒', label: 'Магазин', action: 'shop' },
    { key: '8', icon: '📖', label: 'Атлас', action: 'atlas' },
  ];
  for (const def of slotDefs) {
    const slot = el('button', 'hud-slot');
    slot.type = 'button';
    slot.dataset.action = def.action;
    slot.append(el('span', 'hud-slot__key', def.key));
    slot.append(el('span', 'hud-slot__icon', def.icon));
    slot.append(el('span', 'hud-slot__label', def.label));
    slot.addEventListener('click', () => onSlot(def.action));
    slots.push({ node: slot, action: def.action });
    hotbar.append(slot);
  }

  // --- индикатор поклёвки ---
  const bite = el('div', 'hud-bite');
  bite.append(el('div', 'hud-bite__title', 'Поклёвка'));
  const biteHint = el('div', 'hud-bite__hint', 'Подсекайте — ЛКМ');
  bite.append(biteHint);

  // --- вываживание ---
  const fight = el('div', 'hud-fight');
  fight.hidden = true;
  const fightHead = el('div', 'hud-fight__head');
  const fightFish = el('div', 'hud-fight__fish', '—');
  const fightDist = el('div', null, '0 м');
  fightHead.append(fightFish, fightDist);
  const gauge = el('div', 'hud-fight__gauge');
  const staminaBar = el('div', 'hud-fight__stamina');
  const tensionBar = el('div', 'hud-fight__tension');
  const dangerZone = el('div', 'hud-fight__danger');
  gauge.append(staminaBar, tensionBar, dangerZone);
  const fightStats = el('div', 'hud-fight__stats');
  const statLeft = el('span', null, '0 кг');
  const statMid = el('span', null, '0 м');
  const statRight = el('span', null, '0 %');
  fightStats.append(statLeft, statMid, statRight);
  const fightWarn = el('div', 'hud-fight__warn', '');
  fight.append(fightHead, gauge, fightStats, fightWarn);

  // --- журнал и подсказка ---
  const logBox = el('div', 'hud-log');
  const hintBox = el('div', 'hud-hint');
  hintBox.innerHTML = [
    '<b>ЛКМ</b> — заброс / подсечка / подмотка',
    '<b>ПКМ</b> — поднять удилище',
    '<b>Esc</b> — отмена / закрыть панель',
    '<b>Tab</b> — садок, <b>M</b> — карта',
  ].join('<br>');

  const toastRoot = document.getElementById('toast-root') || root;
  const toastWrap = el('div', 'toast-stack');
  toastRoot.append(toastWrap);

  root.append(top, tackleBox, hotbar, bite, fight, logBox, hintBox);

  return {
    moneyVal, levelNum, levelXp, xpFill, energyFill, satietyFill,
    clock, dayLine, wIcon, wTemp, wWind, waterName, spotName,
    tackleRows, slots, bite, biteHint, fight, fightFish, fightDist,
    tensionBar, staminaBar, statLeft, statMid, statRight, fightWarn,
    logBox, toastWrap,
  };
}

export function initHud({ bus, state, actions: actionsCtx }) {
  const root = document.getElementById('hud-root');
  if (!root) return { update() {}, destroy() {} };
  const acts = actionsCtx || actions;
  const ui = build(root);
  let lastPhase = 'idle';
  let lastFightStatus = 'fighting';
  let lastLogLen = -1;
  let reelHeld = false;

  // --- команды игрока ---

  function castWithPower() {
    bus.emit('action:cast', { power01: 0.72 });
  }

  function onSlot(action) {
    bus.emit('sfx', { name: 'click' });
    switch (action) {
      case 'cast':
        castWithPower();
        break;
      case 'strike':
        bus.emit('action:strike');
        break;
      case 'reel':
        bus.emit('action:reel', { value: reelHeld ? 0 : 1 });
        break;
      case 'bait':
        cycleBait();
        break;
      case 'map':
      case 'inventory':
      case 'shop':
      case 'atlas':
      case 'tackle':
      case 'quests':
      case 'settings':
        acts.setPanel(state.ui.panel === action ? null : action);
        break;
      default:
        break;
    }
  }

  /** Быстрая смена наживки колесом/цифрой: берём следующую, что есть в садке. */
  function cycleBait() {
    const owned = Object.keys(state.inventory.baits).filter((id) => state.inventory.baits[id] > 0);
    if (owned.length === 0) {
      bus.emit('toast', { text: 'Наживки нет — загляните в магазин', kind: 'bad' });
      return;
    }
    const cur = state.tackle.baitId;
    const idx = owned.indexOf(cur);
    const next = owned[(idx + 1) % owned.length];
    if (actions.setTackle({ baitId: next, lureId: null })) {
      bus.emit('toast', { text: `Насадили ${BAIT_BY_ID[next]?.name || next}`, kind: 'info' });
      bus.emit('sfx', { name: 'click' });
    }
  }

  // --- обновление верхней части ---

  function renderState() {
    ui.moneyVal.textContent = fmtMoney(state.player.money);
    const need = xpNext(state.player.level);
    ui.levelNum.textContent = `${state.player.level} ур.`;
    ui.levelXp.textContent = `${fmtInt(state.player.xp)} / ${fmtInt(need)}`;
    ui.xpFill.style.width = `${clamp((state.player.xp / Math.max(1, need)) * 100, 0, 100)}%`;
    ui.energyFill.style.width = `${clamp(state.player.energy, 0, 100)}%`;
    ui.satietyFill.style.width = `${clamp(state.player.satiety, 0, 100)}%`;

    const water = WATER_BY_ID[state.world.waterId];
    const spot = ALL_SPOTS.find((s) => s.id === state.world.spotId);
    ui.waterName.textContent = water?.name || 'Водоём';
    ui.spotName.textContent = spot?.name || 'Точка';

    const t = state.tackle;
    ui.tackleRows.rod.textContent = nameOf(TACKLE_BY_ID, t.rodId);
    ui.tackleRows.reel.textContent = nameOf(TACKLE_BY_ID, t.reelId);
    ui.tackleRows.line.textContent = nameOf(TACKLE_BY_ID, t.lineId);
    ui.tackleRows.hook.textContent = nameOf(TACKLE_BY_ID, t.hookId);
    const bait = BAIT_BY_ID[t.baitId];
    const lure = LURE_BY_ID[t.lureId];
    const baitCount = state.inventory.baits[t.baitId] || 0;
    ui.tackleRows.bait.textContent = lure
      ? lure.name
      : bait
        ? `${bait.name} ×${baitCount}`
        : 'пусто';
    const RIG_LABEL = { float: 'Поплавочная', spinning: 'Спиннинг', feeder: 'Фидер', bottom: 'Донка' };
    ui.tackleRows.rig.textContent = RIG_LABEL[t.rig] || t.rig;
  }

  function renderClock(ctx) {
    ui.clock.textContent = fmtClock(ctx.minutes);
    ui.dayLine.textContent = `День ${ctx.day} · ${SEASON_LABEL[ctx.season] || ''}`;
    const w = ctx.weather || {};
    ui.wIcon.textContent = weatherIcon(w);
    ui.wTemp.textContent = `${round1(w.tempC ?? 0)}°C · ${Math.round(w.pressure ?? 1013)} гПа`;
    ui.wWind.textContent = `${round1(w.windMs ?? 0)} м/с ${compass(w.windDir ?? 0)}`;
  }

  function compass(deg) {
    const dirs = ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'];
    return dirs[Math.round(((deg % 360) / 45)) % 8];
  }

  function renderLog() {
    const log = state.log || [];
    if (log.length === lastLogLen) return;
    lastLogLen = log.length;
    ui.logBox.textContent = '';
    for (const entry of log.slice(0, 8)) {
      const line = el('div', 'hud-log__line');
      line.append(el('span', 'hud-log__time', fmtClock((entry.ts % 86400000) / 60000)));
      line.append(document.createTextNode(entry.text));
      ui.logBox.append(line);
    }
  }

  function renderPhase(ctx) {
    const phase = ctx.phase;
    const slotCast = ui.slots.find((s) => s.action === 'cast');
    const slotStrike = ui.slots.find((s) => s.action === 'strike');
    const slotReel = ui.slots.find((s) => s.action === 'reel');
    if (slotCast) slotCast.node.classList.toggle('hud-slot--active', phase === 'idle' || phase === 'landed');
    if (slotStrike) slotStrike.node.classList.toggle('hud-slot--active', phase === 'bite');
    if (slotReel) slotReel.node.classList.toggle('hud-slot--active', phase === 'fight');

    ui.bite.classList.toggle('hud-bite--visible', phase === 'bite');
    ui.bite.classList.toggle('hud-bite--strike', phase === 'bite');
    if (phase === 'bite') ui.biteHint.textContent = 'Подсекайте — ЛКМ или 2';

    ui.fight.hidden = phase !== 'fight';
    if (phase === 'bite' && lastPhase !== 'bite') bus.emit('sfx', { name: 'bite' });
    lastPhase = phase;
  }

  function renderFight(f) {
    if (!f) return;
    ui.fightFish.textContent = f.fish?.id ? FISH_BY_ID[f.fish.id]?.name || f.fish.id : '—';
    ui.fightDist.textContent = `${round1(f.distM)} м`;
    const tension = clamp(f.tension, 0, 1.35) / 1.35;
    ui.tensionBar.style.width = `${tension * 100}%`;
    ui.staminaBar.style.width = `${clamp(f.fishStamina, 0, 1) * 100}%`;
    ui.statLeft.textContent = fmtKg(f.fishKg);
    ui.statMid.textContent = `${round1(f.distM)} м`;
    ui.statRight.textContent = `${Math.round(clamp(f.tension, 0, 1.45) * 100)} %`;
    let warn = '';
    if (f.tension > 0.98) warn = 'Оборвёте! Ослабьте';
    else if (f.tension < 0.14) warn = 'Слабина — подматывайте';
    else if (f.distM < 8) warn = 'У берега!';
    ui.fightWarn.textContent = warn;
    if (f.status !== lastFightStatus) lastFightStatus = f.status;
  }

  function pushToast({ text, kind }) {
    const t = el('div', `hud-toast hud-toast--${kind || 'info'}`, text);
    ui.toastWrap.append(t);
    setTimeout(() => t.remove(), 3500);
  }

  // --- ввод ---

  function onCanvasDown(e) {
    if (document.body.classList.contains('panel-open')) return;
    if (e.button === 0) {
      const phase = curCtx?.phase ?? 'idle';
      if (phase === 'bite') bus.emit('action:strike');
      else if (phase === 'fight') {
        reelHeld = true;
        bus.emit('action:reel', { value: 1 });
      } else if (phase === 'idle' || phase === 'landed') castWithPower();
    }
  }

  function onCanvasUp(e) {
    if (e.button === 0 && reelHeld) {
      reelHeld = false;
      bus.emit('action:reel', { value: 0 });
    }
  }

  function onKeyDown(e) {
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const phase = curCtx?.phase ?? 'idle';
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        if (phase === 'bite') bus.emit('action:strike');
        else if (phase === 'idle' || phase === 'landed') castWithPower();
        else if (phase === 'fight') bus.emit('action:reel', { value: 1 });
        break;
      case 'Escape':
        if (state.ui.panel) acts.setPanel(null);
        else if (phase === 'wait' || phase === 'cast') bus.emit('action:cancel');
        break;
      case 'Tab':
        e.preventDefault();
        onSlot('inventory');
        break;
      case 'KeyM':
        onSlot('map');
        break;
      case 'KeyQ':
        cycleBait();
        break;
      default: {
        const num = e.code.startsWith('Digit') ? Number(e.code.slice(5)) : 0;
        if (num >= 1 && num <= 8) {
          const slot = ui.slots[num - 1];
          if (slot) onSlot(slot.action);
        }
        break;
      }
    }
  }

  let curCtx = null;

  // --- подписка на события ---

  const offs = [
    bus.on('state:changed', () => renderState()),
    bus.on('money:changed', () => renderState()),
    bus.on('inventory:changed', () => renderState()),
    bus.on('level:up', ({ level }) => {
      pushToast({ text: `Новый уровень: ${level}`, kind: 'gold' });
      bus.emit('sfx', { name: 'levelup' });
      renderState();
    }),
    bus.on('toast', pushToast),
    bus.on('fight:update', renderFight),
    bus.on('weather:changed', () => {
      if (curCtx) renderClock(curCtx);
    }),
    bus.on('time:tick', () => {
      if (curCtx) renderClock(curCtx);
    }),
    bus.on('ui:panel', ({ name }) => {
      document.body.classList.toggle('panel-open', Boolean(name));
    }),
  ];

  document.getElementById('scene')?.addEventListener('mousedown', onCanvasDown);
  window.addEventListener('mouseup', onCanvasUp);
  window.addEventListener('keydown', onKeyDown);

  return {
    update(dt, ctx) {
      curCtx = ctx;
      renderClock(ctx);
      renderPhase(ctx);
      if (ctx.phase === 'fight' && ctx.fight) renderFight(ctx.fight);
      renderLog();
    },
    start() {
      renderState();
      renderLog();
    },
    toast: pushToast,
    destroy() {
      offs.forEach((off) => off && off());
      document.getElementById('scene')?.removeEventListener('mousedown', onCanvasDown);
      window.removeEventListener('mouseup', onCanvasUp);
      window.removeEventListener('keydown', onKeyDown);
      root.textContent = '';
    },
  };
}

export default initHud;
