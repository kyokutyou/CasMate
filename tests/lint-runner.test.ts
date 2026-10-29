import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, unlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import prototypeTests from '../tools/prototype-tests.json';

const runner = resolve('tools/lint.mjs');
const directories: string[] = [];
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'casmate-lint-'));
  directories.push(directory);
  execFileSync('git', ['init', '--quiet'], { cwd: directory });
  writeFileSync(join(directory, 'eslint.config.mjs'), "export default [{ ignores: ['eslint-ignored/**'] }, { files: ['**/*.js', '**/*.ts', '**/*.tsx'], rules: { 'no-undef': 'error' } }];\n");
  writeFileSync(join(directory, '.gitignore'), 'cache/\n');
  return directory;
}
function run(directory: string, ...args: string[]) {
  return spawnSync(process.execPath, [runner, ...args], { cwd: directory, encoding: 'utf8', timeout: 15000 });
}
afterEach(() => {
  for (const directory of directories.splice(0)) {
    const target = resolve(directory);
    if (!target.startsWith(resolve(tmpdir()) + sep) || !target.split(sep).at(-1)?.startsWith('casmate-lint-')) throw new Error('Unexpected fixture directory');
    rmSync(target, { recursive: true, force: true });
  }
});

it('新規ディレクトリ・空白を含む未追跡ソースも検査し、GitとESLintの除外を守る', () => {
  const directory = fixture();
  for (const folder of ['new source', 'cache', 'eslint-ignored']) mkdirSync(join(directory, folder));
  for (const file of ['new source/bad.js', 'cache/bad.js', 'eslint-ignored/bad.js']) writeFileSync(join(directory, file), 'undefinedVariable();\n');
  const failed = run(directory);
  expect(failed.error).toBeUndefined();
  expect(failed.status).toBe(1);
  expect(failed.stdout).toContain('bad.js');
  expect(failed.stdout).toContain('no-undef');
  expect(failed.stdout).not.toContain('cache');
  expect(failed.stdout).not.toContain('eslint-ignored');
  writeFileSync(join(directory, 'new source/bad.js'), 'const valid = 1; void valid;\n');
  expect(run(directory).status).toBe(0);
}, 20000);

it('Git除外される追跡済みソースも検査し、未ステージの削除ファイルでは失敗しない', () => {
  const directory = fixture();
  mkdirSync(join(directory, 'cache'));
  writeFileSync(join(directory, 'cache/tracked.js'), 'undefinedVariable();\n');
  writeFileSync(join(directory, 'deleted.js'), 'const valid = 1;\n');
  execFileSync('git', ['add', '-f', 'cache/tracked.js', 'deleted.js'], { cwd: directory });
  unlinkSync(join(directory, 'deleted.js'));
  const failed = run(directory);
  expect(failed.status).toBe(1);
  expect(failed.stdout).toContain('tracked.js');
  expect(failed.stderr).not.toContain('deleted.js');
  writeFileSync(join(directory, 'cache/tracked.js'), 'const valid = 1; void valid;\n');
  expect(run(directory).status).toBe(0);
}, 20000);

it('製品の新規ソースと見本の違反を別々に検出し、見本以外を除外しない', () => {
  const directory = fixture();
  for (const folder of ['new-product', 'prototypes/example', 'tests']) mkdirSync(join(directory, folder), { recursive: true });
  writeFileSync(join(directory, 'new-product/bad.js'), 'undefinedProduct();\n');
  writeFileSync(join(directory, 'prototypes/example/bad.js'), 'undefinedPrototype();\n');
  // A name containing "prototype" is still a product test unless explicitly listed.
  writeFileSync(join(directory, 'tests/new-prototype.test.tsx'), 'undefinedProductTest();\n');
  for (const file of prototypeTests) writeFileSync(join(directory, file), 'undefinedPrototypeTest();\n');
  const product = run(directory);
  expect(product.status).toBe(1);
  expect(product.stdout).toContain('new-product');
  expect(product.stdout).toContain('new-prototype.test.tsx');
  expect(product.stdout).not.toContain('undefinedPrototype');
  for (const file of prototypeTests) expect(product.stdout).not.toContain(file.split('/').at(-1));
  const prototypes = run(directory, '--scope=prototypes');
  expect(prototypes.status).toBe(1);
  expect(prototypes.stdout).toContain('bad.js');
  expect(prototypes.stdout).not.toContain('new-product');
  expect(prototypes.stdout).not.toContain('new-prototype.test.tsx');
  for (const file of prototypeTests) expect(prototypes.stdout).toContain(file.split('/').at(-1));
  writeFileSync(join(directory, 'new-product/bad.js'), 'const valid = 1; void valid;\n');
  writeFileSync(join(directory, 'tests/new-prototype.test.tsx'), 'const valid = 1; void valid;\n');
  expect(run(directory, '--scope=product').status).toBe(0);
  expect(run(directory, '--scope=prototypes').status).toBe(1);
}, 20000);

it.each([['--scope=unknown'], ['--scope=product', 'extra'], ['--scope=prototypes', '--scope=product']])(
  '無効な範囲・余分な引数を成功扱いしない: %s', (...args) => {
    const failed = run(fixture(), ...args);
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain('Usage:');
  },
);

it('Git列挙失敗を成功扱いしない', () => {
  const directory = fixture();
  // Invalidate only this fixture's metadata without deleting a repository recursively.
  unlinkSync(join(directory, '.git/HEAD'));
  const failed = run(directory);
  expect(failed.status).toBe(1);
  expect(failed.stderr).toContain('Git file enumeration failed');
});

it('範囲選択後のゼロ件とESLint除外後のゼロ件を成功扱いしない', () => {
  const directory = fixture();
  const emptyScope = run(directory, '--scope=prototypes');
  expect(emptyScope.status).toBe(1);
  expect(emptyScope.stderr).toContain('No source files found for lint (prototypes)');
  mkdirSync(join(directory, 'eslint-ignored'));
  writeFileSync(join(directory, 'eslint-ignored/ignored.js'), 'undefinedVariable();\n');
  writeFileSync(join(directory, 'eslint.config.mjs'), "export default [{ ignores: ['eslint-ignored/**', 'eslint.config.mjs'] }];\n");
  const failed = run(directory);
  expect(failed.status).toBe(1);
  expect(failed.stderr).toContain('No source files were checked by ESLint');
  unlinkSync(join(directory, 'eslint.config.mjs'));
  unlinkSync(join(directory, 'eslint-ignored/ignored.js'));
  const empty = run(directory);
  expect(empty.status).toBe(1);
  expect(empty.stderr).toContain('No source files found for lint (product)');
}, 20000);
