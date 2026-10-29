import { useEffect, type Dispatch, type SetStateAction } from 'react';

export function useSuccessNoticeExpiry<T extends { tone: string }>(notice: T | null, setNotice: Dispatch<SetStateAction<T | null>>) {
  useEffect(() => {
    if (notice?.tone !== 'success') return;
    const timer = window.setTimeout(() => setNotice(current => current === notice ? null : current), 4000);
    return () => window.clearTimeout(timer);
  }, [notice, setNotice]);
}
