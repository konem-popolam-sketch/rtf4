/**
 * Мини-фреймворк для unit-тестов: test(name, fn) и утверждения.
 * Без зависимостей, работает в Node ESM.
 */

const results = [];
let currentGroup = 'общее';

/** Заголовок группы тестов — печатается в отчёте. */
export function group(title) {
  currentGroup = title;
  console.log(`\n— ${title} —`);
}

/** Запускает тест; исключение внутри fn означает провал, но не роняет прогон. */
export async function test(name, fn) {
  const started = Date.now();
  try {
    const note = await fn();
    results.push({ group: currentGroup, name, ok: true, note, ms: Date.now() - started });
    console.log(`  OK   ${name}${note ? ` — ${note}` : ''}`);
    return true;
  } catch (err) {
    results.push({ group: currentGroup, name, ok: false, error: err, ms: Date.now() - started });
    const text = String((err && err.message) || err).split('\n').join('\n       ');
    console.log(`  FAIL ${name}\n       ${text}`);
    return false;
  }
}

/* ─────────────────────────── утверждения ─────────────────────────── */

export function fail(message) {
  throw new Error(message);
}

export function ok(condition, message) {
  if (!condition) fail(message);
}

export function eq(actual, expected, what) {
  if (!Object.is(actual, expected)) {
    fail(`${what}: ожидалось ${JSON.stringify(expected)}, получено ${JSON.stringify(actual)}`);
  }
}

export function near(actual, expected, eps, what) {
  if (!(Math.abs(actual - expected) <= eps)) fail(`${what}: ожидалось ${expected} ±${eps}, получено ${actual}`);
}

export function inRange(value, min, max, what) {
  if (!(Number.isFinite(value) && value >= min && value <= max)) {
    fail(`${what}: ${value} вне диапазона ${min}..${max}`);
  }
}

export function same(a, b, what) {
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  if (sa !== sb) fail(`${what}: ${sa} !== ${sb}`);
}

/** Печатает итог и возвращает код выхода: 0 — всё зелёное, 1 — есть провалы. */
export function summary(startedAt) {
  const passed = results.filter((item) => item.ok).length;
  const failed = results.filter((item) => !item.ok);
  const secs = ((Date.now() - startedAt) / 1000).toFixed(2);

  console.log('\n=== Итог ===');
  console.log(`${results.length} тестов · ${passed} passed, ${failed.length} failed · ${secs} c`);
  if (failed.length === 0) {
    console.log('Все тесты зелёные.');
    return 0;
  }
  console.log('Провалы:');
  for (const item of failed) {
    const reason = String((item.error && item.error.message) || item.error).split('\n')[0];
    console.log(`  FAIL [${item.group}] ${item.name} — ${reason}`);
  }
  return 1;
}
