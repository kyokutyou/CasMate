// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {setupPointingTool} from '../src/renderer/reactions/client/pointing-tool.mjs';
import {placeMarker} from '../src/renderer/reactions/client/pointing.mjs';
import {pointSceneFrame} from '../src/renderer/reactions/client/point-scene.mjs';
import sampleFrames from './fixtures/reaction-point-sample-reference.json';

afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();document.body.replaceChildren();});
function fixture(){
 vi.useFakeTimers();vi.stubGlobal('ResizeObserver',class{observe(){}});
 document.body.innerHTML='<button></button><div tabindex="0"></div><section></section><p></p>';
 const button=document.querySelector('button')!,stage=document.querySelector('div')!,layer=document.querySelector('section')!,hint=document.querySelector('p')!;
 let finish!:(value:{ok:boolean})=>void;
 const submit=vi.fn(()=>new Promise<{ok:boolean}>(resolve=>{finish=resolve;}));
 const control=setupPointingTool({button,stage,layer,hint,getFrame:()=>({id:'frame',instance:'server',generation:1,canvasWidth:1920}),getPoint:()=>({x:.5,y:.5}),submit});
 return {button,stage,layer,submit,control,finish:()=>finish({ok:true})};
}
it.each([0,1000,6000])('does not restart an old point confirmation after a %dms response',async delay=>{
 const f=fixture();f.button.click();f.stage.click();
 expect(f.submit).toHaveBeenCalledOnce();
 await vi.advanceTimersByTimeAsync(delay);f.finish();await vi.advanceTimersByTimeAsync(0);
 expect(f.layer.querySelectorAll('.point-marker:not(.marker-pending,.marker-preview)')).toHaveLength(delay<4000?1:0);
 if(delay<4000){await vi.advanceTimersByTimeAsync(4000-delay-1);expect(f.layer.childElementCount).toBe(1);await vi.advanceTimersByTimeAsync(1);expect(f.layer.childElementCount).toBe(0);}
 f.control.close();
});
it('cancels without sending and ignores a late success after invalidation',async()=>{
 const f=fixture();f.button.click();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));f.stage.click();expect(f.submit).not.toHaveBeenCalled();
 f.button.click();f.stage.click();f.control.invalidate();f.finish();await vi.advanceTimersByTimeAsync(0);expect(f.layer.childElementCount).toBe(0);f.control.close();
});
it('switches the three local previews, follows without sending, and commits only the selected intent',async()=>{
 vi.useFakeTimers();vi.stubGlobal('ResizeObserver',class{observe(){}});
 document.body.innerHTML='<button id="look"></button><button id="question"></button><button id="danger"></button><div tabindex="0"></div><section></section><p></p>';
 const buttons={look:document.querySelector<HTMLButtonElement>('#look')!,question:document.querySelector<HTMLButtonElement>('#question')!,danger:document.querySelector<HTMLButtonElement>('#danger')!};
 const stage=document.querySelector('div')!,layer=document.querySelector('section')!;
 let point:{x:number;y:number}|null={x:.2,y:.3};
 const submit=vi.fn(async()=>({ok:true}));
 const tool=setupPointingTool({buttons,stage,layer,hint:document.querySelector('p')!,getFrame:()=>({id:'f',generation:1,canvasWidth:1920}),getPoint:()=>point,submit});
 for(const intent of ['look','question','danger'] as const){
  buttons[intent].click();stage.dispatchEvent(new MouseEvent('pointermove'));
  expect(buttons[intent].getAttribute('aria-pressed')).toBe('true');
  const ghost=layer.querySelector<HTMLElement>('.marker-preview')!;
  expect(ghost.dataset.intent).toBe(intent);expect(submit).not.toHaveBeenCalled();
  point={x:.7,y:.6};stage.dispatchEvent(new MouseEvent('pointermove'));
  expect(layer.querySelector('.marker-preview')).toBe(ghost);expect(ghost.querySelector<HTMLElement>('.point-dot')!.style.left).toBe('70%');
 }
 stage.click();await vi.advanceTimersByTimeAsync(0);
 expect(submit).toHaveBeenCalledExactlyOnceWith({kind:'point',intent:'danger',frameId:'f',x:.7,y:.6});
 expect(buttons.danger.getAttribute('aria-pressed')).toBe('false');
 for(const intent of ['look','question','danger'] as const){
  buttons[intent].click();stage.dispatchEvent(new MouseEvent('pointermove'));buttons[intent].click();expect(layer.querySelector('.marker-preview')).toBeNull();
  buttons[intent].click();point=null;stage.click();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));
 }
 expect(submit).toHaveBeenCalledTimes(1);tool.close();
});
it('seeks delayed markers, expires them without extending life, and releases removed-marker timers',async()=>{
 vi.useFakeTimers();vi.stubGlobal('ResizeObserver',class{observe(){}});
 const layer=document.createElement('div');document.body.append(layer);
 const marker=placeMarker(layer,.3,.4,1920,{intent:'question',duration:1000});
 expect(marker.querySelector('.point-label')?.textContent).toBe('これなに？');
 expect(marker.style.getPropertyValue('--point-age')).toBe('-3000ms');
 await vi.advanceTimersByTimeAsync(999);expect(marker.isConnected).toBe(true);
 await vi.advanceTimersByTimeAsync(1);expect(marker.isConnected).toBe(false);
 for(let i=0;i<12;i++)placeMarker(layer,.5,.5,1920,{intent:'danger'});
 expect(layer.childElementCount).toBe(10);
 layer.replaceChildren();await vi.advanceTimersByTimeAsync(0);
 expect(vi.getTimerCount()).toBe(0);
});
it('retains the approved sample arrow, expanding wave, sparks and drawn ring',()=>{
 vi.stubGlobal('ResizeObserver',class{observe(){}});
 const layer=document.createElement('div');document.body.append(layer);
 const marker=placeMarker(layer,.5,.5,1920,{intent:'look',variant:'marker-preview',duration:0});
 expect(marker.querySelector('.point-pointer')).not.toBeNull();
 expect(marker.querySelector('.point-wave')).not.toBeNull();
 expect(marker.querySelector('.point-sparks')).not.toBeNull();
 expect(marker.querySelector('.point-ring')).not.toBeNull();
 marker.remove();
});
// Captured from the approved compact sample, independently of production code.
it.each(sampleFrames)('matches the approved $intent sample at $age ms',sample=>{
 const frame=pointSceneFrame(sample.age,sample.intent);
 for(const key of ['fade','radius','progress','stroke','waveOpacity'] as const)expect(frame[key]).toBeCloseTo(sample[key],6);
 if(sample.waveRadius!==null)expect(frame.waveRadius).toBeCloseTo(sample.waveRadius,6);
 const cluster=sample.clusterTransform.match(/translateY\(([-+.e\d]+)px\) scale\(([-+.e\d]+)\)/)!;
 const body=sample.bubbleTransform.match(/translateY\(([-+.e\d]+)px\) rotate\(([-+.e\d]+)deg\)/)!;
 expect(frame.lift).toBeCloseTo(Number(cluster[1]),4);expect(frame.intro).toBeCloseTo(Number(cluster[2]),4);
 expect(frame.bounce).toBeCloseTo(Number(body[1]),4);expect(frame.tilt).toBeCloseTo(Number(body[2]),4);
});
it.each(['look','question','danger'])('keeps reduced-motion %s static and omits wave and sparks',intent=>{
 const frame=pointSceneFrame(0,intent,true);
 expect(frame).toMatchObject({intro:1,lift:0,bounce:0,tilt:0,progress:1,waveOpacity:0,sparksOpacity:0});
});
