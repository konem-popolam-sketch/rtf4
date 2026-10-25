/**
 * Панель «Задания»: список квестов, прогресс, награды, кнопка «Забрать».
 * Получение награды — actions.claimQuest.
 * Владелец: ui-programmer.
 */
import { mountPanel, bindDelegated, clickSfx, toast } from './shell.js';
import {
  bar,
  emptyState,
  esc,
  questAvailable,
  questGoalText,
  questProgress,
  questStatus,
  rub,
} from './common.js';
import { fmtInt } from '../../core/util.js';
import { fishName, quests } from './data.js';

const TABS = [
  { id: 'active', name: 'Активные' },
  { id: 'ready', name: 'Готовые' },
  { id: 'done', name: 'Выполненные' },
];

function fishLabelFor(quest) {
  const goal = (quest && quest.goal) || {};
  return goal.fishId ? fishName(goal.fishId) : '';
}

function rewardChips(quest) {
  const reward = quest.reward || {};
  const parts = [];
  if (Number(reward.money) > 0) parts.push(`<span class="pn-reward pn-reward--money">${rub(reward.money)}</span>`);
  if (Number(reward.xp) > 0) parts.push(`<span class="pn-reward pn-reward--xp">${fmtInt(reward.xp)} XP</span>`);
  if (Number(reward.level) > 0) parts.push(`<span class="pn-reward pn-reward--level">ур. ${reward.level}</span>`);
  if (Number(reward.bait) > 0) parts.push(`<span class="pn-reward">наживка ×${reward.bait}</span>`);
  return parts.join('') || '<span class="pn-sub">без награды</span>';
}

function progressLabel(quest, value) {
  const goal = quest.goal || {};
  const target = Math.max(1, Number(goal.target) || 1);
  if (goal.type === 'catchKg') return `${value.toFixed(1)} / ${target} кг`;
  if (goal.type === 'earnMoney') return `${rub(value)} / ${rub(target)}`;
  return `${fmtInt(value)} / ${fmtInt(target)}`;
}

function questCard(quest, state, expanded) {
  const value = questProgress(state, quest);
  const target = Math.max(1, Number(quest.goal && quest.goal.target) || 1);
  const status = questStatus(state, quest);
  const done = status === 'claimed';
  const ready = status === 'ready';
  const goalText = questGoalText(quest.goal, fishLabelFor(quest));
  return `
    <article class="pn-quest${ready ? ' pn-quest--ready' : ''}${done ? ' pn-quest--done' : ''}">
      <header class="pn-quest__head">
        <b class="pn-quest__title">${esc(quest.title || quest.id)}</b>
        ${quest.repeatable ? '<span class="pn-badge">повторяемое</span>' : ''}
        <span class="pn-badge ${done ? 'pn-badge--good' : ready ? 'pn-badge--gold' : ''}">
          ${done ? 'получено' : ready ? 'готово' : 'в работе'}
        </span>
      </header>
      ${expanded && quest.desc ? `<p class="pn-text">${esc(quest.desc)}</p>` : ''}
      <div class="pn-quest__goal">${esc(goalText)}</div>
      <div class="pn-quest__progress">
        ${bar(value, target, ready ? 'good' : 'accent')}
        <span class="u-mono">${esc(progressLabel(quest, value))}</span>
      </div>
      <footer class="pn-quest__foot">
        <span class="pn-rewards">${rewardChips(quest)}</span>
        <span class="u-spacer"></span>
        ${
          done
            ? '<span class="pn-sub">награда уже забрана</span>'
            : `<button class="btn btn--sm ${ready ? 'btn--primary' : ''}" type="button" data-act="claim" data-id="${esc(
                quest.id,
              )}" ${ready ? '' : 'disabled'}>Забрать награду</button>`
        }
      </footer>
    </article>`;
}

function grouped(state) {
  const buckets = { active: [], ready: [], done: [] };
  for (const quest of quests) {
    if (!questAvailable(state, quest)) continue;
    const status = questStatus(state, quest);
    if (status === 'claimed') buckets.done.push(quest);
    else if (status === 'ready') buckets.ready.push(quest);
    else buckets.active.push(quest);
  }
  return buckets;
}

function renderQuests(api) {
  const state = api.state;
  const view = api.view;
  const buckets = grouped(state);
  const readyCount = buckets.ready.length;
  const current = TABS.some((t) => t.id === view.tab) ? view.tab : readyCount > 0 ? 'ready' : 'active';
  view.tab = current;
  const list = buckets[current] || [];

  api.sheet.setSub(`В работе ${buckets.active.length} · готово ${readyCount}`);
  api.sheet.setExtra(
    readyCount > 0 ? `<span class="pn-badge pn-badge--gold">${readyCount} к получению</span>` : '<span class="pn-sub">нет наград к получению</span>',
  );

  api.sheet.body.innerHTML = `
    <div class="pn-tabs">
      ${TABS.map(
        (tab) =>
          `<button class="pn-tab${tab.id === current ? ' pn-tab--active' : ''}" type="button" data-act="tab" data-tab="${tab.id}">
            ${esc(tab.name)} <span class="pn-tab__count">${buckets[tab.id].length}</span>
          </button>`,
      ).join('')}
    </div>
    <div class="pn-tabbody pn-quests">
      ${
        list.length === 0
          ? emptyState(
              current === 'ready'
                ? 'Готовых заданий нет — ловите рыбу и выполняйте условия.'
                : current === 'done'
                ? 'Пока ни одно задание не закрыто.'
                : 'Активных заданий нет.',
            )
          : list.map((quest) => questCard(quest, state, view.expanded)).join('')
      }
    </div>`;

  return bindDelegated(api.sheet.body, {
    tab(target) {
      if (view.tab === target.dataset.tab) return;
      clickSfx(api.bus);
      view.tab = target.dataset.tab;
      api.render();
    },
    claim(target) {
      const id = target.dataset.id;
      if (!id) return;
      clickSfx(api.bus);
      if (api.actions && typeof api.actions.claimQuest === 'function') {
        const ok = api.actions.claimQuest(id);
        if (ok === false) toast(api.bus, 'Награда пока недоступна', 'bad');
      } else {
        toast(api.bus, 'Получение награды пока недоступно', 'bad');
      }
    },
  });
}

export function mount(root, ctx) {
  return mountPanel(root, ctx, {
    name: 'quests',
    title: 'Задания',
    subtitle: 'Работа и трофеи',
    className: 'pn-sheet--quests',
    events: ['state:changed', 'quest:progress', 'money:changed'],
    makeView: () => ({ tab: 'active', expanded: true }),
    render: renderQuests,
  });
}

