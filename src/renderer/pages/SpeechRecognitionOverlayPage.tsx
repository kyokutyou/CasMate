import { useLayoutEffect, useState } from 'react';
import type { SpeechRecognitionOverlayItem } from '../../shared/types';
import { useSpeechRecognitionOverlay } from '../api';
import { SpeechRecognitionOverlayView } from '../components/OverlayViews';
import { unexpiredSpeechRecognitionOverlayItem } from '../overlay-expiry';
import { useTransparentDocument } from '../use-transparent-document';
import { useObsDisplayTest } from '../use-obs-display-test';

export function SpeechRecognitionOverlayPage() {
  useTransparentDocument();
  const overlay = useSpeechRecognitionOverlay();
  const normal = useUnexpiredItem(overlay?.state.active);
  const test = useObsDisplayTest('speech');
  const active = test ? { text: 'OBS表示テストです' } : normal;
  if (!overlay || !active) return null;
  const appearance = test?.data.kind === 'speech' ? test.data.appearance : overlay.appearance;
  return <SpeechRecognitionOverlayView text={active.text} appearance={appearance} />;
}

function useUnexpiredItem(
  item: SpeechRecognitionOverlayItem | null | undefined,
): SpeechRecognitionOverlayItem | null {
  const [now, setNow] = useState(() => Date.now());
  useLayoutEffect(() => {
    let timer: number | undefined;
    const refresh = () => {
      const current = Date.now();
      setNow(current);
      const expiresAt = item ? new Date(item.expiresAt).getTime() : 0;
      if (expiresAt > current) timer = window.setTimeout(refresh, expiresAt - current);
    };
    refresh();
    return () => clearTimeout(timer);
  }, [item]);
  return unexpiredSpeechRecognitionOverlayItem(item ?? null, now);
}
