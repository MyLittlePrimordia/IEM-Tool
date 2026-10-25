// Verifies the Settings pane: the one-column merged layout, and the controls the
// merge introduced.
//
// The pane has been rebuilt four times for one reason: 15 settings had to fit
// without an inner scrollbar. A ~1000px scrolling column, then a 2x2 grid of
// columns (scroll-free, but four boxes and two reading columns), then one column
// with every row paired two-up (scroll-free, but a wide gap between each label
// and its control). It is now three cards, twelve rows, 760px wide, where two
// rows are real merges of one decision that used to occupy several rows.
//
// Two of those merges are behavioural, so this suite pins them:
//
//   * Track transitions replaced the Gapless switch, the Crossfade switch and the
//     fade-length slider. The player always treated those as one 3-way choice
//     (`_overlapSecs`: crossfade, else the 0.18s gapless seam, else 0), and the
//     control must write exactly the same two localStorage keys, survive a
//     reload, and only show the length slider in Crossfade.
//   * Audio output put the channel and the device in one row, without losing
//     either control.
//
// It also pins the quiet-rest rules that make the card readable: the hint tone
// is one step below the label and the hint type is the 10px floor, not a second
// accent colour, and no control may wear the full --line border at rest. Buttons
// go further and are edgeless until hovered; value boxes keep a hairline, because
// a field with no edge stops reading as a control.
//
// Layout is the thing that regresses silently here: a longer hint or a wider
// font grows the page past the pane, which `overflow` then clips with no error.
// So the geometry is measured, not eyeballed.
//
//   npx electron tools/verify-settings-layout.js
const { app, BrowserWindow } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');
const APP_ROOT = path.join(__dirname, '..');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.gz': 'application/gzip', '.mp3': 'audio/mpeg' };

let failures = 0;
function check(label, actual, expected) {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: got ${JSON.stringify(actual)}${ok ? '' : `, expected ${JSON.stringify(expected)}`}`);
}

// Cards, row order, and the number of controls in each row. `buttons` counts the
// real buttons inside a cluster/action group; a switch or a single value box is
// one. The merged rows are the reason the count is not always 1.
const CARDS = [
  { title: 'Aesthetics', rows: [['Theme', 1], ['Font', 1], ['Text size', 1]] },
  { title: 'Accessibility', rows: [['Audio output', 2], ['Blue light filter', 1], ['Track transitions', 3]] },
  { title: 'System', rows: [['Measurement sources', 1], ['Offline database', 3], ['Settings repair', 1], ['Library', 3], ['IEM Tool', 2], ['Measurement database', 2]] }
];
// Offline database counts three: its Reset button ships `display:none` and only
// appears when the loaded database differs from the built-in one. It still has
// to be in the row, so it is counted here.

function startServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let rel = decodeURIComponent(req.url.split('?')[0]);
      if (rel === '/') rel = '/index.html';
      const fp = path.join(APP_ROOT, path.normalize(rel).replace(/^([/\\])+/, ''));
      fs.readFile(fp, (err, buf) => {
        if (err) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(buf);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv.address().port));
  });
}

// One round trip so every number describes the same frame.
const MEASURE = `(function () {
  const pane = document.getElementById('pane-settings');
  const scroll = pane.querySelector('.settings-scroll');
  const page = pane.querySelector('.settings-page');
  const groups = Array.from(page.children).filter(e => e.classList.contains('settings-group'));
  const r = (e) => e.getBoundingClientRect();
  const visible = (e) => e.offsetParent !== null;

  const cards = groups.map((g) => {
    const rows = Array.from(g.querySelectorAll('.settings-row')).filter(visible).map((row) => {
      const box = r(row);
      const label = row.querySelector('.settings-row-label');
      const hint = row.querySelector('.settings-row-hint');
      const text = row.querySelector('.settings-row-text');
      const control = row.querySelector('.settings-controls, .settings-control, .settings-slider, .settings-seg, .settings-actions, .switch');
      const cb = control ? r(control) : null;
      const lb = label ? r(label) : null;
      const wrap = row.querySelector('.settings-slider');
      return {
        label: label ? label.textContent.trim() : '',
        top: Math.round(box.top),
        height: Math.round(box.height),
        width: Math.round(box.width),
        // Buttons in a cluster, or 1 for a switch / value box / segment.
        buttons: control
          ? (control.querySelectorAll('button').length || 1)
          : 0,
        labelLines: lb ? Math.round(lb.height / parseFloat(getComputedStyle(label).lineHeight)) : 0,
        textRight: text ? Math.round(r(text).right) : 0,
        controlLeft: cb ? Math.round(cb.left) : 0,
        controlRight: cb ? Math.round(cb.right) : 0,
        rowRight: Math.round(box.right),
        rowScrollOverflow: row.scrollWidth - row.clientWidth,
        hintClippedVertically: hint ? hint.scrollHeight - hint.clientHeight : 0,
        sliderVisible: !!(wrap && !wrap.hidden)
      };
    });
    const box = r(g);
    return {
      title: (g.querySelector('.settings-group-title') || {}).textContent || '',
      left: Math.round(box.left), width: Math.round(box.width),
      rows: rows
    };
  });

  return {
    size: innerWidth + 'x' + innerHeight,
    paneHeight: Math.round(r(pane).height),
    pageHeight: Math.round(r(page).height),
    pageBottom: Math.round(r(page).bottom),
    paneBottom: Math.round(r(pane).bottom),
    scrollClient: scroll.clientHeight,
    scrollHeight: scroll.scrollHeight,
    pageColumns: getComputedStyle(page).flexDirection,
    pageWidth: Math.round(r(page).width),
    columnWrappers: page.querySelectorAll('.settings-column').length,
    hiddenRows: page.querySelectorAll('.settings-row[style*="display:none"], .settings-row.is-wide').length,
    cards: cards
  };
})()`;

const run = (win, js) => win.webContents.executeJavaScript(js, true);
const measure = (win) => run(win, MEASURE);

// Hover a viewport point through CDP. Synthesized input goes straight to the
// renderer, so it does not need the OS window to be focused - which a verify run
// behind another window cannot rely on. The wait covers the 120ms border fade,
// otherwise the read catches an interpolated colour.
async function moveMouse(win, x, y) {
  const dbg = win.webContents.debugger;
  if (!dbg.isAttached()) dbg.attach('1.3');
  await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
  await new Promise(r => setTimeout(r, 300));
}

// Resize the LAYOUT viewport through CDP, not the OS window.
//
// `win.setContentSize` looked fine stand-alone and then silently refused to grow
// the window back past 1280x720 when this suite ran inside verify:ui - which read
// as a layout overflow and failed five unrelated checks. Device-metrics
// emulation changes innerWidth/innerHeight, media queries and layout directly,
// in both directions, with no window manager in the middle.
async function resize(win, w, h) {
  const dbg = win.webContents.debugger;
  if (!dbg.isAttached()) dbg.attach('1.3');
  await dbg.sendCommand('Emulation.setDeviceMetricsOverride', {
    width: w, height: h, deviceScaleFactor: 0, mobile: false
  });
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 100));
    const s = await run(win, 'innerWidth + "x" + innerHeight');
    const [iw, ih] = String(s).split('x').map(Number);
    if (Math.abs(iw - w) <= 2 && Math.abs(ih - h) <= 2) return 'ok';
  }
  return run(win, 'innerWidth + "x" + innerHeight');
}

function checkStructure(tag, m) {
  check(`${tag} single reading column (no column wrappers)`, m.columnWrappers, 0);
  check(`${tag} page is a flex column`, m.pageColumns, 'column');
  const widths = m.cards.map(c => c.width);
  const lefts = m.cards.map(c => c.left);
  check(`${tag} card count`, m.cards.length, CARDS.length);
  check(`${tag} card titles`, m.cards.map(c => c.title).join('|'), CARDS.map(c => c.title).join('|'));
  check(`${tag} cards share one width`, new Set(widths).size, 1);
  check(`${tag} cards share one left edge`, new Set(lefts).size, 1);
  // 760px, not the workspace width: the label/control pair is the whole point of
  // the page and it must not be spread across 1100px of card.
  check(`${tag} page width`, m.pageWidth <= 760, true);
  CARDS.forEach((want, i) => {
    const card = m.cards[i];
    check(`${tag} ${want.title} row count`, card.rows.length, want.rows.length);
    check(`${tag} ${want.title} row order`, card.rows.map(r => r.label).join('|'), want.rows.map(r => r[0]).join('|'));
    want.rows.forEach(([label, buttons], j) => {
      const row = card.rows[j];
      check(`${tag} ${label} buttons`, row.buttons, buttons);
      check(`${tag} ${label} label on one line`, row.labelLines, 1);
      check(`${tag} ${label} no text/control overlap`, row.controlLeft >= row.textRight - 1, true);
      check(`${tag} ${label} control inside row`, row.controlRight <= row.rowRight + 1, true);
      check(`${tag} ${label} content does not overflow`, row.rowScrollOverflow <= 1, true);
      check(`${tag} ${label} hint not clipped vertically`, row.hintClippedVertically <= 1, true);
    });
  });
}

function checkNoScroll(tag, m) {
  check(`${tag} pane does not scroll`, m.scrollHeight - m.scrollClient, 0);
  check(`${tag} page fits the pane`, m.pageBottom <= m.paneBottom, true);
}

async function boot(win, port) {
  await win.loadURL(`http://127.0.0.1:${port}/index.html?cb=${Date.now()}`);
  for (let i = 0; i < 60; i++) {
    if (await run(win, '!!(window.App && window.EQ)').catch(() => false)) break;
    await new Promise(r => setTimeout(r, 500));
  }
  await new Promise(r => setTimeout(r, 2200));
  await run(win, "App.switchTab('settings'); App.setReadingSize(1); 'ok'");
  await new Promise(r => setTimeout(r, 700));
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  // Throwaway profile: the mode checks below write the same localStorage keys
  // the real app uses, which would otherwise leave the developer's playback
  // mode changed.
  require('./lib/verify-profile').isolateProfile('settings-layout');
  const port = await startServer();
  const win = new BrowserWindow({
    width: 1536, height: 821, show: true, frame: false,
    webPreferences: { backgroundThrottling: false }
  });
  await boot(win, port);

  console.log('\n[1] 1536x821: three cards, twelve rows, one column, no scroll');
  let m = await measure(win);
  checkStructure('desktop', m);
  checkNoScroll('desktop', m);
  // Every row is a single line of 40px. A merged row that needs a second hint
  // (the old Updates row) is the shape this check exists to catch.
  const tall = m.cards.flatMap(c => c.rows).filter(r => r.height > 41).map(r => r.label);
  check('desktop rows taller than one line', tall.join('|'), '');

  // Quiet at rest: the hint is the muted token at the 10px floor (not a second
  // bright treat), the controls sit on the faintest border, and the switch has a
  // visible track in both states. Measured through a probe element because the
  // tokens are hex and computed styles are rgb.
  const style = await run(win, `(() => {
    const root = getComputedStyle(document.documentElement);
    const v = (n) => root.getPropertyValue(n).trim();
    const probe = document.createElement('span');
    document.body.appendChild(probe);
    const probeColor = (n) => { probe.style.color = v(n); return getComputedStyle(probe).color; };
    const probeBg = (n) => { probe.style.backgroundColor = v(n); return getComputedStyle(probe).backgroundColor; };
    probe.style.borderStyle = 'solid';
    probe.style.borderColor = v('--line-subtle');
    const lineSubtleBorder = getComputedStyle(probe).borderTopColor;
    probe.style.borderColor = v('--line-strong');
    const lineStrongBorder = getComputedStyle(probe).borderTopColor;
    const lo = probeColor('--text-lo');
    const accent = probeColor('--accent');
    const lineBg = probeBg('--line');
    const accentBg = probeBg('--accent');
    const hoverBg = probeBg('--bg-hover');
    probe.remove();

    const hint = getComputedStyle(document.querySelector('.settings-row-hint'));
    const label = getComputedStyle(document.querySelector('.settings-row-label'));
    const btn = getComputedStyle(document.querySelector('.settings-row .settings-btn:not(.settings-btn-outline)'));
    const control = getComputedStyle(document.querySelector('.settings-row .settings-control'));
    const sw = document.getElementById('a11y-bluelight-btn');
    const track = sw.querySelector('.switch-track');
    // The track cross-fades its fill with an !important transition, so an
    // inline transition:none loses to the stylesheet and the computed style
    // read right after the class change is still the previous colour.
    track.style.setProperty('transition', 'none', 'important');
    const rowBg = getComputedStyle(document.querySelector('.settings-row')).backgroundColor;
    const offBg = getComputedStyle(track).backgroundColor;
    const wasOn = sw.classList.contains('is-on');
    sw.classList.add('is-on');
    const onBg = getComputedStyle(track).backgroundColor;
    if (!wasOn) sw.classList.remove('is-on');
    track.style.removeProperty('transition');
    return {
      hintColor: hint.color, hintSize: hint.fontSize, labelColor: label.color,
      lo, accent, btnBorder: btn.borderTopColor, lineSubtleBorder, lineStrongBorder,
      controlBorder: control.borderTopColor,
      offBg, onBg, lineBg, accentBg, rowBg, hoverBg
    };
  })()`);
  check('hint uses --text-lo', style.hintColor, style.lo);
  check('hint is not the accent colour', style.hintColor === style.accent, false);
  check('hint is darker than the label', style.hintColor === style.labelColor, false);
  check('hint type is the 10px floor', style.hintSize, '10px');
  check('switch off track is visible against the row', style.offBg === style.rowBg, false);
  check('switch off track uses --line', style.offBg, style.lineBg);
  check('switch on track uses the accent', style.onBg, style.accentBg);

  // Borders are the difference between a quiet card and a grid of lit-up boxes,
  // so both halves of the rule are pinned: an action button has no edge until it
  // is hovered, and a value box keeps one so it still reads as a field.
  check('button border invisible at rest', style.btnBorder, 'rgba(0, 0, 0, 0)');
  check('value box keeps a hairline at rest', style.controlBorder, style.lineSubtleBorder);
  // The deliberate exception: Credits is the only action button alone in its row,
  // so nothing else there says the row has an action. It keeps the field hairline.
  check('lone Credits button keeps a hairline', await run(win,
    "getComputedStyle(document.querySelector('.settings-btn-outline')).borderTopColor"), style.lineSubtleBorder);
  const point = await run(win, `(() => {
    const b = Array.from(document.querySelectorAll('.settings-row .settings-btn:not(.settings-btn-outline)'))
      .find(e => e.offsetParent !== null && e.getBoundingClientRect().height > 0);
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), text: b.textContent.trim() };
  })()`);
  await moveMouse(win, point.x, point.y);
  const hovered = await run(win, `(() => {
    const b = document.querySelector('.settings-row .settings-btn:hover');
    if (!b) return { border: 'nothing hovered', bg: 'nothing hovered' };
    const s = getComputedStyle(b);
    return { border: s.borderTopColor, bg: s.backgroundColor };
  })()`);
  check(`hovered button (${point.text}) draws an edge`, hovered.border, style.lineStrongBorder);
  // A button that starts with a hairline must brighten on hover too, not sit still.
  await moveMouse(win, await run(win, `(() => {
    const r = document.querySelector('.settings-btn-outline').getBoundingClientRect();
    return Math.round(r.left + r.width / 2);
  })()`), await run(win, `(() => {
    const r = document.querySelector('.settings-btn-outline').getBoundingClientRect();
    return Math.round(r.top + r.height / 2);
  })()`));
  check('Credits hairline brightens on hover', await run(win, `(() => {
    const b = document.querySelector('.settings-btn-outline');
    return b.matches(':hover') ? getComputedStyle(b).borderTopColor : 'not hovered';
  })()`), style.lineStrongBorder);
  await moveMouse(win, 2, 2);
  // The edge must not arrive by way of the fill vanishing into the row: at rest
  // the fill is the only thing placing the button, so a hover that drops it would
  // leave an empty outline where a button used to be.
  check(`hovered button (${point.text}) keeps a fill`, hovered.bg, style.hoverBg);
  check(`hovered button (${point.text}) fill is not the row`, hovered.bg === style.rowBg, false);
  await moveMouse(win, 2, 2);
  check('button edge disappears again after hover', await run(win,
    "getComputedStyle(document.querySelector('.settings-row .settings-btn:not(.settings-btn-outline)')).borderTopColor"), 'rgba(0, 0, 0, 0)');

  check('content is vertically centred', await run(win, `(() => {
    const pane = document.getElementById('pane-settings');
    const page = pane.querySelector('.settings-page');
    const p = pane.getBoundingClientRect(), b = page.getBoundingClientRect();
    return Math.abs((b.top - p.top) - (p.bottom - b.bottom)) <= 2;
  })()`), true);

  console.log('\n[2] Track transitions: the 3-way control replaces two switches + a slider');
  // Fresh profile: settings_gapless is unset, which means ON.
  let mode = await run(win, `({
    active: Array.from(document.querySelectorAll('#settings-track-mode .settings-seg-btn')).filter(b => b.classList.contains('is-active')).map(b => b.textContent.trim()).join(''),
    pressed: document.querySelectorAll('#settings-track-mode [aria-pressed="true"]').length,
    slider: !document.getElementById('crossfade-length').hidden,
    gapless: localStorage.getItem('settings_gapless'),
    crossfade: localStorage.getItem('settings_crossfade')
  })`);
  check('default mode is Gapless', mode.active, 'Gapless');
  check('exactly one segment pressed', mode.pressed, 1);
  // The first build of this control picked the selected pill with the 8%-opacity
  // accent on black, which no one could see. Pin the contrast, not just the class.
  const segStyle = await run(win, `(() => {
    const active = document.querySelector('#settings-track-mode .settings-seg-btn.is-active');
    const idle = Array.from(document.querySelectorAll('#settings-track-mode .settings-seg-btn'))
      .find(b => !b.classList.contains('is-active'));
    const a = getComputedStyle(active), i = getComputedStyle(idle);
    return { bgDiffers: a.backgroundColor !== i.backgroundColor, ring: a.boxShadow !== 'none' };
  })()`);
  check('selected segment has its own fill', segStyle.bgDiffers, true);
  check('selected segment has an accent ring', segStyle.ring, true);
  check('length slider hidden when not crossfading', mode.slider, false);

  await run(win, "document.querySelector('#settings-track-mode [data-arg-0=\"off\"]').click(); 'ok'");
  mode = await run(win, `({
    active: Array.from(document.querySelectorAll('#settings-track-mode .settings-seg-btn')).filter(b => b.classList.contains('is-active')).map(b => b.textContent.trim()).join(''),
    gapless: localStorage.getItem('settings_gapless'),
    crossfade: localStorage.getItem('settings_crossfade'),
    slider: !document.getElementById('crossfade-length').hidden
  })`);
  check('Off writes gapless=0', mode.gapless, '0');
  check('Off writes crossfade=0', mode.crossfade, '0');
  check('Off is active', mode.active, 'Off');

  await run(win, "document.querySelector('#settings-track-mode [data-arg-0=\"crossfade\"]').click(); 'ok'");
  mode = await run(win, `({
    active: Array.from(document.querySelectorAll('#settings-track-mode .settings-seg-btn')).filter(b => b.classList.contains('is-active')).map(b => b.textContent.trim()).join(''),
    gapless: localStorage.getItem('settings_gapless'),
    crossfade: localStorage.getItem('settings_crossfade'),
    slider: !document.getElementById('crossfade-length').hidden,
    disabled: document.getElementById('a11y-crossfade-slider').disabled,
    display: document.getElementById('a11y-crossfade-display').textContent
  })`);
  check('Crossfade is active', mode.active, 'Crossfade');
  check('Crossfade writes crossfade=1', mode.crossfade, '1');
  check('Crossfade keeps gapless=1 underneath (so toggling back restores it)', mode.gapless, '1');
  check('length slider shown for Crossfade', mode.slider, true);
  check('length slider enabled for Crossfade', mode.disabled, false);
  check('length readout', mode.display, '6s');

  await run(win, `(() => {
    const s = document.getElementById('a11y-crossfade-slider');
    s.value = '9';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok';
  })()`);
  await new Promise(r => setTimeout(r, 200));
  mode = await run(win, `({
    stored: localStorage.getItem('settings_crossfade_secs'),
    display: document.getElementById('a11y-crossfade-display').textContent
  })`);
  check('slider writes crossfade seconds', mode.stored, '9');
  check('slider readout follows', mode.display, '9s');

  await run(win, "document.querySelector('#settings-track-mode [data-arg-0=\"gapless\"]').click(); 'ok'");
  mode = await run(win, `({
    active: Array.from(document.querySelectorAll('#settings-track-mode .settings-seg-btn')).filter(b => b.classList.contains('is-active')).map(b => b.textContent.trim()).join(''),
    gapless: localStorage.getItem('settings_gapless'),
    crossfade: localStorage.getItem('settings_crossfade'),
    slider: !document.getElementById('crossfade-length').hidden
  })`);
  check('back to Gapless clears crossfade', mode.crossfade, '0');
  check('back to Gapless keeps gapless=1', mode.gapless, '1');
  check('Gapless hides the length slider again', mode.slider, false);

  // The mode is read from storage on boot, so a reload must restore it.
  await run(win, "document.querySelector('#settings-track-mode [data-arg-0=\"crossfade\"]').click(); 'ok'");
  await boot(win, port);
  mode = await run(win, `({
    active: Array.from(document.querySelectorAll('#settings-track-mode .settings-seg-btn')).filter(b => b.classList.contains('is-active')).map(b => b.textContent.trim()).join(''),
    slider: !document.getElementById('crossfade-length').hidden,
    display: document.getElementById('a11y-crossfade-display').textContent
  })`);
  check('mode restored after reload', mode.active, 'Crossfade');
  check('length slider restored after reload', mode.slider, true);
  check('length value restored after reload', mode.display, '9s');

  console.log('\n[3] Audio output: channel and device share one row');
  const audio = await run(win, `(() => {
    const row = document.getElementById('a11y-audio-btn').closest('.settings-row');
    const a = document.getElementById('a11y-audio-btn').getBoundingClientRect();
    const b = document.getElementById('audio-output-btn').getBoundingClientRect();
    return { sameRow: row === document.getElementById('audio-output-btn').closest('.settings-row'),
             sideBySide: Math.abs(a.top - b.top) < 2 && b.left > a.right,
             channel: document.getElementById('a11y-audio-btn').textContent.trim() };
  })()`);
  check('channel and device share one row', audio.sameRow, true);
  check('channel sits before the device box', audio.sideBySide, true);
  check('channel still shows its value', audio.channel.length > 0, true);

  console.log('\n[4] 1280x720 (smallest supported desktop window): still no scroll');
  const at1280 = await resize(win, 1280, 720);
  check('resized to 1280x720', at1280, 'ok');
  await new Promise(r => setTimeout(r, 300));
  m = await measure(win);
  checkNoScroll('1280', m);

  console.log('\n[4b] 1229x691 (default window on a 1366x768 laptop): no phantom clearance scroll');
  const atLaptop = await resize(win, 1229, 691);
  check('resized to 1229x691', atLaptop, 'ok');
  await new Promise(r => setTimeout(r, 300));
  m = await measure(win);
  checkNoScroll('laptop', m);
  // Below 1280 the footer floats over the pane, so the page still has to clear
  // it - just by the real overlap, not by the whole bar's height. That padding
  // was the "slight scroll": a page that fit the pane kept 128px of scroll
  // under it, permanently.
  check('laptop: last card clears the floating footer', await run(win, `(() => {
    const foot = document.getElementById('global-footer-bar');
    const page = document.getElementById('pane-settings').querySelector('.settings-page');
    return Math.round(page.getBoundingClientRect().bottom) <= Math.round(foot.getBoundingClientRect().top) + 1;
  })()`), true);

  console.log('\n[5] text size 125%: the largest slider step still fits');
  await resize(win, 1536, 821);
  await new Promise(r => setTimeout(r, 300));
  await run(win, "App.setReadingSize(1.25); 'ok'");
  await new Promise(r => setTimeout(r, 700));
  m = await measure(win);
  checkStructure('125%', m);
  checkNoScroll('125%', m);
  await run(win, "App.setReadingSize(1); 'ok'");

  console.log('\n[6] update-status row: appears, spans the card, does not push the page out of view');
  await run(win, `(() => {
    document.getElementById('update-status').style.display = 'flex';
    document.getElementById('update-status-text').textContent = 'Checking for a newer database...';
    return 'ok';
  })()`);
  await new Promise(r => setTimeout(r, 300));
  m = await measure(win);
  const status = m.cards[2].rows.find(r => r.label === 'Update status');
  check('status row present', !!status, true);
  check('status row spans the card', status && (Math.abs(status.width - m.cards[2].width) <= 1), true);
  check('status row keeps the pane scroll-free at 1536', m.pageBottom <= m.paneBottom, true);
  await run(win, "document.getElementById('update-status').style.display='none'; 'ok'");

  console.log('\n[7] 1024x640: narrow window scrolls instead of clipping');
  const at1024 = await resize(win, 1024, 640);
  check('resized to 1024x640', at1024, 'ok');
  await new Promise(r => setTimeout(r, 300));
  m = await measure(win);
  check('narrow pane scrolls', m.scrollHeight > m.scrollClient, true);
  check('no horizontal overflow', await run(win, `(() => {
    const sc = document.querySelector('#pane-settings .settings-scroll');
    return sc.scrollWidth <= sc.clientWidth + 1;
  })()`), true);
  const lastReachable = await run(win, `(() => {
    const pane = document.getElementById('pane-settings');
    const scroll = pane.querySelector('.settings-scroll');
    scroll.scrollTop = scroll.scrollHeight;
    const last = pane.querySelector('.settings-page').lastElementChild.getBoundingClientRect();
    const box = scroll.getBoundingClientRect();
    return last.bottom <= box.bottom + 1;
  })()`);
  check('last card reachable by scrolling', lastReachable, true);

  win.destroy();
  console.log('');
  if (failures) {
    console.error(`SETTINGS LAYOUT FAILED (${failures} check(s))`);
    app.exit(1);
  } else {
    console.log('SETTINGS LAYOUT PASSED');
    app.exit(0);
  }
}).catch((e) => {
  console.error('SETTINGS LAYOUT FAILED: ' + (e && e.message || e));
  app.exit(1);
});
