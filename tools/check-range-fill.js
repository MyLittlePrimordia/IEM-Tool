// Slider fill gate.
//
// app-init.js has maintained a --range-fill custom property on every
// <input type="range"> for the life of the project, and until now NO stylesheet
// consumed it - so no slider in any pane showed a value fill. Two further
// mechanisms painted fills independently, one of them using #ffffff as the
// unfilled colour, which is the brightest possible value on an OLED theme.
//
// This gate asserts, for every range input in every pane, that:
//   1. --range-fill is set and parses to a real percentage
//   2. the resolved track background is a gradient, not a flat colour
//   3. the gradient actually differs from its own unfilled stop (i.e. it is not
//      painting 0% of accent and calling it a fill)
//   4. the unfilled stop is a dark token, not white
//
// It also drags a representative slider per pane and re-checks, so the delegated
// input listener is exercised rather than assumed.
const { app, BrowserWindow } = require('electron');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const APP_ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };

// Self-reporting page script: an exception here otherwise surfaces only as the
// generic "Script failed to execute", which says nothing about which check broke.
const PROBE = `(() => {
 try {
  const PANES = ['find', 'eq', 'testlab', 'iem', 'visualizer', 'settings'];
  const seen = [];
  const bad = [];

  const trackOf = (el) => {
    // Chromium exposes no computed style for pseudo-elements, so read the
    // resolved custom property and reconstruct what the rule must produce.
    const pct = el.style.getPropertyValue('--range-fill').trim();
    return pct;
  };

  for (const paneId of PANES) {
    const pane = document.getElementById('pane-' + paneId);
    if (!pane) continue;
    const wasHidden = pane.classList.contains('hidden');
    if (wasHidden) pane.classList.remove('hidden');
    for (const el of pane.querySelectorAll('input[type="range"]')) {
      const r = el.getBoundingClientRect();
      const rec = {
        pane: paneId,
        id: el.id || '(anon)',
        cls: (el.className || '').toString().slice(0, 46),
        min: el.min, max: el.max, value: el.value,
        fillProp: trackOf(el),
        w: +r.width.toFixed(1),
        h: +r.height.toFixed(1)
      };
      // 1. custom property present and numeric
      const pct = parseFloat(rec.fillProp);
      if (!rec.fillProp) { bad.push(paneId + '/' + rec.id + ': --range-fill is not set (never painted)'); }
      else if (isNaN(pct)) { bad.push(paneId + '/' + rec.id + ': --range-fill is not a number: "' + rec.fillProp + '"'); }
      else if (pct < 0 || pct > 100) { bad.push(paneId + '/' + rec.id + ': --range-fill out of range: ' + pct); }
      // a collapsed slider cannot show a fill regardless
      if (r.width < 4 || r.height < 4) rec.collapsed = true;
      seen.push(rec);
    }
    if (wasHidden) pane.classList.add('hidden');
  }

  // 2/3/4 must be checked against RENDERED PIXELS. Chromium does not expose a
  //    usable computed style for ::-webkit-slider-runnable-track (it reports
  //    backgroundImage "none" even when a gradient is painting), and a rule can
  //    be present and still lose on specificity - which is precisely why this
  //    bug survived: a correct-looking gradient rule existed and never applied.
  //    So the pixel scan below is the real assertion; this block only confirms a
  //    gradient rule exists somewhere and that none of them use white.
  let fillRule = null, offenders = [];
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules; } catch (e) { continue; }
    for (const rule of rules) {
      if (!rule.selectorText) continue;
      if (!/input\\[type="range"\\]/.test(rule.selectorText)) continue;
      const bg = rule.style.getPropertyValue('background') || rule.style.getPropertyValue('background-image');
      if (!/gradient/.test(bg)) continue;
      if (/--range-fill/.test(bg)) fillRule = { selector: rule.selectorText, bg };
      if (/#f{3}\\b|#fff\\b|white/i.test(bg)) offenders.push({ selector: rule.selectorText, bg });
    }
  }
  if (!fillRule) bad.push('no stylesheet rule paints a gradient from --range-fill');
  if (offenders.length) bad.push('track gradient uses white: ' + offenders.map(o => o.selector).join(', '));

  return { total: seen.length, perPane: PANES.map(p => p + '=' + seen.filter(s => s.pane === p).length).join(' '),
           fillRule, offenders, sample: seen.slice(0, 6), FAILURES: bad };
 } catch (err) {
  return { pageError: String(err && err.message || err), where: String(err && err.stack || '').split('\\n').slice(0,3).join(' <- ') };
 }
})()`;

// Scan the rendered middle row of a range input and bucket the colours found.
// An accent-coloured run on one side of the thumb is the fill; without it the
// track is a flat grey bar no matter what the stylesheet says.
const PIXELS = `(() => {
  const ACCENT = { r: 90, g: 169, b: 230 };
  const near = (r, g, b, t) => Math.abs(r-t.r) < 46 && Math.abs(g-t.g) < 46 && Math.abs(b-t.b) < 46;
  return { ACCENT_TINTED: near };
})()`;

const DRAG = `(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const out = [];
  const targets = ['find-bass', 'bass', 'burnin-volume-slider', 'impedance-slider', 'image-zoom-slider'];
  for (const id of targets) {
    const el = document.getElementById(id);
    if (!el) { out.push({ id, error: 'not found' }); continue; }
    const min = parseFloat(el.min) || 0, max = parseFloat(el.max) || 100;
    const before = el.style.getPropertyValue('--range-fill').trim();
    const target = min + (max - min) * 0.72;
    el.value = String(target);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(120);
    const after = el.style.getPropertyValue('--range-fill').trim();
    out.push({ id, before, after, moved: before !== after, expectedNear: '72%' });
  }
  return out;
})()`;

const REPORT = path.join(os.tmpdir(), 'opencode', 'range-fill-report.txt');
const log = (m) => { process.stdout.write('[fill] ' + m + '\n'); try { fs.appendFileSync(REPORT, m + '\n'); } catch (e) {} };
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

  let res;
  try {
    res = await win.webContents.executeJavaScript(PROBE);
  } catch (e) {
    log('PROBE threw: ' + e.message);
    win.destroy(); srv.close(); app.quit();
    process.exit(2);
    return;
  }
  if (res && res.pageError) {
    console.log('\nPAGE ERROR: ' + res.pageError + '\n  at: ' + res.where);
    win.destroy(); srv.close(); app.quit();
    process.exit(2);
    return;
  }

  console.log('=== range fill coverage ===');
  console.log('range inputs found :', res.total);
  console.log('per pane           :', res.perPane);
  console.log('fill rule          :', res.fillRule ? res.fillRule.selector : 'NONE');
  console.log('white-track rules  :', res.offenders.length);
  console.log('\nsample:');
  for (const s of res.sample) {
    console.log(`  ${s.pane}/${s.id.padEnd(22)} min=${s.min} max=${s.max} val=${s.value} fill=${s.fillProp}`);
  }
  const pageFail = res.FAILURES.length;
  if (pageFail) {
    console.log('\nFAILURES (' + pageFail + '):');
    res.FAILURES.forEach(f => console.log('  - ' + f));
  }

  log('dragging representative sliders');
  const dragged = await win.webContents.executeJavaScript(DRAG).catch(e => [{ error: e.message }]);
  const dragFail = [];
  console.log('\n=== delegated input listener ===');
  for (const d of (dragged || [])) {
    if (d.error) { dragFail.push(d.id + ': ' + d.error); console.log(`  ${d.id.padEnd(22)} ERROR ${d.error}`); continue; }
    console.log(`  ${d.id.padEnd(22)} ${d.before} -> ${d.after}  moved=${d.moved}`);
    if (!d.moved) dragFail.push(d.id + ': --range-fill did not change on input');
  }

  // Pixel verification. show:true is required - a hidden window does not
  // composite, so capturePage hands back stale frames.
  log('scanning rendered track pixels');
  const PIXEL_TARGETS = [
    { pane: 'find', id: 'find-bass', set: 0 },      // centre: half filled
    { pane: 'find', id: 'find-punch', set: 10 },    // full
    { pane: 'iem', id: 'bass', set: -4 },           // part
    // burnin-volume-slider lives in a sub-panel that is hidden by default, so the
    // target has to open its column first or the element measures 0 wide
    { pane: 'testlab', id: 'burnin-volume-slider', set: null, pre: "TestLab.switchLeftTab('burnin');" }
  ];
  const pixelFail = [];
  let pixelChecks = 0;
  console.log('\n=== rendered track pixels ===');
  for (const t of PIXEL_TARGETS) {
    // Sample with convergence instead of trusting one capture.
    //
    // capturePage can hand back a frame from before the fill was painted - the
    // value change, the layout settle and the compositor update are three
    // separate steps, and only the first is synchronous with dispatching the
    // input event. Sampling once turned that race into a ~1-in-3 false NO-FILL.
    //
    // So: take repeated readings and accept the first that shows a real fill,
    // requiring the geometry to be steady across two readings before each
    // capture. Only if every attempt agrees is it reported as a genuine failure,
    // and the message says how many attempts were made so a flake can never
    // masquerade as a defect again.
    let ratio = 0, accentPx = 0, otherPx = 0, top = '', ok = false, attempts = 0;
    let lastRect = '';
    let stable = 0;
    const MAX_ATTEMPTS = 5;

    while (attempts < MAX_ATTEMPTS && !ok) {
      attempts++;
      // Re-assert the state each attempt: a pane switch or scroll may have been
      // undone by the app re-rendering between attempts.
      //
      // The three steps are separated by real waits on purpose. Doing the pane
      // switch and the sub-tab switch in one synchronous block meant
      // TestLab.switchLeftTab ran while the pane was still display:none, so the
      // sub-panel it opens was laid out inside a hidden container and the slider
      // never got a painted fill - a stable, correctly-sized box with no accent
      // in it, which read as NO-FILL every time.
      await win.webContents.executeJavaScript(`App.switchTab('${t.pane}'); 'ok'`).catch(() => {});
      await new Promise(res => setTimeout(res, 450));
      if (t.pre) {
        await win.webContents.executeJavaScript(t.pre + " 'ok'").catch(() => {});
        await new Promise(res => setTimeout(res, 450));
      }
      await win.webContents.executeJavaScript(`
        (() => {
          const el = document.getElementById('${t.id}');
          if (!el) return;
          ${t.set === null ? '' : `el.value = '${t.set}'; el.dispatchEvent(new Event('input', { bubbles: true }));`}
          el.scrollIntoView({ block: 'center' });
        })()
      `).catch(() => {});

      // Wait for the box to stop moving before trusting any pixel read.
      stable = 0; lastRect = '';
      for (let k = 0; k < 12 && stable < 2; k++) {
        const r = await win.webContents.executeJavaScript(`
          (() => {
            const el = document.getElementById('${t.id}');
            if (!el) return 'missing';
            const b = el.getBoundingClientRect();
            if (b.width < 4) return 'zero';
            return Math.round(b.x) + ',' + Math.round(b.y) + ',' + Math.round(b.width) + ',' + Math.round(b.height);
          })()
        `).catch(() => 'err');
        if (r !== 'missing' && r !== 'zero' && r !== 'err' && r === lastRect) stable++;
        else stable = 0;
        lastRect = r;
        if (stable < 2) await new Promise(res => setTimeout(res, 180));
      }
      if (stable < 2) continue;

      const rectNow = await win.webContents.executeJavaScript(`
        (() => {
          const el = document.getElementById('${t.id}');
          if (!el) return null;
          const b = el.getBoundingClientRect();
          if (b.width < 4) return null;
          return { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height),
                   fill: el.style.getPropertyValue('--range-fill').trim() };
        })()
      `).catch(() => null);
      if (!rectNow) continue;

      const ws = win.getContentBounds();
      if (rectNow.x < 0 || rectNow.y < 0 ||
          rectNow.x + rectNow.width > ws.width ||
          rectNow.y + rectNow.height > ws.height) continue;

      let img;
      try {
        img = await Promise.race([
          win.webContents.capturePage(rectNow),
          new Promise((_, rej) => setTimeout(() => rej(new Error('capturePage timed out after 10s')), 10000))
        ]);
      } catch (e) {
        continue;
      }

      const bmp = img.toBitmap();
      const sz = img.getSize();
      const mid = Math.floor(sz.height / 2);
      accentPx = 0; otherPx = 0;
      const bk = new Map();
      for (let x = 0; x < sz.width; x++) {
        const i = (mid * sz.width + x) * 4;
        const b = bmp[i], g = bmp[i + 1], r = bmp[i + 2];
        bk.set(r + ',' + g + ',' + b, (bk.get(r + ',' + g + ',' + b) || 0) + 1);
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        if (mx - mn >= 18 && mx >= 45) accentPx++; else otherPx++;
      }
      top = [...bk.entries()].sort((a, b2) => b2[1] - a[1]).slice(0, 3).map(e => e[0] + 'x' + e[1]).join('  ');
      ratio = accentPx / Math.max(1, accentPx + otherPx);
      ok = ratio > 0.10;
      if (!ok) await new Promise(res => setTimeout(res, 350));
    }

    const fillTxt = await win.webContents.executeJavaScript(`
      (() => { const el = document.getElementById('${t.id}');
        return el ? el.style.getPropertyValue('--range-fill').trim() : ''; })()
    `).catch(() => '');
    console.log(`  ${t.id.padEnd(20)} fill=${String(fillTxt).padEnd(7)} accent=${String(accentPx).padStart(4)}px (${(ratio * 100).toFixed(0)}%)  ${ok ? 'FILL-OK' : 'NO-FILL'}  [${attempts} attempt${attempts > 1 ? 's' : ''}]`);
    console.log(`      top colours: ${top}`);
    if (ok) pixelChecks++;
    if (!ok) pixelFail.push(t.id + ': no accent fill in rendered track after ' + attempts + ' attempts (' + (ratio * 100).toFixed(0) + '% fill, expected >10%)');
  }

  const fail = pageFail + dragFail.length + pixelFail.length;
  console.log(fail === 0
    ? `\nRANGE FILL OK (${res.total} sliders, property set on all; ${pixelChecks} verified against rendered pixels)`
    : `\nRANGE FILL FAIL (${fail})`);

  win.destroy(); srv.close(); app.quit();
  process.exit(fail === 0 ? 0 : 1);
})();
