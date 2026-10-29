import { describe, expect, it, vi } from 'vitest';
import { createDefaultSettings } from '../src/main/core/settings';
import { ShitarabaNextThreadController, type ShitarabaNextThreadControllerDependencies } from '../src/main/shitaraba/shitaraba-next-thread-controller';
import { BoardWriteFailure } from '../src/main/board/board-write-adapter';

const currentUrl = 'https://bbs.jpnkn.com/test/read.cgi/clarahas/123/';
const nextUrl = 'https://bbs.jpnkn.com/test/read.cgi/clarahas/456/';
type Writer = ShitarabaNextThreadControllerDependencies['writer'];

function settings(threadUrl = currentUrl) {
  const value = structuredClone(createDefaultSettings().sources.shitaraba);
  value.threadUrl = threadUrl;
  value.nextThread = { ...value.nextThread, enabled: true, createAtResponseNumber: 950, switchAtResponseNumber: 1000,
    titleMode: 'manual', manualTitle: '配信10', bodyMode: 'manual', manualBody: '本文', authorName: '配信者', email: 'sage' };
  return value;
}

function setup(overrides: Partial<Writer> = {}, source = settings(), extra: Partial<ShitarabaNextThreadControllerDependencies> = {}) {
  const writer: Writer = {
    fetchThreadContent: vi.fn(async () => ({ title: '配信09', body: '1レス目' })),
    findThreadsByTitle: vi.fn(async () => []),
    createNextThread: vi.fn(async () => ({ threadUrl: nextUrl })),
    announceNextThread: vi.fn(async () => undefined),
    ...overrides,
  };
  const dependencies = { writer, onState: vi.fn(), onCreatedAnnouncement: vi.fn(), onSwitchedAnnouncement: vi.fn(),
    switchThread: vi.fn(async () => undefined), delay: vi.fn(async () => undefined), ...extra };
  return { controller: new ShitarabaNextThreadController(source, dependencies), writer, dependencies };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('共通掲示板次スレッド制御', () => {
  it('切替中に新しい現行スレッドも切替番号へ到達した場合は前の切替完了後に評価する', async () => {
    const thirdUrl = 'https://bbs.jpnkn.com/test/read.cgi/clarahas/789/';const source = settings();
    const { controller, writer, dependencies } = setup({
      findThreadsByTitle: vi.fn(async thread => thread.threadId === '123' ? [nextUrl] : thread.threadId === '456' ? [thirdUrl] : []),
    }, source);
    dependencies.switchThread.mockImplementation(async url => {
      await controller.updateSettings({ ...source, threadUrl: url });
      controller.observeResponseNumber(url === nextUrl ? 1000 : 1);
    });
    await controller.initialize();controller.observeResponseNumber(1000);await controller.waitForIdle();
    expect(dependencies.switchThread).toHaveBeenCalledTimes(2);
    expect(dependencies.switchThread).toHaveBeenLastCalledWith(thirdUrl);
    expect(writer.createNextThread).not.toHaveBeenCalled();controller.dispose();
  });
  it('旧スレッドの案内待機中に新スレッドが作成番号へ到達しても待機完了後に作成する', async () => {
    const pending = deferred<void>();const source = settings();
    Object.assign(source.nextThread, { titleMode: 'auto', createAtResponseNumber: 4, switchAtResponseNumber: 6, announceCurrentThread: true });
    const { controller, writer, dependencies } = setup({
      fetchThreadContent: vi.fn(async thread => ({ title: thread.threadId === '123' ? '配信09' : '配信10', body: '本文' })),
      createNextThread: vi.fn().mockResolvedValueOnce({ threadUrl: nextUrl }).mockResolvedValue({ threadUrl: 'https://bbs.jpnkn.com/test/read.cgi/clarahas/789/' }),
    }, source, { delay: vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(undefined) });
    dependencies.switchThread.mockImplementation(async () => {
      await controller.updateSettings({ ...source, threadUrl: nextUrl });controller.observeResponseNumber(4);
    });
    await controller.initialize();const first = controller.createNow();
    await vi.waitFor(() => expect(controller.snapshot().status).toBe('created'));
    controller.observeResponseNumber(6);
    await vi.waitFor(() => expect(controller.snapshot()).toMatchObject({ status: 'monitoring', maxResponseNumber: 4 }));
    pending.resolve();await first;await controller.waitForIdle();
    expect(writer.createNextThread).toHaveBeenCalledTimes(2);
    expect(writer.createNextThread).toHaveBeenLastCalledWith(expect.objectContaining({ title: '配信11' }));controller.dispose();
  });
  it('作成するレス番号を取得済み最大番号まで下げると追加レスを待たず作成する', async () => {
    const source = settings();const { controller, writer } = setup({}, source);
    await controller.initialize();controller.observeResponseNumber(900);
    await controller.updateSettings({ ...source, nextThread: { ...source.nextThread, createAtResponseNumber: 900 } });
    expect(writer.createNextThread).toHaveBeenCalledOnce();
    expect(controller.snapshot().status).toBe('created');controller.dispose();
  });
  it('作成済みで切替レス番号を取得済み最大番号まで下げると追加レスを待たず切り替える', async () => {
    const source = settings();const { controller, dependencies } = setup({}, source);
    await controller.initialize();controller.observeResponseNumber(950);await controller.waitForIdle();
    expect(dependencies.switchThread).not.toHaveBeenCalled();
    await controller.updateSettings({ ...source, nextThread: { ...source.nextThread, switchAtResponseNumber: 950 } });
    expect(dependencies.switchThread).toHaveBeenCalledExactlyOnceWith(nextUrl);controller.dispose();
  });
  it('作成の送信中と完了後は送信したタイトルと本文を確認できる', async () => {
    const pending = deferred<{ threadUrl: string }>();const source = settings();
    const { controller, writer } = setup({ createNextThread: vi.fn(() => pending.promise) }, source);
    await controller.initialize();const creating = controller.createNow();await vi.waitFor(() => expect(writer.createNextThread).toHaveBeenCalledOnce());
    const changed = { ...source, nextThread: { ...source.nextThread, manualTitle: '次回のタイトル', manualBody: '次回の本文' } };
    await controller.updateSettings(changed);
    expect(controller.snapshot()).toMatchObject({ status: 'creating', plannedTitle: '配信10', plannedBody: '本文' });
    pending.resolve({ threadUrl: nextUrl });await creating;await controller.updateSettings(changed);
    expect(controller.snapshot()).toMatchObject({ status: 'created', plannedTitle: '配信10', plannedBody: '本文' });controller.dispose();
  });
  it('送信中に投稿者設定を編集しても作成とURL案内は同じ投稿者情報を使う', async () => {
    const pending = deferred<{ threadUrl: string }>();const source = settings();source.nextThread.announceCurrentThread = true;
    const { controller, writer } = setup({ createNextThread: vi.fn(() => pending.promise) }, source);
    await controller.initialize();const creating = controller.createNow();await vi.waitFor(() => expect(writer.createNextThread).toHaveBeenCalledOnce());
    await controller.updateSettings({ ...source, nextThread: { ...source.nextThread, authorName: '新しい名前', email: 'new' } });
    pending.resolve({ threadUrl: nextUrl });await creating;
    expect(writer.announceNextThread).toHaveBeenCalledWith(expect.objectContaining({ authorName: '配信者', email: 'sage' }));controller.dispose();
  });
  it('結果不明から登録した場合も作成試行の内容と投稿者情報を引き継ぐ', async () => {
    const source = settings();source.nextThread.announceCurrentThread = true;
    const { controller, writer } = setup({ createNextThread: vi.fn(async () => { throw new BoardWriteFailure('uncertain', '結果不明'); }) }, source);
    await controller.initialize();await expect(controller.createNow()).rejects.toThrow();
    await controller.updateSettings({ ...source, nextThread: { ...source.nextThread, manualTitle: '次回用タイトル', manualBody: '次回用本文', authorName: '次回用名前', email: 'new' } });
    await controller.resolve({ outcome: 'created', threadUrl: nextUrl });
    expect(controller.snapshot()).toMatchObject({ status: 'created', plannedTitle: '配信10', plannedBody: '本文' });
    expect(writer.announceNextThread).toHaveBeenCalledWith(expect.objectContaining({ authorName: '配信者', email: 'sage' }));controller.dispose();
  });
  it('自動作成の送信中にオフへ変更しても作成中の実状態を保持する', async () => {
    const pending = deferred<{ threadUrl: string }>();
    const source = settings();const { controller, writer } = setup({ createNextThread: vi.fn(() => pending.promise) }, source);
    await controller.initialize();controller.observeResponseNumber(950);
    await vi.waitFor(() => expect(writer.createNextThread).toHaveBeenCalledOnce());
    await controller.updateSettings({ ...source, nextThread: { ...source.nextThread, enabled: false } });
    expect(controller.snapshot().status).toBe('creating');
    pending.resolve({ threadUrl: nextUrl });await controller.waitForIdle();
    expect(controller.snapshot()).toMatchObject({ status: 'created', nextThreadUrl: nextUrl });
    expect(writer.createNextThread).toHaveBeenCalledOnce();controller.dispose();
  });
  it('終了時は所有する30秒の案内タイマーを解除して投稿を開始しない', async () => {
    vi.useFakeTimers();
    try {
      const source = settings(); source.nextThread.announceCurrentThread = true;
      const { controller, writer } = setup({}, source, { delay: undefined });
      await controller.initialize();
      controller.observeResponseNumber(950);
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.getTimerCount()).toBe(1);
      controller.dispose();
      expect(vi.getTimerCount()).toBe(0);
      await controller.waitForIdle();
      expect(writer.announceNextThread).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it('jpnknの最大レス番号が閾値を飛び越えた時に一度だけ作成する', async () => {
    const { controller, writer, dependencies } = setup();
    await controller.initialize();
    controller.observeResponseNumber(949);
    expect(writer.createNextThread).not.toHaveBeenCalled();
    controller.observeResponseNumber(951);
    await controller.waitForIdle();
    controller.observeResponseNumber(999);
    await controller.waitForIdle();
    expect(writer.createNextThread).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      currentThread: expect.objectContaining({ service: 'jpnkn', boardId: 'clarahas', threadId: '123' }),
      title: '配信10', body: '本文', authorName: '配信者', email: 'sage',
    }));
    expect(controller.snapshot()).toMatchObject({ status: 'created', nextThreadUrl: nextUrl, maxResponseNumber: 999 });
    expect(dependencies.onCreatedAnnouncement).toHaveBeenCalledOnce();
  });

  it('ブラウザ作成が必要な状態は設定変更・OFF・同じURLの再確認でも解除しない', async () => {
    const createNextThread = vi.fn(async () => { throw new BoardWriteFailure('browserRequired', 'ブラウザで作成してください。'); });
    const { controller, dependencies } = setup({ createNextThread });
    await controller.initialize();
    await expect(controller.createNow()).rejects.toThrow('ブラウザ');
    const changed = settings();
    changed.nextThread = { ...changed.nextThread, enabled: false, manualTitle: '別タイトル', announceCurrentThread: true };
    await controller.updateSettings(changed);
    await controller.updateSettings({ ...changed, nextThread: { ...changed.nextThread, enabled: true } });
    controller.observeResponseNumber(1100);
    await controller.waitForIdle();
    expect(controller.snapshot().status).toBe('browserRequired');
    await expect(controller.createNow()).rejects.toThrow();
    await expect(controller.resolve({ outcome: 'notCreated' })).rejects.toThrow('ブラウザ');
    expect(createNextThread).toHaveBeenCalledOnce();
    expect(dependencies.onCreatedAnnouncement).not.toHaveBeenCalled();
    expect(dependencies.switchThread).not.toHaveBeenCalled();
  });

  it('ブラウザ作成後の登録は同一サービス・同一板の別URLだけを許可し、案内POSTを省略する', async () => {
    const source = settings(); source.nextThread.announceCurrentThread = true;
    const createNextThread = vi.fn(async () => { throw new BoardWriteFailure('browserRequired', 'ブラウザで作成してください。'); });
    const { controller, writer, dependencies } = setup({ createNextThread }, source);
    await controller.initialize();
    await expect(controller.createNow()).rejects.toThrow();
    for (const threadUrl of [currentUrl, 'https://bbs.jpnkn.com/test/read.cgi/other/456/',
      'https://jbbs.shitaraba.net/bbs/read.cgi/game/123/456/', 'http://bbs.jpnkn.com/test/read.cgi/clarahas/456/']) {
      await expect(controller.resolve({ outcome: 'created', threadUrl })).rejects.toThrow();
    }
    controller.observeResponseNumber(1100);
    await controller.resolve({ outcome: 'created', threadUrl: nextUrl });
    expect(controller.snapshot()).toMatchObject({ status: 'created', nextThreadUrl: nextUrl, message: expect.stringContaining('案内は省略') });
    expect(writer.announceNextThread).not.toHaveBeenCalled();
    expect(dependencies.delay).not.toHaveBeenCalled();
    expect(dependencies.onCreatedAnnouncement).toHaveBeenCalledOnce();
    expect(dependencies.switchThread).toHaveBeenCalledExactlyOnceWith(nextUrl);
    expect(dependencies.onSwitchedAnnouncement).toHaveBeenCalledOnce();
    expect(source.nextThread.announceCurrentThread).toBe(true);
  });

  it('結果不明からのjpnkn URL登録でも30秒待って一度だけ案内する', async () => {
    const source = settings(); source.nextThread.announceCurrentThread = true;
    const { controller, writer, dependencies } = setup({ createNextThread: vi.fn(async () => {
      throw new BoardWriteFailure('uncertain', '結果不明');
    }) }, source);
    await controller.initialize();
    await expect(controller.createNow()).rejects.toThrow('作成を確認できません');
    await controller.resolve({ outcome: 'created', threadUrl: nextUrl });
    expect(dependencies.delay).toHaveBeenCalledExactlyOnceWith(30_000);
    expect(writer.announceNextThread).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      currentThread: expect.objectContaining({ service: 'jpnkn', threadId: '123' }), message: `次スレッドはこちらです。\n${nextUrl}`,
    }));
    expect(controller.snapshot()).toMatchObject({ status: 'created', nextThreadUrl: nextUrl });
  });

  it('jpnknの案内は30秒後に旧スレッドへ一度だけ送り、待機中の成功音声と到達済み切替を待たせない', async () => {
    vi.useFakeTimers();
    try {
      const source = settings(); source.nextThread.announceCurrentThread = true;
      const { controller, writer, dependencies } = setup({}, source, { delay: undefined });
      await controller.initialize();
      controller.observeResponseNumber(950);
      await vi.advanceTimersByTimeAsync(0);
      expect(controller.snapshot()).toMatchObject({ status: 'created', nextThreadUrl: nextUrl });
      expect(dependencies.onCreatedAnnouncement).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(writer.announceNextThread).not.toHaveBeenCalled();
      controller.observeResponseNumber(1000);
      await vi.advanceTimersByTimeAsync(0);
      expect(dependencies.switchThread).toHaveBeenCalledExactlyOnceWith(nextUrl);
      expect(dependencies.onSwitchedAnnouncement).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(24_999);
      expect(writer.announceNextThread).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await controller.waitForIdle();
      expect(writer.announceNextThread).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        currentThread: expect.objectContaining({ service: 'jpnkn', threadId: '123' }),
        message: `次スレッドはこちらです。\n${nextUrl}`,
      }));
      controller.observeResponseNumber(1001);
      await controller.waitForIdle();
      expect(writer.createNextThread).toHaveBeenCalledOnce();
      expect(writer.announceNextThread).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });

  it('同名確認の待機中に接続先が変わった場合は旧スレッドの作成を送信しない', async () => {
    const pending = deferred<string[]>();
    const findThreadsByTitle = vi.fn().mockResolvedValueOnce([]).mockReturnValueOnce(pending.promise).mockResolvedValue([]);
    const { controller, writer } = setup({ findThreadsByTitle });
    await controller.initialize();
    const creation = controller.createNow();
    const rejected = expect(creation).rejects.toThrow('接続先が変更');
    await vi.waitFor(() => expect(findThreadsByTitle).toHaveBeenCalledTimes(2));
    await controller.updateSettings(settings('https://bbs.jpnkn.com/test/read.cgi/clarahas/789/'));
    pending.resolve([]);
    await rejected;
    expect(writer.createNextThread).not.toHaveBeenCalled();
    expect(controller.snapshot()).toMatchObject({ status: 'monitoring', nextThreadUrl: null });
  });

  it.each(['browserRequired', 'success'] as const)('別URLから元へ戻っても旧世代の%s結果を反映しない', async kind => {
    const pending = deferred<{ threadUrl: string }>();
    const createNextThread = vi.fn(() => pending.promise);
    const { controller, dependencies } = setup({ createNextThread });
    await controller.initialize();
    const creation = controller.createNow();
    const rejected = expect(creation).rejects.toThrow('接続先が変更');
    await vi.waitFor(() => expect(createNextThread).toHaveBeenCalledOnce());
    await controller.updateSettings(settings('https://bbs.jpnkn.com/test/read.cgi/clarahas/789/'));
    await controller.updateSettings(settings());
    if (kind === 'success') pending.resolve({ threadUrl: nextUrl });
    else pending.reject(new BoardWriteFailure('browserRequired', 'ブラウザで作成してください。'));
    await rejected;
    expect(controller.snapshot()).toMatchObject({ status: 'monitoring', nextThreadUrl: null, message: null });
    expect(dependencies.onCreatedAnnouncement).not.toHaveBeenCalled();
    expect(dependencies.switchThread).not.toHaveBeenCalled();
  });

  it('作成内容の古い取得結果で新スレッドのプレビューを上書きしない', async () => {
    const pending = deferred<{ title: string; body: string }>();
    const source = settings(); source.nextThread.titleMode = 'auto'; source.nextThread.bodyMode = 'auto';
    const fetchThreadContent = vi.fn().mockResolvedValueOnce({ title: '配信09', body: '最初の本文' })
      .mockReturnValueOnce(pending.promise).mockResolvedValue({ title: '配信19', body: '新しい本文' });
    const { controller, writer } = setup({ fetchThreadContent }, source);
    await controller.initialize();
    const creation = controller.createNow();
    const rejected = expect(creation).rejects.toThrow('接続先が変更');
    await vi.waitFor(() => expect(fetchThreadContent).toHaveBeenCalledTimes(2));
    await controller.updateSettings({ ...source, threadUrl: 'https://bbs.jpnkn.com/test/read.cgi/clarahas/789/' });
    pending.resolve({ title: '配信99', body: '古い本文' });
    await rejected;
    expect(controller.snapshot()).toMatchObject({ status: 'monitoring', plannedTitle: '配信20', plannedBody: '新しい本文' });
    expect(writer.createNextThread).not.toHaveBeenCalled();
  });

  it.each(['success', 'failure'] as const)('旧接続先の切替%sが別スレッドの状態や音声へ反映されない', async kind => {
    const pending = deferred<void>();
    const source = settings(); source.nextThread.enabled = false;
    const switchThread = vi.fn(() => pending.promise);
    const { controller, dependencies } = setup({}, source, { switchThread });
    await controller.initialize();
    controller.observeResponseNumber(1100);
    const creation = controller.createNow();
    await vi.waitFor(() => expect(switchThread).toHaveBeenCalledOnce());
    await controller.updateSettings({ ...source, threadUrl: 'https://bbs.jpnkn.com/test/read.cgi/clarahas/789/' });
    if (kind === 'success') pending.resolve();
    else pending.reject(new Error('切替失敗'));
    await creation;
    expect(controller.snapshot()).toMatchObject({ status: 'manualReady', nextThreadUrl: null, message: null });
    expect(dependencies.onSwitchedAnnouncement).not.toHaveBeenCalled();
  });

  it('作成成功の読み上げに失敗してもURL案内と閾値切替を継続する', async () => {
    const source = settings(); source.nextThread.enabled = false; source.nextThread.announceCurrentThread = true;
    const { controller, writer, dependencies } = setup({}, source, {
      onCreatedAnnouncement: vi.fn(() => { throw new Error('音声故障'); }),
    });
    await controller.initialize();
    controller.observeResponseNumber(1100);
    await expect(controller.createNow()).resolves.toBeUndefined();
    expect(controller.snapshot()).toMatchObject({ status: 'created', nextThreadUrl: nextUrl });
    expect(writer.announceNextThread).toHaveBeenCalledOnce();
    expect(dependencies.switchThread).toHaveBeenCalledExactlyOnceWith(nextUrl);
  });
});
