// Проверка панелей: открывает каждую панель на стенде и снимает скриншот.
// node .tmp-panels/shots.cjs [width] [height]
const path = require('path');
const PROFILE_MODULES = 'C:/Users/Igor/.dsh/profiles/desktop/node_modules';
const puppeteer = require(path.join(PROFILE_MODULES, 'puppeteer-core'));

const WIDTH = Number(process.argv[2] || 1280);
const HEIGHT = Number(process.argv[3] || 720);
const PANELS = ['inventory', 'shop', 'map', 'atlas', 'tackle', 'quests', 'settings'];

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new',
    userDataDir: path.resolve('.chrome-panels-profile'),
    args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', `--window-size=${WIDTH},${HEIGHT}`],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console.error: ' + m.text());
  });
  await page.goto('http://127.0.0.1:8093/.tmp-panels/harness.html', { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForFunction('window.__ready === true', { timeout: 15000 });

  for (const name of PANELS) {
    await page.evaluate((n) => window.__panels.open(n), name);
    await new Promise((r) => setTimeout(r, 350));
    const info = await page.evaluate(() => {
      const el = document.querySelector('.pn-container:not([hidden])');
      if (!el) return { visible: false };
      const sheet = el.querySelector('.panel-sheet');
      const r = sheet.getBoundingClientRect();
      return {
        visible: true,
        title: (sheet.querySelector('.panel-sheet__title') || {}).textContent,
        w: Math.round(r.width),
        h: Math.round(r.height),
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        overflowX: el.scrollWidth > el.clientWidth,
        textLen: (sheet.textContent || '').trim().length,
        buttons: sheet.querySelectorAll('button').length,
        bodyScroll: (() => {
          const body = sheet.querySelector('.panel-sheet__body');
          return { sh: body.scrollHeight, ch: body.clientHeight };
        })(),
      };
    });
    console.log(name, JSON.stringify(info));
    await page.screenshot({ path: `.tmp-panels/shot-${name}-${WIDTH}x${HEIGHT}.png` });
  }

  // Клик по вкладке магазина (снасти) — проверка делегирования и таблиц.
  await page.evaluate(() => window.__panels.open('shop'));
  await new Promise((r) => setTimeout(r, 250));
  const shopTab = await page.evaluate(() => {
    const btn = document.querySelector('.pn-container:not([hidden]) [data-tab="tackle"]');
    if (!btn) return false;
    btn.click();
    return true;
  });
  await new Promise((r) => setTimeout(r, 300));
  console.log('shop tackle tab click:', shopTab);
  await page.screenshot({ path: `.tmp-panels/shot-shop-tackle-${WIDTH}x${HEIGHT}.png` });

  // Проверка закрытия по ESC и события ui:panel.
  const closed = await page.evaluate(() => {
    window.__closed = null;
    window.__bus.on('ui:panel', (p) => {
      window.__closed = p;
    });
    return true;
  });
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 250));
  const escState = await page.evaluate(() => ({
    opened: window.__panels.isOpen(),
    event: window.__closed,
    visible: Boolean(document.querySelector('.pn-container:not([hidden])')),
  }));
  console.log('esc close:', closed, JSON.stringify(escState));

  // Продажа рыбы через actions в инвентаре: клик «Продать».
  await page.evaluate(() => window.__panels.open('inventory'));
  await new Promise((r) => setTimeout(r, 250));
  const before = await page.evaluate(() => window.__state.inventory.fish.length);
  await page.evaluate(() => {
    const btn = document.querySelector('.pn-container:not([hidden]) [data-act="sell"]');
    if (btn) btn.click();
  });
  await new Promise((r) => setTimeout(r, 250));
  const after = await page.evaluate(() => ({
    fish: window.__state.inventory.fish.length,
    money: window.__state.player.money,
  }));
  console.log('sell one:', before, '->', JSON.stringify(after));

  console.log(errors.length ? 'PAGE ERRORS:\n' + [...new Set(errors)].join('\n') : 'no page errors');
  await browser.close();
})().catch((e) => {
  console.error('SHOTS FAILED:', e.stack || e.message);
  process.exit(1);
});
