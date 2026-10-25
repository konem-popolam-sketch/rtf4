#!/usr/bin/env node
/**
 * studio-sync.mjs — связать живую команду этого проекта с доской студии.
 *
 * Зачем: доска (`claude god/docs/studio-board`) и плашка «Агенты» читают живые
 * команды только из `<студия>/.agent-teams`. Наша команда живёт в
 * `rtf4/.agent-teams`, поэтому доска показывала выдуманные лизинги из state.json
 * (12 «работают», 0 «ждут») и не видела ни одного настоящего агента.
 *
 * Что делает:
 *  1. алиасы: имена агентов в командах — русские (Горо, Ичиго, …), а доска ищет
 *     латинские id. Генерируем алиасы из roster.json (все стили), только для имён,
 *     которые однозначно указывают на один слот;
 *  2. мост: junction `<студия>/.agent-teams/rtf4-build` -> `rtf4/.agent-teams/rtf4-build`,
 *     чтобы доска и плашка видели живую команду, не копируя файлы;
 *  3. пересборка доски официальным CLI (`build_studio_board.py --set-all resting --html-only`):
 *     выдуманные лизинги снимаются, живые агенты получают working/waiting, все
 *     остальные — resting.
 *
 * Запуск: node tools/studio-sync.mjs [--dry-run]
 * Требует записи вне рабочей папки (доска студии лежит на OneDrive).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, lstatSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const DRY = process.argv.includes('--dry-run');

const STUDIO = 'C:\\Users\\Igor\\OneDrive\\Desktop\\claude god';
const BOARD = join(STUDIO, 'docs', 'studio-board');
const ROSTER = join(BOARD, 'roster.json');
const ALIASES = join(BOARD, 'aliases.json');
const TEAMS = join(STUDIO, '.agent-teams');
const BRIDGE = join(TEAMS, 'rtf4-build');
const LIVE = 'C:\\Users\\Igor\\Downloads\\rtf4\\.agent-teams\\rtf4-build';
const BUILDER = join(STUDIO, 'tools', 'studio-board', 'build_studio_board.py');

const log = (...a) => console.log(...a);

/** Настоящая папка, а не junction/симлинк: у ссылки lstat показывает ссылку. */
function isRealDir(p) {
  try {
    const st = lstatSync(p);
    return st.isDirectory() && !st.isSymbolicLink();
  } catch {
    return false;
  }
}

/* --------------------------------- 1. алиасы -------------------------------- */

const roster = JSON.parse(readFileSync(ROSTER, 'utf8').replace(/^\uFEFF/, ''));

// Доска живёт в одном стиле: у него имена героев свои (аниме: Ичиго, Кэндзи…;
// какамора: Рэн, Рику…). Одно и то же русское имя в двух стилях принадлежит
// РАЗНЫМ слотам (Ичиго = gameplay-programmer И godot-gdscript-specialist),
// поэтому алиасы строим по текущему стилю доски, а из остальных стилей берём
// только имена, которые ни с чем не конфликтуют.
const boardStyle = (() => {
  try {
    const st = JSON.parse(readFileSync(join(BOARD, 'state.json'), 'utf8').replace(/^\uFEFF/, ''));
    return st._style || roster.defaultStyle || 'anime';
  } catch {
    return roster.defaultStyle || 'anime';
  }
})();

const byName = new Map(); // lower(name) -> Set(slot)
const addName = (name, slot) => {
  const key = String(name ?? '').trim().toLowerCase();
  if (!key) return;
  if (!byName.has(key)) byName.set(key, new Set());
  byName.get(key).add(slot);
};
for (const [slot, rec] of Object.entries(roster.agents ?? {})) {
  addName(rec?.faces?.[boardStyle]?.name, slot);
}
for (const [slot, rec] of Object.entries(roster.agents ?? {})) {
  for (const [style, face] of Object.entries(rec?.faces ?? {})) {
    if (style === boardStyle) continue;
    const key = String(face?.name ?? '').trim().toLowerCase();
    if (key && !byName.has(key)) byName.set(key, new Set([slot]));
  }
}

const current = JSON.parse(readFileSync(ALIASES, 'utf8').replace(/^\uFEFF/, ''));
const merged = { ...(current.aliases ?? {}) };
let added = 0;
for (const [name, slots] of byName) {
  // неоднозначное имя (одно имя на два разных слота) алиасом не делаем:
  // иначе доска начнёт путать людей.
  if (slots.size !== 1) continue;
  const slot = [...slots][0];
  if (merged[name] === slot) continue;
  if (merged[name] && merged[name] !== slot) continue;
  merged[name] = slot;
  added += 1;
}

const outAliases = { ...current, aliases: merged };
if (DRY) {
  log(`[dry] алиасов стало бы ${Object.keys(merged).length} (+${added})`);
} else {
  writeFileSync(ALIASES, `${JSON.stringify(outAliases, null, 2)}\n`, 'utf8');
  log(`алиасы: ${Object.keys(merged).length} (+${added}) -> ${ALIASES}`);
}

/* --------------------------------- 2. мост --------------------------------- */

/**
 * Мост — обычная папка с копией team.json, а не junction.
 *
 * Причина: плагин плашки и доска перебирают `.agent-teams` через readdir с
 * `withFileTypes` и проверяют `isDirectory()`, а у junction это false — команда
 * молча пропускалась, и доска показывала нули. Настоящая папка читается всеми
 * одинаково; копию обновляет этот же скрипт при каждом запуске.
 */
if (!existsSync(LIVE) || !existsSync(join(LIVE, 'team.json'))) {
  log(`! нет живой команды в ${LIVE} — мост ставить не на что`);
} else if (DRY) {
  log(`[dry] ${BRIDGE}\\team.json <- ${LIVE}\\team.json`);
} else {
  // junction от прошлых запусков снимаем: rmdir удаляет ссылку, не трогая цель.
  if (existsSync(BRIDGE) && !isRealDir(BRIDGE)) {
    spawnSync('cmd', ['/c', 'rmdir', BRIDGE], { stdio: 'inherit' });
  }
  mkdirSync(BRIDGE, { recursive: true });
  copyFileSync(join(LIVE, 'team.json'), join(BRIDGE, 'team.json'));
  log(`мост: ${join(BRIDGE, 'team.json')}`);
}

/* ------------------------------ 3. пересборка ------------------------------ */

if (DRY) {
  log('[dry] python build_studio_board.py --set-all resting --html-only');
} else {
  const res = spawnSync('python', [BUILDER, '--set-all', 'resting', '--html-only'], {
    cwd: STUDIO,
    // stdio: inherit — в песочнице нельзя забирать вывод дочернего процесса в pipe
    stdio: 'inherit',
  });
  log(`пересборка: exit ${res.status ?? 'error'}`);
}

/* ------------------------------- 4. проверка ------------------------------- */

const state = JSON.parse(readFileSync(join(BOARD, 'state.json'), 'utf8').replace(/^\uFEFF/, ''));
const counts = { working: 0, waiting: 0, resting: 0 };
for (const entry of Object.values(state.agents ?? {})) {
  const st = entry?.state ?? 'resting';
  counts[st] = (counts[st] ?? 0) + 1;
}
const live = Object.entries(state.agents ?? {})
  .filter(([, v]) => v?.team)
  .map(([k, v]) => `${k}:${v.state}`);
log(`доска: работают ${counts.working}, ждут ${counts.waiting}, отдыхают ${counts.resting}`);
log(`живые: ${live.join(', ') || '—'}`);
