// Verify the advanced TUNE / GAIN / Q number boxes fit inside their own rows.
// Run: electron tools/verify-band-rows.js
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
await q("(function(){App.switchTab('eq');var b=document.getElementById('eq-tab-advanced');if(b)b.click();return 'ok';})()");
await new Promise(r=>setTimeout(r,2000));
const d=await q(`(()=>{
  const rows=[['row-tune_m0','eq-f0'],['row-gain_m0','eq-s0_num'],['row-q_m0','eq-q_m0_num']];
  const out=[];
  rows.forEach(function(p){
    const row=document.getElementById(p[0]), inp=document.getElementById(p[1]);
    if(!row||!inp){ out.push({row:p[0],input:p[1],missing:true}); return; }
    const rr=row.getBoundingClientRect(), ir=inp.getBoundingClientRect(), cs=getComputedStyle(inp);
    out.push({ row:p[0], input:p[1],
      rowRect:[Math.round(rr.y),Math.round(rr.height)],
      inputRect:[Math.round(ir.y),Math.round(ir.height)],
      cssH:cs.height, cssMinH:cs.minHeight, cssMaxH:cs.maxHeight,
      overhangTop:Math.round(rr.top-ir.top),
      overhangBottom:Math.round(ir.bottom-rr.bottom) });
  });
  // overlap between consecutive boxes
  const a=document.getElementById('eq-f0'), b=document.getElementById('eq-s0_num'), c=document.getElementById('eq-q_m0_num');
  const ov=(x,y)=> x&&y ? Math.round(Math.min(x.getBoundingClientRect().bottom,y.getBoundingClientRect().top)-Math.max(x.getBoundingClientRect().top,y.getBoundingClientRect().top)) : null;
  return { rows:out, overlapTuneGain:ov(a,b), overlapGainQ:ov(b,c) };
})()`);
console.log('RESULT '+JSON.stringify(d,null,1));
const bad = (d.rows||[]).some(r=>r.missing || r.overhangTop>0 || r.overhangBottom>0) || (d.overlapTuneGain||0)>0 || (d.overlapGainQ||0)>0;
console.log(bad?'BAND ROW CHECK FAIL':'BAND ROW CHECK PASS');
const img=await win.webContents.capturePage();
fs.writeFileSync(path.join(os.tmpdir(),'iem-bandrows.png'),img.toPNG());
win.destroy();s.close();app.exit(bad?1:0);})();