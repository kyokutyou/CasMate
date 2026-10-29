import { connectionKeys } from '../../shared/types';
import type { AppSettings, AppSnapshot, ConnectionKey } from '../../shared/types';
import { connectionLabel, statusLabels } from '../messages';
import { useContext } from 'react';
import { ManagementNavigation } from '../management-navigation';
import { SlimSwitch } from './SlimSwitch';

export interface ManagementHomeProps {
  snapshot: AppSnapshot; draft: AppSettings;
  prefix?: string; sections?: 'all' | 'sources' | 'operations';
  sourcesBusy?: boolean; shitarabaStartBlocked?: boolean;
  operationsBusy?: Partial<Record<'commentSpeech' | 'aiListener' | 'speechRecognition', boolean>>;
  toggleSource(source: ConnectionKey, enabled: boolean): Promise<unknown>;
  toggleSpeech(enabled: boolean): Promise<unknown>; toggleAi(enabled: boolean): Promise<unknown>; toggleRecognition(enabled: boolean): Promise<unknown>;
}

export function ManagementOperations({ snapshot, draft, operationsBusy, toggleSpeech, toggleAi, toggleRecognition, prefix = 'home', compact = false }: ManagementHomeProps & { compact?: boolean }) {
  const { open } = useContext(ManagementNavigation)!;
  const ai = snapshot.aiListener;
  const operations = [
    { id: 'commentSpeech', icon: '♫', name: 'コメント読み上げ', checked: draft.commentSpeech.enabled, action: toggleSpeech,
      status: !snapshot.settings.commentSpeech.enabled ? '停止中'
        : snapshot.commentSpeech.engineStatus === 'ready' ? snapshot.commentSpeech.currentCommentId ? '読み上げ中' : '新着待ち'
        : { disabled: '停止中', preparing: '準備中', unavailable: '要確認' }[snapshot.commentSpeech.engineStatus] },
    { id: 'aiListener', icon: '✦', name: 'AIリスナー', checked: ai?.requested ?? false, action: toggleAi,
      status: ai ? { stopped: '停止中', preparing: '準備中', running: '稼働中', paused: '休止中', attention: '手動再開待ち' }[ai.status] : '準備中',
      disabled: !ai || (ai.status === 'attention' && !ai.requested), reason: ai?.status === 'attention' ? '設定で理由を確認して再開' : undefined },
    { id: 'speechRecognition', icon: '♩', name: '配信者音声認識', checked: snapshot.settings.speechRecognition.enabled, action: toggleRecognition,
      status: { disabled: '停止中', waitingForInput: 'スマホ音声待ち', preparing: '準備中', listening: '待受中', speechDetected: '発話検出', recognizing: '認識中', unavailable: '要確認' }[snapshot.speechRecognition.status] },
  ] as const;
  const displayed = operations.filter(operation => prefix !== 'home' || operation.id !== 'aiListener');
  if (compact) displayed.sort((a, b) => ['commentSpeech', 'speechRecognition', 'aiListener'].indexOf(a.id) - ['commentSpeech', 'speechRecognition', 'aiListener'].indexOf(b.id));
  return <section className={compact ? 'home-support studio-live-operations' : 'home-support studio-card'} aria-label={compact ? 'いつもの操作' : undefined}>
    <h2>{prefix === 'home' ? '音声' : 'よく使う操作'}</h2><div className="home-operations">{displayed.map(operation => {
      const reason = 'reason' in operation ? operation.reason : undefined;
      const status = operation.status;
      return <article key={operation.id} data-operation={operation.id}>
        {!compact && <span className="entry-icon" aria-hidden="true">{operation.icon}</span>}
        <div className="operation-copy"><button id={`${prefix}-${operation.id}`} className="feature-link" aria-label={compact ? `${operation.name}の設定と状態` : undefined} onClick={event => open(operation.id, event.currentTarget)}>
          {compact ? { commentSpeech: '読み上げ', speechRecognition: '音声認識', aiListener: 'AIリスナー' }[operation.id] : operation.name} ›</button>
          <p className={compact ? 'studio-live-operation-status' : operation.id === 'commentSpeech' ? 'home-comment-speech-status' : undefined} title={compact ? [status, reason].filter(Boolean).join('。') : undefined}><span>{status}{compact && reason && <><br />設定で確認・再開</>}</span></p></div>
        <SlimSwitch label={operation.name} checked={operation.checked} keepFocus={compact} disabled={operationsBusy?.[operation.id] || ('disabled' in operation ? operation.disabled : false)} reason={compact ? undefined : reason} onChange={operation.action} />
      </article>;
    })}</div>
  </section>;
}

export function ManagementHome(props: ManagementHomeProps) {
  const { snapshot, sourcesBusy, shitarabaStartBlocked, toggleSource, prefix = 'home', sections = 'all' } = props;
  const { open } = useContext(ManagementNavigation)!;
  return <>
    {sections !== 'operations' && <section className="home-connections studio-card"><div className="home-section-heading"><h2>コメントの接続</h2><button id={`${prefix}-connections`} onClick={event => open('sources', event.currentTarget)}>接続先を変更 ›</button></div>
      <div className="home-source-grid">{connectionKeys.map(source => {
        const status = snapshot.sourceStatuses[source];
        const active = status.state !== 'stopped' && (status.state !== 'error' || snapshot.settings.sources[source].enabled);
        return <article className="home-source" key={source}>
          <button id={`${prefix}-source-${source}`} className="source-link" onClick={event => open('sources', event.currentTarget, `source-${source}`)}>{connectionLabel(source, status)} ›</button>
          <p className={`home-source-status status-${status.state}`}>{statusLabels[status.state]}</p>
          <SlimSwitch label={`${connectionLabel(source, status)}のコメント取得`} checked={active} keepFocus={prefix === 'live'}
            disabled={sourcesBusy || (source === 'shitaraba' && !active && shitarabaStartBlocked)} onChange={enabled => toggleSource(source, enabled)} />
        </article>;
      })}</div>
      <div className="studio-footer-links"><button id={`${prefix}-filter`} className="feature-link" onClick={event => open('commentFilter', event.currentTarget)}>フィルター ›</button><button id={`${prefix}-nextThread`} className="feature-link" onClick={event => open('nextThread', event.currentTarget)}>次スレッド作成 ›</button></div>
    </section>}
    {sections !== 'sources' && <ManagementOperations {...props} />}
  </>;
}
