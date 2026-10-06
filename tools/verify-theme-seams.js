// Detect visible seams in the per-theme backdrops.
//
// A tiled background is seamless when the pixels either side of a tile boundary
// are indistinguishable from any other adjacent pair. Rather than trusting the
// declared background-size, this measures the RGB step across each layer's OWN
// tile phase and compares it with the step a quarter of a tile away, where
// there is definitionally no boundary. That control is what makes the number
// trustworthy: same signal, same sample count, same geometry, differing only in
// phase, so anything global - the smooth top glow ramp, the pattern's own
// detail, dithering - lands on both sides and cancels.
//
// Two things this has to get right, both learned the hard way:
//
//  1. Measure the EXACT boundary line, not a strip around it. Averaging |delta|
//     across a strip dilutes a 1px hard edge by the strip width while the
//     pattern's own smooth gradients keep contributing, so a strip test reports
//     a real seam as noise.
//  2. Use RGB distance, not luminance. A seam can be a pure hue step - the tile
//     edge changes tint while staying equally dark - and luminance is blind to
//     it.
//
// All UI chrome is hidden so only the backdrop is rasterised, and the theme
// class is re-checked AFTER each capture: the app re-applies its own saved
// theme from localStorage, so an injected class can be reverted mid-run and the
// capture would silently show a different theme than the one measured.
//
// Run: electron tools/verify-theme-seams.js [--only=id,id]
const { app, BrowserWindow } = require('electron');
const http = require('http'); const fs = require('fs'); const path = require('path');
const APP_ROOT = path.join(__dirname, '..');
const MIME = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.ttf':'font/ttf','.woff2':'font/woff2','.gz':'application/gzip','.mp3':'audio/mpeg' };
function serve(){return new Promise((res,rej)=>{const s=http.createServer((q,r)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u==='/')u='/index.html';const f=path.join(APP_ROOT,u);if(!f.startsWith(APP_ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end();}r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(f).pipe(r);});s.on('error',rej);s.listen(0,'127.0.0.1',()=>res({s,port:s.address().port}));});}
app.disableHardwareAcceleration();
setTimeout(()=>{console.log('WATCHDOG TIMEOUT');process.exit(2);},1800000);

const W = 1536, H = 900;
const SEAM_RATIO = 2.5;    // seam step vs the quarter-tile control
const SEAM_FLOOR = 1.0;     // 0-255 units, stops anti-aliasing noise counting
const MIN_P = 12;           // below this a tile is too fine to read as a seam

const lum = (bmp, w, x, y) => { const o = (y * w + x) * 4; return 0.2126*bmp[o+2] + 0.7152*bmp[o+1] + 0.0722*bmp[o]; };
const px  = (bmp, w, x, y) => { const o = (y * w + x) * 4; return [bmp[o+2], bmp[o+1], bmp[o]]; };

function lineAt(bmp, w, h, axis, b, m) {
  let sum = 0, cnt = 0;
  if (axis === 'x') {
    for (let y = m; y < h - m; y++) {
      const A = px(bmp, w, b, y), B = px(bmp, w, b - 1, y);
      sum += (Math.abs(A[0]-B[0]) + Math.abs(A[1]-B[1]) + Math.abs(A[2]-B[2])) / 3; cnt++;
    }
  } else {
    for (let x = m; x < w - m; x++) {
      const A = px(bmp, w, x, b), B = px(bmp, w, x, b - 1);
      sum += (Math.abs(A[0]-B[0]) + Math.abs(A[1]-B[1]) + Math.abs(A[2]-B[2])) / 3; cnt++;
    }
  }
  return cnt ? sum / cnt : 0;
}

function measure(bmp, w, h, axis, P, frac, m) {
  const off = Math.round(P * frac);
  let sum = 0, cnt = 0;
  for (let k = 0; ; k++) {
    const b = Math.round(off + k * P);
    if (b < 3 || b >= (axis === 'x' ? w : h) - 2) break;
    const v = lineAt(bmp, w, h, axis, b, m);
    if (v > 0) { sum += v; cnt++; }
  }
  return cnt >= 2 ? { step: sum / cnt, at: cnt } : null;
}

// A layer tiles with period P starting at ITS OWN background-position offset,
// and these themes offset their layers differently. The composite therefore has
// no single tile origin, so each distinct (period, phase) pair is tested.
function findSeams(bmp, w, h, axis, layers, scale, m) {
  const hits = [], seen = new Set();
  for (const L of layers) {
    const P = Math.round(L.period * scale);
    if (!(P >= MIN_P)) continue;
    const ph = Math.round(((((L.phase % L.period) + L.period) % L.period) * scale)) % P;
    const key = axis + '|' + P + '|' + ph;
    if (seen.has(key)) continue;
    seen.add(key);
    const seam = measure(bmp, w, h, axis, P, ph / P, m);
    if (!seam) continue;
    const ctrl = measure(bmp, w, h, axis, P, (ph + P * 0.25) / P, m) || { step: 0, at: 0 };
    if (seam.step > SEAM_FLOOR && seam.step > ctrl.step * SEAM_RATIO) {
      hits.push({ period: P, phase: ph, step: +seam.step.toFixed(2), ctrl: +ctrl.step.toFixed(2), at: seam.at, axis });
    }
  }
  return hits;
}

(async()=>{ await app.whenReady();
const { s, port } = await serve();
const win = new BrowserWindow({ width: W, height: H, show: false, frame: false, backgroundColor: '#000000',
  webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(APP_ROOT,'preload.js') } });
await win.loadURL(`http://127.0.0.1:${port}/index.html?cb=${Date.now()}`);
const q = async js => { try { return await win.webContents.executeJavaScript(js, true); } catch (e) { return { ERR: e.message }; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
for (let i = 0; i < 80; i++) { if (await q('!!(window.App && window.EQ)') === true) break; await sleep(500); }
await sleep(1500);

const onlyArg = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7);
const only = onlyArg ? onlyArg.split(',') : null;

const ids = await q('(function(){return (window.App&&App.builtInThemes||[]).map(function(t){return t.id;});})()');
// Guard hard: if the bundle failed to boot, App is undefined, ids is [], the
// loop body never runs, and this script would otherwise report a cheerful
// "ALL BACKDROPS SEAMLESS" having measured nothing at all.
if (!Array.isArray(ids) || ids.length === 0) {
  console.log('FATAL: App.builtInThemes is empty - the app did not boot, so NO backdrop was measured.');
  win.destroy(); s.close(); app.exit(1);
}

// Hide chrome. App.setGlobalTheme drives charts and canvases and throws once
// every panel is hidden, so theming happens through localStorage + the app's own
// API, and the style below is re-asserted after each theme change.
const HIDE = `(function(){
  var st = document.getElementById('seam-probe');
  if (!st) { st = document.createElement('style'); st.id = 'seam-probe'; document.head.appendChild(st); }
  st.textContent = 'body>*{display:none !important}#app-window>*{display:none !important}';
  return 1;
})()`;

const clsNow = () => q(`(function(){
  return Array.prototype.slice.call(document.documentElement.classList)
    .filter(function(c){return c.indexOf('theme-')===0;})[0] || '';
})()`);

// Use the app's own theming path so a later self-reapply lands on the SAME
// theme instead of fighting us.
const THEME = id => `(function(){
  try { localStorage.setItem('settings_theme_id', ${JSON.stringify(id)}); } catch (e) {}
  try { App.setGlobalTheme(${JSON.stringify(id)}); return 'app'; } catch (e) { return 'threw: ' + e.message; }
})()`;

console.log('scanning ' + ids.length + ' themes at ' + W + 'x' + H +
            '  (floor ' + SEAM_FLOOR + ', ratio ' + SEAM_RATIO + 'x)\n');

let problems = 0;
for (const id of ids) {
  if (only && !only.includes(id)) continue;

  let bmp = null, iw = 0, ih = 0, geo = null, why = '';
  for (let attempt = 1; attempt <= 4 && !bmp; attempt++) {
    await q(THEME(id));
    await sleep(500);
    if ((await clsNow()) !== 'theme-' + id) { why = 'theme would not apply'; await sleep(400); continue; }
    await q(HIDE);
    await sleep(500);

    const a = await win.webContents.capturePage();
    await sleep(320);
    const b = await win.webContents.capturePage();
    if (!a || !b || !a.getSize().width || a.getSize().width !== b.getSize().width) { why = 'capture size'; await sleep(400); continue; }
    // The app can revert the class between capture and measurement; if it did,
    // the pixels belong to a different theme and must be discarded.
    if ((await clsNow()) !== 'theme-' + id) { why = 'theme reverted mid-capture'; await sleep(400); continue; }

    const bb = b.toBitmap(), w2 = b.getSize().width, h2 = b.getSize().height;
    const ab = a.toBitmap();
    let diff = 0, n = 0, mn = 255, mx = 0;
    for (let y = 40; y < h2 - 40; y += 5) for (let x = 40; x < w2 - 40; x += 5) {
      const o = (y * w2 + x) * 4;
      diff += Math.abs(ab[o] - bb[o]); n++;
      const L = lum(bb, w2, x, y); if (L < mn) mn = L; if (L > mx) mx = L;
    }
    diff /= (n || 1);
    if (diff > 0.75) { why = 'frame not settled'; await sleep(500); continue; }
    if (mx - mn < 1.0) { why = 'blank frame'; await sleep(500); continue; }

    const g = await q(`(function(){
      var cs = getComputedStyle(document.getElementById('app-window'));
      return { size: cs.backgroundSize, pos: cs.backgroundPosition, vw: window.innerWidth };
    })()`);
    if (!g || g.ERR || typeof g.size !== 'string') { why = 'no geometry'; await sleep(400); continue; }

    bmp = bb; iw = w2; ih = h2; geo = g;
  }
  if (!bmp) { console.log(id.padEnd(10) + ' MEASUREMENT FAILED (' + why + ')'); problems++; continue; }

  // Entry 0 of both lists is the glow (100% 100% at 0 0): it never tiles.
  const scale = iw / geo.vw;
  const sizes = String(geo.size).split(/\s*,\s*/).slice(1).map(e => e.trim().split(/\s+/).map(parseFloat));
  const poss  = String(geo.pos ).split(/\s*,\s*/).slice(1).map(e => e.trim().split(/\s+/).map(parseFloat));
  const xL = [], yL = [];
  sizes.forEach((sz, i) => {
    const p = poss[i] || [0, 0];
    if (isFinite(sz[0]) && isFinite(sz[1])) {
      xL.push({ period: sz[0], phase: isFinite(p[0]) ? p[0] : 0 });
      yL.push({ period: sz[1], phase: isFinite(p[1]) ? p[1] : 0 });
    }
  });

  const m = Math.round(Math.min(iw, ih) * 0.02);
  const all = findSeams(bmp, iw, ih, 'x', xL, scale, m).concat(findSeams(bmp, iw, ih, 'y', yL, scale, m));
  const tile = sizes[0] ? sizes[0][0].toFixed(0) + 'x' + sizes[0][1].toFixed(0) : '?';

  if (all.length) {
    problems++;
    console.log(id.padEnd(10) + ' SEAMS  (tile ' + tile + ' css px, ' + sizes.length + ' layers)');
    for (const h of all)
      console.log('    ' + h.axis + '-axis, period ' + String(h.period).padStart(4) +
                  'px phase ' + String(h.phase).padStart(4) + ': step ' +
                  String(h.step).padStart(6) + ' vs control ' + String(h.ctrl).padStart(6) +
                  '  over ' + h.at + ' boundaries');
  } else {
    console.log(id.padEnd(10) + ' seamless   (tile ' + tile + ' css px, ' + sizes.length + ' layers)');
  }
}

console.log(problems === 0 ? '\nALL BACKDROPS SEAMLESS' : '\n' + problems + ' THEME(S) WITH SEAMS');
win.destroy(); s.close(); app.exit(problems === 0 ? 0 : 1);
})();