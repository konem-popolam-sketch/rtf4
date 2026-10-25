/** Тесты климата: src/sim/climate.js — время, сезоны, погода. */
import { group, test, ok, eq, near, inRange } from '../lib/harness.mjs';
import { loadModule } from '../lib/loader.mjs';

const CLIMATE = 'src/sim/climate.js';
const SEASON_ORDER = ['spring', 'summer', 'autumn', 'winter'];
const DAYS_PER_SEASON = 7;

let createClimate = null;
let stepClimate = null;
let timeOfDayOf = null;
let loadError = null;

export async function register() {
  group('climate.js — время, сезоны, погода');

  const entry = await loadModule(CLIMATE, ['createClimate', 'stepClimate', 'timeOfDayOf']);
  if (entry.mod) {
    createClimate = entry.mod.createClimate;
    stepClimate = entry.mod.stepClimate;
    timeOfDayOf = entry.mod.timeOfDayOf;
  } else {
    loadError = entry.error;
    console.log(`  (модуль недоступен: ${loadError})`);
  }
  const needClimate = () => {
    if (!createClimate || !stepClimate || !timeOfDayOf) throw new Error(loadError || 'climate.js не загрузился');
  };

  await test('timeOfDayOf: фазы на границах 240/480/1080/1320', async () => {
    needClimate();
    const cases = [
      [0, 'night'], [239, 'night'], [240, 'dawn'], [479, 'dawn'], [480, 'day'],
      [1079, 'day'], [1080, 'dusk'], [1319, 'dusk'], [1320, 'night'], [1439, 'night'],
    ];
    for (const [minutes, expected] of cases) {
      eq(timeOfDayOf(minutes), expected, `timeOfDayOf(${minutes})`);
    }
    return '10 границ совпали';
  });

  await test('createClimate: начальное состояние задано и валидно', async () => {
    needClimate();
    const climate = createClimate({ seed: 'selftest', startMinutes: 360, startDay: 2, season: 'summer' });
    eq(climate.season, 'summer', 'season');
    eq(climate.day, 2, 'day');
    eq(climate.minutes, 360, 'minutes');
    ok(climate.weather && typeof climate.weather === 'object', 'weather отсутствует');
    inRange(climate.weather.tempC, -60, 60, 'weather.tempC');
    inRange(climate.weather.pressure, 900, 1100, 'weather.pressure');
    return `summer, день 2, погода ${Math.round(climate.weather.tempC)}°C`;
  });

  await test('stepClimate: минуты растут по timeScale', async () => {
    needClimate();
    const climate = createClimate({ seed: 'grow', startMinutes: 600, startDay: 1, season: 'autumn' });
    const before = climate.minutes;
    let previousTotal = climate.day * 1440 + climate.minutes;
    let monotone = true;
    for (let i = 0; i < 100; i += 1) {
      stepClimate(climate, 0.25, 1);
      const total = climate.day * 1440 + climate.minutes;
      if (total < previousTotal - 1e-6) monotone = false;
      previousTotal = total;
    }
    ok(monotone, 'игровое время шло назад');
    near(climate.minutes - before, 25, 1e-6, 'прирост минут за 100 шагов по 0.25 с');
    return `${before} → ${climate.minutes.toFixed(1)} минут за 25 реальных секунд`;
  });

  await test('stepClimate: переход через полночь повышает день', async () => {
    needClimate();
    const climate = createClimate({ seed: 'midnight', startMinutes: 1430, startDay: 3, season: 'autumn' });
    const result = stepClimate(climate, 0.25, 60); // 15 игровых минут
    eq(result.day, 4, 'day после полуночи');
    inRange(result.minutes, 0, 1439, 'minutes после полуночи');
    eq(result.changed, true, 'флаг changed на смене суток');
    return `день 3 → ${result.day}, ${Math.round(result.minutes)} мин`;
  });

  await test('stepClimate: сезон меняется раз в 7 игровых дней', async () => {
    needClimate();
    const climate = createClimate({ seed: 'season', startMinutes: 0, startDay: 1, season: 'autumn' });
    const seasonsByDay = new Map(); // день → множество сезонов, увиденных в этот день
    const orderViolations = [];
    const changeDays = [];
    let previousSeason = climate.season;
    let previousDay = climate.day;
    const remember = () => {
      if (!seasonsByDay.has(climate.day)) seasonsByDay.set(climate.day, new Set());
      seasonsByDay.get(climate.day).add(climate.season);
    };
    remember();
    // 40 игровых дней по 15 игровых минут за шаг — с запасом на 5 смен сезона.
    for (let step = 0; step < 96 * 40; step += 1) {
      stepClimate(climate, 0.25, 60);
      remember();
      if (climate.season !== previousSeason) {
        if (!SEASON_ORDER.includes(climate.season)) orderViolations.push(`неизвестный сезон «${climate.season}»`);
        const nextExpected = SEASON_ORDER[(SEASON_ORDER.indexOf(previousSeason) + 1) % 4];
        if (nextExpected !== climate.season) {
          orderViolations.push(`после «${previousSeason}» ожидался «${nextExpected}», получен «${climate.season}»`);
        }
        if (climate.day !== previousDay) changeDays.push(climate.day);
        previousSeason = climate.season;
      }
      previousDay = climate.day;
    }

    // 1. Главный симптом: сезон дёргается несколько раз за один игровой день.
    const noisyDays = [...seasonsByDay.entries()].filter(([, set]) => set.size > 1);
    ok(
      noisyDays.length === 0,
      `сезон скачет внутри игрового дня: ${noisyDays
        .slice(0, 3)
        .map(([day, set]) => `день ${day} — ${[...set].join('/')}`)
        .join('; ')}. Контракт docs/API.md §4: смена сезона каждые ${DAYS_PER_SEASON} игровых дней. ` +
        'Причина в src/sim/climate.js: stepClimate вызывает seasonOfDay(c.day, c.season) уже с ' +
        'изменённым c.season, поэтому каждый шаг добавляет ещё одну смену.',
    );

    // 2. Порядок сезонов: весна → лето → осень → зима → весна.
    ok(orderViolations.length === 0, `нарушен порядок сезонов: ${orderViolations.slice(0, 3).join('; ')}`);

    // 3. Ровно одна смена на каждые 7 дней, начиная с 7-го.
    const seenDays = Math.max(...seasonsByDay.keys());
    const expectedChanges = Math.floor(seenDays / DAYS_PER_SEASON);
    ok(
      changeDays.length === expectedChanges,
      `смен сезона ${changeDays.length}, ожидалось ${expectedChanges} за ${seenDays} игровых дней`,
    );
    for (let i = 1; i < changeDays.length; i += 1) {
      eq(changeDays[i] - changeDays[i - 1], DAYS_PER_SEASON, `интервал между сменами (дни ${changeDays[i - 1]}→${changeDays[i]})`);
    }
    return `${changeDays.length} смен ровно через ${DAYS_PER_SEASON} дней (дни ${changeDays.join(', ')})`;
  });

  await test('stepClimate: флаг changed реагирует на смену фазы суток', async () => {
    needClimate();
    // Старт за минуту до рассвета: первый же шаг должен сменить ночь на рассвет.
    const climate = createClimate({ seed: 'dawn', startMinutes: 239, startDay: 1, season: 'autumn' });
    eq(timeOfDayOf(climate.minutes), 'night', 'фаза до шага');
    const result = stepClimate(climate, 0.25, 4); // +1 игровая минута
    eq(timeOfDayOf(result.minutes), 'dawn', 'фаза после шага');
    eq(result.changed, true, 'флаг changed на смене фазы');
    return 'ночь → рассвет, changed=true';
  });
}
