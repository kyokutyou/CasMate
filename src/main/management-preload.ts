import { contextBridge, ipcRenderer } from 'electron';
import type { ManagementHistoryBridge } from '../shared/management-history';

const bridge: ManagementHistoryBridge = {
  subscribe(listener) {
    const receive = (_event: unknown, direction: unknown) => {
      if (direction === 'back' || direction === 'forward') listener(direction);
    };
    ipcRenderer.on('casmate:management-history', receive);
    return () => ipcRenderer.removeListener('casmate:management-history', receive);
  },
};
contextBridge.exposeInMainWorld('casmateNavigation', bridge);
