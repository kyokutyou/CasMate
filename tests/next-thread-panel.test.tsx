// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { createDefaultSettings } from '../src/main/core/settings';
import type { ShitarabaNextThreadSettings, ShitarabaNextThreadState } from '../src/shared/types';
import { NextThreadPanel } from '../src/renderer/components/NextThreadPanel';

const threadUrl = 'https://jbbs.shitaraba.net/bbs/read.cgi/game/123/456/';
const state: ShitarabaNextThreadState = { status: 'manualReady', maxResponseNumber: 900, remainingResponses: 50,
  plannedTitle: '配信10', plannedBody: '案内本文', nextThreadUrl: null, message: null, updatedAt: '2026-09-17T00:00:00Z' };
function setup(overrides: Partial<Parameters<typeof NextThreadPanel>[0]> = {}) {
  const onChange = vi.fn(); const onCreate = vi.fn(async () => {}); const onResolve = vi.fn(async () => {}); const onSuccess = vi.fn();
  function Harness() {
    const [settings, setSettings] = useState(createDefaultSettings().sources.shitaraba.nextThread);
    const change = (value: ShitarabaNextThreadSettings) => { onChange(value); setSettings(value); };
    return <NextThreadPanel settings={settings} state={state} threadUrl={threadUrl} synchronized
      onChange={change} onSave={async value => change(value)} onCreate={onCreate} onResolve={onResolve} onSuccess={onSuccess} {...overrides} />;
  }
  const view = render(<Harness />); return { ...view, onChange, onCreate, onResolve, onSuccess };
}
afterEach(cleanup);
it.each([
  ['手動タイトル', 'タイトル', { titleMode: 'auto' as const }],
  ['手動本文', '本文', { bodyMode: 'auto' as const }],
  ['案内文', '現行スレッドにURLを投稿', { announceCurrentThread: false }],
])('外部更新で%sが閉じた場合は対応する操作へフォーカスを戻す', (label, fallback, changed) => {
  const settings = { ...createDefaultSettings().sources.shitaraba.nextThread, titleMode: 'manual' as const, bodyMode: 'manual' as const, announceCurrentThread: true };
  const props = { settings, state, threadUrl, synchronized: true, onChange: vi.fn(), onSave: vi.fn(async () => {}), onCreate: vi.fn(async () => {}), onResolve: vi.fn(async () => {}), onSuccess: vi.fn() };
  const view = render(<NextThreadPanel {...props} />);
  act(() => screen.getByLabelText(label).focus());
  view.rerender(<NextThreadPanel {...props} settings={{ ...settings, ...changed }} />);
  expect(screen.getByLabelText(fallback)).toHaveFocus();
});
it('入力から別の操作へ移動済みなら外部更新でフォーカスを奪わない', () => {
  const settings = { ...createDefaultSettings().sources.shitaraba.nextThread, titleMode: 'manual' as const };
  const props = { settings, state, threadUrl, synchronized: true, onChange: vi.fn(), onSave: vi.fn(async () => {}), onCreate: vi.fn(async () => {}), onResolve: vi.fn(async () => {}), onSuccess: vi.fn() };
  const view = render(<NextThreadPanel {...props} />);
  act(() => { screen.getByLabelText('手動タイトル').focus();screen.getByLabelText('本文').focus(); });
  view.rerender(<NextThreadPanel {...props} settings={{ ...settings, titleMode: 'auto' }} />);
  expect(screen.getByLabelText('本文')).toHaveFocus();
});
it('入力から明示的にフォーカスを外した後は外部更新で再フォーカスしない', () => {
  const settings = { ...createDefaultSettings().sources.shitaraba.nextThread, titleMode: 'manual' as const };
  const props = { settings, state, threadUrl, synchronized: true, onChange: vi.fn(), onSave: vi.fn(async () => {}), onCreate: vi.fn(async () => {}), onResolve: vi.fn(async () => {}), onSuccess: vi.fn() };
  const view = render(<NextThreadPanel {...props} />);
  act(() => { const input = screen.getByLabelText('手動タイトル');input.focus();input.blur(); });
  view.rerender(<NextThreadPanel {...props} settings={{ ...settings, titleMode: 'auto' }} />);
  expect(document.body).toHaveFocus();
});
it('保存済みの編集値を外部更新で元に戻しても過去の入力を復活させない', () => {
  const settings = { ...createDefaultSettings().sources.shitaraba.nextThread, titleMode: 'manual' as const, manualTitle: '元のタイトル' };
  const props = { settings, state, threadUrl, synchronized: true, onChange: vi.fn(), onSave: vi.fn(async () => {}), onCreate: vi.fn(async () => {}), onResolve: vi.fn(async () => {}), onSuccess: vi.fn() };
  const result = render(<NextThreadPanel {...props} />);
  fireEvent.change(screen.getByLabelText('手動タイトル'), { target: { value: '編集したタイトル' } });
  result.rerender(<NextThreadPanel {...props} settings={{ ...settings, manualTitle: '編集したタイトル' }} />);
  result.rerender(<NextThreadPanel {...props} />);
  expect(screen.getByLabelText('手動タイトル')).toHaveValue('元のタイトル');
});
it('旧スレッドの操作失敗を新しい現行スレッドへ持ち越さない', async () => {
  const props = { settings: createDefaultSettings().sources.shitaraba.nextThread, state, threadUrl, synchronized: true, onChange: vi.fn(), onSave: vi.fn(async () => {}), onCreate: vi.fn(async () => { throw new Error('旧スレッドの失敗'); }), onResolve: vi.fn(async () => {}), onSuccess: vi.fn() };
  const result = render(<NextThreadPanel {...props} />);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '今すぐ作成' })));
  expect(screen.getByText('旧スレッドの失敗')).toBeVisible();
  result.rerender(<NextThreadPanel {...props} threadUrl="https://jbbs.shitaraba.net/bbs/read.cgi/game/123/999/" synchronized={false} />);
  expect(screen.queryByText('旧スレッドの失敗')).not.toBeInTheDocument();
  expect(document.querySelector('.next-state-message')).toHaveTextContent('保存・反映を待っています');
});
it('現行スレッドを変更して元のURLへ戻しても遅れた操作エラーを復活させない', async () => {
  let fail!: (error: Error) => void;
  const props = { settings: createDefaultSettings().sources.shitaraba.nextThread, state, threadUrl, synchronized: true, onChange: vi.fn(), onSave: vi.fn(async () => {}), onCreate: vi.fn(() => new Promise<void>((_, reject) => { fail = reject; })), onResolve: vi.fn(async () => {}), onSuccess: vi.fn() };
  const result = render(<NextThreadPanel {...props} />);fireEvent.click(screen.getByRole('button', { name: '今すぐ作成' }));
  result.rerender(<NextThreadPanel {...props} threadUrl="https://jbbs.shitaraba.net/bbs/read.cgi/game/123/999/" />);
  result.rerender(<NextThreadPanel {...props} />);await act(async () => fail(new Error('古い処理のエラー')));
  expect(screen.queryByText('古い処理のエラー')).not.toBeInTheDocument();
});
it('次スレッドへの切替でURLが消えてもブラウザボタンのフォーカスを維持する', () => {
  const props = { settings: createDefaultSettings().sources.shitaraba.nextThread, state: { ...state, status: 'created' as const, nextThreadUrl: 'https://jbbs.shitaraba.net/bbs/read.cgi/game/123/789/' }, threadUrl, synchronized: true,
    onChange: vi.fn(), onSave: vi.fn(async () => {}), onCreate: vi.fn(async () => {}), onResolve: vi.fn(async () => {}), onSuccess: vi.fn() };
  const result = render(<NextThreadPanel {...props} />);const button = screen.getByRole('button', { name: 'ブラウザで開く' });act(() => button.focus());
  result.rerender(<NextThreadPanel {...props} state={state} />);
  expect(button).toHaveFocus();expect(button).not.toBeDisabled();expect(button).toHaveAttribute('aria-disabled', 'true');
});
it.each(['0', '0456', '456/not-a-thread', '456/l0'])('不正なjpnknスレッドURLを正規化して登録しない：%s', async path => {
  const { onResolve } = setup({ threadUrl: 'https://bbs.jpnkn.com/test/read.cgi/clarahas/123/', state: { ...state, status: 'uncertain' } });
  fireEvent.click(screen.getByText('ブラウザで作成・結果を確認'));
  fireEvent.change(screen.getByLabelText('作成済み次スレッドURL'), { target: { value: `https://bbs.jpnkn.com/test/read.cgi/clarahas/${path}/` } });
  const button = screen.getByRole('button', { name: '作成済みURLを登録' });expect(button).toBeDisabled();
  await act(async () => fireEvent.click(button));expect(onResolve).not.toHaveBeenCalled();
});
it('古い状態メッセージがあっても保存・反映待ちを説明する', () => {
  setup({ synchronized: false, state: { ...state, status: 'inputRequired', message: '以前のタイトルを確認してください。' } });
  expect(document.querySelector('.next-state-message')).toHaveTextContent('保存・反映を待っています');
});
it.each([
  [threadUrl, 5], ['https://bbs.jpnkn.com/test/read.cgi/clarahas/123/', 30],
] as const)('案内オンで現行サービスに合う待機秒数を表示する: %s', async (currentUrl, seconds) => {
  setup({ threadUrl: currentUrl });
  expect(screen.queryByText(/秒後に1回投稿します/)).toBeNull();
  await act(async () => fireEvent.click(screen.getByRole('switch', { name: '現行スレッドにURLを投稿' })));
  expect(screen.getByText(`作成成功から${seconds}秒後に1回投稿します。`)).toBeVisible();
  expect(screen.getByLabelText('案内文')).toBeVisible();
});
it('設定と確認を分けて全項目と予定内容を提示する', () => {
  setup();
  expect(screen.getAllByRole('heading', { level: 3 }).map(node => node.textContent)).toEqual(['作成の設定', '作成予定']);
  expect(screen.getByRole('combobox', { name: 'タイトル' })).toHaveDisplayValue('末尾の番号を +1');
  expect(screen.getByRole('combobox', { name: '本文' })).toHaveDisplayValue('1レス目を引き継ぐ');
  expect(screen.getByRole('switch', { name: '次スレッド自動作成' })).toHaveAttribute('aria-checked', 'false');
  expect(screen.getByLabelText('作成予定タイトル')).toHaveValue('配信10');
  expect(screen.getByRole('button', { name: '今すぐ作成' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'URLをコピー' })).toBeDisabled();
});
it('自動作成の設定と稼働状態を区別し、オフでも手動作成できる', async () => {
  const { onCreate, onResolve } = setup();
  expect(screen.getByText('自動作成はオフ')).toBeVisible();
  expect(screen.getByText('自動作成がオフでも使えます。')).toBeVisible();
  expect(screen.getByRole('button', { name: '今すぐ作成' })).toBeEnabled();
  await act(async () => fireEvent.click(screen.getByRole('switch', { name: '次スレッド自動作成' })));
  expect(screen.getByRole('switch', { name: '次スレッド自動作成' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByText('残り 50 レス')).toBeVisible();
  fireEvent.change(screen.getByRole('spinbutton', { name: '作成するレス番号' }), { target: { value: '5' } });
  expect(screen.getByText('手動作成できます')).toBeVisible();
  await act(async () => fireEvent.click(screen.getByRole('switch', { name: '次スレッド自動作成' })));
  expect(screen.getByText('自動作成はオフ')).toBeVisible();
  expect(screen.getByRole('button', { name: '今すぐ作成' })).toBeEnabled();
  expect(onCreate).not.toHaveBeenCalled();
  expect(onResolve).not.toHaveBeenCalled();
});
it('番号の不正値と前後関係を保持し、有効になってから保存する', () => {
  const { onChange } = setup();
  const create = screen.getByRole('spinbutton', { name: '作成するレス番号' });
  fireEvent.change(create, { target: { value: '1001' } });
  expect(onChange).not.toHaveBeenCalled();
  expect(create).toHaveValue(1001);
  expect(screen.getByRole('button', { name: '今すぐ作成' })).toBeDisabled();
  fireEvent.change(screen.getByRole('spinbutton', { name: '切り替えるレス番号' }), { target: { value: '1100' } });
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ createAtResponseNumber: 1001, switchAtResponseNumber: 1100 }));
  fireEvent.change(create, { target: { value: '' } });
  expect(create).toHaveAttribute('aria-invalid', 'true');
});
it('手動内容を独立して選べ、投稿者名と案内文を検証する', async () => {
  const { onChange } = setup();
  await act(async () => fireEvent.change(screen.getByRole('combobox', { name: 'タイトル' }), { target: { value: 'manual' } }));
  expect(screen.getByLabelText('手動タイトル')).toBeVisible();
  expect(screen.queryByLabelText('手動本文')).toBeNull();
  fireEvent.click(screen.getByText('投稿者名・E-mail'));
  expect(screen.getByText('空欄なら掲示板の既定名。# は使えません。')).toBeVisible();
  onChange.mockClear();
  fireEvent.change(screen.getByLabelText('投稿者名'), { target: { value: 'name#trip' } });
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('投稿者名'), { target: { value: '配信者' } });
  fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'sage#ok' } });
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ email: 'sage#ok' }));
});
it('保存・反映待ちは古い予定で作成しない', () => {
  setup({ synchronized: false });
  expect(screen.getByRole('button', { name: '今すぐ作成' })).toBeDisabled();
  expect(screen.getByText(/保存・反映を待っています/)).toBeVisible();
});
it('処理中の連打を止め、失敗を保持して再実行できる', async () => {
  let reject!: (error: Error) => void;
  const onCreate = vi.fn(() => new Promise<void>((_, no) => { reject = no; }));
  const { onSuccess } = setup({ onCreate });
  const button = screen.getByRole('button', { name: '今すぐ作成' });
  fireEvent.click(button); fireEvent.click(button);
  expect(onCreate).toHaveBeenCalledTimes(1);
  expect(button).toHaveAttribute('aria-disabled', 'true');
  await act(async () => reject(new Error('作成に失敗しました。')));
  expect(onSuccess).not.toHaveBeenCalled();
  expect(screen.getByText('作成に失敗しました。')).toBeVisible();
  expect(button).not.toHaveAttribute('aria-disabled', 'true');
});
it('結果不明でも自動展開せず、同じ掲示板のURLだけ登録する', async () => {
  const { onResolve } = setup({ state: { ...state, status: 'uncertain', message: '結果不明です。' } });
  expect(screen.getByLabelText('作成済み次スレッドURL')).not.toBeVisible();
  expect(screen.getByText(/「ブラウザで作成・結果を確認」を開いてください/)).toBeVisible();
  fireEvent.click(screen.getByText('ブラウザで作成・結果を確認'));
  fireEvent.change(screen.getByLabelText('作成済み次スレッドURL'), { target: { value: threadUrl } });
  expect(screen.getByRole('button', { name: '作成済みURLを登録' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('作成済み次スレッドURL'), { target: { value: 'https://jbbs.shitaraba.net/bbs/read.cgi/game/123/789/' } });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '作成済みURLを登録' })));
  expect(onResolve).toHaveBeenCalledWith({ outcome: 'created', threadUrl: 'https://jbbs.shitaraba.net/bbs/read.cgi/game/123/789/' });
});

it('jpnknも同じ操作で手動作成でき、次URLを正規化して開く', () => {
  const open = vi.spyOn(window, 'open').mockReturnValue(null);
  try {
    setup({ threadUrl: 'https://bbs.jpnkn.com/test/read.cgi/clarahas/123/',
      state: { ...state, status: 'created', nextThreadUrl: 'https://bbs.jpnkn.com/test/read.cgi/clarahas/456/l50' } });
    expect(screen.getByRole('button', { name: '今すぐ作成' })).toBeDisabled();
    expect(screen.getByLabelText('次スレッドURL')).toHaveValue('https://bbs.jpnkn.com/test/read.cgi/clarahas/456/');
    fireEvent.click(screen.getByRole('button', { name: 'ブラウザで開く' }));
    expect(open).toHaveBeenCalledWith('https://bbs.jpnkn.com/test/read.cgi/clarahas/456/', '_blank', 'noopener,noreferrer');
  } finally { open.mockRestore(); }
});

it('ブラウザ作成が必要な場合は再作成と未作成確認を止め、同じjpnkn板の別URLだけ登録する', async () => {
  const open = vi.spyOn(window, 'open').mockReturnValue(null);
  try {
    const current = 'https://bbs.jpnkn.com/test/read.cgi/clarahas/123/';
    const { onCreate, onResolve, onSuccess } = setup({ threadUrl: current,
      state: { ...state, status: 'browserRequired', message: 'ブラウザで認証して作成してください。' } });
    expect(screen.getByRole('button', { name: '今すぐ作成' })).toBeDisabled();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(screen.getByLabelText('作成済み次スレッドURL')).not.toBeVisible();
    fireEvent.click(screen.getByText('ブラウザで作成・結果を確認'));
    expect(screen.getByRole('button', { name: '未作成を確認' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '現行掲示板をブラウザで開く' }));
    expect(open).toHaveBeenCalledWith('https://bbs.jpnkn.com/clarahas/', '_blank', 'noopener,noreferrer');
    for (const value of [current, 'https://bbs.jpnkn.com/test/read.cgi/other/456/',
      'https://jbbs.shitaraba.net/bbs/read.cgi/game/123/456/', 'http://bbs.jpnkn.com/test/read.cgi/clarahas/456/',
      'https://bbs.jpnkn.com.evil.test/test/read.cgi/clarahas/456/', 'https://name@bbs.jpnkn.com/test/read.cgi/clarahas/456/']) {
      fireEvent.change(screen.getByLabelText('作成済み次スレッドURL'), { target: { value } });
      expect(screen.getByRole('button', { name: '作成済みURLを登録' })).toBeDisabled();
    }
    fireEvent.change(screen.getByLabelText('作成済み次スレッドURL'), { target: { value: 'https://bbs.jpnkn.com/test/read.cgi/clarahas/456/l50' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '作成済みURLを登録' })));
    expect(onResolve).toHaveBeenCalledExactlyOnceWith({ outcome: 'created', threadUrl: 'https://bbs.jpnkn.com/test/read.cgi/clarahas/456/' });
    expect(onCreate).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledExactlyOnceWith('作成済みURLを登録しました。');
  } finally { open.mockRestore(); }
});

it('手動作成で認証要求が返っても作成成功のトーストを出さない', async () => {
  const { onSuccess } = setup({ threadUrl: 'https://bbs.jpnkn.com/test/read.cgi/clarahas/123/',
    onCreate: vi.fn(async () => { throw new Error('認証が必要です。ブラウザで作成してください。'); }) });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '今すぐ作成' })));
  expect(onSuccess).not.toHaveBeenCalled();
  expect(screen.getByText('認証が必要です。ブラウザで作成してください。')).toBeVisible();
});

it('接続先の保存・反映待ちでは旧状態へのURL登録と未作成確認を実行しない', () => {
  const { onResolve } = setup({ synchronized: false, state: { ...state, status: 'uncertain' } });
  fireEvent.click(screen.getByText('ブラウザで作成・結果を確認'));
  fireEvent.change(screen.getByLabelText('作成済み次スレッドURL'), { target: { value: 'https://jbbs.shitaraba.net/bbs/read.cgi/game/123/789/' } });
  expect(screen.getByRole('button', { name: '作成済みURLを登録' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '未作成を確認' })).toBeDisabled();
  expect(onResolve).not.toHaveBeenCalled();
});

it('フォーカス中の作成ボタンが認証要求で無効になってもフォーカスを保持する', () => {
  const props = { settings: createDefaultSettings().sources.shitaraba.nextThread, state, threadUrl, synchronized: true,
    onChange: vi.fn(), onSave: vi.fn(async () => {}), onCreate: vi.fn(async () => {}), onResolve: vi.fn(async () => {}), onSuccess: vi.fn() };
  const view = render(<NextThreadPanel {...props} />);
  const action = screen.getByRole('button', { name: '今すぐ作成' });
  act(() => action.focus());
  view.rerender(<NextThreadPanel {...props} state={{ ...state, status: 'browserRequired' }} />);
  expect(action).toHaveFocus();
  expect(action).toHaveAttribute('aria-disabled', 'true');
  fireEvent.click(action);
  expect(props.onCreate).not.toHaveBeenCalled();
});
