import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
import { installManagementHistory } from '../src/main/management-history';

it('ネイティブの戻る・進むだけを管理画面へ送り、既定の二重移動を抑止する', () => {
  const window = Object.assign(new EventEmitter(), { webContents: { send: vi.fn() } });
  installManagementHistory(window);
  const preventDefault = vi.fn();
  window.emit('app-command', { preventDefault }, 'browser-backward');
  window.emit('app-command', { preventDefault }, 'browser-forward');
  window.emit('app-command', { preventDefault }, 'media-play-pause');
  expect(window.webContents.send.mock.calls).toEqual([['casmate:management-history', 'back'], ['casmate:management-history', 'forward']]);
  expect(preventDefault).toHaveBeenCalledTimes(2);
});
