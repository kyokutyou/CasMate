import { useEffect, useRef, useState } from 'react';
import type { ObsTestDisplaySnapshot } from '../shared/obs-source-test';
import type { obsOverlayDefinitions } from '../shared/obs-source-registration';

export function useObsDisplayTest(overlay: keyof typeof obsOverlayDefinitions, enabled = true) {
  const [snapshot, setSnapshot] = useState<ObsTestDisplaySnapshot>({ revision: -1, display: null });
  const [now, setNow] = useState(Date.now);
  const revision = useRef(-1);
  const timing = useRef<{ id: string; base: number; elapsed: number; deadline: number } | null>(null);
  const expired = useRef<string | null>(null);
  const display = snapshot.display;
  useEffect(() => {
    if (!enabled) return;
    let closed = false; let socket: WebSocket | undefined; let retry: number | undefined;
    let connection = 0; let receivedSnapshot = false;
    const accept = (value: ObsTestDisplaySnapshot, initial = false) => {
      if (closed || !Number.isSafeInteger(value.revision) || (!initial && value.revision < revision.current) ||
        (value.display && (value.display.data?.kind !== overlay || !Number.isFinite(value.display.startedAt) || !Number.isFinite(value.display.expiresAt)))) return;
      revision.current = value.revision;
      const accepted = value.display?.testId === expired.current ? { ...value, display: null } : value;
      setSnapshot(accepted);
      if (!accepted.display) setNow(Date.now());
    };
    const connect = () => {
      if (closed) return;
      const generation = ++connection; receivedSnapshot = false;
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/overlay/obs-test?overlay=${overlay}`);
      socket.addEventListener('message', event => {
        if (generation !== connection) return;
        try { accept(JSON.parse(String(event.data)) as ObsTestDisplaySnapshot, !receivedSnapshot); receivedSnapshot = true; } catch { /* Malformed frames do not reset the deadline. */ }
      });
      socket.addEventListener('close', () => { if (!closed && generation === connection) retry = window.setTimeout(connect, 1000); });
    };
    connect();
    const bootstrapConnection = connection;
    void fetch('/api/overlays/obs-test/bootstrap?overlay=' + overlay, { cache: 'no-store' })
      .then(async response => { const value = await response.json() as ObsTestDisplaySnapshot;
        if (response.ok && connection === bootstrapConnection && !receivedSnapshot) accept(value);
      }).catch(() => undefined);
    return () => { closed = true; clearTimeout(retry); socket?.close(); };
  }, [overlay, enabled]);
  useEffect(() => {
    if (!enabled || !display) return;
    // Wall time is only for joining an existing phase. A local monotonic deadline cannot be extended by reconnects.
    if (timing.current?.id !== display.testId) {
      const elapsed = Math.max(0, Date.now() - display.startedAt);
      timing.current = { id: display.testId, base: performance.now(), elapsed,
        deadline: performance.now() + Math.min(5000, Math.max(0, display.expiresAt - Date.now())) };
    }
    const clock = timing.current;
    const update = () => {
      if (performance.now() >= clock.deadline) { expired.current = display.testId; setNow(display.expiresAt); }
      else setNow(display.startedAt + clock.elapsed + performance.now() - clock.base);
    };
    update(); const tick = window.setInterval(update, 50);
    return () => clearInterval(tick);
  }, [display, enabled]);
  return enabled && snapshot.display && now < snapshot.display.expiresAt ? { ...snapshot.display, elapsed: Math.max(0, now - snapshot.display.startedAt) } : null;
}
