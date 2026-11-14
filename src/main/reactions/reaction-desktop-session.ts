import type { ReactionFrame, ReactionRegion, ReactionWindow } from '../../shared/listener-reactions';
import type { ReactionDependencies, ReactionRangeRead, ReactionRangeRecovery, ReactionWindowClass } from './reaction-range';

export type MonitorPin = { id: string; context?: string };
export type FollowOrigin = { context: string; monitor?: MonitorPin };
export type RunningTarget = { id: string; pid: number; displayGeometry?: string; fingerprint?: string };
type DisplayCanvas = Pick<ReactionFrame, 'canvasWidth' | 'canvasHeight'>;
export type EditResume = {
  generation: number;
  targetKey: string;
  targetId?: string;
  pid?: number;
  geometry?: string;
  dependencies?: ReactionDependencies;
  fingerprint?: string;
};

export type RangeRecovery = { classes: ReactionWindowClass[]; signature: string; obs?: ReactionRangeRecovery };
type SharedWork = { outcome: 'pending' | 'ready' | 'failed' };
export type RecoveryEvidence = {
  inputs?: boolean;
  target?: Pick<ReactionWindow, 'id' | 'pid'>;
  viewport?: (windows: ReactionWindow[]) => boolean;
  range?: RangeRecovery;
  read?: ReactionRangeRead;
  work?: SharedWork;
};
export type RecoveryWait = {
  revision: number;
  evidence: RecoveryEvidence;
  observedRecovery: boolean;
  windowsReady: boolean;
  nextProbe: number;
};

export type AutomaticStartOptions = { deadline?: number; waitUntil?: number; monitor?: MonitorPin };
export type AutomaticStart = {
  epoch: number;
  programRevision: number;
  waitUntil: number;
  deadline: number;
  nextAttempt: number;
  phase: 'inputs' | 'range' | 'native' | 'saving';
  recovery?: RangeRecovery;
  pendingRead?: ReactionRangeRead;
  pendingWork?: SharedWork;
  readyGeneration?: number;
  automaticRange: boolean;
  needsOnline: boolean;
  monitor?: MonitorPin;
  timer: ReturnType<typeof setTimeout>;
};

type EditPhase = { kind: 'editing' | 'confirmation'; resume: EditResume; preparation?: Promise<void> };
type Phase = { kind: 'stopped' } | EditPhase |
  { kind: 'starting'; attempt: AutomaticStart; follow?: FollowOrigin } |
  { kind: 'recovering'; wait: RecoveryWait; follow: FollowOrigin } |
  { kind: 'displaying'; target: RunningTarget; region: ReactionRegion; canvas: DisplayCanvas; follow?: FollowOrigin };

/** The desktop intent and its current phase have a single owner. I/O is performed by the caller. */
export class ReactionDesktopSession {
  private phase: Phase = { kind: 'stopped' };
  private revision = 0;
  private manualPreparation?: { epoch: number };

  constructor(private readonly now: () => number) {}

  get epoch() { return this.revision; }
  get edit() {
    return this.phase.kind === 'editing' || this.phase.kind === 'confirmation' ? this.phase : undefined;
  }
  get attempt() { return this.phase.kind === 'starting' ? this.phase.attempt : undefined; }
  get display() { return this.phase.kind === 'displaying' ? this.phase : undefined; }
  get recovery() { return this.phase.kind === 'recovering' ? this.phase : undefined; }
  get preparingManually() { return this.manualPreparation?.epoch === this.revision; }
  get follow() {
    const phase = this.phase;
    return phase.kind === 'starting' || phase.kind === 'recovering' || phase.kind === 'displaying' ? phase.follow : undefined;
  }

  private transition(phase: Phase) {
    clearTimeout(this.attempt?.timer);
    this.phase = phase;
  }

  stop() {
    this.revision++;
    this.transition({ kind: 'stopped' });
  }

  editRange(resume: EditResume, kind: EditPhase['kind']) {
    this.transition({ kind, resume });
  }

  markManualPreparation() {
    const preparation = { epoch: this.revision };
    this.manualPreparation = preparation;
    return () => {
      if (this.manualPreparation !== preparation) return false;
      this.manualPreparation = undefined;
      return true;
    };
  }

  prepareEditedRange(edit: EditPhase, prepare: (current: () => boolean) => Promise<void>, timeout: () => Error) {
    if (edit.preparation) return edit.preparation;
    const deadline = this.now() + 16_000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const current = () => this.edit === edit && this.now() < deadline;
    const expired = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(timeout()), 16_000);
      timer.unref?.();
    });
    edit.preparation = Promise.race([prepare(current), expired]).finally(() => clearTimeout(timer));
    return edit.preparation;
  }

  begin(automaticRange: boolean, needsOnline: boolean, programRevision: number, options: AutomaticStartOptions,
    follow: FollowOrigin | undefined, expired: (attempt: AutomaticStart) => void) {
    const now = this.now();
    const { deadline = now + 16_000, waitUntil = Math.min(deadline, now + 8_000), monitor } = options;
    const timer = setTimeout(() => expired(attempt), Math.max(0, Math.ceil(deadline - now)));
    timer.unref?.();
    const attempt: AutomaticStart = {
      epoch: this.revision, programRevision, waitUntil, deadline, nextAttempt: 0,
      phase: 'inputs', automaticRange, needsOnline, monitor, timer,
    };
    this.transition({ kind: 'starting', attempt, follow });
  }

  current(attempt: AutomaticStart) {
    return this.attempt === attempt && this.now() < attempt.deadline;
  }

  canBeginRange(attempt: AutomaticStart, generation: number, imageAt: number, windowsAt: number) {
    if (!this.current(attempt) || attempt.phase !== 'inputs') return false;
    if (attempt.readyGeneration !== generation && Math.max(imageAt, windowsAt) > attempt.waitUntil) return false;
    attempt.readyGeneration = generation;
    if (this.now() < attempt.nextAttempt) return false;
    attempt.phase = 'range';
    return true;
  }

  retry(attempt: AutomaticStart, recovery: RangeRecovery) {
    attempt.recovery = recovery;
    attempt.pendingWork = undefined;
    attempt.phase = 'inputs';
    attempt.nextAttempt = this.now() + 500;
  }

  wait(follow: FollowOrigin, revision: number, evidence: RecoveryEvidence, probeInterval: number) {
    const wait = { revision, evidence, observedRecovery: false, windowsReady: false, nextProbe: this.now() + probeInterval };
    this.transition({ kind: 'recovering', wait, follow });
  }

  recoveryAction(wait: RecoveryWait, haveInputs: boolean, windowsReady: boolean, probeAvailable: boolean, probeInterval: number) {
    wait.windowsReady = windowsReady;
    const { inputs, target, viewport, read, range, work } = wait.evidence;
    const inputsRecovered = inputs && !target && !viewport && !read && !range?.obs;
    if (haveInputs && work?.outcome !== 'pending' && (wait.observedRecovery || windowsReady || inputsRecovered || work?.outcome === 'ready')) return 'resume';
    const now = this.now();
    if (!wait.observedRecovery && (range?.obs || read) && probeAvailable && now >= wait.nextProbe) {
      wait.nextProbe = now + probeInterval;
      return 'probe';
    }
  }

  show(target: RunningTarget, region: ReactionRegion, canvas: DisplayCanvas, follow?: FollowOrigin) {
    this.transition({ kind: 'displaying', target, region, canvas, follow });
  }

  /** A shared resource can become ready after its initiating attempt was invalidated. */
  async awaitWork<T>(completion: Promise<T>, attempt: AutomaticStart | undefined, phase: 'native' | 'saving', restored?: () => boolean) {
    if (!attempt) return completion;
    const work: SharedWork = { outcome: 'pending' };
    attempt.phase = phase;
    attempt.pendingWork = work;
    try {
      const result = await completion;
      work.outcome = 'ready';
      return result;
    } catch (error) {
      // Completing compensation unblocks recovery; an actual write error does not.
      work.outcome = restored?.() ? 'ready' : 'failed';
      throw error;
    } finally {
      if (attempt.pendingWork === work && this.current(attempt)) {
        attempt.pendingWork = undefined;
        attempt.phase = 'range';
      }
    }
  }
}
