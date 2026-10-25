// Verifies the three Settings click-to-cycle boxes - Audio channel, Theme and
// Font - so their order, their label and their persistence are pinned.
//
// All three are the same control shape (one .settings-control button, click to
// advance) and all three are easy to break silently: a reordered theme table, a
// label that stops carrying the emoji, a stored id that is written but never
// read back. Theme and Font already round-tripped; Audio channel was
// session-only until this suite existed, so a Mono choice was forgotten on the
// next launch. The suite drives the real buttons through the data-action
// dispatcher, then reloads the document twice: once to prove each saved choice
// is restored, once to prove an empty profile lands on the documented defaults.
//
//   npx electron tools/verify-settings-cycle.js
const { app, BrowserWindow } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');
const APP_ROOT = path.join(__dirname, '..');
// This suite writes theme, font and audio-mode keys and reloads the document.
// A throwaway profile (tools/lib/verify-profile.js) keeps it out of the real
// one whether it is started by verify:ui or by hand.
require('./lib/verify-profile').isolateProfile('settings-cycle');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.gz': 'application/gzip', '.mp3': 'audio/mpeg' };

let failures = 0;
function check(label, actual, expected) {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: got ${JSON.stringify(actual)}${ok ? '' : `, expected ${JSON.stringify(expected)}`}`);
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const port = await startServer();
  const win = new BrowserWindow({ width: 1536, height: 821, show: true, webPreferences: { backgroundThrottling: false } });
  await win.loadURL(`http://127.0.0.1:${port}/index.html?cb=${Date.now()}`);
  const run = (js) => win.webContents.executeJavaScript(js, true);

  // Boot is a chain: fonts -> themes -> restoreSavedSettings. Until
  // settingsRestored is set and the font map exists, the three buttons hold
  // their static markup (empty label), so checking them earlier would read
  // "nothing happened" and pass or fail at random.
  // document.readyState matters as much as the app's own flags: the Audio
  // channel is restored from a window 'load' hook (Accessibility.init), which on
  // a slow runner can land after the settings chain above has finished. Without
  // this the persistence check would race the very restore it is checking.
  async function bootReady() {
    for (let i = 0; i < 120; i++) {
      const ok = await run(`!!(window.App && App.settingsRestored && document.readyState === 'complete'
        && App.currentFontMeta
        && Object.keys(App.fontMap || {}).length
        && (document.getElementById('font-cycle-btn') || {}).textContent
        && document.getElementById('font-cycle-btn').textContent.trim())`).catch(() => false);
      if (ok === true) return true;
      await sleep(250);
    }
    return false;
  }
  async function reloadApp() {
    try { await run('location.reload(); 1'); } catch (e) {}
    return bootReady();
  }

  const booted = await bootReady();
  console.log('\n[1] the three cycle boxes are present and labelled');
  check('the app finished its boot restore chain', booted, 'true');

  // Normalise to a known starting point, and build the audio context now so the
  // mono check has a master gain to read. Independent of the OS device list:
  // this is about the graph's channel count, not about which sink is selected.
  const setup = await run(`(() => {
    App.switchTab('settings');
    let ctx = null;
    try { ctx = SharedAudio.init(); } catch (e) {}
    if (window.isMonoMode) document.getElementById('a11y-audio-btn').click();
    const themes = (App.builtInThemes || []).map(t => ({ id: t.id, name: t.name, emoji: t.emoji, accent: t.variables['--accent-blue'] }));
    App.setGlobalTheme(themes[0].id);
    const fonts = Object.keys(App.fontMap || {});
    App.setGlobalFont(fonts[0]);
    return {
      themes,
      mapOrder: Object.keys(App.themeMap || {}),
      fonts,
      firstFontEmoji: ((App.fontMeta || []).find(m => m.id === fonts[0]) || {}).emoji,
      ctx: !!ctx,
      audioText: document.getElementById('a11y-audio-btn').textContent.trim(),
      mono: window.isMonoMode,
      themeText: document.getElementById('theme-cycle-btn').textContent.trim(),
      fontText: document.getElementById('font-cycle-btn').textContent.trim()
    };
  })()`);
  check('Audio channel starts on Stereo', setup.audioText, 'Stereo');
  check('mono flag starts off', setup.mono, 'false');
  check('Theme shows the declared first theme', setup.themeText, `${setup.themes[0].emoji} ${setup.themes[0].name}`);
  check('Font shows the announced first font', setup.fontText, `${setup.firstFontEmoji} ${setup.fonts[0]}`);
  check('audio context available for the channel check', setup.ctx, 'true');
  check('themeMap is built in the declared theme order', setup.mapOrder.join(','), setup.themes.map(t => t.id).join(','));

  console.log('\n[2] Audio channel: Stereo -> Mono -> Stereo, flag, label and graph together');
  const audio = await run(`(async () => {
    const btn = document.getElementById('a11y-audio-btn');
    const out = [];
    for (let i = 0; i < 2; i++) {
      btn.click();
      await new Promise(r => setTimeout(r, 120));
      out.push({
        text: btn.textContent.trim(),
        mono: window.isMonoMode,
        stored: localStorage.getItem('settings_audio_mode'),
        ch: SharedAudio.masterGain ? SharedAudio.masterGain.channelCount : null,
        mode: SharedAudio.masterGain ? SharedAudio.masterGain.channelCountMode : null
      });
    }
    return out;
  })()`);
  check('click 1 label', audio[0].text, 'Mono');
  check('click 1 flag', audio[0].mono, 'true');
  check('click 1 persisted', audio[0].stored, 'mono');
  check('click 1 graph channel count', audio[0].ch, 1);
  check('click 1 graph channel mode', audio[0].mode, 'explicit');
  check('click 2 label', audio[1].text, 'Stereo');
  check('click 2 flag', audio[1].mono, 'false');
  check('click 2 persisted', audio[1].stored, 'stereo');
  check('click 2 graph channel count', audio[1].ch, 2);
  check('click 2 graph channel mode', audio[1].mode, 'max');

  console.log('\n[3] Theme: one click advances one theme, wraps, and applies its tokens');
  const themeSteps = await run(`(async () => {
    const btn = document.getElementById('theme-cycle-btn');
    const out = [];
    for (let i = 0; i < 11; i++) {
      btn.click();
      await new Promise(r => setTimeout(r, 80));
      const root = document.documentElement;
      out.push({
        stored: localStorage.getItem('settings_theme_id'),
        current: App.currentTheme,
        classes: Array.from(root.classList).filter(c => c.startsWith('theme-')),
        accent: root.style.getPropertyValue('--accent').trim(),
        text: btn.textContent.trim()
      });
    }
    return out;
  })()`);
  const themeIds = setup.themes.map(t => t.id);
  themeSteps.forEach((step, i) => {
    const want = setup.themes[(i + 1) % themeIds.length];
    check(`click ${i + 1} stored theme`, step.stored, want.id);
    check(`click ${i + 1} active theme`, step.current, want.id);
    check(`click ${i + 1} label (emoji kept)`, step.text, `${want.emoji} ${want.name}`);
    check(`click ${i + 1} class`, step.classes.join(','), `theme-${want.id}`);
    check(`click ${i + 1} accent applied`, step.accent, want.accent);
  });
  check('theme wrapped back to the first theme after a full lap', themeSteps[themeIds.length - 1].current, themeIds[0]);
  // 11 clicks from index 0, so the run ends two themes past the default. That
  // matters: restoring "slate" would prove nothing, since it is also the
  // fallback an ignored key produces.
  const themeIndexAfter = 11 % themeIds.length;
  check('the theme run ends off the default', themeIndexAfter !== 0, true);
  check('theme at the end of the run', themeSteps[10].current, themeIds[themeIndexAfter]);

  console.log('\n[4] Font: one click advances one font, wraps, and applies its family');
  const fontSteps = await run(`(async () => {
    const btn = document.getElementById('font-cycle-btn');
    const keys = Object.keys(App.fontMap || {});
    const out = [];
    for (let i = 0; i < keys.length + 1; i++) {
      btn.click();
      await new Promise(r => setTimeout(r, 80));
      const id = localStorage.getItem('settings_font_id');
      const meta = (App.fontMeta || []).find(m => m.id === id) || {};
      out.push({
        stored: id,
        family: document.documentElement.style.getPropertyValue('--font-family').trim(),
        expectedFamily: String(App.fontMap[id] || '').trim(),
        text: btn.textContent.trim(),
        meta: { id: meta.id, emoji: meta.emoji, scale: meta.scale },
        currentMeta: App.currentFontMeta ? App.currentFontMeta.id : null
      });
    }
    return out;
  })()`);
  const fontNames = setup.fonts;
  fontSteps.forEach((step, i) => {
    const want = fontNames[(i + 1) % fontNames.length];
    check(`click ${i + 1} stored font`, step.stored, want);
    check(`click ${i + 1} label names the font`, step.text.indexOf(want) !== -1, true);
    check(`click ${i + 1} label keeps its emoji`, step.text, `${step.meta.emoji} ${want}`);
    check(`click ${i + 1} family applied`, step.family, step.expectedFamily);
    check(`click ${i + 1} current font metadata`, step.currentMeta, want);
  });
  check('font wrapped back to the first font after a full lap', fontSteps[fontNames.length - 1].stored, fontNames[0]);
  check('landed on the second font before the reload', fontSteps[fontNames.length].stored, fontNames[1]);
  check('every stored font resolves to a font family', fontSteps.every(s => !!s.expectedFamily), true);

  // Leave Mono + an off-default theme and font, then prove a fresh document
  // reads all three back. This is the persistence half: writing the key is only
  // useful if boot applies it.
  await run(`(document.getElementById('a11y-audio-btn').click(), 1)`);
  await sleep(150);

  console.log('\n[5] a fresh document restores Mono, the chosen theme and the chosen font');
  check('reload finished booting', await reloadApp(), 'true');
  // Give the load-hook restores their setTimeout(0) turn.
  await sleep(400);
  const restored = await run(`(() => {
    let ctx = null;
    try { ctx = SharedAudio.init(); } catch (e) {}
    const meta = App.currentFontMeta || {};
    return {
      mono: window.isMonoMode,
      audioText: document.getElementById('a11y-audio-btn').textContent.trim(),
      audioStored: localStorage.getItem('settings_audio_mode'),
      ch: SharedAudio.masterGain ? SharedAudio.masterGain.channelCount : null,
      mode: SharedAudio.masterGain ? SharedAudio.masterGain.channelCountMode : null,
      themeStored: localStorage.getItem('settings_theme_id'),
      themeCurrent: App.currentTheme,
      themeClass: document.documentElement.classList.contains('theme-' + App.currentTheme),
      themeText: document.getElementById('theme-cycle-btn').textContent.trim(),
      fontStored: localStorage.getItem('settings_font_id'),
      fontText: document.getElementById('font-cycle-btn').textContent.trim(),
      fontFamily: document.documentElement.style.getPropertyValue('--font-family').trim(),
      fontExpected: String(App.fontMap[localStorage.getItem('settings_font_id')] || '').trim(),
      fontMetaId: meta.id
    };
  })()`);
  check('mono flag restored', restored.mono, 'true');
  check('label restored', restored.audioText, 'Mono');
  check('stored mode survives', restored.audioStored, 'mono');
  check('restored mono reaches the audio graph', restored.ch, 1);
  check('restored mono sets the graph channel mode', restored.mode, 'explicit');
  // A full font lap plus one leaves the second font, which is not the default -
  // restoring "JetBrains Mono" would pass even if the key were ignored.
  const themeAfterReload = setup.themes[themeIndexAfter];
  const fontAfterReload = fontNames[1];
  check('the font run ends off the default', fontAfterReload !== 'JetBrains Mono', true);
  check('theme id survives', restored.themeStored, themeAfterReload.id);
  check('theme applied after reload', restored.themeCurrent, themeAfterReload.id);
  check('theme class applied after reload', restored.themeClass, 'true');
  check('theme label after reload', restored.themeText, `${themeAfterReload.emoji} ${themeAfterReload.name}`);
  check('font id survives', restored.fontStored, fontAfterReload);
  check('font label after reload', restored.fontText, `${fontSteps[fontNames.length].meta.emoji} ${fontAfterReload}`);
  check('font family after reload', restored.fontFamily, restored.fontExpected);
  check('font metadata after reload', restored.fontMetaId, fontAfterReload);

  console.log('\n[6] an empty profile lands on the documented defaults');
  await run(`(localStorage.removeItem('settings_audio_mode'),
              localStorage.removeItem('settings_theme_id'),
              localStorage.removeItem('settings_font_id'), 1)`);
  check('reload finished booting', await reloadApp(), 'true');
  await sleep(400);
  const fresh = await run(`(() => {
    let ctx = null;
    try { ctx = SharedAudio.init(); } catch (e) {}
    return {
      mono: window.isMonoMode,
      audioText: document.getElementById('a11y-audio-btn').textContent.trim(),
      audioKey: localStorage.getItem('settings_audio_mode'),
      ch: SharedAudio.masterGain ? SharedAudio.masterGain.channelCount : null,
      mode: SharedAudio.masterGain ? SharedAudio.masterGain.channelCountMode : null,
      theme: App.currentTheme,
      themeText: document.getElementById('theme-cycle-btn').textContent.trim(),
      fontStored: localStorage.getItem('settings_font_id'),
      fontText: document.getElementById('font-cycle-btn').textContent.trim(),
      fontFamily: document.documentElement.style.getPropertyValue('--font-family').trim(),
      fontExpected: String(App.fontMap['JetBrains Mono'] || '').trim(),
      fontEmoji: ((App.fontMeta || []).find(m => m.id === 'JetBrains Mono') || {}).emoji
    };
  })()`);
  check('default mode is Stereo', fresh.audioText, 'Stereo');
  check('default mono flag is off', fresh.mono, 'false');
  check('nothing written until the user chooses', fresh.audioKey, 'null');
  check('default graph is stereo', fresh.ch, 2);
  check('default graph channel mode', fresh.mode, 'max');
  check('default theme', fresh.theme, 'slate');
  check('default theme label', fresh.themeText, `${setup.themes[0].emoji} ${setup.themes[0].name}`);
  check('default font', fresh.fontStored, 'JetBrains Mono');
  check('default font label', fresh.fontText, `${fresh.fontEmoji} JetBrains Mono`);
  check('default font family', fresh.fontFamily, fresh.fontExpected);

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  app.exit(failures === 0 ? 0 : 1);
});
setTimeout(() => { console.log('WATCHDOG TIMEOUT'); app.exit(2); }, 180000);
