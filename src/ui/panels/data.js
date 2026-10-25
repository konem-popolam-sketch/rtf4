/**
 * Справочники панелей: единая точка чтения данных игры.
 * Схемы совпадают с docs/API.md §2; недостающие поля аккуратно подставляются.
 * Владелец: ui-programmer.
 */
import { FISH } from '../../data/fish.js';
import { BAITS } from '../../data/baits.js';
import { LURES } from '../../data/lures.js';
import { TACKLE_BY_ID } from '../../data/tackle.js';
import { WATERS } from '../../data/spots.js';
import { QUESTS } from '../../data/quests.js';
import { fmtKg } from '../../core/util.js';

const asList = (value) => (Array.isArray(value) ? value.filter((item) => item && item.id) : []);
const asMap = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});

export const fishes = asList(FISH);
export const baits = asList(BAITS);
export const lures = asList(LURES);
export const waters = asList(WATERS);
export const quests = asList(QUESTS);

export const FISH_BY_ID = { ...asMap(FISH && FISH.byId), ...Object.fromEntries(fishes.map((f) => [f.id, f])) };
export const BAIT_BY_ID = Object.fromEntries(baits.map((b) => [b.id, b]));
export const LURE_BY_ID = Object.fromEntries(lures.map((l) => [l.id, l]));
export const TACKLE = asMap(TACKLE_BY_ID);

const FALLBACK_FISH = {
  name: 'Неизвестная рыба',
  rarity: 0,
  pricePerKg: 0,
  xp: 0,
  minKg: 0,
  maxKg: 0,
  water: [],
  bait: [],
  lure: [],
  desc: '',
  shape: 'torpedo',
  color: '#6d8791',
};

export function fishOf(id) {
  return FISH_BY_ID[id] || { ...FALLBACK_FISH, id, name: id || '—' };
}

export function fishName(id) {
  return fishOf(id).name;
}

export function baitOf(id) {
  return BAIT_BY_ID[id] || null;
}

export function lureOf(id) {
  return LURE_BY_ID[id] || null;
}

export function baitName(id) {
  return baitOf(id) ? baitOf(id).name : 'Наживка';
}

export function lureName(id) {
  return lureOf(id) ? lureOf(id).name : 'Приманка';
}

export function tackleOf(id) {
  return TACKLE[id] || null;
}

export function tackleName(id) {
  const item = tackleOf(id);
  return item ? item.name || id : '—';
}

/** Цена рыбы за конкретный вес; если в записи садка уже есть price — берём его. */
export function fishPrice(fishId, weightKg, explicitPrice) {
  if (Number.isFinite(Number(explicitPrice)) && Number(explicitPrice) > 0) return Math.round(Number(explicitPrice));
  const fish = fishOf(fishId);
  return Math.max(0, Math.round((Number(fish.pricePerKg) || 0) * (Number(weightKg) || 0)));
}

export function fishLabel(fishId, weightKg) {
  if (weightKg == null || !Number.isFinite(Number(weightKg))) return fishName(fishId);
  return `${fishName(fishId)} · ${fmtKg(weightKg)}`;
}

const CATEGORY_PREFIXES = [
  ['rod', 'rod_'],
  ['reel', 'reel_'],
  ['line', 'line_'],
  ['hook', 'hook_'],
  ['float', 'float_'],
  ['sinker', 'sinker_'],
  ['feeder', 'feeder_'],
];

export const TACKLE_CATEGORIES = [
  { id: 'rod', name: 'Удилище', slot: 'rodId' },
  { id: 'reel', name: 'Катушка', slot: 'reelId' },
  { id: 'line', name: 'Леска', slot: 'lineId' },
  { id: 'hook', name: 'Крючок', slot: 'hookId' },
  { id: 'float', name: 'Поплавок', slot: 'floatId' },
  { id: 'sinker', name: 'Грузило', slot: 'sinkerId' },
  { id: 'feeder', name: 'Кормушка', slot: 'feederId' },
];

export function tackleCategory(id) {
  for (const [cat, prefix] of CATEGORY_PREFIXES) {
    if (String(id).startsWith(prefix)) return cat;
  }
  return '';
}

export function tackleByCategory(cat) {
  return Object.values(TACKLE)
    .filter((item) => item && item.id && tackleCategory(item.id) === cat)
    .sort((a, b) => (Number(a.level) || 1) - (Number(b.level) || 1) || (Number(a.price) || 0) - (Number(b.price) || 0));
}

export function rigKindList(rig) {
  switch (rig) {
    case 'spinning':
      return ['spin', 'spinning'];
    case 'float':
      return ['float'];
    case 'feeder':
      return ['feeder'];
    case 'bottom':
      return ['bottom'];
    default:
      return ['float', 'spin', 'spinning', 'feeder', 'bottom'];
  }
}

export function isRodFitsRig(rod, rig) {
  if (!rod) return false;
  if (!rod.kind) return true;
  return rigKindList(rig).includes(rod.kind);
}

/** Список id снастей, которыми игрок реально владеет (плюс надетые сейчас). */
export function ownedTackleIds(state) {
  const inv = (state && state.inventory) || {};
  const owned = Array.isArray(inv.tackleOwned) ? inv.tackleOwned.filter(Boolean) : [];
  const eq = equippedTackleIds(state);
  const all = owned.length > 0 ? owned : Object.keys(TACKLE);
  const set = new Set(all);
  eq.forEach((id) => set.add(id));
  return Array.from(set);
}

export function equippedTackleIds(state) {
  const gear = (state && state.tackle) || {};
  return ['rodId', 'reelId', 'lineId', 'hookId', 'floatId', 'sinkerId', 'feederId']
    .map((slot) => gear[slot])
    .filter(Boolean);
}

export function waterOf(id) {
  return waters.find((w) => w.id === id) || null;
}

export function waterName(id) {
  const water = waterOf(id);
  return water ? water.name : 'Водоём';
}

export function spotOf(waterId, spotId) {
  const water = waterOf(waterId);
  const spots = water && Array.isArray(water.spots) ? water.spots : [];
  return spots.find((s) => s.id === spotId) || null;
}

export function questsList() {
  return quests.slice();
}

export const WATER_BY_ID = Object.fromEntries(waters.map((w) => [w.id, w]));
