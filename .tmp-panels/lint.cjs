// Статический анализ моих панелей: линт неиспользуемых импортов, TODO, console, длина функций.
const fs = require('fs');
const path = require('path');

const DIR = path.resolve('src/ui/panels');
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.js'));
let problems = 0;

for (const file of files) {
  const src = fs.readFileSync(path.join(DIR, file), 'utf8');
  const used = new Set();
  const imports = [];

  for (const m of src.matchAll(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g)) {
    const names = m[1]
      .split(',')
      .map((s) => s.trim().split(/\s+as\s+/).pop().trim())
      .filter(Boolean);
    const spec = m[2];
    for (const n of names) {
      imports.push({ name: n, spec, index: m.index });
      const re = new RegExp(`\\b${n.replace(/\$/g, '\\$')}\\b`, 'g');
      if ((src.match(re) || []).length > 1) used.add(n);
    }
  }
  const unused = imports.filter((i) => !used.has(i.name));
  if (unused.length) {
    problems += 1;
    console.log(`${file}: неиспользуемые импорты: ${unused.map((u) => u.name).join(', ')}`);
  }

  if (/\bTODO\b|\bFIXME\b|lorem/i.test(src)) {
    problems += 1;
    console.log(`${file}: найдены TODO/FIXME/lorem`);
  }
  if (/console\.(log|debug|info)\(/.test(src)) {
    problems += 1;
    console.log(`${file}: console.* в продакшн-пути`);
  }

  // Длина функций верхнего уровня и методов: грубая оценка по скобкам от `function`/`=> {`.
  const fnStarts = [...src.matchAll(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\([^)]*\)\s*\{/gm)];
  for (const m of fnStarts) {
    let depth = 0;
    let i = m.index + m[0].length - 1;
    let end = i;
    for (; i < src.length; i += 1) {
      const ch = src[i];
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    const lines = src.slice(m.index, end).split('\n').length;
    if (lines > 60) {
      problems += 1;
      console.log(`${file}: функция ${m[1]} — ${lines} строк (>60)`);
    }
  }
  const lineCount = src.split('\n').length;
  if (lineCount > 400) {
    problems += 1;
    console.log(`${file}: ${lineCount} строк (>400)`);
  }
}

const css = fs.readFileSync(path.resolve('styles/panels.css'), 'utf8');
const base = fs.readFileSync(path.resolve('styles/base.css'), 'utf8');
const defined = new Set([...base.matchAll(/--([a-z0-9-]+)\s*:/g)].map((m) => m[1]));
const usedVars = new Set([...css.matchAll(/var\(--([a-z0-9-]+)/g)].map((m) => m[1]));
const missing = [...usedVars].filter((v) => !defined.has(v));
if (missing.length) {
  problems += 1;
  console.log(`panels.css: неизвестные токены: ${missing.join(', ')}`);
}
const openBraces = (css.match(/{/g) || []).length;
const closeBraces = (css.match(/}/g) || []).length;
if (openBraces !== closeBraces) {
  problems += 1;
  console.log('panels.css: несбалансированные скобки');
}
const hardColors = [...css.matchAll(/(?<![\w-])(#[0-9a-fA-F]{3,8})/g)].map((m) => m[1]);
if (hardColors.length) {
  problems += 1;
  console.log(`panels.css: жёсткие цвета: ${hardColors.join(', ')}`);
}

console.log(problems ? `\nПроблем: ${problems}` : '\nПанели: статический анализ чистый.');
process.exit(problems ? 1 : 0);
