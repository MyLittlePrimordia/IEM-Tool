// Functional test for the multi-surface volume control added with the footer
// breakpoint change. There are now three volume sliders (footer, mobile footer,
// modal) plus three % readouts and two mute icons, and EQ.updateMusicVolume is
// meant to be the single funnel that keeps them all in step.
//
//   npx electron tools/verify-volume-sync.js
const { app, BrowserWindow } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');
const APP_ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.gz': 'application/gzip' };

const SNAP = `(() => {
  const g = (id) => document.getElementById(id);
  const v = (id) => { const e = g(id); return e ? e.value : '(missing)'; };
  const t = (id) => { const e = g(id); return e ? e.textContent.trim() : '(missing)'; };
  const vis = (id) => { const e = g(id); if (!e) return 'missing'; const r = e.getBoundingClientRect(); return (r.width > 0 && r.height > 0) ? 'visible' : 'hidden'; };
  return {
    footerSlider: v('eq-musicVolumeSlider'),
    mobileSlider: v('mobile-music-volume'),
    modalSlider: v('modal-volume-slider'),
    footerPct: t('eq-volDisplay'),
    mobilePct: t('mobile-vol-display'),
    modalPct: t('modal-vol-display'),
    footerIcon: t('eq-volIcon'),
    mobileIcon: t('mobile-volIcon'),
    mobileCtlVisible: vis('mobile-music-volume'),
    desktopCtlVisible: vis('eq-musicVolumeSlider')
  };
})()`;

const setSlider = (id, val) => `(() => {
  const el = document.getElementById(${JSON.stringify(id)});
  if (!el) return 'missing';
  el.value = ${JSON.stringify(String(val))};
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return 'ok';
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

let failures = 0;
function check(label, actual, expected) {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: got ${JSON.stringify(actual)}${ok ? '' : `, expected ${JSON.stringify(expected)}`}`);
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const port = await startServer();
  // 900px => below the new xl breakpoint, so the mobile footer is the live one.
  const win = new BrowserWindow({ width: 900, height: 700, show: true, webPreferences: { backgroundThrottling: false } });
  await win.loadURL(`http://127.0.0.1:${port}/index.html`);
  for (let i = 0; i < 40; i++) {
    if (await win.webContents.executeJavaScript("!!document.getElementById('top-nav-bar')", true).catch(() => false)) break;
    await new Promise(r => setTimeout(r, 500));
  }
  await new Promise(r => setTimeout(r, 2500));

  console.log('\n[1] initial state at 900px (mobile footer should be the live surface)');
  let s = await win.webContents.executeJavaScript(SNAP, true);
  console.log('   ' + JSON.stringify(s));
  check('mobile slider is the visible surface', s.mobileCtlVisible, 'visible');
  check('desktop slider is hidden', s.desktopCtlVisible, 'hidden');
  check('desktop bar hidden', await win.webContents.executeJavaScript("getComputedStyle(document.getElementById('footer-bar-desktop')).display", true), 'none');
  check('mobile bar shown', await win.webContents.executeJavaScript("getComputedStyle(document.getElementById('footer-bar-mobile')).display", true), 'flex');
  // The modal's volume controls only exist while the visualizer modal is open,
  // so they are asserted only when present rather than treated as a failure.
  const modalAbsent = s.modalSlider === '(missing)';
  if (modalAbsent) console.log('   (modal volume slider absent - visualizer modal is closed; skipping its assertions)');
  check('footer + mobile sliders agree at boot', s.footerSlider + '/' + s.mobileSlider, '50/50');

  console.log('\n[2] drive the MOBILE slider to 30 -> every present surface must follow');
  await win.webContents.executeJavaScript(setSlider('mobile-music-volume', 30), true);
  await new Promise(r => setTimeout(r, 300));
  s = await win.webContents.executeJavaScript(SNAP, true);
  check('footer slider synced', s.footerSlider, '30');
  check('footer readout', s.footerPct, '30%');
  check('mobile readout', s.mobilePct, '30%');
  if (!modalAbsent) check('modal slider synced', s.modalSlider, '30');
  if (!modalAbsent) check('modal readout', s.modalPct, '30%');

  console.log('\n[3] drive the (hidden) DESKTOP slider to 80 -> mobile must follow');
  await win.webContents.executeJavaScript(setSlider('eq-musicVolumeSlider', 80), true);
  await new Promise(r => setTimeout(r, 300));
  s = await win.webContents.executeJavaScript(SNAP, true);
  check('mobile slider followed', s.mobileSlider, '80');
  check('mobile readout followed', s.mobilePct, '80%');
  if (!modalAbsent) check('modal slider followed', s.modalSlider, '80');

  console.log('\n[4] mute from the MOBILE icon -> everything goes to 0');
  await win.webContents.executeJavaScript("EQ.toggleMute()", true);
  await new Promise(r => setTimeout(r, 300));
  s = await win.webContents.executeJavaScript(SNAP, true);
  check('footer slider muted', s.footerSlider, '0');
  check('mobile slider muted', s.mobileSlider, '0');
  check('mobile readout muted', s.mobilePct, '0%');
  check('footer icon muted', s.footerIcon, '\u{1F507}');
  check('mobile icon muted', s.mobileIcon, '\u{1F507}');

  console.log('\n[5] unmute -> must restore the pre-mute value (80) everywhere');
  await win.webContents.executeJavaScript("EQ.toggleMute()", true);
  await new Promise(r => setTimeout(r, 300));
  s = await win.webContents.executeJavaScript(SNAP, true);
  check('footer slider restored', s.footerSlider, '80');
  check('mobile slider restored', s.mobileSlider, '80');
  check('mobile readout restored', s.mobilePct, '80%');
  check('mobile icon restored', s.mobileIcon, '\u{1F50A}');

  console.log('\n[6] at 1400px the desktop bar is live and the mobile one is hidden');
  win.setSize(1400, 800);
  await new Promise(r => setTimeout(r, 900));
  s = await win.webContents.executeJavaScript(SNAP, true);
  check('desktop slider is visible', s.desktopCtlVisible, 'visible');
  check('mobile slider is hidden', s.mobileCtlVisible, 'hidden');
  check('sliders still agree', s.footerSlider + '/' + s.mobileSlider, '80/80');

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  app.exit(failures === 0 ? 0 : 1);
});
setTimeout(() => app.exit(2), 180000);
