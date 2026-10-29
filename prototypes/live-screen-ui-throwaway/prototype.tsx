// Throwaway comparison: all actions change memory in this tab only.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { SlimSwitch } from '../../src/renderer/components/SlimSwitch';
import { managementThemeStyle } from '../../src/renderer/management-themes';
import { managementTextSizeStyle } from '../../src/renderer/management-text-sizes';
import { applyScenario, commentAt, initialState, sources, variants, type Operation, type PreviewState, type Scenario, type Variant } from './model';

type DialogKind = Operation | 'connections' | 'windows' | 'obs' | 'phone' | 'navigation' | 'state' | 'feed';
const titles: Record<DialogKind, string> = { speech: 'コメント読み上げ', ai: 'AIリスナー', recognition: '配信者音声認識',
  connections: 'コメントの接続', windows: 'ウィンドウ・設定', obs: 'OBSとの連携', phone: 'スマホ連携',
  navigation: 'ほかの画面への入口', state: '見本の状態', feed: 'コメントの表示' };
const operationLabels: Record<Operation, string> = { speech: '読み上げ', ai: 'AIリスナー', recognition: '音声認識' };
const connectionLabels = { connected: '接続済み', stopped: '停止中', error: '接続エラー' };
interface Parts { controls: ReactNode; status: ReactNode; feed: ReactNode; transcript: ReactNode; utility: ReactNode }
interface ReadingPosition { top: number; id: number | null; offset: number }

function OperationControl({ operation, checked, status, attention, onOpen, onToggle }: {
  operation: Operation; checked: boolean; status: string; attention: boolean;
  onOpen(kind: DialogKind): void; onToggle(key: Operation): void;
}) {
  return <div className="operation-cell" data-operation={operation}>
    <div className="operation-copy"><button className="operation-name" aria-label={`${titles[operation]}の設定と状態`} onClick={() => onOpen(operation)}>{operationLabels[operation]}<span aria-hidden="true"> ›</span></button>
      <span className={attention ? 'operation-status needs-attention' : 'operation-status'}>{status}</span></div>
    <SlimSwitch label={titles[operation]} checked={checked} onChange={() => onToggle(operation)} />
  </div>;
}

export function VariantA(parts: Parts) {
  return <div className="variant-layout layout-a"><div className="quick-controls">{parts.controls}</div>{parts.status}{parts.feed}{parts.transcript}{parts.utility}</div>;
}
export function VariantB(parts: Parts) {
  return <div className="variant-layout layout-b"><aside className="control-rail"><div className="rail-heading">いつもの操作</div><div className="quick-controls">{parts.controls}</div>{parts.status}{parts.utility}</aside><div className="feed-column">{parts.feed}{parts.transcript}</div></div>;
}
export function VariantC(parts: Parts) {
  return <div className="variant-layout layout-c">{parts.feed}<div className="bottom-dock"><div className="quick-controls">{parts.controls}</div>{parts.status}{parts.utility}</div></div>;
}

function Feed({ state, update, openDialog, scrollPositionRef, newComment }: {
  state: PreviewState; update(change: (previous: PreviewState) => PreviewState): void;
  openDialog(kind: DialogKind): void; scrollPositionRef: RefObject<ReadingPosition>; newComment(): void;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = scroll.current;
    if (!node) return;
    if (state.follow) node.scrollTop = node.scrollHeight;
    else {
      const position = scrollPositionRef.current;
      const row = [...node.children].find(child => (child as HTMLElement).dataset.commentId === String(position.id));
      node.scrollTop = row ? node.scrollTop + row.getBoundingClientRect().top - node.getBoundingClientRect().top - position.offset : position.top;
    }
  }, [state.comments.length, state.follow, scrollPositionRef]);
  const disconnected = !sources.some(source => state.connections[source] === 'connected');
  return <section className="live-feed" aria-label="コメント一覧">
    <div className="feed-heading"><h1>コメント</h1><div className="feed-actions"><button className="follow-button" aria-pressed={state.follow}
      onClick={() => update(previous => ({ ...previous, follow: !previous.follow, latestAction: previous.follow ? '新着への追従を停止' : '新着へ追従' }))}>{state.follow ? '↓ 新着に追従' : '↓ 最新へ戻る'}</button>
      <button className="icon-control" aria-label="コメントの表示設定" onClick={() => openDialog('feed')}>⚙</button></div></div>
    <div ref={scroll} className="comment-scroll" tabIndex={0} aria-label="コメントを読み返す" onScroll={event => {
      const node = event.currentTarget;
      const top = node.getBoundingClientRect().top;
      const row = [...node.children].find(child => child.getBoundingClientRect().bottom > top);
      scrollPositionRef.current = { top: node.scrollTop, id: row ? Number((row as HTMLElement).dataset.commentId) : null, offset: row ? row.getBoundingClientRect().top - top : 0 };
      const follow = node.scrollHeight - node.scrollTop - node.clientHeight < 24;
      if (follow !== state.follow) update(previous => ({ ...previous, follow }));
    }}>
      {state.comments.map(comment => <article className="sample-comment" data-source={comment.source} data-comment-id={comment.id} key={comment.id}>
        <div className="comment-meta"><span className="source-tag">{comment.source === 'YouTube Live' ? 'YouTube' : comment.source}</span><strong>{comment.author}</strong><time>{comment.time}</time></div>
        <p>{comment.text}</p>
      </article>)}
      {state.comments.length === 0 && <div className="feed-empty"><span aria-hidden="true">☷</span><h2>{disconnected ? 'コメントの接続から始めましょう' : '新着コメントを待っています'}</h2>
        <p>{disconnected ? '使うサービスの接続先を確認し、コメント取得をオンにします。' : '接続済みです。新しいコメントが届くとここに表示します。'}</p>
        {disconnected ? <button onClick={() => openDialog('connections')}>コメントの接続を開く</button> : <button onClick={newComment}>コメントを1件受け取る</button>}
      </div>}
    </div>
    <div className="feed-foot"><span>{state.follow ? '新着コメントに追従しています' : '読み返し中 · 追従を停止しています'}</span><span>{state.comments.length}件</span></div>
  </section>;
}

export function LivePrototype() {
  const requested = new URLSearchParams(location.search).get('variant');
  const [variant, setVariant] = useState<Variant>(requested === 'B' || requested === 'C' ? requested : 'A');
  const [state, setState] = useState(initialState);
  const [width, setWidth] = useState('auto');
  const [theme, setTheme] = useState<'ocean' | 'pearl'>('ocean');
  const [dialogKind, setDialogKind] = useState<DialogKind | null>(null);
  const [scenario, setScenario] = useState<Scenario>('normal');
  const dialog = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const scrollPositionRef = useRef<ReadingPosition>({ top: 0, id: null, offset: 0 });
  const nextId = useRef(24);
  const changeVariant = useCallback((value: Variant) => {
    setVariant(value);
    const url = new URL(location.href); url.searchParams.set('variant', value); history.replaceState(null, '', url);
  }, []);
  useEffect(() => {
    const onPopState = () => { const value = new URLSearchParams(location.search).get('variant'); setVariant(value === 'B' || value === 'C' ? value : 'A'); };
    const onKey = (event: KeyboardEvent) => {
      if (dialogKind || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !(event.key === 'ArrowLeft' || event.key === 'ArrowRight')) return;
      if (event.target instanceof Element && event.target.closest('input, textarea, select, button, [role="switch"], [contenteditable="true"]')) return;
      event.preventDefault();
      changeVariant(variants[(variants.findIndex(item => item.id === variant) + (event.key === 'ArrowRight' ? 1 : 2)) % 3].id);
    };
    window.addEventListener('keydown', onKey); window.addEventListener('popstate', onPopState);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('popstate', onPopState); };
  }, [variant, dialogKind, changeVariant]);
  const addComment = useCallback(() => {
    setState(previous => {
      const active = sources.filter(source => previous.connections[source] === 'connected');
      if (!active.length) return previous;
      const id = nextId.current++;
      return { ...previous, comments: [...previous.comments, commentAt(id, active[id % active.length])].slice(-120), latestAction: '見本のコメントを1件受信' };
    });
  }, []);
  useEffect(() => { if (!state.flowing) return; const timer = setInterval(addComment, 2400); return () => clearInterval(timer); }, [state.flowing, addComment]);
  const openDialog = (kind: DialogKind) => { openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setDialogKind(kind); };
  const close = () => { dialog.current?.close(); setDialogKind(null); requestAnimationFrame(() => { if (openerRef.current?.isConnected) openerRef.current.focus(); }); };
  useEffect(() => { if (dialogKind && !dialog.current?.open) dialog.current?.showModal(); }, [dialogKind]);
  const toggle = (key: Operation) => {
    if (key === 'ai' && state.aiAttention) { openDialog('ai'); return; }
    setState(previous => ({ ...previous, operations: { ...previous.operations, [key]: !previous.operations[key] },
      latestAction: `${operationLabels[key]}を${previous.operations[key] ? 'オフ' : 'オン'}に変更` }));
  };
  const errors = sources.filter(source => state.connections[source] === 'error');
  const warningCount = errors.length + Number(state.aiAttention);
  const operationStatus = (key: Operation) => key === 'ai' && state.aiAttention ? '手動再開待ち' : !state.operations[key] ? '停止中'
    : key === 'speech' ? '新着待ち' : key === 'recognition' ? '待受中' : state.obs === 'streaming' ? '発言待機' : 'OBS配信待ち';
  const operationOrder: readonly Operation[] = variant === 'A' ? ['speech', 'recognition', 'ai'] : ['speech', 'ai', 'recognition'];
  const controls = operationOrder.map(key => <OperationControl key={key} operation={key}
    checked={state.operations[key]} status={operationStatus(key)} attention={key === 'ai' && state.aiAttention} onOpen={openDialog} onToggle={toggle} />);
  const status = <div className="connection-strip" aria-label="接続と連携の状態">
    <button className={errors.length ? 'strip-button needs-attention' : 'strip-button'} onClick={() => openDialog('connections')}>
      <span>コメント接続</span><strong>{errors.length ? `${errors[0]} 要確認` : `${sources.filter(source => state.connections[source] === 'connected').length} / 3`}</strong><span aria-hidden="true">›</span></button>
    <button className="strip-button" onClick={() => openDialog('obs')}><span>OBS</span><strong><span className={state.obs === 'streaming' ? 'status-dot' : 'status-dot stopped'} />{state.obs === 'streaming' ? '配信中' : '停止中'}</strong><span aria-hidden="true">›</span></button>
    <button className="strip-button" onClick={() => openDialog('phone')}><span>スマホ</span><strong>LAN準備済み</strong><span aria-hidden="true">›</span></button>
  </div>;
  const transcript = <div className="transcript-row"><span>認識プレビュー</span><p>{state.previewActive ? '「今日は、配信中の操作をもっと使いやすくしていきます。」' : '停止中'}</p>
    <button onClick={() => openDialog('recognition')}>{state.previewActive ? '確認・停止 ›' : '確認する ›'}</button></div>;
  const utility = <div className="utility-row"><span className={warningCount ? 'needs-attention' : ''}>{warningCount ? `要確認 ${warningCount}件` : '接続と操作の詳細は各入口から'}</span>
    <button onClick={() => openDialog('windows')}>ウィンドウ・設定 <span aria-hidden="true">›</span></button></div>;
  const parts = { controls, status, transcript, utility,
    feed: <Feed state={state} update={setState} openDialog={openDialog} scrollPositionRef={scrollPositionRef} newComment={addComment} /> };
  const selected = variants.find(item => item.id === variant)!;
  const hasConnection = sources.some(source => state.connections[source] === 'connected');
  return <div className="prototype-workbench">
    <div className="prototype-notice"><strong>操作できる見本</strong><span>架空データ · 実接続・音声・投稿なし</span><button onClick={() => openDialog('state')}>見本の状態</button></div>
    <div className="preview-stage"><div className="preview-frame" style={{ maxWidth: width === 'auto' ? '1200px' : `${width}px` }}>
      <main className="dashboard management-shell live-preview" data-variant={variant} style={{ ...managementThemeStyle(theme), ...managementTextSizeStyle('medium') }}>
        <header className="preview-header"><div className="preview-brand"><span aria-hidden="true">▤</span><strong>きゃすメイト</strong></div>
          <button className="preview-pc" onClick={() => openDialog('state')} aria-label="PC状態の見本"><span>GPU <b>24%</b></span><span>VRAM <b>3.2<span> / 8 GiB</span></b></span><span>メモリ <b>9.4<span> / 32 GiB</span></b></span></button></header>
        <nav className="preview-nav" aria-label="メインナビゲーション">{['ホーム', '配信準備', '配信中', '設定'].map(label => <button key={label} aria-current={label === '配信中' ? 'page' : undefined} onClick={() => { if (label !== '配信中') openDialog('navigation'); }}>{label}</button>)}
          <button className={`preview-warning ${warningCount ? 'needs-attention' : ''}`} onClick={() => openDialog(state.aiAttention ? 'ai' : 'connections')}>⚠ 要確認 {warningCount}件</button></nav>
        <div className="preview-live-body">{variant === 'A' ? <VariantA {...parts} /> : variant === 'B' ? <VariantB {...parts} /> : <VariantC {...parts} />}</div>
      </main>
    </div></div>
    <footer className="prototype-tools">
      <div className="variant-picker"><button aria-label="前の案" onClick={() => changeVariant(variants[(variants.findIndex(item => item.id === variant) + 2) % 3].id)}>←</button>
        <div className="variant-options">{variants.map(item => <button key={item.id} aria-pressed={variant === item.id} onClick={() => changeVariant(item.id)}><b>{item.id}</b><span>{item.name}</span>{item.id === 'A' && <small>おすすめ</small>}</button>)}</div>
        <button aria-label="次の案" onClick={() => changeVariant(variants[(variants.findIndex(item => item.id === variant) + 1) % 3].id)}>→</button></div>
      <div className="sample-tools"><label>幅<select aria-label="見本の幅" value={width} onChange={event => setWidth(event.target.value)}><option value="auto">画面に合わせる</option>{['1200','760','560','320'].map(value => <option key={value} value={value}>{value}px</option>)}</select></label>
        <label>状態<select aria-label="見本の状態を切り替える" value={scenario} onChange={event => { const value = event.target.value as Scenario; setScenario(value); setState(previous => applyScenario(previous, value)); }}><option value="normal">通常</option><option value="offline">接続エラー</option><option value="attention">AI確認待ち</option><option value="empty">初回・未接続</option></select></label>
        <button aria-pressed={state.flowing} disabled={!hasConnection && !state.flowing} onClick={() => setState(previous => ({ ...previous, flowing: !previous.flowing, latestAction: previous.flowing ? '新着の再現を停止' : '新着の再現を開始' }))}>{state.flowing ? '■ 新着を止める' : '▶ 新着を流す'}</button>
        <button disabled={!hasConnection} onClick={addComment}>＋ 1件</button><button onClick={() => setTheme(previous => previous === 'ocean' ? 'pearl' : 'ocean')}>{theme === 'ocean' ? 'ライトへ' : 'ダークへ'}</button>
        <button onClick={() => { setState(initialState()); nextId.current = 24; scrollPositionRef.current = { top: 0, id: null, offset: 0 }; setScenario('normal'); }}>リセット</button></div>
      <p className="variant-description"><strong>{selected.id} · {selected.name}</strong><span>{selected.description}</span><small aria-live="polite">{state.latestAction}</small></p>
    </footer>
    <dialog ref={dialog} className="prototype-dialog" data-theme={theme} style={{ ...managementThemeStyle(theme),
      width: width !== 'auto' && dialogKind !== 'state' ? `min(540px, ${Number(width) - 24}px, calc(100vw - 24px))` : undefined }} aria-labelledby="prototype-dialog-title" onCancel={event => { event.preventDefault(); close(); }}>
      <div className="dialog-heading"><h2 id="prototype-dialog-title">{dialogKind ? titles[dialogKind] : ''}</h2><button autoFocus onClick={close}>閉じる</button></div>
      <div className="dialog-content">
        {dialogKind === 'connections' && <><p className="dialog-intro">使うコメントソースを、個別に接続・停止します。</p>{sources.map(source => <div className="connection-detail" key={source}><div><strong>{source}</strong><p className={state.connections[source] === 'error' ? 'needs-attention' : ''}>{state.connections[source] === 'error' ? '応答がありません。接続先とネットワークを確認してください。' : connectionLabels[state.connections[source]]}</p></div>
          <SlimSwitch label={`${source}のコメント取得`} checked={state.connections[source] !== 'stopped'} onChange={enabled => setState(previous => ({ ...previous, connections: { ...previous.connections, [source]: enabled ? 'connected' : 'stopped' }, latestAction: `${source}の取得を${enabled ? '開始' : '停止'}（見本）` }))} />
          {state.connections[source] === 'error' && <button onClick={() => setState(previous => ({ ...previous, connections: { ...previous.connections, [source]: 'connected' }, latestAction: `${source}の再接続を再現` }))}>再接続</button>}</div>)}<p className="dialog-note">接続操作は見本内だけで再現します。過去のコメントは停止しても残ります。</p></>}
        {dialogKind && ['speech','ai','recognition'].includes(dialogKind) && <><div className="dialog-operation"><div><strong>{dialogKind === 'ai' && state.aiAttention ? '手動再開待ち' : operationStatus(dialogKind as Operation)}</strong><p>{dialogKind === 'speech' ? '新着コメントをVOICEVOXで読み上げます。' : dialogKind === 'ai' ? '人格・参加先・連携を確認できます。' : '配信での認識と、結果を確認するプレビューは個別に操作します。'}</p></div><SlimSwitch label={`${titles[dialogKind]}の設定`} checked={state.operations[dialogKind as Operation]} onChange={() => toggle(dialogKind as Operation)} /></div>
          {dialogKind === 'ai' && state.aiAttention && <div className="attention-box"><strong>投稿先の連携を確認してください</strong><p>自動では再開しません。連携の確認後、再開します。</p><button onClick={() => setState(previous => ({ ...previous, aiAttention: false, operations: { ...previous.operations, ai: true }, latestAction: '確認後のAI手動再開を再現' }))}>確認して再開する（見本）</button></div>}
          {dialogKind === 'recognition' && <button onClick={() => setState(previous => ({ ...previous, previewActive: !previous.previewActive, latestAction: `認識プレビューを${previous.previewActive ? '停止' : '開始'}（見本）` }))}>{state.previewActive ? 'プレビューを停止' : 'プレビューを開始'}</button>}
          <p className="dialog-note">この見本では音声出力・音声入力・AI生成を行いません。切替と状態表示の位置を確認できます。</p></>}
        {dialogKind === 'windows' && <><p>コメントを別ウィンドウで見る場合や、表示を調整する場合の入口です。</p>{(['comments','character'] as const).map(key => <div className="connection-detail" key={key}><div><strong>{key === 'comments' ? 'コメント一覧' : 'キャラクター'}</strong><p>{state.windows[key] ? '表示中（見本）' : '閉じています'}</p></div><button onClick={() => setState(previous => ({ ...previous, windows: { ...previous.windows, [key]: !previous.windows[key] }, latestAction: '独立ウィンドウの表示切替を再現' }))}>{state.windows[key] ? '閉じる' : '開く'}</button></div>)}<button onClick={() => setDialogKind('feed')}>一覧の表示設定 ›</button><p className="dialog-note">実際のウィンドウは開かず、表示状態の切替だけを再現します。</p></>}
        {dialogKind === 'obs' && <><div className="detail-facts"><span>OBS接続</span><strong>接続済み</strong><span>OBS配信</span><strong>{state.obs === 'streaming' ? '配信中' : '停止中'}</strong></div><p>OBS配信の実際の状態を表示する領域です。画面名の「配信中」とは独立しています。</p><p className="dialog-note">架空の状態です。この見本からOBS配信は操作しません。</p></>}
        {dialogKind === 'phone' && <><div className="detail-facts"><span>ネットワーク</span><strong>家庭内LAN</strong><span>PCでの接続準備</span><strong>準備済み</strong><span>端末の実接続</span><strong>未確認</strong></div><p>接続準備とスマホの送信・OBSでの表示は別の操作です。</p><p className="dialog-note">登録・QR発行・ネットワーク公開は行いません。</p></>}
        {dialogKind === 'feed' && <><p>コメント一覧の外観・表示項目の設定へ進む入口です。</p><div className="dialog-operation"><span>新着への追従</span><SlimSwitch label="新着への追従" checked={state.follow} onChange={follow => setState(previous => ({ ...previous, follow, latestAction: '追従設定を変更' }))} /></div><p className="dialog-note">見本では表示設定の入口と追従操作を確認できます。</p></>}
        {dialogKind === 'navigation' && <><p>この比較見本は「配信中」の配置を検討するためのものです。</p><p>ホーム・配信準備・設定は、現在のアプリの構成を維持する想定です。</p><button onClick={close}>配信中の見本に戻る</button></>}
        {dialogKind === 'state' && <><p>すべて、このタブのメモリ内だけで扱う架空の状態です。案を切り替えても共用し、再読み込みすると初期状態に戻ります。</p><label>OBS状態の再現<select value={state.obs} onChange={event => setState(previous => ({ ...previous, obs: event.target.value as PreviewState['obs'], latestAction: 'OBS状態の見本を変更' }))}><option value="streaming">配信中</option><option value="stopped">停止中</option></select></label><pre>{JSON.stringify({ variant, width, theme, scenario, ...state }, null, 2)}</pre></>}
      </div>
    </dialog>
  </div>;
}
