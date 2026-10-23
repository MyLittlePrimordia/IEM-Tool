// Loads the app bundle. Externalised from an inline <script> so that
// script-src does not need 'unsafe-inline' (the last inline script in the app).
//
// Behaviour is deliberately identical to the inline version it replaces:
//   - packaged builds (?packaged=1) load the minified bundle
//   - the cache-buster is the content hash from js/bundle-version.js rather than
//     Date.now(), so the ~1MB bundle stays cached until the source changes
//   - a load failure shows a full-screen message instead of a blank window
(function () {
  var isPackaged = location.search.indexOf('packaged') !== -1;
  var bundleVersion = (typeof window.BUNDLE_VERSION === 'string' && window.BUNDLE_VERSION) || String(Date.now());

  // One failure surface, whether the script 404s or loads and then never boots.
  // Without the timer a bundle that parses but throws during init (or a boot
  // path that silently returns) left a window showing the bare static markup:
  // no message, no console hint, and no indication that a reload might help.
  function showBootFailure(reason) {
    if (document.getElementById('iem-boot-failure')) return;
    var box = document.createElement('div');
    box.id = 'iem-boot-failure';
    box.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;flex-direction:column;gap:12px;align-items:center;justify-content:center;background:#050507;color:#f87171;font:14px monospace;padding:24px;text-align:center;white-space:pre-wrap';
    var text = document.createElement('div');
    text.textContent = reason + '\n\nPress Reload to try again. If it keeps happening, check the console (Ctrl+Shift+I) for the first error.';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Reload';
    btn.style.cssText = 'font:inherit;padding:8px 18px;border:2px solid #f87171;background:transparent;color:#f87171;cursor:pointer';
    btn.addEventListener('click', function () { location.reload(); });
    box.appendChild(text);
    box.appendChild(btn);
    document.body.appendChild(box);
  }

  var bundleScript = document.createElement('script');
  bundleScript.src = 'app/js/app.bundle' + (isPackaged ? '.min' : '') + '.js?v=' + bundleVersion;
  bundleScript.onerror = function () {
    showBootFailure('Failed to load the app bundle.\n' + bundleScript.src);
  };
  document.body.appendChild(bundleScript);

  // App is assigned at the end of the boot sequence; until then the UI is not
  // interactive. 20s is long enough that a slow disk or a cold start on an old
  // laptop does not trip it, and short enough to beat the user's patience.
  var waited = 0;
  var watchdog = setInterval(function () {
    if (window.App) { clearInterval(watchdog); return; }
    waited += 500;
    if (waited < 20000) return;
    clearInterval(watchdog);
    showBootFailure('The app bundle loaded but the interface did not start.');
  }, 500);
})();
