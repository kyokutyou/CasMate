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

async function fixture(validForMs = 12000) {
  vi.resetModules();
  vi.useFakeTimers();
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  document.head.innerHTML = '<meta name="casmate-preview" data-mode="youtube" data-id="aBcdEFg-Hi1">';
  document.body.dataset.page = 'listener';
  document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
  const section = document.querySelector<HTMLElement>('#screen-section')!;
  const player = document.querySelector<HTMLElement>('#live-preview')!;
  const stage = document.querySelector<HTMLElement>('#screen-stage')!;
  vi.spyOn(section, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 640, 360));
  vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 50, 640, 360));
  Object.defineProperties(player, {clientWidth: {value: 640}, clientHeight: {value: 360}});
  vi.stubGlobal('ResizeObserver', class { observe() {} });
  const payloads: Array<Record<string, unknown>> = [];
  let metadataReads = 0;
  const fetch = vi.fn(async (url: string, options: RequestInit) => {
    if (url === '/react') {
      payloads.push(JSON.parse(String(options.body)));
      return {ok: true, status: 200, json: async () => ({at: Date.now()})};
    }
    if (++metadataReads > 1 && validForMs < 12000) return new Promise<never>((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(options.signal?.reason), {once: true});
    });
    return {ok: true, status: 200, json: async () => ({id: 'youtube-frame', generation: 1, instance: 'server', canvasWidth: 1920, canvasHeight: 1080, validForMs, url: '/unused.jpg', capturedAt: Date.now()})};
  });
  vi.stubGlobal('fetch', fetch);
  await import('../src/renderer/reactions/client/app.mjs');
  await vi.advanceTimersByTimeAsync(0);
  const tool = (id: string) => document.querySelector<HTMLButtonElement>(`#${id}-tool`)!;
  const key = (value: string) => stage.dispatchEvent(new KeyboardEvent('keydown', {key: value, bubbles: true, cancelable: true}));
  const pointer = (type: string, x: number, y: number) => {
    const event = new MouseEvent(type, {button: 0, clientX: x, clientY: y, bubbles: true, cancelable: true});
    Object.defineProperties(event, {pointerId: {value: 1}, isPrimary: {value: true}});
    stage.dispatchEvent(event);
  };
  return {player, stage, fetch, payloads, tool, key, pointer};
}

it('sends a point and both area shapes from the YouTube player without fetching JPEG or replacing the player', async () => {
  const f = await fixture();
  const iframe = f.player.querySelector('iframe');
  const toggle = document.querySelector<HTMLButtonElement>('#player-controls-toggle')!;
  expect(iframe?.src).toBe('https://www.youtube.com/embed/aBcdEFg-Hi1?playsinline=1&autoplay=1&mute=1');
  expect(f.stage.parentElement).toBe(f.player);
  expect(toggle.hidden).toBe(false);
  expect(toggle.getAttribute('aria-pressed')).toBe('true');

  f.tool('point').click();
  await Promise.resolve();
  expect(toggle.getAttribute('aria-pressed')).toBe('false');
  expect(f.player.dataset.controls).toBe('false');
  expect(iframe?.tabIndex).toBe(-1);
  f.stage.dispatchEvent(new MouseEvent('click', {clientX: 420, clientY: 230, bubbles: true}));
  await vi.advanceTimersByTimeAsync(800);
  expect(f.payloads).toEqual([{kind: 'point', intent:'look', frameId: 'youtube-frame', x: .5, y: .5}]);
  expect(document.querySelector('#status')?.textContent).toBe('場所を送りました');
  expect(toggle.getAttribute('aria-pressed')).toBe('false');

  f.tool('ellipse').click();
  expect(f.stage.querySelector('.range-cursor')).toBeNull();
  f.pointer('pointerdown', 228, 122);
  f.pointer('pointermove', 612, 338);
  f.pointer('pointerup', 612, 338);
  await vi.advanceTimersByTimeAsync(800);
  expect(f.payloads[1]).toMatchObject({kind: 'area', shape: 'ellipse', frameId: 'youtube-frame', area: {x: .2, y: .2}});
  expect(f.payloads[1].area).toEqual({x: .2, y: .2, width: expect.closeTo(.6), height: expect.closeTo(.6)});
  expect(document.querySelector('#status')?.textContent).toBe('範囲を送りました');

  f.tool('rectangle').click();
  f.key('Enter'); f.key('ArrowRight'); f.key('ArrowDown'); f.key('Enter');
  await vi.advanceTimersByTimeAsync(800);
  expect(f.payloads[2]).toMatchObject({kind: 'area', shape: 'rectangle', frameId: 'youtube-frame'});
  expect(f.player.querySelector('iframe')).toBe(iframe);
  expect(f.fetch.mock.calls.every(([url]) => url === '/frame' || url === '/react' || url === '/preview')).toBe(true);
});

it('cancels an unfinished YouTube circle when metadata expires and prevents a late release from submitting', async () => {
  const f = await fixture(1000);
  f.tool('ellipse').click();
  f.pointer('pointerdown', 228, 122);
  f.pointer('pointermove', 612, 338);
  await vi.advanceTimersByTimeAsync(1000);
  f.pointer('pointerup', 612, 338);
  expect(f.payloads).toEqual([]);
  expect(f.tool('point').disabled).toBe(true);
  expect(f.tool('ellipse').disabled).toBe(true);
  expect(f.tool('rectangle').disabled).toBe(true);
  expect(f.stage.querySelector('.range-preview')).toBeNull();
  expect(f.fetch.mock.calls.every(([url]) => url === '/frame')).toBe(true);
});

it.each(['controls', 'still'])('cancels an unfinished circle when switching %s without submitting on release', async change => {
  const f = await fixture();
  const iframe = f.player.querySelector('iframe');
  f.tool('ellipse').click();
  await Promise.resolve();
  f.pointer('pointerdown', 228, 122);
  f.pointer('pointermove', 612, 338);
  const selector = change === 'controls' ? '#player-controls-toggle' : `[data-preview-view="${change}"]`;
  document.querySelector<HTMLButtonElement>(selector)!.click();
  await vi.advanceTimersByTimeAsync(0);
  f.pointer('pointerup', 612, 338);
  expect(f.payloads).toEqual([]);
  expect(f.tool('ellipse').getAttribute('aria-pressed')).toBe('false');
  if (change === 'still') expect(iframe?.isConnected).toBe(false);
  else expect(f.player.querySelector('iframe')).toBe(iframe);
  if (change === 'controls') expect(f.player.dataset.controls).toBe('true');
});

it.each(['point','question','danger','ellipse'])('cancels an armed %s on width changes and ignores a late placement', async kind => {
  const f=await fixture(),iframe=f.player.querySelector('iframe');
  const toggle=document.querySelector<HTMLButtonElement>('#preview-width-toggle')!;
  try {
    f.tool(kind).click();await Promise.resolve();
    if(kind==='ellipse'){f.pointer('pointerdown',228,122);f.pointer('pointermove',612,338);}
    toggle.click();await vi.advanceTimersByTimeAsync(0);
    expect(document.body.classList.contains('preview-wide')).toBe(true);
    f.pointer('pointerup',612,338);f.stage.dispatchEvent(new MouseEvent('click',{clientX:420,clientY:230,bubbles:true}));f.key('Enter');
    await vi.advanceTimersByTimeAsync(0);
    expect(f.payloads).toEqual([]);expect(f.tool(kind).getAttribute('aria-pressed')).toBe('false');
    expect(f.player.querySelector('iframe')).toBe(iframe);
    toggle.click();expect(document.body.classList.contains('preview-wide')).toBe(false);
    f.tool('point').click();f.stage.dispatchEvent(new MouseEvent('click',{clientX:420,clientY:230,bubbles:true}));
    await vi.advanceTimersByTimeAsync(0);
    expect(f.payloads).toEqual([{kind:'point',intent:'look',frameId:'youtube-frame',x:.5,y:.5}]);
  } finally {document.body.classList.remove('preview-wide');}
});
it.each(['question','danger'])('previews %s locally over video and sends it only after confirmation',async intent=>{
 const f=await fixture(),iframe=f.player.querySelector('iframe');
 f.tool(intent).click();await Promise.resolve();f.pointer('pointermove',420,230);
 expect(f.payloads).toEqual([]);expect(f.stage.querySelector<HTMLElement>('.marker-preview')?.dataset.intent).toBe(intent);
 f.stage.dispatchEvent(new MouseEvent('click',{clientX:420,clientY:230,bubbles:true}));await vi.advanceTimersByTimeAsync(0);
 expect(f.payloads).toEqual([{kind:'point',intent,frameId:'youtube-frame',x:.5,y:.5}]);
 expect(f.player.querySelector('iframe')).toBe(iframe);expect(f.fetch.mock.calls.every(([url])=>url==='/frame'||url==='/react')).toBe(true);
});
