/** Тесты форматирования и мелких хелперов из src/core/util.js. */
import { group, test, ok, eq } from '../lib/harness.mjs';
import { useModule } from '../lib/loader.mjs';

const UTIL = 'src/core/util.js';

export async function register() {
  group('util.js — форматирование и хелперы');
  await useModule(UTIL, ['fmtInt', 'fmtMoney', 'fmtClock', 'clamp']);

  await test('fmtInt: разряды через пробел', async () => {
    const { fmtInt } = await useModule(UTIL, ['fmtInt']);
    eq(fmtInt(1234567), '1 234 567', 'fmtInt(1234567)');
    eq(fmtInt(999), '999', 'fmtInt(999)');
    eq(fmtInt(0), '0', 'fmtInt(0)');
    eq(fmtInt(1000), '1 000', 'fmtInt(1000)');
    return '1 234 567 / 999 / 1 000';
  });

  await test('fmtMoney: рубли и разряды', async () => {
    const { fmtMoney } = await useModule(UTIL, ['fmtMoney']);
    eq(fmtMoney(450), '450 ₽', 'fmtMoney(450)');
    eq(fmtMoney(1234), '1 234 ₽', 'fmtMoney(1234)');
    return '450 ₽ / 1 234 ₽';
  });

  await test('fmtClock: игровые минуты → ЧЧ:ММ', async () => {
    const { fmtClock } = await useModule(UTIL, ['fmtClock']);
    eq(fmtClock(395), '06:35', 'fmtClock(395)');
    eq(fmtClock(0), '00:00', 'fmtClock(0)');
    eq(fmtClock(1439), '23:59', 'fmtClock(1439)');
    eq(fmtClock(1440), '00:00', 'fmtClock(1440) — новые сутки');
    eq(fmtClock(-30), '23:30', 'fmtClock(-30) — уход в предыдущие сутки');
    return '06:35 / 23:59 / 00:00';
  });

  await test('fmtKg: граммы до килограмма, дальше килограммы с запятой', async () => {
    const { fmtKg } = await useModule(UTIL, ['fmtKg']);
    eq(fmtKg(0.42), '420 г', 'fmtKg(0.42)');
    eq(fmtKg(3.7), '3,70 кг', 'fmtKg(3.7)');
    ok(/^1,00 кг$/.test(fmtKg(1)), `fmtKg(1) = ${fmtKg(1)}`);
    return '420 г / 3,70 кг';
  });

  await test('clamp/lerp/round2 работают на границах', async () => {
    const { clamp, lerp, round2 } = await useModule(UTIL, ['clamp', 'lerp', 'round2']);
    eq(clamp(-5, 0, 1), 0, 'clamp ниже минимума');
    eq(clamp(5, 0, 1), 1, 'clamp выше максимума');
    eq(clamp(0.5, 0, 1), 0.5, 'clamp внутри диапазона');
    eq(lerp(0, 10, 0.5), 5, 'lerp посередине');
    eq(round2(1.2345), 1.23, 'round2');
    return 'значения совпали';
  });
}
