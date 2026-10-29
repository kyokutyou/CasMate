import { compatibilityPolicy } from '../../shared/compatibility-policy.generated';
import type { CommonComment, MobileCommentsBootstrap, CommentListSettings } from '../../shared/types';

export interface MobileWireEvent {
  type: string;
  connectionId: string;
  generation: number;
  revision?: number;
  payload: Record<string, unknown>;
}

/** Same display reducer for the browser transport and the origin-checked Android bridge. */
export class MobileCommentFeed {
  private state: MobileCommentsBootstrap | null = null;
  private pending: MobileCommentsBootstrap | null = null;
  private deferred: MobileWireEvent[] = [];
  private revision = 0;
  private connection = '';
  private generation = 0;
  constructor(private readonly changed: (value: MobileCommentsBootstrap) => void) {}
  receive(e: MobileWireEvent): void {
    if (e.type === 'mobile.snapshotBegin') {
      this.connection = e.connectionId; this.generation = e.generation; this.revision = e.revision ?? 0;
      this.pending = { ...e.payload, comments: [] } as unknown as MobileCommentsBootstrap;
      this.deferred = []; return;
    }
    if (e.connectionId !== this.connection || e.generation !== this.generation) return;
    if (e.type === 'mobile.snapshotChunk' && this.pending) {
      this.pending.comments = [...this.pending.comments, ...e.payload.comments as CommonComment[]].slice(-10_000); return;
    }
    if (e.type === 'mobile.snapshotEnd' && this.pending) {
      this.state = this.pending; this.pending = null;
      for (const item of this.deferred) this.apply(item);
      this.deferred = []; this.changed(this.state); return;
    }
    if (this.pending) {
      // An unbounded burst cannot retain arbitrary history in a hidden/slow renderer.
      if (this.deferred.length >= 10_000) throw new Error('履歴の再同期が必要です。');
      this.deferred.push(e);
    } else if (this.state) { this.apply(e); this.changed(this.state); }
  }
  private apply(e: MobileWireEvent): void {
    const s = this.state;
    if (!s) return;
    if (e.type === 'comment.received' || e.type === 'comment.removed') {
      if ((e.revision ?? 0) <= this.revision) return;
      this.revision = e.revision!;
      const id = e.payload.id;
      s.comments = s.comments.filter(item => item.id !== id);
      if (e.type === 'comment.received') s.comments = [...s.comments, e.payload as unknown as CommonComment].slice(-10_000);
    } else if (e.type === 'commentList.settingsChanged') s.commentList = e.payload as unknown as CommentListSettings;
    else if (e.type === 'source.activityChanged') s.sourcesRunning = e.payload.sourcesRunning === true;
    this.state = { ...s };
  }
}

export interface ReceivedAudio { audioId: string; bytes: Uint8Array<ArrayBuffer>; expiresAt: number; }
interface IncomingAudio extends ReceivedAudio { offset: number; }
interface BrowserCallbacks {
  comments: (value: MobileCommentsBootstrap) => void;
  connected: (value: boolean) => void;
  available: (value: boolean) => void;
  audio: (value: ReceivedAudio) => void;
  discard: (id?: string) => void;
  error: (value: string) => void;
}

export class MobileBrowserConnection {
  private socket: WebSocket | null = null;
  private connection = '';
  private generation = { comments: 0, audio: 0 };
  private desiredAudio = false;
  private subscribedAudio = false;
  private available = false;
  private stopped = false;
  private blocked = false;
  private attempt = 0;
  private retry?: ReturnType<typeof setTimeout>;
  private heartbeat?: ReturnType<typeof setInterval>;
  private lastMessage = 0;
  private readonly incoming = new Map<string, IncomingAudio>();
  private feed: MobileCommentFeed;
  constructor(private readonly callbacks: BrowserCallbacks) { this.feed = new MobileCommentFeed(callbacks.comments); }
  start(): void { this.connect(); document.addEventListener('visibilitychange', this.visibility); window.addEventListener('online', this.online); }
  close(): void {
    this.stopped = true; clearTimeout(this.retry); clearInterval(this.heartbeat);
    document.removeEventListener('visibilitychange', this.visibility); window.removeEventListener('online', this.online);
    this.socket?.close(); this.incoming.clear(); this.callbacks.discard();
  }
  audioDesired(value: boolean): void { this.desiredAudio = value; this.subscribeAudio(); }
  audioResult(type: 'mobile.audioStarted' | 'mobile.audioEnded' | 'mobile.audioError', audioId: string): void {
    this.send({ type, generation: this.generation.audio, audioId });
  }
  private send(value: unknown): void { if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(value)); }
  private subscribe(topic: 'comments' | 'audio', enabled: boolean): void {
    this.generation[topic] += 1;
    this.send({ type: 'mobile.subscribe', protocolVersion: compatibilityPolicy.contracts.mobileProtocol.current, topic, generation: this.generation[topic], enabled });
  }
  private subscribeAudio(): void {
    if (!this.connection) return;
    const value = this.desiredAudio && this.available;
    if (value === this.subscribedAudio) return;
    this.subscribedAudio = value; this.incoming.clear(); this.callbacks.discard(); this.subscribe('audio', value);
  }
  private visibility = (): void => { if (this.connection) this.subscribe('comments', document.visibilityState !== 'hidden'); };
  private online = (): void => { if (!this.stopped && !this.blocked && !this.socket) { clearTimeout(this.retry); this.connect(); } };
  private lost(ws: WebSocket, code?: number): void {
    if (this.socket !== ws) return;
    clearInterval(this.heartbeat); this.socket = null; this.connection = ''; this.subscribedAudio = false;
    // Do not wait for a close handshake on a half-open TCP connection.
    ws.close(); this.incoming.clear(); this.callbacks.discard(); this.callbacks.connected(false);
    if (code === 4406) this.blocked = true;
    if (!this.stopped && !this.blocked) this.retry = setTimeout(() => this.connect(), [500, 1000, 2000][Math.min(this.attempt++, 2)]);
  }
  private connect(): void {
    if (this.stopped || this.blocked) return;
    const ws = new WebSocket(`ws://${location.host}/mobile/ws`);
    this.socket = ws; ws.binaryType = 'arraybuffer'; this.lastMessage = Date.now();
    this.heartbeat = setInterval(() => { if (Date.now() - this.lastMessage >= 4000) this.lost(ws); }, 500);
    ws.onclose = event => this.lost(ws, event?.code);
    ws.onerror = () => this.lost(ws);
    ws.onmessage = (message) => {
      if (this.socket !== ws || this.stopped) return;
      this.lastMessage = Date.now();
      try {
        if (message.data instanceof ArrayBuffer) { this.binary(message.data); return; }
        const e = JSON.parse(String(message.data)) as MobileWireEvent;
        if (!this.connection && e.type === 'mobile.snapshot') {
          this.blocked = true; this.callbacks.error('PC版を更新してください。'); this.lost(ws); return;
        }
        if (e.type === 'mobile.hello') {
          if (e.payload.protocolVersion !== compatibilityPolicy.contracts.mobileProtocol.current) {
            this.blocked = true; this.callbacks.error('PCとスマホのアプリを更新してください。'); this.lost(ws); return;
          }
          this.connection = e.connectionId; this.attempt = 0; this.generation = { comments: 0, audio: 0 };
          this.feed = new MobileCommentFeed(this.callbacks.comments);
          this.available = e.payload.audioAvailable === true; this.callbacks.available(this.available);
          this.callbacks.connected(true); this.visibility(); this.subscribeAudio(); return;
        }
        if (e.connectionId !== this.connection) return;
        if (e.type === 'ping') { this.send({ type: 'pong', nonce: e.payload.nonce }); return; }
        if (e.type === 'mobile.audioAvailabilityChanged') {
          this.available = e.payload.audioAvailable === true; this.callbacks.available(this.available); this.subscribeAudio(); return;
        }
        if (e.type.startsWith('mobile.audio') || e.type === 'mobile.subscription') {
          if (e.generation !== this.generation.audio || !this.subscribedAudio) return;
          const id = String(e.payload.audioId);
          if (e.type === 'mobile.audioReady') {
            const length = e.payload.byteLength as number;
            const ttl = e.payload.expiresInMs as number;
            if (!/^[\w-]{24}$/.test(id) || !Number.isInteger(length) || length < 1 || length > 8 * 1024 * 1024 ||
              !Number.isFinite(ttl) || ttl <= 0 || ttl > 15000 || this.incoming.size >= 2) { this.audioResult('mobile.audioError', id); return; }
            this.incoming.set(id, { audioId: id, bytes: new Uint8Array(length), offset: 0, expiresAt: Date.now() + ttl });
          } else if (e.type === 'mobile.audioDiscard') { this.incoming.delete(id); this.callbacks.discard(id); }
          else if (e.type === 'mobile.subscription' && e.payload.status === 'busy') this.callbacks.error('PCの読み上げ設定を確認してください。');
          return;
        }
        if (e.generation === this.generation.comments) this.feed.receive(e);
      } catch { this.lost(ws); }
    };
  }
  private binary(data: ArrayBuffer): void {
    if (data.byteLength < 37 || data.byteLength > 36 + 16384) return;
    const view = new DataView(data);
    if (view.getUint32(0) !== 0x434d4132 || view.getUint32(4) !== this.generation.audio) return;
    const id = String.fromCharCode(...new Uint8Array(data, 12, 24));
    const item = this.incoming.get(id);
    if (!item) return;
    const chunk = new Uint8Array(data, 36);
    if (item.offset !== view.getUint32(8) || item.offset + chunk.length > item.bytes.length || item.expiresAt <= Date.now()) {
      this.incoming.delete(id); this.audioResult('mobile.audioError', id); return;
    }
    item.bytes.set(chunk, item.offset); item.offset += chunk.length;
    if (item.offset === item.bytes.length) { this.incoming.delete(id); this.callbacks.audio(item); }
  }
}
