import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CharacterAssetStore } from '../src/main/server/character-asset-store';
import { crc32, deflateSync } from 'node:zlib';

function chunk(type: string, data: Buffer) {
  const prefix = Buffer.alloc(4); prefix.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([prefix, body, crc]);
}
function generatedPng(raw: number[], color = 6, depth = 8, interlace = 0, size = 1) {
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4);
  header[8] = depth; header[9] = color; header[12] = interlace;
  return Buffer.concat([onePixelPng.subarray(0, 8), chunk('IHDR', header),
    ...(color === 3 ? [chunk('PLTE', Buffer.from([255, 0, 0, 0, 0, 255]))] : []),
    chunk('IDAT', deflateSync(Buffer.from(raw))), chunk('IEND', Buffer.alloc(0))]);
}

const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const opaqueOnePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4AWP4z8AAAAMBAQDbfS68AAAAAElFTkSuQmCC',
  'base64',
);

describe('CharacterAssetStore', () => {
  it.each([
    { name: '低ビット深度のグレー', raw: [0, 0], color: 0, depth: 1 },
    { name: 'パレット', raw: [0, 0], color: 3, depth: 1 },
    { name: '16ビットRGBA', raw: [0, 255, 255, 0, 0, 0, 0, 255, 255], color: 6, depth: 16 },
    { name: 'インターレース', raw: [0, 255, 0, 0, 255, 0, 255, 0, 0, 255, 0, 255, 0, 0, 255, 255, 0, 0, 255], color: 6, depth: 8, interlace: 1, size: 2 },
  ])('$nameの正常な静止PNGを受け付ける', async ({ raw, color, depth, interlace, size }) => {
    const directory = await mkdtemp(join(tmpdir(), 'casmate-assets-'));
    const store = new CharacterAssetStore(directory);
    const url = await store.save('closed', generatedPng(raw, color, depth, interlace, size), 'image/png');
    expect(await store.dimensions(url)).toEqual({ width: size ?? 1, height: size ?? 1 });
  });

  it.each([
    { name: '画素不足', raw: [0, 255] },
    { name: '余分な画素', raw: [0, 255, 0, 0, 255, 255] },
    { name: '不正フィルター', raw: [5, 255, 0, 0, 255] },
  ])('CRCが正しくても$nameのPNGを拒否する', async ({ raw }) => {
    const store = new CharacterAssetStore(await mkdtemp(join(tmpdir(), 'casmate-assets-')));
    await expect(store.save('closed', generatedPng(raw), 'image/png')).rejects.toThrow('破損');
  });

  it('小さな寸法に大量の画素を展開するPNGをデコード前に拒否する', async () => {
    const store = new CharacterAssetStore(await mkdtemp(join(tmpdir(), 'casmate-assets-')));
    await expect(store.save('closed', generatedPng(new Array<number>(2 * 1024 * 1024).fill(0)), 'image/png')).rejects.toThrow('破損');
  });

  it('デコーダーが読み飛ばす付加チャンクでもCRC破損を拒否する', async () => {
    const store = new CharacterAssetStore(await mkdtemp(join(tmpdir(), 'casmate-assets-')));
    const text = chunk('tEXt', Buffer.from('Note\0example'));
    const valid = Buffer.concat([onePixelPng.subarray(0, 33), text, onePixelPng.subarray(33)]);
    await expect(store.save('closed', valid, 'image/png')).resolves.toMatch(/\.png$/);
    text[text.length - 1] ^= 255;
    await expect(store.save('closed', Buffer.concat([onePixelPng.subarray(0, 33), text, onePixelPng.subarray(33)]), 'image/png')).rejects.toThrow('破損');
  });
  it('実形式を検証して対応画像をローカル保存する', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'casmate-assets-'));
    const store = new CharacterAssetStore(directory);

    const url = await store.save('closed', onePixelPng, 'image/png');

    expect(url).toMatch(/^\/assets\/closed-.+\.png$/);
    expect(await readFile(join(directory, url.replace('/assets/', '')))).toEqual(onePixelPng);
    await expect(store.save('open', opaqueOnePixelPng, 'image/png')).resolves.toMatch(/\.png$/u);
  });

  it('容量と各辺の上限を拒否する', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'casmate-assets-'));
    const store = new CharacterAssetStore(directory);
    const oversizedDimensions = Buffer.from(onePixelPng);
    oversizedDimensions.writeUInt32BE(8_193, 16);

    await expect(store.save('closed', Buffer.alloc(20 * 1024 * 1024 + 1), 'image/png'))
      .rejects.toThrow('20 MiB');
    await expect(store.save('closed', oversizedDimensions, 'image/png'))
      .rejects.toThrow('8,192px');
  });

  it('Content-Type偽装と破損ファイルを拒否する', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'casmate-assets-'));
    const store = new CharacterAssetStore(directory);
    await expect(store.save('closed', onePixelPng, 'image/gif')).rejects.toThrow('静止PNG');
    await expect(store.save('open', Buffer.from('not image'), 'image/png')).rejects.toThrow('破損');
    await expect(store.save('closed', onePixelPng.subarray(0, 33), 'image/png')).rejects.toThrow('破損');
    const corrupted = Buffer.from(onePixelPng); corrupted[45] ^= 255;
    await expect(store.save('closed', corrupted, 'image/png')).rejects.toThrow('破損');
  });

  it('静止PNG以外とAPNGを拒否する', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'casmate-assets-'));
    const store = new CharacterAssetStore(directory);
    const apng = Buffer.concat([
      onePixelPng.subarray(0, -12),
      Buffer.from([0, 0, 0, 8]),
      Buffer.from('acTL'),
      Buffer.from([0, 0, 0, 1, 0, 0, 0, 0]),
      Buffer.alloc(4),
      onePixelPng.subarray(-12),
    ]);

    await expect(store.save('closed', onePixelPng, 'image/webp')).rejects.toThrow('静止PNG');
    await expect(store.save('closed', onePixelPng, 'image/gif')).rejects.toThrow('静止PNG');
    await expect(store.save('closed', apng, 'image/png')).rejects.toThrow('アニメーションPNG');
  });

  it('口開き素材は対応する閉口素材と幅・高さが完全一致する場合だけ受理する', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'casmate-assets-'));
    const store = new CharacterAssetStore(directory);

    await expect(store.save(
      'open',
      onePixelPng,
      'image/png',
      { width: 2, height: 1 },
    )).rejects.toThrow('幅・高さ');

    const url = await store.save(
      'open',
      onePixelPng,
      'image/png',
      { width: 1, height: 1 },
    );
    expect(await store.dimensions(url)).toEqual({ width: 1, height: 1 });
  });
});
