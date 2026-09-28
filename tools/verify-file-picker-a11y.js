// Verifies POL-003: the five file-picker controls that were mouse-only are now
// focusable and keyboard-activatable, and that Enter/Space actually reach the
// hidden file input rather than just firing a decorative click.
//
//   npx electron tools/verify-file-picker-a11y.js
const { app, BrowserWindow } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');
const APP_ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.gz': 'application/gzip' };

let failures = 0;
function check(label, actual, expected) {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: got ${JSON.stringify(actual)}${ok ? '' : `, expected ${JSON.stringify(expected)}`}`);
}

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
  const win = new BrowserWindow({ width: 1600, height: 900, show: true });
  await win.loadURL(`http://127.0.0.1:${port}/index.html`);
  for (let i = 0; i < 40; i++) {
    if (await win.webContents.executeJavaScript("!!document.getElementById('top-nav-bar')", true).catch(() => false)) break;
    await new Promise(r => setTimeout(r, 500));
  }
  await new Promise(r => setTimeout(r, 2500));
  const run = (js) => win.webContents.executeJavaScript(js, true);

  const SELECTORS = ['#eq-file-label', '#ab-file-label-a', '#ab-file-label-b', '#smart-import-dropzone'];

  console.log('\n[1] all four id-addressed triggers exist, are focusable, and are announced');
  const meta = await run(`(${JSON.stringify(SELECTORS)}).map(sel => {
    const el = document.querySelector(sel);
    if (!el) return { sel, missing: true };
    return {
      sel,
      role: el.getAttribute('role'),
      tabindex: el.getAttribute('tabindex'),
      marker: el.hasAttribute('data-file-trigger'),
      aria: el.getAttribute('aria-label')
    };
  })`);
  for (const m of meta) {
    check(`${m.sel} role`, m.role, 'button');
    check(`${m.sel} tabindex`, m.tabindex, '0');
    check(`${m.sel} keyboard marker`, m.marker, true);
    check(`${m.sel} has aria-label`, !!m.aria, true);
  }

  console.log('\n[2] the anonymous mobile label is marked up too');
  const mobile = await run(`(() => {
    const input = document.getElementById('eq-file-mobile');
    if (!input) return { missing: true };
    const lab = input.closest('label');
    if (!lab) return { missing: true };
    return { role: lab.getAttribute('role'), tabindex: lab.getAttribute('tabindex'), marker: lab.hasAttribute('data-file-trigger') };
  })()`);
  check('mobile label role', mobile.role, 'button');
  check('mobile label tabindex', mobile.tabindex, '0');
  check('mobile label keyboard marker', mobile.marker, true);

  console.log('\n[3] Enter and Space both activate the trigger');
  // Detect a real click event landing on the file input via a capture-phase
  // listener on document. Two reasons this is the right probe:
  //   - A <label>'s activation behaviour forwards a synthetic click to the
  //     wrapped control internally, so it never goes through the input's
  //     .click() *method* - patching that method records nothing.
  //   - The Smart Import dropzone only binds its own click listener when the
  //     modal is opened, so open it first for that one case.
  const act = await run(`(async () => {
    const expected = {
      '#eq-file-label': 'eq-file',
      '#ab-file-label-a': 'ab-file-a',
      '#ab-file-label-b': 'ab-file-b',
      '#smart-import-dropzone': 'smart-file-input'
    };
    const hit = [];
    const spy = function (e) {
      const t = e.target;
      if (t && t.id && t.type === 'file') hit.push(t.id);
    };
    document.addEventListener('click', spy, true);

    if (EQ.showSmartImportModal) { try { EQ.showSmartImportModal(); } catch (e) {} }
    await new Promise(r => setTimeout(r, 400));

    const rows = [];
    for (const sel of Object.keys(expected)) {
      const el = document.querySelector(sel);
      if (!el) { rows.push({ sel, key: '-', opened: [], prevented: null, missing: true }); continue; }
      for (const key of ['Enter', ' ']) {
        hit.length = 0;
        const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
        el.dispatchEvent(ev);
        rows.push({ sel, key: key === ' ' ? 'Space' : key, opened: hit.slice(), prevented: ev.defaultPrevented });
      }
    }
    document.removeEventListener('click', spy, true);
    return rows;
  })()`);
  for (const r of act) {
    check(`${r.sel} + ${r.key}: click reached the file input`, JSON.stringify(r.opened.length > 0), 'true');
    check(`${r.sel} + ${r.key}: defaultPrevented`, r.prevented, true);
  }

  console.log('\n[4] Tab order reaches the desktop transport picker');
  const focusable = await run(`(() => {
    const el = document.getElementById('eq-file-label');
    if (!el) return 'missing';
    el.focus();
    return document.activeElement === el ? 'focused' : 'activeElement=' + (document.activeElement && document.activeElement.id);
  })()`);
  check('eq-file-label is focusable', focusable, 'focused');

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  app.exit(failures === 0 ? 0 : 1);
});
setTimeout(() => app.exit(2), 180000);
