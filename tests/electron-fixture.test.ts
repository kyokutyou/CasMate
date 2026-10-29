import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { runElectronFixture } from './helpers/electron-fixture';

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    const target = resolve(directory);
    if (!target.startsWith(resolve(tmpdir()) + sep) || !target.split(sep).at(-1)?.startsWith('casmate-electron-fixture-')) throw new Error('Unexpected fixture directory');
    await rm(target, { recursive: true, force: true });
  }
});

it.each([0, 17])('Electronの相対書込みを一時フォルダーに収め、終了コード%sを保持する', async code => {
  const directory = await mkdtemp(join(tmpdir(), 'casmate-electron-fixture-'));
  directories.push(directory);
  const script = join(directory, 'main.mjs');
  const html = join(directory, 'index.html');
  const sideEffect = join('Ḉ朗ɭ', 'Microsoft', 'Spelling', 'neutral');
  await mkdir(join(directory, 'assets'));
  await writeFile(html, 'fixture html');
  await writeFile(script, `
    import { app } from 'electron';
    import { mkdir, readFile, writeFile } from 'node:fs/promises';
    import { join } from 'node:path';
    // Reject an incorrect launch before making any relative writes.
    if (process.cwd() !== process.argv[3]) { console.error('Unexpected working directory'); app.exit(91); }
    else {
      await mkdir(${JSON.stringify(sideEffect)}, { recursive: true });
      await writeFile(join(${JSON.stringify(sideEffect)}, 'evidence.json'), JSON.stringify({
        cwd: process.cwd(), html: await readFile(process.argv[2], 'utf8'), extra: process.argv.slice(4),
      }));
      app.exit(${code});
    }
  `);
  // Relative inputs must be resolved before the child changes working directory.
  const launch = () => runElectronFixture(relative(process.cwd(), script), relative(process.cwd(), html),
    relative(process.cwd(), directory), ['--fixture-argument']);
  if (code === 0) await launch();
  else await expect(launch()).rejects.toMatchObject({ code });
  expect(JSON.parse(await readFile(join(directory, sideEffect, 'evidence.json'), 'utf8'))).toEqual({
    cwd: directory, html: 'fixture html', extra: ['--fixture-argument'],
  });
});
