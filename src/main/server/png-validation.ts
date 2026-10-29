import { crc32, createInflate } from 'node:zlib';
import { PNG } from 'pngjs';

const passes = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];

/** Bound decompression before the decoder, including its interlaced path. */
export async function validatePng(content: Buffer, width: number, height: number): Promise<void> {
  let offset = 8; let headers = 0; let ended = false;
  const imageData: Buffer[] = [];
  while (offset + 12 <= content.length) {
    const length = content.readUInt32BE(offset);
    const type = content.toString('ascii', offset + 4, offset + 8);
    const end = offset + 12 + length;
    if (end > content.length || !headers && type !== 'IHDR') throw new Error('PNG_CHUNK');
    if (crc32(content.subarray(offset + 4, end - 4)) !== content.readUInt32BE(end - 4)) throw new Error('PNG_CRC');
    if (type === 'IHDR' && (++headers !== 1 || offset !== 8 || length !== 13)) throw new Error('PNG_HEADER');
    if (type === 'IDAT') imageData.push(content.subarray(offset + 8, end - 4));
    offset = end;
    if (type === 'IEND') { if (length !== 0) throw new Error('PNG_END'); ended = true; break; }
  }
  if (!ended || offset !== content.length || !imageData.length) throw new Error('PNG_INCOMPLETE');
  const depth = content[24]; const color = content[25]; const interlace = content[28];
  const channels = color === 0 || color === 3 ? 1 : color === 2 ? 3 : color === 4 ? 2 : color === 6 ? 4 : 0;
  const allowedDepths = color === 0 ? [1, 2, 4, 8, 16] : color === 3 ? [1, 2, 4, 8] : [8, 16];
  if (!channels || !allowedDepths.includes(depth) || interlace > 1) throw new Error('PNG_FORMAT');
  const scanlines = interlace ? passes : [[0, 0, 1, 1]];
  const expected = scanlines.reduce((total, [x, y, dx, dy]) => {
    const columns = Math.max(0, Math.ceil((width - x) / dx));
    const rows = Math.max(0, Math.ceil((height - y) / dy));
    return total + (columns && rows ? (Math.ceil(columns * channels * depth / 8) + 1) * rows : 0);
  }, 0);
  const inflater = createInflate({ chunkSize: 64 * 1024 });
  let inflatedBytes = 0;
  try {
    inflater.end(Buffer.concat(imageData));
    for await (const chunk of inflater) {
      inflatedBytes += chunk.length;
      if (inflatedBytes > expected) throw new Error('PNG_IMAGE_LENGTH');
    }
    if (inflatedBytes !== expected) throw new Error('PNG_IMAGE_LENGTH');
  } finally { inflater.destroy(); }
  // Decode filters, palettes and pixel data and verify the chunk CRCs.
  const decoded = PNG.sync.read(content, { checkCRC: true });
  if (decoded.width !== width || decoded.height !== height) throw new Error('PNG_DIMENSIONS');
}
