// Verify the Smart Import paste field: single-row collapsed with no scrollbar,
// an expand control that opens a large overlay, and no text lost across the
// round trip. Also checks the surrounding DOM structure, because the markup in
// this area has been re-parented more than once.
//
// Run: electron tools/verify-smart-import-expand.js
const { app, BrowserWindow } = require('electron');
const http = require('http'); const fs = require('fs'); const path = require('path');
const APP_ROOT = path.join(__dirname, '..');
const MIME = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.ttf':'font/ttf','.woff2':'font/woff2','.gz':'application/gzip','.mp3':'audio/mpeg' };
function serve(){return new Promise((res,rej)=>{const s=http.createServer((q,r)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u==='/')u='/index.html';const f=path.join(APP_ROOT,u);if(!f.startsWith(APP_ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end();}r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(f).pipe(r);});s.on('error',rej);s.listen(0,'127.0.0.1',()=>res({s,port:s.address().port}));});}
app.disableHardwareAcceleration();
setTimeout(()=>{console.log('WATCHDOG TIMEOUT');process.exit(2);},240000);

(async()=>{ await app.whenReady();
const { s, port } = await serve();
const win = new BrowserWindow({ width: 1400, height: 900, show: false, frame: false,
  webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(APP_ROOT,'preload.js') } });
await win.loadURL(`http://127.0.0.1:${port}/index.html?cb=${Date.now()}`);
const q = async js => { try { return await win.webContents.executeJavaScript(js, true); } catch (e) { return { ERR: e.message }; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
for (let i = 0; i < 80; i++) { if (await q('!!(window.App && typeof EQ_Module !== "undefined")') === true) break; await sleep(500); }
await sleep(1200);

const fails = [];
const check = (name, cond, detail) => {
  if (cond) console.log('  PASS  ' + name + (detail ? ': ' + detail : ''));
  else { console.log('  FAIL  ' + name + (detail ? ': ' + detail : '')); fails.push(name); }
};

// --- structure -------------------------------------------------------------
console.log('\n[1] DOM structure');
const struct = await q(`(function(){
  var ta   = document.getElementById('smart-import-textarea');
  var home = document.getElementById('smart-import-textarea-home');
  var ov   = document.getElementById('smart-import-expand-overlay');
  var slot = document.getElementById('smart-import-expand-slot');
  var modal= document.getElementById('smart-import-modal');
  return {
    hasAll: !!(ta && home && ov && slot && modal),
    modalParent: modal ? modal.parentElement.tagName : null,
    ovParent:    ov ? ov.parentElement.tagName : null,
    // The textarea must live INSIDE the modal's panel, not beside it.
    taInsideModal: !!(modal && modal.contains(ta)),
    homeInsideModal: !!(modal && modal.contains(home)),
    ovHidden: ov ? !ov.classList.contains('is-open') : null,
    ovAria: ov ? ov.getAttribute('aria-modal') : null
  };
})()`);
check('all five nodes exist', struct.hasAll, JSON.stringify(struct).slice(0, 120));
check('overlay is a sibling of the modal, both under body',
  struct.modalParent === 'BODY' && struct.ovParent === 'BODY', struct.modalParent + '/' + struct.ovParent);
check('textarea starts inside the modal', struct.taInsideModal === true);
check('textareas home wrapper inside the modal', struct.homeInsideModal === true);
check('overlay starts closed (no is-open)', struct.ovHidden === true);
check('overlay is aria-modal', struct.ovAria === 'true', String(struct.ovAria));

// --- open the modal and inspect the collapsed field ------------------------
console.log('\n[2] Collapsed field');
// EQ_Module is a top-level `const`, so it is in the global LEXICAL scope and not
// on window. Bare references resolve; window.EQ_Module is undefined.
const api = await q(`({
  show:     typeof EQ_Module.showSmartImportModal,
  expand:   typeof EQ_Module.expandSmartImportField,
  collapse: typeof EQ_Module.collapseSmartImportExpand,
  wired:    typeof EQ_Module._smartImportWireExpand,
  onWindow: typeof window.EQ_Module
})`);
check('all four methods are published on EQ_Module',
  api.show === 'function' && api.expand === 'function' && api.collapse === 'function' && api.wired === 'function',
  JSON.stringify(api));

const openRes = await q('(function(){ try { EQ_Module.showSmartImportModal(); return "ok"; } catch(e){ return "THREW: " + e.message; } })()');
check('showSmartImportModal did not throw', String(openRes).indexOf('THREW') !== 0, String(openRes));
await sleep(600);
const mascot = await q('typeof Mascot');
check('Mascot global exists', mascot !== 'undefined', mascot);
const isOpen = await q(`(function(){
  var m=document.getElementById('smart-import-modal');
  var cs=getComputedStyle(m);
  return { open: m && !m.classList.contains('hidden'), display: cs.display, cls: m ? m.className : null }; })()`);
check('modal is actually open', isOpen.open === true, JSON.stringify(isOpen));
const collapsed = await q(`(function(){
  var ta = document.getElementById('smart-import-textarea');
  var cs = getComputedStyle(ta);
  return { h: ta.clientHeight, scrollH: ta.scrollHeight, clientW: ta.clientWidth,
           overflowY: cs.overflowY, whiteSpace: cs.whiteSpace, rows: ta.rows,
           lineHeight: cs.lineHeight, padTop: cs.paddingTop, padBottom: cs.paddingBottom,
           inHome: ta.parentElement.id === 'smart-import-textarea-home',
           expandBtn: !!document.getElementById('smart-import-expand-btn'),
           ariaExpanded: document.getElementById('smart-import-expand-btn').getAttribute('aria-expanded') };
})()`);
check('collapsed to a single row', collapsed.h > 0 && collapsed.h < 48, 'height ' + collapsed.h + 'px');
// The placeholder read as top-aligned because a textarea does not centre its
// own text. It is centred by making the line box exactly as tall as the field
// with zero vertical padding, so assert both halves of that.
check('collapsed line box matches the field height (text is centred)',
  Math.abs(parseFloat(collapsed.lineHeight) - collapsed.h) <= 1.5,
  'line-height ' + collapsed.lineHeight + ' vs height ' + collapsed.h);
check('collapsed field has no vertical padding', collapsed.padTop === '0px' && collapsed.padBottom === '0px',
  collapsed.padTop + ' / ' + collapsed.padBottom);
// overflow-y:hidden is the definitive "no scrollbar" test. scrollHeight is NOT:
// white-space:pre honours the pasted newlines, so a multi-line value legitimately
// has a scrollHeight far larger than the box while still rendering no scroller.
check('no vertical scrollbar while collapsed (overflow hidden)', collapsed.overflowY === 'hidden', collapsed.overflowY);
check('collapsed content is clipped, not scrolled', collapsed.overflowY === 'hidden', collapsed.overflowY);
check('expand button present', collapsed.expandBtn === true);
check('aria-expanded starts false', collapsed.ariaExpanded === 'false', String(collapsed.ariaExpanded));
check('textarea starts in its home wrapper', collapsed.inHome === true);

// The reported bug was a horizontal scrollbar. A real AutoEQ/Peace paste is ONE
// very long line, so that is what gets pasted here: a long unbroken run first,
// then more lines for the multi-line case.
await q(`(function(){
  var ta = document.getElementById('smart-import-textarea');
  var parts = [];
  for (var i = 0; i < 40; i++) parts.push('Band ' + i + ' : ' + (i*137 % 9000) + ' Hz ' + ((i*7)%20-10) + ' db Q ' + (0.5 + i*0.01).toFixed(2) + ' db');
  ta.value = 'Preamp: -3.0 dB GraphicEQ: ' + parts.join(' ') + ' ||| ' + parts.join('\\n');
  return 1;
})()`);
await sleep(250);
const afterPaste = await q(`(function(){
  var ta = document.getElementById('smart-import-textarea');
  return { scrollH: ta.scrollHeight, h: ta.clientHeight, lines: ta.value.split('\\n').length,
           overflowY: getComputedStyle(ta).overflowY,
           overflowX: getComputedStyle(ta).overflowX,
           scrollW: ta.scrollWidth, clientW: ta.clientWidth };
})()`);
check('still no scroller after a long paste (overflow stays hidden)',
  afterPaste.overflowY === 'hidden' && afterPaste.overflowX === 'hidden',
  'y=' + afterPaste.overflowY + ' x=' + afterPaste.overflowX);
// The reported bug was a HORIZONTAL scrollbar. Prove the value really is wider
// than the box and that overflow-x:hidden is what suppresses the scroller,
// rather than the content happening to fit.
check('long paste IS wider than the box, and clipped rather than scrolled',
  afterPaste.scrollW > afterPaste.clientW && afterPaste.overflowX === 'hidden',
  'content ' + afterPaste.scrollW + 'px wide in a ' + afterPaste.clientW + 'px box, overflow-x:hidden');

// --- expand ----------------------------------------------------------------
console.log('\n[3] Expand');
const beforeVal = afterPaste.lines;
const clickRes = await q('(function(){ try { document.getElementById("smart-import-expand-btn").click(); return "ok"; } catch(e){ return "THREW: " + e.message; } })()');
check('clicking the expand button did not throw', String(clickRes).indexOf('THREW') !== 0, String(clickRes));
const wired = await q('(function(){ try { EQ_Module.expandSmartImportField(); return "ok"; } catch(e){ return "THREW: " + e.message; } })()');
check('expandSmartImportField does not throw', String(wired).indexOf('THREW') !== 0, String(wired));
await sleep(500);
const expanded = await q(`(function(){
  var ta = document.getElementById('smart-import-textarea');
  var ov = document.getElementById('smart-import-expand-overlay');
  var slot = document.getElementById('smart-import-expand-slot');
return { h: ta.clientHeight, inSlot: ta.parentElement === slot,
           ovVisible: ov.classList.contains('is-open'),
           ovDisplay: getComputedStyle(ov).display,
           slotH: slot.getBoundingClientRect().height,
           slotCssH: getComputedStyle(slot).height,
           slotDisplay: getComputedStyle(slot).display,
           panelH: slot.parentElement.getBoundingClientRect().height,
           taCssH: getComputedStyle(ta).height,
           lines: ta.value.split('\\n').length,
           focused: document.activeElement === ta,
           wrapped: getComputedStyle(ta).whiteSpace,
           ariaExpanded: document.getElementById('smart-import-expand-btn').getAttribute('aria-expanded') };
})()`);
check('overlay visible after expand', expanded.ovVisible === true);
check('the SAME textarea was moved into the overlay slot', expanded.inSlot === true);
check('no text lost on expand', expanded.lines === beforeVal, beforeVal + ' lines in, ' + expanded.lines + ' out');
check('field is now tall', expanded.h > 150, 'height ' + expanded.h + 'px (slot ' + Math.round(expanded.slotH) + 'px)');
check('textarea is focused', expanded.focused === true);
check('aria-expanded now true', expanded.ariaExpanded === 'true', String(expanded.ariaExpanded));

// Edit while expanded, then collapse: the edit must survive.
await q(`(function(){ var ta=document.getElementById('smart-import-textarea');
  ta.value = ta.value + '\\nExtra 9999 Hz 3 db Q 1.00 db'; return 1; })()`);
await sleep(150);
const collapseRes = await q('(function(){ try { EQ_Module.collapseSmartImportExpand(); return "ok"; } catch(e){ return "THREW: " + e.message; } })()');
check('collapseSmartImportExpand did not throw', String(collapseRes).indexOf('THREW') !== 0, String(collapseRes));
await sleep(450);
const collapsed2 = await q(`(function(){
  var ta = document.getElementById('smart-import-textarea');
  var ov = document.getElementById('smart-import-expand-overlay');
  return { lines: ta.value.split('\\n').length,
           inHome: ta.parentElement.id === 'smart-import-textarea-home',
           ovHidden: !ov.classList.contains('is-open'),
           h: ta.clientHeight,
           scrollH: ta.scrollHeight,
           overflowY: getComputedStyle(ta).overflowY,
           hasEdit: ta.value.indexOf('Extra 9999 Hz') !== -1 };
})()`);
check('edits made while expanded survive the collapse', collapsed2.hasEdit === true);
check('textarea returned to its home wrapper', collapsed2.inHome === true);
check('overlay closed again', collapsed2.ovHidden === true);
check('collapsed to a single row again', collapsed2.h > 0 && collapsed2.h < 48, 'height ' + collapsed2.h + 'px');
check('and still no scroller after collapsing', collapsed2.overflowY === 'hidden', collapsed2.overflowY);

// --- Esc + process read the same node --------------------------------------
console.log('\n[4] Esc, and processSmartImport still reads the field');
await q('EQ_Module.expandSmartImportField(); return 1;');
await sleep(400);
await q(`(function(){ document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); return 1; })()`);
await sleep(400);
const afterEsc = await q(`(function(){
  var ov=document.getElementById('smart-import-expand-overlay');
  var ta=document.getElementById('smart-import-textarea');
  return { hidden: !ov.classList.contains('is-open'),
           inHome: ta.parentElement.id === 'smart-import-textarea-home' };
})()`);
check('Escape collapses the overlay', afterEsc.hidden === true && afterEsc.inHome === true);

// The id the parser reads must resolve to the one visible element.
const target = await q(`(function(){
  var all = document.querySelectorAll('#smart-import-textarea');
  return { count: all.length, hasValue: !!(document.getElementById('smart-import-textarea')||{}).value };
})()`);
check('exactly one #smart-import-textarea exists', target.count === 1, target.count + ' found');

// --- design requirements ----------------------------------------------------
console.log('\n[5] Popup design');
await q('EQ_Module.expandSmartImportField(); return 1;');
await sleep(450);
const design = await q(`(function(){
  var panel  = document.querySelector('#smart-import-expand-overlay .smart-import-panel');
  var editor = document.querySelector('#smart-import-expand-overlay .smart-import-editor');
  var title  = document.querySelector('#smart-import-expand-overlay .smart-import-panel-title');
  var close  = document.getElementById('smart-import-collapse-btn');
  var hint   = document.querySelector('#smart-import-expand-overlay .smart-import-hint');
  var cs = function(e){ return e ? getComputedStyle(e) : null; };
  var lum = function(str){
    var m = str.match(/[\\d.]+/g); if(!m) return null;
    return 0.2126*(+m[0]) + 0.7152*(+m[1]) + 0.0722*(+m[2]);
  };
  return {
    panelRadius: cs(panel) ? cs(panel).borderRadius : null,
    editorRadius: cs(editor) ? cs(editor).borderRadius : null,
    panelBg: cs(panel) ? cs(panel).backgroundColor : null,
    editorBg: cs(editor) ? cs(editor).backgroundColor : null,
    title: title ? title.textContent.trim() : null,
    closeGlyph: close ? close.textContent.trim() : null,
    hint: hint ? hint.textContent.trim() : null,
    slotInsideEditor: !!(editor && editor.contains(document.getElementById('smart-import-expand-slot')))
  };
})()`);
const lumOf = s => { const m = (s||'').match(/[\d.]+/g); return m ? 0.2126*(+m[0]) + 0.7152*(+m[1]) + 0.0722*(+m[2]) : NaN; };
const px = v => parseFloat(v);

check('panel has rounded corners', px(design.panelRadius) >= 8, design.panelRadius);
check('inner editor box has rounded corners', px(design.editorRadius) >= 6, design.editorRadius);
check('slot sits inside the editor box', design.slotInsideEditor === true);
check('inner box is a lighter shade than the panel',
  lumOf(design.editorBg) > lumOf(design.panelBg),
  'editor ' + design.editorBg + ' vs panel ' + design.panelBg);
// Glyph checks go by codepoint, not by literal: putting these arrows in a
// regular expression is how they get mangled by an editor or a shell layer.
const has = (s, cp) => String(s || '').indexOf(String.fromCodePoint(cp)) !== -1;
check('title uses the diagonal-arrow glyph U+2922, not the four-corners U+29F6/U+26F6',
  has(design.title, 0x2922) && !has(design.title, 0x29F6) && !has(design.title, 0x26F6),
  design.title);
check('title no longer says "Expanded"', !/expanded/i.test(design.title), design.title);
check('close button uses a plain cross (U+2715/2716/00D7)',
  has(design.closeGlyph, 0x2715) || has(design.closeGlyph, 0x2716) || has(design.closeGlyph, 0x00D7),
  'U+' + (design.closeGlyph.codePointAt(0) || 0).toString(16).toUpperCase());
check('hint is shortened', design.hint.length <= 20, JSON.stringify(design.hint));
await q('EQ_Module.collapseSmartImportExpand(); return 1;');
await sleep(300);

console.log(fails.length ? '\nPROBLEMS:\n' + fails.map(f => '  - ' + f).join('\n') : '\nSMART IMPORT EXPAND CHECK PASS');
console.log(fails.length ? 'SMART IMPORT EXPAND CHECK FAIL' : '');
win.destroy(); s.close(); app.exit(fails.length ? 1 : 0);
})();