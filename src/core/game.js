/**
 * game.js (core) — игровой цикл и машина состояний рыбалки. Владелец: капитан.
 * Единственное место, где встречаются sim, scene, ui и audio.
 *
 * Фазы: idle → cast → wait → bite → fight → landed → idle
 * Данные текут так: HUD/сцена читают ctx (см. docs/API.md §1), а команды игрока
 * приходят событиями шины: action:cast, action:strike, action:reel, action:cancel.
 */
import { bus } from './bus.js';
import { clamp, nowMs, fmtKg, round2 } from './util.js';
import { createFight, stepFight, fightProgress } from '../sim/fight.js';
import { evaluateBite, rollFishWeight } from '../sim/bite.js';
import { createClimate, stepClimate, timeOfDayOf, pressureDelta } from '../sim/climate.js';
import { resolveTackle } from '../sim/tackle-stats.js';
import { applyCast } from '../sim/cast.js';
import { FISH, FISH_BY_ID } from '../data/fish.js';
import { WATER_BY_ID, ALL_SPOTS } from '../data/spots.js';
import { BAIT_BY_ID } from '../data/baits.js';
import * as actions from '../state/actions.js';
import { markChanged, saveState } from '../state/game.js';

const LANDING_TIMEOUT = 1.6; // сколько секунд показываем трофей до возврата в idle
const BITE_WINDOW = 1.35; // окно подсечки, секунды
const MAX_BITE_HOLD = 14; // если не подсекать/не вытащить — рыба уходит

export function createGame({ state, renderer, bus: b }) {
  const events = b || bus;
  const game = {
    state,
    renderer,
    scene: null,
    climate: createClimate({
      seed: `${state.world.waterId}:${state.world.day}`,
      startMinutes: state.world.minutes,
      startDay: state.world.day,
      season: state.world.season,
    }),
    phase: 'idle',
    cast: null,
    fight: null,
    fish: null,
    pendingFish: null,
    biteTimer: 0,
    biteWindow: 0,
    biteStrength: 0,
    landedTimer: 0,
    catchInfo: null,
    started: false,
    running: false,
    paused: false,
    lastFrame: 0,
    rafId: 0,
  };

  // --- служебное ---

  function tackleStats() {
    return resolveTackle(state);
  }

  function currentWater() {
    return WATER_BY_ID[state.world.waterId] || null;
  }

  function currentSpot() {
    return ALL_SPOTS.find((s) => s.id === state.world.spotId) || ALL_SPOTS[0];
  }

  /** Таблица рыбы, допустимой в текущем водоёме. */
  function waterFishTable() {
    const water = currentWater();
    const type = water?.type ?? 'pond';
    return FISH.filter((f) => Array.isArray(f.water) && f.water.includes(type));
  }

  /**
   * Держит state.world.weather той же ссылкой, что и game.climate.weather.
   * Синхронизация нужна каждый кадр, а не только при cl.changed: климат плавно
   * подмешивает погоду постоянно, поэтому сейв иначе отстаёт от реальной погоды.
   * markChanged() здесь не зовём — иначе автосейв срабатывал бы каждый кадр.
   */
  function syncWeather() {
    state.world.weather = game.climate.weather;
  }

  function setPhase(next) {
    if (game.phase === next) return;
    game.phase = next;
    game.scene?.setPhase?.(next);
    events.emit('phase:changed', { phase: next });
  }

  function toast(text, kind = 'info') {
    events.emit('toast', { text, kind });
  }

  function sfx(name) {
    events.emit('sfx', { name });
  }

  /** Кадровый контекст для модулей сцены и HUD (docs/API.md §1). */
  function frameContext(dt) {
    const c = game.climate;
    return {
      dt,
      now: nowMs(),
      minutes: Math.floor(c.minutes),
      day: c.day,
      season: c.season,
      timeOfDay: timeOfDayOf(c.minutes),
      weather: c.weather,
      phase: game.phase,
      cast: game.cast,
      fight: game.fight,
      fish: game.fish,
      paused: game.paused,
    };
  }

  // --- действия игрока ---

  function actionCast(power01 = 0.7) {
    if (game.paused || game.phase === 'fight' || game.phase === 'cast') return false;
    if (game.phase === 'bite') return false;
    const spot = currentSpot();
    const stats = tackleStats();
    if (!state.inventory.baits[state.tackle.baitId] && state.tackle.rig !== 'spinning') {
      // Насадка кончилась — берём любую из садка, иначе просим купить.
      const fallback = Object.keys(state.inventory.baits).find((id) => state.inventory.baits[id] > 0);
      if (fallback) {
        actions.setTackle({ baitId: fallback });
        toast(`Насадили ${BAIT_BY_ID[fallback]?.name || fallback}`, 'info');
      } else {
        toast('Наживка закончилась — купите в магазине', 'bad');
        return false;
      }
    }
    const res = applyCast({
      spot,
      stats,
      power01: clamp(Number(power01) || 0.7, 0.05, 1),
      skillCasting: state.player.skills.casting,
      weather: game.climate.weather,
      rng: Math.random,
    });
    game.cast = {
      distM: res.distM,
      spotId: spot.id,
      x: res.x,
      z: res.z,
      depthM: res.depthM ?? spot.depthM,
      bobberT: 0,
    };
    setPhase('cast');
    game.scene?.castTo?.(res.distM);
    sfx('cast');
    state.stats.casts += 1;
    markChanged();
    // Переход в ожидание — после анимации полёта.
    const flight = clamp(res.distM / 26, 0.45, 1.4);
    setTimeout(() => {
      if (game.phase !== 'cast') return;
      beginWaiting();
    }, flight * 1000);
    return true;
  }

  function beginWaiting() {
    setPhase('wait');
    const spot = currentSpot();
    const stats = tackleStats();
    const decision = evaluateBite({
      fishTable: waterFishTable(),
      bait: stats.bait,
      lure: stats.lure,
      tackle: stats,
      spot,
      weather: game.climate.weather,
      timeOfDay: timeOfDayOf(game.climate.minutes),
      season: game.climate.season,
      skillLuring: state.player.skills.luring,
      airPressureDelta: pressureDelta(game.climate),
      rng: Math.random,
    });
    game.biteTimer = clamp(decision.delaySec, 2, 120);
    game.pendingFish = decision.willBite ? decision.chosenFishId : null;
    events.emit('bite:start', { delaysSec: game.biteTimer });
  }

  function triggerBite() {
    if (game.phase !== 'wait') return;
    const fishId = game.pendingFish;
    if (!fishId) {
      // Пустая поклёвка — поплавок дёрнулся, но рыба не взяла.
      game.scene?.setBite?.(0.35);
      sfx('bite');
      setTimeout(() => game.scene?.setBite?.(0), 600);
      beginWaiting();
      return;
    }
    const fish = FISH_BY_ID[fishId];
    const kg = rollFishWeight(fish, Math.random);
    game.fish = fish;
    game.pendingFish = null;
    game.pendingKg = kg;
    game.biteWindow = BITE_WINDOW;
    game.biteStrength = clamp(0.45 + (fish.fightPower || 0.4) * 0.5, 0.4, 1);
    state.stats.bites += 1;
    markChanged();
    setPhase('bite');
    game.scene?.setBite?.(game.biteStrength);
    game.scene?.splash?.(0.35 + game.biteStrength * 0.4);
    sfx('bite');
    events.emit('bite:strike', { fishId });
  }

  function actionStrike() {
    if (game.paused) return false;
    if (game.phase !== 'bite') return false;
    setPhase('fight');
    game.scene?.setBite?.(0);
    const stats = tackleStats();
    game.fight = createFight({ fish: { ...game.fish, kg: game.pendingKg }, tackle: stats, rng: Math.random });
    game.fight.fishKg = game.pendingKg;
    sfx('strike');
    toast('Подсечка!', 'good');
    game.scene?.showFishOn?.({ ...game.fish, kg: game.pendingKg });
    return true;
  }

  function actionReel(value) {
    game.reelInput = clamp(Number(value) || 0, 0, 1);
    return true;
  }

  function actionRodUp(up) {
    game.rodUp = Boolean(up);
    return true;
  }

  function actionCancel() {
    if (game.phase === 'wait' || game.phase === 'cast') {
      game.cast = null;
      game.biteTimer = 0;
      game.pendingFish = null;
      game.fight = null;
      game.fish = null;
      setPhase('idle');
      game.scene?.setPhase?.('idle');
      return true;
    }
    if (game.phase === 'bite') {
      // Пропущенная подсечка: рыба уходит.
      finishFight('escaped');
      return true;
    }
    return false;
  }

  function finishFight(status) {
    const fish = game.fish;
    const kg = game.pendingKg || 0;
    game.fight = null;
    game.scene?.hideFish?.();
    if (status === 'landed' && fish) {
      const cm = Math.round(12 + Math.cbrt(Math.max(0.01, kg)) * 22);
      const record = actions.addFish(fish.id, kg, cm);
      const price = round2(kg * (fish.pricePerKg || 100));
      game.catchInfo = { fish, kg, cm, price, record };
      game.landedTimer = LANDING_TIMEOUT;
      setPhase('landed');
      game.scene?.splash?.(0.9);
      sfx('land');
      events.emit('fight:end', { status, fish, kg });
      toast(`${fish.name} · ${fmtKg(kg)}`, 'gold');
      actions.progressQuest?.('catchFish', { fishId: fish.id, kg });
    } else {
      state.stats.escapes += 1;
      markChanged();
      setPhase('idle');
      events.emit('fight:end', { status, fish, kg });
      sfx('snap');
      toast(status === 'broken' ? 'Леска оборвалась!' : 'Рыба сошла…', 'bad');
      actions.addToLog(status === 'broken' ? 'Обрыв лески при вываживании' : 'Сход рыбы у берега');
    }
    game.cast = null;
    game.fish = null;
    game.pendingKg = 0;
    saveState(state);
  }

  // --- обновление кадра ---

  function update(dtReal) {
    if (!game.started || game.paused) {
      // Даже на паузе обновляем сцену, чтобы картинка не застывала.
      game.renderer?.update?.(0, frameContext(0));
      return;
    }
    const scale = state.settings.timeScale || 1;
    const dt = clamp(dtReal, 0, 0.1);

    // Климат: время идёт по игровым минутам.
    const before = game.climate;
    const cl = stepClimate(before, dt, scale);
    // Погоду держим синхронной каждый кадр — климат меняет её плавно и постоянно.
    syncWeather();
    if (cl.changed) {
      state.world.minutes = Math.floor(cl.minutes);
      state.world.day = cl.day;
      state.world.season = cl.season;
      state.world.weather = cl.weather;
      events.emit('time:tick', {
        minutes: state.world.minutes,
        day: cl.day,
        season: cl.season,
        timeOfDay: timeOfDayOf(cl.minutes),
      });
      events.emit('weather:changed', cl.weather);
    }
    actions.tickPlayTime(dt);

    const ctx = frameContext(dt);

    // Таймеры фаз.
    if (game.phase === 'wait') {
      game.cast.bobberT = (game.cast.bobberT || 0) + dt;
      game.biteTimer -= dt * scale * 0.35;
      if (game.biteTimer <= 0) triggerBite();
    } else if (game.phase === 'bite') {
      game.biteWindow -= dt;
      game.scene?.setBite?.(game.biteStrength * clamp(game.biteWindow / BITE_WINDOW, 0.2, 1));
      if (game.biteWindow <= 0) {
        game.scene?.setBite?.(0);
        finishFight('escaped');
      }
    } else if (game.phase === 'fight') {
      const input = { reel: game.reelInput || 0, rodUp: Boolean(game.rodUp), pump: false };
      stepFight(game.fight, input, dt);
      game.scene?.reelProgress?.(fightProgress(game.fight));
      events.emit('fight:update', game.fight);
      const tension = game.fight?.tension ?? 0;
      if (tension > 0.75) game.scene?.splash?.(0.2 + tension * 0.4);
      if (game.fight && game.fight.status !== 'fighting') finishFight(game.fight.status);
    } else if (game.phase === 'landed') {
      game.landedTimer -= dt;
      if (game.landedTimer <= 0) {
        setPhase('idle');
        game.catchInfo = null;
        game.cast = null;
      }
    }

    game.renderer?.update?.(dt, ctx);
    game.scene?.update?.(dt, ctx);
    game.hud?.update?.(dt, ctx);
  }

  function frame(t) {
    if (!game.running) return;
    const now = t || nowMs();
    const dt = game.lastFrame ? (now - game.lastFrame) / 1000 : 0.016;
    game.lastFrame = now;
    try {
      update(dt);
      game.renderer?.render?.(dt);
    } catch (err) {
      console.error('[game] frame failed', err);
      if (window.RTF4_DEBUG) throw err;
    }
    game.rafId = requestAnimationFrame(frame);
  }

  // --- публичный интерфейс ---

  game.start = () => {
    if (game.started) return;
    game.started = true;
    game.running = true;
    game.lastFrame = 0;
    game.climate = createClimate({
      seed: `${state.world.waterId}:${state.world.day}:${Date.now()}`,
      startMinutes: state.world.minutes,
      startDay: state.world.day,
      season: state.world.season,
    });
    // Новый климат — сразу отдаём его погоду в состояние, иначе до первого
    // changed-кадра HUD и заброс жили бы со стартовой погодой из сейва.
    syncWeather();
    const water = currentWater();
    game.scene?.setWater?.(water);
    game.renderer?.setWater?.(water);
    events.emit('sfx', { name: 'click' });
    toast(`${water?.name || 'Водоём'} · ${currentSpot()?.name || ''}`, 'info');
    actions.addToLog(`Рыбалка началась: ${water?.name || ''}`);
    game.rafId = requestAnimationFrame(frame);
  };

  game.stop = () => {
    game.running = false;
    cancelAnimationFrame(game.rafId);
  };

  game.setPaused = (v) => {
    game.paused = Boolean(v);
    state.ui.paused = game.paused;
    markChanged();
  };

  // Команды игрока доступны и как свойства, и через события шины (см. wireGame).
  game.actionCast = actionCast;
  game.actionStrike = actionStrike;
  game.actionReel = actionReel;
  game.actionRodUp = actionRodUp;
  game.actionCancel = actionCancel;
  game.finishFight = finishFight;
  game.ctx = () => frameContext(0.016);
  game.tackleStats = tackleStats;

  game.reelInput = 0;
  game.rodUp = false;
  game.pendingKg = 0;

  return game;
}

/** Подключение событий шины: команды игрока приходят из HUD и горячих клавиш. */
export function wireGame(game) {
  bus.on('action:cast', (p) => game.actionCast?.(p?.power01));
  bus.on('action:strike', () => game.actionStrike?.());
  bus.on('action:reel', (p) => game.actionReel?.(p?.value));
  bus.on('action:rodUp', (p) => game.actionRodUp?.(p?.up));
  bus.on('action:cancel', () => game.actionCancel?.());
  bus.on('ui:panel', (p) => game.setPaused?.(Boolean(p?.name)));
  return game;
}

export default createGame;
