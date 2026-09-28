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
  var bundleScript = document.createElement('script');
  bundleScript.src = 'app/js/app.bundle' + (isPackaged ? '.min' : '') + '.js?v=' + bundleVersion;
  bundleScript.onerror = function () {
    var errBox = document.createElement('div');
    errBox.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:#050507;color:#f87171;font:14px monospace;padding:24px;text-align:center;white-space:pre-wrap';
    errBox.textContent = 'Failed to load the app bundle.\n' + bundleScript.src + '\nCheck the network tab and try a hard refresh.';
    document.body.appendChild(errBox);
  };
  document.body.appendChild(bundleScript);
})();
