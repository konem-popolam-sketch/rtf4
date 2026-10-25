/**
 * Панель «Атлас рыб»: 30 видов, редкость, веса, цена, наживки и приманки,
 * «поймано N раз» из state.stats.caughtByFish.
 * Владелец: ui-programmer.
 */
import { mountPanel, bindDelegated, bindDelegatedInput } from './shell.js';
import {
  bar,
  emptyState,
  esc,
  fishCaughtMap,
  keepFocus,
  rarityBadge,
  TIME_NAMES,
  WATER_TYPE_NAMES,
} from './common.js';
import { fmtInt, fmtKg, plural } from '../../core/util.js';
import { baitName, fishes, lureName, waterOf } from './data.js';

const WATER_FILTERS = [
  { id: 'all', name: 'Все водоёмы' },
  { id: 'river', name: 'Река' },
  { id: 'lake', name: 'Озеро' },
  { id: 'pond', name: 'Пруд' },
  { id: 'sea', name: 'Море' },
];

const SORTS = [
  { id: 'rarity', name: 'По редкости' },
  { id: 'name', name: 'По названию' },
  { id: 'price', name: 'По цене' },
  { id: 'weight', name: 'По весу' },
];

function caughtLabel(rec) {
  if (!rec || !rec.count) return '<span class="pn-sub">ещё не поймана</span>';
  const n = rec.count;
  return `<b class="u-good">${fmtInt(n)}</b> <span class="pn-sub">${plural(n, 'раз', 'раза', 'раз')}</span>`;
}

function fishRow(fish, rec) {
  const caught = Boolean(rec && rec.count);
  const maxKg = Number(fish.maxKg) || 0;
  const record = Math.max(Number(fish.recordKg) || 0, (rec && Number(rec.maxKg)) || 0);
  const baits = (fish.bait || []).slice(0, 4).map((id) => `<span class="pn-chip">${esc(baitName(id))}</span>`).join('');
  const lures = (fish.lure || []).slice(0, 4).map((id) => `<span class="pn-chip">${esc(lureName(id))}</span>`).join('');
  const waters = (fish.water || [])
    .map((type) => `<span class="pn-chip pn-chip--water">${esc(WATER_TYPE_NAMES[type] || type)}</span>`)
    .join('');
  const times = Object.entries(fish.timeOfDay || {})
    .filter(([, v]) => Number(v) >= 0.8)
    .map(([k]) => TIME_NAMES[k] || k)
    .join(', ');
  return `
    <tr class="${caught ? 'pn-row--caught' : 'pn-row--unknown'}">
      <td class="pn-cell-main">
        <span class="pn-fishdot" style="--fish:${esc(fish.color || 'var(--c-accent)')}"></span>
        <b>${esc(fish.name)}</b>
        <span class="pn-sub">${esc(fish.latin || '')}${fish.family ? ` · ${esc(fish.family)}` : ''}</span>
      </td>
      <td>${rarityBadge(fish.rarity)}</td>
      <td class="u-mono">${fmtKg(fish.minKg || 0)} – ${fmtKg(maxKg)}</td>
      <td class="u-mono u-gold">${Math.round(Number(fish.pricePerKg) || 0)} ₽/кг</td>
      <td class="u-mono">${record > 0 ? fmtKg(record) : '—'}</td>
      <td>${caughtLabel(rec)}</td>
      <td class="pn-cell-fish">${waters}</td>
      <td class="pn-cell-fish">${baits || '<span class="pn-sub">—</span>'}${lures ? `<span class="pn-sep"></span>${lures}` : ''}</td>
      <td><span class="pn-sub">${esc(times || 'круглые сутки')}</span></td>
    </tr>`;
}

function fishCard(fish, rec) {
  const caught = Boolean(rec && rec.count);
  const depth = { bottom: 'со дна', mid: 'в полводы', surface: 'у поверхности' }[fish.depth] || 'в толще воды';
  const baits = (fish.bait || []).map((id) => esc(baitName(id))).join(', ');
  const lures = (fish.lure || []).map((id) => esc(lureName(id))).join(', ');
  return `
    <article class="pn-fishcard${caught ? ' pn-fishcard--caught' : ''}">
      <header class="pn-fishcard__head">
        <span class="pn-fishcard__silhouette" style="--fish:${esc(fish.color || 'var(--c-accent)')}">
          <span class="pn-fishcard__shape pn-fishcard__shape--${esc(fish.shape || 'torpedo')}"></span>
        </span>
        <div class="pn-fishcard__title">
          <b>${esc(fish.name)}</b>
          <span class="pn-sub">${esc(fish.latin || '')}</span>
          ${rarityBadge(fish.rarity)}
        </div>
      </header>
      <p class="pn-text">${esc(fish.desc || '')}</p>
      <div class="pn-good__meta">
        <span class="pn-chip">${esc(depth)}</span>
        <span class="pn-chip">${fmtKg(fish.minKg || 0)} – ${fmtKg(fish.maxKg || 0)}</span>
        <span class="pn-chip u-gold">${Math.round(Number(fish.pricePerKg) || 0)} ₽/кг</span>
        <span class="pn-chip">${Number(fish.xp) || 0} XP</span>
      </div>
      <div class="pn-fishcard__stats">
        <span>сила</span>${bar(fish.fightPower, 1, 'bad')}
        <span>выносливость</span>${bar(fish.stamina, 1, 'warn')}
        <span>хватка</span>${bar(fish.aggro, 1, 'accent')}
      </div>
      <dl class="pn-dl">
        <dt>Наживки</dt><dd>${esc(baits || 'не клюёт')}</dd>
        <dt>Приманки</dt><dd>${esc(lures || 'не берёт')}</dd>
        <dt>Поймано</dt><dd>${caughtLabel(rec)}${rec && rec.maxKg ? ` · лучший ${fmtKg(rec.maxKg)}` : ''}</dd>
      </dl>
    </article>`;
}

function filtered(api) {
  const state = api.state;
  const view = api.view;
  const query = String(view.query || '').trim().toLowerCase();
  const caught = fishCaughtMap(state);
  let list = fishes.filter((fish) => {
    if (view.water && view.water !== 'all' && !(fish.water || []).includes(view.water)) return false;
    if (view.onlyCaught && !(caught[fish.id] && caught[fish.id].count)) return false;
    if (!query) return true;
    const name = String(fish.name || '').toLowerCase();
    const latin = String(fish.latin || '').toLowerCase();
    return name.includes(query) || latin.includes(query);
  });
  const sort = view.sort || 'rarity';
  list = list.slice().sort((a, b) => {
    if (sort === 'name') return String(a.name).localeCompare(String(b.name), 'ru');
    if (sort === 'price') return (Number(b.pricePerKg) || 0) - (Number(a.pricePerKg) || 0);
    if (sort === 'weight') return (Number(b.maxKg) || 0) - (Number(a.maxKg) || 0);
    return (Number(b.rarity) || 0) - (Number(a.rarity) || 0) || String(a.name).localeCompare(String(b.name), 'ru');
  });
  return { list, caught };
}

function summaryLine(state, caught) {
  const total = fishes.length;
  const opened = fishes.filter((fish) => caught[fish.id] && caught[fish.id].count).length;
  const waterId = state && state.world && state.world.waterId;
  const water = waterId ? waterOf(waterId) : null;
  return {
    opened,
    total,
    html: `Открыто ${opened} из ${total}${water ? ` · водоём «${esc(water.name)}»` : ''}`,
  };
}

function atlasToolbar(view) {
  return `
    <div class="pn-toolbar pn-toolbar--wrap">
      <label class="pn-field pn-field--search">
        <span>Поиск</span>
        <input type="search" data-role="search" data-act="query" placeholder="Название или латынь"
          value="${esc(view.query || '')}" autocomplete="off" />
      </label>
      <label class="pn-field">
        <span>Водоём</span>
        <select data-act="water">
          ${WATER_FILTERS.map(
            (w) => `<option value="${w.id}"${view.water === w.id ? ' selected' : ''}>${esc(w.name)}</option>`,
          ).join('')}
        </select>
      </label>
      <label class="pn-field">
        <span>Сортировка</span>
        <select data-act="sort">
          ${SORTS.map((s) => `<option value="${s.id}"${view.sort === s.id ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}
        </select>
      </label>
      <label class="pn-check">
        <input type="checkbox" data-act="only-caught" ${view.onlyCaught ? 'checked' : ''} />
        <span>Только пойманные</span>
      </label>
      <span class="u-spacer"></span>
      <div class="pn-segmented">
        <button class="pn-seg${view.mode === 'table' ? ' pn-seg--active' : ''}" type="button" data-act="mode" data-mode="table">Таблица</button>
        <button class="pn-seg${view.mode === 'cards' ? ' pn-seg--active' : ''}" type="button" data-act="mode" data-mode="cards">Карточки</button>
      </div>
    </div>`;
}

function atlasList(view, list, caught) {
  if (list.length === 0) return emptyState('Ничего не найдено — измените фильтры.');
  if (view.mode === 'cards') {
    return `<div class="pn-grid pn-grid--fish">${list.map((fish) => fishCard(fish, caught[fish.id])).join('')}</div>`;
  }
  return `
    <div class="pn-tablewrap pn-tablewrap--tall">
      <table class="pn-table pn-table--atlas">
        <thead>
          <tr>
            <th>Рыба</th><th>Редкость</th><th>Вес</th><th>Цена</th><th>Рекорд</th>
            <th>Поймано</th><th>Водоёмы</th><th>На что</th><th>Клёв</th>
          </tr>
        </thead>
        <tbody>${list.map((fish) => fishRow(fish, caught[fish.id])).join('')}</tbody>
      </table>
    </div>`;
}

function atlasHandlers(api) {
  const offClick = bindDelegated(api.sheet.body, {
    mode(target) {
      api.view.mode = target.dataset.mode === 'cards' ? 'cards' : 'table';
      api.render();
    },
  });
  const offInput = bindDelegatedInput(api.sheet.body, (target) => {
    const act = target.dataset.act;
    const view = api.view;
    if (act === 'query') {
      view.query = target.value;
      api.render();
      keepFocus(api.sheet.body.querySelector('[data-role="search"]'), true);
      return;
    }
    if (act === 'water') view.water = target.value;
    else if (act === 'sort') view.sort = target.value;
    else if (act === 'only-caught') view.onlyCaught = target.checked;
    else return;
    api.render();
  });
  return () => {
    offClick();
    offInput();
  };
}

function renderAtlas(api) {
  const view = api.view;
  const { list, caught } = filtered(api);
  const summary = summaryLine(api.state, caught);
  const oldSearch = api.sheet.body.querySelector('[data-role="search"]');
  const focusSearch = oldSearch === document.activeElement;

  api.sheet.setSub(summary.html);
  api.sheet.setExtra(`<span class="pn-kv"><span>Записей</span><b class="u-mono">${summary.opened}/${summary.total}</b></span>`);
  api.sheet.body.innerHTML = `${atlasToolbar(view)}${atlasList(view, list, caught)}`;

  if (focusSearch) keepFocus(api.sheet.body.querySelector('[data-role="search"]'), true);
  return atlasHandlers(api);
}

export function mount(root, ctx) {
  return mountPanel(root, ctx, {
    name: 'atlas',
    title: 'Атлас рыб',
    subtitle: 'Дневник рыбака',
    className: 'pn-sheet--atlas',
    events: ['state:changed', 'inventory:changed'],
    makeView: () => ({ query: '', water: 'all', sort: 'rarity', onlyCaught: false, mode: 'table' }),
    render: renderAtlas,
  });
}

export const ATLAS_FISH_COUNT = fishes.length;
