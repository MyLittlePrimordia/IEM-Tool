// main.js
// This is the "brain" of the desktop app. It does two things:
//   1. Starts a tiny local web server that serves your app's files
//      (index.html, manifest.json, dsp-processor.js, data/, js/, etc.)
//   2. Opens a window and points it at that local server.
//
// WHY A LOCAL SERVER INSTEAD OF JUST OPENING index.html DIRECTLY?
// Opening a file straight off disk (a "file://" URL) is a much stricter,
// flakier environment for fetch() of thousands of oddly-named text files,
// and your AudioWorklet (dsp-processor.js) wants a "secure context" that
// file:// doesn't reliably provide. Serving over http://127.0.0.1 instead
// makes the packaged app behave exactly like it did in a normal browser
// during development — no CORS surprises, no worklet quirks.

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

// Serves one file, honoring an HTTP Range header if the browser sent one.
// Audio/video elements rely on Range support (206 Partial Content + Accept-Ranges)
// to seek and to report a real, finite duration. Without it, Chromium treats the
// resource like an unbounded live stream: duration comes back as Infinity, and any
// attempt to seek just restarts playback from byte 0 instead of moving the playhead.
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
      res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
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
      'Cache-Control': 'no-store'
    });
    stream.pipe(res);
    stream.on('error', () => { res.end(); });
    return;
  }

  res.writeHead(200, {
    'Content-Type': mimeType,
    'Content-Length': fileSize,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store'
  });
  fs.createReadStream(filePath).pipe(res);
}

// Where the actual web app files live.
//  - While developing (npm start): ./app-files next to this file.
//  - Once packaged into an installer: resources/app-files next to the exe.
function getAppRoot() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'app-files')
    : path.join(__dirname, 'app-files');
}

function startLocalServer(rootDir) {
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      try {
        // req.url arrives already percent-encoded by the browser (e.g. spaces as %20,
        // and now that index.html encodes each path segment, things like & and ' too).
        // Decode it back to the real filename so we can find the file on disk.
        const rawPath = decodeURIComponent(req.url.split('?')[0]);
        let filePath = path.normalize(path.join(rootDir, rawPath));

        // Safety check: never allow a request to escape the app-files folder.
        if (!filePath.startsWith(path.normalize(rootDir))) {
          res.writeHead(403);
          res.end('Forbidden');
          return;
        }

        fs.stat(filePath, (err, stats) => {
          if (err) {
            res.writeHead(404);
            res.end('Not found');
            return;
          }
          if (stats.isDirectory()) {
            filePath = path.join(filePath, 'index.html');
            // Re-stat: we just changed filePath to point at the directory's index.html.
            fs.stat(filePath, (dirErr, dirStats) => {
              if (dirErr) {
                res.writeHead(404);
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
        res.writeHead(500);
        res.end('Server error');
      }
    });

    // Port 0 = "give me any free port." Binding to 127.0.0.1 (not 0.0.0.0) means
    // this server is only reachable from this same machine, not the network.
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
    server.on('error', reject);
  });
}

async function createWindow() {
  const rootDir = getAppRoot();
  const port = await startLocalServer(rootDir);

  // Size the window to the actual screen's usable area up front, rather than a fixed
  // 1440x900 guess. Calling .maximize() on a still-hidden (show:false) window is an
  // Electron quirk that doesn't reliably "stick" on every platform — the window can end
  // up shown at its original small size regardless, exactly what you were seeing. Setting
  // real pixel bounds up front sidesteps that quirk entirely.
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: screenWidth,
    height: screenHeight,
    x: 0,
    y: 0,
    // Your app's own CSS switches to a compact "mobile" layout below 1280x750 —
    // enforcing this as the hard floor means resizing can never drop the window
    // into that broken in-between zone.
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
    // Belt-and-suspenders: also flip the actual "maximized" OS flag now that the window
    // already has full-screen-sized bounds, so the restore/double-click-titlebar behavior
    // is correct too.
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
