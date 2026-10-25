/**
 * Панель «Карта водоёмов»: четыре водоёма, их точки, блокировка по уровню.
 * Переход — actions.setWater + actions.setSpot.
 * Владелец: ui-programmer.
 */
import { mountPanel, bindDelegated, clickSfx } from './shell.js';
import { chip, emptyState, esc, rub, STRUCTURE_NAMES, TIME_NAMES, WATER_TYPE_NAMES } from './common.js';
import { fishOf, spotOf, waterOf, waters } from './data.js';

const TYPE_ICON = { river: '≋', lake: '◍', pond: '❧', sea: '≈' };

function currentWaterId(state) {
  return (state && state.world && state.world.waterId) || '';
}

function currentSpotId(state) {
  return (state && state.world && state.world.spotId) || '';
}

function levelOf(state) {
  return Number(state && state.player && state.player.level) || 1;
}

function waterCard(water, state, active) {
  const level = levelOf(state);
  const unlock = Number(water.unlockLevel) || 1;
  const locked = level < unlock;
  const cost = Number(water.travelCost) || 0;
  const spots = Array.isArray(water.spots) ? water.spots : [];
  return `
    <button class="pn-water${active ? ' pn-water--active' : ''}${locked ? ' pn-water--locked' : ''}"
      type="button" data-act="pick-water" data-id="${esc(water.id)}">
      <span class="pn-water__icon">${TYPE_ICON[water.type] || '◍'}</span>
      <span class="pn-water__main">
        <b>${esc(water.name)}</b>
        <span class="pn-sub">${esc(water.region || WATER_TYPE_NAMES[water.type] || '')}</span>
      </span>
      <span class="pn-water__meta">
        <span class="pn-badge">${spots.length} точ.</span>
        ${
          locked
            ? `<span class="pn-badge pn-badge--bad">ур. ${unlock}</span>`
            : `<span class="pn-badge pn-badge--good">открыт</span>`
        }
        ${cost > 0 ? `<span class="pn-sub u-mono">${rub(cost)}</span>` : ''}
      </span>
    </button>`;
}

function spotFishChips(spot) {
  const list = Array.isArray(spot.fish) ? spot.fish : [];
  if (list.length === 0) return '<span class="pn-sub">рыба не указана</span>';
  return list
    .map((id) => {
      const fish = fishOf(id);
      const rarity = Math.max(0, Math.min(5, Number(fish.rarity) || 0));
      return `<span class="pn-chip pn-chip--r${rarity}">${esc(fish.name)}</span>`;
    })
    .join('');
}

function spotRow(spot, water, state, activeSpot) {
  const level = levelOf(state);
  const unlock = Number(water.unlockLevel) || 1;
  const locked = level < unlock;
  const best = Array.isArray(spot.bestTime) ? spot.bestTime : [];
  const structure = STRUCTURE_NAMES[spot.structure] || spot.structure || '';
  return `
    <tr class="${activeSpot ? 'pn-row--active' : ''}${locked ? ' pn-row--locked' : ''}">
      <td class="pn-cell-main">
        <b>${esc(spot.name || spot.id)}</b>
        <span class="pn-sub">${esc(spot.notes || '')}</span>
      </td>
      <td>${chip(structure)}</td>
      <td class="u-mono">${Number(spot.depthM) || 0} м</td>
      <td class="u-mono">x ${Math.round(Number(spot.x) || 0)} · z ${Math.round(Number(spot.z) || 0)}</td>
      <td class="pn-cell-fish">${spotFishChips(spot)}</td>
      <td>${best.map((t) => chip(TIME_NAMES[t] || t)).join(' ') || '<span class="pn-sub">любое</span>'}</td>
      <td class="pn-cell-act">
        <button class="btn btn--sm ${activeSpot ? 'btn--ghost' : 'btn--primary'}" type="button"
          data-act="goto" data-water="${esc(water.id)}" data-spot="${esc(spot.id)}" ${locked || activeSpot ? 'disabled' : ''}>
          ${activeSpot ? 'Вы здесь' : locked ? `с ур. ${unlock}` : 'Перейти'}
        </button>
      </td>
    </tr>`;
}

function waterInfo(water) {
  const ambient = water.ambient || {};
  return `
    <section class="pn-card pn-waterinfo">
      <h3 class="pn-card__title">${esc(water.name)} ${chip(WATER_TYPE_NAMES[water.type] || water.type)}</h3>
      <p class="pn-text">${esc(water.desc || '')}</p>
      <div class="pn-good__meta">
        ${water.region ? chip(water.region) : ''}
        ${chip(`открыт с ур. ${Number(water.unlockLevel) || 1}`)}
        ${Number(water.travelCost) > 0 ? chip(`дорога ${rub(water.travelCost)}`) : chip('без доплат')}
        ${ambient.reeds ? chip('камыш') : ''}
        ${Number(ambient.boats) > 0 ? chip(`лодки: ${ambient.boats}`) : ''}
      </div>
    </section>`;
}

function spotsTable(water, state) {
  const spots = Array.isArray(water.spots) ? water.spots : [];
  if (spots.length === 0) return emptyState('У этого водоёма пока нет описанных точек.');
  const active = currentSpotId(state);
  const inWater = currentWaterId(state) === water.id;
  return `
    <div class="pn-tablewrap">
      <table class="pn-table pn-table--spots">
        <thead>
          <tr><th>Точка</th><th>Структура</th><th>Глубина</th><th>Координаты</th><th>Рыба</th><th>Клёв</th><th></th></tr>
        </thead>
        <tbody>${spots.map((spot) => spotRow(spot, water, state, inWater && active === spot.id)).join('')}</tbody>
      </table>
    </div>`;
}

function selectedWater(api) {
  const activeId = currentWaterId(api.state);
  const wanted = api.payload && api.payload.waterId ? api.payload.waterId : api.view.waterId || activeId;
  return waterOf(wanted) || waters[0] || null;
}

function activeLine(activeWater, activeSpot) {
  if (!activeWater) return '';
  const spotText = activeSpot ? `, точка «${esc(activeSpot.name || activeSpot.id)}»` : '';
  return `<p class="pn-hint">Сейчас вы на «${esc(activeWater.name)}»${spotText}.</p>`;
}

function mapBody(water, state, info) {
  const right = info.locked
    ? `<div class="pn-lock">Водоём откроется на ${Number(water.unlockLevel) || 1}-м уровне. Сейчас ваш уровень — ${info.level}.</div>`
    : spotsTable(water, state);
  return `
    <div class="pn-columns pn-columns--map">
      <aside class="pn-waterlist">
        ${waters.map((w) => waterCard(w, state, w.id === water.id)).join('')}
        ${activeLine(info.activeWater, info.activeSpot)}
      </aside>
      <div class="pn-stack pn-stack--map">
        ${waterInfo(water)}
        ${right}
      </div>
    </div>`;
}

function mapHandlers(api) {
  return bindDelegated(api.sheet.body, {
    'pick-water'(target) {
      const id = target.dataset.id;
      if (!id || id === api.view.waterId) return;
      clickSfx(api.bus);
      api.view.waterId = id;
      api.payload = null;
      api.render();
    },
    goto(target) {
      const waterId = target.dataset.water;
      const spotId = target.dataset.spot;
      const water = waterOf(waterId);
      if (!water || !spotOf(waterId, spotId)) return;
      if (levelOf(api.state) < (Number(water.unlockLevel) || 1)) {
        api.bus.emit('toast', { text: `«${water.name}» откроется на ${water.unlockLevel}-м уровне`, kind: 'bad' });
        return;
      }
      clickSfx(api.bus);
      if (api.actions && typeof api.actions.setWater === 'function') api.actions.setWater(waterId);
      if (api.actions && typeof api.actions.setSpot === 'function') api.actions.setSpot(spotId);
      api.close();
    },
  });
}

function renderMap(api) {
  const state = api.state;
  const level = levelOf(state);
  const water = selectedWater(api);
  const unlockedCount = waters.filter((w) => (Number(w.unlockLevel) || 1) <= level).length;
  const activeWater = waterOf(currentWaterId(state));
  const activeSpot = activeWater ? spotOf(activeWater.id, currentSpotId(state)) : null;

  api.sheet.setSub(`Открыто ${unlockedCount} из ${waters.length}`);
  api.sheet.setExtra(`<span class="pn-kv"><span>Уровень</span><b class="u-mono">${level}</b></span>`);

  if (!water) {
    api.sheet.body.innerHTML = emptyState('Список водоёмов пуст.');
    return null;
  }

  api.view.waterId = water.id;
  const locked = level < (Number(water.unlockLevel) || 1);
  api.sheet.body.innerHTML = mapBody(water, state, { locked, level, activeWater, activeSpot });
  return mapHandlers(api);
}

export function mount(root, ctx) {
  return mountPanel(root, ctx, {
    name: 'map',
    title: 'Карта водоёмов',
    subtitle: 'Куда поедем',
    className: 'pn-sheet--map',
    events: ['state:changed', 'level:up'],
    makeView: () => ({ waterId: null }),
    render: renderMap,
    onOpen(view) {
      /* новое открытие начинается с текущего водоёма */
      view.waterId = null;
    },
  });
}
