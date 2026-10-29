import { randomUUID } from 'node:crypto';
import { ObsSourceRegistrationController } from '../../src/main/obs/obs-source-registration-controller';
import type { ObsSourceSession } from '../../src/main/obs/obs-control-controller';
import { ObsControlHttpError } from '../../src/main/obs/obs-control-controller';
import type { ObsSourceTarget, ObsSourceRegistrationState } from '../../src/shared/obs-source-registration';
import type { SmartphoneView } from '../../src/shared/smartphone';
import { smartphoneView } from './smartphone-view';

export const firstScene = '11111111-1111-4111-8111-111111111110';
export const secondScene = '11111111-1111-4111-8111-111111111112';
export const deviceId = smartphoneView.devices[0].id;
export const defaultTransform = {
  positionX: 0, positionY: 0, rotation: 0, scaleX: 1, scaleY: 1, alignment: 5, boundsAlignment: 0,
  boundsType: 'OBS_BOUNDS_NONE', boundsWidth: 0, boundsHeight: 0, cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0,
};
const requests = [
  'GetVersion', 'GetInputKindList', 'GetInputList', 'GetInputSettings', 'GetInputDefaultSettings',
  'GetSceneCollectionList', 'GetSceneList', 'GetStudioModeEnabled', 'GetGroupList', 'GetSceneItemList', 'GetGroupSceneItemList',
  'GetSceneItemTransform', 'GetVideoSettings', 'CreateInput', 'CreateSceneItem', 'SetSceneItemTransform',
];
export interface FakeSourceInput { uuid: string; name: string; kind: string; settings: Record<string, unknown> }
export interface FakeSourceItem {
  id: number; uuid: string; enabled: boolean; group: boolean; nested: boolean; transform: Record<string, unknown>;
}
export interface FakeSourceScene { uuid: string; name: string; group: boolean; items: FakeSourceItem[] }

export class FakeSourceObs {
  collection = '配信';
  version = '5.4.0';
  availableRequests = [...requests];
  inputKinds = ['browser_source', 'ffmpeg_source'];
  generation = 1;
  occupied = false;
  connected = true;
  destinationRevision = 0;
  private program = firstScene;
  private studio = false;
  private preview: string | null = secondScene;
  get currentScene() { return this.program; }
  set currentScene(value: string) { if (this.program !== value) this.destinationRevision++; this.program = value; }
  get studioMode() { return this.studio; }
  set studioMode(value: boolean) { if (this.studio !== value) this.destinationRevision++; this.studio = value; }
  get previewScene() { return this.preview; }
  set previewScene(value: string | null) { if (this.preview !== value) this.destinationRevision++; this.preview = value; }
  baseWidth = 1920;
  baseHeight = 1080;
  inputs: FakeSourceInput[] = [];
  scenes: FakeSourceScene[] = [
    { uuid: firstScene, name: '本番', group: false, items: [] },
    { uuid: secondScene, name: '予備', group: false, items: [] },
  ];
  calls: Array<{ type: string; data?: Record<string, unknown> }> = [];
  defaults: Record<string, Record<string, unknown>> = {
    browser_source: { is_local_file: false, width: 800, height: 600 },
    ffmpeg_source: { is_local_file: true },
  };
  failures: Array<{ type: string; error: Error; after?: boolean }> = [];
  intercept?: (type: string, data?: Record<string, unknown>) => Promise<void>;
  private nextItem = 1;

  sourceReader = (): ObsSourceSession => this.session();
  acquireSourceRegistration = () => {
    if (this.occupied) throw new ObsControlHttpError(409, 'BUSY');
    if (!this.connected) throw new Error('OBS_UNAVAILABLE');
    this.occupied = true;
    let released = false;
    const session = this.session(() => !released);
    return { session, release: () => { if (released) return; released = true; this.occupied = false; } };
  };
  private session(active = () => true): ObsSourceSession {
    const generation = this.generation;
    return { valid: () => this.connected && this.generation === generation && active(),
      destinationRevision: () => this.destinationRevision,
      request: (type, data) => this.request(type, data) };
  }

  input(kind: string, settings: Record<string, unknown>, name = '手動ソース'): FakeSourceInput {
    const input = { uuid: randomUUID(), name, kind, settings: structuredClone(settings) };
    this.inputs.push(input); return input;
  }
  item(sceneUuid: string, uuid: string, options: Partial<FakeSourceItem> = {}): FakeSourceItem {
    const item: FakeSourceItem = { id: this.nextItem++, uuid, enabled: true, group: false, nested: false,
      transform: { ...defaultTransform }, ...options };
    this.scene(sceneUuid).items.push(item); return item;
  }
  scene(uuid: string): FakeSourceScene {
    const scene = this.scenes.find(scene => scene.uuid === uuid);
    if (!scene) throw new Error('missing scene'); return scene;
  }
  async request(type: string, data?: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.calls.push({ type, data: data ? structuredClone(data) : undefined });
    await this.intercept?.(type, data);
    const failureIndex = this.failures.findIndex(failure => failure.type === type);
    const failure = failureIndex >= 0 ? this.failures.splice(failureIndex, 1)[0] : undefined;
    if (failure && !failure.after) throw failure.error;
    const value = this.response(type, data ?? {});
    if (failure) throw failure.error;
    return value;
  }
  private response(type: string, data: Record<string, unknown>): Record<string, unknown> {
    if (type === 'GetVersion') return { obsWebSocketVersion: this.version, availableRequests: this.availableRequests };
    if (type === 'GetInputKindList') return { inputKinds: this.inputKinds };
    if (type === 'GetSceneCollectionList') return { currentSceneCollectionName: this.collection };
    if (type === 'GetStudioModeEnabled') return { studioModeEnabled: this.studioMode };
    if (type === 'GetSceneList') return { currentProgramSceneUuid: this.currentScene, currentPreviewSceneUuid: this.studioMode ? this.previewScene : null,
      scenes: this.scenes.filter(scene => !scene.group).map(scene => ({ sceneUuid: scene.uuid, sceneName: scene.name })) };
    if (type === 'GetVideoSettings') return { baseWidth: this.baseWidth, baseHeight: this.baseHeight, outputWidth: 1280, outputHeight: 720 };
    if (type === 'GetGroupList') return { groups: this.scenes.filter(scene => scene.group).map(scene => scene.name) };
    if (type === 'GetInputList') return { inputs: this.inputs.map(input => ({
      inputUuid: input.uuid, inputName: input.name, inputKind: input.kind, unversionedInputKind: input.kind,
    })) };
    if (type === 'GetInputDefaultSettings') return { defaultInputSettings: this.defaults[String(data.inputKind)] ?? {} };
    if (type === 'GetInputSettings') {
      const input = this.inputs.find(input => input.uuid === data.inputUuid);
      if (!input) throw new Error('missing input');
      return { inputKind: input.kind, inputSettings: structuredClone(input.settings) };
    }
    if (type === 'GetSceneItemList' || type === 'GetGroupSceneItemList') return { sceneItems: this.scene(String(data.sceneUuid)).items.map(item => ({
      sceneItemId: item.id, sourceUuid: item.uuid, sourceName: this.inputs.find(input => input.uuid === item.uuid)?.name ?? 'scene',
      sourceType: item.nested || item.group ? 'OBS_SOURCE_TYPE_SCENE' : 'OBS_SOURCE_TYPE_INPUT',
      isGroup: item.group || item.nested ? item.group : null, sceneItemEnabled: item.enabled,
    })) };
    if (type === 'GetSceneItemTransform') {
      const item = this.scene(String(data.sceneUuid)).items.find(item => item.id === data.sceneItemId);
      if (!item) throw new Error('missing item');
      return { sceneItemTransform: { ...item.transform, width: null, height: null, sourceWidth: 0, sourceHeight: 0 } };
    }
    if (type === 'CreateInput') {
      const input = this.input(String(data.inputKind), record(data.inputSettings), String(data.inputName));
      const item = this.item(String(data.sceneUuid), input.uuid);
      return { inputUuid: input.uuid, sceneItemId: item.id };
    }
    if (type === 'CreateSceneItem') return { sceneItemId: this.item(String(data.sceneUuid), String(data.sourceUuid)).id };
    if (type === 'SetSceneItemTransform') {
      const item = this.scene(String(data.sceneUuid)).items.find(item => item.id === data.sceneItemId);
      if (!item) throw new Error('missing item');
      Object.assign(item.transform, record(data.sceneItemTransform)); return {};
    }
    throw new Error('unexpected request ' + type);
  }
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected record');
  return value as Record<string, unknown>;
}
export function sourceSetup(obs = new FakeSourceObs()) {
  const states: ObsSourceRegistrationState[] = [];
  const phone: SmartphoneView = structuredClone(smartphoneView);
  phone.devices.push({ ...structuredClone(phone.devices[0]), id: '11111111-1111-4111-8111-111111111113', name: 'スマホB', obsLocalPort: 12001 });
  const controller = new ObsSourceRegistrationController({
    obs, baseUrl: () => 'http://127.0.0.1:3100', onState: state => states.push(state),
    smartphone: () => ({
      snapshot: () => structuredClone(phone),
      obsInput: id => 'udp://127.0.0.1:' + phone.devices.find(device => device.id === id)?.obsLocalPort +
        '?localaddr=127.0.0.1&fifo_size=1024&overrun_nonfatal=1',
    }),
  });
  const target: ObsSourceTarget = { kind: 'overlay', overlay: 'comments' };
  return { controller, obs, phone, states, target,
    add: (overrides: Record<string, unknown> = {}) => controller.add({ target, collection: obs.collection, sceneUuid: firstScene, ...overrides }) };
}
