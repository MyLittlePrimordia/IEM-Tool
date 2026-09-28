// Measures the real rendered geometry of both transport bars across widths.
// Verifies which bar is displayed, how tall it actually gets (it declares
// h-[110px] but lives inside a fixed-height h-14 parent, so it can be shrunk),
// whether its rows fit, and whether anything overflows horizontally.
const { app, BrowserWindow } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');
const APP_ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.gz': 'application/gzip' };

const PROBE = `(() => {
  const bar = document.getElementById('global-footer-bar');
  const d = document.getElementById('footer-bar-desktop');
  const m = document.getElementById('footer-bar-mobile');
  const r2 = n => Math.round(n * 10) / 10;
  const info = (el) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return { display: cs.display, w: r2(r.width), h: r2(r.height), scrollW: el.scrollWidth, overflowX: el.scrollWidth - el.clientWidth };
  };
  return {
    vw: window.innerWidth,
    bar: info(bar),
    desktop: info(d),
    mobile: info(m),
    mobileDir: m ? getComputedStyle(m).flexDirection : '(none)',
    mobileCols: m ? getComputedStyle(m).flexWrap : '(none)',
    mobileRowPos: m ? Array.from(m.children).map(c => {
      const r = c.getBoundingClientRect();
      return 'x' + r2(r.x) + ' y' + r2(r.y) + ' ' + r2(r.width) + 'x' + r2(r.height);
    }) : [],
    mobileRows: m ? Array.from(m.children).map(c => ({ cls: (c.className || '').slice(0, 26), h: r2(c.getBoundingClientRect().height) })) : [],
    mobileCtl: ['mobile-music-volume', 'mobile-vol-display', 'mobile-scrub', 'mobile-volIcon'].map(id => {
      const e = document.getElementById(id);
      if (!e) return id + '=missing';
      const r = e.getBoundingClientRect();
      return id + '=' + r2(r.width) + 'x' + r2(r.height) + (r.width < 1 ? '(collapsed)' : '');
    }),
    // Which descendants actually stick out past the footer's own box?
    offenders: m ? Array.from(m.querySelectorAll('*')).map(e => {
      const r = e.getBoundingClientRect();
      const mr = m.getBoundingClientRect();
      return { tag: e.tagName, id: e.id || '', over: r2(r.right - mr.right), w: r2(r.width), y: r2(r.top - mr.top) };
    }).filter(o => o.over > 0.5).sort((a, b) => b.over - a.over).slice(0, 6).map(o => o.tag + '#' + (o.id || '-') + ' right+' + o.over + ' w=' + o.w + ' y=' + o.y) : [],
    trackInfo: (() => { const e = document.getElementById('mobile-track-info'); if (!e) return 'missing'; const r = e.getBoundingClientRect(); return r2(r.width) + 'px wide'; })()
  };
})()`;

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

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const port = await startServer();
  const win = new BrowserWindow({ width: 1400, height: 800, show: true, webPreferences: { backgroundThrottling: false } });
  await win.loadURL(`http://127.0.0.1:${port}/index.html`);
  for (let i = 0; i < 40; i++) {
    if (await win.webContents.executeJavaScript("!!document.getElementById('top-nav-bar')", true).catch(() => false)) break;
    await new Promise(r => setTimeout(r, 500));
  }
  await new Promise(r => setTimeout(r, 2500));

  for (const w of [360, 768, 800, 1023, 1279, 1280, 1400]) {
    win.setSize(w, 760);
    await new Promise(r => setTimeout(r, 700));
    const p = await win.webContents.executeJavaScript(PROBE, true);
    const live = p.desktop.display !== 'none' ? 'DESKTOP' : 'mobile';
    console.log(`\n=== ${w}px -> live bar: ${live} ===`);
    console.log(`   bar      display=${p.bar.display} ${p.bar.w}x${p.bar.h} overflowX=${p.bar.overflowX}`);
    if (live === 'DESKTOP') {
      console.log(`   desktop  ${p.desktop.w}x${p.desktop.h} overflowX=${p.desktop.overflowX}${p.desktop.overflowX > 0 ? '  <-- CLIPPED' : ''}`);
    } else {
      console.log(`   mobile   declared 110px, renders ${p.mobile.h}px  overflowX=${p.mobile.overflowX}${p.mobile.overflowX > 0 ? '  <-- CLIPPED' : ''}`);
      console.log(`   dir=${p.mobileDir} wrap=${p.mobileCols}`);
      console.log(`   rows     ${p.mobileRows.map(r => r.h).join(' / ')}`);
      console.log(`   rowPos   ${p.mobileRowPos.join('   ')}`);
      console.log(`   ctrls    ${p.mobileCtl.join('  ')}`);
      console.log(`   trackInfo ${p.trackInfo}`);
      if (p.offenders.length) {
        console.log('   OVERFLOWING:');
        p.offenders.forEach(o => console.log('     ' + o));
      }
    }
  }
  app.exit(0);
});
setTimeout(() => app.exit(2), 180000);
