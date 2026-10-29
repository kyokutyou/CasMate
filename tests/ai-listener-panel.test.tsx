// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AiListenerPanel } from '../src/renderer/components/AiListenerPanel';
import userEvent from '@testing-library/user-event';
import { defaultAiSettings, type AiView } from '../src/shared/ai-listener';
import { ManagementNavigation } from '../src/renderer/management-navigation';
import { emptyAiApiUsage, emptyAiOutcomes } from '../src/shared/ai-usage';

const view: AiView = { postingBudget: { used: 0, limit: 60, nextAllowedAt: null }, requested: false, status: 'stopped', message: '停止中', nextAt: null, memoryCharacters: 123, hasKey: false, authorization: null, services: {
  youtube: { ready: false, message: '', account: null, latest: null }, twitch: { ready: false, message: '', account: null, latest: null }, shitaraba: { ready: false, message: '', account: null, latest: null }, jpnkn: { ready: false, message: '', account: null, latest: null },
} };
afterEach(() => { cleanup(); localStorage.clear(); });

it('停止中は処理段階を隠して主操作へ案内し、開始要求後に処理状況を表示する', () => {
  const props = { settings: defaultAiSettings(), change: vi.fn(), mutate: vi.fn() };
  const result = render(<AiListenerPanel {...props} view={view} />);
  const progress = screen.getByLabelText('AIリスナーの処理状況');
  expect(progress).not.toBeVisible(); expect(progress).toHaveAttribute('tabindex', '-1');
  result.rerender(<AiListenerPanel {...props} view={{ ...view, requested: true }} />);
  expect(progress).toBeVisible(); expect(progress).toHaveAttribute('tabindex', '0');
});

it('初回設定は保存済みの参加先ごとに人格と投稿認証の不足を表示する', () => {
  const saved = defaultAiSettings();
  saved.personas = [{ id: 'p', name: '保存した人格', personality: '', tone: '', firstPerson: '', topics: '', notes: '' }];
  saved.participants.youtube = { enabled: true, personaId: 'p' };
  saved.participants.twitch = { enabled: true, personaId: '' };
  const draft = structuredClone(saved); draft.participants.twitch.personaId = 'p';
  render(<ManagementNavigation.Provider value={{ editor: 'aiListener', initialSetup: true, open: vi.fn(), reportError: vi.fn() }}><AiListenerPanel settings={draft} savedSettings={saved} view={{ ...view, hasKey: true }} change={vi.fn()} mutate={vi.fn()} /></ManagementNavigation.Provider>);
  const preparation = screen.getByRole('region', { name: '保存済みのAI利用準備' });
  expect(preparation).toHaveTextContent('YouTube Live投稿アカウントを連携してください');
  expect(preparation).toHaveTextContent('Twitch人格を選んでください・投稿アカウントを連携してください');
});
it.each(['success','failure'] as const)('初回設定のキー保存は二重要求を防ぎ、%sでも同じボタンにフォーカスを保つ', async outcome => {
  let resolve!: () => void; let reject!: (error: Error) => void;
  const mutate = vi.fn(() => new Promise<void>((done, fail) => { resolve = done; reject = fail; }));
  render(<ManagementNavigation.Provider value={{ editor: 'aiListener', initialSetup: true, open: vi.fn(), reportError: vi.fn() }}><AiListenerPanel settings={defaultAiSettings()} view={view} change={vi.fn()} mutate={mutate} /></ManagementNavigation.Provider>);
  fireEvent.change(screen.getByLabelText(/Gemini APIキー/), { target: { value: 'test-key' } });
  const button = screen.getByRole('button', { name: 'APIキーを保存' });button.focus();fireEvent.click(button);fireEvent.click(button);
  expect(button).toHaveFocus();expect(button).not.toBeDisabled();expect(button).toHaveAttribute('aria-disabled','true');expect(mutate).toHaveBeenCalledOnce();
  await act(async () => { if(outcome === 'success') resolve();else reject(new Error('保存できませんでした。')); });
  expect(button).toHaveFocus();expect(button).not.toBeDisabled();expect(button).toHaveAttribute('aria-disabled', outcome === 'success' ? 'true' : 'false');
});
describe('AI管理カード', () => {
  it('人格を追加する案内は編集中の人格を保持し、その名前入力へ戻る', () => {
    const settings = defaultAiSettings();settings.participants.jpnkn.enabled = true;
    render(<AiListenerPanel settings={settings} view={{ ...view, hasKey: true }} change={vi.fn()} mutate={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: '人格' }));fireEvent.click(within(screen.getByRole('tabpanel', { name: '人格' })).getByRole('button', { name: '人格を追加' }));
    const input = screen.getByLabelText('管理用の名前（必須）');fireEvent.change(input, { target: { value: '編集中の人格' } });
    fireEvent.click(screen.getByRole('tab', { name: '発言の調整' }));fireEvent.click(within(document.querySelector('.ai-runtime')!).getByRole('button', { name: '人格を追加' }));
    expect(input).toHaveValue('編集中の人格');expect(input).toHaveFocus();
  });
  it('停止中の接続待ちから開始してAI用のコメント取得を起動できる', async () => {
    const settings = defaultAiSettings();settings.personas = [{ id: 'p', name: '相棒', personality: '', tone: '', firstPerson: '', topics: '', notes: '' }];settings.participants.jpnkn = { enabled: true, personaId: 'p' };
    const mutate = vi.fn(async () => undefined);
    render(<AiListenerPanel settings={settings} view={{ ...view, hasKey: true, services: { ...view.services, jpnkn: { ...view.services.jpnkn, message: 'コメント取得を待っています。' } } }} change={vi.fn()} mutate={mutate} />);
    fireEvent.click(screen.getByRole('button', { name: '開始', exact: true }));
    await waitFor(() => expect(mutate).toHaveBeenCalledWith('/api/ai-listener/start', 'POST', undefined));
  });
  it.each([
    ['Gemini APIキー（', 'APIキーを保存', 'key', 'draft-a', 'draft-b'],
    ['YouTubeの認証設定JSON（デスクトップアプリ）', 'YouTube登録情報を保存', 'youtubeJson', 'draft-a', 'draft-b'],
    ['Twitch Public Client ID', 'Twitch登録情報を保存', 'twitchClientId', 'draft-a', 'draft-b'],
  ])('資格情報の保存失敗と保存中の再入力を保持する：%s', async (label, buttonName, field, first, second) => {
    let finish: (value?: unknown) => void = () => {};
    const mutate = vi.fn().mockRejectedValueOnce(new Error('保存できません。')).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<AiListenerPanel settings={defaultAiSettings()} view={view} change={vi.fn()} mutate={mutate} />);
    fireEvent.click(screen.getByRole('tab', { name: '連携' }));document.querySelectorAll('#ai-panel-connections details').forEach(details => { details.open = true; });
    const input = screen.getByLabelText(new RegExp(label));
    fireEvent.change(input, { target: { value: first } });fireEvent.click(screen.getByRole('button', { name: buttonName }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('保存できません。'));expect(input).toHaveValue(first);
    fireEvent.click(screen.getByRole('button', { name: buttonName }));expect(mutate).toHaveBeenLastCalledWith('/api/ai-listener/credentials', 'POST', { [field]: first });
    fireEvent.change(input, { target: { value: second } });await act(async () => finish());expect(input).toHaveValue(second);
  });
  it('見本の注意色と設定待ちの理由を表示し、認証案内を状態領域に収める', () => {
    const settings = defaultAiSettings();const panel = (state: AiView) => <AiListenerPanel settings={settings} view={state} change={vi.fn()} mutate={vi.fn()} />;
    const result = render(panel(view));
    expect(screen.getByText('準備が必要')).toHaveAttribute('data-tone', 'warning');
    expect(screen.getByLabelText('AIリスナーの処理状況')).toHaveTextContent('現在：設定を待っています');
    result.rerender(panel({ ...view, authorization: { source: 'twitch', url: 'https://example.com/authorize', code: 'ABCD', expiresAt: 123456789 } }));
    const auth = screen.getByRole('link', { name: /Twitch：/ });expect(auth.closest('.ai-runtime-message')).not.toBeNull();
    expect(screen.getByText('ABCD')).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: '人格' }));expect(auth).toBeVisible();
    auth.focus();const status = auth.closest('.ai-runtime-message');result.rerender(panel(view));expect(status).toHaveFocus();
  });
  it('OBS連動の停止中に前回の投稿障害が残っていても自動開始を止められる', async () => {
    const settings = defaultAiSettings();settings.mode = 'obs';settings.personas = [{ id: 'p', name: '相棒', personality: '', tone: '', firstPerson: '', topics: '', notes: '' }];settings.participants.jpnkn = { enabled: true, personaId: 'p' };
    const mutate = vi.fn(async () => undefined);
    render(<AiListenerPanel settings={settings} view={{ ...view, hasKey: true, services: { ...view.services, jpnkn: { ...view.services.jpnkn, message: '投稿結果が不明です。' } } }} change={vi.fn()} mutate={mutate} />);
    expect(screen.getByRole('button', { name: '確認後に再開' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '自動開始を止める' }));
    await waitFor(() => expect(mutate).toHaveBeenCalledWith('/api/ai-listener/stop', 'POST', undefined));
  });
  it.each(['participants', 'latest'])('サービスの再開が完了してボタンが消えても同じ欄へフォーカスを戻す：%s', async place => {
    const settings = defaultAiSettings();settings.personas = [{ id: 'p', name: '相棒', personality: '', tone: '', firstPerson: '', topics: '', notes: '' }];settings.participants.jpnkn = { enabled: true, personaId: 'p' };
    const mutate = vi.fn(async () => undefined);
    const state = { ...view, hasKey: true, services: { ...view.services, jpnkn: { ...view.services.jpnkn, message: '投稿結果が不明です。' } } };
    const panel = (next: AiView) => <AiListenerPanel settings={settings} view={next} change={vi.fn()} mutate={mutate} />;
    const result = render(panel(state));
    if (place === 'participants') fireEvent.click(screen.getByRole('tab', { name: '参加先' }));
    else fireEvent.click(screen.getByText('接続状態・最新投稿'));
    const region = document.querySelector(place === 'participants' ? '#ai-panel-participants' : '.ai-latest')!;
    const button = within(region).getByRole('button', { name: 'jpnknを再開' });button.focus();fireEvent.click(button);
    await waitFor(() => expect(mutate).toHaveBeenCalledWith('/api/ai-listener/resume', 'POST', { source: 'jpnkn' }));
    result.rerender(panel({ ...state, services: { ...state.services, jpnkn: { ...state.services.jpnkn, ready: true, message: '' } } }));
    expect(button).not.toBeInTheDocument();
    expect(place === 'participants' ? screen.getByLabelText('jpnknで使う人格') : region.querySelector('.ai-latest-item:last-child')).toHaveFocus();
  });
  it('不足設定へ案内するだけでは保存・認証・開始を行わず、該当入力へフォーカスする', async () => {
    const settings = defaultAiSettings();settings.personas = [{ id: 'p', name: '相棒', personality: '', tone: '', firstPerson: '', topics: '', notes: '' }];
    settings.participants.jpnkn.enabled = true;
    const mutate = vi.fn(), change = vi.fn();
    const result = render(<AiListenerPanel settings={settings} view={{ ...view, hasKey: true }} change={change} mutate={mutate} />);
    fireEvent.click(screen.getByRole('button', { name: '人格を選ぶ' }));
    await waitFor(() => expect(screen.getByLabelText('jpnknで使う人格')).toHaveFocus());
    expect(screen.getByRole('tab', { name: '参加先' })).toHaveAttribute('aria-selected', 'true');
    settings.participants.jpnkn.enabled = false;settings.participants.youtube.enabled = true;
    result.rerender(<AiListenerPanel settings={settings} view={{ ...view, hasKey: true }} change={change} mutate={mutate} />);
    fireEvent.click(within(document.querySelector('.ai-runtime')!).getByRole('button', { name: '投稿アカウントを連携' }));
    await waitFor(() => expect(screen.getByLabelText('YouTubeの認証設定JSON（デスクトップアプリ）')).toHaveFocus());
    expect(screen.getByLabelText('YouTubeの認証設定JSON（デスクトップアプリ）').closest('details')).toHaveAttribute('open');
    expect(screen.getByLabelText('Twitch Public Client ID').closest('details')).not.toHaveAttribute('open');
    expect(change).not.toHaveBeenCalled();expect(mutate).not.toHaveBeenCalled();
  });
  it('停止中の不要な操作を隠し、稼働中の停止と必要な確認後の再開を維持する', async () => {
    const settings = defaultAiSettings();const mutate = vi.fn(async () => undefined);
    const panel = (state: AiView) => <AiListenerPanel settings={settings} view={state} change={vi.fn()} mutate={mutate} />;
    const result = render(panel(view));expect(screen.queryByRole('button', { name: '停止', exact: true })).toBeNull();expect(screen.queryByRole('button', { name: '確認後に再開' })).toBeNull();
    result.rerender(panel({ ...view, requested: true, status: 'running' }));fireEvent.click(screen.getByRole('button', { name: '停止', exact: true }));
    await waitFor(() => expect(mutate).toHaveBeenCalledWith('/api/ai-listener/stop', 'POST', undefined));
    result.rerender(panel({ ...view, status: 'attention', message: '投稿結果を確認してください。' }));
    fireEvent.click(screen.getByRole('button', { name: '投稿結果を確認' }));expect(document.querySelector('.ai-latest')).toHaveAttribute('open');
    expect(mutate).toHaveBeenCalledTimes(1);fireEvent.click(screen.getByRole('button', { name: '確認後に再開' }));
    await waitFor(() => expect(mutate).toHaveBeenLastCalledWith('/api/ai-listener/resume', 'POST', undefined));
  });
  it('ばらつきの範囲を示し、最低30秒の補正と不正入力を区別する', () => {
    const settings = defaultAiSettings();const renderPanel = () => <AiListenerPanel settings={settings} view={view} change={vi.fn()} mutate={vi.fn()} />;
    const result = render(renderPanel());expect(screen.getByText('待つ時間の目安：48〜72秒')).toBeVisible();
    settings.waitSeconds = 30;settings.jitterPercent = 50;result.rerender(renderPanel());expect(screen.getByText('待つ時間の目安：30〜45秒')).toBeVisible();
    settings.jitterPercent = 51;result.rerender(renderPanel());expect(screen.getByText('待ち時間：30〜3600秒、ばらつき：0〜50%')).toBeVisible();
  });
  it('全サービスの投稿障害でも開始要求を取り消せる', async () => {
    const settings = defaultAiSettings();settings.personas = [{ id: 'p', name: '相棒', personality: '', tone: '', firstPerson: '', topics: '', notes: '' }];settings.participants.jpnkn = { enabled: true, personaId: 'p' };
    const mutate = vi.fn(async () => undefined);
    render(<AiListenerPanel settings={settings} view={{ ...view, hasKey: true, requested: true, status: 'paused', services: { ...view.services, jpnkn: { ...view.services.jpnkn, message: '投稿結果が不明です。' } } }} change={vi.fn()} mutate={mutate} />);
    expect(screen.getByRole('button', { name: '確認後に再開' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '開始要求を取り消す' }));
    await waitFor(() => expect(mutate).toHaveBeenCalledWith('/api/ai-listener/stop', 'POST', undefined));
  });
  it('見本1どおり状態詳細・開始条件・キー保存・人格名をまとまりの中に配置する', () => {
    render(<AiListenerPanel settings={defaultAiSettings()} view={view} change={vi.fn()} mutate={vi.fn()} />);
    expect(document.querySelector('.ai-runtime .ai-duration-details')).not.toBeNull();
    expect(document.querySelector('.ai-runtime .ai-latest')).not.toBeNull();
    expect(document.querySelector('.ai-mode select')).not.toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: '連携' }));
    expect(document.querySelector('.ai-credential-row input[type=password]')).not.toBeNull();
    expect(document.querySelector('.ai-credential-row button')).toHaveTextContent('APIキーを保存');
    fireEvent.click(screen.getByRole('tab', { name: '人格' }));
    fireEvent.click(screen.getByRole('button', { name: '人格を追加' }));
    expect(screen.getByLabelText('管理用の名前（必須）').closest('.ai-fields')).toBeNull();
  });
  it.each([
    ['OBS接続・配信状態の確認待ちです。', true], ['OBS配信先への再接続待ちです。', true],
    ['OBS配信開始待ちです。', false], ['会話を聞いています。', false],
    ['音声認識を待っています。', false], ['投稿上限による待機中です。会話は記憶しています。', false],
  ])('OBS設定への入口は対処が必要な状態だけに表示する：%s', (message, visible) => {
    const open = vi.fn(), mutate = vi.fn(), change = vi.fn();
    const panel = (requested: boolean) => <ManagementNavigation.Provider value={{ editor: 'aiListener', open, reportError: vi.fn() }}><AiListenerPanel settings={defaultAiSettings()} view={{ ...view, requested, message }} change={change} mutate={mutate} /></ManagementNavigation.Provider>;
    const result = render(panel(true));
    expect(Boolean(screen.queryByRole('button', { name: 'OBS設定を開く' }))).toBe(visible);
    expect(document.querySelector('#ai-panel-behavior .ai-details')).not.toHaveAttribute('open');
    expect(screen.getByRole('spinbutton', { name: '発言待ち時間' })).toHaveAccessibleDescription('秒');
    expect(screen.getByRole('spinbutton', { name: '待ち時間のばらつき' })).toHaveAccessibleDescription('±%');
    result.rerender(panel(false));
    expect(screen.queryByRole('button', { name: 'OBS設定を開く' })).toBeNull();
    expect(change).not.toHaveBeenCalled(); expect(mutate).not.toHaveBeenCalled();
  });
  it.each([
    ['youtube', 'YouTube Live'], ['twitch', 'Twitch'], ['shitaraba', 'したらば'], ['jpnkn', 'jpnkn'],
  ] as const)('初回設定では%sの再開操作を除外し、詳細画面では同じAPIを使う', (source, label) => {
    const mutate = vi.fn(); const settings = defaultAiSettings();
    settings.personas = [{ id: 'p', name: '人格', personality: '', tone: '', firstPerson: '', topics: '', notes: '' }];
    settings.participants[source] = { enabled: true, personaId: 'p' };
    const state = { ...view, services: { ...view.services, [source]: { ...view.services[source], account: '配信用', message: '接続を確認してください' } } };
    const panel = (basic: boolean) => <ManagementNavigation.Provider value={{ editor: 'aiListener', initialSetup: basic, open: vi.fn(), reportError: vi.fn() }}>
      <AiListenerPanel settings={settings} view={state} change={vi.fn()} mutate={mutate} />
    </ManagementNavigation.Provider>;
    const result = render(panel(true));
    expect(screen.getByRole('heading', { name: /参加先を選ぶ/ })).toBeVisible();
    expect(screen.queryAllByRole('button', { name: /再開/, hidden: true })).toHaveLength(0);
    expect(mutate).not.toHaveBeenCalled();
    result.rerender(panel(false)); fireEvent.click(screen.getByRole('tab', { name: '参加先' }));
    fireEvent.click(within(screen.getByRole('tabpanel', { name: '参加先' })).getByRole('button', { name: `${label}を再開` }));
    expect(mutate).toHaveBeenCalledExactlyOnceWith('/api/ai-listener/resume', 'POST', { source });
  });
  it('起動中の送信・取得済みトークン・通常結果を表示し、欠測と0を区別する', () => {
    const panel = (state: AiView) => <AiListenerPanel settings={defaultAiSettings()} view={state} change={vi.fn()} mutate={vi.fn()} />;
    const result = render(panel(view));
    const usage = screen.getByLabelText('今回の起動中のAPI使用量');
    fireEvent.click(screen.getByText('今回の起動中のAPI使用量', { selector: 'summary' }));
    expect(usage).toHaveTextContent('入力未取得');
    const input = screen.getByRole('spinbutton', { name: '発言待ち時間' }); input.focus();
    result.rerender(panel({ ...view, usage: { api: { ...emptyAiApiUsage(), requests: 4, pending: 1,
      input: { tokens: 0, responses: 2 }, output: { tokens: 12, responses: 1 }, total: { tokens: 100, responses: 1 } },
      outcomes: { ...emptyAiOutcomes(), succeeded: 1, skipped: 2, cancelled: 3, failed: 4, unknown: 5 } } }));
    expect(usage).toHaveTextContent('API送信試行4回'); expect(usage).toHaveTextContent('処理中1件');
    expect(usage).toHaveTextContent('入力0トークン（取得2件）'); expect(usage).toHaveTextContent('全体100トークン（取得1件）');
    expect(usage).toHaveTextContent('投稿成功1件'); expect(usage).toHaveTextContent('見送り2件'); expect(usage).toHaveTextContent('取消3件');
    expect(usage).toHaveTextContent('失敗4件'); expect(usage).toHaveTextContent('結果不明5件');
    expect(input).toHaveFocus();
  });
  it('通常画面で発話待ちと生成段階・直近時間を表示し、状態更新後も入力とエラーを保持する', () => {
    const settings = defaultAiSettings(); const panel = (state: AiView, saveError?: string) => <AiListenerPanel settings={settings} view={state} saveError={saveError} change={vi.fn()} mutate={vi.fn()} />;
    const result = render(panel({ ...view, requested: true, status: 'running', nextAt: 1789257660000, activity: { stage: 'speaking', startedAt: 1, lastDurationsMs: {} } }));
    const progress = screen.getByLabelText('AIリスナーの処理状況'); expect(progress).toHaveTextContent('配信者の発話待ち');
    expect(progress).toHaveTextContent(`次の発言チェック：${new Date(1789257660000).toLocaleTimeString()}`); expect(progress).toHaveTextContent('投稿予約ではありません');
    const input = screen.getByRole('spinbutton', { name: '発言待ち時間' }); input.focus();
    result.rerender(panel({ ...view, requested: true, status: 'running', activity: { stage: 'generating', startedAt: 2, lastDurationsMs: { 'obs-check': 100, 'image-preparation': 250, generating: 2000, posting: 500 } } }, '設定を保存できません。'));
    expect(progress).toHaveTextContent('AIの発言を生成中');
    fireEvent.click(screen.getByText('処理時間を確認')); expect(screen.getByText(/生成 2.0秒/)).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('設定を保存できません。'); expect(input).toHaveFocus();
    expect(screen.queryByText(/secret/)).not.toBeInTheDocument();
  });
  it('保存済みキーでGemini APIを1回だけ試し、結果と共通成功通知を表示する', async () => {
    const settings = defaultAiSettings();
    let finish!: (value: unknown) => void;
    const mutate = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    const onSuccess = vi.fn();
    render(<AiListenerPanel settings={settings} view={{ ...view, hasKey: true }} change={vi.fn()} mutate={mutate} onSuccess={onSuccess} />);
    fireEvent.click(screen.getByRole('tab', { name: '連携' }));
    const test = screen.getByRole('button', { name: 'Gemini接続をテスト' });
    fireEvent.click(test); fireEvent.click(test);
    expect(mutate).toHaveBeenCalledExactlyOnceWith('/api/ai-listener/test-api', 'POST', {});
    expect(test).toHaveAttribute('aria-disabled', 'true');
    finish({ model: settings.model, message: '文章応答を確認しました。' });
    await waitFor(() => expect(screen.getByLabelText('Gemini APIテストの結果')).toHaveTextContent('文章応答を確認しました'));
    expect(onSuccess).toHaveBeenCalledExactlyOnceWith('Gemini APIのテストに成功しました。');
  });
  it('キー未保存・入力中・AI開始希望中にはAPIテストを送らない', () => {
    const settings = defaultAiSettings(), mutate = vi.fn();
    const rendered = render(<AiListenerPanel settings={settings} view={view} change={vi.fn()} mutate={mutate} />);
    fireEvent.click(screen.getByRole('tab', { name: '連携' }));
    const test = () => screen.getByRole('button', { name: 'Gemini接続をテスト' });
    fireEvent.click(test()); expect(mutate).not.toHaveBeenCalled();
    rendered.rerender(<AiListenerPanel settings={settings} view={{ ...view, hasKey: true }} change={vi.fn()} mutate={mutate} />);
    fireEvent.change(screen.getByLabelText(/Gemini APIキー（/), { target: { value: 'unsaved-key' } });
    fireEvent.click(test()); expect(mutate).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Gemini APIキー（/), { target: { value: '' } });
    rendered.rerender(<AiListenerPanel settings={settings} view={{ ...view, hasKey: true, requested: true }} change={vi.fn()} mutate={mutate} />);
    fireEvent.click(test()); expect(mutate).not.toHaveBeenCalled();
  });
  it('APIテスト中にモデルが変わると古い成功を表示・通知しない', async () => {
    const settings = defaultAiSettings(); let finish!: (value: unknown) => void;
    const mutate = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    const onSuccess = vi.fn(), change = vi.fn();
    const renderPanel = (model = settings.model) => <AiListenerPanel settings={{ ...settings, model }} view={{ ...view, hasKey: true }} change={change} mutate={mutate} onSuccess={onSuccess} />;
    const result = render(renderPanel()); fireEvent.click(screen.getByRole('tab', { name: '連携' }));
    fireEvent.click(screen.getByRole('button', { name: 'Gemini接続をテスト' }));
    result.rerender(renderPanel('another-model'));
    await act(async () => { finish({ model: settings.model }); });
    expect(onSuccess).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Gemini APIテストの結果')).toHaveTextContent('まだ行っていません');
  });
  it('jpnknの参加・人格・名前・メールをしたらばとは独立して編集できる', () => {
    const change = vi.fn(); const settings = defaultAiSettings();
    settings.shitarabaName = 'したらばAI'; settings.shitarabaEmail = 'sage';
    render(<AiListenerPanel settings={settings} view={view} change={change} mutate={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: '参加先' }));
    expect(screen.getAllByRole('switch')).toHaveLength(4);
    const toggle = screen.getByRole('switch', { name: 'jpnknに参加' }); expect(toggle).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(toggle); expect(change).toHaveBeenLastCalledWith(expect.objectContaining({ participants: { ...settings.participants, jpnkn: { enabled: true, personaId: '' } } }));
    fireEvent.click(screen.getAllByText('投稿者名・E-mail', { selector: 'summary' })[1]);
    fireEvent.change(screen.getByLabelText('jpnknの名前'), { target: { value: 'jpnknAI' } });
    expect(change).toHaveBeenLastCalledWith(expect.objectContaining({ jpnknName: 'jpnknAI', shitarabaName: 'したらばAI' }));
    fireEvent.change(screen.getByLabelText('jpnknのE-mail'), { target: { value: 'mail' } });
    expect(change).toHaveBeenLastCalledWith(expect.objectContaining({ jpnknEmail: 'mail', shitarabaEmail: 'sage' }));
    expect(screen.getByText(/ブラウザで確認してから/)).toBeVisible();
  });
  it('固定上限とOBS必須条件を表示し、設定へ移動できる', () => {
    const open = vi.fn(); const settings = defaultAiSettings();
    const renderPanel = (state: AiView) => <ManagementNavigation.Provider value={{ editor: 'aiListener', open, reportError: () => {} }}><AiListenerPanel settings={settings} view={state} change={vi.fn()} mutate={vi.fn()} /></ManagementNavigation.Provider>;
    const result = render(renderPanel(view));
    expect(screen.queryByRole('button', { name: 'OBS設定を開く' })).toBeNull();
    expect(screen.getByText('どちらもOBS配信中だけ動作します。')).toBeVisible();
    expect(screen.getByRole('spinbutton', { name: '発言待ち時間' })).toHaveAttribute('min', '30');
    fireEvent.click(screen.getByText('発言の条件・上限について'));
    expect(screen.getByText(/全サービス合計で直近60分に60件/)).toBeVisible();
    result.rerender(renderPanel({ ...view, requested: true, status: 'paused', message: 'OBS接続・配信状態の確認待ちです。' }));
    const obs = screen.getByRole('button', { name: 'OBS設定を開く' });
    expect(obs.closest('.ai-runtime')).not.toBeNull();
    fireEvent.click(obs); expect(open).toHaveBeenCalledWith('obsControl', expect.any(HTMLElement));
    const input = screen.getByRole('spinbutton', { name: '発言待ち時間' }); input.focus();
    result.rerender(renderPanel({ ...view, requested: true, status: 'running', postingBudget: { used: 60, limit: 60, nextAllowedAt: Date.now() + 30000 }, message: '投稿上限による待機中です。会話は記憶しています。' }));
    expect(screen.getByText('直近60分の投稿枠：60 / 60件')).toBeVisible();
    expect(screen.getByText(/解除時刻は投稿の予約ではありません/)).toBeVisible(); expect(input).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'OBS設定を開く' })).toBeNull();
  });
  it('参加先のスイッチをEnterとSpaceで切り替え、人格割当を維持する', async () => {
    const user = userEvent.setup(); const change = vi.fn(); const settings = defaultAiSettings();
    render(<AiListenerPanel settings={settings} view={view} change={change} mutate={vi.fn()} />);
    await user.click(screen.getByRole('tab', { name: '参加先' }));
    const toggle = screen.getByRole('switch', { name: 'YouTube Liveに参加' });
    toggle.focus(); await user.keyboard('{Enter}');
    expect(change).toHaveBeenLastCalledWith(expect.objectContaining({ participants: { ...settings.participants, youtube: { ...settings.participants.youtube, enabled: true } } }));
    await user.keyboard(' '); expect(change).toHaveBeenCalledTimes(2);
  });
  it('保存量とは別に会話の送信上限を変更できる', () => {
    const change = vi.fn();
    render(<AiListenerPanel settings={defaultAiSettings()} view={view} change={change} mutate={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: '記憶・ログ' }));
    const field = screen.getByRole('spinbutton', { name: '送信する会話本文の上限' });
    expect(field).toHaveValue(3000);
    fireEvent.change(field, { target: { value: '2000' } });
    expect(change).toHaveBeenCalledWith(expect.objectContaining({ contextCharacters: 2000, memoryCharacters: 10000 }));
    fireEvent.click(screen.getByText('記憶と送信量について'));
    expect(screen.getByText(/入力トークン数の保証ではありません/)).toBeVisible();
  });
  it('発言文字数は上限ではなく目標として表示する', () => {
    render(<AiListenerPanel settings={defaultAiSettings()} view={view} change={vi.fn()} mutate={vi.fn()} />);
    expect(screen.getByText('発言文字数の目標')).toBeVisible();
    fireEvent.click(screen.getByText('発言の条件・上限について'));
    expect(screen.getByText(/会話に合う長さで生成/)).toBeVisible();
    expect(screen.queryByText('発言文字数の上限')).toBeNull();
  });
  it('プロンプトログは初期オフで、会話が残る説明付きで有効にできる', () => {
    const change = vi.fn();
    render(<AiListenerPanel settings={defaultAiSettings()} view={view} change={change} mutate={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: '記憶・ログ' }));
    fireEvent.click(screen.getByText('デバッグ用の記録'));
    const checkbox = screen.getByRole('checkbox', { name: '送信プロンプトをデバッグログに保存' });
    expect(checkbox).not.toBeChecked(); fireEvent.click(checkbox);
    expect(change).toHaveBeenCalledWith(expect.objectContaining({ debugPromptLog: true }));
    expect(screen.getByText(/共有記憶の削除やオフへの変更では既存ログは消えません/)).toBeVisible();
  });
  it('詳細を閉じても開始停止とサービス別最新投稿を確認できる', async () => {
    const mutate = vi.fn(async () => undefined); const latest = { id: '1', at: '2026-09-13T00:00:00Z', source: 'youtube' as const, target: '', personaId: 'p', personaName: '人格', text: '最新コメント', result: 'unknown' as const };
    render(<AiListenerPanel settings={defaultAiSettings()} view={{ ...view, requested: true, status: 'running', services: { ...view.services, youtube: { ...view.services.youtube, latest } } }} change={vi.fn()} mutate={mutate} />);
    fireEvent.click(screen.getByRole('button', { name: /AIリスナー：.*閉じる/ }));
    fireEvent.click(screen.getByText('接続状態・最新投稿'));
    expect(screen.getByText('最新コメント')).toBeVisible(); expect(screen.getByText(/結果不明/, { selector: '.ai-latest .ai-help' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '停止', exact: true })); await waitFor(() => expect(mutate).toHaveBeenCalledWith('/api/ai-listener/stop', 'POST', undefined));
  });
  it('記憶削除は確認操作後だけ実行し、キー入力は送信後に画面から消す', async () => {
    localStorage.clear(); const mutate = vi.fn(async () => undefined);
    render(<AiListenerPanel settings={defaultAiSettings()} view={view} change={vi.fn()} mutate={mutate} />);
    fireEvent.click(screen.getByRole('tab', { name: '記憶・ログ' }));
    fireEvent.click(screen.getByText('共有記憶を削除', { selector: 'summary' }));
    const button = screen.getByRole('button', { name: '記憶を削除', exact: true }); expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /削除の内容を確認した/ })); fireEvent.click(button);
    await waitFor(() => expect(mutate).toHaveBeenCalledWith('/api/ai-listener/clear-memory', 'POST', { confirmed: true }));
    fireEvent.click(screen.getByRole('tab', { name: '連携' }));
    const input = screen.getByLabelText(/Gemini APIキー（/); fireEvent.change(input, { target: { value: 'sample-secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'APIキーを保存' })); await waitFor(() => expect(mutate).toHaveBeenCalledWith('/api/ai-listener/credentials', 'POST', { key: 'sample-secret' }));
    expect(input).toHaveValue('');
  });
  it('タブの移動だけでは保存・開始せず、人格と資格情報の入力を保持する', () => {
    const change = vi.fn(); const mutate = vi.fn();
    render(<AiListenerPanel settings={defaultAiSettings()} view={view} change={change} mutate={mutate} />);
    fireEvent.click(screen.getByRole('tab', { name: '人格' }));
    fireEvent.click(screen.getByRole('button', { name: '人格を追加' }));
    fireEvent.change(screen.getByLabelText('管理用の名前（必須）'), { target: { value: '聞き上手' } });
    fireEvent.click(screen.getByRole('tab', { name: '連携' }));
    fireEvent.change(screen.getByLabelText(/Gemini APIキー（/), { target: { value: 'draft-key' } });
    expect(screen.queryByLabelText('管理用の名前（必須）')).not.toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: '人格' }));
    expect(screen.getByLabelText('管理用の名前（必須）')).toHaveValue('聞き上手');
    fireEvent.click(screen.getByRole('tab', { name: '連携' }));
    expect(screen.getByLabelText(/Gemini APIキー（/)).toHaveValue('draft-key');
    expect(change).not.toHaveBeenCalled(); expect(mutate).not.toHaveBeenCalled();
  });
  it('矢印キーとHome・Endで移動でき、人格タブへのフォーカスで切り替わる', () => {
    render(<AiListenerPanel settings={defaultAiSettings()} view={view} change={vi.fn()} mutate={vi.fn()} />);
    const first = screen.getByRole('tab', { name: '発言の調整' });
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: '参加先' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(screen.getByRole('tab', { name: '記憶・ログ' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(first).toHaveFocus();
    fireEvent.focus(document.getElementById('ai-personas')!);
    expect(screen.getByRole('tab', { name: '人格' })).toHaveAttribute('aria-selected', 'true');
  });
});
