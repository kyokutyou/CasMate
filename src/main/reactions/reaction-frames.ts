import { randomUUID } from 'node:crypto';
import { ObsProgramContextChanged, ObsProgramPreview, type ObsProgramImage } from '../obs/obs-program-preview';
import type { ObsVisualReader } from '../obs/obs-visual';
import type { ReactionFrame } from '../../shared/listener-reactions';
import { ReactionProgramObservation, type ReactionProgram } from './reaction-program-observation';

export interface StoredReactionFrame extends ReactionProgram { metadata: ReactionFrame; bytes: Buffer; observedAt?: number }
type ObservedReactionFrame = StoredReactionFrame & { requestedAt: number; observedAt: number; publicEpoch: number };
type ProgramObservationTicket = { generation: number; start: number };
const CAPTURE_TIMEOUT_MS = 10_000;
const FRAME_LIFETIME_MS = 12_000;

export class ReactionFrames {
  generation = 0;
  message = 'OBS連携と最新画像を確認してください。';
  private frames = new Map<string, ObservedReactionFrame>();
  private publicEpoch = 0;
  private busy = false;
  private closed = false;
  private readonly observation = new ReactionProgramObservation();
  private readonly capture: ObsProgramPreview;
  private readonly abort = new AbortController();
  private readonly listeners = new Set<() => void>();
  private readonly now: () => number;
  readonly monotonicNow: () => number;
  constructor(read: () => ObsVisualReader, now?: () => number, monotonicNow = now ?? (() => performance.now())) {
    this.capture = new ObsProgramPreview(read, undefined, { maxDimension: 640, quality: 50, timeoutMs: CAPTURE_TIMEOUT_MS });
    this.now = now ?? Date.now;
    this.monotonicNow = monotonicNow;
  }
  get program(): ReactionProgram | undefined { return this.observation.latest; }
  beginProgramObservation(): ProgramObservationTicket { return { generation: this.generation, start: this.observation.begin() }; }
  acceptProgramObservation(ticket: ProgramObservationTicket, program: ReactionProgram): boolean {
    if (!this.current(ticket)) return false;
    const result = this.observation.accept(ticket.start, program);
    if (result === 'changed') this.invalidate();
    return result !== 'overlap';
  }
  private current(ticket: ProgramObservationTicket): boolean { return !this.closed && ticket.generation === this.generation; }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private changed() { for (const listener of this.listeners) listener(); }
  invalidate(message = '映像が変わりました。最新画像で範囲を確認してください。') { this.generation++; this.frames.clear(); this.message = message; this.changed(); }
  invalidatePublic() { this.publicEpoch++; }
  // Either a program change or a publication interruption retires the public generation.
  get publicGeneration() { return this.generation + this.publicEpoch; }
  get(id: string): ObservedReactionFrame | null {
    const frame = this.frames.get(id); const age = frame ? this.monotonicNow() - frame.requestedAt : Infinity;
    return !this.closed && frame?.metadata.generation === this.generation && age >= 0 && age <= FRAME_LIFETIME_MS ? frame : null;
  }
  getPublic(id: string): ObservedReactionFrame | null {
    const frame = this.get(id);
    return frame?.publicEpoch === this.publicEpoch ? frame : null;
  }
  latest() { return this.get([...this.frames.keys()].at(-1) ?? ''); }
  latestPublic() {
    const frame = this.latest();
    return frame?.publicEpoch === this.publicEpoch ? frame : null;
  }
  latestAt(cutoff: number, publicOnly = false): ObservedReactionFrame | null {
    const frame = [...this.frames.values()].reverse().find(candidate => candidate.observedAt <= cutoff && (!publicOnly || candidate.publicEpoch === this.publicEpoch));
    return frame ? this.get(frame.metadata.id) : null;
  }
  private frameMetadata(frame: ObservedReactionFrame | null, generation: number): ReactionFrame | null {
    return frame ? { ...frame.metadata, generation, validForMs: Math.max(0, Math.floor(FRAME_LIFETIME_MS - (this.monotonicNow() - frame.requestedAt))) } : null;
  }
  metadata() { return this.frameMetadata(this.latest(), this.generation); }
  publicMetadata() { return this.frameMetadata(this.latestPublic(), this.publicGeneration); }
  async tick() {
    if (this.busy || this.closed) return;
    this.busy = true;
    const requestedAt = this.monotonicNow();
    const capturedAt = this.now();
    const ticket = this.beginProgramObservation();
    // A capture interrupted by a publication stop may finish for management only.
    const publicEpoch = this.publicEpoch;
    try {
      const image: ObsProgramImage = await this.capture.capture(this.abort.signal);
      if (!this.current(ticket) || !image.current() || !image.context || !image.canvasWidth || !image.canvasHeight) return;
      const observedAt = this.monotonicNow();
      if (observedAt - requestedAt >= CAPTURE_TIMEOUT_MS) return;
      const result = this.observation.accept(ticket.start, { context: image.context, scene: image.sceneName });
      if (result === 'overlap') return;
      // Publish the new generation and its verified frame together. Follow can
      // reconcile the new scene without briefly restarting against the old one.
      if (result === 'changed') {
        this.generation++;
        this.frames.clear();
      }
      const id = randomUUID();
      const metadata: ReactionFrame = { id, capturedAt, validForMs: FRAME_LIFETIME_MS, width: image.width, height: image.height, canvasWidth: image.canvasWidth, canvasHeight: image.canvasHeight, generation: this.generation, url: `/frame.jpg?id=${id}` };
      this.frames.set(id, { metadata, bytes: image.bytes, context: image.context, scene: image.sceneName, requestedAt, observedAt, publicEpoch });
      while (this.frames.size > 24) this.frames.delete(this.frames.keys().next().value!);
      this.message = ''; this.changed();
    } catch (error) {
      if (!this.current(ticket) || !this.observation.isUncontested(ticket.start)) return;
      const interrupted = error instanceof Error && ['BUSY','OBS_CAPTURE_CHANGED'].includes(error.message);
      if (error instanceof ObsProgramContextChanged) this.invalidate();
      else if (!interrupted) this.message = 'OBS画像を取得できません。接続と最新画像を確認してください。';
    } finally { this.busy = false; }
  }
  close() { this.closed = true; this.abort.abort(); this.frames.clear(); this.listeners.clear(); }
}
