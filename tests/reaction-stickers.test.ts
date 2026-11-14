// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {REACTION_STICKERS} from '../src/shared/reaction-stickers';
import type {ReactionEvent} from '../src/shared/listener-reactions';
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();document.body.replaceChildren();});
it('renders all nine expressions and never revives removed or expired async drawings',async()=>{
 vi.resetModules();vi.useFakeTimers();vi.setSystemTime(10000);
 const callbacks=new Map<number,FrameRequestCallback>();let serial=0;
 vi.stubGlobal('requestAnimationFrame',(fn:FrameRequestCallback)=>{callbacks.set(++serial,fn);return serial;});
 vi.stubGlobal('cancelAnimationFrame',(id:number)=>callbacks.delete(id));
 let finish!:()=>void;const loaded=new Promise<void>(resolve=>{finish=resolve;});
 vi.stubGlobal('Image',class{src='';decode(){return loaded;}});
 const drawImage=vi.fn(),setTransform=vi.fn();
 const ctx=new Proxy({drawImage,setTransform,createLinearGradient:()=>({addColorStop(){}}),createRadialGradient:()=>({addColorStop(){}})},{get:(target,key)=>key in target?target[key as keyof typeof target]:()=>{}});
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
 const {playReactionSticker}=await import('../src/renderer/reactions/stickers/player');
 const layer=document.createElement('div');document.body.append(layer);Object.defineProperties(layer,{clientWidth:{value:1920},clientHeight:{value:1080}});
 const event:ReactionEvent={instance:'test',sequence:1,counts:{heart:0,clap:0,point:0},accepting:true,pointingEnabled:true,frameGeneration:0,frame:null,kind:'sticker',sticker:'confused',stickerPlacement:{x:.06,y:.08,width:.38,height:.38},at:10000};
 playReactionSticker(layer,event);expect(layer.children).toHaveLength(1);layer.replaceChildren();await Promise.resolve();finish();await loaded;await Promise.resolve();await Promise.resolve();expect(layer.children).toHaveLength(0);expect(callbacks.size).toBe(0);
 for(const sticker of REACTION_STICKERS){playReactionSticker(layer,{...event,sticker:sticker.id});await Promise.resolve();await Promise.resolve();const canvas=layer.querySelector('canvas');expect(canvas?.getAttribute('aria-label')).toBe(sticker.name);expect(canvas?.style.left).toBe('6%');expect(canvas?.style.top).toBe('8%');layer.replaceChildren();await Promise.resolve();}
 expect(drawImage).toHaveBeenCalled();
 playReactionSticker(layer,{...event,at:5000});expect(layer.childElementCount).toBe(0);
 playReactionSticker(layer,{...event,stickerPlacement:undefined});expect(layer.childElementCount).toBe(0);
 const small=document.createElement('div');document.body.append(small);Object.defineProperties(small,{clientWidth:{value:960},clientHeight:{value:540}});
 playReactionSticker(layer,event);playReactionSticker(small,event);await Promise.resolve();await Promise.resolve();
 expect(small.querySelector('canvas')?.style.left).toBe(layer.querySelector('canvas')?.style.left);
 expect(small.querySelector('canvas')?.style.top).toBe(layer.querySelector('canvas')?.style.top);
 layer.replaceChildren();small.replaceChildren();await Promise.resolve();
 const portrait=document.createElement('div');document.body.append(portrait);Object.defineProperties(portrait,{clientWidth:{value:1080},clientHeight:{value:1920}});
 setTransform.mockClear();playReactionSticker(portrait,event);await Promise.resolve();await Promise.resolve();
 const fit=setTransform.mock.calls.find(args=>args[0]!==1);expect(fit).toBeDefined();expect(fit![0]).toBe(fit![3]);expect(fit![5]).toBeGreaterThan(0);
 portrait.replaceChildren();await Promise.resolve();
 for(let i=0;i<5;i++)playReactionSticker(layer,event);expect(layer.childElementCount).toBe(3);
 await vi.advanceTimersByTimeAsync(4200);expect(layer.childElementCount).toBe(0);expect(callbacks.size).toBe(0);
});
