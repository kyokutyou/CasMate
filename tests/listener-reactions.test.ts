import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { build } from 'vite';
import { ReactionController, type ReactionDesktop } from '../src/main/reactions/reaction-controller';
import { ReactionFrames } from '../src/main/reactions/reaction-frames';
import { defaultReactionSettings, type ReactionWindow, type ReactionSettings } from '../src/shared/listener-reactions';
import type { ObsVisualReader } from '../src/main/obs/obs-visual';
import { reactionSourceRegion, reactionViewport } from '../src/main/reactions/reaction-geometry';
import { ReactionPublicServer, createReactionPublicApplication } from '../src/main/reactions/reaction-public-server';
import express from 'express';
import { createServer, get } from 'node:http';
import { registerReactionManagementRoutes } from '../src/main/reactions/reaction-management-routes';
import { ReactionPublication, type ReactionPublicationServer } from '../src/main/reactions/reaction-publication';
import type { TunnelCallbacks } from '../src/main/poll/srv-us-tunnel';
import { LocalAccess } from '../src/main/server/local-access';
import { REACTION_STICKERS } from '../src/shared/reaction-stickers';
import { ReactionStickerPlacement } from '../src/main/reactions/reaction-sticker-placement';
const cleanup: (() => Promise<void>)[] = [];
it('shares fixed arrow endpoints and acceptance time with OBS and the clipped PC layer',async()=>{
 const f=await fixture();await f.select();await f.controller.startDesktop();f.controller.setOnline(true);
 const cookie=await f.cookie(),events:Array<import('../src/shared/listener-reactions').ReactionEvent>=[];
 f.controller.subscribe((type,data)=>{if(type==='reaction'&&'kind' in data)events.push(data);});
 const frame=f.frames.publicMetadata()!,from={x:.15,y:.7},to={x:.8,y:.25};
 const result=await f.send(cookie,{kind:'arrow',frameId:frame.id,from,to});
 expect(result.status).toBe(200);expect(result.body).toMatchObject({kind:'arrow',from,to});
 const event=events.at(-1)!;expect(event).toMatchObject({kind:'arrow',from,to,frameId:frame.id,counts:{arrow:1}});
 expect(f.desktop.reaction).toHaveBeenLastCalledWith({...event,clip:{x:0,y:0,width:1,height:1}});
 expect(event).not.toHaveProperty('clip');expect(f.desktop.marker).not.toHaveBeenCalled();
 expect((await f.send(cookie,{kind:'arrow',frameId:frame.id,from,to})).status).toBe(429);
 for(const change of [{text:'任意文'},{from:{x:.2,y:.2,z:0}},{to:{x:2,y:.5}},{to:{x:.15,y:.7}},{from:null},{from:[.1,.2]},{to:{x:'0.5',y:.5}}]){
  f.advance(900);expect((await f.send(cookie,{kind:'arrow',frameId:frame.id,from,to,...change})).status).toBe(400);
 }
 f.advance(900);f.scene();expect((await f.send(cookie,{kind:'arrow',frameId:frame.id,from,to})).status).toBe(409);
 expect(events).toHaveLength(1);
});
it('keeps an arrow outside the selected PC game region on OBS only and rejects retired frames',async()=>{
 const f=await fixture();await f.select();await f.controller.update({...f.saved(),region:{x:.25,y:.25,width:.5,height:.5}});await f.controller.startDesktop();f.controller.setOnline(true);
 const cookie=await f.cookie(),frame=f.frames.publicMetadata()!;
 expect((await f.send(cookie,{kind:'arrow',frameId:frame.id,from:{x:.4,y:.4},to:{x:.9,y:.9}})).status).toBe(200);
 expect(f.desktop.reaction).not.toHaveBeenCalled();
 f.advance(900);expect((await f.send(cookie,{kind:'arrow',frameId:frame.id,from:{x:0,y:0},to:{x:.5,y:.5}})).status).toBe(200);
 expect(f.desktop.reaction).toHaveBeenLastCalledWith(expect.objectContaining({kind:'arrow',from:{x:0,y:0},clip:{x:.25,y:.25,width:.5,height:.5}}));
 f.frames.invalidate();f.advance(900);expect((await f.send(cookie,{kind:'arrow',frameId:frame.id,from:{x:0,y:0},to:{x:.5,y:.5}})).status).toBe(409);
});
it('validates fixed point intents and delivers the same intent and acceptance time to PC and OBS',async()=>{
 const f=await fixture();await f.select();await f.controller.startDesktop();f.controller.setOnline(true);
 const cookie=await f.cookie(),events:Array<import('../src/shared/listener-reactions').ReactionEvent>=[];
 f.controller.subscribe((type,data)=>{if(type==='reaction'&&'kind' in data)events.push(data);});
 for(const intent of ['look','question','danger']){
  f.advance(900);await f.frames.tick();
  const frame=f.frames.publicMetadata()!;
  const result=await f.send(cookie,{kind:'point',intent,frameId:frame.id,x:.4,y:.6});
  expect(result.status).toBe(200);
  const event=events.at(-1)!;expect(event.intent).toBe(intent);
  expect(f.desktop.marker).toHaveBeenLastCalledWith(expect.objectContaining({x:.4,y:.6,intent,at:event.at}));
 }
 for(const extra of [{intent:'unknown'},{intent:null},{intent:'__proto__'},{intent:'danger',text:'任意文'},{intent:'look',url:'https://example.com'}]){
  f.advance(900);await f.frames.tick();expect((await f.send(cookie,{kind:'point',frameId:f.frames.publicMetadata()!.id,x:.5,y:.5,...extra})).status).toBe(400);
 }
});
it('accepts exactly nine fixed character reactions without an image, retaining publication and cookie limits', async () => {
  const f = await fixture(); f.controller.setOnline(true); f.frames.invalidate();
  const cookie = await f.cookie();
  const accepted: Array<import('../src/shared/listener-reactions').ReactionEvent> = [];
  f.controller.subscribe((type,data)=>{if(type==='reaction'&&'kind' in data)accepted.push(data);});
  for (const sticker of REACTION_STICKERS) {
    f.advance(900);
    const result = await f.send(cookie, {kind:'sticker',sticker:sticker.id});
    expect(result.status).toBe(200);
    expect(result.body.kind).toBe('sticker');
    expect(accepted.at(-1)?.stickerPlacement?.width).toBeCloseTo(.38);
    expect(accepted.at(-1)?.stickerPlacement?.height).toBeCloseTo(.38);
    expect(accepted.at(-1)?.stickerPlacement?.x).toBeGreaterThanOrEqual(.03);
    expect(accepted.at(-1)!.stickerPlacement!.y+accepted.at(-1)!.stickerPlacement!.height).toBeLessThanOrEqual(.8500001);
  }
  expect((await f.send(cookie,{kind:'sticker',sticker:'surprise'})).status).toBe(429);
  for (const payload of [{kind:'sticker',sticker:'unknown'},{kind:'sticker'},{kind:'sticker',sticker:'surprise',url:'file:///private'},{kind:'sticker',sticker:'surprise',size:2},{kind:'sticker',sticker:'surprise',stickerPlacement:{x:0,y:0,width:1,height:1}}]) {
    f.advance(900); expect((await f.send(cookie,payload)).status).toBe(400);
  }
  f.controller.setOnline(false); f.advance(900);
  expect((await f.send(cookie,{kind:'sticker',sticker:'surprise'})).status).toBe(503);
  f.controller.setOnline(true); f.advance(900);
  expect((await f.send(cookie,{kind:'sticker',sticker:'surprise'})).status).toBe(200);
  const fresh=accepted.at(-1)!;
  expect(fresh.stickerPlacement).toEqual(new ReactionStickerPlacement().choose(`${fresh.instance}:${fresh.sequence}`,0,3800));
  f.frames.invalidate(); f.advance(900);
  expect((await f.send(cookie,{kind:'sticker',sticker:'surprise'})).status).toBe(200);
  const changed=accepted.at(-1)!;
  expect(changed.stickerPlacement).toEqual(new ReactionStickerPlacement().choose(`${changed.instance}:${changed.sequence}`,0,3800));
});
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); vi.useRealTimers(); });
const target: ReactionWindow = { id: '1', pid: 123, title: 'game', processName: 'game.exe', className: 'Game', x: 100, y: 200, width: 640, height: 360, minimized: false };
const transform = { positionX: 0, positionY: 0, sourceWidth: 32, sourceHeight: 18, scaleX: 1, scaleY: 1, rotation: 0, alignment: 5, cropLeft: 0,cropTop: 0,cropRight: 0,cropBottom: 0,cropToBounds: false,boundsType: 'OBS_BOUNDS_NONE' };
async function fixture(useProductionPublicClock = false, initialSettings = defaultReactionSettings()) {
  let now = 100000, scene = 'scene', sceneUuid = 'program-scene', saved = initialSettings;
  const image = readFileSync(new URL('./fixtures/obs-program-black.jpg', import.meta.url));
  const read: ObsVisualReader = { valid: () => true, request: vi.fn(async type => {
    switch (type) {
      case 'GetCurrentProgramScene': return { currentProgramSceneName: scene, currentProgramSceneUuid: sceneUuid };
      case 'GetSceneCollectionList': return { currentSceneCollectionName: 'collection' };
      case 'GetVideoSettings': return { baseWidth: 32, baseHeight: 18 };
      case 'GetVersion': return { supportedImageFormats: ['jpg'] };
      case 'GetSourceScreenshot': return { imageData: `data:image/jpeg;base64,${image.toString('base64')}` };
      case 'GetSceneItemList': return { sceneItems: [{ sourceName: 'game', sourceUuid: 'game-id', sceneItemId: 7, inputKind: 'game_capture', sceneItemEnabled: true, sceneItemTransform: transform }] };
      case 'GetInputSettings': return { inputSettings: { window: 'game:Game:game.exe', capture_mode: 'window' } };
      case 'GetSourceFilterList': return { filters: [] };
      default: throw new Error(type);
    }
  }) };
  const inventory = { windows: [{ ...target }], foreground: '', observedAt: now };
  const desktop: ReactionDesktop = { inventory: () => inventory, demand: vi.fn(), prepare: vi.fn(async () => undefined), render: vi.fn(), marker: vi.fn(), reaction: vi.fn(), clear: vi.fn(), close: vi.fn() };
  const store = { load: async () => saved, save: vi.fn(async (settings: ReactionSettings) => { saved = settings; }) };
  const frames = new ReactionFrames(() => read, () => now);
  const controller = new ReactionController(store, frames, () => read, desktop, () => now); await controller.initialize(); cleanup.push(() => controller.shutdown());
  await frames.tick();
  const select = () => controller.update({ ...defaultReactionSettings(), target: { title: target.title, processName: target.processName, className: target.className } });
  const app = createReactionPublicApplication({ controller, host: () => 'reactions.example', online: () => controller.publicView().accepting, nonce: 'nonce', assets: new Map([['/', { body: Buffer.from('<meta name="casmate-preview"><h1>Reactions</h1>'), type: 'text/html' }]]), monotonicNow: useProductionPublicClock ? undefined : () => now });
  const cookie = async () => String((await request(app).get('/').set('Host','reactions.example')).headers['set-cookie'][0]).split(';')[0];
  const send = (identity: string, body: unknown) => request(app).post('/react').set('Host','reactions.example').set('Origin','https://reactions.example').set('Cookie',identity).send(body);
  return { controller, frames, read, desktop, inventory, store, select, app, cookie, send, advance: (ms: number) => { now += ms; inventory.observedAt = now; }, scene: (name = 'other') => { scene = name; sceneUuid = name === 'scene' ? 'program-scene' : 'other-scene'; }, rename: () => { scene = 'renamed'; }, saved: () => saved };
}
async function advanceRecovery(f: Awaited<ReturnType<typeof fixture>>, ms: number, fresh = true) {
  for (let remaining = ms; remaining > 0;) {
    const step = Math.min(250, remaining);
    f.advance(step);
    if (!fresh) f.inventory.observedAt = 0;
    await vi.advanceTimersByTimeAsync(step);
    remaining -= step;
  }
}
function monitorInput(f:Awaited<ReturnType<typeof fixture>>) {
  const monitor=f.inventory.windows[0],normal=f.read.request;
  f.read.request=async(type,data)=>type==='GetInputSettings'?{inputSettings:{monitor_id:'one'}}:type==='GetSceneItemList'?{sceneItems:[{sourceName:'screen',sourceUuid:'screen-id',sceneItemId:1,inputKind:'monitor_capture',sceneItemEnabled:true,sceneItemTransform:{...transform,sourceWidth:monitor.width,sourceHeight:monitor.height,scaleX:32/monitor.width,scaleY:18/monitor.height}}]}:normal(type,data);
}
describe('production listener reactions', () => {
  it.each([
    { mode: 'twitch', id: 'caster_name', otherId: 'Ab1_CD-efgH', origin: 'https://player.twitch.tv', otherOrigin: 'youtube.com' },
    { mode: 'youtube', id: 'Ab1_CD-efgH', otherId: 'caster_name', origin: 'https://www.youtube.com', otherOrigin: 'twitch.tv' },
  ] as const)('publishes only the selected live preview ($mode) in the listener HTML and allows both official players for later switches', async ({ mode, id, otherId, origin, otherOrigin }) => {
    const f = await fixture(false, {
      ...defaultReactionSettings(), preview: { mode, twitchChannel: 'caster_name', youtubeVideoId: 'Ab1_CD-efgH' },
    });
    f.controller.setOnline(true);
    const response = await request(f.app).get('/').set('Host', 'reactions.example').expect(200);
    expect(response.text).toContain(`<meta name="casmate-preview" data-mode="${mode}" data-id="${id}">`);
    expect(response.text).not.toContain(otherId);
    expect(response.headers['content-security-policy']).toContain(origin);
    expect(response.headers['content-security-policy']).toContain(otherOrigin);
    const preview = await request(f.app).get('/preview').set('Host','reactions.example').expect(200);
    expect(preview.body).toEqual({mode,id});
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    const health = await request(f.app).get('/health').set('Host', 'reactions.example').expect(200);
    expect(health.headers['content-security-policy']).not.toContain('frame-src');
    expect(health.text).not.toContain(id);
    f.controller.setOnline(false);
    const offline = await request(f.app).get('/').set('Host', 'reactions.example').expect(503);
    expect(offline.headers['content-security-policy']).not.toContain('frame-src');
    expect(offline.text).not.toContain(id);
  });
  it('serves only the OBS preview while the selected channel is blank, even with request-supplied settings', async () => {
    const f = await fixture(false, {
      ...defaultReactionSettings(), preview: { mode: 'twitch', twitchChannel: '', youtubeVideoId: 'Ab1_CD-efgH' },
    });
    f.controller.setOnline(true);
    const response = await request(f.app).get('/?mode=youtube&videoId=other').set('Host', 'reactions.example').expect(200);
    expect(response.text).toContain('<meta name="casmate-preview">');
    expect(response.text).not.toContain('Ab1_CD-efgH');
    expect(response.headers['content-security-policy']).toContain('frame-src https://player.twitch.tv https://www.youtube.com');
  });
  it('keeps a local manual display after the unused preview expires and stops on a silent program switch', async () => {
    vi.useFakeTimers();
    const f = await fixture();
    await f.select();
    await f.controller.startDesktop();
    const publication = { status:'off' as const, url:null, message:'' };
    const captureCount = () => vi.mocked(f.read.request).mock.calls.filter(([type]) => type === 'GetSourceScreenshot').length;
    const captures = captureCount();
    await advanceRecovery(f, 12_250);
    expect(captureCount()).toBe(captures);
    expect(f.controller.view(publication)).toMatchObject({ frame:null, desktop:{ enabled:true, showing:true } });
    f.controller.testDesktop();
    expect(f.desktop.marker).toHaveBeenCalledWith({ x:.5, y:.5, canvasWidth:32, region:{ x:0, y:0, width:1, height:1 }, intent:'look', at:expect.any(Number) });

    f.scene();
    await advanceRecovery(f, 1_250);
    expect(f.controller.view(publication).desktop).toMatchObject({ enabled:false, showing:false, resume:'confirmation' });
    expect(captureCount()).toBe(captures);
  });
  it('invalidates a renamed stopped binding without clearing the verified image of a different program scene', async () => {
    vi.useFakeTimers();
    const f = await fixture();
    await f.select();
    f.controller.setOnline(true);
    await f.controller.startDesktop();
    f.controller.stopDesktop();
    f.scene();
    await advanceRecovery(f, 1500);
    const publication = { status:'online' as const, url:null, message:'' };
    const before = f.controller.view(publication);
    const frame = f.controller.publicView().frame;
    expect(before.settings.binding?.scene).toBe('scene');
    expect(frame).not.toBeNull();
    expect(f.frames.latest()?.scene).toBe('other');

    f.controller.obsChanged('SceneNameChanged', { oldSceneName:'scene', sceneName:'renamed', sceneUuid:'program-scene' });
    expect(f.controller.view(publication)).toMatchObject({ frame:before.frame, settings:{ binding:{ context:'invalid' } } });
    expect(f.controller.publicView().frame).toEqual(frame);
  });
  it('keeps preview demand active throughout a slow foreground preview poll', async () => {
    vi.useFakeTimers();
    const f = await fixture();
    f.controller.preview();
    await advanceRecovery(f, 5500);
    expect(f.desktop.demand).not.toHaveBeenCalledWith(false);
    await advanceRecovery(f, 500);
    expect(f.desktop.demand).toHaveBeenLastCalledWith(false);
  });
  it('orders management snapshots across a foreground change without a capture', async () => {
    vi.useFakeTimers();
    const f = await fixture();
    await f.select();
    await f.controller.update({ ...f.saved(), foregroundOnly:true });
    f.inventory.foreground = target.id;
    await f.controller.startDesktop();
    const publication = { status:'off' as const, url:null, message:'' };
    const earlier = f.controller.view(publication);
    expect(earlier.desktop.showing).toBe(true);
    f.inventory.foreground = '';
    await advanceRecovery(f, 250);
    const later = f.controller.view(publication);
    expect(later.desktop.showing).toBe(false);
    expect(later.frame?.id).toBe(earlier.frame?.id);
    expect(later.revision).toBeGreaterThan(earlier.revision);
  });
  it('reports the active desktop target even when another window takes the saved title', async () => {
    vi.useFakeTimers();
    const f = await fixture();
    await f.select();
    await f.controller.startDesktop();
    const publication = { status:'off' as const, url:null, message:'' };
    expect(f.controller.view(publication).selectedId).toBe(target.id);
    f.inventory.windows = [{ ...target, title:'renamed' }, { ...target, id:'2', pid:456 }];
    await advanceRecovery(f, 250);
    expect(f.controller.view(publication)).toMatchObject({ selectedId:target.id, desktop:{ enabled:true, showing:true } });
    f.controller.stopDesktop();
    expect(f.controller.view(publication).selectedId).toBe('2');
  });
  it.each([
    ['CurrentPreviewSceneChanged', { sceneName:'preview' }],
    ['SceneListChanged', {}],
    ['SceneItemTransformChanged', { sceneName:'scene', sceneItemId:7 }],
  ] as const)('keeps both images after %s while only an unconfirmed target is selected', async (type, data) => {
    const f = await fixture();
    await f.select(); f.controller.setOnline(true);
    const publication = { status:'online' as const, url:null, message:'' };
    const frame = f.controller.view(publication).frame!;
    expect(f.controller.view(publication).settings.binding).toBeNull();
    f.controller.obsChanged(type, data);
    expect(f.controller.view(publication).frame).toEqual(frame);
    expect(f.controller.publicView().frame).toEqual(frame);
  });
  it('still invalidates the image after a program transform when a manual crop has been saved', async () => {
    const f = await fixture();
    await f.select();
    await f.controller.update({ ...f.saved(), region:{ x:.1,y:.1,width:.8,height:.8 } });
    const publication = { status:'off' as const, url:null, message:'' };
    expect(f.controller.view(publication)).toMatchObject({ settings:{ binding:null }, desktop:{ enabled:false } });
    expect(f.controller.view(publication).frame).not.toBeNull();
    f.controller.obsChanged('SceneItemTransformChanged', { sceneName:'scene', sceneItemId:7 });
    expect(f.controller.view(publication).frame).toBeNull();
  });
  it('ignores preview selection during unbound manual preparation but still guards a program transform', async () => {
    const f = await fixture(); await f.select(); f.controller.setOnline(true);
    const frame = f.controller.publicView().frame!;
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    vi.mocked(f.desktop.prepare).mockReturnValueOnce(held);
    const starting = f.controller.runDesktopPreparation(() => f.controller.startDesktop(), undefined);
    const refused = expect(starting).rejects.toThrow();
    try {
      await vi.waitFor(() => expect(f.desktop.prepare).toHaveBeenCalledOnce());
      f.controller.obsChanged('CurrentPreviewSceneChanged', { sceneName:'preview' });
      expect(f.controller.publicView().frame).toEqual(frame);
      f.controller.obsChanged('SceneItemTransformChanged', { sceneName:'scene', sceneItemId:7 });
      expect(f.controller.publicView().frame).toBeNull();
    } finally { release(); await refused; }
  });
  it('sends a desktop-only test marker immediately at the center of the display range', async () => {
    const f = await fixture();
    await f.select();
    await f.controller.update({ ...f.saved(), region:{ x:.25, y:.25, width:.5, height:.5 } });
    await f.controller.startDesktop();
    const listener = vi.fn();
    const unsubscribe = f.controller.subscribe(listener);
    try {
      f.controller.testDesktop();
      expect(f.desktop.marker).toHaveBeenCalledExactlyOnceWith({ x:.5, y:.5, canvasWidth:16, region:{ x:.25, y:.25, width:.5, height:.5 }, intent:'look', at:expect.any(Number) });
      expect(listener).not.toHaveBeenCalled();
    } finally { unsubscribe(); }
  });
  it('rejects a test when PC display is stopped or the selected window is hidden', async () => {
    const f = await fixture();
    await f.select();
    expect(() => f.controller.testDesktop()).toThrow('先にPC表示を開始してください。');
    await f.controller.startDesktop();
    f.inventory.windows[0].minimized = true;
    expect(() => f.controller.testDesktop()).toThrow('テスト表示できません。');
    expect(f.desktop.marker).not.toHaveBeenCalled();
  });
  it('explains why a foreground-only test cannot display over the background target', async () => {
    const f = await fixture();
    await f.select();
    await f.controller.update({ ...f.saved(), foregroundOnly:true });
    f.inventory.foreground = target.id;
    await f.controller.startDesktop();
    f.inventory.foreground = '2';
    expect(() => f.controller.testDesktop()).toThrow('表示先を前面にするか、前面限定をオフにしてください。');
    expect(f.desktop.marker).not.toHaveBeenCalled();
  });
  it.each(['range','target','insets','foreground'] as const)('resumes a previously running desktop after saving a %s edit',async kind=>{
    const f=await fixture();await f.select();await f.controller.startDesktop();f.controller.pauseEditing();f.controller.pauseEditing();
    expect(f.controller.view({status:'off',url:null,message:''}).desktop).toMatchObject({enabled:false,resume:'editing'});
    const settings={...f.saved()};
    if(kind==='range')settings.region={x:.1,y:.1,width:.8,height:.8};
    if(kind==='insets')settings.insets={left:1,top:2,right:3,bottom:4};
    if(kind==='foreground')settings.foregroundOnly=true;
    if(kind==='target'){f.inventory.windows.push({...target,id:'2',pid:124,title:'other'});settings.target={...settings.target!,title:'other'};}
    await f.controller.update(settings);expect(f.controller.view({status:'off',url:null,message:''}).desktop).toMatchObject({enabled:true});expect(f.controller.view({status:'off',url:null,message:''}).desktop.resume).toBeUndefined();
  });
  it('never starts a stopped desktop just because settings are edited or a drag is cancelled',async()=>{
    const f=await fixture();await f.select();f.controller.pauseEditing();await f.controller.update({...f.saved(),insets:{left:1,top:0,right:0,bottom:0}});await f.controller.cancelEditing(f.controller.view({status:'off',url:null,message:''}).desktop.editToken);expect(f.desktop.prepare).not.toHaveBeenCalled();
  });
  it('retains and revalidates automatic capture mapping when only foreground or margins change',async()=>{
    const f=await fixture();await f.select();await f.controller.detect('1');const binding=f.saved().binding;await f.controller.startDesktop();f.controller.pauseEditing();await f.controller.update({...f.saved(),binding:null,foregroundOnly:true,insets:{left:1,top:0,right:0,bottom:0}});expect(f.saved().binding?.fingerprint).toBe(binding?.fingerprint);expect(f.controller.view({status:'off',url:null,message:''}).desktop.enabled).toBe(true);
  });
  it('rolls back a requested range detection when OBS silently switches during the write', async () => {
    const f = await fixture();
    await f.select();
    const before = f.saved();
    const save = f.store.save.getMockImplementation()!;
    f.store.save.mockImplementationOnce(async settings => {
      await save(settings);
      f.scene();
    });
    await expect(f.controller.detect(target.id)).rejects.toThrow();
    expect(f.saved()).toEqual(before);
    expect(f.controller.view({ status: 'off', url: null, message: '' }).desktop.enabled).toBe(false);
  });
  it.each([[999, true], [7, false]] as const)('keeps only a valid explicit range detection after transform of item %d during saving', async (sceneItemId, survives) => {
    const f = await fixture();
    await f.select();
    let markSaving!: () => void;
    let releaseSave!: () => void;
    const saving = new Promise<void>(resolve => { markSaving = resolve; });
    const heldSave = new Promise<void>(resolve => { releaseSave = resolve; });
    const save = f.store.save.getMockImplementation()!;
    f.store.save.mockImplementationOnce(async settings => {
      markSaving();
      await heldSave;
      await save(settings);
    });
    const detection = f.controller.detect(target.id);
    const check = survives ? expect(detection).resolves.toBeUndefined() : expect(detection).rejects.toThrow();
    await saving;
    f.controller.obsChanged('SceneItemTransformChanged', { sceneName:'scene', sceneItemId });
    releaseSave();
    await check;
    expect(f.saved().binding?.item ?? null).toBe(survives ? 7 : null);
  });
  it.each([
    ['a competing minimized window', true, false],
    ['an unrelated window', false, false],
    ['a duplicate for another capture retargeted while saving', true, true],
  ] as const)('rechecks explicit detection when %s arrives during save verification', async (_description, competing, retarget) => {
    const f = await fixture();
    await f.select();
    const other = { ...target, id:'3', pid:125, title:'other', processName:'other.exe', className:'Other' };
    if (retarget) f.inventory.windows.push(other);
    let markVerification!: () => void;
    let releaseVerification!: () => void;
    const verification = new Promise<void>(resolve => { markVerification = resolve; });
    const heldVerification = new Promise<void>(resolve => { releaseVerification = resolve; });
    let holdFilter = false;
    let retargeted = false;
    const save = f.store.save.getMockImplementation()!;
    f.store.save.mockImplementationOnce(async settings => {
      await save(settings);
      holdFilter = true;
      retargeted = retarget;
    });
    const read = f.read.request;
    f.read.request = async (type, data) => {
      if (retarget && type === 'GetInputSettings' && data?.inputName === 'other') {
        return { inputSettings:{ window:retargeted ? 'other:Other:other.exe' : 'missing:Missing:missing.exe' } };
      }
      if (type === 'GetSourceFilterList' && holdFilter) {
        holdFilter = false;
        markVerification();
        await heldVerification;
      }
      const result = await read(type, data);
      if (retarget && type === 'GetSceneItemList') {
        const items = result.sceneItems as Record<string, unknown>[];
        return { sceneItems:[...items, { ...items[0], sourceName:'other', sourceUuid:'other-id', sceneItemId:8, inputKind:'window_capture' }] };
      }
      return result;
    };
    const detection = f.controller.detect(target.id);
    const check = competing ? expect(detection).rejects.toThrow() : expect(detection).resolves.toBeUndefined();
    await verification;
    const appeared = { ...(retarget ? other : target), id:'2', pid:124,
      processName:retarget ? other.processName : competing ? target.processName : 'unrelated.exe', minimized:competing };
    f.inventory.windows = [...f.inventory.windows, appeared];
    releaseVerification();
    await check;
    expect(f.saved().binding?.item ?? null).toBe(competing ? null : 7);
  });
  it('resumes the previous range when a running desktop drag is cancelled',async()=>{
    const f=await fixture();await f.select();await f.controller.startDesktop();f.controller.pauseEditing();await f.controller.cancelEditing(f.controller.view({status:'off',url:null,message:''}).desktop.editToken);expect(f.controller.view({status:'off',url:null,message:''}).desktop.enabled).toBe(true);expect(f.saved().region).toEqual({x:0,y:0,width:1,height:1});
  });
  it.each(['stop','unpublish','disconnect','shutdown'] as const)('does not resume after %s interrupts a pending edit save',async reason=>{
    const f=await fixture();await f.select();await f.controller.startDesktop();f.controller.pauseEditing();let finish!:()=>void;const normal=f.store.save.getMockImplementation()!;f.store.save.mockImplementationOnce(settings=>new Promise(resolve=>{finish=()=>{void normal(settings).then(resolve);};}));
    const saving=f.controller.update({...f.saved(),insets:{left:1,top:0,right:0,bottom:0}});await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
    if(reason==='stop')f.controller.stopDesktop();if(reason==='unpublish')f.controller.setOnline(false);if(reason==='disconnect')f.controller.obsChanged('Disconnected');const closing=reason==='shutdown'?f.controller.shutdown():undefined;
    finish();await saving;await closing;expect(f.controller.view({status:'off',url:null,message:''}).desktop.enabled).toBe(false);expect(f.controller.view({status:'off',url:null,message:''}).desktop.resume).toBeUndefined();
  });
  it('preserves the restart wish through a save failure and resumes after an explicit successful resave',async()=>{
    const f=await fixture();await f.select();await f.controller.startDesktop();f.controller.pauseEditing();const settings={...f.saved(),insets:{left:1,top:0,right:0,bottom:0}};f.store.save.mockRejectedValueOnce(new Error('disk failure'));
    await expect(f.controller.update(settings)).rejects.toThrow('disk failure');expect(f.controller.view({status:'off',url:null,message:''}).desktop.enabled).toBe(false);await f.controller.update(settings);expect(f.controller.view({status:'off',url:null,message:''}).desktop.enabled).toBe(true);
  });
  it('reports confirmation separately from a successful settings save when native restart fails',async()=>{
    const f=await fixture();await f.select();await f.controller.startDesktop();f.controller.pauseEditing();vi.mocked(f.desktop.prepare).mockRejectedValueOnce(new Error('native failure'));
    await f.controller.update({...f.saved(),insets:{left:1,top:0,right:0,bottom:0}});expect(f.saved().insets.left).toBe(1);expect(f.controller.view({status:'off',url:null,message:''}).desktop).toMatchObject({enabled:false,resume:'confirmation',message:expect.stringContaining('native failure')});await f.controller.startDesktop();expect(f.controller.view({status:'off',url:null,message:''}).desktop.resume).toBeUndefined();
  });
  it('invalidates an unbound image when a pending manual confirmation loses its range', async () => {
    const f = await fixture();
    await f.select(); await f.controller.startDesktop(); f.controller.pauseEditing();
    vi.mocked(f.desktop.prepare).mockRejectedValueOnce(new Error('native failure'));
    await f.controller.update({ ...f.saved(), insets:{ left:1,top:0,right:0,bottom:0 } });
    const view = () => f.controller.view({ status:'off', url:null, message:'' });
    expect(view().settings.binding).toBeNull();
    expect(view().desktop.resume).toBe('confirmation');
    expect(view().frame).not.toBeNull();
    f.controller.obsChanged('SceneItemTransformChanged', { sceneName:'scene', sceneItemId:7 });
    expect(view().frame).toBeNull();
    expect(view().desktop.resume).toBe('confirmation');
  });
  it('requires confirmation after a scene change during editing even once a new image exists',async()=>{
    const f=await fixture();await f.select();await f.controller.startDesktop();f.controller.pauseEditing();f.controller.obsChanged('CurrentProgramSceneChanged');f.scene();await f.frames.tick();
    await f.controller.update({...f.saved(),insets:{left:1,top:0,right:0,bottom:0}});await f.controller.cancelEditing(f.controller.view({status:'off',url:null,message:''}).desktop.editToken);expect(f.controller.view({status:'off',url:null,message:''}).desktop).toMatchObject({enabled:false,resume:'confirmation'});await f.controller.startDesktop();expect(f.controller.view({status:'off',url:null,message:''}).desktop.enabled).toBe(true);
  });
  it.each([
    ['reset', 'delayed scene event'], ['reset', 'unrelated item transform'],
    ['drag', 'delayed scene event'], ['drag', 'unrelated item transform'],
  ] as const)('resumes after a %s despite a %s', async (action, cause) => {
    const f = await fixture();
    const read = f.read.request;
    f.read.request = async (type, data) => type === 'GetSceneItemList'
      ? { sceneItems:[{ sourceName:'game', sourceUuid:'game-id', sceneItemId:7, inputKind:'game_capture', sceneItemEnabled:true,
        sceneItemTransform:{ ...transform, positionX:8, positionY:4.5, scaleX:.5, scaleY:.5 } }] }
      : read(type,data);
    await f.controller.detect(target.id);
    await f.controller.startDesktop();
    expect(f.saved().region).toEqual({ x:.25,y:.25,width:.5,height:.5 });
    f.controller.pauseEditing();
    if (cause === 'delayed scene event') f.controller.obsChanged('CurrentProgramSceneChanged', { sceneName:'old', sceneUuid:'old-id' });
    else f.controller.obsChanged('SceneItemTransformChanged', { sceneName:'scene', sceneItemId:999 });
    await f.frames.tick();
    const region = action === 'reset' ? { x:0,y:0,width:1,height:1 } : { x:.1,y:.2,width:.7,height:.6 };
    await f.controller.update({ ...f.saved(), binding:null, region });
    expect(f.saved().region).toEqual(region);
    expect(f.controller.view({ status:'off',url:null,message:'' }).desktop).toMatchObject({ enabled:true, showing:true });
  });
  it('still requires confirmation when OBS changes scenes before an edited range resumes without a notification', async () => {
    const f = await fixture();
    await f.select();
    await f.controller.startDesktop();
    f.controller.pauseEditing();
    vi.mocked(f.desktop.prepare).mockImplementationOnce(async () => { f.scene(); });
    await f.controller.update({ ...f.saved(), region:{ x:.1,y:.1,width:.8,height:.8 } });
    expect(f.controller.view({ status:'off',url:null,message:'' }).desktop).toMatchObject({
      enabled:false, resume:'confirmation', message:expect.stringContaining('映像が変わりました'),
    });
  });
  it.each(['edited range', 'initial publication'] as const)('does not activate the %s when OBS switches during its program read', async mode => {
    vi.useFakeTimers();
    const f = await fixture();
    await f.select();
    if (mode === 'edited range') {
      await f.controller.startDesktop();
      f.controller.pauseEditing();
    } else {
      await f.controller.configurePublishStart(true);
    }
    let markVideoRead!: () => void;
    let releaseVideoRead!: () => void;
    const videoRead = new Promise<void>(resolve => { markVideoRead = resolve; });
    const heldVideo = new Promise<void>(resolve => { releaseVideoRead = resolve; });
    let holdVideo = true;
    const read = f.read.request;
    f.read.request = async (type, data) => {
      if (type === 'GetVideoSettings' && holdVideo) {
        holdVideo = false;
        markVideoRead();
        await heldVideo;
      }
      return read(type, data);
    };
    const region = { x:.1, y:.1, width:.8, height:.8 };
    const saved = mode === 'edited range' ? f.controller.update({ ...f.saved(), region }) : undefined;
    if (!saved) {
      f.controller.setOnline(true);
      f.controller.preparePublishStart()();
    }
    await videoRead;
    vi.mocked(f.desktop.render).mockClear();
    f.scene();
    releaseVideoRead();
    await saved;
    await vi.advanceTimersByTimeAsync(0);
    expect(f.desktop.render).not.toHaveBeenCalledWith(expect.objectContaining({ width:expect.any(Number) }));
    if (mode === 'edited range') {
      expect(f.saved().region).toEqual(region);
      expect(f.controller.view({ status:'off', url:null, message:'' }).desktop).toMatchObject({ enabled:false, resume:'confirmation' });
    } else {
      expect(f.controller.view({ status:'online', url:null, message:'' }).desktop.enabled).toBe(false);
      expect(f.controller.publicView().accepting).toBe(true);
    }
  });
  it('retains the verified capture path across consecutive manual range edits', async () => {
    const f = await fixture();
    await f.controller.detect(target.id);
    await f.controller.startDesktop();
    await f.controller.update({ ...f.saved(), region:{ x:.1,y:.1,width:.8,height:.8 } });
    f.controller.pauseEditing();
    f.controller.obsChanged('SceneItemTransformChanged', { sceneName:'scene',sceneItemId:999 });
    const region = { x:.2,y:.2,width:.6,height:.6 };
    await f.controller.update({ ...f.saved(), region });
    expect(f.saved().region).toEqual(region);
    expect(f.controller.view({ status:'off',url:null,message:'' }).desktop).toMatchObject({ enabled:true, showing:true });
  });
  it('requires confirmation when the original capture moves during a range edit without notification', async () => {
    const f = await fixture();
    const read = f.read.request;
    let moved = false;
    f.read.request = async (type, data) => type === 'GetSceneItemList' && moved
      ? { sceneItems:[{ sourceName:'game', sourceUuid:'game-id', sceneItemId:7, inputKind:'game_capture', sceneItemEnabled:true,
        sceneItemTransform:{ ...transform, positionX:8 } }] }
      : read(type,data);
    await f.controller.detect(target.id);
    await f.controller.startDesktop();
    f.controller.pauseEditing();
    vi.mocked(f.desktop.prepare).mockImplementationOnce(async () => { moved = true; });
    await f.controller.update({ ...f.saved(), region:{ x:.1,y:.1,width:.8,height:.8 } });
    expect(f.controller.view({ status:'off',url:null,message:'' }).desktop).toMatchObject({
      enabled:false, resume:'confirmation', message:expect.stringContaining('対応範囲が変わりました'),
    });
  });
  it('keeps the edited range without binding it to an old scene after a silent switch during save', async () => {
    const f = await fixture();
    await f.select();
    await f.controller.configurePublishStart(true);
    await f.controller.startDesktop();
    f.controller.pauseEditing();
    const save = f.store.save.getMockImplementation()!;
    f.store.save.mockImplementation(async settings => {
      await save(settings);
      if (settings.binding?.scene === 'scene') f.scene();
    });
    const region = { x:.1,y:.1,width:.8,height:.8 };
    await f.controller.update({ ...f.saved(), region });
    expect(f.saved()).toMatchObject({ region, binding:null });
    expect(f.controller.view({ status:'off',url:null,message:'' }).desktop).toMatchObject({ enabled:false, resume:'confirmation' });
  });
  it.each(['before','after'] as const)('does not resume into a replacement window when the target disappears %s editing starts',async when=>{
    const f=await fixture();await f.select();await f.controller.startDesktop();if(when==='before')f.inventory.windows=[{...target,id:'2',pid:999}];f.controller.pauseEditing();if(when==='after')f.inventory.windows=[{...target,id:'2',pid:999}];await f.controller.update({...f.saved(),insets:{left:1,top:0,right:0,bottom:0}});expect(f.controller.view({status:'off',url:null,message:''}).desktop).toMatchObject({enabled:false,resume:'confirmation'});
  });
  it.each([true,false])('cancels the edit restart wish when the original target disappears from a fresh inventory (fresh=%s)',async fresh=>{
    vi.useFakeTimers();const f=await fixture();await f.select();await f.controller.startDesktop();f.controller.pauseEditing();f.inventory.windows=[];if(!fresh)f.inventory.observedAt-=2000;await vi.advanceTimersByTimeAsync(250);
    f.inventory.windows=[{...target}];f.advance(0);await f.controller.update({...f.saved(),insets:{left:1,top:0,right:0,bottom:0}});expect(f.controller.view({status:'off',url:null,message:''}).desktop.enabled).toBe(!fresh);if(fresh)expect(f.controller.view({status:'off',url:null,message:''}).desktop.resume).toBeUndefined();
  });
  it('changes an expired edit image into confirmation without reviving automatically when capture returns',async()=>{
    vi.useFakeTimers();const f=await fixture();await f.select();await f.controller.startDesktop();f.controller.pauseEditing();const generation=f.frames.generation,pauseCapture=vi.spyOn(f.frames,'tick').mockResolvedValue(undefined);f.advance(12001);await vi.advanceTimersByTimeAsync(250);
    expect(f.frames.generation).toBe(generation);expect(f.controller.view({status:'off',url:null,message:''}).desktop).toMatchObject({enabled:false,resume:'confirmation',message:expect.stringContaining('期限')});pauseCapture.mockRestore();await f.frames.tick();await f.controller.cancelEditing(f.controller.view({status:'off',url:null,message:''}).desktop.editToken);expect(f.controller.view({status:'off',url:null,message:''}).desktop.enabled).toBe(false);await f.controller.startDesktop();expect(f.controller.view({status:'off',url:null,message:''}).desktop.enabled).toBe(true);
  });
  it('keeps a manual stop authoritative while the edited native restart is preparing',async()=>{
    const f=await fixture();await f.select();await f.controller.startDesktop();f.controller.pauseEditing();let finish!:()=>void;vi.mocked(f.desktop.prepare).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));const saving=f.controller.update({...f.saved(),insets:{left:1,top:0,right:0,bottom:0}});await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));f.controller.stopDesktop();finish();await saving;expect(f.controller.view({status:'off',url:null,message:''}).desktop).toMatchObject({enabled:false});expect(f.controller.view({status:'off',url:null,message:''}).desktop.resume).toBeUndefined();
  });
  it.each([false,true])('resumes detection only if the desktop was previously running (%s)',async running=>{
    const f=await fixture();await f.select();if(running)await f.controller.startDesktop();await f.controller.detect('1');expect(f.controller.view({status:'off',url:null,message:''}).desktop.enabled).toBe(running);
  });
  it('requires confirmation if the target changes while native edit restart is preparing',async()=>{
    const f=await fixture();await f.select();await f.controller.startDesktop();f.controller.pauseEditing();let finish!:()=>void;vi.mocked(f.desktop.prepare).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));const saving=f.controller.update({...f.saved(),insets:{left:1,top:0,right:0,bottom:0}});await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));f.inventory.windows=[{...target,id:'2',pid:999}];finish();await saving;expect(f.controller.view({status:'off',url:null,message:''}).desktop).toMatchObject({enabled:false,resume:'confirmation'});
  });
  it('times out edited native preparation and never revives its late completion',async()=>{
    vi.useFakeTimers();const f=await fixture();await f.select();await f.controller.startDesktop();f.controller.pauseEditing();let finish!:()=>void;vi.mocked(f.desktop.prepare).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));const saving=f.controller.update({...f.saved(),insets:{left:1,top:0,right:0,bottom:0}});await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));await vi.advanceTimersByTimeAsync(16000);await saving;expect(f.controller.view({status:'off',url:null,message:''}).desktop).toMatchObject({enabled:false,resume:'confirmation',message:expect.stringContaining('時間切れ')});finish();await vi.advanceTimersByTimeAsync(0);expect(f.controller.view({status:'off',url:null,message:''}).desktop.enabled).toBe(false);
  });
  it.each([false,true])('invalidates a manual monitor when its parent group moves (stopped=%s)',async stopped=>{
    const f=await fixture();f.inventory.windows=[{...target,id:'display:one',pid:0,title:'one',processName:'@display',className:'@display',width:32,height:18}];const normal=f.read.request;
    f.read.request=async(type,data)=>type==='GetInputSettings'?{inputSettings:{monitor_id:'one'}}:type==='GetSceneItemList'?{sceneItems:[{sourceName:'group',sourceUuid:'group-id',sceneItemId:1,isGroup:true,sceneItemEnabled:true,sceneItemTransform:transform}]}:type==='GetGroupSceneItemList'?{sceneItems:[{sourceName:'screen',sourceUuid:'screen-id',sceneItemId:7,inputKind:'monitor_capture',sceneItemEnabled:true,sceneItemTransform:transform}]}:normal(type,data);
    await f.controller.update({...defaultReactionSettings(),target:{title:'one',processName:'@display',className:'@display'}});await f.controller.startDesktop();if(stopped)f.controller.stopDesktop();f.controller.obsChanged('SceneItemTransformChanged',{sceneName:'scene',sceneItemId:1});const state=f.controller.view({status:'off',url:null,message:''});expect(state.settings.binding?.context).toBe('invalid');expect(state.desktop.enabled).toBe(false);
  });
  it('maps a manually selected legacy cropped monitor through the original source, not the visible red rectangle',async()=>{
    const f=await fixture();f.inventory.windows=[{...target,id:'display:one',pid:0,title:'one',processName:'@display',className:'@display',width:32,height:18}];const normal=f.read.request;
    f.read.request=async(type,data)=>type==='GetInputSettings'?{inputSettings:{monitor_id:0}}:type==='GetSceneItemList'?{sceneItems:[{sourceName:'screen',sourceUuid:'screen-id',sceneItemId:1,inputKind:'monitor_capture',sceneItemEnabled:true,sceneItemTransform:{...transform,cropLeft:16}}]}:normal(type,data);
    await f.controller.update({...defaultReactionSettings(),target:{title:'one',processName:'@display',className:'@display'},region:{x:0,y:0,width:.5,height:1}});await f.controller.startDesktop();f.controller.setOnline(true);
    expect(f.desktop.render).toHaveBeenLastCalledWith({x:116,y:200,width:32,height:18});await f.controller.react({kind:'point',frameId:f.frames.metadata()!.id,x:.25,y:.5});expect(f.desktop.marker).toHaveBeenLastCalledWith(expect.objectContaining({x:.75}));expect(f.controller.view({status:'online',url:null,message:''}).settings.binding?.input).toBe('screen-id');
  });
  it('keeps a saved monitor pinned on a new publication and waits for a fresh inventory before deciding it is absent',async()=>{
    const f=await fixture();const monitor={...target,id:'display:one',pid:0,title:'one',processName:'@display',className:'@display',displayName:'DISPLAY1',width:32,height:18};f.inventory.windows=[monitor];monitorInput(f);const normal=f.read.request;
    f.read.request=async(type,data)=>type==='GetInputSettings'?{inputSettings:{monitor_id:'DISPLAY1'}}:type==='GetSceneItemList'?{sceneItems:[{sourceName:'screen',sourceUuid:'screen-id',sceneItemId:1,inputKind:'monitor_capture',sceneItemEnabled:true,sceneItemTransform:transform}]}:normal(type,data);
    await f.controller.configurePublishStart(true);let published=f.controller.preparePublishStart();f.controller.setOnline(true);published();await new Promise(r=>setTimeout(r,80));expect(f.saved().target?.title).toBe('one');f.controller.setOnline(false);
    f.inventory.windows=[];f.inventory.observedAt=0;published=f.controller.preparePublishStart();f.controller.setOnline(true);published();expect(f.controller.view({status:'online',url:null,message:''}).desktop.message).toContain('自動確認');
    f.inventory.windows=[{...monitor,id:'display:two',title:'two'}];f.advance(500);await f.controller.react({kind:'heart'});await new Promise(r=>setTimeout(r,80));const state=f.controller.view({status:'online',url:null,message:''});expect(state.desktop.enabled).toBe(false);expect(state.settings.target?.title).toBe('one');expect(state.desktop.message).toContain('切断');
  });
  it('pins the monitor identity while automatic OBS range recalculation is waiting',async()=>{
    const f=await fixture();const monitor={...target,id:'display:one',pid:0,title:'one',processName:'@display',className:'@display',displayName:'DISPLAY1',width:32,height:18};f.inventory.windows=[monitor];monitorInput(f);const normal=f.read.request;
    f.read.request=async(type,data)=>type==='GetInputSettings'?{inputSettings:{monitor_id:'DISPLAY1'}}:type==='GetSceneItemList'?{sceneItems:[{sourceName:'screen',sourceUuid:'screen-id',sceneItemId:1,inputKind:'monitor_capture',sceneItemEnabled:true,sceneItemTransform:transform}]}:normal(type,data);
    await f.controller.configurePublishStart(true);const published=f.controller.preparePublishStart();f.controller.setOnline(true);published();await new Promise(r=>setTimeout(r,80));expect(f.controller.view({status:'online',url:null,message:''}).desktop.enabled).toBe(true);
    f.controller.obsChanged('SceneItemTransformChanged',{sceneName:'scene',sceneItemId:1});f.inventory.windows=[{...monitor,id:'display:two',title:'two'}];f.advance(500);await f.frames.tick();await new Promise(r=>setTimeout(r,350));const state=f.controller.view({status:'online',url:null,message:''});expect(state.desktop.enabled).toBe(false);expect(state.settings.target?.title).toBe('one');
  });
  it('starts the saved monitor on republication even when another monitor capture is visible', async () => {
    const f = await fixture();
    const monitor = { ...target, id:'display:one', pid:0, title:'one', processName:'@display', className:'@display', width:32, height:18 };
    f.inventory.windows = [monitor];
    monitorInput(f);
    await f.controller.detect(monitor.id);
    await f.controller.configurePublishStart(true);
    const other = { ...monitor, id:'display:two', title:'two', x:132 };
    f.inventory.windows.push(other);
    const read = f.read.request;
    f.read.request = async (type,data) => {
      if (type === 'GetInputSettings') return { inputSettings:{ monitor_id:data?.inputName === 'second' ? 'two' : 'one' } };
      if (type === 'GetSceneItemList') return { sceneItems:[
        { sourceName:'screen', sourceUuid:'screen-id', sceneItemId:1, inputKind:'monitor_capture', sceneItemEnabled:true, sceneItemTransform:transform },
        { sourceName:'second', sourceUuid:'second-id', sceneItemId:2, inputKind:'monitor_capture', sceneItemEnabled:true, sceneItemTransform:transform },
      ] };
      return read(type,data);
    };
    const published = f.controller.preparePublishStart();
    f.controller.setOnline(true); published();
    await vi.waitFor(() => expect(f.controller.view({status:'online',url:null,message:''}).desktop.enabled).toBe(true));
    expect(f.saved().target?.title).toBe('one');
  });
  it('automatically selects a cropped monitor and recalculates after OBS cropping changes',async()=>{
    const f=await fixture();f.inventory.windows=[{...target,id:'display:one',pid:0,title:'one',processName:'@display',className:'@display',width:32,height:18}];let crop=8;
    const normal=f.read.request;f.read.request=async(type,data)=>type==='GetInputSettings'?{inputSettings:{monitor_id:'one'}}:type==='GetSceneItemList'?{sceneItems:[{sourceName:'screen',sourceUuid:'screen-id',sceneItemId:1,inputKind:'monitor_capture',sceneItemEnabled:true,sceneItemTransform:{...transform,cropLeft:crop}}]}:normal(type,data);
    await f.controller.configurePublishStart(true);const published=f.controller.preparePublishStart();f.controller.setOnline(true);published();await new Promise(r=>setTimeout(r,80));expect(f.controller.view({status:'online',url:null,message:''}).desktop.enabled).toBe(true);expect(f.saved().target?.processName).toBe('@display');
    crop=4;f.controller.obsChanged('SceneItemTransformChanged',{sceneName:'scene',sceneItemId:1});f.advance(500);await f.frames.tick();await new Promise(r=>setTimeout(r,350));expect(f.controller.view({status:'online',url:null,message:''}).desktop.showing).toBe(true);expect(f.saved().region.width).toBe(.875);
  });
  it('tracks a cropped monitor, ignores window-only options, and stops on disconnect without selecting another screen',async()=>{
    const f=await fixture();const monitor:ReactionWindow={...target,id:'display:one',pid:0,title:'one',processName:'@display',className:'@display',displayName:'DISPLAY1',x:-32,y:0,width:32,height:18};
    f.inventory.windows=[monitor];monitorInput(f);const normal=f.read.request;f.read.request=async(type,data)=>type==='GetInputSettings'?{inputSettings:{monitor_id:'one'}}:type==='GetSceneItemList'?{sceneItems:[{sourceName:'screen',sourceUuid:'screen-id',sceneItemId:1,inputKind:'monitor_capture',sceneItemEnabled:true,sceneItemTransform:{...transform,cropLeft:8,cropTop:2,cropRight:4,cropBottom:4}}]}:normal(type,data);
    await f.controller.update({...defaultReactionSettings(),target:{title:'one',processName:'@display',className:'@display'},foregroundOnly:true,insets:{left:20,right:20,top:20,bottom:20}});
    await f.controller.detect(monitor.id);await f.controller.startDesktop();f.controller.setOnline(true);expect(f.controller.view({status:'online',url:null,message:''}).desktop.showing).toBe(true);
    await f.controller.react({kind:'point',frameId:f.frames.metadata()!.id,x:.25,y:.25});expect(f.desktop.marker).toHaveBeenCalled();
    f.inventory.windows=[{...monitor,id:'display:two',title:'two'}];f.advance(250);await f.controller.react({kind:'heart'});expect(f.controller.view({status:'online',url:null,message:''}).desktop.enabled).toBe(false);expect(f.controller.view({status:'online',url:null,message:''}).selectedId).toBe('');
  });
  it('invalidates a manual monitor mapping when resolution changes',async()=>{
    const f=await fixture();const monitor={...target,id:'display:one',pid:0,title:'one',processName:'@display',className:'@display'};f.inventory.windows=[monitor];monitorInput(f);await f.controller.update({...defaultReactionSettings(),target:{title:'one',processName:'@display',className:'@display'}});await f.controller.startDesktop();f.controller.setOnline(true);
    f.inventory.windows=[{...monitor,width:1280}];f.advance(250);await f.controller.react({kind:'heart'});const state=f.controller.view({status:'online',url:null,message:''});expect(state.desktop.showing).toBe(false);expect(state.settings.binding?.context).toBe('invalid');await expect(f.controller.startDesktop()).rejects.toThrow();
  });
  it('invalidates a confirmed monitor even while desktop display is stopped',async()=>{
    const f=await fixture();const monitor={...target,id:'display:one',pid:0,title:'one',processName:'@display',className:'@display'};f.inventory.windows=[monitor];monitorInput(f);await f.controller.update({...defaultReactionSettings(),target:{title:'one',processName:'@display',className:'@display'}});await f.controller.configurePublishStart(true);f.controller.stopDesktop();
    f.inventory.windows=[{...monitor,width:1280}];await expect(f.controller.startDesktop()).rejects.toThrow('モニター');expect(f.controller.view({status:'off',url:null,message:''}).settings.binding?.context).toBe('invalid');
  });
  it('rolls back manual monitor confirmation when geometry changes during saving',async()=>{
    const f=await fixture();const monitor={...target,id:'display:one',pid:0,title:'one',processName:'@display',className:'@display'};f.inventory.windows=[monitor];monitorInput(f);await f.controller.update({...defaultReactionSettings(),target:{title:'one',processName:'@display',className:'@display'}});
    f.store.save.mockImplementationOnce(async()=>{f.inventory.windows=[{...monitor,width:1280}];});await expect(f.controller.configurePublishStart(true)).rejects.toThrow();expect(f.controller.view({status:'off',url:null,message:''}).settings.autoStartOnPublish).toBe(false);
  });
  it('rejects a point if its delivery tick discovers a changed monitor geometry',async()=>{
    const f=await fixture();const monitor={...target,id:'display:one',pid:0,title:'one',processName:'@display',className:'@display'};f.inventory.windows=[monitor];monitorInput(f);await f.controller.update({...defaultReactionSettings(),target:{title:'one',processName:'@display',className:'@display'}});await f.controller.startDesktop();f.controller.setOnline(true);const frameId=f.frames.metadata()!.id;f.inventory.windows=[{...monitor,x:99}];
    await expect(f.controller.react({kind:'point',frameId,x:.5,y:.5})).rejects.toThrow('対応範囲');expect(f.controller.publicView().counts.point).toBe(0);
  });
  it('rejects monitor geometry changing while native overlay preparation is pending',async()=>{
    const f=await fixture();const monitor={...target,id:'display:one',pid:0,title:'one',processName:'@display',className:'@display'};f.inventory.windows=[monitor];monitorInput(f);await f.controller.update({...defaultReactionSettings(),target:{title:'one',processName:'@display',className:'@display'}});
    f.desktop.prepare=async()=>{f.inventory.windows=[{...monitor,x:99}];};await expect(f.controller.startDesktop()).rejects.toThrow('対象候補');
  });
  it('accepts only a fixed cheer, shares request limits, and forwards the same event to desktop and OBS without needing a frame',async()=>{
    const f=await fixture();await f.select();await f.controller.startDesktop();f.controller.setOnline(true);
    const events:unknown[]=[];const off=f.controller.subscribe((type,data)=>{if(type==='reaction')events.push(data);});
    const identity=await f.cookie();expect((await f.send(identity,{kind:'cheer',text:'custom'})).status).toBe(400);
    f.advance(800);const result=await f.send(identity,{kind:'cheer'});expect(result.status).toBe(200);expect(result.body.kind).toBe('cheer');expect(f.controller.publicView().counts.cheer).toBe(1);
    expect(f.desktop.reaction).toHaveBeenLastCalledWith(events[0]);expect(events[0]).toMatchObject({kind:'cheer',accepting:true});
    expect((await f.send(identity,{kind:'cheer'})).status).toBe(429);
    f.controller.frames.invalidate('OBS unavailable');f.advance(1000);expect((await f.send(identity,{kind:'cheer'})).status).toBe(200);
    f.controller.setOnline(false);await expect(f.controller.react({kind:'cheer'})).rejects.toThrow();off();
  });
  it('accepts framed areas and sends desktop clipping without exposing that clipping publicly',async()=>{
    const f=await fixture();await f.select();await f.controller.startDesktop();f.controller.setOnline(true);
    const area={x:.1,y:.2,width:.3,height:.4};const result=await f.controller.react({kind:'area',shape:'ellipse',area,frameId:f.frames.metadata()!.id});
    expect(result).toMatchObject({kind:'area',shape:'ellipse',area});expect(result).not.toHaveProperty('clip');
    expect(f.desktop.reaction).toHaveBeenLastCalledWith(expect.objectContaining({kind:'area',area,clip:{x:0,y:0,width:1,height:1}}));
    expect(f.controller.publicView().counts.area).toBe(1);
  });
  it.each([{shape:'script'},{area:{x:0,y:0,width:.001,height:.5}},{area:{x:.8,y:0,width:.5,height:.5}},{area:{x:0,y:0,width:NaN,height:.5}},{extra:true}])('rejects invalid area reactions %j',async override=>{
    const f=await fixture();f.controller.setOnline(true);await expect(f.controller.react({kind:'area',shape:'rectangle',area:{x:0,y:0,width:.5,height:.5},frameId:f.frames.metadata()!.id,...override})).rejects.toThrow();expect(f.controller.publicView().sequence).toBe(0);
  });
  it('rejects stale area frames and cancels an area sent across publication stop',async()=>{
    const f=await fixture();f.controller.setOnline(true);const payload={kind:'area',shape:'rectangle',area:{x:0,y:0,width:.5,height:.5},frameId:f.frames.metadata()!.id};
    f.frames.invalidate();await expect(f.controller.react(payload)).rejects.toThrow();await f.frames.tick();payload.frameId=f.frames.metadata()!.id;
    let finish!:(value:Record<string,unknown>)=>void;vi.mocked(f.read.request).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));const sent=f.controller.react(payload),rejected=expect(sent).rejects.toThrow();f.controller.setOnline(false);finish({currentSceneCollectionName:'collection'});await rejected;expect(f.desktop.reaction).not.toHaveBeenCalled();
  });
  it('retries minimization during discovery after the window is restored',async()=>{
    vi.useFakeTimers();const f=await fixture(),normal=vi.mocked(f.read.request).getMockImplementation()!;let first=true;
    vi.mocked(f.read.request).mockImplementation(async(type,data)=>{if(type==='GetInputSettings'&&first){first=false;f.inventory.windows[0].minimized=true;}return normal(type,data);});
    await f.controller.configurePublishStart(true);f.controller.setOnline(true);f.controller.preparePublishStart()();await vi.advanceTimersByTimeAsync(0);
    expect(f.desktop.prepare).not.toHaveBeenCalled();f.inventory.windows[0].minimized=false;f.advance(500);await vi.advanceTimersByTimeAsync(500);
    expect(f.controller.view({status:'online',url:null,message:''}).desktop.enabled).toBe(true);
  });
  it('retries a temporary missing OBS input after discovery starts',async()=>{
    vi.useFakeTimers();const f=await fixture(),normal=vi.mocked(f.read.request).getMockImplementation()!;let first=true;
    vi.mocked(f.read.request).mockImplementation(async(type,data)=>{if(type==='GetInputSettings'&&first){first=false;f.controller.obsChanged('SceneItemRemoved',{sceneName:'scene',sceneItemId:7});throw new Error('OBS_VISUAL_UNAVAILABLE');}return normal(type,data);});
    await f.controller.configurePublishStart(true);f.controller.setOnline(true);f.controller.preparePublishStart()();await vi.advanceTimersByTimeAsync(0);
    f.advance(500);await vi.advanceTimersByTimeAsync(500);expect(f.controller.view({status:'online',url:null,message:''}).desktop.enabled).toBe(true);
  });
  it('rolls back and retries when the target is minimized during automatic persistence',async()=>{
    vi.useFakeTimers();const f=await fixture();await f.controller.configurePublishStart(true);const save=f.store.save.getMockImplementation()!;
    f.store.save.mockImplementationOnce(async settings=>{f.inventory.windows[0].minimized=true;await save(settings);});
    f.controller.setOnline(true);f.controller.preparePublishStart()();await vi.advanceTimersByTimeAsync(0);expect(f.saved().target).toBeNull();expect(vi.mocked(f.desktop.render).mock.calls.every(([bounds])=>bounds===null)).toBe(true);
    f.inventory.windows[0].minimized=false;f.advance(500);await vi.advanceTimersByTimeAsync(500);expect(f.controller.view({status:'online',url:null,message:''}).desktop.enabled).toBe(true);
  });
  it('bounds persistent temporary OBS failures by the original deadline',async()=>{
    vi.useFakeTimers();const f=await fixture(),normal=vi.mocked(f.read.request).getMockImplementation()!;let reads=0;
    vi.mocked(f.read.request).mockImplementation((type,data)=>{if(type==='GetInputSettings'){reads++;return Promise.reject(new Error('OBS_VISUAL_UNAVAILABLE'));}return normal(type,data);});
    await f.controller.configurePublishStart(true);f.controller.setOnline(true);f.controller.preparePublishStart()();await vi.advanceTimersByTimeAsync(0);
    for(let i=0;i<32;i++){f.advance(500);await vi.advanceTimersByTimeAsync(500);}expect(f.controller.view({status:'online',url:null,message:''}).desktop.message).toContain('時間切れ');
    const stopped=reads;f.advance(1000);await vi.advanceTimersByTimeAsync(1000);expect(reads).toBe(stopped);expect(reads).toBeGreaterThan(1);expect(f.desktop.prepare).not.toHaveBeenCalled();
  });
  it('ignores hundreds of unrelated transform events during both detection scans',async()=>{
    vi.useFakeTimers();const f=await fixture(),normal=vi.mocked(f.read.request).getMockImplementation()!;
    vi.mocked(f.read.request).mockImplementation(async(type,data)=>{if(type==='GetInputSettings')for(let i=0;i<100;i++)f.controller.obsChanged('SceneItemTransformChanged',{sceneName:'scene',sceneItemId:999});return normal(type,data);});
    await f.controller.configurePublishStart(true);f.controller.setOnline(true);f.controller.preparePublishStart()();await vi.advanceTimersByTimeAsync(0);
    expect(f.controller.view({status:'online',url:null,message:''}).desktop.enabled).toBe(true);
  });
  it.each(['preparing','running'])('invalidates when another capture becomes a match while %s',async phase=>{
    const f=await fixture(),normal=vi.mocked(f.read.request).getMockImplementation()!;let matches=false;
    vi.mocked(f.read.request).mockImplementation(async(type,data)=>{const r=await normal(type,data);if(type==='GetSceneItemList')r.sceneItems=[...(r.sceneItems as Record<string,unknown>[]),{sourceName:'other',sourceUuid:'other-id',sceneItemId:8,inputKind:'window_capture',sceneItemEnabled:true,sceneItemTransform:transform}];if(type==='GetInputSettings'&&data?.inputName==='other')return {inputSettings:{window:matches?'game:Game:game.exe':'missing:Missing:missing.exe'}};return r;});
    await f.controller.detect('1');const change=()=>{matches=true;f.controller.obsChanged('InputSettingsChanged',{inputName:'other',inputUuid:'other-id'});};
    if(phase==='preparing'){vi.mocked(f.desktop.prepare).mockImplementation(async()=>{change();});await expect(f.controller.startDesktop(true)).rejects.toThrow();}
    else {await f.controller.startDesktop(true);change();}
    expect(f.controller.view({status:'online',url:null,message:''}).desktop.enabled).toBe(false);
  });
  it('retries a late game launch within the original deadline',async()=>{
    vi.useFakeTimers();const f=await fixture();await f.controller.configurePublishStart(true);f.inventory.windows=[];f.controller.setOnline(true);f.controller.preparePublishStart()();
    await vi.advanceTimersByTimeAsync(0);f.inventory.windows=[{...target}];f.advance(500);await vi.advanceTimersByTimeAsync(500);
    expect(f.controller.view({status:'online',url:null,message:''}).desktop.enabled).toBe(true);
  });
  it('ignores unrelated window title changes during automatic detection',async()=>{
    const f=await fixture();f.inventory.windows.push({...target,id:'music',pid:999,title:'song',processName:'music.exe',className:'Music'});
    const normal=vi.mocked(f.read.request).getMockImplementation()!;vi.mocked(f.read.request).mockImplementation(async(type,data)=>{if(type==='GetInputSettings')f.inventory.windows[1].title+=' next';return normal(type,data);});
    await f.controller.configurePublishStart(true);f.controller.setOnline(true);f.controller.preparePublishStart()();
    await vi.waitFor(()=>expect(f.controller.view({status:'online',url:null,message:''}).desktop.enabled).toBe(true));
    const generation=f.frames.generation;f.controller.obsChanged('SceneItemTransformChanged',{sceneName:'scene',sceneItemId:999});
    expect(f.frames.generation).toBe(generation);expect(f.controller.view({status:'online',url:null,message:''}).desktop.enabled).toBe(true);
  });
  it.each(['stop','unpublish','edit','disconnect'])('does not resume a retry after %s',async action=>{
    vi.useFakeTimers();const f=await fixture();await f.controller.configurePublishStart(true);f.inventory.windows=[];f.controller.setOnline(true);f.controller.preparePublishStart()();await vi.advanceTimersByTimeAsync(0);
    if(action==='stop')f.controller.stopDesktop();if(action==='unpublish')f.controller.setOnline(false);if(action==='edit')await f.controller.update({...f.saved(),insets:{left:1,right:0,top:0,bottom:0}});if(action==='disconnect')f.controller.obsChanged('Disconnected');
    f.inventory.windows=[{...target}];f.advance(1000);await f.frames.tick();await vi.advanceTimersByTimeAsync(1000);
    expect(f.controller.view({status:'online',url:null,message:''}).desktop.enabled).toBe(false);expect(f.desktop.prepare).not.toHaveBeenCalled();
  });
  it('does not extend the overall retry deadline after an OBS change',async()=>{
    vi.useFakeTimers();const f=await fixture();await f.controller.configurePublishStart(true);vi.mocked(f.desktop.prepare).mockImplementation(()=>new Promise(()=>{}));f.controller.setOnline(true);f.controller.preparePublishStart()();await vi.advanceTimersByTimeAsync(0);
    for(let i=0;i<8;i++){f.advance(500);await vi.advanceTimersByTimeAsync(500);}f.controller.obsChanged('SceneItemTransformChanged',{sceneName:'scene',sceneItemId:7});
    for(let i=8;i<31;i++){f.advance(500);await vi.advanceTimersByTimeAsync(500);}
    expect(f.controller.view({status:'online',url:null,message:''}).desktop.preparing).toBe(true);
    f.advance(500);await vi.advanceTimersByTimeAsync(500);
    expect(f.controller.view({status:'online',url:null,message:''}).desktop.message).toContain('時間切れ');expect(f.controller.view({status:'online',url:null,message:''}).desktop.enabled).toBe(false);
  });
  it('invalidates a nested ancestor transform while ignoring unrelated input changes',async()=>{
    const f=await fixture(),normal=vi.mocked(f.read.request).getMockImplementation()!;
    vi.mocked(f.read.request).mockImplementation(async(type,data)=>{
      if(type==='GetGroupSceneItemList')return normal('GetSceneItemList');
      const value=await normal(type,data);if(type==='GetSceneItemList')value.sceneItems=[{sourceName:'group',sourceUuid:'group-id',sceneItemId:2,isGroup:true,sceneItemEnabled:true,sceneItemTransform:transform}];return value;
    });
    await f.controller.detect('1');await f.controller.startDesktop();f.controller.setOnline(true);
    const gen=f.frames.generation;f.controller.obsChanged('SourceFilterEnableStateChanged',{sourceName:'other'});expect(f.frames.generation).toBe(gen);
    f.controller.obsChanged('SceneItemTransformChanged',{sceneName:'group',sceneItemId:7});expect(f.frames.generation).toBeGreaterThan(gen);expect(f.controller.view({status:'online',url:null,message:''}).desktop.enabled).toBe(false);
  });
  it('cancels a manual confirmation on an OBS edit even if its scoped reader stays valid',async()=>{
    const f=await fixture();await f.select();let finish!:()=>void;const save=f.store.save.getMockImplementation()!;
    f.store.save.mockImplementationOnce(settings=>new Promise<void>(resolve=>{finish=()=>{void save(settings).then(resolve);};}));
    const enabling=f.controller.configurePublishStart(true),rejected=expect(enabling).rejects.toThrow();await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
    f.controller.obsChanged('SceneItemTransformChanged',{sceneName:'scene',sceneItemId:7});expect(f.read.valid()).toBe(true);finish();await rejected;expect(f.saved().autoStartOnPublish).toBe(false);
  });
  it('cancels a nested initial start when the child changes during native preparation',async()=>{
    const f=await fixture(),normal=vi.mocked(f.read.request).getMockImplementation()!;
    vi.mocked(f.read.request).mockImplementation(async(type,data)=>{if(type==='GetGroupSceneItemList')return normal('GetSceneItemList');const r=await normal(type,data);if(type==='GetSceneItemList')r.sceneItems=[{sourceName:'group',sourceUuid:'group-id',sceneItemId:2,isGroup:true,sceneItemEnabled:true,sceneItemTransform:transform}];return r;});
    await f.controller.detect('1');let finish!:()=>void;vi.mocked(f.desktop.prepare).mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    const starting=f.controller.startDesktop(),rejected=expect(starting).rejects.toThrow();await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
    f.controller.obsChanged('SceneItemTransformChanged',{sceneName:'group',sceneItemId:7});finish();await rejected;expect(f.controller.view({status:'off',url:null,message:''}).desktop.enabled).toBe(false);
  });
  it('does not persist an automatic choice if a second OBS capture gains its window during save',async()=>{
    const f=await fixture(),normal=vi.mocked(f.read.request).getMockImplementation()!;
    vi.mocked(f.read.request).mockImplementation(async(type,data)=>{const r=await normal(type,data);if(type==='GetSceneItemList')r.sceneItems=[...(r.sceneItems as Record<string,unknown>[]),{sourceName:'other',sourceUuid:'other-id',sceneItemId:8,inputKind:'window_capture',sceneItemEnabled:true,sceneItemTransform:transform}];if(type==='GetInputSettings'&&data?.inputName==='other')return {inputSettings:{window:'other:Other:other.exe'}};return r;});
    await f.controller.configurePublishStart(true);let finish!:()=>void;const save=f.store.save.getMockImplementation()!;f.store.save.mockImplementationOnce(settings=>new Promise<void>(resolve=>{finish=()=>{void save(settings).then(resolve);};}));
    f.controller.setOnline(true);f.controller.preparePublishStart()();await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
    f.inventory.windows.push({...target,id:'other',pid:888,title:'other',className:'Other',processName:'other.exe'});finish();
    await vi.waitFor(async()=>{f.advance(500);await f.frames.tick();expect(f.controller.view({status:'online',url:null,message:''}).desktop.message).toContain('複数');});expect(f.saved().target).toBeNull();expect(vi.mocked(f.desktop.render).mock.calls.every(([bounds])=>bounds===null)).toBe(true);
  });
  it('maps points and all-canvas particles through a cropped source without stretching',async()=>{
    const f=await fixture(),normal=vi.mocked(f.read.request).getMockImplementation()!;vi.mocked(f.read.request).mockImplementation(async(type,data)=>{const r=await normal(type,data);if(type==='GetSceneItemList')for(const item of r.sceneItems as Record<string,unknown>[])item.sceneItemTransform={...transform,cropLeft:8};return r;});
    await f.controller.detect('1');await f.controller.startDesktop();f.controller.setOnline(true);
    expect(f.saved().region).toEqual({x:0,y:0,width:.75,height:1});expect(f.desktop.render).toHaveBeenLastCalledWith({x:260,y:200,width:640,height:360});
    await f.controller.react({kind:'point',frameId:f.frames.metadata()!.id,x:.125,y:.5});expect(f.desktop.marker).toHaveBeenLastCalledWith({x:.375,y:.5,canvasWidth:32,region:{x:-.25,y:0,width:1,height:1}, intent:'look', at:expect.any(Number)});
    await f.controller.react({kind:'heart'});await f.controller.react({kind:'clap'});expect(f.desktop.reaction).toHaveBeenCalledTimes(2);
  });
  it('rechecks all candidate classes after native preparation',async()=>{
    const f=await fixture(),normal=vi.mocked(f.read.request).getMockImplementation()!;
    vi.mocked(f.read.request).mockImplementation(async(type,data)=>{const r=await normal(type,data);if(type==='GetSceneItemList')r.sceneItems=[...(r.sceneItems as Record<string,unknown>[]),{sourceName:'other',sourceUuid:'other-id',sceneItemId:8,inputKind:'window_capture',sceneItemEnabled:true,sceneItemTransform:transform}];if(type==='GetInputSettings'&&data?.inputName==='other')return {inputSettings:{window:'other:Other:other.exe'}};return r;});
    await f.controller.detect('1');let finish!:()=>void;vi.mocked(f.desktop.prepare).mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    const start=f.controller.startDesktop(true),rejected=expect(start).rejects.toThrow('対象候補');await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
    f.inventory.windows.push({...target,id:'other',pid:888,title:'other',className:'Other',processName:'other.exe'});finish();await rejected;expect(f.controller.view({status:'online',url:null,message:''}).desktop.enabled).toBe(false);
  });
  it('ignores unrelated transform events received during initial discovery',async()=>{
    const f=await fixture(),normal=vi.mocked(f.read.request).getMockImplementation()!;vi.mocked(f.read.request).mockImplementation(async(type,data)=>{if(type==='GetInputSettings')f.controller.obsChanged('SceneItemTransformChanged',{sceneName:'scene',sceneItemId:999});return normal(type,data);});
    await f.controller.configurePublishStart(true);f.controller.setOnline(true);f.controller.preparePublishStart()();await vi.waitFor(()=>expect(f.controller.view({status:'online',url:null,message:''}).desktop.enabled).toBe(true));
  });
  it('selects the unique OBS target and range on publication without prior target selection',async()=>{
    const f=await fixture(); await f.controller.configurePublishStart(true); f.controller.setOnline(true); f.controller.preparePublishStart()();
    await vi.waitFor(()=>expect(f.controller.view({status:'online',url:null,message:''}).desktop.enabled).toBe(true));
    expect(f.saved().target?.title).toBe('game');expect(f.saved().binding?.fingerprint).toMatch(/^[a-f0-9]{64}$/);expect(f.saved().region).toEqual({x:0,y:0,width:1,height:1});
  });
  it('recalculates automatic bounds and resumes after scene, transform and rename changes',async()=>{
    const f=await fixture();await f.controller.configurePublishStart(true);f.controller.setOnline(true);f.controller.preparePublishStart()();
    const enabled=()=>f.controller.view({status:'online',url:null,message:''}).desktop.enabled;
    await vi.waitFor(()=>expect(enabled()).toBe(true));
    for(const event of ['SceneItemTransformChanged','CurrentProgramSceneChanged','SceneNameChanged']){
      if(event==='CurrentProgramSceneChanged')f.scene();if(event==='SceneNameChanged')f.rename();
      const old=f.frames.metadata()!.id;f.controller.obsChanged(event,{sceneName:event==='SceneNameChanged'?'renamed':'scene',oldSceneName:'other',sceneItemId:7});
      if (event !== 'CurrentProgramSceneChanged') expect(enabled()).toBe(false);
      await f.frames.tick();expect(f.frames.get(old)).toBeNull();
      await vi.waitFor(()=>expect(enabled()).toBe(true));expect(f.saved().binding?.scene).toBe(f.frames.latest()!.scene);
    }
  });
  it.each([
    ['no-image', '最新画像', 9000],
    ['window-missing', '時間切れ', 17000],
    ['window-minimized', '時間切れ', 17000],
    ['zero-size', '時間切れ', 17000],
    ['fullscreen-game', '特定のウィンドウ', 1000],
    ['ambiguous', '複数', 1000],
    ['rotated', '未対応', 1000],
    ['off-canvas', '画面内にありません', 1000],
    ['missing-monitor-id', '対象モニターを特定できません', 1000],
  ] as const)('keeps following after a scene with %s fails', async (mode, reason, dwell) => {
    vi.useFakeTimers();
    const f = await fixture();
    const publication = { status:'online', url:null, message:'' } as const;
    const read = f.read.request;
    let inB = false;
    let scans = 0;
    const tick = async (ms: number) => {
      for (let elapsed = 0; elapsed < ms; elapsed += 500) {
        f.advance(500);
        await vi.advanceTimersByTimeAsync(500);
      }
    };
    f.read.request = async (type, data) => {
      if (type === 'GetSourceScreenshot' && inB && mode === 'no-image') throw new Error('BUSY');
      if (type === 'GetInputSettings' && data?.inputName === 'b') {
        if (mode === 'fullscreen-game') return { inputSettings:{ capture_mode:'any_fullscreen' } };
        if (mode === 'missing-monitor-id') return { inputSettings:{ monitor_id:'absent' } };
        return { inputSettings:{ window:mode === 'window-missing' ? 'other:Other:other.exe' : 'game:Game:game.exe' } };
      }
      if (type === 'GetSceneItemList' && data?.sceneName === 'other') {
        scans++;
        const geometry = { ...transform };
        if (mode === 'rotated') geometry.rotation = 90;
        if (mode === 'off-canvas') geometry.positionX = 64;
        if (mode === 'zero-size') geometry.sourceWidth = geometry.sourceHeight = 0;
        const item = { sourceName:'b', sourceUuid:'b-id', sceneItemId:1, sceneItemEnabled:true,
          inputKind:mode === 'fullscreen-game' ? 'game_capture' : mode === 'missing-monitor-id' ? 'monitor_capture' : 'window_capture',
          sceneItemTransform:geometry };
        return { sceneItems:mode === 'ambiguous' ? [item, { ...item, sceneItemId:2 }] : [item] };
      }
      return read(type, data);
    };
    await f.controller.configurePublishStart(true);
    f.controller.setOnline(true);
    f.controller.preparePublishStart()();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.controller.view(publication).desktop.showing).toBe(true);
    const saved = f.saved();
    inB = true;
    f.scene();
    f.controller.obsChanged('CurrentProgramSceneChanged', { sceneName:'other', sceneUuid:'other-scene' });
    if (mode === 'window-minimized') f.inventory.windows[0].minimized = true;
    await tick(dwell);
    const waiting = f.controller.view(publication).desktop;
    expect(waiting).toMatchObject({ enabled:false, preparing:false, resume:'scene', message:expect.stringContaining(reason) });
    expect(f.saved()).toEqual(saved);
    expect(f.controller.publicView().accepting).toBe(true);
    const scansBefore = scans;
    f.controller.obsChanged('CurrentProgramSceneChanged', { sceneName:'other', sceneUuid:'other-scene' });
    await tick(2000);
    expect(f.controller.view(publication).desktop).toEqual(waiting);
    expect(scans - scansBefore).toBeLessThanOrEqual(1);
    expect(f.desktop.prepare).toHaveBeenCalledTimes(1);

    inB = false;
    f.inventory.windows[0].minimized = false;
    f.scene('scene');
    if (mode !== 'no-image') f.controller.obsChanged('CurrentProgramSceneChanged', { sceneName:'scene', sceneUuid:'program-scene' });
    await tick(2000);
    expect(f.controller.view(publication).desktop).toMatchObject({ enabled:true, showing:true, preparing:false });
    expect(f.saved().binding?.scene).toBe('scene');
  });
  it.each(['scene event', 'new image', 'window warming up', 'publish while waiting', 'publish while resuming', 'stop', 'edit', 'unpublish', 'disconnect'] as const)(
    'waits past the retry deadline on a video-device-only scene and handles %s', async action => {
    vi.useFakeTimers();
    const f = await fixture();
    const publication = { status:'online', url:null, message:'' } as const;
    const read = f.read.request;
    let cameraScans = 0;
    let warming = false;
    f.read.request = async (type, data) => {
      if (type === 'GetSceneItemList' && data?.sceneName === 'other') {
        cameraScans++;
        return { sceneItems:[{ sourceName:'camera', sceneItemId:2, inputKind:'dshow_input', sceneItemEnabled:true }] };
      }
      if (type === 'GetSceneItemList' && warming) {
        return { sceneItems:[{ sourceName:'game', sourceUuid:'game-id', sceneItemId:7, inputKind:'window_capture', sceneItemEnabled:true, sceneItemTransform:{ ...transform, sourceWidth:0, sourceHeight:0 } }] };
      }
      return read(type, data);
    };
    await f.controller.configurePublishStart(true);
    const publishLater = action === 'publish while waiting' || action === 'publish while resuming';
    if (publishLater) {
      await f.controller.detect(target.id);
      await f.controller.startDesktop();
    } else {
      f.controller.setOnline(true);
      f.controller.preparePublishStart()();
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(f.controller.view(publication).desktop.enabled).toBe(true);
    const saved = f.saved();

    f.scene();
    f.controller.obsChanged('CurrentProgramSceneChanged');
    f.advance(500);
    await f.frames.tick();
    await vi.advanceTimersByTimeAsync(500);
    for (let i=0; i<34; i++) {
      f.advance(500);
      await vi.advanceTimersByTimeAsync(500);
    }
    const waiting = f.controller.view(publication).desktop;
    expect(waiting).toMatchObject({ enabled:false, showing:false, preparing:false, resume:'scene' });
    expect(cameraScans).toBeGreaterThanOrEqual(2);
    expect(cameraScans).toBeLessThanOrEqual(11);
    expect(f.desktop.prepare).toHaveBeenCalledTimes(1);
    expect(f.saved()).toEqual(saved);
    let published: (() => void) | undefined;
    if (publishLater) {
      await f.controller.requestPublication({ start:async (onPublished, onStarting) => { published = onPublished; onStarting?.(); } });
      expect(f.controller.view({ ...publication, status:'starting' }).desktop).toEqual(waiting);
      if (action === 'publish while waiting') {
        f.controller.setOnline(true);
        published?.();
        expect(f.controller.view(publication).desktop).toEqual(waiting);
      }
    }
    expect(f.controller.publicView()).toMatchObject({ accepting:action !== 'publish while resuming' });
    expect(f.controller.publicView()).not.toHaveProperty('desktop');
    if (f.controller.publicView().accepting) await expect(f.controller.react({ kind:'heart' })).resolves.toMatchObject({ kind:'heart' });

    f.frames.invalidate();
    expect(f.controller.view(publication).desktop).toEqual(waiting);
    await f.frames.tick();
    expect(f.controller.view(publication).desktop).toEqual(waiting);
    f.controller.obsChanged('CurrentProgramSceneChanged', { sceneName:'other', sceneUuid:'other-scene' });
    expect(f.controller.view(publication).desktop).toEqual(waiting);

    if (action === 'stop') f.controller.stopDesktop();
    if (action === 'edit') await f.controller.update({ ...saved, insets:{ ...saved.insets, left:5 } });
    if (action === 'unpublish') f.controller.setOnline(false);
    if (action === 'disconnect') f.controller.obsChanged('Disconnected');

    let finishResume!: () => void;
    if (action === 'publish while resuming') vi.mocked(f.desktop.prepare).mockImplementationOnce(() => new Promise(resolve => { finishResume = resolve; }));
    warming = action === 'window warming up';
    f.scene('scene');
    if (action !== 'new image') f.controller.obsChanged('CurrentProgramSceneChanged');
    f.advance(500);
    await f.frames.tick();
    await vi.advanceTimersByTimeAsync(500);
    if (warming) {
      expect(f.controller.view(publication).desktop).toMatchObject({ enabled:false, preparing:true });
      warming = false;
      f.advance(500);
      await vi.advanceTimersByTimeAsync(500);
    }
    if (action === 'publish while resuming') {
      expect(f.desktop.prepare).toHaveBeenCalledTimes(2);
      f.controller.setOnline(true);
      published?.();
      finishResume();
      await vi.advanceTimersByTimeAsync(0);
      expect(f.desktop.prepare).toHaveBeenCalledTimes(2);
    }
    if (action === 'publish while waiting') await advanceRecovery(f, 1000);
    const resumes = action === 'scene event' || action === 'new image' || action === 'window warming up' || publishLater;
    expect(f.controller.view(publication).desktop).toMatchObject({ enabled:resumes, showing:resumes });
    expect(f.controller.view(publication).desktop.resume).toBeUndefined();
    expect(f.saved().binding?.scene).toBe('scene');
  });
  it('retries instead of waiting for another scene if a capture becomes visible during the empty-scene check', async () => {
    vi.useFakeTimers();
    const f = await fixture();
    const publication = { status:'online', url:null, message:'' } as const;
    const read = f.read.request;
    let first = true;
    f.read.request = async (type, data) => {
      if (type === 'GetSceneItemList' && data?.sceneName === 'other' && first) {
        first = false;
        f.controller.obsChanged('SceneItemEnableStateChanged', { sceneName:'other', sceneItemId:7, sceneItemEnabled:true });
        return { sceneItems:[] };
      }
      return read(type, data);
    };
    await f.controller.configurePublishStart(true);
    f.controller.setOnline(true);
    f.controller.preparePublishStart()();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.controller.view(publication).desktop.enabled).toBe(true);
    f.scene();
    f.controller.obsChanged('CurrentProgramSceneChanged');
    f.advance(500);
    await f.frames.tick();
    await vi.advanceTimersByTimeAsync(250);
    expect(f.controller.view(publication).desktop).toMatchObject({ enabled:false, preparing:true });
    f.advance(500);
    await vi.advanceTimersByTimeAsync(500);
    expect(f.controller.view(publication).desktop).toMatchObject({ enabled:true, showing:true });
    expect(f.saved().binding?.scene).toBe('other');
  });
  it.each(['initial publication', 'same scene'] as const)('continues bounded retries when a capture is temporarily hidden during %s', async mode => {
    vi.useFakeTimers();
    const f = await fixture();
    const publication = { status:'online', url:null, message:'' } as const;
    const read = f.read.request;
    let hidden = mode === 'initial publication';
    f.read.request = (type, data) => type === 'GetSceneItemList' && hidden ? Promise.resolve({ sceneItems:[] }) : read(type, data);
    await f.controller.configurePublishStart(true);
    f.controller.setOnline(true);
    f.controller.preparePublishStart()();
    await vi.advanceTimersByTimeAsync(0);
    if (mode === 'same scene') {
      expect(f.controller.view(publication).desktop.enabled).toBe(true);
      hidden = true;
      f.controller.obsChanged('SceneItemEnableStateChanged', { sceneName:'scene', sceneItemId:7, sceneItemEnabled:false });
      f.advance(500);
      await f.frames.tick();
      await vi.advanceTimersByTimeAsync(250);
    }
    expect(f.controller.view(publication).desktop).toMatchObject({ enabled:false, preparing:true });
    expect(f.controller.view(publication).desktop.resume).toBeUndefined();
    hidden = false;
    f.controller.obsChanged('SceneItemEnableStateChanged', { sceneName:'scene', sceneItemId:7, sceneItemEnabled:true });
    f.advance(500);
    await f.frames.tick();
    await vi.advanceTimersByTimeAsync(500);
    expect(f.controller.view(publication).desktop).toMatchObject({ enabled:true, showing:true });
  });
  it.each(['native failure', 'invalid live viewport'] as const)('keeps the previous scene settings after a window scene switch with %s', async failure => {
    vi.useFakeTimers();
    const f = await fixture();
    const publication = { status:'online', url:null, message:'' } as const;
    await f.controller.update({ ...f.saved(), insets:{ left:8, right:0, top:0, bottom:0 } });
    await f.controller.configurePublishStart(true);
    f.controller.setOnline(true);
    f.controller.preparePublishStart()();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.controller.view(publication).desktop.enabled).toBe(true);
    const previous = f.saved();

    if (failure === 'native failure') vi.mocked(f.desktop.prepare).mockRejectedValueOnce(new Error('native failure'));
    else vi.mocked(f.desktop.prepare).mockImplementationOnce(async () => { f.inventory.windows[0].width = 4; });
    f.scene();
    f.controller.obsChanged('CurrentProgramSceneChanged');
    f.advance(500);
    await f.frames.tick();
    await vi.advanceTimersByTimeAsync(250);
    expect(f.controller.view(publication).desktop).toMatchObject({
      enabled:false, preparing:false, message:expect.stringContaining(failure === 'native failure' ? 'native failure' : '範囲が不正'),
    });
    expect(f.saved()).toEqual(previous);
    expect(f.controller.publicView().accepting).toBe(true);
  });
  it('keeps the prior mapping if a scene switch interrupts the initial publication startup and the next start fails', async () => {
    vi.useFakeTimers();
    const f = await fixture();
    const publication = { status:'online', url:null, message:'' } as const;
    let finish!: () => void;
    vi.mocked(f.desktop.prepare)
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockRejectedValueOnce(new Error('native failure'));
    await f.controller.configurePublishStart(true);
    const previous = f.saved();
    f.controller.setOnline(true);
    f.controller.preparePublishStart()();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.controller.view(publication).desktop).toMatchObject({ enabled:false, preparing:true });
    f.scene();
    f.controller.obsChanged('CurrentProgramSceneChanged');
    f.advance(500);
    await f.frames.tick();
    await vi.advanceTimersByTimeAsync(250);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.controller.view(publication).desktop).toMatchObject({ enabled:false, preparing:false, message:expect.stringContaining('native failure') });
    expect(f.saved()).toEqual(previous);
    expect(f.controller.publicView().accepting).toBe(true);
  });
  it.each(['arriving within the new deadline', 'missing', 'arriving after the new deadline', 'waiting for late window inventory'] as const)(
    'gives a new scene its own image deadline with the image %s', async image => {
    vi.useFakeTimers();
    const f = await fixture();
    const publication = { status:'online', url:null, message:'' } as const;
    await f.controller.configurePublishStart(true);
    f.controller.setOnline(true);
    f.controller.preparePublishStart()();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.controller.view(publication).desktop.enabled).toBe(true);

    const read = f.read.request;
    const blocked = vi.fn(() => new Promise<Record<string, unknown>>(() => {}));
    let inB = true;
    f.read.request = (type, data) => type === 'GetInputSettings' && inB ? blocked() : read(type, data);
    f.scene();
    f.controller.obsChanged('CurrentProgramSceneChanged', { sceneName:'other', sceneUuid:'other-scene' });
    await advanceRecovery(f, 4000);
    expect(blocked).toHaveBeenCalledOnce();

    inB = false;
    f.scene('scene');
    const event = { sceneName:'scene', sceneUuid:'program-scene' };
    f.controller.obsChanged('CurrentProgramSceneChanged', event);
    const capture = vi.spyOn(f.frames, 'tick').mockResolvedValue(undefined);
    const lateInventory = image === 'waiting for late window inventory';
    await advanceRecovery(f, 4500, !lateInventory);
    expect(f.controller.view(publication).desktop).toMatchObject({ enabled:false, preparing:true });
    f.controller.obsChanged('CurrentProgramSceneChanged', event);
    const timely = image === 'arriving within the new deadline';
    if (timely || lateInventory) capture.mockRestore();
    if (!timely) {
      await advanceRecovery(f, 5000, !lateInventory);
      expect(f.controller.view(publication).desktop).toMatchObject({ enabled:false, preparing:false, resume:'scene', message:expect.stringContaining('最新画像') });
    }
    if (image === 'arriving after the new deadline') capture.mockRestore();
    if (image !== 'missing') {
      await advanceRecovery(f, 1000);
      expect(f.controller.view(publication).desktop).toMatchObject({ enabled:true, showing:true, preparing:false });
    }
    expect(f.controller.publicView().accepting).toBe(true);
  });
  it.each(['no identity', 'collection only'] as const)('keeps the deadline and tries once when an unidentified scene becomes known (%s)', async identity => {
    vi.useFakeTimers();
    const f = await fixture();
    const publication = { status:'online', url:null, message:'' } as const;
    await f.controller.configurePublishStart(true);
    f.controller.setOnline(true);
    f.controller.preparePublishStart()();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.controller.view(publication).desktop.showing).toBe(true);
    f.scene();
    const read = f.read.request;
    let noImage = true;
    f.read.request = async (type, data) => {
      if (type === 'GetSceneCollectionList' && identity === 'collection only') return { currentSceneCollectionName:'other-collection' };
      if (type === 'GetSourceScreenshot' && noImage) throw new Error('BUSY');
      return read(type, data);
    };
    if (identity === 'collection only') f.controller.obsChanged('CurrentSceneCollectionChanged', { sceneCollectionName:'other-collection' });
    else f.controller.obsChanged('CurrentProgramSceneChanged');
    for (let i = 0; i < 5; i++) {
      await advanceRecovery(f, 1500);
      f.controller.obsChanged('CurrentProgramSceneChanged');
    }
    await advanceRecovery(f, 2000);
    expect(f.controller.view(publication).desktop).toMatchObject({ resume:'scene', preparing:false });
    noImage = false;
    await advanceRecovery(f, 1000);
    expect(f.controller.view(publication).desktop).toMatchObject({ enabled:true, showing:true });
    expect(f.saved().binding?.scene).toBe('other');
  });
  it.each(['during detection', 'while waiting'] as const)('ends following if the pinned monitor disconnects %s', async when => {
    vi.useFakeTimers();
    const f = await fixture();
    const publication = { status:'online', url:null, message:'' } as const;
    const monitor: ReactionWindow = { ...target, id:'display:one', pid:0, title:'one', processName:'@display', className:'@display', width:32, height:18 };
    f.inventory.windows = [monitor];
    monitorInput(f);
    const read = f.read.request;
    f.read.request = async (type, data) => {
      if (type === 'GetSceneItemList' && data?.sceneName === 'other') {
        if (when === 'during detection') f.inventory.windows = [];
        return { sceneItems:[] };
      }
      return read(type, data);
    };
    await f.controller.configurePublishStart(true);
    f.controller.setOnline(true);
    f.controller.preparePublishStart()();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.controller.view(publication).desktop.showing).toBe(true);
    f.scene();
    f.controller.obsChanged('CurrentProgramSceneChanged', { sceneName:'other', sceneUuid:'other-scene' });
    await advanceRecovery(f, 1500);
    if (when === 'while waiting') {
      expect(f.controller.view(publication).desktop.resume).toBe('scene');
      f.inventory.windows = [];
      f.advance(500);
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(f.controller.view(publication).desktop).toMatchObject({ enabled:false, message:expect.stringContaining('切断') });
    expect(f.controller.view(publication).desktop.resume).toBeUndefined();
    f.inventory.windows = [monitor];
    f.scene('scene');
    f.controller.obsChanged('CurrentProgramSceneChanged', { sceneName:'scene', sceneUuid:'program-scene' });
    f.advance(500);
    await vi.advanceTimersByTimeAsync(500);
    expect(f.controller.view(publication).desktop).toMatchObject({ enabled:false, preparing:false });
  });
  it.each(['window with notification', 'window without notification', 'ambiguous', 'ambiguous in monitor scene', 'different monitor', 'native failure', 'monitor disconnected during preparation', 'monitor disconnected during save'] as const)(
    'rechecks a scene after switching from window capture to display capture: %s', async destination => {
    vi.useFakeTimers();
    const f = await fixture();
    const publication = { status:'online', url:null, message:'' } as const;
    const monitor: ReactionWindow = { ...target, id:'display:one', pid:0, title:'one', processName:'@display', className:'@display', width:32, height:18, x:800 };
    f.inventory.windows.push(monitor, { ...monitor, id:'display:two', title:'two', x:832 });
    const screen = { sourceName:'screen', sourceUuid:'screen-id', sceneItemId:1, inputKind:'monitor_capture', sceneItemEnabled:true, sceneItemTransform:transform };
    const window = { sourceName:'game', sourceUuid:'game-id', sceneItemId:7, inputKind:'window_capture', sceneItemEnabled:true, sceneItemTransform:{ ...transform, positionX:8, positionY:4.5, scaleX:.5, scaleY:.5 } };
    let returning = false;
    const read = f.read.request;
    f.read.request = async (type, data) => {
      if (type === 'GetSceneItemList') {
        if (data?.sceneName === 'other') return { sceneItems: returning && destination === 'ambiguous in monitor scene' ? [screen, window] : [screen] };
        if (returning && destination === 'ambiguous') return { sceneItems:[window, screen] };
        if (returning && destination === 'different monitor') return { sceneItems:[{ ...screen, sourceName:'second', sourceUuid:'second-id' }] };
        return { sceneItems:[window] };
      }
      if (type === 'GetInputSettings' && data?.inputName === 'screen') return { inputSettings:{ monitor_id:'one' } };
      if (type === 'GetInputSettings' && data?.inputName === 'second') return { inputSettings:{ monitor_id:'two' } };
      return read(type, data);
    };
    await f.controller.configurePublishStart(true);
    f.controller.setOnline(true);
    f.controller.preparePublishStart()();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.controller.view(publication)).toMatchObject({ selectedId:target.id, desktop:{ enabled:true } });

    const switchScene = async (name: string, notify = true) => {
      const old = f.frames.metadata()!.id;
      f.scene(name);
      if (notify) f.controller.obsChanged('CurrentProgramSceneChanged', { sceneName:name });
      f.advance(500);
      await f.frames.tick();
      expect(f.frames.get(old)).toBeNull();
      await vi.advanceTimersByTimeAsync(250);
      expect(f.controller.publicView().accepting).toBe(true);
    };
    await switchScene('other');
    expect(f.controller.view(publication)).toMatchObject({ selectedId:monitor.id, desktop:{ enabled:true } });
    expect(f.saved().region).toEqual({ x:0, y:0, width:1, height:1 });

    returning = true;
    const before = f.saved();
    const disconnect = () => { f.inventory.windows = f.inventory.windows.filter(w => w.id !== monitor.id); };
    if (destination === 'native failure') vi.mocked(f.desktop.prepare).mockRejectedValueOnce(new Error('native failure'));
    if (destination === 'monitor disconnected during preparation') vi.mocked(f.desktop.prepare).mockImplementationOnce(async () => disconnect());
    if (destination === 'monitor disconnected during save') {
      const save = f.store.save.getMockImplementation()!;
      f.store.save.mockImplementationOnce(async settings => { await save(settings); disconnect(); });
    }
    if (destination === 'ambiguous in monitor scene') {
      f.controller.obsChanged('SceneItemEnableStateChanged', { sceneName:'other', sceneItemId:7, sceneItemEnabled:true });
      f.advance(500);
      await f.frames.tick();
      await vi.advanceTimersByTimeAsync(250);
      expect(f.controller.view(publication).desktop.message).toContain('複数');
    } else {
      await switchScene('scene', destination !== 'window without notification');
    }
    if (destination.startsWith('window')) {
      expect(f.controller.view(publication)).toMatchObject({ selectedId:target.id, desktop:{ enabled:true } });
      expect(f.saved().binding?.input).toBe('game-id');
      expect(f.saved().region).toEqual({ x:.25, y:.25, width:.5, height:.5 });
    } else {
      expect(f.controller.view(publication).desktop).toMatchObject({ enabled:false, preparing:false });
      expect(f.saved()).toEqual(before);
    }
  });
  it.each(['stop','unpublish','edit','disconnect'])('does not revive automatic PC display after %s during recalculation',async action=>{
    const f=await fixture();await f.controller.configurePublishStart(true);f.controller.setOnline(true);f.controller.preparePublishStart()();
    const state = () => f.controller.view({status:'online',url:null,message:''}).desktop;
    await vi.waitFor(()=>expect(state().enabled).toBe(true));
    let finish!: () => void;
    vi.mocked(f.desktop.prepare).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    f.scene();
    f.controller.obsChanged('CurrentProgramSceneChanged');
    await f.frames.tick();
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    if(action==='stop')f.controller.stopDesktop();if(action==='unpublish')f.controller.setOnline(false);if(action==='edit')await f.controller.update({...f.saved(),insets:{left:1,top:0,right:0,bottom:0}});if(action==='disconnect')f.controller.obsChanged('Disconnected');
    finish();await f.frames.tick();await new Promise(resolve=>setTimeout(resolve,300));expect(state().enabled).toBe(false);
  });
  it('refuses ambiguous windows on automatic selection and preserves settings',async()=>{
    const f=await fixture();f.inventory.windows.push({...target,id:'2',pid:456});await f.controller.configurePublishStart(true);f.controller.setOnline(true);f.controller.preparePublishStart()();
    await vi.waitFor(()=>expect(f.controller.view({status:'online',url:null,message:''}).desktop.message).toContain('複数'));expect(f.saved().target).toBeNull();expect(f.desktop.prepare).not.toHaveBeenCalled();expect(f.controller.publicView().accepting).toBe(true);
  });
  it.each(['any_fullscreen','hotkey',undefined])('refuses game capture without a specific window mode (%s)',async mode=>{
    const f=await fixture(),normal=vi.mocked(f.read.request).getMockImplementation()!;
    vi.mocked(f.read.request).mockImplementation((type,data)=>type==='GetInputSettings'?Promise.resolve({inputSettings:{window:'game:Game:game.exe',capture_mode:mode}}):normal(type,data));
    await f.controller.configurePublishStart(true);f.controller.setOnline(true);f.controller.preparePublishStart()();
    await vi.waitFor(()=>expect(f.controller.view({status:'online',url:null,message:''}).desktop.message).toContain('特定のウィンドウ'));expect(f.saved().target).toBeNull();expect(f.desktop.prepare).not.toHaveBeenCalled();
  });
  it('recomputes changed transform coordinates while retaining window insets',async()=>{
    const f=await fixture();await f.controller.update({...f.saved(),insets:{left:12,top:0,right:0,bottom:0}});await f.controller.configurePublishStart(true);f.controller.setOnline(true);f.controller.preparePublishStart()();
    await vi.waitFor(()=>expect(f.controller.view({status:'online',url:null,message:''}).desktop.enabled).toBe(true));
    const normal=vi.mocked(f.read.request).getMockImplementation()!;
    vi.mocked(f.read.request).mockImplementation(async(type,data)=>{const value=await normal(type,data);if(type==='GetSceneItemList')value.sceneItems=[{sourceName:'game',sourceUuid:'game-id',sceneItemId:7,inputKind:'game_capture',sceneItemEnabled:true,sceneItemTransform:{...transform,scaleX:0.5,scaleY:0.5,positionX:8,positionY:4.5}}];return value;});
    f.controller.obsChanged('SceneItemTransformChanged',{sceneName:'scene',sceneItemId:7});
    await vi.waitFor(async()=>{await f.frames.tick();expect(f.controller.view({status:'online',url:null,message:''}).desktop.enabled).toBe(true);});
    expect(f.saved().region).toEqual({x:0.25,y:0.25,width:0.5,height:0.5});expect(f.saved().insets.left).toBe(12);
  });
  it('maps overflowing captures through the full source across restarts and manual edits',async()=>{
    const f=await fixture(),normal=vi.mocked(f.read.request).getMockImplementation()!;
    vi.mocked(f.read.request).mockImplementation(async(type,data)=>{const value=await normal(type,data);if(type==='GetSceneItemList')for(const item of value.sceneItems as Record<string,unknown>[])item.sceneItemTransform={...transform,positionX:28,scaleX:.5,scaleY:.5};return value;});
    await f.controller.detect('1');f.controller.setOnline(true);
    expect(f.saved().region).toEqual({x:.875,y:0,width:.125,height:.5});
    expect(JSON.stringify(f.saved())).not.toContain('captureRegion');
    const point=()=>f.controller.react({kind:'point',frameId:f.frames.metadata()!.id,x:.9375,y:.25});
    for(let i=0;i<2;i++){
      await f.controller.startDesktop();
      expect(f.desktop.render).toHaveBeenLastCalledWith({x:-1020,y:200,width:1280,height:720});
      await point();expect(f.desktop.marker).toHaveBeenLastCalledWith({x:.125,y:.5,canvasWidth:16,region:{x:.875,y:0,width:.5,height:.5}, intent:'look', at:expect.any(Number)});
      await f.controller.react({kind:'heart'});await f.controller.react({kind:'clap'});f.controller.stopDesktop();
    }
    expect(f.desktop.reaction).toHaveBeenCalledTimes(4);
    await f.controller.update({...f.saved(),region:{x:0,y:0,width:1,height:1}});
    await f.controller.startDesktop();await point();
    expect(f.desktop.marker).toHaveBeenLastCalledWith({x:.9375,y:.25,canvasWidth:32,region:{x:0,y:0,width:1,height:1}, intent:'look', at:expect.any(Number)});
  });
  it('recalculates an overflowing transform and resumes without changing OBS placement',async()=>{
    const f=await fixture(),normal=vi.mocked(f.read.request).getMockImplementation()!;
    await f.controller.configurePublishStart(true);f.controller.setOnline(true);f.controller.preparePublishStart()();
    const enabled=()=>f.controller.view({status:'online',url:null,message:''}).desktop.enabled;
    await vi.waitFor(()=>expect(enabled()).toBe(true));
    vi.mocked(f.read.request).mockImplementation(async(type,data)=>{const value=await normal(type,data);if(type==='GetSceneItemList')for(const item of value.sceneItems as Record<string,unknown>[])item.sceneItemTransform={...transform,positionX:-8,positionY:-4.5,scaleX:.5,scaleY:.5};return value;});
    f.controller.obsChanged('SceneItemTransformChanged',{sceneName:'scene',sceneItemId:7});
    expect(enabled()).toBe(false);await f.frames.tick();await vi.waitFor(()=>expect(enabled()).toBe(true));
    expect(f.saved().region).toEqual({x:0,y:0,width:.25,height:.25});
    expect(f.desktop.render).toHaveBeenLastCalledWith({x:420,y:380,width:1280,height:720});
    await f.controller.react({kind:'point',frameId:f.frames.metadata()!.id,x:.125,y:.125});
    expect(f.desktop.marker).toHaveBeenLastCalledWith({x:.75,y:.75,canvasWidth:16,region:{x:-.25,y:-.25,width:.5,height:.5}, intent:'look', at:expect.any(Number)});
    expect(vi.mocked(f.read.request).mock.calls.every(([type])=>type.startsWith('Get'))).toBe(true);
  });
  it('rolls back a delayed automatic selection save after manual stop',async()=>{
    const f=await fixture();await f.controller.configurePublishStart(true);let finish!:()=>void;const save=f.store.save.getMockImplementation()!;
    f.store.save.mockImplementationOnce(settings=>new Promise<void>(resolve=>{finish=()=>{void save(settings).then(resolve);};}));
    f.controller.setOnline(true);f.controller.preparePublishStart()();await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));f.controller.stopDesktop();finish();
    await vi.waitFor(()=>expect(f.store.save).toHaveBeenCalledTimes(3));expect(f.saved().target).toBeNull();expect(vi.mocked(f.desktop.render).mock.calls.every(([bounds])=>bounds===null)).toBe(true);expect(f.controller.view({status:'online',url:null,message:''}).desktop.enabled).toBe(false);
  });
  it.each(['SceneItemTransformChanged','SceneNameChanged'])('restarts an initial unbound automatic selection after %s during its read',async event=>{
    const f=await fixture(),normal=vi.mocked(f.read.request).getMockImplementation()!;let finish!:()=>void;
    vi.mocked(f.read.request).mockImplementationOnce(normal);
    let held=false;vi.mocked(f.read.request).mockImplementation((type,data)=>{
      if(type==='GetInputSettings'&&!held){held=true;return new Promise(resolve=>{finish=()=>{void normal(type,data).then(resolve);};});}return normal(type,data);
    });
    await f.controller.configurePublishStart(true);f.controller.setOnline(true);f.controller.preparePublishStart()();await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
    expect(f.saved().binding).toBeNull();if(event==='SceneNameChanged')f.rename();f.controller.obsChanged(event,{sceneName:event==='SceneNameChanged'?'renamed':'scene',oldSceneName:'scene',sceneItemId:7});finish();
    await vi.waitFor(async()=>{f.advance(500);await f.frames.tick();expect(f.controller.view({status:'online',url:null,message:''}).desktop.enabled).toBe(true);});expect(f.saved().binding?.fingerprint).toBeTruthy();
  });
  it('refuses multiple visible captures even when each maps to a unique window',async()=>{
    const f=await fixture(),normal=vi.mocked(f.read.request).getMockImplementation()!;
    vi.mocked(f.read.request).mockImplementation(async(type,data)=>{const value=await normal(type,data);if(type==='GetSceneItemList'){const items=value.sceneItems as Record<string,unknown>[];value.sceneItems=[items[0],{...items[0],sceneItemId:8}];}return value;});
    await f.controller.configurePublishStart(true);f.controller.setOnline(true);f.controller.preparePublishStart()();await vi.waitFor(()=>expect(f.controller.view({status:'online',url:null,message:''}).desktop.message).toContain('複数'));expect(f.saved().target).toBeNull();
  });
  it('delivers the built listener design in the first HTML response with a matching CSP hash',async()=>{
    const f=await fixture(),directory=await mkdtemp(join(tmpdir(),'casmate-reaction-assets-'));
    const server=new ReactionPublicServer(f.controller,directory);
    try{
      await build({configFile:'vite.reactions.config.mts',logLevel:'silent',build:{outDir:directory,emptyOutDir:false}});
      const port=await server.start();server.host='reactions.example';server.online=true;
      const response=await request('http://127.0.0.1:'+port).get('/').set('Host','reactions.example');expect(response.status).toBe(200);
      const style=response.text.match(/<style>([\s\S]*?)<\/style>/u)?.[1];expect(style,'first response must include the design without a later CSS request').toBeTruthy();
      const hash=createHash('sha256').update(style!).digest('base64');expect(response.headers['content-security-policy']).toContain("'sha256-"+hash+"'");
      expect(response.headers['content-security-policy']).not.toContain("'unsafe-inline'");expect(response.text).not.toMatch(/<link[^>]*rel=["']stylesheet/u);expect(style).toContain('body');expect(style).toContain('.panel');
      await f.controller.configureListenerPreview({ mode: 'youtube', twitchChannel: '', youtubeVideoId: 'Ab1_CD-efgH' });
      const live = await request('http://127.0.0.1:'+port).get('/').set('Host','reactions.example').expect(200);
      expect(live.text).toContain('<meta name="casmate-preview" data-mode="youtube" data-id="Ab1_CD-efgH">');
      expect(live.headers['content-security-policy']).toContain(`'sha256-${hash}'`);
      expect(live.headers['content-security-policy']).toContain('frame-src https://player.twitch.tv https://www.youtube.com');
    }finally{await server.stop();await rm(directory,{recursive:true,force:true});}
  });
  it('sends the same accepted particle event to OBS and the visible desktop without replay after stop',async()=>{
    const f=await fixture();await f.select();f.controller.setOnline(true);await f.controller.startDesktop();const events:unknown[]=[];f.controller.subscribe((kind,data)=>{if(kind==='reaction')events.push(data);});
    await f.controller.react({kind:'heart'});await f.controller.react({kind:'clap'});expect(f.desktop.reaction).toHaveBeenCalledTimes(2);expect(vi.mocked(f.desktop.reaction).mock.calls.map(([event])=>event)).toEqual(events);
    f.controller.stopDesktop();await f.controller.react({kind:'heart'});expect(f.desktop.reaction).toHaveBeenCalledTimes(2);await f.controller.startDesktop();expect(f.desktop.reaction).toHaveBeenCalledTimes(2);
    f.inventory.windows[0].minimized=true;await f.controller.react({kind:'clap'});expect(f.desktop.reaction).toHaveBeenCalledTimes(2);
  });
  it.each(['visible','outside','stopped','minimized','missing','foreground','stale','expired','scene'] as const)('checks desktop point delivery after metadata-only acceptance: %s',async condition=>{
    const f=await fixture();await f.select();
    if(condition==='outside')await f.controller.update({...f.saved(),region:{x:.25,y:.25,width:.5,height:.5}});
    if(condition==='foreground')await f.controller.update({...f.saved(),foregroundOnly:true});
    f.controller.setOnline(true);await f.controller.startDesktop();
    await f.controller.configureListenerPreview({mode:'twitch',twitchChannel:'caster',youtubeVideoId:''});
    const frame=f.frames.publicMetadata()!;
    if(condition==='stopped')f.controller.stopDesktop();
    if(condition==='minimized')f.inventory.windows[0].minimized=true;
    if(condition==='missing')f.inventory.windows=[];
    if(condition==='stale')f.inventory.observedAt=0;
    if(condition==='expired')f.advance(12001);
    if(condition==='scene')f.scene();
    const cookie=await f.cookie();
    const metadata=await request(f.app).get('/frame').set('Host','reactions.example');
    if(condition==='scene')expect([200,503]).toContain(metadata.status);
    else expect(metadata.status).toBe(condition==='expired'?503:200);
    const response=await f.send(cookie,{kind:'point',frameId:frame.id,x:condition==='outside'?.1:.5,y:condition==='outside'?.1:.5});
    expect(response.status).toBe(['expired','scene'].includes(condition)?409:200);
    expect(f.desktop.marker).toHaveBeenCalledTimes(condition==='visible'?1:0);
  });
  it('keeps existing point positions when extending the desktop to the full OBS canvas',async()=>{
    const f=await fixture();await f.controller.update({...f.saved(),target:{title:target.title,processName:target.processName,className:target.className},region:{x:.25,y:.25,width:.5,height:.5}});f.controller.setOnline(true);await f.controller.startDesktop();
    expect(f.desktop.render).toHaveBeenLastCalledWith({x:-220,y:20,width:1280,height:720});
    await f.controller.react({kind:'point',frameId:f.frames.metadata()!.id,x:.5,y:.5});expect(f.desktop.marker).toHaveBeenLastCalledWith({x:.5,y:.5,canvasWidth:16,region:{x:.25,y:.25,width:.5,height:.5}, intent:'look', at:expect.any(Number)});
    await f.controller.react({kind:'point',frameId:f.frames.metadata()!.id,x:.1,y:.1});expect(f.desktop.marker).toHaveBeenCalledTimes(1);
  });
  it('waits for the initial OBS connection after startup publication, then validates fresh inputs once',async()=>{
    vi.useFakeTimers();
    const f=await fixture(false,{...defaultReactionSettings(),publishOnStartup:true,autoStartOnPublish:true});
    let connected=false; f.read.valid=()=>connected; f.frames.invalidate();
    await f.controller.publishAtStartup({start:async ready=>{f.controller.setOnline(true);ready?.();}});
    await advanceRecovery(f,30000);
    expect(f.controller.view({status:'online',url:null,message:''}).desktop).toMatchObject({enabled:false,preparing:true,message:expect.stringContaining('OBS接続待ち')});
    f.controller.obsChanged('Disconnected');
    expect(f.controller.view({status:'online',url:null,message:''}).desktop.preparing).toBe(true);
    connected=true; await advanceRecovery(f,1000); await f.frames.tick(); await advanceRecovery(f,1000);
    expect(f.controller.view({status:'online',url:null,message:''}).desktop.enabled).toBe(true);
    expect(f.saved().binding?.fingerprint).toBeTruthy();
    connected=false; f.controller.obsChanged('Disconnected'); connected=true;
    await f.frames.tick(); await advanceRecovery(f,1000);
    expect(f.controller.view({status:'online',url:null,message:''}).desktop.enabled).toBe(false);
    expect(f.desktop.prepare).toHaveBeenCalledTimes(1);
  });
  it.each([false,true])('preserves initial OBS waiting across connection failures before publication readiness (stop %s)',async stop=>{
    vi.useFakeTimers();
    const f=await fixture(false,{...defaultReactionSettings(),publishOnStartup:true,autoStartOnPublish:true});
    let connected=false; f.read.valid=()=>connected; f.frames.invalidate();
    let ready:(()=>void)|undefined;
    await f.controller.publishAtStartup({start:async callback=>{ready=callback;}});
    f.controller.obsChanged('Disconnected'); await advanceRecovery(f,30000);
    if(stop)f.controller.stopDesktop();
    f.controller.setOnline(true); ready?.();
    expect(f.controller.view({status:'online',url:null,message:''}).desktop.preparing).toBe(!stop);
    connected=true; await advanceRecovery(f,2000);
    expect(f.controller.view({status:'online',url:null,message:''}).desktop.enabled).toBe(!stop);
  });
  it('cancels initial OBS publication waiting on manual start and still handles later scene changes',async()=>{
    vi.useFakeTimers();
    const f=await fixture(false,{...defaultReactionSettings(),publishOnStartup:true,autoStartOnPublish:true,target:{title:target.title,processName:target.processName,className:target.className}});
    let connected=false; f.read.valid=()=>connected; f.frames.invalidate();
    let ready:(()=>void)|undefined;
    await f.controller.publishAtStartup({start:async callback=>{ready=callback;}});
    connected=true; await f.frames.tick();
    await f.controller.startDesktop();
    f.scene(); await f.frames.tick();
    expect(f.controller.view({status:'online',url:null,message:''}).desktop.enabled).toBe(false);
    f.controller.setOnline(true); ready?.(); await advanceRecovery(f,1000);
    expect(f.controller.view({status:'online',url:null,message:''}).desktop.enabled).toBe(false);
    expect(f.desktop.prepare).toHaveBeenCalledTimes(1);
  });
  it('ends initial OBS waiting with the normal input deadline after connection and does not retry failed validation',async()=>{
    vi.useFakeTimers();
    const f=await fixture(false,{...defaultReactionSettings(),publishOnStartup:true,autoStartOnPublish:true});
    let connected=false; f.read.valid=()=>connected; f.frames.invalidate();
    const request=f.read.request;
    f.read.request=async(type,data)=>{if(type==='GetSourceScreenshot')throw Error('not ready');return request(type,data);};
    await f.controller.publishAtStartup({start:async ready=>{f.controller.setOnline(true);ready?.();}});
    await advanceRecovery(f,20000); connected=true; await advanceRecovery(f,9000);
    expect(f.controller.view({status:'online',url:null,message:''}).desktop).toMatchObject({enabled:false,preparing:false,message:expect.stringContaining('最新画像')});
    expect(f.controller.publicView().accepting).toBe(true);
    f.read.request=request; await f.frames.tick(); await advanceRecovery(f,1000);
    expect(f.desktop.prepare).not.toHaveBeenCalled();
  });
  it.each(['stop','unpublish','edit','disabled','shutdown'])('cancels initial OBS waiting on %s',async action=>{
    vi.useFakeTimers();
    const f=await fixture(false,{...defaultReactionSettings(),publishOnStartup:true,autoStartOnPublish:true});
    let connected=false; f.read.valid=()=>connected; f.frames.invalidate();
    await f.controller.publishAtStartup({start:async ready=>{f.controller.setOnline(true);ready?.();}});
    expect(f.controller.view({status:'online',url:null,message:''}).desktop.preparing).toBe(true);
    if(action==='stop')f.controller.stopDesktop();
    if(action==='unpublish')f.controller.setOnline(false);
    if(action==='edit')await f.controller.update({...f.saved(),foregroundOnly:false});
    if(action==='disabled')f.controller.obsChanged('Disabled');
    if(action==='shutdown')await f.controller.shutdown();
    connected=true; await f.frames.tick(); await advanceRecovery(f,1000);
    expect(f.desktop.prepare).not.toHaveBeenCalled();
    expect(f.controller.view({status:'online',url:null,message:''}).desktop.preparing).toBe(false);
  });
  it('defaults startup publication off and applies changed preferences only to the next app startup',async()=>{
    const f=await fixture(),start=vi.fn(async()=>undefined);await f.controller.publishAtStartup({start});expect(start).not.toHaveBeenCalled();
    await f.controller.configureStartupPublication(true);expect(f.saved().publishOnStartup).toBe(true);await f.controller.publishAtStartup({start});expect(start).not.toHaveBeenCalled();expect(f.controller.publicView().accepting).toBe(false);
  });
  it.each([false,true])('starts once through normal publication readiness on startup (desktop opt-in %s)',async desktopOptIn=>{
    const f=await fixture();await f.select();if(desktopOptIn)await f.controller.configurePublishStart(true);await f.controller.configureStartupPublication(true);
    let events!:TunnelCallbacks;const server:ReactionPublicationServer={host:null,nonce:'boot',get online(){return f.controller.publicView().accepting;},set online(value){f.controller.setOnline(value);},start:vi.fn(async()=>13579),stop:async()=>{f.controller.setOnline(false);},disconnect:()=>{f.controller.setOnline(false);}};
    const open=vi.fn(async(_port:number,callbacks:TunnelCallbacks)=>{events=callbacks;return {close:async()=>undefined};});const publication=new ReactionPublication(server,{open},()=>f.controller.isAvailable(),async()=>true);cleanup.push(()=>publication.stop());
    await f.controller.publishAtStartup(publication);await f.controller.publishAtStartup(publication);expect(open).toHaveBeenCalledTimes(1);expect(f.controller.publicView().accepting).toBe(false);
    events.url('https://aaaaaaaaaaaaaaaaaaaaaaaaaa.srv.us/');await vi.waitFor(()=>expect(publication.view().status).toBe('online'));
    if(desktopOptIn)await vi.waitFor(()=>expect(f.controller.view(publication.view()).desktop.enabled).toBe(true));else expect(f.desktop.prepare).not.toHaveBeenCalled();
    await publication.stop();expect(f.controller.publicView().accepting).toBe(false);await f.controller.publishAtStartup(publication);expect(open).toHaveBeenCalledTimes(1);
  });
  it('does not revive an interrupted startup publication when its tunnel opens late',async()=>{
    const f=await fixture();await f.controller.configureStartupPublication(true);let finish!:(value:{close:()=>Promise<void>})=>void;
    const server:ReactionPublicationServer={host:null,nonce:'boot',online:false,start:async()=>13579,stop:async()=>undefined,disconnect:()=>{f.controller.setOnline(false);}};
    const open=vi.fn(()=>new Promise<{close:()=>Promise<void>}>(resolve=>{finish=resolve;})),close=vi.fn(async()=>undefined);const publication=new ReactionPublication(server,{open},()=>true,async()=>true);cleanup.push(()=>publication.stop());
    const starting=f.controller.publishAtStartup(publication);await vi.waitFor(()=>expect(open).toHaveBeenCalled());const stopping=publication.stop();finish({close});await Promise.all([starting,stopping]);
    expect(close).toHaveBeenCalledTimes(1);expect(publication.view().status).toBe('off');await f.controller.publishAtStartup(publication);expect(open).toHaveBeenCalledTimes(1);
  });
  it('isolates startup failure and does not overwrite a later manual stop with a stale error',async()=>{
    const f=await fixture();await f.controller.configureStartupPublication(true);let fail!:(error:Error)=>void;const startup=f.controller.publishAtStartup({start:()=>new Promise((_resolve,reject)=>{fail=reject;})});
    f.controller.stopDesktop();fail(new Error('network'));await expect(startup).resolves.toBeUndefined();expect(f.controller.view({status:'off',url:null,message:''}).desktop.message).toBe('PC表示を停止しました。');expect(f.controller.isAvailable()).toBe(true);
    const other=await fixture();await other.controller.configureStartupPublication(true);await expect(other.controller.publishAtStartup({start:async()=>{throw new Error('network');}})).resolves.toBeUndefined();expect(other.controller.view({status:'off',url:null,message:''}).desktop.message).toContain('起動時公開を開始できません');
  });
  it('does not publish when settings are unavailable or shutdown has begun',async()=>{
    const f=await fixture();await f.controller.configureStartupPublication(true);await f.controller.shutdown();const start=vi.fn(async()=>undefined);await f.controller.publishAtStartup({start});expect(start).not.toHaveBeenCalled();
    const broken=new ReactionController({load:async()=>{throw new Error('broken');},save:async()=>undefined},new ReactionFrames(()=>f.read),()=>f.read,f.desktop);await broken.initialize();cleanup.push(()=>broken.shutdown());await broken.publishAtStartup({start});expect(start).not.toHaveBeenCalled();
  });
  it('saves startup preference without stopping active publication or PC display',async()=>{
    const f=await fixture();await f.select();f.controller.setOnline(true);await f.controller.startDesktop();await f.controller.configureStartupPublication(true);await f.controller.configureStartupPublication(false);
    expect(f.controller.publicView().accepting).toBe(true);expect(f.controller.view({status:'online',url:null,message:''}).desktop.enabled).toBe(true);expect(f.saved().publishOnStartup).toBe(false);
    f.store.save.mockRejectedValueOnce(new Error('disk'));await expect(f.controller.configureStartupPublication(true)).rejects.toThrow();expect(f.saved().publishOnStartup).toBe(false);
  });
  it('publishes only the last saved preview preference and leaves PC display running', async () => {
    const f = await fixture();
    await f.select();
    await f.controller.detect(target.id);
    await f.controller.startDesktop();
    f.controller.setOnline(true);
    const before = f.saved();
    const preview = { mode: 'twitch', twitchChannel: 'example', youtubeVideoId: 'M7lc1UVf-VE' };
    const save = f.store.save.getMockImplementation()!;
    let finish!: () => void;
    f.store.save.mockImplementationOnce(async settings => {
      await new Promise<void>(resolve => { finish = resolve; });
      await save(settings);
    });
    const saving = f.controller.configureListenerPreview(preview);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    expect(f.controller.listenerPreview()).toEqual(before.preview);
    finish();
    await saving;
    expect(f.controller.listenerPreview()).toEqual(preview);
    expect(f.saved().binding).toEqual(before.binding);
    expect(f.controller.view({ status: 'online', url: null, message: '' }).desktop).toMatchObject({ enabled: true, showing: true });
    expect(f.controller.publicView().accepting).toBe(true);

    await f.controller.update({ ...before, insets: { ...before.insets, left: 12 } });
    expect(f.saved().insets.left).toBe(12);
    expect(f.controller.listenerPreview()).toEqual(preview);

    f.store.save.mockRejectedValueOnce(new Error('disk'));
    await expect(f.controller.configureListenerPreview({ ...preview, mode: 'youtube' })).rejects.toThrow('disk');
    expect(f.controller.listenerPreview()).toEqual(preview);
  });
  it.each(['preference-first','range-first'])('serializes startup preference with range writes without restoring stale fields (%s)',async order=>{
    const f=await fixture();await f.select();let finish!:()=>void;f.store.save.mockImplementationOnce(()=>new Promise<void>(resolve=>{finish=resolve;}));
    const range={...f.saved(),insets:{left:12,top:0,right:0,bottom:0}};
    const first=order==='preference-first'?f.controller.configureStartupPublication(true):f.controller.update(range);await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
    const second=order==='preference-first'?f.controller.update(range):f.controller.configureStartupPublication(true);finish();await Promise.all([first,second]);expect(f.saved().publishOnStartup).toBe(true);expect(f.saved().insets.left).toBe(12);
  });
  it('does not lose startup preference while confirming desktop auto-start',async()=>{
    const f=await fixture();await f.select();await Promise.all([f.controller.configurePublishStart(true),f.controller.configureStartupPublication(true)]);expect(f.saved().publishOnStartup).toBe(true);expect(f.saved().autoStartOnPublish).toBe(true);expect(f.saved().binding).not.toBeNull();
  });
  it('preserves and persists OBS invalidation occurring during a startup preference write',async()=>{
    const f=await fixture();await f.select();await f.controller.configurePublishStart(true);let finish!:()=>void;f.store.save.mockImplementationOnce(()=>new Promise<void>(resolve=>{finish=resolve;}));
    const saving=f.controller.configureStartupPublication(true);await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
    f.controller.obsChanged('SceneItemTransformChanged',{sceneName:'scene',sceneItemId:7});finish();await saving;
    expect(f.saved().publishOnStartup).toBe(true);expect(f.saved().binding?.context).toBe('invalid');expect(f.controller.view({status:'off',url:null,message:''}).settings.binding?.context).toBe('invalid');
    f.controller.setOnline(true);f.controller.preparePublishStart()();expect(f.desktop.prepare).not.toHaveBeenCalled();
  });
  it.each([false,true])('restores or stops on a failed rebase write (restore failure %s)',async restoreFails=>{
    const f=await fixture();await f.select();await f.controller.configurePublishStart(true);const save=f.store.save.getMockImplementation()!;let finish!:()=>void;
    f.store.save.mockImplementationOnce(settings=>new Promise<void>(resolve=>{finish=()=>{void save(settings).then(resolve);};})).mockRejectedValueOnce(new Error('rebase failed'));
    if(restoreFails)f.store.save.mockRejectedValueOnce(new Error('restore failed'));
    const operation=f.controller.configureStartupPublication(true),rejected=expect(operation).rejects.toThrow('rebase failed');await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
    f.controller.obsChanged('SceneItemTransformChanged',{sceneName:'scene',sceneItemId:7});finish();await rejected;
    const state=f.controller.view({status:'off',url:null,message:''});expect(state.settings.publishOnStartup).toBe(false);expect(state.settings.binding?.context).toBe('invalid');
    if(restoreFails){expect(state.available).toBe(false);expect(state.error).toContain('保存状態が不明');const start=vi.fn(async()=>undefined);await f.controller.publishAtStartup({start});expect(start).not.toHaveBeenCalled();}
    else{expect(f.saved().publishOnStartup).toBe(false);expect(f.saved().binding?.context).toBe('invalid');expect(state.available).toBe(true);}
  });
  it('finalizes the startup guard synchronously after persisting the latest invalidation',async()=>{
    const f=await fixture();await f.select();await f.controller.configurePublishStart(true);let finish!:()=>void;
    const completeStartupChange=vi.fn(()=>{expect(f.saved().binding?.context).toBe('invalid');return undefined;});Object.assign(f.store,{beginStartupChange:async()=>undefined,completeStartupChange});
    f.store.save.mockImplementationOnce(()=>new Promise<void>(resolve=>{finish=resolve;}));const saving=f.controller.configureStartupPublication(true);await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));f.controller.obsChanged('SceneItemTransformChanged',{sceneName:'scene',sceneItemId:7});finish();await saving;
    expect(completeStartupChange).toHaveBeenCalledTimes(1);expect(completeStartupChange.mock.results[0].value).toBeUndefined();expect(f.saved().publishOnStartup).toBe(true);expect(f.controller.view({status:'off',url:null,message:''}).settings.binding?.context).toBe('invalid');
  });
  it('uses authenticated management operations for opt-in and delivers its callback after publication', async () => {
    const f=await fixture();await f.select();const app=express(),access=new LocalAccess(13579,'management-token');app.use(access.requireHost,express.json());
    const publication={view:()=>({status:f.controller.publicView().accepting?'online' as const:'off' as const,url:null,message:''}),start:vi.fn(async(callback?:()=>void)=>{f.controller.setOnline(true);callback?.();}),stop:async()=>{f.controller.setOnline(false);}};
    registerReactionManagementRoutes(app,{controller:f.controller,publication},access.requireManagementRead,access.requireOperation);
    const post=(action:string)=>request(app).post(`/api/management/reactions/${action}`).set('Host','127.0.0.1:13579').set('Origin','http://127.0.0.1:13579').set('X-CasMate-Token','management-token');
    expect((await request(app).post('/api/management/reactions/auto-start').set('Host','127.0.0.1:13579').send({enabled:true})).status).toBe(403);
    expect((await request(app).post('/api/management/reactions/startup-publication').set('Host','127.0.0.1:13579').send({enabled:true})).status).toBe(403);
    expect((await request(app).post('/api/management/reactions/edit').set('Host','127.0.0.1:13579')).status).toBe(403);
    const preview = { mode: 'youtube', twitchChannel: 'example', youtubeVideoId: 'M7lc1UVf-VE' };
    expect((await request(app).post('/api/management/reactions/preview-settings').set('Host','127.0.0.1:13579').send(preview)).status).toBe(403);
    expect((await post('preview-settings').send({ ...preview, youtubeVideoId: 'https://example.com' })).status).toBe(400);
    const savedPreview = await post('preview-settings').send(preview);
    expect(savedPreview.status).toBe(200);
    expect(savedPreview.body.settings.preview).toEqual(preview);
    expect(f.controller.publicView()).not.toHaveProperty('preview');
    expect((await post('startup-publication').send({enabled:true,extra:1})).status).toBe(400);
    expect((await post('startup-publication').send({enabled:'yes'})).status).toBe(400);
    expect((await post('startup-publication').send({enabled:true})).status).toBe(200);expect(f.saved().publishOnStartup).toBe(true);expect(publication.start).not.toHaveBeenCalled();
    expect((await post('auto-start').send({enabled:true,extra:1})).status).toBe(400);
    expect((await post('auto-start').send({enabled:true})).status).toBe(200);expect(f.saved().autoStartOnPublish).toBe(true);expect(f.desktop.prepare).not.toHaveBeenCalled();
    expect((await post('publish')).status).toBe(200);await vi.waitFor(()=>expect(f.desktop.prepare).toHaveBeenCalledTimes(1));
    const current = f.controller.view(publication.view());
    expect(current.desktop.enabled).toBe(true);
    const settings = { ...current.settings, insets:{ ...current.settings.insets, left:5 } };
    const saves = f.store.save.mock.calls.length;
    expect((await post('edit').set('X-CasMate-Reaction-Instance', 'retired')).status).toBe(409);
    expect((await post('settings').set('X-CasMate-Reaction-Instance', 'retired').send(settings)).status).toBe(409);
    expect(f.controller.view(publication.view()).desktop.enabled).toBe(true);
    expect(f.store.save).toHaveBeenCalledTimes(saves);
    const first=(await post('edit').set('X-CasMate-Reaction-Instance', current.instance)).body.desktop;
    expect(first).toMatchObject({enabled:false,resume:'editing'});expect(f.controller.publicView()).not.toHaveProperty('desktop');
    const second=(await post('edit')).body.desktop;
    expect(second.editToken).not.toBe(first.editToken);
    expect((await post('edit-cancel').send({editToken:first.editToken})).body.desktop.enabled).toBe(false);
    expect((await post('edit-cancel').send({editToken:second.editToken})).body.desktop.enabled).toBe(true);
    const third=(await post('edit')).body.desktop;
    await post('stop');expect((await post('edit-cancel').send({editToken:third.editToken})).body.desktop.enabled).toBe(false);
    expect((await post('settings').set('X-CasMate-Reaction-Instance', current.instance).send(settings)).status).toBe(200);
    expect(f.saved().insets.left).toBe(5);
    expect((await post('unpublish')).status).toBe(200);expect(f.controller.publicView().accepting).toBe(false);
  });
  it('registers publication before a pending settings write so a later stop cannot be undone',async()=>{
    const f=await fixture();await f.select();let finish!:()=>void;f.store.save.mockImplementationOnce(()=>new Promise<void>(resolve=>{finish=resolve;}));
    const updating=f.controller.update({...defaultReactionSettings(),target:{title:target.title,processName:target.processName,className:target.className}});await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
    const app=express();app.use(express.json());let seen=false;app.use((req,_res,next)=>{if(req.path.endsWith('/publish'))seen=true;next();});const calls:string[]=[];
    const publication={view:()=>({status:f.controller.publicView().accepting?'online' as const:'off' as const,url:null,message:''}),start:async(callback?:()=>void)=>{calls.push('start');f.controller.setOnline(true);callback?.();},stop:async()=>{calls.push('stop');f.controller.setOnline(false);}};
    registerReactionManagementRoutes(app,{controller:f.controller,publication},(_req,_res,next)=>next(),(_req,_res,next)=>next());
    const publishing=request(app).post('/api/management/reactions/publish').then(res=>res);
    await vi.waitFor(()=>expect(seen).toBe(true));expect((await request(app).post('/api/management/reactions/unpublish')).status).toBe(200);
    finish();await updating;await publishing;expect(calls).toEqual(['start','stop']);expect(f.controller.publicView().accepting).toBe(false);
  });
  it.each(['SceneItemTransformChanged','SceneNameChanged'])('rejects automatic confirmation invalidated by %s during persistence',async event=>{
    const f=await fixture();await f.select();let finish!:()=>void;f.store.save.mockImplementationOnce(()=>new Promise<void>(resolve=>{finish=resolve;}));
    const configuring=f.controller.configurePublishStart(true), rejected=expect(configuring).rejects.toThrow();await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
    f.controller.obsChanged(event,{sceneName:event==='SceneNameChanged'?'renamed':'scene',oldSceneName:'scene',sceneItemId:7});vi.spyOn(f.read,'valid').mockReturnValue(false);finish();await rejected;
    expect(f.saved().autoStartOnPublish).toBe(false);expect(f.saved().binding).toBeNull();
  });
  it('allows unconfigured automatic selection and confirms manually selected bounds', async () => {
    const f=await fixture(); await f.controller.configurePublishStart(true); expect(f.saved().binding).toBeNull(); await f.controller.configurePublishStart(false);
    await f.select(); await f.controller.configurePublishStart(true);
    expect(f.saved().autoStartOnPublish).toBe(true); expect(f.saved().binding?.context).toBe(f.frames.latest()!.context);
    const published=await f.controller.preparePublishStart(); expect(f.controller.view({status:'off',url:null,message:''}).desktop.enabled).toBe(false);
    f.controller.setOnline(true); published(); await vi.waitFor(()=>expect(f.controller.view({status:'online',url:null,message:''}).desktop.enabled).toBe(true));
    expect(f.desktop.prepare).toHaveBeenCalledTimes(1);
    f.controller.setOnline(false); expect(f.controller.view({status:'off',url:null,message:''}).desktop.enabled).toBe(false);
  });
  it('does not auto-start when disabled, or after manual stop while publication is starting', async () => {
    const f=await fixture(); await f.select(); const disabled=await f.controller.preparePublishStart(); f.controller.setOnline(true); disabled(); expect(f.desktop.prepare).not.toHaveBeenCalled();
    await f.controller.configurePublishStart(true);
    let cancelled: (() => void) | undefined;
    await f.controller.requestPublication({ start: async (published, accepted) => { cancelled = published; accepted?.(); } });
    const starting = {status:'starting',url:null,message:''} as const;
    expect(f.controller.view(starting).desktop.preparing).toBe(true);
    f.controller.stopDesktop(); expect(f.controller.view(starting).desktop.preparing).toBe(false); cancelled?.();
    await Promise.resolve(); expect(f.desktop.prepare).not.toHaveBeenCalled();
  });
  it('exposes manual preparation to a second management request and rejects starts from a stopped generation', async () => {
    const f = await fixture();
    await f.select();
    let finish: (() => void) | undefined;
    vi.mocked(f.desktop.prepare).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const app = express();
    app.use(express.json());
    const publication = { view: () => ({ status: 'off' as const, url: null, message: '' }), start: async () => {}, stop: async () => {} };
    registerReactionManagementRoutes(app, { controller: f.controller, publication }, (_req, _res, next) => next(), (_req, _res, next) => next());
    const route = '/api/management/reactions';
    const operationToken = (await request(app).get(route)).body.desktop.operationToken;
    const starting = request(app).post(`${route}/start`).send({ operationToken }).then(result => result);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    expect((await request(app).get(route)).body.desktop.preparing).toBe(true);
    expect((await request(app).post(`${route}/stop`)).body.desktop.preparing).toBe(false);
    expect((await request(app).post(`${route}/start`).send({ operationToken })).status).toBe(409);
    finish?.();
    expect((await starting).status).toBe(409);
    expect((await request(app).get(route)).body.desktop).toMatchObject({ enabled:false, preparing:false });
  });
  it('waits for the first published image before automatic start', async () => {
    vi.useFakeTimers(); const f=await fixture(); await f.select(); await f.controller.configurePublishStart(true); f.frames.invalidate();
    const published=await f.controller.preparePublishStart(); f.controller.setOnline(true); published(); expect(f.desktop.prepare).not.toHaveBeenCalled();
    expect(f.controller.view({status:'online',url:null,message:''}).desktop.preparing).toBe(true);
    await f.frames.tick(); await vi.advanceTimersByTimeAsync(250); expect(f.desktop.prepare).toHaveBeenCalledTimes(1);
  });
  it('starts with a frame received just before the input deadline when window inventory was already fresh', async () => {
    vi.useFakeTimers();
    const f = await fixture();
    await f.controller.configurePublishStart(true);
    f.frames.invalidate();
    f.controller.setOnline(true);
    f.controller.preparePublishStart()();
    f.advance(7990);
    await f.frames.tick();
    f.advance(20);
    await vi.advanceTimersByTimeAsync(250);
    expect(f.controller.view({ status:'online',url:null,message:'' }).desktop).toMatchObject({ enabled:true, showing:true });
  });
  it('keeps publication online and explains an absent target after the bounded wait', async () => {
    vi.useFakeTimers(); const f=await fixture(); await f.select(); await f.controller.configurePublishStart(true); f.inventory.windows=[];
    const published=await f.controller.preparePublishStart(); f.controller.setOnline(true); published(); f.advance(8001); await vi.advanceTimersByTimeAsync(250);
    const state=f.controller.view({status:'online',url:null,message:''}); expect(state.desktop.enabled).toBe(false); expect(state.desktop.message).toContain('一意な対象'); expect(f.controller.publicView().accepting).toBe(true);
    await expect(f.controller.react({kind:'clap'})).resolves.toMatchObject({kind:'clap'}); expect(f.desktop.prepare).not.toHaveBeenCalled();
  });
  it('does not reuse invalidated bounds or automatically restart on reconnection', async () => {
    vi.useFakeTimers(); const f=await fixture(); await f.select(); await f.controller.configurePublishStart(true);
    f.controller.obsChanged('SceneItemTransformChanged',{sceneName:'scene',sceneItemId:7});
    const published=await f.controller.preparePublishStart(); f.controller.setOnline(true); published(); expect(f.controller.view({status:'online',url:null,message:''}).desktop.message).toContain('再確認');
    f.controller.setOnline(false); f.controller.setOnline(true); await f.frames.tick(); await vi.advanceTimersByTimeAsync(1000); expect(f.desktop.prepare).not.toHaveBeenCalled();
  });
  it.each(['stop','scene','settings','shutdown'])('cancels delayed auto-start on %s without reviving old results', async reason => {
    const f=await fixture(); await f.select(); await f.controller.configurePublishStart(true); let finish!:()=>void;
    vi.mocked(f.desktop.prepare).mockImplementation(()=>new Promise<void>(resolve=>{finish=resolve;}));
    const published=await f.controller.preparePublishStart(); f.controller.setOnline(true); published(); await vi.waitFor(()=>expect(f.desktop.prepare).toHaveBeenCalled());
    if(reason==='stop')f.controller.stopDesktop();
    if(reason==='scene'){ f.scene(); f.controller.obsChanged('CurrentProgramSceneChanged'); await f.frames.tick(); }
    if(reason==='settings')await f.controller.update({...f.saved(),insets:{left:1,top:0,right:0,bottom:0}});
    if(reason==='shutdown')await f.controller.shutdown();
    finish(); await Promise.resolve(); await Promise.resolve(); expect(f.controller.view({status:'online',url:null,message:''}).desktop.enabled).toBe(false);
  });
  it('reports automatic start failure and keeps public reactions available', async () => {
    const f=await fixture(); await f.select(); await f.controller.configurePublishStart(true); vi.mocked(f.desktop.prepare).mockRejectedValue(new Error('native failure'));
    const published=await f.controller.preparePublishStart(); f.controller.setOnline(true); published(); await vi.waitFor(()=>expect(f.controller.view({status:'online',url:null,message:''}).desktop.message).toContain('開始していません'));
    expect(f.controller.publicView().accepting).toBe(true); await expect(f.controller.react({kind:'heart'})).resolves.toMatchObject({kind:'heart'});
  });
  it('does not save automatic opt-in after a persistence failure and starts OFF after restoring opt-in', async () => {
    const f=await fixture(); await f.select(); f.store.save.mockRejectedValueOnce(new Error('disk')); await expect(f.controller.configurePublishStart(true)).rejects.toThrow(); expect(f.saved().autoStartOnPublish).toBe(false);
    await f.controller.configurePublishStart(true);
    const restored=new ReactionController(f.store,new ReactionFrames(()=>f.read),()=>f.read,f.desktop); await restored.initialize(); cleanup.push(()=>restored.shutdown());
    expect(restored.view({status:'off',url:null,message:''}).settings.autoStartOnPublish).toBe(true); expect(restored.publicView().accepting).toBe(false); expect(restored.view({status:'off',url:null,message:''}).desktop.enabled).toBe(false);
  });
  it('requires reconfirmation after editing bounds, and manual start confirms them for later publication', async () => {
    const f=await fixture(); await f.select(); await f.controller.configurePublishStart(true); await f.controller.update({...f.saved(),region:{x:0,y:0,width:.5,height:1}});
    const published=await f.controller.preparePublishStart(); f.controller.setOnline(true); published(); expect(f.desktop.prepare).not.toHaveBeenCalled();
    await f.controller.startDesktop(); expect(f.saved().binding).not.toBeNull(); expect(f.saved().autoStartOnPublish).toBe(true);
  });
  it('cancels native startup at the overall automatic deadline while publication remains online',async()=>{
    vi.useFakeTimers();const f=await fixture();await f.select();await f.controller.configurePublishStart(true);let finish!:()=>void;
    vi.mocked(f.desktop.prepare).mockImplementation(()=>new Promise<void>(resolve=>{finish=resolve;}));f.controller.setOnline(true);f.controller.preparePublishStart()();await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(16000);expect(f.controller.view({status:'online',url:null,message:''}).desktop.message).toContain('時間切れ');expect(f.controller.publicView().accepting).toBe(true);
    finish();await vi.advanceTimersByTimeAsync(0);expect(f.controller.view({status:'online',url:null,message:''}).desktop.enabled).toBe(false);
  });
  it('gives a manual start priority over a pending automatic window preparation',async()=>{
    const f=await fixture();await f.select();await f.controller.configurePublishStart(true);let finish!:()=>void;
    vi.mocked(f.desktop.prepare).mockImplementationOnce(()=>new Promise<void>(resolve=>{finish=resolve;}));f.controller.setOnline(true);f.controller.preparePublishStart()();await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
    await f.controller.startDesktop();finish();await Promise.resolve();await Promise.resolve();expect(f.controller.view({status:'online',url:null,message:''}).desktop.enabled).toBe(true);
  });
  it('does not persist a manual reconfirmation if OBS changes during its save',async()=>{
    const f=await fixture();await f.select();await f.controller.configurePublishStart(true);await f.controller.update({...f.saved(),insets:{left:1,top:0,right:0,bottom:0}});
    let finish!:()=>void;f.store.save.mockImplementationOnce(()=>new Promise<void>(resolve=>{finish=resolve;}));const starting=f.controller.startDesktop(),rejected=expect(starting).rejects.toThrow();await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
    f.controller.obsChanged('SceneItemTransformChanged',{sceneName:'scene',sceneItemId:7});vi.spyOn(f.read,'valid').mockReturnValue(false);finish();await rejected;expect(f.saved().binding).toBeNull();expect(f.controller.view({status:'off',url:null,message:''}).desktop.enabled).toBe(false);
  });
  it.each(['manual','automatic'])('invalidates %s bounds on rename before later scene edits and keeps publication alive', async mode => {
    const f = await fixture(); await f.select(); if (mode === 'automatic') await f.controller.detect('1');
    f.controller.setOnline(true); await f.controller.startDesktop();
    const publication = { status: 'online' as const, url: null, message: '' };
    f.controller.obsChanged('SceneNameChanged', { oldSceneName: 'unrelated', sceneName: 'another', sceneUuid: 'another-id' });
    expect(f.controller.view(publication).desktop.enabled).toBe(true);
    f.rename(); f.controller.obsChanged('SceneNameChanged', { oldSceneName: 'scene', sceneName: 'renamed', sceneUuid: 'program-scene' });
    f.controller.obsChanged('SceneItemCreated', { sceneName: 'renamed', sceneUuid: 'program-scene', sceneItemId: 99 });
    expect(f.controller.view(publication).desktop.enabled).toBe(false);
    expect(f.controller.view(publication).settings.binding?.context).toBe('invalid');
    expect(f.desktop.clear).toHaveBeenCalled(); expect(f.controller.publicView().accepting).toBe(true);
    await vi.waitFor(async()=>{await f.frames.tick();expect(f.frames.metadata()).not.toBeNull();});
    if(mode==='manual') {expect(f.controller.view(publication).desktop).toMatchObject({enabled:false,resume:'confirmation'});await f.controller.startDesktop();expect(f.controller.view(publication).desktop.enabled).toBe(true);}
    else await vi.waitFor(()=>expect(f.controller.view(publication).desktop.enabled).toBe(true));
    await expect(f.controller.react({ kind: 'heart' })).resolves.toMatchObject({ kind: 'heart' });
  });
  it('rejects saved automatic bounds if the scene was renamed while notifications were unavailable', async () => {
    const f = await fixture(); await f.controller.detect('1'); const context = f.saved().binding!.context;
    f.rename(); await f.frames.tick(); expect(f.frames.latest()!.context).toBe(context);
    await expect(f.controller.startDesktop()).rejects.toThrow('範囲を設定し直してください');
  });
  it.each(['manual','automatic'])('stops %s desktop rendering on target geometry changes without stopping publication', async mode => {
    const f = await fixture(); await f.select(); if (mode === 'automatic') await f.controller.detect('1');
    f.controller.setOnline(true); await f.controller.startDesktop();
    f.controller.obsChanged('SceneItemTransformChanged', { sceneName: 'scene', sceneUuid: 'program-scene', sceneItemId: 7, sceneItemTransform: { ...transform, positionX: 10, cropLeft: 2 } });
    expect(f.controller.view({status:'online',url:null,message:''}).desktop.enabled).toBe(false);
    expect(f.controller.publicView().accepting).toBe(true); expect(f.desktop.clear).toHaveBeenCalled();
  });
  it('ends OBS SSE and its heartbeat when the controller shuts down', async () => {
    const f=await fixture(), app=express();
    const publication: Pick<ReactionPublication,'view'|'start'|'stop'>={view:()=>({status:'off',url:null,message:''}),start:async()=>undefined,stop:async()=>undefined};
    registerReactionManagementRoutes(app,{controller:f.controller,publication},(_req,_res,next)=>next(),(_req,_res,next)=>next());
    const server=createServer(app); await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    const address=server.address(); if(!address || typeof address==='string') throw new Error('address');
    let ended!:Promise<void>;
    await new Promise<void>((resolve,reject)=>{get(`http://127.0.0.1:${address.port}/api/overlays/reactions/events`,response=>{ended=new Promise<void>(done=>response.once('end',done));response.once('data',()=>resolve());response.resume();}).on('error',reject);});
    await f.controller.shutdown(); await ended; expect((await request(app).get('/api/overlays/reactions/events')).status).toBe(503); await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  });
  it('restores settings with both publication and desktop off', async () => { const f = await fixture(); expect(f.controller.publicView().accepting).toBe(false); expect(f.controller.view({ status:'off',url:null,message:'' }).desktop.enabled).toBe(false); });
  it('requests JPEG50, keeps 24 frames and rejects expired or invalidated frames', async () => {
    const f = await fixture(); const id = f.frames.metadata()!.id;
    expect(f.read.request).toHaveBeenCalledWith('GetSourceScreenshot', expect.objectContaining({ imageCompressionQuality:50,imageWidth:32,imageHeight:18 }));
    for (let i=0;i<24;i++) { f.advance(500); await f.frames.tick(); } expect(f.frames.get(id)).toBeNull();
    const latest = f.frames.metadata()!.id; f.advance(12001); expect(f.frames.get(latest)).toBeNull(); await f.frames.tick(); const next = f.frames.metadata()!.id; f.frames.invalidate(); expect(f.frames.get(next)).toBeNull();
  });
  it('stops desktop on a verified scene change while continuing the next shared image', async () => {
    const f = await fixture();
    await f.select(); await f.controller.startDesktop(); f.controller.setOnline(true);
    const previous = f.frames.metadata()!;
    f.scene(); f.controller.obsChanged('CurrentProgramSceneChanged');
    await f.frames.tick();
    expect(f.controller.view({ status:'online',url:null,message:'' }).desktop).toMatchObject({ enabled:false, resume:'confirmation' });
    expect(f.frames.get(previous.id)).toBeNull();
    expect(f.frames.metadata()).not.toBeNull();
  });
  it('never enables desktop after stop during window preparation', async () => {
    const f=await fixture(); await f.select(); let finish!:()=>void; vi.mocked(f.desktop.prepare).mockImplementation(() => new Promise<void>(resolve => { finish=resolve; }));
    const starting=f.controller.startDesktop(); const rejected=expect(starting).rejects.toThrow(); await vi.waitFor(()=>expect(f.desktop.prepare).toHaveBeenCalled()); f.controller.stopDesktop(); finish(); await rejected;
    expect(f.controller.view({status:'off',url:null,message:''}).desktop.enabled).toBe(false);
  });
  it('does not migrate active rendering to another window of the same process', async () => { vi.useFakeTimers(); const f=await fixture(); await f.select(); await f.controller.startDesktop(); f.inventory.windows=[{...target,id:'2',pid:456}]; await vi.advanceTimersByTimeAsync(300); expect(f.controller.view({status:'off',url:null,message:''}).desktop.enabled).toBe(false); expect(f.desktop.marker).not.toHaveBeenCalled(); });
  it('detects the entire capture and persists identity hints without HWND/PID', async () => { const f=await fixture(); await f.controller.detect('1'); expect(f.saved().region).toEqual({x:0,y:0,width:1,height:1}); expect(f.saved().target).toEqual({title:'game',processName:'game.exe',className:'Game'}); expect(f.saved().binding?.item).toBe(7); });
  it('rolls back an automatic candidate cancelled during persistence', async () => {
    const f=await fixture(); let finish!:()=>void; f.store.save.mockImplementationOnce(() => new Promise<void>(resolve => { finish=resolve; }));
    const detection=f.controller.detect('1'); const rejected=expect(detection).rejects.toThrow(); await vi.waitFor(()=>expect(f.store.save).toHaveBeenCalled()); f.controller.stopDesktop(); finish(); await rejected; expect(f.saved().target).toBeNull();
  });
  it('accepts a current point and rejects stale coordinates, malformed input, and old scene', async () => {
    const f=await fixture(); f.controller.setOnline(true); const point={kind:'point',frameId:f.frames.metadata()!.id,x:.5,y:.5};
    expect(await f.controller.react(point)).toMatchObject({kind:'point',sequence:1});
    await expect(f.controller.react({...point,x:NaN})).rejects.toThrow(); f.scene(); await expect(f.controller.react(point)).rejects.toThrow(); f.frames.invalidate(); await expect(f.controller.react(point)).rejects.toThrow();
  });
  it.each(['notified', 'not notified'] as const)('rejects an old image when a program scene is renamed (%s)', async notification => {
    const f = await fixture();
    f.controller.setOnline(true);
    const old = f.frames.metadata()!.id;
    f.rename();
    if (notification === 'notified') {
      f.controller.obsChanged('SceneNameChanged', { oldSceneName:'scene', sceneName:'renamed', sceneUuid:'program-scene' });
      expect(f.frames.get(old)).toBeNull();
    }
    await expect(f.controller.react({ kind:'point', frameId:old, x:.5, y:.5 })).rejects.toMatchObject({ status:409 });
    await f.frames.tick();
    expect(f.frames.get(old)).toBeNull();
    const latest = f.frames.metadata()!.id;
    await expect(f.controller.react({ kind:'point', frameId:latest, x:.5, y:.5 })).resolves.toMatchObject({ sequence:1 });
  });
  it.each(['scene', 'canvas', 'collection'] as const)('rejects a position if its OBS %s changes during reads before a notification arrives', async context => {
    const f = await fixture();
    f.controller.setOnline(true);
    const read = f.read.request;
    let changed = false;
    f.read.request = async (type, data) => {
      const response = await read(type, data);
      if (type === 'GetVideoSettings') {
        const video = changed && context === 'canvas' ? { ...response, baseWidth:64 } : response;
        changed = true;
        if (context === 'scene') f.scene();
        return video;
      }
      if (type === 'GetSceneCollectionList' && changed && context === 'collection') return { currentSceneCollectionName:'next' };
      return response;
    };
    await expect(f.controller.react({ kind:'point', frameId:f.frames.metadata()!.id, x:.5, y:.5 })).rejects.toMatchObject({ status:409 });
    expect(f.controller.publicView().sequence).toBe(0);
  });
  it('returns a stale-image response when a scene switch interrupts the OBS read for a public point', async () => {
    const f = await fixture();
    f.controller.setOnline(true);
    const cookie = await f.cookie();
    const frameId = f.frames.metadata()!.id;
    const read = f.read.request;
    f.read.request = async (type, data) => {
      if (type === 'GetVideoSettings') {
        f.scene();
        f.controller.obsChanged('CurrentProgramSceneChanged');
        throw new Error('OBS_CAPTURE_CHANGED');
      }
      return read(type, data);
    };
    expect((await f.send(cookie, { kind:'point', frameId, x:.5, y:.5 })).status).toBe(409);
    expect(f.controller.publicView().sequence).toBe(0);
  });
  it('distinguishes a retired image ID from a failed OBS context check', async () => {
    const f = await fixture();
    f.controller.setOnline(true);
    const cookie = await f.cookie();
    const frameId = f.controller.publicView().frame!.id;
    const original = await request(f.app).get('/frame').set('Host','reactions.example');
    expect(original.body).toMatchObject({ id:frameId, instance:expect.any(String) });
    expect(original.body.instance).not.toBe(f.controller.instance);
    f.scene();
    const mismatched = await f.send(cookie, { kind:'point',frameId,x:.5,y:.5 });
    expect(mismatched.status).toBe(409);
    expect(mismatched.body).not.toHaveProperty('code');
    f.scene('scene');
    f.advance(12001);
    await f.frames.tick();
    expect(f.controller.publicView().frame!.id).not.toBe(frameId);
    const retired = await f.send(cookie, { kind:'point',frameId,x:.5,y:.5 });
    expect(retired.status).toBe(409);
    expect(retired.body).toMatchObject({ code:'FRAME_RETIRED', instance:original.body.instance, generation:f.controller.publicView().frameGeneration });
    const restarted = createReactionPublicApplication({ controller:f.controller, host:()=>'reactions.example',
      online:()=>true, nonce:'test', assets:new Map() });
    const next = await request(restarted).get('/frame').set('Host','reactions.example');
    expect(next.body).toMatchObject({ instance:expect.any(String), generation:retired.body.generation });
    expect(next.body.instance).not.toBe(original.body.instance);
  });
  it('identifies image expiry during otherwise successful OBS context checks', async () => {
    const f = await fixture();
    f.controller.setOnline(true);
    const cookie = await f.cookie();
    const frame = f.controller.publicView().frame!;
    const read = f.read.request;
    let expire = true;
    f.read.request = async (type, data) => {
      if (type === 'GetVideoSettings' && expire) {
        expire = false;
        f.advance(12001);
        await f.frames.tick();
      }
      return read(type, data);
    };
    const response = await f.send(cookie, { kind:'point',frameId:frame.id,x:.5,y:.5 });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code:'FRAME_RETIRED',generation:frame.generation });
    expect(f.controller.publicView()).toMatchObject({ sequence:0, frame:{id:expect.any(String),generation:frame.generation} });
    expect(f.controller.publicView().frame?.id).not.toBe(frame.id);
  });
  it('keeps the management preview across publication loss while retiring the old public frame', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const f = await fixture();
    const host = 'reactions.example';
    const publication = { status:'off' as const, url:null, message:'' };
    f.controller.setOnline(true);
    const frame = f.controller.publicView().frame!;
    const cookie = await f.cookie();
    const publicJpeg = () => request(f.app).get(frame.url).set('Host', host);
    expect((await publicJpeg()).status).toBe(200);
    f.controller.setOnline(false);
    expect(f.controller.view(publication).frame?.id).toBe(frame.id);
    expect(f.frames.get(frame.id)?.bytes.length).toBeGreaterThan(0);
    expect(f.controller.publicView().frame).toBeNull();
    const unavailable = await publicJpeg();
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers['x-casmate-frame-state']).toBe('unavailable');
    await request(f.app).get('/frame').set('Host', host).expect(503).expect('X-CasMate-Frame-State', 'unavailable');

    f.controller.setOnline(true);
    await request(f.app).get('/frame').set('Host', host).expect(503).expect('X-CasMate-Frame-State', 'unavailable');
    await publicJpeg().expect(410).expect('X-CasMate-Frame-State', 'unavailable');
    expect((await f.send(cookie, {kind:'point',frameId:frame.id,x:.5,y:.5})).status).toBe(409);
    f.advance(800);
    expect((await f.send(cookie, {kind:'area',frameId:frame.id,shape:'rectangle',area:{x:0,y:0,width:.5,height:.5}})).status).toBe(409);

    await f.frames.tick();
    const next = (await request(f.app).get('/frame').set('Host', host)).body;
    expect(next).toMatchObject({id:expect.any(String),generation:f.controller.publicView().frameGeneration});
    expect(next.id).not.toBe(frame.id);
    expect(next.generation).toBeGreaterThan(frame.generation);
    expect((await request(f.app).get(next.url).set('Host', host)).status).toBe(200);
    f.advance(800);
    expect((await f.send(cookie, {kind:'point',frameId:next.id,x:.5,y:.5})).status).toBe(200);
  });
  it('waits for a public image before starting PC display on explicit republication', async () => {
    vi.useFakeTimers();
    const f = await fixture();
    const capture = vi.spyOn(f.frames, 'tick').mockResolvedValue();
    await f.controller.configurePublishStart(true);
    f.controller.setOnline(true);
    f.controller.setOnline(false);
    const publish = f.controller.preparePublishStart();
    f.controller.setOnline(true);
    publish();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.controller.publicView().frame).toBeNull();
    expect(f.desktop.prepare).not.toHaveBeenCalled();

    capture.mockRestore();
    await f.frames.tick();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.desktop.prepare).toHaveBeenCalledTimes(1);
  });
  it('keeps a capture already in flight at publication loss private after reconnecting', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const f = await fixture();
    f.controller.setOnline(true);
    const oldId = f.controller.publicView().frame!.id;
    const originalRequest = f.read.request;
    let finish!: () => void;
    const held = new Promise<void>(resolve => { finish = resolve; });
    f.read.request = async (type, data) => {
      if (type === 'GetSourceScreenshot') await held;
      return originalRequest(type, data);
    };
    const capture = f.frames.tick();
    f.controller.setOnline(false);
    f.controller.setOnline(true);
    finish();
    await capture;
    const local = f.controller.view({status:'online',url:null,message:''}).frame!;
    expect(local.id).not.toBe(oldId);
    expect(f.controller.publicView().frame).toBeNull();
    expect((await request(f.app).get(local.url).set('Host','reactions.example')).status).toBe(410);
    await f.frames.tick();
    expect(f.controller.publicView().frame?.id).not.toBe(local.id);
    expect(f.controller.publicView().frame?.id).toBe(f.frames.metadata()?.id);
  });
  it('rejects an in-flight point across publication stop and restart', async () => {
    const f=await fixture(); f.controller.setOnline(true); const point={kind:'point',frameId:f.frames.metadata()!.id,x:.5,y:.5};
    let resolve!:(value:Record<string,unknown>)=>void; vi.mocked(f.read.request).mockImplementationOnce(()=>new Promise(done=>{resolve=done;})); const sending=f.controller.react(point); const rejected=expect(sending).rejects.toThrow(); f.controller.setOnline(false); f.controller.setOnline(true); resolve({currentSceneCollectionName:'collection'}); await rejected; expect(f.controller.publicView().sequence).toBe(0);
  });
  it('still delivers the OBS point when desktop tracking stops during the same reaction', async()=>{
    const f=await fixture();await f.select();await f.controller.startDesktop();f.controller.setOnline(true);
    let seen=0, delivered=0;f.controller.subscribe((name,data)=>{if(name==='snapshot')seen=data.sequence;if(name==='reaction' && data.sequence>seen)delivered++;});
    f.inventory.windows=[];await f.controller.react({kind:'point',frameId:f.frames.metadata()!.id,x:.5,y:.5});expect(delivered).toBe(1);
  });
  it('exposes only the dedicated public assets with Host, Origin and Cookie guards', async () => {
    const f=await fixture(); f.controller.setOnline(true); const cookie=await f.cookie();
    expect((await f.send(cookie,{kind:'heart'})).status).toBe(200); expect((await f.send(cookie,{kind:'heart'})).status).toBe(429);
    expect((await request(f.app).get('/frame').set('Host','evil.example')).status).toBe(403);
    expect((await request(f.app).post('/react').set('Host','reactions.example').send({kind:'heart'})).status).toBe(403);
    for(const path of ['/api/bootstrap','/api/management/reactions','/overlay/reactions','/package.json']) expect((await request(f.app).get(path).set('Host','reactions.example')).status).toBe(404);
    const body=(await request(f.app).get('/frame').set('Host','reactions.example')).body; expect(JSON.stringify(body)).not.toMatch(/game.exe|collection|scene/);
    f.controller.setOnline(false); expect((await request(f.app).get('/frame').set('Host','reactions.example')).status).toBe(503);
  });
  it('confirms the current public image generation when metadata requests are rate limited', async () => {
    const f = await fixture();
    f.controller.setOnline(true);
    const getFrame = () => request(f.app).get('/frame').set('Host','reactions.example');
    let instance: string | undefined;
    for (let batch = 0; batch < 8; batch++) {
      const replies = await Promise.all(Array.from({ length:64 }, getFrame));
      expect(replies.every(reply => reply.status === 200)).toBe(true);
      instance ??= replies[0].body.instance;
    }
    const limited = await getFrame();
    expect(limited.status).toBe(429);
    expect(instance).toEqual(expect.any(String));
    expect(limited.body).toMatchObject({ instance, generation:f.controller.publicView().frame!.generation });
    const url = f.controller.publicView().frame!.url;
    const getJpeg = () => request(f.app).get(url).set('Host','reactions.example');
    const validJpeg = await getJpeg();
    expect(validJpeg.status).toBe(429);
    expect(validJpeg.headers['x-casmate-frame-state']).toBeUndefined();
    f.frames.invalidate();
    const retiredJpeg = await getJpeg();
    expect(retiredJpeg.status).toBe(429);
    expect(retiredJpeg.headers['x-casmate-frame-state']).toBe('unavailable');
    await f.frames.tick();
    const replacedJpeg = await getJpeg();
    expect(replacedJpeg.status).toBe(429);
    expect(replacedJpeg.headers['x-casmate-frame-state']).toBe('unavailable');
    expect(replacedJpeg.headers['x-casmate-frame-reason']).toBe('retired');
    f.controller.setOnline(false);
    const offline = await getFrame();
    expect(offline.status).toBe(429);
    expect(offline.headers['x-casmate-frame-state']).toBe('unavailable');
    expect(offline.body).not.toHaveProperty('generation');
    expect(offline.body).not.toHaveProperty('instance');
    f.controller.setOnline(true);
    f.advance(1000);
    await f.frames.tick();
    const normalRetirement = await getJpeg();
    expect(normalRetirement.status).toBe(410);
    expect(normalRetirement.headers['x-casmate-frame-state']).toBe('unavailable');
    expect(normalRetirement.headers['x-casmate-frame-reason']).toBe('retired');
  });
  it('serves 50 listeners for repeated 500ms image updates while sharing one capture', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }); const f=await fixture(); f.controller.setOnline(true); vi.mocked(f.read.request).mockClear();
    for(let round=0;round<4;round++) {
      f.advance(500); await f.frames.tick(); const id=f.frames.metadata()!.id;
      const responses=await Promise.all(Array.from({length:50},async()=>[await request(f.app).get('/frame').set('Host','reactions.example'),await request(f.app).get(`/frame.jpg?id=${id}`).set('Host','reactions.example')]));
      expect(responses.flat().every(result=>result.status===200)).toBe(true);
    }
    expect(vi.mocked(f.read.request).mock.calls.filter(([type])=>type==='GetSourceScreenshot')).toHaveLength(4);
  });
  it('reopens the public image and cookie limits on elapsed time after the wall clock moves backwards', async () => {
    let elapsed = 10000, wall = 100000;
    const monotonicClock = vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
    const wallClock = vi.spyOn(Date, 'now').mockImplementation(() => wall);
    try {
      const f = await fixture(true);
      f.controller.setOnline(true);
      const cookie = await f.cookie();
      await f.send(cookie,{kind:'heart'}).expect(200);
      const getFrame = () => request(f.app).get('/frame').set('Host','reactions.example');
      for (let batch = 0; batch < 8; batch++) {
        await Promise.all(Array.from({ length:64 }, () => getFrame().expect(200)));
      }
      wall -= 60000;
      elapsed += 799;
      await f.send(cookie,{kind:'heart'}).expect(429);
      await getFrame().expect(429);
      elapsed++;
      await f.send(cookie,{kind:'heart'}).expect(200);
      await getFrame().expect(429);
      elapsed += 200;
      await getFrame().expect(200);
    } finally {
      monotonicClock.mockRestore(); wallClock.mockRestore();
    }
  });
  it('separately limits reaction bursts to 20/s', async () => {
    const f=await fixture(); f.controller.setOnline(true); const cookies=await Promise.all(Array.from({length:21},()=>f.cookie())); f.advance(1000);
    const statuses=await Promise.all(cookies.map(cookie=>f.send(cookie,{kind:'clap'}).then(res=>res.status))); expect(statuses.filter(status=>status===200)).toHaveLength(20); expect(statuses.filter(status=>status===429)).toHaveLength(1);
  });
});
describe('reaction capture geometry',()=>{
  it('fits a crop into client physical pixels and letterboxes without stretching',()=>{ expect(reactionViewport(target,{left:0,top:0,right:0,bottom:0},1920,1080,{x:0,y:0,width:1,height:1})).toEqual({x:100,y:200,width:640,height:360}); });
  it.each([{rotation:1},{cropLeft:-2},{scaleX:-1},{boundsType:'OBS_BOUNDS_STRETCH'}])('refuses unsupported transform %j',override=>{expect(reactionSourceRegion({...transform,...override},32,18)).toBeNull();});
});
