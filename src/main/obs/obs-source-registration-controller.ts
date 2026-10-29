import { randomUUID } from 'node:crypto';
import {
  obsOverlayDefinitions,
  type ObsSourceAddRequest, type ObsSourceCandidate, type ObsSourceContext, type ObsSourceOperation,
  type ObsSourceRegistrationState, type ObsSourceTarget,
} from '../../shared/obs-source-registration';
import type { SmartphoneController } from '../smartphone/smartphone-controller';
import { ObsControlHttpError, ObsSourceRequestRejected, type ObsControlController, type ObsSourceSession } from './obs-control-controller';

const requiredRequests = [
  'GetVersion', 'GetInputKindList', 'GetInputList', 'GetInputSettings', 'GetInputDefaultSettings',
  'GetSceneCollectionList', 'GetSceneList', 'GetStudioModeEnabled', 'GetGroupList', 'GetSceneItemList', 'GetGroupSceneItemList',
  'GetSceneItemTransform', 'GetVideoSettings', 'CreateInput', 'CreateSceneItem', 'SetSceneItemTransform',
];
const transformNumbers = [
  'positionX', 'positionY', 'rotation', 'scaleX', 'scaleY', 'alignment', 'boundsAlignment',
  'boundsWidth', 'boundsHeight', 'cropLeft', 'cropRight', 'cropTop', 'cropBottom',
] as const;
type Transform = Record<typeof transformNumbers[number], number> & { boundsType: string };
type Definition = { title: string; kind: 'browser_source' | 'ffmpeg_source'; input: string; identity: string };
type Input = ObsSourceCandidate & { kind: string };
type Item = { id: number; uuid: string; group: boolean; scene: boolean };
interface Inventory {
  context: ObsSourceContext;
  inputs: Input[];
  names: Set<string>;
  definition: Definition;
}
interface Job {
  operation: ObsSourceOperation;
  definition: Definition;
  ownedItem: boolean;
  createdInput: boolean;
  uncertainWrite: boolean;
  initialTransform: Transform | null;
  desiredTransform: Transform | null;
  createdSettings: Record<string, unknown> | null;
  attemptHasWritten?: boolean;
  attemptDestinationRevision?: number;
}

export interface ObsSourceRegistrationOptions {
  obs: Pick<ObsControlController, 'sourceReader' | 'acquireSourceRegistration'>;
  baseUrl: () => string;
  smartphone?: () => Pick<SmartphoneController, 'snapshot' | 'obsInput'> | null;
  onState?: (state: ObsSourceRegistrationState) => void;
}

export class ObsSourceRegistrationError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

/** Only CasMate targets enter this controller. It never changes settings of an existing input. */
export class ObsSourceRegistrationController {
  private busy = false;
  private stopped = false;
  private lastJob: Job | null = null;
  // Unfinished operations retain proof of ownership only for the lifetime of this process.
  private readonly unfinished = new Map<string, Job>();

  constructor(private readonly options: ObsSourceRegistrationOptions) {}

  view(): ObsSourceRegistrationState {
    return { busy: this.busy, lastOperation: this.lastJob ? structuredClone(this.lastJob.operation) : null,
      unfinishedOperations: [...this.unfinished.values()].map(job => structuredClone(job.operation)) };
  }

  stop(): void { this.stopped = true; }

  async context(value: unknown): Promise<ObsSourceContext> {
    const target = parseObsSourceTarget(value);
    try {
      const definition = this.resolve(target);
      const reader = this.checked(this.options.obs.sourceReader(), target, definition);
      return (await this.inventory(reader, target, definition)).context;
    } catch (error) { throw sourceError(error); }
  }

  /** Validate existing membership without creating or repairing anything, including after restart. */
  async validateDisplayTest(value: unknown, session?: ObsSourceSession, requireCurrent = true): Promise<{ title: string; valid(): boolean }> {
    const request = parseObsSourceAddRequest(value);
    if (!request.inputUuid || request.retryOperationId || !isRecord(value) || Object.keys(value).length !== 4) throw invalid();
    if (request.target.kind !== 'overlay') throw new ObsSourceRegistrationError(400, 'OBS_TEST_UNSUPPORTED_TARGET', 'スマホ映像はスマホで送信を開始し、OBSで確認してください。');
    try {
      const definition = this.resolve(request.target);
      const reader = this.checked(session ?? this.options.obs.sourceReader(), request.target, definition);
      const destinationRevision = reader.destinationRevision();
      const inventory = await this.inventory(reader, request.target, definition, requireCurrent);
      if (inventory.context.collection !== request.collection ||
        !inventory.context.scenes.some(scene => scene.uuid === request.sceneUuid) ||
        !inventory.context.candidates.some(input => input.uuid === request.inputUuid) ||
        requireCurrent && inventory.context.currentSceneUuid !== request.sceneUuid) throw changed();
      const member = await this.find(reader, request.sceneUuid, request.inputUuid);
      await this.collection(reader, request.collection);
      if (requireCurrent) await this.destination(reader, request.collection, request.sceneUuid);
      if (requireCurrent && reader.destinationRevision() !== destinationRevision) throw changed();
      if (!member) throw new ObsSourceRegistrationError(409, 'OBS_TEST_NOT_IN_SCENE', 'このOBSソースは対象のシーンに追加されていません。「OBSに追加」で追加してからテストしてください。');
      return { title: definition.title, valid: () => {
        try { return reader.valid() && this.resolve(request.target).identity === definition.identity; } catch { return false; }
      } };
    } catch (error) { throw sourceError(error); }
  }

  async add(value: unknown): Promise<ObsSourceOperation> {
    const request = parseObsSourceAddRequest(value);
    const previous = request.retryOperationId ? this.unfinished.get(request.retryOperationId) : undefined;
    if (request.retryOperationId && (!previous || !sameTarget(previous.operation.target, request.target) ||
      previous.operation.collection !== request.collection || previous.operation.sceneUuid !== request.sceneUuid ||
      (request.inputUuid !== undefined && request.inputUuid !== previous.operation.inputUuid))) {
      throw invalid('再試行する登録操作と対象を確認してください。');
    }
    if (!previous && [...this.unfinished.values()].some(job => sameTarget(job.operation.target, request.target) &&
      job.operation.collection === request.collection && job.operation.sceneUuid === request.sceneUuid)) {
      throw new ObsSourceRegistrationError(409, 'OBS_SOURCE_RETRY_REQUIRED', '前回の登録が未完了です。「要確認」から結果を確認して再試行してください。');
    }
    let definition: Definition;
    let lease: ReturnType<ObsControlController['acquireSourceRegistration']>;
    try {
      definition = this.resolve(request.target);
      if (this.busy) throw new ObsControlHttpError(409, 'BUSY');
      lease = this.options.obs.acquireSourceRegistration();
    } catch (error) { throw sourceError(error); }
    const job: Job = previous ?? {
      operation: {
        id: randomUUID(), target: request.target, title: definition.title, collection: request.collection,
        sceneUuid: request.sceneUuid, sceneName: '', status: 'running', phase: 'checking', result: null,
        inputUuid: null, sceneItemId: null, errorCode: null, message: 'OBSのソースと追加先を確認しています。',
      },
      definition, ownedItem: false, createdInput: false, uncertainWrite: false,
      initialTransform: null, desiredTransform: null, createdSettings: null,
    };
    this.busy = true;
    this.lastJob = job;
    job.operation.status = 'running';
    job.operation.errorCode = null;
    job.attemptHasWritten = false;
    job.attemptDestinationRevision = lease.session.destinationRevision();
    this.publish();
    try {
      if (previous && definition.identity !== previous.definition.identity) throw changed();
      const reader = this.checked(lease.session, request.target, job.definition);
      const inventory = await this.inventory(reader, request.target, job.definition);
      if (inventory.context.collection !== request.collection) throw changed();
      const scene = inventory.context.scenes.find(scene => scene.uuid === request.sceneUuid);
      if (!scene) throw changed();
      if (inventory.context.currentSceneUuid !== request.sceneUuid) {
        if (previous) throw new ObsSourceRegistrationError(409, 'OBS_SOURCE_RETRY_TARGET_CHANGED', 'OBSで前回のコレクションとシーン「' + job.operation.sceneName + '」を開いてから再試行してください。');
        throw changed();
      }
      job.operation.sceneName = scene.name;
      if (previous) await this.resume(reader, inventory, job);
      else await this.register(reader, inventory, request, job);
      job.operation.status = 'succeeded';
      job.operation.phase = 'complete';
      job.operation.errorCode = null;
      job.operation.message = job.operation.result === 'alreadyPresent'
        ? 'このシーンには追加済みです。既存の設定・配置を保持しました。'
        : 'OBSへの登録と設定・配置の確認が完了しました。映像・音声はOBSで確認してください。';
      this.unfinished.delete(job.operation.id);
    } catch (error) {
      const failure = sourceError(error);
      job.operation.status = job.uncertainWrite ? 'unknown' : job.ownedItem ? 'incomplete' : 'failed';
      job.operation.errorCode = failure.code;
      job.operation.message = failure.message + (job.ownedItem || job.uncertainWrite
        ? ' 作成済みの部分は残しています。再試行またはOBSで確認してください。' : '');
      if (job.ownedItem || job.uncertainWrite) this.unfinished.set(job.operation.id, job);
    } finally {
      this.busy = false;
      lease.release();
      this.publish();
    }
    return structuredClone(job.operation);
  }

  private resolve(target: ObsSourceTarget): Definition {
    if (this.stopped) throw new ObsSourceRegistrationError(503, 'OBS_UNAVAILABLE', 'アプリを終了中です。');
    if (target.kind === 'overlay') {
      const overlay = obsOverlayDefinitions[target.overlay];
      const input = this.options.baseUrl() + overlay.path;
      return { title: overlay.title, kind: 'browser_source', input, identity: input };
    }
    const phone = this.options.smartphone?.();
    const state = phone?.snapshot();
    const device = state?.devices.find(device => device.id === target.deviceId);
    if (!phone || !state?.available || !device?.obsLocalPort) {
      throw new ObsSourceRegistrationError(409, 'OBS_SOURCE_TARGET_UNAVAILABLE', 'スマホの登録と、端末共通のOBS入力を準備してください。');
    }
    const input = phone.obsInput(target.deviceId);
    return { title: device.name, kind: 'ffmpeg_source', input,
      identity: JSON.stringify([target.deviceId, input]) };
  }

  private checked(session: ObsSourceSession, target: ObsSourceTarget, definition: Definition): ObsSourceSession {
    const until = Date.now() + 30_000;
    const valid = () => !this.stopped && Date.now() < until && session.valid();
    const guard = () => {
      if (!valid() || this.resolve(target).identity !== definition.identity) throw changed();
    };
    return { valid, destinationRevision: () => session.destinationRevision(), request: async (type, data) => {
      guard();
      const result = await session.request(type, data);
      guard();
      return result;
    } };
  }

  private async inventory(reader: ObsSourceSession, target: ObsSourceTarget, definition: Definition, requireCurrent = true): Promise<Inventory> {
    const destinationRevision = reader.destinationRevision();
    const version = await reader.request('GetVersion');
    const availableRequests = version.availableRequests;
    if (typeof version.obsWebSocketVersion !== 'string' || !supportsUuids(version.obsWebSocketVersion) ||
      !Array.isArray(availableRequests) || requiredRequests.some(type => !availableRequests.includes(type))) {
      throw unsupported();
    }
    const kinds = await reader.request('GetInputKindList', { unversioned: true });
    if (!Array.isArray(kinds.inputKinds) || !kinds.inputKinds.includes(definition.kind)) throw unsupported();
    const collection = (await reader.request('GetSceneCollectionList')).currentSceneCollectionName;
    if (!nonempty(collection)) throw malformed();
    const studioMode = requireCurrent ? (await reader.request('GetStudioModeEnabled')).studioModeEnabled : false;
    if (typeof studioMode !== 'boolean') throw malformed();
    const sceneList = await reader.request('GetSceneList');
    const scenes = array(sceneList.scenes).map(scene => {
      if (!uuid(scene.sceneUuid) || !nonempty(scene.sceneName)) throw malformed();
      return { uuid: scene.sceneUuid, name: scene.sceneName };
    });
    const canvas = await reader.request('GetVideoSettings');
    if (!dimension(canvas.baseWidth) || !dimension(canvas.baseHeight)) throw malformed();
    const inputs = array((await reader.request('GetInputList')).inputs).map(input => {
      if (!uuid(input.inputUuid) || !nonempty(input.inputName) || !nonempty(input.unversionedInputKind ?? input.inputKind)) throw malformed();
      return { uuid: input.inputUuid, name: input.inputName, kind: String(input.unversionedInputKind ?? input.inputKind) };
    });
    const candidates: ObsSourceCandidate[] = [];
    const incompatible: ObsSourceContext['incompatible'] = [];
    const defaults = record((await reader.request('GetInputDefaultSettings', { inputKind: definition.kind })).defaultInputSettings);
    for (const input of inputs.filter(input => input.kind === definition.kind)) {
      const individual = await reader.request('GetInputSettings', { inputUuid: input.uuid });
      const settings = effectiveSettings(definition, defaults, record(individual.inputSettings));
      if ((definition.kind === 'browser_source' ? settings.url : settings.input) !== definition.input) continue;
      const reason = incompatibility(definition, settings);
      if (reason) incompatible.push({ uuid: input.uuid, name: input.name, reason });
      else candidates.push({ uuid: input.uuid, name: input.name });
    }
    const groups = (await reader.request('GetGroupList')).groups;
    if (!Array.isArray(groups) || groups.length > 2048 || groups.some(name => !nonempty(name))) throw malformed();
    const currentSceneUuid = requireCurrent ? editingScene(sceneList, studioMode) : null;
    const present = currentSceneUuid && candidates.length
      ? new Set((await this.treeItems(reader, currentSceneUuid)).map(item => item.uuid)) : new Set<string>();
    await this.collection(reader, collection);
    if (requireCurrent) await this.destination(reader, collection, currentSceneUuid!);
    if (requireCurrent && reader.destinationRevision() !== destinationRevision) throw changed();
    return {
      definition, inputs, names: new Set([...inputs.map(input => input.name), ...scenes.map(scene => scene.name), ...groups]),
      context: {
        target, title: definition.title, collection, scenes,
        currentSceneUuid,
        canvas: { width: canvas.baseWidth, height: canvas.baseHeight }, candidates, incompatible,
        presentInputUuids: candidates.filter(input => present.has(input.uuid)).map(input => input.uuid),
      },
    };
  }

  private async collection(reader: ObsSourceSession, expected: string): Promise<void> {
    if ((await reader.request('GetSceneCollectionList')).currentSceneCollectionName !== expected) throw changed();
  }

  private async destination(reader: ObsSourceSession, collection: string, sceneUuid: string): Promise<void> {
    const revision = reader.destinationRevision();
    await this.collection(reader, collection);
    const mode = (await reader.request('GetStudioModeEnabled')).studioModeEnabled;
    if (typeof mode !== 'boolean') throw malformed();
    const scenes = await reader.request('GetSceneList');
    if (editingScene(scenes, mode) !== sceneUuid || (await reader.request('GetStudioModeEnabled')).studioModeEnabled !== mode) throw changed();
    await this.collection(reader, collection);
    if (reader.destinationRevision() !== revision) throw changed();
  }

  private async items(reader: ObsSourceSession, sceneUuid: string, group = false): Promise<Item[]> {
    const data = await reader.request(group ? 'GetGroupSceneItemList' : 'GetSceneItemList', { sceneUuid });
    return array(data.sceneItems).map(item => {
      if (!Number.isSafeInteger(item.sceneItemId) || Number(item.sceneItemId) < 0 || !uuid(item.sourceUuid) ||
        (item.isGroup !== null && typeof item.isGroup !== 'boolean') || typeof item.sourceType !== 'string' ||
        typeof item.sceneItemEnabled !== 'boolean') throw malformed();
      return { id: Number(item.sceneItemId), uuid: item.sourceUuid, group: item.isGroup === true,
        scene: item.sourceType === 'OBS_SOURCE_TYPE_SCENE' };
    });
  }

  private async treeItems(reader: ObsSourceSession, sceneUuid: string, group = false,
    path: string[] = [], budget = { remaining: 2048 }): Promise<Item[]> {
    if (path.includes(sceneUuid) || path.length >= 16 || --budget.remaining < 0) throw malformed();
    const items = await this.items(reader, sceneUuid, group);
    const found: Item[] = [];
    // Inspect the entire tree even after a match, so cycles cannot become a false success.
    for (const item of items) {
      if (--budget.remaining < 0) throw malformed();
      found.push(item);
      if (item.group || item.scene) {
        found.push(...await this.treeItems(reader, item.uuid, item.group, [...path, sceneUuid], budget));
      }
    }
    return found;
  }

  private async find(reader: ObsSourceSession, sceneUuid: string, inputUuid: string): Promise<Item | null> {
    return (await this.treeItems(reader, sceneUuid)).find(item => item.uuid === inputUuid) ?? null;
  }

  private async register(reader: ObsSourceSession, inventory: Inventory, request: ObsSourceAddRequest, job: Job): Promise<void> {
    const { candidates, incompatible, canvas } = inventory.context;
    const selected = request.inputUuid ? candidates.find(input => input.uuid === request.inputUuid)
      : candidates.length === 1 ? candidates[0] : undefined;
    if (request.inputUuid && !selected) throw invalid('選択したソースはこの対象に適合しません。候補を再取得してください。');
    if (candidates.length > 1 && !selected) {
      throw new ObsSourceRegistrationError(409, 'OBS_SOURCE_SELECTION_REQUIRED', '同じ入力のソースが複数あります。使用するOBSソースを選択してください。');
    }
    if (!selected && incompatible.length > 0) {
      throw new ObsSourceRegistrationError(409, 'OBS_SOURCE_INCOMPATIBLE', '同じ入力の既存ソースの設定が適合しません。OBSで設定を確認してください。');
    }
    job.desiredTransform = placement(canvas.width, canvas.height);
    if (selected) {
      job.operation.inputUuid = selected.uuid;
      if (await this.find(reader, request.sceneUuid, selected.uuid)) {
        await this.verifyInput(reader, job);
        await this.collection(reader, request.collection);
        await this.destination(reader, request.collection, request.sceneUuid);
        if (reader.destinationRevision() !== job.attemptDestinationRevision) throw changed();
        job.operation.result = 'alreadyPresent';
        return;
      }
    } else {
      // Validate the scene tree before any write, including corrupt/cyclic nested scenes.
      await this.find(reader, request.sceneUuid, request.sceneUuid);
    }
    const beforeItems = new Set((await this.items(reader, request.sceneUuid)).map(item => item.id));
    await this.collection(reader, request.collection);
    let response: Record<string, unknown>;
    if (selected) {
      this.phase(job, 'addingItem', '既存ソースを追加先シーンへ共有しています。');
      response = await this.mutate(reader, job, 'CreateSceneItem', {
        sceneUuid: request.sceneUuid, sourceUuid: selected.uuid, sceneItemEnabled: true,
      });
    } else {
      this.phase(job, 'creatingInput', 'OBSにソースを作成しています。');
      job.createdSettings = inventory.definition.kind === 'browser_source'
        ? { is_local_file: false, url: inventory.definition.input, width: canvas.width, height: canvas.height }
        : { is_local_file: false, input: inventory.definition.input, input_format: 'mpegts', seekable: false, close_when_inactive: false };
      response = await this.mutate(reader, job, 'CreateInput', {
        sceneUuid: request.sceneUuid, inputName: unusedName('きゃすメイト ' + job.definition.title, inventory.names),
        inputKind: job.definition.kind, inputSettings: job.createdSettings, sceneItemEnabled: true,
      });
      if (!uuid(response.inputUuid) || inventory.inputs.some(input => input.uuid === response.inputUuid)) {
        job.uncertainWrite = true; throw malformed();
      }
      job.operation.inputUuid = response.inputUuid;
      job.createdInput = true;
    }
    if (!Number.isSafeInteger(response.sceneItemId) || Number(response.sceneItemId) < 0 || beforeItems.has(Number(response.sceneItemId))) {
      job.uncertainWrite = true; throw malformed();
    }
    job.operation.sceneItemId = Number(response.sceneItemId);
    job.ownedItem = true;
    job.operation.result = selected ? 'reused' : 'created';
    this.publish();
    job.initialTransform = await this.transform(reader, job);
    await this.configure(reader, job);
  }

  private async resume(reader: ObsSourceSession, inventory: Inventory, job: Job): Promise<void> {
    if (!job.ownedItem || !job.operation.inputUuid || job.operation.sceneItemId === null ||
      !job.initialTransform || !job.desiredTransform) {
      throw new ObsSourceRegistrationError(409, 'OBS_SOURCE_RESULT_UNKNOWN', '前回の作成結果や配置の所有を確認できません。OBSで確認してください。');
    }
    const direct = await this.items(reader, job.operation.sceneUuid);
    if (!direct.some(item => item.id === job.operation.sceneItemId && item.uuid === job.operation.inputUuid) ||
      !inventory.context.candidates.some(input => input.uuid === job.operation.inputUuid)) throw changed();
    await this.verifyInput(reader, job);
    const current = await this.transform(reader, job);
    if (equalTransform(current, job.desiredTransform)) {
      await this.verify(reader, job);
      job.uncertainWrite = false;
      return;
    }
    if (!equalTransform(current, job.initialTransform)) {
      throw new ObsSourceRegistrationError(409, 'OBS_SOURCE_ITEM_CHANGED', '作成後にOBSの配置が変更されています。自動で上書きせず、OBSで確認してください。');
    }
    // The acknowledged IDs and unchanged stored transform permit only the unfinished placement.
    job.uncertainWrite = false;
    await this.configure(reader, job);
  }

  private async configure(reader: ObsSourceSession, job: Job): Promise<void> {
    await this.verifyInput(reader, job);
    const current = await this.transform(reader, job);
    if (!job.initialTransform || !equalTransform(current, job.initialTransform)) throw changed();
    await this.collection(reader, job.operation.collection);
    this.phase(job, 'configuring', '新しく追加した項目の初期配置を設定しています。');
    await this.mutate(reader, job, 'SetSceneItemTransform', {
      sceneUuid: job.operation.sceneUuid, sceneItemId: job.operation.sceneItemId, sceneItemTransform: job.desiredTransform,
    });
    await this.verify(reader, job);
  }

  private async verifyInput(reader: ObsSourceSession, job: Job): Promise<void> {
    const inputUuid = job.operation.inputUuid;
    const listed = array((await reader.request('GetInputList')).inputs).find(input => input.inputUuid === inputUuid);
    if (!listed || (listed.unversionedInputKind ?? listed.inputKind) !== job.definition.kind) throw changed();
    const defaults = record((await reader.request('GetInputDefaultSettings', { inputKind: job.definition.kind })).defaultInputSettings);
    const settings = effectiveSettings(job.definition, defaults, record((await reader.request('GetInputSettings', { inputUuid })).inputSettings));
    if ((job.definition.kind === 'browser_source' ? settings.url : settings.input) !== job.definition.input ||
      incompatibility(job.definition, settings) ||
      (job.createdInput && Object.entries(job.createdSettings ?? {}).some(([key, value]) => settings[key] !== value))) throw changed();
  }

  private async transform(reader: ObsSourceSession, job: Job): Promise<Transform> {
    const items = await this.items(reader, job.operation.sceneUuid);
    if (!items.some(item => item.id === job.operation.sceneItemId && item.uuid === job.operation.inputUuid)) throw changed();
    const data = record((await reader.request('GetSceneItemTransform', {
      sceneUuid: job.operation.sceneUuid, sceneItemId: job.operation.sceneItemId,
    })).sceneItemTransform);
    if (typeof data.boundsType !== 'string' || transformNumbers.some(key => typeof data[key] !== 'number' || !Number.isFinite(data[key]))) throw malformed();
    // Computed width/height may be nonfinite for a media input which has not received frames.
    return Object.fromEntries(['boundsType', ...transformNumbers].map(key => [key, data[key]])) as Transform;
  }

  private async verify(reader: ObsSourceSession, job: Job): Promise<void> {
    this.phase(job, 'verifying', '入力・項目・保存された配置を読み戻して確認しています。');
    await this.verifyInput(reader, job);
    if (!job.desiredTransform || !equalTransform(await this.transform(reader, job), job.desiredTransform)) {
      throw new ObsSourceRegistrationError(409, 'OBS_SOURCE_PLACEMENT_UNCONFIRMED', 'OBSに保存された初期配置を確認できませんでした。');
    }
    await this.collection(reader, job.operation.collection);
  }

  private async mutate(reader: ObsSourceSession, job: Job, type: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!job.attemptHasWritten) {
      await this.destination(reader, job.operation.collection, job.operation.sceneUuid);
      if (reader.destinationRevision() !== job.attemptDestinationRevision) throw changed();
      job.attemptHasWritten = true;
    }
    job.uncertainWrite = true;
    try {
      const response = await reader.request(type, data);
      job.uncertainWrite = false;
      return response;
    } catch (error) {
      if (error instanceof ObsSourceRequestRejected) job.uncertainWrite = false;
      throw error;
    }
  }

  private phase(job: Job, phase: ObsSourceOperation['phase'], message: string): void {
    job.operation.phase = phase; job.operation.message = message; this.publish();
  }
  private publish(): void { this.options.onState?.(this.view()); }
}

function editingScene(sceneList: Record<string, unknown>, studioMode: boolean): string {
  const sceneUuid = studioMode ? sceneList.currentPreviewSceneUuid : sceneList.currentProgramSceneUuid;
  if (!uuid(sceneUuid) || !array(sceneList.scenes).some(scene => scene.sceneUuid === sceneUuid)) {
    throw new ObsSourceRegistrationError(409, 'OBS_SOURCE_SCENE_UNAVAILABLE', studioMode
      ? 'OBSのプレビューシーンを確認できません。OBSで追加先のシーンを開いてから再取得してください。'
      : 'OBSの現在のシーンを確認できません。OBSで追加先のシーンを開いてから再取得してください。');
  }
  return sceneUuid;
}

export function parseObsSourceTarget(value: unknown): ObsSourceTarget {
  if (!isRecord(value)) throw invalid();
  if (value.kind === 'overlay' && exactKeys(value, ['kind', 'overlay']) &&
    typeof value.overlay === 'string' && Object.hasOwn(obsOverlayDefinitions, value.overlay)) {
    return { kind: 'overlay', overlay: value.overlay as keyof typeof obsOverlayDefinitions };
  }
  if (value.kind === 'smartphone' && exactKeys(value, ['kind', 'deviceId']) && uuid(value.deviceId)) {
    return { kind: 'smartphone', deviceId: value.deviceId };
  }
  throw invalid();
}

export function parseObsSourceAddRequest(value: unknown): ObsSourceAddRequest {
  if (!isRecord(value) || Object.keys(value).some(key => !['target', 'collection', 'sceneUuid', 'inputUuid', 'retryOperationId'].includes(key)) ||
    !nonempty(value.collection) || !uuid(value.sceneUuid) ||
    (value.inputUuid !== undefined && !uuid(value.inputUuid)) ||
    (value.retryOperationId !== undefined && !uuid(value.retryOperationId))) throw invalid();
  return { target: parseObsSourceTarget(value.target), collection: value.collection, sceneUuid: value.sceneUuid,
    ...(value.inputUuid !== undefined ? { inputUuid: value.inputUuid } : {}),
    ...(value.retryOperationId !== undefined ? { retryOperationId: value.retryOperationId } : {}) };
}

function incompatibility(definition: Definition, settings: Record<string, unknown>): string | null {
  if (settings.is_local_file !== false) return 'ローカルファイルがONになっています。';
  if (definition.kind === 'ffmpeg_source') {
    if (settings.seekable !== false) return 'シーク可能な入力になっています。';
    if (settings.input_format !== '' && settings.input_format !== 'mpegts') return '入力形式が自動またはmpegtsではありません。';
  }
  return null;
}
function effectiveSettings(definition: Definition, defaults: Record<string, unknown>, individual: Record<string, unknown>): Record<string, unknown> {
  // OBS C getters return empty strings/false for these unregistered keys. ffmpeg registers local=true.
  return { input_format: '', seekable: false, close_when_inactive: false, is_local_file: definition.kind === 'ffmpeg_source',
    ...defaults, ...individual };
}
function placement(width: number, height: number): Transform {
  return { positionX: width / 2, positionY: height / 2, rotation: 0, scaleX: 1, scaleY: 1, alignment: 0,
    boundsAlignment: 0, boundsType: 'OBS_BOUNDS_SCALE_INNER',
    boundsWidth: width, boundsHeight: height, cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0 };
}
function equalTransform(a: Transform, b: Transform): boolean {
  return a.boundsType === b.boundsType && transformNumbers.every(key => Math.abs(a[key] - b[key]) < 0.001);
}
function unusedName(base: string, names: Set<string>): string {
  if (!names.has(base)) return base;
  for (let suffix = 2; suffix < 10_000; suffix++) {
    const name = base + ' (' + suffix + ')';
    if (!names.has(name)) return name;
  }
  throw new ObsSourceRegistrationError(409, 'OBS_SOURCE_NAME_UNAVAILABLE', 'ソース名が多数使われています。OBSの名前を整理してください。');
}
function supportsUuids(version: string): boolean {
  const parts = /^(\d+)\.(\d+)(?:\.|$)/.exec(version);
  return Boolean(parts && (Number(parts[1]) > 5 || (Number(parts[1]) === 5 && Number(parts[2]) >= 4)));
}
function uuid(value: unknown): value is string { return typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value); }
function nonempty(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0 && value.length <= 1024; }
function dimension(value: unknown): value is number { return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 16384; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function record(value: unknown): Record<string, unknown> { if (!isRecord(value)) throw malformed(); return value; }
function array(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length > 2048 || value.some(item => !isRecord(item))) throw malformed();
  return value;
}
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
}
function sameTarget(a: ObsSourceTarget, b: ObsSourceTarget): boolean {
  return a.kind === 'overlay' ? b.kind === 'overlay' && a.overlay === b.overlay
    : b.kind === 'smartphone' && a.deviceId === b.deviceId;
}
function invalid(message = '追加する表示・端末・シーンを確認してください。'): ObsSourceRegistrationError {
  return new ObsSourceRegistrationError(400, 'OBS_SOURCE_INVALID_REQUEST', message);
}
function changed(): ObsSourceRegistrationError {
  return new ObsSourceRegistrationError(409, 'OBS_SOURCE_TARGET_CHANGED', 'OBSの接続・コレクション・対象が変更されました。再取得して確認してください。');
}
function malformed(): ObsSourceRegistrationError {
  return new ObsSourceRegistrationError(503, 'OBS_SOURCE_RESPONSE_INVALID', 'OBSの応答を確認できません。OBSのバージョンとソースを確認してください。');
}
function unsupported(): ObsSourceRegistrationError {
  return new ObsSourceRegistrationError(503, 'OBS_SOURCE_UNSUPPORTED', '自動登録にはobs-websocket 5.4以上と、対象ソース・必要APIへの対応が必要です。');
}
function sourceError(error: unknown): ObsSourceRegistrationError {
  if (error instanceof ObsSourceRegistrationError) return error;
  if (error instanceof ObsControlHttpError && error.code === 'BUSY') {
    return new ObsSourceRegistrationError(409, 'BUSY', 'OBSで別の操作を処理中です。完了後に追加してください。');
  }
  if (error instanceof Error && error.message === 'OBS_SOURCE_TARGET_CHANGED') return changed();
  if (error instanceof ObsSourceRequestRejected) return new ObsSourceRegistrationError(409, 'OBS_SOURCE_REQUEST_REJECTED', 'OBSが要求を受け付けませんでした。ソースと追加先シーンを確認してください。');
  return new ObsSourceRegistrationError(503, 'OBS_UNAVAILABLE', 'OBS接続を確認してください。応答を確認できませんでした。');
}
