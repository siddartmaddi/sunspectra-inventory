/**
 * Local development server: serves the frontend and runs the real backend (.gs files)
 * against a fake spreadsheet saved in dev/data.json. No Google account needed.
 *
 *   node dev/server.js           start on http://localhost:8787 (access key: dev-key)
 *   node dev/server.js --reset   start over with fresh sample data
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { loadBackend } = require('./fake-apps-script');

const PORT = Number(process.env.PORT) || 8787;
const FRONTEND = path.join(__dirname, '..', 'frontend');
const DATA_FILE = path.join(__dirname, 'data.json');

if (process.argv.includes('--reset') && fs.existsSync(DATA_FILE)) fs.unlinkSync(DATA_FILE);
const saved = fs.existsSync(DATA_FILE) ? JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) : null;
const backend = loadBackend({ saved });
if (!saved) {
  backend.setup();
  backend.loadSampleData();
}
const save = () => fs.writeFileSync(DATA_FILE, JSON.stringify(backend.__dump()));
save();

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.csv': 'text/csv',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const out = backend.doPost({ postData: { contents: body } });
      save();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(out.getContent());
    });
    return;
  }

  // In development the app talks to this server instead of Google.
  if (url.pathname === '/config.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    res.end("export const API_URL = '/api';\n");
    return;
  }

  let file = path.normalize(path.join(FRONTEND, decodeURIComponent(url.pathname)));
  if (!file.startsWith(FRONTEND)) { res.writeHead(403); res.end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  fs.readFile(file, (err, content) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(content);
  });
}).listen(PORT, () => console.log(`SunSpectra dev server: http://localhost:${PORT}  (access key: dev-key)`));
