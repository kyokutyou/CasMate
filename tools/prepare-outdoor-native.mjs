import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dependencies = JSON.parse(await readFile(resolve(root, 'native/outdoor/dependencies.json'), 'utf8'));
const digest = value => createHash('sha256').update(value).digest('hex');
for (const [name, dependency] of Object.entries(dependencies)) {
  const destination = resolve(root, 'tmp/outdoor-native-deps', name);
  const marker = resolve(destination, '.casmate-sha256');
  if (await readFile(marker, 'utf8').catch(() => '') !== dependency.sha256) {
  await mkdir(destination, { recursive: true });
  const archive = resolve(root, 'tmp/outdoor-native-deps', `${name}.archive`);
  let bytes = await readFile(archive).catch(() => null);
  if (!bytes || digest(bytes) !== dependency.sha256) {
    const response = await fetch(dependency.url);
    if (!response.ok) throw new Error(`Cannot download ${name}: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (digest(bytes) !== dependency.sha256) throw new Error(`Invalid ${name} source checksum`);
    await writeFile(archive, bytes);
  }
  // Upstream's optional ffplay shell shortcut is a symlink, not a library input.
  execFileSync('tar', ['-xf', archive, '-C', destination, '--strip-components=1', '--exclude=*/srt-ffplay'], { windowsHide: true });
  await writeFile(marker, dependency.sha256);
  console.log(`${name} ${dependency.version}: verified`);
  }
  for (const patch of dependency.patches ?? []) {
    if (!/^[a-z0-9-]+\.json$/u.test(patch.file)) throw new Error('Invalid native patch path');
    const bytes = await readFile(resolve(root, 'native/outdoor/patches', patch.file));
    if (digest(bytes) !== patch.sha256) throw new Error('Invalid native patch checksum');
    const data = JSON.parse(bytes.toString('utf8'));
    if (!/^[a-zA-Z0-9/_-]+\.cpp$/u.test(data.path) || data.path.includes('..')) throw new Error('Invalid native source path');
    const sourcePath = resolve(destination, data.path); const original = await readFile(sourcePath, 'utf8');
    if (digest(original) === data.afterSha256) continue;
    if (digest(original) !== data.beforeSha256 || original.split(data.before).length !== 2) throw new Error('Unexpected native patch source');
    const updated = original.replace(data.before, data.after);
    if (digest(updated) !== data.afterSha256) throw new Error('Unexpected native patch result');
    await writeFile(sourcePath, updated);
  }
}
const androidNotices = resolve(root, 'android/app/build/generated/outdoorAssets/licenses/outdoor');
await mkdir(resolve(androidNotices, 'patches'), { recursive: true });
await copyFile(resolve(root, 'native/outdoor/dependencies.json'), resolve(androidNotices, 'dependencies.json'));
for (const patch of dependencies.srt.patches ?? []) await copyFile(resolve(root, 'native/outdoor/patches', patch.file), resolve(androidNotices, 'patches', patch.file));
