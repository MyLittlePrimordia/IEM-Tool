// Verify the 3D Soundstage transport group paints nothing outside its bounds.
// Run: electron tools/verify-seam.js
const { app, BrowserWindow } = require('electron');
const http = require('http'); const fs = require('fs'); const path = require('path');
const APP_ROOT = path.join(__dirname, '..');
const MIME = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.ttf':'font/ttf','.woff2':'font/woff2','.gz':'application/gzip','.mp3':'audio/mpeg' };
function serve() {
  return new Promise((res, rej) => {
    const s = http.createServer((q, r) => {
      let u = decodeURIComponent(q.url.split('?')[0]); if (u === '/') u = '/index.html';
      const f = path.join(APP_ROOT, u);
      if (!f.startsWith(APP_ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
      r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      fs.createReadStream(f).pipe(r);
    });
    s.on('error', rej); s.listen(0, '127.0.0.1', () => res({ s, port: s.address().port }));
  });
}
app.disableHardwareAcceleration();
(async () => {
  await app.whenReady();
  const { s, port } = await serve();
  const win = new BrowserWindow({
    width: 1536, height: 821, show: false, frame: false, backgroundColor: '#000000',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(APP_ROOT, 'preload.js') }
  });
  await win.loadURL(`http://127.0.0.1:${port}/index.html?cb=${Date.now()}`);
  const q = async js => { try { return await win.webContents.executeJavaScript(js, true); } catch (e) { return { ERR: e.message }; } };
  for (let i = 0; i < 60; i++) { if (await q('!!(window.App && window.EQ)') === true) break; await new Promise(r => setTimeout(r, 500)); }
  await new Promise(r => setTimeout(r, 2500));
  await q("App.switchTab('testlab')");
  await new Promise(r => setTimeout(r, 1500));

  const d = await q(`(()=>{
    const wrap = document.querySelector('#tl-controls-spatial > div.btn-clear');
    if (!wrap) return { error: 'no wrapper' };
    const card = document.getElementById('spatial-card');
    const wr = wrap.getBoundingClientRect(), cr = card.getBoundingClientRect();
    const rogue = [];
    [...wrap.children].forEach(c => {
      const b = getComputedStyle(c, '::before');
      if (b.content && b.content !== 'none' && b.position === 'absolute')
        rogue.push((c.id ? '#'+c.id : c.tagName) + ' ::before content=' + b.content + ' left=' + b.left + ' top=' + b.top);
    });
    const seams = [...document.querySelectorAll('#tl-controls-spatial .tl-seam')].map(s => {
      const r = s.getBoundingClientRect(), cs = getComputedStyle(s);
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bg: cs.backgroundColor, img: cs.backgroundImage };
    });
    return {
      wrapperRect: { x: Math.round(wr.x), y: Math.round(wr.y), w: Math.round(wr.width), h: Math.round(wr.height) },
      wrapperPosition: getComputedStyle(wrap).position,
      cardLeft: Math.round(cr.x),
      roguePseudoElements: rogue,
      seamCount: seams.length,
      seams: seams
    };
  })()`);

  console.log('RESULT ' + JSON.stringify(d, null, 1));
  const ok = d && !d.error && d.roguePseudoElements && d.roguePseudoElements.length === 0 && d.seamCount === 2;
  console.log(ok ? 'SEAM CHECK PASS' : 'SEAM CHECK FAIL');
  // capturePage can grab a stale compositor frame right after a tab switch
  await q("document.body.getBoundingClientRect()");
  await new Promise(r => setTimeout(r, 2500));
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(require('os').tmpdir(), 'iem-seam.png'), img.toPNG());
  console.log('activeTab=' + JSON.stringify(await q('(window.App && App.activeTab) || null')));
  win.destroy(); s.close(); app.exit(ok ? 0 : 1);
})();