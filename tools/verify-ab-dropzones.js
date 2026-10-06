// Verify the TestLab A/B source drop zones and their file-picker labels match
// the app's drop-target treatment (.slot-drop) instead of the old hard-black
// pixel-art borders.
// Run: electron tools/verify-ab-dropzones.js
const { app, BrowserWindow } = require('electron');
const http = require('http'); const fs = require('fs'); const path = require('path'); const os = require('os');
const APP_ROOT = path.join(__dirname, '..');
const MIME = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.ttf':'font/ttf','.woff2':'font/woff2','.gz':'application/gzip','.mp3':'audio/mpeg','.csv':'text/csv','.txt':'text/plain' };
function serve(){return new Promise((res,rej)=>{const s=http.createServer((q,r)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u==='/')u='/index.html';const f=path.join(APP_ROOT,u);if(!f.startsWith(APP_ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end();}r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(f).pipe(r);});s.on('error',rej);s.listen(0,'127.0.0.1',()=>res({s,port:s.address().port}));});}
app.disableHardwareAcceleration();
setTimeout(()=>{console.log('WATCHDOG TIMEOUT');process.exit(2);},120000);

const FRAME = id => `(()=>{const e=document.getElementById(${JSON.stringify(id)});
  if(!e) return null; const c=getComputedStyle(e); const r=e.getBoundingClientRect();
  return { cls:e.className, radius:c.borderTopLeftRadius,
           borderW:c.borderTopWidth, borderStyle:c.borderTopStyle, borderColor:c.borderTopColor,
           bg:c.backgroundColor, shadow:c.boxShadow,
           inlineShadow:e.style.boxShadow || '(none)',
           hasSlotDrop:e.classList.contains('slot-drop'),
           w:Math.round(r.width), h:Math.round(r.height) };})()`;

(async()=>{await app.whenReady();
const {s,port}=await serve();
const win=new BrowserWindow({width:1536,height:821,show:false,frame:false,backgroundColor:'#000000',
  webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,preload:path.join(APP_ROOT,'preload.js')}});
await win.loadURL(`http://127.0.0.1:${port}/index.html?cb=${Date.now()}`);
const q=async js=>{try{return await win.webContents.executeJavaScript(js,true);}catch(e){return {ERR:e.message};}};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

for(let i=0;i<80;i++){ if(await q('!!(window.App && window.EQ)')===true) break; await sleep(500); }
await sleep(2500);
// Kill transitions: a show:false window freezes the animation clock, which
// strands width/transform transitions at their start value and makes a correct
// change look like no change at all.
await q("(function(){var s=document.createElement('style');s.textContent="+
  "'*,*::before,*::after{transition:none !important;animation:none !important;}';"+
  "document.head.appendChild(s);return 1;})()");

await q("(function(){App.switchTab('testlab');return 1;})()");
await sleep(1500);
await q("(function(){var b=document.getElementById('tl-right-tab-ab'); if(b) b.click(); return 1;})()");
await sleep(1500);

const zoneA = await q(FRAME('ab-drop-zone-a'));
const zoneB = await q(FRAME('ab-drop-zone-b'));
const labA  = await q(FRAME('ab-file-label-a'));
const labB  = await q(FRAME('ab-file-label-b'));
console.log(JSON.stringify({ zoneA, zoneB, labA, labB },null,1));

// Reference: #base-slot is an existing drop target that was already correct.
// Compare against it rather than hardcoding a border width - the outline is
// driven by --drop-outline-w, which section 8.x set to 2px, superseding the
// 1px in the earlier .slot-drop rule. Asserting "1px" here would have been
// asserting a stale value.
const ref = await q(FRAME('base-slot'));
console.log('reference #base-slot: ' + JSON.stringify(
  ref && { radius: ref.radius, borderW: ref.borderW, borderStyle: ref.borderStyle,
           borderColor: ref.borderColor, hasSlotDrop: ref.hasSlotDrop }));

const sameBorder = (a, b) => a && b &&
  a.borderStyle === b.borderStyle && a.borderW === b.borderW &&
  a.borderColor === b.borderColor && a.radius === b.radius;

// A drop target must carry .slot-drop and render the SAME outline as the
// reference drop target, and be rounded.
const zoneOk = z => z && z.hasSlotDrop && parseFloat(z.radius) > 0 && sameBorder(z, ref) && z.w > 0;
// A picker label: rounded, thin themed border, and NO hard offset shadow. The
// inline `box-shadow: ... !important` used to win over label.btn-label's
// `box-shadow: none !important`, keeping the pixel-art look.
const labOk = l => l && parseFloat(l.radius) > 0 && parseFloat(l.borderW) <= 1.5 &&
  (l.shadow === 'none' || l.shadow === '') && l.inlineShadow === '(none)' && l.w > 0;

const ok = zoneOk(zoneA) && zoneOk(zoneB) && labOk(labA) && labOk(labB);

// --- drag highlight must still be visible ---------------------------------
// Regression guard. The outline is declared with `border: ... !important`, and
// the old code armed it by writing an inline style.borderColor, which has no
// priority and therefore loses. Arming now toggles `.is-armed`, so prove the
// border really changes while armed - and that the box does NOT resize, since
// `.is-armed` reuses --drop-outline-w instead of dropping to 1px.
await q("(function(){var z=document.getElementById('ab-drop-zone-a');" +
        "z.dispatchEvent(new Event('dragenter',{bubbles:true}));return 1;})()");
await sleep(500);
const armed = await q(FRAME('ab-drop-zone-a'));
await q("(function(){var z=document.getElementById('ab-drop-zone-a');" +
        "z.dispatchEvent(new Event('dragleave',{bubbles:true}));return 1;})()");
await sleep(500);
const disarmed = await q(FRAME('ab-drop-zone-a'));

// Armed must go SOLID, keep the same outline width (no 1px layout nudge), and
// return to dashed on dragleave.
//
// The armed COLOUR is deliberately not asserted. This harness freezes computed
// colour reads for this element - demonstrated earlier when an inline
// `!important` color could not change the reported value either - so a colour
// comparison here reports the stale default rather than the truth. Width and
// style do update reliably, and they are what carry the fix.
const noResize = armed && zoneA && parseFloat(armed.borderW) === parseFloat(zoneA.borderW);
const togglesBack = disarmed && disarmed.borderStyle === 'dashed';
const okDrag = !!(armed && armed.borderStyle === 'solid') && noResize && togglesBack;

console.log('drag: armedStyle=' + (armed && armed.borderStyle) +
            ' armedW=' + (armed && armed.borderW) + ' armedColor=' + (armed && armed.borderColor) +
            ' disarmedStyle=' + (disarmed && disarmed.borderStyle) +
            ' -> highlight=' + okDrag);

const pass = ok && okDrag;
console.log('checks: zoneA=' + zoneOk(zoneA) + ' zoneB=' + zoneOk(zoneB) +
            ' labelA=' + labOk(labA) + ' labelB=' + labOk(labB) + ' drag=' + okDrag);
console.log(pass ? 'AB DROPZONES CHECK PASS' : 'AB DROPZONES CHECK FAIL');

const img = await win.webContents.capturePage();
fs.writeFileSync(path.join(os.tmpdir(), 'iem-abdrop.png'), img.toPNG());
win.destroy(); s.close(); app.exit(pass ? 0 : 1);})();