// Isolated prototype checks. No product application or external service is started.
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import electron from 'electron';
const directory = await mkdtemp(join(tmpdir(), 'casmate-setup-entry-preview-'));
const output = resolve('tmp/initial-setup-entry-results-comparison');
await mkdir(output, { recursive: true });
const result = await promisify(execFile)(electron, [resolve('prototypes/initial-setup-entry-results-throwaway/verify-electron.mjs'), directory, output], { cwd: directory, windowsHide: true, timeout: 90000 });
process.stdout.write(result.stdout); process.stderr.write(result.stderr);
if (!result.stdout.includes('PASS:')) throw new Error('Prototype checks did not report success');
