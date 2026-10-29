import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function writePcWorkerFingerprint(directory) {
  const files = (await readdir(directory, { withFileTypes: true })).filter(entry => entry.isFile() && /\.(dll|exe|json)$/iu.test(entry.name))
    .map(entry => entry.name).sort((a, b) => a.toUpperCase() < b.toUpperCase() ? -1 : a.toUpperCase() > b.toUpperCase() ? 1 : 0);
  if (!files.length) throw new Error('PC worker runtime is missing.');
  const hash = createHash('sha256');
  for (const file of files) { hash.update(file.toLowerCase() + '\n'); hash.update(createHash('sha256').update(await readFile(join(directory, file))).digest()); }
  const fingerprint = hash.digest('hex');
  await writeFile(join(directory, 'service-runtime.sha256'), fingerprint + '\n');
  return fingerprint;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await writePcWorkerFingerprint(resolve('resources/pc-status-worker'));
}
