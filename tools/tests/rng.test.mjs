/** Тесты детерминированного ГПСЧ: mulberry32, hashSeed, pickWeighted. */
import { group, test, fail, ok, eq, near, inRange, same } from '../lib/harness.mjs';
import { useModule } from '../lib/loader.mjs';

const RNG = 'src/core/rng.js';

export async function register() {
  group('rng.js — детерминированный ГПСЧ');
  await useModule(RNG, ['mulberry32', 'hashSeed', 'pickWeighted']);

  await test('mulberry32: одинаковый seed → одинаковая последовательность', async () => {
    const { mulberry32 } = await useModule(RNG, ['mulberry32']);
    const seqA = Array.from({ length: 20 }, mulberry32(12345));
    const seqB = Array.from({ length: 20 }, mulberry32(12345));
    same(seqA, seqB, 'две последовательности с seed=12345');
    ok(new Set(seqA).size > 15, `последовательность почти не повторяется (уникальных: ${new Set(seqA).size}/20)`);
    return '20 значений совпали';
  });

  await test('mulberry32: разные seed → разные последовательности', async () => {
    const { mulberry32 } = await useModule(RNG, ['mulberry32']);
    const a = Array.from({ length: 10 }, mulberry32(1));
    const b = Array.from({ length: 10 }, mulberry32(2));
    ok(a.some((value, i) => value !== b[i]), 'последовательности для seed=1 и seed=2 совпали');
    return 'последовательности различаются';
  });

  await test('mulberry32: значения в [0,1)', async () => {
    const { mulberry32 } = await useModule(RNG, ['mulberry32']);
    const next = mulberry32(777);
    let min = 1;
    let max = 0;
    for (let i = 0; i < 5000; i += 1) {
      const v = next();
      if (!Number.isFinite(v)) fail(`не число на шаге ${i}: ${v}`);
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    ok(min >= 0 && max < 1, `диапазон ${min}..${max} вышел за [0,1)`);
    ok(max > 0.99 && min < 0.01, `распределение слишком узкое: ${min}..${max}`);
    return `5000 значений в ${min.toFixed(4)}..${max.toFixed(4)}`;
  });

  await test('hashSeed: стабилен и лежит в uint32', async () => {
    const { hashSeed } = await useModule(RNG, ['hashSeed']);
    eq(hashSeed('rtf4'), hashSeed('rtf4'), 'повторный вызов hashSeed("rtf4")');
    eq(hashSeed(''), 2166136261, 'hashSeed("") — FNV-offset basis');
    eq(hashSeed('rtf4'), 3455861665, 'золотое значение hashSeed("rtf4")');
    ok(hashSeed('karp') !== hashSeed('som'), 'разные строки дают одинаковый хеш');
    for (const value of [hashSeed(''), hashSeed('okun'), hashSeed('Сом'), hashSeed('a'.repeat(500))]) {
      inRange(value, 0, 0xffffffff, 'hashSeed');
      ok(Number.isInteger(value), `hashSeed вернул не целое: ${value}`);
    }
    return 'FNV-1a стабилен, uint32';
  });

  await test('pickWeighted: учитывает веса', async () => {
    const { mulberry32, pickWeighted } = await useModule(RNG, ['mulberry32', 'pickWeighted']);
    const rng = mulberry32(42);
    const entries = [{ value: 'редко', weight: 1 }, { value: 'часто', weight: 9 }];
    const counts = { редко: 0, часто: 0 };
    const N = 4000;
    for (let i = 0; i < N; i += 1) counts[pickWeighted(rng, entries)] += 1;
    const share = counts.часто / N;
    near(share, 0.9, 0.03, 'доля элемента с весом 9/10');
    return `${(share * 100).toFixed(1)}% у веса 9 против 10%`;
  });

  await test('pickWeighted: нулевые веса игнорируются, пустой список — undefined', async () => {
    const { mulberry32, pickWeighted } = await useModule(RNG, ['mulberry32', 'pickWeighted']);
    const rng = mulberry32(7);
    for (let i = 0; i < 200; i += 1) {
      eq(pickWeighted(rng, [{ value: 'нет', weight: 0 }, { value: 'да', weight: 1 }]), 'да', 'нулевой вес');
    }
    eq(pickWeighted(rng, []), undefined, 'пустой список');
    eq(pickWeighted(rng, [{ value: 'x', weight: 0 }]), 'x', 'все веса нулевые');
    return 'нули пропущены, пустой список → undefined';
  });
}
