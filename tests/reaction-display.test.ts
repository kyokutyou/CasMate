import { expect, it } from 'vitest';
import { detectReactionRange } from '../src/main/reactions/reaction-range';
import { reactionCanvasViewport } from '../src/main/reactions/reaction-geometry';
import type { ObsVisualReader } from '../src/main/obs/obs-visual';
import type { StoredReactionFrame } from '../src/main/reactions/reaction-frames';
import { type ReactionWindow, defaultReactionSettings, readReactionSettings } from '../src/shared/listener-reactions';
const display:ReactionWindow={id:'display:device-1',pid:0,title:'device-1',processName:'@display',className:'@display',displayName:'\\\\.\\DISPLAY1',label:'モニター 1',x:-1920,y:100,width:1920,height:1080,minimized:false};
const transform={positionX:100,positionY:50,sourceWidth:1920,sourceHeight:1080,scaleX:.5,scaleY:.5,rotation:0,alignment:5,cropLeft:200,cropTop:100,cropRight:120,cropBottom:80,cropToBounds:false,boundsType:'OBS_BOUNDS_NONE'};
const frame:StoredReactionFrame={context:JSON.stringify(['collection','scene-id',1000,1000]),scene:'scene',bytes:Buffer.alloc(0),metadata:{id:'frame',generation:0,capturedAt:0,validForMs:12000,url:'',width:640,height:640,canvasWidth:1000,canvasHeight:1000}};
function fixture(id:unknown='device-1',overrides:Record<string,unknown>={},targets:ReactionWindow[]=[display], count=1){
 let calls=0;
 const read:ObsVisualReader={valid:()=>true,request:async type=>{
  if(type==='GetCurrentProgramScene')return{currentProgramSceneName:'scene',currentProgramSceneUuid:'scene-id'};
  if(type==='GetSceneCollectionList')return{currentSceneCollectionName:'collection'};
  if(type==='GetVideoSettings')return{baseWidth:1000,baseHeight:1000};
  if(type==='GetSceneItemList')return{sceneItems:Array.from({length:count},(_,i)=>({sourceName:'monitor'+i,sourceUuid:'monitor-id'+i,sceneItemId:i+1,inputKind:'monitor_capture',sceneItemEnabled:true,sceneItemTransform:{...transform,...overrides}}))};
  if(type==='GetInputSettings')return{inputSettings:{monitor_id:typeof id==='function'?id(++calls):id}};
  if(type==='GetSourceFilterList')return{filters:[]};throw Error(type);
 }};
 return (manual=false)=>detectReactionRange(read,manual?display:null,targets,frame,new AbortController().signal,undefined,manual);
}
it('maps four-sided cropping back to a physical monitor with a negative desktop origin',async()=>{
 const r=await fixture()();expect(r.target).toEqual(display);expect(r.region).toEqual({x:.1,y:.05,width:.8,height:.45});expect(r.captureRegion).toEqual({x:0,y:0,width:.96,height:.54});
 const viewport=reactionCanvasViewport(display,{left:0,right:0,top:0,bottom:0},1000,1000,r.captureRegion)!;
 expect(viewport).toEqual({x:-1920,y:100,width:2000,height:2000});expect(viewport.x+r.region.x*viewport.width).toBe(-1720);expect(viewport.y+r.region.y*viewport.height).toBe(200);
 expect(r.dependencies.candidateSources).toContain('monitor-id0');
});
it('supports explicit DISPLAY names and preserves the settings schema',async()=>{
 await expect(fixture(display.displayName)()).resolves.toMatchObject({target:display});
 const saved={...defaultReactionSettings(),target:{title:display.title,processName:'@display',className:'@display'}};expect(readReactionSettings(saved)).toEqual(saved);
});
it.each([undefined,0,'','missing'])('refuses unresolvable monitor identity %j',async id=>{await expect(fixture(id===undefined?null:id)()).rejects.toThrow('モニター');});
it.each([{rotation:90},{scaleX:-.5},{scaleY:.25},{cropLeft:-1},{cropToBounds:true},{cropLeft:1920}])('refuses unsupported display transforms %j',async t=>{await expect(fixture('device-1',t)()).rejects.toThrow();});
it('refuses mismatched monitor dimensions and duplicate matches',async()=>{
 await expect(fixture('device-1',{},[{...display,width:2560}])()).rejects.toThrow('解像度');
 await expect(fixture('device-1',{},[display,{...display,id:'other'}])()).rejects.toThrow('複数');
});
it('cancels when OBS changes the target during the second scan',async()=>{await expect(fixture((n:number)=>n===1?'device-1':'missing')()).rejects.toThrow('判定中');});
it('uses a unique legacy source only after explicit monitor selection, preserving its crop mapping',async()=>{
 const run=fixture(0);await expect(run()).rejects.toThrow('モニター');await expect(run(true)).resolves.toMatchObject({target:display,captureRegion:{x:0,y:0,width:.96,height:.54}});
 await expect(fixture(0,{},[display],2)(true)).rejects.toThrow('複数');await expect(fixture('missing')(true)).rejects.toThrow('モニター');
});
