// Снасти: удилища, катушки, лески, крючки, поплавки, грузила, кормушки.
// Схема — docs/API.md §2.4, id — docs/SPEC.md §4a. Баланс: сильнее и дороже = выше level.
export const RODS = [
  {
    id: 'rod_float_1',
    name: 'Поплавочная удочка «Старт»',
    kind: 'float',
    power: 0.25,
    maxLoadKg: 2,
    castRangeM: 20,
    sensitivity: 0.45,
    price: 250,
    level: 1,
    desc: 'Лёгкое стеклопластиковое удилище для карася и плотвы у берега.',
  },
  {
    id: 'rod_float_pro',
    name: 'Поплавочная «Мастер»',
    kind: 'float',
    power: 0.5,
    maxLoadKg: 7,
    castRangeM: 32,
    sensitivity: 0.78,
    price: 1400,
    level: 3,
    desc: 'Карбон с мягкой вершинкой и запасом прочности: видно осторожную поклёвку на дистанции.',
  },
  {
    id: 'rod_spin_1',
    name: 'Спиннинг «Первый заброс»',
    kind: 'spin',
    power: 0.4,
    maxLoadKg: 4,
    castRangeM: 40,
    sensitivity: 0.5,
    price: 480,
    level: 2,
    desc: 'Бюджетный спиннинг до 15 г, хватает на окуня и щуку-травянку.',
  },
  {
    id: 'rod_spin_pro',
    name: 'Спиннинг «Хищник»',
    kind: 'spin',
    power: 0.75,
    maxLoadKg: 12,
    castRangeM: 60,
    sensitivity: 0.82,
    price: 3200,
    level: 5,
    desc: 'Жёсткий бланк до 40 г: держит трофейную щуку и позволяет джиговать на течении.',
  },
  {
    id: 'rod_feeder_1',
    name: 'Фидер «Пикер»',
    kind: 'feeder',
    power: 0.5,
    maxLoadKg: 6,
    castRangeM: 45,
    sensitivity: 0.6,
    price: 900,
    level: 2,
    desc: 'Пикер с вершинками разной жёсткости — под прикормку и леща на реке.',
  },
  {
    id: 'rod_bottom_1',
    name: 'Донка «Тяжёлая»',
    kind: 'bottom',
    power: 0.65,
    maxLoadKg: 10,
    castRangeM: 55,
    sensitivity: 0.4,
    price: 1600,
    level: 4,
    desc: 'Мощная донка под груз и живца: сом и трофейный карп на илистом дне.',
  },
];

export const REELS = [
  {
    id: 'reel_1',
    name: 'Катушка «Обычная»',
    reelSpeed: 0.3,
    maxDragKg: 3,
    price: 200,
    level: 1,
    desc: 'Простая безынерционка с передним фрикционом, до 3 кг на фрикционе.',
  },
  {
    id: 'reel_pro',
    name: 'Катушка «Морская»',
    reelSpeed: 0.55,
    maxDragKg: 8,
    price: 1500,
    level: 4,
    desc: 'Усиленный механизм и плавный фрикцион — под карпа и морскую рыбу.',
  },
  {
    id: 'reel_spin_pro',
    name: 'Катушка «Быстрая»',
    reelSpeed: 0.9,
    maxDragKg: 12,
    price: 2800,
    level: 6,
    desc: 'Высокая передача для скоростной подмотки приманок и силового вываживания.',
  },
];

export const LINES = [
  {
    id: 'line_1',
    name: 'Леска 0.20 мм',
    lineTestKg: 2.5,
    diameterMm: 0.2,
    invisibility: 0.6,
    price: 60,
    level: 1,
    desc: 'Стандартная монофильная леска: тянет мелочь, но рвётся на крупной рыбе.',
  },
  {
    id: 'line_pro',
    name: 'Леска 0.30 мм',
    lineTestKg: 6,
    diameterMm: 0.3,
    invisibility: 0.45,
    price: 220,
    level: 3,
    desc: 'Прочная монофилка с запасом на рывок; чуть заметнее в прозрачной воде.',
  },
  {
    id: 'line_braid',
    name: 'Шнур 0.15 мм',
    lineTestKg: 11,
    diameterMm: 0.15,
    invisibility: 0.25,
    price: 650,
    level: 5,
    desc: 'Плетёный шнур: почти не тянется, поэтому подсечка резкая, но рыба его видит.',
  },
];

export const HOOKS = [
  {
    id: 'hook_s',
    name: 'Крючок №12',
    size: 's',
    strength: 0.3,
    price: 12,
    level: 1,
    desc: 'Мелкий крючок под опарыша и мотыля: мелочь засекается, но разгибается на крупной рыбе.',
  },
  {
    id: 'hook_m',
    name: 'Крючок №8',
    size: 'm',
    strength: 0.55,
    price: 20,
    level: 1,
    desc: 'Универсальный размер под червя, кукурузу и горох.',
  },
  {
    id: 'hook_l',
    name: 'Крючок №4',
    size: 'l',
    strength: 0.85,
    price: 45,
    level: 3,
    desc: 'Кованый крючок для живца и бойла: держит трофейную пасть без разгиба.',
  },
];

export const FLOATS = [
  {
    id: 'float_s',
    name: 'Поплавок 1 г',
    sensitivity: 0.75,
    buoyancy: 0.3,
    price: 30,
    level: 1,
    desc: 'Лёгкий поплавок для стоячей воды: показывает даже прикосновение к наживке.',
  },
  {
    id: 'float_m',
    name: 'Поплавок 4 г',
    sensitivity: 0.85,
    buoyancy: 0.75,
    price: 80,
    level: 2,
    desc: 'Огружённый поплавок под течение и ветер, с длинной антенной и чёткой поклёвкой.',
  },
];

export const SINKERS = [
  {
    id: 'sinker_s',
    name: 'Грузило 10 г',
    weightG: 10,
    price: 10,
    level: 1,
    desc: 'Лёгкая дробинка для поплавочной оснастки на малой глубине.',
  },
  {
    id: 'sinker_m',
    name: 'Грузило 40 г',
    weightG: 40,
    price: 25,
    level: 2,
    desc: 'Тяжёлый груз для донки: держит дно на течении и не сносит оснастку.',
  },
];

export const FEEDERS = [
  {
    id: 'feeder_s',
    name: 'Кормушка 30 г',
    weightG: 30,
    price: 60,
    level: 2,
    desc: 'Пружинная кормушка под прикормку: медленно отдаёт смесь и подводит леща к точке.',
  },
];

// Сводный справочник по всем категориям снастей: TACKLE_BY_ID.rod_float_1.maxLoadKg
export const TACKLE_BY_ID = Object.fromEntries(
  [...RODS, ...REELS, ...LINES, ...HOOKS, ...FLOATS, ...SINKERS, ...FEEDERS].map((item) => [item.id, item]),
);
