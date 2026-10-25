const { app, BrowserWindow, screen, ipcMain, shell, Menu, dialog, session } = require('electron');
const path = require('path');
const http = require('http');
const https = require('https');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const fs = require('fs');
const { captureThemeBackdrop } = require('./theme-backdrop.js');

// ---------------------------------------------------------------------------
// Portable mode (Linux AppImage; also any portable Windows build).
//
// Windows ships as a normal NSIS installer, so PORTABLE_EXECUTABLE_DIR is unset
// there and the app uses the standard per-user locations (see below). When the
// app is launched as a portable .exe (electron-builder sets
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

// Files this server is allowed to hand out at all.
//
// The old guard was a deny-list (main.js, preload.js, package.json, .git, ...).
// That leaked everything nobody had thought to name: crash.log, .env files,
// editor backups, .map files, database.json.bak and any future stray file in
// the app folder. An allow-list fails closed instead. Audio is here because the
// bundled demo tracks live under app/audio; wasm/onnx because the photo tab
// fetches ONNX Runtime Web and its model through this server.
const SERVED_FILE_EXTENSIONS = new Set([
  '.html', '.htm', '.js', '.mjs', '.css', '.json', '.gz', '.txt',
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.bmp',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.mp3', '.wav', '.ogg', '.oga', '.opus', '.flac', '.m4a', '.mp4', '.m4b',
  '.aac', '.aiff', '.aif', '.ape', '.wv', '.amr', '.mka',
  '.wasm', '.onnx'
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
  // Fail closed on unknown extensions: see SERVED_FILE_EXTENSIONS.
  if (!SERVED_FILE_EXTENSIONS.has(ext)) {
    sendEmpty(res, 403);
    return;
  }
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
//   Linux AppImage    : <folder of the AppImage>/IEM-Data
//   Windows installer : %APPDATA%\iem-tool\IEM-Data
//   macOS             : ~/Library/Application Support/<app>/IEM-Data
// Settings -> Data -> "Open database folder" opens whichever one applies.
function getExternalDataDir() {
  if (!app.isPackaged) return null;
  return path.join(PORTABLE_BASE || app.getPath('userData'), 'IEM-Data');
}

function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch (_) { return false; }
}

// "Working copy" (Database tab). The first time a user edits the database from the
// Database tab, the bundled database.json / database.json.gz / data/ are COPIED into
// IEM-Data and this marker is written. From then on IEM-Data is the complete database:
// the bundled files that ship with the app are never written to, renamed or deleted,
// and the local server stops falling back to them, so a file the user deleted stays
// deleted. Settings -> Offline database -> Reset deletes the working copy and the app
// is back on the bundled database. Without the marker nothing changes: IEM-Data stays
// the optional "drop a newer database.json here" override it always was.
const WORKING_COPY_MARKER = '.iem-working-copy.json';
const DB_VERSION_MARKER = 'db-version.json';
function workingCopyActive() {
  const ext = getExternalDataDir();
  return !!(ext && isFile(path.join(ext, WORKING_COPY_MARKER)));
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
    if (isFile(path.join(extRoot, WORKING_COPY_MARKER))) return null; // complete working copy: never fall back to the bundled files
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
        // DNS-rebinding guard: only answer requests addressed to the literal
        // loopback origin the app itself loaded. A web page in the user's
        // browser that rebinds a hostname to 127.0.0.1 would otherwise be able
        // to read database.json and the bundled assets through this server.
        const addr = server && server.address();
        if (addr && (req.headers.host || '').toLowerCase() !== `127.0.0.1:${addr.port}`) {
          sendEmpty(res, 403);
          return;
        }
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

  // Permission lockdown. The app is fully offline and needs no camera, mic,
  // location, notifications or MIDI. The only grants it uses are clipboard
  // read (paste of curve data) and sanitized clipboard write (copy EQ lines),
  // and only for its own origin. Everything else is denied by default.
  const ALLOWED_PERMISSIONS = new Set(['clipboard-read', 'clipboard-sanitized-write']);
  const ownOrigin = `http://127.0.0.1:${port}`;
  const ses = mainWindow.webContents.session;
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const origin = (details && details.requestingUrl) || '';
    callback(ALLOWED_PERMISSIONS.has(permission) && origin.startsWith(ownOrigin + '/'));
  });
  ses.setPermissionCheckHandler((wc, permission, requestingOrigin) => {
    const fromOwnOrigin = requestingOrigin === ownOrigin || requestingOrigin === ownOrigin + '/';
    if (!fromOwnOrigin) return false;
    // Chromium withholds audio device labels AND the real sink IDs behind a
    // granted media permission, so Settings > Output device could only ever
    // list anonymous "Output 1 / 2" entries whose empty IDs all resolved to the
    // system default. Allowing the media CHECK exposes the names Windows shows
    // ("Speakers (Realtek(R) Audio)") and the IDs setSinkId needs. It cannot
    // open a microphone: every actual capture request still goes through the
    // request handler above, which keeps denying 'media'.
    if (permission === 'media' || permission === 'speaker-selection') return true;
    return ALLOWED_PERMISSIONS.has(permission);
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}/index.html${app.isPackaged ? '?packaged=1' : ''}`);

  // Lock the window to the local app only: deny popups and any navigation away
  // from the local UI (prevents accidental trips to external web content).
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // Right-click menu. Electron shows nothing by default (a browser would), so text fields
  // could only be pasted into with Ctrl+V. Editable fields get Undo / Cut / Copy / Paste /
  // Select all (plus spelling suggestions); selected text elsewhere gets Copy. Nothing else.
  mainWindow.webContents.on('context-menu', (_event, params) => {
    const items = [];
    if (params.isEditable) {
      (params.dictionarySuggestions || []).slice(0, 5).forEach((word) => {
        items.push({ label: word, click: () => mainWindow.webContents.replaceMisspelling(word) });
      });
      if (items.length) items.push({ type: 'separator' });
      const f = params.editFlags || {};
      items.push(
        { role: 'undo', enabled: !!f.canUndo }, { role: 'redo', enabled: !!f.canRedo }, { type: 'separator' },
        { role: 'cut', enabled: !!f.canCut }, { role: 'copy', enabled: !!f.canCopy }, { role: 'paste', enabled: !!f.canPaste },
        { type: 'separator' }, { role: 'selectAll' }
      );
    } else if (params.selectionText && params.selectionText.trim()) {
      items.push({ role: 'copy' });
    }
    if (items.length) Menu.buildFromTemplate(items).popup({ window: mainWindow });
  });
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(`http://127.0.0.1:${port}/`)) e.preventDefault();
  });

  // Failure recovery.
  //
  // The window is created with show:false and is only revealed on
  // ready-to-show. If the FIRST loadURL fails, that event never fires, so the
  // old code left no window, no dialog and no log: launching the app simply did
  // nothing. Every load/crash path below either reloads or quits explicitly.
  const recoverableFailure = (message, detail) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!mainWindow.isVisible()) mainWindow.show();
    let choice = 1;
    try {
      choice = dialog.showMessageBoxSync(mainWindow, {
        type: 'error',
        title: 'IEM Tool',
        message: message,
        detail: detail,
        buttons: ['Reload', 'Quit'],
        defaultId: 0,
        cancelId: 1,
        noLink: true
      });
    } catch (_) {}
    if (choice === 0) { try { mainWindow.reload(); } catch (_) {} }
    else app.quit();
  };

  mainWindow.webContents.on('did-fail-load', (_event, code, description, validatedURL, isMainFrame) => {
    if (isMainFrame === false) return;
    const detail = `${description || 'Load failed'} (${code})\n${validatedURL || ''}`;
    logCrash(new Error('[did-fail-load] ' + detail));
    recoverableFailure('The app interface failed to load.', detail);
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    logCrash(new Error('[render-process-gone] ' + JSON.stringify(details || {})));
    recoverableFailure(
      'The app interface stopped unexpectedly.',
      'Reason: ' + ((details && details.reason) || 'unknown') +
        '. Your saved reviews and settings are stored separately and are not affected.'
    );
  });

  // Log only: a transient GC pause can fire this, and a modal on top of a busy
  // UI would be worse than the pause. The crash log is the durable record.
  mainWindow.webContents.on('unresponsive', () => {
    logCrash(new Error('[unresponsive] renderer stopped responding'));
  });
  mainWindow.webContents.on('responsive', () => {
    // No user-facing action needed; kept as a symmetry hook for diagnostics.
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

  // Let the renderer flush its Data-tab autosave before the window goes away.
  //
  // data-module.js used to rely on `beforeunload` + an un-awaited IndexedDB
  // write; the renderer is torn down immediately, so the last edit inside the
  // autosave debounce could be lost. Here the close is deferred until the
  // renderer answers on `app:flush-done` (or 800ms passes, so a wedged/crashed
  // renderer can never make the window unclosable).
  let closeGuardDone = false;
  mainWindow.on('close', (e) => {
    if (closeGuardDone || !mainWindow || mainWindow.webContents.isDestroyed()) {
      closeGuardDone = true;
      return;
    }
    e.preventDefault();
    // Allow the retry below (and any later close) even if no answer arrives.
    closeGuardDone = true;
    try { mainWindow.webContents.send('app:flush-before-close'); } catch (_) {}
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
    }, 800);
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
ipcMain.handle('win:is-maximized', () => !!(mainWindow && mainWindow.isMaximized()));

// Renderer finished its pre-close autosave flush (see the close guard in
// createWindow). Sender-checked because closing the window is a UI action.
ipcMain.on('app:flush-done', (event) => {
  if (!dataSenderOk(event)) return;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
});

// Settings -> Data -> "Open database folder". Opens the folder where a newer
// database.json + data/ can be dropped (see getExternalDataDir). Creates it
// first if it does not exist yet, with a short README so it is obvious what
// goes in it. Argument-less on purpose: the renderer cannot choose the path.
// In dev (unpackaged) there is no external folder, so the project root - where
// database.json and data/ live - is opened instead.
const IEM_DATA_README = [
  'IEM Tool - offline database updates',
  '',
  'To update the database, copy a newer "database.json" (and/or "database.json.gz")',
  'and the "data" folder into THIS folder, then restart IEM Tool.',
  '',
  'Files here win over the copy that came with the app. A missing file falls back',
  'to the built-in one, so you only need to add what changed. If you supply',
  'database.json or database.json.gz, the built-in database index is not used.',
  'To go back to the built-in database, delete the files you added here.',
  ''
].join('\r\n');

// ---------------------------------------------------------------------------
// Update center (Settings > Updates).
//
// The renderer cannot call GitHub directly: index.html's CSP is
// `connect-src 'self'`, deliberately. All network access lives here, against
// fixed, hard-coded repository endpoints, so a compromised renderer cannot
// turn this into a generic fetch proxy.
// ---------------------------------------------------------------------------
const REPO_APP = 'MyLittlePrimordia/IEM-Tool';
const REPO_DATA = 'MyLittlePrimordia/Database';
const RELEASE_PAGE = `https://github.com/${REPO_APP}/releases/latest`;
const RELEASE_API = `https://api.github.com/repos/${REPO_APP}/releases/latest`;
const APP_COMMIT_API = `https://api.github.com/repos/${REPO_APP}/commits/main`;
const DATA_COMMIT_API = `https://api.github.com/repos/${REPO_DATA}/commits/main`;
const DATA_TREE_API = `https://api.github.com/repos/${REPO_DATA}/git/trees`;
// A hidden marker written by .github/workflows/build.yml into the rolling
// release body. Comparing this commit with the one compiled into the app is
// what makes updates work without manual version bumps.
const BUILD_MARKER_RE = /<!--\s*iem-build:\s*([0-9a-f]{7,40})\s*-->/i;

// ---------------------------------------------------------------------------
// Measurement source links (Settings > Data > Measurement sources).
//
// The credits panel opens the original database for each source. Those URLs
// come from a renderer-side data table, so they are validated here as well:
// HTTPS only, no embedded credentials or explicit port, and only these
// publishers (plus any *.squig.link database). This keeps the bridge from
// becoming a generic "open any URL" primitive.
// ---------------------------------------------------------------------------
const CREDIT_URL_HOSTS = new Set([
  'squig.link',
  'hangout.audio',
  'jaysaudio.github.io',
  'headphones.com',
  'www.headpie.net',
  'www.hypethesonics.com',
  'www.stereophile.com',
  'www.reddit.com',
  'www.rtings.com',
  'www.head-fi.org'
]);

function isCreditUrlAllowed(raw) {
  try {
    const url = new URL(String(raw || ''));
    if (url.protocol !== 'https:') return false;
    if (url.username || url.password || url.port) return false;
    const host = url.hostname.toLowerCase();
    return CREDIT_URL_HOSTS.has(host) || host.endsWith('.squig.link');
  } catch (e) {
    return false;
  }
}

function httpsJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'IEM-Tool-Updater', 'Accept': 'application/vnd.github+json' }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return httpsJson(res.headers.location).then(resolve, reject);
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; if (body.length > 4 * 1024 * 1024) req.destroy(new Error('response too large')); });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`GitHub returned HTTP ${res.statusCode}`));
        }
        try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('invalid JSON from GitHub')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('update check timed out')));
  });
}

// ---------------------------------------------------------------------------
// Build identity + database fingerprints.
//
// Neither repository bumps a semantic version per push, so updates are decided
// by content hashes instead:
//   * the app compares the commit compiled into it with the commit in the
//     rolling release;
//   * the database compares Git's own tree/blob hashes for database.json and
//     data/ against the Database repository's latest commit. Git's SHA-1
//     object format is stable across checkouts, so this also survives Windows'
//     CRLF working copy (text is normalised before hashing, as Git does).
// ---------------------------------------------------------------------------
let buildInfoCache = null;
function packageVersion() {
  try { return String(JSON.parse(fs.readFileSync(path.join(getAppRoot(), 'package.json'), 'utf8')).version || app.getVersion()); }
  catch (_) { return app.getVersion(); }
}
function getBuildInfo() {
  if (buildInfoCache) return buildInfoCache;
  const fallback = {
    version: packageVersion(), commit: '', shortCommit: '',
    branch: '', bundle: '', builtAt: null
  };
  const candidates = [
    path.join(getAppRoot(), 'app', 'js', 'build-info.json'),
    path.join(__dirname, 'app', 'js', 'build-info.json')
  ];
  for (const file of candidates) {
    try {
      if (!isFile(file)) continue;
      const info = JSON.parse(fs.readFileSync(file, 'utf8'));
      buildInfoCache = {
        version: String(info.version || packageVersion()),
        commit: String(info.commit || ''),
        shortCommit: String(info.shortCommit || info.commit || '').slice(0, 7),
        branch: String(info.branch || ''),
        bundle: String(info.bundle || ''),
        builtAt: info.builtAt || null
      };
      return buildInfoCache;
    } catch (_) { /* try the next path */ }
  }
  buildInfoCache = fallback;
  return buildInfoCache;
}

function normalizedGitText(buf) {
  return Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
}
function gitBlobSha(buf) {
  return crypto.createHash('sha1')
    .update('blob ' + buf.length + '\0')
    .update(buf)
    .digest();
}
// Git orders tree entries by name, treating directories as if their name had a
// trailing slash. A plain string sort is subtly different when a file and a
// directory share a prefix, so reproduce base_name_compare here.
function gitTreeCompare(a, b) {
  const A = Buffer.from(a.name, 'utf8'), B = Buffer.from(b.name, 'utf8');
  const n = Math.min(A.length, B.length);
  const common = Buffer.compare(A.subarray(0, n), B.subarray(0, n));
  if (common) return common;
  if (A.length < B.length) return (a.dir ? 47 : 0) - B[n];   // 47 = '/'
  if (A.length > B.length) return A[n] - (b.dir ? 47 : 0);
  return (a.dir ? 47 : 0) - (b.dir ? 47 : 0);
}
async function gitTreeSha(dir) {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  const children = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      children.push({ name: entry.name, dir: true, sha: await gitTreeSha(path.join(dir, entry.name)) });
    } else if (entry.isFile()) {
      const file = path.join(dir, entry.name);
      let buf = await fs.promises.readFile(file);
      if (/\.txt$/i.test(entry.name)) buf = normalizedGitText(buf);
      children.push({ name: entry.name, dir: false, sha: gitBlobSha(buf) });
    }
  }
  children.sort(gitTreeCompare);
  const parts = [];
  for (const child of children) {
    parts.push(Buffer.from(`${child.dir ? '40000' : '100644'} ${child.name}\0`, 'utf8'), child.sha);
  }
  const body = Buffer.concat(parts);
  return crypto.createHash('sha1').update('tree ' + body.length + '\0').update(body).digest();
}
async function fingerprintDatabase(root) {
  const dbFile = path.join(root, 'database.json');
  const dataDir = path.join(root, 'data');
  if (!isFile(dbFile)) throw new Error('No database.json in the active database folder.');
  if (!fs.existsSync(dataDir) || !fs.statSync(dataDir).isDirectory()) throw new Error('No data/ folder in the active database folder.');
  const dbBuf = normalizedGitText(await fs.promises.readFile(dbFile));
  const dataTree = await gitTreeSha(dataDir);
  return {
    databaseJsonSha: gitBlobSha(dbBuf).toString('hex'),
    dataTreeSha: dataTree.toString('hex')
  };
}
function databaseRootForCheck() {
  const ext = getExternalDataDir();
  if (ext && (workingCopyActive() || isFile(path.join(ext, 'database.json')))) return ext;
  return getDataRoot();
}
async function fetchDatabaseHead() {
  const commit = await httpsJson(DATA_COMMIT_API);
  const sha = String(commit.sha || '');
  const treeSha = commit.commit && commit.commit.tree && commit.commit.tree.sha;
  if (!sha || !treeSha) throw new Error('GitHub did not return a commit for the Database repository.');
  const rootTree = await httpsJson(`${DATA_TREE_API}/${treeSha}`);
  const entries = Array.isArray(rootTree.tree) ? rootTree.tree : [];
  const data = entries.find(e => e.path === 'data' && e.type === 'tree');
  const db = entries.find(e => e.path === 'database.json' && e.type === 'blob');
  if (!data || !db) throw new Error('The Database repository does not contain database.json and data/.');
  return {
    sha,
    shortSha: sha.slice(0, 7),
    treeSha,
    dataTreeSha: data.sha,
    databaseJsonSha: db.sha,
    message: (commit.commit && commit.commit.message) || '',
    date: (commit.commit && commit.commit.committer && commit.commit.committer.date) || null
  };
}

ipcMain.handle('app:get-version', () => packageVersion());
ipcMain.handle('app:get-build-info', (event) => {
  if (!dataSenderOk(event)) return { ok: false, error: 'denied' };
  return { ok: true, ...getBuildInfo() };
});

ipcMain.handle('app:check-update', async (event) => {
  if (!dataSenderOk(event)) return { ok: false, error: 'denied' };
  try {
    const local = getBuildInfo();
    const rel = await httpsJson(RELEASE_API);
    const body = String(rel.body || '');
    const marker = body.match(BUILD_MARKER_RE);
    let remoteCommit = marker ? marker[1] : '';
    let source = 'release';
    if (!remoteCommit) {
      // Releases created before the build marker existed fall back to the head
      // of main. The marker is preferred because it names a build that is
      // actually published, not one that may still be compiling.
      const head = await httpsJson(APP_COMMIT_API);
      remoteCommit = String(head.sha || '');
      source = 'main';
    }
    const remoteShort = remoteCommit.slice(0, 7);
    const changed = !!(local.commit && remoteCommit && local.commit !== remoteCommit);
    return {
      ok: true,
      current: local.version,
      localCommit: local.commit,
      localShort: local.shortCommit,
      remoteCommit,
      remoteShort,
      bundle: local.bundle,
      builtAt: local.builtAt,
      source,
      changed,
      newer: changed,
      dev: !local.commit,
      latest: remoteShort || String(rel.tag_name || ''),
      url: rel.html_url || RELEASE_PAGE,
      notes: body.replace(BUILD_MARKER_RE, '').trim().slice(0, 4000),
      publishedAt: rel.published_at || null,
      releaseUpdatedAt: rel.updated_at || null
    };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

ipcMain.handle('app:open-release-page', async (event) => {
  if (!dataSenderOk(event)) return { ok: false, error: 'denied' };
  try { await shell.openExternal(RELEASE_PAGE); return { ok: true }; }
  catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});

ipcMain.handle('app:open-credit-url', async (event, rawUrl) => {
  if (!dataSenderOk(event)) return { ok: false, error: 'denied' };
  if (!isCreditUrlAllowed(rawUrl)) return { ok: false, error: 'blocked' };
  try { await shell.openExternal(String(rawUrl)); return { ok: true }; }
  catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});

ipcMain.handle('db:check-update', async (event) => {
  if (!dataSenderOk(event)) return { ok: false, error: 'denied' };
  try {
    const remote = await fetchDatabaseHead();
    const local = await fingerprintDatabase(databaseRootForCheck());
    return {
      ok: true,
      ...remote,
      local,
      changed: local.dataTreeSha !== remote.dataTreeSha
        || local.databaseJsonSha !== remote.databaseJsonSha
    };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'IEM-Tool-Updater' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return downloadFile(res.headers.location, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`Download returned HTTP ${res.statusCode}`)); }
      const out = fs.createWriteStream(dest);
      let bytes = 0;
      res.on('data', (chunk) => { bytes += chunk.length; if (bytes > 300 * 1024 * 1024) req.destroy(new Error('database archive is unexpectedly large')); });
      res.pipe(out);
      out.on('finish', () => out.close(() => resolve(bytes)));
      out.on('error', reject);
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(120000, () => req.destroy(new Error('database download timed out')));
  });
}

function extractTarGz(archive, dest) {
  return new Promise((resolve, reject) => {
    // Run tar from the archive's folder and name the archive relatively. GNU tar
    // (the one on PATH in a Git-for-Windows setup) reads a colon before a slash
    // in the -f argument as an rsh host, so an absolute Windows path such as
    // C:\Users\...\database.tar.gz failed with "Cannot connect to C: resolve
    // failed" and every in-app database install aborted before it started.
    // A relative filename is unambiguous for both GNU tar and bsdtar.
    execFile('tar', ['-xzf', path.basename(archive), '-C', dest], {
      cwd: path.dirname(archive), windowsHide: true, timeout: 180000
    }, (err, stdout, stderr) => {
      if (err) return reject(new Error('Could not extract the archive' + (stderr ? ': ' + String(stderr).slice(0, 300) : '')));
      resolve();
    });
  });
}

// Installs an exact Database commit into IEM-Data transactionally: extract to a
// staging folder, verify the Git tree/blob hashes against the commit, validate
// the catalogue and data directory, move the old pair aside, then move the new
// pair in. On any failure the previous pair is restored.
ipcMain.handle('db:download-update', async (event) => {
  if (!dataSenderOk(event)) return { ok: false, error: 'denied' };
  const ext = getExternalDataDir();
  if (!ext) return { ok: false, error: 'Database updates are only available in the installed app. In development, update database.json and data/ in the project folder.' };
  const stamp = Date.now();
  const work = path.join(os.tmpdir(), `iem-db-update-${stamp}`);
  const archive = path.join(work, 'database.tar.gz');
  const extract = path.join(work, 'extract');
  let movedOldData = false;
  let movedOldJson = false;
  try {
    const head = await fetchDatabaseHead();
    fs.mkdirSync(extract, { recursive: true });
    // Download the commit that was checked, not main: a push landing between
    // the check and the download must not install a tree we did not verify.
    await downloadFile(`https://codeload.github.com/${REPO_DATA}/tar.gz/${head.sha}`, archive);
    await extractTarGz(archive, extract);
    const rootEntry = fs.readdirSync(extract, { withFileTypes: true }).find(e => e.isDirectory());
    if (!rootEntry) throw new Error('The downloaded archive is empty.');
    const srcRoot = path.join(extract, rootEntry.name);
    const newDb = path.join(srcRoot, 'database.json');
    const newData = path.join(srcRoot, 'data');
    if (!isFile(newDb)) throw new Error('The downloaded archive has no database.json.');
    if (!fs.existsSync(newData) || !fs.statSync(newData).isDirectory()) throw new Error('The downloaded archive has no data/ folder.');
    let products = 0;
    try {
      const parsed = JSON.parse(fs.readFileSync(newDb, 'utf8'));
      if (!Array.isArray(parsed) || !parsed.length) throw new Error('not a non-empty array');
      products = parsed.length;
    } catch (e) {
      throw new Error('The downloaded database.json is invalid: ' + ((e && e.message) || e));
    }
    const downloaded = await fingerprintDatabase(srcRoot);
    if (downloaded.dataTreeSha !== head.dataTreeSha || downloaded.databaseJsonSha !== head.databaseJsonSha) {
      throw new Error('The downloaded archive does not match the requested commit; nothing was installed.');
    }

    fs.mkdirSync(ext, { recursive: true });
    fs.mkdirSync(path.join(ext, 'backup'), { recursive: true });
    const oldData = path.join(ext, 'data');
    const oldJson = path.join(ext, 'database.json');
    const bakData = path.join(ext, 'backup', `data-${stamp}`);
    const bakJson = path.join(ext, 'backup', `database-${stamp}.json`);
    if (fs.existsSync(oldData)) { fs.renameSync(oldData, bakData); movedOldData = true; }
    if (isFile(oldJson)) { fs.renameSync(oldJson, bakJson); movedOldJson = true; }
    try {
      const dataDest = path.join(ext, 'data');
      try { fs.renameSync(newData, dataDest); }
      catch (crossDevice) { fs.cpSync(newData, dataDest, { recursive: true }); }
      fs.copyFileSync(newDb, path.join(ext, 'database.json'));
      const gz = zlib.gzipSync(fs.readFileSync(newDb), { level: 9 });
      fs.writeFileSync(path.join(ext, 'database.json.gz'), gz);
      atomicWrite(path.join(ext, WORKING_COPY_MARKER), JSON.stringify({
        version: 1, createdAt: new Date().toISOString(), appVersion: app.getVersion(),
        source: 'github', installedAt: new Date().toISOString(), products
      }, null, 2));
      atomicWrite(path.join(ext, DB_VERSION_MARKER), JSON.stringify({
        schema: 1, commit: head.sha, shortCommit: head.shortSha,
        tree: head.treeSha, dataTree: head.dataTreeSha,
        databaseJson: head.databaseJsonSha,
        installedAt: new Date().toISOString(), products
      }, null, 2));
    } catch (installErr) {
      // Roll back: remove anything half-installed, restore the old pair.
      try { fs.rmSync(path.join(ext, 'data'), { recursive: true, force: true }); } catch (_) {}
      try { fs.rmSync(path.join(ext, 'database.json'), { force: true }); } catch (_) {}
      try { fs.rmSync(path.join(ext, 'database.json.gz'), { force: true }); } catch (_) {}
      if (movedOldData) { try { fs.renameSync(bakData, oldData); } catch (_) {} }
      if (movedOldJson) { try { fs.renameSync(bakJson, oldJson); } catch (_) {} }
      throw installErr;
    }
    // Old backups are pruned to the two most recent sets; the data folder is
    // large enough that unbounded snapshots would fill the disk.
    try {
      const backups = fs.readdirSync(path.join(ext, 'backup'));
      const dataBackups = backups.filter(n => n.startsWith('data-')).sort();
      while (dataBackups.length > 2) {
        const old = dataBackups.shift();
        fs.rmSync(path.join(ext, 'backup', old), { recursive: true, force: true });
      }
      const jsonBackups = backups.filter(n => n.startsWith('database-')).sort();
      while (jsonBackups.length > 4) {
        const old = jsonBackups.shift();
        fs.rmSync(path.join(ext, 'backup', old), { force: true });
      }
    } catch (_) {}
    return { ok: true, products, shortSha: head.shortSha, commit: head.sha, backup: path.join(ext, 'backup') };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  } finally {
    try { fs.rmSync(work, { recursive: true, force: true }); } catch (_) {}
  }
});

ipcMain.handle('app:open-data-folder', async (event) => {
  if (!dataSenderOk(event)) return { ok: false, error: 'denied' };
  try {
    const dir = getExternalDataDir() || getDataRoot();
    fs.mkdirSync(dir, { recursive: true });
    const readme = path.join(dir, 'README.txt');
    if (app.isPackaged && !isFile(readme)) {
      try { fs.writeFileSync(readme, IEM_DATA_README); } catch (_) {}
    }
    const err = await shell.openPath(dir);
    return err ? { ok: false, error: err, path: dir } : { ok: true, path: dir };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

// ---------------------------------------------------------------------------
// Database tab (renderer: app/js/data-*.js). Everything below is scoped:
//  - the renderer never supplies a path, only a data-relative name that must be
//    "data/<folder>/<file>.txt" with no traversal;
//  - writes go to ONE place: the IEM-Data folder when packaged (the folder the
//    app already prefers over its bundled copy), or the project root when
//    running unpackaged (`npm start`);
//  - reads see both the writable folder and the bundled copy, writable first.
// ---------------------------------------------------------------------------
const zlib = require('zlib');
const DATA_MAX_BYTES = 64 * 1024 * 1024;

function dataWriteRoot() { return app.isPackaged ? getExternalDataDir() : getDataRoot(); }
function dataReadRoots() {
  const roots = [];
  const ext = getExternalDataDir();
  if (ext) roots.push(ext);
  if (!workingCopyActive()) roots.push(getDataRoot());   // once the working copy exists it is the whole database
  return roots.filter((r, i) => r && roots.indexOf(r) === i);
}
function safeDataRel(rel) {
  if (typeof rel !== 'string') return null;
  const n = rel.replace(/\\/g, '/').replace(/\/+/g, '/').trim();
  if (!/^data\/[^/].*\.txt$/i.test(n)) return null;
  if (n.split('/').some((p) => p === '..' || p === '.' || p === '')) return null;
  if (n.length > 400) return null;
  return n;
}
function dataSenderOk(event) {
  return !!(mainWindow && event && event.sender === mainWindow.webContents);
}
function walkTxt(dir, rel, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
  for (const e of entries) {
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) walkTxt(path.join(dir, e.name), rel + e.name + '/', out);
    else if (e.isFile() && e.name.toLowerCase().endsWith('.txt')) out.push(rel + e.name);
  }
}
function atomicWrite(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + process.pid + '-' + Date.now();
  try {
    const fd = fs.openSync(tmp, 'w');
    try { fs.writeFileSync(fd, data); try { fs.fsyncSync(fd); } catch (_) {} } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (_) {}
    throw e;
  }
}

// Writes database.json and database.json.gz as ONE operation.
//
// The two files used to be written sequentially with no shared failure
// handling, so a success on the first and a failure on the second (disk full,
// permission, process killed) left a NEW database.json next to an OLD .gz. The
// catalogue loader preferred the .gz, so the app silently kept showing the old
// catalogue while the Data tab showed the new one.
//
// Both payloads are therefore compressed and staged before either file is
// replaced, and the .json is renamed FIRST. If the .gz rename then fails, the
// new database is still what every reader (main process, DataStore,
// CurveIndexer) loads, and the stale .gz is reported through gzStale rather
// than silently winning. Previous versions of both files go to backup/.
function writeDatabaseSet(root, text, wantJson, wantGz) {
  const j = path.join(root, 'database.json');
  const g = path.join(root, 'database.json.gz');
  const files = [];
  fs.mkdirSync(path.join(root, 'backup'), { recursive: true });
  for (const [src, bak] of [[j, 'database.json.bak'], [g, 'database.json.gz.bak']]) {
    if (isFile(src)) { try { fs.copyFileSync(src, path.join(root, 'backup', bak)); } catch (_) {} }
  }

  // Compress before touching disk: a gzip failure must not leave a half-written set.
  const gz = wantGz ? zlib.gzipSync(Buffer.from(text, 'utf8'), { level: 9 }) : null;
  const staged = [];
  try {
    if (wantJson) {
      const tmp = j + '.tmp-' + process.pid + '-' + Date.now();
      const fd = fs.openSync(tmp, 'w');
      try { fs.writeFileSync(fd, text); try { fs.fsyncSync(fd); } catch (_) {} } finally { fs.closeSync(fd); }
      staged.push({ tmp, dest: j, name: 'database.json', bytes: Buffer.byteLength(text) });
    }
    if (wantGz) {
      const tmp = g + '.tmp-' + process.pid + '-' + Date.now();
      const fd = fs.openSync(tmp, 'w');
      try { fs.writeFileSync(fd, gz); try { fs.fsyncSync(fd); } catch (_) {} } finally { fs.closeSync(fd); }
      staged.push({ tmp, dest: g, name: 'database.json.gz', bytes: gz.length });
    }
  } catch (e) {
    for (const s of staged) { try { fs.unlinkSync(s.tmp); } catch (_) {} }
    throw e;
  }

  for (let i = 0; i < staged.length; i++) {
    const s = staged[i];
    try {
      fs.renameSync(s.tmp, s.dest);
      files.push({ name: s.name, bytes: s.bytes });
    } catch (e) {
      for (let k = i; k < staged.length; k++) { try { fs.unlinkSync(staged[k].tmp); } catch (_) {} }
      if (i === 0 && wantJson && wantGz) {
        throw new Error('database.json could not be replaced, so nothing was changed: ' + ((e && e.message) || e));
      }
      if (i > 0) {
        throw new Error('database.json was saved, but database.json.gz could not be replaced (the compressed copy is now stale): ' + ((e && e.message) || e));
      }
      throw e;
    }
  }
  return files;
}

ipcMain.handle('data:info', (event) => {
  if (!dataSenderOk(event)) return { ok: false, error: 'denied' };
  const root = dataWriteRoot();
  let canWrite = false;
  try { if (root) { fs.mkdirSync(root, { recursive: true }); fs.accessSync(root, fs.constants.W_OK); canWrite = true; } } catch (_) {}
  return { ok: true, canWrite, path: root, packaged: app.isPackaged, workingCopy: app.isPackaged ? workingCopyActive() : true,
    canReset: app.isPackaged, label: app.isPackaged ? 'Your copy (IEM-Data)' : 'Project folder (dev)' };
});

// First write from the Database tab: copy the bundled database into IEM-Data (never into
// the bundled files). Anything already in IEM-Data wins, so a user who dropped a newer
// database there keeps it. Returns quickly when it already exists.
let seedPromise = null;
async function seedWorkingCopy() {
  const ext = getExternalDataDir();
  if (!ext) return { ok: true, created: false, dev: true };
  if (workingCopyActive()) return { ok: true, created: false };
  const bundled = getDataRoot();
  fs.mkdirSync(ext, { recursive: true });
  const has = (n) => isFile(path.join(ext, n));
  if (!has('database.json') && !has('database.json.gz')) {
    for (const n of ['database.json', 'database.json.gz']) {
      if (isFile(path.join(bundled, n))) fs.copyFileSync(path.join(bundled, n), path.join(ext, n));
    }
  } else if (has('database.json') && !has('database.json.gz')) {
    atomicWrite(path.join(ext, 'database.json.gz'), zlib.gzipSync(fs.readFileSync(path.join(ext, 'database.json')), { level: 9 }));
  }
  const srcData = path.join(bundled, 'data');
  if (fs.existsSync(srcData)) await fs.promises.cp(srcData, path.join(ext, 'data'), { recursive: true, force: false, errorOnExist: false });
  atomicWrite(path.join(ext, WORKING_COPY_MARKER), JSON.stringify({ version: 1, createdAt: new Date().toISOString(), appVersion: app.getVersion() }, null, 2));
  return { ok: true, created: true };
}
ipcMain.handle('data:ensure-working-copy', async (event) => {
  if (!dataSenderOk(event)) return { ok: false, error: 'denied' };
  try {
    if (!seedPromise) seedPromise = seedWorkingCopy().finally(() => { seedPromise = null; });
    return await seedPromise;
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});

// Settings -> Offline database -> Reset. Removes ONLY what the Database tab / an update drop
// created inside IEM-Data (database files, data/, backup/, marker). The bundled files are
// untouched, so the app simply goes back to them.
ipcMain.handle('data:reset-working-copy', async (event) => {
  if (!dataSenderOk(event)) return { ok: false, error: 'denied' };
  try {
    const ext = getExternalDataDir();
    if (!ext || path.basename(ext) !== 'IEM-Data') return { ok: false, error: 'Reset is only available in the installed app.' };
    for (const n of ['database.json', 'database.json.gz', WORKING_COPY_MARKER, DB_VERSION_MARKER]) { try { fs.rmSync(path.join(ext, n), { force: true }); } catch (_) {} }
    for (const n of ['data', 'backup']) { await fs.promises.rm(path.join(ext, n), { recursive: true, force: true }); }
    return { ok: true };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});

// Settings > Library > Reset: erase everything this app persists, then start again.
// Three stores are involved and they live in different places:
//   * localStorage - theme, settings, custom EQ presets, Find favourites, hearing
//                    calibration, last alignment, Data-tab autosave
//   * IndexedDB    - saved reviews (with photos), curve cache, working copy
//   * IEM-Data     - database entries and measurement files the user added
// The first two are Chromium storage, so they are cleared through the session: a
// renderer-side deleteDatabase() races the IndexedDB connections its own modules
// keep open, and a blocked delete quietly leaves the reviews in place. IEM-Data is
// only removed when packaged - in dev that path is the project folder's own
// database, which must never be touched.
//
// app.exit() is deliberate. A normal quit runs the close handshake, whose autosave
// writes the Data tab's working file straight back into the folder just deleted;
// exit skips it and relaunch starts a genuinely first-run app. The reply is sent
// before the reboot so a failure is still reported on the still-live page.
ipcMain.handle('app:factory-reset', async (event) => {
  if (!dataSenderOk(event)) return { ok: false, error: 'denied' };
  try {
    const ext = getExternalDataDir();
    if (ext && path.basename(ext) === 'IEM-Data') {
      await fs.promises.rm(ext, { recursive: true, force: true });
    }
    // No `storages` filter on purpose. Passing one (even ['indexeddb']) left
    // every saved review in place while reporting success - measured by seeding
    // a review, resetting, reloading and reading it back. The unfiltered call
    // clears localStorage and IndexedDB together, which is exactly the set the
    // app owns: it sets no cookies and talks to no origin but its own.
    await session.defaultSession.clearStorageData();
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
  setTimeout(() => { app.relaunch(); app.exit(0); }, 250);
  return { ok: true };
});

// Every write needs the working copy to exist first (installed app). The renderer asks the
// user and calls data:ensure-working-copy; this is the backstop so a write can never land
// in a half-seeded folder.
function writeBlocked() { return app.isPackaged && !workingCopyActive(); }

ipcMain.handle('data:read-database', (event) => {
  if (!dataSenderOk(event)) return { ok: false, error: 'denied' };
  try {
    for (const root of dataReadRoots()) {
      const j = path.join(root, 'database.json'), g = path.join(root, 'database.json.gz');
      const hasJ = isFile(j), hasG = isFile(g);
      if (!hasJ && !hasG) continue;
      let gzStale = false;
      if (hasJ && hasG) { try { gzStale = fs.statSync(g).mtimeMs + 2000 < fs.statSync(j).mtimeMs; } catch (_) {} }
      if (hasJ) return { ok: true, text: fs.readFileSync(j, 'utf8'), source: 'database.json', gzStale };
      const buf = zlib.gunzipSync(fs.readFileSync(g), { maxOutputLength: DATA_MAX_BYTES });
      return { ok: true, text: buf.toString('utf8'), source: 'database.json.gz', gzStale: false };
    }
    return { ok: false, error: 'No database.json or database.json.gz found.' };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});

ipcMain.handle('data:list-files', (event) => {
  if (!dataSenderOk(event)) return { ok: false, error: 'denied' };
  try {
    const set = new Set();
    for (const root of dataReadRoots()) {
      const out = [];
      walkTxt(path.join(root, 'data'), 'data/', out);
      out.forEach((p) => set.add(p));
    }
    return { ok: true, files: Array.from(set).sort() };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});

ipcMain.handle('data:read-file', (event, rel) => {
  if (!dataSenderOk(event)) return { ok: false, error: 'denied' };
  const n = safeDataRel(rel);
  if (!n) return { ok: false, error: 'bad path' };
  for (const root of dataReadRoots()) {
    const p = path.join(root, n);
    const r = path.relative(root, p);
    if (r.startsWith('..') || path.isAbsolute(r)) continue;
    try { if (isFile(p) && fs.statSync(p).size <= 20 * 1024 * 1024) return { ok: true, text: fs.readFileSync(p, 'utf8') }; } catch (_) {}
  }
  return { ok: false, error: 'not found' };
});

ipcMain.handle('data:write-database', (event, payload) => {
  if (!dataSenderOk(event)) return { ok: false, error: 'denied' };
  if (writeBlocked()) return { ok: false, error: 'needs-working-copy' };
  try {
    const root = dataWriteRoot();
    if (!root) return { ok: false, error: 'No writable data folder.' };
    const req = (payload && typeof payload === 'object') ? payload : {};
    const text = req.text;
    if (typeof text !== 'string' || text.length < 2 || text.length > DATA_MAX_BYTES) return { ok: false, error: 'bad payload' };
    // Refuse anything that is not a JSON array: a corrupted save must never replace a good database.
    let parsed;
    try { parsed = JSON.parse(text); } catch (_) { return { ok: false, error: 'payload is not valid JSON' }; }
    if (!Array.isArray(parsed)) return { ok: false, error: 'payload is not a JSON array' };
    fs.mkdirSync(root, { recursive: true });
    const wantJson = req.json !== false;
    const wantGz = req.gz !== false;
    if (!wantJson && !wantGz) return { ok: false, error: 'nothing to write' };
    const files = writeDatabaseSet(root, text, wantJson, wantGz);
    return { ok: true, files, path: root };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});

ipcMain.handle('data:write-file', (event, payload) => {
  if (!dataSenderOk(event)) return { ok: false, error: 'denied' };
  if (writeBlocked()) return { ok: false, error: 'needs-working-copy' };
  try {
    const root = dataWriteRoot();
    const n = safeDataRel(payload && payload.rel);
    if (!root || !n) return { ok: false, error: 'bad path' };
    const text = payload.text;
    if (typeof text !== 'string' || text.length > 20 * 1024 * 1024) return { ok: false, error: 'bad payload' };
    const dest = path.join(root, n);
    const r = path.relative(root, dest);
    if (r.startsWith('..') || path.isAbsolute(r)) return { ok: false, error: 'bad path' };
    let existed = dataReadRoots().some((rt) => isFile(path.join(rt, n)));
    if (existed && !payload.overwrite) return { ok: true, existed: true, skipped: true };
    atomicWrite(dest, text);
    return { ok: true, existed };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});

// Opening the changelog from the panel. shell.openPath hands the file to the
// OS's Markdown handler; when there is none (or it fails) the file is revealed
// in its folder instead, so a click always gets the reader somewhere.
ipcMain.handle('data:open-save-log', async (event) => {
  if (!dataSenderOk(event)) return { ok: false, error: 'denied' };
  try {
    const root = dataWriteRoot();
    const file = root ? path.join(root, 'save-log.md') : '';
    if (!file || !isFile(file)) return { ok: false, error: 'No save-log.md yet.' };
    const err = await shell.openPath(file);
    if (!err) return { ok: true, how: 'opened', path: root };
    shell.showItemInFolder(file);
    return { ok: true, how: 'revealed', path: root };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});

// Reading the changelog back is what lets an export add to it instead of
// replacing it. Same fixed filename and root as the write, and `text: null`
// instead of an error when nothing has been exported yet.
ipcMain.handle('data:read-save-log', (event) => {
  if (!dataSenderOk(event)) return { ok: false, error: 'denied' };
  try {
    const root = dataWriteRoot();
    if (!root) return { ok: true, text: null };
    const file = path.join(root, 'save-log.md');
    if (!isFile(file)) return { ok: true, text: null };
    if (fs.statSync(file).size > 8 * 1024 * 1024) return { ok: false, error: 'save-log.md is too large to merge with' };
    return { ok: true, text: fs.readFileSync(file, 'utf8') };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});

// The save log's Markdown changelog. One fixed filename beside the database, no
// renderer-supplied path, and the same "working copy first" rule as every other
// write, so an export can never land in the installed app's bundled files.
ipcMain.handle('data:write-save-log', (event, payload) => {
  if (!dataSenderOk(event)) return { ok: false, error: 'denied' };
  if (writeBlocked()) return { ok: false, error: 'needs-working-copy' };
  try {
    const root = dataWriteRoot();
    if (!root) return { ok: false, error: 'No writable data folder.' };
    const text = payload && payload.text;
    if (typeof text !== 'string' || text.length > 8 * 1024 * 1024) return { ok: false, error: 'bad payload' };
    fs.mkdirSync(root, { recursive: true });
    atomicWrite(path.join(root, 'save-log.md'), text);
    return { ok: true, path: root };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});

ipcMain.handle('data:delete-file', (event, rel) => {
  if (!dataSenderOk(event)) return { ok: false, error: 'denied' };
  if (writeBlocked()) return { ok: false, error: 'needs-working-copy' };
  try {
    const root = dataWriteRoot();
    const n = safeDataRel(rel);
    if (!root || !n) return { ok: false, error: 'bad path' };
    const dest = path.join(root, n);
    const r = path.relative(root, dest);
    if (r.startsWith('..') || path.isAbsolute(r)) return { ok: false, error: 'bad path' };
    if (!isFile(dest)) return { ok: true, existed: false };
    fs.unlinkSync(dest);
    return { ok: true, existed: true };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
});

// Review-card export backdrop. The rasterising itself lives in theme-backdrop.js
// so it can be required directly by tools/verify-theme-backdrop-export.js and
// tested as the production function rather than as a re-implementation.
//
// Scope: takes a theme id and two integers, returns a PNG data URL (or null),
// touches nothing on disk, and passes no renderer-supplied markup or path.
ipcMain.handle('theme:capture-backdrop', (_event, payload) => {
  if (!dataSenderOk(_event)) return null;
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