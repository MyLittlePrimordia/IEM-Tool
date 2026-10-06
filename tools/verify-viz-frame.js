// Verify the VIZ pane is inset in a card when normal, and edge-to-edge in fullscreen.
// Run: electron tools/verify-viz-frame.js
const { app, BrowserWindow } = require('electron');
const http = require('http'); const fs = require('fs'); const path = require('path'); const os = require('os');
const APP_ROOT = path.join(__dirname, '..');
const MIME = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.ttf':'font/ttf','.woff2':'font/woff2','.gz':'application/gzip','.mp3':'audio/mpeg' };
function serve(){return new Promise((res,rej)=>{const s=http.createServer((q,r)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u==='/')u='/index.html';const f=path.join(APP_ROOT,u);if(!f.startsWith(APP_ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end();}r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(f).pipe(r);});s.on('error',rej);s.listen(0,'127.0.0.1',()=>res({s,port:s.address().port}));});}
app.disableHardwareAcceleration();
// Watchdog: a stuck renderer or the animating visualiser canvas must never keep
// this process alive past its budget - without it a blocked capturePage hangs the
// whole run and prints nothing at all.
setTimeout(() => { console.log('WATCHDOG TIMEOUT'); process.exit(2); }, 90000);
const SNAP = `(withFs)=>{ const pane=document.getElementById('pane-visualizer');
  const frame=pane.firstElementChild, stage=pane.querySelector('.viz-stage');
  const g=e=>{ if(!e) return 'ABSENT'; const c=getComputedStyle(e), r=e.getBoundingClientRect();
    return { radius:c.borderRadius, border:c.border, bg:c.backgroundColor, shadow:c.boxShadow.slice(0,40),
             rect:[Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)] }; };
  return { fullscreen: document.body.classList.contains('viz-fullscreen-active'),
           hasHead: !!pane.querySelector('.viz-head'),
           pane:g(pane), frame:g(frame), stage:g(stage),
           panePadding:getComputedStyle(pane).padding }; }`;
(async()=>{await app.whenReady();
const {s,port}=await serve();
const win=new BrowserWindow({width:1536,height:821,show:true,frame:false,backgroundColor:'#000000',
  webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,preload:path.join(APP_ROOT,'preload.js')}});
await win.loadURL(`http://127.0.0.1:${port}/index.html?cb=${Date.now()}`);
const q=async js=>{try{return await win.webContents.executeJavaScript(js,true);}catch(e){return {ERR:e.message};}};
for(let i=0;i<60;i++){ if(await q('!!(window.App && window.EQ)')===true) break; await new Promise(r=>setTimeout(r,500)); }
await new Promise(r=>setTimeout(r,3000));
await q("App.switchTab('visualizer')");
await new Promise(r=>setTimeout(r,2000));
const normal = await q(`(${SNAP})(false)`);
console.log('NORMAL  '+JSON.stringify(normal,null,1));

await q("document.body.classList.add('viz-fullscreen-active')");
await new Promise(r=>setTimeout(r,1200));
const fs2 = await q(`(${SNAP})(true)`);
console.log('FULLSCREEN  '+JSON.stringify(fs2,null,1));
await q("document.body.classList.remove('viz-fullscreen-active')");
await new Promise(r=>setTimeout(r,1200));
const img=await win.webContents.capturePage();
fs.writeFileSync(path.join(os.tmpdir(),'iem-viz.png'),img.toPNG());

const f=normal.frame||{};
const st=normal.stage||{};
const frameBottom = f.rect ? f.rect[1]+f.rect[3] : 0;
const ok = !normal.fullscreen &&
  f.radius!=='0px' && f.border!=='0px none rgb(242, 243, 245)' &&
  normal.panePadding==='12px' &&
  normal.hasHead===false &&
  parseFloat((st.border||'0px').split(' ')[0])===0 &&
  fs2.frame.radius==='0px' && (fs2.frame.border==='0px none rgb(242, 243, 245)') &&
  fs2.panePadding==='0px';
console.log('stage fills frame: '+(frameBottom>0 && st.rect && st.rect[3]>=f.rect[3]-2));
console.log(ok?'VIZ FRAME CHECK PASS':'VIZ FRAME CHECK FAIL');
win.destroy();s.close();app.exit(ok?0:1);})();