// Verify the nine per-theme 3D backdrops.
//  - every theme's pattern actually reaches #app-window (not occluded)
//  - image / position / size lists all have the SAME layer count per theme
//    (they cycle rather than fail, so a mismatch is silent)
//  - no two themes share a pattern
//  - the glow layer is still present and first
// Run: electron tools/verify-theme-backdrop.js
const { app, BrowserWindow } = require('electron');
const http = require('http'); const fs = require('fs'); const path = require('path'); const os = require('os');
const APP_ROOT = path.join(__dirname, '..');
const MIME = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.ttf':'font/ttf','.woff2':'font/woff2','.gz':'application/gzip','.mp3':'audio/mpeg' };
function serve(){return new Promise((res,rej)=>{const s=http.createServer((q,r)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u==='/')u='/index.html';const f=path.join(APP_ROOT,u);if(!f.startsWith(APP_ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end();}r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(f).pipe(r);});s.on('error',rej);s.listen(0,'127.0.0.1',()=>res({s,port:s.address().port}));});}
app.disableHardwareAcceleration();
setTimeout(()=>{console.log('WATCHDOG TIMEOUT');process.exit(2);},180000);

// Count top-level comma-separated layers (rgba() and calc() contain commas).
const layers = v => { let d=0,n=1; for(const ch of v){ if(ch==='(')d++; else if(ch===')')d--; else if(ch===','&&d===0)n++; } return n; };

const READ = `(()=>{
  const w=document.getElementById('app-window');
  const c=getComputedStyle(w);
  const root=getComputedStyle(document.documentElement);
  const cls=Array.from(document.documentElement.classList).find(x=>x.startsWith('theme-'));
  const t=document.querySelector('.'+cls);
  const ts=t?getComputedStyle(t):null;
  return {
    cls:cls,
    accent:root.getPropertyValue('--accent').trim(),
    accentRgb:root.getPropertyValue('--accent-rgb').trim(),
    glow:root.getPropertyValue('--theme-glow-strength').trim(),
    s: ts?ts.getPropertyValue('--s').trim():null,
    tp: ts?ts.getPropertyValue('--tp').trim():null,
    tpFloor: ts?ts.getPropertyValue('--tp-floor').trim():null,
    bgBase: root.getPropertyValue('--bg-base').trim(),
    tpPos: ts?ts.getPropertyValue('--tp-pos').trim():null,
    tpSize: ts?ts.getPropertyValue('--tp-size').trim():null,
    winImage:c.backgroundImage, winPos:c.backgroundPosition,
    winSize:c.backgroundSize, winRepeat:c.backgroundRepeat,
    winBg:c.backgroundColor
  };
})()`;

(async()=>{await app.whenReady();
const {s,port}=await serve();
const win=new BrowserWindow({width:1536,height:821,show:false,frame:false,backgroundColor:'#000000',
  webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,preload:path.join(APP_ROOT,'preload.js')}});
await win.loadURL(`http://127.0.0.1:${port}/index.html?cb=${Date.now()}`);
const q=async js=>{try{return await win.webContents.executeJavaScript(js,true);}catch(e){return {ERR:e.message};}};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
for(let i=0;i<80;i++){ if(await q('!!(window.App&&window.EQ)')===true) break; await sleep(500); }
await sleep(2500);

const ids = await q(`(function(){ return (window.App&&App.builtInThemes?App.builtInThemes:[]).map(function(t){return t.id;}); })()`);
console.log('theme ids: ' + JSON.stringify(ids));
if (!Array.isArray(ids) || ids.length !== 9) { console.log('THEME BACKDROP CHECK FAIL'); win.destroy(); s.close(); app.exit(1); }

const rows = [];
for (const id of ids) {
  await q(`(function(){ App.setGlobalTheme(${JSON.stringify(id)}); return 1; })()`);
  await sleep(650);
  const r = await q(READ);
  const declared = layers(r.tp || 'none');
  const dPos = r.tpPos ? layers(r.tpPos) : 0;
  const dSize = r.tpSize ? layers(r.tpSize) : 0;
  // Computed lists: glow + pattern. Sizes may legitimately be shorter (cycling
  // is intended when every layer wants the same size), but positions must cover
  // every layer or a layer lands somewhere arbitrary.
  const winLayers = layers(r.winImage);
  const winPos = layers(r.winPos);
  rows.push({ id, ...r, declared, dPos, dSize, winLayers, winPos });
  console.log(`${id.padEnd(10)} s=${String(r.s).padEnd(6)} declared=${declared} pos=${dPos} size=${dSize} ` +
              `| win img=${winLayers} pos=${winPos} repeat="${(r.winRepeat||'').replace(/\s+/g,' ').slice(0,30)}"`);
}

let fails = [];
// 1. The pattern must actually be painted on #app-window.
for (const r of rows) {
  const hasGlow = /radial-gradient\(120% 70% at 50% -10%/.test(r.winImage);
  const patternLayers = r.winLayers - 1;
  if (patternLayers < 1) fails.push(r.id + ': pattern not painted on #app-window');
  if (r.declared < 1) fails.push(r.id + ': --tp empty');
  if (!hasGlow) fails.push(r.id + ': glow layer missing');
  // Positions must cover the pattern layers, and the size list must have one
  // entry per layer. background-position/-size/-repeat all CYCLE a short list
  // instead of failing, so a short size list silently hands the next layer
  // `100% 100%` and stretches its pattern across the whole window.
  if (r.winPos - 1 < r.declared) fails.push(r.id + ': position list shorter than image list (' + (r.winPos-1) + ' < ' + r.declared + ')');
  if (r.dSize !== r.declared) fails.push(r.id + ': --tp-size has ' + r.dSize + ' entries for ' + r.declared + ' layers');
  // The repeat list must cover every layer, or a pattern layer stops tiling.
  const repN = layers(r.winRepeat || '');
  if (repN < r.winLayers) fails.push(r.id + ': repeat list (' + repN + ') shorter than layer stack (' + r.winLayers + ')');
  // Every layer after the glow must be set to repeat, not just the first.
  const reps = (r.winRepeat || '').split(/\s*,\s*/);
  for (let i = 1; i < reps.length && i < r.winLayers; i++) {
    if (reps[i] !== 'repeat') { fails.push(r.id + ': layer ' + i + ' would not tile (repeat=' + reps[i] + ')'); break; }
  }
}
// 2. All nine patterns distinct.
const uniqTp = new Set(rows.map(r=>r.tp)).size;
if (uniqTp !== 9) fails.push('only ' + uniqTp + '/9 distinct --tp values');
// 3. Distinct painted backgrounds.
const uniqWin = new Set(rows.map(r=>r.winImage)).size;
if (uniqWin !== 9) fails.push('only ' + uniqWin + '/9 distinct painted background-image values');
// 4. No off-palette colour in a pattern.
   //    Checked against the STYLESHEET TEXT, not the computed value. Computed
   //    custom-property values have var() substituted, so `color-mix(in oklab,
   //    var(--accent) 7%, #050507)` comes back carrying the theme's own accent
   //    hex and the token block's neutrals - every theme trips a naive hex scan
   //    even though nothing is hardcoded in its block. In the source text those
   //    are still `var(--accent)` / `var(--tp-deep)`, and a real leftover from a
   //    source snippet stands out immediately.
   //    #0000 is the transparent shorthand; #0008 and rgba(0,0,0,a) are neutral
   //    shadows. All three are legitimate.
const cssText = fs.readFileSync(path.join(APP_ROOT, 'app', 'css', 'app.css'), 'utf8');
const secStart = cssText.indexOf('8.13 Per-theme backdrop');
const secEnd = cssText.indexOf('8.14', secStart);
if (secStart < 0 || secEnd < 0) {
  fails.push('could not locate the 8.13 per-theme backdrop section in app.css');
} else {
  const section = cssText.slice(secStart, secEnd);
  for (const r of rows) {
    const m = new RegExp('\\.theme-' + r.id + '\\s*\\{([^}]*)\\}').exec(section);
    if (!m) { fails.push(r.id + ': no .theme-' + r.id + ' block in the 8.13 backdrop section'); continue; }
    const stripped = m[1]
      .replace(/#0000/gi, '')
      .replace(/#0008/gi, '')
      .replace(/rgba\(\s*0\s*,\s*0\s*,\s*0\s*,[^)]*\)/gi, '');
    if (/#[0-9a-f]{3,8}/i.test(stripped)) fails.push(r.id + ': hardcoded hex left in .theme-' + r.id);
  }
}
// 4b. A declared --tp-floor must actually win over --bg-base. A floor is the
//     opaque base under the pattern; if it lost, the tile's transparent regions
//     show pure --bg-base and every tile edge becomes a visible square.
for (const r of rows) {
  if (!r.tpFloor) continue;
  if (r.winBg === r.bgBase)
    fails.push(r.id + ': --tp-floor declared but #app-window background is still --bg-base');
  if (/rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/.test(r.winBg))
    fails.push(r.id + ': --tp-floor resolved to a fully transparent background');
}

console.log('\ndistinct --tp: ' + uniqTp + '/9   distinct painted background: ' + uniqWin + '/9');

if (fails.length) { console.log('PROBLEMS:'); fails.forEach(f=>console.log('  - ' + f)); }
else console.log('all nine paint, none occluded, position lists cover their layers, floors win, no hardcoded colours');
const ok = fails.length === 0;
console.log(ok ? 'THEME BACKDROP CHECK PASS' : 'THEME BACKDROP CHECK FAIL');

const img = await win.webContents.capturePage();
fs.writeFileSync(path.join(os.tmpdir(), 'iem-theme.png'), img.toPNG());
win.destroy(); s.close(); app.exit(ok ? 0 : 1);})();