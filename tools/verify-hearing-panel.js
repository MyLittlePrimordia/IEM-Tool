// Verify the redesigned Hearing & Isolation panel: pill progress track, aligned
// meter rows, no leftover segment bar, and the correct action-row column count
// in both the idle and running states.
// Run: electron tools/verify-hearing-panel.js
const { app, BrowserWindow } = require('electron');
const http = require('http'); const fs = require('fs'); const path = require('path'); const os = require('os');
const APP_ROOT = path.join(__dirname, '..');
const MIME = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.ttf':'font/ttf','.woff2':'font/woff2','.gz':'application/gzip','.mp3':'audio/mpeg','.csv':'text/csv','.txt':'text/plain' };
function serve(){return new Promise((res,rej)=>{const s=http.createServer((q,r)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u==='/')u='/index.html';const f=path.join(APP_ROOT,u);if(!f.startsWith(APP_ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end();}r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(f).pipe(r);});s.on('error',rej);s.listen(0,'127.0.0.1',()=>res({s,port:s.address().port}));});}
app.disableHardwareAcceleration();
setTimeout(()=>{console.log('WATCHDOG TIMEOUT');process.exit(2);},150000);

const SNAP = `(()=>{
  const q=id=>document.getElementById(id);
  const R=e=>{const r=e.getBoundingClientRect();return {x:Math.round(r.left),w:Math.round(r.width),h:Math.round(r.height)};};
  const cs=e=>getComputedStyle(e);
  const panel=q('tl-right-panel-hearing');
  const track=document.querySelector('#tl-right-panel-hearing .indexing-progress-track');
  const fill=q('hearing-progress-fill');
  const calRow=q('hearing-cal-row');
  const progRow=track?track.closest('.hearing-meter-row'):null;
  const slider=q('hearing-test-vol');
  const actionRow=document.querySelector('.hearing-action-row');
  const actions=q('hearing-actions');
  return {
    oldSegBarExists: !!q('hearing-seg-bar'),
    oldSegCount: document.querySelectorAll('.hearing-seg').length,
    trackRadius: track?cs(track).borderTopLeftRadius:null,
    trackHeight: track?Math.round(track.getBoundingClientRect().height):null,
    fillWidthInline: fill?fill.style.width:null,
    fillRadius: fill?cs(fill).borderTopLeftRadius:null,
    pct: q('hearing-progress-pct')?q('hearing-progress-pct').textContent:null,
    // Alignment: the slider and the progress track should share left/right edges.
    sliderBox: slider?R(slider):null,
    trackBox: track?R(track):null,
    calRowHidden: calRow?calRow.classList.contains('hidden'):null,
    progRowBox: progRow?R(progRow):null,
    actionCols: actionRow?cs(actionRow).gridTemplateColumns:null,
    actionsClass: actions?actions.className:null,
    startBtnText: q('hearing-test-btn')?q('hearing-test-btn').textContent.trim():null,
    notHeardHidden: q('hearing-not-heard-btn')?q('hearing-not-heard-btn').classList.contains('hidden'):null,
    resetBox: (function(){var b=document.querySelector('[data-action="click_298_TestLab_resetHearingTest"]');return b?R(b):null;})(),
    startBox: q('hearing-test-btn')?R(q('hearing-test-btn')):null,
    startRadius: q('hearing-test-btn')?cs(q('hearing-test-btn')).borderTopLeftRadius:null,
    instructionH: q('hearing-test-instruction')?Math.round(q('hearing-test-instruction').getBoundingClientRect().height):null,
    panelH: panel?Math.round(panel.getBoundingClientRect().height):null
  };
})()`;

(async()=>{await app.whenReady();
const {s,port}=await serve();
const win=new BrowserWindow({width:1536,height:821,show:false,frame:false,backgroundColor:'#000000',
  webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,preload:path.join(APP_ROOT,'preload.js')}});
await win.loadURL(`http://127.0.0.1:${port}/index.html?cb=${Date.now()}`);
const q=async js=>{try{return await win.webContents.executeJavaScript(js,true);}catch(e){return {ERR:e.message};}};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

for(let i=0;i<80;i++){ if(await q('!!(window.App && window.EQ)')===true) break; await sleep(500); }
await sleep(2500);
// show:false freezes the animation clock, which strands width transitions and
// makes a correct change look like no change. Disable transitions up front.
await q("(function(){var s=document.createElement('style');s.textContent="+
  "'*,*::before,*::after{transition:none !important;animation:none !important;}';"+
  "document.head.appendChild(s);return 1;})()");

await q("(function(){App.switchTab('testlab');return 1;})()");
await sleep(1500);
await q("(function(){var b=document.getElementById('tl-right-tab-hearing'); if(b) b.click(); return 1;})()");
await sleep(1800);

const idle = await q(SNAP);
console.log('IDLE ' + JSON.stringify(idle,null,1));

// Drive the running state through the real entry point.
await q("(function(){var b=document.getElementById('hearing-test-btn'); if(b) b.click(); return 1;})()");
await sleep(2000);
const running = await q(SNAP);
console.log('RUNNING ' + JSON.stringify({ actionCols:running.actionCols,
  actionsClass:running.actionsClass, startBtnText:running.startBtnText,
  notHeardHidden:running.notHeardHidden, calRowHidden:running.calRowHidden,
  fillWidthInline:running.fillWidthInline, pct:running.pct },null,1));

const align = a => a && a.sliderBox && a.trackBox &&
  Math.abs(a.sliderBox.x - a.trackBox.x) <= 2 &&
  Math.abs((a.sliderBox.x + a.sliderBox.w) - (a.trackBox.x + a.trackBox.w)) <= 2;

const okNoLegacy = idle.oldSegBarExists === false && idle.oldSegCount === 0 &&
                   running.oldSegCount === 0;
const okTrack = idle.trackRadius && parseFloat(idle.trackRadius) > 10 && idle.trackHeight > 0;
const okAlign = align(idle);
const okIdleCols = idle.actionCols && idle.actionCols.split(' ').length === 1;
const okRunCols = running.actionCols && running.actionCols.split(' ').length === 2;
const okRunState = running.actionsClass.includes('is-running') &&
  running.startBtnText === 'HEARD (+)' && running.notHeardHidden === false;
const okResetFull = idle.resetBox && idle.startBox &&
  Math.abs(idle.resetBox.w - idle.startBox.w) <= 2;
// The first tone legitimately reports 0% (_hearingTestFraction returns
// hearingStep * per + answers/8 * per, and both are 0 at step 0), so asserting
// a non-zero fill after START tests the wrong thing. Drive the updater directly
// instead - that proves the fill is actually wired to the progress fraction.
const wired = await q(`(function(){
  var T=window.TestLab; if(!T) return {err:'no TestLab'};
  T._updateHearingTestUI({progress:0.5});
  var f=document.getElementById('hearing-progress-fill');
  var p=document.getElementById('hearing-progress-pct');
  var mid={w:f.style.width, pct:p.textContent};
  T._updateHearingTestUI({progress:1});
  var end={w:f.style.width, pct:p.textContent};
  T._updateHearingTestUI({progress:0});
  var zero={w:f.style.width, pct:p.textContent};
  return {mid:mid,end:end,zero:zero};
})()`);
console.log('FILL WIRING ' + JSON.stringify(wired));
const okFill = wired && wired.mid && wired.mid.w === '50%' && wired.mid.pct === '50%' &&
  wired.end && wired.end.w === '100%' && wired.end.pct === '100%' &&
  wired.zero && wired.zero.w === '0%';

console.log('checks: noLegacySegs=' + okNoLegacy + ' pillTrack=' + okTrack +
  ' rowsAligned=' + okAlign + ' idleOneCol=' + okIdleCols + ' runTwoCol=' + okRunCols +
  ' runState=' + okRunState + ' resetFullWidth=' + okResetFull + ' fillDriven=' + okFill);
const ok = okNoLegacy && okTrack && okAlign && okIdleCols && okRunCols && okRunState &&
           okResetFull && okFill;
console.log(ok ? 'HEARING PANEL CHECK PASS' : 'HEARING PANEL CHECK FAIL');

const img = await win.webContents.capturePage();
fs.writeFileSync(path.join(os.tmpdir(), 'iem-hearing.png'), img.toPNG());
win.destroy(); s.close(); app.exit(ok ? 0 : 1);})();