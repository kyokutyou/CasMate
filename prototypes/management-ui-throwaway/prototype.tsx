// THROWAWAY: three structural alternatives, entirely in-memory and disconnected.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { adjacentVariant, categories, features, initialValues, isDerivedVariant, isHomeVariant, isPortraitVariant, parseVariant, purposeFeatures, scenarios, variantGroups, variantNames, type Category, type Feature, type Values, type Variant } from './model';
import { PurposeVariations } from './PurposeVariations';
import { HomeControlDock, HomeVariations } from './HomeVariations';
import { RefinedHome } from './RefinedHome';
import { ComposedHomes } from './ComposedHomes';
import { DemoSwitch } from './SwitchDesigns';
import { PcStatus, PcStatusDetails, PcStylePicker, parsePcStyle, type PcStyle, type PcLoad } from './PcStatus';

function Icon({ name = 'settings', size = 20 }: { name?: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    chat: <path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 3V6a2 2 0 0 1 2-2Z" />,
    audio: <><path d="M4 10v4m4-8v12m4-15v18m4-15v12m4-8v4" /></>,
    spark: <><path d="m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6Z" /></>,
    display: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8m-4-4v4" /></>,
    phone: <><rect x="6" y="2" width="12" height="20" rx="3" /><path d="M10 18h4" /></>,
    settings: <><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="8" cy="6" r="2" /><circle cx="16" cy="12" r="2" /><circle cx="10" cy="18" r="2" /></>,
    home: <><path d="m3 10 9-7 9 7v10H3Z" /><path d="M9 20v-7h6v7" /></>,
    arrow: <path d="m9 5 7 7-7 7" />,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? paths.settings}</svg>;
}

function Modal({ title, children, close }: { title: string; children: ReactNode; close(): void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const previousFocus = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={ref} className="prototype-modal" aria-label={title} onCancel={close}>
    <header><h2>{title}</h2><button aria-label="閉じる" onClick={close}>×</button></header>{children}
  </dialog>;
}

type Trial = { variant: Variant; task: string; moves: number; scroll: number; note: string };
type Purpose = keyof typeof purposeFeatures;
type ReturnPoint = { page: 'home' | 'settings'; scroll: number; key: string | null; label: string | null; text: string | null };

export function Prototype() {
  const [variant, setVariant] = useState<Variant>(() => parseVariant(new URLSearchParams(window.location.search).get('variant')));
  const [values, setValues] = useState<Values>({ ...initialValues });
  const [category, setCategory] = useState<Category>('comments');
  const [featureId, setFeatureId] = useState<string | null>(null);
  const [aPage, setAPage] = useState<'home' | 'settings'>('home');
  const [purpose, setPurpose] = useState<Purpose>('配信準備');
  const [warning, setWarning] = useState(true);
  const [notice, setNotice] = useState('');
  const [modal, setModal] = useState<'preview' | 'guide' | 'compare' | 'reset' | 'pc' | null>(null);
  const [pcStyle, setPcStyle] = useState(() => parsePcStyle(new URLSearchParams(window.location.search).get('pc')));
  const [pcLoad, setPcLoad] = useState<PcLoad>('normal');
  const [task, setTask] = useState(scenarios[0]);
  const [trial, setTrial] = useState<Trial | null>(null);
  const [records, setRecords] = useState<Trial[]>([]);
  const [note, setNote] = useState('');
  const pane = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const pendingField = useRef<string | undefined>(undefined);
  const [returnPoint, setReturnPoint] = useState<ReturnPoint | null>(null);
  const pendingReturn = useRef<ReturnPoint | null>(null);
  const scrollPosition = useRef(0);
  const nestedScrollPositions = useRef(new WeakMap<HTMLElement, number>());
  const feature = features.find(f => f.id === featureId);
  const selectedCategory = categories.find(c => c.id === category)!;
  const homeDerived = isHomeVariant(variant);
  const refined = variant === 'A4';
  const composed = variant === 'A5' || variant === 'A6' || variant === 'A7';
  const homeLayout = variant === 'A' || homeDerived || refined || composed;
  const derived = isDerivedVariant(variant) || homeDerived;
  const portrait = isPortraitVariant(variant);
  const inlineEditing = variant === 'V3';
  const isPurposeLayout = variant === 'C' || isDerivedVariant(variant);
  const variantGroup = variantGroups.find(group => group.variants.some(v => v === variant))!;
  const selectionPage = inlineEditing ? null : featureId;
  const categoryPage = variant === 'B' ? category : null;
  const homePage = homeLayout ? aPage : null;

  function changeVariant(next: Variant) {
    if (next === variant) return;
    setVariant(next); setFeatureId(null); setAPage('home'); setPurpose('配信準備'); setCategory('comments');
    setModal(null);
    const url = new URL(window.location.href); url.searchParams.set('variant', next); window.history.replaceState(null, '', url);
    if (trial) { setRecords(r => [...r, { ...trial, note: `${note}（案の切替で終了）` }]); setTrial(null); setNote(''); }
  }
  function changePcStyle(next: PcStyle) {
    setPcStyle(next);
    setAPage('home'); setFeatureId(null);
    const url = new URL(window.location.href); url.searchParams.set('pc', next); window.history.replaceState(null, '', url);
  }
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || modal) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable="true"], [role="tablist"]')) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        changeVariant(adjacentVariant(variant, event.key === 'ArrowRight' ? 1 : -1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  useEffect(() => {
    const timer = window.setTimeout(() => setNotice(''), 2800);
    return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const restore = pendingReturn.current;
    pendingReturn.current = null;
    if (restore && pane.current) {
      const trigger = Array.from(pane.current.querySelectorAll('button')).find(button => restore.key ? button.dataset.returnKey === restore.key : restore.label ? button.getAttribute('aria-label') === restore.label : button.textContent === restore.text);
      (trigger ?? heading.current)?.focus({ preventScroll: true });
      pane.current.scrollTop = restore.scroll;
      scrollPosition.current = pane.current.scrollTop;
      nestedScrollPositions.current = new WeakMap();
      return;
    }
    if (pane.current) pane.current.scrollTop = 0;
    scrollPosition.current = 0;
    nestedScrollPositions.current = new WeakMap();
    const targetField = pendingField.current ? document.getElementById(`prototype-field-${pendingField.current}`) : null;
    pendingField.current = undefined;
    if (targetField) {
      targetField.focus({ preventScroll: true });
      targetField.closest('.field')?.scrollIntoView?.({ block: 'nearest' });
    } else heading.current?.focus({ preventScroll: true });
  }, [selectionPage, categoryPage, homePage, purpose, variant]);

  function move(action: () => void) {
    setTrial(t => t ? { ...t, moves: t.moves + 1 } : null); action();
  }
  function openFeature(id: string, fieldKey?: string) {
    const target = features.find(f => f.id === id)!;
    if (variant === 'A5' && !featureId) {
      const trigger = document.activeElement;
      setReturnPoint({ page: aPage, scroll: pane.current?.scrollTop ?? 0, key: trigger?.getAttribute('data-return-key') ?? null, label: trigger?.getAttribute('aria-label') ?? null, text: trigger?.textContent ?? null });
    }
    pendingField.current = fieldKey;
    move(() => { setCategory(target.category); setFeatureId(id); setAPage('settings'); });
  }
  function showComposedSettings() {
    move(() => { setAPage('settings'); setFeatureId(null); });
  }
  function backFromEditor() {
    const origin = variant === 'A5' ? returnPoint : null;
    if (origin) {
      pendingReturn.current = origin;
      move(() => { setAPage(origin.page); setFeatureId(null); });
    } else move(() => setFeatureId(null));
  }
  function update(key: string, value: string | boolean) {
    setValues(v => ({ ...v, [key]: value }));
    if (key === 'demoTwitchConnected' && typeof value === 'boolean') setWarning(false);
  }
  function simulate(message: string) { setNotice(`${message}（試作内）`); }
  function beginTrial() {
    setTrial({ variant, task, moves: 0, scroll: 0, note: '' }); setNote('');
    setFeatureId(null); setAPage('home'); setCategory('comments'); setPurpose('配信準備');
    if (task === scenarios[5]) setWarning(true);
    if (pane.current) pane.current.scrollTop = 0;
    scrollPosition.current = 0; setModal(null);
  }
  function reset() {
    setPcLoad('normal');
    setValues({ ...initialValues }); setWarning(true); setTrial(null); setRecords([]); setNote('');
    setFeatureId(null); setAPage('home'); setCategory('comments'); setPurpose('配信準備'); setModal(null); simulate('初期状態に戻しました');
  }
  const title = (!inlineEditing && feature?.name) || (homeLayout ? aPage === 'home' ? '配信のホーム' : '設定' : variant === 'B' ? selectedCategory.name : purpose);
  const description = (!inlineEditing && feature?.description) || (homeLayout ? aPage === 'home' ? 'いつもの操作を、ここから。' : '変更したい内容から選んでください。' : variant === 'B' ? selectedCategory.description : { 配信準備: '接続を整えて、配信の準備を。', 配信中: '今の状態を確認して、必要な操作だけ。', 外配信: 'スマホとPCをつないで、外へ。' }[purpose]);
  const featureRows = (items: Feature[]) => <div className="feature-rows">{items.map(f => <button className="feature-row" key={f.id} onClick={() => openFeature(f.id)}>
    <span><strong>{f.name}</strong><small>{f.description}</small></span><Icon name="arrow" size={16} />
  </button>)}</div>;
  const quickControls = <div className="quick-controls">
    {[['speechOn', '読み上げ', 'audio'], ['aiOn', 'AIリスナー', 'spark'], ['listOn', 'コメント一覧', 'chat']].map(([key, label, icon]) => <button key={key} className="quick-control" aria-pressed={Boolean(values[key])} onClick={() => update(key, !values[key])}>
      <Icon name={icon} /><span>{label}</span><span className={`pill ${values[key] ? 'good' : ''}`}>{values[key] ? 'オン' : 'オフ'}</span>
    </button>)}
  </div>;

  const purposeNavigation = <nav className={`purpose-nav ${variant === 'V2' ? 'bottom-purpose-nav' : ''}`} aria-label="用途">{(Object.keys(purposeFeatures) as Purpose[]).map((p, i) => <button className={purpose === p ? 'active' : ''} aria-current={purpose === p ? 'page' : undefined} key={p} onClick={() => move(() => { setPurpose(p); setFeatureId(null); })}><span className="step-number">0{i + 1}</span>{p}</button>)}</nav>;
  const editor = feature ? <Editor feature={feature} slimSwitches={composed} values={values} update={update} simulate={simulate} openModal={setModal} warning={warning} resolve={() => { update('demoTwitchConnected', true); setWarning(false); simulate('Twitchに再接続しました'); }} /> : null;

  return <div className={`prototype-root ${derived ? 'sized-preview' : ''} ${portrait ? 'portrait-preview' : ''}`} data-variant={variant}>
    <div className={`app-frame variant-${variant} ${composed ? 'composed-frame' : ''}`}>
      <header className="app-header"><a className="brand" href={`?variant=${variant}`} onClick={e => { e.preventDefault(); move(() => { setFeatureId(null); setAPage('home'); }); }}><span className="brand-mark"><Icon name="audio" size={19} /></span>きゃすメイト</a>{variant === 'A5' && aPage === 'home' && !feature ? <PcStatus style={pcStyle} load={pcLoad} open={() => setModal('pc')}/> : <><span className="prototype-label">DESIGN PREVIEW</span><span className="local-status"><i />ローカル接続</span></>}</header>
      {homeLayout && variant !== 'A2' && <nav className="a-nav" aria-label="メイン"><button className={aPage === 'home' ? 'active' : ''} onClick={() => move(() => { setAPage('home'); setFeatureId(null); })}><Icon name="home" size={16} />ホーム</button><button className={aPage === 'settings' ? 'active' : ''} onClick={() => move(() => { setAPage('settings'); setFeatureId(null); })}><Icon size={16} />設定</button><span>配信の操作と、設定を分ける</span></nav>}
      {isPurposeLayout && variant !== 'V2' && purposeNavigation}
      <div className="workspace">
        {variant === 'B' && <aside className="sidebar"><p className="section-label">ワークスペース</p><nav aria-label="設定分類">{categories.map(c => <button key={c.id} className={category === c.id ? 'active' : ''} onClick={() => move(() => { setCategory(c.id); setFeatureId(null); })}><Icon name={c.icon} size={18} /><span>{c.name}</span>{c.id === 'comments' && warning && <i className="attention-dot" />}</button>)}</nav><div className="sidebar-bottom"><span className="pill good">読み上げ {values.speechOn ? 'オン' : 'オフ'}</span><small>必要な設定を、一つずつ。</small></div></aside>}
        <div className="main-column">
          {warning && (!(refined || composed) || aPage === 'settings') && <div className="warning-bar"><span><b>!</b> Twitchの接続を確認してください</span><button onClick={() => openFeature('sources')}>設定を確認 <span aria-hidden="true">↗</span></button></div>}
          <main ref={pane} className="content-pane" onScrollCapture={e => {
            const target = e.target as HTMLElement;
            const next = target.scrollTop;
            const previous = target === e.currentTarget ? scrollPosition.current : nestedScrollPositions.current.get(target) ?? 0;
            const delta = Math.abs(next - previous);
            if (target === e.currentTarget) scrollPosition.current = next;
            else nestedScrollPositions.current.set(target, next);
            if (delta) setTrial(t => t ? { ...t, scroll: t.scroll + delta } : null);
          }}>
            {feature && !inlineEditing && <button className="back-link" onClick={backFromEditor}>← {variant === 'A5' && returnPoint?.page === 'home' ? 'ホーム' : variant === 'B' ? selectedCategory.name : isPurposeLayout ? purpose : '設定'}に戻る</button>}
            <div className="page-heading"><div><p className="section-label">{feature ? 'SETTINGS' : variant === 'A' && aPage === 'home' ? 'YOUR WORKSPACE' : 'WORKSPACE / SETTINGS'}</p><h1 ref={heading} tabIndex={-1}>{title}</h1><p>{description}</p></div>{feature && <span className="pill">試作内で保持</span>}</div>
            {composed ? <ComposedHomes key={variant} variant={variant} page={aPage} selected={feature} editor={editor} values={values} warning={warning} open={openFeature} update={update} showSettings={showComposedSettings} /> : refined ? feature ? <><p className="refined-breadcrumb">設定 › {selectedCategory.id === 'app' ? 'OBS連携・アプリ' : selectedCategory.name} › {feature.name}</p>{editor}</> : <RefinedHome page={aPage} values={values} warning={warning} open={openFeature} update={update} reconnect={() => { setWarning(false); simulate('Twitchに再接続しました'); }} showSettings={() => move(() => setAPage('settings'))} /> : isHomeVariant(variant) ? <HomeVariations key={variant} variant={variant} page={aPage} selected={feature} values={values} warning={warning} editor={editor} open={openFeature} showSettings={() => move(() => { setAPage('settings'); setFeatureId(null); })} navigate={move} update={update} /> : isDerivedVariant(variant) ? <PurposeVariations key={`${variant}-${purpose}`} variant={variant} purpose={purpose} selected={feature} values={values} warning={warning} editor={editor} open={openFeature} close={() => move(() => setFeatureId(null))} /> : feature ? editor : variant === 'A' ? aPage === 'home' ? <>
              <section className="home-overview"><div><span className={`pill ${warning ? 'warn' : 'good'}`}>{warning ? '一部の接続に確認が必要' : '接続は良好です'}</span><h2>今日も、いつもの配信を。</h2><p>YouTube Live 接続中 <span>／</span> したらば 接続中</p></div><button className="primary" onClick={() => openFeature('sources')}>接続先を確認 <Icon name="arrow" size={15} /></button></section>
              <div className="section-heading"><h2>よく使う操作</h2><span>ワンクリックで切り替え</span></div>{quickControls}
              <div className="section-heading"><h2>設定を調整</h2><button className="text-button" onClick={() => move(() => setAPage('settings'))}>すべての設定 →</button></div>
              <div className="home-links">{['speech', 'ai', 'overlay', 'mobile'].map(id => { const f = features.find(f => f.id === id)!; return <button key={id} onClick={() => openFeature(id)}>{f.name}<Icon name="arrow" size={14} /></button>; })}</div>
            </> : <div className="category-grid">{categories.map(c => <section className="category-card" key={c.id}><div className="category-title"><span className="icon-tile"><Icon name={c.icon} /></span><h2>{c.name}</h2></div>{featureRows(features.filter(f => f.category === c.id))}</section>)}</div> : variant === 'B' ? <>
              <div className="category-intro"><Icon name={selectedCategory.icon} size={26} /><p>{features.filter(f => f.category === category).length}つの設定<span>項目を選ぶと、編集画面が開きます。</span></p></div>{featureRows(features.filter(f => f.category === category))}
              <p className="quiet-note">切り替えても、実行中の操作や入力はそのまま。</p>
            </> : <>
              {purpose === '配信中' ? quickControls : <div className="purpose-banner"><span className="icon-tile"><Icon name={purpose === '外配信' ? 'phone' : 'settings'} /></span><div><strong>{purpose === '外配信' ? 'スマホから配信する' : 'まずは、接続先から'}</strong><p>{purpose === '外配信' ? '登録と接続方法を確認できます。' : '接続 → 音声 → 表示の順に確認。'}</p></div><button className="primary" onClick={() => openFeature(purpose === '外配信' ? 'mobile' : 'sources')}>{purpose === '外配信' ? '接続案内へ' : '接続先へ'}</button></div>}
              <div className="section-heading"><h2>{purpose === '外配信' ? '外配信で使う設定' : purpose === '配信中' ? '配信中に調整する' : '準備する内容'}</h2><span>{purposeFeatures[purpose].length}項目</span></div>
              <div className="purpose-list">{purposeFeatures[purpose].map((id, i) => { const f = features.find(f => f.id === id)!; return <button key={id} onClick={() => openFeature(id)}><span className="list-number">{String(i + 1).padStart(2, '0')}</span><span><strong>{f.name}</strong><small>{f.description}</small></span><Icon name="arrow" size={15} /></button>; })}</div>
            </>}
          </main>
        </div>
      </div>
      {variant === 'V2' && purposeNavigation}
      {variant === 'A2' && <nav className="home-bottom-nav" aria-label="メイン"><button aria-current={aPage === 'home' ? 'page' : undefined} onClick={() => move(() => { setAPage('home'); setFeatureId(null); })}><Icon name="home" size={18} />ホーム</button><button aria-current={aPage === 'settings' ? 'page' : undefined} onClick={() => move(() => { setAPage('settings'); setFeatureId(null); })}><Icon name="settings" size={18} />設定</button></nav>}
      {variant === 'A3' && <HomeControlDock values={values} update={update} />}
      {notice && <div className="notice" role="status">✓ {notice}</div>}
    </div>
    <footer className="comparison-bar" aria-label="デザイン比較">
      <nav className="comparison-groups" aria-label="比較する案のグループ">{variantGroups.map(group => <button key={group.id} aria-pressed={group.id === variantGroup.id} onClick={() => { if (group.id !== variantGroup.id) changeVariant(group.variants[0]); }}>{group.label}</button>)}<span>{refined ? 'Aのホームを改善' : derived ? portrait ? '基準 560 × 760 px' : '基準 760 × 560 px' : '最初の比較案'}</span></nav>
      <div className="variant-switcher"><button aria-label="前の案" onClick={() => changeVariant(adjacentVariant(variant, -1))}>←</button>{variantGroup.variants.map(v => <button key={v} className={variant === v ? 'selected' : ''} aria-label={`${v}：${variantNames[v]}`} aria-pressed={variant === v} onClick={() => changeVariant(v)}>{v}</button>)}<button aria-label="次の案" onClick={() => changeVariant(adjacentVariant(variant, 1))}>→</button></div>
      {variant === 'A5' ? <PcStylePicker style={pcStyle} change={changePcStyle}/> : <div className="variant-caption"><strong>{variantNames[variant]}</strong><small>{trial ? `計測中 · 移動 ${trial.moves}回 / ${Math.round(trial.scroll)}px` : composed ? 'スイッチ：スリム' : '架空データ / ← → キーで16案を比較'}</small></div>}
      <button className={`compare-button ${trial ? 'recording' : ''}`} onClick={() => setModal('compare')}>{trial ? '計測を記録' : '比べ方・記録'}</button><button className="reset-button" aria-label="初期状態に戻す" title="初期状態に戻す" onClick={() => setModal('reset')}>↺</button>
    </footer>
    {modal && <Modal title={{ preview: '表示プレビュー', guide: 'スマホ接続の案内', compare: '使い心地を比べる', reset: '初期状態に戻す', pc: 'PC状態' }[modal]} close={() => setModal(null)}>
      {modal === 'pc' && <PcStatusDetails load={pcLoad} change={setPcLoad}/>}
      {modal === 'preview' && <Preview feature={feature} values={values} />}
      {modal === 'guide' && <><p className="modal-intro">{feature?.id === 'outdoor' ? 'Android外配信' : 'スマホ音声再生'}の接続手順</p><ol className="guide-steps"><li><strong>PCとスマホを同じネットワークへ</strong><p>同一LAN、または配信者自身のTailscaleへ接続します。</p></li><li><strong>{feature?.id === 'outdoor' ? '外配信用QRで登録' : 'スマホ音声再生の公開をオン'}</strong><p>{feature?.id === 'outdoor' ? 'PCで登録情報を表示し、Androidクライアントで読み取ります。' : '接続方法に合わせてLAN公開またはTailscale公開を選びます。'}</p></li><li><strong>{feature?.id === 'outdoor' ? 'OBSの受信設定を確認' : 'スマホでコメント用URLを開く'}</strong><p>{feature?.id === 'outdoor' ? '準備したSRT入力で受信します。' : '読み上げをオンにして、音声再生を開始します。'}</p></li></ol><p className="sample-note">これは操作比較用の案内です。接続先・QR・通信は生成しません。</p></>}
      {modal === 'reset' && <><p>試作の設定・比較記録を初期状態へ戻します。</p><div className="dialog-actions"><button onClick={() => setModal(null)}>キャンセル</button><button className="primary" onClick={reset}>初期状態に戻す</button></div></>}
      {modal === 'compare' && <>
        <p className="modal-intro">同じ操作を各案で試し、迷った場所を残せます。</p>
        {refined && <section className="demo-scenarios"><h3>A改良案で試す状態</h3><button onClick={() => { update('speechOn', true); update('demoSpeechReady', false); setFeatureId(null); setAPage('home'); setModal(null); }}>読み上げの準備中</button><button onClick={() => { update('aiOn', true); update('demoAiHold', true); setFeatureId(null); setAPage('home'); setModal(null); }}>AIの手動再開待ち</button><button onClick={() => { update('demoSpeechReady', true); update('demoAiHold', false); setWarning(true); setFeatureId(null); setAPage('home'); setModal(null); }}>コメントの接続エラー</button></section>}
        {trial ? <><div className="trial-summary"><strong>{trial.variant} · {trial.task}</strong><p>移動 {trial.moves}回 · スクロール {Math.round(trial.scroll)}px</p></div><label className="field">迷った場所・良かった点<textarea value={note} onChange={e => setNote(e.target.value)} placeholder="例：音声の場所がすぐ分かった" /></label><div className="dialog-actions"><button onClick={() => setModal(null)}>計測を続ける</button><button className="primary" onClick={() => { setRecords(r => [...r, { ...trial, note }]); setTrial(null); setNote(''); }}>この結果を記録</button></div></> : <><label className="field">試す操作<select value={task} onChange={e => setTask(e.target.value)}>{scenarios.map(s => <option key={s}>{s}</option>)}</select></label><button className="primary" onClick={beginTrial}>この案で計測を始める</button></>}
        <p className="sample-note">移動はメニュー・設定画面への遷移回数。スクロールは本文領域の移動距離の合計です。計測開始時は入口に戻り、設定値は維持します。再読み込みで記録は消えます。</p>
        {records.length > 0 && <section className="trial-records"><h3>比較記録</h3>{records.map((r, i) => <article key={i}><strong>{r.variant} · {r.task}</strong><small>移動 {r.moves}回 / {Math.round(r.scroll)}px</small><p>{r.note || 'メモなし'}</p></article>)}</section>}
        <details className="debug-state"><summary>試作の状態を見る</summary><pre>{JSON.stringify({ variant, pcStyle, pcLoad, category, featureId, purpose, warning, values, trial, records }, null, 2)}</pre></details>
      </>}
    </Modal>}
  </div>;
}

function Editor({ feature, slimSwitches, values, update, simulate, openModal, warning, resolve }: {
  slimSwitches: boolean;
  feature: Feature; values: Values; update(key: string, value: string | boolean): void; simulate(message: string): void;
  openModal(value: 'preview' | 'guide'): void; warning: boolean; resolve(): void;
}) {
  return <section className="editor">
    {feature.id === 'sources' && <div className="connection-status">{[['YouTube Live', 'demoYoutubeConnected'], ['Twitch', 'demoTwitchConnected'], ['したらば', 'demoShitarabaConnected']].map(([name, key]) => <span key={key} className={`pill ${name === 'Twitch' && warning ? 'warn' : values[key] !== false ? 'good' : ''}`}>{name} {name === 'Twitch' && warning ? '接続エラー' : values[key] !== false ? '接続中' : '停止中'}</span>)}</div>}
    {feature.fields.map(field => field.kind === 'toggle' && slimSwitches ? <div className="toggle-field slim-toggle-field" key={field.key}><div><span>{field.label}</span>{field.help && <small>{field.help}</small>}</div><DemoSwitch appearance="slim" name={field.label} on={Boolean(values[field.key])} change={() => update(field.key, !values[field.key])}/></div> : <label className={field.kind === 'toggle' ? 'toggle-field' : 'field'} key={field.key}>
      <span>{field.label}</span>
      {field.kind === 'toggle' ? <input type="checkbox" role="switch" checked={Boolean(values[field.key])} onChange={e => update(field.key, e.target.checked)} /> : field.kind === 'select' ? <select value={String(values[field.key])} onChange={e => update(field.key, e.target.value)}>{field.options!.map(o => <option key={o}>{o}</option>)}</select> : field.kind === 'textarea' ? <textarea rows={3} value={String(values[field.key])} onChange={e => update(field.key, e.target.value)} /> : <input id={`prototype-field-${field.key}`} type={field.kind === 'number' ? 'number' : 'text'} min={field.min} max={field.max} step={field.step} value={String(values[field.key])} onChange={e => update(field.key, e.target.value)} />}
      {field.help && <small>{field.help}</small>}
    </label>)}
    <div className="editor-actions">
      {feature.id === 'sources' && <button className="primary" onClick={resolve}>Twitchに再接続</button>}
      {feature.id === 'speech' && <button onClick={() => simulate('試聴を再現しました。音声は出ません')}>声を試す</button>}
      {feature.id === 'recognition' && <button className="primary" onClick={() => simulate('音声認識設定を適用しました')}>設定を適用</button>}
      {feature.id === 'ai' && <button className="primary" onClick={() => simulate('人格を保存しました')}>人格を保存</button>}
      {feature.preview && <button onClick={() => openModal('preview')}>プレビューを開く</button>}
      {feature.guide && <button className="primary" onClick={() => openModal('guide')}>接続の案内を開く</button>}
    </div>
    <p className="sample-note">変更は比較用画面の中だけに反映されます。</p>
  </section>;
}

function Preview({ feature, values }: { feature?: Feature; values: Values }) {
  const font = Math.max(8, Math.min(200, Number(values[feature?.id === 'commentList' ? 'listFontSize' : 'fontSize']) || 28));
  return <><p className="modal-intro">{feature?.name} · サンプル</p><div className="preview-canvas">
    {feature?.id === 'character' ? <div className="character-sample"><svg viewBox="0 0 120 120" width="140" aria-label="サンプルキャラクター" role="img"><path d="M25 48 20 16 48 33Q60 27 72 33L100 16 95 48Q111 100 60 105 9 100 25 48" fill="#a5cbbf"/><circle cx="43" cy="64" r="4" fill="#182b29"/><circle cx="77" cy="64" r="4" fill="#182b29"/><path d="M53 78q7 8 14 0" fill="none" stroke="#182b29" strokeWidth="3"/></svg><small>画像は試作用です</small></div> : feature?.id === 'effects' ? <p className="effect-preview">{String(values.effectText)}</p> : feature?.id === 'recognition' ? <p>今日はゆっくり話していきます。</p> : <div className="sample-comment" style={{ fontSize: font }}>{values.showAuthor && <small>はるか</small>}こんばんは！ 今日も楽しみにしていました。</div>}
  </div><p className="sample-note">現在の試作設定を使った表示例です。</p></>;
}
