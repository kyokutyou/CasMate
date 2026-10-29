import { randomBytes } from 'node:crypto';
import type {
  CommentSpeechSettings,
  CommonComment,
  MobileSpeechSettings,
  MobileSpeechState,
  TailscalePublicationStatus,
} from '../../shared/types';
import type { SpeechSynthesizer } from './comment-speech-controller';
import { buildSpeechText } from './speech-text';

export interface AudioTranscoder {
  transcode(wav: Buffer, bitrateKbps: number): Promise<Buffer>;
  available(): boolean;
  shutdown?(): Promise<void>;
}

export interface MobileAudioReady {
  audioId: string;
  commentId: string;
  expiresInMs: number;
}

export interface MobileSpeechDependencies {
  synthesizer: SpeechSynthesizer;
  transcoder: AudioTranscoder;
  onState?: (state: MobileSpeechState) => void;
  onAudioReady?: (clientId: string, audio: MobileAudioReady) => void;
  onAudioDiscard?: (clientId: string, audioId: string) => void;
  now?: () => number;
  getWav?: (
    itemId: string,
    text: string,
    settings: CommentSpeechSettings,
  ) => Promise<Buffer>;
}

type MobileSpeechItem =
  | { kind: 'comment'; id: string; comment: CommonComment }
  | { kind: 'system'; id: string; text: string }
  | { kind: 'preview'; id: string; wav: Buffer };

interface SharedItem {
  expiresAt: number;
  value: MobileSpeechItem;
  references: number;
  prepared: Map<string, Promise<string | null>>;
  audioIds: Set<string>;
}

interface Subscription {
  id: string;
  current: SharedItem | null;
  audioId: string | null;
  started: boolean;
  prefetch: { item: SharedItem; audioId: string | null } | null;
  queue: SharedItem[];
}

export class MobileSpeechController {
  private commentSpeech: CommentSpeechSettings;
  private mobileSpeech: MobileSpeechSettings;
  private readonly clients = new Map<string, Subscription>();
  private droppedCount = 0;
  private warning: string | null = null;
  private lanWarning: string | null = null;
  private conversionAvailable = true;
  private urls: MobileSpeechState['urls'] = [];
  private tailscaleStatus: TailscalePublicationStatus = 'disabled';
  private readonly audioById = new Map<string, Buffer>();
  private readonly workers = new Set<Promise<void>>();
  private conversion: Promise<unknown> = Promise.resolve();
  private expiryTimer: NodeJS.Timeout | null = null;

  constructor(
    commentSpeech: CommentSpeechSettings,
    mobileSpeech: MobileSpeechSettings,
    private readonly dependencies: MobileSpeechDependencies,
  ) {
    this.commentSpeech = structuredClone(commentSpeech);
    this.mobileSpeech = structuredClone(mobileSpeech);
  }

  snapshot(): MobileSpeechState {
    const clients = [...this.clients.values()];
    return {
      urls: structuredClone(this.urls),
      tailscaleStatus: this.tailscaleStatus,
      activeClient: clients.length > 0,
      clientCount: clients.length,
      currentCommentId: clients.find((client) => client.current)?.current?.value.id ?? null,
      queueLength: clients.reduce((total, client) => total + client.queue.length, 0),
      droppedCount: this.droppedCount,
      audioAvailable: this.conversionAvailable &&
        this.dependencies.transcoder.available() &&
        this.commentSpeech.enabled &&
        this.commentSpeech.voice !== null,
      warning: this.warning ?? this.lanWarning,
    };
  }

  setUrls(urls: MobileSpeechState['urls']): void {
    this.urls = structuredClone(urls);
    this.changed();
  }

  setLanWarning(warning: string | null): void {
    this.lanWarning = warning;
    this.changed();
  }

  setTailscaleStatus(status: TailscalePublicationStatus): void {
    this.tailscaleStatus = status;
    this.changed();
  }

  updateSettings(commentSpeech: CommentSpeechSettings, mobileSpeech: MobileSpeechSettings): void {
    const disabled = !commentSpeech.enabled ||
      !commentSpeech.voice ||
      (!mobileSpeech.lanEnabled && !mobileSpeech.tailscaleEnabled && !mobileSpeech.directEnabled);
    this.commentSpeech = structuredClone(commentSpeech);
    this.mobileSpeech = structuredClone(mobileSpeech);
    if (disabled) for (const id of this.clients.keys()) this.stop(id);
    this.changed();
  }

  start(clientId: string): boolean {
    if (this.clients.has(clientId)) return true;
    if ((!this.mobileSpeech.lanEnabled && !this.mobileSpeech.tailscaleEnabled && !this.mobileSpeech.directEnabled) || !this.snapshot().audioAvailable) return false;
    this.clients.set(clientId, { id: clientId, current: null, audioId: null, started: false, prefetch: null, queue: [] });
    this.expiryTimer ??= setInterval(() => {
      for (const client of this.clients.values()) { this.expire(client); this.drain(client); }
    }, 250).unref();
    this.warning = null;
    this.changed();
    return true;
  }

  stop(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;
    this.clients.delete(clientId);
    if (this.clients.size === 0 && this.expiryTimer) { clearInterval(this.expiryTimer); this.expiryTimer = null; }
    if (client.current) this.release(client.current);
    for (const item of client.queue) this.release(item);
    this.changed();
  }

  accept(comment: CommonComment): void {
    if (comment.initialHistory) return;
    this.broadcast({ kind: 'comment', id: comment.id, comment: structuredClone(comment) });
  }

  acceptSystemAnnouncement(id: string, text: string): void {
    if (text) this.broadcast({ kind: 'system', id, text });
  }

  createPreviewReceiver(): ((wav: Buffer) => void) | undefined {
    const recipients = [...this.clients.values()];
    if (recipients.length === 0 || !this.commentSpeech.enabled) return undefined;
    // 合成を待つ間に開始・再接続した端末へ過去の試聴を送らない。
    return (wav) => this.broadcast(
      { kind: 'preview', id: 'preview:' + randomBytes(18).toString('base64url'), wav: Buffer.from(wav) },
      recipients.filter((client) => this.clients.get(client.id) === client),
    );
  }

  private broadcast(value: MobileSpeechItem, recipients = [...this.clients.values()]): void {
    const clients = recipients.filter((client) => client.current?.value.id !== value.id &&
      !client.queue.some((item) => item.value.id === value.id));
    const item: SharedItem = { value, expiresAt: this.now() + 15_000, references: clients.length, prepared: new Map(), audioIds: new Set() };
    for (const client of clients) {
      this.expire(client);
      client.queue.push(item);
      if (client.queue.length > 10) {
        this.dropQueued(client, client.queue.shift()!);
      }
      this.drain(client);
    }
    this.changed();
  }

  audio(audioId: string): Buffer | null {
    const value = this.audioById.get(audioId);
    return value ? Buffer.from(value) : null;
  }

  audioEnded(clientId: string, audioId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;
    if (client.prefetch?.audioId === audioId) {
      this.removeFailed(client, client.prefetch.item);
      this.changed(); this.drain(client); return;
    }
    if (audioId !== client.audioId || !client.current) return;
    this.release(client.current);
    client.current = null;
    client.audioId = null;
    client.started = false;
    this.changed();
    this.drain(client);
  }

  audioStarted(clientId: string, audioId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;
    this.expire(client);
    if (client.audioId === audioId) client.started = true;
    this.drain(client);
  }

  async whenSettled(): Promise<void> {
    while (this.workers.size > 0) await Promise.all(this.workers);
  }

  async shutdown(): Promise<void> {
    for (const id of this.clients.keys()) this.stop(id);
    await this.dependencies.transcoder.shutdown?.();
  }

  private drain(client: Subscription): void {
    if (this.clients.get(client.id) !== client) return;
    if (client.current) {
      if (client.audioId && !client.prefetch && client.queue.length > 0) {
        const item = client.queue[0]!;
        client.prefetch = { item, audioId: null };
        this.track(this.deliver(item, client));
      }
      return;
    }
    if (client.queue.length === 0) return;
    const item = client.queue.shift()!;
    client.current = item;
    client.started = false;
    if (client.prefetch?.item === item) {
      client.audioId = client.prefetch.audioId;
      client.prefetch = null;
      // An in-flight prefetch becomes the current item without a second conversion/send.
      if (client.audioId) this.drain(client);
      return;
    }
    this.changed();
    this.track(this.deliver(item, client));
  }

  private track(worker: Promise<void>): void {
    this.workers.add(worker);
    void worker.finally(() => this.workers.delete(worker));
  }

  private async deliver(item: SharedItem, client: Subscription): Promise<void> {
    try {
      const audioId = await this.prepareAudio(item);
      if (this.clients.get(client.id) !== client) return;
      this.expire(client);
      const current = client.current === item;
      if (!current && client.prefetch?.item !== item) return;
      if (audioId) {
        if (current) client.audioId = audioId;
        else client.prefetch!.audioId = audioId;
        this.warning = null;
        this.conversionAvailable = true;
        this.dependencies.onAudioReady?.(client.id, { audioId, commentId: item.value.id, expiresInMs: Math.max(0, item.expiresAt - this.now()) });
        this.drain(client);
      } else {
        this.removeFailed(client, item);
        this.drain(client);
      }
    } catch {
      if (this.clients.get(client.id) !== client) return;
      this.warning = 'FFmpegまたはスマホ音声の準備に失敗しました。PC読み上げは継続します。';
      // A transient item failure must not cause clients to unsubscribe from audio.
      this.conversionAvailable = this.dependencies.transcoder.available();
      this.removeFailed(client, item);
      this.drain(client);
    }
    this.changed();
  }

  private now(): number { return (this.dependencies.now ?? Date.now)(); }

  private removeFailed(client: Subscription, item: SharedItem): void {
    if (client.current === item) {
      this.release(item); client.current = null; client.audioId = null; client.started = false;
    } else if (client.queue.includes(item)) {
      client.queue.splice(client.queue.indexOf(item), 1);
      this.dropQueued(client, item);
    }
  }

  private dropQueued(client: Subscription, item: SharedItem): void {
    if (client.prefetch?.item === item) {
      if (client.prefetch.audioId) this.dependencies.onAudioDiscard?.(client.id, client.prefetch.audioId);
      client.prefetch = null;
    }
    this.release(item);
    this.droppedCount += 1;
  }

  private expire(client: Subscription): void {
    const now = this.now();
    const dropped = this.droppedCount;
    if (client.current && !client.started && client.current.expiresAt <= now) {
      if (client.audioId) this.dependencies.onAudioDiscard?.(client.id, client.audioId);
      this.release(client.current);
      client.current = null; client.audioId = null;
      this.droppedCount += 1;
    }
    while (client.queue[0] && client.queue[0].expiresAt <= now) this.dropQueued(client, client.queue.shift()!);
    if (dropped !== this.droppedCount) this.changed();
  }

  private prepareAudio(item: SharedItem): Promise<string | null> {
    const settings = structuredClone(this.commentSpeech);
    const bitrate = this.mobileSpeech.bitrateKbps;
    const key = JSON.stringify([settings, bitrate]);
    const existing = item.prepared.get(key);
    if (existing) return existing;
    // 同じ項目の変換を共有し、FFmpegプロセス数を接続台数に比例させない。
    const prepared = this.conversion.then(async () => {
      if (item.references === 0) return null;
      const value = item.value;
      let wav: Buffer;
      if (value.kind === 'preview') wav = value.wav;
      else {
        const text = value.kind === 'system' ? value.text : buildSpeechText(value.comment, settings);
        if (!text) return null;
        wav = await (this.dependencies.getWav
          ? this.dependencies.getWav(value.id, text, settings)
          : this.dependencies.synthesizer.synthesize(text, settings));
      }
      if (item.references === 0) return null;
      const m4a = await this.dependencies.transcoder.transcode(wav, bitrate);
      if (item.references === 0) return null;
      const audioId = randomBytes(18).toString('base64url');
      item.audioIds.add(audioId);
      this.audioById.set(audioId, Buffer.from(m4a));
      return audioId;
    });
    item.prepared.set(key, prepared);
    this.conversion = prepared.catch(() => undefined);
    return prepared;
  }

  private release(item: SharedItem): void {
    item.references -= 1;
    if (item.references === 0) for (const audioId of item.audioIds) this.audioById.delete(audioId);
  }

  private changed(): void {
    this.dependencies.onState?.(this.snapshot());
  }
}
