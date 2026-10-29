// Throwaway: three settings layouts using the real editor heading, switch and warnings.
// Fictional content; every action remains in memory. Never imports the application API.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ManagementEditorHeading } from '../shared/ManagementEditorHeading';
import { SlimSwitch } from '../../src/renderer/components/SlimSwitch';
import { ManagementWarnings } from '../../src/renderer/components/ManagementWarnings';

const variants = ['A', 'B', 'C'] as const;
type Variant = typeof variants[number];
const names = { A: '一覧で整える', B: '目的で切り替える', C: '流れに沿って整える' };
const descriptions = { A: '設定と作成予定を、上からひと続きに。', B: '作成条件・投稿内容・確認と実行を分けて集中。', C: '作成 → 案内 → 切替の順に、必要な箇所を開く。' };
type Status = 'waiting' | 'creating' | 'created' | 'uncertain' | 'failed' | 'inputRequired';
const labels: Record<Status, string> = { waiting: '作成待ち', creating: '作成中', created: '作成済み', uncertain: '結果不明', failed: '作成失敗', inputRequired: '入力が必要' };
const defaultSettings = { enabled: false, createAt: '950', switchAt: '1000', titleMode: 'auto', bodyMode: 'auto', title: '', body: '', announce: false, template: '次スレッドはこちらです。\n{url}', author: '', email: '' };
const demoBody = '配信の感想や連絡はこちらへどうぞ。\n初めての方も、お気軽にコメントしてください。\n\n前スレッド：\nhttps://jbbs.shitaraba.net/radio/12345/1000000000/';
const demoUrl = 'https://jbbs.shitaraba.net/bbs/read.cgi/radio/12345/1000000001/';
function Box({ title, children, className = '' }: { title: string; children: ReactNode; className?: string }) {
  return <section className={`nt-box ${className}`}><h2>{title}</h2>{children}</section>;
}
export function Prototype() {
  const initial = new URLSearchParams(window.location.search).get('variant');
  const [variant, setVariant] = useState<Variant>(variants.includes(initial as Variant) ? initial as Variant : 'A');
  const [settings, setSettings] = useState(defaultSettings);
  const [status, setStatus] = useState<Status>('waiting');
  const [tab, setTab] = useState(0);
  const [page, setPage] = useState<'editor' | 'home' | 'settings'>('editor');
  const [origin, setOrigin] = useState<'home' | 'settings'>('settings');
  const [toast, setToast] = useState('');
  const [toastSequence, setToastSequence] = useState(0);
  const [resolved, setResolved] = useState('');
  const [resolutionError, setResolutionError] = useState('');
  const [nextUrl, setNextUrl] = useState('');
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const notify = (message: string) => { setToast(message); setToastSequence(n => n + 1); };
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(''), 4000); return () => clearTimeout(id); }, [toast, toastSequence]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const choose = (value: Variant) => { setVariant(value); const url = new URL(window.location.href); url.searchParams.set('variant', value); window.history.replaceState(null, '', url); };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!(event.key === 'ArrowLeft' || event.key === 'ArrowRight') || (event.target instanceof HTMLElement && event.target.closest('input,textarea,select,[contenteditable], [role=tablist]'))) return;
      event.preventDefault(); choose(variants[(variants.indexOf(variant) + (event.key === 'ArrowRight' ? 1 : 2)) % 3]);
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [variant]);
  const patch = (key: keyof typeof settings, value: string | boolean) => setSettings(current => ({ ...current, [key]: value }));
  const title = settings.titleMode === 'auto' ? 'きゃすメイト配信 Part 043' : settings.title;
  const content = settings.bodyMode === 'auto' ? demoBody : settings.body;
  const numberValid = (value: string) => /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 10000;
  const errors = [!numberValid(settings.createAt) || !numberValid(settings.switchAt) ? 'レス番号は1〜10000の整数を入力してください。' : '',
    !title.trim() || !content.trim() ? 'タイトルと本文を入力してください。' : '',
    settings.announce && settings.template.split('{url}').length !== 2 ? '案内文には {url} を1つ含めてください。' : '',
    settings.author.includes('#') ? '投稿者名に # は使用できません。' : ''].filter(Boolean);
  const stateMessage = status === 'uncertain' ? '作成できたか確認できません。再送せず、掲示板を確認してください。' : status === 'failed' ? '作成に失敗しました。コメント取得は継続します。内容を確認して手動で再実行できます。' : status === 'inputRequired' ? '内容を用意できません。タイトル・本文を手動入力して、今すぐ作成を選んでください。' : '';
  const canCreate = !errors.length && !['creating', 'created', 'uncertain'].includes(status) &&
    (status !== 'inputRequired' || (settings.titleMode === 'manual' && settings.bodyMode === 'manual'));
  const create = () => {
    if (!canCreate) return;
    setStatus('creating');
    timer.current = setTimeout(() => { setStatus('created'); setNextUrl(demoUrl); notify('次スレッドを作成しました（見本）。'); }, 1000);
  };
  const number = (key: 'createAt' | 'switchAt', label: string) => <label className="nt-field">{label}<div className="nt-unit"><input aria-label={label} type="number" min={1} max={10000} value={settings[key]} aria-invalid={!numberValid(settings[key])} onChange={e => patch(key, e.target.value)} /><span>番</span></div><small className="nt-hint">{numberValid(settings[key]) ? '1〜10000の整数' : '1〜10000の整数を入力してください。'}</small></label>;
  const automatic = <div className="nt-between nt-auto"><div><strong>次スレッド自動作成</strong><small>指定したレス番号に到達すると、一度だけ作成</small></div><SlimSwitch label="次スレッド自動作成" checked={settings.enabled} onChange={value => patch('enabled', value)} /></div>;
  const mode = (key: 'titleMode' | 'bodyMode', label: string, automaticLabel: string) => <div className="nt-mode"><span>{label}</span><div className="nt-segment" aria-label={label}>{['auto', 'manual'].map(value => <button key={value} aria-pressed={settings[key] === value} onClick={() => patch(key, value)}>{value === 'auto' ? automaticLabel : '手動で入力'}</button>)}</div></div>;
  const titleField = <div className="nt-stack">{mode('titleMode', 'タイトルの用意', '末尾の番号を +1')}{settings.titleMode === 'manual' ? <label className="nt-field">手動タイトル<input value={settings.title} onChange={e => patch('title', e.target.value)} /></label> : <small>現行スレッドの最後の数字列を1つ増やします。</small>}</div>;
  const bodyField = <div className="nt-stack">{mode('bodyMode', '本文の用意', '1レス目を引き継ぐ')}{settings.bodyMode === 'manual' ? <label className="nt-field">手動本文<textarea rows={5} value={settings.body} onChange={e => patch('body', e.target.value)} /></label> : <small>現行スレッドの1レス目を、本文として使います。</small>}</div>;
  const identity = <details className="nt-details"><summary>投稿者名・E-mail <small>任意・作成と案内に共通</small></summary><div className="nt-grid"><label className="nt-field">投稿者名<input value={settings.author} onChange={e => patch('author', e.target.value)} /><small className="nt-hint">{settings.author.includes('#') ? '# は使用できません。' : '空欄なら掲示板の既定名を使います。'}</small></label><label className="nt-field">E-mail<input value={settings.email} onChange={e => patch('email', e.target.value)} /><small className="nt-hint">空欄可。「sage」なども入力できます。</small></label></div></details>;
  const announce = <div className="nt-stack"><div className="nt-between"><div><strong>現行スレッドへ次URLを案内</strong><small>作成成功から5秒後に、一度だけ投稿</small></div><SlimSwitch label="現行スレッドへ次URLを案内" checked={settings.announce} onChange={value => patch('announce', value)} /></div>{settings.announce && <label className="nt-field">案内文テンプレート<textarea rows={3} value={settings.template} onChange={e => patch('template', e.target.value)} /><small className="nt-hint">{'{url} をちょうど1回含めます。次スレッドURLに置き換わります。'}</small></label>}</div>;
  const live = <div className="nt-live"><div><small>現行スレッド</small><strong>きゃすメイト配信 Part 042</strong></div><div><small>最大レス番号</small><strong>928<span>番</span></strong></div><div><small>作成開始まで</small><strong>{numberValid(settings.createAt) ? Math.max(0, Number(settings.createAt) - 928) : '—'}<span>レス</span></strong></div><span className="nt-status" data-warning={Boolean(stateMessage)}>{labels[status]}</span></div>;
  const preview = <div className="nt-preview"><small>作成予定タイトル</small><strong>{title || 'タイトルを入力してください'}</strong><small>作成予定本文</small><pre>{content || '本文を入力してください'}</pre></div>;
  const execution = <div className="nt-execution"><div className="nt-between"><div><strong>内容を確認して作成</strong><small>自動作成がオフでも実行できます。</small></div><button className="nt-primary nt-create" disabled={!canCreate} onClick={create}>{status === 'creating' ? '作成中…' : '今すぐ作成'}</button></div><div className="nt-fixed-status" role="status">{errors[0] || stateMessage || (status === 'created' ? '作成済みです。指定した切替レス番号への到達後に接続先を切り替えます。' : status === 'creating' ? '同名タイトルを確認して作成しています。' : '作成前に掲示板の同名タイトルを確認し、重複作成を防ぎます。')}</div><div className="nt-url"><input aria-label="次スレッドURL" readOnly value={nextUrl} placeholder="作成後に次スレッドURLを表示" /><div className="nt-actions"><button disabled={!nextUrl} onClick={() => notify('URLコピーを確認しました（見本）。')}>URLをコピー</button><button disabled={!nextUrl} onClick={() => notify('ブラウザで開く操作の見本です。')}>ブラウザで開く ↗</button></div></div><button className="nt-recovery-link" onClick={() => setRecoveryOpen(value => !value)} aria-expanded={recoveryOpen}>結果不明時の確認・復旧 {recoveryOpen ? '−' : '＋'}</button>{recoveryOpen && <div className="nt-recovery"><p>掲示板で作成結果を確認し、作成済みならURLを登録してください。未作成を確認した場合も、自動では再送しません。</p><button onClick={() => notify('現行掲示板を開く操作の見本です。')}>現行掲示板を開く ↗</button><label className="nt-field">作成済み次スレッドURL<input value={resolved} onChange={e => setResolved(e.target.value)} /></label><small className="nt-hint">{resolutionError || '同じ掲示板の、現行スレッド以外のURLを指定します。'}</small><div className="nt-actions"><button disabled={status !== 'uncertain'} onClick={() => {
      if (!/^https:\/\/jbbs\.shitaraba\.net\/bbs\/read\.cgi\/radio\/12345\/(?!1000000000(?:\/|$))\d+\/$/.test(resolved)) { setResolutionError('同じ掲示板の次スレッドURLを入力してください。'); return; }
      setNextUrl(resolved); setResolutionError(''); setStatus('created'); notify('作成済みURLを登録しました（見本）。');
    }}>作成済みURLを登録</button><button disabled={status !== 'uncertain'} onClick={() => { setStatus('waiting'); setResolutionError(''); notify('未作成を確認しました。手動操作を待ちます。'); }}>未作成を確認</button></div></div>}</div>;
  const conditions = <Box title="作成と切替のタイミング">{automatic}<div className="nt-grid">{number('createAt', '作成開始レス番号')}{number('switchAt', '切替レス番号')}</div><small>切替時は、作成済みの次スレッドへしたらばの接続先だけを切り替えます。</small></Box>;
  const post = <Box title="次スレッドに引き継ぐ内容"><div className="nt-stack">{titleField}{bodyField}{identity}</div></Box>;
  const announcement = <Box title="作成後の案内">{announce}</Box>;
  const review = <Box title="作成予定と実行"><div className="nt-stack">{preview}{execution}</div></Box>;
  const warningItems = [...errors, stateMessage, resolutionError].filter(Boolean).map((message, index) => ({ key: `nt-${index}`, message }));
  const navigate = (next: 'home' | 'settings') => { setPage(next); setOrigin(next); bodyRef.current?.scrollTo?.(0, 0); };
  return <div className="nt-prototype"><main className="dashboard management-shell">
    <header className="management-header"><div className="management-brand" aria-label="きゃすメイト"><span aria-hidden="true">▤</span><strong>きゃすメイト</strong></div><span className="management-connection connection-ok" aria-label="バックエンド接続済み（見本）"><span className="connection-label">バックエンド接続済み</span><span className="connection-symbol">✓</span></span><div className="toast-region" aria-live="polite" aria-atomic="true">{toast && <div className="banner"><span className="toast-check">✓</span><span className="toast-message" title={toast}>{toast}</span></div>}</div></header>
    <nav className="management-nav" aria-label="メインナビゲーション"><button aria-current={page === 'home' ? 'page' : undefined} onClick={() => navigate('home')}>ホーム</button><button aria-current={page !== 'home' ? 'page' : undefined} onClick={() => navigate('settings')}>設定</button><ManagementWarnings items={warningItems} /></nav>
    <div className="management-body" ref={bodyRef}>{page === 'editor' ? <>
      <ManagementEditorHeading title="したらば次スレッド作成" backPage={origin === 'home' ? 'ホーム' : '設定'} onBack={() => navigate(origin)} introduction={{ heading: '次スレッドの準備から、接続先の切替まで', body: '作成するタイミングと投稿内容を設定します。現行スレッドへのURL案内も設定できます。' }} />
      {variant === 'A' && <div className="nt-stack">{conditions}{live}{post}{announcement}{review}</div>}
      {variant === 'B' && <div className="nt-stack">{live}<div className="nt-tabs" role="tablist" aria-label="次スレッド設定">{['作成条件', '投稿内容', '確認と実行'].map((name, index) => <button key={name} role="tab" id={`nt-tab-${index}`} aria-controls="nt-tabpanel" aria-selected={tab === index} tabIndex={tab === index ? 0 : -1} onClick={() => setTab(index)} onKeyDown={e => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); const next = (index + (e.key === 'ArrowRight' ? 1 : 2)) % 3; setTab(next); document.getElementById(`nt-tab-${next}`)?.focus(); } }}>{name}</button>)}</div><div role="tabpanel" id="nt-tabpanel" aria-labelledby={`nt-tab-${tab}`} className="nt-stack">{tab === 0 ? <>{conditions}{announcement}</> : tab === 1 ? post : review}</div></div>}
      {variant === 'C' && <div className="nt-stack">{automatic}<div className="nt-flow">{[{ title: '次スレッドを作成', summary: `${settings.createAt}番で準備`, children: <><div className="nt-grid">{number('createAt', '作成開始レス番号')}</div>{titleField}{bodyField}{identity}</> }, { title: '現行スレッドへ案内', summary: settings.announce ? '成功から5秒後にURLを投稿' : '案内しない', children: announce }, { title: '接続先を切替', summary: `${settings.switchAt}番で次スレッドへ`, children: <>{number('switchAt', '切替レス番号')}<small>次スレッドが未作成の場合は現行スレッドを継続します。</small></> }].map((step, index) => <details key={step.title} open={index === 0 ? true : undefined}><summary><span className="nt-step">{index + 1}</span><span><strong>{step.title}</strong><small>{step.summary}</small></span><span className="nt-expand">＋</span></summary><div className="nt-flow-content nt-stack">{step.children}</div></details>)}</div>{live}{review}</div>}
    </> : <><h1>{page === 'home' ? '配信のホーム' : '設定'}</h1><button className="management-entry" onClick={() => { setPage('editor'); requestAnimationFrame(() => document.getElementById('editor-heading')?.focus()); }}><span className="entry-icon">↗</span><span><strong>したらば次スレッド作成</strong><small>作成条件・案内・復旧</small></span><span>›</span></button></>}
      <aside className="nt-lab"><strong>比較用の操作 · 本体へは保存・投稿しません</strong><p>{variant}：{descriptions[variant]}</p><label>状態の見本<select aria-label="状態の見本" value={status} onChange={e => { if (timer.current) clearTimeout(timer.current); const value = e.target.value as Status; setStatus(value); setNextUrl(value === 'created' ? demoUrl : ''); }}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><div className="nt-actions"><button onClick={() => notify('設定を変更しました（見本）。')}>成功通知を表示</button><button onClick={() => notify('とても長い成功通知の見本です。入力位置を変えず、全文はポインターを合わせて確認できます。')}>長文通知</button></div><details><summary>見本の内部状態</summary><pre data-testid="payload">{JSON.stringify({ variant, settings, status, nextUrl, errors }, null, 2)}</pre></details></aside>
    </div></main>
    {import.meta.env.DEV && <aside className="nt-switcher" aria-label="見本の切替"><span>UI見本</span><button aria-label="前の案" onClick={() => choose(variants[(variants.indexOf(variant) + 2) % 3])}>←</button>{variants.map(value => <button key={value} aria-pressed={variant === value} title={names[value]} onClick={() => choose(value)}>{value}<span> {names[value]}</span></button>)}<button aria-label="次の案" onClick={() => choose(variants[(variants.indexOf(variant) + 1) % 3])}>→</button></aside>}
  </div>;
}
