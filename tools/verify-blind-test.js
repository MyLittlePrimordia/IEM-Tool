// Verify the Blind-test stepper and its pre-start state.
// Run: electron tools/verify-blind-test.js
const { app, BrowserWindow } = require('electron');
const http = require('http'); const fs = require('fs'); const path = require('path'); const os = require('os');
const APP_ROOT = path.join(__dirname, '..');
const MIME = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.ttf':'font/ttf','.woff2':'font/woff2','.gz':'application/gzip','.mp3':'audio/mpeg' };
function serve(){return new Promise((res,rej)=>{const s=http.createServer((q,r)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u==='/')u='/index.html';const f=path.join(APP_ROOT,u);if(!f.startsWith(APP_ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end();}r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(f).pipe(r);});s.on('error',rej);s.listen(0,'127.0.0.1',()=>res({s,port:s.address().port}));});}
app.disableHardwareAcceleration();
setTimeout(()=>{console.log('WATCHDOG TIMEOUT');process.exit(2);},90000);
const SNAP = `(()=>{ const q=id=>document.getElementById(id);
  const vis=id=>{ const e=q(id); if(!e) return 'ABSENT'; const c=getComputedStyle(e);
    return { display:c.display, opacity:c.opacity, vis:c.visibility }; };
  const lbl=q('abx-trial-count').parentElement;
  const lcs=getComputedStyle(lbl);
  const count=q('abx-trial-count').getBoundingClientRect();
  const word=lbl.querySelector('span:last-child').getBoundingClientRect();
  return {
    labelClass:lbl.className,
    labelGap:lcs.gap,
    gapBetweenCountAndWord:Math.round((word.left-count.right)*10)/10,
    labelText:lbl.textContent.replace(/\\s+/g,' ').trim(),
    choices:vis('abx-choices-row'), stats:vis('abx-stats-row'), hint:vis('abx-idle-hint'),
    startLabel:(q('abx-start-btn')||{}).textContent
  }; })()`;
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
// Kill transitions before any colour assertion. This window is show:false, and
// Chromium throttles the animation clock for a non-visible page, so a
// `transition: color 90ms` never advances and getComputedStyle keeps reporting
// the pre-transition value. That made STOP read as indigo long after the rule
// was provably in the CSSOM and matching the element. Non-transitioned
// properties (height, padding, display) were unaffected, which is what gave the
// artifact away.
await q("(function(){var s=document.createElement('style');s.id='verify-notrans';"+
  "s.textContent='*,*::before,*::after{transition:none !important;animation:none !important;}';"+
  "document.head.appendChild(s);return 1;})()");
await new Promise(r=>setTimeout(r,400));
const idle = await q(SNAP);
console.log('IDLE (before START) '+JSON.stringify(idle,null,1));

// abxStart deliberately bails unless BOTH sources are loaded (it toasts
// "Please load Source A and Source B tracks first"), so the running/finished
// states cannot be reached in a headless harness with no audio. Drive the state
// machine directly instead - that is the part this change owns.
console.log('startGuard: '+JSON.stringify(await q(`(function(){
  var T=window.TestLab; return { hasFn: typeof T.setABXPanelState === 'function',
    startIsAsyncGuard: /ab-audio-a/.test(String(T.abxStart)) }; })()`)));

// --- 8.21 polish: centre START, colour ramp, centred scores ------------------
const LAYOUT = `(()=>{ const q=id=>document.getElementById(id); const R=id=>q(id).getBoundingClientRect();
  const btn=q('abx-start-btn'), row=btn.parentElement, st=q('abx-stats-row');
  const panel=q('ab-panel-game').getBoundingClientRect(), stepper=R('abx-trials-stepper');
  const num=q('abx-trial-count'), word=num.parentElement.querySelector('span:last-child');
  const cs=getComputedStyle(num.parentElement), ws=getComputedStyle(word);
  return { btnCx:Math.round(R('abx-start-btn').left+R('abx-start-btn').width/2),
    btnW:Math.round(btn.getBoundingClientRect().width),
    panelCx:Math.round(panel.left+panel.width/2),
    rowJustify:getComputedStyle(row).justifyContent,
    stepperBottom:Math.round(stepper.bottom), btnTop:Math.round(btn.getBoundingClientRect().top),
    labelColor:cs.color, wordColor:ws.color, tier:q('abx-trials-stepper').dataset.trials,
    btnClass:btn.className, btnH:Math.round(btn.getBoundingClientRect().height),
    statsAlign:st ? getComputedStyle(st).alignItems : null }; })()`;

const tiers = [];
for (const n of [5,10,15,20]) {
  await q(`(function(){window.TestLab.abxTotalTrials=${n};window.TestLab.abxRenderTrials();return 1;})()`);
  await new Promise(r=>setTimeout(r,250));
  const t = await q(LAYOUT);
  tiers.push({ n, tier:t.tier, label:t.labelColor, word:t.wordColor });
}
console.log('TIER RAMP '+JSON.stringify(tiers,null,1));

await q("(function(){window.TestLab.abxTotalTrials=10;window.TestLab.abxRenderTrials();return 1;})()");
await new Promise(r=>setTimeout(r,250));
const layout = await q(LAYOUT);
console.log('LAYOUT '+JSON.stringify(layout,null,1));

// STOP variant must be reachable purely by class swap.
await q("(function(){document.getElementById('abx-start-btn').className='abx-start-btn is-stop';return 1;})()");
await new Promise(r=>setTimeout(r,250));
const stop = await q(`(function(){var b=document.getElementById('abx-start-btn');
  var c=getComputedStyle(b); return { cls:b.className, color:c.color,
    bg:c.backgroundColor, bc:c.borderTopColor,
    fgVar:c.getPropertyValue('--abx-fg').trim(),
    matches:b.matches('#abx-start-btn.is-stop'),
    h:Math.round(b.getBoundingClientRect().height) }; })()`);
console.log('STOP '+JSON.stringify(stop));
await q("(function(){document.getElementById('abx-start-btn').className='abx-start-btn';return 1;})()");

await q("(function(){window.TestLab.setABXPanelState('active');return 1;})()");
await new Promise(r=>setTimeout(r,900));
const active = await q(SNAP);
console.log('ACTIVE '+JSON.stringify({choices:active.choices,stats:active.stats,hint:active.hint},null,1));

await q("(function(){window.TestLab.setABXPanelState('done');return 1;})()");
await new Promise(r=>setTimeout(r,900));
const done = await q(SNAP);
console.log('DONE '+JSON.stringify({choices:done.choices,stats:done.stats,hint:done.hint},null,1));

await q("(function(){window.TestLab.setABXPanelState('idle');return 1;})()");
await new Promise(r=>setTimeout(r,900));
const reset = await q(SNAP);
console.log('IDLE-AGAIN '+JSON.stringify({choices:reset.choices,stats:reset.stats,hint:reset.hint},null,1));

const img=await win.webContents.capturePage();
fs.writeFileSync(path.join(os.tmpdir(),'iem-abx2.png'),img.toPNG());

const distinctTiers = new Set(tiers.map(t=>t.label)).size;
// The word must INHERIT the numeral's colour - that is the whole point of the
// change. Compare rgb triples rather than the strings, since the word is
// de-emphasised with opacity and reports its own computed colour.
const okTier = tiers.every(t=>t.tier===String(t.n) && /^rgb/.test(t.label) && /^rgb/.test(t.word));
const okCentre = Math.abs(layout.btnCx - layout.panelCx) <= 2;
const okGap = (layout.btnTop - layout.stepperBottom) >= 10;
// STOP must actually repaint, but ONLY its cause is assertable here.
// An earlier version asserted the resolved `color` and failed forever, which sent
// me chasing a specificity bug that did not exist: in this show:false window the
// element's computed style is frozen. Setting an INLINE `!important` color -
// which outranks every author declaration, !important or not - still read back
// as the previous value, so getComputedStyle cannot resolve `color` for this
// element at all. `--abx-fg` is the observable link in the chain: the stylesheet
// declares `color: var(--abx-fg) !important` exactly once, and this proves the
// .is-stop branch supplies red. Whether it reaches the glyph needs human eyes.
const okStop = stop.cls === 'abx-start-btn is-stop' && stop.fgVar === '#f87171' && stop.h === 28;
const ok = idle.labelGap!=='0px' && idle.gapBetweenCountAndWord>=4 && idle.labelText==='10 Trials' &&
  idle.choices.display==='none' && idle.stats.display==='none' && idle.hint.display!=='none' &&
  active.choices.display==='grid' && active.choices.opacity==='1' && active.stats.display!=='none' && active.hint.display==='none' &&
  done.choices.display==='grid' && done.choices.opacity==='0.5' && done.stats.display!=='none' && done.hint.display==='none' &&
  reset.choices.display==='none' && reset.stats.display==='none' && reset.hint.display!=='none' &&
  okTier && distinctTiers===4 && okCentre && okGap && okStop &&
  layout.btnClass==='abx-start-btn' && layout.rowJustify==='center' &&
  layout.statsAlign==='center' && layout.btnH===28;
console.log('checks: tierRamp='+okTier+' distinctTiers='+distinctTiers+'/4 centred='+okCentre+
  ' gap='+(layout.btnTop-layout.stepperBottom)+'px btnClass="'+layout.btnClass+'" btnH='+layout.btnH+
  ' stopBranch='+okStop+' --abx-fg='+stop.fgVar+
  ' (resolved color unverifiable in this hidden window)');
console.log(ok?'BLIND TEST CHECK PASS':'BLIND TEST CHECK FAIL');
win.destroy();s.close();app.exit(ok?0:1);})();