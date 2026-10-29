import { compatibilityPolicy } from '../../shared/compatibility-policy.generated';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import type { MobileCommentsBootstrap, MobileCommentsRealtimeEvent } from '../../shared/types';
import type { AppState } from '../core/app-state';
import type { MobileAudioReady } from '../speech/mobile-speech-controller';

/** One read-only connection. No management/controller credentials enter this boundary. */
export class MobileReadSession {
  readonly connectionId = randomUUID();
  private comments = 0;
  private audio = 0;
  private generations = { comments: 0, audio: 0 };
  private lastPong = Date.now();
  private nonce = '';
  private priority: (() => void)[] = [];
  private history: (() => void) | null = null;
  private pumping = false;
  private closed = false;
  private queuedBytes = 0;
  private timer: NodeJS.Timeout;

  constructor(
    readonly clientId: string,
    private readonly socket: WebSocket,
    private readonly state: AppState,
    private readonly snapshot: () => { revision: number; payload: MobileCommentsBootstrap },
    onClose: () => void,
  ) {
    this.send('mobile.hello', { protocolVersion: compatibilityPolicy.contracts.mobileProtocol.current, mobilePublished: true, audioAvailable: state.snapshot().mobileSpeech.audioAvailable });
    this.timer = setInterval(() => {
      if (Date.now() - this.lastPong >= 4_000) { socket.terminate(); return; }
      this.nonce = randomUUID();
      this.send('ping', { nonce: this.nonce });
    }, 2_000).unref();
    socket.on('message', (data, binary) => { if (!binary) this.receive(String(data)); });
    socket.on('error', () => socket.terminate());
    socket.once('close', () => {
      this.closed = true; clearInterval(this.timer); this.priority = []; this.history = null;
      state.stopMobileSpeech(clientId); onClose();
    });
  }

  event(event: MobileCommentsRealtimeEvent): void {
    const audio = event.type === 'mobile.audioAvailabilityChanged';
    if (audio || this.comments) this.send(event.type, event.payload, audio ? this.audio : this.comments,
      'revision' in event ? event.revision : undefined);
  }

  audioReady(audio: MobileAudioReady): void {
    const generation = this.audio;
    if (!generation) return;
    const data = this.state.mobileAudio(audio.audioId);
    if (!data || data.length > 8 * 1024 * 1024) {
      this.state.finishMobileAudio(this.clientId, audio.audioId); return;
    }
    if (this.queuedBytes + data.length > 16 * 1024 * 1024) { this.socket.terminate(); return; }
    this.queuedBytes += data.length;
    this.send('mobile.audioReady', { ...audio, byteLength: data.length }, generation);
    let offset = 0;
    const next = () => {
      if (this.audio !== generation || this.closed) { this.queuedBytes -= data.length - offset; return; }
      const end = Math.min(data.length, offset + 16_384);
      const frame = Buffer.alloc(36 + end - offset);
      frame.writeUInt32BE(0x434d4132, 0); frame.writeUInt32BE(generation, 4); frame.writeUInt32BE(offset, 8);
      frame.write(audio.audioId, 12, 24, 'ascii'); data.copy(frame, 36, offset, end);
      this.write(frame); this.queuedBytes -= end - offset; offset = end;
      // Complete the current item before its prefetch, which may be much shorter.
      // New comments still pass between frames; the two players preserve completion order.
      if (offset < data.length) this.priority.unshift(next);
    };
    this.priority.push(next); this.pump();
  }

  discard(audioId: string): void { if (this.audio) this.send('mobile.audioDiscard', { audioId }, this.audio); }

  close(): void { this.socket.terminate(); }

  private receive(raw: string): void {
    if (raw.length > 8192) { this.socket.close(1009); return; }
    try {
      const m = JSON.parse(raw);
      if (m.type === 'pong' && m.nonce === this.nonce) { this.lastPong = Date.now(); return; }
      if (m.type === 'ping' && typeof m.nonce === 'string') { this.send('pong', { nonce: m.nonce }); return; }
      if (m.type === 'mobile.subscribe') {
        if (m.protocolVersion !== compatibilityPolicy.contracts.mobileProtocol.current) { this.socket.close(4406, 'PCまたはアプリの更新が必要です。'); return; }
        const topic = m.topic as 'audio' | 'comments';
        if ((topic !== 'audio' && topic !== 'comments') || !Number.isInteger(m.generation) ||
          m.generation <= this.generations[topic] || m.generation > 0xffffffff || typeof m.enabled !== 'boolean') return;
        this.generations[topic] = m.generation;
        if (topic === 'audio') {
          this.audio = 0; this.state.stopMobileSpeech(this.clientId);
          this.audio = m.enabled ? m.generation : 0;
          const started = m.enabled && this.state.startMobileSpeech(this.clientId);
          if (!started) this.audio = 0;
          this.send('mobile.subscription', { status: started ? 'started' : m.enabled ? 'busy' : 'stopped' }, m.generation);
        } else {
          this.comments = m.enabled ? m.generation : 0;
          this.history = null;
          if (this.comments) this.startSnapshot(this.comments);
        }
      } else if (m.generation === this.audio && this.audio && typeof m.audioId === 'string') {
        if (m.type === 'mobile.audioStarted') this.state.startMobileAudio(this.clientId, m.audioId);
        if (m.type === 'mobile.audioEnded' || m.type === 'mobile.audioError') this.state.finishMobileAudio(this.clientId, m.audioId);
      }
    } catch { /* Malformed public input never reaches management operations. */ }
  }

  private startSnapshot(generation: number): void {
    const { revision, payload } = this.snapshot();
    const { comments, ...metadata } = payload;
    this.send('mobile.snapshotBegin', metadata, generation, revision);
    let offset = 0;
    this.history = () => {
      if (generation !== this.comments) { this.history = null; return; }
      if (offset < comments.length) {
        const chunk = [];
        let bytes = 0;
        while (offset < comments.length && chunk.length < 100) {
          const size = Buffer.byteLength(JSON.stringify(comments[offset]));
          if (chunk.length && bytes + size > 32 * 1024) break;
          chunk.push(comments[offset++]!); bytes += size;
        }
        this.send('mobile.snapshotChunk', { comments: chunk }, generation, revision);
      } else {
        this.history = null;
        this.send('mobile.snapshotEnd', {}, generation, revision);
      }
    };
    this.pump();
  }

  private send(type: string, payload: unknown, generation = 0, revision?: number): void {
    this.write(JSON.stringify({ type, connectionId: this.connectionId, generation, revision, payload }));
  }

  private write(data: string | Buffer): void {
    if (this.closed || this.socket.readyState !== WebSocket.OPEN) return;
    if (this.socket.bufferedAmount > 256 * 1024) { this.socket.terminate(); return; }
    this.socket.send(data);
  }

  private pump(): void {
    if (this.pumping || this.closed) return;
    this.pumping = true;
    setImmediate(() => {
      this.pumping = false;
      if (this.closed) return;
      if (this.socket.bufferedAmount > 64 * 1024) {
        this.pumping = true;
        setTimeout(() => { this.pumping = false; this.pump(); }, 10).unref();
        return;
      }
      const next = this.priority.shift() ?? this.history;
      next?.();
      if (this.priority.length || this.history) this.pump();
    });
  }
}
