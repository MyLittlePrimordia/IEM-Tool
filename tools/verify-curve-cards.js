// Verify the loaded-curve slot cards: role chip, eye/remove buttons and the
// colour swatch must be rounded, and the swatch must match its neighbours' size.
// Run: electron tools/verify-curve-cards.js
const { app, BrowserWindow } = require('electron');
const http = require('http'); const fs = require('fs'); const path = require('path'); const os = require('os');
const APP_ROOT = path.join(__dirname, '..');
const MIME = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.ttf':'font/ttf','.woff2':'font/woff2','.gz':'application/gzip','.mp3':'audio/mpeg','.csv':'text/csv','.txt':'text/plain' };
function serve(){return new Promise((res,rej)=>{const s=http.createServer((q,r)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u==='/')u='/index.html';const f=path.join(APP_ROOT,u);if(!f.startsWith(APP_ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end();}r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(f).pipe(r);});s.on('error',rej);s.listen(0,'127.0.0.1',()=>res({s,port:s.address().port}));});}
app.disableHardwareAcceleration();
setTimeout(()=>{console.log('WATCHDOG TIMEOUT');process.exit(2);},120000);

(async()=>{await app.whenReady();
const {s,port}=await serve();
const win=new BrowserWindow({width:1536,height:821,show:false,frame:false,backgroundColor:'#000000',
  webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,preload:path.join(APP_ROOT,'preload.js')}});
await win.loadURL(`http://127.0.0.1:${port}/index.html?cb=${Date.now()}`);
const q=async js=>{try{return await win.webContents.executeJavaScript(js,true);}catch(e){return {ERR:e.message};}};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

for(let i=0;i<80;i++){ if(await q('!!(window.App && window.EQ)')===true) break; await sleep(500); }
await sleep(2500);
await q("(function(){var s=document.createElement('style');s.textContent="+
  "'*,*::before,*::after{transition:none !important;animation:none !important;}';"+
  "document.head.appendChild(s);return 1;})()");
await q("(function(){App.switchTab('eq');return 1;})()");
await sleep(2500);

// Load a curve by clicking a database row - the real user path, which runs
// PEQDB_Module.toggleCurveSelection and then updateAll -> renderActiveCurvesDock.
// (PEQDB_Module is not exposed as a window property, so poking STATE directly
// is not available.)
await q("(function(){var b=document.getElementById('btn-db-mode'); if(b) b.click(); return 1;})()");
await sleep(1200);
await q(`(function(){
  var heads=document.querySelectorAll('#peqdb-list [data-brand-group] > div[data-cmd]');
  for (var i=0;i<Math.min(2,heads.length);i++) heads[i].click();
  return heads.length; })()`);
await sleep(1500);

// Poll for a LAID-OUT row (brand groups render collapsed, and the list indexes
// asynchronously) and retry the click until a card actually appears. Clicking
// blindly was intermittently a no-op, which made this check flaky rather than
// wrong - but a flaky check is worse than no check.
let seeded = 'no attempt';
for (let attempt = 0; attempt < 6; attempt++) {
  const rowReady = await q(`(function(){
    var rows=document.querySelectorAll('#peqdb-list .peqdb-row-item');
    for (var i=0;i<rows.length;i++){
      var r=rows[i].getBoundingClientRect();
      if (r.width>0 && r.height>0) return 'ready';
    }
    return 'none:'+rows.length; })()`);
  if (rowReady !== 'ready') { await sleep(1500); continue; }
  seeded = await q(`(function(){
    var rows=document.querySelectorAll('#peqdb-list .peqdb-row-item');
    for (var i=0;i<rows.length;i++){
      var r=rows[i].getBoundingClientRect();
      if (r.width>0 && r.height>0){ rows[i].click(); return 'clicked'; }
    }
    return 'no visible row'; })()`);
  await sleep(1800);
  const cards = await q(`document.querySelectorAll('.curve-role-chip').length`);
  if (cards > 0) { seeded += ' -> cards:' + cards; break; }
  seeded += ' (no card yet)';
  // Nudge the list: expand another group in case this one held a single row
  // whose data has not finished loading.
  await q(`(function(){
    var heads=document.querySelectorAll('#peqdb-list [data-brand-group] > div[data-cmd]');
    if(heads.length) heads[heads.length-1].click(); return 1; })()`);
  await sleep(1200);
}
console.log('seed: ' + JSON.stringify(seeded) +
            ' globals: ' + JSON.stringify(await q(`(function(){
  return { module: typeof window.PEQDB_Module, appState: typeof window.AppState }; })()`)));
await sleep(1200);

const cards = await q(`(function(){
  var out=[];
  // Anchor on the role chip, not a card class: the card carries no radius class
  // of its own because #base-slot > div already pins slot children to --r-xs.
  document.querySelectorAll('.curve-role-chip').forEach(function(chip){
    var card=chip.closest('#base-slot > div, #target-slot > div, #reference-pile > div') || chip.parentElement.parentElement;
    var cc=getComputedStyle(card);
    var rec={ cardRadius:cc.borderTopLeftRadius, chip:null, eye:null, swatch:null, remove:null };
    var r=chip.getBoundingClientRect(), c=getComputedStyle(chip);
    rec.chip={ radius:c.borderTopLeftRadius, w:Math.round(r.width), h:Math.round(r.height),
               text:chip.textContent.trim() };
    var eye=card.querySelector('[data-cmd="PEQDB_Module.toggleVisible"]');
    if(eye){ var r2=eye.getBoundingClientRect(), c2=getComputedStyle(eye);
      rec.eye={ radius:c2.borderTopLeftRadius, w:Math.round(r2.width), h:Math.round(r2.height) }; }
    var sw=card.querySelector('.curve-card-swatch');
    if(sw){ var r3=sw.getBoundingClientRect(), c3=getComputedStyle(sw);
      rec.swatch={ radius:c3.borderTopLeftRadius, w:Math.round(r3.width), h:Math.round(r3.height),
                   glyph:sw.textContent.trim(), fontSize:c3.fontSize,
                   bgInline:sw.style.backgroundColor }; }
    var rm=card.querySelector('[data-cmd="PEQDB_Module.removeCurve"]');
    if(rm){ var r4=rm.getBoundingClientRect(), c4=getComputedStyle(rm);
      rec.remove={ radius:c4.borderTopLeftRadius, w:Math.round(r4.width), h:Math.round(r4.height) }; }
    out.push(rec);
  });
  return out;
})()`);
console.log(JSON.stringify(cards,null,1));

const rounded = v => v && parseFloat(v.radius) > 0;
const c0 = (cards && cards[0]) || null;
const okCard = c0 && rounded({ radius: c0.cardRadius });
const okChip = c0 && rounded(c0.chip);
const okBtns = c0 && rounded(c0.eye) && rounded(c0.remove);
const okSwatch = c0 && rounded(c0.swatch) && c0.swatch.glyph === '\u{1F3A8}';
// The swatch must be the SAME SIZE as its two neighbours - that mismatch was
// the actual complaint, not just the corners. flex-shrink-0 now pins all three
// at 24px (w-6 h-6), so assert the absolute size too: a mere "equal to each
// other" check would pass on three identical 12px buttons.
const sameSize = c0 && c0.swatch && c0.eye && c0.remove &&
  c0.swatch.w === c0.eye.w && c0.swatch.h === c0.eye.h &&
  c0.swatch.w === c0.remove.w && c0.swatch.h === c0.remove.h;
const is24 = v => v && v.w === 24 && v.h === 24;
const okSize = is24(c0 && c0.swatch) && is24(c0 && c0.eye) && is24(c0 && c0.remove);

console.log('checks: card=' + !!okCard + ' chip=' + !!okChip + ' buttons=' + !!okBtns +
            ' swatch=' + !!okSwatch + ' sameSizeAsNeighbours=' + !!sameSize +
            ' all24px=' + !!okSize +
            ' (swatch=' + (c0&&c0.swatch&&c0.swatch.w+'x'+c0.swatch.h) +
            ' eye=' + (c0&&c0.eye&&c0.eye.w+'x'+c0.eye.h) +
            ' chip=' + (c0&&c0.chip&&c0.chip.w+'x'+c0.chip.h) + ')');
const ok = okCard && okChip && okBtns && okSwatch && sameSize && okSize;
console.log(ok ? 'CURVE CARDS CHECK PASS' : 'CURVE CARDS CHECK FAIL');

const img = await win.webContents.capturePage();
fs.writeFileSync(path.join(os.tmpdir(), 'iem-cards.png'), img.toPNG());
win.destroy(); s.close(); app.exit(ok ? 0 : 1);})();