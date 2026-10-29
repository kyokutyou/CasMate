const alwaysOnTopPrefix = 'casmate-comment-list://always-on-top/';

export function commentListAlwaysOnTopActionUrl(enabled: boolean): string {
  return `${alwaysOnTopPrefix}${enabled ? 'on' : 'off'}`;
}

export function parseCommentListAlwaysOnTopAction(url: string): boolean | null {
  if (url === `${alwaysOnTopPrefix}on`) return true;
  if (url === `${alwaysOnTopPrefix}off`) return false;
  return null;
}

export function isIndependentCommentList(search: string): boolean {
  return new URLSearchParams(search).get('window') === 'independent';
}

export function handleCommentListWindowOpen(
  url: string,
  setAlwaysOnTop: (enabled: boolean) => void,
  openExternal: (url: string) => void,
): void {
  const alwaysOnTop = parseCommentListAlwaysOnTopAction(url);
  if (alwaysOnTop !== null) {
    setAlwaysOnTop(alwaysOnTop);
    return;
  }
  try {
    const target = new URL(url);
    if (target.protocol === 'http:' || target.protocol === 'https:') openExternal(url);
  } catch {
    // Unknown and malformed targets remain inside the denied window-open request.
  }
}
