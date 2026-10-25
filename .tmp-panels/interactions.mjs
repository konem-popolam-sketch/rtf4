/**
 * Интерактивный тест панелей: клики/изменения через делегированные обработчики
 * должны приводить к вызовам actions и менять состояние стора.
 */
import { setupFakeDom, makeTarget, makeMemoryStorage } from './fake-dom.mjs';

setupFakeDom();
const { bus } = await import('../src/core/bus.js');
const { initState } = await import('../src/state/game.js');
const actions = await import('../src/state/actions.js');
const { initPanels } = await import('../src/ui/panels/index.js');

const state = initState(makeMemoryStorage());
state.player.money = 100000;
state.player.level = 8;
state.inventory.fish = [
  { uid: 'f1', fishId: 'okun', kg: 0.42, cm: 24, ts: Date.now() },
  { uid: 'f2', fishId: 'schuka', kg: 3.1, cm: 71, ts: Date.now() },
];
state.quests.progress = { q_pond_mix: 5 };
state.inventory.lures = [{ uid: 'l1', lureId: 'vertushka', wear: 0.2 }];

const panels = initPanels({ bus, state, actions });

const pass = [];
const fail = [];
const check = (name, cond, extra = '') => {
  if (cond) pass.push(name);
  else fail.push(`${name}${extra ? ` — ${extra}` : ''}`);
};

function bodyOf(name) {
  const entry = panels.panels.get(name);
  return entry.container.firstElementChild._slots.body;
}

function click(name, dataset) {
  const body = bodyOf(name);
  const target = makeTarget(dataset);
  body.fire('click', {
    target,
    preventDefault() {},
    stopPropagation() {},
  });
}

function change(name, dataset) {
  const body = bodyOf(name);
  const target = makeTarget(dataset);
  body.fire('change', { target });
  body.fire('input', { target });
}

// ---------- Инвентарь: продажа одной рыбы и всего улова
panels.open('inventory');
const money0 = state.player.money;
click('inventory', { act: 'sell', uid: 'f1' });
check('inventory: продажа одной рыбы уменьшает садок', state.inventory.fish.length === 1, `len=${state.inventory.fish.length}`);
check('inventory: деньги выросли', state.player.money > money0, `${money0}->${state.player.money}`);
click('inventory', { act: 'sell-all' });
check('inventory: продажа всего улова очищает садок', state.inventory.fish.length === 0);

// ---------- Магазин: покупка наживки и приманки, продажа
panels.open('shop');
const money1 = state.player.money;
const cherv0 = state.inventory.baits.cherv || 0;
click('shop', { act: 'buy', id: 'cherv', qty: '5' });
check('shop: покупка наживки +5', (state.inventory.baits.cherv || 0) === cherv0 + 5, `cherv=${state.inventory.baits.cherv}`);
check('shop: деньги списались', state.player.money < money1);
const money2 = state.player.money;
click('shop', { act: 'buy-tackle', id: 'rod_float_pro' });
check('shop: покупка снасти в рюкзак', state.inventory.tackleOwned.includes('rod_float_pro'));
check('shop: деньги за снасть списались', state.player.money < money2);

// ---------- Карта: переезд на другой водоём
panels.open('map');
click('map', { act: 'goto', water: 'volga', spot: (await import('../src/data/spots.js')).WATER_BY_ID.volga.spots[1].id });
check('map: водоём сменился', state.world.waterId === 'volga', state.world.waterId);
check('map: точка установлена', Boolean(state.world.spotId));
check('map: панель закрылась после переезда', panels.isOpen() === null, String(panels.isOpen()));

// ---------- Экипировка: смена оснастки и слота
panels.open('tackle');
actions.buyTackle('hook_l');
change('tackle', { act: 'gear', slot: 'hookId', value: 'hook_l' });
check('tackle: крючок сменён', state.tackle.hookId === 'hook_l', state.tackle.hookId);
click('tackle', { act: 'rig', rig: 'feeder' });
check('tackle: оснастка сменена на фидер', state.tackle.rig === 'feeder', state.tackle.rig);
click('tackle', { act: 'bait', id: 'oparysh' });
check('tackle: наживка поставлена', state.tackle.baitId === 'oparysh', state.tackle.baitId);
click('tackle', { act: 'lure', id: 'vertushka', uid: 'l1' });
check('tackle: приманка вытеснила наживку', state.tackle.lureId === 'vertushka' && state.tackle.baitId === null);

// ---------- Задания: забрать награду
panels.open('quests');
const money3 = state.player.money;
click('quests', { act: 'claim', id: 'q_pond_mix' });
check('quests: награда забрана', state.quests.claimedIds.includes('q_pond_mix'), JSON.stringify(state.quests.claimedIds));
check('quests: деньги за квест пришли', state.player.money > money3, `${money3}->${state.player.money}`);

// ---------- Настройки: громкость и скорость времени
panels.open('settings');
change('settings', { act: 'volume', key: 'master', value: '35' });
check('settings: громкость обновлена', Math.abs(state.settings.volume.master - 0.35) < 1e-6, String(state.settings.volume.master));
click('settings', { act: 'time-preset', scale: '4' });
check('settings: скорость времени ×4', state.settings.timeScale === 4, String(state.settings.timeScale));
click('settings', { act: 'reset-ask' });
check('settings: подтверждение сброса показано', panels.panels.get('settings').panel.isOpen === true);

console.log(`\nПройдено: ${pass.length}`);
if (fail.length) {
  console.log(`Провалено: ${fail.length}`);
  for (const f of fail) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log('Интерактивные проверки панелей пройдены.');
