import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { ObsProgramPreview } from '../src/main/obs/obs-program-preview';
import type { ObsVisualReader } from '../src/main/obs/obs-visual';

function fixture(width = 1920, height = 1080) {
  let scene = '配信'; let collection = 'main'; let current = true;
  let imageData = 'data:image/jpeg;base64,/9j/2Q==';
  const request = vi.fn<ObsVisualReader['request']>(async type => {
    if (type === 'GetCurrentProgramScene') return { currentProgramSceneName: scene, currentProgramSceneUuid: 'program-uuid' };
    if (type === 'GetSceneCollectionList') return { currentSceneCollectionName: collection };
    if (type === 'GetVideoSettings') return { baseWidth: width, baseHeight: height };
    if (type === 'GetVersion') return { supportedImageFormats: ['jpg'] };
    if (type === 'GetSourceScreenshot') return { imageData };
    throw new Error(type);
  });
  const preview = new ObsProgramPreview(() => ({ request, valid: () => current }),
    () => ({ width: Math.floor(width * Math.min(1, 1280 / Math.max(width, height))), height: Math.floor(height * Math.min(1, 1280 / Math.max(width, height))) }));
  return { preview, request, changeScene: () => { scene = 'other'; }, changeCollection: () => { collection = 'other'; },
    disconnect: () => { current = false; }, setImage: (value: string) => { imageData = value; } };
}
describe('OBS本番シーンの静止画', () => {
  it('実JPEG解析で黒画像を正常として扱い、小さい画像を拡大しない', async () => {
    const f = fixture(32, 18);
    const bytes = readFileSync(new URL('./fixtures/obs-program-black.jpg', import.meta.url));
    f.setImage(`data:image/jpeg;base64,${bytes.toString('base64')}`);
    const preview = new ObsProgramPreview(() => ({ request: f.request, valid: () => true }));
    const image = await preview.capture(new AbortController().signal);
    expect(image).toMatchObject({ width: 32, height: 18, mimeType: 'image/jpeg' });
    expect(image.bytes).toEqual(bytes);
    expect(f.request).toHaveBeenCalledWith('GetSourceScreenshot', expect.objectContaining({ imageWidth: 32, imageHeight: 18 }));
  });
  it('実JPEG解析で要求した寸法と異なる画像を拒否する', async () => {
    const f = fixture(64, 36);
    const bytes = readFileSync(new URL('./fixtures/obs-program-black.jpg', import.meta.url));
    f.setImage(`data:image/jpeg;base64,${bytes.toString('base64')}`);
    const preview = new ObsProgramPreview(() => ({ request: f.request, valid: () => true }));
    await expect(preview.capture(new AbortController().signal)).rejects.toThrow('OBS_CAPTURE_INVALID');
  });
  it('開始終了マーカーだけの壊れたJPEGを実解析で拒否し、次の明示取得で復旧する', async () => {
    const f = fixture(32, 18);
    const preview = new ObsProgramPreview(() => ({ request: f.request, valid: () => true }));
    await expect(preview.capture(new AbortController().signal)).rejects.toThrow();
    const bytes = readFileSync(new URL('./fixtures/obs-program-black.jpg', import.meta.url));
    f.setImage(`data:image/jpeg;base64,${bytes.toString('base64')}`);
    expect((await preview.capture(new AbortController().signal)).bytes).toEqual(bytes);
  });
  it('配信状態を条件にせず本番シーン全体を撮影し、プレビュー・AI指定ソースへ置換しない', async () => {
    const { preview, request } = fixture();
    const image = await preview.capture(new AbortController().signal);
    expect(image).toMatchObject({ sceneName: '配信', width: 1280, height: 720, mimeType: 'image/jpeg' });
    expect(image.bytes).toEqual(Buffer.from('/9j/2Q==', 'base64'));
    expect(Date.parse(image.capturedAt)).not.toBeNaN();
    expect(request).toHaveBeenCalledWith('GetSourceScreenshot', { sourceUuid: 'program-uuid', imageFormat: 'jpg', imageWidth: 1280, imageHeight: 720, imageCompressionQuality: 75 });
    expect(request.mock.calls.map(([type]) => type)).not.toContain('GetStreamStatus');
    expect(request.mock.calls.map(([type]) => type)).not.toContain('GetCurrentPreviewScene');
  });
  it.each([[640, 360], [1080, 1920]])('小画像を拡大せず縦キャンバスも保つ（%s×%s）', async (width, height) => {
    const { preview } = fixture(width, height); const image = await preview.capture(new AbortController().signal);
    const scale = Math.min(1, 1280 / Math.max(width, height));
    expect([image.width, image.height]).toEqual([Math.floor(width * scale), Math.floor(height * scale)]);
  });
  it.each(['scene', 'collection', 'connection'])('撮影中の%s変更を検出して画像を破棄する', async kind => {
    const f = fixture(); const original = f.request.getMockImplementation()!;
    f.request.mockImplementation(async (type, data) => { const response = await original(type, data);
      if (type === 'GetSourceScreenshot') { if (kind === 'scene') f.changeScene(); else if (kind === 'collection') f.changeCollection(); else f.disconnect(); }
      return response;
    });
    await expect(f.preview.capture(new AbortController().signal)).rejects.toThrow();
  });
  it.each(['data:image/png;base64,/9j/2Q==', 'data:image/jpeg;base64,AAAA', 'data:image/jpeg;base64,' + 'A'.repeat(2800001)])('不正・過大画像を拒否する', async data => {
    const f = fixture(); f.setImage(data); await expect(f.preview.capture(new AbortController().signal)).rejects.toThrow();
  });
  it('応答待ちを取り消し、同時撮影は待たせず拒否する', async () => {
    const f = fixture(); let finish!: () => void;
    const original = f.request.getMockImplementation()!;
    f.request.mockImplementation((type, data) => type === 'GetSourceScreenshot' ?
      new Promise(resolve => { finish = () => resolve({ imageData: 'data:image/jpeg;base64,/9j/2Q==' }); }) : original(type, data));
    const abort = new AbortController(); const pending = f.preview.capture(abort.signal);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    await expect(f.preview.capture(new AbortController().signal)).rejects.toThrow('BUSY');
    abort.abort(); await expect(pending).rejects.toThrow();
    await expect(f.preview.capture(new AbortController().signal)).rejects.toThrow('BUSY');
    finish(); await new Promise(resolve => setTimeout(resolve, 0));
    f.request.mockImplementation(original);
    expect((await f.preview.capture(new AbortController().signal)).sceneName).toBe('配信');
  });
  it('無応答でも5秒で終了する', async () => {
    const f = fixture(); f.request.mockImplementation(() => new Promise(() => {}));
    await expect(f.preview.capture(new AbortController().signal)).rejects.toThrow();
  }, 8000);
});
