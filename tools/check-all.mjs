#!/usr/bin/env node
/**
 * tools/check-all.mjs — проверка всех модулей проекта без сборки.
 *
 * Что делает:
 *  1. синтаксис каждого .js/.mjs из src/ — `node --check`; вывод ошибки пишется в файл,
 *     потому что пайпы в песочнице запрещены (EPERM), а stdio:'inherit' не даёт текста.
 *     Если спавн недоступен совсем — встроенный разбор через new Function.
 *  2. структура CSS из styles/ — баланс скобок и комментариев (node --check CSS не понимает).
 *  3. связность модулей: каждый относительный импорт существует, каждый «голый» спецификатор
 *     объявлен в import map из index.html; недостижимые из src/main.js файлы — WARN.
 *     Импорты с перехваченной ошибкой (.catch / optional()) — WARN, а не FAIL.
 *  4. правила SPEC §5 / DoD §4: плейсхолдеры, внешние CDN, аддоны three.js,
 *     console.log в продакшн-пути, файлы длиннее 400 строк.
 *
 * Запуск: node tools/check-all.mjs [--all] [--warn-as-error] [--quiet]
 *   --all           дополнительно проверять tools/*.js|*.mjs
 *   --warn-as-error любое предупреждение считается ошибкой (для CI)
 *   --quiet         печатать только FAIL/WARN-строки
 * Код выхода: 0 — всё чисто, 1 — есть хотя бы один FAIL (или WARN при --warn-as-error).
 */
import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { JS_EXT, ROOT, relOf, walk } from './lib/paths.mjs';
import { checkCssStructure, checkJsSyntax, cleanupSyntaxTemp } from './lib/syntax.mjs';
import { findImports, makeBasenameIndex, readImportMap, resolveSpecifier } from './lib/imports.mjs';
import { lintSource } from './lib/rules.mjs';

const ARGS = new Set(process.argv.slice(2));
const SCAN_DIRS = ARGS.has('--all') ? ['src', 'styles', 'tools'] : ['src', 'styles'];
const WARN_AS_ERROR = ARGS.has('--warn-as-error');
const QUIET = ARGS.has('--quiet');
const ENTRY = 'src/main.js';

/** Строки отчёта: { status: 'OK'|'FAIL'|'WARN', file, check, note }. */
const rows = [];

function addRow(status, file, check, note = '') {
  rows.push({ status, file, check, note });
}

function printSection(title, sectionRows) {
  const visible = QUIET ? sectionRows.filter((row) => row.status !== 'OK') : sectionRows;
  if (visible.length === 0) return;
  console.log(`\n${title}`);
  const fileWidth = Math.min(52, Math.max(0, ...visible.map((row) => row.file.length)));
  for (const row of visible) {
    const mark = row.status === 'OK' ? 'OK  ' : row.status === 'FAIL' ? 'FAIL' : 'WARN';
    console.log(`  ${mark} ${row.file.padEnd(fileWidth)}  ${row.check.padEnd(16)}  ${row.note}`.trimEnd());
  }
}

/** Читает файл и складывает исходники в Map; ошибку чтения помещает в отчёт. */
function readSources(files, sources) {
  for (const file of files) {
    const rel = relOf(file);
    try {
      sources.set(rel, readFileSync(file, 'utf8'));
    } catch (err) {
      addRow('FAIL', rel, 'чтение', err.message);
    }
  }
}

/* ───────────────────── 1. Синтаксис JS и структура CSS ───────────────────── */

function checkSyntax(jsFiles, cssFiles, sources) {
  readSources(jsFiles, sources);
  for (const [rel, source] of sources) {
    const result = checkJsSyntax(join(ROOT, rel), source);
    addRow(result.status, rel, result.check, result.note);
  }
  for (const file of cssFiles) {
    const rel = relOf(file);
    let source = '';
    try {
      source = readFileSync(file, 'utf8');
    } catch (err) {
      addRow('FAIL', rel, 'чтение', err.message);
      continue;
    }
    const issues = checkCssStructure(source);
    if (issues.length === 0) addRow('OK', rel, 'структура CSS', `${source.split('\n').length} строк`);
    else for (const issue of issues) addRow('FAIL', rel, 'структура CSS', issue);
  }
}

/* ───────────────────────── 2. Связность модулей ───────────────────────── */

function checkGraph(sources, importMap, hasIndexHtml) {
  const issues = [];
  const edges = new Map();
  const basenames = makeBasenameIndex();

  for (const [rel, source] of sources) {
    const file = join(ROOT, rel);
    const imports = findImports(source);
    const resolved = [];
    const seenNote = new Set();

    for (const item of imports) {
      const target = resolveSpecifier(file, item.spec, importMap, basenames);
      if (target.ok) {
        // Встроенные модули Node (node:fs) — не файлы проекта, в граф не входят.
        if (target.abs) resolved.push(relOf(target.abs));
        if (target.note && !seenNote.has(target.note)) {
          seenNote.add(target.note);
          issues.push({
            status: 'WARN',
            file: rel,
            check: 'импорт',
            note: `${target.note} (строка ${item.line}: «${item.spec}»)`,
          });
        }
        continue;
      }
      // Мягкий импорт (ошибка перехвачена) — не FAIL: модуль может появиться позже.
      issues.push({
        status: item.soft ? 'WARN' : 'FAIL',
        file: rel,
        check: 'импорт',
        note: `строка ${item.line}: ${target.message}${item.soft ? ' [мягкий импорт: ошибка перехвачена]' : ''}`,
      });
    }
    edges.set(rel, resolved);
    if (!QUIET) issues.push({ status: 'OK', file: rel, check: 'импорты', note: `${imports.length} шт.` });
  }

  if (!hasIndexHtml) {
    issues.push({ status: 'FAIL', file: 'index.html', check: 'import map', note: 'файл не найден в корне проекта' });
  }

  // Достижимость от точки входа: подсвечиваем мёртвые модули.
  // tools/ — самостоятельные CLI-скрипты, подключать их к src/main.js не нужно.
  if (edges.has(ENTRY)) {
    const reachable = new Set();
    const queue = [ENTRY];
    while (queue.length > 0) {
      const current = queue.shift();
      if (reachable.has(current)) continue;
      reachable.add(current);
      for (const target of edges.get(current) || []) {
        if (edges.has(target) && !reachable.has(target)) queue.push(target);
      }
    }
    for (const rel of edges.keys()) {
      if (rel.startsWith('tools/') || reachable.has(rel)) continue;
      issues.push({ status: 'WARN', file: rel, check: 'граф', note: `не подключён из ${ENTRY} (нет пути по import)` });
    }
  } else {
    issues.push({ status: 'WARN', file: ENTRY, check: 'граф', note: 'точка входа не найдена — достижимость не проверена' });
  }
  return issues;
}

/* ─────────────────────────────── 3. main ─────────────────────────────── */

function main() {
  const startedAt = Date.now();
  const allFiles = SCAN_DIRS.flatMap((dir) => walk(join(ROOT, dir)));
  const jsFiles = allFiles.filter((file) => JS_EXT.has(extname(file).toLowerCase())).sort();
  const cssFiles = allFiles.filter((file) => extname(file).toLowerCase() === '.css').sort();
  const { map: importMap, hasIndexHtml } = readImportMap();

  console.log('=== check-all: проверка модулей rtf4 ===');
  console.log(`корень: ${ROOT}`);
  console.log(`каталоги: ${SCAN_DIRS.join(', ')} · JS: ${jsFiles.length} · CSS: ${cssFiles.length}`);

  const sources = new Map();
  checkSyntax(jsFiles, cssFiles, sources);
  printSection('— синтаксис и структура —', rows.slice());

  const graphIssues = checkGraph(sources, importMap, hasIndexHtml);
  printSection('— связность модулей —', graphIssues);

  const ruleIssues = [];
  for (const [rel, source] of sources) {
    for (const issue of lintSource(source, rel)) {
      ruleIssues.push({ status: issue.status, file: rel, check: 'правила', note: issue.note });
    }
  }
  printSection('— правила SPEC —', ruleIssues);

  const allRows = [...rows, ...graphIssues, ...ruleIssues];
  const fails = allRows.filter((row) => row.status === 'FAIL');
  const warns = allRows.filter((row) => row.status === 'WARN');
  const oks = allRows.filter((row) => row.status === 'OK');
  const secs = ((Date.now() - startedAt) / 1000).toFixed(1);

  console.log('\n=== Итог ===');
  console.log(`проверок: ${allRows.length} · OK: ${oks.length} · FAIL: ${fails.length} · WARN: ${warns.length} · ${secs} c`);

  if (fails.length > 0) {
    console.log('ПРОВЕРКА НЕ ПРОЙДЕНА. Ошибки:');
    for (const row of fails) console.log(`  FAIL ${row.file} — ${row.note}`);
    return 1;
  }
  if (warns.length > 0 && WARN_AS_ERROR) {
    console.log('ПРОВЕРКА НЕ ПРОЙДЕНА: есть предупреждения, а задан --warn-as-error.');
    for (const row of warns) console.log(`  WARN ${row.file} — ${row.note}`);
    return 1;
  }
  console.log('Все проверки пройдены.');
  return 0;
}

let code = 1;
try {
  code = main();
} catch (err) {
  console.error('check-all упал:', err && err.stack ? err.stack : err);
  code = 1;
} finally {
  cleanupSyntaxTemp();
}
process.exitCode = code;
