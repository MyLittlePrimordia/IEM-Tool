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
  // True when the custom caption bar is in use. The renderer uses this to skip
  // drag-region attributes if it is ever loaded outside Electron (e.g. the
  // browser-based visual regression harness in tools/).
  hasCustomChrome: true,

  windowMinimize: () => ipcRenderer.send('win:minimize'),
  windowToggleMaximize: () => ipcRenderer.send('win:toggle-maximize'),
  windowClose: () => ipcRenderer.send('win:close'),

  // Synchronous: the caption buttons must repaint their maximize/restore glyph
  // in the same frame the window state changes, and an async round-trip would
  // leave a stale icon for a frame or two.
  windowIsMaximized: () => ipcRenderer.sendSync('win:is-maximized'),

  // Renders one theme's real CSS backdrop offscreen and returns it as a PNG
  // data URL, so the review-card export uses the app's actual texture instead
  // of a hand-drawn copy of it. Returns null if the capture fails, and the
  // caller is expected to fall back to a plain themed surface rather than
  // leaving the card blank.
  captureThemeBackdrop: (themeId, width, height) =>
    ipcRenderer.invoke('theme:capture-backdrop', { themeId, width, height }),

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