/**
 * Загрузка тестируемых модулей проекта с понятной причиной отказа.
 * Если файл ещё пишется другим агентом, тест должен получить «нет модуля», а не упасть.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './paths.mjs';

const moduleCache = new Map();

/**
 * Динамический импорт модуля проекта.
 * -> { mod } либо { error } с человекочитаемой причиной.
 */
export async function loadModule(relPath, requiredExports = []) {
  if (moduleCache.has(relPath)) return moduleCache.get(relPath);
  const abs = join(ROOT, relPath);
  let entry;
  if (!existsSync(abs)) {
    entry = { error: `нет модуля ${relPath} (файл не найден)` };
  } else {
    try {
      const mod = await import(pathToFileURL(abs).href);
      const missing = requiredExports.filter((name) => mod[name] === undefined);
      entry = missing.length > 0
        ? { error: `в ${relPath} нет экспорта: ${missing.join(', ')}` }
        : { mod };
    } catch (err) {
      entry = { error: `модуль ${relPath} не загрузился: ${(err && err.message) || err}` };
    }
  }
  moduleCache.set(relPath, entry);
  return entry;
}

/** То же, но бросает ошибку — для тестов, где модуль обязателен. */
export async function useModule(relPath, requiredExports = []) {
  const entry = await loadModule(relPath, requiredExports);
  if (entry.error) {
    const { fail } = await import('./harness.mjs');
    fail(entry.error);
  }
  return entry.mod;
}
