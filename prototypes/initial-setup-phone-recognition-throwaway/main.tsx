// Throwaway: compare parallel instructions, a focused wizard, and readiness navigation.
// All actions update memory only. No device access, network setup, recording or persistence.
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

type Screen = 'phone' | 'recognition';
type Variant = 'A' | 'B' | 'C';
type Use = 'comments' | 'speech' | 'video';
type Network = 'lan' | 'tailscale' | 'direct';
const variants: Variant[] = ['A', 'B', 'C'];
const names = { A: '手順と確認を並べる', B: '1つずつ案内する', C: '準備状況から進める' };
const useLabels = { comments: 'コメントを見る', speech: '読み上げを聞く', video: '映像・配信マイクを送る' };
const networks = { lan: '同じWi-Fi・LAN', tailscale: '外出先・Tailscale', direct: '外出先・直接接続' };
const initialPhone = { uses: ['comments'] as Use[], network: 'lan' as Network, prepared: false, registered: false, connected: false, audioSending: false, checked: false };
const initialRecognition = { model: false, input: 'pc', applied: '', transcript: '', enabled: false, checked: false, error: false };
function App() {
  const query = new URLSearchParams(location.search);
  const [variant, setVariant] = useState<Variant>(variants.find(v => v === query.get('variant')) ?? 'A');
  const [screen, setScreen] = useState<Screen>(query.get('screen') === 'recognition' ? 'recognition' : 'phone');
  const [theme, setTheme] = useState('dark');
  const [phone, setPhone] = useState(initialPhone);
  const [recognition, setRecognition] = useState(initialRecognition);
  const [step, setStep] = useState(0);
  const [message, setMessage] = useState('');
  const [dialog, setDialog] = useState<'qr' | 'state' | 'finish' | ''>('');
  const scroll = useRef<HTMLElement>(null);
  const modal = useRef<HTMLDialogElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const isPhone = screen === 'phone';
  const stages = isPhone ? ['使い方を選ぶ', 'PCの接続を準備', 'スマホを登録', '使えるか確認'] : ['モデルを準備', '入力を選んで適用', '話して試す', '配信で使う'];
  const completed = isPhone ? [phone.uses.length > 0, phone.prepared, phone.registered, phone.checked] : [recognition.model, !!recognition.applied, !!recognition.transcript, recognition.checked];
  const firstPending = completed.findIndex(value => !value);
  const changeScreen = (value: Screen) => { setScreen(value); setStep(0); setMessage(''); };
  useEffect(() => {
    const params = new URLSearchParams({ variant, screen });
    history.replaceState(null, '', `?${params}`);
    scroll.current?.scrollTo(0, 0);
    title.current?.focus();
  }, [variant, screen]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || dialog || (event.target instanceof Element && event.target.closest('input,textarea,select,button,summary,[contenteditable]'))) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        setVariant(v => variants[(variants.indexOf(v) + (event.key === 'ArrowRight' ? 1 : 2)) % 3]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog]);
  useEffect(() => { if (dialog) modal.current?.showModal(); else modal.current?.close(); }, [dialog]);
  const notify = (text: string) => setMessage(`見本：${text}`);
  const readyInput = recognition.input === 'pc' || (phone.connected && phone.audioSending);
  const previewValid = !!recognition.transcript && recognition.applied === recognition.input && (recognition.applied !== 'phone' || readyInput);
  function toggleUse(use: Use) {
    setPhone(p => ({ ...p, uses: p.uses.includes(use) ? p.uses.filter(v => v !== use) : [...p.uses, use], checked: false }));
  }
  function phoneStage(index: number) {
    if (index === 0) return <>
      <p>スマホで使いたい機能だけ選びます。複数選べます。</p>
      <fieldset className="use-options"><legend className="sr-only">スマホの用途</legend>{(Object.keys(useLabels) as Use[]).map(use => <label key={use}><input data-use={use} type="checkbox" checked={phone.uses.includes(use)} onChange={() => toggleUse(use)} /><span><strong>{useLabels[use]}</strong><small>{use === 'comments' ? 'PCが取得したコメントをAndroidで表示。' : use === 'speech' ? 'PCのVOICEVOXで作った音声をスマホで再生。' : 'Androidのカメラ・マイクをPCへ送信。'}</small></span></label>)}</fieldset>
      {!phone.uses.length && <p className="warning">使いたい機能を1つ以上選んでください。</p>}
      {phone.uses.includes('speech') && <p className="inline-note">先に「読み上げ」でVOICEVOXの準備と試聴を済ませます。</p>}
      {phone.uses.includes('video') && <p className="inline-note">映像を配信に載せるには、後の「OBS表示」でOBSへの追加も必要です。</p>}
    </>;
    if (index === 1) return <>
      <label className="field">PCとスマホをどこで使いますか？<select data-field="network" value={phone.network} onChange={e => { setPhone(p => ({ ...p, network: e.target.value as Network, prepared: false, connected: false, audioSending: false, checked: false })); notify('選んだ接続方法の準備はまだ始めていません。'); }}>{(Object.keys(networks) as Network[]).map(n => <option key={n} value={n}>{networks[n]}</option>)}</select></label>
      <p>{phone.network === 'lan' ? 'PCとAndroidを、同じ信頼できるルーター・Wi-Fiにつなぎます。' : phone.network === 'tailscale' ? 'PCとAndroidにTailscaleを用意し、同じプライベートネットワークに参加します。' : '外部からPCへ接続するための公開アドレス・ルーター設定などを確認します。'}</p>
      <button className="primary" data-action="prepare" disabled={!phone.uses.length || phone.prepared} onClick={() => { setPhone(p => ({ ...p, prepared: true })); notify('PCの接続準備ができた状態にしました。'); }}>{phone.prepared ? 'PCの準備済み（見本）' : 'PCの接続を準備する'}</button>
      <small className="block">接続方法を選んだだけでは有効になりません。ここでは設定変更・通信は行いません。</small>
      <details><summary>接続の準備ができないとき</summary><p>PCとスマホの接続先、Windowsの通信許可を確認します。外出先で使う場合は、選んだ接続方法の準備も確認してください。</p></details>
    </>;
    if (index === 2) return <>
      <p>Android版きゃすメイトの登録画面で、PCに表示したQRを読み取ります。</p>
      <button className="primary" data-action="qr" disabled={!phone.prepared} onClick={() => setDialog('qr')}>登録用QRを表示</button>
      <p className="status-line">{phone.registered ? '✓ Androidスマホを登録済み（見本）' : 'まだスマホが登録されていません。'}</p>
      <small className="block">登録だけではカメラ・マイクの送信やOBS配信は始まりません。</small>
    </>;
    return <>
      <p>登録したAndroidできゃすメイトを開き、PCとの接続を確認します。</p>
      <button data-action="connect" disabled={!phone.registered || phone.connected} onClick={() => { setPhone(p => ({ ...p, connected: true })); notify('スマホが接続した状態にしました。'); }}>{phone.connected ? 'スマホ接続中（見本）' : 'スマホが接続した状態を見る'}</button>
      <ul className="check-instructions">{phone.uses.map(use => <li key={use}>{use === 'comments' ? 'スマホのコメント画面に、新しいコメントが表示されることを確認。' : use === 'speech' ? '読み上げのテスト音声が、スマホから聞こえることを確認。' : 'Androidで送信を開始して、PCで映像・マイクの状態を確認。OBSへの追加は後で案内します。'}</li>)}</ul>
      <label className="personal"><input data-action="phone-check" type="checkbox" checked={phone.checked} disabled={!phone.connected || !phone.uses.length} onChange={e => setPhone(p => ({ ...p, checked: e.target.checked }))} /><span>選んだ用途がスマホで使えることを確認できた<small>見本内の確認記録です。</small></span></label>
    </>;
  }
  function recognitionStage(index: number) {
    if (index === 0) return <>
      <p>日本語の音声認識モデルを、このPCで使えるようにします。</p>
      <div className="model-info"><strong>日本語 Parakeet CTC</strong><small>ダウンロード 約490 MB ／ 空き容量2 GB以上</small></div>
      <button className="primary" data-action="model" disabled={recognition.model} onClick={() => { setRecognition(r => ({ ...r, model: true, error: false })); notify('モデルの準備済み状態にしました。ダウンロードは行いません。'); }}>{recognition.model ? 'モデル準備済み（見本）' : '音声認識モデルを準備する'}</button>
      <small className="block">初回のみ必要です。音声はこのPC上で認識します。</small>
    </>;
    if (index === 1) return <>
      <label className="field">どの音声を文字にしますか？<select data-field="input" value={recognition.input} onChange={e => setRecognition(r => ({ ...r, input: e.target.value, checked: false }))}><option value="pc">PCの既定のマイク</option><option value="phone">登録したAndroidスマホ</option></select></label>
      {recognition.input === 'phone' && <p className={!phone.connected ? 'warning' : 'inline-note'}>{!phone.registered ? '先にスマホの登録が必要です。' : !phone.connected ? 'スマホが未接続です。Android側の接続と音声送信を確認します。' : 'Android側で音声送信を開始してから、適用してください。'}</p>}
      {recognition.input === 'phone' && !phone.connected && <button onClick={() => changeScreen('phone')}>スマホ連携の見本へ →</button>}
      {recognition.input === 'phone' && phone.connected && <><button data-action="audio-send" disabled={phone.audioSending} onClick={() => { setPhone(p => ({ ...p, audioSending: true })); notify('Androidで音声送信を開始した状態にしました。'); }}>{phone.audioSending ? 'Androidの音声送信中（見本）' : 'Androidで音声送信した状態を見る'}</button><small className="block">実際の操作はAndroid側で行います。</small></>}
      <button className="primary" data-action="apply" disabled={!recognition.model || !readyInput || recognition.applied === recognition.input} onClick={() => { setRecognition(r => ({ ...r, applied: r.input, transcript: '', checked: false, error: false })); notify('選んだ入力を適用しました。認識はまだ開始していません。'); }}>この入力を適用する</button>
      <small className="block">{recognition.applied ? `適用済み：${recognition.applied === 'pc' ? 'PCの既定のマイク' : 'Androidスマホ'}` : 'まだ入力は適用されていません。'}{recognition.applied && recognition.applied !== recognition.input ? ' 選び直した入力は未適用です。' : ''}</small>
      <details><summary>認識の調整・詳細設定</summary><p>音声の区切りや認識タイミングなどの調整は、通常の設定画面で行います。この見本では変更しません。</p></details>
    </>;
    if (index === 2) return <>
      <p>「今日はよろしくお願いします」と話し、文字になるか確かめます。配信で使う設定がOFFでも試せます。</p>
      <button className="primary" data-action="preview" disabled={!recognition.model || !recognition.applied || recognition.applied !== recognition.input || !readyInput} onClick={() => setRecognition(r => ({ ...r, transcript: r.error ? '' : '今日はよろしくお願いします。' }))}>認識プレビューを試す（見本）</button>
      {recognition.error && <p className="warning" role="status">音声入力を利用できません。マイクの接続・Windowsのマイク許可を確認し、入力を選び直して適用してください。</p>}
      <small className="block">録音は行いません。右側の文字は表示例です。</small>
    </>;
    return <>
      <p>確認できたら、普段の配信で使うか選びます。</p>
      <label className="personal"><input data-action="enable" type="checkbox" checked={recognition.enabled} disabled={!previewValid} onChange={e => setRecognition(r => ({ ...r, enabled: e.target.checked }))} /><span>配信に使う<small>ONにすると認識を開始し、次回のアプリ起動時にも自動で認識します。OBSの配信開始とは別の設定です。</small></span></label>
      <label className="personal"><input data-action="recognition-check" type="checkbox" checked={recognition.checked} disabled={!previewValid} onChange={e => setRecognition(r => ({ ...r, checked: e.target.checked }))} /><span>話した言葉が文字で表示された<small>「配信に使う」はOFFのままでも確認できます。</small></span></label>
      <p className="inline-note">文字をOBSに表示する手順は、後の「OBS表示」で案内します。</p>
    </>;
  }
  const content = (index: number) => isPhone ? phoneStage(index) : recognitionStage(index);
  function results() {
    return <aside className="surface preview-panel" aria-label="現在の確認状況"><span className="eyebrow">{isPhone ? 'スマホとのつながり' : '認識の確認'}</span><h2>{isPhone ? '登録と接続を確認' : '話した言葉を、文字に'}</h2>
      {isPhone ? <><div className="connection-picture"><div>▣<small>このPC</small></div><span className={phone.connected ? 'active-link' : ''}>{phone.connected ? '── 接続中 ──' : '··· 未接続 ···'}</span><div>▯<small>Android</small></div></div><dl className="status-list"><div><dt>PCの接続準備</dt><dd>{phone.prepared ? '準備済み' : '未準備'}</dd></div><div><dt>スマホの登録</dt><dd>{phone.registered ? '1台登録済み' : '未登録'}</dd></div><div><dt>現在の接続</dt><dd>{phone.connected ? '接続中' : '未接続'}</dd></div><div><dt>用途の本人確認</dt><dd>{phone.checked ? '確認済み' : '未確認'}</dd></div></dl><p className="inline-note">{!phone.prepared ? 'まずPCの接続を準備しましょう。' : !phone.registered ? '次はAndroidでQRを読み取ります。' : !phone.connected ? '登録済みです。Android側の接続を確かめましょう。' : !phone.checked ? '選んだ用途が使えるか、スマホで確認しましょう。' : '選んだ用途の確認が終わりました。'}</p></> : <><div className="transcript"><small>認識結果の表示例</small><p aria-live="polite">{recognition.transcript || '認識プレビューを試すと、ここに言葉が表示されます。'}</p><span>{recognition.transcript ? '表示例・実際の認識ではありません' : 'まだプレビューしていません'}</span></div><dl className="status-list"><div><dt>モデル</dt><dd>{recognition.model ? '準備済み' : '未準備'}</dd></div><div><dt>適用済み入力</dt><dd>{recognition.applied ? recognition.applied === 'pc' ? 'PCマイク' : 'Android' : '未適用'}</dd></div><div><dt>配信に使う</dt><dd>{recognition.enabled ? 'ON' : 'OFF'}</dd></div><div><dt>文字の本人確認</dt><dd>{recognition.checked ? '確認済み' : '未確認'}</dd></div></dl></>}
      <small>状態・結果はすべて画面見本です。</small></aside>;
  }
  function card(index: number) { return <section className="surface step-card" key={index}><div className="step-heading"><span>{completed[index] ? '✓' : index + 1}</span><h2>{stages[index]}</h2></div>{content(index)}</section>; }
  function VariantA() { return <div className="split guide-split"><div className="step-stack">{stages.map((_, i) => card(i))}</div>{results()}</div>; }
  function VariantB() { return <div className="wizard-layout"><nav className="wizard-nav" aria-label="設定手順">{stages.map((name, i) => <button key={name} aria-current={step === i ? 'step' : undefined} onClick={() => setStep(i)}><span>{completed[i] ? '✓' : i + 1}</span>{name}</button>)}</nav><div className="split wizard-content"><section className="surface wizard-card"><span className="eyebrow">STEP {step + 1} / 4</span><h2>{stages[step]}</h2>{content(step)}<div className="wizard-actions"><button disabled={step === 0} onClick={() => setStep(s => s - 1)}>前の手順</button><button className="primary" disabled={step === 3 || !completed[step]} onClick={() => setStep(s => s + 1)}>次の手順 →</button></div></section>{results()}</div></div>; }
  function VariantC() { return <div className="readiness-layout"><section className="readiness-intro"><div><span className="eyebrow">あと何をすれば使える？</span><h2>{firstPending < 0 ? '確認が終わりました' : `次は「${stages[firstPending]}」`}</h2><p>準備できている項目はそのままに、必要なところから進められます。</p></div><button className="primary" onClick={() => setStep(firstPending < 0 ? 3 : firstPending)}>次に必要な項目を開く ↓</button></section><div className="readiness-columns"><nav className="readiness-nav" aria-label="準備状況">{stages.map((name, i) => <button key={name} aria-current={step === i ? 'step' : undefined} onClick={() => setStep(i)}><span>{completed[i] ? '✓' : '○'}</span><strong>{name}</strong><small>{completed[i] ? '確認・準備済み' : 'これから'}</small></button>)}</nav><section className="surface task-editor"><span className="eyebrow">{step + 1} / 4</span><h2>{stages[step]}</h2>{content(step)}</section>{results()}</div></div>; }
  function scenario(value: string) {
    setMessage('');
    if (value === 'empty') { setPhone(initialPhone); setRecognition(initialRecognition); }
    if (value === 'registered') { setPhone({ ...initialPhone, prepared: true, registered: true }); setRecognition({ ...initialRecognition, model: true }); }
    if (value === 'ready') { setPhone({ ...initialPhone, prepared: true, registered: true, connected: true, audioSending: true, checked: true }); setRecognition({ ...initialRecognition, model: true, applied: 'pc', transcript: '今日はよろしくお願いします。', checked: true }); }
    if (value === 'error') setRecognition({ ...initialRecognition, model: true, applied: 'pc', error: true });
  }
  const checked = isPhone ? phone.checked : recognition.checked;
  return <div className="prototype" data-theme={theme} data-variant={variant} data-screen={screen}>
    <header className="app-header"><strong><span className="brand-icon">き</span><span className="brand-name">きゃすメイト</span></strong><small>画面見本 ／ 接続・録音・保存なし</small><span className="toast" role="status">{message}</span></header>
    <nav className="app-nav" aria-label="アプリ"><span>ホーム</span><span>コメント</span><span className="selected">設定</span><span>OBS</span></nav>
    <main className="page-scroll" ref={scroll}><div className="page-inner"><div className="setup-top"><div><span className="eyebrow">はじめての設定</span><h1 ref={title} tabIndex={-1}>{isPhone ? 'スマホでコメント・音声を使う' : '自分の声を文字にする'}</h1></div><button className="quiet interrupt" onClick={() => notify('本体ではホームへ戻り、設定 → アプリ設定から再開できます。')}>中断してホームへ</button></div>
      <div className="flow-progress"><span>✓ コメント接続</span><i>→</i><span>✓ 読み上げ</span><i>→</i><button data-screen="phone" aria-current={isPhone ? 'step' : undefined} onClick={() => changeScreen('phone')}>3 スマホ連携</button><i>→</i><button data-screen="recognition" aria-current={!isPhone ? 'step' : undefined} onClick={() => changeScreen('recognition')}>4 配信者音声認識</button><i>→</i><span>OBS表示</span></div>
      <p className="description">{isPhone ? 'AndroidとPCをつなぎ、選んだ機能がスマホで使えるか確認します。' : 'モデルとマイクを準備して、話した言葉が文字になるか試します。'}</p>
      {variant === 'A' ? VariantA() : variant === 'B' ? VariantB() : VariantC()}
    </div></main>
    <footer className="action-bar"><div className="footer-help"><strong>{checked ? 'この画面の確認ができました' : '準備と実際の動作を、順番に確認しましょう'}</strong><small>今できない場合は「後で設定する」で進められます。</small></div><div className="footer-buttons"><button className="back" onClick={() => isPhone ? notify('前の「読み上げ」は既存の見本で確認できます。') : changeScreen('phone')}>← 戻る</button><button className="skip" onClick={() => isPhone ? changeScreen('recognition') : setDialog('finish')}>後で設定する</button><button className="primary next" disabled={!checked} onClick={() => isPhone ? changeScreen('recognition') : setDialog('finish')}>{isPhone ? '音声認識へ →' : 'OBS表示へ →'}</button></div></footer>
    {import.meta.env.DEV && <div className="comparison"><div className="preview-screens"><span>比較用の操作</span><button aria-pressed={isPhone} onClick={() => changeScreen('phone')}>スマホ連携</button><button aria-pressed={!isPhone} onClick={() => changeScreen('recognition')}>配信者音声認識</button><button className="theme" onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? 'ライト配色' : 'ダーク配色'}</button><button className="state-button" onClick={() => setDialog('state')}>状態・場面</button></div><div className="variant-switcher"><button aria-label="前の案" onClick={() => setVariant(variants[(variants.indexOf(variant) + 2) % 3])}>←</button>{variants.map(v => <button key={v} data-variant-button={v} aria-pressed={variant === v} onClick={() => setVariant(v)}>{v}案 <span>{names[v]}</span></button>)}<button aria-label="次の案" onClick={() => setVariant(variants[(variants.indexOf(variant) + 1) % 3])}>→</button><small>{variant}案 · {names[variant]}</small></div></div>}
    <dialog ref={modal} onCancel={() => setDialog('')}><div className="dialog-heading"><h2>{dialog === 'qr' ? 'Androidで登録する' : dialog === 'state' ? '見本の状態・場面' : '次はOBS表示'}</h2><button aria-label="閉じる" onClick={() => setDialog('')}>×</button></div>
      {dialog === 'qr' && <><div className="qr-example" aria-label="QRの配置見本">▦</div><p className="center">QRの配置見本です。読み取り・登録はできません。</p><ol className="route-list"><li>Android版きゃすメイトを開く</li><li>スマホ連携の登録画面で、PCのQRを読み取る</li><li>登録後、PCとの接続を確認する</li></ol><button className="primary" data-action="register" onClick={() => { setPhone(p => ({ ...p, registered: true })); setDialog(''); notify('Androidを1台登録した状態にしました。接続はまだ確認していません。'); }}>登録済みの状態を見る</button></>}
      {dialog === 'state' && <><label className="field">場面を切り替える<select defaultValue="" data-field="scenario" onChange={e => scenario(e.target.value)}><option value="" disabled>場面を選ぶ</option><option value="empty">最初から</option><option value="registered">スマホ登録済み・未接続</option><option value="ready">両方の確認済み</option><option value="error">音声認識の入力エラー</option></select></label><p>比較中の選択と状態は、案・画面を切り替えても保持します。再読み込みでリセットします。</p><pre>{JSON.stringify({ variant, screen, theme, step, phone, recognition, dialog, message }, null, 2)}</pre></>}
      {dialog === 'finish' && <><p>この先は既存の「OBS表示」の案内につながります。</p><p>今回はスマホ連携・配信者音声認識の比較見本です。設定や確認記録は保存していません。</p><button className="primary" onClick={() => setDialog('')}>この見本に戻る</button></>}
    </dialog>
  </div>;
}
createRoot(document.getElementById('root')!).render(<App />);
