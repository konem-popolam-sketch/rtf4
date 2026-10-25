/**
 * live-check.mjs — проверка ОПУБЛИКОВАННОЙ игры, а не локальной копии.
 *
 * Обходит сайт по-настоящему: скачивает index.html, вытаскивает точку входа,
 * дальше рекурсивно идёт по всем статическим и динамическим импортам,
 * по <link rel=stylesheet> и по importmap. Любой 404 или неверный MIME —
 * провал: именно так на проде отваливаются забытые файлы.
 *
 * Запуск: node tools/live-check.mjs [baseUrl]
 * По умолчанию — GitHub Pages проекта.
 */

const BASE = (process.argv[2] || 'https://konem-popolam-sketch.github.io/rtf4').replace(/\/+$/, '');

const problems = [];
const seen = new Set();
const ok = [];
let bytes = 0;

/** Абсолютный URL из относительного пути внутри сайта. */
function abs(href, fromPath) {
  if (/^(https?:)?\/\//i.test(href) || href.startsWith('data:')) return href;
  const baseDir = fromPath ? fromPath.replace(/[^/]*$/, '') : '/';
  const url = new URL(href, `https://x.invalid${baseDir.startsWith('/') ? '' : '/'}${baseDir}`);
  return url.pathname + url.search;
}

const IMPORT_STATIC = /\bfrom\s*['"]([^'"]+)['"]/g;
const IMPORT_BARE = /\bimport\s*['"]([^'"]+)['"]/g;
const IMPORT_DYNAMIC = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const IMPORT_META = /\bimport\.meta\.url\b/g;

function extract(text, re) {
  const out = [];
  let m = re.exec(text);
  while (m) {
    out.push(m[1]);
    m = re.exec(text);
  }
  return out;
}

async function fetchPath(path, expectType) {
  if (seen.has(path)) return null;
  seen.add(path);
  let res;
  try {
    res = await fetch(`${BASE}${path}`, { headers: { 'user-agent': 'rtf4-live-check' } });
  } catch (err) {
    problems.push(`${path} — сетевая ошибка: ${err.message}`);
    return null;
  }
  const type = res.headers.get('content-type') || '';
  if (!res.ok) {
    problems.push(`${path} — HTTP ${res.status}${type ? ` (${type})` : ''}`);
    return null;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  bytes += buf.length;
  if (expectType && !type.includes(expectType)) {
    problems.push(`${path} — MIME «${type}», ожидался ${expectType}`);
  }
  ok.push({ path, status: res.status, type, size: buf.length });
  return { text: buf.toString('utf8'), type };
}

/** Importmap из index.html: голые имена вроде «three» должны указывать на реальный файл. */
function parseImportMap(html) {
  const m = /<script[^>]+type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/i.exec(html);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch (err) {
    problems.push(`importmap не разбирается как JSON: ${err.message}`);
    return null;
  }
}

const JS_EXT = /\.(mjs|js)$/i;

function resolveSpecifier(spec, importMap, fromPath) {
  if (spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('/')) {
    return abs(spec, fromPath);
  }
  if (/^[a-z]+:/i.test(spec)) return null; // внешняя схема — не наша забота
  // Голый спецификатор: ищем в importmap (с учётом завершающего слэша — префиксные карты).
  const imports = (importMap && importMap.imports) || {};
  if (imports[spec]) return abs(imports[spec], '/index.html');
  const prefix = Object.keys(imports)
    .filter((k) => k.endsWith('/') && spec.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  if (prefix) return abs(imports[prefix] + spec.slice(prefix.length), '/index.html');
  problems.push(`${fromPath} — голый импорт «${spec}» не покрыт importmap`);
  return null;
}

async function crawlModule(path, importMap, depth = 0) {
  const got = await fetchPath(path, 'javascript');
  if (!got) return;
  const specs = [
    ...extract(got.text, IMPORT_STATIC),
    ...extract(got.text, IMPORT_BARE),
    ...extract(got.text, IMPORT_DYNAMIC),
  ];
  for (const spec of specs) {
    const target = resolveSpecifier(spec, importMap, path);
    if (!target) continue;
    if (JS_EXT.test(target)) {
      await crawlModule(target, importMap, depth + 1);
    } else {
      // Импорт ассета (css/json) — просто проверяем доступность.
      await fetchPath(target, null);
    }
  }
}

async function main() {
  console.log(`Проверка опубликованного сайта: ${BASE}\n`);

  const index = await fetchPath('/', 'text/html');
  if (!index) {
    console.log('=== live-check: ПРОВАЛ ===');
    console.log(`  • корень сайта недоступен: ${problems.join('; ')}`);
    process.exit(1);
  }

  const html = index.text;
  const importMap = parseImportMap(html);
  if (!importMap) problems.push('в index.html нет importmap — three не разрешится в браузере');
  else if (!importMap.imports || !importMap.imports.three) problems.push('importmap без записи «three»');

  // Точка входа: <script type="module" src="...">.
  const entryRe = /<script[^>]+type=["']module["'][^>]*\bsrc=["']([^"']+)["']/gi;
  const entries = [];
  let m = entryRe.exec(html);
  while (m) {
    entries.push(abs(m[1], '/index.html'));
    m = entryRe.exec(html);
  }
  if (entries.length === 0) problems.push('в index.html нет <script type="module" src> — игра не запустится');

  // Стили.
  const cssRe = /<link[^>]+rel=["']stylesheet["'][^>]*\bhref=["']([^"']+)["']/gi;
  const styles = [];
  m = cssRe.exec(html);
  while (m) {
    styles.push(abs(m[1], '/index.html'));
    m = cssRe.exec(html);
  }

  for (const style of styles) await fetchPath(style, 'text/css');
  for (const entry of entries) await crawlModule(entry, importMap);

  // Иконки/картинки, если объявлены, тоже должны открываться.
  const assetRe = /<(?:img|link)[^>]+(?:href|src)=["']([^"']+\.(?:png|svg|ico|webp|jpg))["']/gi;
  m = assetRe.exec(html);
  while (m) {
    await fetchPath(abs(m[1], '/index.html'), null);
    m = assetRe.exec(html);
  }

  console.log(`Проверено URL: ${ok.length}, суммарно ${(bytes / 1024 / 1024).toFixed(2)} МБ`);
  for (const item of ok.filter((i) => i.size > 100000)) {
    console.log(`  ${String(item.status).padEnd(4)}${(item.size / 1024).toFixed(0).padStart(7)} КБ  ${item.path}`);
  }

  // Дополнительно: живая страница обязана быть именно игрой, а не заглушкой.
  const mustHave = [
    ['id="scene"', 'canvas#scene'],
    ['id="loader"', 'экран загрузки'],
    ['id="btn-start"', 'кнопка «Начать»'],
  ];
  for (const [needle, label] of mustHave) {
    if (!html.includes(needle)) problems.push(`в index.html нет ${label} (${needle})`);
  }

  console.log('');
  if (problems.length === 0) {
    console.log('=== live-check: OK ===');
    console.log('Опубликованная игра отдаёт все файлы: точка входа, three, все модули и стили.');
    process.exit(0);
  }
  console.log(`=== live-check: ПРОВАЛ (${problems.length}) ===`);
  for (const p of problems.slice(0, 20)) console.log(`  • ${p}`);
  process.exit(1);
}

main().catch((err) => {
  console.error('live-check упал:', err);
  process.exit(1);
});
