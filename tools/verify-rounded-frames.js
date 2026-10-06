// Verify the last square-cornered frames: the Find tool-panel brief, EQ-database
// filename strips, and the Find mini curve frame.
// Run: electron tools/verify-rounded-frames.js
const { app, BrowserWindow } = require('electron');
const http = require('http'); const fs = require('fs'); const path = require('path'); const os = require('os');
const APP_ROOT = path.join(__dirname, '..');
const MIME = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.ttf':'font/ttf','.woff2':'font/woff2','.gz':'application/gzip','.mp3':'audio/mpeg','.csv':'text/csv','.txt':'text/plain' };
function serve(){return new Promise((res,rej)=>{const s=http.createServer((q,r)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u==='/')u='/index.html';const f=path.join(APP_ROOT,u);if(!f.startsWith(APP_ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end();}r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(f).pipe(r);});s.on('error',rej);s.listen(0,'127.0.0.1',()=>res({s,port:s.address().port}));});}
app.disableHardwareAcceleration();
setTimeout(()=>{console.log('WATCHDOG TIMEOUT');process.exit(2);},120000);

// Read a frame's resolved geometry. `radius` is the thing under test.
const FRAME = sel => `(()=>{const e=document.querySelector(${JSON.stringify(sel)});
  if(!e) return null; const c=getComputedStyle(e); const r=e.getBoundingClientRect();
  return { radius:c.borderTopLeftRadius, radiusBR:c.borderBottomRightRadius,
           borderW:c.borderTopWidth, borderStyle:c.borderTopStyle,
           w:Math.round(r.width), h:Math.round(r.height) };})()`;

(async()=>{await app.whenReady();
const {s,port}=await serve();
const win=new BrowserWindow({width:1536,height:821,show:false,frame:false,backgroundColor:'#000000',
  webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,preload:path.join(APP_ROOT,'preload.js')}});
await win.loadURL(`http://127.0.0.1:${port}/index.html?cb=${Date.now()}`);
const q=async js=>{try{return await win.webContents.executeJavaScript(js,true);}catch(e){return {ERR:e.message};}};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const click=id=>q("(function(){var b=document.getElementById("+JSON.stringify(id)+"); if(b) b.click(); return 1;})()");

for(let i=0;i<80;i++){ if(await q('!!(window.App && window.EQ)')===true) break; await sleep(500); }
await sleep(2500);

// Disable transitions BEFORE anything renders. `.peqdb-row-item` carries
// `transition: all 0.15s ease` (app.css:3395), so when the EQ tab is hidden the
// rows are inserted at width 0 and then animate out to full width. This window is
// show:false, and Chromium throttles the animation clock for a non-visible page,
// so that transition never advances and every row is stranded at 0x0 - which
// reads exactly like "the CSS did nothing". Same trap as the blind-test STOP
// colour; the fix is the same.
await q("(function(){var s=document.createElement('style');s.id='verify-notrans';"+
  "s.textContent='*,*::before,*::after{transition:none !important;animation:none !important;}';"+
  "document.head.appendChild(s);return 1;})()");
await sleep(500);

// Click the REAL sub-tab buttons. A hidden node still resolves border-radius, so
// asserting on one proves the rule applies but not that anything is painted;
// switching tabs makes each element lay out with a real width so the check is
// about rendering, not just the cascade.
await q("(function(){App.switchTab('find');return 1;})()");
await sleep(2000);

const findFrame = await q(FRAME('.find-curve-frame'));

// Endgame sub-tab -> that panel's .panel-brief lays out. This used to measure
// #endgame-legend, the box that used to sit at the bottom of the Endgame panel;
// that legend has been removed, and .panel-brief is the framed box in the same
// panel now, carrying the same --r-md frame. The selector is SCOPED to the
// Endgame panel on purpose: all four panels own a .panel-brief, and a bare
// '.panel-brief' would resolve the Taste one, which is display:none while
// Endgame is showing and would measure 0x0 - a false failure for the same
// reason the curve frame check needs its tab switched on.
await click('find-right-tab-endgame'); await sleep(1500);
const brief = await q(FRAME('#find-right-panel-endgame .panel-brief'));

// The EQ database list is NOT on the Find tab - it lives in #pane-eq > #eq-col-db,
// so #peqdb-list stays zero-sized until the EQ tab is showing. Measure it there.
await q("(function(){App.switchTab('eq');return 1;})()");
await sleep(2000);
await click('btn-db-mode'); await sleep(1200);

// Brand groups render COLLAPSED: the header gets `data-cmd="toggleBrandGroup"`
// and the rows live in a sibling `.brand-items-container` carrying `hidden`, so
// display:none and every row measures 0x0 until a group is opened. Expand the
// first few, otherwise there is nothing laid out to inspect.
await q(`(function(){
  var heads=document.querySelectorAll('#peqdb-list [data-brand-group] > div[data-cmd]');
  for (var i=0;i<Math.min(3,heads.length);i++) heads[i].click();
  return heads.length; })()`);
await sleep(1500);

// The EQ database indexes itself on load; poll for laid-out filename strips
// rather than reaching into module internals for a global that is not always
// exported as a window property.
let db = {count:0,visible:0,samples:[]};
for (let i=0;i<40;i++){
  db = await q(`(function(){
    var all=document.querySelectorAll('.db-file-name');
    var out=[], vis=0;
    all.forEach(function(e){ var c=getComputedStyle(e); var r=e.getBoundingClientRect();
      if (r.width>0 && r.height>0) { vis++;
        if (out.length<5) out.push({ radius:c.borderTopLeftRadius, radiusBR:c.borderBottomRightRadius,
                 borderW:c.borderTopWidth, w:Math.round(r.width), h:Math.round(r.height) }); } });
    return { count:all.length, visible:vis, samples:out,
             listRows:document.querySelectorAll('#peqdb-list .peqdb-row-item').length };
  })()`);
  if (db.visible > 0) break;
  await sleep(1000);
}

console.log(JSON.stringify({ findFrame, dbFileNames:db, endgameBrief:brief },null,1));

const allCorners = v => v && parseFloat(v.radius) > 0 && parseFloat(v.radiusBR) > 0;
const okFind  = allCorners(findFrame) && findFrame.w > 0;
const okBrief = allCorners(brief) && brief.w > 0;
const okDb    = db.visible > 0 && db.samples.length > 0 && db.samples.every(allCorners);
console.log('checks: findFrame='+okFind+' endgameBrief='+okBrief+
  ' dbFileNames='+okDb+' (total='+db.count+' laidOut='+db.visible+', listRows='+db.listRows+')');
const ok = okFind && okBrief && okDb;
console.log(ok?'ROUNDED FRAMES CHECK PASS':'ROUNDED FRAMES CHECK FAIL');

const img=await win.webContents.capturePage();
fs.writeFileSync(path.join(os.tmpdir(),'iem-frames.png'),img.toPNG());
win.destroy();s.close();app.exit(ok?0:1);})();