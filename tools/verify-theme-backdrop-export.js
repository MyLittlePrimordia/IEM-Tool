// Verify the review-card export can reproduce the nine theme backdrops.
//
// This runs in the Electron MAIN process (tools/verify-*.js boot app.whenReady),
// so it can call the REAL production function from theme-backdrop.js - the same
// one main.js puts behind the theme:capture-backdrop IPC channel. Testing the
// module rather than a re-implementation is the point: a test of a copy would
// pass while the shipped path was broken.
//
// What it asserts:
//   1. each theme renders a NON-FLATTENED backdrop (a pattern is really there)
//   2. all nine are visually DISTINCT from one another
//   3. the capture covers the full card viewport at one consistent scale
//   4. an unknown theme id degrades to the floor instead of failing
//   5. the renderer path is wired: IPC channel, preload bridge, packaging
//
// Run: electron tools/verify-theme-backdrop-export.js
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const APP_ROOT = path.join(__dirname, '..');
const { captureThemeBackdrop, THEME_IDS } = require(path.join(APP_ROOT, 'theme-backdrop.js'));
const THEMES = ['slate', 'parchment', 'ember', 'circuit', 'byte', 'cartridge', 'arcade', 'blush', 'bit'];
const CARD_W = 1200, CARD_H = 800;

app.disableHardwareAcceleration();
setTimeout(() => { console.log('WATCHDOG TIMEOUT'); process.exit(2); }, 180000);

const fails = [];
const check = (name, cond, detail) => {
  if (cond) console.log('  PASS  ' + name + (detail ? ': ' + detail : ''));
  else { console.log('  FAIL  ' + name + (detail ? ': ' + detail : '')); fails.push(name); }
};

// Decode the returned data URL with nativeImage, in the main process. Doing it
// here rather than in a throwaway renderer avoids the whole class of window
// races - and a data: URL cannot be loaded as a top-level document anyway, so
// the obvious approach does not even work.
function analyse(dataUrl) {
  if (!dataUrl) return null;
  const img = nativeImage.createFromDataURL(dataUrl);
  if (!img || img.isEmpty()) return null;
  const size = img.getSize();
  const bmp = img.toBitmap();
  const w = size.width, h = size.height;
  if (!w || !h) return null;

  // 12x12 grayscale signature, averaged per cell.
  const n = 12;
  const cells = new Array(n * n).fill(0);
  const counts = new Array(n * n).fill(0);
  const stride = Math.max(1, Math.floor(Math.min(w, h) / 400));
  for (let y = 0; y < h; y += stride) {
    const cy = Math.min(n - 1, Math.floor(y / h * n));
    for (let x = 0; x < w; x += stride) {
      const cx = Math.min(n - 1, Math.floor(x / w * n));
      const i = (y * w + x) * 4;              // toBitmap is BGRA
      cells[cy * n + cx] += (bmp[i] + bmp[i + 1] + bmp[i + 2]) / 3;
      counts[cy * n + cx]++;
    }
  }
  // A cell with no samples falls back to the grand mean rather than 0/0, so a
  // sparse grid cannot poison every comparison with NaN - that failure mode made
  // a distinctness check pass for the wrong reason once already.
  const total = cells.reduce((a, b) => a + b, 0);
  const grand = total / counts.reduce((a, b) => a + b, 0);
  return { w, h, sig: cells.map((v, i) => Math.round(counts[i] ? v / counts[i] : grand)) };
}

function spread(sig) {
  const mean = sig.reduce((a, b) => a + b, 0) / sig.length;
  return Math.sqrt(sig.reduce((a, b) => a + (b - mean) ** 2, 0) / sig.length);
}

(async () => {
  await app.whenReady();
  const shots = {};

  console.log('\n[1] Every theme captures a real, patterned backdrop');
  for (const t of THEMES) {
    const dataUrl = await captureThemeBackdrop(t, CARD_W, CARD_H);
    check(t + ': capture returned an image', !!dataUrl && dataUrl.startsWith('data:image/png;base64,'),
      dataUrl ? Math.round(dataUrl.length / 1024) + ' KB data URL' : 'null');
    const a = await analyse(dataUrl);
    if (!a) { check(t + ': could be decoded', false); continue; }
    shots[t] = a;
    // The raster must cover the card. Capturing smaller and scaling it up would
    // resample the pattern and break its pitch - the texture would no longer be
    // the theme's texture, just a blurred copy of it. capturePage returns
    // PHYSICAL pixels, so a 1.5x display yields 1800x1200 for a 1200x800
    // viewport; that is fine, and it must be one uniform scale for all nine.
    check(t + ': covers the card viewport',
      a.w >= CARD_W && Math.abs(a.w / a.h - CARD_W / CARD_H) < 0.02, a.w + 'x' + a.h);
    check(t + ': backdrop has visible structure (not a flat fill)',
      spread(a.sig) > 1.2, 'spread ' + spread(a.sig).toFixed(2));
  }

  const scales = Object.keys(shots).map(t => shots[t].w / CARD_W);
  check('every capture uses one uniform scale factor',
    scales.length === THEMES.length && scales.every(s => Math.abs(s - scales[0]) < 0.05),
    scales.length ? 'scale ' + scales[0].toFixed(3) : 'none');

  console.log('\n[2] All nine are visually distinct');
  const clashes = [];
  for (let i = 0; i < THEMES.length; i++) {
    for (let j = i + 1; j < THEMES.length; j++) {
      const a = shots[THEMES[i]], b = shots[THEMES[j]];
      if (!a || !b) continue;
      let diff = 0;
      for (let k = 0; k < a.sig.length; k++) diff += Math.abs(a.sig[k] - b.sig[k]);
      diff /= a.sig.length;
      // `!(diff >= 1)` rather than `diff < 1` so a NaN counts as a failure.
      if (!(diff >= 1.0)) clashes.push(THEMES[i] + ' vs ' + THEMES[j] + ' (mean diff ' + diff.toFixed(2) + ')');
    }
  }
  check('no two themes produce the same backdrop', clashes.length === 0,
    clashes.join('; ') || (Object.keys(shots).length === 9 ? 'all 36 pairs differ' : 'only ' + Object.keys(shots).length + ' captured'));
  check('every signature is real data, not NaN',
    Object.keys(shots).length === THEMES.length && THEMES.every(t => shots[t].sig.every(Number.isFinite)));

  console.log('\n[3] Unknown theme ids degrade instead of failing');
  const bogus = await captureThemeBackdrop('../../etc/passwd', CARD_W, CARD_H);
  const bogusAnalysis = analyse(bogus);
  check('a bogus theme id still yields a usable floor, not a crash',
    !!bogus && !!bogusAnalysis, bogus ? bogusAnalysis.w + 'x' + bogusAnalysis.h : 'null');
  // Compared with a tolerance, not exact equality: the raster contains
  // antialiased gradient edges and a soft radial glow, so two captures of the
  // same theme can differ by a fraction of a level. Exact equality would fail
  // on rounding and tell us nothing.
  let fallbackDiff = Infinity;
  if (bogusAnalysis && shots.slate) {
    const a = shots.slate.sig, b = bogusAnalysis.sig;
    let d = 0;
    for (let k = 0; k < a.length; k++) d += Math.abs(a[k] - b[k]);
    fallbackDiff = d / a.length;
  }
  check('bogus id falls back to slate, it does not invent a theme',
    fallbackDiff < 0.5, 'mean diff from slate ' + fallbackDiff.toFixed(3));
  check('theme id set has exactly the nine real ids', THEME_IDS.size === 9, [...THEME_IDS].join(','));

  console.log('\n[4] The backdrop page resolves the APP\'s real theme tokens');
  // The bug this catches: App.setGlobalTheme applies each theme by writing
  // theme.variables as INLINE custom properties on <html>. The .theme-* blocks
  // in app.css only carry a stale --accent left over from before the accents
  // were retuned. A backdrop page that sets the class alone therefore inherits
  // those stale values, and since --tp is built from
  // `color-mix(... var(--accent) ...)`, the exported card came out slate-blue
  // while the app showed Black as grey.
  const accentWin = new BrowserWindow({
    width: 400, height: 300, show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
  });
  try {
    await accentWin.loadFile(path.join(APP_ROOT, 'app', 'export-backdrop.html'), { search: 'theme=slate' });
    const expected = {};
    for (const t of THEMES) {
      // eslint-disable-next-line no-await-in-loop
      await accentWin.loadFile(path.join(APP_ROOT, 'app', 'export-backdrop.html'), { search: 'theme=' + t });
      // eslint-disable-next-line no-await-in-loop
      await new Promise(r => setTimeout(r, 150));
      // eslint-disable-next-line no-await-in-loop
      expected[t] = await accentWin.webContents.executeJavaScript(
        `getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()`, true);
    }
    // The accents the app actually applies, read from the shared token map the
    // app itself consumes. Not a hand-copied list: a copy is exactly the kind
    // of second source of truth that caused this.
    const tokenSrc = fs.readFileSync(path.join(APP_ROOT, 'app', 'js', 'theme-tokens.js'), 'utf8');
    const want = {};
    const re = /"id":\s*"([a-z]+)"[\s\S]*?"--accent":\s*"(#[0-9A-Fa-f]{6})"/g;
    let m;
    while ((m = re.exec(tokenSrc)) !== null) want[m[1]] = m[2].toUpperCase();

    const wrong = THEMES.filter(t => (want[t] || '').toUpperCase() !== (expected[t] || '').toUpperCase());
    check('the page applies the same --accent the app applies, for all nine',
      wrong.length === 0,
      wrong.length ? wrong.map(t => t + ' got ' + expected[t] + ' want ' + want[t]).join('; ')
                   : THEMES.map(t => t + '=' + expected[t]).join(' '));

    const distinct = new Set(Object.values(expected));
    check('all nine accents are distinct (a grey-everywhere regression is caught here)',
      distinct.size === 9, distinct.size + ' distinct values');
    check('Black is neutral grey, not the stale light blue',
      (expected.slate || '').toUpperCase() === '#A3A3AB', 'slate=' + expected.slate);
  } catch (e) {
    check('token parity check ran', false, 'threw: ' + e.message);
  } finally {
    accentWin.destroy();
  }

  console.log('\n[5] The renderer path is actually wired');
  const mainSrc = fs.readFileSync(path.join(APP_ROOT, 'main.js'), 'utf8');
  const preloadSrc = fs.readFileSync(path.join(APP_ROOT, 'preload.js'), 'utf8');
  const modSrc = fs.readFileSync(path.join(APP_ROOT, 'app', 'js', 'iem-module.js'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'package.json'), 'utf8'));
  const files = pkg.build.files;

  check("main.js handles 'theme:capture-backdrop'",
    /ipcMain\.handle\(\s*['"]theme:capture-backdrop['"]/.test(mainSrc));
  check('main.js requires the real module rather than inlining a copy',
    /require\(['"]\.\/theme-backdrop\.js['"]\)/.test(mainSrc));
  check('preload exposes captureThemeBackdrop over the bridge',
    /captureThemeBackdrop\s*:/.test(preloadSrc) && /theme:capture-backdrop/.test(preloadSrc));
  check('the export calls the bridge and falls back when it cannot',
    /captureThemeBackdrop/.test(modSrc) && /backdropPainted/.test(modSrc));
  check('no hand-drawn pattern helpers survive in the export',
    !/const (squareGrid|dotMatrix|traceGrid)\s*=/.test(modSrc) &&
    !/case 'parchment':\s*checker/.test(modSrc));
  // Packaging: the page and the module must ship or a built app exports blank.
  check('theme-backdrop.js is packaged', files.includes('theme-backdrop.js'));
  check('app/export-backdrop.html is packaged', files.includes('app/export-backdrop.html'));
  check('the backdrop page links the real stylesheet and the shared token map',
    /href=["']css\/app\.css["']/.test(fs.readFileSync(path.join(APP_ROOT, 'app', 'export-backdrop.html'), 'utf8')) &&
    /src=["']js\/theme-tokens\.js["']/.test(fs.readFileSync(path.join(APP_ROOT, 'app', 'export-backdrop.html'), 'utf8')));
  check('the shared token map ships inside app/js/**/*', files.includes('app/js/**/*'));

  console.log('\n[6] End-to-end through the real preload bridge and IPC');
  // The likeliest silent break in this feature is the wiring between the three
  // processes: a typo in the bridge method name, a channel name that does not
  // match on both sides, or a preload that never got the method. None of that is
  // visible to the tests above, which talk to the module directly.
  const { ipcMain } = require('electron');
  ipcMain.handle('theme:capture-backdrop', (_e, payload) =>
    captureThemeBackdrop(payload && payload.themeId, payload && payload.width, payload && payload.height));

  const appWin = new BrowserWindow({
    width: 900, height: 700, show: false,
    webPreferences: {
      preload: path.join(APP_ROOT, 'preload.js'),
      sandbox: true, contextIsolation: true, nodeIntegration: false
    }
  });
  try {
    await appWin.loadFile(path.join(APP_ROOT, 'index.html'));
    const round = await appWin.webContents.executeJavaScript(`(async function(){
      if (!window.appBridge) return { stage: 'no appBridge' };
      if (typeof window.appBridge.captureThemeBackdrop !== 'function') return { stage: 'no bridge method' };
      var url = await window.appBridge.captureThemeBackdrop('circuit', 1200, 800);
      return {
        stage: 'ok',
        isPng: typeof url === 'string' && url.indexOf('data:image/png;base64,') === 0,
        kb: typeof url === 'string' ? Math.round(url.length / 1024) : 0
      };
    })()`, true);
    check('preload exposes the bridge into the sandboxed page',
      round && round.stage === 'ok', JSON.stringify(round));
    check('invoking it over IPC returns a PNG data URL',
      round && round.isPng === true && round.kb > 20, JSON.stringify(round));
  } catch (e) {
    check('bridge round trip completed', false, 'threw: ' + e.message);
  } finally {
    appWin.destroy();
  }

  console.log('\n' + '='.repeat(64));
  if (fails.length) {
    console.log('THEME BACKDROP EXPORT CHECK FAIL - ' + fails.length + ' problem(s):');
    fails.forEach(f => console.log('  - ' + f));
  } else {
    console.log('THEME BACKDROP EXPORT CHECK PASS');
  }
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(3); });