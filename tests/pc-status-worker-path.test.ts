import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { pcStatusWorkerExecutablePath } from '../src/main/pc-status/worker-path';

it('配布版のPC計測ワーカーをextraResourcesの同梱先から起動する', async () => {
  const manifest = JSON.parse(await readFile('package.json', 'utf8')) as {
    build: { extraResources: { from: string; to: string }[] };
  };
  const worker = manifest.build.extraResources.find(entry => entry.from === 'resources/pc-status-worker');
  expect(worker).toBeDefined();
  const resourcesPath = join(process.cwd(), 'installed', 'resources');
  expect(pcStatusWorkerExecutablePath(true, join(resourcesPath, 'app.asar'), resourcesPath))
    .toBe(join(resourcesPath, worker!.to, 'CasMate.PcStatus.Worker.exe'));
});

it('開発版のPC計測ワーカーはプロジェクトのresourcesから起動する', () => {
  expect(pcStatusWorkerExecutablePath(false, process.cwd(), 'unused'))
    .toBe(join(process.cwd(), 'resources', 'pc-status-worker', 'CasMate.PcStatus.Worker.exe'));
});

it('利用者単位のアンインストールから同梱ワーカーで直接接続サービスを削除する', async () => {
  const manifest = JSON.parse(await readFile('package.json', 'utf8')) as {
    build: { nsis: { perMachine: boolean; include: string }; extraResources: { from: string; to: string }[] };
  };
  const worker = manifest.build.extraResources.find(entry => entry.from === 'resources/pc-status-worker')!;
  const hook = await readFile(manifest.build.nsis.include, 'utf8');
  const installed = '$INSTDIR\\resources\\' + worker.to.replaceAll('/', '\\') + '\\CasMate.PcStatus.Worker.exe';
  expect(manifest.build.nsis.perMachine).toBe(false);
  expect(hook).toContain(installed);
  expect(hook).toContain('--direct-firewall-uninstall');
  expect(hook).toMatch(/StrCmp \$0 "0"[\s\S]*MessageBox[\s\S]*Abort/u);
});
