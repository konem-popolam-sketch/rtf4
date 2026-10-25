/**
 * Разбор импортов, карта import map и классификация спецификаторов.
 * Работает на уровне текста: AST не нужен, а зависимости нулевые.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { JS_EXT, ROOT, relOf, walk } from './paths.mjs';

/**
 * Убирает комментарии, сохраняя номера строк, чтобы не ловить импорты из примеров в доке.
 * Учитывает строки, шаблонные литералы и регулярные выражения: внутри `/['"]/g` кавычка
 * не открывает строку, иначе сканер разъезжается и «находит» импорты в комментариях.
 */
export function stripComments(source) {
  let out = '';
  let i = 0;
  let inLine = false;
  let inBlock = false;
  let quote = '';
  // Последний значимый символ — по нему решаем, начинается ли регулярка или это деление.
  let prevSignificant = '';
  const regexAllowedAfter = /[([{,;:=!&|?+\-*%^~<>]$/;

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

    // Регулярное выражение: `/…/flags`. Внутри — свои экранирования и классы `[…]`.
    const regexStart = ch === '/' && next !== '/' && next !== '*' && /[([{,;:=!&|?+\-*%^~<>]$|^$/.test(prevSignificant);
    if (regexStart) {
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < source.length) {
        const cj = source[j];
        if (cj === '\n') break; // незакрытая регулярка — не наш случай
        if (cj === '\\') {
          j += 2;
          continue;
        }
        if (cj === '[') inClass = true;
        else if (cj === ']') inClass = false;
        else if (cj === '/' && !inClass) {
          closed = true;
          j += 1;
          break;
        }
        j += 1;
      }
      if (closed) {
        while (j < source.length && /[a-z]/i.test(source[j])) j += 1; // флаги
        out += ' '.repeat(j - i);
        i = j;
        prevSignificant = '/';
        continue;
      }
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
    if (!/\s/.test(ch)) prevSignificant = ch;
    out += ch;
    i += 1;
  }
  return out;
}

export function lineAt(source, index) {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i += 1) if (source[i] === '\n') line += 1;
  return line;
}

/** Мягкий импорт — тот, чья ошибка перехвачена: .catch(…) или обёртка вида optional('…'). */
const SOFT_CALLER = /\b(optional|maybe|tryLoad|softLoad|lazyLoad|lazy|ensure)$/i;

/**
 * Находит все импорты файла: статические, динамические и пути в вызовах-загрузчиках.
 * soft=true означает, что ошибка загрузки перехвачена и модуль может появиться позже.
 */
export function findImports(source) {
  const code = stripComments(source);
  const found = [];
  const push = (spec, index, soft = false) => {
    if (!spec) return;
    const line = lineAt(code, index);
    const existing = found.find((item) => item.spec === spec && item.line === line);
    if (existing) {
      existing.soft = existing.soft || soft;
      return;
    }
    found.push({ spec, line, soft });
  };
  const isGuarded = (index) => /^\s*(?:\)\s*)?\.catch\s*\(/.test(code.slice(index, index + 24));

  let m;
  const dynamicRe = /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g;
  while ((m = dynamicRe.exec(code)) !== null) push(m[2], m.index, isGuarded(dynamicRe.lastIndex));

  const fromRe = /\bfrom\s*(['"])([^'"]+)\1/g;
  while ((m = fromRe.exec(code)) !== null) push(m[2], m.index, false);

  const bareRe = /(?:^|[\n;{}])\s*import\s*(['"])([^'"]+)\1/g;
  while ((m = bareRe.exec(code)) !== null) push(m[2], m.index, false);

  // Путь модуля строковым литералом в вызове загрузчика: optional('./ui/hud.js') в main.js.
  // Именно вызов функции, а не любая строка, — иначе ловятся значения вида './vendor/three.module.js'.
  const pathRe = /\b([\w$]+)\s*\(\s*(['"])(\.{1,2}\/[^'"\n]+\.m?js)\2\s*\)/g;
  while ((m = pathRe.exec(code)) !== null) {
    if (m[1] === 'import') continue; // уже учтено выше
    push(m[3], m.index, SOFT_CALLER.test(m[1]));
  }
  return found;
}

/** Все .js-файлы src с их базовыми именами — чтобы подсказать правильный путь при опечатке. */
export function makeBasenameIndex() {
  const index = new Map();
  for (const abs of walk(join(ROOT, 'src'))) {
    if (!JS_EXT.has(extname(abs).toLowerCase())) continue;
    const base = abs.split(/[\\/]/).pop();
    if (!index.has(base)) index.set(base, []);
    index.get(base).push(relOf(abs));
  }
  return index;
}

/** Карта import map из index.html плюс локальный three.js как запасной вариант. */
export function readImportMap() {
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

/** Встроенные модули Node — их не надо искать в дереве проекта и в import map. */
const NODE_BUILTINS = new Set([
  'assert', 'buffer', 'child_process', 'cluster', 'console', 'constants', 'crypto', 'dgram', 'dns',
  'events', 'fs', 'http', 'http2', 'https', 'inspector', 'module', 'net', 'os', 'path', 'perf_hooks',
  'process', 'punycode', 'querystring', 'readline', 'repl', 'stream', 'string_decoder', 'timers',
  'tls', 'trace_events', 'tty', 'url', 'util', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib',
  'test', 'assert/strict', 'fs/promises', 'dns/promises', 'stream/promises', 'timers/promises',
  'util/types', 'readline/promises', 'path/posix', 'path/win32',
]);

/** node:fs, fs/promises и прочие встроенные модули не являются файлами проекта. */
export function isNodeBuiltin(spec) {
  if (spec.startsWith('node:')) return true;
  return NODE_BUILTINS.has(spec);
}

/**
 * Проверяет спецификатор импорта: запрещённые схемы, встроенные модули Node,
 * относительные пути и «голые» имена из import map.
 * -> { ok, abs?, note?, message? }
 */
export function resolveSpecifier(file, spec, importMap, basenames) {
  for (const banned of BANNED_SPECIFIERS) {
    if (banned.re.test(spec)) return { ok: false, message: `«${spec}»: ${banned.text}` };
  }
  if (isNodeBuiltin(spec)) return { ok: true, abs: null, builtin: true };
  if (spec.startsWith('.') || spec.startsWith('/')) {
    const abs = spec.startsWith('/') ? join(ROOT, spec) : resolve(dirname(file), spec);
    if (existsSync(abs) && statSync(abs).isFile()) return { ok: true, abs };
    if (!extname(abs) && existsSync(`${abs}.js`)) {
      return { ok: true, abs: `${abs}.js`, note: 'импорт без расширения .js' };
    }
    // Подсказка: такой файл существует, но путь указан неверно (частая ошибка — ../ vs ../../).
    const base = spec.split('/').pop();
    const candidates = (basenames && basenames.get(base)) || [];
    const hint = candidates.length > 0 ? ` (возможно, имелся в виду ${candidates.join(' или ')})` : '';
    return { ok: false, message: `файл не найден: ${relOf(abs)}${hint}` };
  }
  const mapped = importMap[spec];
  if (!mapped) return { ok: false, message: `«${spec}» не объявлен в import map (index.html)` };
  const abs = resolve(ROOT, mapped);
  if (!existsSync(abs)) return { ok: false, message: `import map: отсутствует ${mapped}` };
  return { ok: true, abs };
}
