/* eslint-disable @typescript-eslint/no-require-imports, no-undef */
// Sandboxed, one-way display bridge. No management credentials or commands.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('casmateReactionDesktop', {
  marker: listener => { ipcRenderer.on('reaction-marker', (_event, value) => listener(value)); },
  reaction: listener => { ipcRenderer.on('reaction-particles', (_event, value) => listener(value)); },
  clear: listener => { ipcRenderer.on('reaction-clear', listener); },
});
