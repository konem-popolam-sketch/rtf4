/**
 * Шина событий: единственный способ связать sim/ui/scene без циклических импортов.
 */
const listeners = new Map();

export const bus = {
  on(name, fn) {
    if (typeof fn !== 'function') throw new TypeError('bus.on: fn must be a function');
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(fn);
    return () => bus.off(name, fn);
  },
  off(name, fn) {
    const set = listeners.get(name);
    if (set) set.delete(fn);
  },
  once(name, fn) {
    const off = bus.on(name, (payload) => {
      off();
      fn(payload);
    });
    return off;
  },
  emit(name, payload) {
    const set = listeners.get(name);
    if (!set || set.size === 0) return;
    for (const fn of Array.from(set)) {
      try {
        fn(payload);
      } catch (err) {
        // Слушатель не должен ронять цикл игры.
        if (typeof window !== 'undefined' && window.RTF4_DEBUG) {
          console.error('[bus] listener failed for', name, err);
        }
      }
    }
  },
  clear(name) {
    if (name) listeners.delete(name);
    else listeners.clear();
  },
};

export default bus;
