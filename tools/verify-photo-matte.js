// Unit tests for the pure helpers behind the u2netp photo matte: letterbox
// resampling, the strength curve, and the magic-wand region grow. Also checks
// the operation-log undo contract, which is the reason fills are stored as
// seeds rather than pixels.
//
// Run: electron tools/verify-photo-matte.js
const { app, BrowserWindow } = require('electron');
const http = require('http'); const fs = require('fs'); const path = require('path');
const APP_ROOT = path.join(__dirname, '..');
const MIME = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.ttf':'font/ttf','.woff2':'font/woff2','.gz':'application/gzip','.mp3':'audio/mpeg','.wasm':'application/wasm','.onnx':'application/octet-stream' };
function serve(){return new Promise((res,rej)=>{const s=http.createServer((q,r)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u==='/')u='/index.html';const f=path.join(APP_ROOT,u);if(!f.startsWith(APP_ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end();}r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(f).pipe(r);});s.on('error',rej);s.listen(0,'127.0.0.1',()=>res({s,port:s.address().port}));});}
app.disableHardwareAcceleration();
setTimeout(()=>{console.log('WATCHDOG TIMEOUT');process.exit(2);},300000);

(async()=>{ await app.whenReady();
const { s, port } = await serve();
const win = new BrowserWindow({ width: 1200, height: 800, show: false,
  webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(APP_ROOT,'preload.js') } });
await win.loadURL(`http://127.0.0.1:${port}/index.html?cb=${Date.now()}`);
const q = async js => { try { return await win.webContents.executeJavaScript(js, true); } catch (e) { return { ERR: e.message }; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
for (let i = 0; i < 80; i++) { if (await q('!!(window.App && typeof IEM_PhotoMatte_test !== "undefined")') === true) break; await sleep(500); }
await sleep(800);

const fails = [];
const check = (name, cond, detail) => {
  if (cond) console.log('  PASS  ' + name + (detail ? ': ' + detail : ''));
  else { console.log('  FAIL  ' + name + (detail ? ': ' + detail : '')); fails.push(name); }
};

console.log('\n[0] Module attached');
const wired = await q(`({
  helper: typeof IEM_PhotoMatte_test,
  infer: typeof IEM_Module.inferPhotoMatte,
  composite: typeof IEM_Module.compositePhotoMatte,
  fill: typeof IEM_Module.addPhotoMatteFill,
  undo: typeof IEM_Module.undoPhotoMatte,
  redo: typeof IEM_Module.redoPhotoMatte,
  strength: typeof IEM_Module.setPhotoMatteStrength
})`);
check('helpers exported for testing', wired.helper === 'object', JSON.stringify(wired));
check('inference entry point attached', wired.infer === 'function');
check('compositor attached', wired.composite === 'function');
check('undo/redo attached', wired.undo === 'function' && wired.redo === 'function');
check('strength setter attached', wired.strength === 'function');

console.log('\n[1] Letterbox: the WHOLE image reaches the model');
// Regression test for a real bug: the letterbox step passed the destination
// size into drawImage's 9-argument SOURCE-crop slots, so the model received the
// top-left corner of the photo blown up to fill the frame. The matte came back
// correct for that crop and was then stretched over the full image, producing a
// cutout with the right shape in the wrong place.
//
// A marker in the BOTTOM-RIGHT corner is the discriminator: under the buggy
// crop it fell outside the sampled region and vanished; under a correct
// letterbox it must survive at the matching position.
const lb = await q(`(function(){
  var T = window.IEM_PhotoMatte_test;
  function make(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var x = c.getContext('2d');
    x.fillStyle = 'rgb(128,128,128)'; x.fillRect(0,0,w,h);
    return { c:c, x:x };
  }
  function sample(box, w, h, srcX, srcY) {
    // Where a pixel at (srcX,srcY) of the source must land in the letterbox.
    var sx = box.x0 + Math.min(box.innerW - 1, Math.floor(srcX / w * box.innerW));
    var sy = box.y0 + Math.min(box.innerH - 1, Math.floor(srcY / h * box.innerH));
    var p = (sy * 320 + sx) * 4;
    return { r: box.data[p], g: box.data[p+1], b: box.data[p+2] };
  }
  var out = {};

  // 1. Square 400x400, white markers hard in BOTH corners.
  var a = make(400, 400);
  a.x.fillStyle = '#ffffff';
  a.x.fillRect(360, 360, 40, 40);
  a.x.fillRect(0, 0, 40, 40);
  var bSquare = T.letterbox(a.c, 320);
  out.square = { innerW:bSquare.innerW, innerH:bSquare.innerH, x0:bSquare.x0, y0:bSquare.y0,
                 br: sample(bSquare, 400, 400, 380, 380),
                 tl: sample(bSquare, 400, 400, 20, 20) };

  // 2. Landscape 600x300 with a marker in the far bottom-right.
  var b = make(600, 300);
  b.x.fillStyle = '#ffffff';
  b.x.fillRect(570, 270, 30, 30);
  var bLand = T.letterbox(b.c, 320);
  out.landscape = { innerW:bLand.innerW, innerH:bLand.innerH, x0:bLand.x0, y0:bLand.y0,
                    aspect: bLand.innerW / bLand.innerH,
                    br: sample(bLand, 600, 300, 590, 290),
                    tl: sample(bLand, 600, 300, 10, 10) };

  // 3. Portrait 300x600, marker bottom-right.
  var c = make(300, 600);
  c.x.fillStyle = '#ffffff';
  c.x.fillRect(270, 570, 30, 30);
  var bPort = T.letterbox(c.c, 320);
  out.portrait = { innerW:bPort.innerW, innerH:bPort.innerH, x0:bPort.x0, y0:bPort.y0,
                   aspect: bPort.innerW / bPort.innerH,
                   br: sample(bPort, 300, 600, 290, 590) };
  return out;
})()`);
const bright = p => p.r > 200 && p.g > 200 && p.b > 200;
check('square photo fills the frame exactly', lb.square.innerW === 320 && lb.square.innerH === 320 && lb.square.x0 === 0 && lb.square.y0 === 0, JSON.stringify(lb.square));
check('square: bottom-right corner survives (regression)', bright(lb.square.br), JSON.stringify(lb.square.br));
check('square: top-left corner survives', bright(lb.square.tl), JSON.stringify(lb.square.tl));
check('landscape is pillarboxed, aspect kept', Math.abs(lb.landscape.aspect - 2) < 0.02, 'aspect=' + lb.landscape.aspect);
// Landscape fills the WIDTH and is padded top/bottom, so it is the inner rect's
// horizontal offset that must be zero and its vertical one centred.
check('landscape fills the width and is centred vertically',
  lb.landscape.innerW === 320 && lb.landscape.x0 === 0 &&
  lb.landscape.y0 === Math.floor((320 - lb.landscape.innerH) / 2),
  JSON.stringify({x0:lb.landscape.x0,y0:lb.landscape.y0,innerW:lb.landscape.innerW,innerH:lb.landscape.innerH}));
check('landscape: bottom-right corner survives (regression)', bright(lb.landscape.br), JSON.stringify(lb.landscape.br));
check('portrait is letterboxed, aspect kept', Math.abs(lb.portrait.aspect - 0.5) < 0.02, 'aspect=' + lb.portrait.aspect);
check('portrait: bottom-right corner survives (regression)', bright(lb.portrait.br), JSON.stringify(lb.portrait.br));

console.log('\n[2] Letterbox resample (no aspect distortion)');
const rs = await q(`(function(){
  var T = window.IEM_PhotoMatte_test;
  // 4x2 source -> 8x4: a horizontal ramp, so any squash/stretch shows up.
  var sw = 4, sh = 2;
  var src = new Float32Array(sw*sh);
  for (var y=0;y<sh;y++) for (var x=0;x<sw;x++) src[y*sw+x] = x/(sw-1);
  var out = T.resizeMask(src, sw, sh, 8, 4);
  return {
    len: out.length,
    first: out[0], last: out[out.length-1],
    mid: out[1*8 + 4]
  };
})()`);
check('output length is dw*dh', rs.len === 32, String(rs.len));
check('ramp spans 0..255 after upscale', rs.first === 0 && rs.last === 255, rs.first + '..' + rs.last);
check('midpoint is a smooth intermediate value (bilinear, not stepped)',
  rs.mid > 0 && rs.mid < 255 && Math.abs(rs.mid - 128) < 70, 'mid ' + rs.mid);
const zero = await q(`(function(){ var T=window.IEM_PhotoMatte_test; var o=T.resizeMask(new Float32Array(0),0,0,0,0); return o.length; })()`);
check('degenerate sizes return an empty mask, not a throw', zero === 0, String(zero));

console.log('\n[2] Strength curve');
const sc = await q(`(function(){
  var T = window.IEM_PhotoMatte_test;
  function run(s){
    var m = new Uint8ClampedArray([0, 64, 128, 192, 255]);
    T.applyStrength(m, s);
    return Array.from(m);
  }
  return { neutral: run(0.5), low: run(0.0), high: run(1.0), undef: run(undefined) };
})()`);
check('0.5 is an exact identity (model output untouched)',
  JSON.stringify(sc.neutral) === '[0,64,128,192,255]', JSON.stringify(sc.neutral));
check('low strength keeps MORE (more opaque) than neutral',
  sc.low[1] > sc.neutral[1] && sc.low[3] > sc.neutral[3], '64->' + sc.low[1] + '  192->' + sc.low[3]);
check('high strength cuts MORE (more transparent) than neutral',
  sc.high[1] < sc.neutral[1] && sc.high[3] < sc.neutral[3], '64->' + sc.high[1] + '  192->' + sc.high[3]);
check('default applies when strength is undefined',
  JSON.stringify(sc.undef) === '[0,64,128,192,255]', JSON.stringify(sc.undef));

console.log('\n[3] Region grow (magic wand)');
const rg = await q(`(function(){
  var T = window.IEM_PhotoMatte_test;
  var W = 40, H = 40;
  // Left half white backdrop, right half mid-grey "product".
  var cv = document.createElement('canvas'); cv.width=W; cv.height=H;
  var cx = cv.getContext('2d');
  cx.fillStyle = '#ffffff'; cx.fillRect(0,0,20,H);
  cx.fillStyle = 'rgb(128,128,128)'; cx.fillRect(20,0,20,H);
  var rgb = T.sourceRGB(cv, W, H);
  // Model says: product fully opaque, backdrop fully opaque too (it MISSED it).
  var mask = new Uint8ClampedArray(W*H).fill(255);
  var removed = T.regionGrow(mask, rgb, W, H, 5, 20);
  var leftOpaque = 0, rightOpaque = 0;
  for (var y=0;y<H;y++){
    for (var x=0;x<20;x++) if (mask[y*W+x] === 255) leftOpaque++;
    for (var x=20;x<W;x++) if (mask[y*W+x] === 255) rightOpaque++;
  }
  // Clicking the PRODUCT is expected to remove the product - that is what a magic
  // wand does, it removes what matches the colour you clicked. The safety
  // property is that it must NOT run on past a colour boundary into the rest of
  // the image, which is what "removed 800 of 1600" versus "removed everything"
  // distinguishes.
  var m2 = new Uint8ClampedArray(W*H).fill(255);
  var removed2 = T.regionGrow(m2, rgb, W, H, 30, 20);
  var leftOpaque2 = 0;
  for (var y=0;y<H;y++) for (var x=0;x<20;x++) if (m2[y*W+x] === 255) leftOpaque2++;
  return {
    removed: removed, leftOpaque: leftOpaque, rightOpaque: rightOpaque,
    removed2: removed2, backdropSurvives: leftOpaque2,
    outOfBounds: T.regionGrow(mask, rgb, W, H, 999, 999)
  };
})()`);
check('clicking missed backdrop removes it', rg.leftOpaque === 0, rg.leftOpaque + ' px still opaque of 800');
check('and leaves the product completely alone', rg.rightOpaque === 800, rg.rightOpaque + '/800 px still opaque');
check('a click is bounded by colour, not by image edge',
  rg.removed2 === 800 && rg.backdropSurvives === 800,
  'removed ' + rg.removed2 + ' of 1600; differently-coloured backdrop kept ' + rg.backdropSurvives + '/800');
check('out-of-bounds seed is a no-op, not a throw', rg.outOfBounds === 0, String(rg.outOfBounds));

console.log('\n[4] Operation-log undo contract');
const undo = await q(`(function(){
  var I = IEM_Module;
  var W = 21, H = 20;
  var cv = document.createElement('canvas'); cv.width=W; cv.height=H;
  var cx = cv.getContext('2d');
  // Three bands: missed backdrop | product | missed backdrop. The two backdrop
  // regions are not 4-connected, so each click must register as its own step.
  cx.fillStyle='#ffffff';        cx.fillRect(0,0,7,H);
  cx.fillStyle='rgb(128,128,128)'; cx.fillRect(7,0,7,H);
  cx.fillStyle='#ffffff';        cx.fillRect(14,0,7,H);
  var base = new Uint8ClampedArray(W*H).fill(255);   // model missed both backdrops
  I._matteSourceCanvas = cv;
  I._matteBaseMask = base;
  I._matteFills = [];
  I._matteRedoStack = [];
  I._matteStrength = 0.5;

  var out = [];
  out.push({ canUndo: I.canUndoPhotoMatte(), canRedo: I.canRedoPhotoMatte() });
  var r1 = I.addPhotoMatteFill(3, 10);
  out.push({ removed: r1, fills: I._matteFills.length, canUndo: I.canUndoPhotoMatte() });
  var r2 = I.addPhotoMatteFill(17, 10);
  out.push({ removed: r2, fills: I._matteFills.length });
  // A third click inside an already-removed region changes nothing, so it must
  // NOT add an undo step - undo should only ever walk real changes.
  var r3 = I.addPhotoMatteFill(3, 10);
  out.push({ removedNoop: r3, fills: I._matteFills.length });
  I.undoPhotoMatte();
  out.push({ fills: I._matteFills.length, canRedo: I.canRedoPhotoMatte() });
  I.redoPhotoMatte();
  out.push({ fills: I._matteFills.length });
  I.setPhotoMatteStrength(0.9);
  out.push({ fillsAfterStrength: I._matteFills.length });
  // Multiple undos then redos in sequence.
  I.undoPhotoMatte(); I.undoPhotoMatte();
  out.push({ afterTwoUndo: I._matteFills.length, canUndo: I.canUndoPhotoMatte(), canRedo: I.canRedoPhotoMatte() });
  I.redoPhotoMatte(); I.redoPhotoMatte();
  out.push({ afterTwoRedo: I._matteFills.length });
  I.resetPhotoMatteFills();
  out.push({ afterReset: I._matteFills.length, canUndo: I.canUndoPhotoMatte() });

  I._matteSourceCanvas = null; I._matteBaseMask = null;
  I._matteFills = []; I._matteRedoStack = [];
  return out;
})()`);
check('nothing to undo or redo on a fresh matte',
  undo[0].canUndo === false && undo[0].canRedo === false, JSON.stringify(undo[0]));
check('one fill removes that region and is undoable',
  undo[1].removed === 140 && undo[1].fills === 1 && undo[1].canUndo === true, JSON.stringify(undo[1]));
check('a second click on a separate region makes a second step',
  undo[2].removed === 140 && undo[2].fills === 2, JSON.stringify(undo[2]));
check('a click that changes nothing adds no undo step',
  undo[3].removedNoop === 0 && undo[3].fills === 2, JSON.stringify(undo[3]));
check('undo pops exactly one and enables redo',
  undo[4].fills === 1 && undo[4].canRedo === true, JSON.stringify(undo[4]));
check('redo restores it', undo[5].fills === 2, JSON.stringify(undo[5]));
check('strength change leaves the fill log intact',
  undo[6].fillsAfterStrength === 2, JSON.stringify(undo[6]));
check('repeated undo walks back down the log',
  undo[7].afterTwoUndo === 0 && undo[7].canUndo === false && undo[7].canRedo === true, JSON.stringify(undo[7]));
check('repeated redo walks forward again',
  undo[8].afterTwoRedo === 2, JSON.stringify(undo[8]));
check('reset clears fills and disables undo',
  undo[9].afterReset === 0 && undo[9].canUndo === false, JSON.stringify(undo[9]));

// A new fill must invalidate the redo stack, or redo would resurrect a branch
// the user had already abandoned.
const branch = await q(`(function(){
  var I = IEM_Module;
  var W = 21, H = 20;
  var cv = document.createElement('canvas'); cv.width=W; cv.height=H;
  var cx = cv.getContext('2d');
  cx.fillStyle='#ffffff'; cx.fillRect(0,0,7,H);
  cx.fillStyle='rgb(128,128,128)'; cx.fillRect(7,0,7,H);
  cx.fillStyle='#ffffff'; cx.fillRect(14,0,7,H);
  I._matteSourceCanvas = cv;
  I._matteBaseMask = new Uint8ClampedArray(W*H).fill(255);
  I._matteFills = []; I._matteRedoStack = []; I._matteStrength = 0.5;
  I.addPhotoMatteFill(3, 10);
  I.addPhotoMatteFill(17, 10);
  I.undoPhotoMatte(); I.undoPhotoMatte();   // back to zero, redo holds both steps
  var redoBefore = I.canRedoPhotoMatte();
  I.addPhotoMatteFill(3, 10);                 // diverges from the undone state
  var redoAfter = I.canRedoPhotoMatte();
  var fillsNow = I._matteFills.length;
  I._matteSourceCanvas = null; I._matteBaseMask = null;
  I._matteFills = []; I._matteRedoStack = [];
  return { redoBefore: redoBefore, redoAfter: redoAfter, fillsNow: fillsNow };
})()`);
check('a new fill clears the redo stack (no branching history)',
  branch.redoBefore === true && branch.redoAfter === false && branch.fillsNow === 1, JSON.stringify(branch));

console.log(fails.length ? '\nPROBLEMS:\n' + fails.map(f => '  - ' + f).join('\n') : '\nPHOTO MATTE CHECK PASS');
console.log(fails.length ? 'PHOTO MATTE CHECK FAIL' : '');
win.destroy(); s.close(); app.exit(fails.length ? 1 : 0);
})();