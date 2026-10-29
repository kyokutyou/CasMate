import { CompactFeedback } from './CompactFeedback';
import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ObsControlPhrases, ObsControlView } from '../../shared/obs-control';
import { ManagementNavigation } from '../management-navigation';
import { useObsControlSettings } from '../use-obs-control-settings';
import { SettingsCard } from './SettingsCard';
import { SlimSwitch } from './SlimSwitch';
import { ObsConnectionGuide } from './ObsConnectionGuide';
import './obs-control-panel.css';

const connectionLabels = { disabled: '連携オフ', connecting: '接続中', connected: '接続済み', unavailable: '利用不可' } as const;
const streamLabels = { unknown: '状態不明', stopped: '停止中', starting: '開始中', streaming: '配信中', reconnecting: '再接続中', stopping: '終了中' } as const;
const operationLabels = { executing: '実行中', succeeded: '成功', alreadySatisfied: '変更不要', failed: '失敗', unknown: '結果不明', cancelled: '取消済み' };

export function ObsControlPanel({ view, configure, retry, cancel,
  onSuccess,
}: {
  view: ObsControlView; configure(value: unknown): Promise<unknown>;
  retry(): Promise<unknown>; cancel(): Promise<unknown>;
  onSuccess?(message: string): void;
}) {
  const navigation = useContext(ManagementNavigation);
  const setup = navigation?.initialSetup === true;
  const [operationError, setOperationError] = useState('');
  const [guideOpen, setGuideOpen] = useState(false);
  const settings = useObsControlSettings(view, async value => {
    const result = await configure(value);
    setOperationError('');
    return result;
  });
  const { draft, errors } = settings;
  const [connectionOpen, setConnectionOpen] = useState(Boolean(navigation?.initialSetup));
  useEffect(() => { if (navigation?.initialSetup) setConnectionOpen(true); }, [navigation?.initialSetup]);
  const [operation, setOperation] = useState<string | null>(null);
  const [clock, setClock] = useState(Date.now);
  useEffect(() => { if (view.connection === 'connected') setOperationError(''); }, [view.connection]);
  const pending = useRef(false);
  const connectionState = useRef(view.connection);
  useLayoutEffect(() => { connectionState.current = view.connection; }, [view.connection]);
  useEffect(() => {
    if (!view.confirmation) return;
    setClock(Date.now()); const id = setInterval(() => setClock(Date.now()), 250); return () => clearInterval(id);
  }, [view.confirmation]);

  const run = async (name: string, action: () => Promise<unknown>, success?: string) => {
    if (pending.current) return;
    pending.current = true; setOperation(name); setOperationError('');
    try { await action(); if (success) onSuccess?.(success); }
    catch (error) {
      // State can arrive before a lost retry response; a working connection has already satisfied that request.
      if (name !== 'retry' || connectionState.current !== 'connected') setOperationError(error instanceof Error ? error.message : '操作を完了できません。接続と保存状態を確認してください。');
    }
    finally { pending.current = false; setOperation(null); }
  };
  const toggle = async (key: 'enabled' | 'voiceEnabled' | 'androidEnabled', value: boolean) => {
    if (key === 'enabled' && value && !(await settings.save('connection'))) return;
    await settings.change(key, value, 'immediate');
  };
  const error = [...new Set([...Object.values(errors), operationError, view.error, view.publication.warning].filter(Boolean))].join(' ');
  const retryAvailable = view.connection === 'unavailable' && !view.confirmation;
  const changeConnection = (key: 'port' | 'password', value: string) => { void settings.change('connection', { ...draft.connection, [key]: value }, 'blur'); };
  const phraseField = (key: keyof ObsControlPhrases, label: string) => <label className="oc-field">{label}<input
    aria-label={label} value={draft.phrases[key]} aria-invalid={Boolean(errors.phrases)} aria-describedby="oc-phrases-help"
    onCompositionStart={() => settings.composition('phrases', true)} onCompositionEnd={() => settings.composition('phrases', false)}
    onChange={event => { void settings.change('phrases', { ...draft.phrases, [key]: event.target.value }, 'deferred'); }} /></label>;
  const preparationGuide = <details key="preparation" className="oc-details" open={guideOpen} onToggle={event => setGuideOpen(event.currentTarget.open)}><summary>OBS側の準備方法</summary><ObsConnectionGuide initialSetup={setup} /></details>;
  const connectionControls = (
      <details key="connection" className="oc-connection-details" open={connectionOpen}>
        <summary onClick={event => {
          event.preventDefault();
          if (connectionOpen) void settings.save('connection');
          setConnectionOpen(!connectionOpen);
        }}><span>OBSの接続設定</span><small>ポート{view.obsPort} / パスワード{view.passwordConfigured ? '設定済み' : '未設定'}</small></summary>
        <div className="oc-connection-body">
        {setup && preparationGuide}
        <div className="oc-grid" role="group" aria-label="OBS接続情報" onBlur={event => {
          if (navigation?.isHistoryNavigation?.()) return;
          if (event.currentTarget.contains(event.relatedTarget)) return;
          // Explicit connection actions own the commit; blur must not queue a second attempt after a failed save.
          if (event.relatedTarget instanceof Element && event.relatedTarget.closest('.management-nav,.back-button,.setup-topic-nav,.setup-footer,#setup-detail,#setup-interrupt,.oc-master,.oc-operation-action,.oc-save-connection,.oc-connection-details>summary')) return;
          void settings.save('connection');
        }} onCompositionStart={() => settings.composition('connection', true)} onCompositionEnd={() => settings.composition('connection', false)}>
          <label className="oc-field">OBS WebSocketポート<input aria-label="OBS WebSocketポート" type="number" min={1} max={65535} value={draft.connection.port} aria-invalid={Boolean(errors.connection)} onChange={event => changeConnection('port', event.target.value)} /><small>1〜65535 / 通常は4455</small></label>
          <label className="oc-field">OBS WebSocketパスワード<input aria-label="OBS WebSocketパスワード" type="password" autoComplete="new-password" value={draft.connection.password} placeholder={view.passwordConfigured ? '変更する場合だけ入力' : 'OBSで設定したパスワード'} onChange={event => changeConnection('password', event.target.value)} /><small>{view.passwordConfigured ? '設定済み。空欄なら現在のパスワードを保持。' : '未設定。OBS連携をオンにする前に入力してください。'}</small></label>
        </div>
        <CompactFeedback className="oc-help" role="status" reserve={["ポートとパスワードは、この入力領域から離れるとまとめて保存します。", "OBSポートは1〜65535の整数を入力してください。", "パスワードは256文字以内で入力してください。"]}>{errors.connection || errors.enabled || view.error || 'ポートとパスワードは、この入力領域から離れるとまとめて保存します。'}</CompactFeedback>
        {navigation?.initialSetup && <button type="button" className="secondary oc-save-connection" disabled={settings.saving} onClick={() => void settings.save('connection')}>接続情報を保存</button>}
        {!setup && preparationGuide}
        </div>
      </details>
  );
  return <SettingsCard cardId="obsControl" title="OBS操作" eyebrow="OBS CONTROL" className="obs-control-panel"
    navigationWarning={error || (navigation?.initialSetup && (settings.unsaved || settings.saving) ? '接続情報を保存してください。' : undefined)}>
    {setup && <h2><span className="setup-number">1</span>このPCのOBSに接続する</h2>}
    <div className="oc-content">
      {!setup && <p className="oc-note">音声・Androidから配信を開始・終了するための設定です。</p>}
      {setup && connectionControls}
      <section className="oc-live" aria-label="OBSの現在状態">
        <div className="oc-master"><div hidden={setup}><strong>OBS連携</strong><small>このPCのOBSに接続</small></div>{setup ? <button type="button" className="setup-primary setup-obs-connect" disabled={Boolean(operation) && operation !== 'connection'} aria-disabled={Boolean(operation)} onClick={() => { if (!operation) void run('connection', () => toggle('enabled', !draft.enabled)); }}><span>{operation === 'connection' ? '処理中…' : draft.enabled ? 'OBSの接続を停止する' : 'OBSに接続する'}</span></button> : <SlimSwitch label="OBS連携" checked={draft.enabled} keepFocus disabled={Boolean(operation)} onChange={value => toggle('enabled', value)} />}</div>
        <div className="oc-live-top"><div><small>OBS接続</small><strong>{connectionLabels[view.connection]}</strong></div><div><small>OBS配信</small><strong>{streamLabels[view.stream]}</strong></div></div>
        <div className={`oc-operation${error ? ' oc-operation-error' : view.confirmation || view.lastOperation?.status === 'unknown' ? ' oc-operation-warning' : ''}`}><div className="oc-operation-text" role="status" aria-label="OBS操作の状態">
          {operation && <span className="oc-operation-feedback">操作を処理しています…</span>}
          {error && <span className="oc-operation-feedback field-error">{error}</span>}
          {view.confirmation ? <>{view.confirmation.source === 'voice' ? '音声' : 'Android'}から配信{view.confirmation.action === 'start' ? '開始' : '終了'}の確認待ち · あと{Math.max(0, Math.ceil((view.confirmation.expiresAt - clock) / 1000))}秒<br />{view.confirmation.source === 'voice' ? `「${view.confirmation.action === 'start' ? view.phrases.startConfirm : view.phrases.stopConfirm}」と別の発話で確認します。` : 'Androidの確認画面で操作してください。'}</> : setup && !view.lastOperation ? <>OBS接続：{connectionLabels[view.connection]}<br />{({ disabled: '接続情報を入力して「OBSに接続する」を押してください。', connecting: '接続が終わるまでお待ちください。', connected: '接続できました。下の確認欄へ進んでください。', unavailable: 'OBSの起動と接続情報を確認して、再試行してください。' })[view.connection]}</> : view.lastOperation ? <>直近操作：配信{view.lastOperation.action === 'start' ? '開始' : '終了'}・{operationLabels[view.lastOperation.status]}<br />{view.lastOperation.status === 'unknown' ? '自動再送しません。OBS本体で現在状態を確認してください。' : '配信の開始・終了は、音声またはAndroidから操作します。'}</> : <>確認待ちはありません。<br />配信の開始・終了は、音声またはAndroidから操作します。</>}
        </div><button type="button" className="secondary oc-operation-action" aria-disabled={Boolean(operation) || (!retryAvailable && !view.confirmation)} onClick={() => {
          if (retryAvailable) void run('retry', async () => {
            if (!await settings.save('connection')) return;
            await retry();
            onSuccess?.('OBS接続を再試行しました。');
          });
          else if (view.confirmation) void run('cancel', cancel, '確認を取り消しました。');
        }}>{retryAvailable || setup && !view.confirmation ? 'OBS接続を再試行' : '確認を取り消す'}</button></div>
      </section>
      <div className="oc-save-status" role="status"><span>{settings.saving ? '保存中…' : Object.values(errors).some(Boolean) ? '保存できません' : settings.unsaved ? '未保存の入力があります' : '保存済み'}</span><small>変更は自動保存されます</small></div>
      <div className="oc-permission-area" hidden={navigation?.initialSetup}>
        <div className="oc-section-heading"><h3>どこから操作する？</h3><small>それぞれ個別に切り替え</small></div>
        <div className="oc-permissions">
          <section className="oc-permission" aria-label="音声の操作許可">
            <div className="oc-between"><h3>音声</h3><SlimSwitch label="音声によるOBS操作" checked={draft.voiceEnabled} disabled={!view.enabled || Boolean(operation)} keepFocus onChange={value => toggle('voiceEnabled', value)} /></div>
            <p className="oc-note">指示 → 別の発話で確認。<br />10秒以内に確認すると実行します。</p>
            <p className="oc-note">{view.enabled ? '音声認識の「配信に使う」もオンにしてください。プレビューだけではOBSを操作しません。' : 'OBS連携をオンにすると、音声操作を有効にできます。'}</p>
            <details className="oc-voice-details"><summary>フレーズを編集</summary>
              <div className="oc-phrases"><div className="oc-phrase-pair"><h4>配信を開始するとき</h4>{phraseField('startCommand', '開始を指示するフレーズ')}<small className="oc-flow-arrow">↓ 別の発話で、10秒以内に確認</small>{phraseField('startConfirm', '開始を確認するフレーズ')}</div><div className="oc-phrase-pair"><h4>配信を終了するとき</h4>{phraseField('stopCommand', '終了を指示するフレーズ')}<small className="oc-flow-arrow">↓ 別の発話で、10秒以内に確認</small>{phraseField('stopConfirm', '終了を確認するフレーズ')}</div></div>
              <CompactFeedback className="oc-help" id="oc-phrases-help" role="status" reserve={["各1〜100文字。空白・句読点を除いて完全一致で判定します。4つのフレーズは重複できません。", "フレーズは1〜100文字で入力し、空白・句読点を除いても4つが異なる内容にしてください。"]}>{errors.phrases || errors.voiceEnabled || '各1〜100文字。空白・句読点を除いて完全一致で判定します。4つのフレーズは重複できません。'}</CompactFeedback>
            </details>
          </section>
          <section className="oc-permission" aria-label="Androidの操作許可">
            <div className="oc-between"><h3>Android</h3><SlimSwitch label="AndroidからのOBS操作" checked={draft.androidEnabled} disabled={!view.enabled || Boolean(operation)} keepFocus onChange={value => toggle('androidEnabled', value)} /></div>
            <p className="oc-note">{view.enabled ? 'Androidで対象PCと操作を確認してから実行します。映像送信とは連動しません。' : 'OBS連携をオンにすると、Android操作を有効にできます。'}</p>
            <p className="oc-android-state">Android待受：{view.publication.ready ? '準備完了' : '未準備'}</p>
            <button type="button" id="obs-smartphone-setup" className="secondary" disabled={!navigation} onClick={event => navigation?.open('smartphone', event.currentTarget)}>スマホ連携を開く →</button>
            <p className="oc-note">経路の選択・端末の登録はスマホ連携で行います。</p>
            <CompactFeedback className="oc-help" role="status" reserve={["LANの認証は暗号化ではありません。外部利用はTailscaleまたは直接接続を使用します。"]}>{errors.androidEnabled || view.publication.warning || 'LANの認証は暗号化ではありません。外部利用はTailscaleまたは直接接続を使用します。'}</CompactFeedback>
          </section>
        </div>
      </div>
      {!setup && connectionControls}
    </div>
  </SettingsCard>;
}
