// Verifies the nine per-theme backdrops exist, are geometrically distinct, and
// have not compromised OLED black. Also re-checks the earlier items so one run
// covers this batch.
const { app, BrowserWindow } = require('electron');
const http = require('http'); const fs = require('fs'); const path = require('path');
const APP_ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'shots-grid');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };
const THEMES = ['slate', 'parchment', 'ember', 'circuit', 'byte', 'cartridge', 'arcade', 'blush', 'bit'];
function serve() { return new Promise((resolve, reject) => { const srv = http.createServer((req, res) => { let u = decodeURIComponent(req.url.split('?')[0]); if (u === '/') u = '/index.html'; const f = path.join(APP_ROOT, u); if (!f.startsWith(APP_ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); }); srv.on('error', reject); srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port })); }); }
(async () => {
  await app.whenReady();
  fs.mkdirSync(OUT, { recursive: true });
  const { srv, port } = await serve();
  const win = new BrowserWindow({ width: 1500, height: 940, show: true, webPreferences: { preload: path.join(APP_ROOT, 'preload.js'), contextIsolation: true, sandbox: false } });
  await win.loadURL('http://127.0.0.1:' + port + '/index.html');
  await new Promise(r => setTimeout(r, 3200));
  const fail = [];
  const sigs = new Map();

  for (const th of THEMES) {
    await win.webContents.executeJavaScript(`App.setGlobalTheme('${th}'); 'ok'`).catch(e => fail.push(th + ': ' + e.message));
    await new Promise(r => setTimeout(r, 650));
    const d = await win.webContents.executeJavaScript(`(() => {
      const cs = getComputedStyle(document.documentElement);
      const body = getComputedStyle(document.body, '::before');
      return {
        grid: (cs.getPropertyValue('--theme-grid') || '').trim(),
        size: (cs.getPropertyValue('--theme-grid-size') || '').trim(),
        beforeImage: body.backgroundImage,
        beforeOpacity: body.opacity,
        beforeZ: body.zIndex,
        htmlClass: document.documentElement.className,
        bgBody: cs.getPropertyValue('--bg-body').trim()
      };
    })()`).catch(e => ({ error: e.message }));
    if (d.error) { fail.push(th + ': ' + d.error); continue; }
    if (!d.grid || d.grid === 'none') fail.push(th + ': no --theme-grid defined');
    if (d.bgBody !== '#000000') fail.push(th + ': --bg-body is ' + d.bgBody + ', expected #000000');
    if (!d.beforeImage || d.beforeImage === 'none') fail.push(th + ': body::before has no background-image');
    if (!d.htmlClass.includes('theme-' + th)) fail.push(th + ': html class is "' + d.htmlClass + '"');
    if (d.beforeZ !== '-1') fail.push(th + ': overlay z-index is ' + d.beforeZ + ', expected -1');
    sigs.set(th, d.grid);
    console.log(`  ${th.padEnd(10)} class=${d.htmlClass.padEnd(22)} grid=${d.grid.slice(0, 52)}...`);
  }

  // every theme must be geometrically distinct, not nine tints of one grid
  const uniq = new Set(sigs.values());
  console.log(`\n  distinct grid definitions: ${uniq.size} / ${THEMES.length}`);
  if (uniq.size !== THEMES.length) fail.push(`only ${uniq.size} distinct grids for ${THEMES.length} themes`);

  // screenshots of a representative spread
  for (const th of ['slate', 'ember', 'byte', 'arcade']) {
    await win.webContents.executeJavaScript(`App.setGlobalTheme('${th}'); 'ok'`).catch(() => {});
    await new Promise(r => setTimeout(r, 600));
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT, th + '.png'), img.toPNG());
  }
  console.log('  captured slate/ember/byte/arcade');

  console.log('');
  if (fail.length) { console.log('FAILURES (' + fail.length + '):'); fail.forEach(f => console.log('  - ' + f)); }
  console.log(fail.length === 0 ? '\nTHEME GRIDS OK' : '\nTHEME GRIDS FAIL (' + fail.length + ')');
  win.destroy(); srv.close(); app.quit();
  process.exit(fail.length ? 1 : 0);
})();