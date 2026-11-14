import type { ReactionPublicationState } from '../../shared/listener-reactions';
import { ReactionError } from './reaction-controller';
import { verifyPollEndpoint } from '../poll/poll-publication';
import { canonicalSrvUrl, type PollTunnel, type PollTunnelDriver } from '../poll/srv-us-tunnel';

export interface ReactionPublicationServer {
  host: string | null; online: boolean; nonce: string;
  start(): Promise<number>; stop(): Promise<void>; disconnect(): void;
}
export class ReactionPublication {
  private state: ReactionPublicationState = { status: 'off', url: null, message: '' };
  private desired = false;
  private generation = 0;
  private tunnel: PollTunnel | null = null;
  private retry?: ReturnType<typeof setTimeout>;
  private readiness?: ReturnType<typeof setTimeout>;
  private abort = new AbortController();
  private attempt = 0;
  private port = 0;
  private connecting: Promise<void> = Promise.resolve();
  private starting: Promise<void> = Promise.resolve();
  private startRequestGeneration: number | null = null;
  private publicationId = 0;
  private closing: Promise<boolean> = Promise.resolve(true);
  private stopping: Promise<void> = Promise.resolve();
  private firstPublished?: () => void;
  constructor(private readonly server: ReactionPublicationServer, private readonly driver: PollTunnelDriver, private readonly available: () => boolean,
    private readonly verify: typeof verifyPollEndpoint = verifyPollEndpoint,
    private readonly onReady?: (url: string, publicationId: number, signal: AbortSignal) => void) {}
  view(): ReactionPublicationState { return { ...this.state }; }
  start(onFirstPublished?: () => void, onAccepted?: () => void): Promise<void> {
    const requestedGeneration = this.generation, previousStop = this.stopping;
    if (this.desired || this.startRequestGeneration === requestedGeneration) return this.starting;
    this.startRequestGeneration = requestedGeneration;
    onAccepted?.();
    this.starting = (async () => {
      await previousStop;
      if (requestedGeneration !== this.generation || this.desired) return;
      if (!this.available()) throw new ReactionError(503, 'リアクション設定を読み込めないため公開できません。');
      this.closing = Promise.resolve(true);
      this.desired = true; this.attempt = 0; const generation = ++this.generation;
      this.publicationId++;
      this.firstPublished = onFirstPublished;
      this.state = { status: 'starting', url: null, message: 'srv.usへの公開を準備しています。' };
      try { this.port = await this.server.start(); }
      catch {
        if (this.generation === generation) { this.desired = false; this.state = { status: 'error', url: null, message: 'リアクションページの公開準備に失敗しました。ビルドと保存先を確認してください。' }; }
        await this.server.stop(); return;
      }
      // stop() owns cleanup of a cancelled server start and waits for this entire promise.
      if (!this.desired || generation !== this.generation) return;
      this.connecting = this.connect(generation); await this.connecting;
    })();
    const clearRequest = () => { if (this.startRequestGeneration === requestedGeneration) this.startRequestGeneration = null; };
    void this.starting.then(clearRequest, clearRequest);
    return this.starting;
  }
  stop(): Promise<void> {
    if (this.state.status === 'stopping') return this.stopping;
    const previousStop = this.stopping;
    this.desired = false; ++this.generation; clearTimeout(this.retry); clearTimeout(this.readiness); this.abort.abort(); this.server.disconnect();
    this.firstPublished = undefined;
    this.state = { status: 'stopping', url: null, message: 'リアクションページを停止しています。' };
    const tunnel = this.tunnel; this.tunnel = null;
    const tunnelClosed = this.trackClose(tunnel);
    this.stopping = (async () => {
      const closures = await Promise.allSettled([previousStop, tunnelClosed, this.connecting, this.starting]);
      await this.server.stop();
      this.state = !await this.closing || closures.some(result => result.status === 'rejected')
        ? { status: 'error', url: null, message: '公開は停止しましたが、接続の終了処理に失敗しました。実行用の接続鍵の削除は次の公開開始時に再試行します。' }
        : { status: 'off', url: null, message: '' };
    })();
    return this.stopping;
  }
  private async connect(generation: number): Promise<void> {
    if (!this.desired || generation !== this.generation) return;
    this.abort = new AbortController(); let seen: string | null = null;
    const current = () => this.desired && generation === this.generation;
    try {
      const tunnel = await this.driver.open(this.port, {
        url: url => {
          if (!current() || seen || !canonicalSrvUrl(url)) return;
          seen = url; this.server.host = new URL(url).host;
          void this.verifyReady(url, generation, this.abort.signal);
        },
        disconnected: (message, terminal) => { if (current()) this.lost(message, terminal); },
      });
      if (!current()) { await this.trackClose(tunnel); return; }
      this.tunnel = tunnel;
      this.readiness = setTimeout(() => { if (current() && this.state.status !== 'online') this.lost('公開先への到達を確認できません。再接続しています。', false); }, 30_000);
      this.readiness.unref();
    } catch (error) {
      if (current()) this.lost(error instanceof Error ? error.message : '公開接続を準備できません。', true);
    }
  }
  private async verifyReady(url: string, generation: number, signal: AbortSignal): Promise<void> {
    // DNS and certificates can become available shortly after the URL is printed.
    for (let attempt = 0; attempt < 10 && !signal.aborted; attempt++) {
      try {
        if (await this.verify(url, this.server.nonce, signal) && this.desired && generation === this.generation && !signal.aborted) {
          clearTimeout(this.readiness); this.attempt = 0; this.server.online = true;
          this.state = { status: 'online', url, message: '' };
          this.onReady?.(url, this.publicationId, signal);
          const published = this.firstPublished; this.firstPublished = undefined; published?.(); return;
        }
      } catch { /* Readiness is confirmed by the nonce, never by URL issuance alone. */ }
      await new Promise<void>(resolve => { const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); }; const timer = setTimeout(done, 1000); signal.addEventListener('abort', done, { once: true }); if (signal.aborted) done(); });
    }
  }
  private lost(message: string, terminal: boolean): void {
    const generation = ++this.generation;
    this.abort.abort(); clearTimeout(this.readiness); this.server.disconnect();
    this.firstPublished = undefined;
    const tunnel = this.tunnel; this.tunnel = null;
    this.state = { status: terminal ? 'error' : 'reconnecting', url: this.state.url, message };
    if (terminal) this.desired = false;
    this.trackClose(tunnel);
    const opening = this.connecting, starting = this.starting;
    const closeSafely = async () => {
      if (await this.closing) return true;
      this.desired = false; ++this.generation; await this.server.stop();
      this.state = { status: 'error', url: null, message: '実行用の接続鍵を削除できないため再接続を停止しました。公開開始時に削除を再試行します。' };
      return false;
    };
    if (terminal) {
      this.stopping = (async () => {
        await Promise.allSettled([opening, starting]);
        const closed = await this.closing; await this.server.stop();
        if (!closed && generation === this.generation) this.state = { status: 'error', url: null, message: '実行用の接続鍵を削除できませんでした。公開開始時に削除を再試行します。' };
      })();
      return;
    }
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(this.attempt++, 5));
    this.retry = setTimeout(() => {
      if (this.desired && generation === this.generation) this.connecting = opening.catch(() => undefined).then(closeSafely).then(ok => { if (ok) return this.connect(generation); });
    }, delay);
    this.retry.unref();
  }
  private trackClose(tunnel: PollTunnel | null): Promise<boolean> {
    if (!tunnel) return this.closing;
    const closed = tunnel.close().then(() => true, () => false);
    this.closing = Promise.all([this.closing, closed]).then(results => results.every(Boolean));
    return this.closing;
  }
}
