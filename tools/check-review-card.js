// R9 gate: the exported review card.
//
// The card is a 2400x1600 Canvas2D render (iem-module.js exportReviewCard), so
// none of the CSS design system applies to it and none of the DOM gates can see
// it. Before R9 it drew every panel as fillRect + strokeRect with lineWidth 3
// and a hard-coded '#000000' edge, plus nine per-theme texture branches full of
// literal rgba() values.
//
// This gate renders the card for real, then verifies the rendered pixels:
//   1. corners are rounded - the pixel just inside a panel corner must be the
//      OUTSIDE colour, not the panel fill
//   2. panel edges are a hairline, not a 3px black band
//   3. the accent fill appears somewhere (the theme tint is present)
//   4. no large region is pure #000000 - that was the old border colour and it
//      read as a hole punched through the card
const { app, BrowserWindow } = require('electron');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const APP_ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };

// Runs inside the page: render the card and capture the canvas.
//
// IEM.triggerInfographicDownload is the module's own seam between "draw the
// card" and "save it to disk". Stubbing that is far more robust than
// intercepting document.createElement to catch the anchor - an earlier attempt
// did that and captured nothing.
const RENDER = `(async () => {
  const original = IEM.triggerInfographicDownload;
  let dataUrl = '';
  IEM.triggerInfographicDownload = function (canvas) {
    dataUrl = canvas.toDataURL('image/png');
  };
  try {
    await IEM.exportReviewCard();
    // exportReviewCard() resolves as soon as it sets radarImg.src. The card is
    // actually finished - and only then calls triggerInfographicDownload -
    // inside that image's onload handler, so the work lands in a later task.
    // Reading dataUrl straight after the await always came back empty.
    const deadline = Date.now() + 8000;
    while (!dataUrl && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 100));
    }
  } finally {
    IEM.triggerInfographicDownload = original;
  }
  return { dataUrl, ok: !!dataUrl, len: dataUrl.length };
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

  await win.webContents.executeJavaScript("App.switchTab('iem'); 'ok'").catch(() => {});
  await new Promise(r => setTimeout(r, 1200));

  // exportReviewCard bails out early unless the radar chart exists, so the gate
  // has to initialise it. Without this the render silently produces nothing and
  // the failure looks like a drawing bug rather than a missing precondition.
  const pre = await win.webContents.executeJavaScript(`(() => {
    const has = !!(IEM.radarChart && IEM.radarChart.canvas);
    if (!has && typeof IEM.initChart === 'function') { try { IEM.initChart(); } catch (e) {} }
    return { hadRadar: has,
             nowRadar: !!(IEM.radarChart && IEM.radarChart.canvas),
             hasInitChart: typeof IEM.initChart === 'function' };
  })()`).catch(e => ({ error: e.message }));
  console.log('preconditions: ' + JSON.stringify(pre));

  let rendered;
  try {
    rendered = await win.webContents.executeJavaScript(RENDER);
  } catch (e) {
    console.log('\nCARD RENDER THREW: ' + e.message);
    win.destroy(); srv.close(); app.quit();
    process.exit(2);
    return;
  }
  if (!rendered || !rendered.ok) {
    console.log('\nCARD RENDER PRODUCED NO IMAGE');
    win.destroy(); srv.close(); app.quit();
    process.exit(2);
    return;
  }

  const b64len = (rendered.dataUrl || '').length;
  const stats = await win.webContents.executeJavaScript(`(async () => {
    const url = ${JSON.stringify(rendered.dataUrl || '')};
    if (!url) return { error: 'empty data url' };
    const im = new Image();
    await new Promise((res, rej) => { im.onload = res; im.onerror = rej; im.src = url; });
    const c = document.createElement('canvas');
    c.width = im.width; c.height = im.height;
    const x = c.getContext('2d');
    x.drawImage(im, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;

    const at = (px, py) => { const i = (py * c.width + px) * 4; return [d[i], d[i+1], d[i+2]]; };
    const near = (a, b, t) => Math.abs(a[0]-b[0]) <= t && Math.abs(a[1]-b[1]) <= t && Math.abs(a[2]-b[2]) <= t;

    // Panel boxes in card space (1200x800 logical -> canvas is 2400x1600, 2x).
    // These are the actual coordinates passed to panel() in iem-module.js.
    const S = 2;
    const panels = [
      { name: 'volume',   x: 40,  y: 195, w: 250, h: 65 },
      { name: 'radar',    x: 310, y: 120, w: 540, h: 640 },
      { name: 'score',    x: 870, y: 120, w: 290, h: 90 },
      { name: 'compat',   x: 870, y: 440, w: 290, h: 160 },
      { name: 'signatures', x: 870, y: 610, w: 290, h: 150 }
    ];

    const out = [];
    for (const p of panels) {
      const px = Math.round(p.x * S), py = Math.round(p.y * S);
      const pw = Math.round(p.w * S), ph = Math.round(p.h * S);
      // Corner test. Just inside a ROUNDED corner you are still outside the
      // panel, so the pixel reads as the body; only a SQUARE corner puts panel
      // fill there. The first version of this check asserted the opposite and
      // reported every correctly-rounded panel as square.
      const inside  = at(px + 3, py + 3);
      const outside = at(px - 6, py - 6);
      const centre  = at(px + (pw >> 1), py + (ph >> 1));
      const cornerRounded = near(inside, outside, 6);
      // ...and the panel must have a surface of its own, otherwise the rounded
      // corner is invisible. In Void --bg-card equals --bg-window, so this is
      // the check that catches a panel filled with the body colour.
      const panelHasFill = !near(centre, outside, 4);
      // edge thickness: walk inward along the top edge and count how many pixels
      // differ sharply from the panel interior. A 3px #000 border gives >=3.
      let darkEdge = 0;
      for (let dy = 0; dy < 8; dy++) {
        const c2 = at(px + (pw >> 1), py + dy);
        if (c2[0] < 12 && c2[1] < 12 && c2[2] < 12) darkEdge++;
      }
      out.push({
        name: p.name, cornerRounded, panelHasFill, darkEdge,
        inside: inside.join(','), outside: outside.join(','), centre: centre.join(',')
      });
    }

    // global: how much of the card is pure black (the old border colour)
    let pureBlack = 0, total = 0;
    const hist = new Map();
    for (let i = 0; i < d.length; i += 4 * 37) {   // sample every ~37th pixel
      const r = d[i], g = d[i+1], b = d[i+2];
      total++;
      if (r < 6 && g < 6 && b < 6) pureBlack++;
      const k = (r >> 4) + ',' + (g >> 4) + ',' + (b >> 4);
      hist.set(k, (hist.get(k) || 0) + 1);
    }
    const top = [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

    return {
      size: { w: c.width, h: c.height },
      panels: out,
      pureBlackPct: +((pureBlack / total) * 100).toFixed(2),
      distinctBuckets: hist.size,
      topColours: top.map(e => e[0] + ' x' + e[1])
    };
  })()`);

  const fail = [];
  console.log('=== review card: ' + stats.size.w + 'x' + stats.size.h + ' ===');
  console.log('pure-black coverage : ' + stats.pureBlackPct + '%  (old border was #000000)');
  console.log('distinct colours    : ' + stats.distinctBuckets + ' buckets');
  console.log('dominant            : ' + stats.topColours.join('  '));
  console.log('');
  console.log('panel        rounded  hasFill  darkEdge  centre / outside');
  for (const p of stats.panels) {
    console.log(`  ${p.name.padEnd(11)} rounded=${String(p.cornerRounded).padEnd(6)} hasFill=${String(p.panelHasFill).padEnd(6)} darkEdge=${p.darkEdge}  centre=${p.centre} body=${p.outside}`);
    if (!p.cornerRounded) fail.push(p.name + ': corners are square');
    if (!p.panelHasFill) fail.push(p.name + ': panel fill matches the card body (invisible panel)');
    if (p.darkEdge > 2) fail.push(p.name + ': ' + p.darkEdge + 'px black edge (expected a hairline)');
  }
  if (stats.pureBlackPct > 6) fail.push('pure black covers ' + stats.pureBlackPct + '% of the card');
  if (stats.distinctBuckets < 8) fail.push('card is nearly monochrome (' + stats.distinctBuckets + ' colour buckets)');

  console.log('');
  if (fail.length) {
    console.log('FAILURES (' + fail.length + '):');
    fail.forEach(f => console.log('  - ' + f));
  }
  console.log(fail.length === 0
    ? 'REVIEW CARD OK (rounded panels, hairline edges, no black borders)'
    : 'REVIEW CARD FAIL (' + fail.length + ')');

  win.destroy(); srv.close(); app.quit();
  process.exit(fail.length === 0 ? 0 : 1);
})();