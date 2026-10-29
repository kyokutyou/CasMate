// Throwaway UI study: three structurally different editors, switched by ?variant=A|B|C.
// Settings and runtime are fictional and in memory only. No application API is imported.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ManagementEditorHeading } from '../shared/ManagementEditorHeading';
import { ManagementWarnings } from '../../src/renderer/components/ManagementWarnings';
import { SlimSwitch } from '../../src/renderer/components/SlimSwitch';

type Kind = 'lan' | 'tailscale';
type Variant = 'A' | 'B' | 'C';
type Scenario = 'ready' | 'noLan' | 'notInstalled' | 'serviceStopped' | 'loginRequired' | 'ipUnavailable' | 'listenFailed' | 'audioUnavailable' | 'playing';
const variants: Variant[] = ['A', 'B', 'C'];
const names = { A: '接続方法を並べる', B: '目的に集中する', C: '手順に沿って進める' };
const descriptions = { A: 'LANとTailscaleを並べて比較。ふだんの切替と状態確認を一画面に。', B: '公開設定・スマホ接続・音質と状態をタブで分離。小さい画面でも一つの目的に集中。', C: '公開する → スマホで開く → 音声を聞く。初回の設定を順番に案内。' };
const scenarioNames: Record<Scenario, string> = { ready: '公開できる環境', noLan: 'LANのIPv4なし', notInstalled: 'Tailscale未導入', serviceStopped: 'Tailscaleサービス停止', loginRequired: 'Tailscaleログイン待ち', ipUnavailable: 'Tailscale IPv4取得失敗', listenFailed: 'Tailscale待受失敗', audioUnavailable: '音声変換エラー', playing: 'スマホで音声再生中' };
const tailErrors: Partial<Record<Scenario, string>> = { notInstalled: 'Tailscaleが未導入です。公式Windows版を導入してください。', serviceStopped: 'Tailscaleサービスが停止しています。公式クライアントを起動してください。', loginRequired: '公式クライアントでログインし、PCとAndroidを同じtailnetへ接続してください。', ipUnavailable: 'Tailscale IPv4を確認できません。接続状態と公式クライアントの更新を確認してください。', listenFailed: '待受に失敗しました。WindowsファイアウォールとTailscaleの受信接続許可を確認してください。' };
const demoUrls = { lan: ['http://192.168.1.24:3939/comments', 'http://10.0.0.24:3939/comments'], tailscale: ['http://100.100.10.24:3939/comments'] };
const kindNames = { lan: 'LAN', tailscale: 'Tailscale' };
function Box({ title, children, className = '' }: { title: string; children: ReactNode; className?: string }) {
  return <section className={`ms-box ${className}`}><h2>{title}</h2>{children}</section>;
}
function TailscaleHelp() {
  return <div className="ms-help"><p>PCとAndroidの両方にTailscaleを導入し、同じtailnetへ接続します。</p><div className="ms-links"><a href="https://tailscale.com/docs/install/windows" target="_blank" rel="noreferrer">Windows版の導入 ↗</a><a href="https://tailscale.com/docs/install/android" target="_blank" rel="noreferrer">Android版の導入 ↗</a></div><small>きゃすメイトから導入・ログインは行いません。Personalプランは非商用用途向けです。利用形態に合う<a href="https://tailscale.com/pricing" target="_blank" rel="noreferrer">料金と利用条件</a>を確認してください。</small></div>;
}

export function Prototype() {
  const initial = new URLSearchParams(window.location.search).get('variant') as Variant;
  const [variant, setVariant] = useState<Variant>(variants.includes(initial) ? initial : 'A');
  // Both routes default off, as required by the feature contract.
  const [enabled, setEnabled] = useState({ lan: false, tailscale: false });
  const [bitrate, setBitrate] = useState('32');
  const [savedBitrate, setSavedBitrate] = useState(32);
  const [scenario, setScenario] = useState<Scenario>('ready');
  const [multiple, setMultiple] = useState(false);
  const [tab, setTab] = useState(0);
  const [connectionKind, setConnectionKind] = useState<Kind>('lan');
  const [guide, setGuide] = useState({ lan: false, tailscale: false });
  const [step, setStep] = useState(1);
  const [page, setPage] = useState<'editor' | 'settings' | 'home'>('editor');
  const [origin, setOrigin] = useState<'settings' | 'home'>('settings');
  const [notice, setNotice] = useState<{ message: string; sequence: number }>();
  const bodyRef = useRef<HTMLDivElement>(null);
  const entryRef = useRef<HTMLButtonElement>(null);
  const entryScroll = useRef(0);
  const notify = (message: string) => setNotice(current => ({ message, sequence: (current?.sequence ?? 0) + 1 }));
  // Same header toast presentation and lifetime as the shared management UI.
  useEffect(() => { if (!notice) return; const id = setTimeout(() => setNotice(undefined), 4000); return () => clearTimeout(id); }, [notice]);
  const choose = (value: Variant) => {
    setVariant(value); const url = new URL(window.location.href); url.searchParams.set('variant', value); window.history.replaceState(null, '', url);
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey ||
        (event.target instanceof HTMLElement && event.target.closest('input,textarea,select,[contenteditable],[role=tablist],dialog'))) return;
      event.preventDefault(); choose(variants[(variants.indexOf(variant) + (event.key === 'ArrowRight' ? 1 : 2)) % 3]);
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [variant]);
  const valid = /^\d+$/.test(bitrate) && Number(bitrate) >= 16 && Number(bitrate) <= 128;
  const errors = { lan: enabled.lan && scenario === 'noLan' ? '対象となるLAN用IPv4がありません。PCを同一ネットワークへ接続してください。' : '', tailscale: enabled.tailscale ? tailErrors[scenario] ?? '' : '' };
  const available = (kind: Kind) => enabled[kind] && !errors[kind];
  const active = scenario === 'playing' && (available('lan') || available('tailscale'));
  const audioError = scenario === 'audioUnavailable' && (enabled.lan || enabled.tailscale) ? '音声変換を利用できません。コメント一覧とPC読み上げは継続します。' : '';
  const warningItems = [...Object.entries(errors).filter(([, message]) => message).map(([key, message]) => ({ key, message })),
    ...(!valid ? [{ key: 'bitrate', message: '音質：16〜128の整数を入力してください。範囲外の値は保存しません。' }] : []),
    ...(audioError ? [{ key: 'audio', message: audioError }] : [])];
  const toggle = (kind: Kind, value: boolean) => { setEnabled(current => ({ ...current, [kind]: value })); notify('公開設定を変更しました（見本）。'); };
  const routeStatus = (kind: Kind) => !enabled[kind] ? '公開していません' : errors[kind] ? '要確認' : '公開中';
  const guideBody = (kind: Kind) => <div className="ms-guide">
    {available(kind) ? <>{(kind === 'lan' && !multiple ? demoUrls.lan.slice(0, 1) : demoUrls[kind]).map((url, index) => <div className="ms-url" key={url}>
      <div><span className="ms-caption">{kindNames[kind]}用URL{multiple && kind === 'lan' ? ` ${index + 1}` : ''} · 架空の接続先</span><code>{url}</code><button onClick={() => notify('URLのコピー操作を確認しました（見本）。')}>URLをコピー</button></div>
      <figure><img width="132" height="132" src={`/${kind}-${index}.svg`} alt={`${kindNames[kind]}用URL ${url} のQRコード（架空の接続先）`} /><figcaption>見本のQRコード</figcaption></figure>
    </div>)}<p>スマホでURLまたはQRコードを開き、<strong>「音声を開始」</strong>を押してください。開始後の新着コメントから読み上げます。</p></> : <div className="ms-empty"><strong>{enabled[kind] ? `${kindNames[kind]}の接続準備が必要です` : `${kindNames[kind]}公開をオンにしてください`}</strong><p>{errors[kind] || '公開が利用できると、ここにURLとQRコードを表示します。'}</p></div>}
    {kind === 'tailscale' && <TailscaleHelp />}
    <details className="ms-help-details"><summary>スマホで聞くときの補足</summary><div className="ms-help"><p>音声を利用できるスマホは、LAN・Tailscaleを合わせて同時に1台です。別の端末が利用中なら、その端末が停止するまで待機します。</p><p>画面ロック中や他アプリの表示中も聞く場合はAndroidクライアントを使います。通常ブラウザでは画面を表示したまま利用してください。</p><p>PC側でコメント読み上げをオンにし、有効な話者とスタイルを選んでおきます。</p></div></details>
  </div>;
  const routeControl = (kind: Kind, compact = false) => <div className={`ms-route ${compact ? 'ms-route-compact' : ''}`}>
    <div className="ms-between"><div className="ms-route-heading"><span className="ms-icon" aria-hidden="true">{kind === 'lan' ? '⌂' : '⇄'}</span><div><h3>{kind === 'lan' ? '同じネットワークで' : '外出先・モバイル回線で'}</h3><small>{kindNames[kind]}公開</small></div></div><SlimSwitch label={`${kindNames[kind]}公開`} checked={enabled[kind]} onChange={value => toggle(kind, value)} keepFocus /></div>
    <div className="ms-route-state" aria-live="polite"><span className="ms-dot" data-on={Boolean(available(kind))} /><span>{routeStatus(kind)}</span>{errors[kind] && <span className="ms-warning-tag">詳細は「要確認」へ</span>}</div>
    {!compact && <><p className="ms-route-description">{kind === 'lan' ? 'PCとスマホを同じWi-Fiなどのネットワークへ接続します。' : 'PCとAndroidのTailscaleを接続して使います。'}</p><button className="ms-guide-button" aria-expanded={guide[kind]} onClick={() => setGuide(current => ({ ...current, [kind]: !current[kind] }))}>接続案内・URL・QR <span aria-hidden="true">{guide[kind] ? '−' : '＋'}</span></button>{guide[kind] && guideBody(kind)}</>}
  </div>;
  const privacy = <p className="ms-note">LAN公開は信頼できるネットワークで利用してください。きゃすメイト側の認証・TLSはありません。公開するのはコメント一覧と音声だけです。</p>;
  const quality = <div className="ms-quality"><div><label className="ms-field" htmlFor="bitrate">AAC目標ビットレート</label><div className="ms-unit"><input id="bitrate" type="number" min="16" max="128" step="1" value={bitrate} aria-invalid={!valid} aria-describedby="bitrate-hint" onChange={event => setBitrate(event.target.value)} onBlur={() => { if (valid && Number(bitrate) !== savedBitrate) { setSavedBitrate(Number(bitrate)); notify('音質の変更を反映しました（見本）。'); } }} /><span>kbps</span></div><small id="bitrate-hint" className="ms-input-hint">{valid ? '16〜128の整数。既定値は32 kbpsです。' : '16〜128の整数を入力してください。未保存です。'}</small></div><div className="ms-quality-explain"><strong>通信量に合わせて調整</strong><p>数値を下げると通信量を抑えられます。声・話速・音量はPCのコメント読み上げ設定と共通です。</p><small>AAC-LC / M4A / モノラル</small></div></div>;
  const playback = <div className="ms-playback"><div className="ms-playback-main"><span className="ms-icon" aria-hidden="true">♫</span><div><span className="ms-caption">スマホの音声</span><strong>{audioError ? '音声を利用できません' : active ? '音声再生中 · 1台' : enabled.lan || enabled.tailscale ? 'スマホの開始待ち' : '公開設定を待っています'}</strong></div></div><dl><div><dt>待ち</dt><dd>{active ? 2 : 0}<span>件</span></dd></div><div><dt>破棄累計</dt><dd>{active ? 1 : 0}<span>件</span></dd></div></dl><p>PCとの再生時刻は同期しません。古い音声は切断後にまとめて再生しません。</p></div>;
  const tabs = ['公開設定', 'スマホ接続', '音質と状態'];
  const connectionChooser = <div className="ms-connection-chooser"><div className="ms-segment" aria-label="接続案内の表示先">{(['lan', 'tailscale'] as Kind[]).map(kind => <button key={kind} aria-pressed={connectionKind === kind} onClick={() => setConnectionKind(kind)}>{kindNames[kind]} <small>{routeStatus(kind)}</small></button>)}</div><small>ここでは表示する接続案内だけを切り替えます。公開設定は変わりません。</small></div>;
  const navigate = (next: 'settings' | 'home') => { setPage(next); setOrigin(next); bodyRef.current?.scrollTo?.(0, 0); };
  const advanceStep = (next: number) => { setStep(next); requestAnimationFrame(() => document.getElementById(`step-heading-${next}`)?.focus()); };
  const back = () => { setPage(origin); requestAnimationFrame(() => { if (bodyRef.current) bodyRef.current.scrollTop = entryScroll.current; entryRef.current?.focus({ preventScroll: true }); }); };
  return <div className="ms-prototype"><main className="dashboard management-shell">
    <header className="management-header"><div className="management-brand" aria-label="きゃすメイト"><span aria-hidden="true">▤</span><strong>きゃすメイト</strong></div><span className="management-connection connection-ok" aria-label="バックエンド接続済み（見本）"><span className="connection-label">バックエンド接続済み</span><span className="connection-symbol">✓</span></span><div className="toast-region" role="region" aria-label="通知" aria-live="polite" aria-atomic="true">{notice && <div className="banner"><span className="toast-check" aria-hidden="true">✓</span><span className="toast-message" title={notice.message}>{notice.message}</span></div>}</div></header>
    <nav className="management-nav" aria-label="メインナビゲーション"><button aria-current={page === 'home' ? 'page' : undefined} onClick={() => navigate('home')}>ホーム</button><button aria-current={page !== 'home' ? 'page' : undefined} onClick={() => navigate('settings')}>設定</button><ManagementWarnings items={warningItems} /></nav>
    <div className="management-body" ref={bodyRef}>{page === 'editor' ? <>
      <ManagementEditorHeading title="スマホ音声再生" backPage={origin === 'home' ? 'ホーム' : '設定'} onBack={back} introduction={{ heading: 'PCのコメント読み上げを、スマホでも', body: 'LANまたはTailscaleでコメント一覧と音声を公開します。スマホ側で音声を開始すると、新着コメントを聞けます。' }} />
      {variant === 'A' && <div className="ms-stack"><section><div className="ms-section-heading"><h2>スマホへの公開方法</h2><small>両方を同時にオンにできます</small></div><div className="ms-route-grid">{routeControl('lan')}{routeControl('tailscale')}</div>{privacy}</section><Box title="音質と通信量">{quality}</Box>{playback}</div>}
      {variant === 'B' && <div className="ms-stack"><div className="ms-tabs" role="tablist" aria-label="スマホ音声再生の設定">{tabs.map((name, index) => <button key={name} role="tab" id={`ms-tab-${index}`} aria-controls="ms-tabpanel" aria-selected={tab === index} tabIndex={tab === index ? 0 : -1} onClick={() => setTab(index)} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + (event.key === 'ArrowRight' ? 1 : 2)) % 3; setTab(next); document.getElementById(`ms-tab-${next}`)?.focus(); } }}>{name}</button>)}</div><div id="ms-tabpanel" role="tabpanel" aria-labelledby={`ms-tab-${tab}`} className="ms-stack">
        {tab === 0 && <Box title="使う経路だけ公開する"><p className="ms-lead">LANとTailscaleは独立した設定です。両方を同時に使えます。</p><div className="ms-route-list">{routeControl('lan', true)}{routeControl('tailscale', true)}</div>{privacy}<details className="ms-help-details"><summary>Tailscaleの準備方法</summary><TailscaleHelp /></details><div className="ms-next"><span>公開したら、スマホで接続します。</span><button onClick={() => setTab(1)}>スマホ接続へ →</button></div></Box>}
        {tab === 1 && <Box title="スマホで開く">{connectionChooser}{guideBody(connectionKind)}</Box>}
        {tab === 2 && <><Box title="音質と通信量">{quality}</Box>{playback}<p className="ms-note">スマホで音声を開始する前に、PCのコメント読み上げをオンにし、有効な話者とスタイルを選んでください。</p></>}
      </div></div>}
      {variant === 'C' && <div className="ms-stack"><div className="ms-stepper">{[{ title: '公開方法を選ぶ', subtitle: 'LAN・Tailscaleを必要に応じてオンに' }, { title: 'スマホで開く', subtitle: '接続案内とURL・QRを確認' }, { title: '音声を聞く', subtitle: 'スマホで開始し、音質と状態を確認' }].map((item, index) => <section key={item.title} className="ms-step" data-open={step === index + 1}><button className="ms-step-heading" id={`step-heading-${index + 1}`} aria-expanded={step === index + 1} aria-controls={`step-${index + 1}`} onClick={() => setStep(step === index + 1 ? 0 : index + 1)}><span className="ms-number">0{index + 1}</span><span><strong>{item.title}</strong><small>{item.subtitle}</small></span><span className="ms-expand">{step === index + 1 ? '−' : '＋'}</span></button><div id={`step-${index + 1}`} hidden={step !== index + 1} className="ms-step-body ms-stack">
        {index === 0 && <><div className="ms-route-list">{routeControl('lan', true)}{routeControl('tailscale', true)}</div>{privacy}<button className="ms-primary" onClick={() => advanceStep(2)}>接続案内を見る →</button></>}
        {index === 1 && <>{connectionChooser}{guideBody(connectionKind)}<button className="ms-primary" onClick={() => advanceStep(3)}>音声の開始方法を見る →</button></>}
        {index === 2 && <><div className="ms-instruction"><span aria-hidden="true">▷</span><div><strong>スマホ側で「音声を開始」を押します</strong><p>PCのコメント読み上げをオンにし、有効な話者とスタイルを選んでください。音声再生は同時に1台までです。</p></div></div>{playback}<Box title="音質と通信量">{quality}</Box></>}
      </div></section>)}</div></div>}
    </> : <><h1>{page === 'home' ? '配信のホーム（見本）' : '設定（見本）'}</h1><button ref={entryRef} className="management-entry" onClick={() => { entryScroll.current = bodyRef.current?.scrollTop ?? 0; setPage('editor'); requestAnimationFrame(() => document.getElementById('editor-heading')?.focus()); }}><span className="entry-icon">♫</span><span><strong>スマホ音声再生</strong><small>公開設定・音質・接続案内</small></span><span>›</span></button></>}
    <aside className="ms-lab"><div><span className="ms-lab-label">比較用の操作</span><strong>{variant} · {names[variant]}</strong><p>{descriptions[variant]}</p><small>設定・状態・URLは見本です。保存・接続・音声再生・クリップボードへのコピーは行いません。</small></div><div className="ms-lab-controls"><label>環境・状態の見本<select value={scenario} onChange={event => setScenario(event.target.value as Scenario)}>{Object.entries(scenarioNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="ms-check"><input type="checkbox" checked={multiple} onChange={event => setMultiple(event.target.checked)} />LANのURLを2つ表示</label><button onClick={() => notify('設定を変更しました（見本）。')}>成功通知</button><button onClick={() => notify('長い成功通知の見本です。入力位置を変えずに表示し、全文はポインターを合わせて確認できます。')}>長文通知</button></div><details><summary>見本の内部状態</summary><pre data-testid="payload">{JSON.stringify({ variant, page, enabled, bitrate, savedBitrate, scenario, available: { lan: Boolean(available('lan')), tailscale: Boolean(available('tailscale')) }, active, tab, step, guide, connectionKind, multiple, warnings: warningItems }, null, 2)}</pre></details></aside>
    </div></main>{import.meta.env.DEV && <aside className="ms-switcher" aria-label="見本の切替"><span>UI見本</span><button aria-label="前の案" onClick={() => choose(variants[(variants.indexOf(variant) + 2) % 3])}>←</button>{variants.map(key => <button key={key} aria-pressed={variant === key} onClick={() => choose(key)} title={names[key]}>{key}<span> {names[key]}</span></button>)}<button aria-label="次の案" onClick={() => choose(variants[(variants.indexOf(variant) + 1) % 3])}>→</button></aside>}
  </div>;
}
