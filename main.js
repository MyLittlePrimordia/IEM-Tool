const { app, BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');
const { captureThemeBackdrop } = require('./theme-backdrop.js');

// ---------------------------------------------------------------------------
// Portable mode.
//
// When the app is launched as the Windows portable .exe (electron-builder sets
// PORTABLE_EXECUTABLE_DIR) or as a Linux AppImage (APPIMAGE), everything the
// app writes lives in two folders NEXT TO the executable, so the whole thing
// can sit on a USB stick and leaves nothing behind in %APPDATA% / ~/.config:
//
//   IEM-Data/     optional database update (database.json + data/), see below
//   IEM-Profile/  settings, saved reviews, crash.log (Chromium's user-data dir)
//
// If that folder is not writable (read-only media, Program Files) we silently
// fall back to the normal per-user locations. macOS (.dmg) has no portable
// mode: it always uses ~/Library/Application Support/IEM Tool.
// ---------------------------------------------------------------------------
function portableBaseDir() {
  const dir = process.env.PORTABLE_EXECUTABLE_DIR ||
    (process.env.APPIMAGE ? path.dirname(process.env.APPIMAGE) : null);
  if (!dir) return null;
  try { fs.accessSync(dir, fs.constants.W_OK); return dir; } catch (_) { return null; }
}
const PORTABLE_BASE = portableBaseDir();
if (PORTABLE_BASE) {
  try { app.setPath('userData', path.join(PORTABLE_BASE, 'IEM-Profile')); } catch (_) {}
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  // ONNX Runtime Web needs two of these to work at all:
  //  - .wasm MUST be application/wasm. WebAssembly.instantiateStreaming rejects
  //    any other type, and falls back to arrayBuffer only if streaming is
  //    unavailable - which is not something to rely on.
  //  - .mjs is the ES-module glue some ORT builds load lazily.
  // Without them both fall through to application/octet-stream and session
  // creation fails with an opaque MIME error.
  '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.m4b': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wma': 'audio/x-ms-wma',
  '.aiff': 'audio/aiff',
  '.aif': 'audio/aiff',
  '.ape': 'audio/ape',
  '.wv': 'audio/wavpack',
  '.amr': 'audio/amr',
  '.mka': 'audio/x-matroska',
  '.gz': 'application/gzip'
};

// Caching rules:
//  - Data files (html/json/gz/audio) stay no-store — they may be replaced on
//    disk while the app runs.
//  - bundle-version.js is fetched with a fixed ?v=1 URL, so it must never be
//    cached; it is what busts the versioned bundles on update.
//  - Versioned static assets (?v=... hash in the URL) are immutable once
//    shipped — the bundle-version hash busts them.
//  - Unversioned static assets (CSS, images) are revalidated on every load
//    (no-cache), so files replaced in place by a new build are picked up.
// In dev (unpackaged) nothing is cached so edits to js/css always show up on
// reload.
const CACHEABLE_EXTENSIONS = new Set([
  '.js', '.css', '.woff2', '.woff', '.ttf', '.otf', '.eot',
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico'
]);

function cacheControlFor(ext, url) {
  if (!app.isPackaged) return 'no-store';
  if (url && url.includes('bundle-version.js')) return 'no-cache, must-revalidate';
  if (!CACHEABLE_EXTENSIONS.has(ext)) return 'no-store';
  // Only versioned assets with an explicit ?v= hash are immutable.
  // Using any '?' was over-broad (e.g. ?_=Date.now() would be cached for a year).
  return (url && url.includes('?v='))
    ? 'public, max-age=31536000, immutable'
    : 'no-cache, must-revalidate';
}

let mainWindow;
let server;

function crashLogPath() {
  return path.join(app.getPath('userData'), 'crash.log');
}

const MAX_CRASH_LOG_BYTES = 2 * 1024 * 1024;

function logCrash(err) {
  try {
    const line = `${new Date().toISOString()} ${(err && err.stack) || err}\n`;
    const logPath = crashLogPath();
    try { fs.mkdirSync(path.dirname(logPath), { recursive: true }); } catch (_) {}
    // Rotate once the log grows past a reasonable size so it cannot balloon.
    try {
      if (fs.statSync(logPath).size > MAX_CRASH_LOG_BYTES) {
        fs.renameSync(logPath, logPath + '.old');
      }
    } catch (_) {}
    // Synchronous append: the uncaughtException handler below calls
    // app.exit(1) immediately after, so an async append raced the exit and
    // the crash line was lost. fs.appendFileSync guarantees the write lands
    // before the process goes down.
    fs.appendFileSync(logPath, line);
  } catch (_) {}
}

process.on('uncaughtException', (err) => {
  logCrash(err);
  console.error('[IEM Tool] Uncaught exception:', err);
  // The process is in an undefined state; exit cleanly after logging rather
  // than continuing to run with a broken main process.
  app.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logCrash(reason);
  console.error('[IEM Tool] Unhandled rejection:', reason);
});

function sendEmpty(res, status, extraHeaders) {
  const headers = Object.assign({ 'Content-Length': '0' }, extraHeaders);
  if (!res.headersSent) {
    res.writeHead(status, headers);
    res.end();
  } else {
    res.end();
  }
}

function serveFile(filePath, stats, req, res) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
  const fileSize = stats.size;
  const range = req.headers.range;
  const cacheControl = cacheControlFor(ext, req.url);
  const isHead = req.method === 'HEAD';

  if (range) {
    // Single-range only per RFC 7233; suffix form bytes=-N returns the last N bytes.
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!match || (match[1] === '' && match[2] === '')) {
      sendEmpty(res, 416, { 'Content-Range': `bytes */${fileSize}` });
      return;
    }
    let start = match[1] !== '' ? parseInt(match[1], 10) : null;
    let end = match[2] !== '' ? parseInt(match[2], 10) : null;

    if (start === null) {
      const n = end !== null ? end : 0;
      start = Math.max(0, fileSize - n);
      end = fileSize - 1;
    } else if (end === null) {
      end = fileSize - 1;
    }

    if (isNaN(start) || start < 0) start = 0;
    if (isNaN(end) || end > fileSize - 1) end = fileSize - 1;

    if (start > end || start >= fileSize) {
      sendEmpty(res, 416, { 'Content-Range': `bytes */${fileSize}` });
      return;
    }

    const chunkSize = end - start + 1;
    const headers = {
      'Content-Type': mimeType,
      'Content-Length': chunkSize,
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': cacheControl
    };
    if (isHead) {
      res.writeHead(206, headers);
      res.end();
      return;
    }
    res.writeHead(206, headers);
    const stream = fs.createReadStream(filePath, { start, end });
    stream.pipe(res);
    // Destroy the socket on mid-stream errors: headers with a fixed
    // Content-Length were already sent, so a plain res.end() delivers a
    // truncated 206 body that range-clients treat as a corrupt download.
    stream.on('error', () => { res.destroy(); });
    return;
  }

  const headers = {
    'Content-Type': mimeType,
    'Content-Length': fileSize,
    'Accept-Ranges': 'bytes',
    'Cache-Control': cacheControl
  };
  if (isHead) {
    res.writeHead(200, headers);
    res.end();
    return;
  }
  res.writeHead(200, headers);
  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
  // Same as the 206 path: destroy instead of end() so a mid-stream failure
  // can't deliver a short body under a 200 status.
  stream.on('error', () => { res.destroy(); });
}

function getAppRoot() {
  return app.getAppPath();
}

// database.json / database.json.gz / data/ are shipped as electron-builder
// "extraResources" instead of being baked into the asar (see package.json),
// specifically so a user can update the curve database in place -- replace
// these files/folder on disk and relaunch, no reinstall needed. Once
// packaged they live in `resources/` (a sibling of app.asar), not inside the
// asar alongside index.html/css/js. In dev (unpackaged, `npm start`) there is
// no separate resources dir, so they just sit at the project root as before.
function getDataRoot() {
  return app.isPackaged ? process.resourcesPath : getAppRoot();
}

// Writable, user-updatable copy of the curve database. Looked up BEFORE the
// copy that ships inside the app, so dropping a newer database.json + data/
// into this folder updates the app without reinstalling or re-downloading it.
// Deleting the folder reverts to the database that shipped with the build.
//   Windows portable : <folder of the .exe>/IEM-Data
//   Linux AppImage   : <folder of the AppImage>/IEM-Data
//   macOS / installed: <userData>/IEM-Data
function getExternalDataDir() {
  if (!app.isPackaged) return null;
  return path.join(PORTABLE_BASE || app.getPath('userData'), 'IEM-Data');
}

function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch (_) { return false; }
}

// Resolves a data-root-relative path to a real file: external folder first,
// bundled copy second. database.json and database.json.gz are treated as ONE
// unit - if the external folder supplies either of them, only the external
// pair is served. Otherwise a stale bundled .gz (which the app prefers) would
// silently shadow a freshly dropped database.json.
function resolveDataFile(relativePath, relPosix) {
  const bundledRoot = getDataRoot();
  const extRoot = getExternalDataDir();
  if (extRoot) {
    const isDbIndex = relPosix === 'database.json' || relPosix === 'database.json.gz';
    const extHasIndex = isFile(path.join(extRoot, 'database.json')) || isFile(path.join(extRoot, 'database.json.gz'));
    const extPath = path.normalize(path.join(extRoot, relativePath));
    const extRel = path.relative(extRoot, extPath);
    const extSafe = extRel !== '' && !extRel.startsWith('..') && !path.isAbsolute(extRel);
    if (extSafe && isFile(extPath)) return extPath;
    if (isDbIndex && extHasIndex) return null; // do not fall back to the bundled index
  }
  const bundledPath = path.normalize(path.join(bundledRoot, relativePath));
  const bRel = path.relative(bundledRoot, bundledPath);
  const bSafe = bRel === '' || (!bRel.startsWith('..') && !path.isAbsolute(bRel));
  return bSafe ? bundledPath : null;
}

const DATA_ROOT_RELATIVE = new Set(['database.json', 'database.json.gz']);
function isDataRootPath(relPosix) {
  return DATA_ROOT_RELATIVE.has(relPosix) || relPosix === 'data' || relPosix.startsWith('data/');
}

function startLocalServer(rootDir) {
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      try {
        const rawPath = req.url.split('?')[0];
        let filePath;
        try {
          filePath = path.normalize(path.join(rootDir, decodeURIComponent(rawPath)));
        } catch (e) {
          // Malformed percent-encoding in the request target.
          sendEmpty(res, 400);
          return;
        }

        const relativePath = path.relative(rootDir, filePath);
        const isSafe = (relativePath === '') || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));

        if (!isSafe) {
          sendEmpty(res, 403);
          return;
        }
        // Deny sensitive files that should never be served over HTTP
        const relPosix = relativePath.split(path.sep).join('/');
        if (relPosix === 'node_modules' || relPosix.startsWith('node_modules/') || relPosix === '.git' || relPosix.startsWith('.git/') || relPosix === '.github' || relPosix.startsWith('.github/') || relPosix === 'dist' || relPosix.startsWith('dist/') ||
            relPosix === 'package.json' || relPosix === 'package-lock.json' || relPosix === 'main.js' || relPosix === 'preload.js' || relPosix === '.gitignore') {
          sendEmpty(res, 403);
          return;
        }

        // database.json / database.json.gz / data/** are re-rooted to the
        // (separate, writable, see getDataRoot() above) data root instead of
        // rootDir -- re-validated against THAT root since it's a different
        // base directory than the one relativePath/isSafe were just checked
        // against.
        if (isDataRootPath(relPosix)) {
          const resolved = resolveDataFile(relativePath, relPosix);
          if (!resolved) {
            sendEmpty(res, 404);
            return;
          }
          filePath = resolved;
        }

        fs.stat(filePath, (err, stats) => {
          if (err) {
            sendEmpty(res, 404);
            return;
          }
          if (stats.isDirectory()) {
            filePath = path.join(filePath, 'index.html');
            fs.stat(filePath, (dirErr, dirStats) => {
              if (dirErr) {
                sendEmpty(res, 404);
                return;
              }
              serveFile(filePath, dirStats, req, res);
            });
            return;
          }
          serveFile(filePath, stats, req, res);
        });
      } catch (e) {
        logCrash(e);
        sendEmpty(res, 500);
      }
    });

    // localStorage and IndexedDB (settings, themes, saved reviews) are keyed by
    // origin, and the origin includes the port. A random port per launch meant
    // a brand-new, empty origin every time, so nothing persisted. Prefer one
    // fixed port; only if it is taken fall back to a random one.
    const PREFERRED_PORT = 49617;
    let triedFallback = false;
    server.on('error', (e) => {
      if (e && e.code === 'EADDRINUSE' && !triedFallback) {
        triedFallback = true;
        server.listen(0, '127.0.0.1');
        return;
      }
      logCrash(e);
      reject(e);
    });
    server.on('listening', () => resolve(server.address().port));
    server.listen(PREFERRED_PORT, '127.0.0.1');
  });
}

async function createWindow() {
  const rootDir = getAppRoot();
  const port = await startLocalServer(rootDir);

  // R1: the window is no longer maximized on launch.
  //
  // Two reasons, both user-visible:
  //  1. Windows draws a MAXIMIZED window with SQUARE corners. `roundedCorners`
  //     only applies to a restored window, so auto-maximizing meant the rounded
  //     frame the reskin asks for was never visible on startup.
  //  2. The custom caption buttons are part of the design; maximizing on launch
  //     hid the thing the user opens the app to see.
  //
  // Sized to 90% of the work area (and capped at 1600x900 so it does not become
  // a wall of black on a 4K panel) and centred. The user can still maximize
  // with the button, double-click on the drag region, or Win+Up.
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  const winWidth = Math.min(1600, Math.round(screenWidth * 0.9));
  const winHeight = Math.min(900, Math.round(screenHeight * 0.9));

  mainWindow = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    x: Math.round((screenWidth - winWidth) / 2),
    y: Math.round((screenHeight - winHeight) / 2),
    minWidth: 360,
    minHeight: 360,
    autoHideMenuBar: true,
    show: false,
    // R1: frameless, so index.html draws its own caption bar. Paired with
    // titleBarStyle:'hidden' so Chromium does not also reserve space for a
    // caption it will not paint.
    frame: false,
    titleBarStyle: 'hidden',
    // Must match --bg-base in app/css/app.css. Electron uses it to paint the
    // window before the first frame renders, which is what makes the launch
    // fade in from black instead of flashing white.
    backgroundColor: '#000000',
    roundedCorners: true,
    icon: path.join(__dirname, 'app', 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}/index.html${app.isPackaged ? '?packaged=1' : ''}`);

  // Lock the window to the local app only: deny popups and any navigation away
  // from the local UI (prevents accidental trips to external web content).
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(`http://127.0.0.1:${port}/`)) e.preventDefault();
  });

  // R1: tell the renderer when maximize/restore changes so the caption button
  // can swap its glyph. Fires for the button, for double-click on the drag
  // region, and for Win+Up / Win+Down, so all three stay in sync.
  const pushMaximizeState = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('win:maximized-changed', mainWindow.isMaximized());
    }
  };
  mainWindow.on('maximize', pushMaximizeState);
  mainWindow.on('unmaximize', pushMaximizeState);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// R1: custom caption-bar commands. Three channels only, each handled here
// rather than in the renderer, so a compromised page still cannot reach
// anything beyond minimise / toggle-maximise / close.
ipcMain.on('win:minimize', () => { if (mainWindow) mainWindow.minimize(); });
ipcMain.on('win:toggle-maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('win:close', () => { if (mainWindow) mainWindow.close(); });
ipcMain.on('win:is-maximized', (event) => {
  event.returnValue = mainWindow ? mainWindow.isMaximized() : false;
});

// Review-card export backdrop. The rasterising itself lives in theme-backdrop.js
// so it can be required directly by tools/verify-theme-backdrop-export.js and
// tested as the production function rather than as a re-implementation.
//
// Scope: takes a theme id and two integers, returns a PNG data URL (or null),
// touches nothing on disk, and passes no renderer-supplied markup or path.
ipcMain.handle('theme:capture-backdrop', (_event, payload) => {
  const req = payload && typeof payload === 'object' ? payload : {};
  return captureThemeBackdrop(req.themeId, req.width, req.height);
});

// Enforce a single running instance: re-launching just focuses the existing window.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    if (process.platform === 'darwin' && app.dock) {
      try { app.dock.setIcon(path.join(__dirname, 'app', 'icon.png')); } catch (e) {}
    }
    createWindow();  });
}

app.on('window-all-closed', () => {
  if (server) {
    server.close();
    // Connections are kept alive now; destroy idle sockets so the process can
    // actually exit instead of waiting on open keep-alive connections.
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  }
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});