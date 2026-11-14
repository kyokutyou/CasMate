import { expect, it } from 'vitest';
import { detectReactionRange, rangeRecoveryChanged } from '../src/main/reactions/reaction-range';
import type { ObsVisualReader } from '../src/main/obs/obs-visual';
import type { StoredReactionFrame } from '../src/main/reactions/reaction-frames';
import { reactionCaptureRegion, reactionSourceRegion } from '../src/main/reactions/reaction-geometry';
const t={positionX:0,positionY:0,sourceWidth:1000,sourceHeight:1000,scaleX:1,scaleY:1,rotation:0,alignment:5,cropLeft:0,cropTop:0,cropRight:0,cropBottom:0,cropToBounds:false,boundsType:'OBS_BOUNDS_NONE'};
const window={id:'1',pid:1,title:'game',processName:'game.exe',className:'Game',x:0,y:0,width:1000,height:1000,minimized:false};
const leaf={sourceName:'game',sourceUuid:'game-id',sceneItemId:7,inputKind:'window_capture',sceneItemEnabled:true,sceneItemTransform:t};
const frame:StoredReactionFrame={context:JSON.stringify(['collection','root-id',1000,1000]),scene:'root',bytes:Buffer.alloc(0),metadata:{id:'frame',generation:0,capturedAt:0,validForMs:12000,url:'',width:640,height:640,canvasWidth:1000,canvasHeight:1000}};
function fixture(options:{nested?:boolean; nestedScene?:boolean;filters?:Record<string,unknown>[];moving?:boolean;extra?:Record<string,unknown>[]}={}){
 let lists=0;
 const parent={sourceName:'nested',sourceUuid:'nested-id',sceneItemId:2,sceneItemEnabled:true,isGroup:!options.nestedScene,sourceType:options.nestedScene?'OBS_SOURCE_TYPE_SCENE':undefined,sceneItemTransform:{...t,positionX:100,positionY:100,scaleX:.5,scaleY:.5}};
 const read:ObsVisualReader={valid:()=>true,request:async(type,data)=>{
  switch(type){
   case 'GetCurrentProgramScene':return {currentProgramSceneName:'root',currentProgramSceneUuid:'root-id'};
   case 'GetSceneCollectionList':return {currentSceneCollectionName:'collection'};
   case 'GetVideoSettings':return {baseWidth:1000,baseHeight:1000};
   case 'GetSceneItemList':if(data?.sceneName==='nested')return {sceneItems:[{...leaf,sceneItemTransform:{...t,positionX:100,positionY:100,scaleX:.5,scaleY:.5,cropLeft:100}}]};lists++;return {sceneItems:[options.nested?parent:leaf,...(options.extra??[]),{sourceName:'text',sceneItemId:9,inputKind:'text_gdiplus',sceneItemEnabled:true,sceneItemTransform:{...t,positionX:options.moving?lists:0}}]};
   case 'GetGroupSceneItemList':return {sceneItems:[{...leaf,sceneItemTransform:{...t,positionX:100,positionY:100,scaleX:.5,scaleY:.5,cropLeft:100}}]};
   case 'GetInputSettings':return {inputSettings:{window:data?.inputName==='other'?'missing:Missing:missing.exe':'game:Game:game.exe'}};
   case 'GetSourceFilterList':return {filters:options.filters??[]};
   default:throw new Error(type);
  }
 }};
 return {read,run:()=>detectReactionRange(read,null,[window],frame,new AbortController().signal)};
}
it('retains the original source behind item crops',()=>{
 expect(reactionCaptureRegion({...t,cropLeft:100,cropTop:200},1000,1000)).toEqual({x:-.1,y:-.2,width:1,height:1});
 expect(reactionSourceRegion({...t,cropLeft:100,cropTop:200},1000,1000)).toEqual({x:0,y:0,width:.9,height:.8});
});
it('composes group and cropped child coordinates',async()=>{
 const result=await fixture({nested:true}).run();expect(result.region).toEqual({x:.15,y:.15,width:.225,height:.25});expect(result.captureRegion).toEqual({x:.125,y:.15,width:.25,height:.25});
 expect(result.binding.fingerprint).toBe('2deb300da2d1acb10e5999010929722ae6548a8a34298fca6e9727015d770291');
});
it('detects changed geometry on the selected path while ignoring another capture placement', async () => {
 const other = { ...leaf, sourceName:'other', sourceUuid:'other-id', sceneItemId:8 };
 const { recovery } = await fixture({ nested:true, extra:[other] }).run();
 const moved = fixture({ nested:true, extra:[{ ...other, sceneItemTransform:{ ...t, positionX:400 } }] });
 await expect(rangeRecoveryChanged(moved.read, recovery)).resolves.toBe(false);

 const request = moved.read.request;
 moved.read.request = (type, data) => type === 'GetGroupSceneItemList'
  ? Promise.resolve({ sceneItems:[{ ...leaf, sceneItemTransform:{ ...t, positionX:100, positionY:100, scaleX:.5, scaleY:.5, cropLeft:150 } }] })
  : request(type, data);
 await expect(rangeRecoveryChanged(moved.read, recovery)).resolves.toBe('configuration');
});
it('ignores movement of unrelated text while checking candidates',async()=>{await expect(fixture({moving:true}).run()).resolves.toMatchObject({target:window});});
it('ignores another capture without a corresponding window',async()=>{await expect(fixture({extra:[{...leaf,sourceName:'other',sceneItemId:8}]}).run()).resolves.toMatchObject({target:window});});
it('rejects a silently changed capture that becomes ambiguous on the second scan', async () => {
 const other = { ...leaf, sourceName:'other', sourceUuid:'other-id', sceneItemId:8 };
 const { read } = fixture({ extra:[other] });
 const request = read.request;
 const peers = ['first', 'second'].map((title, index) => ({ ...window, title, id:String(index + 2), pid:index + 2, processName:'other.exe', className:'Other' }));
 let reads = 0;
 read.request = (type, data) => type === 'GetInputSettings' && data?.inputName === 'other'
  ? Promise.resolve({ inputSettings:{ window:++reads === 1 ? 'first:Other:other.exe' : 'missing:Other:other.exe' } })
  : request(type, data);

 await expect(detectReactionRange(read, window, [window, ...peers], frame, new AbortController().signal)).rejects.toMatchObject({ retryable:true });
});
it.each(['color_filter','color_filter_v2'])('allows standard colour correction %s',async filterKind=>{await expect(fixture({filters:[{filterKind,filterEnabled:true}]}).run()).resolves.toMatchObject({target:window});});
it('rejects an unknown active geometric filter',async()=>{await expect(fixture({filters:[{filterKind:'crop_filter',filterEnabled:true}]}).run()).rejects.toThrow('フィルター');});

it('composes a nested scene using its local source coordinates',async()=>{
 const result=await fixture({nested:true,nestedScene:true}).run();
 expect(result.region).toEqual({x:.15,y:.15,width:.225,height:.25});
 expect(result.dependencies.items).toEqual([
   {scene:'root',id:2,transform:{...t,positionX:100,positionY:100,scaleX:.5,scaleY:.5}},
   {scene:'nested',id:7,transform:{...t,positionX:100,positionY:100,scaleX:.5,scaleY:.5,cropLeft:100}},
 ]);
 expect(result.dependencies.sceneItems).toEqual([{scene:'root',ids:[2,9]},{scene:'nested',ids:[7]}]);
});
it('clips descendants against the parent crop without stretching the original source',async()=>{
 const f=fixture({nested:true}),normal=f.read.request;
 f.read.request=async(type,data)=>{const value=await normal(type,data);if(type==='GetSceneItemList')for(const node of value.sceneItems as Record<string,unknown>[])if(node.isGroup)node.sceneItemTransform={...t,positionX:100,positionY:100,scaleX:.5,scaleY:.5,cropLeft:300};return value;};
 const r=await f.run();expect(r.region.x).toBe(.1);expect(r.region.width).toBeCloseTo(.125);expect(r.captureRegion.x).toBeCloseTo(-.025);expect(r.captureRegion.width).toBe(.25);
});
it('ignores disabled unknown filters',async()=>{await expect(fixture({filters:[{filterKind:'external_crop',filterEnabled:false}]}).run()).resolves.toMatchObject({target:window});});
it('rejects duplicate visible paths to the same input',async()=>{await expect(fixture({extra:[{...leaf,sceneItemId:8}]}).run()).rejects.toThrow('複数');});
it('detects recursive scenes',async()=>{
 const f=fixture({nested:true}),normal=f.read.request;f.read.request=(type,data)=>type==='GetGroupSceneItemList'?Promise.resolve({sceneItems:[{sourceName:'root',sourceType:'OBS_SOURCE_TYPE_SCENE',sceneItemEnabled:true}]}):normal(type,data);
 await expect(f.run()).rejects.toThrow('循環');
});
it('limits total traversal including non-capture decorations',async()=>{
 await expect(fixture({extra:Array.from({length:64},(_,i)=>({sourceName:'text'+i,sceneItemId:100+i,sceneItemEnabled:true,inputKind:'text_gdiplus'}))}).run()).rejects.toThrow('対象数');
});
it.each([{cropLeft:-1},{cropRight:1000},{cropToBounds:true}])('rejects invalid or unsupported cropping %j',override=>{expect(reactionCaptureRegion({...t,...override},1000,1000)).toBeNull();});
it('classifies temporary OBS read failures without retrying unexpected errors',async()=>{
 const f=fixture(),normal=f.read.request;
 f.read.request=(type,data)=>type==='GetInputSettings'?Promise.reject(new Error('OBS_VISUAL_UNAVAILABLE')):normal(type,data);
 await expect(f.run()).rejects.toMatchObject({retryable:true});
 f.read.request=(type,data)=>type==='GetInputSettings'?Promise.reject(new Error('unexpected')):normal(type,data);
 await expect(f.run()).rejects.toThrow('unexpected');
});
it('checks dependency changes after the second scan and releases the observer',async()=>{
 const f=fixture(),normal=f.read.request;let valid=true,closed=false,video=0;
 f.read.request=async(type,data)=>{if(type==='GetVideoSettings'&&++video===2)valid=false;return normal(type,data);};
 await expect(detectReactionRange(f.read,null,[window],frame,new AbortController().signal,()=>({valid:()=>valid,close:()=>{closed=true;}}))).rejects.toMatchObject({retryable:true});
 expect(closed).toBe(true);
});
it('releases a registered observer when detection is cancelled during a request',async()=>{
 const f=fixture(),normal=f.read.request,abort=new AbortController();let release!:(value:Record<string,unknown>)=>void,closed=false;
 f.read.request=(type,data)=>type==='GetSourceFilterList'?new Promise(resolve=>{release=resolve;}):normal(type,data);
 const detecting=detectReactionRange(f.read,null,[window],frame,abort.signal,()=>({valid:()=>true,close:()=>{closed=true;}}));
 const rejected=expect(detecting).rejects.toThrow();while(!release)await Promise.resolve();abort.abort();await rejected;expect(closed).toBe(true);release({filters:[]});
});
it('retries when a newly traversed child scene appears before observer registration',async()=>{
 const f=fixture(),normal=f.read.request;let added=false;
 f.read.request=async(type,data)=>{
  if(type==='GetSceneItemList'&&data?.sceneName==='new-scene')return {sceneItems:[]};
  const value=await normal(type,data);
  if(type==='GetSceneItemList'&&added)value.sceneItems=[...(value.sceneItems as Record<string,unknown>[]),{sourceName:'new-scene',sceneItemId:10,sceneItemEnabled:true,sourceType:'OBS_SOURCE_TYPE_SCENE',sceneItemTransform:t}];
  if(type==='GetInputSettings')added=true;
  return value;
 };
 await expect(f.run()).rejects.toMatchObject({retryable:true});
});
