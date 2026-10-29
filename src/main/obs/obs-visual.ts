import { imageSize } from 'image-size';
import type { AiCapture, AiVisualSource } from '../../shared/ai-visual';

export interface ObsVisualReader {
  request(type: string, data?: Record<string, unknown>): Promise<Record<string, unknown>>;
  valid(): boolean;
}
type Item = { sourceUuid?: string; sourceName: string; sourceType?: string; isGroup?: boolean; sceneItemEnabled: boolean;
  sceneItemTransform?: { sourceWidth?: number; sourceHeight?: number } };
const unavailable = 'OBSの接続・ソース・表示状態を確認してください。';
export class ObsVisual {
  constructor(private readonly open: () => ObsVisualReader,
    private readonly decode: (bytes: Buffer) => { width: number; height: number } = bytes => imageSize(bytes)) {}

  private async bounded<T>(signal: AbortSignal, action: (read: ObsVisualReader) => Promise<T>): Promise<T> {
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(5000)]);
    deadline.throwIfAborted();
    const reader = this.open();
    let abort!: () => void;
    const cancelled = new Promise<never>((_, reject) => { abort = () => reject(new Error(unavailable)); deadline.addEventListener('abort', abort, { once: true }); });
    const checked: ObsVisualReader = { valid: () => reader.valid() && !deadline.aborted, request: async (type, data) => {
      deadline.throwIfAborted(); if (!reader.valid()) throw new Error(unavailable);
      const value = await reader.request(type, data);
      deadline.throwIfAborted(); if (!reader.valid()) throw new Error(unavailable); return value;
    } };
    try { return await Promise.race([action(checked), cancelled]); }
    finally { deadline.removeEventListener('abort', abort); }
  }

  private async tree(read: ObsVisualReader, sceneName: string, group = false, path: string[] = [], visible = true): Promise<Array<{ item: Item; visible: boolean }>> {
    if (path.includes(sceneName) || path.length >= 16) throw new Error(unavailable);
    const data = await read.request(group ? 'GetGroupSceneItemList' : 'GetSceneItemList', { sceneName });
    if (!Array.isArray(data.sceneItems) || data.sceneItems.length > 256) throw new Error(unavailable);
    const result: Array<{ item: Item; visible: boolean }> = [];
    for (const item of data.sceneItems as Item[]) {
      if (typeof item.sourceName !== 'string' || typeof item.sceneItemEnabled !== 'boolean') throw new Error(unavailable);
      const showing = visible && item.sceneItemEnabled;
      result.push({ item, visible: showing });
      if (item.isGroup || item.sourceType === 'OBS_SOURCE_TYPE_SCENE') result.push(...await this.tree(read, item.sourceName, Boolean(item.isGroup), [...path, sceneName], showing));
    }
    return result;
  }

  async list(signal: AbortSignal): Promise<AiVisualSource[]> {
    try { return await this.bounded(signal, async read => {
      const collection = (await read.request('GetSceneCollectionList')).currentSceneCollectionName;
      const scenes = (await read.request('GetSceneList')).scenes;
      if (typeof collection !== 'string' || !Array.isArray(scenes) || scenes.length > 256) throw new Error(unavailable);
      const sources = new Map<string, AiVisualSource>();
      for (const scene of scenes) {
        if (typeof scene.sceneName !== 'string') throw new Error(unavailable);
        for (const { item } of await this.tree(read, scene.sceneName)) {
          const t = item.sceneItemTransform;
          if (item.sourceUuid && t && Number(t.sourceWidth) > 0 && Number(t.sourceHeight) > 0) sources.set(item.sourceUuid, { uuid: item.sourceUuid, name: item.sourceName, collection });
        }
      }
      if ((await read.request('GetSceneCollectionList')).currentSceneCollectionName !== collection) throw new Error(unavailable);
      return [...sources.values()];
    }); } catch { signal.throwIfAborted(); throw new Error('映像ソースを取得できません。OBS接続とソース識別子に対応したOBSのバージョンを確認してください。'); }
  }

  async capture(source: AiVisualSource | null, signal: AbortSignal): Promise<AiCapture> {
    const started = Date.now();
    if (!source) return { reason: '撮影ソースを選択してください。', durationMs: 0 };
    try {
      const image = await this.bounded(signal, async read => {
        const collection = (await read.request('GetSceneCollectionList')).currentSceneCollectionName;
        if (collection !== source.collection) throw new Error(unavailable);
        const program = await read.request('GetCurrentProgramScene');
        const name = program.sceneName ?? program.currentProgramSceneName;
        if (typeof name !== 'string') throw new Error(unavailable);
        const before = await this.tree(read, name);
        const match = before.find(({ item, visible }) => visible && item.sourceUuid === source.uuid);
        if (!match) throw new Error(unavailable);
        const width = Number(match.item.sceneItemTransform?.sourceWidth);
        const height = Number(match.item.sceneItemTransform?.sourceHeight);
        if (!(width >= 8 && height >= 8)) throw new Error(unavailable);
        const formats = (await read.request('GetVersion')).supportedImageFormats;
        if (!Array.isArray(formats) || !formats.some(f => f === 'jpg' || f === 'jpeg')) throw new Error(unavailable);
        const scale = Math.min(1, 1280 / Math.max(width, height));
        const response = await read.request('GetSourceScreenshot', { sourceUuid: source.uuid, imageFormat: 'jpg',
          imageWidth: Math.floor(width * scale), imageHeight: Math.floor(height * scale), imageCompressionQuality: 75 });
        const url = response.imageData;
        if (typeof url !== 'string' || url.length > 2800000 || !/^data:image\/jpe?g;base64,[A-Za-z0-9+/]+={0,2}$/.test(url)) throw new Error(unavailable);
        const data = url.slice(url.indexOf(',') + 1); const bytes = Buffer.from(data, 'base64');
        if (bytes.length > 2 * 1024 * 1024 || bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) throw new Error(unavailable);
        const size = this.decode(bytes);
        if (!(size.width > 0 && size.height > 0 && size.width <= Math.min(1280, width) && size.height <= Math.min(1280, height))) throw new Error(unavailable);
        const after = await read.request('GetCurrentProgramScene');
        if ((after.sceneName ?? after.currentProgramSceneName) !== name ||
          (await read.request('GetSceneCollectionList')).currentSceneCollectionName !== collection ||
          JSON.stringify(await this.tree(read, name)) !== JSON.stringify(before)) throw new Error(unavailable);
        return { data, mimeType: 'image/jpeg' as const, width: size.width, height: size.height, bytes: bytes.length, capturedAt: new Date().toISOString() };
      });
      signal.throwIfAborted(); return { image, reason: '画像を取得しました。', durationMs: Date.now() - started };
    } catch { signal.throwIfAborted(); return { reason: '画像なし：取得失敗・非表示・対象変更・時間または容量の上限。OBSを確認してください。', durationMs: Date.now() - started }; }
  }
}
