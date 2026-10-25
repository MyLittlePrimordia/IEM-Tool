// Control-corner audit: every button, chip and toggle in the app, grouped by
// control family, with the corner and height it ACTUALLY resolved to.
//
//   electron tools/audit-control-corners.js
//
// The question it answers is "does the same control have one corner
// everywhere", so it aggregates across all seven panes and the Testlab
// sub-panels instead of reporting per-pane samples: a family that renders 6px
// in EQ and 8px in Settings is one family with two radii, and that is a FAIL.
//
// Five things are checked, in this order:
//   1. static  - --r-square is declared, and the two deliberately square shapes
//                read it instead of a bare 0;
//   2. computed - every family resolves to exactly one radius, and that radius
//                is a step on the declared scale (0 is a step: --r-square);
//   3. shape   - the caption buttons and the fused stepper segments are 0px,
//                i.e. the documented square, not a stray rounded corner;
//   4. hidden  - nothing carrying Tailwind's `.hidden` resolves to a display
//                other than `none`. This app shows and hides panes, cards,
//                labels and controls by adding and removing that class, so a
//                component rule that declares `display` at the same 0,1,0
//                weight (and wins, app.css loading after the Tailwind build)
//                leaves an element permanently visible. The Bake button failed
//                exactly this way, and a control-only version of this check
//                missed everything that is not a control;
//   5. visible - the mirror image: a control, pane, card or label whose whole
//                ancestor chain renders and that the app has not hidden by any
//                of its own mechanisms, yet that computes display:none. That is
//                a rule hiding something the app expects to show.
//
// Exit 0 = pass, 1 = violation, 2 = could not run.
const { app, BrowserWindow } = require('electron');
require('./lib/verify-profile').isolateProfile('control-corners');
const http = require('http');
const fs = require('fs');
const path = require('path');

const APP_ROOT = path.join(__dirname, '..');
const CSS = path.join(APP_ROOT, 'app', 'css', 'app.css');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.gz': 'application/gzip', '.txt': 'text/plain; charset=utf-8', '.mp3': 'audio/mpeg' };

// The declared scale. Keep in step with the :root block; anything outside it is
// a one-off pixel radius, which is the failure mode the scale exists to stop.
const SCALE = ['0px', '4px', '6px', '8px', '12px', '16px', '20px', '999px'];

// Families whose corner is fixed by design and named in app.css section 9.3.
const EXPECT = {
  'app-caption-btn': '0px',
  'stepper-segment': '0px',
  'stepper-rail-segment': '0px',
  'fused-segment': '0px'
};

// Controls whose four corners are deliberately not all the same: the photo
// bar's undo/redo pair joins on the scale's zero step. Keyed by id, so a
// different control with mixed corners is still a failure.
const SHAPE_OK = {
  'photo-matte-undo': '6px 0px 0px 6px',   // top-left, top-right, bottom-right, bottom-left
  'photo-matte-redo': '0px 6px 6px 0px'
};

// ---- the `.hidden` guard ---------------------------------------------------
// Every element that carries `.hidden`, checked on its OWN computed display.
// Own-display rather than "has a box" on purpose: an element inside a closed
// pane has no box yet, and that is exactly the latent case worth catching -
// it becomes visible the moment its container opens.
//
// Tailwind's responsive pattern is `hidden md:flex`: hidden below the
// breakpoint, shown above it. The bare `hidden` class stays in the markup, so
// an element that also carries a breakpoint display utility is excused only
// while that breakpoint is actually in force at the audited width.
const HIDDEN_SCAN = `(() => {
  const BP = { sm: 640, md: 768, lg: 1024, xl: 1280, '2xl': 1536 };
  const shown = /(?:^|\\s)(sm|md|lg|xl|2xl):(block|inline|inline-block|flex|inline-flex|grid|inline-grid|table|table-cell|contents|flow-root)(?=\\s|$)/;
  const bad = [];
  let checked = 0;
  for (const el of document.querySelectorAll('.hidden')) {
    checked++;
    const cs = getComputedStyle(el);
    if (cs.display === 'none') continue;
    const m = (typeof el.className === 'string' ? el.className : '').match(shown);
    if (m && window.innerWidth >= BP[m[1]]) continue;   // responsive reveal, by design
    const b = el.getBoundingClientRect();
    bad.push({
      id: el.id || '',
      tag: el.tagName.toLowerCase(),
      cls: (typeof el.className === 'string' ? el.className : '').slice(0, 80),
      display: cs.display,
      w: Math.round(b.width), h: Math.round(b.height),
      txt: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 24)
    });
  }
  return { checked, bad };
})()`;

// ---- the reverse guard -----------------------------------------------------
// The mirror of the `.hidden` scan: a UI unit that the app expects to show and
// that some rule has quietly made invisible. The test is deliberately narrow so
// it cannot cry wolf:
//
//   * only units this audit is about - controls, panes, cards and labels;
//   * only where the whole ancestor chain renders, so a button inside a closed
//     panel is not blamed for that panel's display;
//   * only where the app's own hiding mechanisms are absent: no `.hidden` class
//     (self or ancestor), no inline `display:none` (JS toggling), no
//     `bp:hidden` responsive utility in force at this width, no `[hidden]`
//     attribute, no closed <dialog>.
//
// Anything left over is a control that cannot appear even though nothing in the
// app asked for it to be hidden - the failure mode opposite to the Bake button,
// where a component rule re-showed something the app had hidden.
const VISIBLE_SCAN = `(() => {
  const BP = { sm: 640, md: 768, lg: 1024, xl: 1280, '2xl': 1536 };
  const respHidden = /(?:^|\\s)(sm|md|lg|xl|2xl):hidden(?=\\s|$)/;
  const SKIP_TAG = new Set(['OPTION', 'OPTGROUP', 'DATALIST']);
  const sel = 'button, [role="button"], label, input, select, textarea, .tab-pane, .section-card, .stepper, .btn-clear, .tag, .category-pill';
  const chainRenders = (el) => {
    let p = el.parentElement;
    while (p && p !== document.documentElement) {
      if (getComputedStyle(p).display === 'none') return false;
      p = p.parentElement;
    }
    return true;
  };
  const bad = [];
  let checked = 0;
  for (const el of document.querySelectorAll(sel)) {
    checked++;
    if (SKIP_TAG.has(el.tagName)) continue;
    if (el.tagName === 'INPUT' && el.type === 'hidden') continue;
    if (el.hasAttribute('hidden')) continue;
    if (el.classList.contains('hidden') || el.closest('.hidden')) continue;
    if (el.style && el.style.display === 'none') continue;      // JS-toggled
    if (el.closest('dialog:not([open])')) continue;
    const m = (typeof el.className === 'string' ? el.className : '').match(respHidden);
    if (m && window.innerWidth >= BP[m[1]]) continue;           // hidden at this width, by design
    if (getComputedStyle(el).display !== 'none') continue;
    if (!chainRenders(el)) continue;                            // an ancestor is the one hiding
    bad.push({
      id: el.id || '', tag: el.tagName.toLowerCase(),
      cls: (typeof el.className === 'string' ? el.className : '').slice(0, 80),
      txt: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 24)
    });
  }
  return { checked, bad };
})()`;

const PANES = ['eq', 'iem', 'testlab', 'find', 'database', 'visualizer', 'settings'];
const TESTLAB_TABS = ['tl-left-tab-balance', 'tl-left-tab-burnin', 'tl-left-tab-resonance',
                      'tl-right-tab-ab', 'tl-right-tab-hearing', 'tl-right-tab-tone'];

// ---- 1. static checks ------------------------------------------------------
function staticChecks() {
  const css = fs.readFileSync(CSS, 'utf8');
  const problems = [];
  if (!/--r-square:\s*0px\s*;/.test(css)) {
    problems.push('--r-square is not declared as 0px in the :root scale');
  }
  // A bare 0 inside one of the two square shapes' own rules would mean the
  // token was documented but not adopted.
  const block = (sel) => {
    const i = css.indexOf(sel + ' {');
    return i < 0 ? '' : css.slice(i, css.indexOf('}', i));
  };
  for (const sel of ['.app-caption-btn', '.stepper > button', '.stepper-rail > button']) {
    const b = block(sel);
    if (!b) { problems.push('selector missing: ' + sel); continue; }
    if (!/border-radius:\s*var\(--r-square\)/.test(b)) {
      problems.push(sel + ' does not read var(--r-square)');
    }
    if (/border-radius:\s*0(px)?\s*!important/.test(b)) {
      problems.push(sel + ' still carries a literal border-radius: 0');
    }
  }
  console.log(problems.length ? 'STATIC: FAIL' : 'STATIC: PASS (--r-square declared and adopted by the square shapes)');
  problems.forEach(p => console.log('  - ' + p));
  return problems;
}

// ---- in-page collector -----------------------------------------------------
// Family = the first recognised control class, with three structural overrides
// (a segment inside a fused stepper is not the same control as a free-standing
// button, even though both are <button>).
const COLLECT = `(() => {
  const FAM = ['app-caption-btn','app-tab','btn-clear','retro-switch-btn','switch','cta-primary',
    'cta-secondary','settings-btn','settings-control','viz-btn','dt-btn','dt-tag','dt-chip','dt-def',
    'dt-brand','dt-item','eq-card-action-btn','driver-step-btn','genre-target-select','genre-target-btn',
    'category-pill','tag','db-sig-tag','slv-fbtn','slv-month','slv-found','subtab-seg-btn',
    'stepper-arrow','stepper-label','peqdb-role-badge','curve-role-chip','nav-pill','tab-btn'];
  const NOISE = /^(hover:|focus:|active:|group|peer|bg-|text-|border-|rounded|px-|py-|gap-|flex|grid|w-|h-|min-|max-|text-|font-)/;
  // A middle button of one of the legacy fused rows (app.css: the
  // div[class*="gap-1.5"].w-full rule) - its outer neighbours own the corner.
  const fusedMiddle = (el) => {
    const p = el.parentElement;
    if (!p || !p.classList || !p.classList.contains('w-full')) return false;
    if (!(p.className || '').includes('gap-1.5') || p.classList.contains('grid')) return false;
    if (p.id === 'tl-controls-graph' || p.id === 'tl-controls-spatial') return false;
    const kids = [...p.children].filter(c => c.tagName === 'BUTTON');
    return kids.length > 1 && kids[0] !== el && kids[kids.length - 1] !== el;
  };
  const famOf = (el) => {
    if (el.closest('.stepper-rail')) return 'stepper-rail-segment';
    if (el.closest('.stepper')) return 'stepper-segment';
    if (el.closest('.dt-tile .dt-tc')) return 'dt-tile-step';
    if (fusedMiddle(el)) return 'fused-segment';
    for (const c of FAM) if (el.classList.contains(c)) return c;
    const cls = [...el.classList].filter(c => !NOISE.test(c)).slice(0, 2);
    return el.tagName.toLowerCase() + (cls.length ? '.' + cls.join('.') : '');
  };
  const sel = 'button, [role="button"], label.btn-label, .tag, .category-pill, .dt-tag, .dt-chip, .dt-def';
  const out = [];
  for (const el of document.querySelectorAll(sel)) {
    // A drop zone (.slot-drop) carries role="button" so it can be a drag
    // target, but it is a surface the size of a card, not a control: it takes
    // the panel radius, not the control corner.
    if (el.classList.contains('slot-drop')) continue;
    const b = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    // Hidden controls are still audited for their CORNER: a button that is
    // only visible after expanding a panel is the one most likely to have been
    // written against an older radius, and getComputedStyle resolves it anyway.
    // Heights are only tallied for visible controls, where the box means
    // something.
    const vis = b.width >= 4 && b.height >= 4 && cs.visibility !== 'hidden' && cs.display !== 'none';
    const corners = [cs.borderTopLeftRadius, cs.borderTopRightRadius,
                     cs.borderBottomRightRadius, cs.borderBottomLeftRadius];
    out.push({
      fam: famOf(el),
      tag: el.tagName.toLowerCase(),
      vis: vis,
      r: corners.every(v => v === corners[0]) ? corners[0] : corners.join(' '),
      h: vis ? Math.round(b.height) : 0,
      w: vis ? Math.round(b.width) : 0,
      id: el.id || '',
      txt: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 18)
    });
  }
  return { square: getComputedStyle(document.documentElement).getPropertyValue('--r-square').trim(), list: out };
})()`;

function serve() {
  return new Promise((res, rej) => {
    const srv = http.createServer((q, r) => {
      let u = decodeURIComponent(q.url.split('?')[0]);
      if (u === '/') u = '/index.html';
      const f = path.join(APP_ROOT, u);
      if (!f.startsWith(APP_ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
        r.writeHead(404); return r.end();
      }
      r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      fs.createReadStream(f).pipe(r);
    });
    srv.on('error', rej);
    srv.listen(0, '127.0.0.1', () => res({ srv, port: srv.address().port }));
  });
}

app.disableHardwareAcceleration();
setTimeout(() => { console.log('WATCHDOG TIMEOUT'); app.exit(2); }, 300000);

(async () => {
  const staticProblems = staticChecks();

  await app.whenReady();
  const { srv, port } = await serve();
  const win = new BrowserWindow({
    width: 1440, height: 900, show: true, frame: false, backgroundColor: '#000000',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(APP_ROOT, 'preload.js') }
  });
  await win.loadURL(`http://127.0.0.1:${port}/index.html?cb=${Date.now()}`);
  const q = async js => { try { return await win.webContents.executeJavaScript(js, true); } catch (e) { return { ERR: e.message }; } };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  for (let i = 0; i < 80; i++) { if (await q('!!(window.App && window.EQ)') === true) break; await sleep(500); }
  await sleep(2500);

  // Freeze transitions: several controls animate in, and a throttled window
  // would otherwise be sampled mid-flight.
  await q("(function(){var s=document.createElement('style');s.textContent='*,*::before,*::after{transition:none !important;animation:none !important;}';document.head.appendChild(s);return 1;})()");

  const seen = new Map();   // fam -> { radii:{r:count}, heights:{h:count}, n }
  const hiddenViolations = new Map();   // key -> element carrying .hidden that still renders
  const invisibleUnits = new Map();     // key -> unit the app expects to show, computing display:none
  let hiddenChecked = 0;
  let unitsChecked = 0;
  const documented = new Set();
  const shapeProblems = [];
  let square = null;
  let sampled = 0;

  const absorb = (res, where) => {
    if (!res || res.ERR) { console.log('  ! collection failed in ' + where + ': ' + (res && res.ERR)); return; }
    if (square === null) square = res.square;
    sampled += res.list.length;
    for (const c of res.list) {
      if (c.id && SHAPE_OK[c.id]) {
        // Documented mixed-corner shape: judged against its own entry, not
        // pooled with the family's single-corner members.
        if (c.r !== SHAPE_OK[c.id]) {
          shapeProblems.push(`${c.id}: expected ${SHAPE_OK[c.id]} (fused pair), got ${c.r}`);
        }
        documented.add(c.id);
        continue;
      }
      let row = seen.get(c.fam);
      if (!row) { row = { radii: {}, heights: {}, n: 0, where: new Set(), ex: c }; seen.set(c.fam, row); }
      row.radii[c.r] = (row.radii[c.r] || 0) + 1;
      if (c.vis) row.heights[c.h] = (row.heights[c.h] || 0) + 1;
      row.n++;
      if (row.where.size < 4) row.where.add(where);
      // Remember an instance per radius, so a violation can name the control.
      if (!row.exByRadius) row.exByRadius = {};
      if (!row.exByRadius[c.r]) row.exByRadius[c.r] = c;
    }
  };

  // Elements are created lazily per pane, so the `.hidden` scan runs on every
  // stop the audit makes, not once at load.
  const scanHidden = async (where) => {
    const res = await q(HIDDEN_SCAN);
    if (!res || res.ERR) { console.log('  ! .hidden scan failed in ' + where + ': ' + (res && res.ERR)); return; }
    hiddenChecked += res.checked;
    for (const e of res.bad) {
      const key = e.id || e.tag + '.' + e.cls.split(/\s+/).slice(0, 3).join('.') + ' "' + e.txt + '"';
      if (!hiddenViolations.has(key)) hiddenViolations.set(key, Object.assign({ where }, e));
    }
  };

  const scanInvisible = async (where) => {
    const res = await q(VISIBLE_SCAN);
    if (!res || res.ERR) { console.log('  ! visibility scan failed in ' + where + ': ' + (res && res.ERR)); return; }
    unitsChecked += res.checked;
    for (const e of res.bad) {
      const key = e.id || e.tag + '.' + e.cls.split(/\s+/).slice(0, 3).join('.') + ' "' + e.txt + '"';
      if (!invisibleUnits.has(key)) invisibleUnits.set(key, Object.assign({ where }, e));
    }
  };

  for (const tab of PANES) {
    await q(`App.switchTab('${tab}')`);
    await sleep(700);
    absorb(await q(COLLECT), tab);
    await scanHidden(tab);
    await scanInvisible(tab);
    if (tab === 'testlab') {
      for (const id of TESTLAB_TABS) {
        const clicked = await q(`(function(){var b=document.getElementById('${id}');if(!b)return 0;b.click();return 1;})()`);
        if (clicked === 1) {
          const sub = id.replace(/^tl-(left|right)-tab-/, '');
          await sleep(450);
          absorb(await q(COLLECT), tab + '/' + sub);
          await scanHidden(tab + '/' + sub);
          await scanInvisible(tab + '/' + sub);
        }
      }
    }
  }

  const rows = [...seen.entries()].sort((a, b) => b[1].n - a[1].n);
  console.log('\nfams=' + rows.length + '  controls sampled=' + sampled + '  --r-square resolves to ' + JSON.stringify(square));
  console.log('');
  const pad = (s, n) => (s + ' '.repeat(n)).slice(0, n);
  console.log(pad('family', 26) + pad('n', 7) + pad('height (visible)', 18) + 'radius (all states)');
  for (const [fam, row] of rows) {
    const hs = Object.entries(row.heights).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + (v > 1 ? 'x' + v : '')).join(',');
    const rs = Object.entries(row.radii).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + (v > 1 ? 'x' + v : '')).join(', ');
    console.log(pad(fam, 26) + pad(String(row.n), 7) + pad(hs, 18) + rs);
  }
  // Small families are the ones a reader cannot identify from the key alone
  // (the key is a class list, and a runtime-built button may have none).
  const small = rows.filter(([, r]) => r.n <= 4);
  if (small.length) {
    console.log('\nsmall families, by instance:');
    for (const [fam, row] of small) {
      console.log('  ' + pad(fam, 30) + pad('r=' + Object.keys(row.radii).join('/'), 12) +
        `${row.ex.tag || ''}${row.ex.id ? '#' + row.ex.id : ''} "${row.ex.txt}"`);
    }
  }

  // ---- verdict -------------------------------------------------------------
  const problems = [...shapeProblems];
  for (const [what, e] of hiddenViolations) {
    problems.push(`"${what}" carries .hidden but resolves to display:${e.display}` +
      ` (${e.w}x${e.h}, seen in ${e.where}) - something outranks Tailwind's .hidden`);
  }
  for (const [what, e] of invisibleUnits) {
    problems.push(`"${what}" (${e.tag}) is expected to show but computes display:none` +
      ` (seen in ${e.where}) - something hides it that nothing in the app asked to`);
  }
  if (documented.size) console.log('documented mixed-corner shapes: ' + [...documented].join(', '));
  for (const [fam, row] of rows) {
    const radii = Object.keys(row.radii);
    if (radii.length > 1) {
      problems.push(`${fam}: ${radii.length} corners for one control - ` +
        radii.map(r => r + ' (n=' + row.radii[r] + ')').join(', '));
    }
    for (const r of radii) {
      // A non-uniform value is reported as its four corners joined, and is
      // itself a defect unless it is one of the documented shapes above.
      if (r.includes(' ')) { problems.push(`${fam}: corners differ (${r})`); continue; }
      if (!SCALE.includes(r)) problems.push(`${fam}: ${r} is not a step on the radius scale`);
    }
    if (EXPECT[fam] && row.radii[EXPECT[fam]] !== row.n) {
      problems.push(`${fam}: expected every instance at ${EXPECT[fam]} (the documented square), got ${Object.keys(row.radii).join(', ')}`);
    }
  }
  if (square !== '0px') problems.push('--r-square did not resolve to 0px in the page (got ' + JSON.stringify(square) + ')');
  // The two square shapes must actually be present, or this audit passes by
  // sampling nothing.
  for (const fam of ['app-caption-btn', 'stepper-segment']) {
    if (!seen.has(fam)) problems.push('no ' + fam + ' sampled - the audit saw nothing to judge');
  }
  console.log('\n.hidden elements checked on every stop: ' + hiddenChecked +
              ', still rendering: ' + hiddenViolations.size);
  console.log('visible units checked on every stop: ' + unitsChecked +
              ', hidden by their own rule: ' + invisibleUnits.size);

  console.log('');
  staticProblems.forEach(p => console.log('  - ' + p));
  problems.forEach(p => console.log('  - ' + p));
  const bad = staticProblems.length + problems.length;
  console.log(bad ? 'CONTROL CORNER AUDIT FAIL (' + bad + ')' : 'CONTROL CORNER AUDIT PASS');

  win.destroy(); srv.close();
  app.exit(bad ? 1 : 0);
})();
