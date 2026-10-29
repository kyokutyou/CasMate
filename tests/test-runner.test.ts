import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { assertSameTestFiles, groupTestFiles } from '../tools/test-scope.mjs';

const runner = resolve('tools/test.mjs');
const runnerTimeout = 25_000;
const reportMergeTimeout = 15_000;
// These integration cases start real Vitest processes. Their outer deadline
// must cover the bounded child execution and temporary-directory cleanup.
const processTestTimeout = runnerTimeout + 10_000;
const directories: string[] = [];
function fixture(failing = false) {
  const directory = mkdtempSync(join(tmpdir(), 'casmate-test-runner-'));
  directories.push(directory);
  mkdirSync(join(directory, 'tests'));
  symlinkSync(resolve('node_modules'), join(directory, 'node_modules'), 'junction');
  writeFileSync(join(directory, 'vite.config.mjs'), "export default {test:{include:['tests/**/*.test.ts'],exclude:['tests/ignored.test.ts'],environment:'node'}};\n");
  const trace = join(directory, 'trace.jsonl');
  for (const name of ['light', 'render']) {
    const marker = name === 'render' ? '// @casmate-' + 'rendering\n' : '';
    writeFileSync(join(directory, 'tests', `${name}.test.ts`), marker + `
      import {it,expect} from 'vitest';
      import {appendFileSync} from 'node:fs';
      it('${name} selected case',()=>{appendFileSync(${JSON.stringify(trace)},'${name}\\n');expect(1).toBe(${failing && name === 'light' ? 2 : 1});});
      it('${name} other case',()=>{expect(true).toBe(true);});
    `);
  }
  writeFileSync(join(directory, 'tests/ignored.test.ts'), "throw new Error('Excluded tests must stay excluded');\n");
  return { directory, trace };
}
function run(directory: string, ...args: string[]) {
  const result = spawnSync(process.execPath, [runner, ...args], { cwd: directory, encoding: 'utf8', timeout: runnerTimeout });
  expect(result.error).toBeUndefined();
  return result;
}
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    const target = resolve(directory);
    if (!target.startsWith(resolve(tmpdir()) + sep) || !target.split(sep).at(-1)?.startsWith('casmate-test-runner-')) throw new Error('Unexpected fixture directory');
    await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

it('新規テストを漏らさず分類し、通常4並列→描画2並列で重複なく実行する', () => {
  const { directory, trace } = fixture();
  const result = run(directory);
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain('2 files = 1 light + 1 rendering');
  expect(result.stdout).toContain('light (1 files, 4 workers)');
  expect(result.stdout).toContain('render (1 files, 2 workers)');
  expect(readFileSync(trace, 'utf8')).toBe('light\nrender\n');
}, processTestTimeout);

it('対象ファイル・ケース名・並列数の指定を両段階へ引き継ぐ', () => {
  const { directory, trace } = fixture();
  const result = run(directory, 'tests/render.test.ts', '-t', 'selected case', '--maxWorkers=1');
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain('0 light + 1 rendering');
  expect(result.stdout).toContain('render (1 files, 1 workers)');
  expect(result.stdout).toMatch(/1 passed.*1 skipped/u);
  expect(readFileSync(trace, 'utf8')).toBe('render\n');
}, processTestTimeout);

it('通常テスト失敗を終了コードへ伝え、描画を成功扱いで続行しない', () => {
  const { directory, trace } = fixture(true);
  const result = run(directory);
  expect(result.status).toBe(1);
  expect(result.stdout).not.toContain('Test phase: render');
  expect(readFileSync(trace, 'utf8')).toBe('light\n');
}, processTestTimeout);

it('単一レポートの指定では全体を統合実行し、出力の上書きで前半を失わない', () => {
  const { directory } = fixture();
  const report = join(directory, 'all.json');
  const result = run(directory, '--reporter=json', `--outputFile=${report}`);
  expect(result.status, result.stderr).toBe(0);
  const json = JSON.parse(readFileSync(report, 'utf8'));
  expect(json.numPassedTests).toBe(4);
  expect(json.testResults).toHaveLength(2);
}, processTestTimeout);

it('出力先を省略したblobレポートにも両群を残す', () => {
  const { directory } = fixture();
  const result = run(directory, '--reporter=blob');
  expect(result.status, result.stderr).toBe(0);
  const report = join(directory, 'merged.json');
  const merged = spawnSync(process.execPath, [resolve('node_modules/vitest/vitest.mjs'), 'run',
    `--mergeReports=${join(directory, '.vitest-reports')}`, '--reporter=json', `--outputFile=${report}`],
  { cwd: directory, encoding: 'utf8', timeout: reportMergeTimeout });
  expect(merged.status, merged.stderr).toBe(0);
  expect(JSON.parse(readFileSync(report, 'utf8')).numPassedTests).toBe(4);
}, processTestTimeout + reportMergeTimeout);

it('同じテストファイルを選ぶ複数の名前付きプロジェクトを維持する', () => {
  const { directory, trace } = fixture();
  writeFileSync(join(directory, 'vite.config.mjs'), `export default {test:{projects:[
    {test:{name:'first',include:['tests/light.test.ts'],environment:'node'}},
    {test:{name:'second',include:['tests/light.test.ts'],environment:'node'}}
  ]}};`);
  const result = run(directory);
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toMatch(/Test Files\s+2 passed/u);
  expect(result.stdout).toMatch(/Tests\s+4 passed/u);
  expect(readFileSync(trace, 'utf8')).toBe('light\nlight\n');
}, processTestTimeout);

it.each([['tests/missing.test.ts'], ['--unknown-test-option']])('空の対象や無効な引数を成功扱いしない: %s', (...args) => {
  expect(run(fixture().directory, ...args).status).toBe(1);
}, processTestTimeout);

it('コメント内の文字列と実importを区別し、Electron共通起動処理の別名importも描画へ分類する', () => {
  const { directory } = fixture();
  const light = join(directory, 'tests/light.test.ts');
  const render = join(directory, 'tests/render.test.ts');
  writeFileSync(light, "// import {runElectronFixture} from './helpers/electron-fixture';\nconst text=\"runElectronFixture\";\n");
  writeFileSync(render, "import {runElectronFixture as launch} from './helpers/electron-fixture';\n");
  expect(groupTestFiles([light, render])).toEqual({ light: [light], render: [render] });
});

it('欠落・重複・余分なファイルとゼロ件を検出する', () => {
  expect(() => assertSameTestFiles(['a'], ['a', 'b'])).toThrow('scope changed');
  expect(() => assertSameTestFiles(['a', 'a'], ['a', 'b'])).toThrow('scope changed');
  expect(() => assertSameTestFiles(['a', 'b', 'c'], ['a', 'b'])).toThrow('scope changed');
  expect(() => groupTestFiles([])).toThrow('No test files');
});
