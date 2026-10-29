// Isolated rendering checks; never starts the real application or contacts services.
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import electron from 'electron';
const directory = await mkdtemp(join(tmpdir(), 'casmate-setup-preview-'));
const output = resolve('tmp/initial-setup-comparison');
await mkdir(output, { recursive: true });
const result = await promisify(execFile)(electron, [resolve('prototypes/initial-setup-ui-throwaway/verify-electron.mjs'), directory, output], { cwd: directory, windowsHide: true, timeout: 90000 });
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
if (!result.stdout.includes('PASS:')) throw new Error('Rendering checks did not report success');
