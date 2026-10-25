/**
 * three-resolver.mjs — резолвер голого спецификатора `three` для Node.
 *
 * В браузере эту работу делает importmap из index.html. В Node его нет,
 * поэтому для смоук-прогона (tools/boot-smoke.mjs) подставляем тот же самый
 * vendor-файл — так смоук проверяет ровно тот three.js, что поедет в прод.
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'three') {
    return {
      url: new URL('../vendor/three.module.js', import.meta.url).href,
      shortCircuit: true,
      format: 'module',
    };
  }
  if (specifier.startsWith('three/')) {
    const rest = specifier.slice('three/'.length);
    return {
      url: new URL(`../vendor/three-${rest}.js`, import.meta.url).href,
      shortCircuit: true,
      format: 'module',
    };
  }
  return nextResolve(specifier, context);
}
