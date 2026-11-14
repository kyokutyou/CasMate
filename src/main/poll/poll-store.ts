import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { defaultPollAppearance, defaultPollDraft, only, record, validPollAppearance, validPollDraft, type ListenerPoll, type PollAppearance, type PollDraft } from '../../shared/listener-poll';

export interface StoredBallot { option: number; version: number; requestId: string }
export interface PollData {
  schema: 1; draft: PollDraft; appearance: PollAppearance;
  current: ListenerPoll | null; history: ListenerPoll[]; ballots: Record<string, StoredBallot>;
}
export interface PollPersistence { load(): Promise<PollData>; save(data: PollData): Promise<void> }
export const emptyPollData = (): PollData => ({ schema: 1, draft: structuredClone(defaultPollDraft), appearance: { ...defaultPollAppearance }, current: null, history: [], ballots: {} });
const timestamp = (x: unknown) => Number.isSafeInteger(x) && Number(x) >= 0;
const uuid = (x: unknown) => typeof x === 'string' && /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/iu.test(x);
function validPoll(x: unknown): x is ListenerPoll {
  return record(x) && only(x, ['id','question','options','counts','startedAt','endsAt','closedAt','closeReason','resultsVisible']) && uuid(x.id) &&
    validPollDraft({ question: x.question, options: x.options, durationMinutes: null }, true) &&
    Array.isArray(x.counts) && Array.isArray(x.options) && x.counts.length === x.options.length && x.counts.every(timestamp) &&
    Number.isSafeInteger(x.counts.reduce((a, b) => a + b, 0)) && timestamp(x.startedAt) && (x.endsAt === null || timestamp(x.endsAt) && Number(x.endsAt) >= Number(x.startedAt)) &&
    (x.closedAt === null ? x.closeReason === null : timestamp(x.closedAt) && Number(x.closedAt) >= Number(x.startedAt) && ['manual','deadline','publicationStopped','interrupted'].includes(String(x.closeReason))) && typeof x.resultsVisible === 'boolean';
}
export function parsePollData(x: unknown): PollData {
  if (!record(x) || !only(x, ['schema','draft','appearance','current','history','ballots']) || x.schema !== 1 || !validPollDraft(x.draft) || !validPollAppearance(x.appearance) ||
    !(x.current === null || validPoll(x.current)) || !Array.isArray(x.history) || !x.history.every(p => validPoll(p) && p.closedAt !== null) || !record(x.ballots)) throw new Error('投票データの形式・版を確認できません。原本は保持しています。');
  const current = x.current;
  if (new Set(x.history.map(p => p.id)).size !== x.history.length || current && (current.closedAt === null ? x.history.some(p => p.id === current.id) : !x.history.some(p => p.id === current.id && JSON.stringify(p.counts) === JSON.stringify(current.counts)))) throw new Error('投票履歴の整合性を確認できません。');
  const counts = current?.options.map(() => 0) ?? [];
  for (const [key, b] of Object.entries(x.ballots)) {
    if (!current || current.closedAt !== null || !/^[\da-f]{64}$/u.test(key) || !record(b) || !only(b, ['option','version','requestId']) || !Number.isInteger(b.option) || Number(b.option) < 0 || Number(b.option) >= counts.length || !Number.isSafeInteger(b.version) || Number(b.version) < 1 || !uuid(b.requestId)) throw new Error('投票記録を確認できません。');
    counts[Number(b.option)]++;
  }
  if (current?.closedAt === null && JSON.stringify(counts) !== JSON.stringify(current.counts)) throw new Error('投票数と記録が一致しません。');
  return x as unknown as PollData;
}
export class PollStore implements PollPersistence {
  constructor(private readonly path: string) {}
  async load(): Promise<PollData> {
    try { return parsePollData(JSON.parse(await readFile(this.path, 'utf8'))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyPollData(); throw error; }
  }
  async save(data: PollData): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, JSON.stringify(data), { flag: 'wx' }); await rename(temporary, this.path); }
    finally { await rm(temporary, { force: true }); }
  }
}
