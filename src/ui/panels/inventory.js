/**
 * Панель «Инвентарь»: садок с рыбой, наживки и приманки.
 * Продажа — только через actions.sellFish / actions.sellAllFish.
 * Владелец: ui-programmer.
 */
import { mountPanel, bindDelegated, clickSfx, equipBait, equipLure, sellFish, sellAllFish } from './shell.js';
import { emptyState, esc, rub } from './common.js';
import { fmtKg, plural } from '../../core/util.js';
import { baitOf, fishName, fishOf, fishPrice, lureOf } from './data.js';

const fishCountLabel = (n) => `${n} ${plural(n, 'рыба', 'рыбы', 'рыб')}`;

function catchRows(state) {
  const inv = (state && state.inventory) || {};
  const fish = Array.isArray(inv.fish) ? inv.fish : [];
  if (fish.length === 0) {
    return {
      totalKg: 0,
      totalPrice: 0,
      html: emptyState('Садок пуст. Забросьте снасть и дождитесь поклёвки.'),
    };
  }
  let totalKg = 0;
  let totalPrice = 0;
  const rows = fish.map((item) => {
    const kg = Number(item.kg) || 0;
    const price = fishPrice(item.fishId, kg, item.price);
    totalKg += kg;
    totalPrice += price;
    const fish = fishOf(item.fishId);
    return `
      <tr>
        <td class="pn-cell-main">
          <span class="pn-fishdot" style="--fish:${esc(fish.color || 'var(--c-accent)')}"></span>
          <span>${esc(fishName(item.fishId))}</span>
          <span class="pn-sub">${esc(item.cm ? `${Math.round(item.cm)} см` : '')}</span>
        </td>
        <td class="u-mono">${fmtKg(kg)}</td>
        <td class="u-mono pn-cell-price">${rub(price)}</td>
        <td class="pn-cell-act">
          <button class="btn btn--sm btn--primary" type="button" data-act="sell" data-uid="${esc(item.uid)}">Продать</button>
        </td>
      </tr>`;
  });
  const html = `
    <div class="pn-tablewrap">
      <table class="pn-table pn-table--catch">
        <thead>
          <tr><th>Рыба</th><th>Вес</th><th>Цена</th><th></th></tr>
        </thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    </div>`;
  return { totalKg, totalPrice, html };
}

function baitsBlock(state) {
  const baits = (state && state.inventory && state.inventory.baits) || {};
  const entries = Object.entries(baits).filter(([, n]) => Number(n) > 0);
  if (entries.length === 0) return emptyState('Наживки закончились — загляните в магазин.');
  const items = entries
    .map(([id, count]) => {
      const bait = baitOf(id);
      const name = bait ? bait.name : id;
      const notes = bait && bait.notes ? bait.notes : '';
      return `
        <li class="pn-item">
          <span class="pn-item__icon" style="--tone:${esc((bait && bait.color) || 'var(--c-accent)')}"></span>
          <span class="pn-item__main">
            <b>${esc(name)}</b>
            <span class="pn-sub">${esc(notes)}</span>
          </span>
          <span class="pn-badge u-mono">×${count}</span>
          <button class="btn btn--sm" type="button" data-act="use-bait" data-id="${esc(id)}">Насадить</button>
        </li>`;
    })
    .join('');
  return `<ul class="pn-list">${items}</ul>`;
}

function luresBlock(state) {
  const list = (state && state.inventory && state.inventory.lures) || [];
  if (!Array.isArray(list) || list.length === 0) return emptyState('Приманок нет — купите в магазине.');
  const grouped = new Map();
  for (const item of list) {
    const id = item && (item.lureId || item.id);
    if (!id) continue;
    const rec = grouped.get(id) || { count: 0, wear: 0, uid: item.uid };
    rec.count += 1;
    rec.wear = Math.max(rec.wear, Number(item.wear) || 0);
    grouped.set(id, rec);
  }
  const items = Array.from(grouped.entries())
    .map(([id, rec]) => {
      const lure = lureOf(id);
      const name = lure ? lure.name : id;
      const wear = Math.round(Math.max(0, Math.min(1, rec.wear)) * 100);
      return `
        <li class="pn-item">
          <span class="pn-item__icon" style="--tone:${esc((lure && lure.color) || 'var(--c-skill)')}"></span>
          <span class="pn-item__main">
            <b>${esc(name)}</b>
            <span class="pn-sub">${lure ? esc(lure.notes || '') : ''}${wear > 0 ? ` · износ ${wear} %` : ''}</span>
          </span>
          <span class="pn-badge u-mono">×${rec.count}</span>
          <button class="btn btn--sm" type="button" data-act="equip-lure" data-id="${esc(id)}" data-uid="${esc(rec.uid || '')}">Поставить</button>
        </li>`;
    })
    .join('');
  return `<ul class="pn-list">${items}</ul>`;
}

function renderInventory(api) {
  const state = api.state;
  const catchData = catchRows(state);
  const fishArr = (state && state.inventory && state.inventory.fish) || [];
  const money = Number(state && state.player && state.player.money) || 0;

  api.sheet.setSub(`Садок: ${fishCountLabel(fishArr.length)} · ${fmtKg(catchData.totalKg)}`);
  api.sheet.setExtra(`<span class="pn-money">${rub(money)}</span>`);

  api.sheet.body.innerHTML = `
    <div class="pn-toolbar">
      <span class="pn-kv"><span>Улов</span><b class="u-mono">${fishCountLabel(fishArr.length)}</b></span>
      <span class="pn-kv"><span>Общий вес</span><b class="u-mono">${fmtKg(catchData.totalKg)}</b></span>
      <span class="pn-kv"><span>Стоимость</span><b class="u-mono u-gold">${rub(catchData.totalPrice)}</b></span>
      <span class="u-spacer"></span>
      <button class="btn btn--primary" type="button" data-act="sell-all" ${fishArr.length ? '' : 'disabled'}>
        Продать весь улов за ${rub(catchData.totalPrice)}
      </button>
    </div>
    <div class="pn-columns pn-columns--inv">
      <section class="pn-card">
        <h3 class="pn-card__title">Садок <span class="pn-badge">${fishArr.length}</span></h3>
        ${catchData.html}
      </section>
      <div class="pn-stack">
        <section class="pn-card">
          <h3 class="pn-card__title">Наживки</h3>
          ${baitsBlock(state)}
        </section>
        <section class="pn-card">
          <h3 class="pn-card__title">Приманки</h3>
          ${luresBlock(state)}
        </section>
      </div>
    </div>`;

  return bindDelegated(api.sheet.body, {
    sell(target) {
      clickSfx(api.bus);
      sellFish(api.actions, api.bus, target.dataset.uid);
    },
    'sell-all'() {
      clickSfx(api.bus);
      sellAllFish(api.actions, api.bus);
    },
    'use-bait'(target) {
      clickSfx(api.bus);
      equipBait(api.actions, api.bus, target.dataset.id);
    },
    'equip-lure'(target) {
      clickSfx(api.bus);
      equipLure(api.actions, api.bus, target.dataset.id, target.dataset.uid || undefined);
    },
  });
}

export function mount(root, ctx) {
  return mountPanel(root, ctx, {
    name: 'inventory',
    title: 'Инвентарь',
    subtitle: 'Садок и наживки',
    className: 'pn-sheet--inventory',
    events: ['state:changed', 'inventory:changed', 'money:changed'],
    render: renderInventory,
  });
}
