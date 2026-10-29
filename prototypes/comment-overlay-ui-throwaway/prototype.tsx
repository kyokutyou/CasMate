// Throwaway: three structurally different settings editors, switched via ?variant=A|B|C.
// Shared production chrome only. All changes stay in memory; no network or real OBS changes.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ManagementEditorHeading } from '../shared/ManagementEditorHeading';
import { ManagementWarnings, type ManagementWarningItem } from '../../src/renderer/components/ManagementWarnings';
import { SlimSwitch } from '../../src/renderer/components/SlimSwitch';

const variants = ['A', 'B', 'C'] as const;
type Variant = typeof variants[number];
const names = { A: '一覧で調整', B: '目的別タブ', C: '順に組み立てる' };
const descriptions = { A: '表示方法から外観まで、一画面を見渡して調整。普段の微調整に。', B: '「表示」「外観」「OBSで確認」を切り替え、必要な設定に集中。', C: '表示方法 → 情報 → 外観 → OBS。初めての準備を順番に案内。' };
const initial = { mode: 'stack', direction: 'newestBottom', stackTime: '10', singleTime: '10',
  service: true, author: true, body: true, font: 'system-ui', size: '32', text: '#ffffff', textOpacity: '100',
  background: '#000000', backgroundOpacity: '50', padding: '8', radius: '8' };
type Settings = typeof initial;
type NumericKey = 'stackTime' | 'singleTime' | 'size' | 'textOpacity' | 'backgroundOpacity' | 'padding' | 'radius';
const ranges: Record<NumericKey, [number, number]> = { stackTime: [1, 60], singleTime: [1, 60], size: [8, 200], textOpacity: [0, 100], backgroundOpacity: [0, 100], padding: [0, 64], radius: [0, 64] };
const labels: Record<NumericKey, string> = { stackTime: '積み上げ表示時間', singleTime: '1件表示時間', size: '文字サイズ', textOpacity: '文字の不透明度', backgroundOpacity: '背景の不透明度', padding: '内側余白', radius: '角丸' };
function invalid(key: NumericKey, value: string) { const [min, max] = ranges[key]; return !/^\d+$/.test(value) || Number(value) < min || Number(value) > max; }
function Box({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return <section className="co-box"><div className="co-section-title"><h2>{title}</h2>{note && <small>{note}</small>}</div>{children}</section>;
}
function VariantA({ mode, fields, appearance, tools }: Record<'mode' | 'fields' | 'appearance' | 'tools', ReactNode>) {
  return <div className="co-stack"><Box title="表示方法とタイミング">{mode}</Box><Box title="表示する情報">{fields}</Box><Box title="文字と背景">{appearance}</Box>{tools}</div>;
}
function VariantB({ tab, setTab, mode, fields, appearance, tools }: Record<'mode' | 'fields' | 'appearance' | 'tools', ReactNode> & { tab: number; setTab(value: number): void }) {
  return <div className="co-stack"><div className="co-tabs" role="tablist" aria-label="設定の目的">{['表示', '外観', 'OBSで確認'].map((label, index) => <button key={label} id={`co-tab-${index}`} role="tab" aria-selected={tab === index} aria-controls="co-tabpanel" tabIndex={tab === index ? 0 : -1} onClick={() => setTab(index)} onKeyDown={event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + (event.key === 'ArrowRight' ? 1 : 2)) % 3;
    setTab(next); document.getElementById(`co-tab-${next}`)?.focus();
  }}>{label}</button>)}</div><div className="co-stack" role="tabpanel" id="co-tabpanel" aria-labelledby={`co-tab-${tab}`}>
    {tab === 0 && <><section className="co-flat"><h2>表示方法とタイミング</h2>{mode}</section><section className="co-flat"><h2>表示する情報</h2>{fields}</section></>}
    {tab === 1 && <section className="co-flat"><h2>文字と背景</h2>{appearance}</section>}{tab === 2 && tools}
  </div></div>;
}
function VariantC({ step, setStep, summaries, mode, fields, appearance, tools }: Record<'mode' | 'fields' | 'appearance' | 'tools', ReactNode> & { step: number; setStep(value: number): void; summaries: string[] }) {
  const titles = ['表示方法を決める', '見せる情報を選ぶ', '文字と背景を整える', 'OBSで確認する'];
  return <div className="co-steps">{titles.map((title, index) => <section key={title} className="co-step" data-open={step === index}>
    <button className="co-step-heading" id={`co-step-${index}`} aria-expanded={step === index} aria-controls={`co-step-body-${index}`} onClick={() => setStep(step === index ? -1 : index)}><span className="co-number">0{index + 1}</span><span><strong>{title}</strong>{step !== index && <small>{summaries[index]}</small>}</span><span className="co-expand">{step === index ? '−' : '＋'}</span></button>
    <div className="co-step-body" id={`co-step-body-${index}`} hidden={step !== index}>{[mode, fields, appearance, tools][index]}{index < 3 && <div className="co-next"><span>設定は変更ごとに反映されます</span><button onClick={() => { setStep(index + 1); requestAnimationFrame(() => document.getElementById(`co-step-${index + 1}`)?.focus()); }}>次へ →</button></div>}</div>
  </section>)}</div>;
}
export function Prototype() {
  const [variant, setVariant] = useState<Variant>(() => { const value = new URLSearchParams(window.location.search).get('variant'); return value === 'B' || value === 'C' ? value : 'A'; });
  const [draft, setDraft] = useState<Settings>({ ...initial });
  const [saved, setSaved] = useState<Settings>({ ...initial });
  const [tab, setTab] = useState(0); const [step, setStep] = useState(0);
  const [page, setPage] = useState<'editor' | 'home' | 'settings'>('editor'); const [origin, setOrigin] = useState<'home' | 'settings'>('settings');
  const [speech, setSpeech] = useState(false); const [failure, setFailure] = useState(false);
  const failureRef = useRef(false);
  const [saveError, setSaveError] = useState(false); const [fieldError, setFieldError] = useState(false);
  const [notice, setNotice] = useState<{ message: string }>(); const [previewOpen, setPreviewOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null); const previewEntry = useRef<HTMLButtonElement | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null); const entryRef = useRef<HTMLButtonElement>(null); const entryScroll = useRef(0);
  const notify = (message = '変更を反映しました（見本）。') => setNotice({ message });
  const choose = (next: Variant) => { setVariant(next); window.history.replaceState(null, '', `?variant=${next}`); requestAnimationFrame(() => bodyRef.current?.scrollTo?.(0, 0)); };
  useEffect(() => { const handle = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || document.querySelector('dialog[open]') || (event.target instanceof Element && event.target.closest('input,textarea,select,button,summary,[contenteditable],[role=tablist]'))) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); choose(variants[(variants.indexOf(variant) + (event.key === 'ArrowRight' ? 1 : 2)) % 3]); }
  }; window.addEventListener('keydown', handle); return () => window.removeEventListener('keydown', handle); }, [variant]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(undefined), 4000); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => {
    const changed = (Object.keys(initial) as (keyof Settings)[]).filter(key => draft[key] !== saved[key] && (!(key in ranges) || !invalid(key as NumericKey, String(draft[key]))));
    if (!changed.length) return;
    const timer = setTimeout(() => {
      if (failureRef.current) { setSaveError(true); return; }
      setSaved(current => ({ ...current, ...Object.fromEntries(changed.map(key => [key, draft[key]])) }));
      setSaveError(false); setNotice({ message: '変更を反映しました（見本）。' });
    }, 500); return () => clearTimeout(timer);
  }, [draft, saved]);
  const update = <K extends keyof Settings>(key: K, value: Settings[K], deferred = false) => {
    setDraft(current => ({ ...current, [key]: value }));
    if (deferred) return;
    if (failure) { setSaveError(true); return; }
    setSaved(current => ({ ...current, ...(['service', 'author', 'body'].includes(key) ? { service: draft.service, author: draft.author, body: draft.body } : {}), [key]: value })); setSaveError(false); notify();
  };
  const warnings: ManagementWarningItem[] = (Object.keys(ranges) as NumericKey[]).filter(key => invalid(key, draft[key])).map(key => ({ key, message: `${labels[key]}：${ranges[key][0]}〜${ranges[key][1]}の整数を入力してください。変更は未反映です。` }));
  if (saveError) warnings.push({ key: 'save', message: '変更を反映できませんでした。入力は保持しています。接続の復旧後、値を変更して再試行してください（見本）。' });
  if (fieldError) warnings.push({ key: 'fields', message: '表示する情報を1つ以上オンにしてください。最後の項目はオフにできません。' });
  const numeric = (key: NumericKey, unit: string, disabled = false) => <div className="co-field"><label htmlFor={`co-${key}`}>{labels[key]}</label><div className="co-unit"><input id={`co-${key}`} type="number" min={ranges[key][0]} max={ranges[key][1]} step="1" value={draft[key]} disabled={disabled} aria-invalid={invalid(key, draft[key])} aria-describedby={`hint-${key}`} onChange={event => update(key, event.target.value, true)} /><span>{unit}</span></div><small id={`hint-${key}`} className="co-hint" data-error={invalid(key, draft[key])}>{invalid(key, draft[key]) ? `${ranges[key][0]}〜${ranges[key][1]}の整数を入力。未反映です。` : disabled ? '読み上げとの同期中は変更できません。' : `${ranges[key][0]}〜${ranges[key][1]} ${unit}`}</small></div>;
  const sync = draft.mode === 'single' && speech;
  const mode = <div className="co-stack co-gap-small"><div className="co-mode" role="group" aria-label="表示方法">{[['stack', '積み上げ', '複数のコメントを並べる'], ['single', '1件ずつ', '一つのコメントに集中']].map(([key, label, hint]) => <button key={key} aria-pressed={draft.mode === key} onClick={() => { if (draft.mode !== key) update('mode', key); }}><span className={`co-mode-icon ${key}`} aria-hidden="true"><i/><i/><i/></span><span><strong>{label}</strong><small>{hint}</small></span><span className="co-radio" aria-hidden="true">{draft.mode === key ? '●' : '○'}</span></button>)}</div>
    <p className="co-note">切り替えると表示中と表示待ちのコメントをクリアし、次の新着から表示します。</p>
    <div className="co-grid">{draft.mode === 'stack' ? <>{numeric('stackTime', '秒')}<label className="co-field">積み上げ方向<select value={draft.direction} onChange={event => update('direction', event.target.value)}><option value="newestBottom">新着を下へ</option><option value="newestTop">新着を上へ</option></select><small className="co-hint">最大10件。古いコメントから消えます。</small></label></> : <>{numeric('singleTime', '秒', sync)}<div className="co-explain"><strong>{sync ? '読み上げの終了に合わせて表示' : '届いた順に、一つずつ表示'}</strong><p>{sync ? 'PCの読み上げが終わって2秒後に消えます。音声を用意できない場合は、保持した1件表示時間を使います。' : '表示時間が終わると、次のコメントへ切り替わります。読み上げがオンなら音声と同期します。'}</p></div></>}</div>
  </div>;
  const fieldEntries = [['service', 'サービス名', 'YouTube・Twitch・したらば'], ['author', '投稿者名', '誰から届いたコメントか'], ['body', '本文', 'コメントの文章・公式エモート']] as const;
  const fields = <div><div className="co-field-list">{fieldEntries.map(([key, label, hint]) => <div className="co-toggle-row" key={key}><div><strong>{label}</strong><small>{hint}</small></div><SlimSwitch label={label} checked={draft[key]} keepFocus onChange={value => {
    if (!value && fieldEntries.filter(([field]) => draft[field]).length === 1) { setFieldError(true); return; }
    setFieldError(false); update(key, value);
  }} /></div>)}</div><p className="co-field-hint" data-error={fieldError}>{fieldError ? '1つ以上オンにしてください。最後の項目はオフにできません。' : '少なくとも1つの情報を表示します。'}</p></div>;
  const color = (key: 'text' | 'background', title: string, alpha: NumericKey) => <div className="co-color"><label className="co-field">{title}<span className="co-color-input"><input type="color" aria-label={title} value={draft[key]} onChange={event => update(key, event.target.value, true)} /><code>{draft[key].toUpperCase()}</code></span></label>{numeric(alpha, '%')}</div>;
  const appearance = <div className="co-stack"><p className="co-shared">◇ この外観は、OBS音声認識ビューにも反映されます。</p><div className="co-grid"><label className="co-field">フォント<select value={draft.font} onChange={event => update('font', event.target.value)}><option value="system-ui">システムのUIフォント</option><option value="Yu Gothic UI">Yu Gothic UI（見本）</option><option value="Meiryo">メイリオ（見本）</option></select><small className="co-hint">本体ではWindowsの利用可能フォントから選択</small></label>{numeric('size', 'px')}</div><div className="co-grid">{color('text', '文字色', 'textOpacity')}{color('background', '背景色', 'backgroundOpacity')}</div><details className="co-details"><summary>余白と角丸</summary><div className="co-grid">{numeric('padding', 'px')}{numeric('radius', 'px')}</div></details></div>;
  const closePreview = () => { dialog.current?.close(); setPreviewOpen(false); previewEntry.current?.focus(); };
  const tools = <section className="co-tools"><div className="co-between"><div><h2>OBSで見え方を確認</h2><p className="co-note">見本のコメントで文字や配色を確認できます。</p></div><button className="co-primary" onClick={event => { previewEntry.current = event.currentTarget; setPreviewOpen(true); dialog.current?.showModal(); }}>プレビューを開く</button></div><details className="co-details"><summary>OBSへの追加方法・URL</summary><div className="co-guide"><p>OBSでブラウザソースを追加し、次のURLを指定します。幅と高さは配信レイアウトに合わせて調整します。</p><code>http://127.0.0.1:3939/overlay/comments</code><small>見本のURLです。本体では現在のポートを使います。</small><button onClick={() => notify('URLコピーの操作を確認しました（見本）。')}>URLをコピー（見本）</button></div></details></section>;
  const parts = { mode, fields, appearance, tools };
  const navigate = (next: 'home' | 'settings') => { setPage(next); setOrigin(next); bodyRef.current?.scrollTo?.(0, 0); };
  const back = () => { setPage(origin); requestAnimationFrame(() => { if (bodyRef.current) bodyRef.current.scrollTop = entryScroll.current; entryRef.current?.focus({ preventScroll: true }); }); };
  return <div className="co-prototype"><main className="dashboard management-shell">
    <header className="management-header"><div className="management-brand" aria-label="きゃすメイト"><span aria-hidden="true">▤</span><strong>きゃすメイト</strong></div><span className="management-connection connection-ok" aria-label="バックエンド接続済み（見本）"><span className="connection-label">バックエンド接続済み</span><span className="connection-symbol">✓</span></span><div className="toast-region" role="region" aria-label="通知" aria-live="polite" aria-atomic="true">{notice && <div className="banner"><span className="toast-check" aria-hidden="true">✓</span><span className="toast-message" title={notice.message}>{notice.message}</span></div>}</div></header>
    <nav className="management-nav" aria-label="メインナビゲーション"><button aria-current={page === 'home' ? 'page' : undefined} onClick={() => navigate('home')}>ホーム</button><button aria-current={page !== 'home' ? 'page' : undefined} onClick={() => navigate('settings')}>設定</button><ManagementWarnings items={warnings}/></nav>
    <div className="management-body" ref={bodyRef}>{page === 'editor' ? <><ManagementEditorHeading title="OBSコメント表示" backPage={origin === 'home' ? 'ホーム' : '設定'} onBack={back} introduction={{ heading: '配信画面に、見やすいコメントを', body: 'OBSのブラウザソースに表示するコメントを調整します。表示方法・情報・外観を変更すると、接続中のOBSコメントビューへ反映されます。' }}/>
      {variant === 'A' && <VariantA {...parts}/>} {variant === 'B' && <VariantB {...parts} tab={tab} setTab={setTab}/>} {variant === 'C' && <VariantC {...parts} step={step} setStep={setStep} summaries={[draft.mode === 'stack' ? '積み上げ' : '1件ずつ', fieldEntries.filter(([key]) => draft[key]).map(([, label]) => label).join('・'), `${draft.size} px · 文字と背景、余白を調整`, 'プレビュー・追加方法・URL']}/>}</> : <><h1>{page === 'home' ? '配信のホーム（見本）' : '設定（見本）'}</h1><button ref={entryRef} className="management-entry" onClick={() => { entryScroll.current = bodyRef.current?.scrollTop ?? 0; setPage('editor'); requestAnimationFrame(() => document.getElementById('editor-heading')?.focus()); }}><span className="entry-icon">▤</span><span><strong>OBSコメント表示</strong><small>文字サイズ・表示方法</small></span><span>›</span></button></>}
    <aside className="co-lab"><small>比較用の操作 · 本体には含みません</small><strong>{variant} · {names[variant]}</strong><p>{descriptions[variant]}</p><p>架空の設定です。保存・OBS接続・コピーは行いません。プレビューは静止見本です。</p><div className="co-lab-controls"><label><input type="checkbox" checked={speech} onChange={event => setSpeech(event.target.checked)}/>コメント読み上げがオンの状態</label><label><input type="checkbox" checked={failure} onChange={event => { setFailure(event.target.checked); failureRef.current = event.target.checked; }}/>保存に失敗する状態</label><button onClick={() => notify()}>成功通知</button><button onClick={() => notify('長い通知の見本です。設定項目の位置を動かさず表示し、全文はポインターを合わせて確認できます。')}>長文通知</button></div><details><summary>見本の内部状態</summary><pre data-testid="payload">{JSON.stringify({ variant, page, draft, saved, speech, failure, saveError, fieldError, tab, step, previewOpen }, null, 2)}</pre></details></aside>
    </div></main>
    <dialog ref={dialog} className="co-preview" aria-labelledby="co-preview-title" onKeyDown={event => { if (event.key === 'Tab') { event.preventDefault(); event.currentTarget.querySelector('button')?.focus(); } }} onCancel={event => { event.preventDefault(); closePreview(); }}><div className="co-between"><h2 id="co-preview-title">コメントの見え方</h2><button autoFocus onClick={closePreview}>閉じる</button></div><p>架空のコメントによる静止見本。配信には流れません。</p><div className="co-preview-stage">{(saved.mode === 'stack' ? (saved.direction === 'newestTop' ? [2, 1, 0] : [0, 1, 2]) : [0]).map(index => <div className="co-sample" key={index} style={{ fontFamily: saved.font, fontSize: `${saved.size}px`, color: `${saved.text}${Math.round(Number(saved.textOpacity) / 100 * 255).toString(16).padStart(2, '0')}`, backgroundColor: `${saved.background}${Math.round(Number(saved.backgroundOpacity) / 100 * 255).toString(16).padStart(2, '0')}`, padding: `${saved.padding}px`, borderRadius: `${saved.radius}px` }}>{saved.service && <small>{['YouTube', 'Twitch', 'したらば'][index]}</small>}{saved.author && <strong>{['そら', 'あおい', '名無し'][index]} </strong>}{saved.body && <span>{['こんばんは！今日の配信も楽しみです', 'このシーン、きれいですね', '初見です。よろしくお願いします！'][index]}</span>}</div>)}</div><p>背景の市松模様は透明部分です。実際の幅・折り返しはOBSで確認してください。</p></dialog>
    {import.meta.env.DEV && <aside className="co-switcher" aria-label="見本の切替"><span>UI見本</span><button aria-label="前の案" onClick={() => choose(variants[(variants.indexOf(variant) + 2) % 3])}>←</button>{variants.map(key => <button key={key} aria-pressed={variant === key} onClick={() => choose(key)}>{key}<span> {names[key]}</span></button>)}<button aria-label="次の案" onClick={() => choose(variants[(variants.indexOf(variant) + 1) % 3])}>→</button></aside>}
  </div>;
}
