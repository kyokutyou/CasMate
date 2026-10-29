import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { UpdateNotice } from '../../shared/update-notices';
import { atomicBytes } from './compatibility-storage';

type NoticeSources = Record<UpdateNotice['source'], () => string | null | undefined>;
export class UpdateNoticeStore {
  private acknowledged: string[] = [];
  private queue = Promise.resolve();
  warning: string | undefined;
  constructor(private readonly path: string, private readonly sources: NoticeSources) {}

  async load(): Promise<void> {
    this.acknowledged = []; this.warning = undefined;
    try {
      const record = JSON.parse(await readFile(this.path, 'utf8'));
      if (!record || Object.keys(record).sort().join(',') !== 'acknowledged,version' || record.version !== 1 ||
        !Array.isArray(record.acknowledged) || !record.acknowledged.every((id: unknown) => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id))) throw new Error('INVALID_NOTICE_RECORD');
      this.acknowledged = record.acknowledged;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.warning = '更新案内の確認記録を読み込めません。案内を未確認として表示しています。保存領域を確認してください。';
    }
  }

  pending(): UpdateNotice[] {
    return (Object.entries(this.sources) as [UpdateNotice['source'], () => string | null | undefined][]).flatMap(([source, read]) => {
      const message = read();
      if (!message) return [];
      const id = createHash('sha256').update(JSON.stringify([source, message])).digest('hex');
      return this.acknowledged.includes(id) ? [] : [{ id, source, message }];
    });
  }

  acknowledge(id: string): Promise<void> {
    const result = this.queue.then(async () => {
      if (this.warning) throw new Error(this.warning);
      if (this.acknowledged.includes(id)) return;
      if (!this.pending().some(notice => notice.id === id)) throw new Error('現在の更新案内を確認できません。一覧を更新してください。');
      const next = [...this.acknowledged, id];
      try { await atomicBytes(this.path, Buffer.from(JSON.stringify({ version: 1, acknowledged: next }) + '\n')); }
      catch { throw new Error('確認済みを保存できませんでした。保存領域を確認して、もう一度お試しください。'); }
      this.acknowledged = next;
    });
    this.queue = result.catch(() => undefined); return result;
  }
}
