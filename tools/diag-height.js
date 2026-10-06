const { app, BrowserWindow } = require("electron");
const http = require('http'); const fs = require('fs'); const path = require('path');
const R = path.join(__dirname, "..");
const M = { ".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json",".png":"image/png",".svg":"image/svg+xml",".ttf":"font/ttf",".woff2":"font/woff2" };
function serve(){return new Promise((res,rej)=>{const s=http.createServer((q,r)=>{let u=decodeURIComponent(q.url.split("?")[0]);if(u==="/")u="/index.html";const f=path.join(R,u);if(!f.startsWith(R)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end();}r.writeHead(200,{"Content-Type":M[path.extname(f)]||"application/octet-stream"});fs.createReadStream(f).pipe(r);});s.on("error",rej);s.listen(0,"127.0.0.1",()=>res({s,port:s.address().port}));});}
(async()=>{await app.whenReady();const {s,port}=await serve();
const w=new BrowserWindow({width:1229,height:691,show:true,webPreferences:{preload:path.join(R,"preload.js"),contextIsolation:true,sandbox:false}});
await w.loadURL("http://127.0.0.1:"+port+"/index.html");
await new Promise(r=>setTimeout(r,3200));
for (const pane of ["find","testlab"]) {
  await w.webContents.executeJavaScript(`App.switchTab('${pane}');'ok'`).catch(()=>{});
  await new Promise(r=>setTimeout(r,1000));
  const d = await w.webContents.executeJavaScript(`(()=>{
    const chain=[];
    let el=document.getElementById('find-col-results');
    while(el && el!==document.documentElement){
      const cs=getComputedStyle(el); const r=el.getBoundingClientRect();
      chain.push({id:el.id||el.tagName.toLowerCase()+'.'+String(el.className||'').split(' ')[0],
        h:Math.round(r.height), cssH:cs.height, display:cs.display, flex:cs.flex,
        minH:cs.minHeight, align:cs.alignSelf, flexBasis:cs.flexBasis});
      el=el.parentElement;
    }
    return chain;})()`).catch(e=>({err:e.message}));
  console.log("=== pane: "+pane+" ===");
  (d||[]).forEach(c=>console.log("  "+c.id.padEnd(24)+" h="+String(c.h).padStart(4)+" cssH="+String(c.cssH).padEnd(8)+" disp="+c.display+" flex="+String(c.flex).padEnd(14)+" minH="+c.minH+" align="+c.align));
}
w.destroy();s.close();app.quit();})();