// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import {afterEach,expect,it,vi} from 'vitest';
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();document.head.replaceChildren();document.body.replaceChildren();delete document.body.dataset.page;});
it('places the result above the preview beside the video selection and keeps the complete controls',()=>{
  const page=new DOMParser().parseFromString(readFileSync('listener-reactions.html','utf8'),'text/html');
  const toolbar=page.querySelector('.preview-toolbar')!;
  expect(toolbar.querySelector('.reaction-feedback')).not.toBeNull();
  expect(toolbar.querySelector('#live-preview-modes')).not.toBeNull();
  expect(toolbar.compareDocumentPosition(page.querySelector('#still-preview')!) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  expect(page.querySelector('#status')?.textContent).toBe('リアクションを送れます');
  expect(page.querySelector('#status')?.getAttribute('tabindex')).toBe('0');
  expect(page.querySelectorAll('.point-toolbar button')).toHaveLength(6);
  expect(page.querySelector('#cheer-hold')?.textContent).toContain('最大10秒');
  expect(page.querySelector('.listener-help summary')?.textContent).toBe('使い方');
  expect(page.querySelector('.listener-help')?.textContent).toContain('受付の確認');
});
it('keeps feelings available without an image, serializes requests, recovers from errors and bounds cheering',async()=>{
  vi.resetModules();vi.useFakeTimers();vi.spyOn(document,'hidden','get').mockReturnValue(false);
  vi.stubGlobal('ResizeObserver',class{observe(){}});
  document.body.dataset.page='listener';
  document.body.innerHTML=new DOMParser().parseFromString(readFileSync('listener-reactions.html','utf8'),'text/html').body.innerHTML;
  const payloads:Array<{kind:string}>=[];
  type Reply={ok:boolean;status:number;json:()=>Promise<object>};
  let finish!:(reply:Reply)=>void,first=true,status=200,badJson=false;
  vi.stubGlobal('fetch',vi.fn(async(url:string,options:RequestInit)=>{
    if(url==='/frame')return {ok:false,status:503};
    if(url==='/preview')return {ok:true,json:async()=>({mode:'obs',id:''})};
    if(url!=='/react')throw Error('Unexpected request');
    payloads.push(JSON.parse(String(options.body)));
    if(first){first=false;return new Promise<Reply>(resolve=>{finish=resolve;});}
    return {ok:status===200,status,json:async()=>{if(badJson)throw Error('invalid response');return status===200?{}:{message:'送信を拒否しました。'};}};
  }));
  await import('../src/renderer/reactions/client/app.mjs');await vi.advanceTimersByTimeAsync(0);
  const result=document.querySelector<HTMLElement>('#status')!;
  Object.defineProperties(result,{clientHeight:{value:30,configurable:true},scrollHeight:{value:300,configurable:true}});
  result.focus();
  const end=new KeyboardEvent('keydown',{key:'End',bubbles:true,cancelable:true});result.dispatchEvent(end);
  expect(end.defaultPrevented).toBe(true);expect(result.scrollTop).toBe(270);expect(document.activeElement).toBe(result);
  result.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true,cancelable:true}));expect(result.scrollTop).toBe(0);
  const modified=new KeyboardEvent('keydown',{key:'End',ctrlKey:true,bubbles:true,cancelable:true});result.dispatchEvent(modified);
  expect(modified.defaultPrevented).toBe(false);expect(result.scrollTop).toBe(0);
  Object.defineProperty(result,'scrollHeight',{value:30,configurable:true});
  const short=new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true});result.dispatchEvent(short);
  expect(short.defaultPrevented).toBe(false);expect(payloads).toHaveLength(0);
  const heart=document.querySelector<HTMLButtonElement>('[data-kind="heart"]')!,clap=document.querySelector<HTMLButtonElement>('[data-kind="clap"]')!;
  expect(document.querySelector<HTMLButtonElement>('#point-tool')!.disabled).toBe(true);
  heart.focus();heart.click();clap.click();expect(payloads).toEqual([{kind:'heart'}]);
  expect(document.activeElement).toBe(heart);expect(heart.getAttribute('aria-disabled')).toBe('true');
  finish({ok:true,status:200,json:async()=>({})});await vi.advanceTimersByTimeAsync(799);
  clap.click();expect(payloads).toHaveLength(1);await vi.advanceTimersByTimeAsync(1);
  status=500;clap.click();await vi.advanceTimersByTimeAsync(0);
  expect(document.querySelector('.reaction-feedback')?.getAttribute('data-state')).toBe('error');
  await vi.advanceTimersByTimeAsync(800);badJson=true;heart.click();await vi.advanceTimersByTimeAsync(0);
  expect(document.querySelector('.reaction-feedback')?.getAttribute('data-state')).toBe('unknown');
  await vi.advanceTimersByTimeAsync(800);expect(payloads).toHaveLength(3);
  status=200;badJson=false;heart.click();await vi.advanceTimersByTimeAsync(0);
  expect(document.querySelector('#status')?.textContent).toBe('ハートを送りました');
  await vi.advanceTimersByTimeAsync(800);
  const cheer=document.querySelector<HTMLButtonElement>('#cheer-hold')!;
  cheer.focus();cheer.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
  await vi.advanceTimersByTimeAsync(10000);
  expect(payloads.filter(payload=>payload.kind==='cheer')).toHaveLength(10);
  expect(cheer.getAttribute('aria-pressed')).toBe('false');expect(document.querySelector('#hold-hint')?.textContent).toContain('10秒');
  await vi.advanceTimersByTimeAsync(2000);expect(payloads).toHaveLength(14);
  const stickers=[...document.querySelectorAll<HTMLButtonElement>('[data-kind="sticker"]')];
  expect(stickers.map(button=>button.dataset.sticker)).toEqual(['surprise','confused','agree','scared','safe','danger','thanks','cheers','rest']);
  for(const button of stickers){button.click();await vi.advanceTimersByTimeAsync(800);expect(payloads.at(-1)).toEqual({kind:'sticker',sticker:button.dataset.sticker});expect(document.querySelector('#status')?.textContent).toBe(`${button.textContent}を送りました`);}
});
