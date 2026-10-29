// Throwaway UI exploration. A: direct URL library; B: selection + guided setup.
// No application API, external connection, OBS mutation, or persistent settings.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ManagementEditorHeading } from '../shared/ManagementEditorHeading';
import { ManagementWarnings } from '../../src/renderer/components/ManagementWarnings';

const sources = [
  { id: 'comments', title: 'コメント', short: '視聴者のコメント', description: 'YouTube・Twitch・したらばのコメントをまとめて表示。', icon: 'comment', path: '/overlay/comments', hint: 'コメントの表示方法や外観は「OBSコメント表示」で調整できます。' },
  { id: 'speech', title: '音声認識', short: 'あなたの話した言葉', description: '配信者の発話を認識し、文字で表示。', icon: 'speech', path: '/overlay/speech-recognition', hint: '「配信者音声認識」をオンにすると、認識した言葉が表示されます。' },
  { id: 'character', title: 'キャラクター', short: '読み上げに合わせた口パク', description: 'コメント読み上げに合わせて動くキャラクター。', icon: 'character', path: '/overlay/character', hint: '画像や動きは「キャラクター」で設定できます。' },
  { id: 'effects', title: '文字演出', short: 'コメントに反応する演出', description: '反応ワードに合わせて、文字や絵文字を降らせます。', icon: 'effects', path: '/overlay/text-effects', hint: '反応ワードや演出内容は「コメント文字演出」で設定できます。' },
] as const;
type Source = typeof sources[number];
type Variant = 'A' | 'B';
const names = { A: '一覧からコピー', B: '選んで追加' };
const browserLinks = [{ title: '管理画面', path: '' }, { title: 'コメント一覧', path: '/comments' }];
function Icon({ name }: { name: string }) {
  return <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === 'comment' && <><path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 3v-3a2 2 0 0 1-2-2V7a3 3 0 0 1 3-3Z"/><path d="M7 9h10M7 13h7"/></>}
    {name === 'speech' && <><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8"/></>}
    {name === 'character' && <><path d="m4 9 1-6 5 3h4l5-3 1 6v7a6 6 0 0 1-6 5h-4a6 6 0 0 1-6-5Z"/><path d="M8 12v2M16 12v2m-6 3 2 1 2-1"/></>}
    {name === 'effects' && <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5ZM20 2v4M18 4h4"/></>}
    {name === 'copy' && <><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V3H3v13h5"/></>}
  </svg>;
}
function Steps() {
  return <ol className="ou-steps"><li><b>1</b><span>OBSの「ソース」で <strong>＋ → ブラウザ</strong> を選ぶ</span></li><li><b>2</b><span>名前を付け、<strong>URL欄に貼り付ける</strong></span></li><li><b>3</b><span>幅・高さを表示範囲に合わせ、<strong>OK</strong> を押す</span></li></ol>;
}
export function Prototype() {
  const [variant, setVariant] = useState<Variant>(() => new URLSearchParams(location.search).get('variant') === 'B' ? 'B' : 'A');
  const [selected, setSelected] = useState(0);
  const [page, setPage] = useState<'editor' | 'settings' | 'home'>('editor');
  const [origin, setOrigin] = useState<'settings' | 'home'>('settings');
  const [port, setPort] = useState('3000');
  const [savedPort, setSavedPort] = useState('3000');
  const [activePort, setActivePort] = useState('3000');
  const [failure, setFailure] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [noticeRevision, setNoticeRevision] = useState(0);
  const publishNotice = useCallback((message: string) => { setNotice(message); setNoticeRevision(value => value + 1); }, []);
  const [lastCopy, setLastCopy] = useState('');
  const [modal, setModal] = useState<{ title: string; source?: Source; url?: string } | null>(null);
  const [width, setWidth] = useState('full');
  const [toolsOpen, setToolsOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const scrollPosition = useRef(0);
  const invalidPort = !/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535;
  const current = sources[selected];
  const urlFor = (path: string) => `http://127.0.0.1:${activePort}${path}`;
  const switchVariant = (value: Variant) => { setVariant(value); const url = new URL(location.href); url.searchParams.set('variant', value); history.replaceState(null, '', url); };
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (dialog.current?.open || (event.target instanceof HTMLElement && event.target.closest('input,textarea,select,button,summary,[contenteditable]'))) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); switchVariant(variant === 'A' ? 'B' : 'A'); }
    };
    window.addEventListener('keydown', handle); return () => window.removeEventListener('keydown', handle);
  }, [variant]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 4000); return () => clearTimeout(timer); }, [notice, noticeRevision]);
  useEffect(() => {
    if (port === savedPort || invalidPort) return;
    const timer = setTimeout(() => {
      if (failure) setError('ポート設定を保存できませんでした。入力値を確認し、再保存してください。');
      else { setSavedPort(port); setError(''); publishNotice('✓ ポート設定を保存しました（見本）'); }
    }, 500);
    return () => clearTimeout(timer);
  }, [port, savedPort, invalidPort, failure, publishNotice]);
  useEffect(() => { if (modal) dialog.current?.showModal(); }, [modal]);
  const show = (value: NonNullable<typeof modal>) => { trigger.current = document.activeElement as HTMLElement; setModal(value); };
  const close = () => { dialog.current?.close(); setModal(null); trigger.current?.focus(); };
  const copy = async (title: string, path: string) => {
    if (failure) { setError('URLをコピーできませんでした。表示されているURLを選択してコピーしてください。'); return; }
    try { await navigator.clipboard.writeText(urlFor(path)); setLastCopy(urlFor(path)); setError(''); publishNotice(`✓ ${title}のURLをコピーしました`); }
    catch { setError('URLをコピーできませんでした。表示されているURLを選択してコピーしてください。'); }
  };
  const openEditor = (from: 'home' | 'settings') => { scrollPosition.current = body.current?.scrollTop ?? 0; setOrigin(from); setPage('editor'); requestAnimationFrame(() => { if (body.current) body.current.scrollTop = 0; document.getElementById('editor-heading')?.focus(); }); };
  const back = () => { setPage(origin); requestAnimationFrame(() => { if (body.current) body.current.scrollTop = scrollPosition.current; document.getElementById('ou-entry')?.focus(); }); };
  const sourceActions = (source: Source) => <div className="ou-actions"><button className="ou-copy" onClick={() => void copy(source.title, source.path)} aria-label={`${source.title}のURLをコピー`}><Icon name="copy"/>コピー</button><button className="ou-quiet" onClick={() => show({ title: `${source.title}の表示例`, source })} aria-label={`${source.title}の表示例を見る`}>表示例 ↗</button></div>;
  const extras = <div className="ou-extras">
    <details><summary><span>ブラウザで使う画面<small>管理画面・コメント一覧</small></span><span aria-hidden="true">＋</span></summary><div className="ou-detail-body">{browserLinks.map(item => <div className="ou-browser-row" key={item.title}><div><strong>{item.title}</strong><code>{urlFor(item.path)}</code></div><div className="ou-actions"><button onClick={() => void copy(item.title, item.path)} aria-label={`${item.title}のURLをコピー`}>コピー</button><button onClick={() => show({ title: `${item.title}をブラウザで開く`, url: urlFor(item.path) })}>開く ↗</button></div></div>)}</div></details>
    <details><summary><span>アプリ設定<small>ポート・バージョン・更新手順</small></span><span aria-hidden="true">＋</span></summary><div className="ou-detail-body ou-app-grid"><section><label htmlFor="ou-port">バックエンドポート</label><input id="ou-port" type="number" min="1024" max="65535" value={port} aria-invalid={invalidPort} aria-describedby="ou-port-hint" onChange={event => setPort(event.target.value)}/><div className="ou-field-hint" id="ou-port-hint" data-error={invalidPort || Boolean(error)}>{invalidPort ? '1024〜65535の整数を入力してください。' : savedPort !== activePort ? '保存済み。再起動後に有効になります。OBS側のURLも変更してください。' : '通常は変更不要です。変更は再起動後に有効になります。'}</div><p className="ou-muted">現在のURLは、起動中のポートを表示しています。</p><div className="ou-retry-slot">{error.startsWith('ポート') && <button onClick={() => { if (!invalidPort && !failure) { setSavedPort(port); setError(''); publishNotice('✓ ポート設定を再保存しました（見本）'); } }}>再保存</button>}</div></section><section><h3>きゃすメイト <span className="ou-version">v0.5.0</span></h3><p>更新版のインストーラーを上書き実行してください。</p><p className="ou-muted">自動更新とテレメトリー送信は行いません。</p></section></div></details>
  </div>;
  return <div className="ou-stage" data-width={width}><div className="dashboard management-shell ou-prototype">
    <header className="management-header"><div className="management-brand" aria-label="きゃすメイト"><span aria-hidden="true">▤</span><strong>きゃすメイト</strong></div><div className="ou-toast" role="status" aria-live="polite">{notice && <span title={notice}>{notice}</span>}</div><span className="ou-connection" aria-label="見本の接続状態：接続済み"><span aria-hidden="true">✓</span><span> 接続済み</span></span></header>
    <nav className="management-nav" aria-label="メインナビゲーション"><button aria-current={page === 'home' ? 'page' : undefined} onClick={() => setPage('home')}>ホーム</button><button aria-current={page !== 'home' ? 'page' : undefined} onClick={() => setPage('settings')}>設定</button><ManagementWarnings items={error ? [{ key: 'prototype-error', message: error }] : []}/></nav>
    <main className="management-body" ref={body}>
      {page !== 'editor' ? <div className="ou-content"><h1>{page === 'home' ? '配信のホーム' : '設定'}</h1><p className="ou-muted">比較見本の入口です。「OBS用URL」から編集画面に戻れます。</p><button className="ou-entry" id="ou-entry" onClick={() => openEditor(page)}><Icon name="copy"/><span><strong>OBS用URL</strong><small>OBSへの追加・画面リンク・アプリ設定</small></span><span>→</span></button></div> : <div className="ou-content">
        <ManagementEditorHeading title="OBS用URL" backPage={origin === 'home' ? 'ホーム' : '設定'} onBack={back} introduction={{ heading: '配信に重ねたい表示を、OBSへ', body: '使いたい表示のURLをコピーして、同じPCのOBSにブラウザソースとして追加します。' }}/>
        {variant === 'A' ? <div className="ou-a"><div className="ou-section-top"><div><h2>OBSに追加する表示</h2><p>表示ごとに、1つのブラウザソースを追加します。</p></div><span className="ou-count">4種類</span></div><section className="ou-source-list" aria-label="OBS用URL一覧">{sources.map(source => <article className="ou-source-row" key={source.id}><div className="ou-source-icon"><Icon name={source.icon}/></div><div className="ou-source-info"><h3>{source.title}</h3><p>{source.description}</p><code>{urlFor(source.path)}</code></div>{sourceActions(source)}</article>)}</section><details className="ou-guide"><summary>OBSへの追加手順<span aria-hidden="true">＋</span></summary><Steps/><p className="ou-muted">幅・高さは配信レイアウトに合わせて調整してください。</p></details></div> : <div className="ou-b"><div className="ou-section-top"><div><h2>何を配信に表示しますか？</h2><p>選んだ表示のURLと、追加の手順を確認できます。</p></div></div><div className="ou-workspace"><div className="ou-picker" aria-label="表示の選択">{sources.map((source, index) => <button key={source.id} aria-pressed={selected === index} onClick={() => setSelected(index)}><div className="ou-source-icon"><Icon name={source.icon}/></div><span><strong>{source.title}</strong><small>{source.short}</small></span><span className="ou-choice" aria-hidden="true">{selected === index ? '●' : '○'}</span></button>)}</div><section className="ou-setup" aria-label={`${current.title}の追加手順`}><div className="ou-setup-title"><span className="ou-eyebrow">OBSに追加</span><h3>{current.title}</h3><p>{current.description}</p></div><div className="ou-copy-step"><div className="ou-step-title"><span>1</span><h4>URLをコピー</h4></div><code>{urlFor(current.path)}</code><button className="ou-copy" onClick={() => void copy(current.title, current.path)}><Icon name="copy"/>URLをコピー</button></div><div className="ou-paste-step"><div className="ou-step-title"><span>2</span><h4>OBSに貼り付け</h4></div><p>「ソース」の <strong>＋ → ブラウザ</strong> で新規作成し、URL欄に貼り付けます。</p><p className="ou-muted">幅・高さを表示範囲に合わせて、OKを押してください。</p></div><div className="ou-setup-foot"><p>{current.hint}</p><button className="ou-quiet" onClick={() => show({ title: `${current.title}の表示例`, source: current })}>表示例を見る ↗</button></div></section></div></div>}
        <p className="ou-running-note"><span aria-hidden="true">ⓘ</span> 表示を使う間は、きゃすメイトを起動しておいてください。</p>{extras}
      </div>}
      <div className="ou-lab-note">UI比較見本 · 設定は見本内だけに保存されます。表示例は架空の内容です。</div>
    </main>
  </div><div className="ou-switcher" aria-label="比較見本の切替"><span className="ou-lab-label">UI見本</span><button aria-label="前の案" onClick={() => switchVariant(variant === 'A' ? 'B' : 'A')}>←</button>{(['A', 'B'] as const).map(key => <button key={key} aria-pressed={variant === key} onClick={() => switchVariant(key)}>{key}<span> {names[key]}</span></button>)}<button aria-label="次の案" onClick={() => switchVariant(variant === 'A' ? 'B' : 'A')}>→</button><button className="ou-tools-button" aria-expanded={toolsOpen} onClick={() => setToolsOpen(!toolsOpen)}>検証</button></div>
    {toolsOpen && <aside className="ou-lab"><div className="ou-between"><strong>見本の検証用</strong><button onClick={() => setToolsOpen(false)}>閉じる</button></div><label>表示幅<select value={width} onChange={event => setWidth(event.target.value)}><option value="full">ウィンドウ幅</option><option value="760">760px</option><option value="560">560px</option><option value="320">320px</option></select></label><label><input type="checkbox" checked={failure} onChange={event => setFailure(event.target.checked)}/>コピー・保存の失敗を再現</label><button onClick={() => { setActivePort(savedPort); publishNotice('✓ 再起動後のURLに切り替えました（見本）'); }}>見本内で再起動</button><button onClick={() => publishNotice('✓ OBS音声認識の長い名前を含むURLをコピーしました')}>長い通知を表示</button><details><summary>操作状態</summary><pre>{JSON.stringify({ variant, page, origin, selected: current.id, port, savedPort, activePort, failure, error, notice, lastCopy, modal: modal?.title ?? null }, null, 2)}</pre></details></aside>}
    <dialog ref={dialog} className="ou-modal" aria-labelledby="ou-modal-title" onCancel={event => { event.preventDefault(); close(); }}><div className="ou-between"><h2 id="ou-modal-title">{modal?.title}</h2><button autoFocus onClick={close}>閉じる</button></div>{modal?.source ? <><p className="ou-muted">配置イメージの静止見本です。実際の表示はOBSで確認してください。</p><div className={`ou-preview ${modal.source.id}`}><span className="ou-preview-label">透明背景の表示例</span>{modal.source.id === 'comments' && <div className="ou-demo-comment"><small>視聴者A</small><strong>こんばんは！今日も楽しみです</strong></div>}{modal.source.id === 'speech' && <div className="ou-demo-speech">それでは、配信を始めます。</div>}{modal.source.id === 'character' && <div className="ou-demo-character"><Icon name="character"/><span>キャラクター画像の例</span></div>}{modal.source.id === 'effects' && <div className="ou-demo-effects"><span>✨</span><span>草</span><span>👏</span><span>草</span></div>}</div><p>{modal.source.hint}</p></> : <><p>本体では、次の画面を既定ブラウザで開きます。</p><code>{modal?.url}</code><p className="ou-muted">この見本では、実際の管理画面への接続は行いません。</p></>}</dialog>
  </div>;
}
