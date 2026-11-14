import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { ObsControlController } from '../src/main/obs/obs-control-controller';
import { defaultObsControlSettings, type ObsControlRecord } from '../src/main/obs/obs-control-store';
import { ObsVisual } from '../src/main/obs/obs-visual';
import type { ObsWebsocketConnection, ObsWebsocketEvent } from '../src/main/obs/obs-websocket-client';
import { ReactionController, type ReactionDesktop } from '../src/main/reactions/reaction-controller';
import { ReactionFrames } from '../src/main/reactions/reaction-frames';
import { defaultReactionSettings, type ReactionSettings, type ReactionWindow } from '../src/shared/listener-reactions';

const imageData = `data:image/jpeg;base64,${readFileSync(new URL('./fixtures/obs-program-black.jpg', import.meta.url)).toString('base64')}`;
const target: ReactionWindow = { id:'1', pid:123, title:'game', processName:'game.exe', className:'Game', x:100, y:200, width:640, height:360, minimized:false };
const transform = { positionX:0, positionY:0, sourceWidth:32, sourceHeight:18, scaleX:1, scaleY:1, rotation:0, alignment:5, cropLeft:0, cropTop:0, cropRight:0, cropBottom:0, cropToBounds:false, boundsType:'OBS_BOUNDS_NONE' };
const entireImage = { x:0,y:0,width:1,height:1 };
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  try { for (const close of cleanup.splice(0)) await close(); }
  finally { vi.restoreAllMocks(); vi.useRealTimers(); }
});

async function fixture(online = true, monitor = false) {
  vi.useFakeTimers();
  let now = 100000, scene = 'A', saved = defaultReactionSettings();
  let wallOffset = 0;
  let listener: ((event: ObsWebsocketEvent) => void) | undefined;
  const state: {
    collection: string;
    shots: string[];
    blocked: boolean;
    intercept?: (type: string, data?: Record<string, unknown>) => Promise<Record<string, unknown>> | undefined;
  } = { collection:'original', shots:[], blocked:false };
  const emit = (eventType: string, eventData?: Record<string,unknown>) => listener?.({ eventType,eventData });
  const notify = (name?: string) => emit('CurrentProgramSceneChanged', name ? { sceneName:name, sceneUuid:`id-${name}` } : {});
  const change = (name: string, event = true) => { scene = name; if (event) notify(name); };
  const answer = async (type: string, data?: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const intercept = state.intercept?.(type, data);
    if (intercept) return intercept;
    switch (type) {
      case 'GetCurrentProgramScene': return { currentProgramSceneName:scene, currentProgramSceneUuid:`id-${scene}` };
      case 'GetSceneCollectionList': return { currentSceneCollectionName:state.collection };
      case 'GetVideoSettings': return { baseWidth:32, baseHeight:18 };
      case 'GetVersion': return { supportedImageFormats:['jpg'] };
      case 'GetSourceScreenshot':
        state.shots.push(scene);
        if (state.blocked) throw new Error('BUSY');
        return { imageData };
      case 'GetSceneItemList': return { sceneItems: data?.sceneName === 'B'
        ? [{ sourceName:'camera', sceneItemId:2, inputKind:'dshow_input', sceneItemEnabled:true }]
        : [{ sourceName:'game', sourceUuid:'game-id', sceneItemId:7, inputKind:monitor ? 'monitor_capture' : 'window_capture', sceneItemEnabled:true, sceneItemTransform:transform }] };
      case 'GetInputSettings': return { inputSettings:monitor ? { monitor_id:'one' } : { window:'game:Game:game.exe' } };
      case 'GetSourceFilterList': return { filters:[] };
      default: throw new Error(type);
    }
  };
  const ok = { requestStatus:{ result:true, code:100 } };
  const connection: ObsWebsocketConnection = {
    request: async (type,data) => ({ ...ok, responseData:await answer(type,data) }),
    subscribe: subscribe => { listener = subscribe; return () => { listener = undefined; }; },
    onDisconnect: () => () => undefined,
    close: async () => undefined,
    getStreamStatus: async () => ({ outputActive:false, outputState:'OBS_WEBSOCKET_OUTPUT_STOPPED' }),
    startStream: async () => ok,
    stopStream: async () => ok,
  };
  const record: ObsControlRecord = { version:1, settings:{ ...defaultObsControlSettings(), enabled:true }, registration:null };
  const obs = new ObsControlController({
    store:{ load:async () => record, save:async () => undefined, resetNotice:null }, transport:{ connect:async () => connection }, now:() => now + wallOffset, monotonicNow:() => now,
    onReactionContextChanged:(type,data) => controller.obsChanged(type,data),
  });
  const read = () => obs.visualReader('background','reaction');
  const display = { ...target, id:'display:one', pid:0, title:'one', processName:'@display', className:'@display', width:32, height:18 };
  const inventory: ReturnType<ReactionDesktop['inventory']> = { windows:[monitor ? display : { ...target }], foreground:target.id, observedAt:now };
  const desktop: ReactionDesktop = {
    inventory:() => inventory, demand:vi.fn(), prepare:vi.fn(async () => undefined), render:vi.fn(),
    marker:vi.fn(), reaction:vi.fn(), clear:vi.fn(), close:vi.fn(),
  };
  const store = { load:async () => saved, save:vi.fn(async (settings: ReactionSettings) => { saved = settings; }) };
  const frames = new ReactionFrames(read,() => now + wallOffset,() => now);
  const controller = new ReactionController(store,frames,read,desktop,() => now + wallOffset);
  cleanup.push(() => controller.shutdown(), () => obs.stop());
  await obs.start(); await obs.retry(); await controller.initialize();
  await frames.tick();
  const view = () => controller.view({ status:online ? 'online' : 'off', url:null, message:'' });
  const elapseWithoutTimers = (ms: number, freshInventory: boolean) => {
    now += ms;
    if (!freshInventory) return;
    inventory.observedAt = now + wallOffset;
    if (inventory.observedMonotonicAt !== undefined) inventory.observedMonotonicAt = now;
  };
  const changeWallTime = (offset: number) => {
    inventory.observedMonotonicAt ??= inventory.observedAt - wallOffset;
    wallOffset += offset;
  };
  const advance = async (ms: number, freshInventory = true) => {
    for (let remaining = ms; remaining > 0;) {
      const step = Math.min(remaining,250);
      remaining -= step;
      elapseWithoutTimers(step,freshInventory);
      await vi.advanceTimersByTimeAsync(step);
    }
  };
  if (online) {
    await controller.configurePublishStart(true);
    controller.setOnline(true); controller.preparePublishStart()();
    await vi.advanceTimersByTimeAsync(0);
  } else {
    await controller.detect(target.id); await controller.startDesktop();
  }
  expect(view().desktop).toMatchObject({ enabled:true, showing:true });
  const park = async () => {
    change('B'); await advance(2000);
    expect(view().desktop).toMatchObject({ enabled:false, preparing:false, resume:'scene' });
  };
  return { state, obs, frames, controller, view, advance, elapseWithoutTimers, changeWallTime, notify, emit, change, park, store, inventory, desktop };
}

it.each([true,false])('recovers from a camera-only scene after a missed return notification (published=%s)', async online => {
  const f = await fixture(online);
  await f.park();
  f.change('A',false);
  await f.advance(3000);
  expect(f.view().desktop).toMatchObject({ enabled:true, showing:true });
  expect(f.view().settings.binding?.scene).toBe('A');
  expect(f.controller.publicView().accepting).toBe(online);
});

it.each(['InputSettingsChanged', 'SourceFilterEnableStateChanged'] as const)('keeps the camera-only preview and public JPEG available during repeated %s events', async event => {
  const f = await fixture();
  await f.park();
  const first = f.view().frame!;
  for (let index = 0; index < 4; index++) {
    const frame = f.controller.publicView().frame!;
    f.emit(event, { inputName:'character', sourceName:'character', sourceUuid:'character-id' });
    expect(f.controller.publicView().frame).toMatchObject({ id:frame.id, generation:first.generation });
    expect(f.view().frame?.id).toBe(frame.id);
    expect(f.frames.get(frame.id)).not.toBeNull();
    await f.advance(1000);
  }
  expect(f.view().desktop).toMatchObject(waiting);
  expect(f.view().frame?.id).not.toBe(first.id);
});

it('keeps publishing the same scene through recovery probes and resumes when a compatible capture appears', async () => {
  const f = await fixture();
  await f.park();
  const generation = f.frames.generation;
  const camera = { sourceName:'camera', sceneItemId:2, inputKind:'dshow_input', sceneItemEnabled:true };
  const decoration = { sourceName:'decoration', sceneItemId:3, isGroup:true, sceneItemEnabled:true };
  let items = [camera, decoration];
  f.state.intercept = (type, data) => {
    if (type === 'GetSceneItemList' && data?.sceneName === 'B') return Promise.resolve({ sceneItems:items });
    if (type === 'GetGroupSceneItemList' && data?.sceneName === decoration.sourceName) return Promise.resolve({ sceneItems:[] });
    return undefined;
  };
  await f.advance(3500);
  expect(f.view().desktop).toMatchObject(waiting);
  expect(f.view().frame?.generation).toBe(generation);
  expect(f.controller.publicView().frame?.generation).toBe(generation);

  items = [camera, { ...windowItem, isGroup:false }];
  await f.advance(3500);
  expect(f.view().desktop).toMatchObject({ enabled:true, showing:true });
  expect(f.view().settings.binding?.scene).toBe('B');
  expect(f.controller.publicView().frame?.generation).toBe(generation);
});

it.each([false, true])('recovers without notification when the OBS item count returns to the limit (nested=%s)', async nested => {
  const f = await fixture(false);
  const capture = { sourceName:'game', sourceUuid:'game-id', sceneItemId:7, inputKind:'window_capture', sceneItemEnabled:true, sceneItemTransform:transform };
  const group = { sourceName:'extras', sceneItemId:8, isGroup:true, sceneItemEnabled:true };
  const decorations = Array.from({ length:nested ? 63 : 64 }, (_, index) => ({ sourceName:`text ${index}`, sceneItemId:100 + index, inputKind:'text_gdiplus', sceneItemEnabled:true }));
  f.state.intercept = (type, data) => {
    if (type === 'GetSceneItemList' && data?.sceneName === 'C') return Promise.resolve({ sceneItems:nested ? [capture, group] : [capture, ...decorations] });
    if (type === 'GetGroupSceneItemList' && data?.sceneName === 'extras') return Promise.resolve({ sceneItems:decorations });
    return undefined;
  };
  f.change('C', false);
  await f.advance(3000);
  expect(f.view().desktop).toMatchObject({ enabled:false, resume:'scene', message:expect.stringContaining('対象数') });

  decorations.pop();
  await f.advance(3500);
  expect(f.view().desktop).toMatchObject({ enabled:true, showing:true });
  expect(f.view().settings.binding?.scene).toBe('C');
});

it('continues offline program checks and capture after the wall clock moves backwards', async () => {
  const f = await fixture(false);
  await f.advance(9000);
  const beforeClockChange = f.view().frame?.capturedAt;
  expect(beforeClockChange).toBe(108000);

  f.changeWallTime(-60000);
  await f.advance(250,false);
  expect(f.view().desktop).toMatchObject({ enabled:true,showing:true });
  f.change('C',false);
  await f.advance(3500);

  expect(f.view().desktop).toMatchObject({ enabled:true,showing:true });
  expect(f.view().settings.binding?.scene).toBe('C');
  expect(f.view().frame?.capturedAt).toBeLessThan(beforeClockChange!);
});

it.each([[7999,true],[8000,true],[8001,false]] as const)('checks initial publication inputs received at %dms against the inclusive input deadline', async (offset, starts) => {
  const f = await fixture();
  const attemptStartedAt = f.inventory.observedAt;
  f.controller.setOnline(false);
  f.inventory.observedAt = 0;
  f.controller.setOnline(true);
  f.controller.preparePublishStart()();
  expect(f.view().desktop).toMatchObject({ enabled:false,preparing:true });

  // Let the input-deadline check run before delivering the inventory at 8000ms.
  await f.advance(offset,false);
  f.inventory.observedAt = attemptStartedAt + offset;
  await f.advance(1000,false);

  expect(f.view().desktop).toMatchObject({ enabled:starts,showing:starts,preparing:false });
  expect(f.controller.publicView().accepting).toBe(true);
});

it('keeps timely image evidence when a newer image arrives before the input-deadline check', async () => {
  const f = await fixture();
  const attemptStartedAt = f.inventory.observedAt;
  f.controller.setOnline(false);
  f.inventory.observedAt = 0;
  f.controller.setOnline(true);
  f.controller.preparePublishStart()();

  await f.advance(8000,false);
  const atDeadline = f.controller.publicView().frame;
  expect(atDeadline?.capturedAt).toBe(attemptStartedAt + 8000);
  f.inventory.observedAt = attemptStartedAt + 8000;
  f.elapseWithoutTimers(100,false);
  await f.frames.tick();
  await vi.advanceTimersByTimeAsync(0);

  expect(f.controller.publicView().frame?.capturedAt).toBe(attemptStartedAt + 8100);
  expect(f.view().desktop).toMatchObject({ enabled:true,showing:true,preparing:false });
});

const windowItem = { sourceName:'game',sourceUuid:'game-id',sceneItemId:7,inputKind:'window_capture',sceneItemEnabled:true,sceneItemTransform:transform };
const waiting = { enabled:false,showing:false,preparing:false,resume:'scene' } as const;

it.each(['resize','reopen'])('recovers when a window can fit the configured margins after %s', async recovery => {
  const f = await fixture();
  await f.controller.update({ ...f.view().settings, insets:{ left:12,right:12,top:0,bottom:0 } });
  f.inventory.windows[0].width = 20;
  f.change('C');
  await f.advance(2500);
  expect(f.view().desktop).toMatchObject({ ...waiting,message:expect.stringContaining('範囲が不正') });
  f.inventory.windows[0].x++;
  await f.advance(3000);
  expect(f.view().desktop).toMatchObject(waiting);
  if (recovery === 'reopen') {
    f.inventory.windows = [{ ...target,id:'2',pid:456,title:'another window' }];
    await f.advance(1500);
    expect(f.view().desktop).toMatchObject(waiting);
    f.inventory.windows = [{ ...target,id:'3',pid:789 }];
  } else f.inventory.windows[0].width = target.width;
  await f.advance(3000);
  expect(f.view().desktop).toMatchObject({ enabled:true,showing:true });
  expect(f.view().settings.binding?.scene).toBe('C');
});

it('recovers when only the OBS scale of an oversized desktop overlay is corrected', async () => {
  const f = await fixture(false);
  let scale = 1 / 64;
  f.state.intercept = (type,data) => type === 'GetSceneItemList' && data?.sceneName === 'C'
    ? Promise.resolve({ sceneItems:[{ ...windowItem, sceneItemTransform:{ ...transform,scaleX:scale,scaleY:scale } }] })
    : undefined;
  f.change('C');
  await f.advance(2500);
  expect(f.view().desktop).toMatchObject({ ...waiting,message:expect.stringContaining('大きすぎ') });
  expect(f.view().settings.binding?.scene).toBe('A');

  scale = 1;
  await f.advance(4500);

  expect(f.view().desktop).toMatchObject({ enabled:true,showing:true });
  expect(f.view().settings.binding?.scene).toBe('C');
  expect(f.view().settings.region).toEqual(entireImage);
});

it('recovers only the latest scene after two attempts time out behind a write', async () => {
  const f = await fixture();
  const save = f.store.save.getMockImplementation()!;
  let release!: () => void;
  f.store.save.mockImplementationOnce(async settings => {
    await new Promise<void>(resolve => { release = resolve; });
    await save(settings);
  });
  f.change('C');
  await f.advance(18500);
  expect(release).toBeTypeOf('function');
  expect(f.view().desktop).toMatchObject(waiting);
  f.change('D');
  await f.advance(18500);
  expect(f.view().desktop).toMatchObject(waiting);
  release();
  await f.advance(3500);
  expect(f.view().desktop).toMatchObject({ enabled:true,showing:true });
  expect(f.view().settings.binding?.scene).toBe('D');
  expect(f.store.save.mock.calls.map(([settings]) => settings.binding?.scene).slice(-3)).toEqual(['C','A','D']);
});

it.each(['image','write'])('recovers after image expiry and a pending write when the %s returns first', async first => {
  const f = await fixture();
  const save = f.store.save.getMockImplementation()!;
  let release!: () => void;
  f.store.save.mockImplementationOnce(async settings => {
    await new Promise<void>(resolve => { release = resolve; });
    await save(settings);
  });
  f.change('C');
  await f.advance(2000);
  expect(release).toBeTypeOf('function');
  f.state.blocked = true;
  await f.advance(18000);
  expect(f.view().desktop).toMatchObject(waiting);
  expect(f.view().frame).toBeNull();
  expect(f.view().settings.binding?.scene).toBe('A');

  if (first === 'image') f.state.blocked = false;
  else release();
  await f.advance(3000);
  expect(f.view().desktop).toMatchObject({ enabled:false,showing:false });
  expect(f.view().settings.binding?.scene).toBe('A');
  expect(f.view().frame !== null).toBe(first === 'image');

  if (first === 'image') release();
  else f.state.blocked = false;
  await f.advance(4500);
  expect(f.view().desktop).toMatchObject({ enabled:true,showing:true });
  expect(f.view().settings.binding?.scene).toBe('C');
  expect(f.store.save.mock.calls.map(([settings]) => settings.binding?.scene).slice(-3)).toEqual(['C','A','C']);
});

it.each([
  ['native',15999], ['native',16000], ['native',16001],
  ['write',15999], ['write',16000], ['write',16001],
] as const)('checks %s completion at %dms even when the expiry timer has not run', async (operation, offset) => {
  const f = await fixture();
  const save = f.store.save.getMockImplementation()!;
  let release!: () => void;
  const hold = () => new Promise<void>(resolve => { release = resolve; });
  if (operation === 'native') vi.mocked(f.desktop.prepare).mockImplementationOnce(hold);
  else f.store.save.mockImplementationOnce(async settings => { await hold(); await save(settings); });
  f.store.save.mockClear();
  f.inventory.observedAt = 0;
  f.change('C',false);
  await f.frames.tick();
  // A fresh inventory near the input deadline leaves the selected image valid
  // at the total deadline, isolating the total deadline from image expiry.
  await f.advance(7000,false);
  await f.advance(250);
  expect(release).toBeTypeOf('function');
  await f.advance(7750);
  expect(f.view().settings.binding?.scene).toBe('A');

  f.elapseWithoutTimers(offset - 15000,true);
  release();
  await vi.advanceTimersByTimeAsync(0);

  const starts = offset < 16000;
  expect(f.view().desktop).toMatchObject({ enabled:starts,showing:starts });
  expect(f.view().settings.binding?.scene).toBe(starts ? 'C' : 'A');
  const writes = f.store.save.mock.calls.map(([settings]) => settings.binding?.scene);
  expect(writes).toEqual(starts ? ['C'] : operation === 'write' ? ['C','A'] : []);
});

it('rechecks OBS when the final pre-save read completes at the total deadline before the timer', async () => {
  const f = await fixture();
  let captureReady = false;
  let release!: () => void;
  vi.mocked(f.desktop.prepare).mockImplementationOnce(async () => { captureReady = true; });
  f.state.intercept = type => {
    if (!captureReady || type !== 'GetVideoSettings') return undefined;
    captureReady = false;
    return new Promise(resolve => { release = () => resolve({ baseWidth:32,baseHeight:18 }); });
  };
  f.store.save.mockClear();
  f.inventory.observedAt = 0;
  f.change('C',false);
  await f.frames.tick();
  await f.advance(7000,false);
  await f.advance(250);
  expect(release).toBeTypeOf('function');
  await f.advance(7750);

  f.elapseWithoutTimers(1000,true);
  release();
  await vi.advanceTimersByTimeAsync(0);
  expect(f.view().desktop).toMatchObject(waiting);
  expect(f.store.save).not.toHaveBeenCalled();

  await f.advance(4500);
  expect(f.view().desktop).toMatchObject({ enabled:true,showing:true });
  expect(f.view().settings.binding?.scene).toBe('C');
  expect(f.store.save.mock.calls.map(([settings]) => settings.binding?.scene)).toEqual(['C']);
});

it('restores a stale automatic write before saving a confirmed manual range', async () => {
  const f = await fixture();
  const save = f.store.save.getMockImplementation()!;
  let release!: () => void;
  f.store.save.mockImplementationOnce(async settings => {
    await new Promise<void>(resolve => { release = resolve; });
    await save(settings);
  });
  f.store.save.mockClear();
  f.change('C');
  await f.advance(2000);
  expect(release).toBeTypeOf('function');
  const region = { x:.125,y:.125,width:.75,height:.75 };
  const editing = f.controller.update({ ...f.view().settings,region });
  release();
  await editing;

  const writes = f.store.save.mock.calls.map(([settings]) => [settings.binding?.scene,settings.region]);
  expect(writes).toEqual([['C',entireImage],['A',entireImage],[undefined,region]]);
  expect(f.view().settings).toMatchObject({ region,binding:null });
  expect(f.view().desktop).toMatchObject({ enabled:false,showing:false });
});

it('recovers when a cyclic scene reference is removed without switching scenes', async () => {
  const f = await fixture();
  let cyclic = true;
  f.state.intercept = (type,data) => type === 'GetSceneItemList' && data?.sceneName === 'C' && cyclic
    ? Promise.resolve({ sceneItems:[windowItem,{ sourceName:'C',sceneItemId:8,sourceType:'OBS_SOURCE_TYPE_SCENE',sceneItemEnabled:true }] })
    : undefined;
  f.change('C');
  await f.advance(2500);
  expect(f.view().desktop).toMatchObject({ ...waiting,message:expect.stringContaining('循環') });
  cyclic = false;
  await f.advance(3500);
  expect(f.view().desktop).toMatchObject({ enabled:true,showing:true });
});

it('recovers the pinned monitor when its capture returns after only window capture remained', async () => {
  const f = await fixture(true,true);
  f.inventory.windows.push({ ...target });
  f.state.intercept = (type,data) => {
    if (type === 'GetSceneItemList' && data?.sceneName === 'A') return Promise.resolve({ sceneItems:[windowItem] });
    if (type === 'GetInputSettings') return Promise.resolve({ inputSettings:{ window:'game:Game:game.exe' } });
    return undefined;
  };
  f.emit('SceneItemEnableStateChanged', { sceneName:'A',sceneItemId:7,sceneItemEnabled:false });
  await f.advance(18500);
  expect(f.view().desktop).toMatchObject(waiting);
  expect(f.view().settings.target?.title).toBe('one');
  f.state.intercept = undefined;
  await f.advance(3500);
  expect(f.view().desktop).toMatchObject({ enabled:true,showing:true });
  expect(f.view().selectedId).toBe('display:one');
});

it('recovers the pinned monitor when the window inventory expires during a range save', async () => {
  const f = await fixture(true,true);
  const save = f.store.save.getMockImplementation()!;
  let release!: () => void;
  f.store.save.mockImplementationOnce(async settings => {
    await new Promise<void>(resolve => { release = resolve; });
    await save(settings);
  });
  f.change('C');
  await f.advance(2000);
  expect(release).toBeTypeOf('function');

  const last = f.inventory.observedAt;
  vi.spyOn(f.desktop, 'inventory').mockImplementation(() => f.inventory.observedAt === last
    ? { ...f.inventory, windows:[], foreground:'' } : f.inventory);
  f.elapseWithoutTimers(1500,false);
  release();
  await vi.advanceTimersByTimeAsync(0);
  expect(f.view().desktop.message).not.toContain('対象モニターが切断');
  expect(f.view().settings.binding?.scene).toBe('A');

  await f.advance(3500);
  expect(f.view().desktop).toMatchObject({ enabled:true,showing:true });
  expect(f.view().selectedId).toBe('display:one');
  expect(f.view().settings.binding?.scene).toBe('C');
});

it('keeps the original monitor pinned after following a window in another scene', async () => {
  const f = await fixture(true,true);
  const original = f.inventory.windows[0];
  f.inventory.windows.push({ ...target },{ ...original,id:'display:two',title:'two' });
  let monitorId = 'two';
  f.state.intercept = (type,data) => {
    if (type === 'GetSceneItemList' && data?.sceneName === 'B') {
      return Promise.resolve({ sceneItems:[{ ...windowItem,sourceName:'window',sourceUuid:'window-id' }] });
    }
    if (type === 'GetSceneItemList' && data?.sceneName === 'C') {
      return Promise.resolve({ sceneItems:[{ ...windowItem,sourceName:'monitor',sourceUuid:'monitor-id',inputKind:'monitor_capture' }] });
    }
    if (type === 'GetInputSettings' && data?.inputName === 'window') return Promise.resolve({ inputSettings:{ window:'game:Game:game.exe' } });
    if (type === 'GetInputSettings' && data?.inputName === 'monitor') return Promise.resolve({ inputSettings:{ monitor_id:monitorId } });
    return undefined;
  };
  f.change('B');
  await f.advance(2500);
  expect(f.view().desktop).toMatchObject({ enabled:true,showing:true });
  expect(f.view().selectedId).toBe(target.id);

  f.change('C');
  await f.advance(3500);
  expect(f.view().desktop).toMatchObject(waiting);
  expect(f.view().settings.binding?.scene).toBe('B');
  expect(f.store.save.mock.calls.map(([settings]) => settings.target?.title)).not.toContain('two');

  monitorId = 'one';
  await f.advance(4500);
  expect(f.view().desktop).toMatchObject({ enabled:true,showing:true });
  expect(f.view().selectedId).toBe(original.id);
  expect(f.view().settings.binding?.scene).toBe('C');
});

it('recovers after the pre-save OBS check repeatedly fails after native preparation', async () => {
  const f = await fixture();
  let failCheck = false;
  vi.mocked(f.desktop.prepare).mockImplementation(async () => { failCheck = true; });
  f.state.intercept = type => {
    if (type !== 'GetCurrentProgramScene' || !failCheck) return;
    failCheck = false;
    return Promise.reject(new Error('OBS_VISUAL_UNAVAILABLE'));
  };
  f.change('C');
  await f.advance(17000);
  expect(f.view().desktop).toMatchObject(waiting);
  f.state.intercept = undefined;
  await f.advance(3500);
  expect(f.view().desktop).toMatchObject({ enabled:true,showing:true });
});

it.each([false,true])('rolls back a timed-out write before deciding whether to retry (stopped=%s)', async stopped => {
  const f = await fixture();
  const save = f.store.save.getMockImplementation()!;
  let release!: () => void;
  f.store.save.mockImplementationOnce(async settings => {
    await new Promise<void>(resolve => { release = resolve; });
    await save(settings);
  });
  f.change('C');
  await f.advance(18500);
  expect(release).toBeTypeOf('function');
  expect(f.view().desktop).toMatchObject(waiting);
  expect(f.view().settings.binding?.scene).toBe('A');
  if (stopped) f.controller.stopDesktop();
  release();
  await f.advance(3500);
  expect(f.view().desktop).toMatchObject({ enabled:!stopped,showing:!stopped });
  const writes = stopped ? ['C','A'] : ['C','A','C'];
  expect(f.store.save.mock.calls.map(([settings]) => settings.binding?.scene).slice(-writes.length)).toEqual(writes);
});

it('does not retry an unchanged range when its timed-out disk write eventually fails', async () => {
  const f = await fixture();
  let rejectWrite!: (error: Error) => void;
  f.store.save.mockImplementationOnce(() => new Promise((_resolve,reject) => { rejectWrite = reject; }));
  f.store.save.mockClear();
  f.change('C');
  await f.advance(18500);
  expect(rejectWrite).toBeTypeOf('function');
  expect(f.view().desktop).toMatchObject(waiting);

  rejectWrite(new Error('disk write failed'));
  await f.advance(4500);

  expect(f.view().desktop).toMatchObject(waiting);
  expect(f.view().settings.binding?.scene).toBe('A');
  expect(f.store.save.mock.calls.map(([settings]) => settings.binding?.scene)).toEqual(['C']);
  f.change('D');
  await f.advance(3500);
  expect(f.view().desktop).toMatchObject({ enabled:true,showing:true });
  expect(f.view().settings.binding?.scene).toBe('D');
});

it('rolls back when capture placement changes silently during the write', async () => {
  const f = await fixture();
  const save = f.store.save.getMockImplementation()!;
  let moved = false;
  f.state.intercept = (type,data) => type === 'GetSceneItemList' && data?.sceneName === 'C' && moved
    ? Promise.resolve({ sceneItems:[{ ...windowItem,sceneItemTransform:{ ...transform,positionX:8 } }] }) : undefined;
  f.store.save.mockImplementationOnce(async settings => { await save(settings); moved = true; });
  f.change('C');
  await f.advance(3500);
  expect(f.view().desktop).toMatchObject({ enabled:true,showing:true });
  expect(f.view().settings.region).toEqual({ x:.25,y:0,width:.75,height:1 });
  expect(f.store.save.mock.calls.map(([settings]) => settings.binding?.scene).slice(-3)).toEqual(['C','A','C']);
});
function fakeRangeTimeout() {
  const timeout = AbortSignal.timeout;
  vi.spyOn(AbortSignal,'timeout').mockImplementation(ms => {
    if (ms !== 8000) return timeout(ms);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms);
    return controller.signal;
  });
}

it('recovers in the same scene when the only compatible capture is added without a notification', async () => {
  const f = await fixture(false);
  await f.park();
  const shots = f.state.shots.length;
  await f.advance(6000);
  expect(f.view().desktop).toMatchObject(waiting);
  expect(f.state.shots).toHaveLength(shots);
  f.state.intercept = (type,data) => type === 'GetSceneItemList' && data?.sceneName === 'B' ? Promise.resolve({ sceneItems:[windowItem] }) : undefined;
  await f.advance(3500);
  expect(f.view().desktop).toMatchObject({ enabled:true,showing:true });
  expect(f.view().settings.binding?.scene).toBe('B');
});

it('recovers when an OBS capture warms up without a notification after the preparation deadline', async () => {
  const f = await fixture();
  let ready = false;
  f.state.intercept = (type,data) => type === 'GetSceneItemList' && data?.sceneName === 'C'
    ? Promise.resolve({ sceneItems:[{ ...windowItem, sceneItemTransform:{ ...transform, sourceWidth:ready ? 32 : 0 } }] }) : undefined;
  f.change('C');
  await f.advance(18500);
  expect(f.view().desktop).toMatchObject(waiting);
  expect(f.view().frame).not.toBeNull();
  const repeatedAttempt = vi.fn();
  const unsubscribe = f.controller.subscribe(() => {
    if (f.view().desktop.preparing) repeatedAttempt();
  });
  try {
    f.state.blocked = true;
    await f.advance(13000);
    expect(f.view().frame).toBeNull();
    f.state.blocked = false;
    await f.advance(3000);
    expect(f.view().frame).not.toBeNull();
    expect(f.view().desktop).toMatchObject(waiting);
    expect(repeatedAttempt).not.toHaveBeenCalled();
  } finally { unsubscribe(); }

  ready = true;
  await f.advance(3500);
  expect(f.view().desktop).toMatchObject({ enabled:true,showing:true });
  expect(f.view().settings.binding?.scene).toBe('C');
});

it('retains the capture readiness check when the window inventory expires during retries', async () => {
  const f = await fixture();
  let ready = false;
  f.state.intercept = (type, data) => type === 'GetSceneItemList' && data?.sceneName === 'C'
    ? Promise.resolve({ sceneItems:[{ ...windowItem, sceneItemTransform:{ ...transform, sourceWidth:ready ? 32 : 0 } }] }) : undefined;
  f.change('C');
  await f.advance(9000);
  expect(f.view().desktop.preparing).toBe(true);

  f.inventory.observedAt = 0;
  await f.advance(1000, false);
  expect(f.view().desktop).toMatchObject(waiting);

  await f.advance(2000);
  expect(f.view().desktop).toMatchObject(waiting);

  ready = true;
  await f.advance(3500);
  expect(f.view().desktop).toMatchObject({ enabled:true, showing:true });
  expect(f.view().settings.binding?.scene).toBe('C');
});

it.each([false, true])('recovers after an ambiguous capture target becomes unique without switching scenes (duplicate minimized=%s)', async minimized => {
  const f = await fixture();
  f.inventory.windows = [{ ...target,id:'2',pid:456,title:'same' }, { ...target,id:'3',pid:789,title:'same',minimized }];
  f.change('C');
  await f.advance(2500);
  expect(f.view().desktop).toMatchObject({ ...waiting,message:expect.stringContaining('複数') });
  await f.advance(4000);
  expect(f.view().settings.binding?.scene).toBe('A');
  f.inventory.windows = [f.inventory.windows[0]];
  await f.advance(2500);
  expect(f.view().desktop).toMatchObject({ enabled:true,showing:true });
  expect(f.view().selectedId).toBe('2');
});

it('recovers after the OBS range reader returns after its deadline while screenshots continued', async () => {
  const f = await fixture();
  f.state.intercept = type => type === 'GetInputSettings' ? Promise.reject(new Error('OBS_VISUAL_UNAVAILABLE')) : undefined;
  f.change('C');
  await f.advance(18500);
  expect(f.view().desktop).toMatchObject(waiting);
  expect(f.view().frame).not.toBeNull();
  f.state.intercept = undefined;
  await f.advance(3500);
  expect(f.view().desktop).toMatchObject({ enabled:true,showing:true });
});

it('recovers when a pending OBS request exceeded the range scan deadline instead of rejecting', async () => {
  const f = await fixture();
  fakeRangeTimeout();
  const pending: Array<(value: Record<string, unknown>) => void> = [];
  f.state.intercept = type => type === 'GetInputSettings' ? new Promise(resolve => { pending.push(resolve); }) : undefined;
  f.change('C');
  await f.advance(18500);
  expect(f.view().desktop).toMatchObject(waiting);
  expect(f.view().frame).not.toBeNull();
  expect(pending.length).toBeGreaterThanOrEqual(2);
  f.state.intercept = undefined;
  for (const release of pending) release({ inputSettings:{ window:'game:Game:game.exe' } });
  await f.advance(3500);
  expect(f.view().desktop).toMatchObject({ enabled:true,showing:true });
});

it('keeps tracking the latest pending OBS read when an expired attempt replies late', async () => {
  const f = await fixture();
  fakeRangeTimeout();
  let secondAttempt = false;
  let releaseOld!: (value: Record<string, unknown>) => void;
  const pendingFilters: Array<(value: Record<string, unknown>) => void> = [];
  f.state.intercept = type => {
    if (!secondAttempt && type === 'GetInputSettings') return new Promise(resolve => { releaseOld = resolve; });
    if (secondAttempt && type === 'GetSourceFilterList') return new Promise(resolve => { pendingFilters.push(resolve); });
    return undefined;
  };
  f.change('C');
  await f.advance(8250);
  expect(releaseOld).toBeTypeOf('function');
  secondAttempt = true;
  await f.advance(1500);
  expect(pendingFilters).toHaveLength(1);
  releaseOld({ inputSettings:{ window:'game:Game:game.exe' } });
  await f.advance(10500);
  expect(f.view().desktop).toMatchObject(waiting);
  f.state.intercept = undefined;
  for (const release of pendingFilters) release({ filters:[] });
  await f.advance(3500);
  expect(f.view().desktop).toMatchObject({ enabled:true,showing:true });
});

it('recovers when OBS retargets an existing capture to an available window in the same scene', async () => {
  const f = await fixture();
  let corrected = false;
  f.state.intercept = type => type === 'GetInputSettings' ? Promise.resolve({
    inputSettings:{ window:corrected ? 'game:Game:game.exe' : 'missing:Other:other.exe' },
  }) : undefined;
  f.change('C');
  await f.advance(18500);
  expect(f.view().desktop).toMatchObject(waiting);
  corrected = true;
  await f.advance(3500);
  expect(f.view().desktop).toMatchObject({ enabled:true,showing:true });
});

it('recovers when an unsupported filter is disabled on the same scene', async () => {
  const f = await fixture();
  let filterEnabled = true;
  f.state.intercept = type => type === 'GetSourceFilterList' ? Promise.resolve({ filters:[{ filterKind:'crop_filter',filterEnabled }] }) : undefined;
  f.change('C');
  await f.advance(2500);
  expect(f.view().desktop).toMatchObject({ ...waiting,message:expect.stringContaining('フィルター') });
  filterEnabled = false;
  await f.advance(3500);
  expect(f.view().desktop).toMatchObject({ enabled:true,showing:true });
});

it('recovers when an unsupported OBS transform is corrected on the same scene', async () => {
  const f = await fixture();
  let rotation = 90, positionX = 0;
  f.state.intercept = (type,data) => type === 'GetSceneItemList' && data?.sceneName === 'C'
    ? Promise.resolve({ sceneItems:[{ ...windowItem,sceneItemTransform:{ ...transform,rotation,positionX } }] }) : undefined;
  f.change('C');
  await f.advance(2500);
  expect(f.view().desktop).toMatchObject({ ...waiting,message:expect.stringContaining('未対応') });
  const generation = f.view().generation;
  for (let step = 0; step < 3; step++) {
    positionX++;
    await f.advance(2250);
    expect(f.view().generation).toBe(generation);
  }
  rotation = 0;
  await f.advance(3500);
  expect(f.view().desktop).toMatchObject({ enabled:true,showing:true });
});

it('recovers when the OBS input whose reads fail is replaced on the same scene', async () => {
  const f = await fixture();
  let replaced = false;
  f.state.intercept = (type,data) => {
    if (type === 'GetInputSettings' && data?.inputName === 'broken') return Promise.reject(new Error('OBS_VISUAL_UNAVAILABLE'));
    if (type === 'GetSceneItemList' && data?.sceneName === 'C' && !replaced) return Promise.resolve({ sceneItems:[{ ...windowItem,sourceName:'broken' }] });
    return undefined;
  };
  f.change('C');
  await f.advance(18500);
  expect(f.view().desktop).toMatchObject(waiting);
  replaced = true;
  await f.advance(3500);
  expect(f.view().desktop).toMatchObject({ enabled:true,showing:true });
  expect(f.view().settings.binding?.scene).toBe('C');
});

it.each(['native','inventory'] as const)('recovers after the %s becomes ready after a timed-out preparation', async recovery => {
  const f = await fixture();
  let release!: () => void;
  vi.mocked(f.desktop.prepare).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  f.change('C');
  await f.advance(2000);
  expect(release).toBeTypeOf('function');
  await f.advance(16000,recovery !== 'inventory');
  expect(f.view().desktop).toMatchObject(waiting);
  expect(f.view().settings.binding?.scene).toBe('A');
  release();
  if (recovery === 'inventory') {
    await f.advance(500,false);
    expect(f.view().desktop).toMatchObject(waiting);
  }
  await f.advance(2500);
  expect(f.view().desktop).toMatchObject({ enabled:true,showing:true });
  expect(f.view().settings.binding?.scene).toBe('C');
});

it.each(['manual stop','another scene'] as const)('ignores a late native completion after %s', async interrupt => {
  const f = await fixture();
  let release!: () => void;
  vi.mocked(f.desktop.prepare).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  f.change('C');
  await f.advance(18000);
  expect(f.view().desktop).toMatchObject(waiting);
  if (interrupt === 'manual stop') f.controller.stopDesktop();
  else await f.park();
  release();
  await f.advance(3500);
  expect(f.view().desktop).toMatchObject({ enabled:false,showing:false,preparing:false });
  expect(f.view().settings.binding?.scene).toBe('A');
});

it.each(['unrelated transform','unchanged capture transform','unrelated visibility','source selected','source locked','source reordered','input activity','old scene notification','failed screenshot'] as const)(
  'keeps displaying an edited range across repeated %s after saving', async interruption => {
    const f = await fixture();
    const region = { x:.1,y:.2,width:.7,height:.6 };
    let sceneItems = [
      { sourceName:'game', sourceUuid:'game-id', sceneItemId:7, inputKind:'window_capture', sceneItemEnabled:true, sceneItemTransform:transform },
      { sourceName:'text', sourceUuid:'text-id', sceneItemId:99, inputKind:'text_gdiplus', sceneItemEnabled:true, sceneItemTransform:transform },
    ];
    if (interruption === 'source reordered') f.state.intercept = (type, data) =>
      type === 'GetSceneItemList' && data?.sceneName === 'A' ? Promise.resolve({ sceneItems }) : undefined;
    await f.controller.update({ ...f.view().settings, binding:null, region });
    expect(f.view().desktop).toMatchObject({ enabled:true, showing:true });
    expect(f.view().settings.binding?.fingerprint).toBeNull();
    const generation = f.view().generation;
    for (let cycle = 0; cycle < 5; cycle++) {
      await f.advance(3000);
      if (interruption === 'unrelated transform') f.emit('SceneItemTransformChanged', { sceneName:'A',sceneItemId:999 });
      if (interruption === 'unchanged capture transform') {
        const sameTransform = Object.fromEntries(Object.entries(transform).reverse());
        f.emit('SceneItemTransformChanged', { sceneName:'A',sceneItemId:7,sceneItemTransform:sameTransform });
      }
      if (interruption === 'unrelated visibility') f.emit('SceneItemEnableStateChanged', { sceneName:'A',sceneItemId:999,sceneItemEnabled:cycle % 2 === 0 });
      if (interruption === 'source selected') f.emit('SceneItemSelected', { sceneName:'A',sceneItemId:7 });
      if (interruption === 'source locked') f.emit('SceneItemLockStateChanged', { sceneName:'A',sceneItemId:7,sceneItemLocked:cycle % 2 === 0 });
      if (interruption === 'source reordered') {
        sceneItems = [...sceneItems].reverse();
        f.emit('SceneItemListReindexed', {
          sceneName:'A', sceneItems:sceneItems.map(({ sceneItemId }, sceneItemIndex) => ({ sceneItemId, sceneItemIndex })),
        });
      }
      if (interruption === 'input activity') f.emit('InputActiveStateChanged', { inputName:'game',inputUuid:'game-id',videoActive:cycle % 2 === 0 });
      if (interruption === 'old scene notification') f.notify('B');
      if (interruption === 'failed screenshot') {
        f.state.intercept = type => type === 'GetSourceScreenshot' ? Promise.reject(new Error('OBS_VISUAL_UNAVAILABLE')) : undefined;
        await f.advance(500);
        f.state.intercept = undefined;
      }
      expect(f.view().desktop).toMatchObject({ enabled:true, showing:true });
      expect(f.view().desktop.resume).toBeUndefined();
      expect(f.view().generation).toBe(generation);
    }
    const before = f.view().frame?.id;
    await f.advance(1000);
    expect(f.view().frame?.id).not.toBe(before);
    await f.controller.update({ ...f.view().settings, binding:null, region:entireImage });
    f.emit('SceneItemTransformChanged', { sceneName:'A',sceneItemId:999 });
    await f.advance(3500);
    expect(f.view().desktop).toMatchObject({ enabled:true, showing:true });
    expect(f.view().settings.region).toEqual(entireImage);
  });

it.each([
  ['changed', { ...transform, positionX:8 }],
  ['partial', { positionX:transform.positionX }],
  ['missing', undefined],
] as const)('asks for confirmation when the capture transform notification is %s after editing the range', async (_case, sceneItemTransform) => {
  const f = await fixture();
  await f.controller.update({ ...f.view().settings, binding:null, region:{ x:.1,y:.1,width:.8,height:.8 } });
  await f.advance(3000);
  f.emit('SceneItemTransformChanged', { sceneName:'A',sceneItemId:7,sceneItemTransform });
  await f.advance(3500);
  expect(f.view().desktop).toMatchObject({ enabled:false, showing:false, resume:'confirmation' });
});

it.each([
  ['missing capture', { sceneName:'A', sceneItems:[{ sceneItemId:99, sceneItemIndex:0 }] }],
  ['an added item', { sceneName:'A', sceneItems:[{ sceneItemId:7, sceneItemIndex:0 }, { sceneItemId:99, sceneItemIndex:1 }] }],
  ['missing scene', { sceneItems:[{ sceneItemId:7, sceneItemIndex:0 }] }],
  ['missing items', { sceneName:'A' }],
  ['invalid items', { sceneName:'A', sceneItems:[{ sceneItemId:7, sceneItemIndex:0 }, { sceneItemId:99, sceneItemIndex:0 }] }],
] as const)('asks for confirmation when the reorder notification has %s', async (_case, eventData) => {
  const f = await fixture();
  await f.controller.update({ ...f.view().settings, binding:null, region:{ x:.1,y:.1,width:.8,height:.8 } });
  f.emit('SceneItemListReindexed', eventData);
  expect(f.view().desktop).toMatchObject({ enabled:false, showing:false, resume:'confirmation' });
});

it.each([false,true])('distinguishes image expiry from an actual program switch while shooting fails (switched=%s)', async switched => {
  const f = await fixture();
  await f.controller.update({ ...f.view().settings, binding:null, region:{ x:.1,y:.1,width:.8,height:.8 } });
  const old = f.view().frame!;
  f.state.intercept = type => type === 'GetSourceScreenshot' ? Promise.reject(new Error('OBS_VISUAL_UNAVAILABLE')) : undefined;
  if (switched) f.change('B',false);
  await f.advance(switched ? 3000 : 13000);
  expect(f.frames.get(old.id)).toBeNull();
  expect(f.view().desktop).toMatchObject({ enabled:!switched, showing:false });
  expect(f.view().desktop.resume).toBe(switched ? 'confirmation' : undefined);
  f.state.intercept = undefined;
  await f.advance(1500);
  expect(f.view().frame).not.toBeNull();
  expect(f.view().desktop.showing).toBe(!switched);
});

it('keeps public images valid after a stale notification with PC display stopped', async () => {
  const f = await fixture();
  f.controller.stopDesktop();
  const original = f.controller.publicView().frame!;

  f.notify('B');
  expect(f.controller.publicView().frame?.id).toBe(original.id);
  expect(f.frames.get(original.id)).not.toBeNull();
  await f.advance(1500);

  expect(f.frames.get(original.id)?.scene).toBe('A');
  expect(f.controller.publicView()).toMatchObject({ accepting:true,frameGeneration:original.generation });
  expect(f.view().desktop).toMatchObject({ enabled:false,showing:false });
});

it('withdraws the old public image after a silent switch even with PC display stopped', async () => {
  const f = await fixture();
  f.controller.stopDesktop();
  const old = f.controller.publicView().frame!;
  f.state.intercept = type => type === 'GetSourceScreenshot' ? Promise.reject(new Error('OBS_VISUAL_UNAVAILABLE')) : undefined;
  f.change('B',false);
  await f.advance(3000);
  expect(f.frames.get(old.id)).toBeNull();
  expect(f.controller.publicView()).toMatchObject({ accepting:true, frame:null });
});

it.each([true,false])('retries the same scene when its first image arrives after the deadline (notified=%s)', async notified => {
  const f = await fixture();
  await f.park();
  f.state.blocked = true;
  f.change('A',notified);
  await f.advance(10500);
  expect(f.view().desktop).toMatchObject({ enabled:false, preparing:false, resume:'scene' });
  f.state.blocked = false;
  await f.advance(2000);
  expect(f.view().desktop).toMatchObject({ enabled:true, showing:true });
  expect(f.view().settings.binding?.scene).toBe('A');
});

it('rechecks the same scene when the window returns after an unobserved round trip', async () => {
  const f = await fixture();
  const windows = f.inventory.windows;
  f.change('B',false);
  f.inventory.windows = [];
  await f.advance(250);
  expect(f.view().desktop).toMatchObject({ enabled:false, preparing:false, resume:'scene' });
  f.change('A',false);
  f.inventory.windows = windows;
  await f.advance(2000);
  expect(f.state.shots).not.toContain('B');
  expect(f.view().desktop).toMatchObject({ enabled:true, showing:true });
  expect(f.view().settings.binding?.scene).toBe('A');
});

it('does not mistake a same-class sibling for the missing target window', async () => {
  const f = await fixture();
  f.inventory.windows = [{ ...target, id:'2', pid:456, title:'different window' }];
  await f.advance(1500);
  expect(f.view().desktop).toMatchObject({ enabled:false, showing:false, resume:'scene' });
  f.inventory.windows = [{ ...target, id:'3', pid:789 }];
  await f.advance(1500);
  expect(f.view().desktop).toMatchObject({ enabled:true, showing:true });
  expect(f.view().selectedId).toBe('3');
});

it('rechecks after a window returns to the same scene even after the range scan timed out', async () => {
  const f = await fixture();
  const windows = f.inventory.windows;
  f.inventory.windows = [];
  f.change('C');
  await f.advance(18000);
  expect(f.view().desktop).toMatchObject({ enabled:false, preparing:false, resume:'scene' });
  expect(f.view().settings.binding?.scene).toBe('A');
  f.inventory.windows = [{ ...windows[0], id:'2', title:'unrelated', processName:'other.exe', className:'Other' }];
  await f.advance(1500);
  expect(f.view().desktop).toMatchObject({ enabled:false, preparing:false, resume:'scene' });
  f.inventory.windows = windows;
  await f.advance(2000);
  expect(f.view().desktop).toMatchObject({ enabled:true, showing:true });
  expect(f.view().settings.binding?.scene).toBe('C');
});

it('validates the range again after a running scene loses and regains its image', async () => {
  const f = await fixture();
  f.state.blocked = true;
  await f.advance(13000);
  expect(f.view().desktop).toMatchObject({ enabled:false, showing:false, resume:'scene' });
  f.state.blocked = false;
  await f.advance(1500);
  expect(f.view().desktop).toMatchObject({ enabled:true, showing:true });
  expect(f.desktop.prepare).toHaveBeenCalledTimes(2);
});

it('resumes offline when a range attempt times out after the last image expires', async () => {
  const f = await fixture(false);
  let scans = 0;
  let release: ((value: Record<string, unknown>) => void) | undefined;
  f.state.intercept = type => {
    if (type !== 'GetInputSettings') return;
    if (++scans === 1) return Promise.reject(new Error('OBS_VISUAL_UNAVAILABLE'));
    return new Promise(resolve => { release = resolve; });
  };
  f.change('C');
  await f.advance(2000);
  expect(release).toBeTypeOf('function');
  f.state.blocked = true;
  await f.advance(16000);
  expect(f.view().frame).toBeNull();
  expect(f.view().desktop).toMatchObject({ enabled:false, preparing:false, resume:'scene' });
  f.state.intercept = undefined;
  f.state.blocked = false;
  release?.({ inputSettings:{ window:'game:Game:game.exe' } });
  await f.advance(3000);
  expect(f.view().desktop).toMatchObject({ enabled:true, showing:true });
  expect(f.view().settings.binding?.scene).toBe('C');
});

it('resumes offline when the image returns after native preparation times out on its first attempt', async () => {
  const f = await fixture(false);
  let release!: () => void;
  vi.mocked(f.desktop.prepare).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  f.change('C');
  await f.advance(2000);
  expect(release).toBeTypeOf('function');
  f.state.blocked = true;
  await f.advance(16000);
  expect(f.view().frame).toBeNull();
  expect(f.view().desktop).toMatchObject({ enabled:false, preparing:false, resume:'scene' });
  f.state.blocked = false;
  release();
  await f.advance(3000);
  expect(f.view().desktop).toMatchObject({ enabled:true, showing:true });
  expect(f.view().settings.binding?.scene).toBe('C');
});

it('does not lose an unidentified return notification during an offline capture', async () => {
  const f = await fixture(false);
  await f.park();
  let release: ((value: Record<string, unknown>) => void) | undefined;
  f.state.intercept = type => type === 'GetSourceScreenshot' ? new Promise(resolve => { release = resolve; }) : undefined;
  const capturing = f.frames.tick();
  await vi.advanceTimersByTimeAsync(0);
  expect(release).toBeTypeOf('function');
  f.change('A',false);
  f.notify();
  await f.advance(1000);
  f.state.intercept = undefined;
  release?.({ imageData });
  await capturing;
  await f.advance(2000);
  expect(f.view().desktop).toMatchObject({ enabled:true, showing:true });
  expect(f.view().settings.binding?.scene).toBe('A');
});

it('recovers after A→B→C→A with the final notification missing and a stale B result', async () => {
  const f = await fixture();
  let release: ((value: Record<string, unknown>) => void) | undefined;
  f.state.intercept = (type,data) => type === 'GetSceneItemList' && data?.sceneName === 'B' ? new Promise(resolve => { release = resolve; }) : undefined;
  f.change('B');
  await f.advance(1000);
  expect(release).toBeTypeOf('function');
  f.change('C');
  f.change('A',false);
  await f.advance(2000);
  expect(f.view().desktop).toMatchObject({ enabled:true, showing:true });
  release?.({ sceneItems:[] });
  await f.advance(1000);
  expect(f.view().desktop).toMatchObject({ enabled:true, showing:true });
  expect(f.view().settings.binding?.scene).toBe('A');
  expect(f.store.save.mock.calls.map(([settings]) => settings.binding?.scene)).not.toContain('B');
  expect(f.store.save.mock.calls.map(([settings]) => settings.binding?.scene)).not.toContain('C');
});

it('keeps the current image when an older verified screenshot returns after a silent round trip', async () => {
  const f = await fixture();
  const original = f.controller.publicView().frame;
  expect(original).not.toBeNull();
  let screenshotTaken = false;
  let release!: () => void;
  f.state.intercept = type => {
    if (type === 'GetSourceScreenshot') screenshotTaken = true;
    if (type !== 'GetSceneCollectionList' || !screenshotTaken) return undefined;
    return new Promise(resolve => { release = () => resolve({ currentSceneCollectionName:'original' }); });
  };
  f.change('B',false);
  const oldCapture = f.frames.tick();
  await vi.advanceTimersByTimeAsync(0);
  expect(release).toBeTypeOf('function');

  let currentSceneChecked = false;
  f.state.intercept = type => {
    if (type === 'GetCurrentProgramScene') currentSceneChecked = true;
    return undefined;
  };
  f.change('A',false);
  await f.advance(1250);
  expect(currentSceneChecked).toBe(true);
  expect(f.controller.publicView().frame?.id).toBe(original?.id);
  release();
  await oldCapture;

  expect(f.frames.latest()?.scene).toBe('A');
  expect(f.controller.publicView().frame?.id).toBe(original?.id);
  expect(f.view().desktop).toMatchObject({ enabled:true,showing:true });
});

it('refreshes an offline follow image before expiry when OBS repeatedly takes 5.5 seconds', async () => {
  const f = await fixture(false);
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms);
    return controller.signal;
  });
  f.state.intercept = type => type === 'GetSourceScreenshot'
    ? new Promise(resolve => setTimeout(() => resolve({ imageData }), 5500)) : undefined;
  const original = f.frames.latest()?.metadata.id;
  const first = f.frames.tick();
  await f.advance(5500);
  await first;
  const refreshed = f.frames.latest()?.metadata.id;
  expect(refreshed).not.toBe(original);
  for (let sample = 0; sample < 24; sample++) {
    await f.advance(250);
    expect(f.frames.latest()).not.toBeNull();
    expect(f.view().desktop).toMatchObject({ enabled:true, showing:true });
  }
  expect(f.frames.latest()?.metadata.id).not.toBe(refreshed);
});

it('keeps the public image updating during repeated successful AI captures', async () => {
  const f = await fixture();
  const ai = new ObsVisual(() => f.obs.visualReader('foreground'));
  const signal = new AbortController().signal;
  const generation = f.controller.publicView().frame?.generation;
  for (let attempt = 0; attempt < 4; attempt++) {
    const before = f.controller.publicView().frame?.id;
    const result = await ai.capture({ uuid:'game-id', name:'game', collection:'original' }, signal);
    expect(result.image).toBeDefined();
    await f.advance(4000);
    expect(f.controller.publicView().frame).toMatchObject({ generation, id:expect.any(String) });
    expect(f.controller.publicView().frame?.id).not.toBe(before);
    expect(f.view().desktop).toMatchObject({ enabled:true, showing:true });
  }
});

it.each([true,false])('recovers after cancelled AI capture releases the physical OBS slot (published=%s)', async online => {
  const f = await fixture(online);
  const ai = new ObsVisual(() => f.obs.visualReader('foreground'));
  const cancellation = new AbortController();
  const shots = f.state.shots.length;
  let release!: () => void;
  f.state.intercept = (type,data) => {
    if (type !== 'GetSourceScreenshot' || data?.imageCompressionQuality !== 75) return undefined;
    expect(data).toMatchObject({ sourceUuid:'game-id',imageWidth:32,imageHeight:18 });
    return new Promise(resolve => { release = () => resolve({ imageData }); });
  };
  const aiResult = ai.capture({ uuid:'game-id',name:'game',collection:'original' },cancellation.signal);
  await vi.advanceTimersByTimeAsync(0);
  expect(release).toBeTypeOf('function');

  f.change('C',false);
  f.controller.preview();
  const cancelled = expect(aiResult).rejects.toThrow('cancelled AI capture');
  cancellation.abort(new Error('cancelled AI capture'));
  await cancelled;
  await f.advance(11000);
  expect(f.view().desktop).toMatchObject(waiting);
  expect(f.state.shots).toHaveLength(shots);
  await expect(f.obs.visualReader('foreground').request('GetSourceScreenshot')).rejects.toThrow('BUSY');

  release();
  await f.advance(4000);
  expect(f.state.shots).toHaveLength(shots);
  await f.advance(4500);
  expect(f.view().desktop).toMatchObject({ enabled:true,showing:true });
  expect(f.view().settings.binding?.scene).toBe('C');
  expect(f.controller.publicView().accepting).toBe(online);
});

it('rolls back a candidate if the scene changes without notification during its save', async () => {
  const f = await fixture();
  const save = f.store.save.getMockImplementation()!;
  const visibleBindings: Array<string | undefined> = [];
  const unsubscribe = f.controller.subscribe(() => {
    if (f.view().desktop.enabled) visibleBindings.push(f.view().settings.binding?.scene);
  });
  try {
    f.store.save.mockImplementationOnce(async settings => {
      expect(settings.binding?.scene).toBe('C');
      await save(settings);
      f.change('A',false);
    });
    f.change('C');
    await f.advance(2500);
    expect(f.view().desktop).toMatchObject({ enabled:true, showing:true });
    expect(visibleBindings).not.toContain('C');
    expect(f.view().settings.binding?.scene).toBe('A');
  } finally { unsubscribe(); }
});

it('keeps displaying the confirmed A when an old B notification arrives after recovery', async () => {
  const f = await fixture();
  await f.park();
  f.change('A',false);
  await f.advance(1500);
  expect(f.view().desktop.showing).toBe(true);
  const generation = f.view().generation;
  f.notify('B');
  expect(f.view().desktop.showing).toBe(true);
  await f.advance(1500);
  expect(f.view().desktop).toMatchObject({ enabled:true, showing:true });
  expect(f.view().generation).toBe(generation);
});

it('retries when a stale notification interrupts native preparation for the current scene', async () => {
  const f = await fixture();
  await f.park();
  let release: (() => void) | undefined;
  vi.mocked(f.desktop.prepare).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  f.change('A');
  await f.advance(1500);
  expect(release).toBeTypeOf('function');
  f.notify('B');
  release?.();
  await f.advance(2000);
  expect(f.view().desktop).toMatchObject({ enabled:true, showing:true });
  expect(f.view().settings.binding?.scene).toBe('A');
});

it.each([false,true])('resumes a manually edited range when a stale notification arrives during native preparation (monitor=%s)', async monitor => {
  const f = await fixture(true,monitor);
  f.controller.pauseEditing();
  vi.mocked(f.desktop.prepare).mockImplementationOnce(async () => f.notify('B'));
  const region = { x:.1,y:.1,width:.8,height:.8 };
  await f.controller.update({ ...f.view().settings, binding:null, region });
  expect(f.view().settings.region).toEqual(region);
  expect(f.view().desktop).toMatchObject({ enabled:true, showing:true });
});

it('resumes an edited range when a stale notification arrives during the binding write', async () => {
  const f = await fixture();
  f.controller.pauseEditing();
  const save = f.store.save.getMockImplementation()!;
  f.store.save.mockImplementation(async settings => {
    await save(settings);
    if (settings.binding && !settings.binding.fingerprint) f.notify('B');
  });
  await f.controller.update({ ...f.view().settings, binding:null, region:{ x:.1,y:.1,width:.8,height:.8 } });
  expect(f.view().desktop).toMatchObject({ enabled:true, showing:true });
  expect(f.view().settings.binding?.scene).toBe('A');
});

it('resumes a monitor range when an old scene notification interrupts its first range scan', async () => {
  const f = await fixture(true,true);
  f.controller.pauseEditing();
  let notifications = 0;
  f.state.intercept = type => {
    if (type !== 'GetInputSettings' || notifications >= 2) return;
    notifications++;
    f.notify('B');
    return Promise.resolve({ inputSettings:{ monitor_id:'one' } });
  };
  await f.controller.update({ ...f.view().settings, binding:null, region:{ x:.1,y:.1,width:.8,height:.8 } });
  expect(notifications).toBe(2);
  expect(f.view().desktop).toMatchObject({ enabled:true, showing:true });
});

it('does not extend a pending deadline on delayed notices for different scenes', async () => {
  const f = await fixture();
  await f.park();
  f.state.blocked = true;
  f.change('A');
  await f.advance(1500);
  expect(f.view().desktop.preparing).toBe(true);
  for (const old of ['B','C','B','C','B']) {
    f.notify(old);
    await f.advance(2000);
  }
  expect(f.view().desktop).toMatchObject({ enabled:false, preparing:false, resume:'scene' });
  f.state.blocked = false;
  await f.advance(1500);
  expect(f.view().desktop).toMatchObject({ enabled:true, showing:true });
  expect(f.view().settings.binding?.scene).toBe('A');
});

it.each(['missing completion','late old start'] as const)('preserves verified images until OBS confirms a collection change (%s)', async fault => {
  const f = await fixture();
  const old = f.controller.publicView().frame!;
  if (fault === 'missing completion') {
    f.emit('CurrentSceneCollectionChanging',{ sceneCollectionName:'original' });
    expect(f.controller.publicView().frame?.id).toBe(old.id);
    expect(f.view().frame?.generation).toBe(old.generation);
    expect(f.view().desktop.showing).toBe(true);
  }
  f.state.collection = 'next';
  f.change('C',false);
  if (fault === 'late old start') {
    f.emit('CurrentSceneCollectionChanged',{ sceneCollectionName:'next' });
    await f.advance(1500);
    expect(f.view().desktop.showing).toBe(true);
    const current = f.controller.publicView().frame!;
    f.emit('CurrentSceneCollectionChanging',{ sceneCollectionName:'original' });
    expect(f.controller.publicView().frame?.id).toBe(current.id);
    expect(f.view().desktop.showing).toBe(true);
    await f.advance(3000);
    expect(f.controller.publicView().frame?.generation).toBe(current.generation);
  }
  await f.advance(3000);
  expect(f.obs.view().connection).toBe('connected');
  expect(f.controller.publicView().frame?.generation).toBeGreaterThan(old.generation);
  expect(f.view().desktop).toMatchObject({ enabled:true, showing:true });
  expect(f.view().settings.binding?.scene).toBe('C');
  await expect(f.controller.react({ kind:'point', frameId:old.id, x:.5, y:.5 })).rejects.toThrow('画像が古くなりました。');
});

it('keeps both images and PC display through a burst of collection starts and refreshes when it stops', async () => {
  const f = await fixture();
  const initial = f.controller.publicView().frame!;
  for (let i = 0; i < 16; i++) {
    f.emit('CurrentSceneCollectionChanging', i % 2 ? { sceneCollectionName:'original' } : undefined);
    await f.advance(500);
  }
  expect(f.controller.publicView().frame?.id).toBe(initial.id);
  expect(f.view().desktop).toMatchObject({ enabled:true,showing:true });
  await f.advance(2000);
  expect(f.controller.publicView().frame).toMatchObject({ generation:initial.generation });
  expect(f.controller.publicView().frame?.id).not.toBe(initial.id);
  expect(f.view().frame?.generation).toBe(initial.generation);
  expect(f.view().desktop).toMatchObject({ enabled:true,showing:true });

  // A real switch still has to be detected when OBS never sent completion.
  const beforeSwitch = f.controller.publicView().frame!;
  f.emit('CurrentSceneCollectionChanging', { sceneCollectionName:'original' });
  f.state.collection = 'actual';
  f.change('C',false);
  await f.advance(3000);
  expect(f.controller.publicView().frame?.generation).toBeGreaterThan(beforeSwitch.generation);
  expect(f.frames.getPublic(beforeSwitch.id)).toBeNull();
  expect(f.view().desktop).toMatchObject({ enabled:true,showing:true });
  expect(f.view().settings.binding?.scene).toBe('C');
});

it.each(['CurrentSceneCollectionChanged','SceneCollectionListChanged'] as const)(
  'keeps refreshing both images when %s arrives during every screenshot', async event => {
    const f = await fixture();
    const initial = f.controller.publicView().frame!;
    f.state.intercept = type => {
      if (type !== 'GetSourceScreenshot') return;
      f.emit(event, { sceneCollectionName:'older', sceneCollections:['original','older'] });
      return Promise.resolve({ imageData });
    };
    await f.advance(15000);
    expect(f.controller.publicView().frame).toMatchObject({ generation:initial.generation });
    expect(f.controller.publicView().frame?.id).not.toBe(initial.id);
    expect(f.view().frame?.generation).toBe(initial.generation);
    expect(f.view().desktop).toMatchObject({ enabled:true,showing:true });
  });
