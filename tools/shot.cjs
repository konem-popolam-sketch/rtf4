// Headless screenshot helper (uses puppeteer-core shipped with the DSH profile).
// Usage: node tools/shot.cjs <url> <outPng> [width] [height] [waitMs]
const path = require('path');

const PROFILE_MODULES = 'C:/Users/Igor/.dsh/profiles/desktop/node_modules';
const puppeteer = require(path.join(PROFILE_MODULES, 'puppeteer-core'));

(async () => {
  const url = process.argv[2];
  const out = process.argv[3];
  const width = Number(process.argv[4] || 1440);
  const height = Number(process.argv[5] || 900);
  const waitMs = Number(process.argv[6] || 2500);

  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new',
    userDataDir: path.resolve('.chrome-shot-profile'),
    args: [
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-crash-reporter',
      '--no-crashpad',
      '--disable-breakpad',
      '--hide-scrollbars',
      `--window-size=${width},${height}`,
    ],
  });
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console.error: ' + m.text());
  });
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise((r) => setTimeout(r, waitMs));
  await page.screenshot({ path: out });
  console.log('shot ok:', out);
  if (errors.length) console.log('PAGE ERRORS:\n' + errors.join('\n'));
  else console.log('no page errors');
  await browser.close();
})().catch((e) => {
  console.error('SHOT FAILED:', e.message);
  process.exit(1);
});
