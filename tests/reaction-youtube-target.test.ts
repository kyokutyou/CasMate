import request from 'supertest';
import { createReactionPublicApplication } from '../src/main/reactions/reaction-public-server';
import { afterEach, expect, it, vi } from 'vitest';
import { resolveYouTubeLiveTarget } from '../src/main/sources/youtube-source';
import { ReactionController } from '../src/main/reactions/reaction-controller';
import { ReactionFrames } from '../src/main/reactions/reaction-frames';
import { defaultReactionSettings, validReactionPreviewSettings } from '../src/shared/listener-reactions';

afterEach(() => vi.unstubAllGlobals());
it.each(['obs','twitch','youtube'] as const)('resolves a handle when changing an online %s preview to YouTube', async mode => {
  const settings=defaultReactionSettings(); settings.preview.mode=mode;
  const read={valid:()=>false,request:async()=>{throw Error('offline');}};
  const controller=new ReactionController({load:async()=>settings,save:async()=>{}},new ReactionFrames(()=>read),()=>read,{
    inventory:()=>({windows:[],foreground:'',observedAt:0}),demand(){},prepare:async()=>{},render(){},marker(){},reaction(){},clear(){},close(){},
  });
  await controller.initialize(); controller.setOnline(true);
  const fetcher=vi.fn<typeof fetch>(async url=>new Response(String(url).includes('/channel/')
    ? '<link rel="canonical" href="https://www.youtube.com/watch?v=abcdefghijk">' : '"externalId":"UCabcdefghijklmnopqrstuv"'));
  vi.stubGlobal('fetch',fetcher);
  try {
    await controller.configureListenerPreview({mode:'youtube',twitchChannel:'',youtubeVideoId:'',youtubeTarget:'@caster'});
    expect(controller.listenerPreview().youtubeVideoId).toBe('abcdefghijk');
    expect(controller.publicView().accepting).toBe(true);
    const app=createReactionPublicApplication({controller,host:()=>'listener.example',online:()=>true,nonce:'test',assets:new Map([['/',{body:Buffer.from('<meta name="casmate-preview">'),type:'text/html'}]])});
    const page=await request(app).get('/').set('Host','listener.example');
    expect(page.status).toBe(200);expect(page.text).toContain('data-mode="youtube" data-id="abcdefghijk"');
    fetcher.mockRejectedValueOnce(new Error('network unavailable'));
    await expect(controller.configureListenerPreview({mode:'youtube',twitchChannel:'',youtubeVideoId:'',youtubeTarget:'@other'})).rejects.toThrow('network unavailable');
    expect(controller.listenerPreview().youtubeVideoId).toBe('abcdefghijk');
    expect(controller.view({status:'online',url:'https://example.com',message:''}).settings.preview.youtubeTarget).toBe('@caster');
    await controller.configureListenerPreview({mode:'youtube',twitchChannel:'',youtubeVideoId:'12345678901'});
    expect(controller.listenerPreview().youtubeVideoId).toBe('12345678901');
  } finally {await controller.shutdown();}
});
it('resolves handles through the channel live page and accepts direct live IDs without network', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('"externalId":"UCabcdefghijklmnopqrstuv"'))
    .mockResolvedValueOnce(new Response('<link rel="canonical" href="https://www.youtube.com/watch?v=abcdefghijk">'));
  expect(await resolveYouTubeLiveTarget('@caster', new AbortController().signal, fetcher)).toBe('abcdefghijk');
  expect(String(fetcher.mock.calls[1][0])).toBe('https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv/live');
  expect(await resolveYouTubeLiveTarget('https://youtu.be/abcdefghijk', new AbortController().signal, fetcher)).toBe('abcdefghijk');
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('rejects missing live results rather than choosing an arbitrary video', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('<a href="/watch?v=abcdefghijk">old video</a>'));
  await expect(resolveYouTubeLiveTarget('UCabcdefghijklmnopqrstuv',new AbortController().signal,fetcher)).rejects.toThrow('現在のライブ');
});
it('preserves a handle in settings, resolves anew per publication and cancels stale results', async () => {
  const settings = defaultReactionSettings();
  settings.preview = {mode:'youtube', twitchChannel:'', youtubeVideoId:'', youtubeTarget:'@caster'};
  expect(validReactionPreviewSettings(settings.preview)).toBe(true);
  const read = {valid:()=>false,request:async()=>{throw Error('offline');}};
  let save: () => Promise<void> = async()=>{};
  const controller = new ReactionController({load:async()=>settings,save:()=>save()},new ReactionFrames(()=>read),()=>read,{
    inventory:()=>({windows:[],foreground:'',observedAt:0}),demand(){},prepare:async()=>{},render(){},marker(){},reaction(){},clear(){},close(){},
  });
  await controller.initialize();
  const start = vi.fn(async()=>{});
  let id = 'abcdefghijk';
  const fetcher = vi.fn<typeof fetch>(async url => new Response(String(url).includes('/channel/')
    ? `<link rel="canonical" href="https://www.youtube.com/watch?v=${id}">` : '"externalId":"UCabcdefghijklmnopqrstuv"'));
  vi.stubGlobal('fetch',fetcher);
  try {
    await controller.requestPublication({start});
    expect(controller.listenerPreview()).toEqual({mode:'youtube',twitchChannel:'',youtubeVideoId:id});
    id='12345678901';await controller.requestPublication({start});
    expect(controller.listenerPreview().youtubeVideoId).toBe(id);
    expect(fetcher).toHaveBeenCalledTimes(4);
    fetcher.mockImplementationOnce(async()=>{expect(controller.view({status:'off',url:null,message:''}).publication.status).toBe('starting');controller.cancelPreviewLookup();return new Response('"externalId":"UCabcdefghijklmnopqrstuv"');});
    await expect(controller.requestPublication({start})).rejects.toThrow('取り消し');
    expect(start).toHaveBeenCalledTimes(2);
    expect(controller.listenerPreview().youtubeVideoId).toBe('');
    let finishSave!:()=>void, finishLookup!:(value:Response)=>void;
    save=()=>new Promise(resolve=>{finishSave=resolve;});
    const saving=controller.configureListenerPreview({...settings.preview,youtubeTarget:'@newcaster'});
    await vi.waitFor(()=>expect(finishSave).toBeTypeOf('function'));
    fetcher.mockImplementationOnce(()=>new Promise(resolve=>{finishLookup=resolve;}));
    const publishing=controller.requestPublication({start});
    const rejected=expect(publishing).rejects.toThrow('取り消し');
    finishSave();await saving;
    finishLookup(new Response('"externalId":"UCabcdefghijklmnopqrstuv"'));
    await rejected;expect(start).toHaveBeenCalledTimes(2);
  } finally { await controller.shutdown(); }
});
