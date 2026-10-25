/**
 * Правила SPEC §5 / DoD §4, применимые к сдаваемым модулям: плейсхолдеры, внешние CDN,
 * аддоны three.js, console.log в продакшн-пути, размер файла.
 */
import { lineAt } from './imports.mjs';

const RULES = [
  {
    id: 'placeholder',
    re: /\b(TODO|FIXME)\b|\blorem\s+ipsum\b/gi,
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
    // В main.js отладочные логи допустимы при ?debug=1 — капитан владеет этим файлом.
    skip: (rel) => /^src\/main\.js$/.test(rel),
  },
];

const MAX_LINES = 400;

/**
 * Проверяет исходник на нарушения правил SPEC.
 * tools/ — служебные скрипты, а не продакшн-код: правила к ним не применяются,
 * иначе чекер ловит собственные описания правил.
 */
export function lintSource(source, rel) {
  const issues = [];
  if (rel.startsWith('tools/')) return issues;

  for (const rule of RULES) {
    if (rule.skip && rule.skip(rel)) continue;
    const matches = source.match(rule.re);
    if (!matches || matches.length === 0) continue;
    issues.push({
      status: rule.status,
      note: `${rule.text} — ${matches.length}× (первое вхождение: строка ${lineAt(source, source.search(rule.re))})`,
    });
  }

  const lineCount = source.split('\n').length;
  if (lineCount > MAX_LINES) {
    issues.push({ status: 'WARN', note: `файл ${lineCount} строк — SPEC §5 требует ≤ ${MAX_LINES}` });
  }
  return issues;
}
