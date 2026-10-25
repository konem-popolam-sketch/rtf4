# Russian Fishing 4 Web — технический контракт (Single Source of Truth)

Фанатский браузерный ремейк «Русской Рыбалки 4». Не копия ассетов, а ремейк механик и интерфейса.
Язык интерфейса и отчётов — русский. Всё, что расходится с этим документом, — ошибка; спорное — вопрос капитану.

## 0. Жёсткие правила окружения (проверено капитаном)

- В песочнице **запрещён spawn сторонних процессов с пайпами**: `npm install`, `vite`, `tsc`, `puppeteer`, `chrome --headless` — НЕ работают (`EPERM`). Не тратить на них время.
- Поэтому сборки НЕТ. Проект — **чистый ES-модульный статический сайт**, который открывается браузером напрямую со статик-сервера.
- Единственная валидация, которая реально работает:
  - `node --check <file.js>` — синтаксис каждого файла;
  - `node tools/selftest.mjs` — логические unit-тесты чистой логики (Node, без DOM);
  - `node tools/serve.cjs 8091 .` — локальная раздача (запускает капитан/QA в фоне).
- Никаких внешних CDN: three.js лежит локально в `vendor/three.module.js` (r169).
- Никаких сетевых запросов во время игры. Сохранение — `localStorage`.
- Никаких чужих ассетов (картинок/звуков из интернета): вся графика — процедурная (canvas-текстуры, примитивы three.js), весь звук — WebAudio-синтез.

## 1. Стек

- JS (ESM), без транспиляции, без TypeScript, без фреймворков. Стили — обычный CSS.
- three.js r169 из `vendor/` через import map в `index.html`.
- Точка входа: `index.html` → `<script type="module" src="./src/main.js">`.

```
rtf4/
  index.html
  styles/            # CSS: base.css, hud.css, panels.css, loader.css
  vendor/three.module.js
  src/
    main.js          # bootstrap: сцена + UI + цикл
    core/            # rng.js, storage.js, bus.js, util.js, save.js
    data/            # fish.js, lures.js, baits.js, spots.js, tackle.js, weather.js, quests.js
    sim/             # climate.js, bite.js, fight.js, fishfinder.js, growth.js
    state/           # game.js (единый стор), actions.js
    scene/           # renderer.js, water.js, sky.js, shore.js, rod.js, bobber.js, fish3d.js, fx.js
    ui/              # hud.js, panels/*.js, dialogs.js, hotbar.js, toast.js
    audio/           # sfx.js (WebAudio-синтез), ambience.js
    textures/        # procedural.js (canvas-генераторы)
  tools/serve.cjs, tools/selftest.mjs
  docs/SPEC.md, docs/DESIGN.md
```

## 2. Контракты модулей (не менять без капитана)

### `src/core/bus.js`
```js
export const bus = { on(name, fn), off(name, fn), emit(name, payload) }
```
События (строго эти имена):
`state:changed`, `time:tick`, `weather:changed`, `bite:start`, `bite:strike`, `fight:update`, `fight:end`,
`catch:landed`, `fish:escaped`, `inventory:changed`, `money:changed`, `level:up`, `toast`, `scene:ready`,
`ui:panel`, `sfx`, `quest:progress`.

### `src/core/rng.js`
```js
export function mulberry32(seed)   // -> () => [0,1)
export function hashSeed(str)      // -> uint32
export function pickWeighted(rng, entries) // entries: [{value, weight}] -> value
```

### `src/data/fish.js`
```js
export const FISH = [ { id, name, latin, family, water:['river'|'lake'|'pond'|'sea'], rarity: 0..5,
  minKg, maxKg, recordKg, fightPower 0..1, stamina 0..1, aggro 0..1, depth: 'bottom'|'mid'|'surface',
  bait: [baitId...], lure: [lureId...], timeOfDay: {dawn,day,dusk,night}, seasons: ['spring',...],
  weatherPenalty: {rain, wind, clear}, xp, pricePerKg, color: '#hex', shape: 'torpedo'|'flat'|'round' } ]
```
≥ **26** видов: окунь, плотва, лещ, карп, карась, щука, судак, сом, налим, линь, голавль, язь, жерех, форель,
хариус, сиг, ряпушка, густера, синец, чехонь, пескарь, ёрш, берш, усач, толстолобик, белый амур, сом-сом,
плюс морские: треска, камбала, сельдь — если сеттинг включает море (минимум одно море).

### `src/data/baits.js`, `src/data/lures.js`
Наживки: червь, опарыш, мотыль, кукуруза, перловка, тесто, геркулес, картофель, горох, ракушка, живец, бойл, пенопласт.
Приманки: вертушка, колебалка, воблер тонущий/плавающий, поппер, джиг, виброхвост, твистер, мормышка, балансир.
У каждой: `id, name, type:'bait'|'lure', price, sizeMm, hookSize, color, attraction{...}, depthWork, drag, notes`.

### `src/data/tackle.js`
Снасти: удилища (спиннинг/поплавочная/фидер/донка), катушки, лески/шнуры, крючки, грузила, поплавки, кормушки.
Свойства: `power, maxLoadKg, castRangeM, sensitivity, reelSpeed, lineTestKg, price, level`.

### `src/data/spots.js`
```js
export const WATERS = [ { id, name, type:'river'|'lake'|'pond'|'sea', unlockLevel, travelCost, region,
  spots: [ { id, name, x, z, depthM, structure:'pit'|'grass'|'snag'|'sand'|'dropoff'|'reed',
             fish: [fishId], bestTime: [...], notes } ] } ]
```
≥ **4** водоёма × ≥4 точки (река, озеро, пруд, море), координаты в метрах для 3D-сцены.

### `src/state/game.js`
Единый стор (plain object) + `subscribe(fn)`; всё изменение — через `actions.js` (мутации + `bus.emit('state:changed')`).
```js
state = {
  version: 1,
  player: { name, level: 1, xp: 0, money: 450, energy: 100, satiety: 100, skillPoints: 0,
            skills: { casting:0, reeling:0, tackle:0, luring:0 } },
  world: { waterId, spotId, day: 1, minutes: 6*60, season: 'autumn',
           weather: { tempC, windMs, windDir, precip: 'none'|'rain'|'storm', pressure, cloud } },
  tackle: { rodId, reelId, lineId, hookId, floatId, sinkerId, feederId, rig: 'float'|'spinning'|'feeder'|'bottom',
            baitId, lureId, extra: { groundbait: bool } },
  inventory: { baits: {id:count}, lures: [ {uid, lureId, wear} ], fish: [ {uid, fishId, kg, cm, ts} ],
               items: {id:count}, tackleOwned: [ids] },
  stats: { casts, bites, catches, escapes, biggestKg, totalKg, sessionStart, playMinutes,
           earnedMoney, caughtByFish: { fishId: { count, maxKg } } },
  settings: { volume: { master: 0.8, sfx: 0.9, ambient: 0.6 }, timeScale: 1 },
  quests: { progress: {questId: 0}, activeIds: [], claimedIds: [], doneIds: [] },
  log: [ {ts, text} ],        // журнал событий, максимум 200
  ui: { panel: null, casting: false, fighting: false, paused: false }
}
```

Полный список мутаторов — `docs/API.md` §3. Панели и HUD не пишут в стор напрямую.
Сейв: `localStorage['rtf4.save.v1']`, автосейв каждые 30 c и на ключевые события.

### `src/sim/fight.js` — сердце игры (чистая логика, тестируемая)
```js
export function createFight({ fish, tackle, rng }) -> fightState
export function stepFight(fightState, input, dtSec) -> fightState   // input: {reel:0..1, rodUp:bool, pump:bool}
```
Правила: натяжение линии `tension 0..1`; превышение `lineTest` → обрыв; слишком слабое натяжение → сход;
у рыбы «рывки» (пульсы) с силой `fightPower`, «усталость» `stamina` падает при нагрузке; дистанция `distM` (5..60 м)
уменьшается при подмотке; посадка — `distM <= landingM`. Выход — `{status:'fighting'|'landed'|'broken'|'escaped'}`.
Все коэффициенты — из данных снасти/рыбы, без хардкода в UI.

### `src/sim/bite.js`
```js
export function evaluateBite({ fishTable, bait, lure, depthM, weather, timeOfDay, season, rng, spot }) 
  -> { willBite: bool, delaySec, chosenFishId, confidence }
```
Учитывать: совпадение наживки/приманки, глубину, время суток, сезон, погоду, структуру дна, skill luring.

### `src/sim/climate.js`
Погода/время: минуты суток идут (1 реальная секунда = 1 игровая минута при `timeScale=1`, ускоряемо),
смена сезона каждые 7 игровых дней; погода марковской цепью с давлением и ветром; влияние на bite.js.

### UI (DOM, поверх canvas)
- HUD сверху: деньги, уровень+XP-полоса, энергия, сытость, время, дата/сезон, погода (иконка+temp+ветер).
- Правый нижний блок: текущая снасть (удилище/катушка/леска/наживка) — как в РР4.
- Хотбар снизу: Заброс (ЛКМ), Подсечка (ПКМ или ЛКМ при поклёвке), Вываживание (ЛКМ зажата), Сменить наживку.
- Панели (модальные): Инвентарь, Магазин, Карта водоёмов, Дневник/Атлас рыб, Крафт наживок, Экипировка, Достижения, Настройки.
- Индикатор поклёвки — поплавок/вершинка + всплывающая шкала; индикатор вываживания — шкала натяжения + полоса выносливости рыбы.
- Все панели закрываются ESC. Ничего не ломается при ресайзе 1280×720 … 2560×1440.

### Сцена (three.js)
- Вода: шейдер или MeshStandardMaterial с нормалями по canvas-текстуре + анимация UV, отражение неба через env/vertex color.
- Берег: террейн-плоскость с процедурной текстурой песка/травы, камыш (инстансы), пара деревьев, лодка/мостки.
- Удочка от первого лица справа, леска (линия/трубка) до поплавка, поплавок с анимацией поклёвки, всплески (points/ring).
- Рыба в воде при вываживании: силуэт, прыжки, брызги.
- Смена дня/ночи: цвет неба, солнце/луна, туман, освещение — непрерывно.
- Целевой FPS ≥ 40 на встроенной графике; ограничение pixelRatio ≤ 2; тени — только одна направленная или вообще без них.

## 3. Разделение ответственности (зоны файлов)

| Роль | Владеет | Не трогает |
|---|---|---|
| captain | `index.html`, `styles/base.css`, `src/main.js`, `src/core/*`, `docs/*`, `tools/*`, сборка/деплой | всё остальное |
| gameplay-programmer | `src/state/*`, `src/data/fish.js`, `baits.js`, `lures.js`, `quests.js` | `src/sim/*`, `src/scene/*`, `src/ui/*` |
| engine-programmer | `src/scene/*`, `src/textures/*` | `src/data/*`, `src/state/*` |
| physics-programmer | `src/sim/*`, `src/data/tackle.js`, `src/data/spots.js`, `src/data/weather.js` | `src/scene/*` |
| ui-programmer | `src/ui/*`, `styles/hud.css`, `styles/panels.css` | `src/sim/*`, `src/scene/*` |
| art-audio-programmer | `src/audio/*`, `src/textures/procedural.js`, `styles/loader.css`, логотип (canvas/SVG) | `src/state/*`, `src/sim/*` |
| qa-integrator | `tools/selftest.mjs`, `src/core/save.js` (по согласованию), отчёт о багах | чужой код без согласования |

Конфликт правок запрещён: правишь только свои файлы; не хватает чужого API — проси капитана/владельца через отчёт.

## 4. Definition of Done для игры

1. `node --check` чистый на всех `.js`.
2. `node tools/selftest.mjs` — зелёный (bite/fight/economy/rng/save-логика).
3. Открывается `index.html` с сервера, грузится за ≤3 c, ошибок в консоли нет.
4. Полный цикл проходим мышью без консоли: выбрать водоём → снасть → заброс → поклёвка → подсечка → вываживание → садок → продажа → прокачка.
5. Сейв переживает перезагрузку страницы.
6. Нет плейсхолдеров вида `TODO`, `lorem`, пустых кнопок.
7. Мобильная раскладка не обязательна, но страница не разъезжается на 1280×720.

## 4a. ПРИЛОЖЕНИЕ: канонические идентификаторы (менять нельзя!)

Эти строки — публичный контракт между модулями. Любой новый id добавляется только с разрешения капитана.

**Рыбы (`fish.id`)** — 31 вид (список ниже — эталон; ни один id не удаляется):
`okun, plotva, lesch, karp, karas, schuka, sudak, som, nalim, lin, golavl, yaz, zherekh, forel, kharius, sig,
ryapushka, gustera, sinets, chekhon, peskar, ersha, bersh, usach, tolstolobik, amur, som_solnechny,
treska, kambala, seld, shchuka_morskaya`

**Наживки (`bait.id`)**: `cherv, oparysh, motyl, kukuruza, perlokva, testo, gercules, kartofel, gorokh,
rakushka, zhivets, boyl, penoplast`

**Приманки (`lure.id`)**: `vertushka, kolebalka, vobler_ton, vobler_plav, popper, dzhig, vibrohvost, tvister,
mormyshka, balansir`

**Снасти (`tackle`)**: удилища `rod_float_1, rod_float_pro, rod_spin_1, rod_spin_pro, rod_feeder_1, rod_bottom_1`;
катушки `reel_1, reel_pro, reel_spin_pro`; лески `line_1, line_pro, line_braid`; крючки `hook_s, hook_m, hook_l`;
поплавки `float_s, float_m`; грузила `sinker_s, sinker_m`; кормушки `feeder_s`.

**Водоёмы (`water.id`)**: `volga` (река, ур.1), `seliger` (озеро, ур.3), `prud_dachny` (пруд, ур.1),
`azov` (море, ур.6).

**Снасти-оснастки (`tackle.rig`)**: `float`, `spinning`, `feeder`, `bottom`.

**Сезоны**: `spring`, `summer`, `autumn`, `winter`. **Время суток**: `dawn`, `day`, `dusk`, `night`.

**Структуры дна**: `pit`, `grass`, `snag`, `sand`, `dropoff`, `reed`.

## 5. Стиль кода

- ES-модули, `const`/`let`, никаких глобалов кроме `window.RTF4_DEBUG` (для тестов).
- Никаких `console.log` в продакшн-пути (кроме `main.js` при `?debug=1`).
- Каждая функция ≤ 60 строк; файл ≤ 400 строк; иначе дробить.
- Комментарии — на русском, только по делу.
- Тексты интерфейса — русские, аккуратные, без англицизмов там, где есть русский термин.
