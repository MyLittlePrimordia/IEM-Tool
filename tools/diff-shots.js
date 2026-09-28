// Pixel-diffs two screenshot directories by loading both PNGs into a canvas in
// Electron and comparing RGBA values channel by channel.
//
//   npx electron tools/diff-shots.js <dirA> <dirB>
//
// Exits 1 if any image differs, so it can gate a build.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const dirA = process.argv[2];
const dirB = process.argv[3];

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 200, height: 200 });
  await win.loadURL('data:text/html,<body></body>');

  const names = fs.readdirSync(dirA).filter(f => f.endsWith('.png'));
  let differing = 0;

  for (const name of names) {
    const pa = path.join(dirA, name);
    const pb = path.join(dirB, name);
    if (!fs.existsSync(pb)) { console.log(`  MISSING in B: ${name}`); differing++; continue; }
    const da = fs.readFileSync(pa).toString('base64');
    const db = fs.readFileSync(pb).toString('base64');

    const res = await win.webContents.executeJavaScript(`(async () => {
      const load = (b64) => new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = rej;
        i.src = 'data:image/png;base64,' + b64;
      });
      const [ia, ib] = await Promise.all([load(${JSON.stringify(da)}), load(${JSON.stringify(db)})]);
      if (ia.width !== ib.width || ia.height !== ib.height) {
        return { sizeMismatch: true, a: [ia.width, ia.height], b: [ib.width, ib.height] };
      }
      const c = (img) => {
        const cv = document.createElement('canvas');
        cv.width = img.width; cv.height = img.height;
        const cx = cv.getContext('2d', { willReadFrequently: true });
        cx.drawImage(img, 0, 0);
        return cx.getImageData(0, 0, img.width, img.height).data;
      };
      const A = c(ia), B = c(ib);
      let bad = 0, maxDelta = 0;
      const w = ia.width;
      let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
      for (let i = 0; i < A.length; i += 4) {
        const d = Math.max(
          Math.abs(A[i] - B[i]),
          Math.abs(A[i + 1] - B[i + 1]),
          Math.abs(A[i + 2] - B[i + 2]),
          Math.abs(A[i + 3] - B[i + 3])
        );
        if (d > 0) {
          bad++;
          if (d > maxDelta) maxDelta = d;
          const p = i / 4, px = p % w, py = (p / w) | 0;
          if (px < x0) x0 = px;
          if (px > x1) x1 = px;
          if (py < y0) y0 = py;
          if (py > y1) y1 = py;
        }
      }
      const box = x1 >= 0 ? { x0, y0, x1, y1 } : null;
      return { sizeMismatch: false, total: A.length / 4, bad, maxDelta, box };
    })()`, true);

    if (res.sizeMismatch) {
      console.log(`  ${name}: SIZE MISMATCH ${res.a.join('x')} vs ${res.b.join('x')}`);
      differing++;
    } else if (res.bad === 0) {
      console.log(`  ${name}: IDENTICAL (${res.total} px)`);
    } else {
      const pct = (res.bad / res.total * 100).toFixed(4);
      console.log(`  ${name}: ${res.bad} px differ (${pct}%), max channel delta ${res.maxDelta}`);
      if (res.box) console.log(`      changed region: x ${res.box.x0}..${res.box.x1}, y ${res.box.y0}..${res.box.y1}`);
      differing++;
    }
  }

  console.log(differing === 0 ? '\nIDENTICAL - no visual change' : `\n${differing} image(s) differ`);
  app.exit(differing === 0 ? 0 : 1);
});
setTimeout(() => app.exit(2), 180000);
