import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, open } from 'node:fs/promises';
import { dirname } from 'node:path';

interface ResetRecord { state: 'pending' | 'complete' | 'failed'; originalHash: string; replacementHash: string; notice: string; }
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export async function atomicBytes(path: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx');
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, path);
}
async function readOptional(path: string): Promise<Buffer | null> {
  try { return await readFile(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
export async function archiveBytes(path: string, original: Buffer): Promise<string> {
  const backup = `${path}.retired-${hash(original)}.backup`;
  const previous = await readOptional(backup);
  if (previous && !previous.equals(original)) throw new Error('互換性整理の退避データが一致しません。原本を保持しています。');
  if (!previous) await atomicBytes(backup, original);
  if (!(await readFile(backup)).equals(original)) throw new Error('退避内容を確認できません。原本を保持しています。');
  return backup;
}
async function writeRecord(path: string, record: ResetRecord) { await atomicBytes(`${path}.compatibility-reset.json`, Buffer.from(JSON.stringify(record))); }
export async function compatibilityNotice(path: string): Promise<string | null> {
  const bytes = await readOptional(`${path}.compatibility-reset.json`);
  if (!bytes) return null;
  const record = JSON.parse(bytes.toString('utf8')) as ResetRecord;
  if (!['pending', 'complete', 'failed'].includes(record.state) || !/^[a-f0-9]{64}$/.test(record.originalHash) || !/^[a-f0-9]{64}$/.test(record.replacementHash) || typeof record.notice !== 'string') throw new Error('互換性整理の記録を確認できません。保存を保持しています。');
  const backup = `${path}.retired-${record.originalHash}.backup`;
  if (hash(await readFile(backup)) !== record.originalHash) throw new Error(`退避データを確認できません。保存と記録を保持しています。退避先: ${backup}`);
  if (record.state === 'failed') throw new Error(`互換性整理の保存に失敗しました。保存と記録を退避して再設定してください。退避先: ${backup}`);
  if (record.state === 'pending') {
    const current = await readOptional(path); const currentHash = current && hash(current);
    if (currentHash === record.replacementHash) await writeRecord(path, { ...record, state: 'complete' });
    else if (currentHash !== record.originalHash) {
      await writeRecord(path, { ...record, state: 'failed' });
      throw new Error(`中断したリセットの現在ファイルを確認できません。現在ファイルと退避原本を保持しています。退避先: ${backup}`);
    }
  }
  return `${record.notice} 退避先: ${backup}`;
}
export async function replaceRetiredBytes(path: string, original: Buffer, replacement: Buffer, notice: string): Promise<string> {
  const backup = await archiveBytes(path, original);
  const record: ResetRecord = { state: 'pending', originalHash: hash(original), replacementHash: hash(replacement), notice };
  await writeRecord(path, record);
  try {
    await atomicBytes(path, replacement);
    if (!(await readFile(path)).equals(replacement)) throw new Error('保存内容を確認できません。');
    await writeRecord(path, { ...record, state: 'complete' });
  } catch (error) {
    try {
      await atomicBytes(path, await readFile(backup));
      if (!(await readFile(path)).equals(original)) throw new Error('原本の復元を確認できません。', { cause: error });
    } finally { await writeRecord(path, { ...record, state: 'failed' }); }
    throw new Error(`設定の置換に失敗しました。原本の退避先: ${backup}`, { cause: error });
  }
  return backup;
}
