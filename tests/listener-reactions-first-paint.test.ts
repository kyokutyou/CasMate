import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';
import { expect, it } from 'vitest';
import { ReactionController } from '../src/main/reactions/reaction-controller';
import { ReactionFrames } from '../src/main/reactions/reaction-frames';
import { ReactionPublicServer } from '../src/main/reactions/reaction-public-server';
import type { ObsVisualReader } from '../src/main/obs/obs-visual';
import { defaultReactionSettings } from '../src/shared/listener-reactions';
import { runElectronFixture } from './helpers/electron-fixture';

async function withPublicPage(run: (controller: ReactionController, directory: string, url: string) => Promise<void>, read: ObsVisualReader = {
  valid: () => false, request: async () => { throw new Error('OBS unavailable'); },
}) {
  const directory = await mkdtemp(join(tmpdir(), 'casmate-reaction-paint-'));
  const frames = new ReactionFrames(() => read);
  const controller = new ReactionController({ load: async () => defaultReactionSettings(), save: async () => undefined }, frames, () => read, {
    inventory: () => ({ windows: [], foreground: '', observedAt: Date.now() }),
    demand() {}, prepare: async () => undefined, render() {}, marker() {}, reaction() {}, clear() {}, close() {},
  });
  const server = new ReactionPublicServer(controller, directory);
  try {
    await controller.initialize();
    await build({ configFile: 'vite.reactions.config.mts', logLevel: 'silent', build: { outDir: directory, emptyOutDir: false } });
    const port = await server.start(); server.host = `127.0.0.1:${port}`; server.online = true;
    await run(controller, directory, `http://127.0.0.1:${port}/`);
  } finally {
    await server.stop(); await controller.shutdown();
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

it('renders the public design with cold caches while all secondary assets are delayed or blocked', async () => {
  await withPublicPage(async (_controller, directory, url) => {
    const { stdout } = await runElectronFixture('tests/fixtures/listener-reactions-first-paint.mjs', 'listener-reactions.html', directory, [url], 45000);
    expect(stdout).toContain('PASS: styled public HTML without secondary assets');
  });
}, 40_000);

it('keeps the adopted feedback near the preview at exact narrow widths and enlarged text', async () => {
  await withPublicPage(async (controller, directory, url) => {
    await controller.configureListenerPreview({ mode:'youtube', twitchChannel:'', youtubeVideoId:'Ab1_CD-efgH' });
    const { stdout } = await runElectronFixture('tests/fixtures/listener-page-responsive.mjs', 'listener-reactions.html', directory, [url], 30000);
    expect(stdout).toContain('PASS: responsive listener feedback, captions, zoom and keyboard scrolling');
  });
}, 35_000);

it('lays out the live player and OBS image together and falls back on narrow screens', async () => {
  const jpeg = await readFile(new URL('./fixtures/obs-program-black.jpg', import.meta.url));
  const read: ObsVisualReader = { valid: () => true, request: async type => {
    switch (type) {
      case 'GetSceneCollectionList': return { currentSceneCollectionName: 'collection' };
      case 'GetCurrentProgramScene': return { currentProgramSceneName: 'scene', currentProgramSceneUuid: 'scene-id' };
      case 'GetVideoSettings': return { baseWidth: 32, baseHeight: 18 };
      case 'GetVersion': return { supportedImageFormats: ['jpg'] };
      case 'GetSourceScreenshot': return { imageData: `data:image/jpeg;base64,${jpeg.toString('base64')}` };
      default: throw new Error(type);
    }
  } };
  await withPublicPage(async (controller, directory, url) => {
    const accepted: import('../src/shared/listener-reactions').ReactionEvent[] = [];
    controller.subscribe((name,data)=>{if(name==='reaction' && 'kind' in data)accepted.push(data);});
    for (const [index, mode] of (['youtube', 'twitch'] as const).entries()) {
      await controller.configureListenerPreview({ mode, twitchChannel: 'casmate_live', youtubeVideoId: 'Ab1_CD-efgH' });
      const { stdout } = await runElectronFixture('tests/fixtures/listener-reactions-first-paint.mjs', 'listener-reactions.html', directory, [`${url}?fixtureMode=${mode}`]);
      expect(stdout).toContain(`PASS: ${mode} preview layout`);
      expect(controller.publicView().counts).toMatchObject({ point:index+1, area:index+1, arrow:index+1 });
      const point=accepted.filter(event=>event.kind==='point').at(-1);
      // MouseEvent client coordinates round fractional CSS pixels in Chromium.
      expect(point?.x).toBeCloseTo(.5,2);expect(point?.y).toBeCloseTo(.5,2);
      const area=accepted.filter(event=>event.kind==='area').at(-1)?.area;
      expect(area).toMatchObject({x:.25,y:.25});
      expect(area?.width).toBeCloseTo(.05);expect(area?.height).toBeCloseTo(.05);
      const arrow=accepted.filter(event=>event.kind==='arrow').at(-1);
      expect(arrow?.from?.x).toBeCloseTo(.2,2);expect(arrow?.from?.y).toBeCloseTo(.7,2);
      expect(arrow?.to?.x).toBeCloseTo(.8,2);expect(arrow?.to?.y).toBeCloseTo(.3,2);
    }
  }, read);
}, 40_000);
