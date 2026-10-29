import { useContext, useCallback, useEffect, useId, useRef, useState, type SelectHTMLAttributes } from 'react';
import { ManagementNavigation, SetupPresentation } from '../management-navigation';
import type { CommentSpeechSettings, CommentSpeechState, VoicevoxSpeaker } from '../../shared/types';
import { SettingsCard } from './SettingsCard';
import { SlimSwitch } from './SlimSwitch';
import { CompactFeedback } from './CompactFeedback';
import './comment-speech-panel.css';

interface Props {
  settings: CommentSpeechSettings;
  savedEnabled?: boolean;
  state: CommentSpeechState;
  saveError?: string;
  externalBusy?: boolean;
  onChange(value: CommentSpeechSettings): void;
  onSave(value: CommentSpeechSettings): Promise<unknown>;
  listVoices(): Promise<VoicevoxSpeaker[]>;
  onVoicesLoaded?(voices: VoicevoxSpeaker[]): void;
  selectEngine(): Promise<boolean>;
  preview(): Promise<unknown>;
  onSuccess(message: string): void;
}

const channels = [
  { key: 'speedScale', label: '読む速さ', min: .5, max: 2, step: .1, digits: 1, unit: '×' },
  { key: 'pitchScale', label: '声の高さ', min: -.15, max: .15, step: .01, digits: 2, unit: '' },
  { key: 'intonationScale', label: '抑揚', min: 0, max: 2, step: .1, digits: 1, unit: '' },
  { key: 'volumeScale', label: '音量', min: 0, max: 2, step: .1, digits: 1, unit: '×' },
] as const;
const engineLabels = { disabled: '未起動', preparing: '準備中', ready: '準備完了', unavailable: '利用不可' };

export function CommentSpeechPanel({ settings, savedEnabled = settings.enabled, state, saveError, externalBusy = false, onChange, onSave, listVoices, onVoicesLoaded, selectEngine, preview, onSuccess }: Props) {
  const navigation = useContext(ManagementNavigation);
  const setup = navigation?.initialSetup === true;
  const { confirmation } = useContext(SetupPresentation);
  const [setupEngineOpen, setSetupEngineOpen] = useState(false);
  const EngineFile = setup ? 'details' : 'div';
  const [voices, setVoices] = useState<VoicevoxSpeaker[]>([]);
  const [voicesLoaded, setVoicesLoaded] = useState(false);
  const [voicesLoading, setVoicesLoading] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const [operationError, setOperationError] = useState('');
  const [operation, setOperation] = useState<string | null>(null);
  const [invalidFields, setInvalidFields] = useState<Record<string, boolean>>({});
  const operationPending = useRef(false);
  const voicesPending = useRef<Promise<void> | null>(null);
  const mounted = useRef(true);
  const id = useId();
  const engineHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const refreshVoices = useCallback(() => {
    if (voicesPending.current) return voicesPending.current;
    setVoicesLoading(true);
    const request = Promise.resolve().then(listVoices).then(available => {
      if (mounted.current) {
        setVoices(available); setVoicesLoaded(true); setVoiceError('');
        onVoicesLoaded?.(available);
      }
    }).catch(error => {
      if (mounted.current) setVoiceError(messageOf(error));
    }).finally(() => {
      voicesPending.current = null;
      if (mounted.current) setVoicesLoading(false);
    });
    voicesPending.current = request;
    return request;
  }, [listVoices, onVoicesLoaded]);
  useEffect(() => {
    if (state.engineStatus === 'ready') void refreshVoices();
  }, [state.engineStatus, refreshVoices]);

  const run = async (kind: string, task: () => Promise<unknown>, success = '') => {
    if (operationPending.current || externalBusy) return;
    operationPending.current = true; setOperation(kind); setOperationError('');
    try {
      const completed = await task();
      if (mounted.current && success && completed !== false) onSuccess(success);
    } catch (error) {
      if (mounted.current) setOperationError(messageOf(error));
    } finally {
      operationPending.current = false;
      if (mounted.current) setOperation(null);
    }
  };
  const invalidChanged = useCallback((key: string, invalid: boolean) => {
    setInvalidFields(current => Boolean(current[key]) === invalid ? current : { ...current, [key]: invalid });
  }, []);
  const change = (next: CommentSpeechSettings) => { setOperationError(''); onChange(next); };
  const save = (next: CommentSpeechSettings) => run('save', () => onSave(next));
  const speaker = voices.find(item => item.speakerUuid === settings.voice?.speakerUuid);
  const style = speaker?.styles.find(item => item.id === settings.voice?.styleId);
  const invalidVoice = voicesLoaded && Boolean(settings.voice) && !style;
  const voiceGuidance = invalidVoice ? '保存済みの話者・スタイルが見つかりません。声を選び直してください。'
    : !settings.voice ? '読み上げる話者とスタイルを選んでください。' : '';
  const disabled = operation !== null || externalBusy;
  const voiceRefreshDisabled = disabled || voicesLoading || state.engineStatus === 'preparing';
  const canPreview = Boolean(style) && !voiceError && !voicesLoading && !disabled
    && state.engineStatus !== 'preparing' && !Object.values(invalidFields).some(Boolean);
  const previewGuidance = state.engineStatus === 'preparing' ? 'VOICEVOXの準備が終わると試聴できます。'
    : operation === 'preview' ? '試聴を準備しています。しばらくお待ちください。'
    : disabled ? '処理が終わると試聴できます。'
    : voicesLoading ? '話者一覧を取得しています。完了までお待ちください。'
    : voiceError ? '話者一覧を取得できません。「話者一覧を更新」を試してください。'
    : !voicesLoaded ? '「話者一覧を更新」で声を取得してください。'
    : !settings.voice ? '話者を選ぶと試聴できます。'
    : !style ? '話者・スタイルを選び直してください。'
    : Object.values(invalidFields).some(Boolean) ? '入力値を修正すると試聴できます。'
    : '現在の設定で試聴できます。';
  const status = !savedEnabled ? 'コメント読み上げはオフです。'
    : state.engineStatus === 'preparing' ? 'VOICEVOXを準備しています。'
    : state.engineStatus !== 'ready' ? 'VOICEVOXを利用できません。接続を確認してください。'
    : voiceGuidance || (state.currentCommentId ? 'コメントを読み上げています。' : '新着コメントを待っています。');
  const localError = voiceError || (operationError !== saveError ? operationError : '');
  const engineGuidance = state.engineStatus === 'ready' ? '話者を選んで試聴できます。'
    : state.engineStatus === 'preparing' ? '準備が終わるまでお待ちください。'
    : state.engineStatus === 'unavailable' ? 'インストール・起動を確認してください。'
    : savedEnabled ? '起動ファイルを確認してください。'
    : '読み上げをオンにすると自動起動します。';

  const runtime = (<div key="runtime" className="speech-runtime">
      <div className="speech-row"><div><h3>{setup ? <><span className="setup-number">3</span>新着コメントの読み上げを使う</> : 'コメントを読み上げる'}</h3>{setup ? <CompactFeedback className="speech-help" role="status" reserve={['コメント読み上げはオフです。', 'VOICEVOXを利用できません。接続を確認してください。', '保存済みの話者・スタイルが見つかりません。声を選び直してください。']}>{status}</CompactFeedback> : <p className="speech-help" role="status">{status}</p>}</div>
        <SlimSwitch keepFocus={setup} label="コメント読み上げ" checked={settings.enabled} disabled={disabled} onChange={enabled => save({ ...settings, enabled })} /></div>
      <div className="speech-row"><span className="speech-engine-state"><span>VOICEVOX · {engineLabels[state.engineStatus]}</span></span>
        <span className="speech-help">読み上げ待ち {state.queueLength}件 · 読み上げずに省略 {state.droppedCount}件</span></div>
      <div className="speech-row"><p className="speech-help">オフにすると、再生中の音声と待ちコメントをクリアします。</p>
        <button type="button" className="secondary" onClick={() => {
          engineHeading.current?.focus({ preventScroll: true });
          engineHeading.current?.scrollIntoView({ block: 'center' });
        }}>VOICEVOXの設定を確認</button></div>
      {setup && navigation?.setupPosition === 'commentSpeech' && confirmation}
    </div>);
  const voiceControls = (<section key="voice" className="speech-section" aria-labelledby="speech-voice-controls">
      <div className="speech-row"><h3 id="speech-voice-controls" tabIndex={-1}>{setup ? <><span className="setup-number">2</span>声を選んで試聴する</> : '声のコントロール'}</h3>
        <button type="button" className="secondary speech-voice-refresh" disabled={!setup && voiceRefreshDisabled} aria-disabled={setup ? voiceRefreshDisabled : undefined} onClick={() => { if (!voiceRefreshDisabled) void refreshVoices(); }}><span>{voicesLoading ? '一覧を取得中…' : '話者一覧を更新'}</span></button></div>
      <div className="speech-fields">
        <label>話者<VoiceSelect keepFocus={setup} aria-label="話者" value={settings.voice?.speakerUuid ?? ''} disabled={disabled || voicesLoading}
          onChange={event => {
            const selected = voices.find(item => item.speakerUuid === event.target.value);
            void save({ ...settings, voice: selected?.styles.length ? { speakerUuid: selected.speakerUuid, styleId: selected.styles[0].id } : null });
          }}>
          <option value="">選択してください</option>
          {settings.voice && !speaker && <option value={settings.voice.speakerUuid}>保存済みの話者（{voicesLoaded ? '利用できません' : '一覧未取得'}）</option>}
          {voices.map(item => <option key={item.speakerUuid} value={item.speakerUuid}>{item.name}</option>)}
        </VoiceSelect></label>
        <label>スタイル<VoiceSelect keepFocus={setup} aria-label="スタイル" value={settings.voice?.styleId ?? ''} disabled={disabled || voicesLoading || !speaker?.styles.length}
          onChange={event => { if (speaker) void save({ ...settings, voice: { speakerUuid: speaker.speakerUuid, styleId: Number(event.target.value) } }); }}>
          {!settings.voice && <option value="">話者を選択してください</option>}
          {settings.voice && !style && <option value={settings.voice.styleId}>保存済みのスタイル（{voicesLoaded ? '利用できません' : '一覧未取得'}）</option>}
          {speaker?.styles.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </VoiceSelect></label>
      </div>
      {setup ? <CompactFeedback className={`speech-help speech-voice-feedback${voiceGuidance || voiceError ? ' field-error' : ''}`} role="status" reserve={['話者一覧を取得しています。', '「話者一覧を更新」で利用できる声を取得してください。', '保存済みの話者・スタイルが見つかりません。声を選び直してください。', '話者一覧を取得できません。VOICEVOXの起動を確認して再試行してください。']}>
        {saveError || localError || (voicesLoading ? '話者一覧を取得しています。' : !voicesLoaded ? '「話者一覧を更新」で利用できる声を取得してください。' : voiceGuidance || '保存済みの声を確認して、試聴してください。')}
      </CompactFeedback> : <>{voicesLoading && <p className="speech-help" role="status">話者一覧を取得しています。</p>}
      {!voicesLoaded && !voicesLoading && !voiceError && <p className="speech-help">「話者一覧を更新」で利用できる声を取得してください。</p>}
      {voiceGuidance && <p className="field-error">{voiceGuidance}</p>}</>}
      <div className="speech-mixer" role="group" aria-label="音声ミキサー">
        {channels.map(({ key, ...channel }) => <SpeechNumericControl key={key} fieldKey={key} {...channel}
          value={settings[key]} disabled={disabled} onInvalidChange={invalidChanged}
          onChange={value => change({ ...settings, [key]: value })} />)}
      </div>
      <div className="speech-preview-sample"><span className="speech-help">固定文で声を確認</span>
        <p>これはコメント読み上げのテストです</p>
        <div className="speech-row"><span className="speech-help">PCで試聴 · 読み上げオフでも利用できます</span>
          <button type="button" className="speech-preview-button" disabled={!canPreview && operation !== 'preview'} aria-disabled={!canPreview}
            aria-label="この声を試聴" aria-describedby={`${id}-preview-guidance`} onClick={() => { if (!canPreview) return; void run('preview', async () => {
            await onSave(settings);
            await preview();
          }, 'PCで試聴を再生しました。'); }}>{operation === 'preview' ? '試聴を準備中…' : '▷ この声を試聴'}</button>
        </div>
        <p id={`${id}-preview-guidance`} className="speech-help speech-preview-guidance" role="status"><span>{previewGuidance}</span></p>
        <p className="speech-help">コメント読み上げがオンなら、読み上げを聞く済みのスマホにも届きます。Androidは「読み上げを聞く」を有効にしてください。</p>
      </div>
    </section>);
  const engineControls = (<section key="engine" className="speech-section" aria-labelledby={`${id}-engine`}>
        <h3 id={`${id}-engine`} ref={engineHeading} tabIndex={-1}>{setup ? <><span className="setup-number">1</span>VOICEVOXを準備する</> : 'VOICEVOX'}</h3>
        {setup && <div className="setup-speech-install"><p>VOICEVOXは、コメントを声にするための無料ソフトです。</p><a href="https://voicevox.hiroshiba.jp/" target="_blank" rel="noreferrer">公式サイトでWindows版を入手 ↗</a><p>インストール後、下のボタンで自動検索・起動できます。</p><button type="button" className="setup-primary setup-engine-check" aria-disabled={voiceRefreshDisabled} onClick={() => { if (!voiceRefreshDisabled) void refreshVoices(); }}><span>{voicesLoading ? 'VOICEVOXを準備中…' : 'VOICEVOXを自動で探して準備する'}</span></button></div>}<div className="speech-engine-overview" hidden={setup}>
          <span className="speech-engine-state"><span>エンジン：{engineLabels[state.engineStatus]}</span></span>
          <p className="speech-help speech-engine-guidance" role="status"><span>{engineGuidance}</span></p>
        </div>
        <p className="speech-help" hidden={setup}>VOICEVOXは別途インストールが必要です。起動済みならそのまま使えます。</p>
        <EngineFile className="speech-engine-file" open={setup ? setupEngineOpen : undefined} onToggle={event => { if (setup && event.currentTarget instanceof HTMLDetailsElement) setSetupEngineOpen(event.currentTarget.open); }}>
          <summary hidden={!setup}>自動で見つからない場合</summary>
          <div className="speech-engine-file-content">
          <p className="speech-help">自動で見つからない場合に指定します。</p>
          <div id={`${id}-engine-file`} className="speech-engine-target">
            <p className="speech-help">選択するファイル（VOICEVOXフォルダー内）</p>
            <code>vv-engine / run.exe</code>
            <p className="speech-help">VOICEVOX.exeは選択しません。</p>
          </div>
          <div><button type="button" className="secondary speech-engine-select" aria-describedby={`${id}-engine-file`} disabled={!setup && voiceRefreshDisabled} aria-disabled={setup ? voiceRefreshDisabled : undefined}
          onClick={() => { if (!voiceRefreshDisabled) void run('engine', async () => {
            if (!await selectEngine()) return false;
            await refreshVoices();
            return true;
          }, 'VOICEVOXの起動ファイルを指定しました。'); }}><span>{operation === 'engine' ? '起動ファイルを確認中…' : 'VOICEVOXの起動ファイルを指定'}</span></button></div>
          </div>
        </EngineFile>
        <div hidden={setup}><hr /><p>PCの再生先</p><p className="speech-help">Windowsの既定の音声出力を使用します。</p>
        <a href="https://voicevox.hiroshiba.jp/term/" target="_blank" rel="noreferrer">VOICEVOXの利用規約・クレジット ↗</a></div>
      </section>);
  const readingControls = (<section className="speech-section" aria-labelledby={`${id}-content`}>
        <h3 id={`${id}-content`}>読み上げる内容</h3>
        <div className="speech-option"><span>コメントソース名を読む</span><SlimSwitch keepFocus={setup} label="コメントソース名を読む" checked={settings.readSource} disabled={disabled} onChange={readSource => save({ ...settings, readSource })} /></div>
        <div className="speech-option"><span>投稿者名を読む</span><SlimSwitch keepFocus={setup} label="投稿者名を読む" checked={settings.readAuthor} disabled={disabled} onChange={readAuthor => save({ ...settings, readAuthor })} /></div>
        <p className="speech-help">本文は常に対象です。ソース名 → 投稿者名 → 本文の順に読みます。</p>
        <hr />
        <SpeechNumericControl fieldKey="maxTextLength" label="本文の最大文字数" min={50} max={500} step={1} unit="文字"
          value={settings.maxTextLength} disabled={disabled} onInvalidChange={invalidChanged}
          onChange={maxTextLength => change({ ...settings, maxTextLength })} />
        <p className="speech-help">50〜500文字。超えた分は「以下省略」と読みます。</p>
        <details><summary>読み上げのルール</summary><p className="speech-help">新着コメントだけを読み上げ、初回履歴は読み上げません。URLは「URL」に置き換え、絵文字は読みません。</p>
          <p className="speech-help">待ち件数は10件まで。超えた場合は古い未読から破棄します。</p></details>
      </section>);
  return <SettingsCard cardId="commentSpeech" title="コメント読み上げ" eyebrow="COMMENT SPEECH"
    className="comment-speech-panel" saveError={saveError}
    navigationWarning={localError || (Object.values(invalidFields).some(Boolean) ? '音声設定の入力値を確認してください。' : '') || (settings.enabled || setup && invalidVoice ? voiceGuidance : '')}
    warning={<>{state.warning && <p role="alert">{state.warning}</p>}{localError && <p role="alert">{localError}</p>}</>}
    >
    {setup && engineControls}
    {!setup && runtime}
    {voiceControls}
    {setup && runtime}
    <div key="lower" className="speech-lower-sections">{readingControls}{!setup && engineControls}</div>
  </SettingsCard>;
}

function SpeechNumericControl({ fieldKey, label, value, min, max, step, digits, unit, disabled, onChange, onInvalidChange }: {
  fieldKey: string; label: string; value: number; min: number; max: number; step: number; digits?: number; unit: string; disabled: boolean;
  onChange(value: number): void; onInvalidChange(key: string, invalid: boolean): void;
}) {
  const id = useId();
  const [text, setText] = useState(String(value));
  const [invalid, setInvalid] = useState(false);
  const isChannel = digits !== undefined;
  useEffect(() => { setText(String(value)); setInvalid(false); onInvalidChange(fieldKey, false); }, [value, fieldKey, onInvalidChange]);
  return <div className={isChannel ? 'speech-channel' : 'speech-length-field'}>
    <label htmlFor={isChannel ? `${id}-slider` : `${id}-number`}>{label}</label>
    {isChannel && <><output className="speech-channel-value" htmlFor={`${id}-slider ${id}-number`}>{value.toFixed(digits)}{unit}</output>
      <input id={`${id}-slider`} type="range" aria-label={label} min={min} max={max} step={step} value={value} disabled={disabled}
        onChange={event => { setText(event.target.value); setInvalid(false); onInvalidChange(fieldKey, false); onChange(event.target.valueAsNumber); }} /></>}
    <div className="speech-number-unit"><input id={`${id}-number`} type="number" aria-label={isChannel ? `${label}の数値` : label}
      aria-invalid={invalid} aria-describedby={invalid ? `${id}-error` : undefined}
      min={min} max={max} step={step} value={text} disabled={disabled} onChange={event => {
        const field = event.target;
        setText(field.value);
        const invalidValue = field.value === '' || !Number.isFinite(field.valueAsNumber) || !field.validity.valid;
        setInvalid(invalidValue); onInvalidChange(fieldKey, invalidValue);
        if (!invalidValue) onChange(field.valueAsNumber);
      }} />{!isChannel && <span>{unit}</span>}</div>
    {invalid && <p id={`${id}-error`} className="field-error" role="alert">{min}〜{max}の範囲、{step}刻みで入力してください。</p>}
  </div>;
}

function VoiceSelect({ keepFocus, disabled, onChange, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { keepFocus: boolean }) {
  return <select {...props} disabled={!keepFocus && disabled} aria-disabled={keepFocus ? Boolean(disabled) : undefined}
    onPointerDown={event => { if (keepFocus && disabled) event.preventDefault(); }}
    onKeyDown={event => { if (keepFocus && disabled && event.key !== 'Tab') event.preventDefault(); }}
    onChange={event => { if (!disabled) onChange?.(event); }} />;
}

function messageOf(error: unknown) { return error instanceof Error ? error.message : '操作に失敗しました。'; }
