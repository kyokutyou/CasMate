// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CommentOverlayView } from '../src/renderer/components/OverlayViews';
import { updateCommentInkGap } from '../src/renderer/comment-ink-gap';
import { createDefaultDocument } from '../src/renderer/obs-style-editor/model';
import { previewComments, previewCommentSettings } from '../src/renderer/obs-style-editor/samples';

vi.mock('../src/renderer/comment-ink-gap', () => ({ updateCommentInkGap: vi.fn() }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('同じ内容のsnapshotでは再計測せず、表示変更・幅変更で再計測し購読を解除する', () => {
  const resizeCallbacks: ResizeObserverCallback[] = [];
  const disconnect = vi.fn();
  vi.stubGlobal('CanvasRenderingContext2D', class {});
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { resizeCallbacks.push(callback); }
    observe() {} disconnect = disconnect;
  });
  vi.stubGlobal('MutationObserver', class { observe() {} disconnect = disconnect; });
  Object.defineProperty(document, 'fonts', { configurable: true, value: new EventTarget() });
  const preview = createDefaultDocument().previews.comments;
  const comments = previewComments(preview), settings = previewCommentSettings(preview);
  const view = render(<CommentOverlayView comments={comments} settings={settings} />);
  expect(updateCommentInkGap).toHaveBeenCalledTimes(1);
  view.rerender(<CommentOverlayView comments={structuredClone(comments)} settings={structuredClone(settings)} />);
  expect(updateCommentInkGap).toHaveBeenCalledTimes(1);
  view.rerender(<CommentOverlayView comments={comments} settings={{ ...settings, showAuthor: false }} />);
  expect(updateCommentInkGap).toHaveBeenCalledTimes(2);
  resizeCallbacks.at(-1)!([], {} as ResizeObserver);
  expect(updateCommentInkGap).toHaveBeenCalledTimes(3);
  view.unmount();
  expect(disconnect).toHaveBeenCalledTimes(4);
  document.fonts.dispatchEvent(new Event('loadingdone'));
  expect(updateCommentInkGap).toHaveBeenCalledTimes(3);
  Reflect.deleteProperty(document, 'fonts');
});
