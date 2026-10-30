// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AppSnapshot, SettingsSection, VoicevoxSpeaker } from '../src/shared/types';
import type { ObsSourceTarget } from '../src/shared/obs-source-registration';
import type { InitialSetupCommand, SetupFeature, SetupStep } from '../src/shared/initial-setup';
import { initialSetupSteps, setupFeatures } from '../src/shared/initial-setup';
import { commentDesignFromSettings } from '../src/shared/obs-design';
import { setupEditor, setupValidationEditors } from '../src/renderer/management-navigation';
import { InitialSetupStore } from '../src/main/core/initial-setup-store';
import { obsRegistrationSnapshot, obsRegistrationContext } from './fixtures/obs-registration-state';

const api = vi.hoisted(() => ({ snapshot: null as AppSnapshot | null, connected: true, error: null,
  listeners: new Set<() => void>(), updateSettings: vi.fn(), mutate: vi.fn(), sourceAction: vi.fn(), uploadAsset: vi.fn(), saveCharacterMotion: vi.fn(),
  listSpeechVoices: vi.fn(async (): Promise<VoicevoxSpeaker[]> => []), obsSourceContext: vi.fn(async (target: ObsSourceTarget) => obsRegistrationContext(target)), obsSourceAdd: vi.fn(),
}));
vi.mock('../src/renderer/api', async () => {
  const { useSyncExternalStore } = await import('react');
  return { useApplicationState: () => { useSyncExternalStore(listener => { api.listeners.add(listener); return () => api.listeners.delete(listener); }, () => api.snapshot); return api; } };
});
vi.mock('../src/renderer/windows-fonts', () => ({ loadWindowsFonts: async () => ['Yu Gothic UI'] }));
import { Dashboard } from '../src/renderer/pages/Dashboard';
let store: InitialSetupStore;
const emit = () => { for (const listener of api.listeners) listener(); };
const button = (name: string) => {
  if (name === '次へ') return document.getElementById('setup-next')!;
  if (name === '設定をはじめる') return screen.getByRole('button', { name: '使いたい機能を選ぶ →', exact: true });
  if (name === '設定を確認') return document.getElementById('setup-result-sources')!;
  const confirmation = screen.queryByRole('checkbox', { name: text => text.startsWith(name) });
  if (confirmation) return confirmation;
  // Query active navigation first; retained editors remain mounted but hidden.
  for (const region of document.querySelectorAll('.management-initial-setup .initial-setup, .management-nav, .editor-heading')) {
    const match = within(region as HTMLElement).queryByRole('button', { name, exact: true });
    if (match) return match;
  }
  return screen.getByRole('button', { name, exact: true });
};
function openPhoneUses() {
  const disclosure = document.querySelector<HTMLDetailsElement>('.setup-phone-use-editor');
  if (disclosure && !disclosure.open) fireEvent.click(document.getElementById('setup-phone-change-uses')!);
}
async function click(name: string) {
  const target = await waitFor(() => {
    const candidate = button(name);
    expect(candidate).not.toBeDisabled();
    expect(candidate).not.toHaveAttribute('aria-disabled', 'true');
    return candidate;
  });
  await act(async () => { fireEvent.click(target); });
  await waitFor(() => expect(screen.queryByText('進み具合を保存しています…')).not.toBeInTheDocument());
}
const currentStep = () => document.querySelector('.initial-setup[data-setup-position]')?.getAttribute('data-setup-position');
async function historyMouse(button: 3 | 4) {
  await waitFor(() => expect(screen.queryByText('進み具合を保存しています…')).not.toBeInTheDocument());
  await act(async () => { fireEvent.mouseUp(window, { button }); });
  await waitFor(() => expect(screen.queryByText('進み具合を保存しています…')).not.toBeInTheDocument());
}
function openApplicationSettings() {
  fireEvent.click(button('設定'));
  fireEvent.click(document.getElementById('settings-application')!);
}
beforeEach(async () => {
  vi.clearAllMocks(); localStorage.clear();
  api.listSpeechVoices.mockResolvedValue([]);
  store = new InitialSetupStore(join(await mkdtemp(join(tmpdir(), 'casmate-setup-ui-')), 'initial-setup.json'), true);
  await store.load(); const snapshot = obsRegistrationSnapshot(); snapshot.initialSetup = store.view(snapshot); api.snapshot = snapshot;
  api.mutate.mockImplementation(async (path: string, _method?: string, command?: InitialSetupCommand) => {
    if (path === '/api/management/initial-setup') {
      await store.update(command, () => api.snapshot!);
      api.snapshot = { ...api.snapshot!, initialSetup: store.view(api.snapshot!) }; emit();
    }
    return { snapshot: api.snapshot };
  });
  api.updateSettings.mockImplementation(async (section: SettingsSection, value: unknown) => {
    api.snapshot = { ...api.snapshot!, settingsRevision: api.snapshot!.settingsRevision + 1, settings: { ...api.snapshot!.settings, [section]: value } }; emit();
    return { snapshot: api.snapshot };
  });
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(cleanup);
it('入口C案は説明とイメージを分け、選択した機能と共通の準備を並べる', async () => {
  render(<Dashboard />);
  expect(screen.getByRole('heading', { name: 'コメントが、配信のそばに。' })).toBeVisible();
  expect(screen.getByText('イメージです。実際のコメント・音声ではありません。')).toBeVisible();
  expect(screen.getByRole('navigation', { name: '初回設定の流れ' })).toHaveTextContent('確認結果');
  expect(document.querySelector('.management-body')).not.toContainElement(button('次へ'));
  await click('使いたい機能を選ぶ →');
  expect(screen.getByRole('group', { name: 'コメントの基本' })).toBeVisible();
  fireEvent.click(document.getElementById('setup-feature-commentOverlay')!);
  await waitFor(() => expect(screen.getByRole('complementary', { name: '今回の案内' })).toHaveTextContent('OBSの接続'));
  fireEvent.click(document.getElementById('setup-feature-aiListener')!);
  await waitFor(() => expect(screen.getByRole('complementary', { name: '今回の案内' })).toHaveTextContent('配信者音声認識'));
  const plan = screen.getByRole('complementary', { name: '今回の案内' });
  expect(within(plan).getAllByText('OBSの接続')).toHaveLength(1);
  expect(within(plan).getAllByRole('listitem')).toHaveLength(5);
  expect(api.mutate.mock.calls.every(([path]) => path === '/api/management/initial-setup')).toBe(true);
  expect(api.sourceAction).not.toHaveBeenCalled();
});
it('今回は選ばないは保存後に空の結果へ進み、設定を保持し、選び直せる', async () => {
  render(<Dashboard />); await click('設定をはじめる');
  fireEvent.click(document.getElementById('setup-feature-sources')!);
  await waitFor(() => expect(store.view(api.snapshot!).selected).toEqual(['sources']));
  const settings = structuredClone(api.snapshot!.settings);
  await click('今回は選ばない');
  await waitFor(() => expect(currentStep()).toBe('summary'));
  expect(store.view(api.snapshot!).selected).toEqual([]);
  expect(api.snapshot!.settings).toEqual(settings);
  expect(screen.getByRole('heading', { name: '今回は、機能を選んでいません' })).toBeVisible();
  await click('使いたい機能を選び直す');
  await waitFor(() => expect(currentStep()).toBe('features'));
});
it('今回は選ばないの保存失敗では結果へ移動せず、選択を保持する', async () => {
  render(<Dashboard />); await click('設定をはじめる');
  fireEvent.click(document.getElementById('setup-feature-sources')!);
  await waitFor(() => expect(store.view(api.snapshot!).selected).toEqual(['sources']));
  api.mutate.mockRejectedValueOnce(new Error('保存できませんでした。'));
  await click('今回は選ばない');
  expect(currentStep()).toBe('features');
  expect(store.view(api.snapshot!).selected).toEqual(['sources']);
  expect(document.getElementById('setup-feature-sources')).toBeChecked();
});
it('今回は選ばないの保存中に画面を離れたら、完了後に確認結果を開かない', async () => {
  render(<Dashboard />); await click('設定をはじめる');
  fireEvent.click(document.getElementById('setup-feature-sources')!);
  await waitFor(() => expect(store.view(api.snapshot!).selected).toEqual(['sources']));
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const mutate = api.mutate.getMockImplementation()!;
  api.mutate.mockImplementationOnce(async (...args) => { await gate; return mutate(...args); });
  fireEvent.click(button('今回は選ばない'));
  await waitFor(() => expect(screen.getByText('進み具合を保存しています…')).toBeInTheDocument());
  fireEvent.click(button('配信中'));
  await act(async () => { release(); });
  await waitFor(() => expect(store.view(api.snapshot!).selected).toEqual([]));
  expect(currentStep()).toBeUndefined();
  expect(document.getElementById('page-heading')).toHaveTextContent('コメントと、いつもの操作');
  expect(store.view(api.snapshot!).position).toBe('features');
});
it('全項目に確認記録がある結果はホームを案内し、現在の停止状態を別に示す', async () => {
  await store.update({revision:0,action:'select',selected:['sources'],smartphoneUses:[]},()=>api.snapshot!);
  await store.update({revision:1,action:'move',position:'summary'},()=>api.snapshot!);
  const view = store.view(api.snapshot!);
  api.snapshot = {...api.snapshot!,initialSetup:{...view,confirmations:{sources:view.fingerprints.sources}}};
  render(<Dashboard />); openApplicationSettings(); await click('はじめての設定を続ける');
  const panel=screen.getByRole('complementary',{name:'このあとの操作'});
  expect(panel).toHaveTextContent('ホームで状態を確認');
  expect(within(panel).queryByRole('button',{name:'この項目を確認する →'})).not.toBeInTheDocument();
  expect(document.getElementById('setup-result-sources')!.closest('article')).toHaveTextContent('停止中');
  await click('戻る');
  await waitFor(()=>expect(currentStep()).toBe('features'));
  expect(document.getElementById('setup-feature-sources')).toBeChecked();
});
it('確認結果C案は前回の確認と現在の待機を分け、必要な準備を優先して戻れる', async () => {
  api.snapshot!.settings.sources.youtube.target = '@caster';
  await store.update({ revision: 0, action: 'select', selected: ['sources', 'commentSpeech', 'commentOverlay'], smartphoneUses: [] }, () => api.snapshot!);
  await store.update({ revision: 1, action: 'confirm', step: 'sources', fingerprint: store.view(api.snapshot!).fingerprints.sources }, () => api.snapshot!);
  await store.update({ revision: 2, action: 'defer', step: 'obsDisplay' }, () => api.snapshot!);
  api.snapshot = { ...api.snapshot!, sourceStatuses: { ...api.snapshot!.sourceStatuses, youtube: { ...api.snapshot!.sourceStatuses.youtube, state: 'waiting' } }, initialSetup: store.view(api.snapshot!) };
  render(<Dashboard />); openApplicationSettings(); await click('はじめての設定を続ける');
  const source = document.getElementById('setup-result-sources')!.closest('article')!;
  expect(source).toHaveTextContent('前回の動作確認済み');
  expect(source).toHaveTextContent('YouTube：配信開始待ち');
  expect(document.getElementById('setup-interrupt')).not.toBeInTheDocument();
  const panel = screen.getByRole('complementary', { name: 'このあとの操作' });
  expect(panel).toHaveTextContent('コメント読み上げ');
  expect(panel).toHaveTextContent('設定'); expect(panel).toHaveTextContent('アプリ設定');
  await click('この項目を確認する →');
  await waitFor(() => expect(currentStep()).toBe('commentSpeech'));
  expect(document.getElementById('setup-heading')).toHaveFocus();
});
it('結果の主ボタンから設定を確認して戻ると、古いフォーカス対象を残さない', async () => {
  api.snapshot!.settings.sources.youtube.target='@caster';
  await showStep('sources','sources');await click('次へ');
  const action=screen.getByRole('button',{name:'この項目を確認する →'});
  act(()=>action.focus());fireEvent.click(action);
  await waitFor(()=>expect(currentStep()).toBe('sources'));
  await click('コメントの接続状態を確認できた');await click('次へ');
  expect(currentStep()).toBe('summary');
  expect(screen.getByRole('heading',{name:'ホームで状態を確認'})).toBeVisible();
  expect(screen.queryByRole('button',{name:'この項目を確認する →'})).not.toBeInTheDocument();
});
it('C案ではサービス選択で接続せず、他サービスの入力と実状態を保持する', async () => {
  await showStep('sources', 'sources');
  const source = screen.getByLabelText('YouTubeの配信URL または @ハンドル');
  fireEvent.change(source, { target: { value: '@caster' } });
  const calls = api.mutate.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: 'Twitch', exact: true }));
  expect(source).not.toBeVisible();
  expect(screen.getByLabelText('Twitchチャンネル名')).toBeVisible();
  expect(api.mutate).toHaveBeenCalledTimes(calls);
  expect(api.sourceAction).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'YouTube', exact: true }));
  expect(source).toBeVisible(); expect(source).toHaveValue('@caster');
  await act(async () => {
    api.snapshot = { ...api.snapshot!, sourceStatuses: { ...api.snapshot!.sourceStatuses, youtube: { ...api.snapshot!.sourceStatuses.youtube, state: 'waiting' } } }; emit();
  });
  const review = screen.getByRole('complementary', { name: '状態と動作の確認' });
  expect(review).toHaveTextContent('配信開始待ち');
  expect(review).toHaveTextContent('正常な待機');
  expect(document.querySelector('.management-body')).not.toContainElement(document.getElementById('setup-next'));
  expect(document.querySelector('.acquisition-list')).toContainElement(source);
  expect(document.querySelector('.acquisition-list')).toContainElement(document.querySelector('.setup-source-selector') as HTMLElement);
  expect(document.querySelector('.acquisition-panel .setup-step-card:last-child')).toContainElement(document.getElementById('setup-confirm-sources'));
  expect(review).not.toContainElement(document.getElementById('setup-confirm-sources'));
  fireEvent.click(screen.getByRole('button', { name: '接続を停止する', exact: true }));
  await waitFor(() => expect(api.sourceAction).toHaveBeenCalledWith('youtube', 'stop'));
  expect(api.snapshot!.settings.sources.youtube.target).toBe('@caster');
});
it('C案の読み上げは準備・試聴・ONの順で、本人確認と実状態を分ける', async () => {
  await showStep('commentSpeech', 'commentSpeech');
  const headings = [...document.querySelectorAll('.comment-speech-panel h3')].filter(node => !node.closest('[hidden]')).map(node => node.textContent);
  expect(headings.slice(0, 3)).toEqual(['1VOICEVOXを準備する', '2声を選んで試聴する', '3新着コメントの読み上げを使う']);
  expect(screen.getByRole('checkbox', { name: /テスト音声が聞こえた/ })).toHaveAttribute('aria-disabled', 'true');
  expect(api.mutate.mock.calls.filter(([path]) => path !== '/api/management/initial-setup')).toEqual([]);
  expect(document.querySelector('.speech-runtime')).toContainElement(document.getElementById('setup-confirm-commentSpeech'));
  fireEvent.click(screen.getByRole('button', { name: 'VOICEVOXを自動で探して準備する' }));
  await waitFor(() => expect(api.listSpeechVoices).toHaveBeenCalledTimes(1));
  expect(api.mutate.mock.calls.filter(([path]) => path !== '/api/management/initial-setup')).toEqual([]);
  fireEvent.click(button('詳細設定を開く ›'));
  expect(screen.queryByRole('complementary', { name: '状態と動作の確認' })).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '声のコントロール' })).toBeVisible();
});
it('読み上げOFFでも一覧に存在しない保存済みの声は確認済みにせず、選び直して復旧できる', async () => {
  api.snapshot!.commentSpeech.engineStatus = 'ready';
  api.snapshot!.settings.commentSpeech.enabled = false;
  api.snapshot!.settings.commentSpeech.voice = { speakerUuid: 'one', styleId: 99 };
  api.listSpeechVoices.mockResolvedValue([{ speakerUuid: 'one', name: '話者一', styles: [{ id: 1, name: '通常' }] }]);
  await showStep('commentSpeech', 'commentSpeech');
  await waitFor(() => expect(document.querySelector('.speech-voice-feedback')).toHaveTextContent('保存済みの話者・スタイルが見つかりません'));
  const check = screen.getByRole('checkbox', { name: 'テスト音声が聞こえた' });
  expect(check).toHaveAttribute('aria-disabled', 'true');expect(button('次へ')).toHaveAttribute('aria-disabled', 'true');
  fireEvent.click(check);expect(store.view(api.snapshot!).confirmations.commentSpeech).toBeUndefined();
  fireEvent.change(screen.getByLabelText('スタイル'), { target: { value: '1' } });
  await waitFor(() => expect(check).toHaveAttribute('aria-disabled', 'false'));
  expect(api.snapshot!.settings.commentSpeech.enabled).toBe(false);
});
it('進行保存中の詳細移動を受け付けず、保存後に開いた段階へ戻る', async () => {
  await showStep('aiListener', 'sources');
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const mutate = api.mutate.getMockImplementation()!;
  api.mutate.mockImplementationOnce(async (...args) => { await gate;return mutate(...args); });
  fireEvent.click(button('次へ'));
  const detail = document.getElementById('setup-detail')!;
  fireEvent.click(detail);
  expect(document.getElementById('editor-heading')).toBeNull();
  expect(detail).toHaveAttribute('aria-disabled', 'true');
  await act(async () => { release(); });
  await waitFor(() => expect(currentStep()).toBe('speechRecognition'));
  await click('詳細設定を開く ›');
  await click('← はじめての設定に戻る');
  expect(currentStep()).toBe('speechRecognition');expect(document.getElementById('setup-detail')).toHaveFocus();
});
it('C案の接続ボタンは掲示板の不正間隔では開始せず、接続中は空欄でも停止できる', async () => {
  await showStep('sources', 'sources');
  await click('詳細設定を開く ›');
  fireEvent.change(screen.getByLabelText('掲示板スレッドURL（したらば／jpnkn）'), { target: { value: 'https://jbbs.shitaraba.net/bbs/read.cgi/game/1/2/' } });
  fireEvent.change(screen.getByLabelText('コメント取得間隔（秒）'), { target: { value: '' } });
  fireEvent.click(button('← はじめての設定に戻る'));
  fireEvent.click(screen.getByRole('button', { name: '掲示板', exact: true }));
  const connect = screen.getByRole('button', { name: '接続する', exact: true });
  expect(connect).toBeDisabled(); fireEvent.click(connect);
  expect(api.sourceAction).not.toHaveBeenCalled();
  await act(async () => {
    api.snapshot = { ...api.snapshot!, sourceStatuses: { ...api.snapshot!.sourceStatuses, shitaraba: { ...api.snapshot!.sourceStatuses.shitaraba, state: 'connected' } } }; emit();
  });
  fireEvent.change(screen.getByLabelText('掲示板スレッドURL（したらば／jpnkn）'), { target: { value: '' } });
  const stop = screen.getByRole('button', { name: '接続を停止する', exact: true });
  expect(stop).not.toBeDisabled(); fireEvent.click(stop);
  await waitFor(() => expect(api.sourceAction).toHaveBeenCalledWith('shitaraba', 'stop'));
});
it('C案のVOICEVOX起動確認は自分の準備中通知でネイティブ無効化せず、重複取得を防ぐ', async () => {
  api.snapshot!.commentSpeech.engineStatus = 'disabled';
  let release!: () => void;
  const gate = new Promise<VoicevoxSpeaker[]>(resolve => { release = () => resolve([]); });
  api.listSpeechVoices.mockImplementationOnce(async () => gate);
  await showStep('commentSpeech', 'commentSpeech');
  const check = screen.getByRole('button', { name: 'VOICEVOXを自動で探して準備する' });
  check.focus(); fireEvent.click(check);
  await waitFor(() => expect(api.listSpeechVoices).toHaveBeenCalledTimes(1));
  await act(async () => {
    api.snapshot = { ...api.snapshot!, commentSpeech: { ...api.snapshot!.commentSpeech, engineStatus: 'preparing' } }; emit();
  });
  expect(check).not.toBeDisabled(); expect(check).toHaveAttribute('aria-disabled', 'true'); expect(check).toHaveFocus();
  fireEvent.click(check); expect(api.listSpeechVoices).toHaveBeenCalledTimes(1);
  await act(async () => {
    api.snapshot = { ...api.snapshot!, commentSpeech: { ...api.snapshot!.commentSpeech, engineStatus: 'ready' } }; emit(); release();
  });
  await waitFor(() => expect(check).toHaveAttribute('aria-disabled', 'false'));
});
it('C案の機能ナビは選択した機能を示し、連続したOBS接続と表示をまとめる', async () => {
  await store.update({ revision: 0, action: 'select', selected: ['sources', 'commentSpeech', 'commentOverlay'], smartphoneUses: [] }, () => api.snapshot!);
  await store.update({ revision: 1, action: 'move', position: 'sources' }, () => api.snapshot!);
  api.snapshot = { ...api.snapshot!, initialSetup: store.view(api.snapshot!) };
  render(<Dashboard />); openApplicationSettings(); await click('はじめての設定を続ける');
  const nav = screen.getByRole('navigation', { name: '設定する機能' });
  expect(within(nav).getAllByRole('button').map(node => node.textContent)).toEqual(['1コメント接続', '2読み上げ', '3OBS表示']);
  fireEvent.click(within(nav).getByRole('button', { name: /読み上げ/ }));
  await waitFor(() => expect(currentStep()).toBe('commentSpeech'));
  expect(document.getElementById('setup-heading')).toHaveTextContent('好きな声で読み上げる');
  expect(api.sourceAction).not.toHaveBeenCalled();
  expect(api.mutate.mock.calls.filter(([path]) => path !== '/api/management/initial-setup')).toEqual([]);
});
it('C案の基本文字サイズは不正入力と詳細往復を保持し、保存済みの見本へ反映する', async () => {
  const design = commentDesignFromSettings(api.snapshot!.settings.commentOverlay);
  design.style.fontSize = 60; design.style.textColor = '#123456';
  api.snapshot!.settings.commentOverlay.design = design;
  await showStep('commentOverlay', 'obsDisplay');
  const input = screen.getByLabelText('文字サイズ（px）');
  expect(screen.queryByRole('button', { name: /OBS.*接続.*(する|停止する)/ })).not.toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'OBSの接続状態' })).toHaveTextContent('OBS接続済み');
  expect(document.querySelector('.comment-overlay-panel')).toContainElement(document.getElementById('setup-register-comments'));
  expect(document.getElementById('setup-test-comments')).toBeNull();
  expect(screen.getAllByRole('button', { name: 'OBSに追加して表示を確認…' })).toHaveLength(1);
  expect(input).toHaveValue(60);
  fireEvent.change(input, { target: { value: '201' } });
  await waitFor(() => expect(input).toHaveAttribute('aria-invalid', 'true'));
  expect(button('次へ')).toHaveAttribute('aria-disabled', 'true');
  fireEvent.click(button('詳細設定を開く ›'));
  expect(input).not.toBeVisible();
  fireEvent.click(button('← はじめての設定に戻る'));
  expect(input).toBeVisible(); expect(input).toHaveValue(201);
  fireEvent.change(input, { target: { value: '48' } });
  await waitFor(() => expect(api.snapshot!.settings.commentOverlay.fontSizePx).toBe(48));
  expect(api.updateSettings).toHaveBeenCalledWith('commentOverlay', expect.objectContaining({ fontSizePx: 48 }), { commentFontSizePx: 48 });
  expect(api.snapshot!.settings.commentOverlay.design).toEqual({ ...design, style: { ...design.style, fontSize: 48 } });
  expect(document.querySelector('.setup-display-sample>div')).toHaveStyle({ fontSize: '48px' });
  expect(screen.getByText('説明用の見本 · OBSの実映像ではありません')).toBeVisible();
  await waitFor(() => expect(button('次へ')).not.toHaveAttribute('aria-disabled', 'true'));
});
it('文字サイズの保存失敗後も編集意図を保持し、表示方法との同時保存後は古いサイズを再送しない', async () => {
  await showStep('commentOverlay', 'obsDisplay');
  const input = screen.getByLabelText('文字サイズ（px）');
  api.updateSettings.mockRejectedValueOnce(new Error('文字サイズを保存できません。'));
  fireEvent.change(input, { target: { value: '48' } });
  await waitFor(() => expect(document.querySelector('.comment-overlay-panel')).toHaveTextContent('文字サイズを保存できません。'));
  const mode = screen.getByLabelText('コメントの表示方法');
  fireEvent.change(mode, { target: { value: 'single' } });
  await waitFor(() => expect(api.snapshot!.settings.commentOverlay.fontSizePx).toBe(48));
  expect(api.updateSettings).toHaveBeenLastCalledWith('commentOverlay', expect.objectContaining({ fontSizePx: 48, mode: 'single' }), { commentFontSizePx: 48 });
  fireEvent.change(mode, { target: { value: 'stack' } });
  await waitFor(() => expect(api.snapshot!.settings.commentOverlay.mode).toBe('stack'));
  expect(api.updateSettings).toHaveBeenLastCalledWith('commentOverlay', expect.objectContaining({ mode: 'stack' }));
});
it('文字サイズの先行保存中に再編集しても、新しいサイズの編集意図を失わない', async () => {
  await showStep('commentOverlay', 'obsDisplay');
  const input = screen.getByLabelText('文字サイズ（px）');
  const update = api.updateSettings.getMockImplementation()!;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  api.updateSettings.mockImplementationOnce(async (...args) => { await gate; return update(...args); });
  fireEvent.change(input, { target: { value: '48' } });
  await waitFor(() => expect(api.updateSettings).toHaveBeenCalledWith('commentOverlay', expect.objectContaining({ fontSizePx: 48 }), { commentFontSizePx: 48 }));
  fireEvent.change(input, { target: { value: '52' } });
  await act(async () => { release(); });
  await waitFor(() => expect(api.snapshot!.settings.commentOverlay.fontSizePx).toBe(52));
  expect(api.updateSettings).toHaveBeenLastCalledWith('commentOverlay', expect.objectContaining({ fontSizePx: 52 }), { commentFontSizePx: 52 });
});
it('C案の確認欄は保存待ちの声を先取りせず、保存済みの話者とスタイルを示す', async () => {
  api.snapshot!.settings.commentSpeech.voice = { speakerUuid: 'one', styleId: 1 };
  api.snapshot!.commentSpeech.engineStatus = 'ready';
  api.listSpeechVoices.mockResolvedValue([
    { speakerUuid: 'one', name: '話者一', styles: [{ id: 1, name: '通常' }] },
    { speakerUuid: 'two', name: '話者二', styles: [{ id: 2, name: 'ささやき' }] },
  ]);
  await showStep('commentSpeech', 'commentSpeech');
  const review = screen.getByRole('complementary', { name: '状態と動作の確認' });
  await waitFor(() => expect(review).toHaveTextContent('保存済みの声：話者一 · 通常'));
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const update = api.updateSettings.getMockImplementation()!;
  api.updateSettings.mockImplementationOnce(async (...args) => { await gate; return update(...args); });
  fireEvent.change(screen.getByLabelText('話者'), { target: { value: 'two' } });
  await waitFor(() => expect(api.updateSettings).toHaveBeenCalledWith('commentSpeech', expect.objectContaining({ voice: { speakerUuid: 'two', styleId: 2 } })));
  expect(review).toHaveTextContent('保存済みの声：話者一 · 通常');
  expect(button('次へ')).toHaveAttribute('aria-disabled', 'true');
  await act(async () => release());
  await waitFor(() => expect(review).toHaveTextContent('保存済みの声：話者二 · ささやき'));
});
it('完了保存を待つ間に移動した画面を、保存完了で上書きしない', async () => {
  render(<Dashboard />); await click('設定をはじめる'); await click('次へ');
  expect(screen.getByRole('heading', { name: '今回は、機能を選んでいません' })).toBeVisible();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const mutate = api.mutate.getMockImplementation()!;
  api.mutate.mockImplementationOnce(async (...args) => { await gate; return mutate(...args); });
  fireEvent.click(button('設定を終えてホームへ'));
  await waitFor(() => expect(screen.getByText('進み具合を保存しています…')).toBeInTheDocument());
  fireEvent.click(button('配信中'));
  await act(async () => { release(); });
  await waitFor(() => expect(api.snapshot!.initialSetup!.completed).toBe(true));
  expect(document.getElementById('page-heading')).toHaveTextContent('コメントと、いつもの操作');
  expect(document.getElementById('page-heading')).toHaveFocus();
});
it.each([
  ['sources', 'sources', /コメントをまとめて見る/],
  ['smartphone', 'smartphone', /^コメントを見る$/],
] as const)('再作成する初回設定の選択欄へ履歴のフォーカスを戻す: %s', async (feature, step, label) => {
  await showStep(feature, step);
  while (currentStep() !== 'features') await click('戻る');
  await click('次へ');
  await historyMouse(3);
  screen.getByLabelText(label).focus();
  await historyMouse(4); await historyMouse(3);
  expect(screen.getByLabelText(label)).toHaveFocus();
});
it('再作成する確認結果の操作へ履歴のフォーカスを戻す', async () => {
  await showStep('sources', 'sources'); await click('次へ');
  button('設定を確認').focus(); await click('設定を確認');
  await historyMouse(3);
  expect(button('設定を確認')).toHaveFocus();
});
it.each([
  [/コメントをまとめて見る/, false],
  [/^読み上げを聞く$/, true],
] as const)('選択の保存中と結果表示後もフォーカスを保ち二重変更を防ぐ: %s', async (label, fail) => {
  await showStep('smartphone', 'smartphone');
  while (currentStep() !== 'features') await click('戻る');
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const mutate = api.mutate.getMockImplementation()!;
  api.mutate.mockClear();
  api.mutate.mockImplementationOnce(async (...args) => { await gate; if (fail) throw new Error('進行を保存できませんでした。'); return mutate(...args); });
  const input = screen.getByLabelText(label); input.focus(); fireEvent.click(input);
  await waitFor(() => expect(input).toHaveAttribute('aria-disabled', 'true'));
  expect(input).toHaveFocus(); fireEvent.click(input);
  expect(api.mutate).toHaveBeenCalledTimes(1);
  await act(async () => { release(); });
  await waitFor(() => expect(input).toHaveAttribute('aria-disabled', 'false'));
  expect(input).toHaveFocus(); expect(input).toHaveProperty('checked', !fail);
});
it('初回設定の手動登録手順は詳細往復と段階往復で開閉を保持する', async () => {
  await showStep('commentOverlay', 'obsDisplay');
  const disclosure = () => screen.getByText('URLを手動で登録する場合').closest('details')!;
  disclosure().open = true; fireEvent(disclosure(), new Event('toggle'));
  await click('詳細設定を開く ›'); fireEvent.click(button('← はじめての設定に戻る'));
  expect(disclosure()).toHaveAttribute('open');
  disclosure().open = false; fireEvent(disclosure(), new Event('toggle'));
  await click('詳細設定を開く ›'); fireEvent.click(button('← はじめての設定に戻る'));
  expect(disclosure()).not.toHaveAttribute('open');
  disclosure().open = true; fireEvent(disclosure(), new Event('toggle'));
  await click('戻る'); await click('次へ');
  expect(disclosure()).toHaveAttribute('open');
}, 10_000);
it('サービスごとの接続状態の開閉を詳細設定と段階の往復で保持する', async () => {
  await showStep('sources', 'sources');
  const disclosure = () => screen.getByText('サービスごとの接続状態').closest('details')!;
  disclosure().open = true; fireEvent(disclosure(), new Event('toggle'));
  await click('詳細設定を開く ›'); fireEvent.click(button('← はじめての設定に戻る'));
  expect(disclosure()).toHaveAttribute('open');
  disclosure().open = false; fireEvent(disclosure(), new Event('toggle'));
  await click('次へ'); await click('設定を確認');
  expect(disclosure()).not.toHaveAttribute('open');
  disclosure().open = true; fireEvent(disclosure(), new Event('toggle'));
  await click('次へ'); await click('設定を確認');
  expect(disclosure()).toHaveAttribute('open');
});
it('本人確認チェックを再操作すると確認記録だけを取り消せる', async () => {
  api.snapshot!.settings.sources.youtube.target = '@caster';
  await showStep('sources', 'sources');
  const settings = structuredClone(api.snapshot!.settings);
  const label = 'コメントの接続状態を確認できた';
  await click(label);
  expect(button(label)).toHaveAttribute('aria-checked', 'true');
  button(label).focus(); await userEvent.setup().keyboard('[Space]');
  await waitFor(() => expect(button(label)).toHaveAttribute('aria-checked', 'false'));
  expect(api.snapshot!.initialSetup!.confirmations.sources).toBeUndefined();
  expect(api.snapshot!.settings).toEqual(settings); expect(currentStep()).toBe('sources');
  expect(api.sourceAction).not.toHaveBeenCalled();
});
it('確認取消の保存待ちと失敗ではチェックを維持し、再試行後にだけ外す', async () => {
  api.snapshot!.settings.sources.youtube.target = '@caster';
  await showStep('sources', 'sources');
  const label = 'コメントの接続状態を確認できた';
  await click(label);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  api.mutate.mockImplementationOnce(async () => { await gate; throw new Error('確認記録を保存できませんでした。'); });
  api.mutate.mockClear();
  const check = button(label); check.focus(); fireEvent.click(check);
  await waitFor(() => expect(check).toHaveAttribute('aria-disabled', 'true'));
  expect(check).toHaveAttribute('aria-checked', 'true'); expect(check).toHaveFocus();
  fireEvent.click(check); expect(api.mutate).toHaveBeenCalledTimes(1);
  await act(async () => { release(); });
  await waitFor(() => expect(check).toHaveAttribute('aria-disabled', 'false'));
  expect(check).toHaveAttribute('aria-checked', 'true'); expect(check).toHaveFocus();
  await click(label); expect(check).toHaveAttribute('aria-checked', 'false');
});
it('確認済みの読み上げはエンジン停止後も記録を取り消せる', async () => {
  api.snapshot!.settings.commentSpeech.voice = { speakerUuid: 'one', styleId: 1 };
  api.snapshot!.commentSpeech.engineStatus = 'ready';
  api.listSpeechVoices.mockResolvedValue([{ speakerUuid: 'one', name: '話者', styles: [{ id: 1, name: '通常' }] }]);
  await showStep('commentSpeech', 'commentSpeech');
  const label = 'テスト音声が聞こえた'; await click(label);
  await act(async () => {
    api.snapshot = { ...api.snapshot!, commentSpeech: { ...api.snapshot!.commentSpeech, engineStatus: 'unavailable' } }; emit();
  });
  expect(button(label)).toHaveAttribute('aria-checked', 'true');
  expect(button(label)).toHaveAttribute('aria-disabled', 'false');
  await click(label); expect(button(label)).toHaveAttribute('aria-checked', 'false');
  expect(button(label)).toHaveAttribute('aria-disabled', 'true');
});
it('機能ナビの保存失敗中もフォーカスと操作位置を保ち、二重移動を防ぐ', async () => {
  await store.update({ revision: 0, action: 'select', selected: ['sources', 'commentSpeech'], smartphoneUses: [] }, () => api.snapshot!);
  await store.update({ revision: 1, action: 'move', position: 'sources' }, () => api.snapshot!);
  api.snapshot = { ...api.snapshot!, initialSetup: store.view(api.snapshot!) };
  render(<Dashboard />); openApplicationSettings(); await click('はじめての設定を続ける');
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  api.mutate.mockImplementationOnce(async () => { await gate; throw new Error('進行を保存できませんでした。'); });
  api.mutate.mockClear();
  const target = within(screen.getByRole('navigation', { name: '設定する機能' })).getByRole('button', { name: /読み上げ/ });
  target.focus(); fireEvent.click(target);
  await waitFor(() => expect(target).toHaveAttribute('aria-disabled', 'true'));
  expect(target).not.toBeDisabled(); expect(target).toHaveFocus();
  fireEvent.click(target); expect(api.mutate).toHaveBeenCalledTimes(1);
  await act(async () => { release(); });
  await waitFor(() => expect(target).toHaveAttribute('aria-disabled', 'false'));
  expect(target).toHaveFocus(); expect(currentStep()).toBe('sources');
  fireEvent.click(target);
  await waitFor(() => expect(currentStep()).toBe('commentSpeech'));
  expect(document.getElementById('setup-heading')).toHaveFocus();
});
it('AI詳細の映像タブと入力のフォーカスを初回設定との履歴往復で保持する', async () => {
  api.snapshot!.aiListener = { requested: false, status: 'stopped', message: '停止中', nextAt: null, memoryCharacters: 0, hasKey: false,
    postingBudget: { used: 0, limit: 60, nextAllowedAt: null }, authorization: null,
    services: { youtube: { ready: false, message: '', account: null, latest: null }, twitch: { ready: false, message: '', account: null, latest: null },
      shitaraba: { ready: false, message: '', account: null, latest: null }, jpnkn: { ready: false, message: '', account: null, latest: null } } };
  await showStep('aiListener', 'aiListener');
  const guide = () => document.querySelector('[data-ai-account=youtube]') as HTMLDetailsElement;
  guide().open = true; fireEvent(guide(), new Event('toggle'));
  fireEvent.change(screen.getByLabelText(/APIキー/), { target: { value: '未保存のキー' } });
  await click('詳細設定を開く ›'); fireEvent.click(screen.getByRole('tab', { name: '映像' }));
  screen.getByLabelText('撮影するOBSソース').focus();
  await historyMouse(3);
  expect(screen.getByRole('heading', { name: /話し方を決める/ })).toBeVisible();
  expect(screen.getByLabelText(/APIキー/)).toHaveValue('未保存のキー');
  expect(guide()).toHaveAttribute('open');
  await historyMouse(4);
  expect(screen.getByRole('tab', { name: '映像' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByLabelText('撮影するOBSソース')).toHaveFocus();
  expect(screen.getByLabelText('撮影するOBSソース')).toBeVisible();
});
it('人格ショートカットを置かず、AIリスナーの人格タブから元の設定入口へ戻る', async () => {
  api.snapshot!.aiListener = { requested: false, status: 'stopped', message: '停止中', nextAt: null, memoryCharacters: 0, hasKey: false,
    postingBudget: { used: 0, limit: 60, nextAllowedAt: null }, authorization: null,
    services: { youtube: { ready: false, message: '', account: null, latest: null }, twitch: { ready: false, message: '', account: null, latest: null },
      shitaraba: { ready: false, message: '', account: null, latest: null }, jpnkn: { ready: false, message: '', account: null, latest: null } } };
  api.snapshot!.initialSetup!.autoShow = false;
  render(<Dashboard />);
  expect(screen.queryByRole('button', { name: 'AIリスナーの人格 ›' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'すべての設定 ›' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '設定の保存先を開く' })).not.toBeInTheDocument();
  await click('設定');
  expect(screen.queryByRole('button', { name: 'AIリスナーの人格 ›' })).not.toBeInTheDocument();
  const entry = document.getElementById('settings-aiListener')!;
  fireEvent.click(entry);
  await userEvent.click(screen.getByRole('tab', { name: '人格', exact: true }));
  await waitFor(() => expect(screen.getByRole('tab', { name: '人格', exact: true })).toHaveAttribute('aria-selected', 'true'));
  expect(screen.getByRole('tab', { name: '人格', exact: true })).toHaveFocus();
  await click('← 設定に戻る');
  expect(entry).toHaveFocus();
  expect(api.mutate).not.toHaveBeenCalled();
});
it('保存先操作はアプリ設定に置き、二重要求を防ぎ失敗後も同じ位置から再試行できる', async () => {
  api.snapshot!.initialSetup!.autoShow = false;
  render(<Dashboard />);
  openApplicationSettings();
  const link = screen.getByRole('button', { name: '設定の保存先を開く' });
  expect(link.closest('.application-settings-panel')).not.toBeNull();
  expect(api.mutate).not.toHaveBeenCalled();
  let reject!: (error: Error) => void;
  api.mutate.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  link.focus(); fireEvent.click(link); fireEvent.click(link);
  expect(api.mutate).toHaveBeenCalledExactlyOnceWith('/api/application/settings-directory/open');
  expect(link).toHaveAttribute('aria-disabled', 'true');
  await act(async () => { reject(new Error('設定の保存先を開けませんでした。')); });
  expect(link).toHaveFocus(); expect(link).toHaveAttribute('aria-disabled', 'false');
  expect(document.getElementById('management-warning-entry')).toHaveTextContent('要確認');
  fireEvent.click(link);
  await waitFor(() => expect(screen.getByRole('region', { name: '通知' })).toHaveTextContent('設定の保存先を開きました。'));
});
async function showStep(feature: SetupFeature, step: SetupStep) {
  await store.update({ revision: 0, action: 'select', selected: [feature], smartphoneUses: ['comments'] }, () => api.snapshot!);
  await store.update({ revision: 1, action: 'move', position: step }, () => api.snapshot!);
  api.snapshot = { ...api.snapshot!, initialSetup: store.view(api.snapshot!) };
  render(<Dashboard />); openApplicationSettings(); await click('はじめての設定を続ける');
}
it.each([
  ['commentOverlay', 'comments'], ['speechRecognition', 'speech'], ['textEffects', 'effects'], ['character', 'character'],
] as const)('初回設定の%sから登録ダイアログを開き、閉じると入口へ戻る', async (feature, overlay) => {
  api.obsSourceContext.mockImplementation(async target => obsRegistrationContext(target));
  await showStep(feature, 'obsDisplay');
  const entry = document.getElementById(`setup-register-${overlay}`)!;
  await act(async () => { fireEvent.click(entry); });
  const dialog = document.getElementById('obs-source-registration-dialog')!;
  await waitFor(() => expect(dialog).toHaveAttribute('open'));
  expect(api.obsSourceContext).toHaveBeenLastCalledWith({ kind: 'overlay', overlay });
  expect(api.obsSourceAdd).not.toHaveBeenCalled();
  await act(async () => { api.snapshot = { ...api.snapshot! }; emit(); });
  expect(dialog).toHaveAttribute('open');
  fireEvent.click(within(dialog).getByRole('button', { name: '閉じる' }));
  expect(dialog).not.toHaveAttribute('open');
  expect(entry).toHaveFocus();
  await act(async () => { fireEvent.click(entry); });
  expect(dialog).toHaveAttribute('open');
  await click('戻る');
  expect(dialog).not.toHaveAttribute('open');
});
it('初回設定のOBS接続にチェック項目と接続情報の案内を表示する', async () => {
  await showStep('commentOverlay', 'obsControl');
  const review = document.querySelector<HTMLElement>('.obs-control-panel')!;
  expect(screen.getAllByText('OBS側の準備方法', { exact: true })).toHaveLength(1);
  fireEvent.click(within(review).getByText('OBS側の準備方法', { exact: true }));
  expect(review).toHaveTextContent('「WebSocketサーバーを有効にする」と「認証を有効にする」にチェックします。');
  expect(review).toHaveTextContent('「適用」でOBS側の変更を保存');
  expect(review).toHaveTextContent('「OK」で閉じます');
  expect(review).toHaveTextContent('「OBSに接続する」があるとき');
  expect(review).toHaveTextContent('接続済みなら押し直し不要');
  expect(review).toHaveTextContent('「OBS接続を再試行」を押します');
  const input = screen.getByLabelText('OBS WebSocketポート');
  const connect = screen.getByRole('button', { name: 'OBSの接続を停止する', exact: true });
  expect(input.compareDocumentPosition(connect) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  await click('詳細設定を開く ›');
  expect(document.querySelector('.oc-details')).toHaveAttribute('open');
  await click('← はじめての設定に戻る');
  expect(document.querySelector('.oc-details')).toHaveAttribute('open');

});
it('初回設定はOBSのOFF・接続中・接続済み・接続不可と障害理由を区別する', async () => {
  await showStep('commentOverlay', 'obsControl');
  const review = screen.getByRole('complementary', { name: '状態と動作の確認' });
  for (const [connection, label] of [['disabled', '連携オフ'], ['connecting', '接続中'], ['connected', '接続済み'], ['unavailable', '利用不可']] as const) {
    await act(async () => { api.snapshot = { ...api.snapshot!, obsControl: { ...api.snapshot!.obsControl!, connection, enabled: connection !== 'disabled', error: connection === 'unavailable' ? '認証を確認してください。' : null } }; emit(); });
    expect(document.querySelector('.obs-control-panel')).toHaveTextContent(label);
    expect(review).not.toHaveTextContent(`現在：${label}`);
  }
  expect(review).toHaveTextContent('認証を確認してください。');
});
it.each(['aiListener', 'commentOverlay'] as const)('OBS接続後の案内は選んだ機能の確認手順に合わせる：%s', async feature => {
  api.snapshot!.obsControl = { ...api.snapshot!.obsControl!, enabled: true, connection: 'connected', error: null };
  await showStep(feature, 'obsControl');
  const review = screen.getByRole('complementary', { name: '状態と動作の確認' });
  if (feature === 'aiListener') {
    expect(initialSetupSteps(api.snapshot!.initialSetup!)).not.toContain('obsDisplay');
    expect(review).not.toHaveTextContent('次はOBS上の表示を確認');
    expect(review).toHaveTextContent('次の設定へ進んでください。');
  } else {
    expect(review).toHaveTextContent('次はOBS上の表示を確認');
  }
});
it('初回設定のOBS未接続時もダイアログで理由を示し、通常画面へ移動すると閉じる', async () => {
  api.snapshot!.obsControl = { ...api.snapshot!.obsControl!, enabled: false, connection: 'disabled' };
  await showStep('commentOverlay', 'obsDisplay');
  await click('OBSに追加して表示を確認…');
  const dialog = screen.getByRole('dialog', { name: /をOBSに追加$/ });
  expect(within(dialog).getByLabelText('OBS登録の状態')).toHaveTextContent('OBS連携がOFF');
  expect(api.obsSourceContext).not.toHaveBeenCalled();
  expect(api.obsSourceAdd).not.toHaveBeenCalled();
  fireEvent.click(button('ホーム'));
  expect(dialog).not.toHaveAttribute('open');
});
it('初回にようこそを表示し、機能は未選択で、選択・移動では開始操作を呼ばない', async () => {
  render(<Dashboard />);
  expect(screen.getByRole('heading', { name: 'ようこそ、きゃすメイトへ' })).toBeVisible();
  await waitFor(() => expect(api.snapshot!.initialSetup!.autoShow).toBe(false));
  await click('設定をはじめる');
  expect(screen.getAllByRole('checkbox')).toHaveLength(8);
  expect(screen.getAllByRole('checkbox').every(node => !(node as HTMLInputElement).checked)).toBe(true);
  await act(async () => fireEvent.click(screen.getByLabelText(/コメントをまとめて見る/)));
  await click('次へ');
  expect(currentStep()).toBe('sources');
  expect(screen.getByLabelText('YouTube接続先')).toBeVisible();
  expect(api.sourceAction).not.toHaveBeenCalled(); expect(api.updateSettings).not.toHaveBeenCalled();
  expect(api.mutate.mock.calls.every(([path]) => path === '/api/management/initial-setup')).toBe(true);
});
it('既存利用者の入口はアプリ設定の最下部に置き、ホームには表示しない', async () => {
  api.snapshot!.initialSetup!.autoShow = false;
  render(<Dashboard />);
  expect(screen.queryByRole('heading', { name: 'ようこそ、きゃすメイトへ' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'はじめての設定を開く', exact: true })).not.toBeInTheDocument();
  openApplicationSettings();
  expect(screen.getByRole('heading', { name: 'はじめての設定' }).closest('section')).toBe(document.querySelector('.application-settings-panel .app-footer-grid > section:last-child'));
  await click('はじめての設定を開く');
  expect(currentStep()).toBe('welcome');
  expect(document.getElementById('setup-heading')).toHaveFocus();
  expect(api.updateSettings).not.toHaveBeenCalled();
});
it.each([false, true])('初回設定から同じページの通常ナビゲーションへ移ると再開場所と見出しへ案内する（詳細=%s）', async detail => {
  await showStep('sources', 'sources');
  if (detail) fireEvent.click(button('詳細設定を開く ›'));
  fireEvent.click(button('設定'));
  expect(screen.getByRole('region', { name: '通知' })).toHaveTextContent('続きは「設定 → アプリ設定」から再開できます。');
  expect(document.getElementById('page-heading')).toHaveFocus();
  fireEvent.click(document.getElementById('settings-application')!);
  await click('はじめての設定を続ける');
  expect(currentStep()).toBe('sources');
});
it('後回し後は次の段階へ進み、中断後と再起動後はホームから再開する', async () => {
  await showStep('aiListener', 'sources');
  button('後で設定する').focus();
  await click('後で設定する');
  expect(currentStep()).toBe('speechRecognition');
  expect(document.getElementById('setup-heading')).toHaveFocus();
  fireEvent.click(button('中断してホームへ'));
  expect(screen.getByRole('region', { name: '通知' })).toHaveTextContent('続きは「設定 → アプリ設定」から再開できます。');
  expect(document.getElementById('page-heading')).toHaveFocus();
  expect(screen.queryByRole('button', { name: 'はじめての設定を続ける', exact: true })).not.toBeInTheDocument();
  openApplicationSettings();
  expect(button('はじめての設定を続ける')).toBeVisible();
  cleanup(); render(<Dashboard />);
  expect(screen.queryByRole('button', { name: 'はじめての設定を続ける', exact: true })).not.toBeInTheDocument();
  openApplicationSettings();
  expect(button('はじめての設定を続ける')).toBeVisible();
  fireEvent.click(button('はじめての設定を続ける'));
  expect(currentStep()).toBe('speechRecognition');
  expect(api.snapshot!.initialSetup!.deferred).toContain('sources');
});
it('詳細画面との往復で同じ入力と段階を維持する', async () => {
  await showStep('sources', 'sources');
  fireEvent.change(screen.getByLabelText('YouTube接続先'), { target: { value: '@caster' } });
  fireEvent.click(button('詳細設定を開く ›'));
  expect(button('← はじめての設定に戻る')).toBeVisible();
  expect(screen.getByLabelText('YouTube接続先')).toHaveValue('@caster');
  fireEvent.click(button('← はじめての設定に戻る'));
  expect(currentStep()).toBe('sources'); expect(screen.getByLabelText('YouTube接続先')).toHaveValue('@caster');
  expect(button('詳細設定を開く ›')).toHaveFocus();
});
it('進行保存に失敗しても同じ段階に留まり、再試行して進める', async () => {
  await showStep('sources', 'sources');
  api.mutate.mockRejectedValueOnce(new Error('進行を保存できませんでした。'));
  await click('次へ');
  expect(currentStep()).toBe('sources');
  expect(document.getElementById('management-warning-entry')).toHaveTextContent('要確認');
  await click('次へ');
  expect(currentStep()).toBe('summary');
});
it('音声認識の未適用入力を確認済みや次へで飛ばさず、後回しにはできる', async () => {
  await showStep('speechRecognition', 'speechRecognition');
  fireEvent.change(screen.getByLabelText('認識に使う入力'), { target: { value: 'smartphone:missing' } });
  // Select a real option so React's controlled select retains the draft.
  const select = screen.getByLabelText('認識に使う入力');
  const option = document.createElement('option'); option.value = 'smartphone:device'; select.append(option);
  fireEvent.change(select, { target: { value: 'smartphone:device' } });
  await waitFor(() => expect(button('次へ')).toHaveAttribute('aria-disabled', 'true'));
  expect(button('話した言葉が文字で表示された')).toHaveAttribute('aria-disabled', 'true');
  await click('後で設定する');
  expect(currentStep()).toBe('obsControl');
});
it('入力準備用の別入口から開いた詳細画面も、同じ入口へフォーカスを戻す', async () => {
  await showStep('speechRecognition', 'speechRecognition');
  fireEvent.click(button('スマホを入力に使う場合：先に登録する'));
  fireEvent.click(button('← はじめての設定に戻る'));
  expect(button('スマホを入力に使う場合：先に登録する')).toHaveFocus();
  expect(currentStep()).toBe('speechRecognition');
});
it('読み上げのローカル不正数値は詳細往復後も進行と確認を禁止する', async () => {
  await showStep('commentSpeech', 'commentSpeech');
  fireEvent.click(button('詳細設定を開く ›'));
  fireEvent.change(screen.getByLabelText('読む速さの数値'), { target: { value: '' } });
  fireEvent.click(button('← はじめての設定に戻る'));
  await waitFor(() => expect(button('次へ')).toHaveAttribute('aria-disabled', 'true'));
  expect(button('テスト音声が聞こえた')).toHaveAttribute('aria-disabled', 'true');
  expect(button('後で設定する')).not.toHaveAttribute('aria-disabled', 'true');
});
it.each([
  ['sources', 'sources', 'YouTube接続先'], ['commentSpeech', 'commentSpeech', '話者'],
  ['smartphone', 'smartphone', null], ['speechRecognition', 'speechRecognition', '認識に使う入力'],
  ['commentOverlay', 'obsDisplay', null], ['textEffects', 'textEffects', null], ['character', 'character', null],
] as const)('%sの単独経路で必要な設定を表示する', async (feature, step, label) => {
  await showStep(feature, step);
  expect(currentStep()).toBe(step);
  if (label) expect(screen.getByLabelText(label)).toBeVisible();
  expect(api.sourceAction).not.toHaveBeenCalled(); expect(api.uploadAsset).not.toHaveBeenCalled();
});
it('AIの初回設定には開始・再開を置かず、人格・参加先・連携の準備を表示する', async () => {
  api.snapshot!.settings.aiListener.personas = [{ id: 'p', name: '人格', personality: '', tone: '', firstPerson: '', topics: '', notes: '' }];
  api.snapshot!.settings.aiListener.participants.youtube = { enabled: true, personaId: 'p' };
  api.snapshot!.aiListener = { requested: false, status: 'stopped', message: '停止中', nextAt: null, memoryCharacters: 0, hasKey: false,
    postingBudget: { used: 0, limit: 60, nextAllowedAt: null }, authorization: null,
    services: Object.fromEntries(['youtube', 'twitch', 'shitaraba', 'jpnkn'].map(id => [id, { ready: false, message: '接続を確認してください', account: '配信用', latest: null }])) as NonNullable<AppSnapshot['aiListener']>['services'] };
  await showStep('aiListener', 'aiListener');
  expect(screen.getByRole('heading', { name: /APIキーを準備する/ })).toBeVisible();
  expect(screen.getByRole('heading', { name: /話し方を決める/ })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'AIを開始' })).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: /参加先を選ぶ/ })).toBeVisible();
  expect(screen.queryAllByRole('button', { name: /再開/, hidden: true })).toHaveLength(0);
  for (const [source, name] of [['youtube', 'YouTube Liveに参加'], ['twitch', 'Twitchに参加'], ['shitaraba', 'したらばに参加'], ['jpnkn', 'jpnknに参加']]) { fireEvent.change(screen.getByLabelText('準備する参加先'), { target: { value: source } }); expect(screen.getByRole('switch', { name })).toBeVisible(); }
  fireEvent.click(button('詳細設定を開く ›'));
  fireEvent.click(screen.getByRole('tab', { name: '参加先' }));
  expect(within(screen.getByRole('tabpanel', { name: '参加先' })).getByRole('button', { name: 'YouTube Liveを再開' })).toBeEnabled();
  fireEvent.click(button('← はじめての設定に戻る'));
  expect(screen.getByRole('heading', { name: /参加先を選ぶ/ })).toBeVisible();
  expect(screen.queryAllByRole('button', { name: /再開/, hidden: true })).toHaveLength(0);
  expect(api.mutate.mock.calls.some(([path]) => /\/ai-listener\/(start|resume)/.test(path))).toBe(false);
});
it('選択を減らしても既存設定を消さず、完了後に結果を開き直せる', async () => {
  await showStep('sources', 'sources'); const settings = structuredClone(api.snapshot!.settings);
  await click('戻る');
  await act(async () => fireEvent.click(screen.getByLabelText(/コメントをまとめて見る/)));
  await waitFor(() => expect(initialSetupSteps(api.snapshot!.initialSetup!)).toEqual([]));
  await click('次へ');
  await click('設定を終えてホームへ');
  expect(document.getElementById('page-heading')).toHaveFocus();
  expect(screen.getByRole('region', { name: '通知' })).not.toHaveTextContent('続きは「設定 → アプリ設定」から再開できます。');
  expect(screen.queryByRole('button', { name: 'はじめての設定を開く', exact: true })).not.toBeInTheDocument();
  openApplicationSettings();
  expect(button('はじめての設定を開く')).toBeVisible();
  fireEvent.click(button('はじめての設定を開く')); expect(currentStep()).toBe('summary');
  expect(api.snapshot!.settings).toEqual(settings);
});

it('選択解除した機能に保存失敗が残っても、選択ゼロで終了できる', async () => {
  await showStep('sources', 'sources');
  api.updateSettings.mockRejectedValueOnce(new Error('接続先を保存できませんでした。'));
  fireEvent.change(screen.getByLabelText('YouTube接続先'), { target: { value: '@caster' } });
  await waitFor(() => expect(api.updateSettings).toHaveBeenCalled());
  await waitFor(() => expect(button('次へ')).toHaveAttribute('aria-disabled', 'true'));
  await click('戻る');
  await act(async () => fireEvent.click(screen.getByLabelText(/コメントをまとめて見る/)));
  await click('次へ');
  expect(currentStep()).toBe('summary');
  expect(initialSetupSteps(api.snapshot!.initialSetup!)).toEqual([]);
  await click('設定を終えてホームへ');
  expect(api.snapshot!.initialSetup!.completed).toBe(true);
  expect(api.snapshot!.settings.sources.youtube.target).not.toBe('@caster');
});

it.each([
  [['commentOverlay'], ['commentOverlay']],
  [['speechRecognition'], ['speechRecognitionOverlay']],
  [['commentOverlay', 'speechRecognition'], ['commentOverlay', 'speechRecognitionOverlay']],
] satisfies [SetupFeature[], string[]][])('OBS表示の検証対象は選択した表示だけにする: %j', (selected, expected) => {
  const view = { selected, smartphoneUses: [], deferred: [] };
  expect(setupEditor('obsDisplay', selected)).toBe(expected[0]);
  expect(setupValidationEditors(view, 'obsDisplay')).toEqual(['obsControl', ...expected]);
  expect(setupValidationEditors(view, 'summary').filter(editor => editor === 'commentOverlay' || editor === 'speechRecognitionOverlay')).toEqual(expected);
  expect(setupValidationEditors({ ...view, deferred: ['obsDisplay'] }, 'summary')).not.toContain('speechRecognitionOverlay');
});

it('音声認識だけでも字幕専用の表示時間の不正入力を確認・完了時に検出し、修正後に再開できる', async () => {
  await showStep('speechRecognition', 'obsDisplay');
  const commentAppearance = structuredClone(api.snapshot!.settings.commentOverlay);
  fireEvent.click(button('詳細設定を開く ›'));
  expect(document.getElementById('editor-heading')).toHaveTextContent('OBS音声認識表示');
  fireEvent.change(screen.getByLabelText('表示時間（秒）'), { target: { value: '' } });
  await waitFor(() => expect(screen.getByLabelText('表示時間（秒）')).toHaveAttribute('aria-invalid', 'true'));
  fireEvent.click(button('← はじめての設定に戻る'));
  expect(currentStep()).toBe('obsDisplay');
  await waitFor(() => expect(button('OBSで選んだ表示を確認できた')).toHaveAttribute('aria-disabled', 'true'));
  expect(button('次へ')).toHaveAttribute('aria-disabled', 'true');
  // Another management screen can move the shared progress to the result page.
  await act(async () => {
    await store.update({ revision: api.snapshot!.initialSetup!.revision, action: 'move', position: 'summary' }, () => api.snapshot!);
    api.snapshot = { ...api.snapshot!, initialSetup: store.view(api.snapshot!) }; emit();
  });
  expect(button('設定を終えてホームへ')).toHaveAttribute('aria-disabled', 'true');
  fireEvent.click(document.getElementById('setup-result-obsDisplay')!);
  await waitFor(() => expect(currentStep()).toBe('obsDisplay'));
  fireEvent.click(button('詳細設定を開く ›'));
  expect(screen.getByLabelText('表示時間（秒）')).toHaveValue(null);
  fireEvent.change(screen.getByLabelText('表示時間（秒）'), { target: { value: '12' } });
  fireEvent.click(button('← はじめての設定に戻る'));
  await waitFor(() => expect(button('OBSで選んだ表示を確認できた')).not.toHaveAttribute('aria-disabled', 'true'));
  await click('OBSで選んだ表示を確認できた');
  await click('次へ');
  await click('設定を終えてホームへ');
  expect(api.snapshot!.settings.speechRecognitionOverlay.displayDurationSeconds).toBe(12);
  expect(api.snapshot!.settings.commentOverlay).toEqual(commentAppearance);
}, 15_000);

it('字幕専用表示時間の保存待ちは初回設定の確認・次へ・完了を止め、保存後に解除する', async () => {
  await showStep('speechRecognition', 'obsDisplay');
  fireEvent.click(button('詳細設定を開く ›'));
  let release!: () => void;
  const saved = new Promise<void>(resolve => { release = resolve; });
  const updateSettings = api.updateSettings.getMockImplementation()!;
  api.updateSettings.mockImplementationOnce(async (...args) => { await saved; return updateSettings(...args); });
  fireEvent.change(screen.getByLabelText('表示時間（秒）'), { target: { value: '12' } });
  await waitFor(() => expect(api.updateSettings).toHaveBeenCalledWith('speechRecognitionOverlay', expect.objectContaining({ displayDurationSeconds: 12 })));
  fireEvent.click(button('← はじめての設定に戻る'));
  expect(button('OBSで選んだ表示を確認できた')).toHaveAttribute('aria-disabled', 'true');
  expect(button('次へ')).toHaveAttribute('aria-disabled', 'true');
  await act(async () => {
    await store.update({ revision: api.snapshot!.initialSetup!.revision, action: 'move', position: 'summary' }, () => api.snapshot!);
    api.snapshot = { ...api.snapshot!, initialSetup: store.view(api.snapshot!) }; emit();
  });
  expect(button('設定を終えてホームへ')).toHaveAttribute('aria-disabled', 'true');
  await act(async () => { release(); });
  await waitFor(() => expect(button('設定を終えてホームへ')).not.toHaveAttribute('aria-disabled', 'true'));
  await click('設定を終えてホームへ');
  expect(api.snapshot!.settings.speechRecognitionOverlay.displayDurationSeconds).toBe(12);
}, 15_000);

it.each(['success', 'failure'] as const)('AI資格情報の保存中は確認・次へ・完了を止め、%s後の状態を反映する', async outcome => {
  const service = { ready: false, message: '', account: null, latest: null };
  api.snapshot!.aiListener = { requested: false, status: 'stopped', message: '停止中', nextAt: null, memoryCharacters: 0, hasKey: true,
    postingBudget: { used: 0, limit: 60, nextAllowedAt: null }, authorization: null,
    services: { youtube: { ...service }, twitch: { ...service }, shitaraba: { ...service }, jpnkn: { ...service } } };
  api.snapshot!.settings.aiListener.personas = [{ id: 'test', name: '確認用', personality: '', tone: '', firstPerson: '', topics: '', notes: '' }];
  api.snapshot!.settings.aiListener.participants.shitaraba = { enabled: true, personaId: 'test' };
  await showStep('aiListener', 'aiListener');
  expect(screen.getByRole('checkbox', { name: 'AIの利用準備を確認できた' })).not.toHaveAttribute('aria-disabled', 'true');
  let resolveSave!: () => void;
  let rejectSave!: (error: Error) => void;
  const saved = new Promise<void>((resolve, reject) => { resolveSave = resolve; rejectSave = reject; });
  const mutate = api.mutate.getMockImplementation()!;
  api.mutate.mockImplementation((path: string, method?: string, command?: InitialSetupCommand) => path === '/api/ai-listener/credentials' ? saved : mutate(path, method, command));
  fireEvent.change(screen.getByLabelText(/APIキー/), { target: { value: 'test-key' } });
  fireEvent.click(button('APIキーを保存'));
  await waitFor(() => expect(api.mutate.mock.calls.some(([path]) => path === '/api/ai-listener/credentials')).toBe(true));
  expect(button('次へ')).toHaveAttribute('aria-disabled', 'true');
  expect(button('AIの利用準備を確認できた')).toHaveAttribute('aria-disabled', 'true');
  await act(async () => {
    await store.update({ revision: api.snapshot!.initialSetup!.revision, action: 'move', position: 'summary' }, () => api.snapshot!);
    api.snapshot = { ...api.snapshot!, initialSetup: store.view(api.snapshot!) }; emit();
  });
  expect(button('設定を終えてホームへ')).toHaveAttribute('aria-disabled', 'true');
  await act(async () => { if (outcome === 'success') resolveSave(); else rejectSave(new Error('資格情報を保存できませんでした。')); });
  if (outcome === 'success') {
    await click('設定を終えてホームへ');
    expect(api.snapshot!.initialSetup!.completed).toBe(true);
  } else {
    expect(button('設定を終えてホームへ')).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(document.getElementById('setup-result-aiListener')!);
    await waitFor(() => expect(currentStep()).toBe('aiListener'));
    await click('後で設定する');
    await click('設定を終えてホームへ');
    expect(api.snapshot!.initialSetup!.deferred).toContain('aiListener');
  }
});

it('画像登録が非表示中に完了しても、別管理画面から移った確認結果で処理中が残らない', async () => {
  await showStep('character', 'character');
  let resolveUpload!: () => void;
  api.uploadAsset.mockImplementationOnce(() => new Promise<void>(resolve => { resolveUpload = resolve; }));
  fireEvent.change(screen.getByLabelText('口を閉じた画像（PNG）を選択'), { target: { files: [new File(['png'], 'closed.png', { type: 'image/png' })] } });
  await waitFor(() => expect(button('次へ')).toHaveAttribute('aria-disabled', 'true'));
  fireEvent.click(button('中断してホームへ'));
  await act(async () => {
    await store.update({ revision: api.snapshot!.initialSetup!.revision, action: 'move', position: 'summary' }, () => api.snapshot!);
    api.snapshot = { ...api.snapshot!, initialSetup: store.view(api.snapshot!) }; emit();
  });
  openApplicationSettings();
  fireEvent.click(button('はじめての設定を続ける'));
  expect(button('設定を終えてホームへ')).toHaveAttribute('aria-disabled', 'true');
  await act(async () => { resolveUpload(); });
  await click('設定を終えてホームへ');
  expect(api.snapshot!.initialSetup!.completed).toBe(true);
});
it('初回設定の履歴移動は保存成功後だけ進み、失敗後も同じ履歴から再試行できる', async () => {
  await showStep('sources', 'sources');
  await click('次へ'); expect(currentStep()).toBe('summary');
  api.mutate.mockRejectedValueOnce(new Error('進行を保存できませんでした。'));
  await historyMouse(3); expect(currentStep()).toBe('summary');
  await historyMouse(3); expect(currentStep()).toBe('sources');
  await historyMouse(4); expect(currentStep()).toBe('summary');
  expect(api.snapshot!.initialSetup!.position).toBe('summary');
  expect(api.sourceAction).not.toHaveBeenCalled();
});
it('選択解除で不要になった初回設定の履歴を読み飛ばす', async () => {
  await showStep('sources', 'sources');
  await click('戻る');
  await act(async () => { fireEvent.click(screen.getByLabelText(/コメントをまとめて見る/)); });
  await historyMouse(3);
  expect(currentStep()).toBeUndefined();
  expect(document.getElementById('editor-heading')).toHaveTextContent('アプリ設定');
});
it('履歴の保存待ち中に通常ページへ移ったら、遅れた完了で画面を戻さない', async () => {
  await showStep('sources', 'sources'); await click('次へ');
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const mutate = api.mutate.getMockImplementation()!;
  api.mutate.mockImplementationOnce(async (...args) => { await gate; return mutate(...args); });
  await act(async () => { fireEvent.mouseUp(window, { button: 3 }); });
  await waitFor(() => expect(screen.getByText('進み具合を保存しています…')).toBeInTheDocument());
  fireEvent.click(button('ホーム'));
  fireEvent.click(button('配信中'));
  fireEvent.click(button('設定'));
  await act(async () => { release(); });
  await waitFor(() => expect(api.snapshot!.initialSetup!.position).toBe('sources'));
  expect(currentStep()).toBeUndefined();
  expect(document.getElementById('page-heading')).toHaveTextContent('設定');
  await historyMouse(3);
  expect(document.getElementById('page-heading')).toHaveTextContent('コメントと、いつもの操作');
  await historyMouse(3);
  expect(document.getElementById('page-heading')).toHaveTextContent('配信のホーム');
  expect(document.getElementById('page-heading')).toHaveFocus();
  openApplicationSettings(); await click('はじめての設定を続ける');
  expect(currentStep()).toBe('sources');
});
it('スマホは上部の用途要約と3手順・確認欄を分け、経路選択だけでは接続せず、用途を進行記録へ保存する', async () => {
  await showStep('smartphone', 'smartphone');
  expect(screen.getByRole('heading', { name: 'スマホをつないで使う' })).toBeVisible();
  const cards = document.querySelectorAll('.setup-phone-steps>.setup-step-card');
  expect([...cards].map(card => card.querySelector('h3')?.textContent)).toEqual(['1PCの接続を準備', '2スマホを登録', '3使えるか確認']);
  const uses = screen.getByRole('region', { name: 'スマホで使う機能' });
  expect(uses).not.toHaveClass('setup-step-card');
  expect(uses).toHaveTextContent('コメントを見る');
  expect(uses.querySelector('.setup-number')).toBeNull();
  expect(screen.queryByRole('heading', { name: /使い方を確認する/ })).toBeNull();
  const check = screen.getByRole('checkbox', { name: '選んだ用途がスマホで使えることを確認できた' });
  expect(cards[2]).toContainElement(check); expect(document.querySelector('.management-body')).not.toContainElement(button('次へ'));
  expect(screen.queryByRole('button', { name: '映像をOBSに追加', exact: true })).not.toBeInTheDocument();
  const review = screen.getByRole('complementary', { name: '状態と動作の確認' });
  expect(review).toHaveTextContent('1台登録済み'); expect(review).toHaveTextContent('スマホ側で確認'); expect(review).not.toHaveTextContent('接続済み');
  api.mutate.mockClear();
  fireEvent.change(screen.getByLabelText('初回設定の接続方法'), { target: { value: 'tailscale' } });
  expect(api.mutate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'PCの接続を準備する', exact: true }));
  await waitFor(() => expect(api.mutate).toHaveBeenCalledWith('/api/smartphone/configure', 'POST', { activeNetwork: 'tailscale' }));
  openPhoneUses(); fireEvent.click(screen.getByRole('checkbox', { name: /映像・配信マイクを送る/ }));
  await waitFor(() => expect(store.view(api.snapshot!).smartphoneUses).toEqual(['comments', 'video']));
  expect(screen.queryByRole('button', { name: '映像をOBSに追加', exact: true })).not.toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: 'このPCで映像・マイクのデータを受信できた（コメント表示はスマホで確認できた）' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'PCで受信を確認する' })).toBeNull();
  expect(document.querySelector('.phone-receive-preview')).toBeNull();
  expect(document.querySelector('.setup-phone-steps')).not.toHaveTextContent('OBS');
  expect(initialSetupSteps(store.view(api.snapshot!))).not.toContain('obsControl');
});
it('スマホの上部は準備済みの設定入口を隠し、切断や読み上げOFFでは不足した入口だけを戻す', async () => {
  api.listSpeechVoices.mockResolvedValue([{ speakerUuid: 'one', name: '話者一', styles: [{ id: 1, name: '通常' }] }]);
  api.snapshot!.sourceStatuses.youtube.state = 'waiting';
  api.snapshot!.commentSpeech.engineStatus = 'ready';
  api.snapshot!.settings.commentSpeech.voice = { speakerUuid: 'one', styleId: 1 };
  api.snapshot!.settings.commentSpeech.enabled = true;
  await showStep('smartphone', 'smartphone');
  openPhoneUses(); fireEvent.click(screen.getByRole('checkbox', { name: /読み上げを聞く/ }));
  await waitFor(() => expect(screen.getByText('✓ 読み上げは準備済み')).toBeVisible());
  expect(screen.getByText('✓ コメント接続は準備済み')).toBeVisible();
  expect(screen.queryByRole('button', { name: '先に読み上げを準備する' })).toBeNull();
  expect(screen.queryByRole('button', { name: '先にコメント接続を設定する' })).toBeNull();
  api.mutate.mockClear();
  await act(async () => { api.snapshot = { ...api.snapshot!, settings: { ...api.snapshot!.settings, commentSpeech: { ...api.snapshot!.settings.commentSpeech, enabled: false } } }; emit(); });
  expect(screen.getByRole('button', { name: '先に読み上げを準備する' })).toBeVisible();
  expect(screen.queryByRole('button', { name: '先にコメント接続を設定する' })).toBeNull();
  await act(async () => { api.snapshot = { ...api.snapshot!, sourceStatuses: { ...api.snapshot!.sourceStatuses, youtube: { ...api.snapshot!.sourceStatuses.youtube, state: 'stopped' } } }; emit(); });
  expect(screen.getByRole('button', { name: '先にコメント接続を設定する' })).toBeVisible();
  expect(api.mutate).not.toHaveBeenCalled();
  expect(api.sourceAction).not.toHaveBeenCalled();
});
it('スマホ手順3は選んだ用途のAndroid操作図を示し、閲覧だけで送信や読み上げを開始しない', async () => {
  await showStep('smartphone', 'smartphone');
  const guide = document.querySelector('.setup-phone-guides') as HTMLElement;
  expect(within(guide).getByRole('heading', { name: 'コメントを見る' })).toBeVisible();
  expect(within(guide).queryByRole('heading', { name: '読み上げを聞く' })).not.toBeInTheDocument();
  openPhoneUses(); fireEvent.click(screen.getByRole('checkbox', { name: /読み上げを聞く/ }));
  await waitFor(() => expect(within(guide).getByRole('heading', { name: '読み上げを聞く' })).toBeVisible());
  openPhoneUses(); fireEvent.click(screen.getByRole('checkbox', { name: /映像・配信マイクを送る/ }));
  await waitFor(() => expect(within(guide).getByRole('heading', { name: '映像・配信マイクを送る' })).toBeVisible());
  expect(within(guide).getAllByRole('img')).toHaveLength(3);
  expect(guide).toHaveTextContent('右上のヘッドホン');
  expect(guide).toHaveTextContent('電波のアイコン（送信・配信）');
  expect(guide).not.toHaveTextContent('OBS');
  expect(guide).toHaveTextContent('このPCで受信を確認');
  expect(guide).toHaveTextContent('図解はAndroidの操作位置');
  expect(guide).toHaveTextContent('実際の接続状態を示すものではありません');
  expect(guide).toHaveTextContent('このPC画面の「この声を試聴」');
  expect(guide).toHaveTextContent('権限を許可した後');
  expect(guide).toHaveTextContent('「送信を開始」をもう一度');
  expect(guide.querySelectorAll('.setup-phone-troubleshooting')).toHaveLength(3);
  for (const help of guide.querySelectorAll<HTMLDetailsElement>('.setup-phone-troubleshooting')) expect(help.open).toBe(false);
  for (const information of ['連携先・接続方法', '届くまでは表示確認できません', 'メディア音量・Bluetoothの出力先', 'コメント設定と状態', '接続状態・失敗理由', '入力マイク・ミュート・音量']) expect(guide).toHaveTextContent(information);
  expect(guide.querySelector('.setup-phone-permission-note')).toBeVisible();
  expect(within(guide).getByText(/送信を止める/)).toBeVisible();
  expect(api.mutate.mock.calls.every(([path]) => path === '/api/management/initial-setup')).toBe(true);
  expect(api.updateSettings).not.toHaveBeenCalled();
});
it('スマホの試聴は既存APIを使い、連打・失敗・再試行で設定と本人確認を変更しない', async () => {
  await showStep('smartphone', 'smartphone');
  openPhoneUses(); fireEvent.click(screen.getByRole('checkbox', { name: /読み上げを聞く/ }));
  await waitFor(() => expect(api.snapshot!.initialSetup!.smartphoneUses).toContain('speech'));
  await act(async () => {
    api.snapshot = { ...api.snapshot!, mobileSpeech: { ...api.snapshot!.mobileSpeech, audioAvailable: true, clientCount: 1 }, smartphone: { ...api.snapshot!.smartphone!, settings: { ...api.snapshot!.smartphone!.settings, activeNetwork: 'lan' } } };emit();
  });
  const test = document.getElementById('setup-phone-speech-preview')!;
  expect(test).toHaveAttribute('aria-disabled', 'false');
  const original = api.mutate.getMockImplementation()!;
  let reject!: (reason: Error) => void;
  api.mutate.mockImplementationOnce(() => new Promise((_done,fail) => { reject = fail; }));
  api.mutate.mockClear();test.focus();fireEvent.click(test);fireEvent.click(test);
  await waitFor(() => expect(api.mutate).toHaveBeenCalledExactlyOnceWith('/api/speech/preview'));
  expect(test).toHaveFocus();expect(test).toHaveAttribute('aria-busy', 'true');expect(test).not.toBeDisabled();
  await act(async () => reject(new Error('試聴に失敗しました')));
  expect(document.getElementById('setup-phone-speech-preview-help')).toHaveTextContent('試聴に失敗しました');
  expect(test).toHaveFocus();expect(test).toHaveAttribute('aria-disabled', 'false');
  await act(async () => { api.snapshot = { ...api.snapshot!, mobileSpeech: { ...api.snapshot!.mobileSpeech, clientCount: 0 } };emit(); });
  expect(test).toHaveAttribute('aria-disabled', 'true');
  expect(document.getElementById('setup-phone-speech-preview-help')).toHaveTextContent('ヘッドホンをON');
  expect(document.getElementById('setup-phone-speech-preview-help')).toHaveTextContent('試聴に失敗しました');
  await act(async () => { api.snapshot = { ...api.snapshot!, mobileSpeech: { ...api.snapshot!.mobileSpeech, clientCount: 1 } };emit(); });
  api.mutate.mockImplementation(original);fireEvent.click(test);
  await waitFor(() => expect(test).toHaveAttribute('aria-busy', 'false'));
  expect(screen.getByRole('region', { name: '通知' })).toHaveTextContent('PCで試聴を再生しました。');
  expect(api.updateSettings).not.toHaveBeenCalled();
  expect(screen.getByRole('checkbox', { name: '選んだ用途がスマホで使えることを確認できた' })).toHaveAttribute('aria-checked', 'false');
  await act(async () => { api.snapshot = { ...api.snapshot!, mobileSpeech: { ...api.snapshot!.mobileSpeech, clientCount: 0 } };emit(); });
  expect(test).toHaveAttribute('aria-disabled', 'true');
  expect(document.getElementById('setup-phone-speech-preview-help')).toHaveTextContent('右上のヘッドホンをON');
  fireEvent.click(test);expect(api.mutate).toHaveBeenCalledTimes(2);
  await act(async () => { api.snapshot = { ...api.snapshot!, mobileSpeech: { ...api.snapshot!.mobileSpeech, audioAvailable: false, clientCount: 1 } };emit(); });
  expect(test).toHaveAttribute('aria-disabled', 'true');
  expect(document.getElementById('setup-phone-speech-preview-help')).toHaveTextContent('コメント読み上げをON');
  await act(async () => { api.snapshot = { ...api.snapshot!, mobileSpeech: { ...api.snapshot!.mobileSpeech, audioAvailable: true }, smartphone: { ...api.snapshot!.smartphone!, settings: { ...api.snapshot!.smartphone!.settings, activeNetwork: 'tailscale' } } };emit(); });
  expect(test).toHaveAttribute('aria-disabled', 'true');
  expect(document.getElementById('setup-phone-speech-preview-help')).toHaveTextContent('この接続方法でPCの接続を準備');
  fireEvent.click(test);expect(api.mutate).toHaveBeenCalledTimes(2);
});
it('スマホ操作中・進行保存中は試聴できない理由を示し、音声準備の障害も案内する', async () => {
  await showStep('smartphone', 'smartphone');
  openPhoneUses(); fireEvent.click(screen.getByRole('checkbox', { name: /読み上げを聞く/ }));
  await waitFor(() => expect(api.snapshot!.initialSetup!.smartphoneUses).toContain('speech'));
  await act(async () => { api.snapshot = { ...api.snapshot!, mobileSpeech: { ...api.snapshot!.mobileSpeech, audioAvailable: true, clientCount: 1, warning: null }, smartphone: { ...api.snapshot!.smartphone!, settings: { ...api.snapshot!.smartphone!.settings, activeNetwork: 'lan' } } };emit(); });
  const test = document.getElementById('setup-phone-speech-preview')!;
  const help = document.getElementById('setup-phone-speech-preview-help')!;
  let finish!: () => void;
  const original = api.mutate.getMockImplementation()!;
  api.mutate.mockClear();
  api.mutate.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ snapshot: api.snapshot }); }));
  fireEvent.click(screen.getByRole('button', { name: 'PCの接続準備を停止する' }));
  await waitFor(() => expect(api.mutate).toHaveBeenCalledTimes(1));
  expect(test).toHaveAttribute('aria-disabled', 'true');expect(help).toHaveTextContent('スマホ連携の操作を処理中');
  fireEvent.click(test);expect(api.mutate).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  api.mutate.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ snapshot: api.snapshot }); }));
  fireEvent.click(document.getElementById('setup-back')!);
  await waitFor(() => expect(api.mutate).toHaveBeenCalledTimes(2));
  expect(test).toHaveAttribute('aria-disabled', 'true');expect(help).toHaveTextContent('進み具合の保存');
  fireEvent.click(test);expect(api.mutate).toHaveBeenCalledTimes(2);
  await act(async () => finish());
  api.mutate.mockImplementation(original);
  await act(async () => { api.snapshot = { ...api.snapshot!, mobileSpeech: { ...api.snapshot!.mobileSpeech, audioAvailable: false, warning: 'FFmpegまたはスマホ音声の準備に失敗しました。' } };emit(); });
  expect(test).toHaveAttribute('aria-disabled', 'true');expect(help).toHaveTextContent('FFmpeg');expect(help).toHaveTextContent('要確認');
});
it('音声認識A案はモデルから配信利用までを並べ、未適用入力の開始を防ぎ、停止とOFFを残す', async () => {
  api.snapshot!.speechRecognition.modelStatus = 'ready';
  await showStep('speechRecognition', 'speechRecognition');
  const sections = document.querySelectorAll('.speech-recognition-panel>.card-details>.recognition-section');
  expect([...sections].map(section => section.querySelector('h3')?.textContent)).toEqual(['1モデルを準備', '2入力を選んで適用', '3話して試す', '4配信で使う']);
  expect(sections[3]).toContainElement(screen.getByRole('checkbox', { name: '話した言葉が文字で表示された' }));
  expect(document.querySelector('.management-body')).not.toContainElement(button('次へ'));
  api.mutate.mockClear();
  fireEvent.click(screen.getByRole('button', { name: 'プレビューを開始', exact: true }));
  await waitFor(() => expect(api.mutate).toHaveBeenCalledWith('/api/speech-recognition/preview/start'));
  const input = screen.getByLabelText('認識に使う入力'); const option = document.createElement('option'); option.value = 'other'; input.append(option);
  fireEvent.change(input, { target: { value: 'other' } });
  expect(screen.getByRole('button', { name: 'プレビューを開始', exact: true })).toHaveAttribute('aria-disabled', 'true');
  await act(async () => { api.snapshot = { ...api.snapshot!, settings: { ...api.snapshot!.settings, speechRecognition: { ...api.snapshot!.settings.speechRecognition, enabled: true } }, speechRecognition: { ...api.snapshot!.speechRecognition, previewActive: true } }; emit(); });
  expect(screen.getByRole('button', { name: 'プレビューを終了', exact: true })).toHaveAttribute('aria-disabled', 'false');
  expect(screen.getByRole('switch', { name: '配信者音声認識を配信に使う' })).toHaveAttribute('aria-disabled', 'false');
});
it('音声認識A案の右欄は実結果だけを表示し、古いセッションと終了後を区別する', async () => {
  api.snapshot!.speechRecognition.modelStatus = 'ready';
  await showStep('speechRecognition', 'speechRecognition');
  const review = screen.getByRole('complementary', { name: '状態と動作の確認' });
  expect(review).not.toHaveTextContent('今日はよろしくお願いします。');
  await act(async () => { api.snapshot = { ...api.snapshot!, speechRecognition: { ...api.snapshot!.speechRecognition, previewActive: true, sessionId: 'current', previewHistory: [{ id: 'r', sessionId: 'old', text: '実際の認識文字列', recognizedAt: new Date(0).toISOString(), audioDurationMilliseconds: 1000, recognitionDurationMilliseconds: 200 }] } }; emit(); });
  expect(within(review).getByText('実際の認識文字列')).toBeVisible(); expect(review).toHaveTextContent('前の入力・セッションの認識結果');
  await act(async () => { api.snapshot = { ...api.snapshot!, speechRecognition: { ...api.snapshot!.speechRecognition, previewActive: false } }; emit(); });
  expect(review).not.toHaveTextContent('実際の認識文字列');
});
it('スマホA案の直接接続の不正な下書き・タブ・開閉を段階移動と詳細往復で保持する', async () => {
  await showStep('smartphone', 'smartphone');
  fireEvent.change(screen.getByLabelText('初回設定の接続方法'), { target: { value: 'direct' } });
  const details = document.querySelector<HTMLDetailsElement>('.sp-advanced')!; details.open = true; fireEvent(details, new Event('toggle'));
  const field = screen.getByLabelText('共通TCP 候補1の公開IP');
  fireEvent.change(field, { target: { value: 'invalid-address' } });
  await waitFor(() => expect(button('次へ')).toHaveAttribute('aria-disabled', 'true'));
  fireEvent.click(button('詳細設定を開く ›'));
  expect(screen.getByLabelText('共通TCP 候補1の公開IP')).toBe(field);
  expect(field).toHaveValue('invalid-address'); expect(details.open).toBe(true);
  fireEvent.click(button('← はじめての設定に戻る'));
  expect(screen.getByLabelText('共通TCP 候補1の公開IP')).toBe(field); expect(field).toHaveValue('invalid-address'); expect(details.open).toBe(true);
  await click('後で設定する'); await historyMouse(3);
  expect(currentStep()).toBe('smartphone');
  expect(screen.getByLabelText('共通TCP 候補1の公開IP')).toBe(field); expect(field).toHaveValue('invalid-address'); expect(details.open).toBe(true);
});
it('スマホA案の確認欄は選択中の接続方法を示し、別経路の準備済みを流用しない', async () => {
  await showStep('smartphone', 'smartphone');
  fireEvent.change(screen.getByLabelText('初回設定の接続方法'), { target: { value: 'tailscale' } });
  const review = screen.getByRole('complementary', { name: '状態と動作の確認' });
  expect(review).toHaveTextContent('Tailscale');
  expect(within(review).getByText('PCの接続準備').parentElement).toHaveTextContent('この接続方法はOFF');
  expect(within(review).getByText('スマホの登録').parentElement).toHaveTextContent('0台登録済み');
  await act(async () => { const smartphone = structuredClone(api.snapshot!.smartphone!); smartphone.settings.activeNetwork = 'tailscale'; smartphone.networks.tailscale.registrationReady = true; api.snapshot = { ...api.snapshot!, smartphone }; emit(); });
  expect(review).toHaveTextContent('次はAndroidでQRを読み取ります。');
});
it('スマホA案は映像の準備失敗と旧受信の停止不明を区別する', async () => {
  await showStep('smartphone', 'smartphone');
  openPhoneUses(); fireEvent.click(screen.getByRole('checkbox', { name: /映像・配信マイクを送る/ }));
  await waitFor(() => expect(store.view(api.snapshot!).smartphoneUses).toContain('video'));
  await act(async () => { const smartphone = structuredClone(api.snapshot!.smartphone!); smartphone.devices[0].profiles.lan.receiver = undefined; smartphone.devices[0].profiles.lan.preparation = { video: 'error', obsControl: 'disabled' }; api.snapshot = { ...api.snapshot!, smartphone }; emit(); });
  expect(document.querySelector('.setup-phone-device-list')).toHaveTextContent('PC受信：要確認');
  await act(async () => { const smartphone = structuredClone(api.snapshot!.smartphone!); smartphone.devices[0].profiles.lan.receiver = { state: 'error', receivedBytes: 0, stopStatus: 'unknown' }; api.snapshot = { ...api.snapshot!, smartphone }; emit(); });
  expect(document.querySelector('.setup-phone-device-list')).toHaveTextContent('旧受信の停止を確認できません');
});
it('スマホA案の読み上げ途中追加は準備状態を案内し、準備後は同じ入口に戻る', async () => {
  api.listSpeechVoices.mockResolvedValue([{ speakerUuid: 'one', name: '話者一', styles: [{ id: 1, name: '通常' }] }]);
  api.snapshot!.commentSpeech.engineStatus = 'disabled';
  api.snapshot!.settings.commentSpeech.voice = null;
  api.snapshot!.settings.commentSpeech.enabled = false;
  await showStep('smartphone', 'smartphone');
  openPhoneUses(); fireEvent.click(screen.getByRole('checkbox', { name: /読み上げを聞く/ }));
  await waitFor(() => expect(store.view(api.snapshot!).smartphoneUses).toContain('speech'));
  expect(screen.getByText('読み上げの準備が必要です。先にVOICEVOXと声を準備してください。')).toBeVisible();
  const help = document.getElementById('setup-phone-audio-help') as HTMLDetailsElement;
  help.open = true; fireEvent(help, new Event('toggle'));
  await waitFor(() => expect(help.open).toBe(true));
  const entry = screen.getByRole('button', { name: '先に読み上げを準備する', exact: true }); fireEvent.click(entry);
  await act(async () => { api.snapshot = { ...api.snapshot!, commentSpeech: { ...api.snapshot!.commentSpeech, engineStatus: 'ready' }, settings: { ...api.snapshot!.settings, commentSpeech: { ...api.snapshot!.settings.commentSpeech, voice: { speakerUuid: 'one', styleId: 1 } } } }; emit(); });
  fireEvent.click(button('← はじめての設定に戻る'));
  await waitFor(() => expect(screen.getByText('声の準備は済んでいます。スマホへ送るには、読み上げ設定で「コメント読み上げ」をONにしてください。')).toBeVisible());
  expect(screen.getByRole('button', { name: '先に読み上げを準備する', exact: true })).toHaveFocus();
  expect((document.getElementById('setup-phone-audio-help') as HTMLDetailsElement).open).toBe(true);
});
it('音声認識A案は未適用の入力でプレビューを開始できない理由を案内する', async () => {
  api.snapshot!.speechRecognition.modelStatus = 'ready';
  api.snapshot!.speechRecognition.microphones = [{ id: 'new', name: '新しいマイク' }];
  await showStep('speechRecognition', 'speechRecognition');
  fireEvent.change(screen.getByLabelText('認識に使う入力'), { target: { value: 'new' } });
  expect(screen.getByRole('region', { name: 'プレビューに使う入力' })).toHaveTextContent('変更を適用してからプレビューを開始してください。');
  await act(async () => { api.snapshot = { ...api.snapshot!, settings: { ...api.snapshot!.settings, speechRecognition: { ...api.snapshot!.settings.speechRecognition, enabled: true } }, speechRecognition: { ...api.snapshot!.speechRecognition, status: 'unavailable' } }; emit(); });
  expect(screen.getByRole('region', { name: 'プレビューに使う入力' })).not.toHaveTextContent('認識しています');
});
it('スマホA案と通常画面の往復で通常側の名前・登録設定の開閉を保つ', async () => {
  await showStep('smartphone', 'smartphone');
  fireEvent.click(button('詳細設定を開く ›'));
  const details = document.querySelector<HTMLDetailsElement>('.sp-device-management')!;
  details.open = true;
  fireEvent.click(button('← はじめての設定に戻る'));
  fireEvent.click(button('詳細設定を開く ›'));
  expect(document.querySelector('.sp-device-management')).toBe(details);
  expect(details.open).toBe(true);
});
it('スマホA案の接続準備は見本と同じ明示ボタンで開始し、ONの経路を停止できる', async () => {
  await showStep('smartphone', 'smartphone');
  fireEvent.change(screen.getByLabelText('初回設定の接続方法'), { target: { value: 'tailscale' } });
  const start = screen.getByRole('button', { name: 'PCの接続を準備する', exact: true });
  expect(start).toHaveClass('setup-primary'); fireEvent.click(start);
  await waitFor(() => expect(api.mutate).toHaveBeenCalledWith('/api/smartphone/configure', 'POST', { activeNetwork: 'tailscale' }));
  await act(async () => { api.snapshot = { ...api.snapshot!, smartphone: { ...api.snapshot!.smartphone!, settings: { ...api.snapshot!.smartphone!.settings, activeNetwork: 'tailscale' } } }; emit(); });
  fireEvent.click(screen.getByRole('button', { name: 'PCの接続準備を停止する', exact: true }));
  await waitFor(() => expect(api.mutate).toHaveBeenCalledWith('/api/smartphone/configure', 'POST', { activeNetwork: null }));
});
it('スマホの用途を全解除してもONの接続準備を同じ場所で停止でき、再開は用途を要求する', async () => {
  await showStep('smartphone', 'smartphone');
  fireEvent.change(screen.getByLabelText('初回設定の接続方法'), { target: { value: 'tailscale' } });
  await act(async () => {
    api.snapshot = { ...api.snapshot!, initialSetup: { ...api.snapshot!.initialSetup!, smartphoneUses: [] }, smartphone: { ...api.snapshot!.smartphone!, settings: { ...api.snapshot!.smartphone!.settings, activeNetwork: 'tailscale' } } };
    emit();
  });
  const stop = screen.getByRole('button', { name: 'PCの接続準備を停止する', exact: true });
  expect(stop).toHaveAttribute('aria-disabled', 'false');
  fireEvent.click(stop);
  await waitFor(() => expect(api.mutate).toHaveBeenCalledWith('/api/smartphone/configure', 'POST', { activeNetwork: null }));
  await act(async () => {
    api.snapshot = { ...api.snapshot!, smartphone: { ...api.snapshot!.smartphone!, settings: { ...api.snapshot!.smartphone!.settings, activeNetwork: null } } };
    emit();
  });
  const start = screen.getByRole('button', { name: 'PCの接続を準備する', exact: true });
  expect(start).toHaveAttribute('aria-disabled', 'true');
  api.mutate.mockClear();fireEvent.click(start);expect(api.mutate).not.toHaveBeenCalled();
});
it('音声認識A案のモデル準備の主操作と4番目の見出しを見本にそろえる', async () => {
  await showStep('speechRecognition', 'speechRecognition');
  expect(screen.getByRole('button', { name: 'モデルを準備', exact: true })).toHaveClass('setup-primary');
  expect(screen.getByRole('heading', { name: '4配信で使う' })).toBeVisible();
});

it('文字演出A案は保存済みルールの反応例までとしOBSテスト送信は後続へ集約する', async () => {
  await showStep('textEffects', 'textEffects');
  expect(document.querySelector('.setup-workspace')).not.toBeNull();
  expect(document.querySelectorAll('.text-effects-panel .setup-step-card')).toHaveLength(4);
  const saved = api.snapshot!.settings.textEffects.rules[0];
  expect(document.querySelector('.setup-creative-review')).toHaveTextContent(saved.trigger + ' → ' + saved.displayText);
  fireEvent.click(screen.getByRole('button', { name: '8888 → 拍手' }));
  expect(document.querySelector('.setup-creative-review')).toHaveTextContent(saved.trigger + ' → ' + saved.displayText);
  expect(api.updateSettings).not.toHaveBeenCalled();
  expect(button('次へ')).toHaveAttribute('aria-disabled', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'ルールを保存', exact: true }));
  await waitFor(() => expect(api.snapshot!.settings.textEffects.rules.at(-1)?.trigger).toBe('8888'));
  await waitFor(() => expect(document.querySelector('.setup-creative-review')).toHaveTextContent('8888 → 👏'));
  await waitFor(() => expect(button('次へ')).not.toHaveAttribute('aria-disabled', 'true'));
  expect(api.mutate.mock.calls.some(([path]) => String(path).includes('/api/text-effects/rules/'))).toBe(false);
  expect(screen.queryByRole('button', { name: '選択ルールをOBSへテスト送信' })).toBeNull();
  expect(screen.getByText('最後の「OBSの表示確認」でソースを追加し、OBSへテスト送信します。')).toBeVisible();
  expect(screen.getByRole('checkbox', { name: '反応ワードと表示文字を確認できた' })).toHaveAttribute('aria-checked', 'false');
});
it.each([false, true])('文字演出の追加失敗をキャンセルすると保存前の一覧へ戻り、取消失敗も再試行できる: %s', async cancelFails => {
  await showStep('textEffects', 'textEffects');
  const original = structuredClone(api.snapshot!.settings.textEffects);
  api.updateSettings.mockRejectedValueOnce(new Error('追加保存に失敗'));
  fireEvent.click(screen.getByRole('button', { name: '8888 → 拍手' }));
  fireEvent.click(screen.getByRole('button', { name: 'ルールを保存', exact: true }));
  await waitFor(() => expect(document.querySelector('.setup-creative-status')).toHaveTextContent('追加保存に失敗'));
  expect(button('次へ')).toHaveAttribute('aria-disabled', 'true');
  if (cancelFails) api.updateSettings.mockRejectedValueOnce(new Error('取消保存に失敗'));
  const cancel = screen.getByRole('button', { name: 'キャンセル', exact: true });
  cancel.focus();fireEvent.click(cancel);
  if (cancelFails) {
    await waitFor(() => expect(document.querySelector('.setup-creative-status')).toHaveTextContent('取消保存に失敗'));
    expect(cancel).toHaveFocus();
    expect(screen.getByLabelText('反応ワード')).toHaveValue('8888');
    expect(button('次へ')).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(cancel);
  }
  await waitFor(() => expect(screen.queryByRole('button', { name: 'キャンセル', exact: true })).not.toBeInTheDocument());
  await waitFor(() => expect(button('次へ')).not.toHaveAttribute('aria-disabled', 'true'));
  expect(api.snapshot!.settings.textEffects).toEqual(original);
  expect(api.updateSettings).toHaveBeenLastCalledWith('textEffects', original);
  expect(screen.getByRole('combobox', { name: '編集するルール' })).toHaveFocus();
  await click('詳細設定を開く ›');
  expect(screen.getAllByRole('button', { name: '削除', exact: true })).toHaveLength(original.rules.length);
});

it('キャラクターA案は画像1枚で確認でき、口パクテストはプレビューだけに作用する', async () => {
  api.snapshot!.settings.character.simple.closedAsset = '/assets/closed.png';
  api.snapshot!.settings.character.simple.openAsset = null;
  await showStep('character', 'character');
  const check = screen.getByRole('checkbox', { name: 'キャラクターの画像を確認できた' });
  expect(check).toHaveAttribute('aria-disabled', 'false');
  expect(check.closest('.setup-step-card')).toHaveTextContent('4準備を確認する');
  const mouth = screen.getByRole('button', { name: '口パクを試す（このプレビューのみ・2秒）' });
  expect(mouth).toHaveAttribute('aria-disabled', 'true');
  await act(async () => { api.snapshot = { ...api.snapshot!, settings: { ...api.snapshot!.settings, character: { ...api.snapshot!.settings.character, simple: { ...api.snapshot!.settings.character.simple, openAsset: '/assets/open.png' } } } }; emit(); });
  expect(mouth).toHaveAttribute('aria-disabled', 'false');
  const before = api.mutate.mock.calls.length;
  fireEvent.click(mouth);
  expect(screen.getByRole('button', { name: '口パク確認中…' })).toHaveAttribute('aria-busy', 'true');
  await waitFor(() => expect(mouth).toHaveTextContent('口パクを試す'), { timeout: 3000 });
  expect(api.mutate.mock.calls.length).toBe(before);
  expect(api.snapshot!.character.mouthShape).toBe('closed');
  expect(api.snapshot!.initialSetup!.confirmations.character).toBeUndefined();
});

it('AIの前提だけの音声認識では、存在しない後続OBS表示を案内しない', async () => {
  await showStep('aiListener', 'speechRecognition');
  expect(initialSetupSteps(api.snapshot!.initialSetup!)).not.toContain('obsDisplay');
  expect(screen.getByText(/字幕が必要になったら、設定の/)).toBeVisible();
  expect(screen.queryByText(/OBSへの表示は後の/)).not.toBeInTheDocument();
});
it.each([['textEffects','コメント文字演出'], ['character','キャラクター']] as const)('OBS表示から%sの詳細を開き、同じ位置へ戻れる', async (feature,title) => {
  await showStep(feature, 'obsDisplay');
  const entry = document.getElementById('setup-detail')!;entry.focus();fireEvent.click(entry);
  expect(document.getElementById('editor-heading')).toHaveTextContent(title);
  expect(document.getElementById('editor-heading')).not.toHaveTextContent('OBSコメント表示');
  await click('← はじめての設定に戻る');
  expect(currentStep()).toBe('obsDisplay');expect(document.getElementById('setup-detail')).toHaveFocus();
});
it.each([['commentSpeech','commentSpeech'],['textEffects','textEffects'],['commentOverlay','obsDisplay'],['smartphone','smartphone']] as const)('%s単独の案内からコメント接続を設定し、同じ段階に戻れる', async (feature,position) => {
  await showStep(feature,position);
  expect(initialSetupSteps(api.snapshot!.initialSetup!)[0]).toBe('sources');
  expect(document.getElementById('setup-comment-settings')).toBeNull();
  const before = structuredClone(api.snapshot!.settings);
  fireEvent.click(document.getElementById('setup-topic-sources')!);
  await waitFor(() => expect(currentStep()).toBe('sources'));
  expect(api.snapshot!.settings).toEqual(before);
  expect(api.sourceAction).not.toHaveBeenCalled();
  fireEvent.click(document.getElementById(`setup-topic-${position === 'obsDisplay' ? 'obsControl' : position}`)!);
  if (position === 'obsDisplay') await click('次へ');
  await waitFor(() => expect(currentStep()).toBe(position));
});
it.each(['next','back','defer','finish'] as const)('進行の%s保存が失敗しても、フォーカスを保ち重複要求を防ぐ', async action => {
  await showStep('sources','sources');
  if(action === 'finish')await click('後で設定する');
  const target = document.getElementById(action === 'defer' ? 'setup-defer-sources' : 'setup-'+action)!;
  let reject!: (error: Error) => void;
  const mutate = api.mutate.getMockImplementation()!;
  api.mutate.mockImplementationOnce(() => new Promise((_done,fail) => { reject=fail; }));
  const before=api.mutate.mock.calls.length;
  target.focus();fireEvent.click(target);fireEvent.click(target);
  expect(target).not.toBeDisabled();expect(target).toHaveAttribute('aria-disabled','true');expect(target).toHaveFocus();
  expect(api.mutate.mock.calls.length).toBe(before+1);
  await act(async()=>reject(new Error('進み具合を保存できませんでした。')));
  expect(target).toHaveFocus();expect(target).toHaveAttribute('aria-disabled','false');
  api.mutate.mockImplementation(mutate);fireEvent.click(target);
  await waitFor(()=>expect(currentStep()).toBe(action === 'next' || action === 'defer' ? 'summary' : action === 'back' ? 'features' : undefined));
  if (action === 'defer') expect(document.getElementById('setup-heading')).toHaveFocus();
});
it('進行記録の再読込で手順が変わっても見出しへフォーカスを戻す', async () => {
  render(<Dashboard />);
  await click('使いたい機能を選ぶ →');
  api.snapshot = { ...api.snapshot!, initialSetup: { ...api.snapshot!.initialSetup!, autoShow: true, position: 'welcome', warning: '進行記録を確認できません。' } };
  await act(async () => { emit(); });
  api.mutate.mockImplementationOnce(async () => {
    api.snapshot = { ...api.snapshot!, initialSetup: { ...api.snapshot!.initialSetup!, position: 'character', selected: ['character'], warning: undefined } };
    emit();
    return { snapshot: api.snapshot };
  });
  const reload = document.getElementById('setup-reload')!;
  reload.focus();
  await act(async () => { fireEvent.click(reload); });
  await waitFor(() => expect(currentStep()).toBe('character'));
  expect(document.getElementById('setup-heading')).toHaveFocus();
});
it('全機能を選び、全手順を後回しにして終了・再開しても機能を自動起動しない', async () => {
  render(<Dashboard/>);await click('使いたい機能を選ぶ →');
  for(const [feature] of setupFeatures){fireEvent.click(document.getElementById('setup-feature-'+feature)!);await waitFor(()=>expect(api.snapshot!.initialSetup!.selected).toContain(feature));await waitFor(()=>expect(document.getElementById('setup-feature-'+feature)).not.toHaveAttribute('aria-disabled','true'));}
  const comments=screen.getByLabelText('コメントを見る') as HTMLInputElement;if(!comments.checked)fireEvent.click(comments);
  await waitFor(()=>expect(api.snapshot!.initialSetup!.smartphoneUses).toContain('comments'));
  await click('次へ');
  const steps=initialSetupSteps(api.snapshot!.initialSetup!);
  for(const step of steps){expect(currentStep()).toBe(step);await click('後で設定する');}
  expect(currentStep()).toBe('summary');expect(api.snapshot!.initialSetup!.deferred).toEqual(steps);
  await click('設定を終えてホームへ');expect(document.getElementById('page-heading')).toHaveFocus();
  openApplicationSettings();await click('はじめての設定を開く');expect(currentStep()).toBe('summary');
  expect(api.sourceAction).not.toHaveBeenCalled();expect(api.updateSettings).not.toHaveBeenCalled();
  expect(api.mutate.mock.calls.every(([path])=>path === '/api/management/initial-setup')).toBe(true);
}, 15_000);

it('映像・マイクだけの初回設定はOBS未設定でもPC受信の確認を記録できる', async () => {
  await showStep('smartphone', 'smartphone');
  openPhoneUses(); fireEvent.click(screen.getByRole('checkbox', { name: /映像・配信マイクを送る/ }));
  await waitFor(() => expect(store.view(api.snapshot!).smartphoneUses).toContain('video'));
  fireEvent.click(screen.getByRole('checkbox', { name: /コメントを見る/ }));
  await waitFor(() => expect(store.view(api.snapshot!).smartphoneUses).toEqual(['video']));
  const phone = api.snapshot!.smartphone!;
  const devices = structuredClone(phone.devices);
  devices[0]!.profiles.lan!.receiver = { state: 'receiving', receivedBytes: 1024 };
  await act(async () => {
    api.snapshot = { ...api.snapshot!, smartphone: { ...phone, settings: { ...phone.settings, activeNetwork: 'lan' }, devices }, obsControl: { ...api.snapshot!.obsControl!, passwordConfigured: false } };
    api.snapshot.initialSetup = store.view(api.snapshot); emit();
  });
  const review = screen.getByRole('complementary', { name: '状態と動作の確認' });
  expect(review).toHaveTextContent('データ受信中');
  expect(screen.getByText('受信データ：1,024 バイト')).toBeVisible();
  expect(review).toHaveTextContent('受信の確認');
  expect(document.querySelector('.setup-phone-steps')).not.toHaveTextContent('OBS');
  const check = screen.getByRole('checkbox', { name: 'このPCで映像・マイクのデータを受信できた' });
  await click('このPCで映像・マイクのデータを受信できた');
  expect(check).toHaveAttribute('aria-checked', 'true');
  expect(api.obsSourceContext).not.toHaveBeenCalled(); expect(api.obsSourceAdd).not.toHaveBeenCalled();
  await click('次へ'); expect(currentStep()).toBe('summary');
});

it('データ受信の確認は登録・送信報告だけや0バイト・受信停止・接続OFF・別経路では許可しない', async () => {
  await showStep('smartphone', 'smartphone');
  openPhoneUses(); fireEvent.click(screen.getByRole('checkbox', { name: /映像・配信マイクを送る/ }));
  await waitFor(() => expect(store.view(api.snapshot!).smartphoneUses).toContain('video'));
  const check = screen.getByRole('checkbox', { name: /このPCで映像・マイクのデータを受信できた/ });
  const apply = async (state: 'receiving' | 'listening' | 'error', receivedBytes: number, activeNetwork: 'lan' | null = 'lan') => {
    await act(async () => {
      const smartphone = structuredClone(api.snapshot!.smartphone!);
      smartphone.settings.activeNetwork = activeNetwork;
      smartphone.devices[0]!.profiles.lan.receiver = { state, receivedBytes };
      api.snapshot = { ...api.snapshot!, smartphone };
      api.snapshot.initialSetup = store.view(api.snapshot); emit();
    });
  };
  await apply('listening', 0); expect(check).toHaveAttribute('aria-disabled', 'true');
  await apply('receiving', 0); expect(check).toHaveAttribute('aria-disabled', 'true');
  await apply('error', 1024); expect(check).toHaveAttribute('aria-disabled', 'true');
  await apply('listening', 1024); expect(check).toHaveAttribute('aria-disabled', 'true');
  await apply('receiving', 1024); expect(check).toHaveAttribute('aria-disabled', 'false');
  fireEvent.change(screen.getByLabelText('初回設定の接続方法'), { target: { value: 'tailscale' } });
  expect(check).toHaveAttribute('aria-disabled', 'true');
  expect(screen.queryByRole('button', { name: 'PCで受信を確認する' })).toBeNull();
  fireEvent.change(screen.getByLabelText('初回設定の接続方法'), { target: { value: 'lan' } });
  await apply('receiving', 1024, null); expect(check).toHaveAttribute('aria-disabled', 'true');
});

it('OBS表示確認は接続設定を重複表示せず、未接続の案内から独立した接続段階へ戻れる', async () => {
  await showStep('commentOverlay', 'obsDisplay');
  const region = screen.getByRole('region', { name: 'OBSの接続状態' });
  expect(region).toHaveTextContent('OBS接続済み');
  expect(screen.queryByRole('button', { name: 'OBSの接続設定に戻る' })).toBeNull();
  expect(screen.queryByLabelText('OBS WebSocketポート')).toBeNull();
  expect(screen.queryByRole('heading', { name: /このPCのOBSに接続する/ })).toBeNull();
  for (const [connection, label] of [['disabled','OBS連携OFF'],['connecting','OBS接続中'],['unavailable','OBS接続不可']] as const) {
    await act(async () => { api.snapshot = { ...api.snapshot!, obsControl: { ...api.snapshot!.obsControl!, connection, error: connection === 'unavailable' ? 'OBSに接続できません。' : null } }; emit(); });
    expect(region).toHaveTextContent(label);
    expect(screen.getByRole('button', { name: 'OBSの接続設定に戻る' })).toBeVisible();
  }
  api.mutate.mockClear();
  await click('OBSの接続設定に戻る'); expect(currentStep()).toBe('obsControl');
  expect(screen.getByLabelText('OBS WebSocketポート')).toBeVisible();
  await act(async () => { api.snapshot = { ...api.snapshot!, obsControl: { ...api.snapshot!.obsControl!, connection: 'connected', error: null } }; emit(); });
  await click('次へ'); expect(currentStep()).toBe('obsDisplay');
  expect(screen.queryByLabelText('OBS WebSocketポート')).not.toBeVisible();
  expect(api.mutate.mock.calls.every(([path]) => path === '/api/management/initial-setup')).toBe(true);
});
it('OBS表示から接続設定への移動は進行保存待ち・失敗で位置とフォーカスを保持し、再試行できる', async () => {
  api.snapshot!.obsControl!.connection = 'disabled';
  await showStep('commentOverlay', 'obsDisplay');
  const entry = screen.getByRole('button', { name: 'OBSの接続設定に戻る' });
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const mutate = api.mutate.getMockImplementation()!;
  api.mutate.mockImplementationOnce(async () => { await gate; throw new Error('進行を保存できませんでした。'); });
  entry.focus(); await act(async () => { fireEvent.click(entry); });
  expect(entry).toHaveAttribute('aria-disabled', 'true');
  fireEvent.click(entry);expect(api.mutate).toHaveBeenCalledTimes(1);
  await act(async () => { release(); });
  expect(currentStep()).toBe('obsDisplay');expect(entry).toHaveFocus();
  api.mutate.mockImplementation(mutate); await click('OBSの接続設定に戻る'); expect(currentStep()).toBe('obsControl');
});

it('接続済みでも非表示のOBS接続情報が不正なら、表示確認から修正に戻れる', async () => {
  await showStep('commentOverlay', 'obsControl');
  const port = screen.getByLabelText('OBS WebSocketポート');
  fireEvent.change(port, { target: { value: '0' } });
  fireEvent.blur(port);
  await waitFor(() => expect(port).toHaveAttribute('aria-invalid', 'true'));
  await act(async () => {
    await store.update({ revision: store.view(api.snapshot!).revision, action: 'move', position: 'obsDisplay' }, () => api.snapshot!);
    api.snapshot = { ...api.snapshot!, initialSetup: store.view(api.snapshot!) }; emit();
  });
  expect(port).not.toBeVisible(); expect(button('次へ')).toHaveAttribute('aria-disabled', 'true');
  await click('OBSの接続設定に戻る');
  expect(currentStep()).toBe('obsControl'); expect(port).toBeVisible(); expect(port).toHaveValue(0);
});

it('スマホ用途は通常要約だけを表示し、途中追加したコメント接続の準備から同じ場所へ戻れる', async () => {
  await store.update({ revision: 0, action: 'select', selected: ['smartphone'], smartphoneUses: ['video'] }, () => api.snapshot!);
  await store.update({ revision: 1, action: 'move', position: 'smartphone' }, () => api.snapshot!);
  api.snapshot = { ...api.snapshot!, initialSetup: store.view(api.snapshot!), sourceStatuses: { ...api.snapshot!.sourceStatuses, youtube: { ...api.snapshot!.sourceStatuses.youtube, state: 'stopped' }, twitch: { ...api.snapshot!.sourceStatuses.twitch, state: 'stopped' }, shitaraba: { ...api.snapshot!.sourceStatuses.shitaraba, state: 'stopped' } } };
  render(<Dashboard />); openApplicationSettings(); await click('はじめての設定を続ける');
  expect(document.querySelector('.setup-phone-use-summary')).toHaveTextContent('映像・配信マイクを送る');
  expect(document.querySelector('.setup-phone-use-editor')).not.toHaveAttribute('open');
  expect(screen.getByRole('checkbox', { name: /コメントを見る/ })).not.toBeVisible();
  const before = api.mutate.mock.calls.length; openPhoneUses();
  expect(api.mutate).toHaveBeenCalledTimes(before);
  fireEvent.click(screen.getByRole('checkbox', { name: /コメントを見る/ }));
  await waitFor(() => expect(store.view(api.snapshot!).smartphoneUses).toContain('comments'));
  expect(screen.getByText('コメント接続の準備が必要です。先に使うサービスの接続先と接続状態を確認してください。')).toBeVisible();
  const entry = screen.getByRole('button', { name: '先にコメント接続を設定する' }); entry.focus(); fireEvent.click(entry);
  expect(document.getElementById('editor-heading')).toHaveTextContent('コメント取得');
  expect(api.sourceAction).not.toHaveBeenCalled();
  await act(async () => { api.snapshot = { ...api.snapshot!, sourceStatuses: { ...api.snapshot!.sourceStatuses, youtube: { ...api.snapshot!.sourceStatuses.youtube, state: 'waiting' } } }; emit(); });
  await click('← はじめての設定に戻る');
  expect(currentStep()).toBe('smartphone'); expect(document.getElementById('setup-phone-comment-settings')).toHaveFocus();
  expect(document.querySelector('.setup-phone-use-editor')).toHaveAttribute('open');
  expect(screen.getByText('✓ コメント接続は準備済み')).toBeVisible();
  expect(screen.queryByRole('button', { name: '先にコメント接続を設定する' })).toBeNull();
});
it.each(['aiListener', 'commentOverlay'] as const)('%sのOBS接続への次へは、表示確認と区別した行き先を示す', async feature => {
  await showStep(feature, feature === 'aiListener' ? 'speechRecognition' : 'sources');
  expect(button('次へ')).toHaveTextContent('次はOBSの接続');
  await click('次へ'); expect(currentStep()).toBe('obsControl');
  if (feature === 'commentOverlay') expect(button('次へ')).toHaveTextContent('次はOBSの表示確認');
  else expect(button('次へ')).toHaveTextContent('AIリスナー');
});
