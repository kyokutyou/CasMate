// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { playReactionParticles } from '../src/renderer/reactions/particles';
import type { ReactionEvent } from '../src/shared/listener-reactions';
import { reactionCanvasViewport } from '../src/main/reactions/reaction-geometry';

if (!Element.prototype.animate) Object.defineProperty(Element.prototype,'animate',{value:()=>undefined,configurable:true,writable:true});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); document.body.replaceChildren(); });
const event: ReactionEvent = { instance: 'session', sequence: 7, counts: { heart: 1, clap: 0, point: 0 }, accepting: true, pointingEnabled: true, frameGeneration: 0, frame: null, kind: 'heart', at: 10000 };
function surface(width: number, height: number) {
  const layer = document.createElement('div'); document.body.append(layer);
  Object.defineProperties(layer, { clientWidth: { value: width }, clientHeight: { value: height } });
  return layer;
}
it('uses identical seeded locations and scaled sizes on OBS and desktop, seeking to the event age', () => {
  vi.useFakeTimers(); vi.setSystemTime(10500);
  const animations: Array<{ currentTime: number | null }> = [];
  const animate = vi.spyOn(Element.prototype, 'animate').mockImplementation(() => {
    const value = { currentTime: null as number | null, finished: new Promise<Animation>(() => {}) }; animations.push(value); return value as Animation;
  });
  const obs = surface(1920,1080), desktop = surface(960,540);
  playReactionParticles(obs,event); playReactionParticles(desktop,event);
  expect(obs.children).toHaveLength(5);expect(desktop.children).toHaveLength(5);
  expect([...obs.children].map(n=>(n as HTMLElement).style.left)).toEqual([...desktop.children].map(n=>(n as HTMLElement).style.left));
  expect((obs.firstElementChild as HTMLElement).style.fontSize).toBe('64px');expect((desktop.firstElementChild as HTMLElement).style.fontSize).toBe('32px');
  expect(animations.every(a=>a.currentTime===500)).toBe(true);
  expect(animate.mock.calls[0][0]).toEqual(expect.arrayContaining([expect.objectContaining({transform:'translate3d(-50%,-756px,0)'})]));
  expect(animate.mock.calls[5][0]).toEqual(expect.arrayContaining([expect.objectContaining({transform:'translate3d(-50%,-378px,0)'})]));
});
it('keeps a constant size and hides delayed particles before their first animation frame',()=>{
  vi.useFakeTimers();vi.setSystemTime(10000);
  const animate=vi.spyOn(Element.prototype,'animate').mockImplementation(()=>({finished:new Promise<Animation>(()=>{})}) as Animation);
  playReactionParticles(surface(1920,1080),event);
  expect(animate).toHaveBeenCalledTimes(5);
  for(const [frames,options] of animate.mock.calls){
    expect(options).toEqual(expect.objectContaining({fill:'both',easing:'linear'}));
    expect(JSON.stringify(frames)).not.toContain('scale(');
  }
});
it('renders one fixed cheer with the same position and proportional constant font on both surfaces',()=>{
 vi.useFakeTimers();vi.setSystemTime(10500);
 const animate=vi.spyOn(Element.prototype,'animate').mockImplementation(()=>({finished:new Promise<Animation>(()=>{})}) as Animation);
 const obs=surface(1920,1080),desktop=surface(960,540);const cheer={...event,kind:'cheer' as const};
 playReactionParticles(obs,cheer);playReactionParticles(desktop,cheer);
 expect(obs.children).toHaveLength(1);expect(obs.textContent).toBe('がんばれ！');expect(desktop.textContent).toBe('がんばれ！');
 const a=obs.firstElementChild as HTMLElement,b=desktop.firstElementChild as HTMLElement;
 expect(a.style.left).toBe(b.style.left);expect(parseFloat(a.style.left)).toBeGreaterThanOrEqual(35);expect(parseFloat(a.style.left)).toBeLessThanOrEqual(65);
 expect(a.style.fontSize).toBe('36px');expect(b.style.fontSize).toBe('18px');expect(JSON.stringify(animate.mock.calls)).not.toContain('scale(');
 vi.advanceTimersByTime(1599);expect(obs.children).toHaveLength(1);vi.advanceTimersByTime(1);expect(obs.children).toHaveLength(0);
});
it('caps cheers separately, rejects expired cheers and keeps the existing total element limit',()=>{
 vi.useFakeTimers();vi.setSystemTime(10000);vi.spyOn(Element.prototype,'animate').mockImplementation(()=>({finished:new Promise<Animation>(()=>{})}) as Animation);
 const layer=surface(1920,1080);playReactionParticles(layer,{...event,kind:'cheer',at:7900});expect(layer.childElementCount).toBe(0);
 for(let i=0;i<25;i++)playReactionParticles(layer,{...event,sequence:i});
 for(let i=0;i<10;i++)playReactionParticles(layer,{...event,kind:'cheer',sequence:i});
 expect(layer.querySelectorAll('.reaction-cheer')).toHaveLength(5);expect(layer.childElementCount).toBeLessThanOrEqual(100);vi.advanceTimersByTime(2100);expect(layer.querySelectorAll('.reaction-cheer')).toHaveLength(0);
});
it('drops expired events, caps particles and removes them within three seconds', () => {
  vi.useFakeTimers(); vi.setSystemTime(10000);
  vi.spyOn(Element.prototype,'animate').mockImplementation(()=>({finished:new Promise<Animation>(()=>{})}) as Animation);
  const layer=surface(1920,1080);
  playReactionParticles(layer,{...event,at:0});expect(layer.children).toHaveLength(0);
  for(let i=0;i<25;i++)playReactionParticles(layer,{...event,sequence:i});expect(layer.children).toHaveLength(100);
  vi.advanceTimersByTime(3000);expect(layer.children).toHaveLength(0);
});
it('extends the desktop canvas beyond the game while preserving the game coordinate mapping',()=>{
  const target={id:'1',pid:1,title:'game',processName:'game.exe',className:'Game',x:100,y:200,width:800,height:600,minimized:false};
  const bounds=reactionCanvasViewport(target,{left:0,right:0,top:0,bottom:0},1920,1080,{x:0,y:0.1,width:0.75,height:0.8});
  expect(bounds).toEqual({x:100,y:200,width:1067,height:600});
  expect(bounds!.x+bounds!.width*.75).toBeCloseTo(900,0);
  expect(bounds!.y+bounds!.height*.1).toBe(260);
  expect(reactionCanvasViewport(target,{left:0,right:0,top:0,bottom:0},1920,1080,{x:0,y:0,width:.000001,height:.000001})).toBeNull();
});

it.each(['heart','clap','cheer'] as const)('does not lose %s to a one millisecond process clock difference',kind=>{
 vi.useFakeTimers();vi.setSystemTime(10000);
 vi.spyOn(Element.prototype,'animate').mockImplementation(()=>({finished:new Promise<Animation>(()=>{})}) as Animation);
 const layer=surface(1920,1080);playReactionParticles(layer,{...event,kind,at:10001});
 expect(layer.childElementCount).toBe(kind==='cheer'?1:5);
});

it.each([1,100,101])('bounds future clock tolerance and particle lifetime at %dms',skew=>{
 vi.useFakeTimers();vi.setSystemTime(10000);
 const animate=vi.spyOn(Element.prototype,'animate').mockImplementation(()=>({currentTime:null,finished:new Promise<Animation>(()=>{})}) as Animation);
 for(const kind of ['heart','clap','cheer'] as const){
  const layer=surface(1920,1080);playReactionParticles(layer,{...event,kind,at:10000+skew});
  expect(layer.childElementCount).toBe(skew<=100?(kind==='cheer'?1:5):0);
  if(skew<=100)expect(animate.mock.results.at(-1)?.value.currentTime).toBe(0);
 }
 vi.advanceTimersByTime(3000);expect(document.querySelectorAll('.reaction-particle')).toHaveLength(0);
});
