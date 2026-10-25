#!/usr/bin/env node
/**
 * tools/check-all.mjs — проверка всех модулей проекта без сборки.
 *
 * Что делает:
 *  1. синтаксис каждого .js/.mjs из src/ (и styles/ при наличии) — `node --check`;
 *     stderr дочернего процесса пишется в файл, потому что пайпы в песочнице запрещены (EPERM),
 *     а stdio:'inherit' не даёт текста ошибки. Если спавн запрещён совсем — встроенный разбор.
 *  2. структура CSS из styles/ — баланс скобок и комментариев (node --check CSS не понимает).
 *  3. связность модулей: каждый относительный импорт существует, каждый «голый» спецификатор
 *     объявлен в import map из index.html; файлы, до которых не дотягивается src/main.js, — WARN.
 *  4. правила SPEC §5 / DoD §4: плейсхолдеры (TODO/lorem), внешние CDN, аддоны three.js,
 *     console.log в продакшн-пути, файлы длиннее 400 строк.
 *
 * Запуск: node tools/check-all.mjs [--all] [--warn-as-error] [--quiet]
 *   --all           дополнительно проверять tools/*.js|*.mjs
 *   --warn-as-error любое предупреждение считается ошибкой (для CI)
 *   --quiet         печатать только FAIL/WARN-строки
 * Код выхода: 0 — всё чисто, 1 — есть хотя бы один FAIL (или WARN при --warn-as-error).
 */
import { spawnSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ARGS = new Set(process.argv.slice(2));
const JS_EXT = new Set(['.js', '.mjs']);
const SCAN_DIRS = ARGS.has('--all') ? ['src', 'styles', 'tools'] : ['src', 'styles'];
const WARN_AS_ERROR = ARGS.has('--warn-as-error');
const QUIET = ARGS.has('--quiet');

/** Строки проблем: { status: 'OK'|'FAIL'|'WARN', file, check, note }. */
const rows = [];

let tempDir = null;
function getTempDir() {
  if (!tempDir) tempDir = mkdtempSync(join(tmpdir(), 'rtf4-check-'));
  return tempDir;
}

function posix(p) {
  return p.split(sep).join('/');
}

function relOf(abs) {
  return posix(relative(ROOT, abs));
}

/** Рекурсивный обход каталога; скрытые каталоги и node_modules пропускаются. */
function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, out);
    else if (entry.isFile()) out.push(abs);
  }
  return out;
}

/* ─────────────────────────── 1. Синтаксис JS ─────────────────────────── */

/** Из вывода node --check достаём «строка N: SyntaxError: …». */
function tidyNodeError(raw, res) {
  if (res.signal) return `проверка прервана сигналом ${res.signal}`;
  if (res.status === null) return 'процесс проверки не завершился (таймаут)';
  const lines = String(raw || '').replace(/\r/g, '').split('\n');
  const errIdx = lines.findIndex((line) => /^[A-Za-z]*Error\b/.test(line.trim()));
  const loc = /:(\d+)\s*$/.exec((lines[0] || '').trim());
  const text = errIdx >= 0 ? lines[errIdx].trim() : 'синтаксическая ошибка';
  return loc ? `строка ${loc[1]}: ${text}` : text;
}

/**
 * `node --check` дочерним процессом. Пайпы в песочнице дают EPERM,
 * поэтому stderr направляем в файл (fd), а не в pipe.
 * Возвращает null, если спавн недоступен — тогда работает встроенный разбор.
 */
function checkViaNode(file) {
  let errFile;
  try {
    errFile = join(getTempDir(), 'stderr.txt');
  } catch {
    return null;
  }
  let fd;
  try {
    fd = openSync(errFile, 'w');
  } catch {
    return null;
  }
  let res = null;
  try {
    res = spawnSync(process.execPath, ['--check', file], {
      stdio: ['ignore', 'ignore', fd],
      timeout: 30000,
      windowsHide: true,
    });
  } catch {
    res = null;
  } finally {
    try {
      closeSync(fd);
    } catch {
      /* уже закрыт */
    }
  }
  if (!res || res.error) return null;
  let raw = '';
  try {
    raw = readFileSync(errFile, 'utf8');
  } catch {
    /* пустой stderr */
  }
  return { status: res.status, message: res.status === 0 ? '' : tidyNodeError(raw, res) };
}

/** Снимает ESM-обвязку, чтобы проверить тело скрипта через new Function (резервный путь). */
function stripModuleSyntax(source) {
  return source
    .split('\n')
    .map((line) => {
      const t = line.trim();
      if (/^import\s/.test(t) || /^import\s*\(/.test(t)) return '';
      if (/^export\s*\{/.test(t) || /^export\s*\*/.test(t)) return '';
      return line
        .replace(/^(\s*)export\s+default\s+/, '$1')
        .replace(/^(\s*)export\s+(?=(?:async\s+)?(?:function|class|const|let|var)\b)/, '$1');
    })
    .join('\n');
}

function checkInProcess(source) {
  try {
    // eslint-disable-next-line no-new-func
    new Function(stripModuleSyntax(source));
    return { ok: true, message: '' };
  } catch (err) {
    return { ok: false, message: `встроенный разбор: ${err.message}` };
  }
}

function checkJsSyntax(file, source) {
  const viaNode = checkViaNode(file);
  if (viaNode) {
    return {
      status: viaNode.status === 0 ? 'OK' : 'FAIL',
      check: 'node --check',
      note: viaNode.message,
    };
  }
  const fallback = checkInProcess(source);
  return {
    status: fallback.ok ? 'OK' : 'FAIL',
    check: 'встроенный разбор',
    note: fallback.ok ? 'spawn недоступен — проверено встроенным разбором' : fallback.message,
  };
}

/* ─────────────────────────── 2. Структура CSS ─────────────────────────── */

function checkCssStructure(source) {
  const issues = [];
  let depth = 0;
  let line = 1;
  let inBlockComment = false;
  let quote = '';
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === '\n') line += 1;
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth < 0) {
        issues.push(`строка ${line}: лишняя «}»`);
        depth = 0;
      }
    }
  }
  if (inBlockComment) issues.push('незакрытый комментарий /* … */');
  if (quote) issues.push('незакрытая кавычка в строке');
  if (depth > 0) issues.push(`не закрыто фигурных скобок: ${depth}`);
  return issues;
}

/* ─────────────────────── 3. Связность модулей (импорты) ─────────────────────── */

/** Убирает комментарии, сохраняя номера строк, чтобы не ловить импорты из примеров в доке. */
function stripComments(source) {
  let out = '';
  let i = 0;
  let inLine = false;
  let inBlock = false;
  let quote = '';
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (inLine) {
      if (ch === '\n') {
        inLine = false;
        out += ch;
      } else out += ' ';
      i += 1;
      continue;
    }
    if (inBlock) {
      if (ch === '*' && next === '/') {
        inBlock = false;
        out += '  ';
        i += 2;
        continue;
      }
      out += ch === '\n' ? '\n' : ' ';
      i += 1;
      continue;
    }
    if (quote) {
      if (ch === '\\') {
        out += '  ';
        i += 2;
        continue;
      }
      if (ch === quote) quote = '';
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '/') {
      inLine = true;
      out += '  ';
      i += 2;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlock = true;
      out += '  ';
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    out += ch;
    i += 1;
  }
  return out;
}

function lineAt(source, index) {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i += 1) if (source[i] === '\n') line += 1;
  return line;
}

function findImports(source) {
  const code = stripComments(source);
  const found = [];
  const push = (spec, index) => {
    if (!spec) return;
    const line = lineAt(code, index);
    if (found.some((item) => item.spec === spec && item.line === line)) return;
    found.push({ spec, line });
  };
  const patterns = [
    /\bfrom\s*(['"])([^'"]+)\1/g, // import … from '…'  |  export … from '…'
    /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g, // динамический import('…')
    /(?:^|[\n;{}])\s*import\s*(['"])([^'"]+)\1/g, // import '…'
    // Путь модуля строковым литералом: загрузчики вида optional('./ui/hud.js') в main.js.
    /(['"])(\.{1,2}\/[^'"\n]+\.m?js)\1/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(code)) !== null) push(m[2], m.index);
  }
  return found;
}

function readImportMap() {
  const map = {};
  const indexPath = join(ROOT, 'index.html');
  if (existsSync(indexPath)) {
    const html = readFileSync(indexPath, 'utf8');
    const block = /<script[^>]*type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/i.exec(html);
    if (block) {
      try {
        const parsed = JSON.parse(block[1]);
        Object.assign(map, parsed.imports || {});
      } catch {
        /* import map нечитаем — сообщим отдельно ниже */
      }
    }
  }
  if (!map.three && existsSync(join(ROOT, 'vendor', 'three.module.js'))) {
    map.three = './vendor/three.module.js';
  }
  return { map, hasIndexHtml: existsSync(indexPath) };
}

const BANNED_SPECIFIERS = [
  { re: /^https?:\/\//, text: 'внешний URL вместо локального модуля (CDN запрещён)' },
  { re: /^\/\//, text: 'протокол-относительный URL (CDN запрещён)' },
  { re: /(?:^|\/)examples\/jsm(?:\/|$)/, text: 'аддоны three.js отсутствуют локально' },
  { re: /^three\/(?:addons|examples)/, text: 'аддоны three.js отсутствуют локально' },
  { re: /(?:unpkg|jsdelivr|cdnjs|esm\.sh)/, text: 'внешний CDN запрещён (SPEC §0)' },
];

function resolveSpecifier(file, spec, importMap) {
  for (const banned of BANNED_SPECIFIERS) {
    if (banned.re.test(spec)) return { ok: false, message: `«${spec}»: ${banned.text}` };
  }
  if (spec.startsWith('.') || spec.startsWith('/')) {
    const abs = spec.startsWith('/') ? join(ROOT, spec) : resolve(dirname(file), spec);
    if (existsSync(abs) && statSync(abs).isFile()) return { ok: true, abs };
    if (!extname(abs) && existsSync(`${abs}.js`)) {
      return { ok: true, abs: `${abs}.js`, note: 'импорт без расширения .js' };
    }
    return { ok: false, message: `файл не найден: ${relOf(abs)}` };
  }
  const mapped = importMap[spec];
  if (!mapped) return { ok: false, message: `«${spec}» не объявлен в import map (index.html)` };
  const abs = resolve(ROOT, mapped);
  if (!existsSync(abs)) return { ok: false, message: `import map: отсутствует ${mapped}` };
  return { ok: true, abs };
}

/* ─────────────────────────── 4. Правила SPEC ─────────────────────────── */

const RULES = [
  {
    id: 'placeholder',
    re: /\b(TODO|FIXME|lorem ipsum)\b/gi,
    status: 'FAIL',
    text: 'плейсхолдер в сдаваемом коде (SPEC DoD §4.6)',
  },
  {
    id: 'cdn',
    re: /https?:\/\/(?:unpkg|cdnjs|jsdelivr|esm\.sh)/gi,
    status: 'FAIL',
    text: 'внешний CDN (SPEC §0: никаких сетевых зависимостей)',
  },
  {
    id: 'addons',
    re: /three\/(?:addons|examples)/g,
    status: 'FAIL',
    text: 'аддоны three.js недоступны локально (SPEC §0)',
  },
  {
    id: 'console',
    re: /\bconsole\.(?:log|debug|info)\s*\(/g,
    status: 'WARN',
    text: 'console.log в продакшн-пути (SPEC §5)',
    skip: (rel) => /^src\/main\.js$/.test(rel),
  },
];

function lintSource(source, rel) {
  const issues = [];
  for (const rule of RULES) {
    if (rule.skip && rule.skip(rel)) continue;
    const matches = source.match(rule.re);
    if (!matches || matches.length === 0) continue;
    const firstIndex = source.search(rule.re);
    issues.push({
      status: rule.status,
      note: `${rule.text} — ${matches.length}× (первое вхождение: строка ${lineAt(source, firstIndex)})`,
    });
  }
  const lineCount = source.split('\n').length;
  if (lineCount > 400) {
    issues.push({ status: 'WARN', note: `файл ${lineCount} строк — SPEC §5 требует ≤ 400` });
  }
  return issues;
}

/* ─────────────────────────── 5. Отчёт ─────────────────────────── */

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
    const file = row.file.padEnd(fileWidth);
    const check = row.check.padEnd(16);
    console.log(`  ${mark} ${file}  ${check}  ${row.note}`.trimEnd());
  }
}

function main() {
  const startedAt = Date.now();
  const allFiles = SCAN_DIRS.flatMap((dir) => walk(join(ROOT, dir)));
  const jsFiles = allFiles.filter((file) => JS_EXT.has(extname(file).toLowerCase())).sort();
  const cssFiles = allFiles.filter((file) => extname(file).toLowerCase() === '.css').sort();
  const { map: importMap, hasIndexHtml } = readImportMap();

  console.log('=== check-all: проверка модулей rtf4 ===');
  console.log(`корень: ${ROOT}`);
  console.log(`каталоги: ${SCAN_DIRS.join(', ')} · JS: ${jsFiles.length} · CSS: ${cssFiles.length}`);

  // 1. Синтаксис
  const sources = new Map();
  for (const file of jsFiles) {
    const rel = relOf(file);
    let source = '';
    try {
      source = readFileSync(file, 'utf8');
    } catch (err) {
      addRow('FAIL', rel, 'чтение', err.message);
      continue;
    }
    sources.set(rel, source);
    const result = checkJsSyntax(file, source);
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
  const syntaxRows = rows.slice();
  printSection('— синтаксис и структура —', syntaxRows);

  // 2. Связность модулей
  const graphIssues = [];
  const edges = new Map();
  for (const [rel, source] of sources) {
    const file = join(ROOT, rel);
    const imports = findImports(source);
    const resolved = [];
    for (const item of imports) {
      const target = resolveSpecifier(file, item.spec, importMap);
      if (target.ok) {
        resolved.push(relative(ROOT, target.abs));
        if (target.note) {
          graphIssues.push({ status: 'WARN', file: rel, check: 'импорт', note: `${target.note} (строка ${item.line}: «${item.spec}»)` });
        }
      } else {
        graphIssues.push({ status: 'FAIL', file: rel, check: 'импорт', note: `строка ${item.line}: ${target.message}` });
      }
    }
    edges.set(rel, resolved);
    if (!QUIET) graphIssues.push({ status: 'OK', file: rel, check: 'импорты', note: `${imports.length} шт.` });
  }
  if (!hasIndexHtml) {
    graphIssues.push({ status: 'FAIL', file: 'index.html', check: 'import map', note: 'файл не найден в корне проекта' });
  }
  // Достижимость от src/main.js
  const entry = 'src/main.js';
  const reachable = new Set();
  if (edges.has(entry)) {
    const queue = [entry];
    while (queue.length > 0) {
      const current = queue.shift();
      if (reachable.has(current)) continue;
      reachable.add(current);
      for (const target of edges.get(current) || []) {
        const targetRel = posix(target);
        if (edges.has(targetRel) && !reachable.has(targetRel)) queue.push(targetRel);
      }
    }
    for (const rel of edges.keys()) {
      if (!reachable.has(rel)) {
        graphIssues.push({ status: 'WARN', file: rel, check: 'граф', note: `не подключён из ${entry} (нет пути по import)` });
      }
    }
  } else {
    graphIssues.push({ status: 'WARN', file: entry, check: 'граф', note: 'точка входа не найдена — достижимость не проверена' });
  }
  printSection('— связность модулей —', graphIssues);

  // 3. Правила SPEC
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
    console.log('ПРОВЕРКА НЕ ПРОЙДЕНА: предупреждения при --warn-as-error.');
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
  if (tempDir) {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* временный каталог уже удалён */
    }
  }
}
process.exitCode = code;
