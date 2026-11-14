import { validArrowPoint } from '../../../shared/reaction-arrow.ts';
import { drawArrowFrame } from './arrow-scene.mjs';
import './arrow.css';

const players=new WeakMap();
// Work in the sample's 736px reference space so click geometry stays identical
// across differently sized listener, OBS and desktop surfaces.
export function shortArrow(to,width=736,height=414){
 const W=736,H=736*height/width,end={x:to.x*W,y:to.y*H};
 const v={x:end.x>W*.35?.87:-.87,y:end.y<H*.68?-.5:.5},norm=Math.hypot(v.x,v.y);v.x/=norm;v.y/=norm;
 const mx=Math.min(14,W/4),my=Math.min(48,H/4),mb=Math.min(36,H/4);
 const available=[v.x>0?(end.x-mx)/v.x:(W-mx-end.x)/-v.x,v.y>0?(end.y-my)/v.y:(H-mb-end.y)/-v.y];
 const length=Math.max(8,Math.min(112,W*.36,...available));
 const from={x:Math.max(0,Math.min(1,(end.x-v.x*length)/W)),y:Math.max(0,Math.min(1,(end.y-v.y*length)/H))};
 return {from,to:{...to}};
}
export function moveArrow(node,from,to){players.get(node)?.move(from,to);}
export function placeArrow(container,from,to,{age=0,duration=4000-age,variant='',clip=null}={}){
 if(!validArrowPoint(from)||!validArrowPoint(to)||from.x===to.x&&from.y===to.y||!Number.isFinite(age)||age<0||age>=4000)return null;
 if(!variant){const accepted=[...container.querySelectorAll(':scope > .arrow-marker:not(.arrow-preview,.arrow-pending)')];while(accepted.length>=10)accepted.shift().remove();}
 const root=document.createElement('div');root.className='arrow-marker'+(variant?' '+variant:'');
 if(clip)root.style.clipPath=`inset(${clip.y*100}% ${(1-clip.x-clip.width)*100}% ${(1-clip.y-clip.height)*100}% ${clip.x*100}%)`;
 const view=document.createElement('div');view.className='arrow-view';
 const canvas=document.createElement('canvas'),label=document.createElement('span');label.className='arrow-label';
 view.append(canvas,label);root.append(view);container.append(root);
 const c=canvas.getContext('2d');if(!c){root.remove();return null;}
 const reduced=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)'),staticPreview=!!variant;
 let W=736,H=414,dpr=1,raf=0,timer=0,disposed=false;
 const began=performance.now(),fixed=duration===0||staticPreview;
 const draw=()=>{if(disposed)return;drawArrowFrame(c,label,root,from,to,W,H,age+(fixed?0:performance.now()-began),{preview:staticPreview,reducedMotion:!!reduced?.matches,dpr});};
 const resize=()=>{
  const r=container.getBoundingClientRect(),width=r.width||736,height=r.height||width*9/16;H=736*height/width;
  // Bound each backing store even for very large OBS canvases.
  dpr=Math.min((globalThis.devicePixelRatio||1)*width/W,2048/W,Math.sqrt(1048576/(W*H)));
  canvas.width=Math.max(1,Math.round(W*dpr));canvas.height=Math.max(1,Math.round(H*dpr));
  canvas.style.width=W+'px';canvas.style.height=H+'px';view.style.width=W+'px';view.style.height=H+'px';view.style.transform=`scale(${width/W})`;draw();
 };
 const dispose=()=>{if(disposed)return;disposed=true;cancelAnimationFrame(raf);clearTimeout(timer);observer.disconnect();resizeObserver.disconnect();reduced?.removeEventListener?.('change',changed);players.delete(root);};
 const observer=new MutationObserver(()=>{if(!root.isConnected)dispose();});
 const resizeObserver=new ResizeObserver(resize);
 const changed=()=>{cancelAnimationFrame(raf);draw();if(!fixed&&!reduced?.matches)raf=requestAnimationFrame(tick);};
 const tick=()=>{if(!root.isConnected){dispose();return;}draw();if(!fixed&&!reduced?.matches)raf=requestAnimationFrame(tick);};
 players.set(root,{move(a,b){if(validArrowPoint(a)&&validArrowPoint(b)){from={...a};to={...b};draw();}}});
 observer.observe(container,{childList:true});resizeObserver.observe(container);reduced?.addEventListener?.('change',changed);resize();
 if(!fixed&&!reduced?.matches)raf=requestAnimationFrame(tick);
 if(duration>0)timer=setTimeout(()=>{root.remove();dispose();},duration);
 return root;
}
