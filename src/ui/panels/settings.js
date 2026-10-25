/**
 * Панель «Настройки»: громкость, скорость времени, сброс сейва.
 * Все изменения — через actions.setVolume / actions.setTimeScale / actions.resetSave.
 * Панель не перерисовывается на state:changed, чтобы не рвать перетаскивание ползунков.
 * Владелец: ui-programmer.
 */
import { mountPanel, bindDelegated, bindDelegatedInput, clickSfx } from './shell.js';
import { esc } from './common.js';
import { fmtClock, fmtInt } from '../../core/util.js';

const VOLUME_ROWS = [
  { key: 'master', name: 'Общая громкость', hint: 'влияет на весь звук игры' },
  { key: 'sfx', name: 'Эффекты', hint: 'всплески, катушка, поклёвка' },
  { key: 'ambient', name: 'Окружение', hint: 'ветер, вода, птицы' },
];

const TIME_PRESETS = [1, 2, 4, 8];

function settingsOf(state) {
  const settings = (state && state.settings) || {};
  const volume = settings.volume || {};
  return {
    volume: {
      master: Number.isFinite(Number(volume.master)) ? Number(volume.master) : 0.8,
      sfx: Number.isFinite(Number(volume.sfx)) ? Number(volume.sfx) : 0.9,
      ambient: Number.isFinite(Number(volume.ambient)) ? Number(volume.ambient) : 0.6,
    },
    timeScale: Number(settings.timeScale) || 1,
  };
}

function volumeRow(key, name, hint, value) {
  const percent = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return `
    <div class="pn-slider" data-row="${key}">
      <div class="pn-slider__head">
        <span>${esc(name)}</span>
        <b class="u-mono" data-label="${key}">${percent} %</b>
      </div>
      <input type="range" min="0" max="100" step="1" value="${percent}"
        data-act="volume" data-key="${key}" aria-label="${esc(name)}" />
      <span class="pn-sub">${esc(hint)}</span>
    </div>`;
}

function timeRow(timeScale) {
  const scale = Math.max(1, Math.min(8, Number(timeScale) || 1));
  return `
    <div class="pn-slider">
      <div class="pn-slider__head">
        <span>Скорость времени</span>
        <b class="u-mono" data-label="time">×${scale}</b>
      </div>
      <input type="range" min="1" max="8" step="1" value="${scale}" data-act="time" aria-label="Скорость времени" />
      <div class="pn-segmented pn-segmented--wide">
        ${TIME_PRESETS.map(
          (x) =>
            `<button class="pn-seg${x === scale ? ' pn-seg--active' : ''}" type="button" data-act="time-preset" data-scale="${x}">×${x}</button>`,
        ).join('')}
      </div>
      <span class="pn-sub">1 игровая минута за секунду при ×1; быстрее — только для ожидания клёва.</span>
    </div>`;
}

function saveInfo(state) {
  const stats = (state && state.stats) || {};
  const world = (state && state.world) || {};
  const player = (state && state.player) || {};
  const minutes = stats.playMinutes != null ? Math.round(Number(stats.playMinutes) || 0) : 0;
  return `
    <div class="pn-kvgrid">
      <span class="pn-kv"><span>Рыбак</span><b>${esc(player.name || 'Игрок')}</b></span>
      <span class="pn-kv"><span>Уровень</span><b class="u-mono">${Number(player.level) || 1}</b></span>
      <span class="pn-kv"><span>День</span><b class="u-mono">${Number(world.day) || 1} · ${fmtClock(Number(world.minutes) || 0)}</b></span>
      <span class="pn-kv"><span>В игре</span><b class="u-mono">${fmtInt(minutes)} мин</b></span>
      <span class="pn-kv"><span>Поймано</span><b class="u-mono">${fmtInt(Number(stats.catches) || 0)}</b></span>
      <span class="pn-kv"><span>Забросов</span><b class="u-mono">${fmtInt(Number(stats.casts) || 0)}</b></span>
    </div>`;
}

function resetBlock(confirming) {
  if (!confirming) {
    return `
      <div class="pn-danger">
        <div>
          <b>Сброс сейва</b>
          <p class="pn-sub">Удаляет прогресс, деньги, снасти и записи атласа. Отменить нельзя.</p>
        </div>
        <button class="btn btn--danger" type="button" data-act="reset-ask">Сбросить сейв</button>
      </div>`;
  }
  return `
    <div class="pn-danger pn-danger--confirm">
      <div>
        <b>Точно сбросить?</b>
        <p class="pn-sub">Страница перезагрузится с новым профилем.</p>
      </div>
      <div class="u-row">
        <button class="btn btn--ghost" type="button" data-act="reset-cancel">Отмена</button>
        <button class="btn btn--danger" type="button" data-act="reset-confirm">Да, начать заново</button>
      </div>
    </div>`;
}

function hotkeysBlock() {
  const rows = [
    ['ЛКМ', 'Заброс / подсечка при поклёвке / подмотка при вываживании'],
    ['ПКМ', 'Подсечка'],
    ['ESC', 'Закрыть панель'],
    ['I', 'Инвентарь'],
    ['M', 'Карта водоёмов'],
    ['B', 'Магазин'],
  ];
  return `<div class="pn-keys">${rows
    .map(([key, text]) => `<span class="pn-key">${esc(key)}</span><span>${esc(text)}</span>`)
    .join('')}</div>`;
}

function settingsMarkup(state, view) {
  const { volume, timeScale } = settingsOf(state);
  return `
    <div class="pn-columns pn-columns--settings">
      <section class="pn-card">
        <h3 class="pn-card__title">Звук</h3>
        ${VOLUME_ROWS.map((row) => volumeRow(row.key, row.name, row.hint, volume[row.key])).join('')}
      </section>
      <div class="pn-stack">
        <section class="pn-card">
          <h3 class="pn-card__title">Время</h3>
          ${timeRow(timeScale)}
        </section>
        <section class="pn-card">
          <h3 class="pn-card__title">Ваш профиль</h3>
          ${saveInfo(state)}
        </section>
        <section class="pn-card">
          <h3 class="pn-card__title">Управление</h3>
          ${hotkeysBlock()}
        </section>
        <section class="pn-card">
          <h3 class="pn-card__title">Профиль и сейв</h3>
          ${resetBlock(view.confirmReset)}
        </section>
      </div>
    </div>`;
}

function requestedReset(api) {
  const view = api.view;
  view.confirmReset = false;
  if (api.actions && typeof api.actions.resetSave === 'function') {
    api.bus.emit('toast', { text: 'Сейв сброшен, перезагрузка…', kind: 'info' });
    api.actions.resetSave();
  } else {
    api.bus.emit('toast', { text: 'Сброс сейва пока недоступен', kind: 'bad' });
  }
}

function settingsHandlers(api) {
  const view = api.view;
  const offClick = bindDelegated(api.sheet.body, {
    'time-preset'(target) {
      clickSfx(api.bus);
      applyTimeScale(api, Number(target.dataset.scale) || 1);
    },
    'reset-ask'() {
      clickSfx(api.bus);
      view.confirmReset = true;
      api.render();
    },
    'reset-cancel'() {
      clickSfx(api.bus);
      view.confirmReset = false;
      api.render();
    },
    'reset-confirm'() {
      clickSfx(api.bus);
      requestedReset(api);
    },
  });

  const offInput = bindDelegatedInput(api.sheet.body, (target) => {
    const act = target.dataset.act;
    if (act === 'volume') {
      const key = target.dataset.key;
      const value = Math.max(0, Math.min(1, Number(target.value) / 100));
      const label = api.sheet.body.querySelector(`[data-label="${key}"]`);
      if (label) label.textContent = `${Math.round(value * 100)} %`;
      applyVolume(api, { [key]: value });
      return;
    }
    if (act === 'time') {
      applyTimeScale(api, Math.max(1, Math.min(8, Math.round(Number(target.value) || 1))));
    }
  });

  return () => {
    offClick();
    offInput();
  };
}

function renderSettings(api) {
  api.sheet.setSub('Звук, время и профиль');
  api.sheet.setExtra('<span class="pn-sub">изменения сохраняются сразу</span>');
  api.sheet.body.innerHTML = settingsMarkup(api.state, api.view);
  return settingsHandlers(api);
}

function applyVolume(api, patch) {
  if (api.actions && typeof api.actions.setVolume === 'function') {
    api.actions.setVolume(patch);
  } else {
    api.bus.emit('toast', { text: 'Громкость пока недоступна', kind: 'bad' });
  }
}

function applyTimeScale(api, scale) {
  if (api.actions && typeof api.actions.setTimeScale === 'function') {
    api.actions.setTimeScale(scale);
  } else {
    api.bus.emit('toast', { text: 'Скорость времени пока недоступна', kind: 'bad' });
  }
  const label = api.sheet.body.querySelector('[data-label="time"]');
  if (label) label.textContent = `×${scale}`;
  const slider = api.sheet.body.querySelector('[data-act="time"]');
  if (slider) slider.value = String(scale);
  api.sheet.body.querySelectorAll('[data-act="time-preset"]').forEach((btn) => {
    btn.classList.toggle('pn-seg--active', Number(btn.dataset.scale) === scale);
  });
}

export function mount(root, ctx) {
  return mountPanel(root, ctx, {
    name: 'settings',
    title: 'Настройки',
    subtitle: 'Звук, время и профиль',
    className: 'pn-sheet--settings',
    events: [],
    makeView: () => ({ confirmReset: false }),
    render: renderSettings,
    onOpen(view) {
      view.confirmReset = false;
    },
  });
}
