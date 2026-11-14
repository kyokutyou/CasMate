// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {watchPreviewSettings} from '../src/renderer/reactions/client/preview-settings.mjs';
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});
it('polls committed settings, preserves display on errors and pauses while hidden',async()=>{
  vi.useFakeTimers();let hidden=false;
  vi.spyOn(document,'hidden','get').mockImplementation(()=>hidden);
  const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>({mode:'youtube',id:'abcdefghijk'})});
  vi.stubGlobal('fetch',fetcher);const update=vi.fn(),watch=watchPreviewSettings(update);
  try {
    await vi.advanceTimersByTimeAsync(2000);expect(update).toHaveBeenCalledWith({mode:'youtube',id:'abcdefghijk'});
    fetcher.mockRejectedValueOnce(Error('offline'));await vi.advanceTimersByTimeAsync(2000);expect(update).toHaveBeenCalledTimes(1);
    hidden=true;document.dispatchEvent(new Event('visibilitychange'));await vi.advanceTimersByTimeAsync(2000);expect(fetcher).toHaveBeenCalledTimes(2);
    hidden=false;document.dispatchEvent(new Event('visibilitychange'));await vi.advanceTimersByTimeAsync(0);expect(update).toHaveBeenCalledTimes(2);
  }finally{watch.close();}
});
it('ignores a late body after timeout and resumes polling without overlapping requests',async()=>{
  vi.useFakeTimers();vi.spyOn(document,'hidden','get').mockReturnValue(false);
  let finish!:(value:unknown)=>void;
  const fetcher=vi.fn().mockResolvedValueOnce({ok:true,json:()=>new Promise(resolve=>{finish=resolve;})})
    .mockResolvedValue({ok:true,json:async()=>({mode:'twitch',id:'newcaster'})});
  vi.stubGlobal('fetch',fetcher);const update=vi.fn(),watch=watchPreviewSettings(update);
  try {
    await vi.advanceTimersByTimeAsync(6000);expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
    finish({mode:'youtube',id:'abcdefghijk'});await vi.advanceTimersByTimeAsync(0);expect(update).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);expect(update).toHaveBeenCalledWith({mode:'twitch',id:'newcaster'});
  }finally{watch.close();}
});
it('ignores a response cancelled by backgrounding and never updates after close',async()=>{
  vi.useFakeTimers();let hidden=false;
  vi.spyOn(document,'hidden','get').mockImplementation(()=>hidden);
  let finish!:(value:unknown)=>void;
  const fetcher=vi.fn().mockResolvedValue({ok:true,json:()=>new Promise(resolve=>{finish=resolve;})});
  vi.stubGlobal('fetch',fetcher);const update=vi.fn(),watch=watchPreviewSettings(update);
  await vi.advanceTimersByTimeAsync(2000);
  hidden=true;document.dispatchEvent(new Event('visibilitychange'));
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  hidden=false;document.dispatchEvent(new Event('visibilitychange'));
  finish({mode:'youtube',id:'abcdefghijk'});await vi.advanceTimersByTimeAsync(0);expect(update).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(2000);watch.close();
  finish({mode:'twitch',id:'caster'});await vi.advanceTimersByTimeAsync(4000);
  expect(update).not.toHaveBeenCalled();expect(fetcher).toHaveBeenCalledTimes(2);
});
