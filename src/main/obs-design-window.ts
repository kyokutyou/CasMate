import { BrowserWindow } from 'electron';
import type { WindowBounds } from '../shared/types';
import { withAppWindowTitle } from './window-branding';
import { restoreManagementSize } from './management-window-bounds';

export function createNativeObsDesignWindow(options: {
  baseUrl: string; bounds: WindowBounds; icon?: string; preload: string;
}, target: 'comments' | 'speech') {
  const window = new BrowserWindow(withAppWindowTitle({ ...options.bounds, minWidth: 560, minHeight: 520,
    icon: options.icon, backgroundColor: '#10151d', show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: options.preload } }));
  window.setMenuBarVisibility(false);
  restoreManagementSize(window, options.bounds);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    const parsed = new URL(url);
    if (parsed.origin !== options.baseUrl || parsed.pathname !== '/obs/design') event.preventDefault();
  });
  let selected = target;
  const sendTarget = () => window.webContents.send('casmate:obs-design-target', selected);
  window.webContents.on('did-finish-load', sendTarget);
  void window.loadURL(`${options.baseUrl}/obs/design?target=${target}`);
  if (options.bounds.maximized) window.maximize();
  return Object.assign(window, {
    notifyTarget: sendTarget,
    select(next: 'comments' | 'speech') { selected = next; if (!window.webContents.isLoading()) sendTarget(); },
    requestClose() { window.webContents.send('casmate:obs-design-close-request'); },
  });
}
