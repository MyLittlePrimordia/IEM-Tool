// Preload bridge — exposes a tiny, whitelisted MusicAPI surface to the
// sandboxed renderer. No raw fs / require access leaks through.
const { contextBridge, ipcRenderer } = require('electron');

// Encode an absolute path into an app-file:// URL the renderer can hand to
// <audio>. Kept identical on both sides of the bridge.
function appFileUrl(filePath) {
  return 'app-file://local/' + encodeURIComponent(String(filePath));
}

contextBridge.exposeInMainWorld('MusicAPI', {
  isDesktop: true,
  appFileUrl,
  getConfig: () => ipcRenderer.invoke('music:getConfig'),
  setConfig: (cfg) => ipcRenderer.invoke('music:setConfig', cfg),
  saveSession: (session) => ipcRenderer.invoke('music:saveSession', session),
  pickFolders: () => ipcRenderer.invoke('music:pickFolders'),
  scan: (folders) => ipcRenderer.invoke('music:scan', folders),
  readTags: (filePath, opts) => ipcRenderer.invoke('music:readTags', filePath, opts),
  writeTags: (filePath, patch) => ipcRenderer.invoke('music:writeTags', filePath, patch),
  readText: (filePath) => ipcRenderer.invoke('music:readText', filePath),
  writeText: (filePath, content) => ipcRenderer.invoke('music:writeText', filePath, content),
  savePlaylist: (defaultName, content) => ipcRenderer.invoke('music:savePlaylist', defaultName, content)
});
