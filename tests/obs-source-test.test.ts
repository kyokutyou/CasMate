import { afterEach, describe, expect, it, vi } from 'vitest';
import { sourceSetup, firstScene, secondScene } from './fixtures/obs-source-registration';
import { ObsSourceTestController } from '../src/main/obs/obs-source-test-controller';
import { createDefaultSettings } from '../src/main/core/settings/schema';
import { deviceId } from './fixtures/obs-source-registration';
import { speechDesignFromSettings } from '../src/shared/obs-design';

afterEach(() => vi.useRealTimers());
async function setup() {
  const fixture = sourceSetup();
  const registered = await fixture.add();
  const request = { target: fixture.target, collection: fixture.obs.collection, sceneUuid: firstScene, inputUuid: registered.inputUuid! };
  const settings = createDefaultSettings();
  const acquire = vi.fn(() => fixture.obs.acquireSourceRegistration());
  const controller = new ObsSourceTestController({ sources: fixture.controller,
    obs: { acquireSourceTest: acquire },
    settings: () => settings, assetReadable: async () => true });
  return { ...fixture, sources: fixture.controller, controller, request, settings, acquire };
}
describe('OBS display test', () => {
  it('uses independent speech appearance in the speech display test', async () => {
    const f = await setup();
    const target = { kind: 'overlay', overlay: 'speech' } as const;
    const input = await f.add({ target });
    f.settings.commentOverlay.fontSizePx = 22;
    f.settings.speechRecognitionOverlay.fontSizePx = 65;
    f.settings.speechRecognitionOverlay.design = speechDesignFromSettings(f.settings.speechRecognitionOverlay);
    f.settings.speechRecognitionOverlay.design.style.fontSize = 70;
    try {
      await f.controller.start({ ...f.request, target, inputUuid: input.inputUuid! });
      expect(f.controller.display('speech').display?.data).toMatchObject({ kind: 'speech', appearance: { fontSizePx: 65 } });
      expect(f.controller.display('speech').display?.data.appearance).not.toHaveProperty('displayDurationSeconds');
      expect(f.controller.display('speech').display?.data.appearance).toHaveProperty('design.style.fontSize', 70);
    } finally { await f.controller.shutdown(); }
  });
  it('checks current membership without registration history or writes', async () => {
    const f = await setup();
    f.obs.calls = [];
    expect((await f.controller.context(f.request)).available).toBe(true);
    expect((await f.controller.context({ ...f.request, sceneUuid: secondScene })).available).toBe(false);
    expect(f.obs.calls.every(call => call.type.startsWith('Get'))).toBe(true);
  });
  it('expires the independent display, releases occupancy and leaves normal settings untouched', async () => {
    vi.useFakeTimers(); const f = await setup(); const before = structuredClone(f.settings);
    const operation = await f.controller.start(f.request);
    expect(f.obs.occupied).toBe(true);
    expect(f.controller.display('comments').display?.testId).toBe(operation.id);
    expect(f.controller.display('speech').display).toBeNull();
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.controller.display('comments').display).toBeNull();
    expect(f.controller.view().current?.phase).toBe('complete');
    expect(f.obs.occupied).toBe(false); expect(f.settings).toEqual(before);
  });
  it('rejects parallel starts and ignores old stop IDs', async () => {
    vi.useFakeTimers(); const f = await setup();
    const first = await f.controller.start(f.request);
    await expect(f.controller.start(f.request)).rejects.toThrow();
    await f.controller.stop(first.id);
    const second = await f.controller.start(f.request);
    await f.controller.stop(first.id);
    expect(f.controller.view().current?.id).toBe(second.id);
    expect(f.controller.view().busy).toBe(true);
    await f.controller.stop(second.id);
  });
  it('rejects extra keys and unrelated inputs', async () => {
    const f = await setup();
    await expect(f.controller.start({ ...f.request, url: 'http://evil' })).rejects.toThrow();
    await expect(f.controller.start({ ...f.request, inputUuid: '11111111-1111-4111-8111-111111111119' })).rejects.toThrow();
    expect(f.obs.occupied).toBe(false);
  });
});

it.each(['lan', 'tailscale', 'direct'] as const)('rejects smartphone tests without OBS requests or occupancy: %s', async network => {
  const f = await setup();
  const target = { kind: 'smartphone' as const, deviceId };
  f.phone.settings.activeNetwork = network;
  f.phone.devices[0].profiles[network] = { ...f.phone.devices[0].profiles.lan!, registered: true };
  const registered = await f.add({ target });
  expect(registered.status).toBe('succeeded');
  const request = { target, collection: f.obs.collection, sceneUuid: firstScene, inputUuid: registered.inputUuid };
  const registration = f.sources.view();
  f.obs.calls = [];
  await expect(f.controller.context(request)).rejects.toMatchObject({ code: 'OBS_TEST_UNSUPPORTED_TARGET', status: 400 });
  await expect(f.controller.start(request)).rejects.toMatchObject({ code: 'OBS_TEST_UNSUPPORTED_TARGET', status: 400 });
  await expect(f.sources.validateDisplayTest(request)).rejects.toMatchObject({ code: 'OBS_TEST_UNSUPPORTED_TARGET', status: 400 });
  expect(f.acquire).not.toHaveBeenCalled();
  expect(f.obs.calls).toEqual([]); expect(f.obs.occupied).toBe(false);
  expect(f.sources.view()).toEqual(registration);
  expect(f.controller.view()).toEqual({ busy: false, current: null, warnings: [] });
});

it('keeps a cancelled preparation from resurrecting its layer or changing a newer test', async () => {
  const f = await setup();
  let resolve!: (value: { title: string; valid(): boolean }) => void;
  const validation = vi.spyOn(f.sources, 'validateDisplayTest');
  validation.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const starting = f.controller.start(f.request);
  await vi.waitFor(() => expect(f.controller.view().current?.phase).toBe('preparing'));
  const firstId = f.controller.view().current!.id;
  await f.controller.stop(firstId);
  const second = await f.controller.start(f.request);
  resolve({ title: 'コメント', valid: () => true });
  expect(await starting).toMatchObject({ id: firstId, phase: 'complete', needsAttention: false });
  expect(f.controller.display('comments').display?.testId).toBe(second.id);
  expect(f.controller.view().current?.id).toBe(second.id);
  await f.controller.stop(second.id);
});

it('preserves a target-change warning through another browser test', async () => {
  vi.useFakeTimers(); const f = await setup();
  const items = [...f.obs.scene(firstScene).items];
  const first = await f.controller.start(f.request);
  f.obs.scene(firstScene).items = [];
  await vi.advanceTimersByTimeAsync(500);
  expect(f.controller.view()).toMatchObject({ busy: false, warnings: [{ id: first.id, needsAttention: true }] });
  expect(f.obs.occupied).toBe(false);
  f.obs.scene(firstScene).items = items;
  const second = await f.controller.start(f.request); await f.controller.stop(second.id);
  expect(f.controller.view().warnings).toHaveLength(1);
});


it('開始後のシーン切替でテストを延長・中断せず、元の所属を確認して5秒で終了する', async () => {
  vi.useFakeTimers(); const f = await setup(); const operation = await f.controller.start(f.request); f.obs.currentScene = secondScene;
  await vi.advanceTimersByTimeAsync(1000); expect(f.controller.view().busy).toBe(true); expect(f.controller.view().current?.expiresAt).toBe(operation.expiresAt);
  await vi.advanceTimersByTimeAsync(4000); expect(f.controller.view().busy).toBe(false); expect(f.controller.view().current?.message).toBe(''); expect(f.controller.view().warnings).toEqual([]);
});

it('最終確認のシーン読取後に切り替わると表示層を開始せず占有を解放する', async () => {
  const f = await setup(); f.obs.calls = [];
  f.obs.intercept = async type => {
    if (type === 'GetSceneCollectionList' && f.obs.calls.at(-2)?.type === 'GetStudioModeEnabled' &&
      f.obs.calls.filter(call => call.type === 'GetSceneItemList').length >= 2) f.obs.currentScene = secondScene;
  };
  await expect(f.controller.start(f.request)).rejects.toMatchObject({ code: 'OBS_SOURCE_TARGET_CHANGED' });
  expect(f.controller.display('comments').display).toBeNull(); expect(f.obs.occupied).toBe(false);
  expect(f.controller.view().current).toMatchObject({ phase: 'complete', needsAttention: true });
});

it('確認完了から表示層開始までの切替も検知し、元のシーンへ戻っても開始しない', async () => {
  const f = await setup(); const original = f.sources.validateDisplayTest.bind(f.sources); let calls = 0;
  vi.spyOn(f.sources, 'validateDisplayTest').mockImplementation(async (...args) => {
    const result = await original(...args);
    if (++calls === 2) { f.obs.currentScene = secondScene; f.obs.currentScene = firstScene; }
    return result;
  });
  await expect(f.controller.start(f.request)).rejects.toMatchObject({ code: 'OBS_SOURCE_TARGET_CHANGED' });
  expect(f.controller.display('comments').display).toBeNull(); expect(f.obs.occupied).toBe(false);
});
