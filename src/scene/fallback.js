/**
 * src/scene/fallback.js — 2D-живопись вместо WebGL.
 * Используется, когда WebGLRenderer не создался: игра остаётся играбельной,
 * рисуем градиент неба, воду, светило и поплавок-точку на том же canvas.
 */
import { clamp01 } from './palette.js';

/** Заглушка WebGL-рендерера: повторяет поля, которые читает капитан. */
export function makeRendererShim(canvas) {
  return {
    isFallback: true,
    domElement: canvas,
    shadowMap: { enabled: false },
    info: { render: { calls: 0, triangles: 0 }, memory: { geometries: 0, textures: 0 } },
    capabilities: { getMaxAnisotropy: () => 1 },
    setPixelRatio() {},
    setSize() {},
    setClearColor() {},
    render() {},
    clear() {},
    dispose() {},
  };
}

/** Получить 2D-контекст canvas или null, если он недоступен. */
export function get2d(canvas) {
  if (!canvas || typeof canvas.getContext !== 'function') return null;
  try {
    return canvas.getContext('2d');
  } catch (err) {
    return null;
  }
}

/**
 * Художник fallback-режима.
 * -> { paint(sky, view), clear(), ready: boolean }
 */
export function makeFallbackPainter(canvas) {
  const c = get2d(canvas);
  const ready = !!c;

  /** Светило: солнце днём, луна ночью, с мягким гало. */
  function drawSun(c, w, h, horizon, sky, day) {
    const minutes = sky?.minutes ?? 720;
    const cx = w * (0.5 + Math.sin(((minutes - 360) / 1440) * Math.PI * 2) * 0.34);
    const cy = horizon - h * (0.06 + Math.max(0, sky?.elev ?? 0.4) * 0.34);
    const r = h * (day > 0.15 ? 0.045 : 0.032);
    const halo = c.createRadialGradient(cx, cy, 0, cx, cy, r * 4.2);
    halo.addColorStop(0, day > 0.15 ? 'rgba(255,236,190,.55)' : 'rgba(190,210,255,.35)');
    halo.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = halo;
    c.beginPath();
    c.arc(cx, cy, r * 4.2, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = day > 0.15 ? '#fff3d0' : '#e8efff';
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.fill();
    return cx;
  }

  /** Дорожка блика по воде от светила к берегу. */
  function drawGlitter(c, w, h, horizon, cx, sky, day) {
    const minutes = sky?.minutes ?? 720;
    c.globalAlpha = 0.28;
    c.fillStyle = day > 0.15 ? '#ffeec4' : '#c9d8ff';
    for (let i = 0; i < 22; i++) {
      const t = i / 22;
      const y = horizon + (h - horizon) * Math.pow(t, 1.5);
      const spread = 8 + t * 70;
      const wob = Math.sin(minutes * 0.05 + i * 0.9) * 6;
      c.fillRect(cx - spread / 2 + wob, y, spread, 1.4);
    }
    c.globalAlpha = 1;
  }

  /** Силуэт камыша на переднем плане — рамка кадра. */
  function drawReeds(c, w, horizon, day) {
    c.strokeStyle = day > 0.3 ? 'rgba(26,46,30,.85)' : 'rgba(8,18,14,.9)';
    c.lineWidth = 2;
    for (let i = 0; i < 34; i++) {
      const x = (i / 34) * w + Math.sin(i * 3.7) * 12;
      const y0 = horizon + 4;
      const hh = 18 + ((i * 37) % 46);
      c.beginPath();
      c.moveTo(x, y0);
      c.quadraticCurveTo(x + 6, y0 - hh * 0.6, x + 12, y0 - hh);
      c.stroke();
    }
  }

  /** Поплавок и леска — единственный игровой объект, видный и в fallback. */
  function drawBobber(c, w, h, horizon, bobber) {
    if (!bobber) return;
    const bx = w * 0.5 + clamp01((bobber.x + 30) / 60) * w * 0.6 - w * 0.3;
    const by = horizon + (h - horizon) * 0.36 - clamp01((bobber.y || 0) + 0.1) * 14;
    c.fillStyle = '#f2f1ea';
    c.beginPath();
    c.arc(bx, by, 4, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#d0342c';
    c.beginPath();
    c.arc(bx, by - 2.6, 2.6, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = 'rgba(240,248,255,.5)';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(bx, by - 4);
    c.lineTo(bx + w * 0.3, horizon - h * 0.1);
    c.stroke();
  }

  /** Один кадр: небо, вода, светило, блик, камыш и поплавок. */
  function paint(sky, view = {}) {
    if (!ready) return;
    const w = canvas.width || 1280;
    const h = canvas.height || 720;
    const horizon = h * (0.45 + clamp01(view.bob || 0) * 30);
    const day = clamp01(sky?.dayness ?? 1);

    const air = c.createLinearGradient(0, 0, 0, horizon);
    air.addColorStop(0, sky?.top || '#6e9dc6');
    air.addColorStop(0.72, sky?.bottom || '#dbe7ef');
    air.addColorStop(1, sky?.fog || '#b9c6cc');
    c.fillStyle = air;
    c.fillRect(0, 0, w, horizon);

    const water = c.createLinearGradient(0, horizon, 0, h);
    water.addColorStop(0, sky?.fog || '#b9c6cc');
    water.addColorStop(0.18, day > 0.3 ? '#3d6d78' : '#173039');
    water.addColorStop(1, day > 0.3 ? '#16323a' : '#08141b');
    c.fillStyle = water;
    c.fillRect(0, horizon, w, h - horizon);

    const cx = drawSun(c, w, h, horizon, sky, day);
    drawGlitter(c, w, h, horizon, cx, sky, day);

    c.strokeStyle = 'rgba(10,20,24,.35)';
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(0, horizon);
    c.lineTo(w, horizon);
    c.stroke();
    drawReeds(c, w, horizon, day);
    drawBobber(c, w, h, horizon, view.bobber);
  }

  function clear() {
    if (ready) c.clearRect(0, 0, canvas.width, canvas.height);
  }

  return { paint, clear, ready };
}
