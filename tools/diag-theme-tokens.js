// Diagnostic: compare the theme tokens the real app resolves against the ones
// app/export-backdrop.html resolves. If these differ, the exported card cannot
// match the app no matter how correct the capture is.
//
// Run: electron tools/diag-theme-tokens.js
const { app, BrowserWindow } = require('electron');
const http = require('http'); const fs = require('fs');
const path = require('path');
const APP_ROOT = path.join(__dirname, '..');
const THEMES = ['slate', 'parchment', 'ember', 'circuit', 'byte', 'cartridge', 'arcade', 'blush', 'bit'];
const MIME = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.ttf':'font/ttf','.woff2':'font/woff2','.gz':'application/gzip','.mp3':'audio/mpeg','.wasm':'application/wasm','.onnx':'application/octet-stream' };

// index.html must be served over HTTP, not file:// - the app's assets are
// relative and a file:// load of it fails outright.
function serve() {
  return new Promise((res, rej) => {
    const s = http.createServer((q, r) => {
      let u = decodeURIComponent(q.url.split('?')[0]);
      if (u === '/') u = '/index.html';
      const f = path.join(APP_ROOT, u);
      if (!f.startsWith(APP_ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
      r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      fs.createReadStream(f).pipe(r);
    });
    s.on('error', rej);
    s.listen(0, '127.0.0.1', () => res({ s, port: s.address().port }));
  });
}

app.disableHardwareAcceleration();
setTimeout(() => { console.log('WATCHDOG TIMEOUT'); process.exit(2); }, 120000);

const READ = `(function(id){
  document.documentElement.className = 'theme-' + id;
  var cs = getComputedStyle(document.documentElement);
  var probe = document.createElement('div');
  document.body.appendChild(probe);
  var pcs = getComputedStyle(probe);
  var out = {
    accent: cs.getPropertyValue('--accent').trim(),
    accentRgb: cs.getPropertyValue('--accent-rgb').trim(),
    tpFloor: cs.getPropertyValue('--tp-floor').trim(),
    tpDeep: cs.getPropertyValue('--tp-deep').trim(),
    bodyBg: pcs.backgroundColor,
    bodyImg: pcs.backgroundImage.slice(0, 60)
  };
  probe.remove();
  return out;
})`;

(async () => {
  await app.whenReady();
  const { s, port } = await serve();

  const appWin = new BrowserWindow({
    width: 1200, height: 800, show: false,
    webPreferences: { preload: path.join(APP_ROOT, 'preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false }
  });
  await appWin.loadURL(`http://127.0.0.1:${port}/index.html?cb=${Date.now()}`);
  await new Promise(r => setTimeout(r, 1500));
  const liveClass = await appWin.webContents.executeJavaScript('document.documentElement.className', true);
  const stored = await appWin.webContents.executeJavaScript(
    `(function(){ try { return String(localStorage.getItem('settings_theme_id')); } catch(e){ return 'n/a'; } })()`, true);
  console.log('live documentElement.className : ' + JSON.stringify(liveClass));
  console.log('localStorage settings_theme_id  : ' + JSON.stringify(stored));
  const appTokens = {};
  for (const t of THEMES) {
    // Must go through the app's OWN setGlobalTheme. Swapping the class alone
    // leaves the inline custom properties from the previously applied theme in
    // place, so every row reads back as slate - which is what made this
    // diagnostic report eight phantom mismatches on the first run.
    appTokens[t] = await appWin.webContents.executeJavaScript(`(function(id){
      if (window.App && typeof window.App.setGlobalTheme === 'function') {
        window.App.setGlobalTheme(id);
      } else {
        document.documentElement.className = 'theme-' + id;
      }
      var cs = getComputedStyle(document.documentElement);
      return {
        accent: cs.getPropertyValue('--accent').trim(),
        accentRgb: cs.getPropertyValue('--accent-rgb').trim(),
        tpFloor: cs.getPropertyValue('--tp-floor').trim(),
        tpDeep: cs.getPropertyValue('--tp-deep').trim()
      };
    })(${JSON.stringify(t)})`, true);
  }
  // Leave the app on the theme it started with.
  await appWin.webContents.executeJavaScript(`(function(id){ if (window.App && window.App.setGlobalTheme) window.App.setGlobalTheme(id); })(${JSON.stringify(stored && stored !== 'n/a' ? stored : 'slate')})`, true).catch(() => {});


  const bdWin = new BrowserWindow({
    width: 1200, height: 800, show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
  });
  const bdTokens = {};
  for (const t of THEMES) {
    await bdWin.loadFile(path.join(APP_ROOT, 'app', 'export-backdrop.html'), { search: 'theme=' + t });
    await new Promise(r => setTimeout(r, 250));
    bdTokens[t] = await bdWin.webContents.executeJavaScript(`${READ}(${JSON.stringify(t)})`, true);
  }
  bdWin.destroy();

  console.log('\n' + 'theme'.padEnd(11) + 'app --accent'.padEnd(20) + 'backdrop --accent'.padEnd(22) + 'match');
  let mismatches = 0;
  for (const t of THEMES) {
    const a = appTokens[t], b = bdTokens[t];
    const same = a.accent === b.accent && a.accentRgb === b.accentRgb && a.tpDeep === b.tpDeep;
    if (!same) mismatches++;
    console.log(
      '  ' + t.padEnd(12) + a.accent.padEnd(18) + b.accent.padEnd(20) + (same ? 'yes' : 'NO  <<<<'));
  }
  console.log('\nmismatched themes: ' + mismatches + ' of ' + THEMES.length);
  console.log('\nslate detail (the reported case):');
  console.log('  app      ' + JSON.stringify(appTokens.slate, null, 2).split('\n').join('\n  '));
  console.log('  backdrop ' + JSON.stringify(bdTokens.slate, null, 2).split('\n').join('\n  '));
  appWin.destroy();
  s.close();
  process.exit(0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(3); });