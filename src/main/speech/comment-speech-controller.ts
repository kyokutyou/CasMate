import type {
  CommentSpeechSettings,
  CommentSpeechState,
  CommonComment,
  VoicevoxSpeaker,
} from '../../shared/types';
import { buildSpeechText } from './speech-text';

export interface SpeechSynthesizer {
  prepare(): Promise<void>;
  listVoices(): Promise<VoicevoxSpeaker[]>;
  synthesize(text: string, settings: CommentSpeechSettings): Promise<Buffer>;
  shutdown?(): Promise<void>;
}

export interface PcAudioPlayer {
  play(request: {
    commentId: string;
    wav: Buffer;
    onMouthShape?: (shape: 'closed' | 'open') => void;
  }): Promise<void>;
  stop(): void | Promise<void>;
  shutdown?(): Promise<void>;
}

export interface SynchronizedOverlay {
  start(comment: CommonComment): void;
  finish(commentId: string): void;
  fallback(comment: CommonComment): Promise<void>;
  clear(): void;
}

export interface CommentSpeechDependencies {
  synthesizer: SpeechSynthesizer;
  player: PcAudioPlayer;
  previewPlayer?: PcAudioPlayer;
  synchronizedOverlay?: SynchronizedOverlay;
  onState?: (state: CommentSpeechState) => void;
  onSpeechStart?: (commentId: string) => void;
  onMouthShape?: (commentId: string, shape: 'closed' | 'open') => void;
  onSpeechStop?: (commentId?: string) => void;
  delay?: (milliseconds: number) => Promise<void>;
  getWav?: (
    itemId: string,
    text: string,
    settings: CommentSpeechSettings,
  ) => Promise<Buffer>;
}

type SpeechQueueItem =
  | { kind: 'comment'; id: string; comment: CommonComment }
  | { kind: 'system'; id: string; text: string };

export class CommentSpeechController {
  private settings: CommentSpeechSettings;
  private synchronized: boolean;
  private queue: SpeechQueueItem[] = [];
  private current: SpeechQueueItem | null = null;
  private droppedCount = 0;
  private engineStatus: CommentSpeechState['engineStatus'] = 'disabled';
  private warning: string | null = null;
  private generation = 0;
  private worker: Promise<void> = Promise.resolve();
  private preparation: Promise<void> = Promise.resolve();
  private voices: VoicevoxSpeaker[] = [];

  constructor(
    settings: CommentSpeechSettings,
    private readonly dependencies: CommentSpeechDependencies,
    synchronized = false,
  ) {
    this.settings = structuredClone(settings);
    this.synchronized = synchronized;
    if (settings.enabled) this.prepare();
  }

  snapshot(): CommentSpeechState {
    return {
      engineStatus: this.engineStatus,
      currentCommentId: this.current?.id ?? null,
      queueLength: this.queue.length,
      droppedCount: this.droppedCount,
      warning: this.warning,
    };
  }

  queuedCommentIds(): string[] {
    return this.queue.map((item) => item.id);
  }

  available(): boolean {
    return this.settings.enabled && this.engineStatus === 'ready' && this.validVoice();
  }

  accept(comment: CommonComment): void {
    if (!this.settings.enabled || comment.initialHistory || this.contains(comment.id)) return;
    this.enqueue({ kind: 'comment', id: comment.id, comment: structuredClone(comment) });
  }

  acceptSystemAnnouncement(id: string, text: string): void {
    if (!this.settings.enabled || !text || this.contains(id)) return;
    this.enqueue({ kind: 'system', id, text });
  }

  private enqueue(item: SpeechQueueItem): void {
    this.queue.push(item);
    if (this.queue.length > 10) {
      this.queue.shift();
      this.droppedCount += 1;
    }
    this.changed();
    this.drain();
  }

  updateSettings(settings: CommentSpeechSettings, synchronized: boolean): void {
    const boundaryChanged = settings.enabled !== this.settings.enabled || synchronized !== this.synchronized;
    this.settings = structuredClone(settings);
    this.synchronized = synchronized;
    if (boundaryChanged) this.clear();
    if (settings.enabled && this.engineStatus !== 'ready') this.prepare();
    if (!settings.enabled) {
      this.engineStatus = 'disabled';
      this.changed();
    } else if (this.engineStatus === 'ready') {
      this.warning = this.validVoice() ? null : '話者とスタイルを選択してください。';
      this.changed();
    }
  }

  async listVoices(): Promise<VoicevoxSpeaker[]> {
    await this.ensureReady(true);
    return structuredClone(this.voices);
  }

  async preview(onPrepared?: (wav: Buffer) => void): Promise<void> {
    await this.ensureReady();
    if (!this.validVoice()) throw new Error('話者とスタイルを選択してください。');
    const wav = await this.dependencies.synthesizer.synthesize(
      'これはコメント読み上げのテストです',
      this.settings,
    );
    onPrepared?.(wav);
    await (this.dependencies.previewPlayer ?? this.dependencies.player).play({
      commentId: 'preview',
      wav,
    });
  }

  clear(): void {
    this.generation += 1;
    const currentId = this.current?.id;
    this.queue = [];
    this.current = null;
    void this.dependencies.player.stop();
    this.dependencies.synchronizedOverlay?.clear();
    this.dependencies.onSpeechStop?.(currentId);
    this.changed();
  }

  async shutdown(): Promise<void> {
    this.clear();
    await Promise.allSettled([
      Promise.resolve(this.dependencies.player.shutdown?.()),
      this.dependencies.previewPlayer && this.dependencies.previewPlayer !== this.dependencies.player
        ? Promise.resolve(this.dependencies.previewPlayer.shutdown?.())
        : Promise.resolve(),
      Promise.resolve(this.dependencies.synthesizer.shutdown?.()),
    ]);
  }

  whenReady(): Promise<void> {
    return this.preparation;
  }

  async whenIdle(): Promise<void> {
    while (this.current || this.queue.length > 0) await this.worker;
  }

  private prepare(allowWhileDisabled = false): void {
    const generation = this.generation;
    this.engineStatus = 'preparing';
    this.warning = null;
    this.changed();
    this.preparation = (async () => {
      try {
        await this.dependencies.synthesizer.prepare();
        const voices = await this.dependencies.synthesizer.listVoices();
        if (generation !== this.generation || (!this.settings.enabled && !allowWhileDisabled)) return;
        this.voices = voices;
        this.engineStatus = 'ready';
        this.warning = this.validVoice() ? null : '話者とスタイルを選択してください。';
        this.changed();
        this.drain();
      } catch {
        if (generation !== this.generation) return;
        this.engineStatus = 'unavailable';
        this.warning = 'VOICEVOXを準備できませんでした。インストールまたは実行ファイルを確認してください。';
        this.queue = [];
        this.changed();
      }
    })();
  }

  private async ensureReady(refresh = false): Promise<void> {
    if (this.engineStatus !== 'preparing' && (refresh || this.engineStatus !== 'ready')) this.prepare(true);
    await this.preparation;
    if (this.engineStatus !== 'ready') throw new Error(this.warning ?? 'VOICEVOXを利用できません。');
  }

  private drain(): void {
    if (this.engineStatus !== 'ready' || this.current || this.queue.length === 0) return;
    const generation = this.generation;
    const next = this.queue.shift()!;
    this.current = next;
    this.changed();
    this.worker = this.process(next, generation).finally(() => {
      if (generation === this.generation && this.current?.id === next.id) {
        this.current = null;
        this.changed();
        this.drain();
      }
    });
  }

  private async process(item: SpeechQueueItem, generation: number): Promise<void> {
    const comment = item.kind === 'comment' ? item.comment : null;
    const text = item.kind === 'system' ? item.text : buildSpeechText(item.comment, this.settings);
    if (!text) return;
    if (!this.validVoice()) {
      this.warning = '話者とスタイルを選択してください。対象コメントは読み上げられませんでした。';
      if (this.synchronized && comment) await this.dependencies.synchronizedOverlay?.fallback(comment);
      return;
    }

    let shown = false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (generation !== this.generation) return;
      try {
        if (attempt > 0) await this.dependencies.synthesizer.prepare();
        if (generation !== this.generation) return;
        const wav = await (this.dependencies.getWav
          ? this.dependencies.getWav(item.id, text, this.settings)
          : this.dependencies.synthesizer.synthesize(text, this.settings));
        if (generation !== this.generation) return;
        if (this.synchronized && comment && !shown) {
          this.dependencies.synchronizedOverlay?.start(comment);
          shown = true;
        }
        this.dependencies.onSpeechStart?.(item.id);
        await this.dependencies.player.play({
          commentId: item.id,
          wav,
          onMouthShape: (shape) => this.dependencies.onMouthShape?.(item.id, shape),
        });
        if (generation !== this.generation) return;
        this.dependencies.onSpeechStop?.(item.id);
        if (shown) {
          await (this.dependencies.delay ?? delay)(synchronizedOverlayTailMs);
          if (generation !== this.generation) return;
          this.dependencies.synchronizedOverlay?.finish(item.id);
        }
        this.warning = null;
        return;
      } catch {
        if (generation !== this.generation) return;
        this.dependencies.onSpeechStop?.(item.id);
        if (attempt === 1) {
          this.warning = 'コメントを読み上げられませんでした。VOICEVOXと音声出力を確認してください。';
          if (shown) this.dependencies.synchronizedOverlay?.finish(item.id);
          else if (this.synchronized && comment) await this.dependencies.synchronizedOverlay?.fallback(comment);
        }
      }
    }
    this.changed();
  }

  private validVoice(): boolean {
    const selected = this.settings.voice;
    return Boolean(selected && this.voices.some(
      (speaker) => speaker.speakerUuid === selected.speakerUuid &&
        speaker.styles.some((style) => style.id === selected.styleId),
    ));
  }

  private contains(id: string): boolean {
    return this.current?.id === id || this.queue.some((item) => item.id === id);
  }

  private changed(): void {
    this.dependencies.onState?.(this.snapshot());
  }
}

const synchronizedOverlayTailMs = 2_000;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
