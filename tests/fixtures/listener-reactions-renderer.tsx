import type { ManagementThemeId } from '../../src/shared/management-theme';
import type { ManagementTextSizeId } from '../../src/shared/management-text-size';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ListenerReactionsPanel } from '../../src/renderer/components/ListenerReactionsPanel';
import { ManagementShell } from '../../src/renderer/components/ManagementShell';
import { defaultReactionSettings, validReactionSettings, validReactionPreviewSettings, type ReactionManagementSnapshot } from '../../src/shared/listener-reactions';
import '../../src/renderer/styles.css';
import pointStyle from '../../src/renderer/reactions/point.css?raw';
import listenerStyle from '../../src/renderer/reactions/client/style.css?raw';
import overlayStyle from '../../src/renderer/reactions/overlay.css?raw';
import { placeMarker } from '../../src/renderer/reactions/client/pointing.mjs';
declare global { interface Window { reactionMarkerFrames(): Promise<Array<{intent:string;age:number;fade:number;radius:number;progress:number;stroke:number;waveOpacity:number;clusterTransform:string;bubbleTransform:string}>> } }
window.reactionMarkerFrames=async()=>{
  const frame=document.createElement('iframe');frame.style.cssText='width:736px;height:400px;border:0';
  const ready=new Promise<void>(resolve=>{frame.onload=()=>resolve();});frame.srcdoc=`<style>body{margin:0}${pointStyle}.local-markers{position:absolute;inset:0}</style><div class="local-markers"></div>`;document.body.append(frame);await ready;
  const layer=frame.contentDocument!.querySelector<HTMLDivElement>('div')!;
  const clock=Object.getOwnPropertyDescriptor(performance,'now'),request=window.requestAnimationFrame,cancel=window.cancelAnimationFrame;
  let now=0,serial=0;const queue=new Map<number,FrameRequestCallback>(),result=[];
  Object.defineProperty(performance,'now',{configurable:true,value:()=>now});
  window.requestAnimationFrame=callback=>{queue.set(++serial,callback);return serial;};window.cancelAnimationFrame=id=>{queue.delete(id);};
  try{
    for(const intent of ['look','question','danger'] as const){
      now=0;const marker=placeMarker(layer,.5,.5,1920,{intent});
      for(const age of [0,120,300,430,650,880,1000,2850,3090,3330]){
        now=age;const callbacks=[...queue.values()];queue.clear();callbacks.forEach(callback=>callback(now));
        const ring=marker.querySelector('.point-ring')!,wave=marker.querySelector('.point-wave')!,label=marker.querySelector<HTMLElement>('.point-label')!,body=marker.querySelector<HTMLElement>('.point-label-body')!;
        result.push({intent,age,fade:Number(label.style.opacity),radius:Number(ring.getAttribute('r')),progress:1-Number(ring.getAttribute('stroke-dashoffset'))/Number(ring.getAttribute('stroke-dasharray')),stroke:Number(ring.getAttribute('stroke-width')),waveOpacity:Number(wave.getAttribute('opacity')),clusterTransform:label.style.transform,bubbleTransform:body.style.transform});
      }
      marker.remove();await Promise.resolve();
    }
  }finally{
    if(clock)Object.defineProperty(performance,'now',clock);else Reflect.deleteProperty(performance,'now');
    window.requestAnimationFrame=request;window.cancelAnimationFrame=cancel;frame.remove();
  }
  return result;
};
declare global { interface Window { reactionLayoutUpdate(theme: ManagementThemeId, textSize: ManagementTextSizeId): void; reactionRangePreview(generation?: number): void; reactionDesktopState(state: 'stopped' | 'showing' | 'confirmation' | 'scene'): void; reactionMarkerComparison(): Promise<Array<{ width: number; font: number; dot: number; label: number; canvas: number }>>; reactionFinishPreviewSave(error?: string): void } }
window.reactionMarkerComparison=async()=>{
  const result=[];
  for(const [width,canvas,listener] of [[640,1920,true],[960,1920,false],[320,1920,true],[640,1460,false]] as const){
    const frame=document.createElement('iframe');frame.style.width=`${width}px`;frame.style.height='360px';frame.style.border='0';
    const ready=new Promise<void>(resolve=>{frame.onload=()=>resolve();});frame.srcdoc=`<style>*{box-sizing:border-box}${pointStyle}${listener?listenerStyle:overlayStyle}</style><div class="${listener?'local-markers':'reaction-markers'}"></div>`;document.body.append(frame);await ready;
    const layer=frame.contentDocument!.querySelector<HTMLDivElement>('div')!;placeMarker(layer,.5,.5,canvas,{duration:0,variant:'marker-preview'});
    for(const node of layer.querySelectorAll('.point-dot,.point-label'))(node as HTMLElement).style.animation='none';
    const dot=layer.querySelector<HTMLElement>('.point-dot')!,label=layer.querySelector<HTMLElement>('.point-label')!;
    result.push({width:layer.getBoundingClientRect().width,canvas,font:parseFloat(frame.contentWindow!.getComputedStyle(label).fontSize),dot:dot.getBoundingClientRect().width,label:label.getBoundingClientRect().width});frame.remove();
  }return result;
};
const data: ReactionManagementSnapshot={instance:'fixture',revision:1,available:true,error:null,settings:defaultReactionSettings(),windows:[],selectedId:'',frame:null,generation:0,publication:{status:'off',url:null,message:''},desktop:{enabled:false,showing:false,message:''}};
let finishPreviewSave: ((error: string) => void) | null = null;
window.reactionFinishPreviewSave = (error = '') => {
  if (!finishPreviewSave) throw new Error('映像設定の保存が始まっていません。');
  finishPreviewSave(error);
  finishPreviewSave = null;
};
window.reactionRangePreview=(generation)=>{
  if (generation !== undefined) data.generation=generation;
  data.revision++;
  data.frame={id:generation === undefined ? 'preview' : `preview-fixed-${generation}`,capturedAt:Date.now(),validForMs:12000,
    width:640,height:360,canvasWidth:1920,canvasHeight:1080,generation:data.generation,url:'/frame.jpg'};
};
window.reactionDesktopState=state=>{
  data.revision++;
  data.desktop=state==='confirmation'
    ? {enabled:false,showing:false,resume:'confirmation',message:'設定は保存されています。映像の対応範囲が変わりました。赤枠を確認してPC表示を再開してください。'.repeat(4)}
    : state==='scene' ? {enabled:false,showing:false,resume:'scene',message:'このシーンではPC表示を一時停止しています。次のシーンで範囲を再判定します。'}
    : {enabled:state==='showing',showing:state==='showing',message:''};
};
const request=async(action?:string,body?:unknown)=>{
  if(action==='publish'){data.publication={status:'online',url:'https://aaaaaaaaaaaaaaaaaaaaaaaaaa.srv.us/',message:''};data.revision++;}
  if(action==='settings'){
    if(!validReactionSettings(body))throw new Error('設定が不正です。');
    data.settings=structuredClone(body);
    data.revision++;
  }
  if (action === 'preview-settings') {
    if (!validReactionPreviewSettings(body)) throw new Error('映像設定が不正です。');
    const failure = await new Promise<string>(resolve => { finishPreviewSave = resolve; });
    if (failure) throw new Error(failure);
    data.settings.preview = structuredClone(body);
    data.revision++;
  }
  if(action==='start')throw new Error('失敗した場合にも操作位置を維持するための十分に長いエラーメッセージです。'.repeat(5));
  if(action==='stop')window.reactionDesktopState('stopped');
  const snapshot=structuredClone(data);
  if(snapshot.frame?.id === 'preview') {
    const capturedAt=Date.now();
    snapshot.frame={...snapshot.frame,id:`preview-${Math.floor(capturedAt/500)}`,capturedAt};
  }
  return snapshot;
};
const root=createRoot(document.getElementById('root')!);
window.reactionLayoutUpdate=(theme,textSize)=>flushSync(()=>root.render(<ManagementShell theme={theme} textSize={textSize} home={null} connected pcStatus={null} windows={null} warnings={[]} activities={[]}><ListenerReactionsPanel request={request} image={async()=>new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#29434e"/></svg>'],{type:'image/svg+xml'})} onNotice={()=>undefined} onRegisterSource={()=>undefined}/></ManagementShell>));
window.reactionLayoutUpdate('ocean','medium');
