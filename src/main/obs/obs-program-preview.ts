import { imageSize } from 'image-size';
import type { ObsVisualReader } from './obs-visual';

export interface ObsProgramImage {
  bytes: Buffer;
  sceneName: string;
  capturedAt: string;
  width: number;
  height: number;
  mimeType: 'image/jpeg';
  current(): boolean;
}

/** Read-only scene capture, independent of the AI listener's selected input. */
export class ObsProgramPreview {
  private busy = false;
  constructor(private readonly open: () => ObsVisualReader,
    private readonly decode: (bytes: Buffer) => { width: number; height: number } = imageSize) {}

  async capture(signal: AbortSignal): Promise<ObsProgramImage> {
    signal.throwIfAborted();
    if (this.busy) throw new Error('BUSY');
    this.busy = true;
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(5000)]);
    let abort!: () => void;
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => reject(new Error('OBS_CAPTURE_CANCELLED'));
      deadline.addEventListener('abort', abort, { once: true });
    });
    let work: Promise<ObsProgramImage> | undefined;
    try {
      const read = this.open();
      const request: ObsVisualReader['request'] = async (type, data) => {
        deadline.throwIfAborted();
        if (!read.valid()) throw new Error('OBS_CAPTURE_CHANGED');
        const result = await read.request(type, data);
        deadline.throwIfAborted();
        if (!read.valid()) throw new Error('OBS_CAPTURE_CHANGED');
        return result;
      };
      work = (async () => {
        const collection = (await request('GetSceneCollectionList')).currentSceneCollectionName;
        const scene = await request('GetCurrentProgramScene');
        const name = scene.currentProgramSceneName;
        const uuid = scene.currentProgramSceneUuid;
        if (typeof collection !== 'string' || typeof name !== 'string' || !name || name.length > 1024) throw new Error('OBS_CAPTURE_UNAVAILABLE');
        const video = await request('GetVideoSettings');
        const width = Number(video.baseWidth); const height = Number(video.baseHeight);
        if (!Number.isInteger(width) || !Number.isInteger(height) || width < 8 || height < 8 || width > 32768 || height > 32768) throw new Error('OBS_CAPTURE_UNAVAILABLE');
        const formats = (await request('GetVersion')).supportedImageFormats;
        if (!Array.isArray(formats) || !formats.includes('jpg')) throw new Error('OBS_CAPTURE_UNAVAILABLE');
        const scale = Math.min(1, 1280 / Math.max(width, height));
        const scaledWidth = Math.floor(width * scale); const scaledHeight = Math.floor(height * scale);
        if (scaledWidth < 8 || scaledHeight < 8) throw new Error('OBS_CAPTURE_UNAVAILABLE');
        const result = await request('GetSourceScreenshot', {
          ...(typeof uuid === 'string' && uuid ? { sourceUuid: uuid } : { sourceName: name }),
          imageFormat: 'jpg', imageWidth: scaledWidth, imageHeight: scaledHeight, imageCompressionQuality: 75,
        });
        const capturedAt = new Date().toISOString();
        const url = result.imageData;
        if (typeof url !== 'string' || url.length > 2800000 || !/^data:image\/jpe?g;base64,[A-Za-z0-9+/]+={0,2}$/.test(url)) throw new Error('OBS_CAPTURE_INVALID');
        const bytes = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
        if (bytes.length < 4 || bytes.length > 2 * 1024 * 1024 || bytes[0] !== 255 || bytes[1] !== 216 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) throw new Error('OBS_CAPTURE_INVALID');
        const size = this.decode(bytes);
        if (size.width !== scaledWidth || size.height !== scaledHeight) throw new Error('OBS_CAPTURE_INVALID');
        const after = await request('GetCurrentProgramScene');
        if (after.currentProgramSceneName !== name || after.currentProgramSceneUuid !== uuid ||
          (await request('GetSceneCollectionList')).currentSceneCollectionName !== collection) throw new Error('OBS_CAPTURE_CHANGED');
        return { bytes, sceneName: name, capturedAt, width: size.width, height: size.height, mimeType: 'image/jpeg' as const,
          current: () => !signal.aborted && read.valid() };
      })();
      // OBS has no request cancellation. Retain the physical capture slot until
      // the outstanding request settles, even if our caller already timed out.
      void work.then(() => { this.busy = false; }, () => { this.busy = false; });
      return await Promise.race([cancelled, work]);
    } finally {
      deadline.removeEventListener('abort', abort);
      if (!work) this.busy = false;
    }
  }
}
