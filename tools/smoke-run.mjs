/**
 * smoke-run.mjs — запуск смоука с резолвером `three` → vendor/three.module.js.
 *
 * Регистрация делается через node:module#register, а не через устаревший
 * ключ --experimental-loader: так работает и в Node 20, и в Node 24.
 * Запуск: node tools/smoke-run.mjs
 */
import { register } from 'node:module';

register('./three-resolver.mjs', import.meta.url);

await import('./boot-smoke.mjs');
