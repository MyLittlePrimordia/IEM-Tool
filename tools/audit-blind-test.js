// Inspect the Blind-test trial stepper + pre-start UI state.
// Run: electron tools/audit-blind-test.js
const { app, BrowserWindow } = require('electron');
const http = require('http'); const fs = require('fs'); const path = require('path'); const os = require('os');
const APP_ROOT = path.join(__dirname, '..');
const MIME = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.ttf':'font/ttf','.woff2':'font/woff2','.gz':'application/gzip','.mp3':'audio/mpeg' };
function serve(){return new Promise((res,rej)=>{const s=http.createServer((q,r)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u==='/')u='/index.html';const f=path.join(APP_ROOT,u);if(!f.startsWith(APP_ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end();}r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(f).pipe(r);});s.on('error',rej);s.listen(0,'127.0.0.1',()=>res({s,port:s.address().port}));});}
app.disableHardwareAcceleration();
setTimeout(()=>{console.log('WATCHDOG TIMEOUT');process.exit(2);},90000);
(async()=>{await app.whenReady();
const {s,port}=await serve();
const win=new BrowserWindow({width:1536,height:821,show:false,frame:false,backgroundColor:'#000000',
  webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,preload:path.join(APP_ROOT,'preload.js')}});
await win.loadURL(`http://127.0.0.1:${port}/index.html?cb=${Date.now()}`);
const q=async js=>{try{return await win.webContents.executeJavaScript(js,true);}catch(e){return {ERR:e.message};}};
for(let i=0;i<60;i++){ if(await q('!!(window.App && window.EQ)')===true) break; await new Promise(r=>setTimeout(r,500)); }
await new Promise(r=>setTimeout(r,3000));
await q("(function(){App.switchTab('testlab');var b=document.getElementById('tl-right-tab-ab');if(b)b.click();return 1;})()");
await new Promise(r=>setTimeout(r,2000));

console.log(JSON.stringify(await q(`(()=>{
  const g=(sel)=>{ const e=document.querySelector(sel); if(!e) return 'ABSENT';
    const c=getComputedStyle(e), r=e.getBoundingClientRect();
    return { cls:String(e.className).slice(0,80), radius:c.borderRadius, bg:c.backgroundColor,
             border:c.border, size:[Math.round(r.width),Math.round(r.height)],
             x:Math.round(r.x), y:Math.round(r.y) }; };
  const wrap=document.getElementById('abx-trials-prev').parentElement;
  return {
    stepperWrapper: g('#ab-panel-game .stepper'),
    arrowPrev: g('#abx-trials-prev'),
    arrowNext: g('#abx-trials-next'),
    label: g('#ab-panel-game .stepper-label'),
    trialCount: g('#abx-trial-count'),
    labelText: (document.getElementById('abx-trial-count')||{}).textContent,
    choicesRow: g('#abx-choices-row'),
    statsRow: g('#ab-panel-game .flex.items-center.justify-between.text-xs.font-bold.pt-1'),
    startBtn: g('#abx-start-btn')
  }; })()`),null,1));

await new Promise(r=>setTimeout(r,1500));
const img=await win.webContents.capturePage();
fs.writeFileSync(path.join(os.tmpdir(),'iem-abx.png'),img.toPNG());
console.log('shot ok');
win.destroy();s.close();app.exit(0);})();