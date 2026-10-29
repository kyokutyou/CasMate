import { runtimeLabels, runtimeHelp, modelLabels } from './speech-recognition-labels';
import { CompactFeedback } from './CompactFeedback';
import { useContext, useEffect, useId, useRef, useState, type ButtonHTMLAttributes } from 'react';
import { ManagementNavigation, SetupPresentation } from '../management-navigation';
import type { SpeechRecognitionResult, SpeechRecognitionSettings, SpeechRecognitionState } from '../../shared/types';
import { messages } from '../messages';
import { SettingsCard } from './SettingsCard';
import { SlimSwitch } from './SlimSwitch';
import './speech-recognition-panel.css';

interface SpeechRecognitionPanelProps {
  settings: SpeechRecognitionSettings;
  state: SpeechRecognitionState;
  externalBusy?: boolean;
  updateSettings(value: SpeechRecognitionSettings): Promise<unknown>;
  mutate(path: string, method?: string, body?: unknown): Promise<unknown>;
  onNotice(message: string, tone: 'success' | 'error'): void;
  onClearNotice(): void;
}

export function SpeechRecognitionPanel({ settings, state, externalBusy = false, updateSettings, mutate, onNotice, onClearNotice }: SpeechRecognitionPanelProps) {
  const navigation = useContext(ManagementNavigation);
  const setup = navigation?.initialSetup && navigation.setupPosition === 'speechRecognition';
  const { confirmation, obsDisplayPlanned } = useContext(SetupPresentation);
  const [draft, setDraft] = useState(settings);
  const [dirty, setDirty] = useState(false);
  const [operation, setOperation] = useState<string | null>(null);
  const pending = useRef(false);
  const [saveError, setSaveError] = useState<string>();
  const [conflict, setConflict] = useState(false);
  const [operationError, setOperationError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<NumberSetting, string>>>({});
  const appliedSettingsKey = JSON.stringify(settings);
  const previousAppliedSettingsKey = useRef(appliedSettingsKey);
  const draftRevision = useRef(state.settingsRevision);
  useEffect(() => { if (!dirty) draftRevision.current = state.settingsRevision; }, [dirty, state.settingsRevision]);
  useEffect(() => {
    if (previousAppliedSettingsKey.current === appliedSettingsKey) return;
    previousAppliedSettingsKey.current = appliedSettingsKey;
    setDraft((current) => dirty ? { ...current, enabled: settings.enabled } : settings);
  }, [appliedSettingsKey, dirty, settings]);

  const perform = async (kind: string, task: () => Promise<unknown>, success?: string) => {
    if (pending.current || externalBusy) return;
    pending.current = true;
    setOperation(kind);
    setOperationError(undefined);
    onClearNotice();
    try {
      await task();
      if (success) onNotice(success, 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '操作に失敗しました。';
      setOperationError(message);
      onNotice(message, 'error');
    } finally {
      pending.current = false;
      setOperation(null);
    }
  };
  const saveSettings = async (value: SpeechRecognitionSettings) => {
    try {
      if (state.settingsRevision === undefined) await updateSettings(value);
      else await mutate('/api/speech-recognition/settings', 'PUT', { revision: draftRevision.current, settings: value });
      setSaveError(undefined);
      setConflict(false);
    }
    catch (error) {
      setSaveError(error instanceof Error ? error.message : messages.settingsSaveFailed);
      setConflict(error instanceof Error && 'code' in error && error.code === 'SPEECH_SETTINGS_CONFLICT');
      throw error;
    }
  };
  const busy = operation !== null || externalBusy;
  const invalid = Object.values(fieldErrors).some(Boolean);
  const modelPreparing = ['downloading', 'extracting', 'validating'].includes(state.modelStatus);
  const retryAvailable = state.modelStatus === 'ready' && state.status === 'unavailable';
  const inputChanged = draft.inputSource !== settings.inputSource || (draft.inputSource === 'smartphone'
    ? draft.smartphoneDeviceId !== settings.smartphoneDeviceId : draft.microphoneId !== settings.microphoneId);
  const inputHelp = inputChanged
    ? setup ? state.previewActive || settings.enabled ? '適用済み入力が使われます。新しい入力は適用後に反映されます。' : '変更を適用してからプレビューを開始してください。' : '入力の変更は未適用です。適用済み入力で開始します。'
    : dirty ? '設定の変更は未適用です。' : '';
  const history = state.previewActive ? state.previewHistory : [];
  const latest = history.at(-1);
  const missingMicrophone = draft.microphoneId && !state.microphones.some((mic) => mic.id === draft.microphoneId);
  const appliedMicrophone = settings.inputSource === 'smartphone'
    ? state.inputs?.find(input => input.smartphoneDeviceId === settings.smartphoneDeviceId)?.name ?? '選択済みのスマホ（未検出）'
    : settings.microphoneId
    ? state.microphones.find((mic) => mic.id === settings.microphoneId)?.name ?? '選択済みのマイク（未検出）'
    : 'Windowsの既定';

  const modelControls = (<div className="recognition-model">
        {setup && <h3><span className="setup-number">1</span>モデルを準備</h3>}
        {setup && <p className="muted">日本語の音声認識モデルを、このPCで使えるようにします。</p>}
        <div><p className="recognition-model-state" aria-live="polite" tabIndex={0}>認識モデル{'\u3000'}Parakeet CTC（日本語）{state.modelStatus === 'ready' && !retryAvailable ? '' : `：${modelLabels[state.modelStatus]}`}{state.modelDownloadProgress === null ? '' : ` ${Math.round(state.modelDownloadProgress * 100)}%`}</p>
          <p className="recognition-model-help muted" tabIndex={state.modelStatus !== 'ready' ? 0 : undefined}>{state.modelStatus !== 'ready'
            ? '初回：公式から約490 MB／空き2 GB以上' : ''}</p></div>
        <div className="recognition-model-actions">
          <ActionButton type="button" className={setup ? 'setup-primary' : 'secondary'} disabled={busy || modelPreparing || state.modelStatus === 'ready' && !retryAvailable}
            onClick={() => void (retryAvailable
              ? perform('retry', () => mutate('/api/speech-recognition/retry'), '再試行しました。')
              : perform('model', () => mutate('/api/speech-recognition/model/prepare'), 'モデルを準備しました。'))}>
            {operation === 'model' || modelPreparing ? 'モデルを準備中…' : operation === 'retry' ? '再試行中…'
              : state.modelStatus === 'failed' ? '取得を再試行' : retryAvailable ? '認識を再試行' : state.modelStatus === 'ready' ? '準備済み' : 'モデルを準備'}</ActionButton>
        </div>
      </div>);
  const masterControls = (<section className={`recognition-section recognition-master${setup ? ' setup-recognition-master' : ''}`} aria-label="配信に使う">
      <div><h3>{setup ? <><span className="setup-number">4</span>配信で使う</> : '配信に使う'}</h3>
        <p className="muted">字幕・AI・OBS音声操作に使用。ONで認識を開始し、次回起動時も自動で開始します。</p>
        <InputUse name="配信に使う入力" input={appliedMicrophone} help={inputHelp} changed={inputChanged} /></div>
      <SlimSwitch keepFocus label="配信者音声認識を配信に使う" checked={settings.enabled} disabled={busy || Boolean(setup && dirty && !settings.enabled)}
        onChange={(enabled) => perform('enabled', () => state.settingsRevision === undefined ? saveSettings({ ...settings, enabled }) : mutate('/api/speech-recognition/enabled', 'PUT', { enabled }), enabled ? '音声認識をオンにしました。' : '音声認識をオフにしました。')} />
      {setup && <><p className="setup-recognition-note">OBSの配信開始とは別の設定です。OFFのままでも、文字を確認できます。{obsDisplayPlanned === false ? '字幕が必要になったら、設定の「OBSにソースを追加」から設定できます。' : 'OBSへの表示は後の「OBS表示」で案内します。'}</p>{confirmation}</>}
    </section>);

  return <SettingsCard cardId="speechRecognition" title="配信者音声認識" eyebrow="STREAMER STT" className="speech-recognition-panel"
    navigationWarning={saveError || operationError || (invalid ? messages.checkDetails : navigation?.initialSetup && dirty ? '未適用の変更があります。「この設定を適用」を押してください。' : undefined)}>
    {setup && <section className="recognition-section setup-recognition-model" aria-label="モデルの準備">{modelControls}</section>}
    {!setup && masterControls}
    <section className="recognition-section" aria-label="入力の準備">
      <h3><span className={setup ? 'setup-number' : 'recognition-step'} aria-hidden="true">{setup ? '2' : '1'}</span>{setup ? '入力を選んで適用' : '入力を準備'}</h3>
      <div className="recognition-microphone">
        <label>認識に使う入力<select value={draft.inputSource === 'smartphone' ? `smartphone:${draft.smartphoneDeviceId}` : draft.microphoneId ?? ''} disabled={busy} onChange={(event) => {
          const value = event.target.value; setDirty(true);
          setDraft(value.startsWith('smartphone:') ? { ...draft, inputSource: 'smartphone', smartphoneDeviceId: value.slice(11) }
            : { ...draft, inputSource: 'microphone', microphoneId: value || null, smartphoneDeviceId: null });
        }}><option value="">Windowsの既定</option>
          {missingMicrophone && <option value={draft.microphoneId!}>選択済みのマイク（未検出）</option>}
          {state.microphones.map((mic) => <option key={mic.id} value={mic.id}>{mic.name}</option>)}
          {draft.inputSource === 'smartphone' && !state.inputs?.some(input => input.smartphoneDeviceId === draft.smartphoneDeviceId) && <option value={`smartphone:${draft.smartphoneDeviceId}`}>選択済みのスマホ（未検出）</option>}
          {(state.inputs ?? []).filter(input => input.inputSource === 'smartphone').map(input => <option key={input.id} value={input.id}>{input.name}{input.available ? '' : '（音声待ち）'}</option>)}
        </select></label>
        <ActionButton type="button" className="secondary" disabled={busy} onClick={() => void perform('microphones', () => mutate('/api/speech-recognition/microphones/refresh'), 'マイク一覧を更新しました。')}>マイク一覧を更新</ActionButton>
      </div>
      {setup && <><p className="muted">入力を選んだ後、「この設定を適用」を押します。選択だけでは認識は始まりません。</p>
        <button type="button" id="setup-smartphone-input" className="secondary" aria-disabled={Boolean(navigation.initialSetupPending)} onClick={event => { if (!navigation.initialSetupPending) navigation.open('smartphone', event.currentTarget); }}>スマホを入力に使う場合：先に登録する</button>
        <p className="muted">スマホ入力はAndroid側で映像・マイクの送信を開始してください。PC側の操作では送信を開始しません。</p></>}
      {!setup && modelControls}
      <details className="recognition-disclosure">
        <summary><span>認識の調整 <small>うまく認識されないときに</small></span><span className="recognition-invalid">{invalid ? '要確認' : ''}</span></summary>
        <div className="recognition-fields">{numberFields.map(({ key, ...field }) => <NumberInput key={key} {...field} validationHelp={numberValidationHelp[key]} value={draft[key]} disabled={busy} error={fieldErrors[key]} onChange={(value) => {
          setDirty(true); setFieldErrors((current) => ({ ...current, [key]: undefined })); setDraft((current) => ({ ...current, [key]: value }));
        }} />)}</div>
      </details>
      <details className="recognition-disclosure recognition-recovery">
        <summary><span>入力の更新・復旧</span><span className="recognition-invalid">{conflict ? '要確認' : ''}</span></summary>
        <div className="recognition-detail-body">
        <p className="recognition-recovery-help muted" tabIndex={0}>{conflict
          ? '別の画面で設定が変わりました。「最新の入力を反映」で保存済み入力を取り込み、内容を確認して適用してください。認識の調整は保持します。'
          : '別の画面で保存した入力を取り込めます。認識の調整は保持します。'}</p>
        <ActionButton type="button" className="secondary" disabled={busy || !conflict} onClick={() => {
          setDraft(current => ({ ...current, enabled: settings.enabled, inputSource: settings.inputSource,
            microphoneId: settings.microphoneId, smartphoneDeviceId: settings.smartphoneDeviceId }));
          draftRevision.current = state.settingsRevision; setConflict(false); setSaveError(undefined); setOperationError(undefined);
          onNotice('最新の入力を取り込みました。認識の調整は保持しています。内容を確認して適用してください。', 'success');
        }}>最新の入力を反映</ActionButton>
        </div>
      </details>
      <div className="recognition-apply">
        <p className="recognition-apply-state muted"><strong className="recognition-apply-status" data-dirty={dirty} aria-live="polite">{dirty ? '未適用の変更があります。' : '設定は適用済みです。'}</strong></p>
        <ActionButton type="button" disabled={busy} onClick={() => void perform('apply', async () => {
          const errors = validateDraft(draft); setFieldErrors(errors);
          if (Object.keys(errors).length) throw new Error(messages.checkDetails);
          await saveSettings({ ...draft, enabled: settings.enabled }); setDirty(false); setFieldErrors({});
        }, '設定を適用しました。')}>{operation === 'apply' ? '適用中…' : 'この設定を適用'}</ActionButton>
      </div>
    </section>
    <section className="recognition-section" aria-label="音声認識プレビュー">
      <div className="recognition-preview-heading"><div><h3 id="recognition-preview" tabIndex={-1}><span className={setup ? 'setup-number' : 'recognition-step'} aria-hidden="true">{setup ? '3' : '2'}</span>{setup ? '話して試す' : '音声認識プレビュー'}</h3>
        <p className="muted">「配信に使う」がオフでも、プレビューで確認できます。</p></div>
        <ActionButton type="button" className={state.previewActive ? 'secondary' : undefined} disabled={busy || Boolean(setup && !state.previewActive && (dirty || state.modelStatus !== 'ready'))} aria-pressed={state.previewActive}
          onClick={() => void perform('preview', () => mutate(`/api/speech-recognition/preview/${state.previewActive ? 'stop' : 'start'}`), state.previewActive ? 'プレビューを終了しました。' : 'プレビューを開始しました。')}>
          {state.previewActive ? 'プレビューを終了' : 'プレビューを開始'}</ActionButton>
      </div>
      {setup && <p className="muted">「今日はよろしくお願いします」と話し、話し終えてから認識結果の欄で文字を確かめます。</p>}
      <InputUse name="プレビューに使う入力" input={appliedMicrophone} help={inputHelp} changed={inputChanged} />
      <div className="recognition-preview-state" role="status" aria-label="認識の稼働状態" tabIndex={0} data-attention={state.status === 'unavailable' || state.status === 'waitingForInput'}>
        <div className="recognition-state-heading" tabIndex={0}><strong>認識：{runtimeLabels[state.status]}</strong><span>プレビュー：{state.previewActive ? '実行中' : '停止中'}</span></div>
        <p className={`recognition-state-message ${state.warning ? 'field-error' : 'muted'}`} tabIndex={0}>{state.warning || runtimeHelp[state.status]}</p>
      </div>
      <div hidden={setup} className="recognition-latest" role="region" aria-label="最新の認識結果" aria-live="polite" tabIndex={0}>
        {latest ? <div className="recognition-last-result"><strong className="muted">{latest.sessionId === state.sessionId ? '前回の認識結果' : '前の入力・セッションの認識結果'}</strong><RecognitionResult result={latest} /></div>
          : <div className="recognition-empty"><strong>認識結果はまだありません</strong></div>}
      </div>
      <details className="recognition-disclosure"><summary>プレビュー履歴（{history.length}件）</summary>
        <p className="muted">直近50件。プレビュー終了時に消去します。</p>
        <div className="recognition-history-list" role="region" aria-label="音声認識プレビュー履歴" tabIndex={0}>
          {history.map((result) => <RecognitionResult key={result.id} result={result} />)}
          {!history.length && <p className="muted">認識結果はまだありません。</p>}
        </div>
      </details>
      <details className="recognition-disclosure"><summary>比較用の音声を保存</summary><div className="recognition-detail-body">
        <label className="check"><input type="checkbox" checked={state.previewActive && state.wavSaving} disabled={!state.previewActive} aria-disabled={busy || !state.previewActive}
          onChange={(event) => { if (!busy) void perform('wav', () => mutate('/api/speech-recognition/preview/wav-saving', 'PUT', { enabled: event.target.checked })); }} />プレビュー中の発話をWAV保存する</label>
        <p className="muted">プレビュー中だけ利用できます。終了すると保存はオフになります。保存済みのWAVファイルは残ります。</p>
        <ActionButton type="button" className="secondary" disabled={busy} onClick={() => void perform('recordings', () => mutate('/api/speech-recognition/recordings/open'))}>WAV保存先を開く</ActionButton>
      </div></details>
    </section>
    {setup && masterControls}
  </SettingsCard>;
}

function InputUse({ name, input, help, changed }: { name: string; input: string; help: string; changed: boolean }) {
  return <div className="recognition-input-use" role="region" aria-label={name}>
    <p className="recognition-input-name" tabIndex={0}>入力（適用済み）：{input}</p>
    <p className="recognition-input-help muted" data-changed={changed} tabIndex={help ? 0 : undefined}>{help}</p>
  </div>;
}

function ActionButton({ disabled, onClick, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} type="button" aria-disabled={Boolean(disabled)} onClick={(event) => {
    if (!disabled) onClick?.(event);
  }} />;
}

export function RecognitionResult({ result }: { result: SpeechRecognitionResult }) {
  return <article className="recognition-entry"><time dateTime={result.recognizedAt}>{new Date(result.recognizedAt).toLocaleTimeString('ja-JP')}</time>
    <p>{result.text || '認識結果なし'}</p><span>音声 {(result.audioDurationMilliseconds / 1000).toFixed(2)}秒 / 認識 {(result.recognitionDurationMilliseconds / 1000).toFixed(2)}秒</span></article>;
}

type NumberSetting = Exclude<keyof SpeechRecognitionSettings, 'enabled' | 'microphoneId' | 'inputSource' | 'smartphoneDeviceId'>;
interface NumberField { key: NumberSetting; label: string; technical: string; help: string; min: number; max: number; step: number }
const numberFields: NumberField[] = [
  { key: 'vadThreshold', label: '声として拾う基準', technical: 'VAD閾値', help: '小さくすると小さな声も拾いやすくなります。', min: 0.01, max: 0.99, step: 0.01 },
  { key: 'minSilenceDurationSeconds', label: '話し終わりの待ち時間', technical: '無音判定（秒）', help: '長くすると、言葉の途中で区切られにくくなります。', min: 0.05, max: 5, step: 0.05 },
  { key: 'minSpeechDurationSeconds', label: '短い音を除く', technical: '最短発話（秒）', help: 'この長さより短い音は、発話として扱いません。', min: 0.05, max: 5, step: 0.05 },
  { key: 'maxSpeechDurationSeconds', label: '長い発話を区切る', technical: '最長発話（秒）', help: '話し続けたとき、この長さで認識の区切りを入れます。', min: 0.05, max: 300, step: 0.5 },
  { key: 'preRollDurationSeconds', label: '語頭を補う', technical: '発話前（秒）', help: '声を検出する直前の音声を含めます。', min: 0, max: 3, step: 0.1 },
  { key: 'postRollDurationSeconds', label: '語尾を補う', technical: '発話後（秒）', help: '声の検出が終わった後の音声を含めます。', min: 0, max: 3, step: 0.1 },
];
function NumberInput({ label, technical, help, validationHelp, value, onChange, error, min, max, step, disabled }: Omit<NumberField, 'key'> & { validationHelp: string; value: number; onChange(value: number): void; error?: string; disabled: boolean }) {
  const helpId = useId();
  return <label className="recognition-number"><span>{label}</span><small>{technical}</small>
    <input aria-label={technical} aria-invalid={Boolean(error)} aria-describedby={helpId} type="number" value={Number.isFinite(value) ? value : ''}
      min={min} max={max} step={step} disabled={disabled} onChange={(event) => onChange(event.target.value === '' ? Number.NaN : Number(event.target.value))} />
    <CompactFeedback as="span" id={helpId} className={`recognition-field-help${error ? ' field-error' : ' muted'}`} reserve={[help, validationHelp]}>{error || help}</CompactFeedback>
  </label>;
}
const numberValidationHelp: Record<NumberSetting, string> = {
  vadThreshold: 'VAD閾値は0より大きく1未満で指定してください。',
  minSpeechDurationSeconds: '最短発話は0.05～5秒で指定してください。',
  minSilenceDurationSeconds: '無音判定は0.05～5秒で指定してください。',
  maxSpeechDurationSeconds: '最長発話は最短発話より長く、300秒以下で指定してください。',
  preRollDurationSeconds: '発話前は0～3秒で指定してください。',
  postRollDurationSeconds: '発話後は0～3秒で指定してください。',
};
function validateDraft(value: SpeechRecognitionSettings): Partial<Record<NumberSetting, string>> {
  const errors: Partial<Record<NumberSetting, string>> = {};
  if (!Number.isFinite(value.vadThreshold) || value.vadThreshold <= 0 || value.vadThreshold >= 1) errors.vadThreshold = numberValidationHelp.vadThreshold;
  if (!inRange(value.minSpeechDurationSeconds, 0.05, 5)) errors.minSpeechDurationSeconds = numberValidationHelp.minSpeechDurationSeconds;
  if (!inRange(value.minSilenceDurationSeconds, 0.05, 5)) errors.minSilenceDurationSeconds = numberValidationHelp.minSilenceDurationSeconds;
  if (!Number.isFinite(value.maxSpeechDurationSeconds) || value.maxSpeechDurationSeconds <= value.minSpeechDurationSeconds || value.maxSpeechDurationSeconds > 300) errors.maxSpeechDurationSeconds = numberValidationHelp.maxSpeechDurationSeconds;
  if (!inRange(value.preRollDurationSeconds, 0, 3)) errors.preRollDurationSeconds = numberValidationHelp.preRollDurationSeconds;
  if (!inRange(value.postRollDurationSeconds, 0, 3)) errors.postRollDurationSeconds = numberValidationHelp.postRollDurationSeconds;
  return errors;
}

function inRange(value: number, minimum: number, maximum: number) {
  return Number.isFinite(value) && value >= minimum && value <= maximum;
}
