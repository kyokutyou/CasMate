import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiController } from '../src/main/ai/ai-controller';
import { AiServiceError, type AiGateway } from '../src/main/ai/ai-connections';
import { emptyAiSecrets, type AiPersistence } from '../src/main/ai/ai-store';
import { defaultAiSettings, type AiAttempt, type AiMemory } from '../src/shared/ai-listener';
import type { IncomingComment } from '../src/shared/types';
import { ShitarabaSource } from '../src/main/sources/shitaraba-source';
import { abortableDelay } from '../src/main/sources/abortable-delay';
import type { ObsStreamState } from '../src/shared/obs-control';
import type { PostingBudgetRecord } from '../src/main/ai/ai-posting-budget';
import type { AiGenerationEvent } from '../src/shared/ai-visual';
import { AppState } from '../src/main/core/app-state';
import { createDefaultSettings } from '../src/main/core/settings';
import type { SpeechRecognitionWorkerEvent } from '../src/main/speech-recognition/speech-recognition-worker';
import { performance } from 'node:perf_hooks';
import * as unicode from '../src/shared/unicode';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { AiStore } from '../src/main/ai/ai-store';

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const comment = (text = '視聴者のコメント', source: IncomingComment['source'] = 'youtube'): IncomingComment => ({ source, externalId: text, authorName: '送信しない名前', content: [{ type: 'text', text }], initialHistory: false });
const controllers: AiController[] = [];
async function removeMemoryFixture(directory: string) {
  const target = resolve(directory);
  if (!target.startsWith(resolve(tmpdir()) + sep) || !target.split(sep).at(-1)?.startsWith('casmate-ai-memory-count-')) throw new Error('Unexpected fixture directory');
  await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
async function setup(mode: 'manual' | 'obs' = 'manual', overrides: Partial<AiPersistence> = {}, gatewayOverrides: Partial<AiGateway> = {}) {
  let memory: AiMemory[] = []; const logs: AiAttempt[] = [];
  let postingBudget: PostingBudgetRecord | null = null;
  const store: AiPersistence = {
    loadPostingBudget: async () => postingBudget, savePostingBudget: vi.fn(async value => { postingBudget = structuredClone(value); }),
    logPrompt: async () => undefined,
    logPromptOutcome: vi.fn(async (_id, _reason) => undefined),
    loadMemory: async () => memory, saveMemory: vi.fn(async data => { memory = structuredClone(data); }),
    loadAttempts: async () => [], log: vi.fn(async a => { logs.push(structuredClone(a)); }), discardAttempt: vi.fn(async id => { for (let i = logs.length - 1; i >= 0; i--) if (logs[i].id === id) logs.splice(i, 1); }),
    loadSecrets: async () => emptyAiSecrets(), saveSecrets: async () => undefined,
    checkWritable: async () => undefined,
    flush: vi.fn(async () => undefined),
    loadSuppressed: async () => false, saveSuppressed: vi.fn(async () => undefined), prune: async () => undefined,
    ...overrides,
  };
  const generate = vi.fn<AiGateway['generate']>().mockResolvedValue('こんにちは');
  let posts = 0;
  const post = vi.fn<AiGateway['post']>().mockImplementation(async (_s, _t, _text, _settings, _signal, send) => { await send(); return `post-${++posts}`; });
  const gateway: AiGateway = { hasKey: () => true, account: s => s, generate, post, ...gatewayOverrides };
  const settings = defaultAiSettings(); settings.mode = mode; settings.jitterPercent = 0;
  settings.personas = [{ id: 'p', name: '人格', tone: '', topics: '', personality: '', firstPerson: '', notes: '' }];
  settings.participants.youtube = { enabled: true, personaId: 'p' };
  const checkObs = vi.fn<() => Promise<{ connected: boolean; stream: ObsStreamState }>>().mockResolvedValue({ connected: true, stream: 'streaming' });
  const random = vi.fn(() => 0.5);
  const c = new AiController(settings, { store, gateway, checkObs, changed: () => undefined, acquire: async () => undefined, release: async () => undefined, ngWords: () => ['禁止'], random }); controllers.push(c);
  await c.initialize(); c.connection('youtube', 'video', true); c.recognition(true);
  if (mode === 'manual') { await c.observeObs(true, 'streaming'); await c.start(); }
  return { c, settings, store, logs, generate, post, checkObs, random, memory: () => memory };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-13T00:00:00Z')); });
afterEach(async () => { for (const c of controllers.splice(0)) await c.shutdown(); vi.useRealTimers(); });
describe('AIリスナーの全体スケジュール', () => {
  it('初期化待ちの開始も、その間の停止を優先して依存機能を起動しない', async () => {
    const { settings, store } = await setup('obs');
    const gate = deferred<AiMemory[]>(); const entered = deferred<void>();
    vi.spyOn(store, 'loadMemory').mockImplementationOnce(() => { entered.resolve(); return gate.promise; });
    const acquire = vi.fn(async () => undefined);
    const c = new AiController(settings, { store, gateway: { hasKey: () => false, account: () => null, generate: async () => '', post: async () => '' },
      acquire, release: async () => undefined, ngWords: () => [], changed: () => undefined });
    controllers.push(c);
    const starting = c.start(); await entered.promise;
    try {
      await c.stop(); gate.resolve([]); await starting;
      expect(c.view().requested).toBe(false); expect(acquire).not.toHaveBeenCalled();
    } finally { gate.resolve([]); await starting; }
  });
  it.each(['manual', 'obs', 'shutdown'] as const)('復旧確認中の%sによる停止を古い再開処理が取り消さない', async stop => {
    const gate = deferred<void>(); const entered = deferred<void>();
    const { c } = await setup('manual', { checkWritable: async () => { entered.resolve(); await gate.promise; } });
    const resuming = c.resume(); await entered.promise;
    try {
      if (stop === 'manual') await c.stop();
      else if (stop === 'obs') await c.observeObs(true, 'stopped');
      else await c.shutdown();
      expect(c.view().requested).toBe(false);
      gate.resolve(); await resuming;
      expect(c.view().requested).toBe(false);
    } finally { gate.resolve(); await resuming; }
  });
  it.each(['acknowledgement', 'unclear', 'resolved', 'redundant', 'no-topic', 'invalid-response'] as const)('%sの見送りを1度だけ集計し、投稿・記憶・挨拶・投稿枠を更新しない', async reason => {
    const { c, settings, generate, post, store, logs, memory } = await setup();
    await c.configure({ ...settings, waitSeconds: 30, debugPromptLog: true });
    vi.mocked(store.savePostingBudget).mockClear();
    c.speech('返答候補の発話', 'human'); await vi.advanceTimersByTimeAsync(0);
    const before = structuredClone(memory()); const saves = vi.mocked(store.saveMemory).mock.calls.length;
    generate.mockResolvedValue({ action: 'skip', reason });
    await vi.advanceTimersByTimeAsync(29_999); expect(generate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(c.view().usage?.outcomes).toEqual({ succeeded: 0, skipped: 1, cancelled: 0, failed: 0, unknown: 0 });
    expect(c.view().message).toContain('見送り'); expect(post).not.toHaveBeenCalled(); expect(logs).toEqual([]);
    expect(store.savePostingBudget).not.toHaveBeenCalled(); expect(store.saveMemory).toHaveBeenCalledTimes(saves);
    expect(memory()).toEqual(before); expect(c.view().postingBudget.used).toBe(0);
    expect(store.logPromptOutcome).toHaveBeenCalledExactlyOnceWith(expect.any(String), reason === 'invalid-response' ? 'invalid-response' : 'intentional');
    await vi.advanceTimersByTimeAsync(90_000);
    expect(generate).toHaveBeenCalledTimes(4); expect(c.view().status).toBe('running');
    expect(generate.mock.calls.every(call => call[3] === true)).toBe(true);
    expect(c.view().usage?.outcomes.skipped).toBe(4); expect(post).not.toHaveBeenCalled();
  });
  it('成功投稿後の見送りでは新しい発話を消費せず、次の通常待機で再検討する', async () => {
    const { c, settings, generate, post } = await setup();
    await c.configure({ ...settings, waitSeconds: 30 }); c.speech('最初の発話', 'first');
    await vi.advanceTimersByTimeAsync(30_000); expect(post).toHaveBeenCalledOnce();
    c.speech('まだ返答していない発話', 'next'); generate.mockResolvedValueOnce({ action: 'skip', reason: 'unclear' });
    await vi.advanceTimersByTimeAsync(30_000); expect(post).toHaveBeenCalledOnce();
    generate.mockResolvedValue('新しい返答');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(generate).toHaveBeenCalledTimes(3); expect(generate.mock.calls[2][3]).toBe(false);
    expect(generate.mock.calls[2][2].some(record => record.id === 'next')).toBe(true);
    expect(c.view().usage?.outcomes.skipped).toBe(1);
    expect(post).toHaveBeenCalledTimes(2);
  });
  it('明示見送りの結果ログ保存失敗も既存の保存障害として休止する', async () => {
    const { c, settings, generate, post, store } = await setup();
    await c.configure({ ...settings, debugPromptLog: true });
    generate.mockResolvedValue({ action: 'skip', reason: 'unclear' });
    vi.mocked(store.logPromptOutcome).mockRejectedValueOnce(new Error('private storage path'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(c.view().status).toBe('attention'); expect(c.view().message).toContain('保存できません');
    expect(c.view().usage?.outcomes).toMatchObject({ skipped: 1, failed: 0 });
    await vi.advanceTimersByTimeAsync(120_000); expect(generate).toHaveBeenCalledOnce(); expect(post).not.toHaveBeenCalled();
    expect(JSON.stringify(c.view())).not.toContain('private storage path');
  });
  it.each(['stop', 'speech', 'obs', 'settings', 'clear'] as const)('%s後の遅い見送りを採用せず取消に数える', async change => {
    const { c, settings, generate, post, store } = await setup();
    await c.configure({ ...settings, debugPromptLog: true });
    vi.mocked(store.savePostingBudget).mockClear();
    const response = deferred<Awaited<ReturnType<AiGateway['generate']>>>(); generate.mockReturnValueOnce(response.promise);
    await vi.advanceTimersByTimeAsync(60_000); expect(generate).toHaveBeenCalledOnce();
    let action: Promise<void> | undefined;
    if (change === 'stop') action = c.stop();
    else if (change === 'speech') c.recognition(true, 'speechDetected');
    else if (change === 'obs') action = c.observeObs(false, 'unknown');
    else if (change === 'settings') action = c.configure({ ...settings, waitSeconds: 31 });
    else action = c.clearMemory();
    response.resolve({ action: 'skip', reason: 'unclear' }); await vi.advanceTimersByTimeAsync(0); await action;
    expect(c.view().usage?.outcomes).toMatchObject({ cancelled: 1, skipped: 0, failed: 0 });
    expect(post).not.toHaveBeenCalled(); expect(store.logPromptOutcome).not.toHaveBeenCalled();
    expect(store.savePostingBudget).not.toHaveBeenCalled();
  });
  it('状態表示・上限変更で既存本文を再分割せず、追加した発言だけを数える', async () => {
    const text = '👩‍💻か\u3099🇯🇵✈\uFE0F👍🏽';
    const records: AiMemory[] = Array.from({ length: 100 }, (_, i) => ({ id: `loaded-${i}`, text,
      at: new Date().toISOString(), role: 'viewer', source: 'youtube' }));
    const count = vi.spyOn(unicode, 'graphemes');
    try {
      const { c, settings } = await setup('manual', { loadMemory: async () => records }); count.mockClear();
      for (let i = 0; i < 100; i++) expect(c.view().memoryCharacters).toBe(500);
      expect(count).not.toHaveBeenCalled();
      c.speech(text, 'new'); expect(c.view().memoryCharacters).toBe(505);
      expect(count).toHaveBeenCalledExactlyOnceWith(text);
      count.mockClear(); await c.configure({ ...settings, memoryCharacters: 1000 });
      expect(c.view().memoryCharacters).toBe(505); expect(count).not.toHaveBeenCalled();
      await c.clearMemory(); expect(c.view().memoryCharacters).toBe(0); expect(count).not.toHaveBeenCalled();
    } finally { count.mockRestore(); }
  });
  it('絵文字・結合文字の上限・削除・実ファイル再読込で文字数と本文を一致させる', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'casmate-ai-memory-count-'));
    const disk = new AiStore(directory, { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => '' });
    const persistence = { loadMemory: () => disk.loadMemory(), saveMemory: (records: AiMemory[]) => disk.saveMemory(records) };
    const live: AiController[] = [];
    try {
      const first = await setup('manual', persistence); live.push(first.c);
      await first.c.configure({ ...first.settings, memoryCharacters: 1000 });
      first.c.speech('👩‍💻'.repeat(500), 'emoji'); first.c.speech('か\u3099'.repeat(500), 'combining');
      expect(first.c.view().memoryCharacters).toBe(1000);
      first.c.speech('🇯🇵', 'flag'); expect(first.c.view().memoryCharacters).toBe(501);
      first.c.speech('👍🏽'.repeat(1001), 'oversize'); expect(first.c.view().memoryCharacters).toBe(501);
      await first.c.shutdown();
      expect((await disk.loadMemory()).map(r => r.id)).toEqual(['combining', 'flag']);
      const second = await setup('manual', persistence); live.push(second.c);
      expect(second.c.view().memoryCharacters).toBe(501);
      second.c.speech('✈\uFE0F', 'plane'); expect(second.c.view().memoryCharacters).toBe(502);
      await second.c.clearMemory(); expect(second.c.view().memoryCharacters).toBe(0); expect(await disk.loadMemory()).toEqual([]);
      second.c.speech('新👩‍💻か\u3099', 'after-clear'); expect(second.c.view().memoryCharacters).toBe(3);
      await second.c.shutdown();
      const third = await setup('manual', persistence); live.push(third.c);
      expect(third.c.view().memoryCharacters).toBe(3); expect((await disk.loadMemory()).map(r => r.text)).toEqual(['新👩‍💻か\u3099']);
    } finally {
      for (const c of live) await c.shutdown();
      await removeMemoryFixture(directory);
    }
  });
  it('遅い保存中の1000入力を最新1件へ集約し、終了で最終保存とflushを待つ', async () => {
    const first = deferred<void>(); const last = deferred<void>(); const flushed = deferred<void>();
    let saved: AiMemory[] = []; let active = 0; let maximum = 0;
    const saveMemory = vi.fn<AiPersistence['saveMemory']>(async records => {
      active++; maximum = Math.max(maximum, active);
      try {
        if (saveMemory.mock.calls.length === 1) await first.promise;
        else await last.promise;
        saved = structuredClone(records);
      } finally { active--; }
    });
    const flush = vi.fn(() => flushed.promise);
    const { c, generate } = await setup('manual', { saveMemory, flush });
    let closing: Promise<void> | undefined;
    try {
      c.comment(comment('最初のコメント')); await vi.advanceTimersByTimeAsync(0);
      expect(saveMemory).toHaveBeenCalledOnce();
      const inputStartedAt = performance.now();
      for (let i = 0; i < 1000; i++) {
        if (i % 2) c.speech(`発話${i}`, `speech-${i}`);
        else c.comment(comment(`コメント${i}`));
      }
      const inputMilliseconds = performance.now() - inputStartedAt;
      if (process.env.CASMATE_AI_MEMORY_BENCH === '1') console.info(`AI_MEMORY_INPUT_BENCHMARK ${JSON.stringify({ inputs: 1000, milliseconds: inputMilliseconds })}`);
      expect(saveMemory).toHaveBeenCalledOnce();
      expect(saveMemory.mock.calls[0][0].map(r => r.text)).toEqual(['最初のコメント']);
      let done = false; closing = c.shutdown().then(() => { done = true; });
      first.resolve(); await vi.advanceTimersByTimeAsync(0);
      expect(saveMemory).toHaveBeenCalledTimes(2); expect(maximum).toBe(1); expect(done).toBe(false);
      expect(saveMemory.mock.calls[1][0]).toHaveLength(1001);
      expect(saveMemory.mock.calls[1][0].at(-1)?.text).toBe('発話999');
      c.speech('終了後の入力', 'after'); c.comment(comment('終了後コメント'));
      last.resolve(); await vi.advanceTimersByTimeAsync(0);
      expect(flush).toHaveBeenCalledOnce(); expect(done).toBe(false);
      flushed.resolve(); await closing;
      expect(saved.map(r => r.text)).toEqual(['最初のコメント', ...Array.from({ length: 1000 }, (_, i) => i % 2 ? `発話${i}` : `コメント${i}`)]);
      expect(generate).not.toHaveBeenCalled(); expect(saveMemory).toHaveBeenCalledTimes(2);
    } finally { first.resolve(); last.resolve(); flushed.resolve(); await closing; }
  }, 30_000);
  it('保存中の削除を空状態の保存まで待ち、旧入力を復活させず削除後だけ保存する', async () => {
    const first = deferred<void>(); const empty = deferred<void>();
    let saved: AiMemory[] = [];
    const saveMemory = vi.fn<AiPersistence['saveMemory']>(async records => {
      if (saveMemory.mock.calls.length === 1) await first.promise;
      if (records.length === 0) await empty.promise;
      saved = structuredClone(records);
    });
    const { c } = await setup('manual', { saveMemory });
    let clearing: Promise<void> | undefined;
    try {
      c.speech('古い発話', 'old'); await vi.advanceTimersByTimeAsync(0);
      for (let i = 0; i < 20; i++) c.comment(comment(`削除前${i}`));
      let done = false; clearing = c.clearMemory().then(() => { done = true; });
      c.speech('削除中の発話', 'during'); c.comment(comment('削除中コメント'));
      first.resolve(); await vi.advanceTimersByTimeAsync(0);
      expect(done).toBe(false); expect(saveMemory.mock.calls.at(-1)?.[0]).toEqual([]);
      empty.resolve(); await clearing;
      expect(saved).toEqual([]); expect(c.view().memoryCharacters).toBe(0);
      c.speech('削除後', 'new'); await c.stop();
      await c.withIdleContext(async (_settings, memory) => { expect(memory.map(r => r.text)).toEqual(['削除後']); });
      expect(saved.map(r => r.text)).toEqual(['削除後']);
    } finally { first.resolve(); empty.resolve(); await clearing; }
  });
  it('保存失敗では後続保存と生成を止め、手動再開で未保存の最新状態を回復する', async () => {
    const failing = deferred<void>(); let saved: AiMemory[] = [];
    const saveMemory = vi.fn<AiPersistence['saveMemory']>(async records => {
      if (saveMemory.mock.calls.length === 1) { await failing.promise; throw new Error('disk'); }
      saved = structuredClone(records);
    });
    const { c, generate, settings } = await setup('manual', { saveMemory });
    c.speech('未保存の発話', 'first'); await vi.advanceTimersByTimeAsync(0);
    c.comment(comment('未保存の最新コメント')); failing.resolve(); await vi.advanceTimersByTimeAsync(0);
    expect(c.view().status).toBe('attention');
    expect(saveMemory).toHaveBeenCalledOnce(); expect(saved).toEqual([]);
    await vi.advanceTimersByTimeAsync(120_000); expect(generate).not.toHaveBeenCalled(); expect(saveMemory).toHaveBeenCalledOnce();
    await c.configure({ ...settings, waitSeconds: 30 }); expect(saveMemory).toHaveBeenCalledOnce();
    await c.resume();
    expect(saved.map(r => r.text)).toEqual(['未保存の発話', '未保存の最新コメント']);
    expect(c.view().status).toBe('running'); expect(saveMemory).toHaveBeenCalledTimes(2);
  });
  it('保存失敗後の明示削除は空状態を保存し、再開で古い記憶を戻さない', async () => {
    const { c, store, memory } = await setup();
    vi.mocked(store.saveMemory).mockRejectedValueOnce(new Error('disk'));
    c.speech('消す発話', 'old'); await vi.advanceTimersByTimeAsync(0);
    expect(c.view().status).toBe('attention');
    await c.clearMemory(); expect(memory()).toEqual([]);
    await c.resume(); expect(memory()).toEqual([]); expect(c.view().status).toBe('running');
  });
  it('削除の重複要求と終了が重なっても空状態の保存完了を待つ', async () => {
    const first = deferred<void>(); const empty = deferred<void>();
    const saveMemory = vi.fn<AiPersistence['saveMemory']>(async records => { if (records.length) await first.promise; else await empty.promise; });
    const { c, store } = await setup('manual', { saveMemory });
    let clearing: Promise<void> | undefined; let closing: Promise<void> | undefined;
    try {
      c.speech('消す発話', 'old'); await vi.advanceTimersByTimeAsync(0);
      clearing = c.clearMemory(); expect(c.clearMemory()).toBe(clearing);
      let stopped = false; closing = c.shutdown().then(() => { stopped = true; });
      first.resolve(); await vi.advanceTimersByTimeAsync(0);
      expect(saveMemory).toHaveBeenCalledTimes(2); expect(saveMemory.mock.calls[1][0]).toEqual([]);
      expect(stopped).toBe(false); expect(store.flush).not.toHaveBeenCalled();
      empty.resolve(); await clearing; await closing;
      expect(c.view().memoryCharacters).toBe(0); expect(store.flush).toHaveBeenCalledOnce();
    } finally { first.resolve(); empty.resolve(); await clearing; await closing; }
  });
  it('設定上限縮小を最新保存へ反映し、後から来る入力の保存待ちで設定完了を延ばさない', async () => {
    const first = deferred<void>(); const second = deferred<void>(); const third = deferred<void>();
    const saveMemory = vi.fn<AiPersistence['saveMemory']>(async () => {
      const count = saveMemory.mock.calls.length;
      if (count === 1) await first.promise; if (count === 2) await second.promise; if (count === 3) await third.promise;
    });
    const { c, settings } = await setup('manual', { saveMemory }); let configuring: Promise<void> | undefined;
    try {
      c.speech('古'.repeat(600), 'old'); await vi.advanceTimersByTimeAsync(0);
      c.speech('新'.repeat(600), 'new');
      let configured = false; configuring = c.configure({ ...settings, memoryCharacters: 1000 }).then(() => { configured = true; });
      first.resolve(); await vi.advanceTimersByTimeAsync(0);
      expect(saveMemory.mock.calls[1][0].map(r => r.id)).toEqual(['new']); expect(configured).toBe(false);
      c.speech('設定開始後の発話', 'later');
      second.resolve(); await vi.advanceTimersByTimeAsync(0);
      expect(configured).toBe(true); expect(saveMemory).toHaveBeenCalledTimes(3);
      expect(saveMemory.mock.calls[2][0].map(r => r.id)).toEqual(['new', 'later']);
    } finally { first.resolve(); second.resolve(); third.resolve(); await configuring; }
  });
  it('通常生成は待機開始時までの最新記憶が保存される前にAPIを呼ばない', async () => {
    const first = deferred<void>(); const latest = deferred<void>();
    const saveMemory = vi.fn<AiPersistence['saveMemory']>(async () => {
      if (saveMemory.mock.calls.length === 1) await first.promise;
      if (saveMemory.mock.calls.length === 2) await latest.promise;
    });
    const { c, generate } = await setup('manual', { saveMemory });
    try {
      c.speech('最初の発話', 'first'); await vi.advanceTimersByTimeAsync(0); c.comment(comment('最新コメント'));
      await vi.advanceTimersByTimeAsync(60_000); expect(generate).not.toHaveBeenCalled();
      first.resolve(); await vi.advanceTimersByTimeAsync(0); expect(generate).not.toHaveBeenCalled();
      latest.resolve(); await vi.advanceTimersByTimeAsync(0);
      expect(generate).toHaveBeenCalledOnce(); expect(generate.mock.calls[0][2].map(r => r.text)).toEqual(['最初の発話', '最新コメント']);
    } finally { first.resolve(); latest.resolve(); }
  });
  it('終了中の保存失敗でも最新状態の再試行を繰り返さずストアを終了する', async () => {
    const failing = deferred<void>();
    const saveMemory = vi.fn<AiPersistence['saveMemory']>(async () => { await failing.promise; throw new Error('disk'); });
    const { c, store } = await setup('manual', { saveMemory });
    c.speech('未保存', 'old'); await vi.advanceTimersByTimeAsync(0); c.comment(comment('最後の入力'));
    const closing = c.shutdown(); failing.resolve(); await expect(closing).resolves.toBeUndefined();
    expect(saveMemory).toHaveBeenCalledOnce(); expect(store.flush).toHaveBeenCalledOnce();
  });
  it.each(['memory', 'log'] as const)('手動復旧の確認中に発生した新しい%s保存失敗を古い復旧要求で解除しない', async failure => {
    const checking = deferred<void>(); const checkWritable = vi.fn(() => checking.promise);
    const { c, store, generate } = await setup('manual', { checkWritable });
    let recovering: Promise<void> | undefined;
    try {
      recovering = c.resume('youtube'); await vi.advanceTimersByTimeAsync(0); expect(checkWritable).toHaveBeenCalledOnce();
      if (failure === 'memory') vi.mocked(store.saveMemory).mockRejectedValueOnce(new Error('new disk failure'));
      else vi.mocked(store.log).mockRejectedValueOnce(new Error('new log failure'));
      c.speech('確認中の発話', 'during'); await vi.advanceTimersByTimeAsync(failure === 'memory' ? 0 : 60_000);
      expect(c.view().status).toBe('attention'); const generations = generate.mock.calls.length;
      checking.resolve(); await recovering;
      expect(c.view().status).toBe('attention');
      await vi.advanceTimersByTimeAsync(120_000); expect(generate).toHaveBeenCalledTimes(generations);
      await c.resume('youtube'); expect(c.view().status).toBe('running');
    } finally { checking.resolve(); await recovering; }
  });
  it('送信済み投稿を待つ間の記憶削除でも、削除中のコメントを保留から戻さない', async () => {
    const posted = deferred<string>(); const empty = deferred<void>();
    let saved: AiMemory[] = [];
    const saveMemory = vi.fn<AiPersistence['saveMemory']>(async records => {
      if (!records.length) await empty.promise; saved = structuredClone(records);
    });
    const { c, post } = await setup('manual', { saveMemory });
    post.mockImplementationOnce(async (_s, _t, _text, _settings, _signal, before) => { await before(); return posted.promise; });
    let clearing: Promise<void> | undefined;
    try {
      await vi.advanceTimersByTimeAsync(60_000); expect(post).toHaveBeenCalledOnce();
      clearing = c.clearMemory(); await vi.advanceTimersByTimeAsync(0);
      c.comment(comment('削除中に到着')); empty.resolve(); await clearing;
      c.comment(comment('削除後に到着')); posted.resolve('post-1'); await vi.advanceTimersByTimeAsync(0);
      expect(saved.map(r => r.text)).toEqual(['削除後に到着']);
    } finally { empty.resolve(); posted.resolve('post-1'); await clearing; }
  });
  it.each(['succeeded', 'skipped', 'failed', 'unknown'] as const)('通常生成の%s結果だけを一度集計し、停止再開で保持する', async result => {
    const { c, generate, post } = await setup();
    if (result === 'skipped') generate.mockResolvedValue('');
    if (result === 'failed') generate.mockRejectedValue(new Error('network'));
    if (result === 'unknown') post.mockImplementation(async (_s, _t, _text, _settings, _signal, before) => { await before(); throw new AiServiceError('unknown', '確認してください'); });
    await vi.advanceTimersByTimeAsync(60_000);
    const expected = { succeeded: 0, skipped: 0, cancelled: 0, failed: 0, unknown: 0, [result]: 1 };
    expect(c.view().usage?.outcomes).toEqual(expected);
    await c.stop(); await c.start(); expect(c.view().usage?.outcomes).toEqual(expected);
  });
  it('発話による未送信取消は遅い完了後に一度数え、投稿しない', async () => {
    const { c, generate, post } = await setup(); const pending = deferred<string>();
    generate.mockReturnValue(pending.promise);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(c.view().usage?.outcomes.cancelled).toBe(0);
    c.recognition(true, 'speechDetected'); pending.resolve('遅い生成文');
    await vi.advanceTimersByTimeAsync(0);
    expect(c.view().usage?.outcomes).toMatchObject({ cancelled: 1, succeeded: 0 }); expect(post).not.toHaveBeenCalled();
  });
  it('送信済み成功は停止と結果保存失敗が重なっても成功へ一度集計する', async () => {
    const { c, post, store } = await setup(); const pending = deferred<string>();
    post.mockImplementation(async (_s, _t, _text, _settings, _signal, before) => { await before(); return pending.promise; });
    vi.mocked(store.log).mockImplementation(async attempt => { if (attempt.result === 'succeeded') throw new Error('save failed'); });
    await vi.advanceTimersByTimeAsync(60_000); await c.stop(); pending.resolve('posted');
    await vi.advanceTimersByTimeAsync(0);
    expect(c.view().usage?.outcomes).toEqual({ succeeded: 1, skipped: 0, cancelled: 0, failed: 0, unknown: 0 });
  });
  it('API認証拒否による自動休止を利用者の取消として数えない', async () => {
    const { c, generate } = await setup(); generate.mockRejectedValue(new AiServiceError('attention', 'APIキーを確認してください'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(c.view().usage?.outcomes).toEqual({ succeeded: 0, skipped: 0, cancelled: 0, failed: 1, unknown: 0 });
  });
  it('記憶削除と設定変更で集計を消さず、新しい起動では過去ログを加算しない', async () => {
    const { c, settings } = await setup(); await vi.advanceTimersByTimeAsync(60_000);
    await c.stop(); await c.clearMemory(); await c.configure({ ...settings, waitSeconds: 30 });
    expect(c.view().usage?.outcomes.succeeded).toBe(1);
    const next = await setup('manual', { loadAttempts: async () => [{ id: 'past', at: new Date().toISOString(), source: 'youtube',
      target: 'video', personaId: 'p', personaName: '人格', text: '過去の発言', result: 'succeeded' }] });
    expect(next.c.view().usage?.outcomes).toEqual({ succeeded: 0, skipped: 0, cancelled: 0, failed: 0, unknown: 0 });
  });
  it('通常期限が来ても発話・認識中は生成せず、最新確定後1.5秒の間を待つ', async () => {
    const { c, generate, post } = await setup();
    await vi.advanceTimersByTimeAsync(59000); c.recognition(true, 'speechDetected');
    await vi.advanceTimersByTimeAsync(1000); expect(generate).not.toHaveBeenCalled();
    expect(c.view().activity?.stage).toBe('speaking');
    c.recognition(true, 'recognizing'); await vi.advanceTimersByTimeAsync(10000);
    expect(generate).not.toHaveBeenCalled(); expect(c.view().activity?.stage).toBe('recognizing');
    c.speech('今の話題', 'latest'); c.recognition(true, 'listening');
    expect(c.view().activity).toMatchObject({ stage: 'speech-gap', startedAt: Date.now() });
    await vi.advanceTimersByTimeAsync(1499); expect(generate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(post).toHaveBeenCalledOnce();
    expect(generate.mock.calls[0][2]).toEqual([expect.objectContaining({ text: '今の話題' })]);
  });
  it('認識文字列がなくてもbusy解除から間を取り、猶予中に話し始めたら再び解除を待つ', async () => {
    const { c, generate, post } = await setup(); c.recognition(true, 'speechDetected');
    await vi.advanceTimersByTimeAsync(120000); expect(generate).not.toHaveBeenCalled();
    c.recognition(true, 'listening'); await vi.advanceTimersByTimeAsync(1499); c.recognition(true, 'speechDetected');
    await vi.advanceTimersByTimeAsync(3000); expect(generate).not.toHaveBeenCalled();
    c.recognition(true, 'recognizing'); c.recognition(true, 'listening');
    await vi.advanceTimersByTimeAsync(1499); expect(generate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(post).toHaveBeenCalledOnce();
    c.recognition(true, 'speechDetected'); await vi.advanceTimersByTimeAsync(120000); c.recognition(true, 'listening');
    await vi.advanceTimersByTimeAsync(1500); expect(post).toHaveBeenCalledOnce(); expect(c.view().activity?.stage).toBe('new-speech');
  });
  it('共有認識セッションの発話・認識状態をAppStateからAIへ渡す', async () => {
    const { c } = await setup(); let listener: ((event: SpeechRecognitionWorkerEvent) => void) | undefined;
    const state = new AppState(createDefaultSettings(), { speechRecognitionWorker: {
      subscribe: next => { listener = next; return () => { listener = undefined; }; },
      initialize: async () => {}, listMicrophones: async () => [], prepareModel: async () => {}, start: async () => ({ sessionId: 'session' }),
      stop: async () => {}, setWavSaving: async () => {}, retry: async () => {}, shutdown: async () => {},
    } });
    try {
      state.attachAi(c); c.connection('youtube', 'video', true); await state.acquireAiDependencies();
      listener?.({ type: 'status', sessionId: 'session', status: 'speechDetected' }); expect(c.view().activity?.stage).toBe('speaking');
      listener?.({ type: 'status', sessionId: 'session', status: 'recognizing' }); expect(c.view().activity?.stage).toBe('recognizing');
      listener?.({ type: 'status', sessionId: 'session', status: 'listening' }); expect(c.view().activity?.stage).toBe('waiting');
    } finally { await state.shutdown(); }
  });
  it('本文を保持せずOBS・画像・生成・投稿の段階と直近時間を表示し、旧イベントを無視して終了で購読を解除する', async () => {
    let observer: ((event: AiGenerationEvent) => void) | undefined; const unsubscribe = vi.fn();
    const { c, generate, checkObs, post } = await setup('manual', {}, { observeGeneration: listener => { observer = listener; return unsubscribe; } });
    const obs = deferred<{ connected: boolean; stream: ObsStreamState }>(); checkObs.mockReturnValueOnce(obs.promise);
    const pending = deferred<string>(); const posted = deferred<string>(); generate.mockReturnValueOnce(pending.promise);
    try {
    await vi.advanceTimersByTimeAsync(60000); expect(c.view().activity?.stage).toBe('obs-check');
    await vi.advanceTimersByTimeAsync(200); obs.resolve({ connected: true, stream: 'streaming' }); await vi.advanceTimersByTimeAsync(0);
    const id = generate.mock.calls[0][5]!;
    const emit = (eventId: string, stage: 'capture' | 'api', status: AiGenerationEvent['status']) => observer?.({ id: eventId, stage, status,
      capture: { reason: '秘密のソース', durationMs: 25, image: { data: 'secret-image', mimeType: 'image/jpeg', width: 1, height: 1, bytes: 1, capturedAt: '2026-09-13T00:00:00Z' } }, apiDurationMs: 400, message: '秘密の本文', text: 'secret-text' });
    emit(id, 'capture', 'working'); expect(c.view().activity?.stage).toBe('image-preparation');
    emit(id, 'api', 'working'); expect(c.view().activity?.stage).toBe('generating');
    emit('another-request', 'capture', 'working'); expect(c.view().activity?.stage).toBe('generating');
    await vi.advanceTimersByTimeAsync(400); emit(id, 'api', 'succeeded');
    post.mockImplementationOnce(async (_s, _t, _text, _settings, _signal, send) => { await send(); return posted.promise; });
    pending.resolve('こんにちは'); await vi.advanceTimersByTimeAsync(0); expect(c.view().activity?.stage).toBe('posting');
    await vi.advanceTimersByTimeAsync(500); posted.resolve('post'); await vi.advanceTimersByTimeAsync(0);
    expect(c.view().activity?.lastDurationsMs).toMatchObject({ 'image-preparation': 25, generating: 400, posting: 500 });
    expect(JSON.stringify(c.view().activity)).not.toMatch(/secret|秘密/);
    await c.stop(); emit(id, 'capture', 'working'); expect(c.view().activity?.stage).toBe('idle');
    await c.shutdown(); expect(unsubscribe).toHaveBeenCalledOnce();
    } finally { obs.resolve({ connected: true, stream: 'streaming' }); pending.resolve('終了'); posted.resolve('post'); await vi.advanceTimersByTimeAsync(0); }
  });
  it('生成中の手動停止で観測購読を解除し、遅れたイベントと生成結果を表示・投稿しない', async () => {
    let observer: ((event: AiGenerationEvent) => void) | undefined; const unsubscribe = vi.fn();
    const { c, generate, post } = await setup('manual', {}, { observeGeneration: listener => { observer = listener; return unsubscribe; } });
    const pending = deferred<string>(); generate.mockReturnValueOnce(pending.promise);
    try {
      await vi.advanceTimersByTimeAsync(60000); const id = generate.mock.calls[0][5]!;
      await c.stop(); expect(unsubscribe).toHaveBeenCalledOnce();
      observer?.({ id, stage: 'api', status: 'succeeded', capture: { reason: '', durationMs: 1 }, apiDurationMs: 9999, message: '古い応答', text: '古い本文' });
      expect(c.view().activity).toMatchObject({ stage: 'idle', lastDurationsMs: { 'obs-check': 0 } });
      pending.resolve('古い本文'); await vi.advanceTimersByTimeAsync(120000); expect(post).not.toHaveBeenCalled();
      expect(unsubscribe).toHaveBeenCalledOnce();
    } finally { pending.resolve('終了'); await vi.advanceTimersByTimeAsync(0); }
  });
  it.each(['success', 'failure'] as const)('テスト中のOBS配信開始を%s後に再評価し、通常待機から開始する', async outcome => {
    const { c, post } = await setup('obs'); await c.observeObs(true, 'stopped');
    const pending = deferred<void>();
    const operation = c.withIdleSettings(async () => {
      await pending.promise;
      if (outcome === 'failure') throw new Error('テスト失敗');
      return 'OK';
    });
    const completion = outcome === 'failure' ? expect(operation).rejects.toThrow('テスト失敗') : expect(operation).resolves.toBe('OK');
    await c.observeObs(true, 'streaming');
    expect(c.view().requested).toBe(false);
    await expect(c.start()).rejects.toThrow('テスト生成');
    pending.resolve(); await completion;
    expect(c.view().requested).toBe(true); expect(c.view().status).toBe('running');
    expect(post).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(59999); expect(post).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(post).toHaveBeenCalledOnce();
  });
  it.each(['stopped', 'disconnected', 'manual-stop', 'manual-mode', 'shutdown'] as const)('テスト中の配信開始後に%sになれば終了後に自動開始しない', async state => {
    const { c, settings, post } = await setup('obs'); await c.observeObs(true, 'stopped');
    const pending = deferred<void>(); const operation = c.withIdleSettings(async () => pending.promise);
    await c.observeObs(true, 'streaming');
    if (state === 'stopped') await c.observeObs(true, 'stopped');
    if (state === 'disconnected') await c.observeObs(false, 'unknown');
    if (state === 'manual-stop') await c.stop();
    if (state === 'manual-mode') await c.configure({ ...settings, mode: 'manual' });
    if (state === 'shutdown') await c.shutdown();
    pending.resolve(); await operation;
    expect(c.view().requested).toBe(false);
    await vi.advanceTimersByTimeAsync(120000); expect(post).not.toHaveBeenCalled();
  });
  it.each(['shitaraba', 'jpnkn'] as const)('%sの送信中の複数pollで自己投稿行を失わず、二重記憶しない', async source => {
    const { c, settings, post, memory } = await setup(); settings.participants.youtube.enabled = false;
    settings.participants[source] = { enabled: true, personaId: 'p' };
    c.connection(source, 'thread', true); await c.configure(settings); c.observeBoardProgress(source, 10);
    const result = deferred<undefined>(); post.mockImplementationOnce(async (_s, _t, _text, _settings, _signal, send) => { await send(); return result.promise; });
    await vi.advanceTimersByTimeAsync(60000);
    const row = { ...comment('こんにちは', source), externalId: 'board:thread:11' };
    c.observeRaw(source, row.externalId, '掲示板の既定名'); c.observeBoardBatch([row], source); c.comment(row);
    c.observeBoardBatch([], source); c.observeBoardBatch([], source);
    result.resolve(undefined); await vi.advanceTimersByTimeAsync(0);
    expect(c.view().services[source].latest).toMatchObject({ result: 'succeeded', previousResponse: 10, externalId: row.externalId });
    expect(c.view().services[source].ready).toBe(true); expect(memory()).toHaveLength(1);
    expect(memory()[0]).toMatchObject({ role: 'ai', source });
  });
  it.each(['target', 'reconnect'] as const)('jpnknの%s変更で旧送信・保留コメントを新接続の記憶へ入れない', async change => {
    const { c, settings, post, memory, logs } = await setup(); settings.participants.youtube.enabled = false;
    settings.participants.jpnkn = { enabled: true, personaId: 'p' };
    c.connection('jpnkn', 'thread', true); await c.configure(settings); c.observeBoardProgress('jpnkn', 10);
    const result = deferred<undefined>(); post.mockImplementationOnce(async (_s, _t, _text, _settings, _signal, send) => { await send(); return result.promise; });
    await vi.advanceTimersByTimeAsync(60000);
    const row = { ...comment('旧スレッドの会話', 'jpnkn'), externalId: 'board:thread:11' };
    c.observeRaw('jpnkn', row.externalId, 'viewer'); c.observeBoardBatch([row], 'jpnkn'); c.comment(row);
    if (change === 'target') c.connection('jpnkn', 'next-thread', true);
    else { c.connection('jpnkn', 'thread', false); c.connection('jpnkn', 'thread', true); }
    result.resolve(undefined); await vi.advanceTimersByTimeAsync(0);
    expect(memory()).toEqual([]); expect(logs.at(-1)).toMatchObject({ source: 'jpnkn', target: 'thread', result: 'succeeded' });
    expect(c.view().services.jpnkn.ready).toBe(true);
    c.comment({ ...comment('新接続の会話', 'jpnkn'), externalId: 'board:new:1' }); await vi.advanceTimersByTimeAsync(0);
    expect(memory().map(r => r.text)).toEqual(['新接続の会話']);
  });
  it('jpnknの認証拒否を再送せず、他サービスは通常待機後に継続する', async () => {
    const { c, settings, post, generate } = await setup(); settings.participants.jpnkn = { enabled: true, personaId: 'p' };
    c.connection('jpnkn', 'thread', true); await c.configure(settings);
    post.mockImplementationOnce(async (_s, _t, _text, _settings, _signal, send) => { await send(); throw new AiServiceError('rejected', 'jpnknはブラウザで認証を確認してください。'); });
    await vi.advanceTimersByTimeAsync(60000);
    expect(post.mock.calls[0][0]).toBe('jpnkn'); expect(c.view().services.jpnkn.latest?.result).toBe('failed');
    expect(c.view().services.jpnkn.message).toContain('ブラウザ'); expect(c.view().services.youtube.ready).toBe(true);
    generate.mockResolvedValue('YouTubeの挨拶'); await vi.advanceTimersByTimeAsync(60000);
    expect(post.mock.calls[1][0]).toBe('youtube'); expect(post).toHaveBeenCalledTimes(2);
  });
  it('jpnknの旧照合不能試行を再開で確認済みにし、同じ試行で再休止しない', async () => {
    const prior: AiAttempt = { id: 'old-jpnkn', at: new Date().toISOString(), source: 'jpnkn', target: 'thread', text: '過去のAI', personaId: 'p', personaName: '人格', result: 'succeeded', previousResponse: 10, authorName: '' };
    const { c } = await setup('manual', { loadAttempts: async () => [prior] }); c.connection('jpnkn', 'thread', true);
    await c.resume('jpnkn'); expect(prior.reviewed).toBe(true);
    c.observeBoardBatch([{ ...comment('過去のAI', 'jpnkn'), externalId: 'board:thread:11' }], 'jpnkn');
    expect(c.view().services.jpnkn.message).not.toContain('曖昧');
  });
  it('停止・再開・記憶削除・復旧操作でも確保済みの件数を保持する', async () => {
    const { c, post, generate } = await setup(); await vi.advanceTimersByTimeAsync(60000);
    expect(c.view().postingBudget.used).toBe(1);
    await c.stop(); await c.clearMemory(); await c.resume();
    expect(c.view().postingBudget.used).toBe(1);
    c.speech('再開後の話題', 'resumed'); generate.mockResolvedValue('再開後の発言'); await vi.advanceTimersByTimeAsync(59999); expect(post).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1); expect(post).toHaveBeenCalledTimes(2); expect(c.view().postingBudget.used).toBe(2);
  });
  it('OBS確認失敗中の再開でも確認を再予約して復旧できる', async () => {
    const { c, checkObs, post } = await setup(); checkObs.mockRejectedValueOnce(new Error('timeout'));
    await vi.advanceTimersByTimeAsync(60000); await c.resume();
    await vi.advanceTimersByTimeAsync(120000); expect(post).toHaveBeenCalledOnce(); expect(c.view().status).toBe('running');
  });
  it('終了時刻の保存障害で後続のリソース解放を妨げない', async () => {
    const { c, store } = await setup(); const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(store.savePostingBudget).mockRejectedValueOnce(new Error('disk'));
    try { await expect(c.shutdown()).resolves.toBeUndefined(); expect(warning).toHaveBeenCalledWith(expect.stringContaining('AI投稿枠')); }
    finally { warning.mockRestore(); }
  });
  it('OBS再接続中に手動停止しても同じ配信の復旧で再開しない', async () => {
    const { c, store, post } = await setup('obs'); await c.observeObs(true, 'streaming');
    await c.observeObs(true, 'reconnecting'); await c.stop();
    expect(store.saveSuppressed).toHaveBeenLastCalledWith(true);
    await c.observeObs(true, 'streaming'); await vi.advanceTimersByTimeAsync(120000);
    expect(c.view().requested).toBe(false); expect(post).not.toHaveBeenCalled();
    await c.observeObs(true, 'stopped'); await c.observeObs(true, 'streaming');
    await vi.advanceTimersByTimeAsync(60000); expect(post).toHaveBeenCalledOnce();
  });
  it('手動開始は配信開始を待ち、初期停止ではオフにならず配信終了でオフになる', async () => {
    const { c, post, memory } = await setup(); await c.stop(); await c.observeObs(true, 'stopped'); await c.start();
    await c.observeObs(true, 'stopped'); c.speech('配信前', 'before'); c.comment(comment());
    await vi.advanceTimersByTimeAsync(120000); expect(post).not.toHaveBeenCalled(); expect(memory()).toHaveLength(0); expect(c.view().requested).toBe(true);
    await c.observeObs(true, 'streaming'); await vi.advanceTimersByTimeAsync(60000); expect(post).toHaveBeenCalledOnce();
    await c.observeObs(true, 'stopped'); expect(c.view().requested).toBe(false);
    await c.observeObs(true, 'streaming'); await vi.advanceTimersByTimeAsync(120000); expect(post).toHaveBeenCalledOnce();
  });
  it.each(['unknown', 'starting', 'stopping', 'reconnecting'] as const)('%sで生成を破棄し、復旧時に通常待機する', async state => {
    const { c, generate, post, memory } = await setup(); const pending = deferred<string>(); generate.mockReturnValueOnce(pending.promise);
    await vi.advanceTimersByTimeAsync(60000); await c.observeObs(true, state); pending.resolve('古い文章');
    c.speech('休止中', 'paused'); await vi.advanceTimersByTimeAsync(120000);
    expect(post).not.toHaveBeenCalled(); expect(memory()).toHaveLength(0); expect(c.view().requested).toBe(true);
    await c.observeObs(true, 'streaming'); await vi.advanceTimersByTimeAsync(59999); expect(post).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(post).toHaveBeenCalledOnce();
  });
  it('OBS確認失敗は通常間隔で再確認し、復旧後に待ち直す', async () => {
    const { c, checkObs, generate, post } = await setup(); checkObs.mockRejectedValueOnce(new Error('timeout'));
    await vi.advanceTimersByTimeAsync(60000); expect(generate).not.toHaveBeenCalled(); expect(c.view().status).toBe('paused');
    await vi.advanceTimersByTimeAsync(59999); expect(checkObs).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1); expect(checkObs).toHaveBeenCalledTimes(2); expect(generate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60000); expect(post).toHaveBeenCalledOnce();
  });
  it('投稿直前にもOBSを確認し、終了していれば投稿枠を消費しない', async () => {
    const { c, checkObs, logs } = await setup(); checkObs.mockResolvedValueOnce({ connected: true, stream: 'streaming' }).mockResolvedValueOnce({ connected: true, stream: 'stopped' });
    await vi.advanceTimersByTimeAsync(60000); expect(checkObs).toHaveBeenCalledTimes(2); expect(logs).toHaveLength(0);
    expect(c.view().postingBudget.used).toBe(0); expect(c.view().requested).toBe(false);
  });
  it('OBS切断後の遅い確認応答を採用しない', async () => {
    const { c, checkObs, generate } = await setup(); const pending = deferred<{ connected: boolean; stream: ObsStreamState }>(); checkObs.mockReturnValueOnce(pending.promise);
    await vi.advanceTimersByTimeAsync(60000); await c.observeObs(false, 'unknown'); pending.resolve({ connected: true, stream: 'streaming' });
    await vi.advanceTimersByTimeAsync(60000); expect(generate).not.toHaveBeenCalled(); expect(c.view().status).toBe('paused');
  });
  it('上限待機中も会話を記憶し、枠が空いてから最新の会話で生成する', async () => {
    const now = Date.now(); const reservations = Array.from({ length: 60 }, (_, i) => now - 1_800_000 + i * 30_000);
    const { c, generate, memory, settings } = await setup('manual', { loadPostingBudget: async () => ({ version: 1, savedAt: now, reservations }) });
    expect(c.view().postingBudget.used).toBe(60);
    c.speech('待っている間の発話', 'wait'); c.comment(comment('最新の会話'));
    await vi.advanceTimersByTimeAsync(0); expect(memory()).toHaveLength(2);
    await c.clearMemory(); c.speech('削除後の発話', 'after'); await c.configure({ ...settings, waitSeconds: 30 });
    await vi.advanceTimersByTimeAsync(1_799_999); expect(generate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(generate).toHaveBeenCalledOnce();
    expect(generate.mock.calls[0][2]).toEqual(expect.arrayContaining([expect.objectContaining({ text: '削除後の発話' })]));
  });
  it('揺らぎを適用しても30秒未満で生成しない', async () => {
    const { c, settings, generate, random } = await setup(); random.mockReturnValue(0); await c.configure({ ...settings, waitSeconds: 30, jitterPercent: 50 });
    await vi.advanceTimersByTimeAsync(29999); expect(generate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(generate).toHaveBeenCalledOnce();
  });
  it('投稿枠の保存中に停止したら送信せず、確保した枠は残す', async () => {
    const { c, store, logs } = await setup(); const pending = deferred<void>();
    vi.mocked(store.savePostingBudget).mockImplementationOnce(() => pending.promise);
    await vi.advanceTimersByTimeAsync(60000); await c.stop(); pending.resolve(); await vi.advanceTimersByTimeAsync(0);
    expect(logs).toHaveLength(0); expect(c.view().postingBudget.used).toBe(1);
  });
  it('投稿枠の保存失敗は投稿を止め、NG文は枠を消費しない', async () => {
    const { c, store, generate, logs } = await setup(); generate.mockResolvedValueOnce('禁止');
    await vi.advanceTimersByTimeAsync(60000); expect(c.view().postingBudget.used).toBe(0);
    vi.mocked(store.savePostingBudget).mockRejectedValueOnce(new Error('disk'));
    await vi.advanceTimersByTimeAsync(60000); expect(logs).toHaveLength(0); expect(c.view().status).toBe('attention');
  });
  it('起動時に100件の初回履歴を取得しても、その後の自己投稿を照合できる', async () => {
    const { c, settings, generate, post, memory } = await setup();
    settings.participants.youtube.enabled = false;
    settings.participants.shitaraba = { enabled: true, personaId: 'p' };
    settings.shitarabaName = 'AI'; await c.configure(settings);
    generate.mockResolvedValue('Hello!'); let posted = false;
    post.mockImplementation(async (_s, _t, _text, _settings, _signal, send) => { await send(); posted = true; return undefined; });
    const history = Array.from({ length: 100 }, (_, i) => `${i + 401}<>Viewer<>sage<>date<>Old comment<>title`).join('\n');
    let first = true; let delivered = false;
    const source = new ShitarabaSource({ category: 'game', boardId: '1', threadId: '2', url: 'https://jbbs.shitaraba.net/bbs/read.cgi/game/1/2/' }, {
      onStatus: status => c.connection('shitaraba', 'thread', status.state === 'connected'),
      onRawAuthor: (s, id, author) => c.observeRaw(s, id, author),
      onShitarabaBatch: rows => c.observeShitarabaBatch(rows),
      onShitarabaProgress: number => c.progress(number),
      onComment: row => c.comment(row),
    }, { fetch: async () => {
      if (first) { first = false; return new Response(history); }
      if (posted && !delivered) { delivered = true; return new Response('501<>AI<>sage<>date<>Hello!<>title'); }
      return new Response('');
    }, delay: abortableDelay }, 5);
    try {
      await source.start(); await vi.advanceTimersByTimeAsync(0);
      expect(memory()).toEqual([]);
      await vi.advanceTimersByTimeAsync(65000);
      expect(post).toHaveBeenCalledOnce();
      expect(c.view().services.shitaraba.latest).toMatchObject({ previousResponse: 500, externalId: 'game:1:2:501', result: 'succeeded' });
      expect(c.view().services.shitaraba.ready).toBe(true);
      expect(memory()).toHaveLength(1);
    } finally { await source.stop(); }
  });
  it('送信中に届いた新着なしの取得結果で自己投稿を照合不能にしない', async () => {
    const { c, settings, post, memory } = await setup();
    settings.participants.youtube.enabled = false;
    settings.participants.shitaraba = { enabled: true, personaId: 'p' }; settings.shitarabaName = 'AI';
    c.connection('shitaraba', 'thread', true); await c.configure(settings); c.progress(10);
    const result = deferred<undefined>();
    post.mockImplementationOnce(async (_s, _t, _text, _settings, _signal, send) => { await send(); return result.promise; });
    await vi.advanceTimersByTimeAsync(60000);
    c.observeShitarabaBatch([]);
    result.resolve(undefined); await vi.advanceTimersByTimeAsync(0);
    expect(c.view().services.shitaraba.ready).toBe(true);
    c.observeShitarabaBatch([]);
    expect(c.view().services.shitaraba.ready).toBe(true);
    const row = { ...comment('こんにちは', 'shitaraba'), externalId: 'board:thread:11' };
    c.observeRaw('shitaraba', row.externalId, 'AI'); c.observeShitarabaBatch([row]); c.comment(row);
    await vi.advanceTimersByTimeAsync(0);
    expect(c.view().services.shitaraba.latest?.externalId).toBe(row.externalId);
    expect(memory()).toHaveLength(1);
  });
  it('投稿準備失敗の具体的な理由を表示し、ログへ本文を残さない', async () => {
    const { c, post, logs } = await setup();
    post.mockRejectedValueOnce(new AiServiceError('rejected', 'したらばの公開フォームを取得できません。'));
    await vi.advanceTimersByTimeAsync(60000);
    expect(c.view().message).toContain('したらばの公開フォームを取得できません。');
    expect(logs).toEqual([]);
  });
  it('したらばを5秒ごとに正常取得しても60秒の発言待機をやり直さない', async () => {
    const { c, settings, post } = await setup(); settings.participants.youtube.enabled = false;
    settings.participants.shitaraba = { enabled: true, personaId: 'p' }; await c.configure(settings);
    const states: string[] = [];
    const source = new ShitarabaSource({ category: 'game', boardId: '1', threadId: '2', url: 'https://jbbs.shitaraba.net/bbs/read.cgi/game/1/2/' }, {
      onStatus: status => { states.push(status.state); c.connection('shitaraba', 'thread', status.state === 'connected'); },
      onComment: comment => c.comment(comment),
    }, { fetch: async () => new Response(''), delay: abortableDelay }, 5);
    try {
      await source.start(); await vi.advanceTimersByTimeAsync(0); const deadline = c.view().nextAt;
      await vi.advanceTimersByTimeAsync(59999); expect(post).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1); expect(post).toHaveBeenCalledOnce();
      expect(states.filter(state => state === 'connecting')).toHaveLength(1);
      expect(deadline).toBe(Date.now());
    } finally { await source.stop(); }
  });
  it('したらばの実際の通信障害では休止し、復旧時点から60秒待ち直す', async () => {
    const { c, settings, post } = await setup(); settings.participants.youtube.enabled = false;
    settings.participants.shitaraba = { enabled: true, personaId: 'p' }; await c.configure(settings);
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(''));
    const source = new ShitarabaSource({ category: 'game', boardId: '1', threadId: '2', url: 'https://jbbs.shitaraba.net/bbs/read.cgi/game/1/2/' }, {
      onStatus: status => c.connection('shitaraba', 'thread', status.state === 'connected'), onComment: comment => c.comment(comment),
    }, { fetch: fetcher, delay: abortableDelay }, 5);
    try {
      await source.start(); await vi.advanceTimersByTimeAsync(50000); fetcher.mockRejectedValueOnce(new Error('offline'));
      await vi.advanceTimersByTimeAsync(5000); expect(c.view().status).toBe('paused'); expect(c.view().nextAt).toBeNull();
      await vi.advanceTimersByTimeAsync(5000); expect(c.view().status).toBe('running');
      await vi.advanceTimersByTimeAsync(59999); expect(post).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1); expect(post).toHaveBeenCalledOnce();
    } finally { await source.stop(); }
  });
  it('終了後の遅延入力で生成や記憶追加を再開しない', async () => {
    const { c, generate, memory } = await setup(); await c.shutdown(); c.speech('遅延した認識結果', 'late'); c.comment(comment());
    await vi.advanceTimersByTimeAsync(60000); expect(generate).not.toHaveBeenCalled(); expect(memory()).toEqual([]);
  });
  it('成功結果のログ保存だけが失敗しても、復旧後に無発話で再挨拶しない', async () => {
    const { c, store, logs, generate, memory } = await setup();
    vi.mocked(store.log).mockImplementationOnce(async a => { logs.push(structuredClone(a)); }).mockRejectedValueOnce(new Error('disk'));
    await vi.advanceTimersByTimeAsync(60000); expect(c.view().status).toBe('attention'); expect(memory()).toHaveLength(1);
    await c.resume(); await vi.advanceTimersByTimeAsync(120000); expect(generate).toHaveBeenCalledTimes(1); expect(logs.at(-1)?.result).toBe('succeeded');
    generate.mockResolvedValue('続きのお話'); c.speech('次の話', 'next'); await vi.advanceTimersByTimeAsync(1500); expect(generate.mock.calls[1][3]).toBe(false);
  });
  it('明確な投稿失敗も再起動後は手動再開待ちを維持する', async () => {
    const prior: AiAttempt = { id: 'failed', at: new Date().toISOString(), source: 'youtube', target: 'video', text: '前回の投稿', personaId: 'p', personaName: '人格', result: 'failed' };
    const { c, post } = await setup('obs', { loadAttempts: async () => [prior] }); await c.observeObs(true, 'streaming');
    await vi.advanceTimersByTimeAsync(60000); expect(post).not.toHaveBeenCalled(); await c.resume('youtube'); await vi.advanceTimersByTimeAsync(60000); expect(post).toHaveBeenCalledOnce(); expect(prior.reviewed).toBe(true);
  });
  it('一時障害後に視聴者コメントが来ても60秒の待機を短縮しない', async () => {
    const { c, settings, generate } = await setup(); await c.configure({ ...settings, waitSeconds: 30 }); generate.mockRejectedValueOnce(new Error('offline'));
    await vi.advanceTimersByTimeAsync(30000); c.comment(comment()); await vi.advanceTimersByTimeAsync(59999); expect(generate).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(generate).toHaveBeenCalledTimes(2);
  });
  it('各サービスの初投稿に挨拶し、一時休止後は挨拶済みを保持する', async () => {
    const { c, settings, post, generate } = await setup(); await vi.advanceTimersByTimeAsync(60000);
    settings.participants.twitch = { enabled: true, personaId: 'p' }; c.connection('twitch', 'channel', true); await c.configure(settings);
    c.speech('次の話', 's1'); generate.mockResolvedValue('Twitchのみなさんこんにちは'); await vi.advanceTimersByTimeAsync(60000);
    expect(post.mock.calls[1][0]).toBe('twitch'); expect(generate.mock.calls[1][3]).toBe(true);
    c.connection('twitch', 'channel', false); c.connection('twitch', 'channel', true); c.speech('さらに続き', 's2'); generate.mockResolvedValue('なるほど');
    await vi.advanceTimersByTimeAsync(60000); expect(generate.mock.calls[2][3]).toBe(false);
  });
  it('OBS接続直後の配信状態不明では手動停止を解除しない', async () => {
    const { c, post } = await setup('obs'); await c.observeObs(true, 'streaming'); await c.stop();
    await c.observeObs(false, 'unknown'); await c.observeObs(true, 'unknown'); await c.observeObs(true, 'streaming');
    await vi.advanceTimersByTimeAsync(60000); expect(post).not.toHaveBeenCalled();
  });
  it.each([1, 2, 0])('したらばの取得バッチが%件一致した場合に一意な自己投稿だけを除外する', async count => {
    const { c, settings, post, memory } = await setup(); settings.participants.youtube.enabled = false;
    settings.participants.shitaraba = { enabled: true, personaId: 'p' }; settings.shitarabaName = 'AI';
    c.connection('shitaraba', 'thread', true); await c.configure(settings); c.progress(10);
    post.mockImplementation(async (_s, _t, _text, _settings, _signal, send) => { await send(); return undefined; });
    await vi.advanceTimersByTimeAsync(60000);
    const batch = Array.from({ length: count }, (_, i) => ({ ...comment('こんにちは', 'shitaraba'), externalId: `board:thread:${11 + i}` }));
    if (count === 0) batch.push({ ...comment('別のコメント', 'shitaraba'), externalId: 'board:thread:11' });
    for (const row of batch) c.observeRaw('shitaraba', row.externalId, 'AI'); c.observeShitarabaBatch(batch); for (const row of batch) c.comment(row);
    await vi.advanceTimersByTimeAsync(0); expect(c.view().services.shitaraba.ready).toBe(count === 1); expect(memory()).toHaveLength(1);
    expect(c.view().services.shitaraba.latest?.externalId).toBe(count === 1 ? 'board:thread:11' : undefined);
  });
  it.each([
    { name: '', count: 1, ready: true },
    { name: '', count: 2, ready: false },
    { name: '', count: 0, ready: false },
    { name: 'AI', count: 1, ready: false },
  ])('したらば投稿名「$name」で掲示板の既定名が$count件返る場合は一意性を確認する', async ({ name, count, ready }) => {
    const { c, settings, post, memory } = await setup();
    settings.participants.youtube.enabled = false;
    settings.participants.shitaraba = { enabled: true, personaId: 'p' }; settings.shitarabaName = name;
    c.connection('shitaraba', 'thread', true); await c.configure(settings); c.progress(45);
    post.mockImplementation(async (_s, _t, _text, _settings, _signal, send) => { await send(); return undefined; });
    await vi.advanceTimersByTimeAsync(60000);
    const batch = Array.from({ length: count }, (_, i) => ({ ...comment('こんにちは', 'shitaraba'), externalId: `board:thread:${46 + i}` }));
    if (!count) batch.push({ ...comment('別の本文', 'shitaraba'), externalId: 'board:thread:46' });
    // The identical older comment must not count as a second candidate.
    batch.unshift({ ...comment('こんにちは', 'shitaraba'), externalId: 'board:thread:45', initialHistory: true });
    for (const row of batch) c.observeRaw('shitaraba', row.externalId, '緑さん');
    c.observeShitarabaBatch(batch); for (const row of batch) c.comment(row);
    await vi.advanceTimersByTimeAsync(0);
    expect(c.view().services.shitaraba.ready).toBe(ready);
    expect(c.view().services.shitaraba.latest?.externalId).toBe(ready ? 'board:thread:46' : undefined);
    expect(memory()).toHaveLength(1);
  });
  it('初回だけ無発話で挨拶し、その後は新しい発話を待つ。自己投稿は記憶を二重化しない', async () => {
    const { c, generate, post, memory } = await setup();
    await vi.advanceTimersByTimeAsync(60000); expect(post).toHaveBeenCalledTimes(1); expect(generate.mock.calls[0][3]).toBe(true);
    c.comment({ ...comment('こんにちは'), externalId: 'post-1' }); expect(memory()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(120000); expect(post).toHaveBeenCalledTimes(1);
    generate.mockResolvedValue('お話の続きですね'); c.speech('配信者の発話', 'speech-1'); await vi.advanceTimersByTimeAsync(1499); expect(post).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(post).toHaveBeenCalledTimes(2); expect(generate.mock.calls[1][3]).toBe(false);
  });
  it('AI不参加サービスの新着でも待ち直し、初回履歴では待ち直さない', async () => {
    const { c, post } = await setup(); await vi.advanceTimersByTimeAsync(30000);
    c.comment({ ...comment(), initialHistory: true }); c.comment(comment('新しい会話', 'twitch'));
    await vi.advanceTimersByTimeAsync(59999); expect(post).not.toHaveBeenCalled(); await vi.advanceTimersByTimeAsync(1); expect(post).toHaveBeenCalledTimes(1);
  });
  it('生成中の新着で取り消し、遅れて生成結果が届いても投稿しない', async () => {
    const { c, generate, post } = await setup(); const pending = deferred<string>(); generate.mockReturnValueOnce(pending.promise);
    await vi.advanceTimersByTimeAsync(60000); c.comment(comment()); pending.resolve('古い文章'); await vi.advanceTimersByTimeAsync(0);
    expect(post).not.toHaveBeenCalled(); await vi.advanceTimersByTimeAsync(60000); expect(post).toHaveBeenCalledTimes(1);
  });
  it('投稿前のログ保存中に停止された本文を削除して送信しない', async () => {
    const { c, store, logs } = await setup(); const pending = deferred<void>();
    vi.mocked(store.log).mockImplementationOnce(async a => { logs.push(structuredClone(a)); await pending.promise; });
    await vi.advanceTimersByTimeAsync(60000); await c.stop(); pending.resolve(); await vi.advanceTimersByTimeAsync(0);
    expect(store.discardAttempt).toHaveBeenCalledOnce(); expect(logs).toEqual([]); expect(c.view().services.youtube.latest).toBeNull();
  });
  it('送信済み要求の結果は記録するが、削除した記憶を復活させない', async () => {
    const { c, post, logs, memory } = await setup(); const pending = deferred<string>();
    post.mockImplementationOnce(async (_s, _t, _text, _settings, _signal, send) => { await send(); return pending.promise; });
    await vi.advanceTimersByTimeAsync(60000); await c.clearMemory(); pending.resolve('post-1'); await vi.advanceTimersByTimeAsync(0);
    expect(logs.at(-1)?.result).toBe('succeeded'); expect(memory()).toEqual([]);
  });
  it('生成開始後に届いた発話で旧文章を取消し、通常待機後の最新文脈で生成する', async () => {
    const { c, generate, post } = await setup(); const pending = deferred<string>(); generate.mockReturnValueOnce(pending.promise);
    await vi.advanceTimersByTimeAsync(60000); c.speech('生成中の発話', 'new'); pending.resolve('こんにちは'); await vi.advanceTimersByTimeAsync(0);
    expect(generate.mock.calls[0][4].aborted).toBe(true); expect(post).not.toHaveBeenCalled();
    generate.mockResolvedValue('次のお話'); await vi.advanceTimersByTimeAsync(59999); expect(post).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(post).toHaveBeenCalledOnce();
    expect(generate.mock.calls[0][2]).toEqual([]); expect(generate.mock.calls[1][2].some(r => r.id === 'new')).toBe(true);
  });
  it('投稿前のログ保存中の発話開始で本文を破棄し、サービスの障害にしない', async () => {
    const { c, store, post, logs } = await setup(); const pending = deferred<void>(); let sends = 0;
    vi.mocked(store.log).mockImplementationOnce(async a => { logs.push(structuredClone(a)); await pending.promise; });
    post.mockImplementation(async (_s, _t, _text, _settings, _signal, send) => { await send(); sends++; return 'sent'; });
    await vi.advanceTimersByTimeAsync(60000); c.recognition(true, 'speechDetected'); pending.resolve(); await vi.advanceTimersByTimeAsync(0);
    expect(sends).toBe(0); expect(store.discardAttempt).toHaveBeenCalledOnce(); expect(logs).toEqual([]);
    expect(c.view().services.youtube.ready).toBe(true); expect(c.view().postingBudget.used).toBe(1);
    c.speech('続きの話', 'continued'); c.recognition(true, 'listening');
    await vi.advanceTimersByTimeAsync(60000); expect(sends).toBe(1);
  });
  it('送信開始後の発話は結果記録を取り消さず、新しい発話だけを次の生成に残す', async () => {
    const { c, post, generate, logs, memory } = await setup(); const result = deferred<string>();
    c.speech('送信に使う発話', 'old');
    post.mockImplementationOnce(async (_s, _t, _text, _settings, _signal, send) => { await send(); return result.promise; });
    await vi.advanceTimersByTimeAsync(60000); c.recognition(true, 'speechDetected'); c.speech('送信後の新しい話', 'new');
    result.resolve('post-1'); await vi.advanceTimersByTimeAsync(0);
    expect(logs.at(-1)?.result).toBe('succeeded'); expect(memory().filter(r => r.role === 'ai')).toHaveLength(1);
    expect(c.view().services.youtube.ready).toBe(true);
    c.recognition(true, 'listening'); generate.mockResolvedValue('新しい話への返事');
    await vi.advanceTimersByTimeAsync(60000); expect(post).toHaveBeenCalledTimes(2); expect(generate.mock.calls[1][3]).toBe(false);
    await vi.advanceTimersByTimeAsync(120000); expect(post).toHaveBeenCalledTimes(2);
  });
  it('時間設定変更と接続先変更で旧生成を取り消す', async () => {
    const { c, generate, post, settings } = await setup(); const pending = deferred<string>(); generate.mockReturnValueOnce(pending.promise);
    await vi.advanceTimersByTimeAsync(60000); await c.configure({ ...settings, waitSeconds: 30 }); c.connection('youtube', 'next-video', true);
    pending.resolve('古い文章'); await vi.advanceTimersByTimeAsync(29999); expect(post).not.toHaveBeenCalled(); await vi.advanceTimersByTimeAsync(1);
    expect(post.mock.calls[0][1]).toBe('next-video');
  });
  it('送信枠変更で生成を取り消し、記憶を保持して新しい枠で待ち直す', async () => {
    const { c, generate, post, settings, memory } = await setup();
    c.speech('保存する会話', 'speech');
    const pending = deferred<string>(); generate.mockReturnValueOnce(pending.promise);
    await vi.advanceTimersByTimeAsync(60000);
    await c.configure({ ...settings, contextCharacters: 1000 });
    expect(generate.mock.calls[0][4].aborted).toBe(true);
    pending.resolve('旧設定の文章'); await vi.advanceTimersByTimeAsync(59999);
    expect(post).not.toHaveBeenCalled(); expect(memory().map(r => r.text)).toEqual(['保存する会話']);
    await vi.advanceTimersByTimeAsync(1);
    expect(generate.mock.calls[1][0].contextCharacters).toBe(1000);
    expect(post).toHaveBeenCalledTimes(1);
  });
  it('NG・空文・絶対上限超過を保存せず次の機会まで待つ', async () => {
    const { generate, logs, post } = await setup(); generate.mockResolvedValueOnce('禁止です').mockResolvedValueOnce(' ').mockResolvedValueOnce('あ'.repeat(201));
    await vi.advanceTimersByTimeAsync(180000); expect(generate).toHaveBeenCalledTimes(3); expect(post).not.toHaveBeenCalled(); expect(logs).toEqual([]);
  });
  it('発言文字数の目標を超えても絶対上限以内なら投稿する', async () => {
    const { generate, post } = await setup(); generate.mockResolvedValueOnce('あ'.repeat(61));
    await vi.advanceTimersByTimeAsync(60000);
    expect(post).toHaveBeenCalledOnce(); expect(post.mock.calls[0][2]).toHaveLength(61);
  });
  describe.each([
    ['通常の日本語', 'あ'],
    ['単一の絵文字', '😀'],
    ['ZWJ結合絵文字', '👩‍💻'],
    ['肌色付き絵文字', '👍🏽'],
    ['異体字セレクター付き絵文字', '✈\uFE0F'],
    ['国旗絵文字', '🇯🇵'],
    ['結合濁点付き文字', 'か\u3099'],
  ])('%sの見た目上の文字数', (_label, character) => {
    it.each([199, 200, 201])('%i文字を境界どおりに判定し、前後の空白だけを除く', async count => {
      const { c, settings, generate, post, store, logs, memory } = await setup();
      await c.configure({ ...settings, debugPromptLog: true });
      const text = character.repeat(count);
      generate.mockResolvedValueOnce(` \n${text}\t `);
      await vi.advanceTimersByTimeAsync(60_000);

      expect(generate).toHaveBeenCalledOnce();
      if (count <= 200) {
        expect(post).toHaveBeenCalledOnce();
        expect(post.mock.calls[0]?.[2]).toBe(text);
        expect(logs.at(-1)).toMatchObject({ result: 'succeeded', text });
        expect(memory()).toEqual([expect.objectContaining({ role: 'ai', text })]);
        expect(store.logPromptOutcome).not.toHaveBeenCalled();
        expect(c.view().usage?.outcomes).toMatchObject({ succeeded: 1, skipped: 0 });
      } else {
        expect(post).not.toHaveBeenCalled(); expect(logs).toEqual([]); expect(memory()).toEqual([]);
        expect(store.logPromptOutcome).toHaveBeenCalledExactlyOnceWith(expect.any(String), 'length');
        expect(c.view().usage?.outcomes).toMatchObject({ succeeded: 0, skipped: 1 });
      }
    });
  });
  it('生成文の見送り通知を後続の投稿成功後に残さない', async () => {
    const { c, generate, post } = await setup(); generate.mockResolvedValueOnce('禁止です').mockResolvedValueOnce('有効な発言');
    await vi.advanceTimersByTimeAsync(60000); expect(c.view().message).toContain('生成文を見送りました');
    await vi.advanceTimersByTimeAsync(60000); expect(post).toHaveBeenCalledOnce(); expect(c.view().message).toBe('会話を聞いています。');
  });
  it('生成文の見送り理由をデバッグログへ記録する', async () => {
    const { c, settings, generate, store } = await setup(); await c.configure({ ...settings, debugPromptLog: true });
    generate.mockResolvedValueOnce('あ'.repeat(201)); await vi.advanceTimersByTimeAsync(60000);
    expect(store.logPromptOutcome).toHaveBeenCalledWith(expect.any(String), 'length');
  });
  it('一時障害は60秒以上待ち、3回で手動再開待ちにする', async () => {
    const { c, settings, generate } = await setup(); await c.configure({ ...settings, waitSeconds: 30 }); generate.mockRejectedValue(new Error('offline'));
    await vi.advanceTimersByTimeAsync(149999); expect(generate).toHaveBeenCalledTimes(2); await vi.advanceTimersByTimeAsync(1);
    expect(generate).toHaveBeenCalledTimes(3); expect(c.view().status).toBe('attention'); await vi.advanceTimersByTimeAsync(60000); expect(generate).toHaveBeenCalledTimes(3);
  });
  it('利用制限は即時休止し、投稿結果不明は該当サービスだけを止める', async () => {
    const { c, settings, generate, post } = await setup(); generate.mockRejectedValueOnce(new AiServiceError('attention', '利用制限'));
    await vi.advanceTimersByTimeAsync(60000); expect(c.view().status).toBe('attention'); await c.resume();
    settings.participants.twitch = { enabled: true, personaId: 'p' }; c.connection('twitch', 'channel', true); await c.configure(settings);
    post.mockImplementationOnce(async (_s, _t, _text, _settings, _signal, send) => { await send(); throw new Error('timeout'); });
    await vi.advanceTimersByTimeAsync(60000); expect(c.view().services.twitch.latest?.result).toBe('unknown'); expect(c.view().services.youtube.ready).toBe(true);
    await vi.advanceTimersByTimeAsync(60000); expect(c.view().services.youtube.latest?.result).toBe('succeeded');
  });
  it('記憶保存失敗では全体を休止し、復旧時に過去ログを再作成しない', async () => {
    const { c, store, logs } = await setup(); await vi.advanceTimersByTimeAsync(60000); const count = logs.length;
    vi.mocked(store.saveMemory).mockRejectedValueOnce(new Error('disk')); c.speech('新しい発話', 'new'); await vi.advanceTimersByTimeAsync(0);
    expect(c.view().status).toBe('attention'); await c.resume(); expect(logs).toHaveLength(count);
  });
  it('OBS連動の手動停止は切断復旧だけで解除されず、確認済み配信終了後に解除する', async () => {
    const { c, post } = await setup('obs'); await c.observeObs(true, 'streaming'); await c.stop();
    await c.observeObs(false, 'stopped'); await c.observeObs(true, 'streaming'); await vi.advanceTimersByTimeAsync(120000); expect(post).not.toHaveBeenCalled();
    await c.observeObs(true, 'stopped'); await c.observeObs(true, 'streaming'); await vi.advanceTimersByTimeAsync(60000); expect(post).toHaveBeenCalledTimes(1);
  });
});
