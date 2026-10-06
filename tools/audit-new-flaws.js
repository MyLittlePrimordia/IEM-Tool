// Confirm the five newly-reported flaws. Run: electron tools/audit-new-flaws.js
const { app, BrowserWindow } = require('electron');
const http = require('http'); const fs = require('fs'); const path = require('path'); const os = require('os');
const APP_ROOT = path.join(__dirname, '..');
const MIME = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.ttf':'font/ttf','.woff2':'font/woff2','.gz':'application/gzip','.mp3':'audio/mpeg' };
function serve(){return new Promise((res,rej)=>{const s=http.createServer((q,r)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u==='/')u='/index.html';const f=path.join(APP_ROOT,u);if(!f.startsWith(APP_ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end();}r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(f).pipe(r);});s.on('error',rej);s.listen(0,'127.0.0.1',()=>res({s,port:s.address().port}));});}
app.disableHardwareAcceleration();
const RAD = `(e)=>{ if(!e) return 'ABSENT'; const c=getComputedStyle(e), r=e.getBoundingClientRect();
  return { radius:c.borderRadius, bg:c.backgroundColor, border:c.border,
           size:[Math.round(r.width),Math.round(r.height)], vis:c.visibility, op:c.opacity }; }`;
(async()=>{await app.whenReady();
const {s,port}=await serve();
const win=new BrowserWindow({width:1536,height:821,show:true,frame:false,backgroundColor:'#000000',
  webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,preload:path.join(APP_ROOT,'preload.js')}});
await win.loadURL(`http://127.0.0.1:${port}/index.html?cb=${Date.now()}`);
const q=async js=>{try{return await win.webContents.executeJavaScript(js,true);}catch(e){return {ERR:e.message};}};
for(let i=0;i<60;i++){ if(await q('!!(window.App && window.EQ)')===true) break; await new Promise(r=>setTimeout(r,500)); }
await new Promise(r=>setTimeout(r,3000));
const rad = RAD;

console.log('== FLAW 6: blind test, BEFORE Start is pressed ==');
await q("(function(){App.switchTab('testlab');var b=document.getElementById('tl-right-tab-ab');if(b)b.click();return 1;})()");
await new Promise(r=>setTimeout(r,1800));
console.log(JSON.stringify(await q(`(()=>{ const rad=${rad};
  const out={};
  ['abx-trials-prev','abx-trial-count','abx-trials-next'].forEach(id=>out[id]=rad(document.getElementById(id)));
  const lbl=document.getElementById('abx-trial-count');
  if(lbl){const p=lbl.parentElement, pc=getComputedStyle(p);
    out.stepperLabel={cls:p.className, radius:pc.borderRadius, bg:pc.backgroundColor, border:pc.border};}
  // the stats block - is it visible before Start?
  const rows={};
  ['abx-choices-row','abx-start-btn','abx-progress-lbl','abx-confidence-wrapper','abx-status-lbl'].forEach(id=>rows[id]=rad(document.getElementById(id)));
  const start=document.getElementById('abx-start-btn');
  out.beforeStart = rows;
  out.startLabel = start?start.textContent.trim():null;
  out.trialText = lbl?lbl.textContent.trim():null;
  return out; })()`),null,1));

console.log('\n== FLAW 7: ENDGAME legend ==');
await q("(function(){App.switchTab('find');var b=document.getElementById('find-right-tab-endgame');if(b)b.click();return 1;})()");
await new Promise(r=>setTimeout(r,1800));
console.log(JSON.stringify(await q(`(()=>{ const rad=${rad};
  const hits=[]; const w=document.createTreeWalker(document.getElementById('find-right-panel-endgame')||document.body,NodeFilter.SHOW_ELEMENT);
  let n; while(n=w.nextNode()){ const t=(n.textContent||'').trim(); if(/^LEGEND/i.test(t)&&n.children.length<6) hits.push({tag:n.tagName,id:n.id,cls:String(n.className).slice(0,70),...rad(n)}); }
  return hits.slice(0,4); })()`),null,1));

console.log('\n== FLAW 8: find result mini FR graph ==');
console.log(JSON.stringify(await q(`(()=>{ const rad=${rad};
  const c=document.querySelector('canvas[id^="spark"]');
  if(!c) return {note:'no spark canvas yet (needs a search)', sampleIds:[...document.querySelectorAll('#find-results canvas')].map(x=>x.id).slice(0,3)};
  const p=c.parentElement;
  return { canvas:{id:c.id,...rad(c)}, frame:{cls:String(p.className).slice(0,70),...rad(p)},
           hasFindCurveFrameClass: !!document.querySelector('.find-curve-frame') }; })()`),null,1));

console.log('\n== FLAW 9: EQ database filename box ==');
await q("(function(){App.switchTab('eq');var b=document.getElementById('btn-db-mode');if(b)b.click();return 1;})()");
await new Promise(r=>setTimeout(r,2500));
console.log(JSON.stringify(await q(`(()=>{ const rad=${rad};
  const t=document.querySelector('.db-file-marquee-text');
  if(!t) return 'no db filename row rendered';
  const box=t.parentElement, row=box.closest('.peqdb-row-item');
  return { text:t.textContent.trim().slice(0,40), box:{cls:String(box.className).slice(0,80),...rad(box)},
           outerRow:{...rad(row)} }; })()`),null,1));

console.log('\n== FLAW 10: BASE / TARGET / REF chip (needs a loaded curve) ==');
console.log(JSON.stringify(await q(`(()=>{ const rad=${rad};
  const base=document.getElementById('base-slot');
  if(!base||!base.firstElementChild) return {note:'no curve loaded; static audit says no radius rule exists'};
  const chip=base.querySelector('span');
  return { chipText:chip?chip.textContent.trim():null, chip:chip?{cls:String(chip.className),...rad(chip)}:null,
           buttons:[...base.querySelectorAll('button')].map(b=>({t:b.title.slice(0,24),...rad(b)})) }; })()`),null,1));

const img=await win.webContents.capturePage();
fs.writeFileSync(path.join(os.tmpdir(),'iem-newflaws.png'),img.toPNG());
win.destroy();s.close();app.exit(0);})();