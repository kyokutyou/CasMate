import { CompactFeedback } from './CompactFeedback';
import { useContext, useEffect, useId, useRef, useState } from 'react';
import { defaultManagementTheme, type ManagementThemeId } from '../../shared/management-theme';
import { managementThemes } from '../management-themes';
import { defaultManagementTextSize, type ManagementTextSizeId } from '../../shared/management-text-size';
import { managementTextSizes } from '../management-text-sizes';
import { messages } from '../messages';
import { SettingsCard } from './SettingsCard';
import { ManagementNavigation } from '../management-navigation';
import './application-settings-panel.css';

interface Props {
  baseUrl: string;
  port: number;
  theme?: ManagementThemeId;
  savedTheme?: ManagementThemeId;
  textSize?: ManagementTextSizeId;
  savedTextSize?: ManagementTextSizeId;
  onSaveTheme(theme: ManagementThemeId): Promise<unknown>;
  onSaveTextSize(size: ManagementTextSizeId): Promise<unknown>;
  onSavePort(port: number): Promise<unknown>;
  onPortEdit(): void;
  onSuccess(message: string): void;
  onError(message: string, operation: 'theme' | 'textSize' | 'port'): void;
  onThemeRecovered?(theme: ManagementThemeId): void;
  onTextSizeRecovered?(size: ManagementTextSizeId): void;
  onOperationStart(): void;
  onOpenSettingsDirectory?(): void;
  settingsDirectoryBusy?: boolean;
}

export function ApplicationSettingsPanel({ baseUrl, port, theme = defaultManagementTheme, savedTheme = defaultManagementTheme, textSize = defaultManagementTextSize, savedTextSize = defaultManagementTextSize, onSaveTheme, onSaveTextSize, onSavePort, onPortEdit, onSuccess, onError, onThemeRecovered, onTextSizeRecovered, onOperationStart, onOpenSettingsDirectory, settingsDirectoryBusy }: Props) {
  const setup = useContext(ManagementNavigation)?.initialSetupEntry;
  const id = useId();
  const [input, setInput] = useState(String(port));
  const [confirmedPort, setConfirmedPort] = useState(port);
  const [saveState, setSaveState] = useState<'idle' | 'waiting' | 'saving' | 'saved' | 'error'>('idle');
  const [localSaveError, setLocalSaveError] = useState('');
  const dirty = useRef(false); const revision = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(true);
  const callbacks = useRef({ onSavePort, onSaveTheme, onSaveTextSize, onSuccess, onError, onOperationStart });
  useEffect(() => { callbacks.current = { onSavePort, onSaveTheme, onSaveTextSize, onSuccess, onError, onOperationStart }; }, [onSavePort, onSaveTheme, onSaveTextSize, onSuccess, onError, onOperationStart]);
  useEffect(() => { if (!dirty.current) { setInput(String(port)); setConfirmedPort(port); } }, [port]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; clearTimeout(timer.current); }; }, []);
  const invalid = !/^\d+$/.test(input) || Number(input) < 1024 || Number(input) > 65535;
  const fieldError = invalid ? '1024〜65535の整数を入力してください。' : '';
  const activePort = Number(new URL(baseUrl).port || (baseUrl.startsWith('https:') ? 443 : 80));
  const save = async (value: number, version: number) => {
    setSaveState('saving'); callbacks.current.onOperationStart();
    try {
      await callbacks.current.onSavePort(value);
      if (!mounted.current || revision.current !== version) return;
      dirty.current = false; setConfirmedPort(value); setSaveState('saved'); setLocalSaveError('');
      callbacks.current.onSuccess('ポート設定を保存しました。');
    } catch (error) {
      if (!mounted.current || revision.current !== version) return;
      const message = error instanceof Error ? error.message : 'ポート設定を保存できませんでした。';
      setSaveState('error'); setLocalSaveError(message); callbacks.current.onError(message, 'port');
    }
  };
  const changePort = (value: string) => {
    if (appearancePending.current) return;
    clearTimeout(timer.current); revision.current += 1; dirty.current = true;
    onPortEdit();
    setInput(value); setLocalSaveError(''); setSaveState('waiting'); onOperationStart();
    if (!/^\d+$/.test(value) || Number(value) < 1024 || Number(value) > 65535) return;
    const version = revision.current;
    timer.current = setTimeout(() => void save(Number(value), version), 500);
  };
  const [appearanceBusy, setAppearanceBusy] = useState<'theme' | 'textSize' | null>(null);
  const [themeFailure, setThemeFailure] = useState<{ id: ManagementThemeId; message: string } | null>(null);
  const themeError = themeFailure?.message ?? '';
  const [textSizeFailure, setTextSizeFailure] = useState<{ id: ManagementTextSizeId; message:string } | null>(null);
  const textSizeError = textSizeFailure?.message ?? '';
  const appearancePending = useRef(false);
  useEffect(() => {
    if (themeFailure?.id === savedTheme) { setThemeFailure(null); onThemeRecovered?.(savedTheme); }
  }, [savedTheme, themeFailure, onThemeRecovered]);
  useEffect(() => {
    if (textSizeFailure?.id === savedTextSize) { setTextSizeFailure(null); onTextSizeRecovered?.(savedTextSize); }
  }, [savedTextSize, textSizeFailure, onTextSizeRecovered]);
  const saveAppearance = async (request:{ operation:'theme'; id:ManagementThemeId } | { operation:'textSize'; id:ManagementTextSizeId }) => {
    if (appearancePending.current) return;
    appearancePending.current = true;
    setAppearanceBusy(request.operation);
    if (request.operation === 'theme') setThemeFailure(null); else setTextSizeFailure(null);
    callbacks.current.onOperationStart();
    try {
      if (request.operation === 'theme') await callbacks.current.onSaveTheme(request.id);
      else await callbacks.current.onSaveTextSize(request.id);
      if (mounted.current) {
        callbacks.current.onSuccess(request.operation === 'theme' ? '管理画面の配色を保存しました。' : '管理画面の文字サイズを保存しました。');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : request.operation === 'theme' ? '管理画面の配色を保存できませんでした。' : '管理画面の文字サイズを保存できませんでした。';
      if (mounted.current) {
        if (request.operation === 'theme') setThemeFailure({ id:request.id, message }); else setTextSizeFailure({ id:request.id, message });
        callbacks.current.onError(message, request.operation);
      }
    } finally {
      appearancePending.current = false;
      if (mounted.current) setAppearanceBusy(null);
    }
  };
  const saveMessage = fieldError || localSaveError || (saveState === 'saving' ? '保存しています…' : saveState === 'waiting' ? '入力後に自動保存します。' : confirmedPort !== activePort ? '保存済み。再起動後に有効になります。OBS側のURLも変更してください。' : '通常は変更不要です。変更は再起動後に有効になります。');

  // Each application operation owns its failure; a section-wide error cannot
  // distinguish a recovered theme from an unsaved port.
  return <SettingsCard cardId="application" title="アプリ設定" eyebrow="APPLICATION" className="application-settings-panel" navigationWarning={fieldError || themeError || textSizeError || localSaveError}>
    <section aria-labelledby={`${id}-appearance`}>
      <h3 id={`${id}-appearance`}>見た目</h3><p className="muted">選択すると反映・自動保存します。</p>
      <div className="app-appearance-grid"><div>
      <h4>配色</h4>
      <fieldset className="app-theme-fieldset"><legend className="sr-only">管理画面の配色</legend>
        {(['dark', 'light'] as const).map(scheme => <div key={scheme} className="app-theme-group"><h4>{scheme === 'dark' ? 'ダーク' : 'ライト'}</h4><div className="app-theme-options">
          {managementThemes.filter(preset => preset.scheme === scheme).map(preset => <label key={preset.id} className="app-theme-choice">
            <span className="app-theme-swatches" style={{ background: preset.background }} aria-hidden="true"><i style={{ background: preset.panel }} /><i style={{ background: preset.panel }} /><i style={{ background: preset.accent }} /></span>
            <span className="app-theme-title"><input type="radio" name={`${id}-theme`} value={preset.id} checked={theme === preset.id} aria-disabled={Boolean(appearanceBusy)}
              onClick={event => { if (appearancePending.current) event.preventDefault(); }}
              onKeyDown={event => { if (appearancePending.current && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(event.key)) event.preventDefault(); }}
              onChange={() => void saveAppearance({ operation:'theme', id:preset.id })} />{preset.name}{preset.id === defaultManagementTheme && <small>既定</small>}</span>
          </label>)}
        </div></div>)}
      </fieldset>
      <div className="app-settings-feedback"><CompactFeedback reserve={['選択すると反映・自動保存します。', '配色を保存しています…']} id={`${id}-theme-status`} className={themeError ? 'field-error' : 'muted'} role="status">{themeError || (appearanceBusy === 'theme' ? '配色を保存しています…' : '')}</CompactFeedback><span>{themeError && <button type="button" className="secondary small" disabled={Boolean(appearanceBusy)} onClick={() => void saveAppearance({ operation:'theme', id:theme })}>配色を再保存</button>}</span></div>
      </div><div className="app-text-size-settings"><div className="app-text-size-row"><div><h4>文字サイズ</h4><p className="muted">OBS・コメント一覧は各画面で設定します。</p></div>
        <fieldset className="app-text-size-fieldset"><legend className="sr-only">管理画面の文字サイズ</legend>
          {managementTextSizes.map(size => <label key={size.id} className="app-text-size-choice">
            <span><input type="radio" name={`${id}-text-size`} value={size.id} checked={textSize === size.id} aria-disabled={Boolean(appearanceBusy)}
              onClick={event => { if (appearancePending.current) event.preventDefault(); }}
              onKeyDown={event => { if (appearancePending.current && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(event.key)) event.preventDefault(); }}
              onChange={() => void saveAppearance({ operation:'textSize', id:size.id })} />{size.id === 'medium' ? '標準' : size.name}</span>
          </label>)}
        </fieldset></div>
        <div className="app-settings-feedback"><CompactFeedback reserve={['選択すると反映・自動保存します。', '文字サイズを保存しています…']} className={textSizeError ? 'field-error' : 'muted'} role="status">{textSizeError || (appearanceBusy === 'textSize' ? '文字サイズを保存しています…' : '')}</CompactFeedback><span>{textSizeError && <button type="button" className="secondary small" aria-label="文字サイズを再保存" disabled={Boolean(appearanceBusy)} onClick={() => void saveAppearance({ operation:'textSize', id:textSize })}>サイズを再保存</button>}</span></div>
      </div></div>
    </section>
    <details className="app-connection-details"><summary><strong>接続設定</strong><span className="muted">通常は変更不要</span></summary><section aria-label="接続設定">
      <div className="app-port-row"><label htmlFor={`${id}-port`}>アプリの接続ポート</label><input id={`${id}-port`} aria-label="アプリの接続ポート（再起動後に有効）" type="number" min="1024" max="65535" step="1" value={input} disabled={Boolean(appearanceBusy)} aria-invalid={invalid} aria-describedby={`${id}-hint ${id}-active-port`} onChange={event => changePort(event.target.value)} /></div>
      <div className="app-settings-feedback"><CompactFeedback reserve={['通常は変更不要です。変更は再起動後に有効になります。', '保存済み。再起動後に有効になります。OBS側のURLも変更してください。', '1024〜65535の整数を入力してください。']} className="app-field-hint" id={`${id}-hint`} data-error={Boolean(fieldError || localSaveError)} aria-live="polite" tabIndex={0}>{saveMessage}</CompactFeedback><span>{localSaveError && <button type="button" className="secondary small" disabled={Boolean(appearanceBusy) || invalid || saveState === 'saving'} onClick={() => { clearTimeout(timer.current); revision.current += 1; void save(Number(input), revision.current); }}>再保存</button>}</span></div>
      <p className="muted" id={`${id}-active-port`}>1024〜65535 ／ 起動中のURLは再起動まで変わりません。</p>
    </section></details>
    {onOpenSettingsDirectory && <section aria-labelledby={`${id}-storage`}><h3 id={`${id}-storage`}>設定の保存先</h3>
      <button id="application-settings-directory" type="button" className="secondary" aria-disabled={Boolean(settingsDirectoryBusy)}
        onClick={() => { if (!settingsDirectoryBusy) onOpenSettingsDirectory(); }}>設定の保存先を開く</button></section>}
    <div className="app-footer-grid">
    <section aria-label="バージョン・更新"><div className="app-version-heading"><h3>バージョン</h3><span>{messages.version}</span></div><p>更新は、新しいインストーラーを上書き実行します。</p><details className="app-update-details"><summary>更新について</summary><p className="muted">自動更新・利用データの送信は行いません。</p></details></section>
    {setup && <section aria-labelledby={`${id}-setup`}><h3 id={`${id}-setup`}>はじめての設定</h3><p>使いたい機能を順番に設定できます。</p>
      <button id="application-initial-setup" type="button" className="secondary" onClick={setup.open}>{setup.resume ? 'はじめての設定を続ける' : 'はじめての設定を開く'}</button></section>}
    </div>
  </SettingsCard>;
}
