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
  '.wav': 'audio/wav'
};

let mainWindow;
let server;

function serveFile(filePath, stats, req, res) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
  const fileSize = stats.size;
  const range = req.headers.range;

  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    let start = match && match[1] ? parseInt(match[1], 10) : 0;
    let end = match && match[2] ? parseInt(match[2], 10) : fileSize - 1;

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
      'Cache-Control': 'no-store',
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
    'Cache-Control': 'no-store',
    'Connection': 'close'
  });
  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
  stream.on('error', () => { res.end(); });
}

function getAppRoot() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'app-files')
    : path.join(__dirname, 'app-files');
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
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}/index.html`);

  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (server) server.close();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});