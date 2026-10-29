import { spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const files = ['compatibility-policy.json', 'src/shared/compatibility-policy.generated.ts', 'android/app/src/main/java/jp/casmate/app/compatibility/CompatibilityPolicy.kt'];
async function sandbox() {
  const root = await mkdtemp(join(tmpdir(), 'casmate-policy-'));
  for (const path of ['tools/compatibility-policy.mjs', ...files]) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await copyFile(resolve(path), join(root, path));
  }
  return root;
}
function check(root: string) { return spawnSync(process.execPath, ['tools/compatibility-policy.mjs', '--check'], { cwd: root, encoding: 'utf8' }); }
async function snapshot(root: string) { return Promise.all(files.map(async path => ({ bytes: await readFile(join(root, path), 'utf8'), modified: (await stat(join(root, path))).mtimeMs }))); }

describe('互換ポリシー生成と読取検証', () => {
  it('一致検証は生成物と定義へ書き込まない', async () => {
    const root = await sandbox(); const before = await snapshot(root);
    expect(check(root).status).toBe(0); expect(await snapshot(root)).toEqual(before);
  });
  it('生成物の改変を拒否し、checkで自動修復しない', async () => {
    const root = await sandbox(); await writeFile(join(root, files[1]), '// stale');
    const before = await snapshot(root); const result = check(root);
    expect(result.status).not.toBe(0); expect(result.stderr).toContain('output is stale');
    expect(await snapshot(root)).toEqual(before);
  });
  it.each(['overlap', 'missing-current', 'duplicate', 'wrong-combination', 'invalid-import'])('不正定義%sを生成前に拒否する', async failure => {
    const root = await sandbox(); const file = join(root, files[0]); const policy = JSON.parse(await readFile(file, 'utf8'));
    if (failure === 'overlap') policy.contracts.pcSettings.retired.push(13);
    if (failure === 'missing-current') policy.contracts.pcSettings.supported = [];
    if (failure === 'duplicate') policy.contracts.pcSettings.supported.push(13);
    if (failure === 'wrong-combination') policy.registrationContracts[0].invitation = 6;
    if (failure === 'invalid-import') policy.contracts.pcSettings.initialImport = 'complete-unversioned';
    await writeFile(file, JSON.stringify(policy)); const before = await snapshot(root);
    const result = spawnSync(process.execPath, ['tools/compatibility-policy.mjs', '--generate'], { cwd: root, encoding: 'utf8' });
    expect(result.status).not.toBe(0); expect(await snapshot(root)).toEqual(before);
  });
});
