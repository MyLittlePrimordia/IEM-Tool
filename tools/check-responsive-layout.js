const { app, BrowserWindow } = require('electron');
const http = require('http'); const fs = require('fs'); const path = require('path');
const APP_ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };
const SIZES = [[1229, 691], [1186, 637], [1024, 640], [1600, 900]];
const PANES = {
  find: ['find-col-prefs', 'find-col-results', 'find-col-tools'],
  eq: ['eq-col-db', 'eq-col-graph', 'eq-col-console'],
  iem: ['iem-col-specs', 'iem-col-radar', 'iem-col-sliders'],
  testlab: ['testlab-col-sweeps', 'testlab-col-spatial', 'testlab-col-generators']
};
function serve() {
  return new Promise((res, rej) => {
    const s = http.createServer((q, r) => {
      let u = decodeURIComponent(q.url.split('?')[0]); if (u === '/') u = '/index.html';
      const f = path.join(APP_ROOT, u);
      if (!f.startsWith(APP_ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
      r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(r);
    });
    s.on('error', rej); s.listen(0, '127.0.0.1', () => res({ s, port: s.address().port }));
  });
}
(async () => {
  await app.whenReady();
  const { s, port } = await serve();
  const fail = [];
  for (const [w, h] of SIZES) {
    const win = new BrowserWindow({ width: w, height: h, show: true, webPreferences: { preload: path.join(APP_ROOT, 'preload.js'), contextIsolation: true, sandbox: false } });
    // The stylesheet must be re-read every run. Chromium served a cached
    // app.css, which made every CSS-only edit report byte-identical geometry and
    // looked like "my rules do not apply" when in fact they were never loaded.
    await win.webContents.session.clearCache();
    await win.loadURL('http://127.0.0.1:' + port + '/index.html?cb=' + Date.now());
    await new Promise(r => setTimeout(r, 3200));
    console.log(`=== ${w}x${h} ===`);
    for (const pane of Object.keys(PANES)) {
      await win.webContents.executeJavaScript(`App.switchTab('${pane}'); 'ok'`).catch(() => {});
      await new Promise(r => setTimeout(r, 900));
      const ids = PANES[pane];
      const d = await win.webContents.executeJavaScript(`(() => {
        const pane = ${JSON.stringify(pane)};
        const p = document.getElementById('pane-' + pane);
        const row = p.querySelector('.responsive-row') || p;
        const dir = getComputedStyle(row).flexDirection;
        const cols = ${JSON.stringify(ids)}.map(id => { const e = document.getElementById(id);
          if (!e) return { id: id, missing: true };
          const r = e.getBoundingClientRect();
          return { id: id, w: Math.round(r.width), h: Math.round(r.height) }; });
        const wp = document.querySelector('.workspace-pane').getBoundingClientRect();
        const ft = document.getElementById('global-footer-bar').getBoundingClientRect();
        return { dir: dir, cols: cols, wpBottom: Math.round(wp.bottom), ftTop: Math.round(ft.top) };
      })()`).catch(e => ({ err: e.message }));
      if (d.err) { console.log('  ' + pane + ': ERR ' + d.err); fail.push(`${w}x${h} ${pane}: ${d.err}`); continue; }
      const bad = d.cols.filter(c => c.missing || c.w < 4 || c.h < 4);
      console.log(`  ${pane.padEnd(8)} dir=${d.dir.padEnd(7)} ` + d.cols.map(c => c.missing ? c.id + ':ABSENT' : `${c.id.split('-').pop()}=${c.w}x${c.h}`).join(' '));
      if (d.dir !== 'row') fail.push(`${w}x${h} ${pane}: flex-direction=${d.dir}`);
      if (bad.length) fail.push(`${w}x${h} ${pane}: collapsed ${bad.map(c => c.id).join(',')}`);
      if (d.wpBottom > d.ftTop + 2) fail.push(`${w}x${h} ${pane}: footer overlaps (ws ${d.wpBottom} > ft ${d.ftTop})`);
    }
    win.destroy();
  }
  s.close();
  console.log('');
  if (fail.length) { console.log('FAILURES (' + fail.length + '):'); fail.forEach(f => console.log('  - ' + f)); }
  console.log(fail.length === 0 ? '\nRESPONSIVE LAYOUT OK' : '\nRESPONSIVE LAYOUT FAIL');
  app.quit(); process.exit(fail.length ? 1 : 0);
})();