// Simple downloader used to vendor runtime libraries into the workspace.
// Usage: node tools/fetch-lib.cjs <url> <outFile>
const https = require('https');
const fs = require('fs');
const path = require('path');

function get(url, depth = 0) {
  return new Promise((resolve, reject) => {
    if (depth > 8) return reject(new Error('too many redirects'));
    https
      .get(url, { headers: { 'user-agent': 'node' } }, (res) => {
        const code = res.statusCode || 0;
        if ([301, 302, 303, 307, 308].includes(code) && res.headers.location) {
          res.resume();
          return resolve(get(res.headers.location, depth + 1));
        }
        if (code !== 200) {
          res.resume();
          return reject(new Error('status ' + code + ' for ' + url));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      })
      .on('error', reject);
  });
}

(async () => {
  const url = process.argv[2];
  const out = process.argv[3];
  const buf = await get(url);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, buf);
  console.log('saved', out, buf.length, 'bytes');
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
