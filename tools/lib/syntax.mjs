/**
 * Проверка синтаксиса JS и структуры CSS без сборки.
 *
 * Песочница запрещает spawn сторонних процессов с пайпами (EPERM), поэтому вывод
 * `node --check` пишется в файл через fd, а не в pipe. Если спавн недоступен вовсе,
 * работает встроенный разбор через `new Function` по телу модуля без ESM-обвязки.
 */
import { spawnSync } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tempDir = null;

function getTempDir() {
  if (!tempDir) tempDir = mkdtempSync(join(tmpdir(), 'rtf4-check-'));
  return tempDir;
}

/** Удаляет временный каталог с логами stderr. Вызывать в finally. */
export function cleanupSyntaxTemp() {
  if (!tempDir) return;
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {
    /* каталог уже удалён */
  }
  tempDir = null;
}

/** Из вывода node --check достаём «строка N: SyntaxError: …». */
export function tidyNodeError(raw, res) {
  if (res.signal) return `проверка прервана сигналом ${res.signal}`;
  if (res.status === null) return 'процесс проверки не завершился (таймаут)';
  const lines = String(raw || '').replace(/\r/g, '').split('\n');
  const errIdx = lines.findIndex((line) => /^[A-Za-z]*Error\b/.test(line.trim()));
  const loc = /:(\d+)\s*$/.exec((lines[0] || '').trim());
  const text = errIdx >= 0 ? lines[errIdx].trim() : 'синтаксическая ошибка';
  return loc ? `строка ${loc[1]}: ${text}` : text;
}

/**
 * `node --check` дочерним процессом. Возвращает null, если спавн недоступен —
 * тогда вызывающий код использует встроенный разбор.
 * Переменная окружения RTF4_NO_SPAWN=1 принудительно включает резервный путь.
 */
export function checkViaNode(file) {
  if (process.env.RTF4_NO_SPAWN) return null;
  const errFile = join(getTempDir(), 'stderr.txt');
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

/**
 * Снимает ESM-обвязку, чтобы проверить тело скрипта через new Function (резервный путь).
 * Поддерживает многострочные `export { … }` / `import { … } from`, `export default`, `export *`.
 */
export function stripModuleSyntax(source) {
  let code = source;
  // import … from '…';  |  import '…';  — вместе с многострочными списками имён.
  code = code.replace(/\bimport\s+(?:[\s\S]*?\s+from\s+)?(['"])[^'"]+\1\s*;?/g, (match) =>
    match.includes('import(') ? match : '',
  );
  // export … from '…';  и  export * from '…';
  code = code.replace(/\bexport\s+(?:\*(?:\s+as\s+[\w$]+)?|\{[\s\S]*?\})\s*from\s*(['"])[^'"]+\1\s*;?/g, '');
  // export { a, b as c };
  code = code.replace(/\bexport\s*\{[\s\S]*?\}\s*;?/g, '');
  // export default <expr> / export default function() {}
  code = code.replace(/\bexport\s+default\s+/g, 'const __default__ = ');
  // export const/let/var/function/class/async function
  code = code.replace(/\bexport\s+(?=(?:async\s+)?(?:function|class|const|let|var)\b)/g, '');
  return code;
}

function checkInProcess(source) {
  const stripped = stripModuleSyntax(source);
  try {
    // eslint-disable-next-line no-new-func
    new Function(stripped);
  } catch (err) {
    return { ok: false, message: `встроенный разбор: ${err.message}` };
  }
  // `import.meta` живёт только в модулях: после снятия обвязки он невалиден в теле Function.
  const metaFree = stripped.replace(/\bimport\s*\.\s*meta\b/g, '({})');
  if (metaFree !== stripped) {
    try {
      // eslint-disable-next-line no-new-func
      new Function(metaFree);
    } catch (err) {
      return { ok: false, message: `встроенный разбор: ${err.message}` };
    }
  }
  return { ok: true, message: '' };
}

/** Проверка одного JS-модуля: сначала node --check, при недоступности спавна — встроенный разбор. */
export function checkJsSyntax(file, source) {
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

/** Баланс фигурных скобок, комментариев и кавычек в CSS. */
export function checkCssStructure(source) {
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
