import { useEffect, useRef, useState } from 'react';
import type { MobileCommentsBootstrap } from '../../shared/types';
import { CommentListView } from '../components/CommentListView';
import { MobileBrowserConnection, MobileCommentFeed, type MobileWireEvent, type ReceivedAudio } from '../mobile/mobile-connection';

type CommentsBridge = { postMessage(message: string): void; onmessage: ((event: { data: string }) => void) | null };

export function MobileCommentsPage({ nativeOnly = false }: { nativeOnly?: boolean } = {}) {
  const embeddedAndroid = nativeOnly || new URLSearchParams(window.location.search).get('embedded') === 'android';
  const embeddedViewportHeight = embeddedAndroid ? window.innerHeight : undefined;
  const [state, setState] = useState<MobileCommentsBootstrap | null>(null);
  const [connected, setConnected] = useState(false);
  const [audioRequested, setAudioRequested] = useState(() => !embeddedAndroid && readAudioRequested());
  const requested = useRef(audioRequested);
  const [error, setError] = useState<string | null>(null);
  const [appearance, setAppearance] = useState<'light' | 'dark'>('light');
  const connection = useRef<MobileBrowserConnection | null>(null);
  const player = useRef<BrowserAudioPlayer | null>(null);
  useEffect(() => {
    if (embeddedAndroid) {
      const bridge = (window as Window & { CasMateComments?: CommentsBridge }).CasMateComments;
      if (!bridge) { setError('Androidアプリを更新して開き直してください。'); return; }
      const feed = new MobileCommentFeed(setState);
      bridge.onmessage = ({ data }) => {
        try {
          const parsed: unknown = JSON.parse(data);
          if (typeof parsed === 'object' && parsed !== null && 'type' in parsed && parsed.type === 'android.presentation') {
            if ('payload' in parsed && typeof parsed.payload === 'object' && parsed.payload !== null && 'theme' in parsed.payload &&
                (parsed.payload.theme === 'light' || parsed.payload.theme === 'dark')) setAppearance(parsed.payload.theme);
            return;
          }
          const event = parsed as MobileWireEvent;
          if (event.type === 'mobile.connection') { setConnected(event.payload.connected === true); return; }
          feed.receive(event);
          if (event.type === 'mobile.snapshotEnd') setConnected(true);
        } catch { setConnected(false); bridge.postMessage('ready'); }
      };
      const stopFlick = installAndroidFlick(bridge);
      bridge.postMessage('ready');
      return () => { stopFlick(); bridge.onmessage = null; bridge.postMessage('hidden'); };
    }
    const audio = new BrowserAudioPlayer((type, id) => session.audioResult(type, id), setError);
    player.current = audio;
    const session = new MobileBrowserConnection({
      comments: value => setState({ ...value, audioAvailable: available }),
      connected: value => { setConnected(value); if (value) setError(null); },
      available: value => { available = value; setState(current => current ? { ...current, audioAvailable: value } : current); },
      audio: value => audio.enqueue(value), discard: id => audio.discard(id), error: setError,
    });
    let available = false;
    connection.current = session;
    session.audioDesired(requested.current); session.start();
    const resume = () => audio.resume();
    document.addEventListener('pointerdown', resume);
    return () => { document.removeEventListener('pointerdown', resume); session.close(); audio.discard(); connection.current = null; player.current = null; };
  }, [embeddedAndroid]);
  const choose = (value: boolean) => {
    requested.current = value; setAudioRequested(value); setError(null);
    try { if (value) localStorage.setItem(audioRequestedStorageKey, 'started'); else localStorage.removeItem(audioRequestedStorageKey); } catch { /* Session intent still works. */ }
    if (value) player.current?.unlock();
    connection.current?.audioDesired(value);
  };
  const start = () => choose(true);
  const stop = () => choose(false);
  const embeddedClass = `mobile-comments-page-embedded native-comment-theme-${appearance}`;
  if (!state) return <main className={embeddedAndroid ? `center-message mobile-comments-loading ${embeddedClass}` : 'center-message'}>{error ?? '読み込み中です…'}</main>;
  return <CommentListView
    comments={state.comments}
    settings={embeddedAndroid ? {
      ...state.commentList,
      textColor: 'var(--android-text)',
      backgroundColor: 'var(--android-background)',
    } : state.commentList}
    connected={connected}
    sourcesRunning={state.sourcesRunning}
    className={embeddedAndroid
      ? `mobile-comments-page ${embeddedClass}`
      : 'mobile-comments-page'}
    style={embeddedViewportHeight === undefined ? undefined : {
      height: `${embeddedViewportHeight}px`,
      minHeight: `${embeddedViewportHeight}px`,
    }}
    embeddedHeader={embeddedAndroid}
    controls={!embeddedAndroid && <button
      type="button"
      className="secondary small"
      aria-pressed={audioRequested}
      disabled={!audioRequested && !state.audioAvailable}
      onClick={audioRequested ? stop : start}
    >
      {audioRequested ? '読み上げを止める' : '読み上げを聞く'}
    </button>}
    notices={error && <p className="mobile-error" role="status">{error}</p>}
  />;
}

/** Android owns navigation; only completed gestures on inert content request a page change. */
function installAndroidFlick(bridge: CommentsBridge): () => void {
  const pointers = new Set<number>();
  let gesture: { id: number; x: number; y: number; started: number } | null = null;
  const reset = () => { gesture = null; pointers.clear(); };
  const down = (event: PointerEvent) => {
    pointers.add(event.pointerId);
    if (pointers.size !== 1 || event.isPrimary === false || event.button > 0) { gesture = null; return; }
    const target = event.target;
    if (!(target instanceof Element) || target.closest('button,input,select,textarea,a,[role="button"],[contenteditable]:not([contenteditable="false"])')) {
      gesture = null; return;
    }
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, started: performance.now() };
  };
  const move = (event: PointerEvent) => {
    if (!gesture || gesture.id !== event.pointerId) return;
    const x = Math.abs(event.clientX - gesture.x); const y = Math.abs(event.clientY - gesture.y);
    if (y > 12 && y >= x) gesture = null;
  };
  const up = (event: PointerEvent) => {
    const current = gesture; gesture = null;
    const single = pointers.size === 1; pointers.delete(event.pointerId);
    if (!single || !current || current.id !== event.pointerId) return;
    const x = event.clientX - current.x; const y = Math.abs(event.clientY - current.y);
    if (Math.abs(x) >= 56 && Math.abs(x) >= y * 1.5 && performance.now() - current.started <= 700) {
      bridge.postMessage(x < 0 ? 'flick:left' : 'flick:right');
    }
  };
  document.addEventListener('pointerdown', down, true);
  document.addEventListener('pointermove', move, true);
  document.addEventListener('pointerup', up, true);
  document.addEventListener('pointercancel', reset, true);
  document.addEventListener('visibilitychange', reset);
  window.addEventListener('blur', reset);
  return () => {
    reset(); document.removeEventListener('pointerdown', down, true);
    document.removeEventListener('pointermove', move, true);
    document.removeEventListener('pointerup', up, true);
    document.removeEventListener('pointercancel', reset, true);
    document.removeEventListener('visibilitychange', reset); window.removeEventListener('blur', reset);
  };
}

class BrowserAudioPlayer {
  private readonly audio = new Audio();
  private current: ReceivedAudio | null = null;
  private queue: ReceivedAudio[] = [];
  private objectUrl: string | null = null;
  private started = false;
  private generation = 0;
  private expiry?: ReturnType<typeof setTimeout>;
  constructor(private readonly result: (type: 'mobile.audioStarted' | 'mobile.audioEnded' | 'mobile.audioError', id: string) => void,
    private readonly error: (message: string | null) => void) {}
  unlock(): void { if (!this.current) { this.audio.src = silentAudio; void this.audio.play().catch(() => undefined); } }
  enqueue(item: ReceivedAudio): void {
    if (this.queue.length + (this.current ? 1 : 0) >= 2) { this.result('mobile.audioError', item.audioId); return; }
    this.queue.push(item); this.next();
  }
  discard(id?: string): void {
    this.queue = id ? this.queue.filter(item => item.audioId !== id) : [];
    if (!id || (this.current?.audioId === id && !this.started)) { this.clear(); this.next(); }
  }
  resume(): void { if (this.current && !this.started) void this.play(); }
  private clear(): void {
    this.generation += 1; clearTimeout(this.expiry); this.audio.pause(); this.audio.onended = null; this.audio.onerror = null;
    this.audio.src = ''; this.current = null; this.started = false;
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl); this.objectUrl = null;
  }
  private next(): void {
    if (this.current) return;
    const item = this.queue.shift();
    if (!item) return;
    if (item.expiresAt <= Date.now()) { this.result('mobile.audioError', item.audioId); this.next(); return; }
    this.current = item; this.objectUrl = URL.createObjectURL(new Blob([item.bytes], { type: 'audio/mp4' }));
    this.audio.src = this.objectUrl;
    const generation = this.generation;
    this.audio.onended = () => { if (generation === this.generation) this.finish(true); };
    this.audio.onerror = () => { if (generation === this.generation) this.finish(false); };
    this.expiry = setTimeout(() => { if (!this.started && generation === this.generation) this.finish(false); }, item.expiresAt - Date.now());
    void this.play();
  }
  private async play(): Promise<void> {
    const item = this.current; const generation = this.generation;
    if (!item || this.started) return;
    if (item.expiresAt <= Date.now()) { this.finish(false); return; }
    try {
      await this.audio.play();
      if (this.current !== item || generation !== this.generation) return;
      this.started = true; clearTimeout(this.expiry); this.result('mobile.audioStarted', item.audioId); this.error(null);
    } catch (failure) {
      if (this.current !== item || generation !== this.generation) return;
      if (typeof failure === 'object' && failure !== null && 'name' in failure && failure.name === 'NotAllowedError') {
        this.error('ブラウザの制限により音声が一時停止しました。画面をタップすると再開します。');
      } else this.finish(false);
    }
  }
  private finish(ok: boolean): void {
    if (!this.current) return;
    this.result(ok ? 'mobile.audioEnded' : 'mobile.audioError', this.current.audioId);
    if (!ok) this.error('音声を再生できなかったため、次のコメントへ進みます。');
    this.clear(); this.next();
  }
}
const silentAudio = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
const audioRequestedStorageKey = 'casmate.mobileSpeech.requested';
function readAudioRequested(): boolean {
  try { return localStorage.getItem(audioRequestedStorageKey) === 'started'; } catch { return false; }
}
