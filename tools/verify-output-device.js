// Verifies Settings > Output device: shortened labels (full name kept in the
// tooltip), one click steps through every endpoint and wraps back to System
// default, and the button is disabled - and inert - when the OS exposes none.
//
// The control has been rebuilt three times (dropdown -> stepper -> click-to-
// cycle), and every check of it so far was a throwaway probe. This keeps the
// contract covered so a future restyle cannot quietly drop a device from the
// cycle or bring back the chipset string on the label.
//
//   npx electron tools/verify-output-device.js
const { app, BrowserWindow } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');
const APP_ROOT = path.join(__dirname, '..');
// The suite clears the saved output-device key so the run starts from System
// default; a throwaway profile (tools/lib/verify-profile.js) keeps that away
// from the developer's chosen DAC whether it runs under verify:ui or by hand.
require('./lib/verify-profile').isolateProfile('output-device');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.gz': 'application/gzip', '.mp3': 'audio/mpeg' };

let failures = 0;
function check(label, actual, expected) {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: got ${JSON.stringify(actual)}${ok ? '' : `, expected ${JSON.stringify(expected)}`}`);
}

// The Windows endpoint names that produced the two-row, chipset-laden label.
// "default" and "communications" are the aliases enumerateDevices adds on top
// of the physical endpoint; the row must show each device exactly once.
const DEVICES = [
  { id: 'default', label: 'Default - Wired IEMs (CX31993+MAX97220 HiFiAudio)' },
  { id: 'communications', label: 'Communications - Wired IEMs (CX31993+MAX97220 HiFiAudio)' },
  { id: 'd1', label: '3 - AG276QZD2 (2- AMD High Definition Audio Device)' },
  { id: 'd2', label: 'Speakers (Realtek(R) Audio)' },
  { id: 'd3', label: 'Wired IEMs (CX31993+MAX97220 HiFiAudio) (06cb:1595)' },
  { id: 'd4', label: '(Unknown)' },
  { id: 'd5', label: '' }
];
const SHORT = ['AG276QZD2', 'Speakers', 'Wired IEMs', '(Unknown)'];

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
  for (let i = 0; i < 80; i++) {
    if (await run("!!(window.App && typeof SharedAudio !== 'undefined' && SharedAudio.listOutputDevices)").catch(() => false)) break;
    await new Promise(r => setTimeout(r, 500));
  }
  await new Promise(r => setTimeout(r, 2500));

  // No audio hardware on CI, and switching a sink for real would move the sound
  // card out from under whoever is running this. Both audio calls are stubbed:
  // listOutputDevices feeds the row, setOutputDevice records what the click
  // asked for.
  const setup = await run(`(async () => {
    window.__odDevices = ${JSON.stringify(DEVICES)};
    window.__odCalls = [];
    SharedAudio.listOutputDevices = async () => window.__odDevices
      .map(d => ({ kind: 'audiooutput', deviceId: d.id, label: d.label }));
    SharedAudio.setOutputDevice = async (id) => { window.__odCalls.push(id); return { ok: true, deviceId: id }; };
    try { localStorage.removeItem('settings_audio_output'); } catch (e) {}
    App.switchTab('settings');
    await App.initAudioOutputs();
    return document.getElementById('audio-output-btn') ? 'ok' : 'BUTTON MISSING';
  })()`);
  console.log('\n[1] the row shows one shortened control and starts on System default');
  check('row present', setup, 'ok');

  const first = await run(`(() => {
    const b = document.getElementById('audio-output-btn');
    const span = document.getElementById('audio-output-label');
    return {
      list: (App._audioOutputs || []).map(d => ({ id: d.id, label: d.label, short: d.short })),
      text: span ? span.textContent : b.textContent,
      title: b.title,
      aria: b.getAttribute('aria-label'),
      disabled: b.disabled,
      buttons: document.querySelectorAll('#audio-output-btn').length,
      stepper: !!document.getElementById('audio-output-stepper'),
      arrows: document.querySelectorAll('#pane-settings .stepper-arrow').length
    };
  })()`);
  check('endpoints after dropping default/communications aliases', (first.list || []).length, 5);
  check('endpoint order', (first.list || []).map(d => d.id).join(','), 'd1,d2,d3,d4,d5');
  SHORT.forEach((short, i) => {
    check(`short label for ${first.list && first.list[i] ? first.list[i].label : i}`, first.list && first.list[i] && first.list[i].short, short);
  });
  check('unlabelled endpoint gets a placeholder', /^Output \d+$/.test((first.list[4] || {}).short || ''), 'true');
  check('full Windows name is still carried in the tooltip (start)', first.title, 'System default — click to switch');
  check('start label', first.text, 'System default');
  check('accessible name', first.aria, 'Output device: System default');
  check('one control, no stepper arrows left behind', first.stepper === false && first.arrows === 0, 'true');
  check('not disabled while devices exist', first.disabled, 'false');

  console.log('\n[2] one click steps to the next device, in order, then wraps to System default');
  const cycle = await run(`(async () => {
    const out = [];
    const b = document.getElementById('audio-output-btn');
    const span = document.getElementById('audio-output-label');
    for (let i = 0; i < 6; i++) {
      b.click();
      await new Promise(r => setTimeout(r, 150));
      out.push({ text: span.textContent, title: b.title, calls: window.__odCalls.slice(), disabled: b.disabled });
    }
    return out;
  })()`);
  const expectedText = SHORT.concat(['Output ' + 5, 'System default']);
  cycle.forEach((step, i) => check(`click ${i + 1} shows`, step.text, expectedText[i]));
  cycle.forEach((step, i) => {
    const want = i < 5 ? `d${i + 1}` : '';
    check(`click ${i + 1} moved the sink to`, step.calls[step.calls.length - 1], want);
  });
  check('every click moved the sink exactly once', cycle[5].calls.join(','), 'd1,d2,d3,d4,d5,');
  check('wrapped back to System default after the last device', cycle[5].text, 'System default');
  check('full device name kept in the tooltip after a switch', cycle[2].title, 'Wired IEMs (CX31993+MAX97220 HiFiAudio) (06cb:1595) — click to switch');
  check('never disabled while cycling', cycle.every(s => s.disabled === false), 'true');

  console.log('\n[3] the toast names the device, and stays one entry');
  const toast = await run(`(() => {
    const nodes = document.querySelectorAll('#toast-stack [data-toast-key="audio-output"]');
    const msg = nodes.length ? nodes[nodes.length - 1].querySelector('.toast-msg') : null;
    return { count: nodes.length, text: msg ? msg.textContent : '' };
  })()`);
  check('keyed toasts after six clicks', toast.count, 1);
  check('toast text', toast.text, 'Audio output: System default');

  console.log('\n[4] two devices that shorten to the same name keep their full names');
  const collide = await run(`(async () => {
    window.__odDevices = [
      { id: 's1', label: 'Speakers (Realtek(R) Audio)' },
      { id: 's2', label: 'Speakers (USB Audio Device)' },
      { id: 'w1', label: 'Wired IEMs (CX31993+MAX97220 HiFiAudio) (06cb:1595)' }
    ];
    await App.initAudioOutputs();
    return (App._audioOutputs || []).map(d => ({ label: d.label, short: d.short }));
  })()`);
  check('first Speaker keeps its full name', collide[0].short, collide[0].label);
  check('second Speaker keeps its full name', collide[1].short, collide[1].label);
  check('unambiguous name is still shortened', collide[2].short, 'Wired IEMs');

  console.log('\n[5] no endpoints: disabled, silent, still labelled System default');
  const empty = await run(`(async () => {
    window.__odDevices = [];
    await App.initAudioOutputs();
    const b = document.getElementById('audio-output-btn');
    const before = window.__odCalls.length;
    b.click();
    await new Promise(r => setTimeout(r, 200));
    const nodes = document.querySelectorAll('#toast-stack [data-toast-key="audio-output"]');
    return {
      disabled: b.disabled,
      text: document.getElementById('audio-output-label').textContent,
      title: b.title,
      before, after: window.__odCalls.length,
      toasts: nodes.length,
      toastText: nodes.length ? nodes[nodes.length - 1].querySelector('.toast-msg').textContent : ''
    };
  })()`);
  check('disabled with no devices', empty.disabled, 'true');
  check('label falls back to System default', empty.text, 'System default');
  check('tooltip still explains the control', empty.title, 'System default — click to switch');
  check('click did not try to switch the sink', empty.after === empty.before, true);
  check('click did not toast', empty.toastText, 'Audio output: System default');

  console.log('\n[6] a device appears: the row re-enables');
  const restored = await run(`(async () => {
    window.__odDevices = ${JSON.stringify(DEVICES)};
    await App.initAudioOutputs();
    const b = document.getElementById('audio-output-btn');
    b.click();
    await new Promise(r => setTimeout(r, 200));
    return { disabled: b.disabled, text: document.getElementById('audio-output-label').textContent,
             last: window.__odCalls[window.__odCalls.length - 1] };
  })()`);
  check('re-enabled', restored.disabled, 'false');
  check('click switches again', restored.last, 'd1');
  check('label tracks the switch', restored.text, 'AG276QZD2');

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  app.exit(failures === 0 ? 0 : 1);
});
setTimeout(() => { console.log('WATCHDOG TIMEOUT'); app.exit(2); }, 180000);
