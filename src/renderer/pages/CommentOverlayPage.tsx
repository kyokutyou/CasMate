import { useLayoutEffect, useState } from 'react';
import type { TimedOverlayComment } from '../../shared/types';
import { useApplicationState } from '../api';
import { CommentOverlayView } from '../components/OverlayViews';
import { unexpiredOverlayComments } from '../overlay-expiry';
import { useTransparentDocument } from '../use-transparent-document';

export function CommentOverlayPage() {
  useTransparentDocument();
  const { snapshot } = useApplicationState();
  const visible = useUnexpiredComments(snapshot?.commentOverlay.active);
  if (!snapshot) return null;
  const settings = snapshot.settings.commentOverlay;
  const displayed = visible;
  return <CommentOverlayView comments={displayed.map(({ comment }) => comment)} settings={settings} />;
}

function useUnexpiredComments(items: TimedOverlayComment[] | undefined): TimedOverlayComment[] {
  const [now, setNow] = useState(() => Date.now());
  useLayoutEffect(() => {
    let timer: number | undefined;
    const refresh = () => {
      const current = Date.now();
      setNow(current);
      const nextExpiry = Math.min(...(items ?? []).flatMap(item => item.expiresAt === null ? [] : [new Date(item.expiresAt).getTime()]).filter(expiry => expiry > current));
      if (Number.isFinite(nextExpiry)) timer = window.setTimeout(refresh, nextExpiry - current);
    };
    refresh();
    return () => clearTimeout(timer);
  }, [items]);
  return unexpiredOverlayComments(items ?? [], now);
}
