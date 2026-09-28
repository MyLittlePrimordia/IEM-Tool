// Measures the PAINTED width of a slider thumb by scanning a screenshot for the
// run of thumb-coloured pixels along the slider's centre line. This settles
// whether the declared `width` is the content box (painted = width + 2*border)
// or already the border box, which changes what ERG-006 actually requires.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const shot = process.argv[2];
const data = fs.readFileSync(shot).toString('base64');

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 200, height: 200 });
  await win.loadURL('data:text/html,<body></body>');
  const res = await win.webContents.executeJavaScript(`(async () => {
    const img = await new Promise((r, j) => { const i = new Image(); i.onload = () => r(i); i.onerror = j; i.src = 'data:image/png;base64,' + ${JSON.stringify(data)}; });
    const cv = document.createElement('canvas');
    cv.width = img.width; cv.height = img.height;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(img, 0, 0);
    return { w: img.width, h: img.height, scale: img.width / 1600, px: Array.from(cx.getImageData(0, 0, img.width, img.height).data) };
  })()`, true);

  const { w, h, scale, px } = res;
  const at = (x, y) => { const i = (y * w + x) * 4; return [px[i], px[i + 1], px[i + 2]]; };
  const isBlue = (x, y) => { const [r, g, b] = at(x, y); return b > 110 && b > r + 30 && g > 60; };

  // Scan each image row for runs of blue; report runs 8..40px wide (thumb-sized).
  const found = [];
  for (let y = 0; y < h; y++) {
    let start = -1;
    for (let x = 0; x <= w; x++) {
      const blue = x < w && isBlue(x, y);
      if (blue && start < 0) start = x;
      else if (!blue && start >= 0) {
        const len = x - start;
        if (len >= 8 && len <= 40) found.push({ y, x0: start, len });
        start = -1;
      }
    }
  }
  // Collapse vertically-adjacent identical runs into one thumb, then keep only
  // substantial ones: a real thumb is ~24 CSS px tall, antialiased glyphs are
  // not. This is what separates the handle from the blue UI text.
  const thumbs = [];
  for (const f of found) {
    const prev = thumbs[thumbs.length - 1];
    if (prev && Math.abs(prev.x0 - f.x0) <= 3 && f.y - prev.yLast <= 3) { prev.yLast = f.y; prev.w = Math.max(prev.w, f.len); continue; }
    thumbs.push({ x0: f.x0, yLast: f.y, w: f.len, y0: f.y });
  }
  const tall = thumbs.filter(t => (t.yLast - t.y0) >= 14);
  const uniq = new Map();
  for (const t of tall) {
    const key = Math.round(t.x0 / 6);
    if (!uniq.has(key)) uniq.set(key, t);
  }
  console.log(`image ${w}x${h}, scale ${scale.toFixed(3)} (image px per CSS px)`);
  console.log(`runs >=14px tall (thumb candidates): ${tall.length}`);
  const list = [...uniq.values()].sort((a, b) => a.x0 - b.x0).slice(0, 20);
  for (const t of list) {
    const cssW = t.w / scale, cssH = (t.yLast - t.y0 + 1) / scale;
    console.log(`  thumb at image x=${t.x0}  painted ${t.w}x${t.yLast - t.y0 + 1}px = ${cssW.toFixed(1)}x${cssH.toFixed(1)} CSS px`);
  }
  app.exit(0);
});
setTimeout(() => app.exit(2), 120000);
