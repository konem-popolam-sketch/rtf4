/**
 * Панель «Магазин»: наживки, приманки, снасти и скупка улова.
 * Покупки и продажа — только через actions.*; деньги показываются сверху.
 * Владелец: ui-programmer.
 */
import { mountPanel, bindDelegated, buyGood, clickSfx, sellAllFish, sellFish } from './shell.js';
import { bar, chip, emptyState, esc, RIG_NAMES, rub } from './common.js';
import { fmtKg } from '../../core/util.js';
import {
  baits,
  fishName,
  fishPrice,
  lures,
  TACKLE,
  TACKLE_CATEGORIES,
  ownedTackleIds,
  tackleByCategory,
} from './data.js';

const TABS = [
  { id: 'baits', name: 'Наживки' },
  { id: 'lures', name: 'Приманки' },
  { id: 'tackle', name: 'Снасти' },
  { id: 'sell', name: 'Скупка улова' },
];

function tabBar(active) {
  return `<div class="pn-tabs">${TABS.map(
    (tab) =>
      `<button class="pn-tab${tab.id === active ? ' pn-tab--active' : ''}" type="button" data-act="tab" data-tab="${tab.id}">${esc(
        tab.name,
      )}</button>`,
  ).join('')}</div>`;
}

function moneyClass(price, money) {
  return price > money ? 'u-bad' : 'u-gold';
}

function buyButtons(id, disabled, qty = true) {
  return `
    <button class="btn btn--sm btn--primary" type="button" data-act="buy" data-id="${esc(id)}" data-qty="1" ${disabled}>Купить</button>
    ${qty ? `<button class="btn btn--sm" type="button" data-act="buy" data-id="${esc(id)}" data-qty="5" ${disabled}>×5</button>` : ''}`;
}

function baitCard(item, owned, money) {
  const price = Math.max(1, Math.round(Number(item.price) || 0));
  const poor = price > money;
  const attraction = item.attraction || {};
  return `
    <article class="pn-good${poor ? ' pn-good--poor' : ''}">
      <header class="pn-good__head">
        <span class="pn-item__icon" style="--tone:${esc(item.color || 'var(--c-accent)')}"></span>
        <b class="pn-good__name">${esc(item.name || item.id)}</b>
        <span class="pn-badge u-mono">×${owned}</span>
      </header>
      <div class="pn-good__meta">
        ${chip(`крючок ${String(item.hookSize || 'm').toUpperCase()}`)}
        ${chip(`${Number(item.sizeMm) || 0} мм`)}
        ${chip(`дно: ${esc(item.depthWork || 'mid')}`)}
      </div>
      <div class="pn-good__attr">
        <span>мелкая</span>${bar(attraction.small, 1, 'skill')}
        <span>средняя</span>${bar(attraction.medium, 1, 'skill')}
        <span>крупная</span>${bar(attraction.big, 1, 'skill')}
      </div>
      ${item.notes ? `<p class="pn-good__note">${esc(item.notes)}</p>` : ''}
      <footer class="pn-good__foot">
        <span class="pn-price ${moneyClass(price, money)}">${rub(price)}</span>
        ${buyButtons(item.id, poor)}
      </footer>
    </article>`;
}

function lureCard(item, owned, money) {
  const price = Math.max(1, Math.round(Number(item.price) || 0));
  const poor = price > money;
  return `
    <article class="pn-good${poor ? ' pn-good--poor' : ''}">
      <header class="pn-good__head">
        <span class="pn-item__icon" style="--tone:${esc(item.color || 'var(--c-skill)')}"></span>
        <b class="pn-good__name">${esc(item.name || item.id)}</b>
        <span class="pn-badge u-mono">×${owned}</span>
      </header>
      <div class="pn-good__meta">
        ${chip(`крючок ${String(item.hookSize || 'm').toUpperCase()}`)}
        ${chip(`${Number(item.sizeMm) || 0} мм`)}
        ${chip(`дно: ${esc(item.depthWork || 'mid')}`)}
      </div>
      <div class="pn-good__attr">
        <span>мелкая</span>${bar(item.attraction && item.attraction.small, 1, 'good')}
        <span>средняя</span>${bar(item.attraction && item.attraction.medium, 1, 'good')}
        <span>крупная</span>${bar(item.attraction && item.attraction.big, 1, 'good')}
      </div>
      ${item.notes ? `<p class="pn-good__note">${esc(item.notes)}</p>` : ''}
      <footer class="pn-good__foot">
        <span class="pn-price ${moneyClass(price, money)}">${rub(price)}</span>
        ${buyButtons(item.id, poor, false)}
      </footer>
    </article>`;
}

function lureWear(state) {
  const list = (state && state.inventory && state.inventory.lures) || [];
  const counts = Object.create(null);
  for (const item of list) {
    const id = item && (item.lureId || item.id);
    if (id) counts[id] = (counts[id] || 0) + 1;
  }
  return counts;
}

function baitsTab(api) {
  const state = api.state;
  const money = Number(state && state.player && state.player.money) || 0;
  const owned = (state && state.inventory && state.inventory.baits) || {};
  if (baits.length === 0) return emptyState('Каталог наживок пуст.');
  return `<div class="pn-grid pn-grid--goods">${baits
    .map((item) => baitCard(item, Number(owned[item.id]) || 0, money))
    .join('')}</div>`;
}

function luresTab(api) {
  const state = api.state;
  const money = Number(state && state.player && state.player.money) || 0;
  const counts = lureWear(state);
  if (lures.length === 0) return emptyState('Каталог приманок пуст.');
  return `<div class="pn-grid pn-grid--goods">${lures
    .map((item) => lureCard(item, counts[item.id] || 0, money))
    .join('')}</div>`;
}

function tackleRow(item, cat, state, money, ownedSet) {
  const price = Math.max(0, Math.round(Number(item.price) || 0));
  const level = Number(item.level) || 1;
  const playerLevel = Number(state && state.player && state.player.level) || 1;
  const owned = ownedSet.has(item.id);
  const lowLevel = level > playerLevel;
  const poor = price > money;
  const disabled = owned || lowLevel || poor ? 'disabled' : '';
  const btnText = owned ? 'Куплено' : lowLevel ? `С ур. ${level}` : 'Купить';
  return `
    <tr class="${owned ? 'pn-row--owned' : ''}">
      <td class="pn-cell-main"><b>${esc(item.name || item.id)}</b><span class="pn-sub">${esc(item.desc || '')}</span></td>
      <td>${item.kind ? chip(RIG_NAMES[item.kind === 'spin' ? 'spinning' : item.kind] || item.kind) : ''}</td>
      <td class="pn-cell-specs">${tackleSpecs(item)}</td>
      <td class="u-mono">ур. ${level}</td>
      <td class="u-mono ${moneyClass(price, money)}">${price > 0 ? rub(price) : '—'}</td>
      <td class="pn-cell-act">
        <button class="btn btn--sm ${owned ? 'btn--ghost' : 'btn--primary'}" type="button"
          data-act="buy-tackle" data-id="${esc(item.id)}" ${disabled}>${esc(btnText)}</button>
      </td>
    </tr>`;
}

function tackleSpecs(item) {
  const specs = [];
  if (item.power != null) specs.push(`мощь ${Math.round(item.power * 100)}`);
  if (item.maxLoadKg != null) specs.push(`до ${item.maxLoadKg} кг`);
  if (item.castRangeM != null) specs.push(`бросок ${item.castRangeM} м`);
  if (item.sensitivity != null) specs.push(`чуйка ${Math.round(item.sensitivity * 100)}`);
  if (item.reelSpeed != null) specs.push(`катушка ${Math.round(item.reelSpeed * 100)}`);
  if (item.maxDragKg != null) specs.push(`фрикцион ${item.maxDragKg} кг`);
  if (item.lineTestKg != null) specs.push(`тест ${item.lineTestKg} кг`);
  if (item.diameterMm != null) specs.push(`Ø ${item.diameterMm} мм`);
  if (item.invisibility != null) specs.push(`незаметность ${Math.round(item.invisibility * 100)}`);
  if (item.strength != null) specs.push(`прочность ${Math.round(item.strength * 100)}`);
  if (item.size && !item.strength) specs.push(`размер ${String(item.size).toUpperCase()}`);
  if (item.buoyancy != null) specs.push(`плавучесть ${Math.round(item.buoyancy * 100)}`);
  if (item.weightG != null) specs.push(`${item.weightG} г`);
  return specs.map((s) => `<span class="pn-spec">${esc(s)}</span>`).join('');
}

function tackleTab(api) {
  const state = api.state;
  const money = Number(state && state.player && state.player.money) || 0;
  const ownedSet = new Set(ownedTackleIds(state));
  const sections = TACKLE_CATEGORIES.map((cat) => {
    const list = tackleByCategory(cat.id);
    if (list.length === 0) return '';
    return `
      <section class="pn-card">
        <h3 class="pn-card__title">${esc(cat.name)}</h3>
        <div class="pn-tablewrap">
          <table class="pn-table pn-table--shop">
            <thead><tr><th>Название</th><th>Тип</th><th>Характеристики</th><th>Уровень</th><th>Цена</th><th></th></tr></thead>
            <tbody>${list.map((item) => tackleRow(item, cat.id, state, money, ownedSet)).join('')}</tbody>
          </table>
        </div>
      </section>`;
  }).join('');
  return sections || emptyState('Каталог снастей пуст.');
}

function sellTab(api) {
  const state = api.state;
  const fish = (state && state.inventory && state.inventory.fish) || [];
  if (fish.length === 0) return emptyState('Продавать нечего: садок пуст.');
  let total = 0;
  let totalKg = 0;
  const rows = fish.map((item) => {
    const kg = Number(item.kg) || 0;
    const price = fishPrice(item.fishId, kg, item.price);
    total += price;
    totalKg += kg;
    return `
      <tr>
        <td class="pn-cell-main">${esc(fishName(item.fishId))}<span class="pn-sub">${esc(item.cm ? `${Math.round(item.cm)} см` : '')}</span></td>
        <td class="u-mono">${fmtKg(kg)}</td>
        <td class="u-mono pn-cell-price">${rub(price)}</td>
        <td class="pn-cell-act"><button class="btn btn--sm" type="button" data-act="sell" data-uid="${esc(item.uid)}">Продать</button></td>
      </tr>`;
  });
  return `
    <div class="pn-sellhead">
      <span class="pn-kv"><span>В садке</span><b class="u-mono">${fish.length}</b></span>
      <span class="pn-kv"><span>Вес</span><b class="u-mono">${fmtKg(totalKg)}</b></span>
      <span class="pn-kv"><span>Выручка</span><b class="u-mono u-gold">${rub(total)}</b></span>
      <span class="u-spacer"></span>
      <button class="btn btn--primary" type="button" data-act="sell-all">Продать всё за ${rub(total)}</button>
    </div>
    <div class="pn-tablewrap">
      <table class="pn-table">
        <thead><tr><th>Рыба</th><th>Вес</th><th>Цена</th><th></th></tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    </div>`;
}

export function mount(root, ctx) {
  let tab = 'baits';
  const panel = mountPanel(root, ctx, {
    name: 'shop',
    title: 'Магазин',
    subtitle: 'Снасти и наживки',
    className: 'pn-sheet--shop',
    events: ['state:changed', 'inventory:changed', 'money:changed', 'level:up'],
    render(api) {
      const state = api.state;
      const money = Number(state && state.player && state.player.money) || 0;
      const level = Number(state && state.player && state.player.level) || 1;
      api.sheet.setSub(`Уровень ${level}`);
      api.sheet.setExtra(`<span class="pn-money">${rub(money)}</span>`);
      const body =
        tab === 'lures' ? luresTab(api) : tab === 'tackle' ? tackleTab(api) : tab === 'sell' ? sellTab(api) : baitsTab(api);
      api.sheet.body.innerHTML = `${tabBar(tab)}<div class="pn-tabbody">${body}</div>`;
      return bindDelegated(api.sheet.body, {
        tab(target) {
          if (tab === target.dataset.tab) return;
          clickSfx(api.bus);
          tab = target.dataset.tab;
          panel.render();
        },
        buy(target) {
          clickSfx(api.bus);
          const id = target.dataset.id;
          if (!id) return;
          const card = target.closest('.pn-good');
          const nameEl = card && card.querySelector('.pn-good__name');
          const qty = Number(target.dataset.qty) || 1;
          const ok = buyGood(api.actions, api.bus, tab === 'lures' ? 'lure' : 'bait', id, qty);
          if (ok && nameEl) {
            api.bus.emit('toast', { text: `Куплено: ${nameEl.textContent}${qty > 1 ? ` ×${qty}` : ''}`, kind: 'good' });
          }
        },
        'buy-tackle'(target) {
          clickSfx(api.bus);
          const ok = buyGood(api.actions, api.bus, 'tackle', target.dataset.id, 1);
          if (ok) {
            const row = target.closest('tr');
            const nameEl = row && row.querySelector('.pn-cell-main b');
            if (nameEl) api.bus.emit('toast', { text: `Куплено: ${nameEl.textContent}`, kind: 'good' });
          }
        },
        sell(target) {
          clickSfx(api.bus);
          sellFish(api.actions, api.bus, target.dataset.uid);
        },
        'sell-all'() {
          clickSfx(api.bus);
          sellAllFish(api.actions, api.bus);
        },
      });
    },
  });
  return panel;
}

export const SHOP_TACKLE_COUNT = Object.keys(TACKLE).length;
