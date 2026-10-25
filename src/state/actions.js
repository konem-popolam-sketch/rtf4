/**
 * actions.js — все мутаторы состояния (docs/API.md §3).
 * Панели и HUD меняют state только через эти функции. Каждая мутация заканчивается
 * markChanged() из './game.js': он эмитит 'state:changed' и планирует автосейв.
 */
import { bus } from '../core/bus.js';
import { clamp, round2, uid } from '../core/util.js';
import { FISH_BY_ID } from '../data/fish.js';
import { BAIT_BY_ID } from '../data/baits.js';
import { LURE_BY_ID } from '../data/lures.js';
import { TACKLE_BY_ID } from '../data/tackle.js';
import { WATER_BY_ID, ALL_SPOTS } from '../data/spots.js';
import { QUESTS, QUEST_BY_ID } from '../data/quests.js';
import { getState, markChanged, resetState, xpNext } from './game.js';

const MAX_FISH = 120;
const MAX_LOG = 200;
const RIGS = ['float', 'spinning', 'feeder', 'bottom'];
const TACKLE_KEYS = ['rodId', 'reelId', 'lineId', 'hookId', 'floatId', 'sinkerId', 'feederId'];
const VOLUME_KEYS = ['master', 'sfx', 'ambient'];
const st = () => getState();
const toast = (text, kind = 'bad') => bus.emit('toast', { text, kind });

function invChanged() {
  const s = st();
  if (s) bus.emit('inventory:changed', s.inventory);
}
/** Изменение баланса. При нехватке денег возвращает false и не меняет состояние. */
export function addMoney(delta, reason = 'misc') {
  const s = st();
  if (!s) return false;
  const d = Math.round(Number(delta) || 0);
  if (d === 0) return true;
  if (d < 0 && s.player.money + d < 0) { toast('Недостаточно денег', 'bad'); return false; }
  s.player.money = Math.max(0, s.player.money + d);
  const income = d > 0 && (reason === 'sell' || reason === 'quest');
  if (income) s.stats.earnedMoney = (Number(s.stats.earnedMoney) || 0) + d;
  if (d > 0 && reason === 'sell') progressQuest('earnMoney', { amount: d });
  bus.emit('money:changed', { money: s.player.money, delta: d });
  markChanged();
  return true;
}
/** Списание денег — обёртка над addMoney с отрицательной суммой. */
export function spend(amount) {
  return addMoney(-Math.abs(Number(amount) || 0), 'buy');
}
/** Начисление опыта с повышением уровней и восстановлением сил. */
export function addXp(amount) {
  const s = st();
  if (!s) return { level: 0, leveledUp: false };
  const gain = Number(amount) || 0;
  if (gain > 0) s.player.xp = (Number(s.player.xp) || 0) + gain;
  let leveledUp = false;
  let guard = 0;
  while (s.player.xp >= xpNext(s.player.level) && guard < 200) {
    s.player.xp -= xpNext(s.player.level);
    s.player.level += 1;
    s.player.skillPoints = (Number(s.player.skillPoints) || 0) + 1;
    s.player.energy = 100;
    s.player.satiety = 100;
    leveledUp = true;
    guard += 1;
    bus.emit('level:up', { level: s.player.level });
    toast(`Новый уровень: ${s.player.level}! Силы восстановлены.`, 'gold');
  }
  s.player.xp = Math.max(0, s.player.xp);
  markChanged();
  return { level: s.player.level, leveledUp };
}/** Проверка, не пора ли повысить уровень. Опыт не начисляет. */
export function levelUpCheck() {
  const s = st();
  return Boolean(s) && s.player.xp >= xpNext(s.player.level);
}
export function addBait(id, qty = 1) {
  const s = st();
  if (!s || !BAIT_BY_ID[id]) return 0;
  const n = Math.max(1, Math.floor(Number(qty) || 1));
  s.inventory.baits[id] = (Number(s.inventory.baits[id]) || 0) + n;
  invChanged();
  markChanged();
  return s.inventory.baits[id];
}
/** Тратит наживку. false — если на складе не хватает, состояние не меняется. */
export function useBait(id, qty = 1) {
  const s = st();
  if (!s) return false;
  const n = Math.max(1, Math.floor(Number(qty) || 1));
  const have = Number(s.inventory.baits[id]) || 0;
  if (have < n) return false;
  if (have - n > 0) s.inventory.baits[id] = have - n;
  else delete s.inventory.baits[id];
  invChanged();
  markChanged();
  return true;
}
/** Кладёт приманку в рюкзак, возвращает uid новой записи (null — неизвестный id). */
export function addLure(id) {
  const s = st();
  if (!s || !LURE_BY_ID[id]) return null;
  const lureUid = uid('lure');
  s.inventory.lures.push({ uid: lureUid, lureId: id, wear: 0 });
  invChanged();
  markChanged();
  return lureUid;
}
/** Элемент оснастки существует, куплен и доступен по уровню. */
function checkOwned(id) {
  const s = st();
  const item = TACKLE_BY_ID[id];
  if (!item) { toast('Такой снасти нет в каталоге', 'bad'); return false; }
  if (!s.inventory.tackleOwned.includes(id)) { toast('Этой снасти нет в рюкзаке', 'bad'); return false; }
  if ((Number(item.level) || 1) > s.player.level) {
    toast('Этот товар вам пока не по зубам', 'bad');
    return false;
  }
  return true;
}
/** Смена оснастки: проверка владения, уровня и взаимоисключения наживки/приманки. */
export function setTackle(patch) {
  const s = st();
  if (!s || !patch || typeof patch !== 'object') return false;
  const next = {};
  for (const key of TACKLE_KEYS) {
    if (!(key in patch)) continue;
    if (patch[key] === null) { next[key] = null; continue; }
    if (!checkOwned(patch[key])) return false;
    next[key] = patch[key];
  }
  if ('rig' in patch) {
    if (!RIGS.includes(patch.rig)) { toast('Неизвестный тип оснастки', 'bad'); return false; }
    next.rig = patch.rig;
  }
  if ('baitId' in patch && patch.baitId !== null && !BAIT_BY_ID[patch.baitId]) {
    toast('Такой наживки нет', 'bad');
    return false;
  }
  if ('lureId' in patch && patch.lureId !== null && !LURE_BY_ID[patch.lureId]) {
    toast('Такой приманки нет', 'bad');
    return false;
  }
  // Применяем атомарно, только после всех проверок.
  Object.assign(s.tackle, next);
  if ('baitId' in patch) s.tackle.baitId = patch.baitId || null;
  if ('lureId' in patch) s.tackle.lureId = patch.lureId || null;
  if (s.tackle.baitId) s.tackle.lureId = null;
  if (s.tackle.lureId) s.tackle.baitId = null;
  markChanged();
  invChanged();
  return true;
}
/** Прибавка к прогрессу по типу цели; 0 — событие не подходит этому квесту. */
function questDelta(goal, payload) {
  const kg = Number(payload.kg) || 0;
  switch (goal.type) {
    case 'catchCount':
      return goal.fishId && goal.fishId !== payload.fishId ? 0 : 1;
    case 'catchKg':
      return kg;
    case 'catchFish':
      if (goal.fishId && goal.fishId !== payload.fishId) return 0;
      return goal.minKg && kg < goal.minKg ? 0 : 1;
    case 'earnMoney':
      return Number(payload.amount) || 0;
    default:
      return 0;
  }
}
/** Продвигает активные квесты подходящего типа. true — если прогресс вырос. */
export function progressQuest(kind, payload = {}) {
  const s = st();
  if (!s || !s.quests) return false;
  const q = s.quests;
  const prog = q.progress || (q.progress = {});
  const claimed = q.claimedIds || (q.claimedIds = []);
  const done = q.doneIds || (q.doneIds = []);
  let changed = false;
  for (const quest of QUESTS) {
    const goal = quest.goal || {};
    if (goal.type !== kind || done.includes(quest.id)) continue;
    if (!quest.repeatable && claimed.includes(quest.id)) continue;
    const delta = questDelta(goal, payload);
    if (delta <= 0) continue;
    const prev = Number(prog[quest.id]) || 0;
    const value = Math.min(Number(goal.target) || 0, prev + delta);
    if (value === prev) continue;
    prog[quest.id] = value;
    changed = true;
    bus.emit('quest:progress', { id: quest.id, value });
  }
  if (changed) markChanged();
  return changed;
}
/** Забирает награду, если прогресс дошёл до цели и награда ещё не выдана. */
export function claimQuest(id) {
  const s = st();
  const quest = QUEST_BY_ID[id];
  if (!s || !quest || !s.quests) return false;
  const q = s.quests;
  const prog = q.progress || (q.progress = {});
  const claimed = q.claimedIds || (q.claimedIds = []);
  const done = q.doneIds || (q.doneIds = []);
  if (!quest.repeatable && (claimed.includes(id) || done.includes(id))) return false;
  const target = Number(quest.goal && quest.goal.target) || 0;
  const value = Number(prog[id]) || 0;
  if (value < target) return false;
  const reward = quest.reward || {};
  if (Number(reward.money) > 0) addMoney(Number(reward.money), 'quest');
  if (Number(reward.xp) > 0) addXp(Number(reward.xp));
  if (!claimed.includes(id)) claimed.push(id);
  if (quest.repeatable) prog[id] = 0;
  else if (!done.includes(id)) done.push(id);
  bus.emit('quest:progress', { id, value: prog[id] || 0 });
  toast(`Задание «${quest.title}» закрыто.`, 'gold');
  markChanged();
  return true;
}
/** Кладёт пойманную рыбу в садок, обновляет статистику, квесты и опыт. */
export function addFish(fishId, kg, cm) {
  const s = st();
  const fish = FISH_BY_ID[fishId];
  if (!s || !fish) return null;
  const weight = Math.max(0, round2(Number(kg) || 0));
  const length = Math.max(0, Math.round(Number(cm) || 0));
  const entry = { uid: uid('fish'), fishId, kg: weight, cm: length, ts: Date.now() };
  s.inventory.fish.push(entry);
  while (s.inventory.fish.length > MAX_FISH) s.inventory.fish.shift();
  const stats = s.stats;
  stats.catches = (Number(stats.catches) || 0) + 1;
  stats.totalKg = round2((Number(stats.totalKg) || 0) + weight);
  stats.biggestKg = Math.max(Number(stats.biggestKg) || 0, weight);
  const caught = stats.caughtByFish || (stats.caughtByFish = {});
  const prev = caught[fishId] || { count: 0, maxKg: 0 };
  const count = (Number(prev.count) || 0) + 1;
  caught[fishId] = { count, maxKg: Math.max(Number(prev.maxKg) || 0, weight) };
  addXp(fish.xp);
  progressQuest('catchCount', { fishId, kg: weight });
  progressQuest('catchKg', { kg: weight });
  progressQuest('catchFish', { fishId, kg: weight });
  bus.emit('catch:landed', { fish, kg: weight, cm: length });
  invChanged();
  markChanged();
  return entry;
}
/** Цена записи садка по прайсу вида. */
function priceOf(entry) {
  const fish = FISH_BY_ID[entry.fishId];
  return fish ? round2((Number(entry.kg) || 0) * fish.pricePerKg) : 0;
}
/** Продажа одной рыбы из садка. Возвращает выручку (0 — если записи нет). */
export function sellFish(fishUid) {
  const s = st();
  if (!s) return 0;
  const idx = s.inventory.fish.findIndex((entry) => entry.uid === fishUid);
  if (idx < 0) return 0;
  const price = priceOf(s.inventory.fish[idx]);
  s.inventory.fish.splice(idx, 1);
  if (price > 0) addMoney(price, 'sell');
  bus.emit('sfx', { name: 'sell' });
  invChanged();
  markChanged();
  return price;
}
/** Продажа всего садка одним разом. Возвращает суммарную выручку. */
export function sellAllFish() {
  const s = st();
  if (!s || s.inventory.fish.length === 0) return 0;
  const total = round2(s.inventory.fish.reduce((sum, entry) => sum + priceOf(entry), 0));
  s.inventory.fish.length = 0;
  if (total > 0) addMoney(total, 'sell');
  bus.emit('sfx', { name: 'sell' });
  invChanged();
  markChanged();
  return total;
}
/** Переезд на водоём: проверка уровня, оплата дороги, выбор точки. */
export function setWater(id) {
  const s = st();
  const water = WATER_BY_ID[id];
  if (!s || !water) return false;
  if ((Number(water.unlockLevel) || 1) > s.player.level) {
    toast(`Водоём закрыт: нужен уровень ${water.unlockLevel}`, 'bad');
    return false;
  }
  const cost = s.world.waterId === id ? 0 : Number(water.travelCost) || 0;
  if (cost > 0 && !spend(cost)) return false;
  s.world.waterId = id;
  const sameSpot = water.spots.some((spot) => spot.id === s.world.spotId);
  if (!sameSpot) s.world.spotId = water.spots[0] ? water.spots[0].id : null;
  bus.emit('world:changed', { waterId: s.world.waterId, spotId: s.world.spotId });
  toast(`${water.name}: добро пожаловать на воду.`, 'info');
  markChanged();
  return true;
}
export function setSpot(id) {
  const s = st();
  if (!s) return false;
  const spot = ALL_SPOTS.find((item) => item.id === id);
  if (!spot || spot.waterId !== s.world.waterId) { toast('Эта точка на другом водоёме', 'bad'); return false; }
  s.world.spotId = id;
  bus.emit('world:changed', { waterId: s.world.waterId, spotId: id });
  markChanged();
  return true;
}
/** Покупка любой позиции каталога: наживка, приманка или снасть. */
export function buyItem(id, qty = 1) {
  const s = st();
  if (!s) return false;
  const n = Math.max(1, Math.floor(Number(qty) || 1));
  const bait = BAIT_BY_ID[id];
  const lure = LURE_BY_ID[id];
  const item = bait || lure || TACKLE_BY_ID[id];
  if (!item) return false;
  // Снасть хранится без количества, поэтому покупается всегда один экземпляр.
  const count = bait || lure ? n : 1;
  if (!bait && !lure && (Number(item.level) || 1) > s.player.level) {
    toast('Этот товар вам пока не по зубам', 'bad');
    return false;
  }
  const price = round2(item.price * count);
  if (s.player.money < price) { toast('Недостаточно денег', 'bad'); return false; }
  addMoney(-price, 'buy');
  if (bait) { addBait(id, count); return true; }
  if (lure) {
    for (let i = 0; i < count; i += 1) addLure(id);
    return true;
  }
  if (!s.inventory.tackleOwned.includes(id)) s.inventory.tackleOwned.push(id);
  invChanged();
  markChanged();
  return true;
}
export function buyBait(id, qty = 1) {
  return Boolean(BAIT_BY_ID[id]) && buyItem(id, qty);
}
export function buyLure(id) {
  return Boolean(LURE_BY_ID[id]) && buyItem(id, 1);
}
export function buyTackle(id) {
  return Boolean(TACKLE_BY_ID[id]) && buyItem(id, 1);
}
export function setVolume(patch) {
  const s = st();
  if (!s || !patch || typeof patch !== 'object') return;
  const vol = s.settings.volume;
  for (const key of VOLUME_KEYS) {
    if (!(key in patch)) continue;
    const v = Number(patch[key]);
    if (Number.isFinite(v)) vol[key] = clamp(v, 0, 1);
  }
  markChanged();
  bus.emit('settings:changed', s.settings);
}
export function setTimeScale(x) {
  const s = st();
  if (!s) return;
  const v = Number(x);
  s.settings.timeScale = clamp(Number.isFinite(v) ? v : 1, 1, 8);
  markChanged();
  bus.emit('settings:changed', s.settings);
}
/** Сброс сейва и перезагрузка страницы (в Node только чистит состояние). */
export function resetSave() {
  resetState();
  if (typeof location !== 'undefined' && location && typeof location.reload === 'function') location.reload();
  return Promise.resolve();
}
export function addToLog(text) {
  const s = st();
  if (!s) return;
  const line = String(text == null ? '' : text).trim();
  if (!line) return;
  s.log.unshift({ ts: Date.now(), text: line });
  if (s.log.length > MAX_LOG) s.log.length = MAX_LOG;
  markChanged();
}
export function setPanel(name) {
  const s = st();
  if (!s) return;
  s.ui.panel = name || null;
  bus.emit('ui:panel', { name: s.ui.panel });
  markChanged();
}
let tickAccumSec = 0;
let drainBucket = null;
/** Копит игровые минуты; раз в 30 минут снимает сытость и энергию. */
export function tickPlayTime(dtSec) {
  const s = st();
  const dt = Number(dtSec) || 0;
  if (!s || dt <= 0) return;
  s.stats.playMinutes = (Number(s.stats.playMinutes) || 0) + dt / 60;
  const bucket = Math.floor(s.stats.playMinutes / 30);
  if (drainBucket === null || bucket < drainBucket) drainBucket = bucket;
  if (bucket > drainBucket) {
    const steps = bucket - drainBucket;
    drainBucket = bucket;
    s.player.satiety = Math.max(0, round2((Number(s.player.satiety) || 0) - steps));
    s.player.energy = Math.max(0, round2((Number(s.player.energy) || 0) - steps * 0.5));
    tickAccumSec = 0;
    markChanged();
    return;
  }
  tickAccumSec += dt;
  if (tickAccumSec >= 1) { tickAccumSec = 0; markChanged(); }
}
/** Агрегатор для панелей: ctx.actions. */
export const actions = {
  addMoney, addXp, spend, addBait, useBait, addLure, setTackle, addFish, sellFish, sellAllFish,
  setWater, setSpot, buyItem, buyBait, buyLure, buyTackle, claimQuest, setVolume, setTimeScale,
  resetSave, addToLog, setPanel, levelUpCheck, tickPlayTime, progressQuest,
};
