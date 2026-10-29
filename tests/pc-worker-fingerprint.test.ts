import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { writePcWorkerFingerprint } from '../tools/write-pc-worker-fingerprint.mjs';

it('公開ワーカーの指紋は.NET側と同じ順序で全ランタイムを含め、指紋自身は含めない', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'casmate-runtime-fingerprint-'));
  try {
    await writeFile(join(directory, 'B.dll'), 'library'); await writeFile(join(directory, 'a.exe'), 'host');
    await writeFile(join(directory, 'ignored.pdb'), 'debug');
    const expected = createHash('sha256').update('a.exe\n').update(createHash('sha256').update('host').digest())
      .update('b.dll\n').update(createHash('sha256').update('library').digest()).digest('hex');
    expect(await writePcWorkerFingerprint(directory)).toBe(expected);
    expect((await readFile(join(directory, 'service-runtime.sha256'), 'utf8')).trim()).toBe(expected);
    expect(await writePcWorkerFingerprint(directory)).toBe(expected);
    await writeFile(join(directory, 'B.dll'), 'new library');
    expect(await writePcWorkerFingerprint(directory)).not.toBe(expected);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
