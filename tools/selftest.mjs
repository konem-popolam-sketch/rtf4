#!/usr/bin/env node
/**
 * tools/selftest.mjs — unit-тесты чистой логики проекта (Node, без DOM и зависимостей).
 *
 * Проверяются модули: src/core/rng.js, src/core/util.js, src/sim/fight.js,
 * src/sim/bite.js, src/sim/climate.js. Тесты лежат в tools/tests/*.test.mjs.
 * Модули подключаются динамически: если файла ещё нет (пишется параллельно другим агентом),
 * тест падает с понятным сообщением «нет модуля …», а не роняет весь прогон.
 *
 * Запуск из корня проекта: node tools/selftest.mjs
 * Код выхода: 0 — все тесты прошли, 1 — есть провалы.
 */
import { summary } from './lib/harness.mjs';
import { ROOT } from './lib/paths.mjs';

/** Порядок важен: rng первым, чтобы фикстуры боя брали настоящий mulberry32. */
const SUITES = [
  './tests/rng.test.mjs',
  './tests/util.test.mjs',
  './tests/fight.test.mjs',
  './tests/bite.test.mjs',
  './tests/climate.test.mjs',
];

async function main() {
  console.log('=== selftest: логика rtf4 ===');
  console.log(`корень: ${ROOT}`);
  const startedAt = Date.now();

  for (const suite of SUITES) {
    try {
      const module = await import(suite);
      await module.register();
    } catch (err) {
      // Сломанный файл тестов — это провал прогона, а не тихий пропуск.
      console.log(`\n— ${suite} —`);
      console.log(`  FAIL не удалось выполнить набор: ${(err && err.stack) || err}`);
      process.exitCode = 1;
      return 1;
    }
  }
  return summary(startedAt);
}

let exitCode = 1;
try {
  exitCode = await main();
} catch (err) {
  console.error('selftest упал вне теста:', err && err.stack ? err.stack : err);
  exitCode = 1;
}
process.exitCode = exitCode;
