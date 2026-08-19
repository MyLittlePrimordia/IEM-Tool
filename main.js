const { app, BrowserWindow, screen } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
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
  '.mka': 'audio/x-matroska'
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
  return (url && url.includes('?'))
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
    // Rotate once the log grows past a reasonable size so it cannot balloon.
    try {
      if (fs.statSync(logPath).size > MAX_CRASH_LOG_BYTES) {
        fs.renameSync(logPath, logPath + '.old');
      }
    } catch (_) {}
    // Async append: a crash while logging must not block the process.
    fs.appendFile(logPath, line, () => {});
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
    stream.on('error', () => { res.end(); });
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
  stream.on('error', () => { res.end(); });
}

function getAppRoot() {
  return app.getAppPath();
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

    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
    server.on('error', (e) => { logCrash(e); reject(e); });
  });
}

async function createWindow() {
  const rootDir = getAppRoot();
  const port = await startLocalServer(rootDir);

  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: screenWidth,
    height: screenHeight,
    x: 0,
    y: 0,
    minWidth: 360,
    minHeight: 360,
    autoHideMenuBar: true,
    show: false,
    icon: path.join(__dirname, 'icon.png'),
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

  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

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
      try { app.dock.setIcon(path.join(__dirname, 'icon.png')); } catch (e) {}
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