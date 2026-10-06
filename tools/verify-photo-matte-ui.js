// Verify the background-removal UI: contextual controls, the strength/zoom
// slider swap, the double-click coordinate mapping and the undo keys.
//
// The maths in iem-photo-matte.js is covered by verify-photo-matte.js, which
// runs with no DOM. This file covers the DOM layer that wraps it, and the seam
// between the two - which is where the interesting bugs live: a slider that
// forgets to hand its zoom range back, or a click that resolves to the wrong
// pixel because the preview transform was re-derived instead of inverted.
//
// Run: electron tools/verify-photo-matte-ui.js
const { app, BrowserWindow } = require('electron');
const http = require('http'); const fs = require('fs'); const path = require('path');
const APP_ROOT = path.join(__dirname, '..');
const MIME = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.ttf':'font/ttf','.woff2':'font/woff2','.gz':'application/gzip','.mp3':'audio/mpeg','.wasm':'application/wasm','.onnx':'application/octet-stream' };
function serve(){return new Promise((res,rej)=>{const s=http.createServer((q,r)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u==='/')u='/index.html';const f=path.join(APP_ROOT,u);if(!f.startsWith(APP_ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end();}r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(f).pipe(r);});s.on('error',rej);s.listen(0,'127.0.0.1',()=>res({s,port:s.address().port}));});}
app.disableHardwareAcceleration();
setTimeout(()=>{console.log('WATCHDOG TIMEOUT');process.exit(2);},240000);

(async()=>{ await app.whenReady();
const { s, port } = await serve();
const win = new BrowserWindow({ width: 1400, height: 900, show: false, frame: false,
  webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(APP_ROOT,'preload.js') } });
await win.loadURL(`http://127.0.0.1:${port}/index.html?cb=${Date.now()}`);
const q = async js => { try { return await win.webContents.executeJavaScript(js, true); } catch (e) { return { ERR: e.message }; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
for (let i = 0; i < 80; i++) { if (await q('!!(window.App && typeof IEM_Module !== "undefined")') === true) break; await sleep(500); }
await sleep(1200);

const fails = [];
const check = (name, cond, detail) => {
  if (cond) console.log('  PASS  ' + name + (detail ? ': ' + detail : ''));
  else { console.log('  FAIL  ' + name + (detail ? ': ' + detail : '')); fails.push(name); }
};

// The photo tab is not necessarily the visible one, so layout cannot be relied
// on. Every geometry-dependent assertion below installs a fixed rect and a fixed
// preview transform instead of measuring whatever the theme happens to render.
const SETUP = `(function(){
  var M = IEM_Module;
  // 100x80 source photo, solid mid-grey, so the wand has one flat region.
  var src = document.createElement('canvas');
  src.width = 100; src.height = 80;
  var sc = src.getContext('2d');
  sc.fillStyle = 'rgb(40,40,40)';
  sc.fillRect(0,0,100,80);

  // Model said "all background" (mask 0) except a 20x20 island at (20,20) it
  // wrongly kept. The island is the missed background the user double-clicks.
  var mask = new Uint8ClampedArray(100*80);
  for (var y = 20; y < 40; y++) for (var x = 20; x < 40; x++) mask[y*100+x] = 255;

  M._matteSourceCanvas = src;
  M._matteBaseMask = mask;
  M._matteFills = [];
  M._matteRedoStack = [];
  M._matteBusy = false;
  M.removeWhiteBg = true;
  M.imgScale = 1.75;
  M.imgOffsetX = 0; M.imgOffsetY = 0;
  // renderImagePreviewInternal bails unless rawImageObj is set, even when the
  // matted processedCanvas is what actually gets drawn.
  M.rawImageObj = src;
  // Prime the composite so processedCanvas exists before any click. The click
  // path is gated on the feature being ON, so this fixture has to turn it on.
  M.compositePhotoMatte();

  // Contain-fit geometry: 200x160 canvas showing the 100x80 photo at 1:1, so
  // the photo occupies canvas (50,40)-(150,120) and source px (sx,sy) sits at
  // canvas (50+sx, 40+sy).
  var canvas = document.getElementById('image-preview-canvas');
  canvas.getBoundingClientRect = function(){ return {left:0, top:0, width:200, height:160, right:200, bottom:160}; };
  M._photoDrawRect = { cw:200, ch:160, drawW:100, drawH:80, scale:1, offX:0, offY:0, canvas:canvas };

  // Stub the model so the real toggle path can be exercised without loading
  // ORT or paying for inference in a DOM test.
  M.__realApply = M.applyPhotoMatte;
  M.applyPhotoMatte = function(){ return Promise.resolve(); };
  M.updatePhotoMatteControls();
  return { islandOpaque: Array.prototype.slice.call(mask.slice(20*100+20, 20*100+24)) };
})()`;

const RESIDUE = `(function(){
  var M = IEM_Module;
  var out = { fills: M._matteFills.length, redo: M._matteRedoStack.length };
  // Sample the island the seed should have removed.
  var c = document.createElement('canvas');
  c.width = 100; c.height = 80;
  var x = c.getContext('2d');
  x.drawImage(M.processedCanvas, 0, 0);
  var d = x.getImageData(0,0,100,80).data;
  var opaque = 0;
  for (var yy = 20; yy < 40; yy++) for (var xx = 20; xx < 40; xx++) {
    if (d[(yy*100+xx)*4+3] !== 0) opaque++;
  }
  out.islandOpaque = opaque;
  return out;
})()`;

console.log('\n[1] Legacy remover removed and module attached');
const wiring = await q(`({
  legacyGone: typeof IEM_Module.processWhiteBgRemoval === 'undefined',
  hasUpdate: typeof IEM_Module.updatePhotoMatteControls === 'function',
  hasDblClick: typeof IEM_Module.handlePhotoMatteDoubleClick === 'function',
  hasRerun: typeof IEM_Module.rerunPhotoMatte === 'function',
  wired: !!IEM_Module._matteUIWired
})`);
check('processWhiteBgRemoval no longer exists', wiring.legacyGone === true);
check('updatePhotoMatteControls present', wiring.hasUpdate === true);
check('handlePhotoMatteDoubleClick present', wiring.hasDblClick === true);
check('rerunPhotoMatte present', wiring.hasRerun === true);
check('UI listeners attached on boot', wiring.wired === true);

console.log('\n[1c] Photo-bar controls are rounded');
const rounded = await q(`(function(){
  var pick = function(sel){
    var e = document.querySelector(sel);
    if (!e) return null;
    return { sel:sel, radius:getComputedStyle(e).borderRadius };
  };
  return {
    centre:  pick('#image-controls-bar [data-action*="recenterImage"]'),
    wand:    pick('#btn-transparency-toggle'),
    rerun:   pick('#photo-matte-rerun'),
    // The pair intentionally shares an outer radius only on the outer edges.
    undo:    pick('#photo-matte-undo')
  };
})()`);
check('centre button has a radius', rounded.centre && parseFloat(rounded.centre.radius) > 0, JSON.stringify(rounded.centre));
check('remove-background toggle has a radius (was square)', rounded.wand && parseFloat(rounded.wand.radius) > 0, JSON.stringify(rounded.wand));
check('all photo-bar buttons agree on the radius',
  rounded.centre && rounded.wand && rounded.rerun &&
  rounded.centre.radius === rounded.wand.radius &&
  rounded.wand.radius === rounded.rerun.radius,
  [rounded.centre, rounded.wand, rounded.rerun].map(function(x){return x.radius;}).join(' / '));

console.log('\n[2] Contextual controls hidden while the feature is off');
// Captured before anything toggles, so "restored" can be asserted against the
// markup's own value instead of a hardcoded code point. These glyphs carry
// U+FE0F and have already proved that guessing at their encoding is wrong.
const orig = await q(`(function(){
  var s = document.getElementById('image-zoom-slider');
  var i = document.getElementById('image-slider-icon');
  return { icon:i.textContent, iconCodes:Array.prototype.map.call(i.textContent, function(c){return c.charCodeAt(0);}),
           tooltip:s.getAttribute('data-tooltip'), min:s.min, max:s.max, step:s.step };
})()`);
console.log('        pristine icon code points: [' + orig.iconCodes.join(',') + ']');
const off = await q(`(function(){
  var g = function(id){ var e = document.getElementById(id); return e ? { hidden:e.classList.contains('hidden'), display:getComputedStyle(e).display, disabled:e.disabled } : null; };
  return { rerun:g('photo-matte-rerun'), undo:g('photo-matte-undo'), redo:g('photo-matte-redo'),
           container: document.getElementById('image-preview-container').classList.contains('is-matte-target'),
           status: document.getElementById('photo-matte-status').classList.contains('hidden') };
})()`);
check('re-analyse hidden', off.rerun && off.rerun.hidden === true, JSON.stringify(off.rerun));
check('undo hidden', off.undo && off.undo.hidden === true, JSON.stringify(off.undo));
check('redo hidden', off.redo && off.redo.hidden === true, JSON.stringify(off.redo));
check('hidden means display:none (CSS guard)', off.rerun && off.rerun.display === 'none', off.rerun && off.rerun.display);
check('photo does not claim crosshair cursor', off.container === false);
check('status hidden', off.status === true);

console.log('\n[3] Feature on: controls appear and the slider becomes strength');
const on = await q(`(function(){
  IEM_Module.toggleBgRemoval(true);
  var s = document.getElementById('image-zoom-slider');
  var g = function(id){ var e = document.getElementById(id); return { hidden:e.classList.contains('hidden'), display:getComputedStyle(e).display, disabled:e.disabled }; };
  return { rerun:g('photo-matte-rerun'), undo:g('photo-matte-undo'), redo:g('photo-matte-redo'),
           slider:{ min:s.min, max:s.max, step:s.step, value:s.value,
                    fill:s.style.getPropertyValue('--range-fill') },
           icon: document.getElementById('image-slider-icon').textContent,
           iconCodes: Array.prototype.map.call(document.getElementById('image-slider-icon').textContent, function(c){return c.charCodeAt(0);})
           };
})()`);
check('re-analyse visible', on.rerun.hidden === false && on.rerun.display !== 'none', JSON.stringify(on.rerun));
check('undo visible', on.undo.hidden === false && on.undo.display !== 'none');
check('redo visible', on.redo.hidden === false && on.redo.display !== 'none');
check('slider is now 0..100 step 1', on.slider.min === '0' && on.slider.max === '100' && on.slider.step === '1', JSON.stringify(on.slider));
check('slider shows current strength', on.slider.value === '50', 'value=' + on.slider.value);
check('icon switched away from zoom', on.icon !== orig.icon, 'got ' + JSON.stringify(on.icon) + ' codes [' + on.iconCodes.join(',') + ']');
check('undo/redo disabled with an empty log', on.undo.disabled === true && on.redo.disabled === true);

// The knob and the coloured fill are painted from two different sources: the
// knob from el.value, the fill from --range-fill (app-init.js). Rebinding the
// range changes el.value without firing `input`, so without an explicit
// refresh the fill keeps the ZOOM percentage - here 32% for zoom 1.75 of
// 0.2..5.0 - while the knob sits at 50%. That gap is the "knob is not connected
// to the bar" report.
check('the fill follows the knob after the range swap (not the stale zoom %)',
  on.slider.fill === '50%', 'fill=' + on.slider.fill + ' value=' + on.slider.value);

console.log('\n[3b] Fill returns to the zoom percentage when rebound back');
const refilled = await q(`(function(){
  var M = IEM_Module;
  M.imgScale = 1.75;
  M.toggleBgRemoval(false);
  var s = document.getElementById('image-zoom-slider');
  var fill = s.style.getPropertyValue('--range-fill');
  M.toggleBgRemoval(false);
  return { fill:fill, value:s.value, min:s.min, max:s.max };
})()`);
// 1.75 on 0.2..5.0 is (1.75-0.2)/4.8 = 32.29%.
check('unbinding repaints the fill for the zoom range',
  Math.abs(parseFloat(refilled.fill) - 32.29) < 0.2, JSON.stringify(refilled));

console.log('\n[4] Feature off: the zoom range comes back exactly');
const roundTrip = await q(`(function(){
  // Pin imgScale so the assertion below is about the slider, not app defaults.
  IEM_Module.imgScale = 1.75;
  IEM_Module.toggleBgRemoval(false);
  var s = document.getElementById('image-zoom-slider');
  return { min:s.min, max:s.max, step:s.step, value:s.value,
           imgScale:IEM_Module.imgScale,
           tooltip:s.getAttribute('data-tooltip'),
           icon: document.getElementById('image-slider-icon').textContent,
           iconCodes: Array.prototype.map.call(document.getElementById('image-slider-icon').textContent, function(c){return c.charCodeAt(0);}),
           undoHidden: document.getElementById('photo-matte-undo').classList.contains('hidden') };
})()`);
// The originals are restored as the exact strings that were there before, not
// as re-typed equivalents, so "5.0" comes back as "5.0" and not "5".
check('zoom range restored to the original strings',
  roundTrip.min === orig.min && roundTrip.max === orig.max && roundTrip.step === orig.step,
  JSON.stringify(roundTrip) + ' vs original ' + JSON.stringify({min:orig.min,max:orig.max,step:orig.step}));
check('slider value restored to imgScale', roundTrip.value === '1.75', 'value=' + roundTrip.value);
check('tooltip restored to the original', roundTrip.tooltip === orig.tooltip, String(roundTrip.tooltip));
check('icon restored byte-for-byte to the original',
  roundTrip.icon === orig.icon && JSON.stringify(roundTrip.iconCodes) === JSON.stringify(orig.iconCodes),
  'got codes [' + roundTrip.iconCodes.join(',') + '] vs [' + orig.iconCodes.join(',') + ']');
check('contextual buttons hidden again', roundTrip.undoHidden === true);

console.log('\n[5] updatePhotoMatteControls is idempotent');
const idem = await q(`(function(){
  IEM_Module.toggleBgRemoval(true);
  var snap = function(){ var s=document.getElementById('image-zoom-slider');
    return [s.min,s.max,s.step,s.value,document.getElementById('photo-matte-undo').disabled].join('|'); };
  var a = snap();
  IEM_Module.updatePhotoMatteControls();
  IEM_Module.updatePhotoMatteControls();
  return { a:a, b:snap() };
})()`);
check('two extra calls change nothing', idem.a === idem.b, idem.a + ' vs ' + idem.b);

console.log('\n[6] Double-click coordinate mapping');
await q(SETUP);
const clicks = await q(`(function(){
  var M = IEM_Module;
  var target = document.getElementById('image-preview-container');
  var fire = function(cx, cy){
    target.dispatchEvent(new MouseEvent('dblclick', { clientX:cx, clientY:cy, bubbles:true, cancelable:true }));
  };
  var out = {};

  // Island centre is source (30,30) -> canvas (80,70). Should remove it.
  fire(80, 70);
  out.afterIsland = ${RESIDUE};

  // Background the model already cleared: source (90,70) -> canvas (140,110).
  // Nothing new to remove, so no history entry may be appended.
  var before = M._matteFills.length;
  fire(140, 110);
  out.afterNoop = { added: M._matteFills.length - before, fills: M._matteFills.length };

  // Outside the photo entirely.
  before = M._matteFills.length;
  fire(-40, 70);
  fire(80, -40);
  out.afterOutside = { added: M._matteFills.length - before };

  // A click that misses the photo but is inside the canvas letterbox area.
  before = M._matteFills.length;
  fire(5, 5);
  out.afterCorner = { added: M._matteFills.length - before };

  out.pulse = document.getElementById('image-preview-container').classList.contains('is-matte-pulse');
  return out;
})()`);
check('click on the kept island removes all 400 island pixels',
  clicks.afterIsland.islandOpaque === 0, 'still opaque: ' + clicks.afterIsland.islandOpaque);
check('one fill recorded for that click', clicks.afterIsland.fills === 1, 'fills=' + clicks.afterIsland.fills);
check('re-clicking cleared background records nothing', clicks.afterNoop.added === 0, JSON.stringify(clicks.afterNoop));
check('clicks outside the photo are ignored', clicks.afterOutside.added === 0, JSON.stringify(clicks.afterOutside));
check('click in the canvas letterbox corner is ignored', clicks.afterCorner.added === 0, JSON.stringify(clicks.afterCorner));
check('the container pulses to confirm the fill', clicks.pulse === true);

console.log('\n[7] Undo/redo buttons track the fill log');
const log = await q(`(function(){
  var M = IEM_Module;
  var u = document.getElementById('photo-matte-undo'), r = document.getElementById('photo-matte-redo');
  var out = {};
  M.updatePhotoMatteControls();
  out.withFill = { undo:u.disabled, redo:r.disabled, canUndo:M.canUndoPhotoMatte() };
  M.undoPhotoMatteUI();
  out.afterUndo = { undo:u.disabled, redo:r.disabled, canRedo:M.canRedoPhotoMatte(), fills:M._matteFills.length };
  M.redoPhotoMatteUI();
  out.afterRedo = { undo:u.disabled, redo:r.disabled, fills:M._matteFills.length };
  return out;
})()`);
check('undo enabled with a fill, redo still disabled',
  log.withFill.undo === false && log.withFill.redo === true, JSON.stringify(log.withFill));
check('undo empties the log and enables redo',
  log.afterUndo.fills === 0 && log.afterUndo.undo === true && log.afterUndo.redo === false, JSON.stringify(log.afterUndo));
check('redo restores the fill', log.afterRedo.fills === 1 && log.afterRedo.redo === true, JSON.stringify(log.afterRedo));

console.log('\n[8] Slider routes to strength, not zoom, while active');
const routed = await q(`(function(){
  var M = IEM_Module;
  M.toggleBgRemoval(true);
  M.imgScale = 1.75;
  var s = document.getElementById('image-zoom-slider');
  s.value = '85';
  s.dispatchEvent(new Event('input', { bubbles:true }));
  var active = { strength:M.getPhotoMatteStrength(), scale:M.imgScale };
  // Go back through the real toggle rather than poking removeWhiteBg. The
  // slider's RANGE is what routes the input, and only the toggle restores it,
  // so flipping the flag by hand would leave the slider at 0..100 and make this
  // a test artefact rather than a measurement.
  M.toggleBgRemoval(false);
  M.imgScale = 1.75;
  s.dispatchEvent(new Event('input', { bubbles:true }));
  var passive = { strength:M.getPhotoMatteStrength(), scale:M.imgScale, max:s.max };
  M.toggleBgRemoval(false);
  return { active:active, passive:passive };
})()`);
check('drag set strength to 0.85 and left zoom alone',
  Math.abs(routed.active.strength - 0.85) < 0.001 && routed.active.scale === 1.75, JSON.stringify(routed.active));
check('with the feature off the same slider zooms again',
  routed.passive.scale === 1.75 && routed.passive.max === '5.0', JSON.stringify(routed.passive));

console.log('\n[9] Keyboard undo, and the text-field guard');
// Section 8 ends with the toggle off, which deliberately clears the fill log,
// so this section needs a fresh photo and one real fill to act on.
await q(SETUP);
await q(`(function(){
  document.getElementById('image-preview-container')
    .dispatchEvent(new MouseEvent('dblclick', { clientX:80, clientY:70, bubbles:true, cancelable:true }));
})()`);
const keys = await q(`(function(){
  var M = IEM_Module;
  M.removeWhiteBg = true;
  var out = {};
  var key = function(target, shift){
    target.dispatchEvent(new KeyboardEvent('keydown', { key:'z', ctrlKey:true, shiftKey:!!shift, bubbles:true, cancelable:true }));
  };
  out.fillsBefore = M._matteFills.length;
  key(document, false);
  out.afterCtrlZ = M._matteFills.length;
  out.canRedo = M.canRedoPhotoMatte();

  // Undo must not be stolen from a text field: put a caret in one first.
  var ta = document.createElement('textarea');
  document.body.appendChild(ta);
  ta.focus();
  key(ta, false);
  out.afterCtrlZInText = M._matteFills.length;
  ta.remove();

  key(document, true);
  out.afterRedoShift = M._matteFills.length;
  M.removeWhiteBg = false;
  return out;
})()`);
check('Ctrl+Z undoes the last fill', keys.afterCtrlZ === keys.fillsBefore - 1, JSON.stringify(keys));
check('Ctrl+Z in a textarea is left to the textarea', keys.afterCtrlZInText === keys.afterCtrlZ, JSON.stringify(keys));
check('Ctrl+Shift+Z redoes it', keys.afterRedoShift === keys.fillsBefore, JSON.stringify(keys));

console.log('\n[10] Clearing the photo resets the matte');
const cleared = await q(`(function(){
  var M = IEM_Module;
  M.toggleBgRemoval(true);
  M._matteFills = [{x:1,y:1}];
  M._matteRedoStack = [{x:2,y:2}];
  M._matteBaseMask = new Uint8ClampedArray(10);
  M.clearImage();
  // The wand toggle is deliberately NOT reset by clearImage: the user is about
  // to load another photo and wants the feature already armed. So the
  // contextual buttons stay on screen - what must change is that re-analyse
  // disables itself, because there is no photo left to re-analyse.
  return { src:M._matteSourceCanvas, base:M._matteBaseMask, fills:M._matteFills.length,
           redo:M._matteRedoStack.length, rgbCache:M._matteRGB,
           stillArmed:M.removeWhiteBg,
           rerunDisabled: document.getElementById('photo-matte-rerun').disabled,
           undoDisabled: document.getElementById('photo-matte-undo').disabled };
})()`);
check('source canvas dropped', cleared.src === null);
check('base mask dropped', cleared.base === null);
check('fill and redo logs emptied', cleared.fills === 0 && cleared.redo === 0, JSON.stringify(cleared));
check('packed-RGB cache invalidated', cleared.rgbCache === null);
check('wand stays armed for the next photo', cleared.stillArmed === true);
check('re-analyse and undo disabled with no photo', cleared.rerunDisabled === true && cleared.undoDisabled === true, JSON.stringify(cleared));

await q(`(function(){ IEM_Module.removeWhiteBg = false; IEM_Module.updatePhotoMatteControls(); })()`);

console.log('\n[11] Transparency backdrop under the cutout');
// A dark product on a dark well is invisible once the backdrop is gone, which
// reads as a broken matte. The checkerboard is the difference between "I can
// see the result" and "I cannot tell what happened", so it gets a test.
const bd = await q(SETUP); // section 10 cleared the photo; the backdrop needs one
const backdrop = await q(`(function(){
  var M = IEM_Module;
  var canvas = document.getElementById('image-preview-canvas');
  // 200x100 well holding a 100x80 (1.25) photo, so the contain-fit leaves the
  // left and right corners outside the photo - somewhere the checkerboard must
  // show and the photo must not.
  canvas.parentNode.getBoundingClientRect = function(){ return {width:200, height:100, left:0, top:0, right:200, bottom:100}; };
  canvas.classList.remove('hidden');
  // Pin the zoom: the shared fixture leaves imgScale at 1.75, which overflows
  // the corners this test probes.
  M.imgScale = 1; M.imgOffsetX = 0; M.imgOffsetY = 0;

  var x = canvas.getContext('2d');
  var probe = function(){
    M.renderImagePreviewInternal();
    var d = x.getImageData(4, 4, 1, 1).data;
    var corner = { a:d[3], r:d[0], g:d[1], b:d[2] };
    var seen = {};
    for (var i = 0; i < 200; i += 4) {
      var p = x.getImageData(i, 4, 1, 1).data;
      if (p[3] === 255) seen[p[0]] = 1;
    }
    return { corner:corner, values:Object.keys(seen).map(Number).sort(function(a,b){return a-b;}) };
  };

  // Fingerprint the EXPORT source, render, then fingerprint it again. If the
  // checkerboard leaked into processedCanvas these would differ.
  var sig = function(){
    var c = M.processedCanvas;
    var d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    var s = d.length;
    for (var i = 0; i < d.length; i += 97) s = (s + d[i]) % 99991;
    return s;
  };
  var before = sig();

  M.toggleBgRemoval(true);
  var on = probe();
  var after = sig();

  M.toggleBgRemoval(false);
  var off = probe();
  return { on:on, off:off, exportUnchanged: before === after };
})()`);
const grey = p => p.a === 255 && p.r === p.g && p.b && p.r >= 120 && p.r <= 185;
check('checkerboard paints an opaque grey where the photo is absent', grey(backdrop.on.corner), JSON.stringify(backdrop.on.corner));
check('both checker shades are present (it is a checker, not a fill)',
  backdrop.on.values.length === 2, JSON.stringify(backdrop.on.values));
check('the two shades are the intended mid greys',
  JSON.stringify(backdrop.on.values) === JSON.stringify([138, 168]), JSON.stringify(backdrop.on.values));
check('with the feature off the area is transparent, not grey', backdrop.off.corner.a === 0, JSON.stringify(backdrop.off.corner));

// The checkerboard belongs to the VIEW, not the image. Export reads
// processedCanvas; the preview canvas is display-only.
check('rendering never writes into the exported canvas', backdrop.exportUnchanged === true);

await q(`(function(){ IEM_Module.toggleBgRemoval(false); IEM_Module.updatePhotoMatteControls(); })()`);

console.log('\n' + '='.repeat(64));
if (fails.length) {
  console.log('PHOTO MATTE UI CHECK FAIL - ' + fails.length + ' problem(s):');
  fails.forEach(f => console.log('  - ' + f));
} else {
  console.log('PHOTO MATTE UI CHECK PASS');
}
win.destroy(); s.close(); process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(3); });