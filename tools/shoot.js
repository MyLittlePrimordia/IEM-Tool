// Screenshot harness: drives the real app in Electron and writes PNGs. Also
// captures renderer console output so a shot doubles as a functional check.
//
//   npx electron tools/shoot.js <outDir> [shotSpecJson]
//
// shotSpec: [{ name, w, h, wait, js }]  — js runs in the page before capture.
//
// Serves the app itself on an ephemeral port rather than depending on an
// external live-server: live-reload reloads the page between shots, which resets
// the active tab and makes the whole capture sequence non-deterministic.
const { app, BrowserWindow } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const outDir = process.argv[2] || path.join(__dirname, '..', 'shots');
const specPath = process.argv[3];
const APP_ROOT = path.join(__dirname, '..');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.gz': 'application/gzip', '.txt': 'text/plain; charset=utf-8',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac', '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.webp': 'image/webp', '.gif': 'image/gif',
};

function startServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let rel = decodeURIComponent(req.url.split('?')[0]);
      if (rel === '/') rel = '/index.html';
      const fp = path.join(APP_ROOT, path.normalize(rel).replace(/^([/\\])+/, ''));
      if (!fp.startsWith(APP_ROOT)) { res.writeHead(403); return res.end(); }
      fs.readFile(fp, (err, buf) => {
        if (err) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, {
          'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream',
          'Cache-Control': 'no-store',
        });
        res.end(buf);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

const DEFAULT_SHOTS = [
  { name: '01-find-default', w: 1600, h: 900 },
  { name: '02-eq-default', w: 1600, h: 900, js: "App.switchTab('eq')" },
  { name: '03-iem-default', w: 1600, h: 900, js: "App.switchTab('iem')" },
  { name: '04-testlab', w: 1600, h: 900, js: "App.switchTab('testlab')" },
  { name: '06-settings', w: 1600, h: 900, js: "App.switchTab('settings')" },
  { name: '07-eq-narrow-1000', w: 1000, h: 800, js: "App.switchTab('eq')" },
  { name: '08-iem-narrow-800', w: 800, h: 700, js: "App.switchTab('iem')" },
  { name: '09-iem-short-700', w: 1100, h: 700, js: "App.switchTab('iem')" },
  { name: '10-find-min-360', w: 360, h: 640 },
  { name: '12-find-tune', w: 1600, h: 900, js: "App.switchTab('find'); FindEngine.switchRightTab('tune')" },
  { name: '13-find-endgame', w: 1600, h: 900, js: "App.switchTab('find'); FindEngine.switchRightTab('endgame')" },
  { name: '14-eq-advanced', w: 1600, h: 900, js: "App.switchTab('eq'); EQ_Module.setEqSection && EQ_Module.setEqSection('advanced')" },
];

const shots = specPath ? JSON.parse(fs.readFileSync(specPath, 'utf8')) : DEFAULT_SHOTS;
fs.mkdirSync(outDir, { recursive: true });

const logs = [];
const errors = [];

app.disableHardwareAcceleration();

// Hard per-shot timeout. Switching tabs can build the DSP graph, which needs an
// AudioWorklet + an output device; in a headless-ish context that can throw or
// stall, and one bad shot must not take the whole run down.
function withTimeout(p, ms, label) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error('shot timeout ' + label)), ms)),
  ]);
}

async function shoot(win, shot) {
  try {
    await withTimeout((async () => {
      if (shot.js) {
        try { await win.webContents.executeJavaScript(shot.js, true); }
        catch (e) { errors.push(`[${shot.name}] js failed: ${e.message}`); }
      }
      await new Promise((r) => setTimeout(r, shot.wait || 700));
      const img = await win.webContents.capturePage();
      const file = path.join(outDir, shot.name + '.png');
      fs.writeFileSync(file, img.toPNG());
      const size = img.getSize();
      console.log(`SHOT ${shot.name}  ${shot.w}x${shot.h} -> ${size.width}x${size.height}  ${file}`);
    })(), 20000, shot.name);
  } catch (e) {
    errors.push(`[${shot.name}] ${e.message}`);
    console.log(`SHOT ${shot.name}  FAILED: ${e.message}`);
  }
}

app.whenReady().then(async () => {
  const { port } = await startServer();
  const URL_BASE = `http://127.0.0.1:${port}/index.html`;
  console.log('serving ' + APP_ROOT + ' on ' + URL_BASE);
  const win = new BrowserWindow({
    width: shots[0].w || 1600,
    height: shots[0].h || 900,
    show: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false },
  });

  win.webContents.on('console-message', (evt) => {
    const p = (evt && evt.level !== undefined) ? evt : null;
    if (p) logs.push(`[${['debug','info','warn','error'][p.level] || p.level}] ${p.message}`);
  });
  win.webContents.on('render-process-gone', (_e, d) => errors.push('RENDERER GONE: ' + JSON.stringify(d)));
  win.webContents.on('unresponsive', () => errors.push('WINDOW UNRESPONSIVE'));

  console.log('loading ' + URL_BASE);
  await win.loadURL(URL_BASE);

  // Wait for boot to actually finish rather than guessing a fixed delay.
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      const st = await win.webContents.executeJavaScript(
        `(function(){try{
           return { booted: !!(window.App && App.activeTab !== undefined),
                    nav: !!document.getElementById('top-nav-bar'),
                    handlers: document.querySelectorAll('[data-action]').length,
                    db: (typeof PEQDB_Module!=='undefined' && PEQDB_Module.STATE.dataset) ? PEQDB_Module.STATE.dataset.length : -1,
                    debugBanner: !!document.getElementById('debug-error-banner') };
         }catch(e){ return {err:String(e)};}})()`, true);
      if (st && st.nav) { console.log('  app state: ' + JSON.stringify(st)); ready = true; break; }
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log('  booted=' + ready);
  // let the catalogue load settle (bounded)
  await new Promise((r) => setTimeout(r, 3000));

  for (const shot of shots) {
    try { if (shot.w && shot.h) win.setSize(shot.w, shot.h); } catch (_) {}
    await new Promise((r) => setTimeout(r, 350));
    await shoot(win, shot);
  }

  fs.writeFileSync(path.join(outDir, '_console.log'), logs.join('\n'));
  console.log('\n--- renderer console (' + logs.length + ' lines) ---');
  logs.slice(0, 40).forEach((l) => console.log('  ' + l));
  if (errors.length) { console.log('\n--- harness errors ---'); errors.forEach((e) => console.log('  ' + e)); }
  console.log('\nDONE');
  app.exit(0);
});

app.on('window-all-closed', () => app.exit(0));
setTimeout(() => { console.log('TIMEOUT'); app.exit(2); }, 300000);
