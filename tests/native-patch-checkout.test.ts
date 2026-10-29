import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { expect, it } from 'vitest';

async function removeFixture(directory: string) {
  const target = resolve(directory);
  if (!target.startsWith(resolve(tmpdir()) + sep) || !target.split(sep).at(-1)?.startsWith('casmate-native-checkout-')) {
    throw new Error('Unexpected checkout fixture directory');
  }
  await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

it('WindowsのCRLF設定でcloneしても固定パッチのSHA-256を維持する', async () => {
  const root = process.cwd();
  const directory = await mkdtemp(join(tmpdir(), 'casmate-native-checkout-'));
  const source = join(directory, 'source');
  const checkout = join(directory, 'checkout');
  const git = (args: string[], cwd = source) => execFileSync('git', args, {
    cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await mkdir(source);
    await writeFile(join(source, '.gitattributes'), await readFile(join(root, '.gitattributes')));
    const dependencies = JSON.parse(await readFile(join(root, 'native/outdoor/dependencies.json'), 'utf8')) as {
      srt: { patches: Array<{ file: string; sha256: string }> };
    };
    expect(dependencies.srt.patches.length).toBeGreaterThan(0);
    for (const patch of dependencies.srt.patches) {
      const relative = join('native', 'outdoor', 'patches', patch.file);
      const text = (await readFile(join(root, relative), 'utf8')).replace(/\r\n/g, '\n');
      expect(createHash('sha256').update(text).digest('hex')).toBe(patch.sha256);
      await mkdir(dirname(join(source, relative)), { recursive: true });
      await writeFile(join(source, relative), text);
    }
    git(['init', '--quiet']);
    git(['config', 'core.autocrlf', 'false']);
    git(['add', '--all']);
    git(['-c', 'user.name=Checkout fixture', '-c', 'user.email=checkout@example.invalid',
      '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=.git/no-hooks', 'commit', '--quiet', '-m', 'Fixture']);
    git(['-c', 'core.autocrlf=true', 'clone', '--quiet', '--no-local', source, checkout], directory);
    for (const patch of dependencies.srt.patches) {
      const bytes = await readFile(join(checkout, 'native', 'outdoor', 'patches', patch.file));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(patch.sha256);
    }
  } finally {
    await removeFixture(directory);
  }
}, 15_000);
