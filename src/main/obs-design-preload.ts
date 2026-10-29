import { contextBridge, ipcRenderer } from 'electron';
import type { ObsDesignBridge } from '../shared/obs-design-bridge';
const bridge: ObsDesignBridge = {
  onTarget(listener) {
    const receive = (_event: unknown, target: unknown) => { if (target === 'comments' || target === 'speech') listener(target); };
    ipcRenderer.on('casmate:obs-design-target', receive);
    ipcRenderer.send('casmate:obs-design-ready');
    return () => ipcRenderer.removeListener('casmate:obs-design-target', receive);
  },
  onCloseRequest(listener) {
    const receive = () => listener();
    ipcRenderer.on('casmate:obs-design-close-request', receive);
    return () => ipcRenderer.removeListener('casmate:obs-design-close-request', receive);
  },
  closeReady() { ipcRenderer.send('casmate:obs-design-close-ready'); },
};
contextBridge.exposeInMainWorld('casmateObsDesign', bridge);
