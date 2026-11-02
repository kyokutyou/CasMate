// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ObsTestDisplay } from '../src/shared/obs-source-test';
import { obsRegistrationSnapshot } from './fixtures/obs-registration-state';
const mock = vi.hoisted(() => ({ snapshot: null as ReturnType<typeof obsRegistrationSnapshot> | null, test: null as (ObsTestDisplay & { elapsed: number }) | null }));
vi.mock('../src/renderer/api', () => ({ useApplicationState: () => ({ snapshot: mock.snapshot }) }));
vi.mock('../src/renderer/use-obs-display-test', () => ({ useObsDisplayTest: () => mock.test }));
import { CommentOverlayPage } from '../src/renderer/pages/CommentOverlayPage';
afterEach(cleanup);
it('専用のテスト層で通常コメントを隠さず、受信状態だけを描画する', () => {
  mock.snapshot = obsRegistrationSnapshot();
  mock.snapshot.settings.commentOverlay.mode = 'stack';
  mock.test = { testId: 'test', startedAt: 0, expiresAt: 5000, elapsed: 1500, data: { kind: 'comments', appearance: { ...mock.snapshot.settings.commentOverlay, stackMaxComments: 3 } } };
  const original = structuredClone(mock.snapshot.commentOverlay);
  const view = render(<CommentOverlayPage/>);
  expect(view.container.querySelectorAll('.overlay-comment')).toHaveLength(0);
  expect(mock.snapshot.commentOverlay).toEqual(original);
  if (mock.test.data.kind === 'comments') mock.test.data.appearance.mode = 'single';
  view.rerender(<CommentOverlayPage/>);
  expect(view.container.querySelectorAll('.overlay-comment')).toHaveLength(0);
  mock.snapshot.commentOverlay.active = [{ expiresAt: null, comment: { id: 'real', externalId: 'real', sequence: 1, source: 'twitch', authorName: '視聴者', content: [{ type: 'text', text: 'テスト中に届いた実コメント' }], initialHistory: false, receivedAt: new Date().toISOString() } }];
  mock.test = null; view.rerender(<CommentOverlayPage/>);
  expect(view.getByText('テスト中に届いた実コメント')).toBeTruthy();
  expect(view.queryByText('OBS表示テストです')).toBeNull();
});
