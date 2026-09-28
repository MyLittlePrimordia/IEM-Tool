// Static/DOM audit for defect classes that render fine but break silently:
//   - duplicate id attributes (getElementById then returns the first, so a
//     second control with the same id is unreachable)
//   - getElementById / querySelector('#id') in the sources naming an id that
//     does not exist (returns null, then the next line throws)
//   - <img> with a missing or empty src
//   - aria-labelledby / aria-describedby / aria-controls pointing at missing ids
//   - interactive controls with no accessible name
//
//   npx electron tools/audit-dom.js
const { app, BrowserWindow } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');
const APP_ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.gz': 'application/gzip' };

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

  console.log('\n=== 1. duplicate id attributes ===');
  const dupes = await run(`(() => {
    const seen = new Map();
    for (const el of document.querySelectorAll('[id]')) {
      const id = el.id;
      if (!id) continue;
      if (!seen.has(id)) seen.set(id, []);
      seen.get(id).push(el.tagName + (el.className ? '.' + String(el.className).split(' ')[0] : ''));
    }
    return [...seen.entries()].filter(([, v]) => v.length > 1).map(([k, v]) => k + ' x' + v.length + ' [' + v.join(', ') + ']');
  })()`);
  console.log(dupes.length ? dupes.map(d => '  ' + d).join('\n') : '  none');

  console.log('\n=== 2. <img> with a missing or empty src ===');
  const imgs = await run(`(() => {
    const bad = [];
    for (const im of document.querySelectorAll('img')) {
      if (!im.getAttribute('src')) bad.push((im.id || '(no id)') + ' src="' + (im.getAttribute('src') || '') + '"');
    }
    return bad;
  })()`);
  console.log(imgs.length ? imgs.map(d => '  ' + d).join('\n') : '  none');

  console.log('\n=== 3. aria references pointing at ids that do not exist ===');
  const aria = await run(`(() => {
    const ids = new Set([...document.querySelectorAll('[id]')].map(e => e.id));
    const bad = [];
    for (const attr of ['aria-labelledby', 'aria-describedby', 'aria-controls']) {
      for (const el of document.querySelectorAll('[' + attr + ']')) {
        for (const ref of el.getAttribute(attr).split(/\\s+/).filter(Boolean)) {
          if (!ids.has(ref)) bad.push((el.id || el.tagName) + ' ' + attr + '="' + ref + '"');
        }
      }
    }
    return bad;
  })()`);
  console.log(aria.length ? aria.map(d => '  ' + d).join('\n') : '  none');

  console.log('\n=== 4. interactive controls with no accessible name ===');
  const unnamed = await run(`(() => {
    const named = (el) => {
      if (el.getAttribute('aria-label')) return true;
      if (el.getAttribute('aria-labelledby')) return true;
      if (el.getAttribute('title')) return true;
      if (el.tagName === 'INPUT' && el.getAttribute('placeholder')) return true;
      const t = (el.textContent || '').trim();
      if (t) return true;
      if (el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]')) return true;
      if (el.closest('label')) return true;
      if (el.getAttribute('data-action') && el.getAttribute('aria-label')) return true;
      return false;
    };
    const bad = [];
    for (const el of document.querySelectorAll('button, a[href], input:not([type=hidden]), select, [role=button]')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue; // not rendered
      if (!named(el)) bad.push(el.tagName + (el.id ? '#' + el.id : '') + (el.className ? '.' + String(el.className).split(' ')[0] : ''));
    }
    return bad;
  })()`);
  console.log(unnamed.length ? unnamed.slice(0, 25).map(d => '  ' + d).join('\n') : '  none' + (unnamed.length > 25 ? `\n  ... and ${unnamed.length - 25} more` : ''));

  console.log('\n=== 5. getElementById targets that do not exist in the built app ===');
  // Visit every tab and open every modal FIRST, otherwise almost every id that
  // lives inside a closed modal or an inactive pane looks "missing".
  await run(`(async () => {
    for (const t of ['find','eq','iem','testlab','settings','visualizer']) {
      try { App.switchTab(t); } catch (e) {}
      await new Promise(r => setTimeout(r, 350));
    }
    for (const s of ['tune','endgame']) { try { FindEngine.switchRightTab(s); } catch (e) {} await new Promise(r => setTimeout(r, 250)); }
    for (const s of ['tone','ab','hearing']) { try { TestLab.switchRightTab(s); } catch (e) {} await new Promise(r => setTimeout(r, 250)); }
    try { IEM.toggleLibraryModal(); } catch (e) {}
    try { PEQDB_Module.showExportModal(); } catch (e) {}
    try { EQ.showSmartImportModal(); } catch (e) {}
    try { PEQDB_Module.showSmartRFModal(); } catch (e) {}
    await new Promise(r => setTimeout(r, 900));
    return 'visited';
  })()`);
  const missing = await run(`fetch('app/js/app.bundle.js').then(r => r.text()).then(src => {
    const ids = new Set([...document.querySelectorAll('[id]')].map(e => e.id));
    const refs = new Set();
    for (const m of src.matchAll(/getElementById\\(\\s*['"\`]([^'"\`]+)['"\`]\\s*\\)/g)) refs.add(m[1]);
    // Ids built by string concatenation or interpolation at runtime are
    // legitimately absent from the static DOM - skip anything with a template
    // placeholder, and anything assembled from a variable.
    const dynamic = /\\$\\{|\\+\\s*[a-zA-Z_$]/;
    const runtimeCreated = new Set();
    for (const m of src.matchAll(/\\.id\\s*=\\s*['"\`]([^'"\`]+)['"\`]/g)) runtimeCreated.add(m[1]);
    for (const m of src.matchAll(/id\\s*=\\s*['"\`]([^'"\`]*\\$\\{[^'"\`]*)['"\`]/g)) runtimeCreated.add(m[1]);
    return [...refs].filter(id => !ids.has(id) && !runtimeCreated.has(id) && !dynamic.test(id)).sort();
  })`);
  console.log(missing.length ? missing.map(d => '  missing id: ' + d).join('\n') : '  none');
  console.log('  (interpolated ids and ids assigned at runtime are excluded)');

  app.exit(0);
});
setTimeout(() => app.exit(2), 240000);
