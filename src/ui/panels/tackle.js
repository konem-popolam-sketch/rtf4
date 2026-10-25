/**
 * Панель «Экипировка»: удилище, катушка, леска, крючок, поплавок, грузило, кормушка,
 * выбор оснастки и наживки/приманки. Всё — через actions.setTackle.
 * Владелец: ui-programmer.
 */
import { mountPanel, bindDelegated, bindDelegatedInput, clickSfx, equipBait, equipLure, setGear, setRig } from './shell.js';
import { chip, emptyState, esc, RIG_NAMES } from './common.js';import {
  baitOf,
  baits,
  isRodFitsRig,
  lureOf,
  lures,
  ownedTackleIds,
  tackleByCategory,
  tackleOf,
  TACKLE_CATEGORIES,
} from './data.js';

const RIGS = ['float', 'spinning', 'feeder', 'bottom'];

const RIG_HINT = {
  float: 'Поплавочная снасть: наживка у дна или в полводы, хорошо для мирной рыбы.',
  spinning: 'Спиннинг: приманки и активная рыба, дальний заброс.',
  feeder: 'Фидер: кормушка с прикормкой, донная ловля на дальней дистанции.',
  bottom: 'Донка: грузило и наживка на дне, ждём крупную рыбу.',
};

function equipped(state) {
  return (state && state.tackle) || {};
}

function ownedList(state) {
  return new Set(ownedTackleIds(state));
}

function slotOptions(cat, state, currentId) {
  const owned = ownedList(state);
  const list = tackleByCategory(cat.id);
  if (list.length === 0) return `<span class="pn-sub">нет в каталоге</span>`;
  return `
    <select class="pn-select" data-act="gear" data-slot="${esc(cat.slot)}">
      ${list
        .map((item) => {
          const has = owned.has(item.id);
          const selected = item.id === currentId ? ' selected' : '';
          const label = `${has ? '' : '🔒 '}${item.name || item.id}`;
          return `<option value="${esc(item.id)}"${selected}${has ? '' : ' data-locked="1"'}>${esc(label)}</option>`;
        })
        .join('')}
    </select>`;
}

function gearRow(cat, state, rig) {
  const gear = equipped(state);
  const id = gear[cat.slot];
  const item = id ? tackleOf(id) : null;
  const optional = cat.id === 'float' || cat.id === 'sinker' || cat.id === 'feeder';
  const show = !(cat.id === 'float' && rig === 'spinning') && !(cat.id === 'feeder' && rig !== 'feeder');
  if (!show) return '';
  return `
    <tr class="${item ? '' : 'pn-row--empty'}">
      <th>${esc(cat.name)}${optional ? ' <span class="pn-sub">необяз.</span>' : ''}</th>
      <td class="pn-cell-main">
        <b>${esc(item ? item.name || item.id : '— не установлено —')}</b>
        <span class="pn-sub">${esc(item ? item.desc || '' : '')}</span>
      </td>
      <td class="pn-cell-act">${slotOptions(cat, state, id || '')}</td>
    </tr>`;
}

function specsOf(item) {
  if (!item) return [];
  const out = [];
  if (item.maxLoadKg != null) out.push(`нагрузка ${item.maxLoadKg} кг`);
  if (item.castRangeM != null) out.push(`бросок ${item.castRangeM} м`);
  if (item.power != null) out.push(`мощь ${Math.round(item.power * 100)}`);
  if (item.sensitivity != null) out.push(`чуйка ${Math.round(item.sensitivity * 100)}`);
  if (item.reelSpeed != null) out.push(`скорость ${Math.round(item.reelSpeed * 100)}`);
  if (item.maxDragKg != null) out.push(`фрикцион ${item.maxDragKg} кг`);
  if (item.lineTestKg != null) out.push(`тест ${item.lineTestKg} кг`);
  if (item.diameterMm != null) out.push(`Ø ${item.diameterMm} мм`);
  if (item.invisibility != null) out.push(`незаметность ${Math.round(item.invisibility * 100)}`);
  if (item.strength != null) out.push(`прочность ${Math.round(item.strength * 100)}`);
  if (item.buoyancy != null) out.push(`плавучесть ${Math.round(item.buoyancy * 100)}`);
  if (item.weightG != null) out.push(`${item.weightG} г`);
  if (item.hookSize) out.push(`крючок ${String(item.hookSize).toUpperCase()}`);
  return out;
}

function summary(api, rig) {
  const gear = equipped(api.state);
  const rod = tackleOf(gear.rodId);
  const reel = tackleOf(gear.reelId);
  const line = tackleOf(gear.lineId);
  const hook = tackleOf(gear.hookId);
  const rigLimit = line && line.lineTestKg ? `${line.lineTestKg} кг` : '—';
  const cast = rod && rod.castRangeM ? `${rod.castRangeM} м` : '—';
  const power = rod && rod.maxLoadKg ? `${rod.maxLoadKg} кг` : '—';
  const drag = reel && reel.maxDragKg ? `${reel.maxDragKg} кг` : '—';
  const hookSize = hook && hook.size ? String(hook.size).toUpperCase() : '—';
  const rating = Math.min(
    100,
    Math.round(
      (Number(rod && rod.power) || 0.3) * 40 +
        (Number(line && line.lineTestKg) || 2) * 6 +
        (Number(reel && reel.reelSpeed) || 0.3) * 20 +
        (Number(hook && hook.strength) || 0.3) * 20,
    ),
  );
  return `
    <section class="pn-card pn-specs">
      <h3 class="pn-card__title">Текущая снасть</h3>
      <div class="pn-kvgrid">
        <span class="pn-kv"><span>Оснастка</span><b>${esc(RIG_NAMES[rig] || rig)}</b></span>
        <span class="pn-kv"><span>Тест лески</span><b class="u-mono">${esc(rigLimit)}</b></span>
        <span class="pn-kv"><span>Бросок</span><b class="u-mono">${esc(cast)}</b></span>
        <span class="pn-kv"><span>Нагрузка</span><b class="u-mono">${esc(power)}</b></span>
        <span class="pn-kv"><span>Фрикцион</span><b class="u-mono">${esc(drag)}</b></span>
        <span class="pn-kv"><span>Крючок</span><b class="u-mono">${esc(hookSize)}</b></span>
      </div>
      <div class="pn-meter">
        <span>Баланс снасти</span>
        <span class="pn-bar pn-bar--accent"><span class="pn-bar__fill" style="width:${rating}%"></span></span>
        <b class="u-mono">${rating}</b>
      </div>
      <p class="pn-hint">${esc(RIG_HINT[rig] || '')}</p>
    </section>`;
}

function baitBlock(api, rig) {
  const state = api.state;
  const gear = equipped(state);
  const owned = (state && state.inventory && state.inventory.baits) || {};
  const entries = Object.entries(owned).filter(([, n]) => Number(n) > 0);
  const active = gear.baitId;
  const disabled = rig === 'spinning';
  if (entries.length === 0) return emptyState('Наживок нет — купите в магазине.');
  return `
    <div class="pn-picklist${disabled ? ' pn-picklist--disabled' : ''}">
      ${entries
        .map(([id, count]) => {
          const bait = baitOf(id);
          const specs = bait ? specsOf(bait).slice(0, 3).join(' · ') : '';
          return `
            <button class="pn-pick${id === active ? ' pn-pick--active' : ''}" type="button"
              data-act="bait" data-id="${esc(id)}" ${disabled ? 'disabled' : ''}>
              <span class="pn-item__icon" style="--tone:${esc((bait && bait.color) || 'var(--c-accent)')}"></span>
              <span class="pn-pick__main">
                <b>${esc(bait ? bait.name : id)}</b>
                <span class="pn-sub">${esc(specs)}</span>
              </span>
              <span class="pn-badge u-mono">×${count}</span>
            </button>`;
        })
        .join('')}
    </div>`;
}

function lureBlock(api) {
  const state = api.state;
  const gear = equipped(state);
  const list = (state && state.inventory && state.inventory.lures) || [];
  if (!Array.isArray(list) || list.length === 0) return emptyState('Приманок нет — купите в магазине.');
  const seen = new Map();
  for (const item of list) {
    const id = item && (item.lureId || item.id);
    if (!id) continue;
    const rec = seen.get(id) || { count: 0, wear: 0, uid: item.uid };
    rec.count += 1;
    rec.wear = Math.max(rec.wear, Number(item.wear) || 0);
    seen.set(id, rec);
  }
  return `
    <div class="pn-picklist">
      ${Array.from(seen.entries())
        .map(([id, rec]) => {
          const lure = lureOf(id);
          const specs = lure ? specsOf(lure).slice(0, 3).join(' · ') : '';
          const wear = Math.round(rec.wear * 100);
          return `
            <button class="pn-pick${id === gear.lureId ? ' pn-pick--active' : ''}" type="button"
              data-act="lure" data-id="${esc(id)}" data-uid="${esc(rec.uid || '')}">
              <span class="pn-item__icon" style="--tone:${esc((lure && lure.color) || 'var(--c-skill)')}"></span>
              <span class="pn-pick__main">
                <b>${esc(lure ? lure.name : id)}</b>
                <span class="pn-sub">${esc(specs)}${wear > 0 ? ` · износ ${wear} %` : ''}</span>
              </span>
              <span class="pn-badge u-mono">×${rec.count}</span>
            </button>`;
        })
        .join('')}
    </div>`;
}

function rigSwitch(rig) {
  return `<div class="pn-segmented pn-segmented--wide">
    ${RIGS.map(
      (id) =>
        `<button class="pn-seg${id === rig ? ' pn-seg--active' : ''}" type="button" data-act="rig" data-rig="${id}">${
          RIG_NAMES[id] || id
        }</button>`,
    ).join('')}
  </div>`;
}

function tackleMarkup(api, gear, rig) {
  const state = api.state;
  const baitTab = rig !== 'spinning';
  const rows = TACKLE_CATEGORIES.map((cat) => gearRow(cat, state, rig)).join('');
  return `
    <div class="pn-columns pn-columns--tackle">
      <div class="pn-stack">
        <section class="pn-card">
          <h3 class="pn-card__title">Оснастка</h3>
          ${rigSwitch(rig)}
          <div class="pn-tablewrap">
            <table class="pn-table pn-table--gear"><tbody>${rows}</tbody></table>
          </div>
        </section>
        ${summary(api, rig)}
      </div>
      <div class="pn-stack">
        <section class="pn-card ${baitTab ? '' : 'pn-card--muted'}">
          <h3 class="pn-card__title">Наживка <span class="pn-sub">${baitTab ? 'для поплавочной и донной' : 'недоступно на спиннинге'}</span></h3>
          ${baitBlock(api, rig)}
        </section>
        <section class="pn-card ${baitTab ? 'pn-card--muted' : ''}">
          <h3 class="pn-card__title">Приманка <span class="pn-sub">${baitTab ? 'только спиннинг' : 'на спиннинге'}</span></h3>
          ${lureBlock(api)}
        </section>
        <p class="pn-hint">Удилище не подходит под оснастку — выберите подходящее в списке. Расход наживки и износ приманки идут на рыбалке.</p>
      </div>
    </div>`;
}

function gearChanged(api, target) {
  const slot = target.dataset.slot;
  const id = target.value;
  if (!slot || !id) return;
  clickSfx(api.bus);
  if (slot === 'rodId') {
    const rod = tackleOf(id);
    const currentRig = equipped(api.state).rig || 'float';
    if (rod && !isRodFitsRig(rod, currentRig)) {
      api.bus.emit('toast', { text: `«${rod.name}» не подходит под оснастку «${RIG_NAMES[currentRig]}»`, kind: 'bad' });
    }
  }
  setGear(api.actions, api.bus, { [slot]: id });
}

function tackleHandlers(api) {
  const offClick = bindDelegated(api.sheet.body, {
    rig(target) {
      const next = target.dataset.rig;
      if (!next || next === (equipped(api.state).rig || 'float')) return;
      clickSfx(api.bus);
      setRig(api.actions, api.bus, next);
      requestAnimationFrame(() => api.render());
    },
    bait(target) {
      clickSfx(api.bus);
      equipBait(api.actions, api.bus, target.dataset.id);
    },
    lure(target) {
      clickSfx(api.bus);
      equipLure(api.actions, api.bus, target.dataset.id, target.dataset.uid || undefined);
    },
  });
  const offInput = bindDelegatedInput(api.sheet.body, (target) => {
    if (target.dataset.act === 'gear') gearChanged(api, target);
  });
  return () => {
    offClick();
    offInput();
  };
}

function renderTackle(api) {
  const state = api.state;
  const gear = equipped(state);
  const rig = gear.rig || 'float';
  const baitTab = rig !== 'spinning';

  api.sheet.setSub(`${RIG_NAMES[rig] || rig} · наживка: ${esc(baitOrLureName(gear, baitTab))}`);
  api.sheet.setExtra(
    `<span class="pn-kv"><span>Уровень</span><b class="u-mono">${Number(state.player && state.player.level) || 1}</b></span>`,
  );
  api.sheet.body.innerHTML = tackleMarkup(api, gear, rig);
  return tackleHandlers(api);
}

function baitOrLureName(gear, baitTab) {
  if (baitTab) {
    const bait = gear.baitId ? baitOf(gear.baitId) : null;
    return bait ? bait.name : 'не выбрана';
  }
  const lure = gear.lureId ? lureOf(gear.lureId) : null;
  return lure ? lure.name : 'не выбрана';
}

export function mount(root, ctx) {
  return mountPanel(root, ctx, {
    name: 'tackle',
    title: 'Экипировка',
    subtitle: 'Снасть и наживка',
    className: 'pn-sheet--tackle',
    events: ['state:changed', 'inventory:changed', 'money:changed'],
    render: renderTackle,
  });
}

export const TACKLE_BAIT_COUNT = baits.length + lures.length;
