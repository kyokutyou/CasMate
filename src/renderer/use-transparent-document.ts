import { useEffect } from 'react';

export function useTransparentDocument(): void {
  useEffect(() => {
    const previousHtmlBackground = document.documentElement.style.background;
    const previousBodyBackground = document.body.style.background;
    const previousBodyOverflow = document.body.style.overflow;
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    document.body.style.overflow = 'hidden';
    return () => {
      document.documentElement.style.background = previousHtmlBackground;
      document.body.style.background = previousBodyBackground;
      document.body.style.overflow = previousBodyOverflow;
    };
  }, []);
}
