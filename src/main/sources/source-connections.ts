import { connectionKeys, type AppSettings, type CommentSource, type ConnectionKey } from '../../shared/types';
import { createShitarabaSource } from './shitaraba-source';
import { createJpnknSource } from './jpnkn-source';
import { normalizeBoardInput } from './source-inputs';
import { createTwitchSource } from './twitch-source';
import { createYouTubeSource } from './youtube-source';
import { createSourceStatus, type CommentSourceAdapter, type SourceCallbacks, type SourceStatus } from './source-adapter';

export type SourceAdapterFactory = (
  source: ConnectionKey,
  settings: AppSettings['sources'],
  callbacks: SourceCallbacks,
) => CommentSourceAdapter;

interface SourceConnectionsOptions {
  settings(): AppSettings['sources'];
  initializeShitaraba(): Promise<void>;
  callbacks: SourceCallbacks;
  factory?: SourceAdapterFactory;
}

/** Owns live adapters and their status; callers decide why a connection is needed. */
export class SourceConnections {
  private readonly adapters = new Map<ConnectionKey, CommentSourceAdapter>();
  private readonly stopGenerations: Record<ConnectionKey, number> = { youtube: 0, twitch: 0, shitaraba: 0 };
  private readonly statuses: Record<ConnectionKey, SourceStatus> = {
    youtube: createSourceStatus('youtube', 'stopped'),
    twitch: createSourceStatus('twitch', 'stopped'),
    shitaraba: createSourceStatus('shitaraba', 'stopped'),
  };

  constructor(private readonly options: SourceConnectionsOptions) {
    for (const source of connectionKeys) this.statuses[source].service = connectionService(source, options.settings());
  }

  snapshot(): Record<ConnectionKey, SourceStatus> {
    return structuredClone(this.statuses);
  }

  state(source: ConnectionKey) {
    return this.statuses[source].state;
  }

  hasConnection(source: ConnectionKey): boolean {
    return this.adapters.has(source);
  }

  async start(source: ConnectionKey): Promise<void> {
    if (this.adapters.has(source)) return;
    const generation = this.stopGenerations[source];
    if (source === 'shitaraba') await this.options.initializeShitaraba();
    // A stop can precede adapter creation; a second start can finish the same
    // initialization first. Neither may revive or duplicate that connection.
    if (generation !== this.stopGenerations[source] || this.adapters.has(source)) return;
    const settings = this.options.settings();
    const service = connectionService(source, settings);
    let adapter: CommentSourceAdapter | undefined;
    const current = () => generation === this.stopGenerations[source] && adapter !== undefined && this.adapters.get(source) === adapter;
    const callbacks: SourceCallbacks = {
      onStatus: status => { if (current()) this.setStatus({ ...status, source, service }); },
      onComment: comment => { if (current()) this.options.callbacks.onComment(comment); },
      onYouTubeVideo: video => { if (current()) this.options.callbacks.onYouTubeVideo?.(video); },
      onRawAuthor: (service, id, name) => { if (current()) this.options.callbacks.onRawAuthor?.(service, id, name); },
      onBoardBatch: comments => { if (current()) this.options.callbacks.onBoardBatch?.(comments); },
      onBoardProgress: maximum => { if (current()) this.options.callbacks.onBoardProgress?.(maximum); },
      onShitarabaBatch: comments => { if (current()) {
        this.options.callbacks.onBoardBatch?.(comments);
        this.options.callbacks.onShitarabaBatch?.(comments);
      } },
      onShitarabaProgress: maximum => { if (current()) {
        this.options.callbacks.onBoardProgress?.(maximum);
        this.options.callbacks.onShitarabaProgress?.(maximum);
      } },
    };
    try {
      adapter = (this.options.factory ?? defaultSourceFactory)(source, settings, callbacks);
      this.adapters.set(source, adapter);
      this.setStatus(createSourceStatus(source, 'connecting'));
      if (!current()) return;
      await adapter.start();
    } catch (error) {
      if (generation !== this.stopGenerations[source] || (adapter && this.adapters.get(source) !== adapter)) return;
      this.adapters.delete(source);
      this.setStatus(createSourceStatus(source, 'error',
        error instanceof Error ? error.message : '接続を開始できませんでした。'));
      throw error;
    }
  }

  async stop(source: ConnectionKey): Promise<void> {
    this.stopGenerations[source] += 1;
    const adapter = this.adapters.get(source);
    this.adapters.delete(source);
    this.setStatus(createSourceStatus(source, 'stopped'));
    if (adapter) {
      try { await adapter.stop(); }
      catch { /* A broken adapter must not prevent the remaining sources from stopping. */ }
    }
  }

  private setStatus(status: SourceStatus): void {
    const next = { ...status, service: status.service ?? connectionService(status.source, this.options.settings()) };
    this.statuses[status.source] = next;
    this.options.callbacks.onStatus(next);
  }

  refreshServices(): void {
    for (const source of connectionKeys) {
      const service = connectionService(source, this.options.settings());
      if (this.statuses[source].service !== service) {
        this.setStatus({ ...this.statuses[source], service, updatedAt: new Date().toISOString() });
      }
    }
  }
}

export function connectionService(source: ConnectionKey, settings: AppSettings['sources']): CommentSource | undefined {
  if (source !== 'shitaraba') return source;
  try { return normalizeBoardInput(settings.shitaraba.threadUrl).service; }
  catch { return undefined; }
}

const defaultSourceFactory: SourceAdapterFactory = (source, settings, callbacks) => {
  switch (source) {
    case 'youtube': return createYouTubeSource(settings.youtube.target, callbacks);
    case 'twitch': return createTwitchSource(settings.twitch.channel, callbacks);
    case 'shitaraba': return normalizeBoardInput(settings.shitaraba.threadUrl).service === 'jpnkn'
      ? createJpnknSource(settings.shitaraba.threadUrl, settings.shitaraba.pollIntervalSeconds, callbacks)
      : createShitarabaSource(settings.shitaraba.threadUrl, settings.shitaraba.pollIntervalSeconds, callbacks);
  }
};
