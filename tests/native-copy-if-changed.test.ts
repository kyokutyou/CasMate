import { mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { expect, it } from 'vitest';
// @ts-expect-error The build helper is JavaScript, outside the application TS projects.
import { copyIfChanged } from '../tools/copy-if-changed.mjs';

it('同一内容は上書きせず、新規・変更済みバイナリーはコピーし、読取失敗を隠さない', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'casmate-native-copy-'));
  try {
    const source = join(directory, 'source.exe'), destination = join(directory, 'worker.exe');
    await writeFile(source, Buffer.from([0, 1, 2]));
    expect(await copyIfChanged(source, destination)).toBe(true);
    await utimes(destination, new Date(1000000), new Date(1000000));
    const before = (await stat(destination)).mtimeMs;
    expect(await copyIfChanged(source, destination)).toBe(false);
    expect((await stat(destination)).mtimeMs).toBe(before);
    await writeFile(source, Buffer.from([0, 1, 3]));
    expect(await copyIfChanged(source, destination)).toBe(true);
    expect(await readFile(destination)).toEqual(Buffer.from([0, 1, 3]));
    await expect(copyIfChanged(join(directory, 'missing'), destination)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(copyIfChanged(source, directory)).rejects.toBeDefined();
  } finally {
    if (resolve(directory).startsWith(resolve(tmpdir()) + sep)) await rm(directory, { recursive: true, force: true });
  }
});
