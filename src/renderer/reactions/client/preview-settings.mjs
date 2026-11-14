export function watchPreviewSettings(update) {
  let active = null, closed = false;
  const poll = async () => {
    if (closed || document.hidden || active) return;
    const operation = new AbortController(); active = operation;
    const timeout = setTimeout(() => operation.abort(), 5000);
    try {
      const response = await fetch('/preview', {signal:operation.signal, cache:'no-store'});
      if (!response.ok) return;
      const value = await response.json();
      if (!closed && !document.hidden && !operation.signal.aborted &&
          ['obs','twitch','youtube'].includes(value?.mode) && typeof value.id === 'string' &&
          (value.mode === 'obs' && value.id === '' || value.id === '' ||
           value.mode === 'twitch' && /^[a-z0-9_]{1,25}$/.test(value.id) ||
           value.mode === 'youtube' && /^[A-Za-z0-9_-]{11}$/.test(value.id))) update(value);
    } catch { /* Keep the current player through temporary connection failures. */ }
    finally { clearTimeout(timeout); if (active === operation) active = null; }
  };
  const visibility = () => { if (document.hidden) active?.abort(); else void poll(); };
  const timer = setInterval(() => void poll(), 2000);
  document.addEventListener('visibilitychange', visibility);
  return {close() { closed = true; clearInterval(timer); active?.abort(); document.removeEventListener('visibilitychange',visibility); }};
}
