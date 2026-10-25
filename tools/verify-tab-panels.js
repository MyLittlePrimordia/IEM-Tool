// Verify every state-driven panel carousel in the app: the Data tab's three
// columns, the IEM and Test Lab left/right sub-tabs, the IEM sound-character
// row, the Find mode and Find tool rows, and the EQ pane's acoustics pills and
// Standard/Advanced fader pills.
// The EQ console is covered too, in its own section: its tabs are the ◀/▶
// stepper rather than a pill row, so it has no .active/aria state to read.
//
//   electron tools/verify-tab-panels.js
//
// The invariant is the same for all of them: in each group exactly one panel is
// showing, it is the panel of the selected tab, that panel actually renders,
// and every sibling panel is hidden with no box. The selected tab carries
// .active and aria-selected="true" (and only it), and re-selecting the active
// tab is a no-op rather than a toggle-off.
//
// This is the check the global `.hidden` / visibility guards cannot make. The
// Data panels are hidden by `.dt-panel` + `.is-on` rather than by `.hidden`, so
// both guards pass them by design; and for the sub-tabs the failure worth
// catching is a switch that lights a tab without moving the panel, or leaves
// two panels on. Either one is visibly broken while every static guard, and
// every page-level visibility sweep, stays green.
//
// Each group also declares the module list that names its steps - IEM's
// leftTabModes / rightTabModes / soundCharModes, TestLab's two, FindEngine's
// findModes / rightTabModes - and both its ids and its label/emoji pair are
// compared with the tab row in the markup, in order. That list is what the
// ◀/▶ cycle helpers and any future renderer walk, so an entry missing from it
// (Package was, for a while), a stale id, or a name the button no longer shows
// (Gem against a "Gems" pill) is drift the click tests cannot see: the button
// exists and works, but the module's own description of the row is wrong.
//
// State is driven the way a reader drives it: real clicks on the real tab
// buttons, then reading the class lists, the computed display, the boxes and
// aria-selected.
const { app, BrowserWindow } = require('electron');
require('./lib/verify-profile').isolateProfile('tab-panels');
const http = require('http');
const fs = require('fs');
const path = require('path');

const APP_ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.gz': 'application/gzip', '.txt': 'text/plain; charset=utf-8', '.mp3': 'audio/mpeg' };

// mode: how this group hides a panel that is not selected.
//   'hidden' - the Tailwind class, as IEM / Find / TestLab sub-tabs do it
//   'is-on'  - .dt-panel + .is-on, as the Data tab does it
// pane:    the pane the group lives in, waited on so a panel is measured after
//          its pane has laid out rather than in the frame that switched to it.
// tablist: the tab row, so a tab added to the markup without a panel (or an
//          entry here) is caught by the button count.
// modeList: the module array that names the same steps, compared against the
//          tab row's ids. tabPrefix / tabSuffix strip a button id back to the
//          mode id (e.g. iem-left-tab-power -> power).
// stray:   panel selectors owned by this group; any match with an id outside
//          the audited set is an un-audited panel.
const GROUPS = [
  {
    name: 'Data · left', mode: 'is-on', prepare: "App.switchTab('database')",
    pane: '#pane-database', tablist: '#dt-left-tabs',
    steps: [
      { a: 'tree', tab: 'dt-left-tab-tree', panel: 'dt-lp-tree' },
      { a: 'history', tab: 'dt-left-tab-history', panel: 'dt-lp-history' }
    ]
  },
  {
    name: 'Data · centre', mode: 'is-on', prepare: "App.switchTab('database')",
    pane: '#pane-database', tablist: '#dt-mid-tabs',
    steps: [
      { a: 'editor', tab: 'dt-mid-tab-editor', panel: 'dt-mp-editor' },
      { a: 'curves', tab: 'dt-mid-tab-curves', panel: 'dt-mp-curves' }
    ]
  },
  {
    name: 'Data · right', mode: 'is-on', prepare: "App.switchTab('database')",
    pane: '#pane-database', tablist: '#dt-right-tabs',
    steps: [
      { a: 'audit', tab: 'dt-right-tab-audit', panel: 'dt-rp-audit' },
      { a: 'ai', tab: 'dt-right-tab-ai', panel: 'dt-rp-ai' },
      { a: 'export', tab: 'dt-right-tab-export', panel: 'dt-rp-export' }
    ]
  },
  {
    name: 'IEM · left', mode: 'hidden', prepare: "App.switchTab('iem')",
    pane: '#pane-iem', tablist: '#iem-left-tabs', stray: '[id^="iem-left-panel-"]',
    modeList: 'IEM.leftTabModes', tabPrefix: 'iem-left-tab-',
    steps: [
      { a: 'search', tab: 'iem-left-tab-search', panel: 'iem-left-panel-search' },
      { a: 'info', tab: 'iem-left-tab-info', panel: 'iem-left-panel-info' },
      { a: 'drivers', tab: 'iem-left-tab-drivers', panel: 'iem-left-panel-drivers' },
      { a: 'power', tab: 'iem-left-tab-power', panel: 'iem-left-panel-power' }
    ]
  },
  {
    name: 'IEM · right', mode: 'hidden', prepare: "App.switchTab('iem')",
    pane: '#pane-iem', tablist: '#iem-right-tabs', stray: '[id^="iem-right-panel-"]',
    modeList: 'IEM.rightTabModes', tabPrefix: 'iem-right-tab-',
    steps: [
      { a: 'sound', tab: 'iem-right-tab-sound', panel: 'iem-right-panel-sound' },
      { a: 'photo', tab: 'iem-right-tab-photo', panel: 'iem-right-panel-photo' },
      { a: 'impressions', tab: 'iem-right-tab-impressions', panel: 'iem-right-panel-impressions' }
    ]
  },
  {
    // The sound-character row lives inside the IEM Sound panel, so it only has
    // boxes to measure once that panel is the one showing.
    name: 'IEM · sound character', mode: 'hidden',
    prepare: "App.switchTab('iem'); IEM.switchRightTab('sound')",
    pane: '#pane-iem', tablist: '#sound-char-tabs', stray: '.sound-char-panel',
    modeList: 'IEM.soundCharModes', tabPrefix: 'sc-tab-',
    steps: [
      { a: 'bass', tab: 'sc-tab-bass', panel: 'sc-panel-bass' },
      { a: 'mids', tab: 'sc-tab-mids', panel: 'sc-panel-mids' },
      { a: 'treble', tab: 'sc-tab-treble', panel: 'sc-panel-treble' },
      { a: 'stage', tab: 'sc-tab-stage', panel: 'sc-panel-stage' },
      { a: 'fit', tab: 'sc-tab-fit', panel: 'sc-panel-fit' },
      { a: 'package', tab: 'sc-tab-package', panel: 'sc-panel-package' }
    ]
  },
  {
    // The Find mode row has no shared id prefix: its two panels are the tuning
    // and filter control stacks, and the mode also owns two blocks that swap
    // with it (the target curve belongs to Tuning, the pick list to Specs).
    name: 'Find · mode', mode: 'hidden', prepare: "App.switchTab('find')",
    pane: '#pane-find', tablist: '#find-mode-tabs',
    modeList: 'FindEngine.findModes', tabPrefix: 'find-mode-', tabSuffix: '-btn',
    steps: [
      { a: 'tuning', tab: 'find-mode-tuning-btn', panel: 'find-tuning-controls' },
      { a: 'filters', tab: 'find-mode-filters-btn', panel: 'find-filter-controls' }
    ],
    linked: [
      { id: 'find-target-curve-block', when: 'tuning' },
      { id: 'find-pick-section', when: 'filters' }
    ]
  },
  {
    name: 'Find · tool', mode: 'hidden', prepare: "App.switchTab('find')",
    pane: '#pane-find', tablist: '#find-right-tabs', stray: '[id^="find-right-panel-"]',
    modeList: 'FindEngine.rightTabModes', tabPrefix: 'find-right-tab-',
    steps: [
      { a: 'taste', tab: 'find-right-tab-taste', panel: 'find-right-panel-taste' },
      { a: 'upgrade', tab: 'find-right-tab-upgrade', panel: 'find-right-panel-upgrade' },
      { a: 'giantkiller', tab: 'find-right-tab-giantkiller', panel: 'find-right-panel-giantkiller' },
      { a: 'endgame', tab: 'find-right-tab-endgame', panel: 'find-right-panel-endgame' }
    ]
  },
  {
    // The acoustics pills live inside the EQ console's Acoustics panel, so the
    // console has to be on that tab before their boxes mean anything.
    name: 'EQ · acoustics', mode: 'hidden',
    prepare: "App.switchTab('eq'); EQ.switchConsoleTab('acoustics')",
    pane: '#pane-eq', tablist: '#acoustics-sub-tabs', stray: '.acoustics-sub-panel',
    modeList: 'EQ.acousticsSubModes', tabPrefix: 'as-tab-',
    steps: [
      { a: 'coupling', tab: 'as-tab-coupling', panel: 'as-panel-coupling' },
      { a: 'spatial', tab: 'as-tab-spatial', panel: 'as-panel-spatial' },
      { a: 'effects', tab: 'as-tab-effects', panel: 'as-panel-effects' },
      { a: 'crossover', tab: 'as-tab-crossover', panel: 'as-panel-crossover' }
    ]
  },
  {
    // Inside the EQ console's Filters panel: the console has to be on Filters
    // before either fader layout has a box to measure.
    name: 'EQ · faders', mode: 'hidden',
    prepare: "App.switchTab('eq'); EQ.switchConsoleTab('filters')",
    pane: '#pane-eq', tablist: '#eq-fader-sub-tabs', stray: '[id^="eq-panel-"]',
    modeList: 'EQ.faderModes', tabPrefix: 'eq-tab-',
    steps: [
      { a: 'standard', tab: 'eq-tab-standard', panel: 'eq-panel-standard' },
      { a: 'advanced', tab: 'eq-tab-advanced', panel: 'eq-panel-advanced' }
    ]
  },
  {
    name: 'TestLab · left', mode: 'hidden', prepare: "App.switchTab('testlab')",
    pane: '#pane-testlab', tablist: '#tl-left-tabs', stray: '[id^="tl-left-panel-"]',
    modeList: 'TestLab.leftTabModes', tabPrefix: 'tl-left-tab-',
    steps: [
      { a: 'resonance', tab: 'tl-left-tab-resonance', panel: 'tl-left-panel-resonance' },
      { a: 'balance', tab: 'tl-left-tab-balance', panel: 'tl-left-panel-balance' },
      { a: 'burnin', tab: 'tl-left-tab-burnin', panel: 'tl-left-panel-burnin' }
    ]
  },
  {
    name: 'TestLab · right', mode: 'hidden', prepare: "App.switchTab('testlab')",
    pane: '#pane-testlab', tablist: '#tl-right-tabs', stray: '[id^="tl-right-panel-"]',
    modeList: 'TestLab.rightTabModes', tabPrefix: 'tl-right-tab-',
    steps: [
      { a: 'tone', tab: 'tl-right-tab-tone', panel: 'tl-right-panel-tone' },
      { a: 'ab', tab: 'tl-right-tab-ab', panel: 'tl-right-panel-ab' },
      { a: 'hearing', tab: 'tl-right-tab-hearing', panel: 'tl-right-panel-hearing' }
    ]
  }
];

const STRAY_SELECTORS = [...new Set(GROUPS.map(g => g.stray).filter(Boolean))];

// The EQ console is the one carousel without pills: three .console-panel panels
// swapped by the ◀/▶ stepper, whose label names the current mode. There are no
// per-mode buttons at all, so .active / aria-selected / a tablist do not apply;
// it is audited by walking the stepper instead.
const CONSOLE = {
  name: 'EQ · console',
  modes: 'EQ.consoleModes',
  active: 'EQ.activeConsoleTab',
  panelPrefix: 'rc-panel-',
  label: '#rc-tab-stepper-label',
  next: '[data-action="click_95_EQ_cycleConsoleTab_1"]',
  prev: '[data-action="click_47_EQ_cycleConsoleTab__1"]'
};

// The module arrays are page globals / bundle-scope consts, so they have to be
// named in the script itself. Generated here, not eval'd in the page, because
// index.html runs under a CSP that forbids eval and new Function.
const MODES = `(() => {
  const out = {};
${GROUPS.filter(g => g.modeList).map(g => `  try {
    const m = (${g.modeList});
    out[${JSON.stringify(g.name)}] = { list: Array.isArray(m) ? m.map(x => ({ id: x && x.id, label: x && x.label, emoji: x && x.emoji })) : null };
  } catch (e) { out[${JSON.stringify(g.name)}] = { list: null, err: e.message }; }`).join('\n')}
  return out;
})()`;

const READ = `(() => {
 try {
  const G = ${JSON.stringify(GROUPS.map(g => ({ name: g.name, mode: g.mode, steps: g.steps, linked: g.linked || [], tablist: g.tablist, tabPrefix: g.tabPrefix || '', tabSuffix: g.tabSuffix || '' })))};
  const STRAY = ${JSON.stringify(STRAY_SELECTORS)};
  const out = { groups: {} };

  for (const g of G) {
    const steps = g.steps.map(s => {
      const panel = document.getElementById(s.panel);
      const tab = document.getElementById(s.tab);
      const cs = panel ? getComputedStyle(panel) : null;
      const r = panel ? panel.getBoundingClientRect() : null;
      return {
        a: s.a,
        panel: !!panel,
        on: panel ? (g.mode === 'hidden' ? !panel.classList.contains('hidden') : panel.classList.contains('is-on')) : null,
        display: cs ? cs.display : null,
        w: r ? Math.round(r.width) : 0,
        h: r ? Math.round(r.height) : 0,
        tab: !!tab,
        active: tab ? tab.classList.contains('active') : null,
        aria: tab ? tab.getAttribute('aria-selected') : null
      };
    });
    const linked = (g.linked || []).map(l => {
      const el = document.getElementById(l.id);
      const cs = el ? getComputedStyle(el) : null;
      const r = el ? el.getBoundingClientRect() : null;
      return { id: l.id, when: l.when, exists: !!el, display: cs ? cs.display : null, w: r ? Math.round(r.width) : 0, h: r ? Math.round(r.height) : 0 };
    });
    // The button ids, in DOM order, with the mode prefix/suffix stripped back
    // to the mode id the module list uses, plus the visible text (emoji + label)
    // the list claims to describe.
    const row = document.querySelector(g.tablist);
    const buttons = row ? Array.from(row.querySelectorAll('button')) : [];
    const rowIds = row ? buttons.map(b =>
      b.id.slice(g.tabPrefix.length, b.id.length - g.tabSuffix.length)) : null;
    const rowText = buttons.map(b => b.textContent.replace(/\\s+/g, ' ').trim());
    out.groups[g.name] = { steps, linked, rowIds, rowText };
  }

  // Every panel that looks like it belongs to an audited group must be one.
  const known = new Set();
  for (const g of G) for (const s of g.steps) known.add(s.panel);
  const strays = [];
  for (const sel of STRAY) {
    for (const el of document.querySelectorAll(sel)) {
      if (!known.has(el.id)) strays.push(el.id || sel);
    }
  }
  out.strays = strays;
  return out;
 } catch (e) { return { ERR: ((e && e.message) || String(e)) + ' :: ' + ((e && e.stack) || '') }; }
})()`;

const CONSOLE_READ = `(() => {
 try {
  const modes = (${CONSOLE.modes}).map(m => ({ id: m.id, label: m.label, emoji: m.emoji }));
  const panels = Array.from(document.querySelectorAll('.console-panel')).map(p => {
    const r = p.getBoundingClientRect();
    return { id: p.id.slice(${JSON.stringify(CONSOLE.panelPrefix)}.length), display: getComputedStyle(p).display, w: Math.round(r.width), h: Math.round(r.height) };
  });
  const lbl = document.querySelector(${JSON.stringify(CONSOLE.label)});
  return { modes, panels, labelText: lbl ? lbl.textContent : null, active: (${CONSOLE.active}) };
 } catch (e) { return { ERR: ((e && e.message) || String(e)) + ' :: ' + ((e && e.stack) || '') }; }
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

let failures = 0;
const check = (ok, label, detail) => {
  if (ok) console.log('  PASS  ' + label + (detail ? ': ' + detail : ''));
  else { failures++; console.log('  FAIL  ' + label + (detail ? ': ' + detail : '')); }
};

(async () => {
  await app.whenReady();
  const { srv, port } = await serve();
  const win = new BrowserWindow({
    width: 1440, height: 900, show: true, frame: false, backgroundColor: '#000000',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(APP_ROOT, 'preload.js') }
  });
  await win.loadURL(`http://127.0.0.1:${port}/index.html?cb=${Date.now()}`);
  const q = async js => { try { return await win.webContents.executeJavaScript(js, true); } catch (e) { return { ERR: e.message }; } };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const read = () => q(READ);
  const clickTab = async tabId => {
    await q(`(function(){var b=document.getElementById(${JSON.stringify(tabId)});if(b)b.click();return 1;})()`);
    await sleep(320);
  };
  // Switching panes re-enables a flex column; a panel measured in the frame
  // that switched can still read 0x0, which is layout settling rather than a
  // defect. Wait for the pane and the selected panel to have boxes, bounded, so
  // a panel that never gets one still fails the assertion below.
  const probe = group => `(function(){
    var G = ${JSON.stringify({ mode: group.mode, steps: group.steps, pane: group.pane })};
    var pane = document.querySelector(G.pane);
    if (!pane) return 'no-pane';
    var pr = pane.getBoundingClientRect();
    if (pr.width <= 0 || pr.height <= 0) return 'pane-0x0';
    var on = G.steps.filter(function(s){
      var p = document.getElementById(s.panel);
      return p && (G.mode === 'hidden' ? !p.classList.contains('hidden') : p.classList.contains('is-on'));
    });
    if (on.length !== 1) return 'showing=' + on.length;
    var r = document.getElementById(on[0].panel).getBoundingClientRect();
    return (r.width > 0 && r.height > 0) ? 'ok' : 'panel-0x0';
  })()`;
  const clickSel = async sel => {
    await q(`(function(){var b=document.querySelector(${JSON.stringify(sel)});if(b)b.click();return 1;})()`);
    await sleep(320);
  };
  // The console needs no tab click, only the EQ pane on screen and laid out.
  const prepareConsole = async () => {
    await q("(function(){try{App.switchTab('eq');}catch(e){}return 1;})()");
    await sleep(400);
    for (let i = 0; i < 20; i++) {
      const ok = await q("(function(){var p=document.getElementById('pane-eq');if(!p)return false;var r=p.getBoundingClientRect();return r.width>0&&r.height>0;})()");
      if (ok === true) break;
      await sleep(100);
    }
  };
  const prepare = async group => {
    await q(`(function(){try{${group.prepare};}catch(e){}return 1;})()`);
    await sleep(200);
    for (let i = 0; i < 20; i++) {
      if (await q(probe(group)) === 'ok') break;
      await sleep(100);
    }
  };
  const bail = msg => {
    console.log('  FAIL  ' + msg);
    console.log('\nTAB PANEL CHECK FAIL');
    win.destroy(); srv.close(); app.exit(1);
  };

  for (let i = 0; i < 80; i++) { if (await q('!!(window.App && window.EQ)') === true) break; await sleep(500); }
  await sleep(2000);
  await q("(function(){var s=document.createElement('style');s.textContent='*,*::before,*::after{transition:none !important;animation:none !important;}';document.head.appendChild(s);return 1;})()");

  // The Data tab's centre column exists only once the database has loaded and
  // an editor is rendered; wait for it rather than sampling a half-built pane.
  await q("App.switchTab('database')");
  let calculated = false;
  for (let i = 0; i < 40; i++) {
    if (await q("!!document.getElementById('dt-mp-curves')") === true) { calculated = true; break; }
    await sleep(500);
  }
  if (!calculated) return bail('the Data tab never rendered #dt-mp-curves - the panel set is incomplete');

  // [1] Wiring: every step has its panel and its tab, the tab row is the size
  //     this audit thinks it is, and no panel escapes the audited set.
  console.log('\n[1] Every group is wired: a panel and a tab per step, no stragglers');
  let st = await read();
  if (st.ERR) return bail('could not read the DOM: ' + st.ERR);
  for (const g of GROUPS) {
    const rows = (st.groups[g.name] || {}).steps || [];
    check(rows.length === g.steps.length && rows.every(r => r.panel), g.name + ': every panel exists',
      rows.filter(r => !r.panel).map(r => 'missing ' + r.a).join(', ') || rows.length + ' panels');
    check(rows.every(r => r.tab), g.name + ': every tab exists',
      rows.filter(r => !r.tab).map(r => 'missing ' + r.a).join(', ') || rows.length + ' tabs');
    const n = await q(`(function(){var el=document.querySelector(${JSON.stringify(g.tablist)});return el?el.querySelectorAll('button').length:-1;})()`);
    check(n === g.steps.length, g.name + ': ' + g.tablist + ' holds exactly the audited tabs', String(n) + ' button(s), ' + g.steps.length + ' audited');
  }

  // [1b] The module's own list of steps must describe the same row: same ids
  //      in the same order, every entry carrying a label and an emoji, and that
  //      label/emoji being the text the pill actually shows. A list that has
  //      drifted is invisible to the click tests above - the button itself
  //      works - but it is what the cycle helpers and any renderer walk.
  console.log('\n[1b] Each module *TabModes list matches its tab row');
  const modeState = await q(MODES);
  if (modeState.ERR) return bail('could not read the module mode lists: ' + modeState.ERR);
  for (const g of GROUPS.filter(x => x.modeList)) {
    const got = modeState[g.name] || {};
    const ids = (st.groups[g.name] || {}).rowIds;
    const list = got.list;
    check(Array.isArray(list) && list.length > 0, g.name + ': ' + g.modeList + ' is a list',
      got.err || (Array.isArray(list) ? list.length + ' entries' : String(list)));
    check(JSON.stringify(ids) === JSON.stringify(g.steps.map(s => s.a)),
      g.name + ': the row ids strip back to the audited step names',
      'row=[' + (ids || []).join(',') + '] audited=[' + g.steps.map(s => s.a).join(',') + ']');
    check(JSON.stringify((list || []).map(m => m.id)) === JSON.stringify(ids),
      g.name + ': ' + g.modeList + ' lists the row\'s ids, in order',
      'list=[' + (list || []).map(m => m.id).join(',') + '] row=[' + (ids || []).join(',') + ']');
    check((list || []).every(m => m.label && m.emoji),
      g.name + ': every ' + g.modeList + ' entry has a label and an emoji',
      (list || []).filter(m => !m.label || !m.emoji).map(m => m.id).join(',') || 'all set');

    // The label and emoji the list claims must be the ones the button shows:
    // one pill is rendered from the markup and the other is written here, so
    // renaming a tab without touching the list leaves two names for one mode.
    const rowText = (st.groups[g.name] || {}).rowText || [];
    const diff = (list || []).map((m, i) => ({
      id: m.id,
      want: ((m.emoji ? m.emoji + ' ' : '') + (m.label || '')).replace(/\s+/g, ' ').trim(),
      got: (rowText[i] || '').replace(/\s+/g, ' ').trim()
    })).filter(p => p.want !== p.got);
    check(diff.length === 0 && (list || []).length === rowText.length,
      g.name + ': ' + g.modeList + ' labels and emoji match the buttons',
      diff.length ? diff.map(p => p.id + ': list="' + p.want + '" button="' + p.got + '"').join('; ')
        : (list || []).length + ' labels match');
  }
  check(st.strays.length === 0, 'no panel outside the audited set', st.strays.join(', '));

  // [2..3] One group at a time: prepare its pane, read the landing state, then
  //        click every tab. This is the part that catches a tab that lights up
  //        without moving its panel, or two panels left on.
  const assertGroup = (group, state, expected, label) => {
    const g = state.groups[group.name];
    if (!g) { check(false, label + ': group readable', 'missing from the read'); return; }
    const rows = g.steps;
    const onRows = rows.filter(r => r.on);
    check(onRows.length === 1, label + ': exactly one panel showing',
      onRows.length === 1 ? onRows[0].a : (onRows.map(r => r.a).join(',') || 'none'));
    if (onRows.length !== 1) return;
    const on = onRows[0];
    check(on.a === expected, label + ': the panel showing is the selected tab\'s', 'tab=' + expected + ' panel=' + on.a);
    check(on.display !== 'none' && on.w > 0 && on.h > 0, label + ': the panel showing renders', on.display + ' ' + on.w + 'x' + on.h);
    const active = rows.filter(r => r.active);
    check(active.length === 1 && active[0].a === on.a, label + ': exactly one tab is active, and it is the same step',
      (active.map(r => r.a).join(',') || 'none') + ' (panel ' + on.a + ')');
    check(rows.every(r => (r.aria === 'true') === (r.a === on.a)), label + ': aria-selected tracks the active tab',
      rows.map(r => r.a + '=' + r.aria).join(' '));
    for (const off of rows.filter(r => r.a !== on.a)) {
      check(off.display === 'none', label + ': ' + off.a + ' panel is display:none', off.display);
      check(off.w === 0 || off.h === 0, label + ': ' + off.a + ' panel has no box', off.w + 'x' + off.h);
      check(off.active === false && off.aria === 'false', label + ': ' + off.a + ' tab is inactive', 'active=' + off.active + ' aria=' + off.aria);
    }
    for (const l of g.linked) {
      const want = l.when === expected;
      const visible = l.display !== 'none' && l.w > 0 && l.h > 0;
      check(l.exists && visible === want, label + ': ' + l.id + (want ? ' shows' : ' is hidden'),
        l.exists ? l.display + ' ' + l.w + 'x' + l.h : 'missing');
    }
  };

  console.log('\n[2] Landing state: one panel per group, agreeing with its tab');
  for (const g of GROUPS) {
    await prepare(g);
    st = await read();
    const rows = (st.groups[g.name] || {}).steps || [];
    const onRows = rows.filter(r => r.on);
    assertGroup(g, st, onRows.length === 1 ? onRows[0].a : (rows[0] || {}).a, g.name + ' (landing)');
  }

  console.log('\n[3] Clicking each tab switches exactly one panel, and only that one');
  for (const g of GROUPS) {
    await prepare(g);
    for (const step of g.steps) {
      await clickTab(step.tab);
      st = await read();
      assertGroup(g, st, step.a, g.name + ' -> ' + step.a);
    }
  }

  console.log('\n[4] Selecting the active tab again changes nothing');
  for (const g of GROUPS) {
    await prepare(g);
    const first = g.steps[0];
    await clickTab(first.tab);
    await clickTab(first.tab);
    st = await read();
    assertGroup(g, st, first.a, g.name + ' -> ' + first.a + ' twice');
  }

  // [5] The EQ console's stepper. Same invariant as the pills - one panel, the
  //     current one, the rest hidden - but its "tab" is a label between two
  //     arrows, so the walk is done by clicking them.
  console.log('\n[5] EQ console stepper: one panel per mode, named by the stepper');
  await prepareConsole();
  let cst = await q(CONSOLE_READ);
  if (cst.ERR) return bail('could not read the EQ console: ' + cst.ERR);
  const cmodes = cst.modes || [];
  check(cmodes.length > 0 && cmodes.every(m => m.label && m.emoji),
    'EQ · console: every consoleModes entry has a label and an emoji',
    cmodes.filter(m => !m.label || !m.emoji).map(m => m.id).join(',') || cmodes.length + ' entries');
  check(cmodes.length === cst.panels.length, 'EQ · console: one panel per console mode',
    cmodes.length + ' modes, ' + cst.panels.length + ' .console-panel(s)');
  check(JSON.stringify(cst.panels.map(p => p.id)) === JSON.stringify(cmodes.map(m => m.id)),
    'EQ · console: consoleModes lists the panels, in order',
    'list=[' + cmodes.map(m => m.id).join(',') + '] panels=[' + cst.panels.map(p => p.id).join(',') + ']');

  const assertConsole = (state, expectedId, label) => {
    const shown = (state.panels || []).filter(p => p.display !== 'none');
    check(shown.length === 1, label + ': exactly one panel showing', shown.map(p => p.id).join(',') || 'none');
    if (shown.length !== 1) return;
    check(shown[0].id === expectedId, label + ": the panel showing is the stepper's mode",
      'mode=' + expectedId + ' panel=' + shown[0].id);
    check(shown[0].w > 0 && shown[0].h > 0, label + ': the panel showing renders', shown[0].w + 'x' + shown[0].h);
    for (const off of (state.panels || []).filter(p => p.id !== shown[0].id)) {
      check(off.display === 'none', label + ': ' + off.id + ' panel is display:none', off.display);
      check(off.w === 0 || off.h === 0, label + ': ' + off.id + ' panel has no box', off.w + 'x' + off.h);
    }
    const mode = cmodes.find(m => m.id === shown[0].id) || {};
    const want = ((mode.emoji ? mode.emoji + ' ' : '') + (mode.label || '')).replace(/\s+/g, ' ').trim();
    const got = String(state.labelText || '').replace(/\s+/g, ' ').trim();
    check(got === want, label + ': the stepper label names that mode', 'label="' + got + '" want="' + want + '"');
    check(state.active === shown[0].id, label + ': ' + CONSOLE.active + ' agrees with the panel', 'active=' + state.active);
  };

  const startIdx = Math.max(0, cst.panels.findIndex(p => p.id === cst.active));
  assertConsole(cst, cmodes[startIdx].id, 'EQ · console (landing)');
  for (let k = 1; k <= cmodes.length; k++) {
    await clickSel(CONSOLE.next);
    cst = await q(CONSOLE_READ);
    assertConsole(cst, cmodes[(startIdx + k) % cmodes.length].id, 'EQ · console >' + k);
  }
  await clickSel(CONSOLE.prev);
  cst = await q(CONSOLE_READ);
  assertConsole(cst, cmodes[(startIdx + cmodes.length - 1) % cmodes.length].id, 'EQ · console <');

  console.log('');
  console.log(failures ? 'TAB PANEL CHECK FAIL (' + failures + ')' : 'TAB PANEL CHECK PASS');
  win.destroy(); srv.close();
  app.exit(failures ? 1 : 0);
})();
