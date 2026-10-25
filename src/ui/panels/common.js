/**
 * Общие строительные блоки панелей: оболочка .panel-sheet, бейджи, полосы,
 * подписки на шину и «терпимое» чтение состояния (поля могут появиться позже).
 * Владелец: ui-programmer.
 */
import { clamp, fmtInt, fmtKg, fmtMoney, round1 } from '../../core/util.js';

export const RARITY_NAMES = ['Обычная', 'Нечастая', 'Редкая', 'Очень редкая', 'Эпическая', 'Легендарная'];
export const RARITY_STARS = ['☆☆☆☆☆', '★☆☆☆☆', '★★☆☆☆', '★★★☆☆', '★★★★☆', '★★★★★'];
export const SEASON_NAMES = { spring: 'Весна', summer: 'Лето', autumn: 'Осень', winter: 'Зима' };
export const TIME_NAMES = { dawn: 'Рассвет', day: 'День', dusk: 'Закат', night: 'Ночь' };
export const WATER_TYPE_NAMES = { river: 'Река', lake: 'Озеро', pond: 'Пруд', sea: 'Море' };
export const STRUCTURE_NAMES = {
  pit: 'Яма',
  grass: 'Трава',
  snag: 'Коряжник',
  sand: 'Песок',
  dropoff: 'Свал',
  reed: 'Камыш',
};
export const RIG_NAMES = { float: 'Поплавочная', spinning: 'Спиннинг', feeder: 'Фидер', bottom: 'Донка' };

/** Экранирование текста, попадающего в innerHTML из данных. */
export function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

export function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function firstNumber(...values) {
  for (const v of values) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

export function pct(value, max) {
  return max > 0 ? clamp((num(value) / num(max)) * 100, 0, 100) : 0;
}

export function fmtPercent01(value) {
  return `${Math.round(clamp(num(value), 0, 1) * 100)} %`;
}

export function money(v) {
  return fmtMoney(num(v));
}

export function kg(v) {
  return fmtKg(num(v));
}

export function price(v) {
  return fmtMoney(Math.max(0, Math.round(num(v))));
}

/** «N ₽» без слова «деньги» — для строк таблиц. */
export function rub(v) {
  return `${fmtInt(Math.max(0, Math.round(num(v))))} ₽`;
}

/** Звёзды редкости: rarity 0..5. */
export function stars(rarity) {
  const r = clamp(Math.round(num(rarity)), 0, 5);
  return `<span class="pn-stars pn-stars--r${r}" title="${RARITY_NAMES[r]}">${RARITY_STARS[r]}</span>`;
}

export function rarityBadge(rarity) {
  const r = clamp(Math.round(num(rarity)), 0, 5);
  return `<span class="pn-rarity pn-rarity--r${r}">${stars(r)}<b>${RARITY_NAMES[r]}</b></span>`;
}

export function chip(text, kind = '') {
  return `<span class="pn-chip${kind ? ` pn-chip--${kind}` : ''}">${esc(text)}</span>`;
}

export function bar(value, max, kind = '') {
  const p = pct(value, max);
  return `<span class="pn-bar${kind ? ` pn-bar--${kind}` : ''}"><span class="pn-bar__fill" style="width:${p.toFixed(1)}%"></span></span>`;
}

export function emptyState(text) {
  return `<div class="pn-empty">${esc(text)}</div>`;
}

/** Панель-оболочка: заголовок, слот подзаголовка, слот справа, тело. */
export function createSheet(root, { title, subtitle = '', className = '' } = {}) {
  root.innerHTML = `
    <section class="panel-sheet pn-sheet ${esc(className)}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <header class="panel-sheet__head">
        <h2 class="panel-sheet__title">${esc(title)}</h2>
        <span class="pn-sheet__sub" data-slot="sub">${esc(subtitle)}</span>
        <span class="u-spacer"></span>
        <span class="pn-sheet__extra" data-slot="extra"></span>
        <button class="panel-sheet__close" type="button" data-slot="close" aria-label="Закрыть панель">✕</button>
      </header>
      <div class="panel-sheet__body" data-slot="body"></div>
    </section>`;
  const wrap = root.firstElementChild;
  const body = wrap.querySelector('[data-slot="body"]');
  const sub = wrap.querySelector('[data-slot="sub"]');
  const extra = wrap.querySelector('[data-slot="extra"]');
  const closeBtn = wrap.querySelector('[data-slot="close"]');
  const closeHandlers = [];
  closeBtn.addEventListener('click', () => closeHandlers.forEach((fn) => fn()));
  return {
    root,
    wrap,
    body,
    closeBtn,
    setSub(text) {
      sub.textContent = text;
    },
    setExtra(html) {
      extra.innerHTML = html;
    },
    onClose(fn) {
      closeHandlers.push(fn);
    },
  };
}

export function subscribeAll(bus, events, fn) {
  const offs = events.map((name) => bus.on(name, fn));
  return () => offs.forEach((off) => off());
}

export function findAction(actions, names) {
  if (!actions) return null;
  for (const name of names) {
    if (typeof actions[name] === 'function') return actions[name].bind(actions);
  }
  return null;
}

/**
 * Выполнить действие с понятной деградацией: если действия нет — тост, стор не трогаем.
 * Возвращает true, если действие было вызвано.
 */
export function runAction(actions, names, bus, ...args) {
  const fn = findAction(actions, names);
  if (!fn) {
    if (bus) bus.emit('toast', { text: 'Действие пока недоступно', kind: 'bad' });
    return false;
  }
  fn(...args);
  return true;
}

/** Карта «сколько раз поймана рыба»: поддерживаем несколько возможных полей состояния. */
export function fishCaughtMap(state) {
  const out = Object.create(null);
  const stats = (state && state.stats) || {};
  const atlas = (state && state.atlas) || {};
  const sources = [stats.caughtByFish, stats.fishCounts, stats.byFish, atlas.records, atlas.caught, stats.caught];
  for (const src of sources) {
    if (!src || typeof src !== 'object' || Array.isArray(src)) continue;
    for (const [id, raw] of Object.entries(src)) {
      const rec = typeof raw === 'number' ? { count: raw } : raw || {};
      const count = firstNumber(rec.count, rec.n, rec.caught, rec.times);
      const maxKg = firstNumber(rec.maxKg, rec.biggestKg, rec.recordKg);
      if (count > 0 || maxKg > 0) out[id] = { count, maxKg };
    }
    if (Object.keys(out).length > 0) return out;
  }
  return out;
}

export function questRecord(state, questId) {
  const q = state && state.quests;
  if (!q) return null;
  if (Array.isArray(q)) return q.find((rec) => rec && rec.id === questId) || null;
  if (Array.isArray(q.active) && q.active.length > 0 && typeof q.active[0] === 'object') {
    return q.active.find((rec) => rec && rec.id === questId) || null;
  }
  const records = q.records || q.items;
  if (records && typeof records === 'object' && !Array.isArray(records) && records[questId]) {
    return records[questId];
  }
  return null;
}

function deriveQuestProgress(state, quest) {
  const stats = (state && state.stats) || {};
  const goal = (quest && quest.goal) || {};
  switch (goal.type) {
    case 'catchCount':
      return firstNumber(stats.catches);
    case 'catchKg':
      return firstNumber(stats.totalKg);
    case 'earnMoney':
      return firstNumber(stats.earnedMoney, stats.moneyEarned, stats.totalEarned);
    case 'catchFish': {
      if (num(goal.minKg) > 0) return 0;
      const counts = fishCaughtMap(state);
      return firstNumber(counts[goal.fishId] && counts[goal.fishId].count);
    }
    default:
      return 0;
  }
}

export function questProgress(state, quest) {
  const target = Math.max(1, num(quest && quest.goal && quest.goal.target, 1));
  const rec = questRecord(state, quest && quest.id);
  let value = NaN;
  if (rec) value = firstNumber(rec.progress, rec.value, rec.count, NaN);
  if (!Number.isFinite(value)) {
    const table = state && state.quests && state.quests.progress;
    if (table && typeof table === 'object') value = firstNumber(table[quest.id], NaN);
  }
  if (!Number.isFinite(value)) value = deriveQuestProgress(state, quest);
  return clamp(num(value), 0, target);
}

function includesId(list, id) {
  if (Array.isArray(list)) return list.some((item) => (item && item.id ? item.id === id : item === id));
  if (list && typeof list === 'object') return Boolean(list[id]);
  return false;
}

export function questClaimed(state, quest) {
  const q = (state && state.quests) || {};
  const rec = questRecord(state, quest.id) || {};
  if (rec.claimed === true || rec.status === 'claimed' || rec.done === 'claimed') return true;
  if (includesId(q.claimedIds, quest.id) || includesId(q.claimed, quest.id) || includesId(q.doneIds, quest.id)) {
    return true;
  }
  return false;
}

export function questStatus(state, quest) {
  if (questClaimed(state, quest)) return 'claimed';
  const target = Math.max(1, num(quest && quest.goal && quest.goal.target, 1));
  if (questProgress(state, quest) >= target) return 'ready';
  return 'active';
}

export function questGoalText(goal, fishLabel) {
  const target = num(goal && goal.target, 0);
  switch (goal && goal.type) {
    case 'catchCount':
      return `Поймать ${target} рыб(ы)`;
    case 'catchKg':
      return `Поймать ${round1(target)} кг рыбы`;
    case 'earnMoney':
      return `Заработать ${rub(target)}`;
    case 'catchFish': {
      const minKg = num(goal.minKg, 0);
      const name = fishLabel || 'рыбу';
      return minKg > 0 ? `Поймать ${name} от ${kg(minKg)}` : `Поймать ${name}`;
    }
    default:
      return 'Особое задание';
  }
}

/** Сохранить фокус и позицию каретки в поле поиска при перерисовке. */
export function keepFocus(input, wasFocused) {
  if (!wasFocused || !input) return;
  input.focus({ preventScroll: true });
  const end = input.value.length;
  try {
    input.setSelectionRange(end, end);
  } catch {
    /* поле могло не поддерживать выделение */
  }
}

export const closeIcon = '✕';
