import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { initialSetupSteps, setupStepLabels, type SetupFeature, type SetupStep, type SmartphoneUse } from '../../src/shared/initial-setup';
import './styles.css';

// Throwaway UI comparison: three different entry/selection/result structures.
// Local state only. No persistence, API, service connection, or media playback.
const variants = ['A', 'B', 'C'] as const;
type Variant = typeof variants[number];
type Screen = 'welcome' | 'features' | 'results';
type RecordState = 'confirmed' | 'configured' | 'deferred' | 'needs';
type Example = 'mixed' | 'ready' | 'attention' | 'empty';
const screens: Screen[] = ['welcome', 'features', 'results'];
const screenNames = { welcome: 'ようこそ', features: '機能選択', results: '確認結果' };
const names = { A: '一覧で見渡す', B: '質問と次の行動', C: '選択と確認を並べる' };
const features: { id: SetupFeature; title: string; description: string; symbol: string }[] = [
  { id: 'sources', title: 'コメントをまとめて見る', description: 'YouTube・Twitch・掲示板をひとつの画面に。', symbol: '◉' },
  { id: 'commentSpeech', title: 'コメントを読み上げる', description: 'VOICEVOXの声で、新しいコメントを聞く。', symbol: '♫' },
  { id: 'commentOverlay', title: 'コメントをOBSに表示', description: '配信画面にコメントを重ねる。', symbol: '▤' },
  { id: 'smartphone', title: 'スマホと連携する', description: 'コメント・読み上げ・カメラやマイクを使う。', symbol: '▯' },
  { id: 'speechRecognition', title: '配信者の声を文字にする', description: 'マイクの声を文字にし、字幕にも使う。', symbol: '♩' },
  { id: 'aiListener', title: 'AIリスナーを使う', description: '配信の会話に参加するAIを準備する。', symbol: '✦' },
  { id: 'textEffects', title: 'コメントで文字演出', description: '決めた言葉に反応して、文字や絵文字を出す。', symbol: '✧' },
  { id: 'character', title: 'キャラクターを表示', description: '画像を表示し、読み上げに合わせて口を動かす。', symbol: '♧' },
];
const basic: SetupFeature[] = ['sources', 'commentSpeech', 'commentOverlay'];
const recordNames: Record<RecordState, string> = { confirmed: '前回の動作確認済み', configured: '設定済み・動作未確認', deferred: '後で設定する', needs: '要確認' };
const nextActions: Record<SetupStep, string> = {
  sources: '接続先と、コメントを受け取れる状態を確かめます。', commentSpeech: 'VOICEVOXを起動し、試聴して声を確かめます。',
  obsControl: 'OBSの接続情報と接続状態を確かめます。', obsDisplay: 'OBS上で実際の表示・位置・大きさを確かめます。',
  smartphone: '接続する場所と、スマホで使う用途を確かめます。', speechRecognition: '入力を選び、自分の声で認識を試します。',
  aiListener: 'APIキー・人格・参加先の準備を確かめます。', textEffects: '反応する言葉と表示内容を確かめます。', character: '画像とプレビューの動きを確かめます。',
};
const mixed: Record<SetupStep, RecordState> = { sources: 'confirmed', commentSpeech: 'configured', obsControl: 'configured', obsDisplay: 'deferred', smartphone: 'deferred', speechRecognition: 'needs', aiListener: 'deferred', textEffects: 'configured', character: 'needs' };
const liveNames: Record<SetupStep, string> = { sources: 'YouTube：配信開始待ち', commentSpeech: 'VOICEVOX：準備完了 ／ 読み上げ：オフ', obsControl: 'OBS：未接続', obsDisplay: 'OBSの実表示は未確認', smartphone: '登録したスマホ：未接続', speechRecognition: '認識モデル：未準備', aiListener: 'AIの投稿：停止中', textEffects: '表示テストは未実施', character: '画像の登録が必要' };

function App() {
  const query = new URLSearchParams(location.search);
  const initialScreen = screens.includes(query.get('screen') as Screen) ? query.get('screen') as Screen : 'welcome';
  const initialExample = ['mixed', 'ready', 'attention', 'empty'].includes(query.get('example') ?? '') ? query.get('example') as Example : 'mixed';
  const [variant, setVariant] = useState<Variant>(variants.includes(query.get('variant') as Variant) ? query.get('variant') as Variant : 'A');
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const [selected, setSelected] = useState<SetupFeature[]>(initialScreen === 'results' && initialExample !== 'empty' ? basic : []);
  const [uses, setUses] = useState<SmartphoneUse[]>(['comments']);
  const [example, setExample] = useState<Example>(initialExample);
  const [records, setRecords] = useState<Record<SetupStep, RecordState>>(() => exampleRecords(initialExample));
  const [question, setQuestion] = useState(0);
  const [light, setLight] = useState(false);
  const [modal, setModal] = useState<'state' | 'route' | SetupStep | null>(null);
  const [toast, setToast] = useState('');
  const [finished, setFinished] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [entry, setEntry] = useState<HTMLElement | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const steps = initialSetupSteps({ selected, smartphoneUses: uses });
  const remaining = steps.filter(step => records[step] !== 'confirmed');
  const priority = steps.find(step => records[step] === 'needs') ?? steps.find(step => records[step] === 'configured') ?? steps.find(step => records[step] === 'deferred');
  const currentLabels: Record<SetupStep, string> = { ...liveNames, ...(example === 'attention' ? { commentSpeech: 'VOICEVOXが見つかりません' } : {}), ...(example === 'ready' ? { obsControl: 'OBS：接続済み' } : {}) };
  const invalidPhone = selected.includes('smartphone') && uses.length === 0;
  useEffect(() => {
    const url = new URL(location.href); url.searchParams.set('variant', variant); url.searchParams.set('screen', screen); url.searchParams.set('example', example); history.replaceState(null, '', url);
  }, [variant, screen, example]);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); document.querySelector('.page-scroll')?.scrollTo({ top: 0 }); }, [variant, screen, question]);
  useEffect(() => { if (modal) dialog.current?.showModal(); else { dialog.current?.close(); entry?.focus({ preventScroll: true }); } }, [modal, entry]);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.closest('input,textarea,select,button,dialog,[contenteditable]')) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setVariant(current => variants[(variants.indexOf(current) + (event.key === 'ArrowRight' ? 1 : 2)) % 3]); }
    }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, []);
  function notify(message: string) { clearTimeout(toastTimer.current); setToast(message); toastTimer.current = setTimeout(() => setToast(''), 4500); }
  function openModal(value: NonNullable<typeof modal>, element: HTMLElement) { setEntry(element); setModal(value); }
  function navigate(value: Screen) { setFinished(false); setScreen(value); }
  function toggle(id: SetupFeature) { setSelected(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]); setFinished(false); }
  function loadExample(value: Example) { setExample(value); setSelected(value === 'empty' ? [] : basic); setRecords(exampleRecords(value)); setFinished(false); }
  function primary(element: HTMLElement) {
    if (screen === 'welcome') navigate('features');
    else if (screen === 'features' && variant === 'B' && question === 0) setQuestion(1);
    else if (screen === 'features' && !selected.length) navigate('results');
    else if (screen === 'features' && !invalidPhone) openModal('route', element);
    else if (screen === 'results') { setFinished(true); notify('初回設定を終えてホームへ戻る想定です。接続や配信は開始しません。'); }
  }
  const featureChoice = (item: typeof features[number], compact = false) => <label className={`feature-choice${compact ? ' compact' : ''}`} data-selected={selected.includes(item.id)} key={item.id}>
    <input type="checkbox" checked={selected.includes(item.id)} onChange={() => toggle(item.id)} data-feature={item.id}/>
    <span className="feature-symbol" aria-hidden="true">{item.symbol}</span><span><strong>{item.title}</strong><small>{item.description}</small></span>
  </label>;
  const phoneChoices = selected.includes('smartphone') && <fieldset className="phone-uses"><legend>スマホでしたいこと</legend>{([['comments', 'コメントを見る'], ['speech', '読み上げを聞く'], ['video', 'カメラ・マイクを使う']] as const).map(([id, label]) => <label key={id}><input type="checkbox" checked={uses.includes(id)} onChange={() => setUses(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])}/>{label}</label>)}<small>{invalidPhone ? '使いたい用途を1つ以上選んでください。' : '選んだ用途に必要な準備も案内します。'}</small></fieldset>;
  const plan = <section className="surface plan"><div className="eyebrow">選ぶと、案内がまとまります</div><h2>今回の案内</h2>{steps.length ? <ol>{steps.map((step, index) => <li key={step}><span>{index + 1}</span><strong>{setupStepLabels[step]}</strong>{!selected.includes(step as SetupFeature) && <small>必要な準備</small>}</li>)}</ol> : <p className="muted">左で使いたい機能を選ぶと、必要な手順がここに並びます。</p>}<p className="hint">選択だけでは機能はONになりません。準備できない項目は、途中でも後回しにできます。</p></section>;
  const resultRow = (step: SetupStep) => <article className="result-row" data-record={records[step]} key={step}>
    <div><h3>{setupStepLabels[step]}</h3><span className="record-badge" data-record={records[step]}>{records[step] === 'confirmed' ? '✓ ' : records[step] === 'needs' ? '! ' : ''}{recordNames[records[step]]}</span><p>{records[step] === 'confirmed' ? 'ご自身で確認した記録があります。' : nextActions[step]}</p><small>現在の状態：{currentLabels[step]}</small></div>
    <button type="button" className="quiet" data-review={step} onClick={event => openModal(step, event.currentTarget)}>{records[step] === 'confirmed' ? '設定を見る' : records[step] === 'needs' ? '原因を確認する' : '続きを設定する'}<span aria-hidden="true"> →</span></button>
  </article>;

  const legend = <p className="result-note">「前回の動作確認済み」は、ご自身で確認した記録です。現在の接続やOBSの実表示とは別に確認できます。</p>;
  function resultContents(): ReactNode {
    if (!steps.length) return <section className="surface empty-result"><span aria-hidden="true">☷</span><h2>今回は、機能を選んでいません</h2><p>必要になったら「設定 → アプリ設定」から<br/>はじめての設定を開けます。</p><button className="quiet" onClick={() => navigate('features')}>使いたい機能を選び直す</button></section>;
    if (variant === 'A') return <><div className="result-intro"><strong>{steps.filter(step => records[step] === 'confirmed').length}項目に確認の記録があります</strong><span>{remaining.length ? `残り${remaining.length}項目は、ここから続けられます。` : '選んだ項目に確認の記録があります。'}</span></div>{legend}<div className="surface result-list">{steps.map(resultRow)}</div></>;
    if (variant === 'B') return <div className="guided-results"><section className="surface priority"><span className="eyebrow">次にすること</span><h2>{priority ? records[priority] === 'needs' ? 'まず、ここを確認しましょう' : '続きは、ここからできます' : '選んだ項目を確かめました'}</h2>{priority ? <><h3>{setupStepLabels[priority]}</h3><p>{nextActions[priority]}</p><p className="live-readout">現在の状態：{currentLabels[priority]}</p><button className="primary" data-priority={priority} onClick={event => openModal(priority, event.currentTarget)}>{records[priority] === 'needs' ? '原因と確認方法を見る' : 'この設定を続ける'} →</button></> : <p>普段の配信前は「配信準備」で現在の状態を確認できます。</p>}<p className="hint">今は終えても大丈夫です。続きは「設定 → アプリ設定」から開けます。</p></section><details className="surface all-results" open><summary>今回の設定をすべて見る · {steps.length}項目</summary>{legend}{steps.map(resultRow)}</details></div>;
    return <div className="split results-split"><section className="surface result-list"><h2>選んだ機能の確認結果</h2>{steps.map(resultRow)}</section><aside className="surface next-panel"><span className="eyebrow">このあと</span><h2>{priority ? '残った項目を進めますか？' : 'いつもの配信準備へ'}</h2>{priority ? <><h3>{setupStepLabels[priority]}</h3><p>{nextActions[priority]}</p><button className="primary" data-priority={priority} onClick={event => openModal(priority, event.currentTarget)}>この項目を確認する →</button><p className="hint">ここで終えて、あとから続けることもできます。</p></> : <p>ホームへ戻り、配信前は「配信準備」で状態を確認できます。</p>}<hr/><h3>続きの開き方</h3><p className="resume-path">設定 <span>›</span> アプリ設定 <span>›</span><br/>はじめての設定</p>{legend}</aside></div>;
  }
  return <div className="prototype" data-theme={light ? 'light' : 'dark'} data-variant={variant} data-screen={screen} data-finished={finished}>
    <header className="app-header"><strong><span className="brand-icon" aria-hidden="true">▤</span><span className="brand-name">きゃすメイト</span></strong><div className="toast" role="status" title={toast}>{toast && `✓ ${toast}`}</div><small>✓ 画面見本</small></header>
    <nav className="app-nav" aria-label="アプリのナビゲーション"><span>ホーム</span><span>配信準備</span><span>配信中</span><span className="selected">設定</span></nav>
    <main className="page-scroll"><div className="page-inner"><div className="setup-top"><div><div className="eyebrow">はじめての設定</div><h1 ref={heading} tabIndex={-1}>{screen === 'welcome' ? variant === 'B' ? '使いたいことを、ひとつずつ。' : 'ようこそ、きゃすメイトへ' : screen === 'features' ? variant === 'B' ? question === 0 ? 'まず、コメントをどう使いますか？' : 'ほかに使いたい機能はありますか？' : '使いたい機能を選びましょう' : 'ここまでの設定を確認しましょう'}</h1></div>{screen !== 'results' && <button className="quiet interrupt" onClick={() => notify('続きは「設定 → アプリ設定」から開けます。')}>中断する</button>}</div>
    <div className="flow-progress" aria-label="初回設定の流れ"><span data-current={screen === 'welcome'}>ようこそ</span><i>›</i><span data-current={screen === 'features'}>機能を選ぶ</span><i>›</i><span>設定・確認</span><i>›</i><span data-current={screen === 'results'}>確認結果</span></div>
    {screen === 'welcome' && (variant === 'A' ? <div className="welcome-overview"><p className="lead">使いたい機能を選ぶと、必要な準備を順番に案内します。</p><div className="welcome-examples">{features.slice(0,3).map(item => <section className="surface" key={item.id}><span className="welcome-symbol" aria-hidden="true">{item.symbol}</span><h2>{item.title}</h2><p>{item.description}</p></section>)}</div><div className="welcome-bottom"><p>スマホ・字幕・AI・演出も、必要なものだけ選べます。</p><p className="hint">途中で中断しても、あとから続けられます。今すぐ配信を始める必要はありません。</p></div></div> : variant === 'B' ? <section className="welcome-guided surface"><span className="welcome-symbol" aria-hidden="true">✦</span><h2>全部を設定しなくても、大丈夫。</h2><p className="lead">最初は、使いたいことを選ぶだけ。<br/>必要な準備を一緒に確認していきます。</p><ol className="journey"><li><span>1</span><div><strong>使いたい機能を選ぶ</strong><small>まだ迷っている項目は選ばなくても大丈夫。</small></div></li><li><span>2</span><div><strong>案内に沿って設定し、確かめる</strong><small>接続・試聴・OBSでの表示を順番に確認。</small></div></li><li><span>3</span><div><strong>残った項目を確認する</strong><small>準備ができていないものは、あとから。</small></div></li></ol></section> : <div className="split welcome-split"><section className="welcome-copy"><p className="lead">コメントを見る・声で聞く・配信画面に表示する。<br/>あなたの使い方に合わせて、準備しましょう。</p><ol className="journey"><li><span>1</span><div><strong>使いたいものだけ選ぶ</strong><small>必要な準備は自動で案内に含めます。</small></div></li><li><span>2</span><div><strong>設定と結果を並べて確かめる</strong><small>左で操作し、右で状態を確認します。</small></div></li><li><span>3</span><div><strong>確認結果を見て終える</strong><small>残った項目は、あとから続けられます。</small></div></li></ol><p className="hint">機能を選ぶだけでは、接続や読み上げは始まりません。</p></section><aside className="surface outcome"><span className="eyebrow">たとえば、こんな使い方に</span><h2>コメントが、配信のそばに。</h2><div className="stream-scene"><span>配信画面のイメージ</span><div className="scene-motif" aria-hidden="true">▧</div><div className="comment-bubble"><strong>視聴者</strong> こんにちは！</div></div><div className="outcome-caption"><span aria-hidden="true">♫</span><p>届いたコメントを、選んだ声で読み上げ。<small>イメージです。実際のコメント・音声ではありません。</small></p></div></aside></div>)}
    {screen === 'features' && <><p className="description">必要なものだけ選んでください。あとから追加・変更できます。</p>{variant === 'A' ? <><fieldset className="feature-grid"><legend>使いたい機能</legend>{features.map(item => featureChoice(item))}</fieldset>{phoneChoices}<div className="inline-plan">{steps.length ? <>今回の案内：{steps.map(step => setupStepLabels[step]).join(' → ')}</> : '何も選ばずに終えることもできます。'}</div></> : variant === 'B' ? <div className="question-layout"><nav className="question-nav" aria-label="機能選択の質問"><button aria-current={question === 0 ? 'step' : undefined} onClick={() => setQuestion(0)}>1 コメントの使い方</button><button aria-current={question === 1 ? 'step' : undefined} onClick={() => setQuestion(1)}>2 そのほかの機能</button></nav><fieldset className="question-choices"><legend>{question === 0 ? '使いたいものはいくつでも選べます' : '必要なものがあれば選んでください'}</legend>{features.filter(item => question === 0 ? basic.includes(item.id) : !basic.includes(item.id)).map(item => featureChoice(item,true))}</fieldset>{question === 1 && phoneChoices}<p className="hint">{question === 0 ? 'どれも使わない場合も、そのまま次の質問へ進めます。' : `${selected.length}機能を選択中。OBSなどの必要な準備もまとめて案内します。`}</p></div> : <div className="split select-split"><div><fieldset className="feature-rows"><legend>コメントの基本</legend>{features.filter(item => basic.includes(item.id)).map(item => featureChoice(item,true))}</fieldset><fieldset className="feature-rows extras"><legend>必要に応じて追加</legend>{features.filter(item => !basic.includes(item.id)).map(item => featureChoice(item,true))}</fieldset>{phoneChoices}</div><aside>{plan}</aside></div>}</>}
    {screen === 'results' && resultContents()}
    </div></main>
    <footer className="action-bar"><div className="footer-help" role="status"><strong>{finished ? '続きは「設定 → アプリ設定」から開けます' : screen === 'results' ? remaining.length ? '残った項目は、あとから続けられます' : steps.length ? '選んだ項目に確認の記録があります' : '必要になったら、いつでも設定できます' : screen === 'features' ? `${selected.length}機能を選択中` : '必要な機能だけ、あなたのペースで'}</strong><small>{screen === 'features' && invalidPhone ? 'スマホでしたいことを1つ以上選んでください。' : screen === 'results' ? '終了しても、接続・読み上げ・配信は開始しません。' : '選択だけでは機能はONになりません。'}</small></div><div className="footer-buttons"><button className="quiet back" disabled={screen === 'welcome'} onClick={() => { if (screen === 'results') navigate('features'); else if (variant === 'B' && question === 1) setQuestion(0); else navigate('welcome'); }}>戻る</button>{screen === 'features' && <button className="quiet skip" onClick={() => { setSelected([]); navigate('results'); }}>今回は選ばない</button>}<button className="primary next" disabled={finished || screen === 'features' && invalidPhone && !(variant === 'B' && question === 0)} onClick={event => primary(event.currentTarget)}>{screen === 'welcome' ? '使いたい機能を選ぶ →' : screen === 'features' ? variant === 'B' && question === 0 ? '次の質問へ →' : selected.length ? '選んだ機能の設定へ →' : '確認結果へ →' : '設定を終えてホームへ'}</button></div></footer>
    <div className="comparison"><div className="preview-screens"><span>比較する画面</span>{screens.map(item => <button data-screen-button={item} key={item} aria-pressed={screen === item} onClick={() => navigate(item)}>{screenNames[item]}</button>)}<button className="theme" onClick={() => setLight(current => !current)}>{light ? '暗色へ' : '明色へ'}</button><button className="state-button" onClick={event => openModal('state',event.currentTarget)}>表示例・内部状態</button></div><div className="variant-switcher"><button aria-label="前の案" onClick={() => setVariant(current => variants[(variants.indexOf(current) + 2) % 3])}>←</button>{variants.map(item => <button data-variant-button={item} key={item} aria-pressed={variant === item} onClick={() => setVariant(item)}>{item}<span> {names[item]}</span></button>)}<button aria-label="次の案" onClick={() => setVariant(current => variants[(variants.indexOf(current) + 1) % 3])}>→</button><small>{variant} · {names[variant]}</small></div></div>
    <dialog ref={dialog} onCancel={() => setModal(null)} aria-labelledby="dialog-title"><div className="dialog-heading"><h2 id="dialog-title">{modal === 'state' ? '比較用の表示例と内部状態' : modal === 'route' ? 'このあと、選んだ機能の案内へ' : modal ? `${setupStepLabels[modal]}の案内へ` : ''}</h2><button aria-label="閉じる" className="quiet" onClick={() => setModal(null)}>×</button></div>{modal === 'state' ? <><label className="example-label">確認結果の表示例<select value={example} onChange={event => loadExample(event.target.value as Example)}><option value="mixed">確認が残る例</option><option value="ready">すべて確認済みの例</option><option value="attention">要確認がある例</option><option value="empty">何も選ばない例</option></select></label><p className="hint">表示例を選ぶと、比較用の選択と確認記録を読み込みます。本体の設定・接続状態は変わりません。</p><pre>{JSON.stringify({ variant, screen, question, selected, smartphoneUses: uses, steps, records: Object.fromEntries(steps.map(step => [step,records[step]])), finished },null,2)}</pre></> : modal === 'route' ? <><p>今回の案内は、次の順番です。</p><ol className="route-list">{steps.map(step => <li key={step}>{setupStepLabels[step]}</li>)}</ol><p className="hint">設定画面は前回のC案へつなぐ想定です。この見本では接続や保存を行わず、設定後の確認結果へ移動します。</p><button className="primary" onClick={() => { setEntry(null); setModal(null); navigate('results'); }}>確認結果の見本を見る →</button></> : modal && <><p>{nextActions[modal]}</p><div className="revisit-state"><strong>{recordNames[records[modal]]}</strong><p>現在の状態：{currentLabels[modal]}</p></div><p className="hint">ここから該当する設定画面を開き、確認したあと、この一覧へ戻る想定です。見本から実際の設定・接続は操作しません。</p><button className="primary" onClick={() => setModal(null)}>確認結果へ戻る</button></>}</dialog>
  </div>;
}
function exampleRecords(example: Example): Record<SetupStep, RecordState> { return example === 'ready' ? Object.fromEntries(Object.keys(mixed).map(step => [step,'confirmed'])) as Record<SetupStep, RecordState> : example === 'attention' ? { ...mixed, commentSpeech:'needs', obsDisplay:'configured' } : { ...mixed }; }

createRoot(document.getElementById('root')!).render(<App/>);
