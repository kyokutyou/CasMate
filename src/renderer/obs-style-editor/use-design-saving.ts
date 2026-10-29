import { useCallback, useEffect, useRef, useState } from 'react';
import type { ObsCommentDesign, ObsSpeechDesign } from '../../shared/obs-design';

export function useDesignSaving(value: ObsCommentDesign | ObsSpeechDesign, save: (value: ObsCommentDesign | ObsSpeechDesign) => Promise<unknown>) {
  const serialized = JSON.stringify(value);
  const saved = useRef(serialized);
  const latest = useRef({ value, serialized, save });
  const working = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const mounted = useRef(true);
  const [status, setStatus] = useState({ pending: false, error: '', saved: serialized });
  useEffect(() => { latest.current = { value, serialized, save }; }, [value, serialized, save]);
  const persist = useCallback(async () => {
    clearTimeout(timer.current);
    if (working.current) return;
    working.current = true;
    try {
      while (saved.current !== latest.current.serialized) {
        const attempt = latest.current;
        await attempt.save(attempt.value);
        saved.current = attempt.serialized;
      }
      if (mounted.current) setStatus({ pending: false, error: '', saved: saved.current });
    } catch (error) {
      if (mounted.current) setStatus(current => ({ ...current, pending: true, error: error instanceof Error ? error.message : '保存できませんでした。' }));
    } finally { working.current = false; }
  }, []);
  useEffect(() => {
    if (serialized === saved.current) {
      if (!working.current) setStatus({ pending: false, error: '', saved: serialized });
      return;
    }
    setStatus(current => ({ ...current, pending: true, error: '' }));
    timer.current = setTimeout(() => { void persist(); }, 500);
    return () => clearTimeout(timer.current);
  }, [serialized, persist]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; clearTimeout(timer.current); }; }, []);
  const adopt = useCallback((remote: ObsCommentDesign | ObsSpeechDesign) => {
    saved.current = JSON.stringify(remote);
    setStatus({ pending: false, error: '', saved: saved.current });
  }, []);
  return { ...status, pending: status.pending || serialized !== status.saved, retry: persist, adopt };
}
