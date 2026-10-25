// Погода, сезоны и границы времени суток. Схема — docs/API.md §2.5.
// Пресеты погоды: cloud — доля облачности, windMs — м/с, pressure — гПа, tempDelta — поправка к сезонной температуре.
export const WEATHER_PRESETS = [
  {
    id: 'clear',
    name: 'Ясно',
    precip: 'none',
    cloud: [0, 0.2],
    windMs: [0, 3],
    pressure: [1018, 1032],
    tempDelta: 1.5,
    weight: 30,
  },
  {
    id: 'cloudy',
    name: 'Переменная облачность',
    precip: 'none',
    cloud: [0.4, 0.8],
    windMs: [2, 6],
    pressure: [1008, 1020],
    tempDelta: 0,
    weight: 34,
  },
  {
    id: 'rain',
    name: 'Дождь',
    precip: 'rain',
    cloud: [0.75, 1],
    windMs: [3, 8],
    pressure: [998, 1012],
    tempDelta: -1.5,
    weight: 20,
  },
  {
    id: 'storm',
    name: 'Гроза',
    precip: 'storm',
    cloud: [0.9, 1],
    windMs: [9, 16],
    pressure: [985, 1000],
    tempDelta: -3,
    weight: 6,
  },
  {
    id: 'fog',
    name: 'Туман',
    precip: 'none',
    cloud: [0.5, 0.9],
    windMs: [0, 2],
    pressure: [1012, 1024],
    tempDelta: -3.5,
    weight: 10,
  },
];

// Сезонный профиль: tempBase — средняя температура, tempAmp — суточная амплитуда,
// precipBias/windBias — множители к вероятности осадков и силе ветра.
export const SEASON_PROFILE = {
  spring: { tempBase: 9, tempAmp: 7, precipBias: 1.1, windBias: 1.05 },
  summer: { tempBase: 21, tempAmp: 8, precipBias: 0.9, windBias: 0.9 },
  autumn: { tempBase: 8, tempAmp: 6, precipBias: 1.35, windBias: 1.25 },
  winter: { tempBase: -6, tempAmp: 5, precipBias: 0.8, windBias: 1.15 },
};

// Границы фаз суток в игровых минутах (0..1439): рассвет, день, закат, ночь.
export const TIME_OF_DAY_BOUNDS = {
  dawn: [240, 480],
  day: [480, 1080],
  dusk: [1080, 1320],
  night: [1320, 1440],
};
