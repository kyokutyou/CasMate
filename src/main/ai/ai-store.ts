import { appendFile, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { aiSources, type AiAttempt, type AiMemory } from '../../shared/ai-listener';
import type { AiContextStats } from './ai-context';
import type { ObsSecretProtection } from '../obs/obs-control-store';
import type { PostingBudgetRecord, PostingBudgetStore } from './ai-posting-budget';

export interface AiToken { access: string; refresh: string; expiresAt: number; accountId: string; accountName: string }
export interface AiSecrets { key: string; youtubeClient: { id: string; secret: string } | null; twitchClientId: string; youtube?: AiToken; twitch?: AiToken }
export const emptyAiSecrets = (): AiSecrets => ({ key: '', youtubeClient: null, twitchClientId: '' });
export type AiPromptSkipReason = 'empty' | 'length' | 'ng' | 'duplicate' | 'intentional' | 'invalid-response';
export interface AiPersistence extends PostingBudgetStore {
  loadMemory(): Promise<AiMemory[]>; saveMemory(records: AiMemory[]): Promise<void>;
  loadAttempts(): Promise<AiAttempt[]>; log(attempt: AiAttempt): Promise<void>;
  logPrompt(id: string, model: string, requestBody: string, selection?: AiContextStats): Promise<void>;
  logPromptOutcome(id: string, reason: AiPromptSkipReason): Promise<void>;
  discardAttempt(id: string): Promise<void>;
  checkWritable(): Promise<void>;
  flush(): Promise<void>;
  loadSecrets(): Promise<AiSecrets>; saveSecrets(secrets: AiSecrets): Promise<void>;
  loadSuppressed(): Promise<boolean>; saveSuppressed(value: boolean): Promise<void>; prune(): Promise<void>;
}
export class AiStore implements AiPersistence {
  readonly logsDirectory: string;
  private queue = Promise.resolve();
  flush() { return this.queue; }
  constructor(readonly root: string, private readonly protection: ObsSecretProtection, private readonly now = () => new Date()) { this.logsDirectory = join(root, 'logs'); }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work); this.queue = result.then(() => undefined, () => undefined); return result;
  }
  private async read(name: string): Promise<string | null> {
    try { return await readFile(join(this.root, name), 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new Error('AI保存ファイルを読み込めません。', { cause: e }); }
  }
  private async atomic(name: string, data: string | Buffer) {
    await mkdir(this.root, { recursive: true }); const path = join(this.root, name);
    await writeFile(path + '.tmp', data); await rename(path + '.tmp', path);
  }
  async loadPostingBudget(): Promise<PostingBudgetRecord | null> {
    const raw = await this.read('posting-budget.json');
    if (raw === null) return null;
    try {
      const value = JSON.parse(raw) as PostingBudgetRecord;
      if (!value || value.version !== 1 || !Number.isFinite(value.savedAt) || !Array.isArray(value.reservations) ||
        !value.reservations.every((at, i, all) => Number.isFinite(at) && at <= value.savedAt && (i === 0 || at >= all[i - 1]))) throw new Error();
      return value;
    } catch { throw new Error('投稿枠の保存記録が破損しています。'); }
  }
  savePostingBudget(value: PostingBudgetRecord) {
    const data = JSON.stringify(value);
    return this.serial(() => this.atomic('posting-budget.json', data));
  }
  async loadMemory(): Promise<AiMemory[]> {
    const raw = await this.read('memory.json'); if (raw === null) return [];
    try { const value = JSON.parse(raw) as AiMemory[];
      if (!Array.isArray(value) || !value.every(r => r && typeof r.id === 'string' && typeof r.text === 'string' && typeof r.at === 'string' && Number.isFinite(Date.parse(r.at)) && ['streamer', 'viewer', 'ai'].includes(r.role) && (r.source === null || aiSources.includes(r.source)))) throw new Error();
      return value;
    } catch { throw new Error('共有記憶が破損しています。記憶削除で初期化してください。'); }
  }
  saveMemory(value: AiMemory[]) { const data = JSON.stringify(value); return this.serial(() => this.atomic('memory.json', data)); }
  async loadSecrets(): Promise<AiSecrets> {
    if (!this.protection.isEncryptionAvailable()) throw new Error('AI資格情報を暗号化できません。');
    try { const bytes = await readFile(join(this.root, 'secrets.protected')); const value = JSON.parse(this.protection.decryptString(bytes)) as AiSecrets;
      if (typeof value.key !== 'string' || typeof value.twitchClientId !== 'string') throw new Error(); return value;
    } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return emptyAiSecrets(); throw new Error('AI資格情報を復元できません。再設定してください。', { cause: e }); }
  }
  saveSecrets(value: AiSecrets) {
    if (!this.protection.isEncryptionAvailable()) return Promise.reject(new Error('AI資格情報を暗号化できません。'));
    const bytes = this.protection.encryptString(JSON.stringify(value)); return this.serial(() => this.atomic('secrets.protected', bytes));
  }
  async loadSuppressed() { return (await this.read('obs-suppressed.json')) === 'true'; }
  saveSuppressed(value: boolean) { return this.serial(() => this.atomic('obs-suppressed.json', JSON.stringify(value))); }
  checkWritable() {
    return this.serial(async () => {
      await mkdir(this.logsDirectory, { recursive: true }); const path = join(this.logsDirectory, '.write-check.tmp');
      await writeFile(path, '', 'utf8'); await rm(path);
    });
  }
  private dateName(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
  log(value: AiAttempt) {
    const path = join(this.logsDirectory, this.dateName(this.now()) + '.jsonl'); const line = JSON.stringify(value) + '\n';
    return this.serial(async () => { await mkdir(this.logsDirectory, { recursive: true }); await appendFile(path, line, 'utf8'); });
  }
  discardAttempt(id: string) {
    return this.serial(async () => {
      for (const name of await readdir(this.logsDirectory)) {
        if (!/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)) continue;
        const path = join(this.logsDirectory, name);
        const original = await readFile(path, 'utf8');
        const remaining = original.split('\n').filter(line => !line || (JSON.parse(line) as AiAttempt).id !== id).join('\n');
        if (remaining !== original) { await writeFile(path + '.tmp', remaining, 'utf8'); await rename(path + '.tmp', path); }
      }
    });
  }
  logPrompt(id: string, model: string, requestBody: string, selection?: AiContextStats) {
    const now = this.now(); const path = join(this.logsDirectory, `prompts-${this.dateName(now)}.jsonl`);
    const line = JSON.stringify({ kind: 'prompt', id, at: now.toISOString(), model, request: JSON.parse(requestBody), selection }) + '\n';
    return this.serial(async () => { await mkdir(this.logsDirectory, { recursive: true }); await appendFile(path, line, 'utf8'); });
  }
  logPromptOutcome(id: string, reason: AiPromptSkipReason) {
    const now = this.now(); const path = join(this.logsDirectory, `prompts-${this.dateName(now)}.jsonl`);
    const line = JSON.stringify({ kind: 'outcome', id, at: now.toISOString(), result: 'skipped', reason }) + '\n';
    return this.serial(async () => { await mkdir(this.logsDirectory, { recursive: true }); await appendFile(path, line, 'utf8'); });
  }
  loadAttempts(): Promise<AiAttempt[]> { return this.serial(() => this.readAttempts()); }
  private async readAttempts(): Promise<AiAttempt[]> {
    await mkdir(this.logsDirectory, { recursive: true }); const attempts = new Map<string, AiAttempt>();
    const cutoff = new Date(this.now()); cutoff.setDate(cutoff.getDate() - 29); const oldest = this.dateName(cutoff);
    for (const name of (await readdir(this.logsDirectory)).sort()) {
      if (!/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name) || name.slice(0, 10) < oldest) continue;
      const lines = (await readFile(join(this.logsDirectory, name), 'utf8')).split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i]) continue;
        try { const a = JSON.parse(lines[i]) as AiAttempt;
          if (!a || typeof a.id !== 'string' || typeof a.text !== 'string' || typeof a.target !== 'string' || !Number.isFinite(Date.parse(a.at)) || typeof a.personaName !== 'string' || !aiSources.includes(a.source) || !['sending', 'succeeded', 'failed', 'unknown'].includes(a.result)) throw new Error();
          attempts.set(a.id, a.result === 'sending' ? { ...a, result: 'unknown' } : a);
        } catch { if (i !== lines.length - 1) throw new Error('発言ログが破損しています。保存フォルダーを確認してください。'); }
      }
    }
    return [...attempts.values()];
  }
  prune() { return this.serial(() => this.pruneFiles()); }
  private async pruneFiles() {
    await mkdir(this.logsDirectory, { recursive: true }); const cutoff = new Date(this.now()); cutoff.setDate(cutoff.getDate() - 29);
    const oldest = this.dateName(cutoff);
    for (const name of await readdir(this.logsDirectory)) {
      const match = /^(?:prompts-)?(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(name);
      if (match && match[1] < oldest) await rm(join(this.logsDirectory, name));
    }
  }
}
