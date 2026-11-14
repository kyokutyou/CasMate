// Select a fixed shape, preview locally, and submit exactly once on release.
import { placeArea } from './range.mjs';
export function setupRangeTool({buttons,stage,layer,hint,getFrame,getPoint,submit,isBusy=()=>false,onArm=()=>{},pause=()=>{},resume=()=>{},remaining=()=>Infinity}){
 let shape=null,start=null,frame=null,ghost=null,pointer=null,timer=null,pending=false,revision=0;
 let aim={x:.25,y:.25};
 const refresh=()=>{for(const [kind,button] of Object.entries(buttons)){button.disabled=!getFrame()||pending||isBusy();button.setAttribute('aria-pressed',String(shape===kind));}stage.classList.toggle('is-ranging',!!shape&&!pending);if(shape)stage.setAttribute('aria-disabled',String(pending||isBusy()||!getFrame()));};
 const dropGhost=()=>{ghost?.remove();ghost=null;};
 const release=()=>{const id=pointer;pointer=null;if(id!==null&&stage.hasPointerCapture?.(id))stage.releasePointerCapture(id);clearTimeout(timer);timer=null;resume();};
 const cancel=(message='選んで、画面をタップ')=>{revision++;shape=null;start=null;frame=null;dropGhost();release();hint.textContent=message;refresh();};
 const rectangle=end=>({x:Math.min(start.x,end.x),y:Math.min(start.y,end.y),width:Math.abs(end.x-start.x),height:Math.abs(end.y-start.y)});
 const preview=end=>{
  dropGhost();if(!shape||!getFrame()||!end)return;
  if(start&&frame)ghost=placeArea(layer,rectangle(end),shape,frame.canvasWidth,{duration:0,variant:'range-preview'});
 };
 const announce=()=>{hint.textContent=`${start?'終点':'始点'}: 横${Math.round(aim.x*100)}%・縦${Math.round(aim.y*100)}% · 矢印で移動、Enterで${start?'送信':'固定'} · Escで取消`;};
 const begin=point=>{if(!shape||start||pending||isBusy()||!getFrame()||!point)return false;if(remaining()<=0){cancel('画像の期限が切れました。最新画像でもう一度選んでください。');return false;}frame=getFrame();start=point;pause();const duration=Math.min(10000,remaining());timer=setTimeout(()=>cancel(duration<10000?'画像の期限が切れました。最新画像でもう一度選んでください。':'範囲選択が時間切れになりました。もう一度選んでください。'),duration);hint.textContent='囲んで離すと送信';return true;};
 const commit=async end=>{
  if(!shape||!start||!frame||pending||isBusy()||!end)return;
  if(remaining()<=0||getFrame()?.generation!==frame.generation){cancel();return;}
  const area=rectangle(end),selected=shape,image=frame;
  if(area.width<.01||area.height<.01){cancel('範囲が小さすぎます。少し広い範囲を選んでください。');return;}
  const operation=++revision;shape=null;start=null;pending=true;dropGhost();release();
  const placed=placeArea(layer,area,selected,image.canvasWidth,{duration:0,variant:'range-pending'});ghost=placed;hint.textContent='範囲を送信しています…';refresh();
  // Request start is a conservative lower bound for acceptance, measured locally.
  const sentAt=performance.now();
  try{
   const result=await submit({kind:'area',shape:selected,area,frameId:image.id});
   if(operation!==revision||document.hidden||getFrame()?.generation!==image.generation)return;
   dropGhost();if(result){const duration=4000-(performance.now()-sentAt);if(duration>0)placeArea(layer,area,selected,image.canvasWidth,{duration});hint.textContent='続けるには、もう一度道具を選んでください。';}
   else hint.textContent='送信結果を確認してから、もう一度選んでください。';
  }catch{if(operation===revision)hint.textContent='送信結果を確認できません。自動では再送しません。';}
  finally{placed?.remove();if(ghost===placed)ghost=null;pending=false;refresh();}
 };
 const choices=Object.entries(buttons).map(([kind,button])=>{const click=()=>{if(button.disabled)return;if(shape===kind){cancel();return;}cancel();onArm();shape=kind;aim={x:.25,y:.25};announce();preview(aim);refresh();stage.focus({preventScroll:true});};button.addEventListener('click',click);return [button,click];});
 const down=e=>{if(e.button!==0||e.isPrimary===false||pointer!==null)return;if(begin(getPoint(e.clientX,e.clientY))){e.preventDefault();pointer=e.pointerId;stage.setPointerCapture?.(pointer);}};
 const move=e=>{if(pointer===e.pointerId&&start){e.preventDefault();preview(getPoint(e.clientX,e.clientY,true));}};
 const up=e=>{if(pointer===e.pointerId){e.preventDefault();void commit(getPoint(e.clientX,e.clientY,true));}};
 const lost=e=>{if(pointer===e.pointerId)cancel();};
 const key=e=>{if(!shape||pending||isBusy())return;if(e.key==='Escape'){e.preventDefault();cancel();return;}if(e.key==='Enter'||e.key===' '){e.preventDefault();if(!start){if(begin(aim)){preview(aim);announce();}}else void commit(aim);return;}if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();aim={x:Math.max(0,Math.min(1,aim.x+(e.key==='ArrowLeft'?-.05:e.key==='ArrowRight'?.05:0))),y:Math.max(0,Math.min(1,aim.y+(e.key==='ArrowUp'?-.05:e.key==='ArrowDown'?.05:0)))};preview(aim);announce();};
 const visibility=()=>{if(document.hidden)cancel();};
 const escape=e=>{if(e.key==='Escape'&&shape){e.preventDefault();cancel();}};
 stage.addEventListener('pointerdown',down);stage.addEventListener('pointermove',move);stage.addEventListener('pointerup',up);stage.addEventListener('pointercancel',lost);stage.addEventListener('lostpointercapture',lost);stage.addEventListener('keydown',key);document.addEventListener('visibilitychange',visibility);document.addEventListener('keydown',escape);
 refresh();return {refresh,invalidate:()=>cancel(),close(){cancel();for(const [button,click] of choices)button.removeEventListener('click',click);stage.removeEventListener('pointerdown',down);stage.removeEventListener('pointermove',move);stage.removeEventListener('pointerup',up);stage.removeEventListener('pointercancel',lost);stage.removeEventListener('lostpointercapture',lost);stage.removeEventListener('keydown',key);document.removeEventListener('visibilitychange',visibility);document.removeEventListener('keydown',escape);}};
}
