// Facade guard for the god-file split. Every public member that existed on
// PEQDB_Module / FindEngine / TestLab_Module / IEM_Module / App before the files
// were carved into fragments (tools/facade-baseline.json) must still exist on
// the live object, with the same kind (function vs data). A split that drops or
// shadows a member fails here instead of in the user's hands.
//
//   npx electron tools/verify-facades.js
const { app, BrowserWindow } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');
const APP_ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.ttf': 'font/ttf', '.mp3': 'audio/mpeg', '.wasm': 'application/wasm', '.gz': 'application/gzip', '.txt': 'text/plain' };
const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, 'facade-baseline.json'), 'utf8'));
function startServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let rel = decodeURIComponent(req.url.split('?')[0]);
      if (rel === '/') rel = '/index.html';
      const fp = path.join(APP_ROOT, path.normalize(rel).replace(/^([/\\])+/, ''));
      fs.readFile(fp, (err, buf) => {
        if (err) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(buf);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv.address().port));
  });
}
let failures = 0;
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const port = await startServer();
  const win = new BrowserWindow({ width: 1300, height: 800, show: true });
  await win.loadURL(`http://127.0.0.1:${port}/index.html`);
  await new Promise(r => setTimeout(r, 6000));
  for (const [mod, members] of Object.entries(baseline)) {
    const missing = await win.webContents.executeJavaScript(`(() => {
      const o = typeof ${mod} !== 'undefined' ? ${mod} : null;
      if (!o) return ['<module missing>'];
      const m = ${JSON.stringify(members)};
      const bad = [];
      for (const [k, kind] of Object.entries(m)) {
        if (!(k in o)) { bad.push(k + ' (missing)'); continue; }
        if (kind === 'function' && typeof o[k] !== 'function') bad.push(k + ' (not a function)');
      }
      return bad;
    })()`, true);
    const ok = missing.length === 0;
    if (!ok) failures++;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${mod}: ${Object.keys(members).length} members${ok ? '' : ' - ' + missing.join(', ')}`);
  }
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} MODULE(S) FAILED`);
  app.exit(failures === 0 ? 0 : 1);
});
setTimeout(() => app.exit(2), 120000);
