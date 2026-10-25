/**
 * Безопасная обёртка над localStorage: игра должна работать и без него
 * (в приватном режиме Safari localStorage бросает исключения).
 */
const KEY_PREFIX = 'rtf4.';

const memory = new Map();

function backend() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const probe = `${KEY_PREFIX}__probe__`;
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}

const store = backend();

export const storage = {
  available: Boolean(store),

  get(key, fallback = null) {
    const k = KEY_PREFIX + key;
    try {
      const raw = store ? store.getItem(k) : memory.get(k);
      if (raw == null) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  },

  set(key, value) {
    const k = KEY_PREFIX + key;
    try {
      const raw = JSON.stringify(value);
      if (store) store.setItem(k, raw);
      else memory.set(k, raw);
      return true;
    } catch {
      return false;
    }
  },

  remove(key) {
    const k = KEY_PREFIX + key;
    try {
      if (store) store.removeItem(k);
      else memory.delete(k);
    } catch {
      /* ignore */
    }
  },

  clearAll() {
    try {
      if (!store) {
        memory.clear();
        return;
      }
      const doomed = [];
      for (let i = 0; i < store.length; i += 1) {
        const k = store.key(i);
        if (k && k.startsWith(KEY_PREFIX)) doomed.push(k);
      }
      doomed.forEach((k) => store.removeItem(k));
    } catch {
      /* ignore */
    }
  },
};

export default storage;
