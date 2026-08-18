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

// Static build artifacts are immutable once shipped (the app.bundle hash in
// bundle-version.js busts them), so they can be cached aggressively. Data
// files (html/json/gz/audio) stay no-store — they may be replaced on disk
// while the app runs.
const CACHEABLE_EXTENSIONS = new Set([
  '.js', '.css', '.woff2', '.woff', '.ttf', '.otf', '.eot',
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico'
]);

function cacheControlFor(ext) {
  return CACHEABLE_EXTENSIONS.has(ext)
    ? 'public, max-age=31536000, immutable'
    : 'no-store';
}

let mainWindow;
let server;

function crashLogPath() {
  return path.join(app.getPath('userData'), 'crash.log');
}

function logCrash(err) {
  try {
    const line = `${new Date().toISOString()} ${(err && err.stack) || err}\n`;
    fs.appendFileSync(crashLogPath(), line);
  } catch (_) {}
}

process.on('uncaughtException', (err) => {
  logCrash(err);
  console.error('[IEM Tool] Uncaught exception:', err);
});

process.on('unhandledRejection', (reason) => {
  logCrash(reason);
  console.error('[IEM Tool] Unhandled rejection:', reason);
});

function serveFile(filePath, stats, req, res) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
  const fileSize = stats.size;
  const range = req.headers.range;

  if (range) {
    // Single-range only per RFC 7233; suffix form bytes=-N returns the last N bytes.
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!match || (match[1] === '' && match[2] === '')) {
      res.writeHead(416, { 'Content-Range': `bytes */${fileSize}`, 'Connection': 'close' });
      res.end();
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
      res.writeHead(416, { 'Content-Range': `bytes */${fileSize}`, 'Connection': 'close' });
      res.end();
      return;
    }

    const chunkSize = end - start + 1;
    const stream = fs.createReadStream(filePath, { start, end });
    res.writeHead(206, {
      'Content-Type': mimeType,
      'Content-Length': chunkSize,
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': cacheControlFor(ext),
      'Connection': 'close'
    });
    stream.pipe(res);
    stream.on('error', () => { res.end(); });
    return;
  }

  res.writeHead(200, {
    'Content-Type': mimeType,
    'Content-Length': fileSize,
    'Accept-Ranges': 'bytes',
    'Cache-Control': cacheControlFor(ext),
    'Connection': 'close'
  });
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
        const rawPath = decodeURIComponent(req.url.split('?')[0]);
        let filePath = path.normalize(path.join(rootDir, rawPath));

        const relativePath = path.relative(rootDir, filePath);
        const isSafe = (relativePath === '') || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));

        if (!isSafe) {
          res.writeHead(403, { 'Connection': 'close' });
          res.end('Forbidden');
          return;
        }

        fs.stat(filePath, (err, stats) => {
          if (err) {
            res.writeHead(404, { 'Connection': 'close' });
            res.end('Not found');
            return;
          }
          if (stats.isDirectory()) {
            filePath = path.join(filePath, 'index.html');
            fs.stat(filePath, (dirErr, dirStats) => {
              if (dirErr) {
                res.writeHead(404, { 'Connection': 'close' });
                res.end('Not found');
                return;
              }
              serveFile(filePath, dirStats, req, res);
            });
            return;
          }
          serveFile(filePath, stats, req, res);
        });
      } catch (e) {
        res.writeHead(500, { 'Connection': 'close' });
        res.end('Server error');
      }
    });

    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
    server.on('error', reject);
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
  if (server) server.close();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});