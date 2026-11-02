import { expect, it, vi } from 'vitest';
import { AppState } from '../src/main/core/app-state';
import { createDefaultSettings } from '../src/main/core/settings';

it('1回につき1件だけ投入し、押した順に見本を循環して積み上げ上限を守る', () => {
  const settings = createDefaultSettings(); settings.commentOverlay.mode = 'stack'; settings.commentOverlay.stackMaxComments = 3;
  const state = new AppState(settings);
  try {
    for (let index = 0; index < 9; index++) {
      state.receiveTestComments(`press-${index}`);
      expect(state.snapshot().comments).toHaveLength(index + 1);
    }
    expect(state.snapshot().commentOverlay.active.map(item => item.comment.authorName)).toEqual(['テスト7', 'テスト8', 'テスト1']);
    expect(state.snapshot().commentOverlay.active.every(item => item.expiresAt === null)).toBe(true);
    expect(state.snapshot().comments[8].content).toEqual(state.snapshot().comments[0].content);
    const restarted = new AppState(settings);
    try { restarted.receiveTestComments('restart'); expect(restarted.snapshot().comments[0].authorName).toBe('テスト1'); }
    finally { restarted.dispose(); }
  } finally { state.dispose(); }
});
it('1件表示では通常キュー・保存済み表示時間を使う', () => {
  const state = new AppState(createDefaultSettings());
  try {
    state.receiveTestComments('single');
    expect(state.snapshot().commentOverlay.active).toHaveLength(1);
    expect(state.snapshot().commentOverlay.queue).toHaveLength(0);
    state.receiveTestComments('second');
    expect(state.snapshot().comments).toHaveLength(2);
    expect(state.snapshot().commentOverlay.queue).toHaveLength(1);
    expect(state.snapshot().commentOverlay.queue[0].authorName).toBe('テスト2');
  } finally { state.dispose(); }
});
it('フィルターと文字演出も通常の受信設定どおり適用する', () => {
  const settings = createDefaultSettings(); settings.commentFilter.ngWords = ['長め'];
  const state = new AppState(settings); const triggers: unknown[] = [];
  state.subscribe(event => { if (event.type === 'textEffects.triggered') triggers.push(event.payload); });
  try {
    for (let index = 0; index < 8; index++) state.receiveTestComments(`filter-${index}`);
    expect(state.snapshot().comments).toHaveLength(7);
    expect(state.snapshot().comments.some(item => item.authorName === 'テスト3')).toBe(false);
    expect(triggers).toHaveLength(1);
    expect(triggers[0]).toMatchObject({ items: Array(3).fill({ text: '草' }) });
  } finally { state.dispose(); }
});
it('読み上げONでは通常の音声合成を呼び出す', async () => {
  const settings = createDefaultSettings(); settings.commentOverlay.mode = 'stack'; settings.commentSpeech.enabled = true;
  settings.commentSpeech.voice = { speakerUuid: 'speaker', styleId: 1 };
  const synthesize = vi.fn(async () => Buffer.from('wav'));
  const state = new AppState(settings, { speechSynthesizer: { prepare: async () => {}, listVoices: async () => [{ speakerUuid: 'speaker', name: '話者', styles: [{ id: 1, name: '通常' }] }], synthesize }, audioPlayer: { play: async () => {}, stop: () => {} } });
  try { state.receiveTestComments('speech'); await vi.waitFor(() => expect(synthesize).toHaveBeenCalled()); }
  finally { await state.shutdown(); }
});
