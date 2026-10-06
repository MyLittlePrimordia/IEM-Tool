// Stepper divider symmetry gate.
//
// A fused stepper is [arrow] [label] [arrow] - the label is flanked by two
// EQUAL targets, so it should carry a hairline on both sides.
//
// It did not. Two rules interacted:
//   * `.stepper > button + button, .stepper > button + div` added border-LEFT
//   * a legacy `div[class*="gap-1.5"].w-full > button:last-child
//     { border-left: none !important }` - written for adjacent arrow pairs with
//     no label between them - stripped the trailing divider
// leaving exactly one divider, on the left. That reads as though the left arrow
// were the primary one, which it is not. It was a rule-interaction accident, not
// a design decision, so nothing guarded it.
//
// This asserts the invariant on every three-part stepper in every pane: arrows
// carry no border, the label carries equal left and right hairlines.
const { app, BrowserWindow } = require('electron');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const APP_ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };

const PANES = ['find', 'eq', 'testlab', 'iem', 'settings'];

const PROBE = `(() => {
  const rows = [];
  for (const wrap of document.querySelectorAll('.stepper')) {
    const kids = [...wrap.children].filter(c => c.tagName === 'BUTTON');
    if (kids.length !== 3) continue;                 // only the arrow/label/arrow shape
    const [a, l, c] = kids;
    const w = (el, side) => parseFloat(getComputedStyle(el)['border' + side + 'Width']) || 0;
    rows.push({
      label: (l.textContent || '').trim().slice(0, 22),
      arrowL: { l: w(a, 'Left'), r: w(a, 'Right') },
      labelB: { l: w(l, 'Left'), r: w(l, 'Right') },
      arrowR: { l: w(c, 'Left'), r: w(c, 'Right') }
    });
  }
  return rows;
})()`;

const REPORT = path.join(os.tmpdir(), 'opencode', 'stepper-divider-report.txt');
const log = (m) => { process.stdout.write('[div] ' + m + '\n'); try { fs.appendFileSync(REPORT, m + '\n'); } catch (e) {} };
try { fs.mkdirSync(path.dirname(REPORT), { recursive: true }); fs.writeFileSync(REPORT, ''); } catch (e) {}

function serve() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      let u = decodeURIComponent(req.url.split('?')[0]);
      if (u === '/') u = '/index.html';
      const f = path.join(APP_ROOT, u);
      if (!f.startsWith(APP_ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    });
    srv.on('error', reject);
    // show:true - a hidden window does not composite and getComputedStyle on
    // layout still works, but capturePage would be stale if we ever add pixels.
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

(async () => {
  await app.whenReady();
  const { srv, port } = await serve();
  const win = new BrowserWindow({
    width: 1600, height: 900, show: true,
    webPreferences: { preload: path.join(APP_ROOT, 'preload.js'), contextIsolation: true, sandbox: false }
  });
  await win.loadURL('http://127.0.0.1:' + port + '/index.html');
  await new Promise(r => setTimeout(r, 2800));

  let checked = 0;
  const bad = [];
  for (const pane of PANES) {
    // Confirm the pane is actually visible before measuring: a hidden pane
    // measures 0x0 and would turn this gate into a no-op.
    const nav = await win.webContents.executeJavaScript(`
      (() => {
        if (typeof App === 'undefined' || !App.switchTab) return { ok: false, why: 'no App.switchTab' };
        App.switchTab('${pane}');
        const el = document.getElementById('pane-${pane}');
        const hidden = !el || el.classList.contains('hidden');
        return { ok: !hidden, why: hidden ? 'pane hidden after switchTab' : '' };
      })()
    `).catch(e => ({ ok: false, why: 'threw: ' + e.message }));
    if (!nav || !nav.ok) { log(pane + ': SKIPPED (' + ((nav && nav.why) || '?') + ')'); continue; }
    await new Promise(r => setTimeout(r, 700));

    const rows = await win.webContents.executeJavaScript(PROBE).catch(() => []);
    for (const r of (rows || [])) {
      checked++;
      const arrowsClean = r.arrowL.l === 0 && r.arrowL.r === 0 && r.arrowR.l === 0 && r.arrowR.r === 0;
      const labelSym = r.labelB.l > 0 && r.labelB.r > 0 && Math.abs(r.labelB.l - r.labelB.r) < 0.01;
      if (!arrowsClean || !labelSym) {
        bad.push(`${pane}/${r.label}: arrows[${r.arrowL.l}/${r.arrowL.r},${r.arrowR.l}/${r.arrowR.r}] label[${r.labelB.l}/${r.labelB.r}]`);
      }
    }
    console.log(`  ${pane.padEnd(9)} ${String((rows || []).length).padStart(2)} three-part steppers`);
  }

  console.log('');
  if (bad.length) {
    console.log('FAILURES (' + bad.length + '):');
    bad.forEach(b => console.log('  - ' + b));
  }
  console.log(`\nchecked ${checked} steppers, ${bad.length} asymmetric`);
  console.log(bad.length === 0
    ? 'DIVIDERS OK (label carries equal hairlines on both sides)'
    : 'DIVIDERS FAIL');

  win.destroy(); srv.close(); app.quit();
  process.exit(bad.length === 0 ? 0 : 1);
})();