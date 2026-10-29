import { randomUUID } from 'node:crypto';
import type { AppSettings } from '../../shared/types';
import type { ObsTestDisplay, ObsTestDisplayData, ObsTestDisplaySnapshot, ObsSourceTestRequest, ObsSourceTestContext, ObsSourceTestState, ObsSourceTestOperation } from '../../shared/obs-source-test';
import { ObsControlHttpError, type ObsSourceLease } from './obs-control-controller';
import { parseObsSourceAddRequest, ObsSourceRegistrationError, type ObsSourceRegistrationController } from './obs-source-registration-controller';

export interface ObsSourceTestOptions {
  sources: Pick<ObsSourceRegistrationController, 'validateDisplayTest'>;
  obs: { acquireSourceTest(): ObsSourceLease };
  settings(): AppSettings;
  assetReadable(asset: string): Promise<boolean>;
  onState?(state: ObsSourceTestState): void;
}
interface Job {
  operation: ObsSourceTestOperation;
  lease: ObsSourceLease;
  valid(): boolean;
  cancelled: boolean;
  cancelRequested?: boolean;
  timer?: ReturnType<typeof setTimeout>;
  guardTimer?: ReturnType<typeof setInterval>;
}

/** Finite browser display layers; never injects a normal application event. */
export class ObsSourceTestController {
  private job: Job | null = null;
  private current: ObsSourceTestOperation | null = null;
  private readonly warnings = new Map<string, ObsSourceTestOperation>();
  private revision = 0;
  private layer: ObsTestDisplay | null = null;
  private shuttingDown = false;
  constructor(private readonly options: ObsSourceTestOptions) {}
  view(): ObsSourceTestState {
    return structuredClone({ busy: this.job !== null, current: this.current, warnings: [...this.warnings.values()] });
  }
  display(overlay: ObsTestDisplayData['kind']): ObsTestDisplaySnapshot {
    return { revision: this.revision, display: this.layer?.data.kind === overlay && Date.now() < this.layer.expiresAt ? structuredClone(this.layer) : null };
  }
  async context(value: unknown): Promise<ObsSourceTestContext> {
    const request = parseRequest(value);
    try {
      await this.options.sources.validateDisplayTest(request);
      await this.data(request);
      return { available: !this.shuttingDown && !this.job, message: this.job ? '別の表示テストを処理中です。' :
        request.target.overlay === 'character' && !this.options.settings().character.simple.openAsset
          ? '口開き画像がないため、口パクなしで表示します。' : '' };
    } catch (error) { return { available: false, message: userMessage(error) }; }
  }
  async start(value: unknown): Promise<ObsSourceTestOperation> {
    const request = parseRequest(value);
    if (this.shuttingDown || this.job) throw failure(409, 'BUSY', '別の表示テストを処理中です。');
    let lease: ObsSourceLease;
    try { lease = this.options.obs.acquireSourceTest(); }
    catch (error) { throw failure(error instanceof ObsControlHttpError ? error.status : 503, error instanceof ObsControlHttpError ? error.code : 'OBS_UNAVAILABLE', 'OBS接続と、処理中の操作を確認してください。'); }
    const operation: ObsSourceTestOperation = { ...request, id: randomUUID(), title: '', phase: 'preparing', startedAt: null, expiresAt: null, needsAttention: false, message: 'テスト表示を準備しています。' };
    const job: Job = { operation, lease, valid: () => lease.session.valid(), cancelled: false };
    const destinationRevision = lease.session.destinationRevision();
    this.job = job; this.current = operation; this.publish();
    try {
      const checked = await bounded(this.options.sources.validateDisplayTest(request, lease.session), 3000);
      job.valid = checked.valid; operation.title = checked.title;
      const data = await bounded(this.data(request), 3000);
      if (!job.cancelled && this.job === job) await bounded(this.options.sources.validateDisplayTest(request, lease.session), 3000);
      if (job.cancelled || this.job !== job || !job.valid() || lease.session.destinationRevision() !== destinationRevision) throw failure(409, 'OBS_SOURCE_TARGET_CHANGED', 'テスト対象が変更されました。');
      operation.startedAt = Date.now(); operation.expiresAt = operation.startedAt + 5000;
      operation.phase = 'sending'; operation.message = 'テスト表示を送信しました。';
      this.layer = { testId: operation.id, startedAt: operation.startedAt, expiresAt: operation.expiresAt, data };
      job.timer = setTimeout(() => { void this.finish(job); }, 5000);
      // Connection/target changes are detected without extending the display deadline.
      let checking = false;
      job.guardTimer = setInterval(() => {
        if (!job.valid()) { void this.finish(job, 'テスト対象が変更されました。OBSで確認してください。'); return; }
        if (checking) return;
        checking = true;
        void this.options.sources.validateDisplayTest(request, lease.session, false).catch(() => this.finish(job, 'テスト対象が変更されました。OBSで確認してください。')).finally(() => { checking = false; });
      }, 500);
      this.publish();
    } catch (error) {
      await this.finish(job, job.cancelRequested ? undefined : userMessage(error));
      if (operation.startedAt === null && !job.cancelRequested) throw error;
    }
    return structuredClone(operation);
  }
  async stop(id: unknown): Promise<ObsSourceTestState> {
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) throw failure(400, 'OBS_TEST_INVALID_REQUEST', 'テストIDを確認してください。');
    if (this.job?.operation.id === id) { this.job.cancelRequested = true; await this.finish(this.job); }
    return this.view();
  }
  async shutdown(): Promise<void> { this.shuttingDown = true; if (this.job) { this.job.cancelRequested = true; await this.finish(this.job); } }

  private async data(request: ObsSourceTestRequest): Promise<ObsTestDisplayData> {
    const settings = this.options.settings();
    switch (request.target.overlay) {
      case 'comments': return { kind: 'comments', appearance: structuredClone(settings.commentOverlay) };
      case 'speech': {
        const { fontFamily, fontSizePx, textColor, backgroundColor, paddingPx, borderRadiusPx, design } = settings.speechRecognitionOverlay;
        return { kind: 'speech', appearance: { fontFamily, fontSizePx, textColor, backgroundColor, paddingPx, borderRadiusPx, ...(design ? { design: structuredClone(design) } : {}) } };
      }
      case 'effects': return { kind: 'effects', appearance: { fontSizePx: settings.textEffects.fontSizePx, fallDurationSeconds: settings.textEffects.fallDurationSeconds } };
      case 'character': {
        const appearance = structuredClone(settings.character.simple);
        if (!appearance.closedAsset || !await this.options.assetReadable(appearance.closedAsset)) throw failure(409, 'OBS_TEST_IMAGE_REQUIRED', 'キャラクター設定で口を閉じた画像を登録してください。');
        if (appearance.openAsset && !await this.options.assetReadable(appearance.openAsset)) appearance.openAsset = null;
        return { kind: 'character', appearance };
      }
    }
  }
  private async finish(job: Job, message?: string): Promise<void> {
    if (job.cancelled) return;
    job.cancelled = true;
    clearTimeout(job.timer); clearInterval(job.guardTimer);
    if (this.layer?.testId === job.operation.id) this.layer = null;
    job.lease.release(); if (this.job === job) this.job = null;
    job.operation.phase = 'complete';
    job.operation.needsAttention = Boolean(message);
    job.operation.message = message ?? '';
    if (message) this.warnings.set(job.operation.id, structuredClone(job.operation));
    this.publish();
  }
  private publish(): void { this.revision++; this.options.onState?.(this.view()); }
}
function parseRequest(value: unknown): ObsSourceTestRequest {
  const parsed = parseObsSourceAddRequest(value);
  if (!parsed.inputUuid || parsed.retryOperationId || !value || typeof value !== 'object' || Object.keys(value).length !== 4) throw failure(400, 'OBS_TEST_INVALID_REQUEST', '対象・コレクション・シーン・ソースを選択してください。');
  if (parsed.target.kind !== 'overlay') throw failure(400, 'OBS_TEST_UNSUPPORTED_TARGET', 'スマホ映像はスマホで送信を開始し、OBSで確認してください。');
  return { target: parsed.target, collection: parsed.collection, sceneUuid: parsed.sceneUuid, inputUuid: parsed.inputUuid };
}
function failure(status: number, code: string, message: string) { return new ObsSourceRegistrationError(status, code, message); }
function userMessage(error: unknown): string { return error instanceof ObsSourceRegistrationError ? error.message : 'テスト送信の結果を確認できません。OBS接続と対象を確認してください。'; }
async function bounded<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('OBS_TEST_TIMEOUT')), milliseconds); })]); }
  finally { clearTimeout(timer); }
}
