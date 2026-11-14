import {expect,it} from 'vitest';
import {ReactionStickerPlacement} from '../src/main/reactions/reaction-sticker-placement';
const area=(a:{x:number;y:number;width:number;height:number},b:typeof a)=>Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
it.each([[1920,1080],[1080,1920],[3840,1080],[1000,1000],[8000,500]])('keeps the complete reaction inside safe bounds at %ix%i', (width,height)=>{
 const pool=new ReactionStickerPlacement();const positions=new Set<string>();
 for(let i=0;i<80;i++){
  const box=pool.choose('instance:'+i,i*200,4300,width,height);positions.add(`${box.x},${box.y}`);
  expect(box.x).toBeGreaterThanOrEqual(.03);expect(box.y).toBeGreaterThanOrEqual(.03);
  expect(box.x+box.width).toBeLessThanOrEqual(.9700001);expect(box.y+box.height).toBeLessThanOrEqual(.8500001);
  expect(box.width*width/(box.height*height)).toBeCloseTo(736/414,8);
 }
 expect(positions.size).toBeGreaterThan(40);
});
it('avoids occupied space, expires by the supplied monotonic time and resets on clear',()=>{
 const pool=new ReactionStickerPlacement();
 const a=pool.choose('repeat',0,4000),b=pool.choose('repeat',1,4000);
 expect(area(a,b)).toBeLessThan(a.width*a.height*.5);
 expect(pool.choose('repeat',4001,4000)).toEqual(a);
 pool.choose('other',4002,4000);pool.clear();expect(pool.choose('repeat',4003,4000)).toEqual(a);
});
it('is deterministic from the authoritative accepted order and does not expose its history for mutation',()=>{
 const a=new ReactionStickerPlacement(),b=new ReactionStickerPlacement();
 for(let i=0;i<30;i++)expect(a.choose('session:'+i,i*500,4200)).toEqual(b.choose('session:'+i,i*500,4200));
 const c=new ReactionStickerPlacement(),d=new ReactionStickerPlacement();
 const box=c.choose('a',0,4200);d.choose('a',0,4200);box.x=999;
 expect(c.choose('b',1,4200)).toEqual(d.choose('b',1,4200));
});
