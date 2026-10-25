/** Тесты решения о поклёвке: src/sim/bite.js. */
import { group, test, ok, eq, inRange } from '../lib/harness.mjs';
import { loadModule, useModule } from '../lib/loader.mjs';
import { BAIT_CHERV, LURE_VERTUSHKA, SPOT_GRASS, WEATHER_CLEAR, makeFish } from '../lib/fixtures.mjs';

const BITE = 'src/sim/bite.js';
const RNG = 'src/core/rng.js';

let evaluateBite = null;
let loadError = null;

/** Базовые аргументы evaluateBite: ясная погода, рассвет, осень, чувствительная снасть. */
function biteCase(over = {}) {
  return {
    fishTable: [makeFish('okun')],
    bait: BAIT_CHERV,
    lure: null,
    tackle: { sensitivity: 0.7 },
    spot: SPOT_GRASS,
    weather: WEATHER_CLEAR,
    timeOfDay: 'dawn',
    season: 'autumn',
    skillLuring: 3,
    airPressureDelta: 0,
    ...over,
  };
}

/** Считает поклёвки на 30 разных seed — детерминированно и без флаки. */
async function countBites(args, seeds = 30) {
  const { mulberry32 } = await useModule(RNG, ['mulberry32']);
  const bites = [];
  for (let seed = 1; seed <= seeds; seed += 1) {
    const result = evaluateBite({ ...args, rng: mulberry32(seed) });
    inRange(result.delaySec, 4, 120, `delaySec (seed=${seed})`);
    if (result.willBite) bites.push(seed);
  }
  return bites;
}

export async function register() {
  group('bite.js — решение о поклёвке');

  const entry = await loadModule(BITE, ['evaluateBite']);
  if (entry.mod) evaluateBite = entry.mod.evaluateBite;
  else {
    loadError = entry.error;
    console.log(`  (модуль недоступен: ${loadError})`);
  }
  const needBite = () => {
    if (!evaluateBite) throw new Error(loadError || 'bite.js не загрузился');
  };

  await test('evaluateBite: подходящая наживка → поклёвка и рыба из таблицы', async () => {
    needBite();
    const { mulberry32 } = await useModule(RNG, ['mulberry32']);
    const table = [makeFish('okun'), makeFish('plotva')];
    const ids = new Set(table.map((fish) => fish.id));
    let bites = 0;
    const checked = 40;
    for (let seed = 1; seed <= checked; seed += 1) {
      const result = evaluateBite(biteCase({ fishTable: table, rng: mulberry32(seed) }));
      inRange(result.delaySec, 4, 120, `delaySec (seed=${seed})`);
      inRange(result.confidence, 0, 1, `confidence (seed=${seed})`);
      eq(typeof result.willBite, 'boolean', 'тип willBite');
      if (result.willBite) {
        bites += 1;
        ok(ids.has(result.chosenFishId), `chosenFishId «${result.chosenFishId}» не из таблицы`);
      } else {
        eq(result.chosenFishId, null, `chosenFishId при willBite=false (seed=${seed})`);
      }
    }
    ok(bites > 0, `за ${checked} сидов не было ни одной поклёвки`);
    return `${bites}/${checked} поклёвок, delaySec в 4..120`;
  });

  await test('evaluateBite: чужая наживка у единственной рыбы — поклёвки нет', async () => {
    needBite();
    const fish = makeFish('karp', { bait: ['cherv', 'oparysh'], lure: [] });
    const bait = { ...BAIT_CHERV, id: 'kukuruza', attraction: { small: 0.9, medium: 0.9, big: 0.9 } };
    const bites = await countBites(biteCase({ fishTable: [fish], bait, lure: null }));
    ok(
      bites.length === 0,
      `на неподходящую наживку «kukuruza» поклёвка случилась в ${bites.length}/30 сидов ` +
        `(сиды ${bites.slice(0, 5).join(', ')}). Контракт SPEC §2 (bite.js): наживка не из fish.bait — ` +
        'поклёвки быть не должно. Правится в src/sim/bite.js: willBiteChance должен учитывать вес совпадения наживки.',
    );
    return '30/30 отказов';
  });

  await test('evaluateBite: чужая приманка у единственной рыбы — поклёвки нет', async () => {
    needBite();
    const fish = makeFish('karp', { bait: [], lure: ['vobler_ton', 'dzhig'] });
    const bites = await countBites(biteCase({ fishTable: [fish], bait: null, lure: LURE_VERTUSHKA }));
    ok(
      bites.length === 0,
      `на чужую приманку «vertushka» поклёвка случилась в ${bites.length}/30 сидов ` +
        `(сиды ${bites.slice(0, 5).join(', ')}). Контракт SPEC §2 (bite.js): приманки нет в fish.lure — ` +
        'поклёвки быть не должно. Правится в src/sim/bite.js.',
    );
    return '30/30 отказов';
  });

  await test('evaluateBite: совпадающая наживка выбирается чаще несовпадающей', async () => {
    needBite();
    const { mulberry32 } = await useModule(RNG, ['mulberry32']);
    const table = [makeFish('okun', { bait: ['cherv'] }), makeFish('som', { bait: ['zhivets'], rarity: 1 })];
    let okun = 0;
    let som = 0;
    for (let seed = 1; seed <= 200; seed += 1) {
      const result = evaluateBite(biteCase({ fishTable: table, rng: mulberry32(seed) }));
      if (!result.willBite) continue;
      if (result.chosenFishId === 'okun') okun += 1;
      else if (result.chosenFishId === 'som') som += 1;
      else throw new Error(`неожиданный chosenFishId: ${result.chosenFishId}`);
    }
    const total = okun + som;
    ok(total > 0, 'не выбрано ни одной рыбы');
    ok(okun / total > 0.7, `доля совпадающей наживки только ${((okun / total) * 100).toFixed(1)}%`);
    return `okun ${okun} против som ${som} (${((okun / total) * 100).toFixed(1)}%)`;
  });

  await test('evaluateBite: пустая таблица — отказ без исключения', async () => {
    needBite();
    const result = evaluateBite(biteCase({ fishTable: [] }));
    eq(result.willBite, false, 'willBite на пустой таблице');
    eq(result.chosenFishId, null, 'chosenFishId на пустой таблице');
    inRange(result.delaySec, 4, 120, 'delaySec');
    return 'willBite=false, chosenFishId=null';
  });
}
