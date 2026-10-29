import { join } from 'node:path';

export function pcStatusWorkerExecutablePath(isPackaged: boolean, appPath: string, resourcesPath: string): string {
  const root = isPackaged ? resourcesPath : appPath;
  return join(root, 'resources', 'pc-status-worker', 'CasMate.PcStatus.Worker.exe');
}
