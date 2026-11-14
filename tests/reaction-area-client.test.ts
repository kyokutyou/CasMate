// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { setupRangeTool } from '../src/renderer/reactions/client/range-tool.mjs';
import { placeArea } from '../src/renderer/reactions/client/range.mjs';
import { watchFrames } from '../src/renderer/reactions/client/pointing.mjs';
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();document.body.replaceChildren();});
it.each([
 ['ellipse','pointer'],['rectangle','pointer'],['ellipse','keyboard'],['rectangle','keyboard'],
])('keeps %s selection free of dots while preserving %s preview and confirmation',async(shape,input)=>{
 const f=fixture(),button=shape==='ellipse'?f.buttons.ellipse:f.buttons.rectangle;
 try{
  button.click();expect(f.layer.childElementCount).toBe(0);
  if(input==='pointer')f.pointer('pointerdown',100,100);else f.key('Enter');
  expect(f.layer.childElementCount).toBe(0);
  if(input==='pointer')f.pointer('pointermove',600,300);else{f.key('ArrowRight');f.key('ArrowDown');}
  const tag=shape==='ellipse'?'ellipse':'rect';
  expect(f.layer.querySelector('.range-preview '+tag)).not.toBeNull();
  expect(f.layer.querySelector('.range-cursor,.point-dot')).toBeNull();expect(f.submit).not.toHaveBeenCalled();
  if(input==='pointer')f.pointer('pointerup',600,300);else f.key('Enter');
  await vi.advanceTimersByTimeAsync(0);
  expect(f.submit).toHaveBeenCalledOnce();
  expect(f.layer.querySelector('.range-marker:not(.range-preview,.range-pending) '+tag)).not.toBeNull();
  expect(f.layer.querySelector('.range-cursor,.point-dot')).toBeNull();
 }finally{f.control.close();}
});
const retiredJpegHeaders = () => new Headers({
  'X-CasMate-Frame-State':'unavailable', 'X-CasMate-Frame-Reason':'retired',
});
function fixture(remaining=()=>Infinity){
 vi.useFakeTimers();vi.spyOn(document,'hidden','get').mockReturnValue(false);
 vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});
 document.body.innerHTML='<button id="ellipse"></button><button id="rectangle"></button><div id="stage" tabindex="0"></div><div id="layer"></div><p></p>';
 const stage=document.querySelector('#stage')!,layer=document.querySelector('#layer')!,hint=document.querySelector('p')!,buttons={ellipse:document.querySelector('#ellipse')!,rectangle:document.querySelector('#rectangle')!};
 let frame:{id:string;generation:number;canvasWidth:number}|null={id:'frame',generation:1,canvasWidth:1920};
 const submit=vi.fn(async()=>({at:Date.now()})),pause=vi.fn(),resume=vi.fn();
 const control=setupRangeTool({buttons,stage,layer,hint,getFrame:()=>frame,getPoint:(x:number,y:number,clamp:boolean)=>clamp?{x:Math.max(0,Math.min(1,x/1000)),y:Math.max(0,Math.min(1,y/500))}:x>=0&&x<=1000&&y>=0&&y<=500?{x:x/1000,y:y/500}:null,submit,pause,resume,remaining});
 const pointer=(type:string,x:number,y:number)=>{const e=new MouseEvent(type,{button:0,clientX:x,clientY:y,bubbles:true,cancelable:true});Object.defineProperties(e,{pointerId:{value:1},isPrimary:{value:true}});stage.dispatchEvent(e);};
 const key=(value:string)=>stage.dispatchEvent(new KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true}));
 return {stage,layer,hint,buttons,submit,pause,resume,control,pointer,key,setFrame:(value:typeof frame)=>{frame=value;}};
}
it('normalizes reverse dragging and commits only once after release',async()=>{
 const f=fixture();f.buttons.ellipse.click();f.pointer('pointerdown',800,400);f.pointer('pointermove',200,100);expect(f.submit).not.toHaveBeenCalled();expect(f.pause).toHaveBeenCalledOnce();f.pointer('pointerup',200,100);await vi.advanceTimersByTimeAsync(0);
 expect(f.submit).toHaveBeenCalledOnce();const payload=f.submit.mock.calls[0][0];expect(payload).toMatchObject({kind:'area',shape:'ellipse',frameId:'frame'});expect(payload.area.x).toBe(.2);expect(payload.area.width).toBeCloseTo(.6);expect(f.buttons.ellipse.getAttribute('aria-pressed')).toBe('false');expect(f.resume).toHaveBeenCalled();f.control.close();
});
it.each(['Escape','pointercancel','timeout','background','invalidate'])('cancels %s without submitting or restoring a selection',async reason=>{
 const f=fixture();f.buttons.rectangle.click();f.pointer('pointerdown',100,100);f.pointer('pointermove',600,300);
 if(reason==='Escape')f.key('Escape');if(reason==='pointercancel')f.pointer('pointercancel',600,300);if(reason==='timeout')await vi.advanceTimersByTimeAsync(10000);if(reason==='background'){vi.spyOn(document,'hidden','get').mockReturnValue(true);document.dispatchEvent(new Event('visibilitychange'));}if(reason==='invalidate'){f.setFrame(null);f.control.invalidate();}
 f.pointer('pointerup',600,300);expect(f.submit).not.toHaveBeenCalled();expect(f.layer.childElementCount).toBe(0);expect(f.buttons.rectangle.getAttribute('aria-pressed')).toBe('false');expect(f.resume).toHaveBeenCalled();f.control.close();
});
it('supports keyboard corners and rejects tiny drags',async()=>{
 const f=fixture();f.buttons.rectangle.click();f.pointer('pointerdown',100,100);f.pointer('pointerup',101,101);expect(f.submit).not.toHaveBeenCalled();f.buttons.rectangle.click();f.key('Enter');f.key('ArrowRight');f.key('ArrowDown');f.key('Enter');await vi.advanceTimersByTimeAsync(0);expect(f.submit).toHaveBeenCalledOnce();expect(f.submit.mock.calls[0][0].area.width).toBeCloseTo(.05);f.control.close();
});
it('announces keyboard corners without a dot and previews the selected range',async()=>{
 const f=fixture();f.buttons.rectangle.click();
 const cursor=()=>f.layer.querySelector('.range-cursor') as HTMLElement|null;
 expect(cursor()).toBeNull();expect(f.layer.childElementCount).toBe(0);
 f.key('ArrowRight');expect(cursor()).toBeNull();expect(f.hint.textContent).toContain('始点: 横30%・縦25%');expect(f.submit).not.toHaveBeenCalled();
 f.key('Enter');expect(cursor()).toBeNull();expect(f.hint.textContent).toContain('終点');
 f.key('ArrowRight');f.key('ArrowDown');expect(f.layer.querySelector('rect')).not.toBeNull();expect(f.hint.textContent).toContain('終点: 横35%・縦30%');
 f.key('Escape');expect(f.layer.childElementCount).toBe(0);expect(f.submit).not.toHaveBeenCalled();f.control.close();
});
it.each([-60000,60000])('uses monotonic elapsed time despite wall clock offset %i',async offset=>{
 const f=fixture();let finish!:(value:unknown)=>void;const serverAt=Date.now();
 f.submit.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 f.buttons.ellipse.click();f.pointer('pointerdown',100,100);f.pointer('pointerup',600,300);
 await vi.advanceTimersByTimeAsync(500);vi.spyOn(Date,'now').mockReturnValue(serverAt+offset);finish({at:serverAt});await vi.advanceTimersByTimeAsync(0);
 expect(f.layer.querySelector('.range-marker:not(.range-pending)')).not.toBeNull();
 await vi.advanceTimersByTimeAsync(3499);expect(f.layer.childElementCount).toBe(1);
 await vi.advanceTimersByTimeAsync(1);expect(f.layer.childElementCount).toBe(0);f.control.close();
});
it('does not revive a successful outline after a response takes four seconds',async()=>{
 const f=fixture();let finish!:(value:unknown)=>void;f.submit.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 f.buttons.ellipse.click();f.pointer('pointerdown',100,100);f.pointer('pointerup',600,300);
 await vi.advanceTimersByTimeAsync(4001);finish({at:Date.now()});await vi.advanceTimersByTimeAsync(0);expect(f.layer.childElementCount).toBe(0);f.control.close();
});
it('drops pending previews after invalidation even if a send succeeds late',async()=>{
 const f=fixture();let finish!:(value:unknown)=>void;f.submit.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));f.buttons.ellipse.click();f.pointer('pointerdown',100,100);f.pointer('pointerup',600,300);f.control.invalidate();finish({at:Date.now()});await vi.advanceTimersByTimeAsync(0);expect(f.layer.childElementCount).toBe(0);expect(f.buttons.ellipse.getAttribute('aria-pressed')).toBe('false');f.control.close();
});
it('caps frames, applies canvas clipping, and removes them after four seconds',async()=>{
 const f=fixture();for(let i=0;i<5;i++)placeArea(f.layer,{x:.1,y:.2,width:.3,height:.4},i%2?'ellipse':'rectangle',1920,{clip:{x:.25,y:0,width:.5,height:1}});
 expect(f.layer.childElementCount).toBe(3);expect((f.layer.firstElementChild as HTMLElement).style.clipPath).toBe('inset(0% 25% 0% 25%)');await vi.advanceTimersByTimeAsync(4000);expect(f.layer.childElementCount).toBe(0);
});
it.each(['preview','pending'])('keeps three accepted outlines while another outline is %s',async state=>{
 const f=fixture();
 const accepted=Array.from({length:3},()=>placeArea(f.layer,{x:.1,y:.2,width:.3,height:.4},'rectangle'));
 f.buttons.ellipse.click();f.pointer('pointerdown',100,100);
 if(state==='preview')f.pointer('pointermove',600,300);
 else f.pointer('pointerup',600,300);
 expect(f.layer.querySelector(`.range-${state}`)).not.toBeNull();
 expect(Array.from(f.layer.children).slice(0,3)).toEqual(accepted);
 if(state==='preview'){
  f.key('Escape');expect(Array.from(f.layer.children)).toEqual(accepted);
 }else{
  await vi.advanceTimersByTimeAsync(0);expect(f.layer.childElementCount).toBe(3);
  expect(f.layer.contains(accepted[0])).toBe(false);
 }
 f.control.close();
});

it('uses a newer authoritative deadline for the same image without showing a wait state',async()=>{
 vi.useFakeTimers();vi.spyOn(document,'hidden','get').mockReturnValue(false);
 if(!HTMLImageElement.prototype.decode)Object.defineProperty(HTMLImageElement.prototype,'decode',{value:()=>Promise.resolve(),configurable:true});
 vi.spyOn(HTMLImageElement.prototype,'decode').mockResolvedValue(undefined);
 const createObjectURL=vi.fn(()=> 'blob:frame');
 vi.stubGlobal('URL',{createObjectURL,revokeObjectURL:vi.fn()});
 document.body.innerHTML='<section><div></div><p></p></section>';
 const began=performance.now();let first=true;
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
  if(url!=='/frame')return {ok:true,blob:async()=>new Blob(['image'])};
  if(first){first=false;await new Promise(resolve=>setTimeout(resolve,300));}
  const validForMs=1000-(performance.now()-began);
  return {ok:validForMs>0,status:validForMs>0?200:503,json:async()=>validForMs>0
   ?{id:'same',generation:1,validForMs,url:'/image',capturedAt:Date.now()}
   :{message:'最新の画像を待っています。'}};
 }));
 const frames=watchFrames({stage:document.querySelector('div'),status:document.querySelector('p')});
 try {
  await vi.advanceTimersByTimeAsync(300);expect(frames.current()?.id).toBe('same');
  await vi.advanceTimersByTimeAsync(699);expect(frames.current()?.id).toBe('same');
  expect(createObjectURL).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);expect(frames.current()).toBeNull();
 }finally{frames.close();}
});

it.each([
 [1, 503, null, true], [2, 503, null, false], [1, 410, null, false],
 [1, 503, 'unavailable', false], [1, 429, 'unavailable', false], [1, 429, 'retired', false],
] as const)(
 'keeps only a valid image when the next JPEG fails (generation %d, status %d, frame state %s)', async (generation, status, state, retain) => {
 vi.useFakeTimers();vi.spyOn(document,'hidden','get').mockReturnValue(false);
 if(!HTMLImageElement.prototype.decode)Object.defineProperty(HTMLImageElement.prototype,'decode',{value:()=>Promise.resolve(),configurable:true});
 vi.spyOn(HTMLImageElement.prototype,'decode').mockResolvedValue(undefined);
 vi.stubGlobal('URL',{createObjectURL:vi.fn(()=> 'blob:frame'),revokeObjectURL:vi.fn()});
 document.body.innerHTML='<section><div></div><p></p></section>';let sequence=0;
 const headers = state === 'retired' ? retiredJpegHeaders() : new Headers(state ? {'X-CasMate-Frame-State':state} : {});
 const cancel=vi.fn(async()=>{});
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>url==='/frame'?{ok:true,status:200,json:async()=>({id:'f'+(++sequence),generation:sequence===1?1:generation,validForMs:900,url:'/image',capturedAt:Date.now()})}:sequence===1?{ok:true,blob:async()=>new Blob(['image'])}:{ok:false,status,headers,body:{cancel}}));
 const frames=watchFrames({stage:document.querySelector('div'),status:document.querySelector('p')});
 try {
  await vi.advanceTimersByTimeAsync(0);expect(frames.current()?.id).toBe('f1');
  await vi.advanceTimersByTimeAsync(500);expect(frames.current()?.id).toBe(retain?'f1':undefined);
  expect(cancel).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(400);expect(frames.current()).toBeNull();
 } finally { frames.close(); }
});

it('keeps the waiting text and its scroll position during repeated identical polling failures',async()=>{
 vi.useFakeTimers();vi.spyOn(document,'hidden','get').mockReturnValue(false);
 const fetch=vi.fn(async()=>({ok:false,status:503,headers:new Headers({'X-CasMate-Frame-State':'unavailable'}),json:async()=>({message:'OBSの最新画像を待っています。'})}));
 vi.stubGlobal('fetch',fetch);
 document.body.innerHTML='<section><div></div><p></p></section>';
 const stage=document.querySelector('div')!,status=document.querySelector('p')!;
 const frames=watchFrames({stage,status});
 try{
  await vi.advanceTimersByTimeAsync(0);
  const waiting=stage.querySelector<HTMLElement>('.screen-wait')!,announcement=status.firstChild;
  expect(waiting.textContent).toBe('OBSの最新画像を待っています。');
  waiting.scrollTop=20;
  await vi.advanceTimersByTimeAsync(500);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(stage.querySelector('.screen-wait')).toBe(waiting);
  expect(waiting.scrollTop).toBe(20);
  expect(status.firstChild).toBe(announcement);
 }finally{frames.close();}
});

it('keeps the OBS waiting display during alternating relay failures', async () => {
  vi.useFakeTimers();
  vi.spyOn(document,'hidden','get').mockReturnValue(false);
  const unavailable = { ok:false, status:503, headers:new Headers({'X-CasMate-Frame-State':'unavailable'}) };
  const fetch=vi.fn(async () => unavailable)
    .mockResolvedValueOnce(unavailable)
    .mockResolvedValueOnce({ ok:false,status:502,headers:new Headers() })
    .mockRejectedValueOnce(new TypeError('Failed to fetch'));
  vi.stubGlobal('fetch',fetch);
  document.body.innerHTML='<div></div><p></p>';
  const stage=document.querySelector('div')!,status=document.querySelector('p')!,onUnavailable=vi.fn();
  const frames=watchFrames({stage,status,onUnavailable});
  try {
    await vi.advanceTimersByTimeAsync(0);
    const waiting=stage.querySelector<HTMLElement>('.screen-wait')!,announcement=status.firstChild;
    waiting.scrollTop=20;
    for (let step=0;step<3;step++) {
      await vi.advanceTimersByTimeAsync(500);
      expect(stage.querySelector('.screen-wait')).toBe(waiting);
      expect(waiting.textContent).toBe('OBSの最新画像を待っています。');
      expect(waiting.scrollTop).toBe(20);
      expect(status.firstChild).toBe(announcement);
    }
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(onUnavailable).toHaveBeenCalledTimes(1);
  } finally { frames.close(); }
});

it.each([503, 429, 410])('keeps the same waiting display when metadata and JPEG report unavailability (%d)', async jpegStatus => {
  vi.useFakeTimers();
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  const headers = new Headers({ 'X-CasMate-Frame-State':'unavailable' });
  let reads = 0;
  const fetch = vi.fn(async (url: string) => {
    if (url !== '/frame') return { ok:false, status:jpegStatus, headers };
    if (++reads % 2 === 1) return { ok:false, status:503, headers };
    return { ok:true, status:200, json:async () => ({ id:'next', generation:1, validForMs:12000, url:'/image' }) };
  });
  vi.stubGlobal('fetch', fetch);
  document.body.innerHTML = '<div></div><p></p>';
  const stage = document.querySelector('div')!, status = document.querySelector('p')!;
  const frames = watchFrames({ stage, status });
  try {
    await vi.advanceTimersByTimeAsync(0);
    const waiting = stage.querySelector('.screen-wait'), announcement = status.firstChild;
    expect(waiting?.textContent).toBe('OBSの最新画像を待っています。');
    for (let index = 0; index < 4; index++) {
      await vi.advanceTimersByTimeAsync(500);
      expect(stage.querySelector('.screen-wait')).toBe(waiting);
      expect(status.firstChild).toBe(announcement);
    }
    expect(fetch.mock.calls.filter(([url]) => url === '/image')).toHaveLength(2);
  } finally { frames.close(); }
});

it('keeps the same retired-image message when the JPEG rate limit starts and ends', async () => {
  vi.useFakeTimers();
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  const headers = retiredJpegHeaders();
  let images = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/frame'
    ? { ok:true, status:200, json:async () => ({ id:'retired', generation:1, validForMs:12000, url:'/image' }) }
    : { ok:false, status:++images % 2 === 1 ? 410 : 429, headers }));
  document.body.innerHTML = '<div></div><p></p>';
  const stage = document.querySelector('div')!, status = document.querySelector('p')!;
  const frames = watchFrames({ stage, status });
  try {
    await vi.advanceTimersByTimeAsync(0);
    const waiting = stage.querySelector('.screen-wait'), announcement = status.firstChild;
    expect(waiting?.textContent).toBe('画像が更新されました。次の更新を待ってください。');
    for (let index = 0; index < 4; index++) {
      await vi.advanceTimersByTimeAsync(500);
      expect(stage.querySelector('.screen-wait')).toBe(waiting);
      expect(status.firstChild).toBe(announcement);
    }
    expect(images).toBe(5);
  } finally { frames.close(); }
});

it('keeps the replacement waiting display if the new-generation JPEG is already retired', async () => {
  vi.useFakeTimers();
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  if (!HTMLImageElement.prototype.decode) Object.defineProperty(HTMLImageElement.prototype, 'decode', { value:() => Promise.resolve(), configurable:true });
  vi.spyOn(HTMLImageElement.prototype, 'decode').mockResolvedValue(undefined);
  vi.stubGlobal('URL', { createObjectURL:vi.fn(() => 'blob:frame'), revokeObjectURL:vi.fn() });
  let generation = 0, finish!: (value: unknown) => void;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/frame') {
      return { ok:true, status:200, json:async () => ({ id:String(++generation), generation, validForMs:12000, url:`/image/${generation}` }) };
    }
    if (url === '/image/1') return { ok:true, blob:async () => new Blob(['image']) };
    return new Promise(resolve => { finish = resolve; });
  }));
  document.body.innerHTML = '<div></div><p></p>';
  const stage = document.querySelector('div')!, status = document.querySelector('p')!;
  const frames = watchFrames({ stage, status });
  try {
    await vi.advanceTimersByTimeAsync(0);
    expect(stage.querySelector('img')).not.toBeNull();
    await vi.advanceTimersByTimeAsync(500);
    expect(stage.querySelector('img')).toBeNull();
    const waiting = stage.querySelector('.screen-wait'), announcement = status.firstChild;
    expect(waiting).not.toBeNull();
    finish({ ok:false, status:410, headers:retiredJpegHeaders() });
    await vi.advanceTimersByTimeAsync(0);
    expect(stage.querySelector('.screen-wait')).toBe(waiting);
    expect(status.firstChild).toBe(announcement);
  } finally { frames.close(); }
});

it.each([1, 5])('treats restarted publication generation %d as a different image source', async generation => {
  vi.useFakeTimers();
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  if (!HTMLImageElement.prototype.decode) Object.defineProperty(HTMLImageElement.prototype, 'decode', { value:() => Promise.resolve(), configurable:true });
  vi.spyOn(HTMLImageElement.prototype, 'decode').mockResolvedValue(undefined);
  vi.stubGlobal('URL', { createObjectURL:vi.fn(() => 'blob:frame'), revokeObjectURL:vi.fn() });
  document.body.innerHTML = '<div></div><p></p>';
  const frame = (instance: string, value: number) => ({ id:instance, instance, generation:value, validForMs:12000, url:`/image/${instance}`, capturedAt:Date.now() });
  let reads = 0, finish!: (value: unknown) => void;
  const fetch = vi.fn(async (url: string) => {
    if (url === '/frame') return { ok:true, status:200, json:async () => ++reads === 1 ? frame('original', 5) : frame('restarted', generation) };
    if (url === '/image/restarted') return new Promise(resolve => { finish = resolve; });
    return { ok:true, blob:async () => new Blob(['image']) };
  });
  vi.stubGlobal('fetch', fetch);
  const stage = document.querySelector('div')!, status = document.querySelector('p')!;
  const frames = watchFrames({ stage, status });
  try {
    await vi.advanceTimersByTimeAsync(0);
    const submitted = frames.current();
    expect(submitted?.id).toBe('original');
    await vi.advanceTimersByTimeAsync(500);
    expect(frames.current()).toBeNull();
    finish({ ok:true, blob:async () => new Blob(['image']) });
    await vi.advanceTimersByTimeAsync(0);
    expect(frames.current()?.id).toBe('restarted');
    const image = stage.querySelector('img');
    frames.rejectPlacement(submitted, 6, 'original');
    expect(frames.current()?.id).toBe('restarted');
    expect(stage.querySelector('img')).toBe(image);
  } finally { frames.close(); }
});

it('retains the confirmed retired-image message when the metadata route is temporarily missing', async () => {
  vi.useFakeTimers();
  vi.spyOn(document,'hidden','get').mockReturnValue(false);
  let reads=0;
  vi.stubGlobal('fetch',vi.fn(async (url:string) => {
    if (url === '/frame' && ++reads === 1) return {ok:true,status:200,json:async()=>({id:'retired',generation:1,validForMs:12000,url:'/image'})};
    return {ok:false,status:url === '/frame' ? 404 : 410};
  }));
  document.body.innerHTML='<div></div><p></p>';
  const stage=document.querySelector('div')!,status=document.querySelector('p')!;
  const frames=watchFrames({stage,status});
  try {
    await vi.advanceTimersByTimeAsync(0);
    const waiting=stage.querySelector('.screen-wait');
    expect(waiting?.textContent).toBe('画像が更新されました。次の更新を待ってください。');
    await vi.advanceTimersByTimeAsync(500);
    expect(stage.querySelector('.screen-wait')).toBe(waiting);
    expect(status.textContent).toBe('画像が更新されました。次の更新を待ってください。');
  } finally { frames.close(); }
});

it('reports a foreground relay failure after polling resumes from the background', async () => {
  vi.useFakeTimers();
  let hidden=true;
  vi.spyOn(document,'hidden','get').mockImplementation(()=>hidden);
  const fetch=vi.fn(async()=>({ok:false,status:502}));
  vi.stubGlobal('fetch',fetch);
  document.body.innerHTML='<div></div><p></p>';
  const status=document.querySelector('p')!;
  const frames=watchFrames({stage:document.querySelector('div'),status});
  try {
    expect(status.textContent).toBe('背景のため画像更新を停止しています。');
    hidden=false;
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(status.textContent).toBe('OBS映像を取得できません。');
  } finally { frames.close(); }
});

it.each([
 [404, undefined, false, false, undefined], [429, 1, false, true, undefined], [429, 2, false, false, undefined],
 [429, undefined, false, false, undefined],
 [429, 1, false, false, 'restarted'], [429, 1, false, true, 'original'],
 [403, undefined, false, false, undefined], [503, undefined, true, false, undefined],
 [502, undefined, false, true, undefined], [503, undefined, false, true, undefined], [504, undefined, false, true, undefined],
 [0, undefined, false, true, undefined],
] as const)(
 'recovers from metadata status %d (generation %s, image unavailable %s, retain %s, instance %s)',async (code,generation,unavailable,retain,instance)=>{
 vi.useFakeTimers();vi.spyOn(document,'hidden','get').mockReturnValue(false);
 if(!HTMLImageElement.prototype.decode)Object.defineProperty(HTMLImageElement.prototype,'decode',{value:()=>Promise.resolve(),configurable:true});
 vi.spyOn(HTMLImageElement.prototype,'decode').mockResolvedValue(undefined);
 vi.stubGlobal('URL',{createObjectURL:vi.fn(()=> 'blob:frame'),revokeObjectURL:vi.fn()});
 document.body.innerHTML='<section><div></div><p></p></section>';let sequence=0;
 const cancel=vi.fn(async()=>{});
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
  if(url!=='/frame')return {ok:true,blob:async()=>new Blob(['image'])};
  sequence++;
  if(sequence===2){
   if(code===0)throw new TypeError('Failed to fetch');
   const headers=new Headers(unavailable?{'X-CasMate-Frame-State':'unavailable'}:{});
   return {ok:false,status:code,headers,body:{cancel},json:()=>unavailable
    ? new Promise(() => {})
    : Promise.resolve({message:'画像を確認できません。',generation,instance})};
  }
  return {ok:true,status:200,json:async()=>({id:'f'+sequence,generation:1,instance:instance && 'original',validForMs:900,url:'/image',capturedAt:Date.now()})};
 }));
 const section=document.querySelector('section')!;
 const stage=section.querySelector('div')!, onUnavailable=vi.fn();
 const frames=watchFrames({stage,status:section.querySelector('p'),onUnavailable});
 try {
  await vi.advanceTimersByTimeAsync(0);expect(frames.current()?.id).toBe('f1');
  const displayed=stage.querySelector('img');
  await vi.advanceTimersByTimeAsync(500);expect(section.hidden).toBe(false);
  expect(frames.current()?.id).toBe(retain?'f1':undefined);
  expect(stage.querySelector('img')).toBe(retain?displayed:null);
  expect(onUnavailable).toHaveBeenCalledTimes(retain?0:1);
  expect(cancel).toHaveBeenCalledTimes(code===404 || code>=500 ? 1 : 0);
  await vi.advanceTimersByTimeAsync(400);expect(frames.current()).toBeNull();
  await vi.advanceTimersByTimeAsync(100);expect(frames.current()?.id).toBe('f3');
 } finally { frames.close(); }
});

it('freezes frame acquisition while selecting and resumes with the latest image',async()=>{
 vi.useFakeTimers();vi.spyOn(document,'hidden','get').mockReturnValue(false);if(!HTMLImageElement.prototype.decode)Object.defineProperty(HTMLImageElement.prototype,'decode',{value:()=>Promise.resolve(),configurable:true});vi.spyOn(HTMLImageElement.prototype,'decode').mockResolvedValue(undefined);
 vi.stubGlobal('URL',{createObjectURL:vi.fn(()=> 'blob:frame'),revokeObjectURL:vi.fn()});
 document.body.innerHTML='<section><div></div><p></p></section>';let sequence=0;
 const fetch=vi.fn(async(url:string)=>url==='/frame'?{ok:true,status:200,json:async()=>({id:'f'+(++sequence),generation:1,canvasWidth:1920,validForMs:12000,url:'/image',capturedAt:Date.now()})}:{ok:true,blob:async()=>new Blob(['image'])});vi.stubGlobal('fetch',fetch);
 const frames=watchFrames({stage:document.querySelector('div'),status:document.querySelector('p')});await vi.advanceTimersByTimeAsync(0);expect(frames.current()?.id).toBe('f1');frames.pause();await vi.advanceTimersByTimeAsync(2000);expect(fetch).toHaveBeenCalledTimes(2);expect(frames.current()?.id).toBe('f1');frames.resume();await vi.advanceTimersByTimeAsync(0);expect(frames.current()?.id).toBe('f2');frames.close();
});

it.each([
  ['replacement', 2, undefined, undefined, true], ['submitted', 2, undefined, undefined, false],
  ['older', 1, undefined, undefined, false], ['restarted', 1, 'new', 'original', true],
  ['old-source', 99, 'original', 'new', false],
] as const)(
 'finishes pending metadata for %s after an authoritative placement rejection', async (id, generation, instance, confirmedInstance, usePending) => {
  vi.useFakeTimers();
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  if (!HTMLImageElement.prototype.decode) Object.defineProperty(HTMLImageElement.prototype, 'decode', { value:() => Promise.resolve(), configurable:true });
  vi.spyOn(HTMLImageElement.prototype, 'decode').mockResolvedValue(undefined);
  vi.stubGlobal('URL', { createObjectURL:vi.fn(() => 'blob:frame'), revokeObjectURL:vi.fn() });
  document.body.innerHTML = '<div></div><p></p>';
  const frame = (frameId: string, frameGeneration: number, source?: string) => ({ id:frameId, generation:frameGeneration, instance:source, validForMs:12000, url:`/image/${frameId}`, capturedAt:Date.now() });
  let requests = 0, signal: AbortSignal | undefined;
  let finish!: (value: ReturnType<typeof frame>) => void;
  const fetch = vi.fn(async (url: string, options?: { signal: AbortSignal }) => {
    if (url !== '/frame') return { ok:true, blob:async () => new Blob(['image']) };
    requests++;
    if (requests === 2) {
      signal = options?.signal;
      return { ok:true, status:200, json:() => new Promise(resolve => { finish = resolve; }) };
    }
    return { ok:true, status:200, json:async () => requests === 1 ? frame('submitted', 1, confirmedInstance && 'original') : frame('fresh', 2, confirmedInstance) };
  });
  vi.stubGlobal('fetch', fetch);
  const frames = watchFrames({ stage:document.querySelector('div'), status:document.querySelector('p') });
  try {
    await vi.advanceTimersByTimeAsync(0);
    const submitted = frames.current();
    expect(submitted?.id).toBe('submitted');
    await vi.advanceTimersByTimeAsync(500);
    frames.rejectPlacement(submitted, 2, confirmedInstance);
    expect(frames.current()).toBeNull();
    expect(signal?.aborted).toBe(false);
    finish(frame(id, generation, instance));
    await vi.advanceTimersByTimeAsync(10);
    const replacement = usePending ? id : 'fresh';
    expect(frames.current()?.id).toBe(replacement);
    expect(fetch.mock.calls.filter(([url]) => url !== '/frame').map(([url]) => url)).toEqual(['/image/submitted', `/image/${replacement}`]);
  } finally { frames.close(); }
 });

it('cancels frozen selections at the image deadline and refuses a late release',async()=>{
 let deadline=Infinity;const f=fixture(()=>deadline-Date.now());deadline=Date.now()+50;f.buttons.ellipse.click();f.pointer('pointerdown',100,100);f.pointer('pointermove',600,300);await vi.advanceTimersByTimeAsync(100);f.pointer('pointerup',600,300);expect(f.submit).not.toHaveBeenCalled();expect(f.buttons.ellipse.getAttribute('aria-pressed')).toBe('false');expect(f.layer.childElementCount).toBe(0);f.control.close();
});
it('subtracts metadata transport time instead of extending a short image deadline',async()=>{
 vi.useFakeTimers();vi.spyOn(document,'hidden','get').mockReturnValue(false);if(!HTMLImageElement.prototype.decode)Object.defineProperty(HTMLImageElement.prototype,'decode',{value:()=>Promise.resolve(),configurable:true});vi.spyOn(HTMLImageElement.prototype,'decode').mockResolvedValue(undefined);
 vi.stubGlobal('URL',{createObjectURL:vi.fn(()=> 'blob:late'),revokeObjectURL:vi.fn()});document.body.innerHTML='<section><div></div><p></p></section>';
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>{await new Promise(resolve=>setTimeout(resolve,url==='/frame'?80:40));return url==='/frame'?{ok:true,status:200,json:async()=>({id:'late',generation:1,canvasWidth:1920,validForMs:100,url:'/image',capturedAt:Date.now()})}:{ok:true,blob:async()=>new Blob(['image'])};}));
 const frames=watchFrames({stage:document.querySelector('div'),status:document.querySelector('p')});await vi.advanceTimersByTimeAsync(120);expect(frames.current()).toBeNull();expect(frames.remaining()).toBe(0);frames.close();
});

it.each(['metadata', 'JPEG', 'decode'])('updates the public image when a candidate expires during %s', async stage => {
  vi.useFakeTimers();
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  if (!HTMLImageElement.prototype.decode) Object.defineProperty(HTMLImageElement.prototype, 'decode', { value:() => Promise.resolve(), configurable:true });
  let decodes = 0;
  vi.spyOn(HTMLImageElement.prototype, 'decode').mockImplementation(async () => {
    if (++decodes === 2 && stage === 'decode') await new Promise<void>(() => {});
  });
  vi.stubGlobal('URL', { createObjectURL:vi.fn(() => 'blob:image'), revokeObjectURL:vi.fn() });
  document.body.innerHTML = '<section><div></div><p></p></section>';
  const image = (id: string, validForMs = 1500) => ({ id, generation:1, validForMs, url:`/image/${id}`, capturedAt:Date.now() });
  let reads = 0;
  const fetchFrame = vi.fn(async (url: string, options: { signal: AbortSignal }) => {
    if (url === '/frame') {
      reads++;
      if (reads === 2 && stage === 'metadata') await new Promise(resolve => setTimeout(resolve, 200));
      return { ok:true, status:200, json:async () => reads === 1 ? image('initial') : reads === 2 ? image('expired', 150) : image('fresh') };
    }
    if (url === '/image/expired' && stage === 'JPEG') {
      await new Promise<void>((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once:true }));
    }
    return { ok:true, blob:async () => new Blob(['image']) };
  });
  vi.stubGlobal('fetch', fetchFrame);
  const onUnavailable = vi.fn();
  const frames = watchFrames({ stage:document.querySelector('div'), status:document.querySelector('p'), onUnavailable });
  try {
    await vi.advanceTimersByTimeAsync(900);
    expect(frames.current()?.id).toBe('initial');
    await vi.advanceTimersByTimeAsync(350);
    expect(frames.current()?.id).toBe('fresh');
    expect(onUnavailable).not.toHaveBeenCalled();
    expect(fetchFrame.mock.calls.some(([url]) => url === '/image/expired')).toBe(stage !== 'metadata');
  } finally { frames.close(); }
});


it('uses metadata alone for video coordinates and retires expired placements without downloading JPEG',async()=>{
 vi.useFakeTimers();vi.spyOn(document,'hidden','get').mockReturnValue(false);
 document.body.innerHTML='<div id="video-stage"></div><p></p>';
 const stage=document.querySelector<HTMLElement>('#video-stage')!;
 vi.spyOn(stage,'getBoundingClientRect').mockReturnValue(new DOMRect(100,50,800,450));
 const metadata={id:'video-frame',generation:1,instance:'server',validForMs:1000,canvasWidth:1920,canvasHeight:1080,url:'/frame.jpg',capturedAt:Date.now()};
 const fetch=vi.fn(async(_url:string)=>({ok:true,status:200,json:async()=>metadata}));vi.stubGlobal('fetch',fetch);
 const unavailable=vi.fn();const frames=watchFrames({stage,status:document.querySelector('p')!,metadataOnly:true,onUnavailable:unavailable});
 await vi.advanceTimersByTimeAsync(0);
 expect(frames.current()?.id).toBe('video-frame');expect(frames.point(500,275)).toEqual({x:.5,y:.5});expect(frames.point(99,275)).toBeNull();
 expect(fetch.mock.calls.length).toBe(1);expect(fetch.mock.calls[0][0]).toBe('/frame');
 frames.pause();await vi.advanceTimersByTimeAsync(1000);expect(frames.current()).toBeNull();expect(unavailable).toHaveBeenCalled();frames.close();
});
