import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

/** Contain Windows native spelling's relative writes in the disposable fixture. */
export async function runElectronFixture(script: string, html: string, directory: string, extraArgs: string[] = [], timeout = 25_000) {
  const electron = (await import('electron')).default as unknown as string;
  const cwd = resolve(directory);
  return promisify(execFile)(electron, [resolve(script), resolve(html), cwd, ...extraArgs], {
    cwd, timeout, windowsHide: true,
  });
}
