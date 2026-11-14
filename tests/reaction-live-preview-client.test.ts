// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';

const html = readFileSync('listener-reactions.html', 'utf8');

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.head.replaceChildren();
  document.body.replaceChildren();
  delete document.body.dataset.page;
});

it.each([
  ['youtube', 'aBcdEFg-Hi1', 200, 'https://www.youtube.com/embed/aBcdEFg-Hi1?playsinline=1&autoplay=1&mute=1'],
])('switches between video and still image for %s', async (provider, id, minimum, src) => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  const page = new DOMParser().parseFromString(html, 'text/html');
  document.head.innerHTML = `<meta name="casmate-preview" data-mode="${provider}" data-id="${id}">`;
  document.body.dataset.page = 'listener';
  document.body.innerHTML = page.body.innerHTML;
  let width = 640;
  let resize = () => {};
  vi.spyOn(document.querySelector('#screen-section')!, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 0, width, 0));
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: () => void) {}
    observe(element: Element) { if (element.id === 'screen-section') resize = this.callback; }
  });
  const frameSignals: AbortSignal[] = [];
  if (!HTMLImageElement.prototype.decode) Object.defineProperty(HTMLImageElement.prototype, 'decode', {value: () => Promise.resolve(), configurable: true});
  vi.spyOn(HTMLImageElement.prototype, 'decode').mockResolvedValue(undefined);
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:frame');
    static revokeObjectURL = vi.fn();
  });
  let holdFrame = false;
  const fetch = vi.fn(async (url: string, { signal }: RequestInit) => {
    if (url === '/preview') return {ok:true,status:200,json:async()=>({mode:provider,id})};
    if (url === '/react') return { ok: true, status: 200, json: async () => ({}) };
    if (url === '/frame.jpg') return {ok: true, blob: async () => new Blob(['image'])};
    if (signal) frameSignals.push(signal);
    if (holdFrame) return new Promise<never>((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
    return { ok: true, status: 200, json: async () => ({id: 'frame', generation: 1, canvasWidth: 1920, canvasHeight: 1080, validForMs: 12000, url: '/frame.jpg', capturedAt: Date.now()}) };
  });
  vi.stubGlobal('fetch', fetch);
  await import('../src/renderer/reactions/client/app.mjs');

  const getFrame = () => document.querySelector('iframe');
  const still = document.querySelector<HTMLElement>('#still-preview')!;
  const select = (mode: string) => document.querySelector<HTMLButtonElement>(`[data-preview-view="${mode}"]`)!.click();
  expect(document.querySelector('[data-preview-view="both"]')).toBeNull();
  const firstPlayer = getFrame();
  expect(firstPlayer?.src).toBe(src);
  expect(firstPlayer?.allow).toContain('autoplay');
  expect(firstPlayer?.referrerPolicy).toBe('strict-origin-when-cross-origin');
  expect(still.hidden).toBe(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/frame']);
  expect(document.querySelector('#screen-stage')?.parentElement?.id).toBe('live-preview');

  document.querySelector<HTMLButtonElement>('[data-kind="heart"]')!.click();
  await vi.advanceTimersByTimeAsync(800);
  expect(fetch.mock.calls.filter(([url]) => url !== '/frame' && url !== '/preview').map(([url]) => url)).toEqual(['/react']);

  select('still');
  expect(getFrame()).toBeNull();
  expect(still.hidden).toBe(false);
  await vi.advanceTimersByTimeAsync(0);
  expect(fetch.mock.calls.at(-1)?.[0]).toBe('/frame.jpg');

  select('live');
  expect(getFrame()).not.toBeNull();
  expect(still.hidden).toBe(true);
  await vi.advanceTimersByTimeAsync(0);
  const jpegCount = fetch.mock.calls.filter(([url]) => url === '/frame.jpg').length;
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetch.mock.calls.filter(([url]) => url === '/frame.jpg')).toHaveLength(jpegCount);

  const link = document.querySelector<HTMLAnchorElement>('#live-preview-link')!;
  const liveMode = document.querySelector<HTMLButtonElement>('[data-preview-view="live"]')!;
  const stage = document.querySelector<HTMLElement>('#screen-stage')!;
  liveMode.focus();
  holdFrame = true;
  width = minimum - 0.25;
  resize();
  expect(getFrame()).toBeNull();
  expect(still.hidden).toBe(false);
  expect(link.hidden).toBe(false);
  expect(document.activeElement).toBe(link);
  const fallbackRequest = frameSignals.at(-1)!;
  const fallbackRequestCount = frameSignals.length;

  stage.focus();
  for (let pulse = 0; pulse < 3; pulse++) {
    width = minimum;
    resize();
    await vi.advanceTimersByTimeAsync(50);
    expect(getFrame()).toBeNull();
    expect(still.hidden).toBe(false);
    width = minimum - 0.25;
    resize();
    await vi.advanceTimersByTimeAsync(50);
  }
  expect(fallbackRequest.aborted).toBe(false);
  expect(frameSignals).toHaveLength(fallbackRequestCount);
  expect(document.activeElement).toBe(stage);

  width = minimum;
  resize();
  await vi.advanceTimersByTimeAsync(199);
  width = minimum - 0.25; // The observer has not delivered this change yet.
  await vi.advanceTimersByTimeAsync(1);
  expect(getFrame()).toBeNull();

  width = minimum;
  resize();
  await vi.advanceTimersByTimeAsync(199);
  expect(getFrame()).toBeNull();
  await vi.advanceTimersByTimeAsync(1);
  expect(getFrame()?.src).toBe(src);
  expect(still.hidden).toBe(true);
  expect(fallbackRequest.aborted).toBe(true);
  expect(document.activeElement).toBe(link);

  const restoredPlayer = getFrame();
  width = minimum;
  resize();
  await vi.advanceTimersByTimeAsync(250);
  expect(getFrame()).toBe(restoredPlayer);
});


it.each([['twitch', 'Twitch', 400], ['youtube', 'YouTube Live', 200]])('places the %s input surface over the same player and restores still mode on narrow screens', async (mode, label, minimum) => {
 vi.resetModules();vi.useFakeTimers();
 document.body.innerHTML=new DOMParser().parseFromString(html,'text/html').body.innerHTML;
 let width=640;let resize=()=>{};
 vi.spyOn(document.querySelector('#screen-section')!, 'getBoundingClientRect').mockImplementation(()=>new DOMRect(0,0,width,360));
 vi.stubGlobal('ResizeObserver',class{constructor(callback:()=>void){resize=callback;}observe(){}});
 const {setupLivePreview}=await import('../src/renderer/reactions/client/live-preview.mjs');
 const enable=vi.fn(), metadata=vi.fn(), cancel=vi.fn();
 const control=setupLivePreview({mode,label,minWidth:minimum,link:'https://example.com/watch',src:'https://example.com/player'},enable,{setMetadataOnly:metadata,cancel});
 const player=document.querySelector('#live-preview')!, stage=document.querySelector('#screen-stage')!, toggle=document.querySelector<HTMLButtonElement>('#player-controls-toggle')!;
 const iframe=player.querySelector('iframe');
 expect(stage.parentElement).toBe(player);expect(metadata).toHaveBeenLastCalledWith(true);expect(enable).toHaveBeenLastCalledWith(true);
 expect(toggle.textContent).toBe('映像の操作');expect(toggle.getAttribute('aria-pressed')).toBe('true');
 document.querySelector('#point-tool')!.setAttribute('aria-pressed','true');await Promise.resolve();
 expect(toggle.getAttribute('aria-pressed')).toBe('false');expect(stage.getAttribute('data-active')).toBe('true');
 document.querySelector('#point-tool')!.setAttribute('aria-pressed','false');await Promise.resolve();expect(stage.getAttribute('data-active')).toBe('false');
 expect(player.querySelector('iframe')).toBe(iframe);
 document.querySelector<HTMLButtonElement>('[data-preview-view="still"]')!.click();
 expect(player.getAttribute('data-controls')).toBe('true');expect(player.querySelector('iframe')).toBeNull();
 document.querySelector<HTMLButtonElement>('[data-preview-view="live"]')!.click();
 toggle.click();expect(toggle.getAttribute('aria-pressed')).toBe('false');expect(cancel).toHaveBeenCalled();
 stage.setAttribute('tabindex','0');(stage as HTMLElement).focus();width=Number(minimum)-.25;resize();expect(document.activeElement?.id).toBe('live-preview-link');expect(player.querySelector('iframe')).toBeNull();expect(stage.parentElement?.id).toBe('still-preview');expect(metadata).toHaveBeenLastCalledWith(false);
 width=Number(minimum);resize();await vi.advanceTimersByTimeAsync(200);expect(stage.parentElement).toBe(player);expect(metadata).toHaveBeenLastCalledWith(true);
 control.update(null);expect(stage.parentElement?.id).toBe('still-preview');expect(player.querySelector('iframe')).toBeNull();expect(metadata).toHaveBeenLastCalledWith(false);
 const next={mode:'youtube',label:'YouTube Live',minWidth:200,link:'https://www.youtube.com/watch?v=abcdefghijk',src:'https://www.youtube.com/embed/abcdefghijk'};
 control.update(next);expect(stage.parentElement).toBe(player);const changed=player.querySelector('iframe');expect(changed?.src).toBe(next.src);
 control.update(next);expect(player.querySelector('iframe')).toBe(changed);
 changed?.focus();control.update(null);expect(document.activeElement).toBe(stage);
});
