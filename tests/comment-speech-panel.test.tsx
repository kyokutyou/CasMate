// @vitest-environment jsdom
import { StrictMode, useState, type ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createDefaultSettings } from '../src/main/core/settings';
import { CommentSpeechPanel } from '../src/renderer/components/CommentSpeechPanel';
import type { VoicevoxSpeaker } from '../src/shared/types';
import { ManagementNavigation } from '../src/renderer/management-navigation';

const voices: VoicevoxSpeaker[] = [
  { speakerUuid: 'one', name: '話者一', styles: [{ id: 1, name: '通常' }, { id: 2, name: '小声' }] },
  { speakerUuid: 'two', name: '話者二', styles: [{ id: 7, name: '通常' }] },
];
const settings = { ...createDefaultSettings().commentSpeech, voice: { speakerUuid: 'one', styleId: 2 } };
const listVoices = vi.fn(async () => voices);
function Harness(props: Partial<ComponentProps<typeof CommentSpeechPanel>>) {
  const [value, setValue] = useState(props.settings ?? settings);
  return <CommentSpeechPanel
    state={{ engineStatus: 'ready', currentCommentId: null, queueLength: 0, droppedCount: 0, warning: null }}
    listVoices={listVoices} selectEngine={async () => true} preview={async () => undefined} onSuccess={() => undefined}
    {...props} settings={value} onChange={next => { setValue(next); props.onChange?.(next); }}
    onSave={async next => { setValue(next); await props.onSave?.(next); }} />;
}
function SetupHarness(props: Partial<ComponentProps<typeof CommentSpeechPanel>>) {
  return <ManagementNavigation.Provider value={{ editor: 'commentSpeech', initialSetup: true, setupPosition: 'commentSpeech', open() {}, reportError() {} }}><Harness {...props} /></ManagementNavigation.Provider>;
}

it('初回設定の話者一覧更新は処理中と失敗後も同じボタンから再試行できる', async () => {
  let reject!: (error: Error) => void;
  const getVoices = vi.fn(async () => voices).mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
  render(<SetupHarness listVoices={getVoices} state={{ engineStatus: 'disabled', currentCommentId: null, queueLength: 0, droppedCount: 0, warning: null }} />);
  const refresh = screen.getByRole('button', { name: '話者一覧を更新' });
  refresh.focus();fireEvent.click(refresh);
  await waitFor(() => expect(getVoices).toHaveBeenCalledTimes(1));
  expect(refresh).not.toBeDisabled();expect(refresh).toHaveAttribute('aria-disabled', 'true');expect(refresh).toHaveFocus();
  fireEvent.click(refresh);expect(getVoices).toHaveBeenCalledTimes(1);
  await act(async () => { reject(new Error('VOICEVOXを起動してください。')); });
  expect(refresh).toHaveFocus();expect(refresh).toHaveAttribute('aria-disabled', 'false');
  fireEvent.click(refresh);
  await screen.findByRole('option', { name: '話者一' });expect(refresh).toHaveFocus();
});
it.each(['話者', 'スタイル', 'コメント読み上げ'] as const)('初回設定の%s保存は操作位置を保持して処理中の再操作を禁止する', async name => {
  let release!: () => void;
  const save = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
  render(<SetupHarness onSave={save} />);
  await screen.findByRole('option', { name: '話者一' });
  const target = name === 'コメント読み上げ' ? screen.getByRole('switch', { name }) : screen.getByRole('combobox', { name });
  target.focus();
  if (name === 'コメント読み上げ') fireEvent.click(target);else fireEvent.change(target, { target: { value: name === '話者' ? 'two' : '1' } });
  expect(save).toHaveBeenCalledTimes(1);expect(target).not.toBeDisabled();expect(target).toHaveAttribute('aria-disabled', 'true');expect(target).toHaveFocus();
  if (name === 'コメント読み上げ') fireEvent.click(target);else fireEvent.change(target, { target: { value: name === '話者' ? 'one' : '2' } });
  expect(save).toHaveBeenCalledTimes(1);
  await act(async () => { release(); });
  expect(target).toHaveAttribute('aria-disabled', 'false');expect(target).toHaveFocus();
});
afterEach(() => { cleanup(); vi.clearAllMocks(); localStorage.clear(); });
describe('コメント読み上げのD案', () => {
  it('末尾の自動保存と同期1件表示の補足案内を表示しない', () => {
    render(<Harness />);
    expect(screen.queryByText('変更は自動保存されます。')).not.toBeInTheDocument();
    expect(screen.queryByText('同期1件表示中は「1件表示時間」を使用しません。')).not.toBeInTheDocument();
  });

  it('指定ボタンの説明として選択対象と対象外のファイルを明示する', () => {
    render(<Harness state={{engineStatus:'disabled',currentCommentId:null,queueLength:0,droppedCount:0,warning:null}} />);
    expect(screen.getByText('vv-engine / run.exe',{selector:'code'})).toBeVisible();
    expect(screen.getByRole('button',{name:'VOICEVOXの起動ファイルを指定'})).toHaveAccessibleDescription('選択するファイル（VOICEVOXフォルダー内） vv-engine / run.exe VOICEVOX.exeは選択しません。');
  });
  it.each([
    ['disabled',false,'読み上げをオンにすると自動起動します。'],
    ['disabled',true,'起動ファイルを確認してください。'],
    ['preparing',true,'準備が終わるまでお待ちください。'],
    ['ready',false,'話者を選んで試聴できます。'],
    ['unavailable',true,'インストール・起動を確認してください。'],
  ] as const)('VOICEVOXの状態と保存済みのオンオフに合う案内を示す（%s/%s）', async (engineStatus,savedEnabled,text) => {
    render(<Harness savedEnabled={savedEnabled} state={{engineStatus,currentCommentId:null,queueLength:0,droppedCount:0,warning:null}} />);
    expect(document.querySelector('.speech-engine-guidance')).toHaveTextContent(text);
    expect((await screen.findByRole('button',{name:'話者一覧を更新'})).closest('section')).toHaveAttribute('aria-labelledby','speech-voice-controls');
  });
  it.each([true,false])('起動ファイルの選択結果が%sなら成功時だけ通知と一覧更新を行う', async selected => {
    const select=vi.fn(async()=>selected),success=vi.fn(),getVoices=vi.fn(async()=>voices);
    render(<Harness selectEngine={select} onSuccess={success} listVoices={getVoices}
      state={{engineStatus:'disabled',currentCommentId:null,queueLength:0,droppedCount:0,warning:null}} />);
    fireEvent.click(screen.getByRole('button',{name:'VOICEVOXの起動ファイルを指定'}));
    await waitFor(()=>expect(screen.getByRole('button',{name:'VOICEVOXの起動ファイルを指定'})).toBeEnabled());
    expect(select).toHaveBeenCalledTimes(1);
    expect(getVoices).toHaveBeenCalledTimes(selected?1:0);
    expect(success).toHaveBeenCalledTimes(selected?1:0);
    if(selected)expect(success).toHaveBeenCalledWith('VOICEVOXの起動ファイルを指定しました。');
  });
  it('起動ファイル選択の失敗を表示し成功通知や一覧取得をしない', async () => {
    const success=vi.fn(),getVoices=vi.fn(async()=>voices);
    render(<Harness selectEngine={async()=>{throw new Error('起動ファイルを選び直してください。');}} onSuccess={success} listVoices={getVoices}
      state={{engineStatus:'disabled',currentCommentId:null,queueLength:0,droppedCount:0,warning:null}} />);
    fireEvent.click(screen.getByRole('button',{name:'VOICEVOXの起動ファイルを指定'}));
    expect(await screen.findByText('起動ファイルを選び直してください。')).toBeVisible();
    expect(success).not.toHaveBeenCalled();expect(getVoices).not.toHaveBeenCalled();
  });
  it('状態欄からVOICEVOX見出しへ移動し、保存やエンジン選択を実行しない', async () => {
    const save=vi.fn(), select=vi.fn(), preview=vi.fn();
    const scroll=vi.fn();
    const previous=HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView=scroll;
    try {
      render(<Harness onSave={save} selectEngine={select} preview={preview} />);
      const user=userEvent.setup();
      screen.getByRole('button', { name:'VOICEVOXの設定を確認' }).focus();
      await user.keyboard('{Enter}');
      expect(screen.getByRole('heading', { name:'VOICEVOX', exact:true })).toHaveFocus();
      expect(scroll).toHaveBeenCalledWith({ block:'center' });
      expect(save).not.toHaveBeenCalled();expect(select).not.toHaveBeenCalled();expect(preview).not.toHaveBeenCalled();
    } finally { HTMLElement.prototype.scrollIntoView=previous; }
  });
  it.each([
    ['preparing', 'VOICEVOXの準備が終わると試聴できます。'],
    ['disabled', '「話者一覧を更新」で声を取得してください。'],
    ['unavailable', '「話者一覧を更新」で声を取得してください。'],
  ] as const)('試聴できない理由をボタンと関連付ける（%s）', (engineStatus, reason) => {
    const preview=vi.fn();
    render(<Harness state={{engineStatus,currentCommentId:null,queueLength:0,droppedCount:0,warning:null}} preview={preview} />);
    const button=screen.getByRole('button', {name:'この声を試聴'});
    expect(button).toBeDisabled();expect(button).toHaveAccessibleDescription(reason);
    fireEvent.click(button);expect(preview).not.toHaveBeenCalled();
  });
  it('話者一覧の取得中・失敗・再取得後に試聴理由を更新する', async () => {
    let reject!: (error:Error)=>void;
    const getVoices=vi.fn().mockImplementationOnce(()=>new Promise((_resolve,fail)=>{reject=fail;})).mockResolvedValue(voices);
    render(<Harness listVoices={getVoices} />);
    const button=screen.getByRole('button', {name:'この声を試聴'});
    await waitFor(()=>expect(button).toHaveAccessibleDescription('話者一覧を取得しています。完了までお待ちください。'));
    reject(new Error('一覧の取得失敗'));
    await waitFor(()=>expect(button).toHaveAccessibleDescription('話者一覧を取得できません。「話者一覧を更新」を試してください。'));
    fireEvent.click(screen.getByRole('button',{name:'話者一覧を更新'}));
    await waitFor(()=>expect(button).toHaveAccessibleDescription('現在の設定で試聴できます。'));
    expect(button).toBeEnabled();
  });
  it.each([null, {speakerUuid:'one',styleId:99}])('未選択・無効な声を試聴前に案内する（%j）', async voice => {
    render(<Harness settings={{...settings,voice}} />);
    await screen.findByRole('option',{name:'話者一'});
    expect(screen.getByRole('button',{name:'この声を試聴'})).toHaveAccessibleDescription(voice
      ? '話者・スタイルを選び直してください。' : '話者を選ぶと試聴できます。');
  });
  it.each([true, false])('保存前のスイッチ値ではなく保存済み設定で稼働説明を示す（%s）', async savedEnabled => {
    render(<Harness settings={{ ...settings, enabled: !savedEnabled }} savedEnabled={savedEnabled}
      state={{ engineStatus: 'ready', currentCommentId: 'playing', queueLength: 0, droppedCount: 0, warning: null }} />);
    await screen.findByRole('option', { name: '話者一' });
    expect(screen.getByRole('switch', { name: 'コメント読み上げ', exact: true })).toHaveAttribute('aria-checked', String(!savedEnabled));
    expect(screen.getByText(savedEnabled ? 'コメントを読み上げています。' : 'コメント読み上げはオフです。')).toBeVisible();
  });
  it('一覧要求中にエンジン準備完了が届いても二重取得しない', async () => {
    let finish!: (value: VoicevoxSpeaker[]) => void;
    const getVoices = vi.fn(() => new Promise<VoicevoxSpeaker[]>(resolve => { finish = resolve; }));
    const state = { engineStatus: 'disabled' as const, currentCommentId: null, queueLength: 0, droppedCount: 0, warning: null };
    const view = render(<StrictMode><Harness state={state} listVoices={getVoices} /></StrictMode>);
    fireEvent.click(screen.getByRole('button', { name: '話者一覧を更新' }));
    await waitFor(() => expect(getVoices).toHaveBeenCalledTimes(1));
    view.rerender(<StrictMode><Harness state={{ ...state, engineStatus: 'ready' }} listVoices={getVoices} /></StrictMode>);
    finish(voices);
    await screen.findByRole('option', { name: '話者一' });
    expect(getVoices).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'この声を試聴' })).toBeEnabled();
    expect(screen.getByText(/コメント読み上げがオンなら、読み上げを聞く済みのスマホにも届きます/)).toBeVisible();
  });
  it('実際の話者とスタイルを分けて選び、組で保存する', async () => {
    const save = vi.fn(); render(<Harness onSave={save} />);
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'スタイル' })).toHaveValue('2'));
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('combobox', { name: '話者', exact: true }), { target: { value: 'two' } });
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ voice: { speakerUuid: 'two', styleId: 7 } })));
  });
  it('スライダーと数値入力が同じ値を編集し、不正値を保存・試聴しない', async () => {
    const change = vi.fn(); const preview = vi.fn(); render(<Harness onChange={change} preview={preview} />);
    await screen.findByRole('option', { name: '話者一' });
    fireEvent.change(screen.getByRole('slider', { name: '読む速さ' }), { target: { value: '1.4' } });
    expect(screen.getByRole('spinbutton', { name: '読む速さの数値' })).toHaveValue(1.4);
    fireEvent.change(screen.getByRole('spinbutton', { name: '読む速さの数値' }), { target: { value: '3' } });
    expect(change).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('slider', { name: '読む速さ' })).toHaveValue('1.4');
    expect(screen.getByRole('button', { name: 'この声を試聴' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'この声を試聴' })).toHaveAccessibleDescription('入力値を修正すると試聴できます。');
    fireEvent.change(screen.getByRole('spinbutton', { name: '読む速さの数値' }), { target: { value: '1.2' } });
    expect(screen.getByRole('slider', { name: '読む速さ' })).toHaveValue('1.2');
    expect(preview).not.toHaveBeenCalled();
  });
  it('空の文字数入力は0として保存されず、スライダーの再操作で不正値を解消する', async () => {
    const change = vi.fn(); render(<Harness onChange={change} />);
    await screen.findByRole('option', { name: '話者一' });
    fireEvent.change(screen.getByRole('spinbutton', { name: '本文の最大文字数' }), { target: { value: '' } });
    expect(change).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('spinbutton', { name: '本文の最大文字数' }), { target: { value: '220' } });
    expect(change).toHaveBeenCalledWith(expect.objectContaining({ maxTextLength: 220 }));
    fireEvent.change(screen.getByRole('spinbutton', { name: '声の高さの数値' }), { target: { value: '0.5' } });
    fireEvent.change(screen.getByRole('slider', { name: '声の高さ' }), { target: { value: '0.05' } });
    expect(screen.getByRole('spinbutton', { name: '声の高さの数値' })).toHaveValue(0.05);
    expect(screen.getByRole('button', { name: 'この声を試聴' })).toBeEnabled();
  });
  it('読み上げオフのまま最新値の保存完了後だけ試聴し、二重要求を防ぐ', async () => {
    let finish!: () => void;
    const save = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const preview = vi.fn(async () => undefined);
    render(<Harness onSave={save} preview={preview} />);
    await screen.findByRole('option', { name: '話者一' });
    fireEvent.change(screen.getByRole('slider', { name: '音量' }), { target: { value: '1.3' } });
    const button = screen.getByRole('button', { name: 'この声を試聴' });
    fireEvent.click(button); fireEvent.click(button);
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAccessibleDescription('試聴を準備しています。しばらくお待ちください。');
    expect(button).not.toBeDisabled();
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ enabled: false, volumeScale: 1.3 }));
    expect(save).toHaveBeenCalledTimes(1); expect(preview).not.toHaveBeenCalled();
    finish(); await waitFor(() => expect(preview).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('switch', { name: 'コメント読み上げ' })).not.toBeChecked();
  });
  it('保存に失敗すると試聴を実行せずエラーを表示する', async () => {
    const preview = vi.fn(); render(<Harness onSave={async () => { throw new Error('保存できません'); }} preview={preview} />);
    await screen.findByRole('option', { name: '話者一' });
    fireEvent.click(screen.getByRole('button', { name: 'この声を試聴' }));
    expect(await screen.findByText('保存できません')).toBeVisible(); expect(preview).not.toHaveBeenCalled();
  });
  it('一覧にない保存済みの組を勝手に変更せず、更新失敗でも保持する', async () => {
    const save = vi.fn(); const getVoices = vi.fn().mockResolvedValueOnce(voices).mockRejectedValueOnce(new Error('一覧を取得できません'));
    render(<Harness settings={{ ...settings, voice: { speakerUuid: 'one', styleId: 99 } }} listVoices={getVoices} onSave={save} />);
    expect(await screen.findByText(/保存済みの話者・スタイルが見つかりません/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '話者一覧を更新' }));
    expect(await screen.findByText('一覧を取得できません')).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'スタイル' })).toHaveValue('99');
    expect(save).not.toHaveBeenCalled();
  });
  it('キーボードでスイッチを操作でき、内容とVOICEVOX設定を常時表示する', async () => {
    const user = userEvent.setup(); const save = vi.fn(); render(<Harness onSave={save} />);
    await screen.findByRole('option', { name: '話者一' });
    const toggle = screen.getByRole('switch', { name: '投稿者名を読む' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    toggle.focus(); await user.keyboard('{Enter}');
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ readAuthor: false }));
    expect(screen.getByRole('button', { name: 'VOICEVOXの起動ファイルを指定' })).toBeVisible();
    expect(screen.getByRole('spinbutton', { name: '本文の最大文字数' })).toBeVisible();
    expect(screen.getAllByRole('slider')).toHaveLength(4);
  });
});
