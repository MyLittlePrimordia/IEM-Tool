// Theme backdrop rasteriser for the review-card export.
//
// Main-process module. Kept out of app/js/ on purpose: scripts/build-bundle.mjs
// concatenates everything in that directory into the renderer bundle, and this
// needs Node's `path` and Electron's BrowserWindow.
//
// Why it exists: the nine theme backdrops are CSS gradient stacks (--tp over
// --tp-floor) that canvas 2D cannot express. The export used to redraw each
// pattern by hand, and the two copies drifted until the cards showed textures
// the app had stopped using. Rendering the real stylesheet here makes the card
// agree with the app by construction, so there is nothing left to keep in step.
//
// Deliberately narrow: it takes a theme id and two integers and returns a PNG
// data URL. It reads no renderer-supplied path and writes nothing to disk.

const { app, BrowserWindow } = require('electron');
const path = require('path');

// The nine real theme ids. An id outside this set falls back to 'slate' rather
// than reaching the stylesheet with attacker-influenced input.
const THEME_IDS = new Set([
  'slate', 'parchment', 'ember', 'circuit', 'byte', 'cartridge', 'arcade', 'blush', 'bit'
]);

const DEFAULT_W = 1200;
const DEFAULT_H = 800;

// One hidden window is reused across captures, then torn down after a quiet
// period. Creating and destroying a window per capture does not work: the next
// loadFile races the previous window's teardown and fails with ERR_FAILED,
// which looks exactly like a capture failure. Reuse also makes repeat exports
// (a user cycling themes in the export dialog) cost one stylesheet parse
// instead of one each time.
//
// The teardown delay keeps a renderer from sitting resident for the rest of the
// session over a single export.
const IDLE_TEARDOWN_MS = 15000;
let cachedWin = null;
let idleTimer = null;

function destroyCache() {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  if (cachedWin && !cachedWin.isDestroyed()) cachedWin.destroy();
  cachedWin = null;
}

function scheduleTeardown() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(destroyCache, IDLE_TEARDOWN_MS);
  if (idleTimer.unref) idleTimer.unref();   // never hold the process open
}

async function getWindow(w, h) {
  if (cachedWin && !cachedWin.isDestroyed()) {
    const b = cachedWin.getBounds();
    if (b.width !== w || b.height !== h) cachedWin.setBounds({ x: 0, y: 0, width: w, height: h });
    return cachedWin;
  }
  const win = new BrowserWindow({
    width: w,
    height: h,
    show: false,
    frame: false,
    webPreferences: {
      offscreen: false,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.on('closed', () => { if (cachedWin === win) cachedWin = null; });
  cachedWin = win;
  return win;
}

if (app && typeof app.on === 'function') app.on('will-quit', destroyCache);

// Clamped because the result crosses IPC as a base64 data URL; an unbounded
// request would be a trivial way to make the main process allocate a huge string.
const clampSize = (v, fallback, lo, hi) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
};

/**
 * Render one theme's backdrop and return it as a PNG data URL, or null if the
 * capture could not be produced. Callers must treat null as "draw a plain
 * themed surface" rather than as a reason to leave the card blank.
 */
async function captureThemeBackdrop(themeId, width, height) {
  const theme = THEME_IDS.has(themeId) ? themeId : 'slate';
  const w = clampSize(width, DEFAULT_W, 320, 2400);
  const h = clampSize(height, DEFAULT_H, 240, 1600);

  try {
    const win = await getWindow(w, h);
    // loadFile with a changed query performs a real reload - which is required
    // here, because the page sets its theme class in a head script. A
    // same-document navigation would leave the previous theme in place.
    await win.loadFile(path.join(__dirname, 'app', 'export-backdrop.html'), { search: 'theme=' + theme });
    // A hidden window still has to parse the stylesheet and lay the background
    // out before there is anything to photograph; capturing sooner yields a
    // blank or half-painted backdrop.
    await new Promise(r => setTimeout(r, 300));
    const image = await win.webContents.capturePage();
    if (!image || image.isEmpty()) return null;
    return 'data:image/png;base64,' + image.toPNG().toString('base64');
  } catch (err) {
    console.error('captureThemeBackdrop failed:', err);
    return null;
  } finally {
    scheduleTeardown();
  }
}

module.exports = { captureThemeBackdrop, THEME_IDS, DEFAULT_W, DEFAULT_H, _destroyCache: destroyCache };