import { CompactFeedback } from './CompactFeedback';
import { useContext, useState } from 'react';
import { ManagementNavigation, SetupPresentation } from '../management-navigation';
import type { ConnectionKey, SourcesSettings, SourceStatusView } from '../../shared/types';
import { connectionLabel, statusLabels } from '../messages';
import { SettingsCard } from './SettingsCard';
import { SlimSwitch } from './SlimSwitch';
import './comment-acquisition-panel.css';

const sources = ['youtube', 'twitch', 'shitaraba'] as const;
const hints = {
  youtube: '配信URL・Live ID・@ハンドルに対応。ハンドルなら配信開始を待てます。',
  twitch: 'チャンネル名またはURL。配信中かどうかに関わらず接続します。',
  shitaraba: '掲示板トップではなく、コメントを取得するスレッドのURLを入力。',
};
const inputErrors = {
  youtube: 'YouTube接続先を確認してください。',
  twitch: 'Twitchチャンネル名またはURLを確認してください。',
  shitaraba: '掲示板スレッドURLを確認してください。',
};
const symbols = { stopped: '○', connecting: '◷', waiting: '◷', connected: '✓', reconnecting: '↻', error: '!' };

export type SourceOperation = ConnectionKey | 'start-all' | 'stop-all' | 'auto-connect';

interface Props {
  settings: SourcesSettings;
  savedSettings: SourcesSettings;
  statuses: Record<ConnectionKey, SourceStatusView>;
  operation: SourceOperation | null;
  saveError?: string;
  operationError?: string;
  onChange(settings: SourcesSettings): void;
  onIntervalInvalidChange(invalid: boolean): void;
  onToggle(source: ConnectionKey, enabled: boolean): Promise<unknown>;
  onReconnect(source: ConnectionKey): Promise<unknown>;
  onStartAll(): Promise<unknown>;
  onStopAll(): Promise<unknown>;
  onAutoConnect(enabled: boolean): Promise<unknown>;
}

export function CommentAcquisitionPanel({ settings, savedSettings, statuses, operation, saveError, operationError,
  onChange, onIntervalInvalidChange, onToggle, onReconnect, onStartAll, onStopAll, onAutoConnect }: Props) {
  const navigation = useContext(ManagementNavigation);
  const setup = navigation?.initialSetup === true;
  const { source: selectedSource, selectSource: setSelectedSource, confirmation } = useContext(SetupPresentation);
  // Invalid text is an editor draft, never a persisted numeric setting. This panel stays mounted on navigation.
  const [intervalText, setIntervalText] = useState<string | null>(null);
  const intervalError = intervalText !== null ? '取得間隔は3〜60秒の整数で入力してください。' : '';
  const busy = operation !== null;
  const selectedStatus = statuses[selectedSource];
  const selectedActive = selectedStatus.state !== 'stopped' && (selectedStatus.state !== 'error' || savedSettings[selectedSource].enabled);
  const selectedTarget = selectedSource === 'youtube' ? settings.youtube.target : selectedSource === 'twitch' ? settings.twitch.channel : settings.shitaraba.threadUrl;
  const setupConnectBlocked = busy || !selectedActive && (!selectedTarget.trim() || selectedSource === 'shitaraba' && Boolean(intervalError));
  const changeTarget = (source: ConnectionKey, value: string) => {
    if (source === 'youtube') onChange({ ...settings, youtube: { ...settings.youtube, target: value } });
    if (source === 'twitch') onChange({ ...settings, twitch: { ...settings.twitch, channel: value } });
    if (source === 'shitaraba') onChange({ ...settings, shitaraba: { ...settings.shitaraba, threadUrl: value } });
  };

  return <SettingsCard cardId="sources" title="コメント取得" eyebrow="COMMENT SOURCES"
    className="sources-panel acquisition-panel" saveError={saveError} navigationWarning={operationError || intervalError}>
    <div className="acquisition-toolbar">
      <span className="acquisition-count">{sources.filter(source => statuses[source].state === 'connected').length}件接続中</span>
      <div className="acquisition-actions">
        <button type="button" className="acquisition-start-all" aria-label="ONのサービスをまとめて接続"
          disabled={(busy && operation !== 'start-all') || Boolean(intervalError)} aria-disabled={busy || Boolean(intervalError)}
          onClick={() => { if (!busy && !intervalError) void onStartAll(); }}>
          {operation === 'start-all' ? '接続を要求中…' : 'ONを一括接続'}</button>
        <button type="button" className="secondary acquisition-stop-all" aria-label="すべて停止"
          disabled={busy && operation !== 'stop-all'} aria-disabled={busy}
          onClick={() => { if (!busy) void onStopAll(); }}>{operation === 'stop-all' ? '停止中…' : 'すべて停止'}</button>
      </div>
    </div>
    <div className="acquisition-list">
      {setup && <><h2 className="setup-source-title"><span className="setup-number">1</span>サービスと接続先を選ぶ</h2><div className="setup-source-selector" role="group" aria-label="設定するコメントサービス">{sources.map(source => <button type="button" key={source} className="secondary" aria-pressed={selectedSource === source} onClick={() => setSelectedSource(source)}>{{ youtube: 'YouTube', twitch: 'Twitch', shitaraba: '掲示板' }[source]}</button>)}</div></>}
      {sources.map(source => {
        const status = statuses[source];
        const active = status.state !== 'stopped' && (status.state !== 'error' || savedSettings[source].enabled);
        const invalidInterval = source === 'shitaraba' && Boolean(intervalError);
        const inputInvalid = status.state === 'error' && status.message === inputErrors[source];
        const message = (source === 'shitaraba' ? intervalError : '') || status.message || hints[source];
        const reconnectDisabled = status.state === 'stopped' || invalidInterval;
        const target = source === 'youtube' ? settings.youtube.target : source === 'twitch' ? settings.twitch.channel : settings.shitaraba.threadUrl;
        const fieldLabel = source === 'youtube' ? setup ? 'YouTubeの配信URL または @ハンドル' : 'YouTube接続先' : source === 'twitch' ? 'Twitchチャンネル名' : '掲示板スレッドURL（したらば／jpnkn）';
        const updated = new Date(status.updatedAt).toLocaleTimeString('ja-JP');
        return <article className="acquisition-source" key={source} hidden={setup && selectedSource !== source} aria-labelledby={`acquisition-name-${source}`}>
          <div className="acquisition-identity">
            <span className={`acquisition-mark acquisition-mark-${source}`} aria-hidden="true">{{ youtube: '▶', twitch: 'Tw', shitaraba: '板' }[source]}</span>
            <h3 id={`acquisition-name-${source}`}>{connectionLabel(source, status)}</h3>
          </div>
          <span className={`acquisition-status acquisition-status-${status.state}`}
            title={`最終更新 ${updated}`} aria-label={`${connectionLabel(source, status)}：${statusLabels[status.state]}、最終更新 ${updated}`}>
            <span aria-hidden="true">{symbols[status.state]}</span>{statusLabels[status.state]}</span>
          <div className="acquisition-fields">
            <label htmlFor={`source-${source}`}>{fieldLabel}</label>
            <input id={`source-${source}`} aria-label={source === 'youtube' ? 'YouTube接続先' : undefined} value={target} readOnly={busy} spellCheck={false} autoComplete="off"
              aria-invalid={inputInvalid} aria-describedby={`source-message-${source}`}
              placeholder={source === 'youtube' ? '配信URL、Live ID、または @ハンドル' : source === 'twitch' ? 'チャンネル名またはURL' : 'スレッドURL'}
              onChange={event => changeTarget(source, event.target.value)} />
            {source === 'shitaraba' && <div className="acquisition-interval">
              <label htmlFor="source-shitaraba-interval">取得間隔</label>
              <input id="source-shitaraba-interval" type="number" aria-label="コメント取得間隔（秒）"
                min={3} max={60} step={1} readOnly={busy} value={intervalText ?? settings.shitaraba.pollIntervalSeconds}
                aria-invalid={Boolean(intervalError)} aria-describedby="source-message-shitaraba source-interval-range"
                onChange={event => {
                  const input = event.currentTarget;
                  const invalid = input.value === '' || !Number.isInteger(input.valueAsNumber) || !input.validity.valid;
                  setIntervalText(invalid ? input.value : null); onIntervalInvalidChange(invalid);
                  if (!invalid) onChange({ ...settings, shitaraba: { ...settings.shitaraba, pollIntervalSeconds: input.valueAsNumber } });
                }} />
              <span>秒</span><span id="source-interval-range">3〜60秒</span>
            </div>}
            <CompactFeedback reserve={[hints[source], inputErrors[source], ...(source === 'shitaraba' ? ['取得間隔は3〜60秒の整数で入力してください。'] : [])]} id={`source-message-${source}`} className={`source-message acquisition-message${invalidInterval || status.state === 'error' ? ' field-error' : ''}`}
              role="status" aria-label={`${connectionLabel(source, status)}の接続メッセージ`} tabIndex={0}>{message}</CompactFeedback>
          </div>
          <button type="button" className="secondary acquisition-reconnect" aria-label={`${connectionLabel(source, status)}を再接続`}
            disabled={operation !== source && (reconnectDisabled || busy)} aria-disabled={busy || reconnectDisabled}
            onClick={() => { if (!busy && !reconnectDisabled) void onReconnect(source); }}>{operation === source ? '処理中…' : '再接続'}</button>
          <div className="acquisition-toggle"><SlimSwitch label={`${connectionLabel(source, status)}のコメント取得`} checked={active}
            disabled={busy || (invalidInterval && !active)} onChange={enabled => onToggle(source, enabled)} /></div>
        </article>;
      })}
    <div className="acquisition-auto">
      <div><h3>アプリ起動時に自動接続</h3><p>有効なコメントソースに、次回の起動時から接続します。</p></div>
      <SlimSwitch label="アプリ起動時に自動接続" checked={settings.autoConnect} disabled={busy} onChange={onAutoConnect} />
    </div>
    </div>
    {setup && <><section className="setup-step-card"><h2><span className="setup-number">2</span>接続して状態を確かめる</h2><p>入力したサービスに接続します。ログインは不要です。</p><button className="setup-primary setup-connect" type="button" disabled={setupConnectBlocked && operation !== selectedSource} aria-disabled={setupConnectBlocked} onClick={() => {
      if (!setupConnectBlocked) void onToggle(selectedSource, !selectedActive);
    }}><span>{operation === selectedSource ? '処理中…' : selectedActive ? '接続を停止する' : '接続する'}</span></button></section><section className="setup-step-card"><h2><span className="setup-number">3</span>受け取れる状態を確認する</h2><p>「接続済み」またはYouTubeの「配信開始待ち」になれば、次へ進めます。</p>{navigation?.setupPosition === 'sources' && confirmation}</section></>}
  </SettingsCard>;
}
