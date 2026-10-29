import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import './styles.css';

// Throwaway: three structurally different initial-setup layouts. All actions are local simulations.
const variants = ['A', 'B', 'C'] as const;
type Variant = typeof variants[number];
type Topic = 'comments' | 'speech' | 'obs';
type Status = 'idle' | 'busy' | 'ready' | 'waiting' | 'error';
const topics: Topic[] = ['comments', 'speech', 'obs'];
const names = { A: '手順をまとめて見渡す', B: 'ひとつずつ進める', C: '設定と確認を並べる' };
const labels = { comments: 'コメント接続', speech: '読み上げ', obs: 'OBS表示' };
const titles = { comments: 'コメントを受け取る', speech: '好きな声で読み上げる', obs: '配信画面にコメントを表示する' };
const descriptions = { comments: '使うサービスに接続して、コメントをひとつの画面に集めます。', speech: 'VOICEVOXを準備して、テスト音声を聞いてみましょう。', obs: 'OBSへの接続と追加を済ませ、実際の表示を確かめます。' };
const sectionTitles = { comments: ['サービスと接続先を選ぶ', '接続して状態を確かめる', '受け取れる状態を確認する'], speech: ['VOICEVOXを準備する', '声を選んで試聴する', '新着コメントの読み上げを使う'], obs: ['このPCのOBSに接続する', 'コメント表示をOBSに追加する', 'OBSでテスト表示を確認する'] };
const confirmations = { comments: 'コメントの接続状態を確認できた', speech: 'テスト音声が聞こえた', obs: 'OBSにテストコメントが表示された' };
const statusLabels: Record<Status, string> = { idle: 'まだ操作していません', busy: '処理しています…', ready: '準備できました', waiting: '配信開始待ち', error: '確認が必要です' };

function App() {
  const query = new URLSearchParams(location.search);
  const [variant, setVariant] = useState<Variant>(variants.includes(query.get('variant') as Variant) ? query.get('variant') as Variant : 'A');
  const [topic, setTopic] = useState<Topic>(topics.includes(query.get('topic') as Topic) ? query.get('topic') as Topic : 'comments');
  const [stage, setStage] = useState(0);
  const [light, setLight] = useState(false);
  const [service, setService] = useState('YouTube');
  const [targets, setTargets] = useState<Record<string, string>>({ YouTube: '@casmate_sample', Twitch: 'casmate_sample', '掲示板': 'https://jbbs.shitaraba.net/bbs/read.cgi/example/123/456/' });
  const [voice, setVoice] = useState('ずんだもん');
  const [style, setStyle] = useState('ノーマル');
  const [fontSize, setFontSize] = useState('32');
  const [displayMode, setDisplayMode] = useState('積み上げ');
  const [port, setPort] = useState('4455');
  const [password, setPassword] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [engine, setEngine] = useState(false);
  const [registered, setRegistered] = useState(false);
  const [played, setPlayed] = useState(false);
  const [tested, setTested] = useState(false);
  const [confirmed, setConfirmed] = useState<Record<Topic, boolean>>({ comments: false, speech: false, obs: false });
  const [states, setStates] = useState<Record<Topic, Status>>({ comments: 'idle', speech: 'idle', obs: 'idle' });
  const [scenario, setScenario] = useState('normal');
  const [modal, setModal] = useState(false);
  const [toast, setToast] = useState('');
  const [finished, setFinished] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dialog = useRef<HTMLDialogElement>(null);
  const entry = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const status = states[topic];
  const busy = Object.values(states).includes('busy');
  const invalidate = (target: Topic) => setConfirmed(s => ({ ...s, [target]: false }));
  const notify = (message: string) => { clearTimeout(toastTimer.current); setToast(message); toastTimer.current = setTimeout(() => setToast(''), 4000); };
  const choose = (value: Topic) => { setTopic(value); setStage(0); setFinished(false); setModal(false); };
  useEffect(() => {
    const url = new URL(location.href); url.searchParams.set('variant', variant); url.searchParams.set('topic', topic); history.replaceState(null, '', url);
  }, [variant, topic]);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [topic, stage, finished]);
  useEffect(() => { if (modal) dialog.current?.showModal(); else dialog.current?.close(); }, [modal]);
  useEffect(() => () => { clearTimeout(timer.current); clearTimeout(toastTimer.current); }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.closest('input,textarea,select,button,dialog,[contenteditable]')) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault(); setVariant(v => variants[(variants.indexOf(v) + (event.key === 'ArrowRight' ? 1 : 2)) % 3]);
      }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, []);
  const run = (kind: 'connect' | 'engine' | 'play' | 'register' | 'test') => {
    if (busy) return;
    const target = topic; invalidate(target); setStates(s => ({ ...s, [target]: 'busy' }));
    timer.current = setTimeout(() => {
      if (scenario === 'error') { setStates(s => ({ ...s, [target]: 'error' })); return; }
      setStates(s => ({ ...s, [target]: scenario === 'waiting' && target === 'comments' && service === 'YouTube' ? 'waiting' : 'ready' }));
      if (kind === 'engine') setEngine(true);
      if (kind === 'play') setPlayed(true);
      if (kind === 'register') { setRegistered(true); setModal(false); entry.current?.focus(); }
      if (kind === 'test') setTested(true);
      notify('見本の操作を反映しました');
    }, 850);
  };
  const message = status === 'error' ? ({ comments: '接続できませんでした。接続先を確認して、もう一度お試しください。', speech: '音声を準備できませんでした。VOICEVOXの起動状態を確認してください。', obs: 'OBSへの操作を完了できませんでした。OBSの接続情報と起動状態を確認してください。' })[topic]
    : status === 'waiting' ? 'YouTubeの配信開始を待っています。正常な待機です。このまま次へ進めます。'
      : status === 'ready' ? ({ comments: '接続できました。新しいコメントが届くと一覧に表示されます。', speech: played ? '試聴の操作が完了しました。音が聞こえたか、ご自身で確認してください。' : 'VOICEVOXの準備ができました。声を選んで試聴してください。', obs: tested ? 'テストを送信しました。OBS上の表示をご自身で確認してください。' : registered ? 'OBSへの追加が済みました。次にテスト表示を確認してください。' : 'OBSに接続できました。次にコメント表示を追加してください。' })[topic]
        : status === 'busy' ? '操作が終わるまで少しお待ちください。' : ({ comments: '接続先を入力し、「接続する」を押してください。', speech: 'まずVOICEVOXをインストールして起動します。', obs: 'OBSを起動し、接続情報を入力してください。' })[topic];
  const readyForCheck = topic === 'comments' ? ['ready', 'waiting'].includes(status) : topic === 'speech' ? played && status === 'ready' : tested && status === 'ready';
  const feedback = <div className="feedback" data-tone={status} role="status"><strong>{status === 'ready' ? '✓ ' : status === 'error' ? '! ' : ''}{statusLabels[status]}</strong><span>{message}</span></div>;
  const changeSource = (value: string) => { setService(value); invalidate('comments'); setStates(s => ({ ...s, comments: 'idle' })); };
  function content(index: number): ReactNode {
    if (topic === 'comments') return [
      <div key="source"><div className="choices" aria-label="コメントを取得するサービス">{['YouTube', 'Twitch', '掲示板'].map(s => <button key={s} aria-pressed={service === s} onClick={() => changeSource(s)}>{s}</button>)}</div>
        <label>{service === 'YouTube' ? 'YouTubeの配信URL または @ハンドル' : service === 'Twitch' ? 'Twitchのチャンネル名 または URL' : '掲示板のスレッドURL'}<input value={targets[service]} onChange={e => { setTargets(s => ({ ...s, [service]: e.target.value })); invalidate('comments'); setStates(s => ({ ...s, comments: 'idle' })); }} /></label>
        <p className="hint">{service === 'YouTube' ? '例：@あなたのハンドル。配信前でも設定できます。' : service === 'Twitch' ? '例：チャンネル名。配信中でなくても接続できます。' : 'したらば／jpnknの、読みたいスレッドのURLを貼り付けます。'}</p></div>,
      <div key="connect"><p>入力したサービスに接続します。ログインは不要です。</p><button className="primary" disabled={busy || !targets[service].trim()} onClick={() => run('connect')}>{busy ? '接続しています…' : status === 'error' ? 'もう一度接続する' : '接続する'}</button>{feedback}</div>,
      <div key="check"><p>「接続済み」またはYouTubeの「配信開始待ち」になれば、次へ進めます。</p><div className="sample-comment"><span className="avatar">見</span><div><strong>視聴者の名前</strong><p>こんにちは！ 配信を楽しみにしています。</p><small>表示イメージ・受信したコメントではありません</small></div></div></div>,
    ][index];
    if (topic === 'speech') return [
      <div key="prepare"><p>VOICEVOXは、コメントを声にするための無料ソフトです。</p><a href="https://voicevox.hiroshiba.jp/" target="_blank" rel="noreferrer">公式サイトでWindows版を入手 ↗</a><p className="hint">インストール後にVOICEVOXを起動してください。</p><button className="primary" disabled={busy} onClick={() => run('engine')}>{engine ? '✓ VOICEVOXの準備済み' : 'VOICEVOXの起動を確認する'}</button><details><summary>自動で見つからない場合</summary><p>通常画面ではVOICEVOXの実行ファイルを選択できます。</p><button onClick={() => run('engine')} disabled={busy}>実行ファイルを選ぶ（見本）</button></details></div>,
      <div key="voice"><div className="fields"><label>話者<select value={voice} onChange={e => { setVoice(e.target.value); setPlayed(false); invalidate('speech'); }}><option>ずんだもん</option><option>四国めたん</option></select></label><label>スタイル<select value={style} onChange={e => { setStyle(e.target.value); setPlayed(false); invalidate('speech'); }}><option>ノーマル</option><option>あまあま</option></select></label></div><div className="sample-phrase">「これはコメント読み上げのテストです」</div><button className="primary" disabled={!engine || busy} onClick={() => run('play')}>▷ この声を試聴する</button><p className="hint">{engine ? '見本では音声は再生しません。試聴後の画面を確認できます。' : 'VOICEVOXの準備ができると試聴できます。'}</p>{feedback}</div>,
      <div key="enable"><div className="toggle-line"><div><strong>新着コメントを読み上げる</strong><p className="hint">試聴だけなら、OFFのままでも確認できます。</p></div><button role="switch" aria-checked={enabled} onClick={() => setEnabled(!enabled)}>{enabled ? 'ON' : 'OFF'}</button></div><p>音が聞こえない場合は、Windowsの音量と出力先を確認してください。</p></div>,
    ][index];
    return [
      <div key="obs-connect"><details><summary>OBS側の準備方法を見る</summary><ol><li>OBSの「ツール」→「WebSocketサーバー設定」を開きます。</li><li>サーバーと認証を有効にし、「接続情報を表示」を開きます。</li></ol></details><p className="hint">OBSに表示されたポートとパスワードを入力します。</p><div className="fields"><label>ポート<input type="number" value={port} onChange={e => { setPort(e.target.value); setRegistered(false); setTested(false); invalidate('obs'); setStates(s => ({ ...s, obs: 'idle' })); }} /></label><label>パスワード<input type="password" value={password} onChange={e => { setPassword(e.target.value); setRegistered(false); setTested(false); invalidate('obs'); setStates(s => ({ ...s, obs: 'idle' })); }} placeholder="OBSのパスワード" autoComplete="off" /></label></div><button className="primary" disabled={busy} onClick={() => run('connect')}>OBSに接続する</button>{feedback}</div>,
      <div key="obs-add"><div className="fields"><label>コメントの表示方法<select value={displayMode} onChange={e => { setDisplayMode(e.target.value); setTested(false); invalidate('obs'); }}><option>積み上げ</option><option>流れるコメント</option></select></label><label>文字サイズ<select value={fontSize} onChange={e => { setFontSize(e.target.value); setTested(false); invalidate('obs'); }}><option value="24">小さめ · 24px</option><option value="32">標準 · 32px</option><option value="40">大きめ · 40px</option></select></label></div><p>OBSで追加先のシーンを開いてから進んでください。</p><button ref={entry} className="primary" disabled={status !== 'ready' || busy} onClick={() => setModal(true)}>{registered ? '追加内容を確認する' : 'OBSに追加する…'}</button><details><summary>URLを手動で登録する場合</summary><p>OBSで「＋」→「ブラウザ」を選び、通常画面のOBS用URLを指定します。</p><code>http://127.0.0.1:3000/overlay/comments</code><p className="hint">見本用のURLです。実際の登録には使いません。</p></details></div>,
      <div key="obs-test"><p>テストコメントを送り、OBSで文字・位置・大きさを確かめます。</p><button className="primary" disabled={!registered || busy} onClick={() => run('test')}>テストコメントを表示する</button><p className="hint">{registered ? 'テスト送信と、OBSに表示されたことの確認は別です。' : '先にコメント表示をOBSへ追加してください。'}</p><div className="mini-preview"><span>OBSで確かめる表示のイメージ</span><div style={{ fontSize: Number(fontSize) * .65 }}>視聴者：こんにちは！</div></div></div>,
    ][index];
  }
  const check = <label className="confirmation"><input type="checkbox" disabled={!readyForCheck || busy} checked={confirmed[topic]} onChange={e => setConfirmed(s => ({ ...s, [topic]: e.target.checked }))} /><span>{confirmations[topic]}<small>{readyForCheck ? 'ご自身で確かめてからチェックしてください。' : '上の準備とテストを済ませると確認できます。'}</small></span></label>;
  const card = (index: number) => <section className="step-card" key={`${topic}-${index}`}><div className="section-title"><span className="number">{index + 1}</span><h2>{sectionTitles[topic][index]}</h2></div>{content(index)}{index === 2 && check}</section>;
  const next = () => { if (finished) notify('確認結果を見ました。見本は繰り返し比較できます'); else if (variant === 'B' && stage < 2) setStage(stage + 1); else if (topic !== 'obs') choose(topics[topics.indexOf(topic) + 1]); else setFinished(true); };
  return <div className="prototype" data-theme={light ? 'light' : 'dark'}>
    <header className="app-header"><strong><span className="brand-icon">▤</span> きゃすメイト</strong><div className="toast" role="status" title={toast}>{toast && `✓ ${toast}`}</div><small>✓ 接続済みの表示例</small></header>
    <nav className="app-nav" aria-label="アプリのナビゲーション"><span>ホーム</span><span>配信準備</span><span>配信中</span><span className="selected">設定</span></nav>
    <main><div className="setup-top"><div><div className="eyebrow">はじめての設定 <span>画面見本</span></div><h1 ref={heading} tabIndex={-1}>{finished ? 'ここまでの設定を確認しましょう' : titles[topic]}</h1></div><button className="quiet" onClick={() => notify('続きは「設定 → アプリ設定」から再開する想定です')}>中断する</button></div>
      <nav className="topic-nav" aria-label="設定する機能">{topics.map((item, index) => <button key={item} aria-current={topic === item ? 'step' : undefined} onClick={() => choose(item)}><span>{confirmed[item] ? '✓' : index + 1}</span>{labels[item]}</button>)}</nav>
      {finished ? <section className="step-card result"><h2>今回の確認結果</h2>{topics.map(item => <div key={item}><span>{labels[item]}</span><strong>{confirmed[item] ? '✓ 本人確認済み' : '後で確認'}</strong><button onClick={() => choose(item)}>設定を見る</button></div>)}<p>未確認の項目は、あとから続きを設定できます。</p></section> : <><p className="description">{descriptions[topic]}</p>
        {variant === 'A' && <div className="variant-a">{[0, 1, 2].map(card)}</div>}
        {variant === 'B' && <div className="variant-b"><nav className="micro-steps" aria-label="この機能の手順">{sectionTitles[topic].map((text, index) => <button key={text} aria-current={stage === index ? 'step' : undefined} onClick={() => setStage(index)}><span>{index + 1}</span>{text}</button>)}</nav>{card(stage)}<p className="hint">この機能の手順 {stage + 1} / 3 · 前の入力は戻っても残ります。</p></div>}
        {variant === 'C' && <div className="variant-c"><div>{[0, 1, 2].map(card)}</div><aside className="preview-panel"><div className="eyebrow">確認するもの</div><h2>{topic === 'comments' ? '接続先と受信の状態' : topic === 'speech' ? '試聴して声を確かめる' : 'OBSの実際の表示'}</h2>{topic === 'comments' ? <><span className="large-symbol">◉</span><strong>{service}</strong><p className="target-preview">{targets[service] || '接続先を入力してください'}</p></> : topic === 'speech' ? <><span className="large-symbol">♫</span><strong>{voice} · {style}</strong><div className="wave">▂ ▅ ▃ ▇ ▄ ▆ ▂ ▅ ▃</div><p>これはコメント読み上げのテストです</p></> : <div className="obs-scene"><small>OBS画面のイメージ</small><div style={{ fontSize: Number(fontSize) * .6 }}>視聴者：こんにちは！</div></div>}{feedback}<p className="hint">{topic === 'obs' ? 'この見本のプレビューだけでは、OBSでの表示確認は完了しません。' : '操作の結果と、次に確かめることをここにまとめます。'}</p></aside></div>}
      </>}
    </main>
    <footer className="action-bar"><div><strong>{finished ? '残りはいつでも設定できます' : confirmed[topic] ? '✓ この項目は確認済みです' : variant === 'B' ? `いま：${sectionTitles[topic][stage]}` : '準備できない項目は、後で設定できます'}</strong><small>{finished ? '見本の確認結果です。実際の設定は変わりません。' : topic === 'obs' ? '追加・テストだけではOBS配信は始まりません。' : '入力例と操作結果は画面見本です。'}</small></div><div className="footer-buttons"><button disabled={busy} onClick={() => { if (variant === 'B' && stage > 0) setStage(stage - 1); else choose(topics[Math.max(0, topics.indexOf(topic) - 1)]); }}>戻る</button><button disabled={busy} onClick={() => { if (topic === 'obs') setFinished(true); else choose(topics[topics.indexOf(topic) + 1]); }}>後で設定する</button><button className="primary" disabled={busy} onClick={next}>{finished ? '結果を確認済みにする' : variant === 'B' && stage < 2 ? '次の手順へ →' : topic === 'obs' ? '確認結果を見る →' : `次は${labels[topics[topics.indexOf(topic) + 1]]} →`}</button></div></footer>
    {import.meta.env.DEV && <div className="comparison"><div className="compare-main"><span className="compare-tag">3案比較</span><button aria-label="前の案" onClick={() => setVariant(variants[(variants.indexOf(variant) + 2) % 3])}>←</button>{variants.map(v => <button key={v} aria-pressed={v === variant} onClick={() => setVariant(v)}>{v}<span> {names[v]}</span></button>)}<button aria-label="次の案" onClick={() => setVariant(variants[(variants.indexOf(variant) + 1) % 3])}>→</button><button onClick={() => setLight(!light)}>{light ? '暗色へ' : '明色へ'}</button></div><div className="current-concept">{variant} · {names[variant]}</div><details><summary>表示例・内部状態</summary><label>操作後の表示<select value={scenario} onChange={e => setScenario(e.target.value)}><option value="normal">正常</option><option value="waiting">YouTubeの配信開始待ち</option><option value="error">失敗</option></select></label><p>架空データのみ。接続・保存・音声再生は行いません。</p><pre>{JSON.stringify({ variant, topic, stage, service, targets, voice, style, fontSize, displayMode, port, passwordEntered: Boolean(password), light, toast, enabled, engine, registered, played, tested, confirmed, states, scenario, modal, finished }, null, 2)}</pre></details></div>}
    <dialog ref={dialog} onCancel={() => setModal(false)} onClose={() => { setModal(false); entry.current?.focus(); }}><div className="dialog-title"><h2>コメント表示をOBSに追加</h2><button aria-label="閉じる" onClick={() => setModal(false)}>×</button></div><p>追加先：配信シーン（見本）</p><div className="registration-info"><strong>ブラウザソース「きゃすメイト コメント」</strong><p>OBSにコメント表示用のソースを追加します。</p></div><p className="hint">追加するまでOBS側は変更されません。見本では実際の追加は行いません。</p><button className="primary" disabled={busy} onClick={() => run('register')}>{busy ? '追加しています…' : 'このシーンに追加する'}</button>{status === 'error' && feedback}</dialog>
  </div>;
}
createRoot(document.getElementById('root')!).render(<App />);
