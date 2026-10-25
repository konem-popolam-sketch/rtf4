/**
 * Общие пути и обход дерева проекта для скриптов tools/.
 * Без зависимостей: только node:*.
 */
import { readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Корень проекта (tools/lib/*.mjs → ../..). */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const JS_EXT = new Set(['.js', '.mjs']);

/** Windows-путь → POSIX-вид: отчёты должны быть одинаковыми на любой ОС. */
export function posix(p) {
  return p.split(sep).join('/');
}

export function relOf(abs) {
  return posix(relative(ROOT, abs));
}

/** Рекурсивный обход каталога; скрытые каталоги и node_modules пропускаются. */
export function walk(dir, out = []) {
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
