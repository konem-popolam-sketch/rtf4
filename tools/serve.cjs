// Minimal static file server used for local preview / tunnel testing.
// Usage: node tools/serve.cjs <port> <rootDir>
const http = require('http');
const fs = require('fs');
const path = require('path');

const port = Number(process.argv[2] || 8080);
const root = path.resolve(process.argv[3] || '.');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
};

http
  .createServer((req, res) => {
    let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    if (urlPath.endsWith('/')) urlPath += 'index.html';
    let file = path.join(root, urlPath);
    if (!file.startsWith(root)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    fs.stat(file, (err, st) => {
      if (err || st.isDirectory()) {
        // SPA fallback
        file = path.join(root, 'index.html');
        fs.readFile(file, (e2, buf) => {
          if (e2) {
            res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
            return;
          }
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(buf);
        });
        return;
      }
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, {
        'content-type': MIME[ext] || 'application/octet-stream',
        'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
      });
      fs.createReadStream(file).pipe(res);
    });
  })
  .listen(port, '0.0.0.0', () => {
    console.log(`serving ${root} on http://localhost:${port}`);
  });
