import { expect, it, vi } from 'vitest';
import { createManagementWindowOpenHandler } from '../src/main/management-window-open';

it.each(['https://example.com/comment', 'http://example.org/path', 'http://127.0.0.1:3000/comments', 'https://voicevox.hiroshiba.jp/', 'https://jbbs.shitaraba.net/'])('管理画面の明示リンク %s を既定ブラウザへ渡し、子ウィンドウは開かない', url => {
  const openExternal = vi.fn();
  const handle = createManagementWindowOpenHandler(openExternal);
  expect(openExternal).not.toHaveBeenCalled();
  expect(handle({ url })).toEqual({ action: 'deny' });
  expect(openExternal).toHaveBeenCalledExactlyOnceWith(url);
});

it.each(['javascript:alert(1)', 'file:///C:/private.txt', 'data:text/html,danger', 'mailto:user@example.com', 'ftp://example.com/', 'casmate-comment-list://always-on-top/on', 'not a URL'])('管理画面からHTTP(S)以外の %s を開かない', url => {
  const openExternal = vi.fn();
  expect(createManagementWindowOpenHandler(openExternal)({ url })).toEqual({ action: 'deny' });
  expect(openExternal).not.toHaveBeenCalled();
});
