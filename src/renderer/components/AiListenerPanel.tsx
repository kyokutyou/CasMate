import { useContext, useId, useLayoutEffect, useRef, useState, type ReactNode, type Ref, type FocusEventHandler } from 'react';
import { aiListenerMessages as m } from '../ai-listener-messages';
import { aiSources, type AiPersona, type AiSettings, type AiView } from '../../shared/ai-listener';
import { sourceLabels } from '../messages';
import { SettingsCard } from './SettingsCard';
import { SlimSwitch } from './SlimSwitch';
import './ai-listener-panel.css';
import { AiVisualPanel } from './AiVisualPanel';
import { AiApiTest } from './AiApiTest';
import { ManagementNavigation, SetupPresentation } from '../management-navigation';
import { AiUsageSummary } from './AiUsageSummary';
import { CompactFeedback } from './CompactFeedback';
import { aiGuideTone, aiRuntimeGuide, aiRuntimeWaiting, aiServiceGuide, type AiGuideAction, type AiSource } from '../ai-listener-guidance';

interface Props {
  onSuccess?(message: string): void;
  settings: AiSettings; savedSettings?: AiSettings; view: AiView; change(value: AiSettings): void;
  mutate(path: string, method?: string, body?: unknown): Promise<unknown>; saveError?: string;
  runtimeBusy?: boolean;
}
const resultLabels = { sending: m.sending, succeeded: m.succeeded, failed: m.failed, unknown: m.unknown };
const activityLabels = { idle: '待機なし', waiting: '通常の発言待機', speaking: '配信者の発話待ち', recognizing: '音声の認識待ち', 'speech-gap': '発話後の間を待っています',
  'new-speech': '新しい発話待ち', 'obs-check': 'OBSの配信状態を確認中', 'image-preparation': '画像入力を準備中', generating: 'AIの発言を生成中', posting: 'コメントを投稿中' };
function durationText(milliseconds?: number) { return milliseconds === undefined ? '未計測' : `${(milliseconds / 1000).toFixed(1)}秒`; }
const tabs = [
  { id: 'behavior', label: '発言の調整' }, { id: 'participants', label: '参加先' },
  { id: 'personas', label: '人格' }, { id: 'visual', label: '映像' }, { id: 'connections', label: '連携' }, { id: 'memory', label: '記憶・ログ' },
] as const;
type Tab = typeof tabs[number]['id'];
const tabId = (id: Tab) => id === 'personas' ? 'ai-personas' : `ai-tab-${id}`;
function Section({ title, description, autoSave, children }: { title: string; description?: string; autoSave?: boolean; children: ReactNode }) {
  return <section className="ai-section"><div className="ai-section-heading"><h3>{title}</h3>
    {autoSave && <span className="ai-save-note">自動保存</span>}
    {description && <p className="ai-help">{description}</p>}</div>{children}</section>;
}
function GuideActionButton({ action, secondary, primaryRef, busy, disabled, onAction, onFocus, onBlur }: {
  action: AiGuideAction; secondary: boolean; primaryRef?: Ref<HTMLButtonElement>; busy: boolean; disabled: boolean;
  onAction(action: AiGuideAction, origin: HTMLButtonElement): void;
  onFocus: FocusEventHandler<HTMLButtonElement>; onBlur: FocusEventHandler<HTMLButtonElement>;
}) {
  return <button ref={primaryRef} type="button" className={secondary ? 'secondary' : undefined} disabled={disabled}
    aria-disabled={busy} aria-busy={busy} onFocus={onFocus} onBlur={onBlur} onClick={event => { if (!busy) onAction(action, event.currentTarget); }}>{action.label}</button>;
}
export function AiListenerPanel({ settings, savedSettings = settings, view, change, mutate, saveError, runtimeBusy = false, onSuccess }: Props) {
  const navigation = useContext(ManagementNavigation);
  const { confirmation } = useContext(SetupPresentation);
  const unitId = useId();
  const guide = aiRuntimeGuide(settings, view);
  const waiting = aiRuntimeWaiting(guide);
  const extraStop = guide.primary.kind !== 'stop' && guide.secondary?.kind !== 'stop'
    && (view.status === 'attention' || view.requested || settings.mode === 'obs');
  const latestDetails = useRef<HTMLDetailsElement>(null);
  const [accountOpen, setAccountOpen] = useState<Partial<Record<AiSource, boolean>>>({});
  const accountDetails = useRef<Partial<Record<AiSource, HTMLDetailsElement | null>>>({});
  const primaryAction = useRef<HTMLButtonElement>(null);
  const focusedAction = useRef<{ element: HTMLElement; fallback: HTMLElement | null } | null>(null);
  useLayoutEffect(() => {
    const origin = focusedAction.current;
    if (origin && !origin.element.isConnected) {
      if (document.activeElement === document.body) (origin.fallback?.isConnected ? origin.fallback : primaryAction.current)?.focus({ preventScroll: true });
      focusedAction.current = null;
    }
  });
  const [setupSource, setSetupSource] = useState<AiSource>('youtube');
  const [detailTab, setDetailTab] = useState<Tab>('behavior');
  const basic = navigation?.initialSetup === true;
  const tab = detailTab;
  const setTab = setDetailTab;
  const visibleTabs = tabs;
  const tabButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const [guideFocus, setGuideFocus] = useState<Extract<AiGuideAction, { kind: 'tab' }> | null>(null);
  const [busy, setBusy] = useState(false);
  const operationPending = useRef(false);
  const [error, setError] = useState('');
  const [visualError, setVisualError] = useState('');
  const [key, setKey] = useState('');
  const [youtubeJson, setYoutubeJson] = useState('');
  const [clientId, setClientId] = useState('');
  const [clearConfirmed, setClearConfirmed] = useState(false);
  const [apiRevision, setApiRevision] = useState(0);
  const [editing, setEditing] = useState<AiPersona | null>(null);
  const personaName = useRef<HTMLTextAreaElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const editorOrigin = useRef<HTMLButtonElement | null>(null);
  const editPersona = (persona: AiPersona, origin: HTMLButtonElement) => {
    editorOrigin.current = origin; setEditing({ ...persona });
    requestAnimationFrame(() => personaName.current?.focus());
  };
  const closeEditor = () => {
    setEditing(null);
    requestAnimationFrame(() => (editorOrigin.current?.isConnected ? editorOrigin.current : addButton.current)?.focus());
  };
  const act = async (action: string, body?: unknown) => {
    if (operationPending.current || busy) return false;
    if (runtimeBusy && ['start', 'stop', 'resume'].includes(action)) return;
    operationPending.current = true;
    setBusy(true); setError('');
    if (action === 'credentials' && body && typeof body === 'object' && 'key' in body) setApiRevision(value => value + 1);
    try { await mutate(`/api/ai-listener/${action}`, 'POST', body); return true; }
    catch (e) { setError(e instanceof Error ? e.message : m.operationFailed); return false; }
    finally { operationPending.current = false; setBusy(false); }
  };
  const numberField = (label: string, field: 'waitSeconds' | 'jitterPercent' | 'maxCharacters' | 'memoryCharacters' | 'contextCharacters', min: number, max: number, unit: string) =>
    <label>{label}<span className="ai-number">{field === 'jitterPercent' && <span aria-hidden="true">±</span>}<input type="number" min={min} max={max} step={1} value={settings[field]} aria-describedby={`${unitId}-${field}`}
      onChange={e => change({ ...settings, [field]: Number(e.target.value) })} /><span id={`${unitId}-${field}`} className={field === 'jitterPercent' ? 'ai-unit-description' : undefined} aria-hidden="true">{unit}</span>{field === 'jitterPercent' && <span aria-hidden="true">%</span>}</span></label>;
  const followGuide = (action: AiGuideAction, origin: HTMLButtonElement) => {
    if (action.kind === 'start' || action.kind === 'stop' || action.kind === 'resume') { void act(action.kind, action.source ? { source: action.source } : undefined); return; }
    if (action.kind === 'editor') { navigation?.open(action.editor, origin); return; }
    if (action.kind === 'latest') {
      if (latestDetails.current) {
        latestDetails.current.open = true;
        const target = action.source ? document.getElementById(`${unitId}-latest-${action.source}`) : latestDetails.current.querySelector('summary');
        target?.focus({ preventScroll: true }); target?.scrollIntoView?.({ block: 'nearest' });
      }
      return;
    }
    setTab(action.tab);
    if (action.tab === 'connections' && action.source) { const details = accountDetails.current[action.source]; if (details) details.open = true; }
    setGuideFocus(action);
  };
  const actionButton = (action: AiGuideAction, secondary = false) => <GuideActionButton action={action} secondary={secondary} primaryRef={secondary ? undefined : primaryAction}
    disabled={(action.kind === 'start' && Boolean(saveError)) || (action.kind === 'editor' && !navigation)} busy={busy || runtimeBusy} onAction={followGuide}
    onFocus={event => { const element = event.currentTarget; focusedAction.current = { element, fallback: element.closest('.ai-service')?.querySelector('select') ?? element.closest<HTMLElement>('.ai-latest-item') }; }}
    onBlur={event => { if (event.relatedTarget) focusedAction.current = null; }} />;
  useLayoutEffect(() => {
    if (!guideFocus) return;
    const target = guideFocus.tab === 'connections' ? guideFocus.source ? accountDetails.current[guideFocus.source]?.querySelector<HTMLElement>('input,textarea') : document.getElementById(`${unitId}-key`)
      : guideFocus.tab === 'participants' ? guideFocus.source ? document.getElementById(`${unitId}-persona-${guideFocus.source}`) : document.querySelector<HTMLElement>('#ai-panel-participants [role=switch]')
      : guideFocus.tab === 'personas' ? personaName.current ?? addButton.current : document.querySelector<HTMLElement>('#ai-panel-memory input');
    target?.focus({ preventScroll: true }); target?.scrollIntoView?.({ block: 'nearest' });setGuideFocus(null);
  }, [guideFocus, unitId]);
  const panel = (id: Tab, children: ReactNode) => basic && ['connections','personas','participants'].includes(id)
    ? <section id={`ai-panel-${id}`} className="setup-step-card setup-ai-step" data-ai-step={id}><h2><span className="setup-number">{id === 'connections' ? 1 : id === 'personas' ? 2 : 3}</span>{id === 'connections' ? 'APIキーを準備する' : id === 'personas' ? '話し方を決める' : '参加先を選ぶ'}</h2>{children}</section>
    : <div id={`ai-panel-${id}`} role="tabpanel" aria-labelledby={tabId(id)} hidden={basic || tab !== id}>{children}</div>;
  const accounts = (!basic || ['youtube', 'twitch'].includes(setupSource)) && (<>       <Section title="投稿アカウント">{(['youtube', 'twitch'] as const).filter(source => !basic || setupSource === source).map(source => <details ref={element => { accountDetails.current[source] = element; }} className="ai-details" data-ai-account={source} open={accountOpen[source] ?? false} onToggle={event => { const expanded = event.currentTarget.open; setAccountOpen(current => current[source] === expanded ? current : { ...current, [source]: expanded }); }} key={source}><summary>{sourceLabels[source]} <span className="ai-help">{view.services[source].account ?? m.unlinked}</span></summary>
        {source === 'youtube' ? <><ol className="ai-help"><li><a href="https://developers.google.com/youtube/v3/guides/auth/installed-apps" target="_blank" rel="noreferrer">YouTube公式の認証手順</a>でデスクトップアプリ用のクライアントを用意します。</li><li>取得したJSONを下へ貼り付けて保存します。</li><li>「{sourceLabels.youtube}{m.link}」からブラウザで許可します。</li></ol><label>{m.youtubeJson}<textarea rows={3} autoComplete="off" value={youtubeJson} onChange={e => setYoutubeJson(e.target.value)} /></label>
          <div className="button-row"><button className="secondary" disabled={!basic && (busy || !youtubeJson.trim())} aria-disabled={basic ? busy || !youtubeJson.trim() : undefined} onClick={async () => { if (!youtubeJson.trim()) return; const submitted = youtubeJson; if (await act('credentials', { youtubeJson: submitted })) setYoutubeJson(current => current === submitted ? '' : current); }}>{m.saveYoutube}</button></div></>
          : <><label>Twitch Public Client ID<input value={clientId} onChange={e => setClientId(e.target.value)} /></label><div className="button-row"><button className="secondary" disabled={!basic && (busy || !clientId.trim())} aria-disabled={basic ? busy || !clientId.trim() : undefined} onClick={async () => { if (!clientId.trim()) return; const submitted = clientId; if (await act('credentials', { twitchClientId: submitted })) setClientId(current => current === submitted ? '' : current); }}>{m.saveTwitch}</button></div></>}
        <div className="button-row"><button disabled={!basic && busy} aria-disabled={basic ? busy : undefined} onClick={() => void act('link', { source })}>{sourceLabels[source]}{m.link}</button>
          <button className="secondary" disabled={!basic && (busy || !view.services[source].account)} aria-disabled={basic ? busy || !view.services[source].account : undefined} onClick={() => { if (view.services[source].account) void act('unlink', { source }); }}>{m.unlink}</button></div>
      </details>)}</Section> </>);
  const apiTest = (<>         <AiApiTest model={settings.model} revision={apiRevision} hasKey={view.hasKey} unsavedKey={Boolean(key.trim())}
          requested={view.requested} busy={busy || runtimeBusy} saveError={saveError} mutate={mutate}
          onBusy={setBusy} onError={setError} onSuccess={onSuccess} /> </>);
  const authorization = view.authorization && <span className="ai-authorization" onFocus={event => { focusedAction.current = { element: event.currentTarget, fallback: event.currentTarget.closest<HTMLElement>('.compact-feedback') }; }} onBlur={event => { if (event.relatedTarget) focusedAction.current = null; }}><a href={view.authorization.url} target="_blank" rel="noreferrer">{sourceLabels[view.authorization.source]}：{m.authorize}</a>{view.authorization.code && <>{m.codePrefix}<strong>{view.authorization.code}</strong></>}{view.authorization.expiresAt && <>{m.expiresPrefix}{new Date(view.authorization.expiresAt).toLocaleTimeString()}）</>}</span>;
  return <SettingsCard cardId="aiListener" title={m.title} eyebrow="AI LISTENER" className="ai-settings"
    navigationWarning={saveError || error || visualError || (basic && busy ? 'AIの設定を保存・確認しています。完了までお待ちください。' : basic && (key.trim() || youtubeJson.trim() || clientId.trim() || editing) ? '連携情報または人格の編集を保存してください。' : undefined)}
    summary={!basic && <>
      {!basic && <><div className="ai-runtime"><div className="ai-runtime-top"><div role="status" className="ai-runtime-copy"><span className="ai-state" data-status={view.status} data-tone={aiGuideTone(guide.label)}>{guide.label}</span>
        <CompactFeedback tabIndex={0} role={saveError || error ? 'alert' : undefined} className={`ai-runtime-message${saveError || error ? ' ai-runtime-error' : ''}`} reserve={['OBS配信先への再接続待ちです。', '投稿上限による待機中です。会話は記憶しています。']}>{saveError || error || (!authorization && guide.reason)}{authorization}</CompactFeedback>
        </div><div className="button-row ai-runtime-primary">{actionButton(guide.primary)}</div></div>
      <div className="ai-runtime-summary"><div className="ai-runtime-progress" aria-label="AIリスナーの処理状況" tabIndex={view.requested || view.status === 'running' ? 0 : -1} style={{ visibility: view.requested || view.status === 'running' ? 'visible' : 'hidden' }}>
        <p>現在：<span className="ai-runtime-stage">{!view.activity || view.activity.stage === 'idle' ? waiting.current : activityLabels[view.activity.stage]}</span></p>
        <p className="ai-runtime-next">次の発言チェック：{view.nextAt === null ? waiting.next : new Date(view.nextAt).toLocaleTimeString()}</p>
        <p className="ai-runtime-caution">判定時刻は投稿予約ではありません。</p>
      </div></div>
      <div className="ai-runtime-details"><details className="ai-duration-details"><summary>処理時間を確認</summary><p className="ai-runtime-durations">直近の処理時間：OBS {durationText(view.activity?.lastDurationsMs['obs-check'])}・画像 {durationText(view.activity?.lastDurationsMs['image-preparation'])}・生成 {durationText(view.activity?.lastDurationsMs.generating)}・投稿 {durationText(view.activity?.lastDurationsMs.posting)}</p></details>
      <details ref={latestDetails} className="ai-latest"><summary>接続状態・最新投稿</summary><div className="ai-service-list">{aiSources.map(source => {
        const service = view.services[source]; const last = service.latest;
        return <article id={`${unitId}-latest-${source}`} tabIndex={-1} key={source} className="ai-latest-item"><div className="ai-row"><strong>{sourceLabels[source]}</strong><span className="ai-help">{service.ready ? m.ready : service.message || m.awaitingSettings}</span></div>
          {last ? <><p className="ai-post">{last.text}</p><p className="ai-help">{last.personaName}・{new Date(last.at).toLocaleString()}・{resultLabels[last.result]}</p></> : <p className="ai-help">{m.noPosts}</p>}
          {aiServiceGuide(settings, view, source).recover && actionButton({ kind: 'resume', label: `${sourceLabels[source]}${m.resumeService}`, source }, true)}
        </article>;
      })}</div></details><div className="ai-runtime-secondary">{guide.secondary && actionButton(guide.secondary, true)}{extraStop && actionButton({ kind: 'stop', label: view.requested ? '開始要求を取り消す' : settings.mode === 'obs' ? '自動開始を止める' : '停止' }, true)}</div></div></div></>}
    </>}>
    {!basic && <div className="ai-tabs" role="tablist" aria-label="AIリスナーの設定">{visibleTabs.map((item, index) => <button key={item.id} id={tabId(item.id)}
      ref={element => { tabButtons.current[index] = element; }} className="secondary" type="button" role="tab" aria-selected={tab === item.id} aria-controls={`ai-panel-${item.id}`}
      tabIndex={tab === item.id ? 0 : -1} onFocus={() => setTab(item.id)} onClick={() => setTab(item.id)} onKeyDown={event => {
        const next = event.key === 'ArrowRight' ? (index + 1) % visibleTabs.length : event.key === 'ArrowLeft' ? (index + visibleTabs.length - 1) % visibleTabs.length
          : event.key === 'Home' ? 0 : event.key === 'End' ? visibleTabs.length - 1 : null;
        if (next !== null) { event.preventDefault(); tabButtons.current[next]?.focus(); }
      }}>{item.label}</button>)}</div>}
    {panel('visual', <AiVisualPanel settings={settings} view={view} active={tab === 'visual'} change={change} mutate={mutate} saveError={saveError} onSuccess={onSuccess} onError={setVisualError} />)}
    {panel('behavior', <>
      <Section title="発言のタイミングと長さ" autoSave>
        <div className="ai-mode"><label>{m.mode}<select value={settings.mode} onChange={e => change({ ...settings, mode: e.target.value as AiSettings['mode'] })}><option value="manual">{m.manual}</option><option value="obs">{m.obsMode}</option></select></label>
        <p className="ai-help">どちらもOBS配信中だけ動作します。</p></div>
        <div className="ai-fields ai-timing-fields">{numberField('発言待ち時間', 'waitSeconds', 30, 3600, '秒')}{numberField('待ち時間のばらつき', 'jitterPercent', 0, 50, '±%')}{numberField(m.maxCharacters, 'maxCharacters', 10, 200, '文字')}</div>
        <CompactFeedback className="ai-help ai-wait-range" reserve={['待つ時間の目安：1800〜5400秒', '待ち時間：30〜3600秒、ばらつき：0〜50%']}>{Number.isInteger(settings.waitSeconds) && settings.waitSeconds >= 30 && settings.waitSeconds <= 3600 && Number.isInteger(settings.jitterPercent) && settings.jitterPercent >= 0 && settings.jitterPercent <= 50
          ? `待つ時間の目安：${Math.max(30, Math.round(settings.waitSeconds * (1 - settings.jitterPercent / 100)))}〜${Math.max(30, Math.round(settings.waitSeconds * (1 + settings.jitterPercent / 100)))}秒` : '待ち時間：30〜3600秒、ばらつき：0〜50%'}</CompactFeedback>
        <p className="ai-help">新しいコメントが届くと、待ち時間を数え直します。</p>
        <div className="ai-budget" aria-label="投稿上限の状態">
          <p>直近60分の投稿枠：{view.postingBudget.used} / {view.postingBudget.limit}件</p>
          <p>頻度制限の解除予定：{view.postingBudget.nextAllowedAt === null ? '制限による待機なし' : new Date(view.postingBudget.nextAllowedAt).toLocaleTimeString()}</p>
          <p>解除時刻は投稿の予約ではありません。会話とOBSの状態により待機します。</p>
        </div>
        <details className="ai-details"><summary>発言の条件・上限について</summary>
          <p className="ai-help">ばらつきを含めて最低30秒待ちます。配信者の発話・認識中は投稿せず、終わってから1.5秒待ちます。生成中に新しい発話が来ると待ち直します。</p>
          <p className="ai-help">全サービス合計で直近60分に60件まで。初回挨拶・送信失敗も含み、停止や再起動ではリセットされません。</p>
          <p className="ai-help">手動方式は配信開始を待てます。配信終了後は、次回あらためて開始してください。</p>
          <p className="ai-help">{m.lengthExplanation}</p>
        </details>
      </Section>
      <section className="ai-section ai-usage-section"><details className="ai-details ai-usage-details"><summary>今回の起動中のAPI使用量</summary>
        <AiUsageSummary usage={view.usage} />
      </details></section>
    </>)}
    {panel('connections', <>
      <Section title="Gemini"><p className="ai-help"><a href="https://aistudio.google.com/" target="_blank" rel="noreferrer">Google AI Studio</a>でAPIキーを用意し、入力して保存します。利用条件・料金も提供元で確認してください。</p>
        <p className="ai-help ai-send-note">AIの発言を生成するため、人格と会話をGeminiへ送信します。</p>
        <div className="ai-credential-row"><label>{m.keyPrefix}{view.hasKey ? m.registered : m.unregistered}）<input id={`${unitId}-key`} type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} /></label>
        <button className="secondary" disabled={!basic && (busy || !key.trim())} aria-disabled={basic ? busy || !key.trim() : undefined} onClick={async () => { if (!key.trim()) return; const submitted = key; if (await act('credentials', { key: submitted })) setKey(current => current === submitted ? '' : current); }}>{m.saveKey}</button></div>
        <label>{m.model}<input value={settings.model} onChange={e => change({ ...settings, model: e.target.value })} /></label>
        {!basic && apiTest}
        <details className="ai-details"><summary>送信内容・利用条件</summary><p className="ai-help">{m.privacyExplanation}</p><p className="ai-help"><a href="https://aistudio.google.com/" target="_blank" rel="noreferrer">Google AI Studio</a> · <a href="https://ai.google.dev/gemini-api/terms" target="_blank" rel="noreferrer">{m.terms}</a></p></details>
      </Section>
      {!basic && accounts}
    </>)}
    {panel('personas', <Section title={`${m.personasPrefix}${settings.personas.length}/30）`} description="性格や話し方を設定します。管理用の名前は、投稿アカウント名とは別です。">
      <div className="ai-persona-layout"><div className="ai-persona-list">
        {!settings.personas.length && <p className="ai-empty">人格がまだありません。最初の一人を追加しましょう。</p>}
        {settings.personas.map(p => {
          const assigned = aiSources.filter(s => settings.participants[s].personaId === p.id);
          return <article className="ai-persona" data-editing={editing?.id === p.id} key={p.id}><div><strong>{p.name}</strong><p className="ai-help">{assigned.length ? `${assigned.map(s => sourceLabels[s]).join('・')}に割当中（削除するには割当を解除）` : '未割当'}</p></div>
            <div className="button-row"><button className="secondary small" disabled={editing !== null} onClick={e => editPersona(p, e.currentTarget)}>{m.edit}</button>
              <button className="secondary small danger" disabled={assigned.length > 0 || editing !== null} onClick={() => change({ ...settings, personas: settings.personas.filter(x => x.id !== p.id) })}>{m.remove}</button></div></article>;
        })}
        <button ref={addButton} className="secondary" disabled={settings.personas.length >= 30 || editing !== null} onClick={e => editPersona({ id: crypto.randomUUID(), name: '', personality: '', tone: '', firstPerson: '', topics: '', notes: '' }, e.currentTarget)}>{m.addPersona}</button>
      </div>
      {editing && <fieldset className="ai-persona-editor"><legend>{m.editPersona}</legend><p className="ai-help">名前以外は空欄でも使えます。</p>
      <label>{m.personaName}（必須）<textarea ref={personaName} rows={1} value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} /></label><div className="ai-fields">
        {([['personality', m.personality], ['tone', m.tone], ['firstPerson', m.firstPerson], ['topics', m.topics]] as const).map(([field, label]) => <label key={field}>{label}<textarea rows={field === 'firstPerson' ? 1 : 2} value={editing[field]} onChange={e => setEditing({ ...editing, [field]: e.target.value })} /></label>)}
      </div><details className="ai-details"><summary>{m.notes}</summary><label>{m.notes}<textarea rows={3} value={editing.notes} onChange={e => setEditing({ ...editing, notes: e.target.value })} /></label></details><div className="button-row"><button disabled={!editing.name.trim()} onClick={() => {
        const exists = settings.personas.some(p => p.id === editing.id);
        change({ ...settings, personas: exists ? settings.personas.map(p => p.id === editing.id ? editing : p) : [...settings.personas, editing] }); closeEditor();
      }}>{m.savePersona}</button><button className="secondary" onClick={closeEditor}>{m.cancel}</button></div></fieldset>}
      </div>
    </Section>)}
    {panel('participants', <Section title="参加先と人格" autoSave description="掲示板は、接続中のしたらば・jpnknのどちらかに参加します。">
      <>{basic && <label>参加先<select aria-label="準備する参加先" value={setupSource} onChange={event => setSetupSource(event.target.value as AiSource)}>{aiSources.map(source => <option key={source} value={source}>{sourceLabels[source]}</option>)}</select></label>}<div className="ai-service-list">{aiSources.filter(source => !basic || source === setupSource).map(source => { const serviceGuide = aiServiceGuide(settings, view, source); return <article className="ai-service" key={source}>
        <div className="ai-row"><h4>{sourceLabels[source]}</h4><SlimSwitch label={`${sourceLabels[source]}${m.participate}`} checked={settings.participants[source].enabled}
          onChange={enabled => change({ ...settings, participants: { ...settings.participants, [source]: { ...settings.participants[source], enabled } } })} /></div>
        <label>{sourceLabels[source]}で使う人格<select id={`${unitId}-persona-${source}`} value={settings.participants[source].personaId} onChange={e => change({ ...settings, participants: { ...settings.participants, [source]: { ...settings.participants[source], personaId: e.target.value } } })}>
          <option value="">{m.selectPersona}</option>{settings.personas.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select></label>
        <div className="ai-service-label" data-tone={aiGuideTone(serviceGuide.label)}>{serviceGuide.label}</div>
        <CompactFeedback className="ai-help ai-service-status" role="status" tabIndex={0} reserve={['「連携」タブで投稿用アカウントを登録してください。', '参加をオンにすると、接続中の掲示板を使います。']}>{basic && serviceGuide.label === 'アカウント未連携' ? '下の投稿アカウントで登録情報を保存し、連携してください。' : serviceGuide.detail}</CompactFeedback>
        <div className="ai-service-recovery">{serviceGuide.action && !basic && actionButton(serviceGuide.action, true)}{!basic && serviceGuide.recover && actionButton({ kind: 'resume', label: `${sourceLabels[source]}${m.resumeService}`, source }, true)}</div>
        {source === 'shitaraba' && <details className="ai-details"><summary>投稿者名・E-mail</summary><div className="ai-fields"><label>{m.shitarabaName}<input value={settings.shitarabaName} onChange={e => change({ ...settings, shitarabaName: e.target.value })} /></label>
          <label>{m.shitarabaEmail}<input value={settings.shitarabaEmail} onChange={e => change({ ...settings, shitarabaEmail: e.target.value })} /></label></div></details>}
        {source === 'jpnkn' && <details className="ai-details"><summary>投稿者名・E-mail</summary><div className="ai-fields"><label>jpnknの名前<input value={settings.jpnknName} onChange={e => change({ ...settings, jpnknName: e.target.value })} /></label>
          <label>jpnknのE-mail<input value={settings.jpnknEmail} onChange={e => change({ ...settings, jpnknEmail: e.target.value })} /></label></div>
          <p className="ai-help">認証が必要な場合は投稿を止めます。ブラウザで確認してから、このサービスを再開してください。</p></details>}
      </article>; })}</div></>
      {!settings.personas.length && <p className="ai-hint">まず人格を追加・保存すると、参加先へ割り当てられます。</p>}
      {basic && accounts}
    </Section>)}
    {panel('memory', <>
      <Section title="共有記憶と送信する会話" autoSave description="共有記憶はすべてのAIリスナーで使います。">
        <p className="ai-memory-size">現在 <strong>{view.memoryCharacters.toLocaleString()}</strong> 文字</p>
        <div className="ai-fields">{numberField(m.memoryCharacters, 'memoryCharacters', 1000, 100000, '文字')}
        {numberField(m.contextCharacters, 'contextCharacters', 1000, 10000, '文字')}</div><details className="ai-details"><summary>記憶と送信量について</summary><p className="ai-help">上限を超えると、古い発言から忘れます。</p><p className="ai-help">{m.contextExplanation}</p></details>
      </Section>
      <Section title="発言ログ">
        <div className="button-row"><button className="secondary" disabled={busy} onClick={() => void act('open-logs')}>{m.openLogs}</button></div>
        <details className="ai-details"><summary>デバッグ用の記録</summary><label className="check"><input type="checkbox" checked={settings.debugPromptLog} onChange={e => change({ ...settings, debugPromptLog: e.target.checked })} />{m.debugPromptLog}</label>
        <p className="ai-help">{m.debugPromptExplanation}</p></details>
      <details className="ai-details ai-delete-details"><summary>共有記憶を削除</summary><p className="ai-help">全員の会話の記憶を削除します。この操作は取り消せません。発言ログは残ります。</p>
        <label className="ai-confirm"><input type="checkbox" checked={clearConfirmed} onChange={e => setClearConfirmed(e.target.checked)} />{m.confirmClear}</label>
        <div className="button-row"><button className="secondary danger" disabled={busy || !clearConfirmed} onClick={() => { setClearConfirmed(false); void act('clear-memory', { confirmed: true }); }}>{m.clearMemory}</button></div>
      </details>
      </Section>
    </>)}
    {basic && <section className="setup-step-card setup-ai-final"><h2><span className="setup-number">4</span>準備を確認する</h2><p>保存した設定を確認します。利用開始は通常画面のAIリスナーで行います。</p><AiSetupPreparation settings={savedSettings} view={view} />{apiTest}<p className="ai-help">APIテストの成功は、利用枠の残量や今後の利用を保証するものではありません。</p><CompactFeedback className="setup-ai-status" role="status" tabIndex={0} reserve={['投稿アカウントの認証が必要です。']}>{saveError || error || (!authorization && view.message)}{authorization}</CompactFeedback><p className="setup-inline-note">コメント接続・配信者音声認識・OBS接続の準備も確認してください。利用開始は通常画面のAIリスナーから行います。</p>{confirmation}</section>}
  </SettingsCard>;
}

function AiSetupPreparation({ settings, view }: { settings: AiSettings; view: AiView }) {
  const participants = aiSources.filter(source => settings.participants[source].enabled);
  return <div className="setup-ai-preparation" role="region" aria-label="保存済みのAI利用準備" tabIndex={0}><ul>
    <li><span>{view.hasKey ? '✓' : '○'} APIキー</span><strong>{view.hasKey ? '保存済み' : 'キーを保存してください'}</strong></li>
    <li><span>{settings.personas.length ? '✓' : '○'} 話し方（人格）</span><strong>{settings.personas.length ? settings.personas.length + '件保存済み' : '人格を追加・保存してください'}</strong></li>
    {!participants.length && <li><span>○ 参加先</span><strong>参加先をONにして、人格を選んでください</strong></li>}
    {participants.map(source => {
      const persona = settings.personas.find(item => item.id === settings.participants[source].personaId);
      const account = source === 'shitaraba' || source === 'jpnkn' || Boolean(view.services[source].account);
      const missing = [!persona && '人格を選んでください', !account && '投稿アカウントを連携してください'].filter(Boolean);
      return <li key={source}><span>{!missing.length ? '✓' : '○'} {sourceLabels[source]}</span><strong>{missing.length ? missing.join('・') : '準備済み：' + persona?.name}</strong></li>;
    })}
  </ul></div>;
}
