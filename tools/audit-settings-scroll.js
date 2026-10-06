// Measure the Settings pane at the app's real default window size (1536x821 on
// this machine) and report what overflows.
// Run: electron tools/audit-settings-scroll.js
const { app, BrowserWindow } = require('electron');
const http = require('http'); const fs = require('fs'); const path = require('path'); const os = require('os');
const APP_ROOT = path.join(__dirname, '..');
const MIME = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.ttf':'font/ttf','.woff2':'font/woff2','.gz':'application/gzip','.mp3':'audio/mpeg','.csv':'text/csv','.txt':'text/plain' };
function serve(){return new Promise((res,rej)=>{const s=http.createServer((q,r)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u==='/')u='/index.html';const f=path.join(APP_ROOT,u);if(!f.startsWith(APP_ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end();}r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(f).pipe(r);});s.on('error',rej);s.listen(0,'127.0.0.1',()=>res({s,port:s.address().port}));});}
app.disableHardwareAcceleration();
setTimeout(()=>{console.log('WATCHDOG TIMEOUT');process.exit(2);},120000);

// One window per process: creating a second BrowserWindow after the first was
// destroyed made loadURL fail with ERR_FAILED, which looked like an app bug.
// Run twice:  electron tools/audit-settings-scroll.js 1536
const W = parseInt(process.argv[2], 10) || 1536;
const H = parseInt(process.argv[3], 10) || 821;

(async()=>{await app.whenReady();
const {s,port}=await serve();
const win=new BrowserWindow({width:W,height:H,show:false,frame:false,backgroundColor:'#000000',
  webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,preload:path.join(APP_ROOT,'preload.js')}});
await win.loadURL(`http://127.0.0.1:${port}/index.html?cb=${Date.now()}`);
const q=async js=>{try{return await win.webContents.executeJavaScript(js,true);}catch(e){return {ERR:e.message};}};
for(let i=0;i<80;i++){ if(await q('!!(window.App&&window.EQ)')===true) break; await new Promise(r=>setTimeout(r,500)); }
await new Promise(r=>setTimeout(r,2500));
await q("(function(){App.switchTab('settings');return 1;})()");
await new Promise(r=>setTimeout(r,2000));
const out = await q(`(function(){
    var pane=document.getElementById('pane-settings');
    var sc=document.querySelector('#pane-settings .settings-scroll') ||
           document.querySelector('.settings-scroll');
    if(!sc) return {err:'no .settings-scroll'};
    var cs=getComputedStyle(sc);
    var groups=[];
    sc.querySelectorAll('.settings-group').forEach(function(g){
      var t=g.querySelector('.settings-group-title');
      var r=g.getBoundingClientRect();
      groups.push({ title:t?t.textContent.trim():'?', h:Math.round(r.height) });
    });
    return { size:innerWidth+'x'+innerHeight,
             clientH:sc.clientHeight, scrollH:sc.scrollHeight,
             overflow:sc.scrollHeight-sc.clientHeight,
             overflowY:cs.overflowY, paddingBottom:cs.paddingBottom,
             gap:cs.rowGap,
             paneH:Math.round(pane.getBoundingClientRect().height),
             groupCount:groups.length, groups:groups };
  })()`);
console.log('=== ' + W + 'x' + H + ' ===');
console.log(JSON.stringify(out,null,1));
win.destroy(); s.close(); app.exit(0);})();