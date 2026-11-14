import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import type { ObsVisualReader } from '../src/main/obs/obs-visual';
import { ReactionFrames } from '../src/main/reactions/reaction-frames';

const imageData = `data:image/jpeg;base64,${readFileSync(new URL('./fixtures/obs-program-black.jpg', import.meta.url)).toString('base64')}`;
const program = (scene: string) => ({ scene, context: JSON.stringify(['main', scene, 32, 18]) });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

function fixture() {
  let scene = 'A';
  let wallTime = 100_000;
  let elapsed = 100;
  let afterCapture: (() => Promise<void>) | undefined;
  let screenshotDelay = 0;
  let imageTaken = false;
  const request: ObsVisualReader['request'] = async type => {
    switch (type) {
      case 'GetCurrentProgramScene': return { currentProgramSceneName: scene };
      case 'GetSceneCollectionList':
        if (imageTaken && afterCapture) {
          const wait = afterCapture;
          afterCapture = undefined;
          await wait();
        }
        return { currentSceneCollectionName: 'main' };
      case 'GetVideoSettings': return { baseWidth: 32, baseHeight: 18 };
      case 'GetVersion': return { supportedImageFormats: ['jpg'] };
      case 'GetSourceScreenshot':
        if (screenshotDelay) await new Promise(resolve => setTimeout(resolve, screenshotDelay));
        imageTaken = true;
        return { imageData };
      default: throw new Error(type);
    }
  };
  const frames = new ReactionFrames(() => ({ request, valid: () => true }), () => wallTime, () => elapsed);
  return {
    frames,
    switchTo: (next: string) => { scene = next; },
    holdImageVerification(wait: () => Promise<void>) { imageTaken = false; afterCapture = wait; },
    advance: (milliseconds: number) => { elapsed += milliseconds; },
    setWallTime: (time: number) => { wallTime = time; },
    delayScreenshot: (milliseconds: number) => { screenshotDelay = milliseconds; },
  };
}

function useCaptureTimers() {
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(milliseconds => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), milliseconds);
    return controller.signal;
  });
}

it.each([[5500, true], [9999, true], [10000, false], [10001, false]] as const)(
  'publishes a verified reaction screenshot delayed by %d ms within its own deadline', async (delay, accepted) => {
    useCaptureTimers();
    const f = fixture();
    f.delayScreenshot(delay);
    const capture = f.frames.tick();
    f.advance(delay);
    f.setWallTime(100_000 + delay);
    await vi.advanceTimersByTimeAsync(delay);
    await capture;
    if (accepted) {
      expect(f.frames.metadata()).toMatchObject({ capturedAt:100_000, validForMs:12000 - delay });
      expect(f.frames.latest()?.observedAt).toBe(100 + delay);
    } else expect(f.frames.metadata()).toBeNull();
  },
);

it('counts time spent verifying the screenshot against its image lifetime', async () => {
  const f = fixture();
  const pending = Promise.withResolvers<void>(), verifying = Promise.withResolvers<void>();
  f.holdImageVerification(() => { verifying.resolve(); return pending.promise; });
  const capture = f.frames.tick();
  await verifying.promise;
  f.advance(4500);
  f.setWallTime(104_500);
  pending.resolve();
  await capture;
  expect(f.frames.metadata()).toMatchObject({ capturedAt:100_000, validForMs:7500 });
  expect(f.frames.latestAt(4599)).toBeNull();
  expect(f.frames.latestAt(4600)).toBe(f.frames.latest());
});

it('discards an over-deadline reaction capture before the timeout callback has run', async () => {
  const f = fixture();
  const pending = Promise.withResolvers<void>(), verifying = Promise.withResolvers<void>();
  f.holdImageVerification(() => { verifying.resolve(); return pending.promise; });
  const capture = f.frames.tick();
  await verifying.promise;
  f.advance(10000);
  pending.resolve();
  await capture;
  expect(f.frames.metadata()).toBeNull();
});

it('discards a late image when the scene changed without a notification during capture', async () => {
  useCaptureTimers();
  const f = fixture();
  await f.frames.tick();
  const original = f.frames.latest();
  f.delayScreenshot(5500);
  const capture = f.frames.tick();
  await vi.advanceTimersByTimeAsync(2500);
  f.switchTo('B');
  f.advance(5500);
  await vi.advanceTimersByTimeAsync(3000);
  await capture;
  expect(f.frames.get(original!.metadata.id)).toBeNull();
  expect(f.frames.metadata()).toBeNull();
  f.delayScreenshot(0);
  await f.frames.tick();
  expect(f.frames.latest()?.scene).toBe('B');
});

it('ignores an old B query after a verified return to A in the same image generation', async () => {
  const { frames, switchTo } = fixture();
  await frames.tick();
  const generation = frames.generation;
  switchTo('B');
  const oldQuery = frames.beginProgramObservation();
  switchTo('A');
  await frames.tick();
  const latest = frames.latest();

  expect(frames.acceptProgramObservation(oldQuery, program('B'))).toBe(false);
  expect(frames.program).toEqual(program('A'));
  expect(frames.latest()).toBe(latest);
  expect(frames.generation).toBe(generation);

  switchTo('B');
  expect(frames.acceptProgramObservation(frames.beginProgramObservation(), program('B'))).toBe(true);
  expect(frames.latest()).toBeNull();
  expect(frames.generation).toBe(generation + 1);
});

it('rejects an old B image before changing history or notifying subscribers after a newer A query', async () => {
  const { frames, switchTo, holdImageVerification } = fixture();
  await frames.tick();
  const generation = frames.generation;
  const original = frames.latest();
  const notifications: Array<string | undefined> = [];
  frames.subscribe(() => { notifications.push(frames.latest()?.scene); });

  switchTo('B');
  const pending = Promise.withResolvers<void>();
  const verified = Promise.withResolvers<void>();
  holdImageVerification(() => { verified.resolve(); return pending.promise; });
  const oldImage = frames.tick();
  await verified.promise;
  switchTo('A');
  expect(frames.acceptProgramObservation(frames.beginProgramObservation(), program('A'))).toBe(true);
  pending.resolve();
  await oldImage;

  expect(frames.generation).toBe(generation);
  expect(frames.latest()).toBe(original);
  expect(notifications).toEqual([]);
  switchTo('B');
  await frames.tick();
  expect(frames.generation).toBe(generation + 1);
  expect(notifications).toEqual(['B']);
});

it('preserves public wall time and applies image expiry to monotonic time', async () => {
  const { frames, setWallTime, advance } = fixture();
  await frames.tick();
  const original = frames.latest();
  expect(original?.observedAt).toBe(100);
  expect(original?.metadata.capturedAt).toBe(100_000);

  setWallTime(1);
  advance(12_000);
  expect(frames.latest()).toBe(original);
  expect(frames.metadata()?.validForMs).toBe(0);
  advance(1);
  expect(frames.latest()).toBeNull();
});

it('retains a timely frame when a later image arrives before the deadline is processed', async () => {
  const { frames, advance } = fixture();
  await frames.tick();
  const timely = frames.latest();
  advance(1);
  await frames.tick();

  expect(frames.latestAt(100)).toBe(timely);
  expect(frames.latestAt(99)).toBeNull();
  expect(frames.latestAt(101)).toBe(frames.latest());
  frames.invalidate();
  expect(frames.latestAt(100)).toBeNull();
});
