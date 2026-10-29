import type { ManagementHistoryDirection } from '../shared/management-history';

interface ManagementWindow {
  on(event: 'app-command', listener: (event: { preventDefault(): void }, command: string) => void): unknown;
  webContents: { send(channel: string, direction: ManagementHistoryDirection): void };
}
export function installManagementHistory(window: ManagementWindow): void {
  window.on('app-command', (event, command) => {
    const direction = command === 'browser-backward' ? 'back' : command === 'browser-forward' ? 'forward' : null;
    if (!direction) return;
    event.preventDefault();
    window.webContents.send('casmate:management-history', direction);
  });
}
