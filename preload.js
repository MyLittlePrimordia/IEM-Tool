// Preload bridge.
//
// R1 (OLED reskin): the window became frameless so the app can draw its own
// caption bar with rounded corners and red / amber / green window buttons. That
// needs three main-process operations, and with contextIsolation + sandbox on,
// the renderer cannot call them without a bridge.
//
// SCOPE IS DELIBERATELY MINIMAL. This file exposes window-chrome actions only -
// no filesystem, no shell, no ipcRenderer passthrough. Each method is a
// named, argument-less command rather than a generic `invoke(channel, ...)`,
// so the renderer cannot reach an arbitrary IPC channel even if it is
// compromised. `sandbox: true` and `contextIsolation: true` stay on.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('appBridge', {
  windowMinimize: () => ipcRenderer.send('win:minimize'),
  windowToggleMaximize: () => ipcRenderer.send('win:toggle-maximize'),
  windowClose: () => ipcRenderer.send('win:close'),

  // Async on purpose: the old sendSync blocked the renderer during boot. The
  // caption bar paints its default glyph immediately and repaints when this
  // resolves (and again on every maximize/unmaximize push), so there is no
  // visible stale-icon frame.
  windowIsMaximized: () => ipcRenderer.invoke('win:is-maximized'),

  // Pre-close autosave handshake. main.js defers the window close and sends
  // 'app:flush-before-close'; the renderer persists the Data tab's working copy
  // and answers with flushBeforeCloseDone(). Returns an unsubscribe function.
  onFlushBeforeClose: (callback) => {
    const listener = () => { try { callback(); } catch (e) { console.error('[flush]', e); } };
    ipcRenderer.on('app:flush-before-close', listener);
    return () => ipcRenderer.removeListener('app:flush-before-close', listener);
  },
  flushBeforeCloseDone: () => ipcRenderer.send('app:flush-done'),

  // Renders one theme's real CSS backdrop offscreen and returns it as a PNG
  // data URL, so the review-card export uses the app's actual texture instead
  // of a hand-drawn copy of it. Returns null if the capture fails, and the
  // caller is expected to fall back to a plain themed surface rather than
  // leaving the card blank.
  captureThemeBackdrop: (themeId, width, height) =>
    ipcRenderer.invoke('theme:capture-backdrop', { themeId, width, height }),

  // Opens the offline-database folder (IEM-Data) in the system file manager,
  // creating it first if needed. No path argument: the main process decides
  // which folder, so this cannot be used to open an arbitrary location.
  // Resolves to { ok, path, error? }.
  openDataFolder: () => ipcRenderer.invoke('app:open-data-folder'),

  // Database tab. Scoped file access: the renderer never names a path. Each
  // call maps to one fixed IPC channel validated in main.js (data-relative
  // "data/<folder>/<name>.txt" only; writes land in the IEM-Data folder).
  dataInfo: () => ipcRenderer.invoke('data:info'),

  // Update center. Fixed, argument-less commands against the project's own
  // GitHub repository; the renderer cannot name a URL or a file path.
  appVersion: () => ipcRenderer.invoke('app:get-version'),
  appBuildInfo: () => ipcRenderer.invoke('app:get-build-info'),
  checkAppUpdate: () => ipcRenderer.invoke('app:check-update'),
  openReleasePage: () => ipcRenderer.invoke('app:open-release-page'),
  // Measurement-source credits. The main process allowlists the scheme and
  // hosts, so this stays a "open a credited source" command rather than a
  // general-purpose URL opener.
  openCreditUrl: (url) => ipcRenderer.invoke('app:open-credit-url', String(url)),
  checkDatabaseUpdate: () => ipcRenderer.invoke('db:check-update'),
  downloadDatabaseUpdate: () => ipcRenderer.invoke('db:download-update'),
  dataReadDatabase: () => ipcRenderer.invoke('data:read-database'),
  dataListFiles: () => ipcRenderer.invoke('data:list-files'),
  dataReadFile: (rel) => ipcRenderer.invoke('data:read-file', String(rel)),
  dataEnsureWorkingCopy: () => ipcRenderer.invoke('data:ensure-working-copy'),
  dataResetWorkingCopy: () => ipcRenderer.invoke('data:reset-working-copy'),

  // Settings > Library > Reset. One-way and argument-less: main.js erases the
  // stored settings, reviews and database edits, then relaunches the app, so
  // there is nothing for the renderer to pass in or to undo afterwards.
  factoryReset: () => ipcRenderer.invoke('app:factory-reset'),
  dataDeleteFile: (rel) => ipcRenderer.invoke('data:delete-file', String(rel)),
  dataWriteDatabase: (payload) => ipcRenderer.invoke('data:write-database', { text: payload && payload.text, json: !(payload && payload.json === false), gz: !(payload && payload.gz === false) }),
  dataWriteFile: (payload) => ipcRenderer.invoke('data:write-file', { rel: payload && payload.rel, text: payload && payload.text, overwrite: !!(payload && payload.overwrite) }),
  // The save log's Markdown changelog. Fixed filename and the same writable root
  // as the database, so the renderer still cannot name a path. Reading it back is
  // how an export appends to the changelog instead of replacing it.
  dataReadSaveLog: () => ipcRenderer.invoke('data:read-save-log'),
  // Hands the changelog to the OS (or reveals it) without the renderer naming a path.
  dataOpenSaveLog: () => ipcRenderer.invoke('data:open-save-log'),
  dataWriteSaveLog: (payload) => ipcRenderer.invoke('data:write-save-log', { text: payload && payload.text }),

  // Push subscription for maximize / unmaximize. Covers all three ways the
  // state can change: the caption button, double-click on the title-bar drag
  // region, and Win+Up / Win+Down — so the glyph can never go stale. Returns an
  // unsubscribe function.
  onWindowStateChanged: (callback) => {
    const listener = (_event, isMaximized) => { callback(!!isMaximized); };
    ipcRenderer.on('win:maximized-changed', listener);
    return () => ipcRenderer.removeListener('win:maximized-changed', listener);
  },
});
