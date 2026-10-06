// Verify the Balance panel's Left/Right/Mono selector: no overlap, no dark slab.
// Run: electron tools/verify-balance-selector.js
const { app, BrowserWindow } = require('electron');
const http = require('http'); const fs = require('fs'); const path = require('path'); const os = require('os');
const APP_ROOT = path.join(__dirname, '..');
const MIME = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.ttf':'font/ttf','.woff2':'font/woff2','.gz':'application/gzip','.mp3':'audio/mpeg' };
function serve(){return new Promise((res,rej)=>{const s=http.createServer((q,r)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u==='/')u='/index.html';const f=path.join(APP_ROOT,u);if(!f.startsWith(APP_ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end();}r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(f).pipe(r);});s.on('error',rej);s.listen(0,'127.0.0.1',()=>res({s,port:s.address().port}));});}
app.disableHardwareAcceleration();
(async()=>{await app.whenReady();
const {s,port}=await serve();
const win=new BrowserWindow({width:1536,height:821,show:true,frame:false,backgroundColor:'#000000',
  webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,preload:path.join(APP_ROOT,'preload.js')}});
await win.loadURL(`http://127.0.0.1:${port}/index.html?cb=${Date.now()}`);
const q=async js=>{try{return await win.webContents.executeJavaScript(js,true);}catch(e){return {ERR:e.message};}};
for(let i=0;i<60;i++){ if(await q('!!(window.App && window.EQ)')===true) break; await new Promise(r=>setTimeout(r,500)); }
await new Promise(r=>setTimeout(r,2500));
await q("(function(){App.switchTab('testlab');var b=document.getElementById('tl-left-tab-balance');if(b)b.click();return 'ok';})()");
await new Promise(r=>setTimeout(r,2000));
const d=await q(`(()=>{
  const s=document.getElementById('channel-tone-selector');
  if(!s) return {error:'absent'};
  const cs=getComputedStyle(s), sr=s.getBoundingClientRect();
  const kids=[...s.children].map(function(e){
    const r=e.getBoundingClientRect(), k=getComputedStyle(e);
    return {id:e.id, x:Math.round(r.x*10)/10, w:Math.round(r.width*10)/10,
            h:Math.round(r.height), radius:k.borderRadius, bg:k.backgroundColor};
  });
  const gaps=[];
  for(var i=1;i<kids.length;i++) gaps.push(Math.round((kids[i].x-(kids[i-1].x+kids[i-1].w))*10)/10);
  const swap=document.getElementById('c-test-swap');
  return { wrapper:{ w:Math.round(sr.width*10)/10, gap:cs.gap, bg:cs.backgroundColor,
                    border:cs.border, radius:cs.borderRadius, padding:cs.padding,
                    h:Math.round(sr.height) },
           kids:kids, gapBetweenButtons:gaps,
           swapRowHeight:swap?Math.round(swap.getBoundingClientRect().height):null,
           EXPECT:{ gap:'4px', wrapperBg:'transparent', pillRadius:'6px', h:'32px = SWAP row' } };
})()`);
console.log('RESULT '+JSON.stringify(d,null,1));
const kids=d.kids||[];
// No overlap (gaps >= 0) AND real separation (gaps >= 3), matching the 4px the
// grid asks for once sub-pixel distribution across 3 tracks is accounted for.
const bad = !!d.error || kids.length!==3 || kids.some(k=>k.radius!=='6px') ||
            (d.gapBetweenButtons||[]).some(g=>g<3) ||
            d.wrapper.bg!=='rgba(0, 0, 0, 0)' || d.wrapper.radius!=='6px' ||
            d.wrapper.h!==32 || kids.some(k=>k.h!==32);
console.log(bad?'BALANCE SELECTOR CHECK FAIL':'BALANCE SELECTOR CHECK PASS');
const img=await win.webContents.capturePage();
fs.writeFileSync(path.join(os.tmpdir(),'iem-balance.png'),img.toPNG());
win.destroy();s.close();app.exit(bad?1:0);})();