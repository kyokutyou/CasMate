// Throwaway: compare three OBS settings layouts with the real shared heading and switches.
// All changes are in memory. No OBS commands, API requests, real QR or protected storage.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ManagementEditorHeading } from '../shared/ManagementEditorHeading';
import { SlimSwitch } from '../../src/renderer/components/SlimSwitch';
import { ManagementWarnings } from '../../src/renderer/components/ManagementWarnings';

const variants = ['A', 'B', 'C'] as const;
type Variant = typeof variants[number];
const names = { A: '一覧で整える', B: '目的で切り替える', C: '手順に沿って整える' };
const descriptions = { A: '接続・音声・Androidをひと続きに。全体を見渡して編集。', B: '必要な設定だけを表示。小さなウィンドウでも集中。', C: 'OBSの準備から端末登録まで。順序が分かる設定ガイド。' };
const initialDraft = { port: '4455', password: '', startCommand: 'きゃすメイト、配信開始', startConfirm: '開始を実行', stopCommand: 'きゃすメイト、配信終了', stopConfirm: '終了を実行', lan: false, tailscale: false, androidPort: '3002' };
type Scenario = 'ready' | 'disconnected' | 'confirming' | 'unknown';
const normalize = (value: string) => value.normalize('NFKC').replace(/[\p{White_Space}\p{Punctuation}]/gu, '');
function Section({ number, title, description, children }: { number: string; title: string; description: string; children: ReactNode }) {
  return <section className="obs-section"><div className="obs-section-heading"><span className="obs-number">{number}</span><div><h2>{title}</h2><small>{description}</small></div></div>{children}</section>;
}

export function Prototype() {
  const initial = new URLSearchParams(window.location.search).get('variant');
  const [variant, setVariant] = useState<Variant>(variants.includes(initial as Variant) ? initial as Variant : 'A');
  const [draft, setDraft] = useState(initialDraft);
  const [saved, setSaved] = useState(initialDraft);
  const [enabled, setEnabled] = useState(false);
  const [voice, setVoice] = useState(false);
  const [android, setAndroid] = useState(false);
  const [tab, setTab] = useState(0);
  const [step, setStep] = useState(0);
  const [scenario, setScenario] = useState<Scenario>('ready');
  const [registered, setRegistered] = useState(false);
  const [includeOutdoor, setIncludeOutdoor] = useState(false);
  const [includeObs, setIncludeObs] = useState(true);
  const [passwordSet, setPasswordSet] = useState(true);
  const [toast, setToast] = useState({ text: '', sequence: 0 });
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [remaining, setRemaining] = useState(10);
  const [page, setPage] = useState<'editor' | 'home' | 'settings'>('editor');
  const [origin, setOrigin] = useState<'home' | 'settings'>('settings');
  const dialog = useRef<HTMLDialogElement>(null);
  const qrTrigger = useRef<HTMLButtonElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const entry = useRef<HTMLButtonElement>(null);
  const scroll = useRef(0);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const notify = (text: string) => setToast(value => ({ text, sequence: value.sequence + 1 }));
  useEffect(() => { if (!toast.text) return; const id = setTimeout(() => setToast(value => ({ ...value, text: '' })), 4000); return () => clearTimeout(id); }, [toast]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    if (scenario !== 'confirming') return;
    const deadline = Date.now() + 10000;
    const id = setInterval(() => { const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000)); setRemaining(seconds); if (!seconds) { setScenario('ready'); notify('確認期限が過ぎたため取り消しました。'); } }, 200);
    return () => clearInterval(id);
  }, [scenario]);
  useEffect(() => {
    if (page === 'editor') document.getElementById('editor-heading')?.focus({ preventScroll: true });
    else { if (body.current) body.current.scrollTop = scroll.current; entry.current?.focus({ preventScroll: true }); }
  }, [page]);
  const choose = (value: Variant) => { setVariant(value); const url = new URL(window.location.href); url.searchParams.set('variant', value); window.history.replaceState(null, '', url); };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key) || (event.target instanceof HTMLElement && event.target.closest('input,textarea,select,[contenteditable],[role=tablist],dialog'))) return;
      event.preventDefault(); choose(variants[(variants.indexOf(variant) + (event.key === 'ArrowRight' ? 1 : 2)) % 3]);
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [variant]);
  const patch = <K extends keyof typeof draft>(key: K, value: typeof draft[K]) => { setDraft(current => ({ ...current, [key]: value })); };
  const changeToggle = (setter: (value: boolean) => void, value: boolean) => { setter(value); if (scenario === 'confirming') setScenario('ready'); notify('オン・オフを保存しました（見本）。'); };
  const validate = () => {
    const phrases = [draft.startCommand, draft.startConfirm, draft.stopCommand, draft.stopConfirm];
    const normalized = phrases.map(normalize);
    return [
      !/^\d+$/.test(draft.port) || +draft.port < 1 || +draft.port > 65535 ? 'OBSポートは1〜65535の整数にしてください。' : '',
      !passwordSet && !draft.password ? '初回はOBS WebSocketパスワードを入力してください。' : '',
      phrases.some(value => [...value].length > 100 || !normalize(value)) ? '音声フレーズは空白・句読点以外を含む1〜100文字にしてください。' : '',
      new Set(normalized).size < 4 ? '音声フレーズは空白・句読点を除いても異なる4つにしてください。' : '',
      !/^\d+$/.test(draft.androidPort) || +draft.androidPort < 1024 || +draft.androidPort > 65535 ? '専用待受ポートは1024〜65535の整数にしてください。' : '',
      ['3000', '3001', draft.port].includes(draft.androidPort) ? '専用待受ポートが他の待受と競合しています。' : '',
    ].filter(Boolean);
  };
  const apply = () => {
    if (busy || !dirty) return;
    const next = validate(); setErrors(next); if (next.length || busy) return;
    setBusy(true); if (scenario === 'confirming') setScenario('ready');
    timer.current = setTimeout(() => { const value = { ...draft, password: '' }; setSaved(value); setDraft(current => JSON.stringify(current) === JSON.stringify(draft) ? value : current); setPasswordSet(true); setBusy(false); notify('この設定を適用しました（見本）。'); }, 650);
  };
  const warnings = [...errors, ...(scenario === 'disconnected' ? ['OBSに接続できません。OBSの起動、ポート、パスワードを確認してください。'] : []), ...(scenario === 'unknown' ? ['配信開始の結果不明。操作を再送せず、OBSの現在状態を確認してください。'] : [])];
  const status = !enabled ? '連携オフ' : scenario === 'disconnected' ? '接続できません' : '接続済み';
  const openEditor = () => { scroll.current = body.current?.scrollTop ?? 0; setOrigin(page === 'home' ? 'home' : 'settings'); setPage('editor'); };
  const field = (key: keyof typeof draft, label: string, hint?: string) => <label className="obs-field">{label}<input aria-label={label} type={key === 'password' ? 'password' : key === 'port' || key === 'androidPort' ? 'number' : 'text'} value={String(draft[key])} autoComplete={key === 'password' ? 'new-password' : 'off'} placeholder={key === 'password' ? passwordSet ? '変更する場合だけ入力' : 'OBSで設定したパスワード' : undefined} onChange={event => patch(key, event.target.value)} />{hint && <small>{hint}</small>}</label>;
  const connectionFields = <div className="obs-stack"><div className="obs-grid">{field('port', 'OBS WebSocketポート', '1〜65535 / 通常は4455')}{field('password', 'OBS WebSocketパスワード', passwordSet ? '設定済み。空欄なら現在のパスワードを保持。' : '初回は入力が必要です。')}</div><details className="obs-details"><summary>OBS側の準備方法</summary><ol><li>OBSを起動し、配信先を設定します。</li><li>「ツール」→「WebSocketサーバー設定」を開きます。</li><li>サーバーと認証を有効にし、ポート・パスワードを入力します。</li></ol><small>同じPCのOBS 1台に接続します。OBSの起動や配信先の変更は行いません。</small></details></div>;
  const voiceFields = <div className="obs-stack"><div className="obs-between"><div><strong>音声によるOBS操作</strong><small>オン・オフは即時保存</small></div><SlimSwitch keepFocus label="音声によるOBS操作" checked={voice} disabled={!enabled} onChange={value => changeToggle(setVoice, value)} /></div><p className="obs-note">{!enabled ? 'OBS連携をオンにすると、音声操作を有効にできます。' : '音声認識の「配信に使う」もオンにしてください。プレビューだけではOBSを操作しません。'}</p><div className="obs-phrases">{(['start', 'stop'] as const).map(action => <div className="obs-phrase-pair" key={action}><h3>{action === 'start' ? '配信を開始するとき' : '配信を終了するとき'}</h3>{field(action === 'start' ? 'startCommand' : 'stopCommand', '① 指示するフレーズ')}<div className="obs-flow-arrow">↓ 別の発話で、10秒以内に確認</div>{field(action === 'start' ? 'startConfirm' : 'stopConfirm', '② 実行を確認するフレーズ')}</div>)}</div><small>各1〜100文字。空白・句読点を除いて完全一致で判定します。4つのフレーズは重複できません。</small></div>;
  const androidFields = <div className="obs-stack"><div className="obs-between"><div><strong>AndroidからのOBS操作</strong><small>音声操作とは独立して切り替え</small></div><SlimSwitch keepFocus label="AndroidからのOBS操作" checked={android} disabled={!enabled} onChange={value => changeToggle(setAndroid, value)} /></div><p className="obs-note">{!enabled ? 'OBS連携をオンにすると、Android操作を有効にできます。' : 'Androidで対象PCと操作を確認してから実行します。映像送信の開始・停止とは連動しません。'}</p><div className="obs-network"><label><input type="checkbox" checked={draft.lan} onChange={event => patch('lan', event.target.checked)} /><span><strong>LAN公開</strong><small>信頼できる同じネットワーク内</small></span></label><label><input type="checkbox" checked={draft.tailscale} onChange={event => patch('tailscale', event.target.checked)} /><span><strong>Tailscale公開</strong><small>外出先から自分のPCへ接続</small></span></label></div>{field('androidPort', '専用待受ポート', '1024〜65535 / 通常は3002。公開設定は「この設定を適用」で反映。')}<small>LANのHTTP認証は暗号化ではありません。外部利用にはTailscaleを使用し、ポート転送は行いません。</small><div className="obs-registration"><div className="obs-between"><strong>Androidを登録</strong><span className="obs-badge">{registered ? '登録あり' : '未登録'}</span></div><p>Androidクライアントで外配信用QRを読み取ります。</p><label className="obs-check"><input type="checkbox" checked={includeObs} disabled={!android} onChange={event => setIncludeObs(event.target.checked)} />OBS操作登録を含める</label><label className="obs-check"><input type="checkbox" checked={includeOutdoor} onChange={event => setIncludeOutdoor(event.target.checked)} />外配信登録も含める <small>映像送信も使う場合</small></label><button ref={qrTrigger} disabled={!android || !(saved.lan || saved.tailscale) || (!includeObs && !includeOutdoor)} onClick={() => { setRegistered(true); dialog.current?.showModal(); }}>登録QRを表示</button><small>Android操作をオンにし、公開先の設定を適用してから表示できます。</small><div className="obs-actions"><button disabled={!registered} onClick={() => { notify('新しい登録へ再生成しました（見本）。'); }}>登録を再生成</button><button className="obs-danger" disabled={!registered} onClick={() => { setRegistered(false); if (scenario === 'confirming') setScenario('ready'); notify('OBS操作登録だけを無効化しました。'); }}>OBS操作登録を無効化</button></div><small>登録の無効化は映像送信登録へ影響しません。</small></div></div>;
  const live = <section className="obs-live" aria-label="OBSの現在状態"><div className="obs-live-top"><div><small>OBS接続</small><strong data-warning={scenario === 'disconnected'}>{status}</strong></div><div><small>OBS配信</small><strong>{!enabled || scenario === 'disconnected' || scenario === 'unknown' ? '状態不明' : '停止中'}</strong></div><button disabled={!enabled || scenario !== 'disconnected'} onClick={() => { setScenario('ready'); notify('OBSの現在状態を取得しました（見本）。'); }}>接続を再試行</button></div><div className="obs-operation"><div className="obs-operation-text" role="status">{scenario === 'confirming' ? <>配信開始の確認待ち · あと{remaining}秒<br />「{saved.startConfirm}」と話すと実行します。</> : scenario === 'unknown' ? <>直近操作：配信開始・結果不明<br />自動再送しません。OBS本体で現在状態を確認してください。</> : <>確認待ちはありません。<br />配信の開始・終了は音声またはAndroidから操作します。</>}</div><button disabled={scenario !== 'confirming'} onClick={() => { setScenario('ready'); notify('確認を取り消しました。'); }}>確認を取り消す</button></div></section>;
  const applyBar = <div className="obs-apply"><div><strong>{busy ? '設定を適用しています' : dirty ? '未適用の変更があります' : 'すべて適用済み'}</strong><small>接続・フレーズ・公開設定をまとめて適用</small></div><button className="obs-primary" aria-disabled={busy || !dirty} onClick={apply}>{busy ? '適用中…' : 'この設定を適用'}</button><div className="obs-validation" aria-live="polite">{errors.length ? `${errors.length}件の入力を確認してください。「要確認」から詳細を読めます。` : 'オン・オフの切り替えは、適用ボタンに関係なく即時保存されます。'}</div></div>;
  const titles = ['OBSに接続', '音声で操作', 'Androidで操作'];
  const contents = [connectionFields, voiceFields, androidFields];
  const variantA = <div className="obs-stack"><Section number="01" title="OBSとの接続" description="このPCで起動しているOBSへ接続">{connectionFields}</Section><Section number="02" title="音声から操作する" description="指示 → 確認の2つの発話で実行">{voiceFields}</Section><Section number="03" title="Androidから操作する" description="公開先を選び、QRで1台の端末を登録">{androidFields}</Section></div>;
  const variantB = <div className="obs-tab-layout"><div className="obs-tabs" role="tablist" aria-label="OBS設定の種類">{titles.map((title, index) => <button key={title} id={`obs-tab-${index}`} role="tab" aria-selected={tab === index} aria-controls={`obs-pane-${index}`} tabIndex={tab === index ? 0 : -1} onClick={() => setTab(index)} onKeyDown={event => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + (event.key === 'ArrowRight' ? 1 : 2)) % 3; setTab(next); document.getElementById(`obs-tab-${next}`)?.focus(); }}><span className="obs-tab-number">0{index + 1}</span>{title}</button>)}</div>{contents.map((content, index) => <section className="obs-tab-pane" key={index} id={`obs-pane-${index}`} role="tabpanel" aria-labelledby={`obs-tab-${index}`} hidden={tab !== index}>{content}</section>)}</div>;
  const variantC = <div className="obs-steps">{titles.map((title, index) => <section key={title} className="obs-step"><button className="obs-step-heading" aria-expanded={step === index} aria-controls={`obs-step-${index}`} onClick={() => setStep(step === index ? -1 : index)}><span className="obs-step-number">{index + 1}</span><span><strong>{title}</strong><small>{['OBSの準備と接続情報', '使う場合だけ有効化・フレーズを編集', '使う場合だけ公開先を選択・端末を登録'][index]}</small></span><span className="obs-expand">{step === index ? '−' : '＋'}</span></button><div className="obs-step-content" id={`obs-step-${index}`} hidden={step !== index}>{contents[index]}{index < 2 && <button className="obs-next" onClick={() => setStep(index + 1)}>次へ：{titles[index + 1]} →</button>}</div></section>)}</div>;
  return <div className="obs-prototype"><main className="dashboard management-shell">
    <header className="management-header"><div className="management-brand" aria-label="きゃすメイト"><span aria-hidden="true">▤</span><strong>きゃすメイト</strong></div><span className="management-connection connection-ok" aria-label="バックエンド接続済み（見本）"><span className="connection-label">バックエンド接続済み</span><span className="connection-symbol">✓</span></span><div className="toast-region" aria-live="polite" aria-atomic="true">{toast.text && <div className="banner"><span className="toast-check">✓</span><span className="toast-message" title={toast.text}>{toast.text}</span></div>}</div></header>
    <nav className="management-nav" aria-label="メインナビゲーション"><button aria-current={page === 'home' ? 'page' : undefined} onClick={() => { scroll.current = 0; setPage('home'); }}>ホーム</button><button aria-current={page !== 'home' ? 'page' : undefined} onClick={() => { scroll.current = 0; setPage('settings'); }}>設定</button><ManagementWarnings items={warnings.map((message, index) => ({ key: `obs-warning-${index}`, message }))} /></nav>
    <div className="management-body" ref={body}>{page === 'editor' ? <><ManagementEditorHeading title="OBS操作" backPage={origin === 'home' ? 'ホーム' : '設定'} onBack={() => setPage(origin)} introduction={{ heading: '音声やAndroidから、OBS配信を開始・終了', body: 'このPCのOBSに接続し、実行前の確認を挟んで操作します。音声とAndroidは個別にオン・オフできます。' }} /><div className="obs-master"><div><strong>OBS連携</strong><small>オンにするとOBSへ接続します</small></div><SlimSwitch keepFocus label="OBS連携" checked={enabled} onChange={value => changeToggle(setEnabled, value)} /></div>{live}<div className="obs-editor">{variant === 'A' ? variantA : variant === 'B' ? variantB : variantC}</div>{applyBar}</> : <><h1>{page === 'home' ? '配信のホーム' : '設定'}</h1><button className="obs-entry" ref={entry} onClick={openEditor}><strong>OBS操作</strong><small>音声やAndroidから配信を開始・終了</small><span>設定を開く →</span></button><p className="obs-note">見本ではOBS操作の編集画面を確認できます。入力途中の値は戻っても保持します。</p>{live}</>}
    <aside className="obs-lab"><strong>{variant} · {names[variant]}</strong><p>{descriptions[variant]}</p><small>比較用の見本です。実際のOBSや保存設定には接続しません。</small><details><summary>状態の見本・内部状態を確認</summary><div className="obs-lab-controls"><label>状態<select value={scenario} onChange={event => { const value = event.target.value as Scenario; setScenario(value); if (value !== 'ready') { setEnabled(true); if (value === 'confirming') { setVoice(true); setRemaining(10); } } }}><option value="ready">通常</option><option value="disconnected">接続失敗</option><option value="confirming">音声の確認待ち</option><option value="unknown">操作結果不明</option></select></label><button onClick={() => { setPasswordSet(false); setDraft(value => ({ ...value, password: '' })); }}>初回パスワード入力の見本</button><button onClick={() => notify('設定を適用しました。これは長い通知の表示と操作位置を確認するための見本です。')}>長い通知を表示</button></div><pre>{JSON.stringify({ variant, draft: { ...draft, password: draft.password ? '(入力あり・非表示)' : '' }, saved: { ...saved, password: '(非表示)' }, enabled, voice, android, registered, scenario, errors, dirty, busy }, null, 2)}</pre></details></aside></div>
    <dialog ref={dialog} className="obs-qr-dialog" aria-labelledby="obs-qr-title" onClose={() => qrTrigger.current?.focus()}><h2 id="obs-qr-title">Android登録QR</h2><div className="obs-qr-placeholder" aria-label="読み取りできない見本用QR領域"><span>QR表示領域</span><small>見本のため読み取れません</small></div><p>含める登録：{includeObs ? 'OBS操作' : ''}{includeObs && includeOutdoor ? '・' : ''}{includeOutdoor ? '外配信' : ''}</p><small>OBSパスワードはAndroidへ渡しません。</small><button autoFocus onClick={() => dialog.current?.close()}>QRを隠す</button></dialog>
  </main>{import.meta.env.DEV && <aside className="obs-switcher" aria-label="見本の切替"><span>UI見本</span><button aria-label="前の案" onClick={() => choose(variants[(variants.indexOf(variant) + 2) % 3])}>←</button>{variants.map(value => <button key={value} aria-pressed={variant === value} onClick={() => choose(value)}>{value}<span> {names[value]}</span></button>)}<button aria-label="次の案" onClick={() => choose(variants[(variants.indexOf(variant) + 1) % 3])}>→</button></aside>}</div>;
}
