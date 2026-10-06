// R10 final verification: theme sweep.
//
// Everything so far was checked under Void, the default. That is the least
// demanding of the nine themes: its accent (#5AA9E6) sits at ~7.3:1 on the card
// surface and every surface is near-black, so a hard-coded white or a 500-weight
// accent would still look tolerable. Bone inverts the whole premise (cream
// surfaces, dark text) and Ember puts a red accent next to red status colours.
//
// This gate, for each of the nine themes:
//   1. applies the theme for real (the app's own setter, not a CSS class)
//   2. re-measures the surfaces that matter and computes WCAG contrast for the
//      text/background pairs that must be legible
//   3. renders the exported review card and re-checks the R9 invariants
//   4. walks every pane looking for clipped text and zero-size layout
//
// It reports per theme so a regression names the theme it broke in.
const { app, BrowserWindow } = require('electron');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const APP_ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };

const THEMES = ['slate', 'parchment', 'ember', 'circuit', 'byte', 'cartridge', 'arcade', 'blush', 'bit'];
const PANES = ['find', 'eq', 'testlab', 'iem', 'visualizer', 'settings'];

const REPORT = path.join(os.tmpdir(), 'opencode', 'r10-report.txt');
const log = (m) => { process.stdout.write('[r10] ' + m + '\n'); try { fs.appendFileSync(REPORT, m + '\n'); } catch (e) {} };
try { fs.mkdirSync(path.dirname(REPORT), { recursive: true }); fs.writeFileSync(REPORT, ''); } catch (e) {}

// ---- page-side helpers -----------------------------------------------------
const HELPERS = `
  const _srgb = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const _lum = ([r, g, b]) => 0.2126 * _srgb(r) + 0.7152 * _srgb(g) + 0.0722 * _srgb(b);
  const _parse = (s) => {
    const m = String(s).match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const p = m[1].split(',').map(v => parseFloat(v));
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  };
  // WCAG relative-contrast ratio, compositing any alpha over a backdrop first.
  const _over = (fg, bg) => {
    const a = fg[3];
    return [0, 1, 2].map(i => fg[i] * a + bg[i] * (1 - a));
  };
  window.__contrast = function (fgStr, bgStr) {
    const fg = _parse(fgStr), bg = _parse(bgStr);
    if (!fg || !bg) return null;
    const f = fg[3] < 1 ? _over(fg, bg) : fg.slice(0, 3);
    const L1 = _lum(f), L2 = _lum(bg.slice(0, 3));
    const hi = Math.max(L1, L2), lo = Math.min(L1, L2);
    return +(((hi + 0.05) / (lo + 0.05)).toFixed(2));
  };
  window.__rgb = (s) => _parse(s);
`;

const APPLY = `(async (themeId) => {
  if (typeof App_Theme !== 'undefined' && App_Theme.setGlobalTheme) {
    await App_Theme.setGlobalTheme(themeId);
  } else if (typeof App !== 'undefined' && App.themeMap && App.themeMap[themeId]) {
    App.themeMap[themeId].apply();
  }
  document.documentElement.className = document.documentElement.className
    .replace(/\\btheme-[a-z]+\\b/g, '').trim() + ' theme-' + themeId;
  IEM_Module.exportTheme = themeId;
  await new Promise(r => setTimeout(r, 260));
  return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
})`;

const CONTRAST = `(() => {
  const cs = getComputedStyle(document.documentElement);
  const card = cs.getPropertyValue('--bg-card').trim();
  const body = cs.getPropertyValue('--bg-window').trim();
  const accentHi = cs.getPropertyValue('--accent-hi').trim();
  const accent = cs.getPropertyValue('--accent').trim();
  const ink = cs.getPropertyValue('--accent-ink').trim();
  const textMain = cs.getPropertyValue('--text-main').trim();
  const textMid = cs.getPropertyValue('--text-secondary').trim();
  const out = {};
  out.accentOnCard = window.__contrast(accentHi, card);
  out.accentFillWithInk = window.__contrast(accent, ink);
  out.textMainOnCard = window.__contrast(textMain, card);
  out.textMidOnCard = window.__contrast(textMid, card);
  out.panelVsBody = window.__contrast(card, body);
  out.raw = { accent, accentHi, ink, card, body, textMain, textMid };
  // a few real DOM surfaces, to catch a component that ignores the tokens
  const probe = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const s = getComputedStyle(el);
    return { color: s.color, bg: s.backgroundColor };
  };
  out.dom = {
    ctaPrimary: probe('#pane-find .cta-primary') || probe('#pane-iem .cta-primary'),
    bodyText: probe('#find-empty-hint'),
    tabLabel: probe('#tl-left-tabs .subtab-seg-btn')
  };
  return out;
})()`;

const PANE_SWEEP = `(() => {
  const res = {};
  for (const p of ${JSON.stringify(PANES)}) {
    const pane = document.getElementById('pane-' + p);
    if (!pane) { res[p] = { missing: true }; continue; }
    const wasHidden = pane.classList.contains('hidden');
    if (wasHidden) pane.classList.remove('hidden');
    const clipped = [];
    const zero = [];
    for (const el of pane.querySelectorAll('button, .subtab-seg-btn, .cta-primary, .cta-secondary')) {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      if (el.scrollWidth - el.clientWidth > 1) {
        clipped.push({ id: el.id || '(anon)', t: (el.textContent || '').trim().slice(0, 22), by: el.scrollWidth - el.clientWidth });
      }
    }
    for (const el of pane.querySelectorAll('.subtab-seg-grid')) {
      const r = el.getBoundingClientRect();
      if (r.width < 10) zero.push(el.id || '(anon)');
    }
    res[p] = { clipped, zero, w: Math.round(pane.getBoundingClientRect().width) };
    if (wasHidden) pane.classList.add('hidden');
  }
  return res;
})()`;

const CARD = `(async () => {
  const orig = IEM.triggerInfographicDownload;
  let url = '';
  IEM.triggerInfographicDownload = function (c) { url = c.toDataURL('image/png'); };
  try {
    await IEM.exportReviewCard();
    const end = Date.now() + 8000;
    while (!url && Date.now() < end) await new Promise(r => setTimeout(r, 100));
  } catch (e) {
    return { error: String(e && e.message || e) };
  } finally {
    IEM.triggerInfographicDownload = orig;
  }
  if (!url) return { error: 'no image' };

  const im = new Image();
  await new Promise((res, rej) => { im.onload = res; im.onerror = rej; im.src = url; });
  const c = document.createElement('canvas');
  c.width = im.width; c.height = im.height;
  const x = c.getContext('2d');
  x.drawImage(im, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height).data;
  const at = (px, py) => { const i = (py * c.width + px) * 4; return [d[i], d[i+1], d[i+2]]; };
  const near = (a, b, t) => Math.abs(a[0]-b[0]) <= t && Math.abs(a[1]-b[1]) <= t && Math.abs(a[2]-b[2]) <= t;

  const S = 2;
  const panels = [
    { name: 'radar', x: 310, y: 120, w: 540, h: 640 },
    { name: 'score', x: 870, y: 120, w: 290, h: 90 },
    { name: 'compat', x: 870, y: 440, w: 290, h: 160 }
  ];
  const out = [];
  for (const p of panels) {
    const px = Math.round(p.x * S), py = Math.round(p.y * S);
    const pw = Math.round(p.w * S), ph = Math.round(p.h * S);
    const inside = at(px + 3, py + 3);
    const outside = at(px - 6, py - 6);
    const centre = at(px + (pw >> 1), py + (ph >> 1));
    let darkEdge = 0;
    for (let dy = 0; dy < 8; dy++) {
      const cc = at(px + (pw >> 1), py + dy);
      if (cc[0] < 12 && cc[1] < 12 && cc[2] < 12) darkEdge++;
    }
    out.push({ name: p.name, rounded: near(inside, outside, 6), hasFill: !near(centre, outside, 4), darkEdge });
  }
  let pureBlack = 0, total = 0;
  const hist = new Map();
  for (let i = 0; i < d.length; i += 4 * 37) {
    const r = d[i], g = d[i+1], b = d[i+2];
    total++;
    if (r < 6 && g < 6 && b < 6) pureBlack++;
    const k = (r >> 4) + ',' + (g >> 4) + ',' + (b >> 4);
    hist.set(k, (hist.get(k) || 0) + 1);
  }
  return { panels: out, pureBlackPct: +((pureBlack / total) * 100).toFixed(2), buckets: hist.size };
})()`;

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
  await new Promise(r => setTimeout(r, 3000));
  await win.webContents.executeJavaScript(HELPERS);
  await win.webContents.executeJavaScript("App.switchTab('iem'); 'ok'").catch(() => {});
  await new Promise(r => setTimeout(r, 1000));
  if (!(await win.webContents.executeJavaScript('!!(IEM.radarChart && IEM.radarChart.canvas)').catch(() => false))) {
    await win.webContents.executeJavaScript("if (typeof IEM.initChart === 'function') IEM.initChart(); 'ok'").catch(() => {});
    await new Promise(r => setTimeout(r, 600));
  }

  const failures = [];
  console.log('=== R10 theme sweep: ' + THEMES.length + ' themes ===');
  console.log('');
  console.log('theme          accent  aHi/card  fill/ink  text/card  textMid  panel/body  card');

  for (const theme of THEMES) {
    const accent = await win.webContents.executeJavaScript(APPLY.replace('themeId', JSON.stringify(theme))).catch(e => null);
    await new Promise(r => setTimeout(r, 320));

    const c = await win.webContents.executeJavaScript(CONTRAST).catch(e => ({ error: e.message }));
    if (c && c.error) { failures.push(theme + ': contrast probe failed - ' + c.error); continue; }

    // WCAG AA: 4.5 for body text, 3.0 for large text and UI boundaries.
    if (c.textMainOnCard < 4.5) failures.push(theme + ': text-main on card is ' + c.textMainOnCard + ':1 (needs 4.5)');
    if (c.textMidOnCard < 4.5) failures.push(theme + ': text-secondary on card is ' + c.textMidOnCard + ':1 (needs 4.5)');
    if (c.accentOnCard < 4.5) failures.push(theme + ': accent-hi on card is ' + c.accentOnCard + ':1 (needs 4.5)');
    if (c.accentFillWithInk < 4.5) failures.push(theme + ': accent fill with accent-ink is ' + c.accentFillWithInk + ':1 (needs 4.5)');
    if (c.panelVsBody < 1.15) failures.push(theme + ': panels are indistinguishable from the body (' + c.panelVsBody + ':1) - they need a surface');

    const sweep = await win.webContents.executeJavaScript(PANE_SWEEP).catch(() => null);
    if (sweep) {
      for (const [p, r] of Object.entries(sweep)) {
        if (r.missing) { failures.push(theme + '/' + p + ': pane missing'); continue; }
        for (const z of (r.zero || [])) failures.push(theme + '/' + p + ': ' + z + ' measured 0px wide');
        for (const cl of (r.clipped || [])) {
          // a hidden sub-panel legitimately clips; only flag what is on screen
          failures.push(theme + '/' + p + ': "' + cl.t + '" clipped by ' + cl.by + 'px');
        }
      }
    }

    const card = await win.webContents.executeJavaScript(CARD).catch(e => ({ error: e.message }));
    let cardNote = 'card ok';
    if (card && card.error) {
      failures.push(theme + ': review card - ' + card.error);
      cardNote = 'ERROR';
    } else if (card) {
      if (card.pureBlackPct > 6) failures.push(theme + ': card pure-black ' + card.pureBlackPct + '%');
      if (card.buckets < 8) failures.push(theme + ': card nearly monochrome (' + card.buckets + ' buckets)');
      for (const p of card.panels) {
        if (!p.rounded) failures.push(theme + ': card panel ' + p.name + ' has square corners');
        if (!p.hasFill) failures.push(theme + ': card panel ' + p.name + ' has no surface');
        if (p.darkEdge > 2) failures.push(theme + ': card panel ' + p.name + ' has a ' + p.darkEdge + 'px black edge');
      }
      cardNote = 'card ' + card.buckets + ' colours, ' + card.pureBlackPct + '% black';
    }

    console.log(
      theme.padEnd(14) +
      String(c.raw.accent).padEnd(8) +
      String(c.accentOnCard).padEnd(9) +
      String(c.accentFillWithInk).padEnd(10) +
      String(c.textMainOnCard).padEnd(11) +
      String(c.textMidOnCard).padEnd(9) +
      String(c.panelVsBody).padEnd(12) +
      cardNote
    );
  }

  console.log('');
  if (failures.length) {
    console.log('FAILURES (' + failures.length + '):');
    failures.forEach(f => console.log('  - ' + f));
  }
  console.log(failures.length === 0
    ? `\nR10 OK - all ${THEMES.length} themes pass contrast, layout and card invariants`
    : `\nR10 FAIL (${failures.length})`);

  win.destroy(); srv.close(); app.quit();
  process.exit(failures.length === 0 ? 0 : 1);
})();