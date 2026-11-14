import { expect, it } from 'vitest';
import { reactionCaptureRegion, reactionSourceRegion, reactionCanvasViewport } from '../src/main/reactions/reaction-geometry';
import { defaultReactionSettings, validReactionSettings } from '../src/shared/listener-reactions';

const transform={positionX:0,positionY:0,sourceWidth:1920,sourceHeight:1080,scaleX:.5,scaleY:.5,rotation:0,alignment:5,cropLeft:0,cropTop:0,cropRight:0,cropBottom:0,cropToBounds:false,boundsType:'OBS_BOUNDS_NONE'};
it.each([
  {positionX:-480,positionY:0,full:{x:-.25,y:0,width:.5,height:.5},visible:{x:0,y:0,width:.25,height:.5}},
  {positionX:0,positionY:-270,full:{x:0,y:-.25,width:.5,height:.5},visible:{x:0,y:0,width:.5,height:.25}},
  {positionX:1440,positionY:0,full:{x:.75,y:0,width:.5,height:.5},visible:{x:.75,y:0,width:.25,height:.5}},
  {positionX:0,positionY:810,full:{x:0,y:.75,width:.5,height:.5},visible:{x:0,y:.75,width:.5,height:.25}},
])('retains the full capture mapping while clipping the visible region at $positionX,$positionY',({positionX,positionY,full,visible})=>{
  expect(reactionCaptureRegion({...transform,positionX,positionY},1920,1080)).toEqual(full);
  expect(reactionSourceRegion({...transform,positionX,positionY},1920,1080)).toEqual(visible);
});
it('handles the reported fit-inner capture extending below the 1080px canvas',()=>{
  const source={...transform,sourceWidth:1497,sourceHeight:904,scaleX:1,scaleY:1,positionY:152,boundsType:'OBS_BOUNDS_SCALE_INNER',boundsWidth:1462,boundsHeight:990,boundsAlignment:0};
  const full=reactionCaptureRegion(source,1920,1080)!,visible=reactionSourceRegion(source,1920,1080)!;
  expect(full.y+full.height).toBeCloseTo(1088.432197728791/1080,9);expect(visible.y+visible.height).toBeCloseTo(1,12);
  const target={id:'1',pid:1,title:'game',processName:'game.exe',className:'Game',x:100,y:200,width:1497,height:904,minimized:false};
  const canvas=reactionCanvasViewport(target,{left:0,right:0,top:0,bottom:0},1920,1080,full)!;
  expect(canvas.width).toBeCloseTo(1920*1497/1462,0);expect(canvas.height).toBeCloseTo(1080*1497/1462,0);
  // Native bounds round both origin and size to physical pixels.
  expect(Math.abs(canvas.y+canvas.height*full.y-200)).toBeLessThan(1);
});
it.each([{positionX:1920},{positionY:1080},{positionX:-960},{positionY:-540},{rotation:1},{cropLeft:-1},{scaleX:-.5}])('refuses fully offscreen or unsupported captures %j',override=>{
  expect(reactionCaptureRegion({...transform,...override},1920,1080)).toBeNull();
});
it('keeps manual and API region validation restricted to the canvas',()=>{
  expect(validReactionSettings({...defaultReactionSettings(),region:{x:-.1,y:0,width:1,height:1}})).toBe(false);
  expect(validReactionSettings({...defaultReactionSettings(),region:{x:0,y:0,width:1.1,height:1}})).toBe(false);
});
