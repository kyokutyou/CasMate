import { describe, expect, it, vi } from 'vitest';
import { ObsVisual, type ObsVisualReader } from '../src/main/obs/obs-visual';
import { defaultAiSettings, validateAiSettings } from '../src/shared/ai-listener';
const source = { uuid: 'game-uuid', name: 'game', collection: 'main' };
function fixture() {
  const item = { sourceUuid: source.uuid, sourceName: 'renamed game', sceneItemEnabled: true, sceneItemTransform: { sourceWidth: 1920, sourceHeight: 1080 } };
  const request = vi.fn<ObsVisualReader['request']>(async type => {
    if (type === 'GetSceneCollectionList') return { currentSceneCollectionName: 'main' };
    if (type === 'GetSceneList') return { scenes: [{ sceneName: 'live' }] };
    if (type === 'GetCurrentProgramScene') return { currentProgramSceneName: 'live' };
    if (type === 'GetSceneItemList') return { sceneItems: [item, { sourceUuid: 'audio', sourceName: 'mic', sceneItemEnabled: true, sceneItemTransform: { sourceWidth: 0, sourceHeight: 0 } }] };
    if (type === 'GetVersion') return { supportedImageFormats: ['jpg'] };
    if (type === 'GetSourceScreenshot') return { imageData: 'data:image/jpeg;base64,/9j/2Q==' };
    throw new Error('unexpected');
  });
  const visual = new ObsVisual(() => ({ request, valid: () => true }), () => ({ width: 1280, height: 720 }));
  return { visual, request, item };
}
describe('OBS映像入力', () => {
  it('画像設定の欠落と未選択オンを拒否する', () => {
    const settings = defaultAiSettings(); delete settings.visual;
    expect(() => validateAiSettings(settings)).toThrow();
    expect(() => validateAiSettings({ ...settings, visual: { enabled: true, source: null } })).toThrow();
  });
  it('映像ソースだけを列挙し、改名しても指定UUIDだけ撮影する', async () => {
    const { visual, request } = fixture();
    expect(await visual.list(new AbortController().signal)).toEqual([{ ...source, name: 'renamed game' }]);
    expect((await visual.capture(source, new AbortController().signal)).image?.width).toBe(1280);
    expect(request).toHaveBeenCalledWith('GetSourceScreenshot', expect.objectContaining({ sourceUuid: source.uuid, imageWidth: 1280, imageHeight: 720, imageCompressionQuality: 75 }));
  });
  it('非表示・別コレクションは撮影せず画像なしになる', async () => {
    const { visual, request, item } = fixture(); item.sceneItemEnabled = false;
    expect((await visual.capture(source, new AbortController().signal)).image).toBeUndefined();
    expect((await visual.capture({ ...source, collection: 'other' }, new AbortController().signal)).image).toBeUndefined();
    expect(request.mock.calls.some(([type]) => type === 'GetSourceScreenshot')).toBe(false);
  });
  it('撮影中に表示状態が変わった画像を破棄する', async () => {
    const { visual, request, item } = fixture();
    const original = request.getMockImplementation()!;
    request.mockImplementation(async (type, data) => { const r = await original(type, data); if (type === 'GetSourceScreenshot') item.sceneItemEnabled = false; return structuredClone(r); });
    expect((await visual.capture(source, new AbortController().signal)).image).toBeUndefined();
  });
  it('取消は画像なし成功へ変換しない', async () => {
    const { visual } = fixture(); const cancel = new AbortController(); cancel.abort();
    await expect(visual.capture(source, cancel.signal)).rejects.toThrow();
  });
  it('OBSが応答しなくても5秒で画像なしに戻る', async () => {
    const request = vi.fn<ObsVisualReader['request']>(() => new Promise(() => {}));
    const visual = new ObsVisual(() => ({ request, valid: () => true }));
    const result = await visual.capture(source, new AbortController().signal);
    expect(result.image).toBeUndefined(); expect(result.durationMs).toBeGreaterThanOrEqual(4900);
    expect(request).toHaveBeenCalledTimes(1);
  }, 8000);
  it('入れ子のグループが非表示なら子ソースを撮影しない', async () => {
    const { visual, request, item } = fixture(); const original = request.getMockImplementation()!;
    let enabled = false;
    request.mockImplementation(async (type, data) => {
      if (type === 'GetSceneItemList') return { sceneItems: [{ sourceUuid: 'group', sourceName: 'group', isGroup: true, sceneItemEnabled: enabled }] };
      if (type === 'GetGroupSceneItemList') return { sceneItems: [item] };
      return original(type, data);
    });
    expect((await visual.capture(source, new AbortController().signal)).image).toBeUndefined();
    enabled = true;
    expect((await visual.capture(source, new AbortController().signal)).image).toBeDefined();
  });
  it('不正形式と容量超過の画像を添付しない', async () => {
    const { visual, request } = fixture(); const original = request.getMockImplementation()!;
    let imageData = 'data:image/png;base64,/9j/2Q==';
    request.mockImplementation(async (type, data) => type === 'GetSourceScreenshot' ? { imageData } : original(type, data));
    expect((await visual.capture(source, new AbortController().signal)).image).toBeUndefined();
    imageData = 'data:image/jpeg;base64,' + 'A'.repeat(2800001);
    expect((await visual.capture(source, new AbortController().signal)).image).toBeUndefined();
  });
});
