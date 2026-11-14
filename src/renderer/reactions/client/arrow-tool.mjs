// Selection never broadcasts; only pointer release or keyboard confirmation sends.
import { moveArrow, placeArrow, shortArrow } from './arrow.mjs';
export function setupArrowTool({button,stage,layer,hint,getFrame,getPoint,submit,isBusy=()=>false,onArm=()=>{},pause=()=>{},resume=()=>{},remaining=()=>Infinity}){
 let armed=false,start=null,image=null,ghost=null,pointer=null,timer=null,pending=false,revision=0,aim={x:.5,y:.5};
 const refresh=()=>{button.disabled=!getFrame()||pending||isBusy();button.setAttribute('aria-pressed',String(armed));stage.classList.toggle('is-arrowing',armed&&!pending);if(armed)stage.setAttribute('aria-disabled',String(button.disabled));};
 const drop=()=>{ghost?.remove();ghost=null;};
 const release=()=>{const id=pointer;pointer=null;if(id!==null&&stage.hasPointerCapture?.(id))stage.releasePointerCapture(id);clearTimeout(timer);timer=null;resume();};
 const instruction='タップで矢印 · ドラッグで向きを指定';
 const cancel=(message=instruction)=>{revision++;armed=false;start=null;image=null;drop();release();hint.textContent=message;hint.dataset.notice=String(message!==instruction);refresh();};
 const endpoints=end=>{
  const frame=image||getFrame(),W=frame?.canvasWidth||736,H=frame?.canvasHeight||W*9/16;
  return start&&Math.hypot((end.x-start.x)*736,(end.y-start.y)*736*H/W)>=12?{from:{...start},to:{...end}}:shortArrow(end,W,H);
 };
 const preview=end=>{
  if(!armed||pending||isBusy()||!getFrame()||!end){drop();return;}
  aim=end;const {from,to}=endpoints(end);
  if(!ghost?.isConnected)ghost=placeArrow(layer,from,to,{duration:0,variant:'arrow-preview'});else moveArrow(ghost,from,to);
 };
 const announce=()=>{hint.textContent=`${start?'終点':'位置'}: 横${Math.round(aim.x*100)}%・縦${Math.round(aim.y*100)}% · 矢印で移動、Enterで${start?'送信':'始点を固定'} · Escで取消`;};
 const begin=point=>{
  if(!armed||start||pending||isBusy()||!getFrame()||!point)return false;
  if(remaining()<=0){cancel('画像の期限が切れました。最新画像でもう一度選んでください。');return false;}
  image=getFrame();start=point;pause();const duration=Math.min(10000,remaining());
  timer=setTimeout(()=>cancel(duration<10000?'画像の期限が切れました。最新画像でもう一度選んでください。':'矢印の選択が時間切れになりました。もう一度選んでください。'),duration);
  hint.textContent='離すと送信 · ドラッグで向きを指定 · Escで取消';return true;
 };
 const commit=async end=>{
  if(!armed||!start||!image||pending||isBusy()||!end)return;
  if(remaining()<=0||getFrame()?.generation!==image.generation||getFrame()?.instance!==image.instance){cancel();return;}
  const {from,to}=endpoints(end),frame=image,operation=++revision;armed=false;start=null;image=null;pending=true;drop();release();
  const placed=placeArrow(layer,from,to,{duration:0,variant:'arrow-pending'});ghost=placed;hint.textContent='矢印を送信しています…';hint.dataset.notice='true';refresh();const sentAt=performance.now();
  try{
   const result=await submit({kind:'arrow',frameId:frame.id,from,to});
   if(operation!==revision||document.hidden||getFrame()?.generation!==frame.generation||getFrame()?.instance!==frame.instance)return;
   drop();if(result){const age=performance.now()-sentAt;if(age<4000)placeArrow(layer,from,to,{age});hint.textContent='続けるには、もう一度道具を選んでください。';}
   else hint.textContent='送信結果を確認してから、もう一度選んでください。';
  }catch{if(operation===revision)hint.textContent='送信結果を確認できません。自動では再送しません。';}
  finally{placed?.remove();if(ghost===placed)ghost=null;pending=false;refresh();}
 };
 const toggle=()=>{if(button.disabled)return;if(armed){cancel();return;}cancel();onArm();armed=true;aim={x:.5,y:.5};refresh();preview(aim);stage.focus({preventScroll:true});};
 const down=e=>{if(e.button!==0||e.isPrimary===false||pointer!==null)return;if(begin(getPoint(e.clientX,e.clientY))){e.preventDefault();pointer=e.pointerId;stage.setPointerCapture?.(pointer);preview(start);}};
 const move=e=>{if(pointer!==null&&pointer!==e.pointerId)return;if(pointer!==null)e.preventDefault();preview(getPoint(e.clientX,e.clientY,pointer!==null));};
 const up=e=>{if(pointer===e.pointerId){e.preventDefault();void commit(getPoint(e.clientX,e.clientY,true));}};
 const lost=e=>{if(pointer===e.pointerId)cancel();};
 const leave=()=>{if(pointer===null&&!start)drop();};
 const key=e=>{
  if(!armed||pending||isBusy())return;
  if(e.key==='Escape'){e.preventDefault();cancel();return;}
  if(e.key==='Enter'||e.key===' '){e.preventDefault();if(e.repeat)return;if(!start){if(begin(aim)){preview(aim);announce();}}else void commit(aim);return;}
  if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();
  aim={x:Math.max(0,Math.min(1,aim.x+(e.key==='ArrowLeft'?-.05:e.key==='ArrowRight'?.05:0))),y:Math.max(0,Math.min(1,aim.y+(e.key==='ArrowUp'?-.05:e.key==='ArrowDown'?.05:0)))};preview(aim);announce();
 };
 const visibility=()=>{if(document.hidden)cancel();},escape=e=>{if(e.key==='Escape'&&armed){e.preventDefault();cancel();}};
 const listeners=[['pointerdown',down],['pointermove',move],['pointerup',up],['pointercancel',lost],['lostpointercapture',lost],['pointerleave',leave],['keydown',key]];
 button.addEventListener('click',toggle);for(const [name,fn]of listeners)stage.addEventListener(name,fn);document.addEventListener('visibilitychange',visibility);document.addEventListener('keydown',escape);refresh();
 return {refresh,invalidate:()=>cancel(),close(){cancel();button.removeEventListener('click',toggle);for(const [name,fn]of listeners)stage.removeEventListener(name,fn);document.removeEventListener('visibilitychange',visibility);document.removeEventListener('keydown',escape);}};
}
