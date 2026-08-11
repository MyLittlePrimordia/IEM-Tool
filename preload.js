// Preload bridge. Kept as an empty sandboxed preload; no privileged APIs are
// exposed to the renderer.
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('appBridge', {});
