// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultSettings } from '../src/main/core/settings';
import type { SpeechRecognitionState } from '../src/shared/types';
import { SpeechRecognitionPanel } from '../src/renderer/components/SpeechRecognitionPanel';

afterEach(cleanup);
function props() {
  const state: SpeechRecognitionState = { status: 'disabled', modelStatus: 'missing', modelDownloadProgress: null,
    microphones: [], previewActive: false, wavSaving: false, previewHistory: [], sessionId: null, warning: null };
  return { settings: createDefaultSettings().speechRecognition, state,
    updateSettings: vi.fn(async () => undefined), mutate: vi.fn(async () => undefined), onNotice: vi.fn(), onClearNotice: vi.fn() };
}
describe('配信者音声認識のA案', () => {
  it.each([
    [false, true, 'listening', '発話待ち'],
    [false, false, 'listening', '発話待ち'],
    [true, false, 'unavailable', '利用不可'],
  ] as const)('配信利用=%s・プレビュー=%sの設定と共有認識の状態=%sを分離する', (enabled, previewActive, status, label) => {
    const p = props(); p.settings.enabled = enabled; p.state.previewActive = previewActive; p.state.status = status;
    render(<SpeechRecognitionPanel {...p} />);
    const master = screen.getByRole('region', { name: '配信に使う' });
    expect(within(master).getByRole('heading', { name: '配信に使う', exact: true })).toBeVisible();
    expect(within(master).queryByText(label)).not.toBeInTheDocument();
    expect(within(master).getByRole('switch')).toHaveAttribute('aria-checked', String(enabled));
    expect(screen.getByRole('status', { name: '認識の稼働状態' })).toHaveTextContent(`認識：${label}`);
    expect(screen.getByRole('status', { name: '認識の稼働状態' })).toHaveTextContent(`プレビュー：${previewActive ? '実行中' : '停止中'}`);
    expect(p.mutate).not.toHaveBeenCalled(); expect(p.updateSettings).not.toHaveBeenCalled();
  });
  it('通常時の重複説明を省き、履歴の寿命は履歴内で確認する', () => {
    const p = props(); p.state.modelStatus = 'ready'; const { container } = render(<SpeechRecognitionPanel {...p} />);
    expect(screen.getAllByText('準備済み')).toHaveLength(1);
    expect(screen.getByText('認識モデル Parakeet CTC（日本語）', { exact: true })).toBeVisible();
    expect(container.textContent).not.toContain('モデルは準備済みです');
    expect(container.textContent).not.toContain('開始・再試行には');
    expect(container.querySelector('.recognition-preview-help')).toBeNull();
    expect((container.textContent?.match(/オフでも/g) ?? [])).toHaveLength(1);
    expect(container.querySelector('.recognition-input-help')).toBeEmptyDOMElement();
    const lifetime = screen.getByText('直近50件。プレビュー終了時に消去します。');
    expect(lifetime).not.toBeVisible();
    fireEvent.click(screen.getByText('プレビュー履歴（0件）')); expect(lifetime).toBeVisible();
  });
  it.each(['disabled', 'waitingForInput', 'unavailable'] as const)('状態=%sでも入力確認用の移動ボタンを表示しない', (status) => {
    const p = props(); p.state.status = status; p.state.warning = status === 'unavailable' ? 'マイクを利用できません。Windowsのマイク設定を確認してください。' : null;
    render(<SpeechRecognitionPanel {...p} />);
    const runtime = screen.getByRole('status', { name: '認識の稼働状態' });
    expect(within(runtime).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '入力・モデルの設定を確認' })).not.toBeInTheDocument();
    if (p.state.warning) expect(runtime.querySelector('.recognition-state-message')).toHaveTextContent(p.state.warning);
    expect(p.updateSettings).not.toHaveBeenCalled(); expect(p.mutate).not.toHaveBeenCalled();
  });
  it('未適用の変更を強調し、適用成功後は同じ状態欄で適用済みに戻す', async () => {
    const p = props(); render(<SpeechRecognitionPanel {...p} />);
    const status = screen.getByText('設定は適用済みです。');
    expect(status).toHaveAttribute('data-dirty', 'false');
    fireEvent.change(screen.getByLabelText('VAD閾値'), { target: { value: '0.42' } });
    expect(screen.getByText('未適用の変更があります。')).toBe(status);
    expect(status.tagName).toBe('STRONG');
    expect(status).toHaveAttribute('data-dirty', 'true');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'この設定を適用' })));
    expect(screen.getByText('設定は適用済みです。')).toBe(status);
    expect(status).toHaveAttribute('data-dirty', 'false');
    expect(p.onNotice).toHaveBeenCalledWith('設定を適用しました。', 'success');
  });
  it('本番ON/OFFを部分更新し、未適用のスマホ入力を保存しない', async () => {
    const p = props(); p.state.settingsRevision = 1;
    p.state.inputs = [{ id: 'smartphone:phone-1', name: '外配信スマホ', inputSource: 'smartphone', microphoneId: null,
      smartphoneDeviceId: 'phone-1', available: false }];
    render(<SpeechRecognitionPanel {...p} />);
    fireEvent.change(screen.getByLabelText('認識に使う入力'), { target: { value: 'smartphone:phone-1' } });
    await act(async () => fireEvent.click(screen.getByRole('switch', { name: '配信者音声認識を配信に使う' })));
    expect(p.mutate).toHaveBeenCalledExactlyOnceWith('/api/speech-recognition/enabled', 'PUT', { enabled: true });
    expect(p.updateSettings).not.toHaveBeenCalled();
    expect(screen.getByLabelText('認識に使う入力')).toHaveValue('smartphone:phone-1');
    expect(screen.getByRole('option', { name: '外配信スマホ（音声待ち）' })).toBeInTheDocument();
  });
  it('スマホとの競合で下書きを保ち、最新入力を取り込んでから新しい版で適用する', async () => {
    const p = props(); p.state.settingsRevision = 1;
    p.mutate.mockRejectedValueOnce(Object.assign(new Error('別の画面で設定が変更されました。'), { code: 'SPEECH_SETTINGS_CONFLICT' }));
    const view = render(<SpeechRecognitionPanel {...p} />);
    fireEvent.click(screen.getByText('認識の調整', { exact: true }));
    fireEvent.change(screen.getByLabelText('VAD閾値'), { target: { value: '0.42' } });
    const settings = { ...p.settings, inputSource: 'smartphone' as const, smartphoneDeviceId: 'phone-2' };
    const state = { ...p.state, settingsRevision: 2, inputs: [{ id: 'smartphone:phone-2', name: '現在のスマホ', inputSource: 'smartphone' as const,
      microphoneId: null, smartphoneDeviceId: 'phone-2', available: false }] };
    view.rerender(<SpeechRecognitionPanel {...p} settings={settings} state={state} />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'この設定を適用' })));
    expect(p.mutate).toHaveBeenLastCalledWith('/api/speech-recognition/settings', 'PUT', expect.objectContaining({ revision: 1 }));
    expect(screen.getByLabelText('VAD閾値')).toHaveValue(0.42);
    expect(screen.getByLabelText('認識に使う入力')).toHaveValue('');
    const recovery = screen.getByText('入力の更新・復旧', { exact: true }).closest('details');
    expect(recovery).not.toHaveAttribute('open');
    expect(recovery?.querySelector('summary')).toHaveTextContent('要確認');
    expect(screen.getAllByText('入力（適用済み）：現在のスマホ')).toHaveLength(2);
    fireEvent.click(screen.getByText('入力の更新・復旧', { exact: true }));
    const reload = screen.getByRole('button', { name: '最新の入力を反映' }); reload.focus();
    fireEvent.click(reload); expect(reload).toHaveFocus();
    expect(screen.getByLabelText('認識に使う入力')).toHaveValue('smartphone:phone-2');
    expect(screen.getByLabelText('VAD閾値')).toHaveValue(0.42);
    expect(recovery?.querySelector('summary')).not.toHaveTextContent('要確認');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'この設定を適用' })));
    expect(p.mutate).toHaveBeenLastCalledWith('/api/speech-recognition/settings', 'PUT', { revision: 2,
      settings: { ...settings, vadThreshold: 0.42 } });
    expect(p.updateSettings).not.toHaveBeenCalled();
  });
  it('OBS関連・モデル情報の欄を表示せず、入力とプレビューの操作を維持する', () => {
    const p = props();
    render(<SpeechRecognitionPanel {...p} />);
    fireEvent.change(screen.getByLabelText('VAD閾値'), { target: { value: '0.42' } });
    expect(screen.queryByText('OBSへの表示・関連機能')).not.toBeInTheDocument();
    expect(screen.queryByText('モデル情報・ライセンス')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '第三者ライセンスを確認' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'URLをコピー' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'プレビューを開始' })).toBeVisible();
    expect(screen.getByLabelText('VAD閾値')).toHaveValue(0.42);
    expect(p.updateSettings).not.toHaveBeenCalled(); expect(p.mutate).not.toHaveBeenCalled();
  });
  it('履歴は受理順に並べ、最新結果を別枠で示す', () => {
    const p = props(); p.state.previewActive = true;
    p.state.previewHistory = ['最初の結果', '次の結果'].map((text, index) => ({ id: String(index), sessionId: 's', sequence: index,
      recognizedAt: '2026-09-16T12:00:00Z', text, audioDurationMilliseconds: 1000, recognitionDurationMilliseconds: 100 }));
    render(<SpeechRecognitionPanel {...p} />);
    const history = screen.getByLabelText('音声認識プレビュー履歴');
    expect(Array.from(history.querySelectorAll('article p')).map(p => p.textContent)).toEqual(['最初の結果', '次の結果']);
    expect(screen.getByLabelText('最新の認識結果')).toHaveTextContent('次の結果');
  });
  it('WAV保存の処理中もフォーカスを保持し、二重送信を防ぐ', async () => {
    const p = props(); p.state.previewActive = true;
    let finish = () => undefined;
    p.mutate.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    render(<SpeechRecognitionPanel {...p} />);
    fireEvent.click(screen.getByText('比較用の音声を保存'));
    const checkbox = screen.getByLabelText('プレビュー中の発話をWAV保存する'); checkbox.focus();
    fireEvent.click(checkbox); fireEvent.click(checkbox);
    expect(checkbox).toHaveFocus(); expect(checkbox).toHaveAttribute('aria-disabled', 'true');
    expect(p.mutate).toHaveBeenCalledExactlyOnceWith('/api/speech-recognition/preview/wav-saving', 'PUT', { enabled: true });
    await act(async () => finish()); expect(checkbox).toHaveFocus();
  });
  it('本番利用の切替で未適用の認識設定を書き込まない', async () => {
    const p = props(); render(<SpeechRecognitionPanel {...p} />);
    fireEvent.click(screen.getByText('認識の調整', { exact: true }));
    fireEvent.change(screen.getByLabelText('VAD閾値'), { target: { value: '0.42' } });
    await act(async () => fireEvent.click(screen.getByRole('switch', { name: '配信者音声認識を配信に使う' })));
    expect(p.updateSettings).toHaveBeenCalledExactlyOnceWith({ ...p.settings, enabled: true });
    expect(screen.getByLabelText('VAD閾値')).toHaveValue(0.42);
    expect(p.mutate).not.toHaveBeenCalled();
  });
  it('設定とプレビューを分け、開いただけでは開始せず詳細は閉じる', () => {
    const p = props(); render(<SpeechRecognitionPanel {...p} />);
    expect(screen.getByRole('heading', { name: /配信に使う/ })).toBeVisible();
    expect(screen.getByText('字幕・AI・OBS音声操作に使用。ONで認識を開始し、次回起動時も自動で開始します。')).toBeVisible();
    expect(screen.getByRole('heading', { name: '入力を準備' })).toBeVisible();
    expect(screen.getByLabelText('VAD閾値')).not.toBeVisible();
    expect(screen.getByLabelText('プレビュー中の発話をWAV保存する')).not.toBeVisible();
    expect(screen.getByRole('button', { name: 'プレビューを開始' })).toBeEnabled();
    expect(p.mutate).not.toHaveBeenCalled(); expect(p.updateSettings).not.toHaveBeenCalled();
  });
  it.each([[false, false], [false, true], [true, false], [true, true]])('利用設定=%sとプレビュー=%sを別々に表示する', (enabled, previewActive) => {
    const p = props(); p.settings.enabled = enabled; p.state.previewActive = previewActive;
    p.state.status = enabled || previewActive ? 'recognizing' : 'disabled';
    const { container } = render(<SpeechRecognitionPanel {...p} />);
    expect(screen.getByRole('switch', { name: '配信者音声認識を配信に使う' })).toHaveAttribute('aria-checked', String(enabled));
    expect(screen.getByRole('status', { name: '認識の稼働状態' })).toHaveTextContent(`プレビュー：${previewActive ? '実行中' : '停止中'}`);
    expect(container.textContent).not.toContain('本番');
    expect(p.mutate).not.toHaveBeenCalled(); expect(p.updateSettings).not.toHaveBeenCalled();
  });
  it('空欄の発話前を0として保存せず、説明領域へ検証結果を表示する', async () => {
    const p = props(); render(<SpeechRecognitionPanel {...p} />);
    fireEvent.click(screen.getByText('認識の調整', { exact: true }));
    const input = screen.getByLabelText('発話前（秒）');
    fireEvent.change(input, { target: { value: '' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'この設定を適用' })));
    expect(input).toHaveAttribute('aria-invalid', 'true'); expect(input).toHaveValue(null);
    expect(p.updateSettings).not.toHaveBeenCalled();
    expect(document.getElementById(input.getAttribute('aria-describedby')!)).toHaveTextContent('発話前は0～3秒');
  });
  it('モデルだけを準備し、本番利用とプレビューは変更しない', async () => {
    const p = props(); render(<SpeechRecognitionPanel {...p} />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'モデルを準備' })));
    expect(p.mutate).toHaveBeenCalledExactlyOnceWith('/api/speech-recognition/model/prepare');
    expect(p.updateSettings).not.toHaveBeenCalled();
  });
  it('保存済みマイクが未検出でも選択値を保持する', () => {
    const p = props(); p.settings.microphoneId = 'unplugged'; render(<SpeechRecognitionPanel {...p} />);
    expect(screen.getByLabelText('認識に使う入力')).toHaveValue('unplugged');
    expect(screen.getByRole('option', { name: '選択済みのマイク（未検出）' })).toBeInTheDocument();
  });
  it('最新結果は文字列として描画し、終了後は履歴・WAVを表示し続けない', () => {
    const p = props(); p.state.previewActive = true; p.state.wavSaving = true;
    p.state.previewHistory = [{ id:'1', sessionId:'s', sequence:1, recognizedAt:'2026-09-16T12:00:00Z', text:'<script>text</script>', audioDurationMilliseconds:3200, recognitionDurationMilliseconds:480 }];
    const view = render(<SpeechRecognitionPanel {...p} />);
    expect(within(screen.getByRole('region', { name:'最新の認識結果' })).getByText('<script>text</script>')).toBeVisible();
    expect(document.querySelector('.recognition-latest script')).toBeNull();
    view.rerender(<SpeechRecognitionPanel {...p} state={{ ...p.state, previewActive:false }} />);
    expect(screen.queryByText('<script>text</script>')).toBeNull();
    expect(screen.getByLabelText('プレビュー中の発話をWAV保存する')).not.toBeChecked();
  });
  it('適用中の連打を防ぎ、失敗しても入力を保持する', async () => {
    const p = props(); let rejectSave: (error: Error) => void = () => undefined;
    p.updateSettings.mockImplementation(() => new Promise((_resolve, reject) => { rejectSave = reject; }));
    render(<SpeechRecognitionPanel {...p} />);
    fireEvent.click(screen.getByText('認識の調整', { exact: true }));
    fireEvent.change(screen.getByLabelText('VAD閾値'), { target: { value:'0.42' } });
    fireEvent.click(screen.getByRole('button', { name:'この設定を適用' }));
    const applying = screen.getByRole('button', { name:'適用中…' });
    fireEvent.click(applying); expect(p.updateSettings).toHaveBeenCalledOnce();
    expect(applying).toHaveAttribute('aria-disabled', 'true');
    await act(async () => rejectSave(new Error('保存できません。')));
    expect(screen.getByLabelText('VAD閾値')).toHaveValue(0.42);
    expect(p.onNotice).toHaveBeenLastCalledWith('保存できません。', 'error');
    expect(document.querySelector('.card-warning')).toBeNull();
  });

  it.each<{ status: SpeechRecognitionState['status']; label: string; help: string }>([
    { status: 'disabled', label: '停止中', help: 'プレビューを開始' },
    { status: 'preparing', label: '準備中', help: '準備が終わるまで' },
    { status: 'listening', label: '発話待ち', help: '話し終わると' },
    { status: 'speechDetected', label: '発話検出', help: '話し終わると' },
    { status: 'recognizing', label: '認識中', help: '' },
    { status: 'waitingForInput', label: 'スマホ音声待ち', help: '映像・マイク送信を開始' },
    { status: 'unavailable', label: '利用不可', help: '入力・モデル' },
  ])('結果取得後も$statusと次の手順を表示する', ({ status, label, help }) => {
    const p = props(); p.state.previewActive = true; p.state.sessionId = 's'; p.state.modelStatus = 'ready';
    p.state.previewHistory = [{ id: '1', sessionId: 's', sequence: 1, recognizedAt: '2026-10-16T00:00:00Z',
      text: '前に話した文章', audioDurationMilliseconds: 1000, recognitionDurationMilliseconds: 120 }];
    const view = render(<SpeechRecognitionPanel {...p} />);
    view.rerender(<SpeechRecognitionPanel {...p} state={{ ...p.state, status }} />);
    const runtime = screen.getByRole('status', { name: '認識の稼働状態' });
    expect(runtime).toHaveTextContent(`認識：${label}`);
    expect(runtime).toHaveTextContent('プレビュー：実行中');
    if (help) expect(runtime).toHaveTextContent(help);
    expect(screen.getByLabelText('最新の認識結果')).toHaveTextContent('前回の認識結果');
    expect(screen.getByLabelText('最新の認識結果')).toHaveTextContent('前に話した文章');
  });
  it('入力・セッション変更後の旧結果を区別し、障害理由を隠さない', () => {
    const p = props(); p.state.previewActive = true; p.state.sessionId = 'new'; p.state.status = 'unavailable';
    p.state.warning = 'マイクへのアクセスが拒否されました。Windowsのマイク設定を確認してください。';
    p.state.previewHistory = [{ id: '1', sessionId: 'old', sequence: 1, recognizedAt: '2026-10-16T00:00:00Z',
      text: '前の入力の文章', audioDurationMilliseconds: 1000, recognitionDurationMilliseconds: 120 }];
    render(<SpeechRecognitionPanel {...p} />);
    expect(screen.getByLabelText('最新の認識結果')).toHaveTextContent('前の入力・セッションの認識結果');
    expect(screen.getByRole('status', { name: '認識の稼働状態' })).toHaveTextContent(p.state.warning);
    expect(screen.getByRole('status', { name: '認識の稼働状態' }).querySelector('.recognition-state-message')).toHaveTextContent(p.state.warning);
  });
  it('プレビュー停止と共有中の認識の稼働を分けて表示する', () => {
    const p = props(); p.state.status = 'listening';
    render(<SpeechRecognitionPanel {...p} />);
    const runtime = screen.getByRole('status', { name: '認識の稼働状態' });
    expect(runtime).toHaveTextContent('認識：発話待ち');
    expect(runtime).toHaveTextContent('プレビュー：停止中');
    expect(screen.getByLabelText('最新の認識結果')).not.toHaveTextContent('前回の認識結果');
  });
  it.each(['enabled', 'preview', 'retry'])('入力変更が未適用のまま%sしても使用する入力を明示し下書きを保存しない', async kind => {
    const p = props(); p.state.settingsRevision = 1; p.state.modelStatus = 'ready'; p.state.status = 'unavailable';
    p.settings.microphoneId = 'mic-a'; p.state.microphones = [{ id: 'mic-a', name: '配信用マイク' }, { id: 'mic-b', name: '確認用マイク' }];
    render(<SpeechRecognitionPanel {...p} />);
    fireEvent.change(screen.getByLabelText('認識に使う入力'), { target: { value: 'mic-b' } });
    for (const name of ['配信に使う入力', 'プレビューに使う入力']) {
      const input = screen.getByRole('region', { name });
      expect(input).toHaveTextContent('入力（適用済み）：配信用マイク');
      expect(input).toHaveTextContent('入力の変更は未適用です');
      expect(input).toHaveTextContent('適用済み入力で開始します');
    }
    const button = kind === 'enabled' ? screen.getByRole('switch', { name: '配信者音声認識を配信に使う' })
      : screen.getByRole('button', { name: kind === 'preview' ? 'プレビューを開始' : '認識を再試行' });
    await act(async () => fireEvent.click(button));
    expect(p.mutate).toHaveBeenCalledExactlyOnceWith(...(kind === 'enabled'
      ? ['/api/speech-recognition/enabled', 'PUT', { enabled: true }]
      : [kind === 'preview' ? '/api/speech-recognition/preview/start' : '/api/speech-recognition/retry']));
    expect(p.updateSettings).not.toHaveBeenCalled();
    expect(screen.getByLabelText('認識に使う入力')).toHaveValue('mic-b');
    expect(screen.getByText('未適用の変更があります。')).toBeInTheDocument();
  });
  it('認識の調整だけを編集したときは入力変更と区別する', () => {
    const p = props(); render(<SpeechRecognitionPanel {...p} />);
    fireEvent.click(screen.getByText('認識の調整', { exact: true }));
    fireEvent.change(screen.getByLabelText('VAD閾値'), { target: { value: '0.42' } });
    expect(screen.getByRole('region', { name: '配信に使う入力' })).toHaveTextContent('設定の変更は未適用です');
    expect(screen.getByRole('region', { name: '配信に使う入力' })).not.toHaveTextContent('入力の変更は未適用です');
  });
  it('モデル欄の同じ主操作で初回準備・進捗・完了・障害復旧を区別する', async () => {
    const p = props(); const view = render(<SpeechRecognitionPanel {...p} />);
    const primary = screen.getByRole('button', { name: 'モデルを準備' }); primary.focus();
    expect(screen.queryByRole('button', { name: '認識を再試行' })).toBeNull();
    for (const modelStatus of ['downloading', 'extracting', 'validating'] as const) {
      view.rerender(<SpeechRecognitionPanel {...p} state={{ ...p.state, modelStatus }} />);
      expect(screen.getByRole('button', { name: 'モデルを準備中…' })).toBe(primary);
      expect(primary).toHaveAttribute('aria-disabled', 'true');
      expect(primary).toHaveFocus(); fireEvent.click(primary);
    }
    expect(p.mutate).not.toHaveBeenCalled();
    view.rerender(<SpeechRecognitionPanel {...p} state={{ ...p.state, modelStatus: 'ready' }} />);
    expect(screen.getByRole('button', { name: '準備済み' })).toBe(primary);
    expect(primary).toHaveAttribute('aria-disabled', 'true');
    expect(document.querySelector('.recognition-model-help')).not.toHaveTextContent('約490 MB');
    view.rerender(<SpeechRecognitionPanel {...p} state={{ ...p.state, modelStatus: 'ready', status: 'unavailable' }} />);
    expect(screen.getByRole('button', { name: '認識を再試行' })).toBe(primary);
    await act(async () => fireEvent.click(primary));
    expect(p.mutate).toHaveBeenCalledExactlyOnceWith('/api/speech-recognition/retry');
    expect(primary).toHaveFocus();
  });
  it('モデル取得失敗の再試行はモデルだけを対象とし、処理中の連打と失敗を扱う', async () => {
    const p = props(); p.state.modelStatus = 'failed';
    let reject: (error: Error) => void = () => undefined;
    p.mutate.mockImplementation(() => new Promise((_resolve, rejectRequest) => { reject = rejectRequest; }));
    render(<SpeechRecognitionPanel {...p} />);
    const primary = screen.getByRole('button', { name: '取得を再試行' }); primary.focus();
    fireEvent.click(primary); fireEvent.click(primary);
    expect(p.mutate).toHaveBeenCalledExactlyOnceWith('/api/speech-recognition/model/prepare');
    expect(screen.getByRole('button', { name: 'モデルを準備中…' })).toBe(primary);
    expect(primary).toHaveFocus();
    await act(async () => reject(new Error('モデルを取得できません。接続を確認してください。')));
    expect(screen.getByRole('button', { name: '取得を再試行' })).toBe(primary);
    expect(p.onNotice).toHaveBeenLastCalledWith('モデルを取得できません。接続を確認してください。', 'error');
    expect(p.updateSettings).not.toHaveBeenCalled();
  });
});
