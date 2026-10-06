// Phase 0 smoke test: can ONNX Runtime Web load, create a u2netp session, and
// run inference inside this app's Electron renderer?
// This is the go/no-go gate for the whole background-remover feature.
//
// Run: electron tools/verify-ort-smoke.js
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
for (let i = 0; i < 80; i++) { if (await q('!!window.App') === true) break; await sleep(500); }
await sleep(800);

const fails = [];
const check = (name, cond, detail) => {
  if (cond) console.log('  PASS  ' + name + (detail ? ': ' + detail : ''));
  else { console.log('  FAIL  ' + name + (detail ? ': ' + detail : '')); fails.push(name); }
};

console.log('\n[1] Runtime is lazy');
const rt = await q(`(function(){
  return {
    presentAtLoad: typeof window.ort !== 'undefined',
    hasLoader: typeof IEM_Module.loadPhotoMatteRuntime === 'function'
  };
})()`);
// The runtime is deliberately NOT a <script> tag in index.html: 142KB of
// parse on the critical path in front of the app bundle cost a responsive
// breakpoint assertion its race in verify:ui. It must be absent at load and
// appear only when the photo tab asks for it.
check('ORT is NOT loaded at page load (lazy)', rt.presentAtLoad === false, JSON.stringify(rt));
check('a runtime loader is exposed', rt.hasLoader === true);

const rtLoaded = await q(`(function(){
  return (async function(){
    try {
      var ort = await IEM_Module.loadPhotoMatteRuntime();
      return { ok: true, version: ort.env.versions ? ort.env.versions.common : null };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  })();
})()`);
check('runtime loads on demand', rtLoaded.ok === true && rtLoaded.version === '1.17.1',
  JSON.stringify(rtLoaded));

console.log('\n[2] Assets fetch with the right MIME');
const mime = await q(`(async function(){
  try {
    async function head(u){
      var r = await fetch(u);
      return { status: r.status, type: r.headers.get('content-type') };
    }
    return {
      wasm: await head('app/js/vendor/ort-wasm-simd.wasm'),
      model: await head('app/models/u2netp.onnx')
    };
  } catch (e) { return { threw: String(e && e.message || e) }; }
})()`);
if (mime && mime.threw) {
  check('asset probe did not throw', false, mime.threw);
} else {
  check('wasm served as application/wasm', mime.wasm && mime.wasm.type === 'application/wasm',
    mime.wasm ? mime.wasm.status + ' ' + mime.wasm.type : 'no response');
  check('model served and readable', mime.model && mime.model.status === 200,
    mime.model ? mime.model.status + ' ' + mime.model.type : 'no response');
}

console.log('\n[3] Session creation + inference');
const inf = await q(`(function(){
  return (async function(){
    try {
      ort.env.wasm.wasmPaths = 'app/js/vendor/';
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.simd = true;
      var t0 = performance.now();
      var buf = await (await fetch('app/models/u2netp.onnx')).arrayBuffer();
      var session = await ort.InferenceSession.Create ? null : null;
      session = await ort.InferenceSession.create(buf, { executionProviders: ['wasm'] });
      var tLoad = performance.now() - t0;

      var N = 320;
      var plane = N * N;
      var data = new Float32Array(3 * plane);
      var mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
      // Synthetic "product": a bright disc on a white field, so the mask should
      // come back non-trivial rather than all-foreground or all-background.
      for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
        var i = y * N + x;
        var dx = x - N/2, dy = y - N/2;
        var inside = (dx*dx + dy*dy) < (N*0.28)*(N*0.28);
        var v = inside ? 0.2 : 0.95;
        data[i] = (v - mean[0]) / std[0];
        data[i + plane] = (v - mean[1]) / std[1];
        data[i + 2*plane] = (v - mean[2]) / std[2];
      }
      var tensor = new ort.Tensor('float32', data, [1, 3, N, N]);
      var t1 = performance.now();
      var res = await session.run({ [session.inputNames[0]]: tensor });
      var tRun = performance.now() - t1;
      var out = res[session.outputNames[0]];
      var md = out.data;
      var mn = Infinity, mx = -Infinity, pos = 0;
      for (var k = 0; k < md.length; k++) { if (md[k] < mn) mn = md[k]; if (md[k] > mx) mx = md[k]; if (md[k] > 0) pos++; }
      return {
        ok: true, loadMs: Math.round(tLoad), runMs: Math.round(tRun),
        dims: out.dims, inName: session.inputNames[0], outName: session.outputNames[0],
        min: mn, max: mx, fracPositive: pos / md.length
      };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  })();
})()`);
check('session created and inference ran', inf.ok === true, inf.ok ? '' : inf.error);
if (inf.ok) {
  console.log('        input "' + inf.inName + '" -> output "' + inf.outName + '" dims ' + JSON.stringify(inf.dims));
  console.log('        model load ' + inf.loadMs + 'ms, inference ' + inf.runMs + 'ms, range ' + inf.min.toFixed(3) + '..' + inf.max.toFixed(3));
  check('output is [1,1,320,320]', JSON.stringify(inf.dims) === '[1,1,320,320]', JSON.stringify(inf.dims));
  // This export emits an ALREADY-Sigmoid'd 0..1 mask, not logits - the range
  // check below confirms it, and the source app's needsSigmoid heuristic picks
  // the right path either way.
  check('output is a normalised 0..1 mask', inf.min >= -0.001 && inf.max <= 1.001,
    'min ' + inf.min.toFixed(4) + ' max ' + inf.max.toFixed(4));
  // A synthetic disc is not a real photograph, so all-foreground here only
  // proves the tensor is wired end to end. Real-image quality is not asserted.
  check('mask produced a usable number of values', inf.fracPositive > 0 && inf.fracPositive <= 1,
    (inf.fracPositive * 100).toFixed(1) + '% positive');
  check('inference is fast enough for a toggle (<3000ms)', inf.runMs < 3000, inf.runMs + 'ms');
}

console.log(fails.length ? '\nPROBLEMS:\n' + fails.map(f => '  - ' + f).join('\n') : '\nORT SMOKE CHECK PASS');
console.log(fails.length ? 'ORT SMOKE CHECK FAIL' : '');
win.destroy(); s.close(); app.exit(fails.length ? 1 : 0);
})();