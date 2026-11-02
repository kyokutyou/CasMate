import { copyFile, readFile } from 'node:fs/promises';

export async function copyIfChanged(source, destination) {
  const bytes = await readFile(source);
  try {
    if (bytes.equals(await readFile(destination))) return false;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await copyFile(source, destination);
  return true;
}
