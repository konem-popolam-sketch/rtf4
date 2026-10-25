# API-контракт модулей (обязателен к исполнению)

Читать вместе с `docs/SPEC.md`. SPEC — правила и зоны ответственности, этот файл — точные сигнатуры.
Расходиться с ним нельзя: капитан собирает модули в `src/main.js` и правит только свои файлы.

Окружение: чистый ESM, без сборки, three.js r169 из `vendor/three.module.js` через import map
(`import * as THREE from 'three'`). Проверка синтаксиса — `node --check <файл>` (работает, т.к.
`package.json` содержит `"type": "module"`).

---

## 1. Общие объекты, которые передаются в модули

```js
// state — единый стор (см. §3)
// bus  — шина событий (src/core/bus.js), уже существует
// ctx  — кадровый контекст, собирается капитаном в src/core/game.js:
ctx = {
  dt: 0.016,            // секунды с прошлого кадра
  now: 1234567,         // performance.now()
  minutes: 421,         // игровые минуты суток 0..1439
  day: 3,
  season: 'autumn',     // 'spring'|'summer'|'autumn'|'winter'
  timeOfDay: 'day',     // 'dawn'|'day'|'dusk'|'night'
  weather: { tempC: 12, windMs: 4, windDir: 220, precip: 'none', pressure: 1013, cloud: 0.4 },
  phase: 'idle',        // 'idle'|'cast'|'wait'|'bite'|'fight'|'landed'
  cast: null,           // { distM, spotId, bobberT } или null
  fight: null,          // fightState из src/sim/fight.js или null
  fish: null,           // текущая рыба на крючке (объект из FISH) или null
  paused: false,
}
```

События шины (строго эти имена, payload указан):

| событие | payload |
|---|---|
| `state:changed` | `state` |
| `time:tick` | `{minutes, day, season, timeOfDay}` |
| `weather:changed` | `weather` |
| `bite:start` | `{delaysSec}` |
| `bite:strike` | `{fishId}` |
| `fight:update` | `fightState` |
| `fight:end` | `{status:'landed'|'broken'|'escaped', fish, kg}` |
| `catch:landed` | `{fish, kg, cm, price}` |
| `inventory:changed` | `state.inventory` |
| `money:changed` | `{money, delta}` |
| `level:up` | `{level}` |
| `sfx` | `{name}` — имя звука из §7 |
| `toast` | `{text, kind:'info'|'good'|'bad'|'gold'}` |
| `ui:panel` | `{name}` или `{name:null}` при закрытии |
| `quest:progress` | `{id, value}` |

---

## 2. `src/data/*.js` — данные (владелец: gameplay-агент)

Только данные, никакой логики. Все id — строго из SPEC §4a. Экспорт — именованные массивы.

### `src/data/fish.js`
```js
export const FISH = [{
  id: 'okun', name: 'Окунь', latin: 'Perca fluviatilis', family: 'окуневые',
  water: ['river','lake','pond'],        // типы водоёмов, где водится
  rarity: 1,                              // 0 обычная .. 5 легендарная
  minKg: 0.05, maxKg: 1.2, recordKg: 2.1,
  fightPower: 0.35, stamina: 0.3, aggro: 0.5,   // 0..1
  depth: 'mid',                           // 'bottom'|'mid'|'surface'
  bait: ['cherv','oparysh'], lure: ['vertushka','vibrohvost'],  // id наживок/приманок
  timeOfDay: { dawn: 1.0, day: 0.7, dusk: 1.0, night: 0.3 },     // множитель клева 0..1.2
  seasons: ['spring','summer','autumn','winter'],
  weatherPenalty: { rain: 0.9, wind: 0.8, clear: 1.0 },          // множитель клева
  xp: 8, pricePerKg: 120,
  color: '#6f8f4a', shape: 'torpedo',     // 'torpedo'|'flat'|'round'
  desc: 'Стайная рыба, держится у травы и коряг.',  // 1 предложение для атласа
}]
```
Требуется ровно 31 запись с id из списка SPEC §4a (все 31 обязательны, ни одного лишнего; счёт по уникальным id).
Согласованность: `bait`/`lure` — только id из `BAITS`/`LURES`; `water` — только `'river','lake','pond','sea'`.

### `src/data/baits.js`
```js
export const BAITS = [{ id, name, type: 'bait', price, sizeMm, hookSize: 's'|'m'|'l',
  color, depthWork: 'bottom'|'mid'|'surface', attraction: { small:0..1, medium:0..1, big:0..1 }, notes }]
```
Ровно 13 наживок с id из SPEC §4a.

### `src/data/lures.js`
```js
export const LURES = [{ id, name, type: 'lure', price, sizeMm, hookSize, color,
  depthWork: 'bottom'|'mid'|'surface', drag: 0..1, attraction: { small, medium, big }, notes }]
```
Ровно 10 приманок с id из SPEC §4a.

### `src/data/tackle.js`
```js
export const RODS = [{ id, name, kind:'float'|'spin'|'feeder'|'bottom', power:0..1,
  maxLoadKg, castRangeM, sensitivity:0..1, price, level:1, desc }]
export const REELS = [{ id, name, reelSpeed:0..1, maxDragKg, price, level, desc }]
export const LINES = [{ id, name, lineTestKg, diameterMm, invisibility:0..1, price, level, desc }]
export const HOOKS = [{ id, name, size:'s'|'m'|'l', strength:0..1, price, level, desc }]
export const FLOATS = [{ id, name, sensitivity:0..1, buoyancy:0..1, price, level, desc }]
export const SINKERS = [{ id, name, weightG, price, level, desc }]
export const FEEDERS = [{ id, name, weightG, price, level, desc }]
```
id удилищ: `rod_float_1, rod_float_pro, rod_spin_1, rod_spin_pro, rod_feeder_1, rod_bottom_1`;
катушки `reel_1, reel_pro, reel_spin_pro`; лески `line_1, line_pro, line_braid`; крючки `hook_s, hook_m, hook_l`;
поплавки `float_s, float_m`; грузила `sinker_s, sinker_m`; кормушки `feeder_s`.
Плюс `export const TACKLE_BY_ID = { ...все объекты всех массивов по id }`.

### `src/data/spots.js`
```js
export const WATERS = [{ id, name, type:'river'|'lake'|'pond'|'sea', unlockLevel, travelCost,
  region, desc, ambient: { fogColor:'#hex', waterColor:'#hex', skyTop:'#hex', skyBottom:'#hex',
                            groundColor:'#hex', reeds:true|false, boats:0|1|2 },
  spots: [{ id, name, x, z, depthM, structure:'pit'|'grass'|'snag'|'sand'|'dropoff'|'reed',
            fish: [fishId], bestTime: ['dawn',...], notes }] }]
```
Водоёмы: `volga`(river,1), `seliger`(lake,3), `prud_dachny`(pond,1), `azov`(sea,6) — по ≥4 точки.
`export const WATER_BY_ID`, `export const ALL_SPOTS` (плоский список с полем `waterId`).

### `src/data/weather.js`
```js
export const WEATHER_PRESETS = [{ id:'clear'|'cloudy'|'rain'|'storm'|'fog', name, precip,
  cloud:[min,max], windMs:[min,max], pressure:[min,max], tempDelta: -5..5, weight }]
export const SEASON_PROFILE = { spring:{tempBase:8, ...}, summer:{...}, autumn:{...}, winter:{...} }
export const TIME_OF_DAY_BOUNDS = { dawn:[4*60,8*60], day:[8*60,18*60], dusk:[18*60,22*60], night:[22*60,24*60] }
```

### `src/data/quests.js`
```js
export const QUESTS = [{ id, title, desc, goal: { type:'catchCount'|'catchKg'|'catchFish'|'earnMoney',
  target: 3, fishId?: 'okun', minKg?: 1 }, reward: { money: 300, xp: 40, level?: 2 }, repeatable: false }]
```
≥8 квестов, все id уникальны.

---

## 3. `src/state/game.js` (капитан)
```js
export function initState(storage)        // -> state (загружает сейв или создаёт новый)
export function saveState(state)          // запись в localStorage, троттлинг внутри
export function getState()                // -> state
export function subscribe(fn)             // fn(state) на каждое изменение; -> unsubscribe
```
Форма состояния — SPEC §2 (`src/state/game.js`). Дополнительно капитан добавляет:
`state.player.name`, `state.player.xpNext` (порог следующего уровня), `state.fishCaught` не нужен —
садок это `state.inventory.fish`.

`src/state/actions.js` (капитан) экспортирует мутаторы. Контракт закрыт для всех модулей:

```js
// деньги и опыт
addMoney(delta, reason)        // -> bool (false, если списание не прошло)
addXp(amount)                  // -> {level, leveledUp}
spend(amount)                  // -> bool
// наживки и приманки
addBait(id, qty = 1)
useBait(id, qty = 1)           // -> bool (false, если нет на складе)
addLure(id)                    // -> uid
// снасть
setTackle(patch)               // patch: {rodId, reelId, lineId, hookId, floatId, sinkerId, feederId,
                               //        rig, baitId, lureId}; baitId:null и lureId:null взаимоисключающие —
                               //        выставление одного обнуляет другое; проверка level/владения внутри
// садок и продажа
addFish(fishId, kg, cm)        // -> запись в садке {uid, fishId, kg, cm, ts}
sellFish(uid)                  // -> price
sellAllFish()                  // -> total
// мир
setWater(id)                   // сам ставит первую точку водоёма, если spotId не из него
setSpot(id)
// покупки (универсально, вид определяется по id)
buyItem(id, qty = 1)           // -> bool; наживка/приманка/снасть по каталогу, списывает деньги
buyBait(id, qty = 1)           // -> bool (обёртка над buyItem)
buyLure(id)                    // -> bool
buyTackle(id)                  // -> bool
// квесты
claimQuest(id)                 // -> bool; выдаёт награду, если прогресс выполнен и награда не забрана
// настройки
setVolume(patch)               // patch: {master, sfx, ambient} 0..1, частичное обновление
setTimeScale(x)                // 1..8
resetSave()                    // -> Promise<void>; чистит сейв и перезагружает страницу
// журнал/UI
addToLog(text)
setPanel(name)                 // name: string|null; эмитит ui:panel
levelUpCheck()                 // -> bool
tickPlayTime(dtSec)
```

Каждое действие мутирует `state` и эмитит `state:changed`; при изменении инвентаря дополнительно
`inventory:changed`, денег — `money:changed`, уровня — `level:up`, панели — `ui:panel`.
**Панели и HUD не мутируют `state` напрямую — только через эти функции.**

Дополнительные поля состояния, которые капитан гарантирует (сверх SPEC §2):
```js
state.settings = { volume: { master: 0.8, sfx: 0.9, ambient: 0.6 }, timeScale: 1 }
state.quests   = { progress: {questId: 0}, activeIds: [], claimedIds: [], doneIds: [] }
state.stats.caughtByFish = { fishId: {count, maxKg} }   // для атласа и квестов «поймать вид»
state.stats.earnedMoney  = 0                            // для квестов «заработать N ₽»
state.tackle.sinkerId, state.tackle.feederId            // оснастки bottom/feeder
state.inventory.tackleOwned = [ids]                     // стартовый набор всегда непустой
```

---

## 4. `src/sim/*` (капитан)

`fight.js`:
```js
export function createFight({ fish, tackle, rng })       // tackle: {maxLoadKg, lineTestKg, reelSpeed, maxDragKg, rodPower}
export function stepFight(fightState, input, dtSec)      // input: {reel:0..1, rodUp:bool, pump:bool}
```
`fightState = { status, distM, tension, fishStamina, fishPower, pulse, pulseTimer, drag, hookHold,
  timeSec, maxTension, slackTimer, fish: {id, kg, fightPower, stamina} }`; при `status !== 'fighting'` шаг ничего не меняет.

`bite.js`:
```js
export function evaluateBite({ fishTable, bait, lure, tackle, spot, weather, timeOfDay, season,
                               skillLuring, rng, airPressureDelta })
  // -> { willBite: bool, delaySec: 4..120, chosenFishId: string|null, confidence: 0..1 }
```

`climate.js`:
```js
export function createClimate({ seed, startMinutes, startDay, season })
export function stepClimate(climate, dtSec, timeScale)   // -> {climate, minutes, day, season, weather, changed}
export function timeOfDayOf(minutes)                     // -> 'dawn'|'day'|'dusk'|'night'
```

---

## 5. `src/scene/*` (владелец: engine-агент)

Капитан импортирует ровно это:
```js
// src/scene/renderer.js
export async function createRenderer({ canvas, state, bus })
// -> { THREE, renderer, scene, camera, resize(), render(dt), update(dt, ctx), setWater(water), dispose() }

// src/scene/scene.js
export function createScene({ THREE, renderer, scene, camera, bus, state, water })
// -> {
//      update(dt, ctx),                 // каждый кадр; ctx см. §1
//      setWater(water),                 // смена водоёма: перестроить берег/камыш/лодки
//      setPhase(phase),                 // 'idle'|'cast'|'wait'|'bite'|'fight'|'landed'
//      castTo(distM),                   // анимация заброса поплавка
//      reelProgress(f),                 // 0..1 — подтянуть поплавок к берегу
//      setBite(strength),               // анимация поклёвки поплавка (0..1), 0 = покоя
//      splash(size),                    // всплеск в точке поплавка
//      showFishOn(fishObj),             // силуэт рыбы у поверхности при вываживании
//      hideFish(),                      // убрать силуэт
//      dispose(),
//    }
```
Требования: `createRenderer` НЕ бросает исключение, если WebGL недоступен — тогда `renderer.isFallback = true`,
`render(dt)` рисует градиент на 2D-контексте, `update()` работает, игра остаётся играбельной.
`createScene` при `renderer.isFallback` возвращает объект с теми же методами-заглушками.
Использовать только API three.js r169: `Scene, PerspectiveCamera, WebGLRenderer, Color, Fog,
HemisphereLight, DirectionalLight, AmbientLight, Mesh, PlaneGeometry, BoxGeometry, CylinderGeometry,
SphereGeometry, CircleGeometry, BufferGeometry, BufferAttribute, MeshStandardMaterial, MeshBasicMaterial,
MeshPhongMaterial, CanvasTexture, RepeatWrapping, Vector3, Quaternion, Euler, Group, Points,
PointsMaterial, Line, LineBasicMaterial, LineSegments, InstancedMesh, Matrix4, MathUtils, Clock, SRGBColorSpace`.
Запрещено: `examples/jsm/*` (аддонов нет локально), `OrbitControls`, `RGBELoader`, `ShaderMaterial` с внешними текстурами.

Текстуры — только процедурные (`src/textures/procedural.js`, владелец тот же):
```js
export function waterNormalTexture(THREE, size = 256)   // -> CanvasTexture с гребнями
export function sandTexture(THREE), grassTexture(THREE), reedTexture(THREE), barkTexture(THREE)
export function skyGradientTexture(THREE, topHex, bottomHex)
export function makeCanvas(size)  // -> CanvasRenderingContext2D (уже с фоном)
```

---

## 6. `src/ui/*` (владельцы: ui-агент; HUD — капитан)

```js
// src/ui/panels/index.js     — агрегатор, который даёт капитан
export function initPanels({ bus, state })  // -> { open(name), close(), isOpen() }

// каждый модуль панели: src/ui/panels/<name>.js
export function mount(root, { bus, state }) // root — пустой <div> контейнера
// -> { open(payload), close(), dispose() }
```
Обязательные панели и имена (совпадают с payload `ui:panel`):
`inventory` (садок+наживки), `shop` (товары+продажа), `map` (водоёмы и точки), `atlas` (атлас рыб),
`tackle` (экипировка), `quests` (задания), `settings` (настройки звука/времени).
Каждая панель рендерит свой DOM внутрь `root` (класс `.panel-sheet` из `styles/base.css`) и
не трогает ничего вне `root`. Панель читает `state`, действия выполняет только через `bus.emit`
или через `ctx.actions` (передаётся в `initPanels` капитаном, объект из `src/state/actions.js`).

```js
// src/ui/hud.js (капитан)
export function initHud({ bus, state })   // -> { update(dt, ctx), destroy() }
```

CSS: `styles/panels.css` — владелец ui-агент. `styles/hud.css` — капитан. Токены в `styles/base.css`
(`--c-brass`, `--c-panel`, `--c-water-deep`, `--c-good`, `--c-bad`, `--c-accent`, радиусы, тени).
Правило: никаких новых цветов «на глаз» — только токены и их `color-mix()`.

---

## 7. `src/audio/*` (владелец: audio-агент)

```js
// src/audio/sfx.js
export function initAudio({ bus })  // -> { unlock(), setVolume(master, sfx, ambient), sfx(name), destroy() }
export function playSfx(name, opts) // alias, безопасен до unlock()
// src/audio/ambience.js
export function createAmbience(ctx2dOrAudioCtx)  // -> { start(sceneId), stop(), setWind(0..1), setRain(0..1) }
```
Имена `sfx`: `cast, splash, bite, strike, reel, snap, land, sell, click, levelup, wind_gust, rain_start`.
Всё синтезируется на WebAudio (`OscillatorNode`, `BufferSource` с шумом, `BiquadFilterNode`,
`GainNode`, `ConvolverNode` без внешних импульсов). Никаких загрузок файлов. AudioContext
создаётся лениво и возобновляется по первому клику (`unlock()` капитан вызывает на «Начать рыбалку»).

---

## 8. Правила работы агентов

1. Правишь только свои файлы из §2, §5, §6, §7. Чужой файл — не трогать, даже чтобы «поправить опечатку»: пиши капитану.
2. Перед сдачей: `node --check` на каждом своём `.js` — 0 ошибок. Для файлов с `import` это работает.
3. Никаких `TODO`, `lorem`, заглушек, пустых функций-заглушек в сдаваемых файлах (fallback для WebGL — исключение, он обязан работать).
4. Никаких `console.log` в продакшн-пути.
5. Комментарии — по-русски, по делу. Каждая функция ≤ 60 строк, файл ≤ 400 строк.
6. Не менять `index.html`, `src/main.js`, `src/core/*`, `docs/*`, `vendor/*`.
7. В отчёте капитану: список файлов, что реализовано, какие API-точки закрыты, что осталось спорным.
