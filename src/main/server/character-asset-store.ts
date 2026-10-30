import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { imageSize } from 'image-size';
import type { CharacterAssetSlot } from '../../shared/types';
import { ValidationError } from '../core/validation-error';
import { validatePng } from './png-validation';
import { defaultCharacterAssets } from '../../shared/default-character-assets';

export interface AssetDimensions {
  width: number;
  height: number;
}

const formats = {
  'image/png': { detected: 'png', extension: 'png' },
} as const;

export class CharacterAssetStore {
  constructor(readonly directory: string, private readonly bundledDirectory?: string) {}

  async save(
    slot: CharacterAssetSlot,
    content: Buffer,
    contentType: string,
    expectedDimensions?: AssetDimensions,
  ): Promise<string> {
    if (content.length > 20 * 1024 * 1024) {
      throw new ValidationError('画像ファイルは20 MiB以下にしてください。');
    }
    const format = formats[contentType as keyof typeof formats];
    if (!format) throw new ValidationError('静止PNG画像を選択してください。');
    if (hasPngChunk(content, 'acTL')) {
      throw new ValidationError('アニメーションPNGは使用できません。静止PNGを選択してください。');
    }

    let dimensions: ReturnType<typeof imageSize>;
    try {
      dimensions = imageSize(content);
    } catch {
      throw new ValidationError('画像ファイルが破損しているか、対応形式ではありません。');
    }
    if (dimensions.type !== format.detected) {
      throw new ValidationError('画像の内容とContent-Typeが一致しません。');
    }
    if (
      !dimensions.width ||
      !dimensions.height ||
      dimensions.width > 8_192 ||
      dimensions.height > 8_192
    ) {
      throw new ValidationError('画像の縦横はそれぞれ8,192px以下にしてください。');
    }
    if (expectedDimensions &&
      (dimensions.width !== expectedDimensions.width || dimensions.height !== expectedDimensions.height)) {
      throw new ValidationError('口開き素材は対応する閉口素材と幅・高さを一致させてください。');
    }

    try { await validatePng(content, dimensions.width, dimensions.height); }
    catch { throw new ValidationError('画像ファイルが破損しているか、対応形式ではありません。'); }
    await mkdir(this.directory, { recursive: true });
    const version = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const fileName = `${slot}-${version}.${format.extension}`;
    const temporary = join(this.directory, `.${fileName}.tmp`);
    await writeFile(temporary, content);
    await rename(temporary, join(this.directory, fileName));
    return `/assets/${fileName}`;
  }

  async dimensions(assetUrl: string): Promise<AssetDimensions | null> {
    const bundled = assetUrl === defaultCharacterAssets.closed || assetUrl === defaultCharacterAssets.open;
    if (bundled ? !this.bundledDirectory : !/^\/assets\/[\w.-]+$/.test(assetUrl)) return null;
    try {
      const path = bundled
        ? join(this.bundledDirectory!, assetUrl.slice(1))
        : join(this.directory, assetUrl.slice('/assets/'.length));
      const content = await readFile(path);
      if (content.length > 20 * 1024 * 1024) return null;
      const dimensions = imageSize(content);
      if (dimensions.type !== 'png' || !dimensions.width || !dimensions.height || dimensions.width > 8192 || dimensions.height > 8192 || hasPngChunk(content, 'acTL')) return null;
      await validatePng(content, dimensions.width, dimensions.height);
      return { width: dimensions.width, height: dimensions.height };
    } catch {
      return null;
    }
  }
}

function hasPngChunk(content: Buffer, expectedType: string): boolean {
  let offset = 8;
  while (offset + 12 <= content.length) {
    const length = content.readUInt32BE(offset);
    const typeOffset = offset + 4;
    const nextOffset = offset + 12 + length;
    if (nextOffset > content.length) return false;
    if (content.toString('ascii', typeOffset, typeOffset + 4) === expectedType) return true;
    offset = nextOffset;
  }
  return false;
}
