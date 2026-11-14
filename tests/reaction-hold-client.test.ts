// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { setupHoldTool } from '../src/renderer/reactions/client/hold-tool.mjs';

afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();document.body.replaceChildren();});
function fixture(){
 vi.useFakeTimers();vi.spyOn(document,'hidden','get').mockReturnValue(false);
 document.body.innerHTML='<button>応援</button><p role="status"></p>';
 const button=document.querySelector('button')!,hint=document.querySelector('p')!;
 const submit=vi.fn(async()=>({message:'受付'})),onStart=vi.fn();let busy=false;
 const control=setupHoldTool({button,hint,submit,onStart,isBusy:()=>busy});
 const pointer=(type:string,id=1)=>{const event=new MouseEvent(type,{button:0,bubbles:true,cancelable:true});Object.defineProperties(event,{pointerId:{value:id},isPrimary:{value:id===1}});button.dispatchEvent(event);};
 const key=(type:string,value:string,repeat=false)=>button.dispatchEvent(new KeyboardEvent(type,{key:value,repeat,bubbles:true,cancelable:true}));
 return {button,hint,submit,onStart,control,pointer,key,busy:(value:boolean)=>{busy=value;control.refresh();}};
}
it('sends on press and then at one-second intervals, and stops on release without a click duplicate',async()=>{
 const f=fixture();f.pointer('pointerdown');await vi.advanceTimersByTimeAsync(0);expect(f.submit).toHaveBeenCalledExactlyOnceWith({kind:'cheer'},{announcePending:true});expect(f.onStart).toHaveBeenCalledOnce();
 await vi.advanceTimersByTimeAsync(999);expect(f.submit).toHaveBeenCalledTimes(1);await vi.advanceTimersByTimeAsync(1);expect(f.submit).toHaveBeenCalledTimes(2);
 f.pointer('pointerup');f.button.click();await vi.advanceTimersByTimeAsync(3000);expect(f.submit).toHaveBeenCalledTimes(2);expect(f.button.getAttribute('aria-pressed')).toBe('false');f.control.close();
});
it('keeps the ongoing hint while another cheer request is pending',async()=>{
 const f=fixture();
 let finish!:(result:{message:string})=>void;
 f.submit.mockResolvedValueOnce({message:'受付'}).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 f.pointer('pointerdown');await vi.advanceTimersByTimeAsync(0);
 expect(f.hint.textContent).toMatch(/^応援中！/u);
 await vi.advanceTimersByTimeAsync(1000);
 expect(f.submit).toHaveBeenCalledTimes(2);
 expect(f.hint.textContent).toMatch(/^応援中！/u);
 finish({message:'受付'});f.pointer('pointerup');f.control.close();
});
it.each(['pointercancel','lostpointercapture','blur','background','pagehide','Escape','close'])('stops on %s and does not resume automatically',async reason=>{
 const f=fixture();f.pointer('pointerdown');await vi.advanceTimersByTimeAsync(0);
 if(reason==='pointercancel'||reason==='lostpointercapture')f.pointer(reason);
 if(reason==='blur')f.button.dispatchEvent(new Event('blur'));
 if(reason==='background'){vi.spyOn(document,'hidden','get').mockReturnValue(true);document.dispatchEvent(new Event('visibilitychange'));}
 if(reason==='pagehide')window.dispatchEvent(new Event('pagehide'));
 if(reason==='Escape')f.key('keydown','Escape');if(reason==='close')f.control.close();
 await vi.advanceTimersByTimeAsync(2000);expect(f.submit).toHaveBeenCalledTimes(1);expect(f.control.active()).toBe(false);f.control.close();
});
it.each(['Enter',' '])('supports held %j without key-repeat or synthesized click duplicates',async key=>{
 const f=fixture();f.key('keydown',key);f.key('keydown',key,true);f.button.click();await vi.advanceTimersByTimeAsync(1000);expect(f.submit).toHaveBeenCalledTimes(2);
 f.key('keyup',key);await vi.advanceTimersByTimeAsync(2000);expect(f.submit).toHaveBeenCalledTimes(2);f.control.close();
});
it('stops at ten seconds and requires a new press',async()=>{
 const f=fixture();f.key('keydown','Enter');await vi.advanceTimersByTimeAsync(10000);expect(f.submit).toHaveBeenCalledTimes(10);expect(f.control.active()).toBe(false);
 f.key('keydown','Enter',true);await vi.advanceTimersByTimeAsync(2000);expect(f.submit).toHaveBeenCalledTimes(10);f.key('keyup','Enter');f.key('keydown','Enter');expect(f.submit).toHaveBeenCalledTimes(11);f.control.close();
});
it('rejects an overdue pulse before the delayed ten-second timer can run',async()=>{
 const f=fixture();let elapsed=0;vi.spyOn(performance,'now').mockImplementation(()=>elapsed);
 f.pointer('pointerdown');await vi.advanceTimersByTimeAsync(0);expect(f.submit).toHaveBeenCalledTimes(1);
 // Simulate a foreground event-loop stall: wall time passes, timers stay queued.
 elapsed=20000;await vi.advanceTimersByTimeAsync(1000);
 expect(f.submit).toHaveBeenCalledTimes(1);expect(f.control.active()).toBe(false);expect(f.hint.textContent).toContain('10秒');
 f.pointer('pointerup');f.pointer('pointerdown');expect(f.submit).toHaveBeenCalledTimes(2);f.control.close();
});
it('stops on an overdue response without scheduling another pulse',async()=>{
 const f=fixture();let elapsed=0;vi.spyOn(performance,'now').mockImplementation(()=>elapsed);
 let finish!:(value:unknown)=>void;f.submit.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 f.pointer('pointerdown');elapsed=20000;finish({});await vi.advanceTimersByTimeAsync(0);
 expect(f.control.active()).toBe(false);await vi.advanceTimersByTimeAsync(1000);expect(f.submit).toHaveBeenCalledTimes(1);f.control.close();
});
it('serializes slow requests, never catches up, and ignores a late success after release',async()=>{
 const f=fixture();let finish!:(value:unknown)=>void;f.submit.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));f.pointer('pointerdown');await vi.advanceTimersByTimeAsync(2500);expect(f.submit).toHaveBeenCalledTimes(1);
 finish({});await vi.advanceTimersByTimeAsync(999);expect(f.submit).toHaveBeenCalledTimes(1);await vi.advanceTimersByTimeAsync(1);expect(f.submit).toHaveBeenCalledTimes(2);
 f.pointer('pointerup');await vi.advanceTimersByTimeAsync(1000);expect(f.submit).toHaveBeenCalledTimes(2);f.control.close();
});
it.each(['failure','rejection','late success'])('never retries %s after stopping',async reason=>{
 const f=fixture();let finish!:(value:unknown)=>void,fail!:(error:Error)=>void;
 f.submit.mockImplementationOnce(()=>new Promise((resolve,reject)=>{finish=resolve;fail=reject;}));f.pointer('pointerdown');
 if(reason==='late success'){f.pointer('pointerup');finish({});}else if(reason==='failure')finish(null);else fail(new Error('offline'));
 await vi.advanceTimersByTimeAsync(3000);expect(f.submit).toHaveBeenCalledTimes(1);expect(f.control.active()).toBe(false);f.control.close();
});
it('keeps the active button enabled to receive release while blocking new presses during another send',()=>{
 const f=fixture();f.busy(true);f.pointer('pointerdown');expect(f.submit).not.toHaveBeenCalled();f.busy(false);f.pointer('pointerdown');f.busy(true);expect(f.button.disabled).toBe(false);f.pointer('pointerup');expect(f.button.disabled).toBe(true);f.control.close();
});
it('focuses the pointer-activated button so moving focus elsewhere cancels the hold',async()=>{
 const f=fixture();const stage=document.createElement('div');stage.tabIndex=0;document.body.append(stage);
 f.pointer('pointerdown');expect(document.activeElement).toBe(f.button);stage.focus();
 await vi.advanceTimersByTimeAsync(2000);expect(f.submit).toHaveBeenCalledTimes(1);expect(f.control.active()).toBe(false);f.control.close();
});
