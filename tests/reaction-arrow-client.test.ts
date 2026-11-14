// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import {afterEach,expect,it,vi} from 'vitest';
import {setupArrowTool} from '../src/renderer/reactions/client/arrow-tool.mjs';
import {placeArrow,shortArrow} from '../src/renderer/reactions/client/arrow.mjs';
import {drawArrowFrame} from '../src/renderer/reactions/client/arrow-scene.mjs';

afterEach(()=>{document.body.replaceChildren();vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});
function context(){
 const ops:unknown[][]=[];
 const c={setTransform:(...args:number[])=>ops.push(['transform',...args]),clearRect:(...args:number[])=>ops.push(['clear',...args]),save(){},restore(){},beginPath(){},moveTo:(...args:number[])=>ops.push(['move',...args]),lineTo:(...args:number[])=>ops.push(['line',...args]),stroke:()=>ops.push(['stroke',c.globalAlpha,c.strokeStyle,c.lineWidth,c.lineCap,c.lineJoin]),globalAlpha:1,strokeStyle:'',lineWidth:0,lineCap:'',lineJoin:''};
 return {c,ops};
}
function fixture(remaining=()=>Infinity){
 vi.useFakeTimers();vi.spyOn(document,'hidden','get').mockReturnValue(false);
 vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockImplementation(()=>context().c as never);
 document.body.innerHTML='<button></button><div tabindex="0"></div><section></section><p></p>';
 const button=document.querySelector('button')!,stage=document.querySelector('div')!,layer=document.querySelector('section')!,hint=document.querySelector('p')!;
 let frame:{id:string;instance:string;generation:number;canvasWidth:number;canvasHeight:number}|null={id:'frame',instance:'server',generation:1,canvasWidth:1920,canvasHeight:1080};
 const submit=vi.fn(async(_payload:object)=>({at:Date.now()})),pause=vi.fn(),resume=vi.fn();
 const control=setupArrowTool({button,stage,layer,hint,getFrame:()=>frame,getPoint:(x:number,y:number,clamp:boolean)=>clamp?{x:Math.max(0,Math.min(1,x/1000)),y:Math.max(0,Math.min(1,y/562.5))}:x>=0&&x<=1000&&y>=0&&y<=562.5?{x:x/1000,y:y/562.5}:null,submit,pause,resume,remaining});
 const pointer=(type:string,x:number,y:number)=>{const e=new MouseEvent(type,{button:0,clientX:x,clientY:y,bubbles:true,cancelable:true});Object.defineProperties(e,{pointerId:{value:1},isPrimary:{value:true}});stage.dispatchEvent(e);};
 const key=(key:string)=>stage.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));
 return {button,stage,layer,hint,submit,pause,resume,control,pointer,key,setFrame:(value:typeof frame)=>{frame=value;}};
}
it.each(['click','drag','keyboard'])('previews %s locally and submits one pair of normalized endpoints on confirmation',async input=>{
 const f=fixture();try{
  f.button.click();expect(f.layer.querySelector('.arrow-preview')).not.toBeNull();
  f.pointer('pointermove',200,300);const ghost=f.layer.firstElementChild;f.pointer('pointermove',250,300);expect(f.layer.firstElementChild).toBe(ghost);expect(f.submit).not.toHaveBeenCalled();
  if(input==='keyboard'){f.key('Enter');f.key('ArrowRight');f.key('ArrowUp');expect(f.submit).not.toHaveBeenCalled();f.key('Enter');}
  else {f.pointer('pointerdown',200,300);if(input==='drag')f.pointer('pointermove',800,100);expect(f.submit).not.toHaveBeenCalled();f.pointer('pointerup',input==='drag'?800:200,input==='drag'?100:300);f.pointer('pointerup',800,100);f.stage.click();}
  await vi.advanceTimersByTimeAsync(0);expect(f.submit).toHaveBeenCalledOnce();
  const payload=f.submit.mock.calls[0][0] as {kind:string;frameId:string;from:{x:number;y:number};to:{x:number;y:number}};
  expect(payload).toMatchObject({kind:'arrow',frameId:'frame'});
  if(input==='drag'){expect(payload.from).toEqual({x:.2,y:300/562.5});expect(payload.to).toEqual({x:.8,y:100/562.5});}
  if(input==='click')expect(payload).toMatchObject(shortArrow({x:.2,y:300/562.5},1920,1080));
  expect(f.button.getAttribute('aria-pressed')).toBe('false');expect(f.layer.querySelector('.arrow-preview,.arrow-pending')).toBeNull();expect(f.layer.querySelector('.arrow-marker')).not.toBeNull();expect(f.pause).toHaveBeenCalledOnce();expect(f.resume).toHaveBeenCalled();
 }finally{f.control.close();}
});
it.each(['Escape','pointercancel','lostpointercapture','timeout','background','invalidate','reselect'])('cancels %s and never submits a stale drag',async reason=>{
 const f=fixture();f.button.click();f.pointer('pointerdown',200,300);f.pointer('pointermove',800,100);
 if(reason==='Escape')f.key('Escape');if(reason==='pointercancel'||reason==='lostpointercapture')f.pointer(reason,800,100);if(reason==='timeout')await vi.advanceTimersByTimeAsync(10000);if(reason==='background'){vi.spyOn(document,'hidden','get').mockReturnValue(true);document.dispatchEvent(new Event('visibilitychange'));}if(reason==='invalidate'){f.setFrame(null);f.control.invalidate();}if(reason==='reselect')f.button.click();
 f.pointer('pointerup',800,100);expect(f.submit).not.toHaveBeenCalled();expect(f.layer.childElementCount).toBe(0);expect(f.resume).toHaveBeenCalled();f.control.close();
});
it('hides hover outside the image, clamps a captured drag, and uses a short arrow for a tiny drag',async()=>{
 const f=fixture();f.button.click();f.pointer('pointermove',-1,10);expect(f.layer.childElementCount).toBe(0);f.pointer('pointerdown',-1,10);f.pointer('pointerup',200,100);expect(f.submit).not.toHaveBeenCalled();
 f.pointer('pointerdown',500,250);f.pointer('pointerup',2000,-200);await vi.advanceTimersByTimeAsync(0);expect(f.submit.mock.calls[0][0]).toMatchObject({to:{x:1,y:0}});
 f.button.click();f.pointer('pointerdown',500,250);f.pointer('pointerup',501,251);await vi.advanceTimersByTimeAsync(0);expect(f.submit.mock.calls[1][0]).toMatchObject(shortArrow({x:.501,y:251/562.5},1920,1080));f.control.close();
});
it('honors the image deadline during selection',async()=>{
 const f=fixture(()=>500);f.button.click();f.pointer('pointerdown',100,100);await vi.advanceTimersByTimeAsync(500);f.pointer('pointerup',800,100);expect(f.submit).not.toHaveBeenCalled();expect(f.layer.childElementCount).toBe(0);expect(f.hint.dataset.notice).toBe('true');expect(f.hint.textContent).toContain('期限');expect(f.button.getAttribute('aria-pressed')).toBe('false');f.control.invalidate();expect(f.hint.dataset.notice).toBe('false');f.control.close();
});
it.each([500,4001])('seeks a successful response delayed %ims instead of restarting it',async delay=>{
 const f=fixture();let finish!:(value:{at:number})=>void;f.submit.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));f.button.click();f.pointer('pointerdown',200,300);f.pointer('pointerup',800,100);await vi.advanceTimersByTimeAsync(delay);finish({at:Date.now()});await vi.advanceTimersByTimeAsync(0);
 expect(f.layer.childElementCount).toBe(delay<4000?1:0);if(delay<4000){expect(Number((f.layer.firstElementChild as HTMLElement).dataset.elapsed)).toBeGreaterThanOrEqual(delay);await vi.advanceTimersByTimeAsync(4000-delay);expect(f.layer.childElementCount).toBe(0);}f.control.close();
});
it('ignores a late success after invalidation and never retries an unknown result',async()=>{
 const f=fixture();let finish!:(value:{at:number})=>void;f.submit.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));f.button.click();f.pointer('pointerdown',200,300);f.pointer('pointerup',800,100);f.control.invalidate();finish({at:Date.now()});await vi.advanceTimersByTimeAsync(0);expect(f.layer.childElementCount).toBe(0);
 f.submit.mockRejectedValueOnce(new Error('offline'));f.button.click();f.key('Enter');f.key('Enter');await vi.advanceTimersByTimeAsync(10000);expect(f.submit).toHaveBeenCalledTimes(2);expect(f.layer.childElementCount).toBe(0);f.control.close();
});
it('bounds accepted canvas storage, clips PC drawing, and disposes timers and animation on removal',async()=>{
 const f=fixture();for(let i=0;i<12;i++)placeArrow(f.layer,{x:.1,y:.6},{x:.7,y:.2},{clip:{x:.25,y:0,width:.5,height:1}});
 await vi.advanceTimersByTimeAsync(0);expect(f.layer.childElementCount).toBe(10);expect((f.layer.firstElementChild as HTMLElement).style.clipPath).toBe('inset(0% 25% 0% 25%)');
 expect([...f.layer.querySelectorAll('canvas')].every(c=>c.width*c.height<=1050000)).toBe(true);f.layer.replaceChildren();await vi.advanceTimersByTimeAsync(0);expect(vi.getTimerCount()).toBe(0);f.control.close();
});
it.each([[736,414],[320,1000],[3000,100]])('keeps clicked tips exact and short-arrow starts inside a %ix%i image',(w,h)=>{
 for(const x of [0,.01,.35,.5,.99,1])for(const y of [0,.01,.5,.99,1]){const p={x,y},a=shortArrow(p,w,h);expect(a.to).toEqual(p);expect(a.from).not.toEqual(p);expect(a.from.x).toBeGreaterThanOrEqual(0);expect(a.from.x).toBeLessThanOrEqual(1);expect(a.from.y).toBeGreaterThanOrEqual(0);expect(a.from.y).toBeLessThanOrEqual(1);}
});
const original=readFileSync('tests/fixtures/reaction-arrow-sample-reference.txt','utf8');
it.each([0,99,100,460,650,820,900,950,1100,1240,1470,1600,3399,3400,3570,3650,3740,3980,4000])('matches the approved sample canvas strokes and label at %ims',age=>{
 const from={x:.2,y:.7},to={x:.8,y:.25},W=736,H=414,a=context(),b=context(),labelA=document.createElement('span'),labelB=document.createElement('span'),rootA=document.createElement('div'),rootB=document.createElement('div');
 const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n)),ease=(n:number)=>1-Math.pow(1-clamp(n,0,1),3),mix=(a:{x:number;y:number},b:{x:number;y:number},t:number)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
 const start={x:from.x*W,y:from.y*H},end={x:to.x*W,y:to.y*H},len=Math.hypot(end.x-start.x,end.y-start.y);
 const sample=new Function('fx','label','root','ghost','active','reduced','palette','W','H','dpr','clamp','ease','mix','arrowGeometry','ms',original+'\ndraw(ms);');
 sample({getContext:()=>b.c},labelB,rootB,null,{}, {matches:false},{color:'#237b90'},W,H,1,clamp,ease,mix,()=>({start,end,v:{x:(end.x-start.x)/len,y:(end.y-start.y)/len}}),age);
 drawArrowFrame(a.c,labelA,rootA,from,to,W,H,age);expect(a.ops).toEqual(b.ops);expect(labelA.outerHTML).toBe(labelB.outerHTML);expect(rootA.dataset).toEqual(rootB.dataset);
});
