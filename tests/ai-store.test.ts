import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AiStore } from '../src/main/ai/ai-store';
import { selectAiContext } from '../src/main/ai/ai-context';
import { defaultAiSettings, trimAiMemory, validateAiSettings, type AiMemory, type AiAttempt } from '../src/shared/ai-listener';
const record = (id: string, text: string): AiMemory => ({ id, text, at: new Date().toISOString(), role: 'viewer', source: 'twitch' });
describe('AI記憶と設定', () => {
  it('jpnknは独立した不参加の既定設定で、現行設定の欠落は拒否する', () => {
    const settings = defaultAiSettings();
    expect(settings.participants.jpnkn).toEqual({ enabled: false, personaId: '' });
    expect([settings.jpnknName, settings.jpnknEmail]).toEqual(['', '']);
    expect(validateAiSettings({ ...settings, jpnknName: 'AI', jpnknEmail: 'sage' })).toMatchObject({ jpnknName: 'AI', jpnknEmail: 'sage', shitarabaName: '', shitarabaEmail: '' });
    expect(() => validateAiSettings({ ...settings, jpnknName: undefined })).toThrow();
    expect(() => validateAiSettings({ ...settings, participants: { ...settings.participants, jpnkn: undefined } })).toThrow();
  });
  it('旧サービスとjpnknの記憶・ログを混在させて保存復元できる', async () => {
    const root = await mkdtemp(join(tmpdir(), 'casmate-ai-four-sources-')); const now = new Date(2026, 9, 8, 12);
    const store = new AiStore(root, { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => '' }, () => now);
    const records: AiMemory[] = (['youtube', 'twitch', 'shitaraba', 'jpnkn'] as const).map((source, i) => ({ id: String(i), at: now.toISOString(), role: 'viewer', source, text: `会話${i}` }));
    await store.saveMemory(records); expect(await store.loadMemory()).toEqual(records);
    for (const source of ['youtube', 'twitch', 'shitaraba', 'jpnkn'] as const) await store.log({ id: source, at: now.toISOString(), source, target: 'thread', personaId: 'p', personaName: '人格', text: '発言', result: 'sending' });
    expect((await store.loadAttempts()).map(a => [a.source, a.result])).toEqual([['youtube', 'unknown'], ['twitch', 'unknown'], ['shitaraba', 'unknown'], ['jpnkn', 'unknown']]);
  });
  it('投稿枠は本文なしで保存し、記憶削除とログ整理で消さず、破損時に初期化しない', async () => {
    const root = await mkdtemp(join(tmpdir(), 'casmate-ai-budget-'));
    const store = new AiStore(root, { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => '' });
    expect(await store.loadPostingBudget()).toBeNull();
    const budget = { version: 1 as const, savedAt: Date.now(), reservations: [Date.now() - 1000] };
    await store.savePostingBudget(budget); await store.saveMemory([]); await store.prune();
    expect(await store.loadPostingBudget()).toEqual(budget);
    await writeFile(join(root, 'posting-budget.json'), '{broken');
    await expect(store.loadPostingBudget()).rejects.toThrow('投稿枠');
    expect(await readFile(join(root, 'posting-budget.json'), 'utf8')).toBe('{broken');
  });
  it.each(['length', 'intentional', 'invalid-response'] as const)('プロンプトと見送り理由%sを同じデバッグIDで記録する', async reason => {
    const root = await mkdtemp(join(tmpdir(), 'casmate-ai-prompt-result-')); const now = new Date(2026, 8, 13, 12);
    const store = new AiStore(root, { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => '' }, () => now);
    await store.logPrompt('prompt-1', 'test-model', JSON.stringify({ contents: [] }));
    await store.logPromptOutcome('prompt-1', reason);
    const lines = (await readFile(join(store.logsDirectory, 'prompts-2026-09-13.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    expect(lines).toHaveLength(2); expect(lines[0]).toMatchObject({ kind: 'prompt', id: 'prompt-1', model: 'test-model' });
    expect(lines[1]).toEqual({ kind: 'outcome', id: 'prompt-1', at: now.toISOString(), result: 'skipped', reason });
  });
  it('プロンプトログを別ファイルへ保存し、記憶削除で消さず30日で削除する', async () => {
    const root = await mkdtemp(join(tmpdir(), 'casmate-ai-prompt-')); let now = new Date(2026, 8, 13, 12);
    const store = new AiStore(root, { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => '' }, () => now);
    const request = { systemInstruction: { parts: [{ text: '人格設定' }] }, contents: [{ text: '会話' }] };
    const selection = selectAiContext([record('selected', '会話')], 1000).stats;
    await store.logPrompt('prompt-1', 'test-model', JSON.stringify(request), selection); await store.saveMemory([]);
    expect(JSON.parse(await readFile(join(store.logsDirectory, 'prompts-2026-09-13.jsonl'), 'utf8'))).toMatchObject({ kind: 'prompt', id: 'prompt-1', at: now.toISOString(), model: 'test-model', request, selection });
    expect(await store.loadAttempts()).toEqual([]);
    now = new Date(2026, 9, 12, 12); await store.prune(); expect(await readdir(store.logsDirectory)).toContain('prompts-2026-09-13.jsonl');
    now = new Date(2026, 9, 13, 12); await store.prune(); expect(await readdir(store.logsDirectory)).not.toContain('prompts-2026-09-13.jsonl');
  });
  it('デバッグログは既定オフで、欠落と不正な値は拒否する', () => {
    expect(defaultAiSettings().debugPromptLog).toBe(false);
    expect(() => validateAiSettings({ ...defaultAiSettings(), debugPromptLog: undefined })).toThrow();
    expect(validateAiSettings({ ...defaultAiSettings(), debugPromptLog: true }).debugPromptLog).toBe(true);
    expect(() => validateAiSettings({ ...defaultAiSettings(), debugPromptLog: 'true' })).toThrow();
  });
  it('日付別ログを30日保持し、未完了の送信を結果不明に復元する', async () => {
    const root = await mkdtemp(join(tmpdir(), 'casmate-ai-log-')); let now = new Date(2026, 7, 14, 12);
    const store = new AiStore(root, { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => '' }, () => now);
    const attempt = (id: string): AiAttempt => ({ id, at: now.toISOString(), source: 'youtube', target: 'video', personaId: 'p', personaName: '人格', text: 'こんにちは', result: 'sending' });
    await store.log(attempt('old')); now = new Date(2026, 7, 15, 12); await store.log(attempt('edge'));
    now = new Date(2026, 8, 13, 12); const current = attempt('current'); await store.log(current); await store.log({ ...current, result: 'succeeded', externalId: 'posted' });
    expect((await store.loadAttempts()).map(a => [a.id, a.result])).toEqual([['edge', 'unknown'], ['current', 'succeeded']]);
    await store.prune(); expect(await readdir(store.logsDirectory)).toEqual(['2026-08-15.jsonl', '2026-09-13.jsonl']);
    await store.discardAttempt('current'); expect((await store.loadAttempts()).map(a => a.id)).toEqual(['edge']);
    expect(await readFile(join(store.logsDirectory, '2026-09-13.jsonl'), 'utf8')).not.toContain('こんにちは');
    expect(now.getDate()).toBe(13); await store.checkWritable();
  });
  it('並行した記憶更新を順序通り保存し、秘密は暗号化境界を通す', async () => {
    const root = await mkdtemp(join(tmpdir(), 'casmate-ai-save-'));
    const store = new AiStore(root, { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(Buffer.from(value).toString('base64')), decryptString: value => Buffer.from(value.toString(), 'base64').toString() });
    await Promise.all([store.saveMemory([record('1', '最初')]), store.saveMemory([record('2', '最後')])]); expect((await store.loadMemory())[0].id).toBe('2');
    await store.saveSecrets({ key: 'private-key', youtubeClient: null, twitchClientId: '' });
    expect((await store.loadSecrets()).key).toBe('private-key'); expect(await readFile(join(root, 'secrets.protected'), 'utf8')).not.toContain('private-key');
  });
  it('書記素で計数し、巨大な単一発言は既存記憶を押し出さない', () => {
    expect(trimAiMemory([record('1', '👨‍👩‍👧‍👦'), record('2', 'あいう'), record('3', '長すぎる文章')], 3).map(r => r.id)).toEqual(['2']);
    expect(trimAiMemory([record('1', 'あ'), record('2', '長すぎる文章')], 3).map(r => r.id)).toEqual(['1']);
  });
  it('上限と不明な人格割当を拒否する', () => {
    expect(validateAiSettings(defaultAiSettings()).waitSeconds).toBe(60);
    expect(() => validateAiSettings({ ...defaultAiSettings(), waitSeconds: 9 })).toThrow();
    const settings = defaultAiSettings(); settings.participants.youtube.personaId = 'missing';
    expect(() => validateAiSettings(settings)).toThrow();
  });
  it('記憶を保存・削除でき、破損ファイルは読み込みで上書きしない', async () => {
    const root = await mkdtemp(join(tmpdir(), 'casmate-ai-'));
    const store = new AiStore(root, { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => '' });
    await store.saveMemory([record('1', 'こんにちは')]); expect(await store.loadMemory()).toHaveLength(1);
    await writeFile(join(root, 'memory.json'), 'broken');
    await expect(store.loadMemory()).rejects.toThrow('破損'); expect(await readFile(join(root, 'memory.json'), 'utf8')).toBe('broken');
    await store.saveMemory([]); expect(await store.loadMemory()).toEqual([]);
    await expect(store.loadSecrets()).rejects.toThrow('暗号化');
  });
});
