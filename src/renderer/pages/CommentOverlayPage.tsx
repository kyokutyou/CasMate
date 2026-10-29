import { useLayoutEffect, useState } from 'react';
import type { TimedOverlayComment } from '../../shared/types';
import { useApplicationState } from '../api';
import { CommentOverlayView } from '../components/OverlayViews';
import { unexpiredOverlayComments } from '../overlay-expiry';
import { useTransparentDocument } from '../use-transparent-document';
import { useObsDisplayTest } from '../use-obs-display-test';

export function CommentOverlayPage() {
  useTransparentDocument();
  const { snapshot } = useApplicationState();
  const visible = useUnexpiredComments(snapshot?.commentOverlay.active);
  const test = useObsDisplayTest('comments');
  if (!snapshot) return null;
  const settings = test?.data.kind === 'comments' ? test.data.appearance : snapshot.settings.commentOverlay;
  const displayed = test ? [{ expiresAt: new Date(test.expiresAt).toISOString(), comment: {
    id: test.testId, externalId: test.testId, sequence: 0, receivedAt: new Date(test.startedAt).toISOString(),
    source: 'youtube' as const, authorName: 'テスト', content: [{ type: 'text' as const, text: 'OBS表示テストです' }], initialHistory: false,
  } }] : visible;
  return <CommentOverlayView comments={displayed.map(({ comment }) => comment)} settings={settings} />;
}

function useUnexpiredComments(items: TimedOverlayComment[] | undefined): TimedOverlayComment[] {
  const [now, setNow] = useState(() => Date.now());
  useLayoutEffect(() => {
    let timer: number | undefined;
    const refresh = () => {
      const current = Date.now();
      setNow(current);
      const nextExpiry = Math.min(...(items ?? []).map(item => new Date(item.expiresAt).getTime()).filter(expiry => expiry > current));
      if (Number.isFinite(nextExpiry)) timer = window.setTimeout(refresh, nextExpiry - current);
    };
    refresh();
    return () => clearTimeout(timer);
  }, [items]);
  return unexpiredOverlayComments(items ?? [], now);
}
